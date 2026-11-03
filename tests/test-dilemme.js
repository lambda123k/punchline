// Partie du « Dilemme » : 3 téléphones + 1 robot + grand écran contre le faux backend
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
async function slide(p, v){ await p.locator("#dslide").evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, v); }

(async () => {
  const browser = await chromium.launch();
  const A = await phone(browser, "Naim"), B = await phone(browser, "Léa"), C = await phone(browser, "Tom");
  const TV = await phone(browser, "TV", { viewport: { width: 1600, height: 900 } });
  const humans = [["Naim", A], ["Léa", B], ["Tom", C]];

  console.log("Accueil et salle d'attente");
  await A.goto(BASE);
  check(await A.locator(".gamecard").count() === 5, "cinq jeux sur l'écran d'accueil");
  await A.click("[data-a=instClose]").catch(() => {});
  await A.screenshot({ path: S + "/dilemme-home.png", fullPage: true });
  await A.click("[data-a=pickGame][data-v=dilemme]"); await A.fill("#name", "Naim"); await A.click("text=Créer une partie"); await A.click("text=Créer la partie");
  await until(A, async () => /\d{4}/.test(await A.locator(".codebig").innerText()), "code");
  const code = (await A.locator(".codebig").innerText()).trim();
  for (const [n, p] of humans.slice(1)){ await p.goto(BASE + "?c=" + code); await p.fill("#name", n); await p.click("[data-a=join]"); }
  await hasText(A, "Tom");
  check((await room()).game === "dilemme", "la partie est bien une partie du Dilemme");
  check(await hasText(B, "Dilemme"), "les autres arrivent dans Le Dilemme");
  await A.click("[data-a=addBot]");
  await hasText(A, "Robot");
  await A.fill("#cin", "tu préfères manger froid / manger tiède");
  await A.click("[data-a=cadd]");
  check(await until(A, async () => ((await room()).custom || [])[0] === "Manger froid\nManger tiède", "carte perso"), "dilemme perso découpé en rouge / bleu");
  await A.screenshot({ path: S + "/dilemme-lobby.png", fullPage: true });
  await TV.goto(BASE + "?tv=" + code); await hasText(TV, "Lancer l'affichage"); await TV.click("[data-a=tvGo]");
  await TV.waitForSelector(".tvlobby");

  for (const round of [1, 2]){
    console.log(`Manche ${round}`);
    if (round === 1) await A.click("[data-a=start]");
    else { await A.waitForSelector("[data-a=next]"); await A.click("[data-a=next]"); }
    check(await until(A, async () => { const r = await room(); return r.phase === "writing" && r.round === round; }, "dilemme tiré"), "le dilemme est tiré tout seul");
    const r = await room();
    const [red, blue] = r.card.split("\n");
    console.log("  dilemme : " + red + " / " + blue);
    if (round === 1) check(r.card === "Manger froid\nManger tiède", "le dilemme perso sort en premier");
    else check(await A.evaluate(c => window.DIL.includes(c), r.card), "le dilemme vient du paquet");
    for (const [, p] of humans) await hasText(p, red);
    check(await hasText(TV, blue), "le grand écran montre les deux côtés");
    check(await A.locator(".dsplit .dh.r").count() === 1 && await A.locator(".dsplit .dh.b").count() === 1, "écran coupé rouge / bleu");
    if (round === 1) await A.screenshot({ path: S + "/dilemme-choose.png", fullPage: true });
    // Naim et Léa bleu, Tom rouge ; curseurs 50 (défaut), 75, 25 ; tout le monde devine « bleu » pour la cible
    const plan = { Naim: [true, null], "Léa": [true, 3], Tom: [false, 1] };
    const target = r.judge, tname = await admin(`return (db.players.find(p => p.id === "${target}") || {}).name`);
    console.log("  dans le viseur : " + tname);
    for (const [n, p] of humans){
      const [y, v] = plan[n];
      await p.click(`[data-a=ayes][data-v="${y ? 1 : 0}"]`);
      await p.waitForSelector("#dslide");
      check(await p.locator(".dsplit.small").innerText().then(x => x.includes(red) && x.includes(blue)), `${n} : le dilemme reste affiché pendant le pari`);
      check(+(await p.locator("#dslide").getAttribute("max")) === 4, `${n} : 4 joueurs, le curseur a 4 crans`);
      check(+(await p.locator("#dslide").inputValue()) === 2 && (await p.locator(".dmeter").innerText()).includes("50 %"), `${n} : le curseur démarre à 50 %`);
      if (v != null){ await slide(p, v); check((await p.locator(".dmeter").innerText()).includes(v * 25 + " %"), `${n} : la barre suit le curseur (${v * 25} %)`); }
      if (tname === n){
        check(await p.locator(".dreadme").count() === 1 && await p.locator(".dread").count() === 0, `${n} est dans le viseur : il ne devine pas`);
      } else {
        check(await p.locator(".dread").count() === 1 && await p.locator("[data-a=asend]").isDisabled(), `${n} : il faut deviner le choix de ${tname} avant de valider`);
        await p.click("[data-a=aread][data-v='1']");
        check(!(await p.locator("[data-a=asend]").isDisabled()), `${n} : Valider s'active après la devinette`);
      }
      if (round === 1 && n === "Léa") { await sleep(1800); await p.screenshot({ path: S + "/dilemme-guess.png", fullPage: true }); }
      await p.click("[data-a=asend]");
      await hasText(p, "Envoyé");
    }
    const before = await admin(`return Object.fromEntries(db.players.map(p=>[p.name,p.score]))`);
    check(await until(A, async () => (await room()).phase === "result", "révélation", 15000), "révélation dès que tout le monde (robot compris) a joué");
    const rr = await room();
    const bets = await admin(`return db.aveux_bets.filter(b=>b.round===${round})`);
    check(bets.length === 4, "4 paris enregistrés");
    check(bets.every(b => b.bet % 25 === 0), "tous les paris tombent sur un cran (0, 25, 50, 75, 100)");
    const after = await admin(`return Object.fromEntries(db.players.map(p=>[p.name,p.score]))`);
    const names = await admin(`return Object.fromEntries(db.players.map(p=>[p.id,p.name]))`);
    const n = bets.length, m = Math.min(...bets.map(b => Math.abs(b.bet * n - rr.yes * 100)));
    const ts = (await admin(`return db.aveux_bets.find(b=>b.round===${round}&&b.player==="${target}")`)).said;
    const expect = {}; bets.forEach(b => { expect[names[b.player]] = (Math.abs(b.bet * n - rr.yes * 100) === m ? (b.bet === Math.round(rr.yes * 100 / n) ? 2 : 1) : 0) + (b.player !== target && b.read === ts ? 1 : 0); });
    const diff = Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]]));
    check(JSON.stringify(diff) === JSON.stringify(Object.fromEntries(Object.keys(after).map(k => [k, expect[k] || 0]))), `points (plus proche, pile, lecture) : ${JSON.stringify(diff)} (bleu ${rr.yes}/4, ${tname} a pris ${ts ? "bleu" : "rouge"})`);
    check(bets.filter(b => b.player !== target).every(b => b.read != null) && bets.find(b => b.player === target).read == null, "les devinettes sont enregistrées, sauf pour la cible");
    const pct = Math.round(rr.yes * 100 / 4);
    check(await until(B, async () => (await B.locator(".dwin").count()) === 1, "révélation finie", 10000), "la barre monte puis le gagnant s'affiche");
    check((await B.locator(".dbig").innerText()).includes(pct + " %"), `le vrai pourcentage s'affiche (${pct} %)`);
    check(await B.locator(".druler .dg").count() === 4, "les 4 paris sont placés sur la règle");
    check(await B.locator(".camp.db .who").count() === rr.yes && await B.locator(".camp.dr .who").count() === 4 - rr.yes, "les camps ROUGE / BLEU s'affichent");
    check((await B.locator(".camp.db").innerText()).includes("Naim") && (await B.locator(".camp.dr").innerText()).includes("Tom"), "chacun est dans le bon camp");
    check(await B.locator(".dreadres").count() === 1 && (await B.locator(".dreadres .drc").innerText()) === (ts ? "BLEU" : "ROUGE"), "on voit le choix de la cible et qui l'a deviné");
    const alone = rr.yes === 3 ? "Tom" : null;
    check(alone ? (await B.locator(".dalone").innerText()).includes(alone) && (await B.locator(".dalone").innerText()).includes("Défends-toi") : await B.locator(".dalone").count() === 0, alone ? "Tom seul en rouge : Défends-toi" : "2 contre 2 : personne ne doit se défendre");
    if (bets.some(b => b.bet === pct)) check(await B.locator(".dwin.pile").count() === 1 && (await B.locator(".dwin small").innerText()) === "+2", "pile sur le bon % : +2 affiché");
    await until(TV, async () => (await TV.locator(".dwin").count()) === 1, "révélation TV");
    if (round === 1){ await B.screenshot({ path: S + "/dilemme-result.png", fullPage: true }); await TV.screenshot({ path: S + "/dilemme-tv-result.png" }); }
  }

  console.log("Soft : pas de dilemme trash");
  await admin(`db.rooms[0].mode = "soft"`);
  const APP = fs.readFileSync(__dirname + "/../app.js", "utf8");
  const TT = new Set(JSON.parse(APP.match(/TRASH_TYPES = new Set\((\[.*?\])\)/)[1]));
  for (let i = 0; i < 3; i++){
    await A.click("[data-a=next]");
    await until(A, async () => (await room()).phase === "writing", "manche soft");
    const c = (await room()).card, t = await A.evaluate(x => window.DIL_TYPE[x], c);
    check(!TT.has(t), `en soft, dilemme non trash (${t})`);
    await admin(`const r=db.rooms[0]; r.deadline=new Date(Date.now()+1500).toISOString()`);
    await until(A, async () => (await room()).phase === "result", "révélation au bout du temps", 12000);
  }

  console.log("Changer de jeu depuis la fin");
  await admin(`db.rooms[0].phase = "end"; db.players.forEach(p => p.score = 2)`);
  check(await until(A, () => A.locator(".mg").count().then(n => n === 4), "quatre autres jeux"), "les quatre autres jeux sont proposés");
  await A.screenshot({ path: S + "/dilemme-fin.png", fullPage: true });
  await A.click(".mg[data-v=aveux]");
  check(await until(A, async () => { const r = await room(); return r.phase === "lobby" && r.game === "aveux"; }, "aveux"), "passer aux Aveux depuis le Dilemme");

  console.log(`\n${ok} réussis, ${fail} ratés`);
  if (errors.length) console.log("Erreurs JS :\n" + [...new Set(errors)].join("\n"));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
