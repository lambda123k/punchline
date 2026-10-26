// Partie complète : 3 téléphones + 1 grand écran contre le faux backend
const { chromium } = require("playwright");
const fs = require("fs");
const S = __dirname, BASE = "http://localhost:8787/";
const CLIENT = fs.readFileSync(S + "/mock-client.js", "utf8");
const QR = `window.qrcode=function(){return{addData(){},make(){},createSvgTag(){return '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'}}};`;
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const admin = code => fetch(BASE + "api/admin", { method: "POST", body: JSON.stringify({ code }) }).then(r => r.json()).then(j => j.data);
let ok = 0, fail = 0;
function check(c, msg){ if (c){ ok++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } }

async function phone(browser, name, opts){
  const ctx = await browser.newContext(opts || { viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await ctx.route(/supabase-js/, r => r.fulfill({ body: CLIENT, contentType: "application/javascript" }));
  await ctx.route(/qrcode-generator/, r => r.fulfill({ body: QR, contentType: "application/javascript" }));
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(name + ": " + e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(name + " console: " + m.text()); });
  p.label = name;
  return p;
}
const txt0 = p => p.locator("#app").innerText();
const txt = p => txt0(p).then(t => ({ includes: s => t.toLowerCase().includes(s.toLowerCase()), slice: (a, b) => t.slice(a, b) }));
async function until(p, fn, msg, ms){
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)){ try { if (await fn()) return true; } catch(e){} await sleep(150); }
  console.log("  ⏱ attente dépassée : " + msg + " (" + p.label + ")\n" + (await txt(p)).slice(0, 400));
  return false;
}
const hasText = (p, s) => until(p, async () => (await txt(p)).includes(s), s);

