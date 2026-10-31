// Partie de « Qui de nous » : 3 téléphones + 1 robot + grand écran contre le faux backend
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
const tail = q => q.replace(/^Qui de nous( est le plus susceptible)?\s+/i, "");
const room = () => admin(`return db.rooms[0]`);

(async () => {
  const browser = await chromium.launch();
  const A = await phone(browser, "Naim"), B = await phone(browser, "Léa"), C = await phone(browser, "Tom");
  const TV = await phone(browser, "TV", { viewport: { width: 1600, height: 900 } });
  const byName = { Naim: A, "Léa": B, Tom: C };

  console.log("Salle d'attente et choix du jeu");
  await A.goto(BASE); await A.click("[data-a=pickGame][data-v=qui]"); await A.fill("#name", "Naim"); await A.click("text=Créer une partie"); await A.click("text=Créer la partie");
  await until(A, async () => /\d{4}/.test(await A.locator(".codebig").innerText()), "code");
  const code = (await A.locator(".codebig").innerText()).trim();
  for (const [p, n] of [[B, "Léa"], [C, "Tom"]]){ await p.goto(BASE + "?c=" + code); await p.fill("#name", n); await p.click("[data-a=join]"); }
  await hasText(A, "Tom");
  check(await until(A, async () => (await room()).game === "qui", "jeu enregistré"), "la partie créée depuis Le Verdict est bien un Verdict");
  check(await hasText(B, "Verdict"), "les autres arrivent dans Le Verdict");
  await A.click("[data-a=addBot]");
  await hasText(A, "Robot Gégé");
  await A.screenshot({ path: S + "/qui-lobby.png", fullPage: true });
  await TV.goto(BASE + "?tv=" + code); await hasText(TV, "Lancer l'affichage"); await TV.click("[data-a=tvGo]");
  await TV.waitForSelector(".tvlobby");

  const ids = await admin(`return Object.fromEntries(db.players.map(p=>[p.name,p.id]))`);
  const nameOfId = id => Object.keys(ids).find(k => ids[k] === id);
  let prevJudge = null;

  for (const round of [1, 2]){
    console.log(`Manche ${round}`);
    if (round === 1){
      await A.fill("#cin", "le plus gourmand"); await A.click("[data-a=cadd]");
      check(await until(A, async () => ((await room()).custom || [])[0] === "Qui de nous est le plus gourmand ?", "question perso"), "question perso mise en forme");
      await A.click("[data-a=start]");
    }
    else {
      const nextBtn = [A, B, C].find(() => true);
      await until(A, async () => (await A.locator("[data-a=next]").count()) > 0 || (await B.locator("[data-a=next]").count()) > 0 || (await C.locator("[data-a=next]").count()) > 0, "bouton manche suivante");
      for (const p of [A, B, C]) if (await p.locator("[data-a=next]").count()){ await p.click("[data-a=next]"); break; }
      void nextBtn;
    }
    check(await until(A, async () => { const r = await room(); return r.phase === "writing" && r.round === round; }, "question tirée"), "la question secrète est tirée toute seule");
    const r = await room();
    const judge = nameOfId(r.judge), J = byName[judge];
    console.log("  devineur : " + judge + " · question : " + r.card);
    if (round === 1) check(r.card === "Qui de nous est le plus gourmand ?", "la question perso sort en premier");
    check(r.options && r.options.length === 4 && r.options.includes(r.card) && new Set(r.options).size === 4, "4 propositions différentes dont la vraie");
    if (round === 2) check(r.judge !== prevJudge, "le rôle de devineur tourne");
    prevJudge = r.judge;
    await sleep(600);
    if (J){
      check(!(await txt(J)).includes(r.card), "le devineur ne voit pas la question");
      check(await hasText(J, "Tu devines"), "le devineur sait qu'il devine");
    }
    check(!(await txt(TV)).includes(r.card), "le grand écran ne montre pas la question");
    const rankers = Object.keys(byName).filter(n => n !== judge);
    for (const n of rankers){
      const p = byName[n];
      await hasText(p, tail(r.card));
      const k = await p.locator(".pv").count();
      check(k === 4, `${n} doit classer 4 joueurs (${k})`);
      for (let i = 0; i < k; i++){ const free = p.locator(".pv:not(.used)"); await free.nth((i + rankers.indexOf(n)) % (await free.count())).click(); }
      check(await p.locator(".slot.full").count() === 4, "les 4 joueurs sont posés sur le thermomètre");
      if (round === 1 && n === rankers[0]) await p.screenshot({ path: S + "/qui-ranking.png", fullPage: true });
      await p.click("[data-a=rankSend]");
      await p.waitForSelector("[data-a=rankEdit]");
    }
    check(await until(A, async () => (await room()).phase === "judging", "phase devinette", 15000), "on passe à la devinette quand tout le monde a classé (robot compris)");
    const nr = await admin(`return db.rankings.filter(k=>k.round===${round}).length`);
    check(nr === 3, `3 classements reçus (${nr})`);
    const before = await admin(`return Object.fromEntries(db.players.map(p=>[p.name,p.score]))`);
    if (J){
      await J.waitForSelector(".gm");
      check(await J.locator("[data-a=guessPick]").count() === 4, "le devineur a 4 propositions");
      check(await J.locator(".gauge .gm").count() === 4, "le thermomètre montre les 4 joueurs classés");
      await TV.waitForSelector(".gm");
      if (round === 1){ await J.screenshot({ path: S + "/qui-guess.png", fullPage: true }); await TV.screenshot({ path: S + "/qui-tv-guess.png" }); }
      if (round === 2){
        const bad = r.options.find(o => o !== r.card);
        await J.click(`[data-a=guessPick][data-v="${r.options.indexOf(bad)}"]`);
        await J.click("[data-a=confirmGuess]");
        check(await until(J, async () => (await J.locator(".tile.wrong").count()) === 1, "tuile éteinte"), "une mauvaise réponse éteint la tuile");
        check((await room()).phase === "judging", "le devineur peut réessayer");
        check(await until(J, async () => (await J.locator(".gpts").innerText()).trim() === "+2", "+2"), "il ne reste que 2 points à gagner");
        check(await J.locator(".gbanner").count() === 1, "le bandeau du devineur est là");
      }
      await J.click(`[data-a=guessPick][data-v="${r.options.indexOf(r.card)}"]`);
      await J.click("[data-a=confirmGuess]");
    }
    check(await until(A, async () => (await room()).phase === "result", "résultat", 30000), "le devineur valide sa réponse");
    const rr = await room();
    const after = await admin(`return Object.fromEntries(db.players.map(p=>[p.name,p.score]))`);
    const right = rr.guess === rr.card;
    const diff = Object.fromEntries(Object.keys(after).map(n => [n, after[n] - before[n]]));
    const moule = await admin(`const r=db.rooms[0], ks=db.rankings.filter(k=>k.round===r.round), s={}, c={};
      ks.forEach(k=>k.ranking.forEach((id,i)=>{s[id]=(s[id]||0)+i+1;c[id]=(c[id]||0)+1}));
      const a=Object.keys(s).map(id=>[id,s[id]/c[id]]), b=Math.min(...a.map(x=>x[1])), t=a.filter(x=>x[1]===b).map(x=>x[0]);
      return ks.filter(k=>t.includes(k.ranking[0])).map(k=>db.players.find(p=>p.id===k.player).name)`);
    const tries = (rr.wrong || []).length + (right ? 1 : 0);
    const expect = Object.fromEntries(Object.keys(after).map(n => [n, (n === judge && right ? 4 - tries : 0) + (moule.includes(n) ? 1 : 0)]));
    check(JSON.stringify(diff) === JSON.stringify(expect), `points ${right ? "bonne réponse" : "raté"} : ${JSON.stringify(diff)}`);
    const other = byName[rankers[0]];
    check(await hasText(other, right ? "Bien vu" : "Raté"), "le résultat s'affiche");
    check((await txt(other)).includes(tail(rr.card)), "la vraie question est révélée");
    check(await hasText(TV, right ? "Bien vu" : "Raté"), "… aussi sur le grand écran");
    check(await other.locator(".rline").count() === 3, "une ligne par joueur qui a classé");
    if (round === 1){ await other.screenshot({ path: S + "/qui-result.png", fullPage: true }); await TV.screenshot({ path: S + "/qui-tv-result.png" }); }
  }

  console.log("Retour en salle d'attente");
  await admin(`db.rooms[0].target = 1; db.players[0].score = Math.max(1, db.players[0].score)`);
  await hasText(A, "Classement final");
  await A.click("[data-a=next]");
  await until(A, async () => (await room()).phase === "end", "fin");
  await hasText(A, "Rejouer"); await A.click("[data-a=restart]");
  check(await until(A, async () => { const r = await room(); return r.phase === "lobby" && r.game === "qui"; }, "lobby"), "« Rejouer » garde le jeu choisi");

  console.log(`\n${ok} réussis, ${fail} ratés`);
  if (errors.length) console.log("Erreurs JS :\n" + [...new Set(errors)].join("\n"));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
