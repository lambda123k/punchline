// Partie des « Aveux » : 3 téléphones + 1 robot + grand écran contre le faux backend
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
  const ctx = await browser.newContext({ serviceWorkers: "block", ...(opts || { viewport: { width: 390, height: 844 }, hasTouch: true }) });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await ctx.route(/supabase-js/, r => r.fulfill({ body: CLIENT, contentType: "application/javascript" }));
  await ctx.route(/qrcode-generator/, r => r.fulfill({ body: QR, contentType: "application/javascript" }));
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(name + ": " + e.message));
  p.on("console", m => { if (m.type() === "error" && !m.text().includes("ERR_FAILED")) errors.push(name + " console: " + m.text()); });
  p.label = name;
  return p;
}
const txt = p => p.locator("#app").innerText();
async function until(p, fn, msg, ms){
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 10000)){ try { if (await fn()) return true; } catch(e){} await sleep(150); }
  console.log("  ⏱ attente dépassée : " + msg + " (" + p.label + ")\n" + (await txt(p)).slice(0, 400));
  return false;
}
const hasText = (p, s, ms) => until(p, async () => (await txt(p)).toLowerCase().includes(s.toLowerCase()), s, ms);
const room = () => admin(`return db.rooms[0]`);

(async () => {
  const browser = await chromium.launch();
  const A = await phone(browser, "Naim"), B = await phone(browser, "Léa"), C = await phone(browser, "Tom");
  const TV = await phone(browser, "TV", { viewport: { width: 1600, height: 900 } });
  const humans = [["Naim", A], ["Léa", B], ["Tom", C]]; let D = null;

  console.log("Accueil et salle d'attente");
  await A.goto(BASE);
  check(await A.locator(".gamecard").count() === 3, "trois jeux sur l'écran d'accueil");
  check(await A.locator(".instbar").count() === 1, "le bandeau d'installation s'affiche dans le navigateur");
  await A.screenshot({ path: S + "/install-bar.png" });
  await A.click("[data-a=instClose]");
  check(await until(A, () => A.locator(".instbar").count().then(n => n === 0), "bandeau fermé"), "le bandeau se ferme et ne revient pas");
  await A.screenshot({ path: S + "/aveux-home.png", fullPage: true });
  await A.click("[data-a=pickGame][data-v=aveux]"); await A.fill("#name", "Naim"); await A.click("text=Créer une partie"); await A.click("text=Créer la partie");
  await until(A, async () => /\d{4}/.test(await A.locator(".codebig").innerText()), "code");
  const code = (await A.locator(".codebig").innerText()).trim();
  for (const [n, p] of humans.slice(1)){ await p.goto(BASE + "?c=" + code); await p.fill("#name", n); await p.click("[data-a=join]"); }
  await hasText(A, "Tom");
  check((await room()).game === "aveux", "la partie est bien une partie des Aveux");
  check(await hasText(B, "Aveux"), "les autres arrivent dans Les Aveux");
  await A.click("[data-a=addBot]");
  await hasText(A, "Robot Gégé");

  console.log("Soft / Trash, cartes perso, selfie");
  check(await A.locator(".vb").count() === 2 && await B.locator(".vb:visible").count() === 1, "l'hôte voit les deux ambiances, les autres seulement celle choisie");
  await A.click("[data-a=vibe][data-v=soft]");
  check(await until(A, async () => (await room()).mode === "soft", "mode soft"), "l'hôte passe en Soft");
  check(await until(B, () => B.locator(".vb.s").count().then(n => n === 1), "soft chez B"), "les autres voient Soft");
  await A.fill("#cin", "j'ai déjà testé Dawa tout seul"); await A.click("[data-a=cadd]");
  check(await until(A, async () => ((await room()).custom || [])[0] === "J'ai déjà testé Dawa tout seul", "carte perso"), "carte perso ajoutée");
  await A.fill("#cin", "à supprimer"); await A.press("#cin", "Enter");
  await until(A, async () => ((await room()).custom || []).length === 2, "2 cartes");
  await A.click(".cardrow >> nth=1 >> [data-a=cdel]");
  check(await until(A, async () => ((await room()).custom || []).length === 1, "suppression"), "carte perso retirée");
  check(await B.locator("#cin").count() === 0, "seul l'hôte peut ajouter des cartes perso");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");
  await A.setInputFiles("#selfie", { name: "me.png", mimeType: "image/png", buffer: png });
  check(await until(A, async () => /^data:image\/jpeg;base64,/.test((await admin("return db.players[0].photo")) || ""), "photo"), "le selfie est enregistré, réduit en jpeg");
  check(await until(B, () => B.locator(".av.photo").count().then(n => n >= 1), "photo chez B"), "les autres voient le selfie dans la pastille");
  await A.screenshot({ path: S + "/lobby-nouveautes.png", fullPage: true });
  await TV.goto(BASE + "?tv=" + code); await hasText(TV, "Lancer l'affichage"); await TV.click("[data-a=tvGo]");
  await TV.waitForSelector(".tvlobby");

  for (const round of [1, 2]){
    console.log(`Manche ${round}`);
    if (round === 1) await A.click("[data-a=start]");
    else { await A.waitForSelector("[data-a=next]"); await A.click("[data-a=next]"); }
    check(await until(A, async () => { const r = await room(); return r.phase === "writing" && r.round === round; }, "affirmation tirée"), "l'affirmation est tirée toute seule");
    const r = await room();
    console.log("  affirmation : " + r.card);
    if (round === 1) check(r.card === "J'ai déjà testé Dawa tout seul", "la carte perso sort en premier");
    if (round === 2){
      console.log("  Zoé arrive en cours de manche");
      D = await phone(browser, "Zoé");
      await D.goto(BASE + "?c=" + code); await D.fill("#name", "Zoé"); await D.click("[data-a=join]");
      check(await hasText(D, "prochaine manche"), "Zoé attend la manche suivante");
      check(await D.locator("[data-a=ayes]").count() === 0, "Zoé ne peut pas répondre à la manche en cours");
      await D.screenshot({ path: S + "/aveux-late.png", fullPage: true });
    }
    for (const [, p] of humans) await hasText(p, r.card);
    check(await admin(`return db.aveux_bets.filter(b=>b.round===${round}).every(b=>b.said==null)`), "avant le résultat, personne ne voit les réponses");
    check(await hasText(TV, r.card), "le grand écran montre l'affirmation");
    check(await A.locator("text=Juge").count() === 0, "pas de juge dans ce jeu");
    if (round === 1) await A.screenshot({ path: S + "/aveux-answer.png", fullPage: true });
    // Naim et Léa disent oui, Tom non ; paris 1, 2, 3 en manche 1
    const plan = { Naim: [true, 1], "Léa": [true, 2], Tom: [false, 3] };
    for (const [n, p] of humans){
      const [y, bet] = plan[n];
      await p.click(`[data-a=ayes][data-v="${y ? 1 : 0}"]`);
      await p.waitForSelector(".astep");
      const start = +(await p.locator(".astep .an").innerText());
      check(start === 2, `le pari démarre à la moitié (${start})`);
      for (let i = start; i < bet; i++) await p.click("[data-a=abet][data-v='1']");
      for (let i = start; i > bet; i--) await p.click("[data-a=abet][data-v='-1']");
      check(+(await p.locator(".astep .an").innerText()) === bet, `${n} parie ${bet}`);
      if (round === 1 && n === "Naim") await p.screenshot({ path: S + "/aveux-bet.png", fullPage: true });
      if (round === 1 && n === "Tom"){ await p.click("[data-a=aback]"); await p.waitForSelector(".ayn"); await p.click(`[data-a=ayes][data-v="0"]`); check(+(await p.locator(".astep .an").innerText()) === bet, "changer de réponse garde le pari"); }
      await p.click("[data-a=asend]");
      await hasText(p, "Pari envoyé");
    }
    const before = await admin(`return Object.fromEntries(db.players.map(p=>[p.name,p.score]))`);
    check(await until(A, async () => (await room()).phase === "result", "révélation", 15000), "révélation dès que tout le monde (robot compris) a parié");
    const rr = await room();
    const bets = await admin(`return db.aveux_bets.filter(b=>b.round===${round})`);
    check(bets.length === 4, "4 paris enregistrés");
    const after = await admin(`return Object.fromEntries(db.players.map(p=>[p.name,p.score]))`);
    const names = await admin(`return Object.fromEntries(db.players.map(p=>[p.id,p.name]))`);
    const botYes = rr.yes - 2;
    check(botYes === 0 || botYes === 1, `nombre de oui cohérent (${rr.yes})`);
    const expect = {}; bets.forEach(b => { const e = Math.abs(b.bet - rr.yes); expect[names[b.player]] = e === 0 ? 2 : e === 1 ? 1 : 0; });
    const diff = Object.fromEntries(Object.keys(after).map(n => [n, after[n] - before[n]]));
    check(JSON.stringify(diff) === JSON.stringify(Object.fromEntries(Object.keys(after).map(n => [n, expect[n] || 0]))), `points : ${JSON.stringify(diff)}`);
    check(await until(B, async () => (await B.locator(".ybig.done").count()) === 1, "compteur fini", 10000), "le compteur monte jusqu'au total");
    check(+(await B.locator(".ybig").innerText()).split("\n")[0] === rr.yes, "le bon nombre de oui s'affiche");
    await B.waitForSelector(".camps");
    check(await B.locator(".camp.y .who").count() === rr.yes && await B.locator(".camp.n .who").count() === 4 - rr.yes, "les deux camps OUI / NON s'affichent à la fin du compteur");
    check((await B.locator(".camp.y").innerText()).includes("Naim") && (await B.locator(".camp.n").innerText()).includes("Tom"), "chacun est dans le bon camp");
    await until(TV, async () => (await TV.locator(".ybig.done").count()) === 1, "compteur TV");
    if (round === 1){ await B.screenshot({ path: S + "/aveux-result.png", fullPage: true }); await TV.screenshot({ path: S + "/aveux-tv-result.png" }); }
  }

  check(await until(D, async () => (await D.locator("[data-a=ayes]").count()) === 0 && !(await txt(D)).includes("prochaine manche"), "Zoé voit le résultat"), "Zoé voit le résultat de la manche");
  console.log("Temps limité : la réponse part toute seule (mode soft)");
  await D.waitForSelector("[data-a=next]", { state: "detached" }).catch(() => {});
  await admin(`db.rooms[0].mode = "soft"`);
  await A.click("[data-a=next]");
  await until(A, async () => (await room()).phase === "writing", "manche 3");
  await admin(`const r=db.rooms[0]; r.timer=3; r.deadline=new Date(Date.now()+3000).toISOString()`);
  check(await until(D, () => D.locator("[data-a=ayes]").count().then(n => n > 0), "Zoé joue"), "Zoé joue dès la manche suivante");
  await A.click(`[data-a=ayes][data-v="1"]`);
  check(await until(A, async () => (await room()).phase === "result", "révélation au bout du temps", 12000), "à la fin du temps, le pari part et on révèle");
  check(await admin(`return db.aveux_bets.filter(b=>b.round===3).some(b=>b.player===db.players[0].id)`), "le pari de Naim est parti seul");
  const c3 = (await room()).card;
  const APP = require("fs").readFileSync(__dirname + "/../app.js", "utf8");
  const TT = new Set(JSON.parse(APP.match(/TRASH_TYPES = new Set\((\[.*?\])\)/)[1])), TC = new Set(JSON.parse(APP.match(/TRASH_CARDS = new Set\((\[.*?\])\)/s)[1]));
  const atype = await A.evaluate(t => (window.AVEUX_TYPE || {})[t], c3);
  check(!TT.has(atype) && !TC.has(c3), "en soft, l'affirmation tirée n'est pas trash (" + c3 + ")");
  await admin(`db.rooms[0].mode = "mix"`);

  console.log("Fin et rejouer");
  await admin(`db.rooms[0].target = 1; db.players[0].score = Math.max(1, db.players[0].score)`);
  await hasText(A, "Classement final");
  await A.click("[data-a=next]");
  await until(A, async () => (await room()).phase === "end", "fin");
  await hasText(A, "Rejouer"); await A.click("[data-a=restart]");
  check(await until(A, async () => { const r = await room(); return r.phase === "lobby" && r.game === "aveux"; }, "lobby"), "« Rejouer » garde Les Aveux");
  check(((await room()).custom || []).length === 0, "les cartes perso sont effacées au retour en salle d'attente");

  console.log("Changer de jeu depuis la fin");
  await admin(`db.rooms[0].phase = "end"; db.players.forEach(p => p.score = 2)`);
  await until(A, () => A.locator(".mg").count().then(n => n === 2), "deux autres jeux");
  check(await A.locator(".mg[data-v=aveux]").count() === 0, "le jeu en cours n'est pas dans les raccourcis");
  await A.screenshot({ path: S + "/fin-changer-jeu.png", fullPage: true });
  await A.click(".mg[data-v=qui]");
  check(await until(A, async () => { const r = await room(); return r.phase === "lobby" && r.game === "qui"; }, "lobby verdict"), "passer au Verdict : même salle, salle d'attente");
  check(await until(A, async () => (await admin("return db.players.map(p => p.score)")).every(x => x === 0), "scores"), "scores remis à zéro");
  check(await until(B, () => B.locator(".biglogo").innerText().then(t => /Verdict/.test(t)), "logo chez B"), "les autres joueurs passent au Verdict");

  console.log("Changer de jeu dans la salle d'attente");
  check(await B.locator("[data-a=swap]").count() === 0, "seul l'hôte voit « Changer de jeu »");
  await A.click("[data-a=swap]");
  await until(A, () => A.locator(".mg[data-a=game]").count().then(n => n === 2), "choix ouvert");
  await A.screenshot({ path: S + "/attente-changer-jeu.png", fullPage: true });
  await A.click(".mg[data-v=punchline]");
  check(await until(A, async () => { const r = await room(); return r.phase === "lobby" && r.game === "punchline"; }, "punchline"), "l'hôte passe à Punchline depuis la salle d'attente");
  check(await until(C, () => C.locator(".biglogo").innerText().then(t => /Punch/.test(t)), "logo chez C"), "le gros logo change chez les autres");

  console.log(`\n${ok} réussis, ${fail} ratés`);
  if (errors.length) console.log("Erreurs JS :\n" + [...new Set(errors)].join("\n"));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