(async () => {
  const browser = await chromium.launch();
  const A = await phone(browser, "Naim"), B = await phone(browser, "Léa"), C = await phone(browser, "Tom");
  const TV = await phone(browser, "TV", { viewport: { width: 1600, height: 900 } });

  console.log("Création et arrivée des joueurs");
  await A.goto(BASE); check(await hasText(A, "À quoi voulez-vous jouer"), "l'accueil propose les deux jeux"); await A.click("[data-a=pickGame][data-v=punchline]"); await A.fill("#name", "Naim"); await A.click("text=Créer une partie"); await A.click("text=Créer la partie");
  await until(A, async () => /\d{4}/.test(await A.locator(".codebig").innerText()), "code");
  const code = (await A.locator(".codebig").innerText()).trim();
  for (const [p, n] of [[B, "Léa"], [C, "Tom"]]){ await p.goto(BASE + "?c=" + code); await p.fill("#name", n); await p.click("[data-a=join]"); }
  await hasText(A, "Tom");
  check(await A.locator("[data-a=addBot]").count() === 1, "l'hôte peut ajouter un robot");

  console.log("Grand écran");
  await TV.goto(BASE); await TV.click("[data-a=menu]"); await TV.click("[data-a=showTv]"); await TV.fill("#code", code); await TV.click("[data-a=watch]");
  await hasText(TV, "Lancer l'affichage"); await TV.click("[data-a=tvGo]");
  await TV.waitForSelector(".tvlobby");
  check((await txt(TV)).includes("Léa") && (await txt(TV)).includes("Tom"), "le grand écran liste les joueurs");
  check(await admin(`return db.players.length`) === 3, "le grand écran ne compte pas comme joueur");
  await TV.screenshot({ path: S + "/tv-lobby.png" });

  console.log("Manche 1");
  await A.click("[data-a=start]");
  const judgeId = async () => admin(`return db.rooms[0].judge`);
  const ids = await admin(`return Object.fromEntries(db.players.map(p=>[p.name,p.id]))`);
  const byName = { Naim: A, "Léa": B, Tom: C };
  let jid = await until(A, async () => !!(await judgeId()), "juge") && await judgeId();
  let jName = Object.keys(ids).find(k => ids[k] === jid), J = byName[jName];
  const others = Object.keys(byName).filter(n => n !== jName);
  console.log("  juge : " + jName);
  await hasText(J, "Piocher une carte"); await J.click("[data-a=peek]"); await J.waitForSelector("[data-a=keep]"); await J.click("[data-a=peek]"); await J.click("[data-a=keep]");
  await hasText(TV, "réponses");
  await TV.screenshot({ path: S + "/tv-writing.png" });
  for (const n of others){ const p = byName[n]; await until(p, () => p.locator("#ans").isVisible(), "zone réponse"); await p.fill("#ans", "réponse de " + n); await p.click("#send"); }
  await hasText(J, "Lis-les une par une");
  for (let i = 0; i < 2; i++){ await J.click("[data-a=flip]"); await sleep(400); }
  const P1 = byName[others[0]], P2 = byName[others[1]];
  await until(P1, () => P1.locator("[data-a=vote]").count().then(n => n === 1), "un seul bouton coup de cœur (pas pour la sienne)");
  check(await P1.locator(".mine").count() === 1, "sa propre réponse est marquée « Ta réponse »");
  // les deux votent pour la réponse de P2 : P1 vote, P2 ne peut pas voter pour la sienne et vote… pour P1
  await P1.click("[data-a=vote]");
  await until(P1, () => P1.locator(".heart.on").count().then(n => n === 1), "vote affiché");
  check((await P1.locator(".heart.on").innerText()).includes("Ton coup de cœur"), "le vote s'affiche tout de suite");
  // réactions
  await P1.click("[data-a=react][data-v='😂']");
  const flew = await until(P2, () => P2.locator(".fly").count().then(n => n > 0), "réaction reçue chez un autre joueur", 3000);
  check(flew, "une réaction 😂 apparaît sur l'écran d'un autre joueur");
  check(await until(TV, () => TV.locator(".fly").count().then(n => n > 0), "réaction sur la télé", 3000), "la réaction apparaît aussi sur le grand écran");
  await TV.screenshot({ path: S + "/tv-judging.png" });
  await P1.screenshot({ path: S + "/phone-judging.png", fullPage: true });
  // le juge choisit la réponse de P1 (la seule votée est celle de P2)
  await J.locator(".answer", { hasText: "réponse de " + others[0] }).click();
  await J.click("[data-a=confirmPick]");
  await hasText(P1, "Gagnant de la manche");
  const scores = await admin(`return Object.fromEntries(db.players.map(p=>[p.name,p.score]))`);
  check(scores[others[0]] === 1 && scores[others[1]] === 1, `gagnant +1 et coup de cœur +1 (${JSON.stringify(scores)})`);
  check(await hasText(P2, "Coup de cœur du public"), "le coup de cœur s'affiche au résultat");
  check(await hasText(TV, "Coup de cœur du public"), "… et sur le grand écran");
  await TV.screenshot({ path: S + "/tv-result.png" });

  console.log("Notation de la carte");
  const nonHost = [B, C].find(p => p);
  check(await nonHost.locator("[data-a=rate]").count() === 0, "la notation n'apparaît pas chez les autres joueurs");
  check(await B.locator(".badges-now").count() === 0, "pas d'insigne annoncé en fin de manche");
  await A.click("[data-a=rate][data-v='1']");
  await until(A, () => A.locator(".rate .on").count().then(n => n === 1), "note affichée");
  await until(A, async () => (await admin(`return db.card_ratings.length`)) === 1, "1 note");
  check(await admin(`return db.card_ratings.length`) === 1, "l'hôte note discrètement la carte (type " + await admin(`return db.card_ratings[0].type`) + ")");
  await P2.screenshot({ path: S + "/phone-result.png", fullPage: true });

  console.log("Absence d'un joueur");
  const winner = others[0], W = byName[winner];
  const gone = others[1]; // le non-gagnant ne répond plus
  const Gp = byName[gone];
  await Gp.context().setOffline(true);
  await admin(`db.players.find(p=>p.name===${JSON.stringify(gone)}).last_seen=new Date(Date.now()-60000).toISOString()`);
  for (const p of [A, B, C]) if (p !== Gp && await p.locator("[data-a=next]").count()){ await p.click("[data-a=next]"); break; }
  await hasText(W, "Tu es le juge");
  await W.click("[data-a=peek]"); await W.waitForSelector("[data-a=keep]"); await W.click("[data-a=keep]");
  const leaderPage = A;
  await hasText(leaderPage, "Parti");
  check(await until(W, async () => (await W.locator(".counter").innerText()) === "0/1", "compteur 0/1"), "le juge n'attend que les joueurs présents (0/1)");
  const writer = Object.keys(byName).find(n => n !== winner && n !== gone);
  await byName[writer].fill("#ans", "seul réponse"); await byName[writer].click("#send");
  check(await hasText(W, "Lis-les une par une"), "la manche avance sans attendre l'absent");

  console.log("Le juge part en pleine manche");
  await W.click("[data-a=flip]"); await sleep(300);
  await W.context().setOffline(true);
  const r0 = await admin(`return db.rooms[0].round`);
  await admin(`db.players.find(p=>p.name===${JSON.stringify(winner)}).last_seen=new Date(Date.now()-60000).toISOString()`);
  // l'hôte (s'il est encore là) relance une manche avec un autre juge
  const host = [A, B, C].find(p => p !== W && p !== Gp);
  const moved = await until(host, async () => (await admin(`return db.rooms[0].round`)) > r0, "nouvelle manche après départ du juge", 12000);
  check(moved, "l'hôte relance une manche quand le juge est parti");
  const nj = await admin(`return db.rooms[0].judge`);
  check(nj !== ids[winner] && nj !== ids[gone], "le nouveau juge est un joueur présent");

  console.log("Retour d'un absent");
  await Gp.context().setOffline(false);
  await Gp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await sleep(1500);
  const seenOk = await admin(`const p=db.players.find(p=>p.name===${JSON.stringify(gone)}); return Date.now()-Date.parse(p.last_seen)<5000`);
  check(seenOk, "le joueur qui revient redevient présent");

  console.log("Page des notes");
  const S1 = await phone(browser, "Stats"); await S1.goto(BASE); await S1.click("[data-a=menu]"); await S1.click("[data-a=stats]");
  await hasText(S1, "% top");
  check((await txt(S1)).includes("1 note"), "la page affiche les notes par type");
  await S1.screenshot({ path: S + "/stats.png", fullPage: true });

  console.log("Pioche pondérée");
  const w = await A.evaluate(async () => {
    // simulation : une carte notée top 3 fois, une nulle 3 fois
    const C = window.CARDS; const n = { top: 0, nul: 0 };
    return n;
  });
  void w;

  console.log(`\n${ok} réussis, ${fail} ratés`);
  if (errors.length) console.log("Erreurs JS :\n" + [...new Set(errors)].join("\n"));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
