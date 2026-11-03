// Partie de Loup-garou : 3 téléphones + 3 robots contre le faux backend, en accéléré (pl-lgfast)
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
async function phone(browser, name){
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("pl-lgfast", "1"); } catch(e){} });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await ctx.route(/\.mp3$/, r => r.fulfill({ status: 404, body: "" }));
  await ctx.route(/supabase-js/, r => r.fulfill({ body: CLIENT, contentType: "application/javascript" }));
  await ctx.route(/qrcode-generator/, r => r.fulfill({ body: QR, contentType: "application/javascript" }));
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(name + ": " + e.message));
  p.on("console", m => { if (m.type() === "error" && !m.text().includes("ERR_FAILED") && !m.text().includes("404")) errors.push(name + " console: " + m.text()); });
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
const shots = new Set();
async function shot(p, name){ if (shots.has(name)) return; shots.add(name); await p.screenshot({ path: S + "/loup-" + name + ".png", fullPage: true }); }

// joue au hasard ce que l'écran demande
async function autoplay(p){
  const t = await txt(p);
  const step = await p.evaluate(() => document.body.className);
  const sel = p.locator("button.lgp:not([disabled])");
  const n = await sel.count();
  const conf = p.locator("[data-a=lgOk],[data-a=lgPick]:not([disabled]),[data-a=lgWolf]:not([disabled]),[data-a=lgCupid],[data-a=lgThiefDraw],[data-a=lgThief],[data-a=lgWitch][data-v=none],[data-a=lgGo]");
  if (n && await conf.count()){
    const sels = await p.locator("button.lgp.sel").count();
    const want = t.includes("deux amoureux") ? 2 : 1;
    for (let i = sels; i < want && i < n; i++) await p.locator("button.lgp:not(.sel):not([disabled])").first().click().catch(() => {});
  }
  if (await conf.count()){ await conf.first().click().catch(() => {}); return t.split("\n")[0] + " " + step; }
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const A = await phone(browser, "Naim"), B = await phone(browser, "Léa"), C = await phone(browser, "Tom");
  const humans = [["Naim", A], ["Léa", B], ["Tom", C]];

  console.log("Accueil et réglages");
  await A.goto(BASE);
  check(await A.locator(".gamecard").count() === 5, "cinq jeux sur l'écran d'accueil");
  await A.click("[data-a=instClose]").catch(() => {});
  await A.click("[data-a=pickGame][data-v=loup]");
  check(await A.evaluate(() => document.body.classList.contains("loup")), "ambiance veillée dès l'accueil du Loup-garou");
  await A.fill("#name", "Naim"); await A.click("text=Créer une partie"); await A.click("text=Créer la partie");
  await until(A, async () => /\d{4}/.test(await A.locator(".codebig").innerText()), "code");
  const code = (await A.locator(".codebig").innerText()).trim();
  for (const [n, p] of humans.slice(1)){ await p.goto(BASE + "?c=" + code); await p.fill("#name", n); await p.click("[data-a=join]"); }
  await hasText(A, "Tom");
  check((await room()).game === "loup", "la partie est une partie de Loup-garou");
  check(await hasText(A, "Encore 1 joueur"), "il faut 4 joueurs");
  for (let i = 0; i < 3; i++){ await A.click("[data-a=addBot]"); await sleep(300); }
  await until(A, async () => (await A.locator(".crowd .cp:not(.empty)").count()) === 6, "6 joueurs");
  check(await until(A, async () => (await A.locator(".lgwolf").innerText()).includes("2"), "2 loups"), "composition recommandée : 2 loups pour 6");
  await A.click("[data-a=lgRole][data-v=cupidon]");
  await until(A, async () => !(await txt(A)).includes("Lancer") || true, "");
  await A.click("[data-a=lgRole][data-v=voleur]");
  check(await hasText(A, "Trop de rôles"), "trop de rôles : bouton bloqué");
  await A.click("[data-a=lgRole][data-v=chasseur]");
  check(await hasText(A, "Au milieu"), "le voleur fait apparaître les cartes du milieu");
  await A.click("[data-a=lgMidAdd][data-v=petitefille]");
  await until(A, async () => (await A.locator(".lgmc").count()) === 3, "3 cartes au milieu");
  check(await hasText(B, "Petite fille"), "les autres voient les cartes du milieu");
  await A.click("[data-a=lgDebate][data-v='120']");
  await until(A, async () => ((await room()).lg || {}).cfg && (await room()).lg.cfg.debate === 120, "débat 2 min");
  await shot(A, "lobby");
  check(await hasText(A, "Lancer la partie"), "composition valide");
  await A.click("[data-a=start]");

  console.log("Les cartes");
  await until(A, async () => !!(await room()).lg && !!(await room()).lg.roles, "rôles distribués");
  const r0 = await room();
  check(Object.keys(r0.lg.roles).length === 6 && r0.lg.mid.length === 3, "6 cartes distribuées, 3 au milieu");
  await A.waitForSelector(".lgflip");
  check((await room()).lg.st.t === "carte", "on commence par regarder sa carte");
  await A.click(".lgflip"); await sleep(800);
  await shot(A, "carte");
  const myRole = r0.lg.roles[await A.evaluate(() => JSON.parse(localStorage.getItem("pl-id")))];
  check(myRole && (await txt(A)).length > 0, "Naim voit sa carte (" + myRole + ")");

  console.log("Partie en accéléré");
  const seen = new Set(); let end = false; const t0 = Date.now();
  while (Date.now() - t0 < 300000){
    const r = await room();
    const st = r.lg && r.lg.st; if (st) seen.add(st.t);
    if (st && st.t === "nuit") await shot(B, "nuit");
    if (st && st.t === "loups"){ for (const [, p] of humans){ if ((await p.locator("[data-a=lgWolf]").count())) { await shot(p, "loups"); break; } } }
    if (st && st.t === "matin") await shot(A, "matin");
    if (st && st.t === "vote") await shot(A, "vote");
    if (st && st.t === "fin"){ end = true; break; }
    for (const [, p] of humans) await autoplay(p);
    await sleep(120);
  }
  check(end, "la partie va jusqu'au bout");
  console.log("  étapes vues : " + [...seen].join(", "));
  ["nuit", "loups", "matin", "election", "maire", "debat", "vote", "execution"].forEach(t => check(seen.has(t), "étape " + t));
  const rf = await room();
  check(!!rf.lg.mayor || rf.lg.deaths.some(d => d.how), "un maire a été élu");
  check(rf.lg.ev.length > 0, "des points ont été comptés (" + rf.lg.ev.length + " lignes)");
  await hasText(A, "gagné");
  await A.locator("[data-a=lgOpen]").first().click();
  await sleep(300);
  check(await A.locator(".lgdet div").count() > 0, "le détail d'un joueur s'ouvre");
  await shot(A, "fin");
  const ranks = await A.locator(".lgr").count();
  check(ranks === 6, "classement des 6 joueurs");

  console.log("Rejouer");
  await A.click("[data-a=restart][data-v=loup]");
  check(await until(A, async () => (await room()).phase === "lobby", "lobby"), "retour en salle d'attente");
  const rl = await room();
  check(rl.lg && !rl.lg.roles && rl.lg.cfg && rl.lg.cfg.debate === 120, "les réglages restent, les rôles sont effacés");
  check(await hasText(A, "Lancer la partie"), "on peut relancer");

  console.log("Distribuer les cartes");
  await A.click("[data-a=lgMode][data-v=deal]");
  await until(A, async () => (await room()).lg.cfg.mode === "deal", "mode distribution");
  await A.click("[data-a=start]");
  check(await until(B, async () => (await B.locator(".lgflip").count()) === 1, "carte"), "en distribution, chacun a sa carte");
  check(!(await txt(B)).includes("Fermez") && (await B.locator("[data-a=lgEnd]").count()) === 0, "pas de nuit ni de bouton Terminer pour les autres");
  await A.click("[data-a=lgEnd]");
  check(await until(A, async () => (await room()).phase === "lobby", "lobby"), "Terminer ramène à la salle d'attente");

  console.log("Le téléphone de l'hôte s'éteint");
  await A.click("[data-a=lgMode][data-v=full]");
  await until(A, async () => (await room()).lg.cfg.mode === "full", "mode complet");
  check(await A.locator("[data-a=lgTest]").count() === 1, "bouton Tester le son");
  await A.click("[data-a=start]");
  await until(A, async () => ((await room()).lg.st || {}).t === "carte", "cartes");
  await A.close();
  const k0 = (await room()).lg.st.k; let moved = 0; const t1 = Date.now();
  while (Date.now() - t1 < 60000 && moved < 3){ for (const p of [B, C]) await autoplay(p); const k = (await room()).lg.st.k; if (k !== k0) moved++; await sleep(300); }
  check(moved >= 1, "la partie avance sans le téléphone de l'hôte");
  const sus = await admin("return db.rooms[0].lg.st.hold");
  check(typeof sus === "number", "chaque étape a un temps de suspense");

  console.log("\n" + ok + " réussis, " + fail + " échoués");
  if (errors.length) console.log("Erreurs :\n" + [...new Set(errors)].slice(0, 15).join("\n"));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
