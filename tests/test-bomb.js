// Partie de Time Bomb : 3 téléphones + 2 robots contre le faux backend
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
async function shot(p, name){ if (shots.has(name)) return; shots.add(name); await p.screenshot({ path: S + "/bomb-" + name + ".png", fullPage: true }); }


async function autoplay(p){
  if (await p.locator(".tbcut").count()) return;
  const c = async s => { const l = p.locator(s); if (await l.count()){ await l.first().click({ timeout: 1500 }).catch(() => {}); return true; } return false; };
  if (await p.locator(".tbflip:not(.on)").count()){ await c(".tbflip"); return; }
  if (await c("[data-a=tbOk]:not([disabled])")) return;
  if (await p.locator("[data-a=tbSend]").count()){ if (Math.random() < .5) await c("[data-a=tbSay][data-v='1']:not([disabled])"); await c("[data-a=tbSend]"); return; }
  if (await p.locator("button.tbc.back").count()){
    if (!(await p.locator("button.tbc.sel").count())) await c("button.tbc.back");
    await c("[data-a=tbCut]:not([disabled])");
  }
}

(async () => {
  const browser = await chromium.launch();
  const A = await phone(browser, "Naim"), B = await phone(browser, "Léa"), C = await phone(browser, "Tom");
  const humans = [["Naim", A], ["Léa", B], ["Tom", C]];

  console.log("Accueil et salle d'attente");
  await A.goto(BASE);
  check(await A.locator(".gamecard").count() === 6, "six jeux sur l'écran d'accueil");
  await A.click("[data-a=instClose]").catch(() => {});
  await shot(A, "accueil");
  await A.click("[data-a=pickGame][data-v=bomb]");
  check(await A.evaluate(() => document.body.classList.contains("bomb")), "ambiance Time Bomb dès l'accueil du jeu");
  await A.fill("#name", "Naim"); await A.click("text=Créer une partie");
  check(!(await txt(A)).includes("Points pour gagner"), "pas de réglages inutiles à la création");
  await A.click("text=Créer la partie");
  await until(A, async () => /\d{4}/.test(await A.locator(".codebig").innerText()), "code");
  const code = (await A.locator(".codebig").innerText()).trim();
  for (const [n, p] of humans.slice(1)){ await p.goto(BASE + "?c=" + code); await p.fill("#name", n); await p.click("[data-a=join]"); }
  await hasText(A, "Tom");
  check((await room()).game === "bomb", "la partie est une partie de Time Bomb");
  check(await hasText(A, "Encore 1 joueur"), "il faut 4 joueurs");
  for (let i = 0; i < 2; i++){ await A.click("[data-a=addBot]"); await sleep(300); }
  await until(A, async () => (await A.locator(".crowd .cp:not(.empty)").count()) === 5, "5 joueurs");
  check(await until(A, async () => (await A.locator(".tbteams").innerText()).replace(/\s/g, "").includes("32"), "équipes"), "5 joueurs : 3 Sherlock, 2 Moriarty");
  await shot(A, "lobby");
  await A.click("[data-a=start]");

  console.log("Les rôles et les câbles");
  await until(A, async () => !!((await room()).lg || {}).roles, "rôles");
  const g0 = (await room()).lg;
  const roles = Object.values(g0.roles);
  check(roles.length === 5 && roles.filter(r => r === "s").length === 3, "3 Sherlock et 2 Moriarty distribués");
  const all = Object.values(g0.hands).flat().map(c => c.c);
  check(all.length === 25 && all.filter(c => c === "d").length === 5 && all.filter(c => c === "b").length === 1, "25 câbles : 5 désamorçages, 1 bombe, 19 neutres");
  check(Object.values(g0.hands).every(h => h.length === 5), "5 câbles chacun à la 1re manche");
  await A.click(".tbflip"); await sleep(800); await shot(A, "role");
  check(await A.locator(".tbflip.on .tbrole").count() === 1, "Naim retourne sa carte de rôle");

  console.log("Annonces");
  for (let i = 0; i < 40 && ((await room()).lg.st || {}).t !== "annonce"; i++){ for (const [, p] of humans) await autoplay(p); await sleep(250); }
  await until(A, async () => ((await room()).lg.st || {}).t === "annonce", "annonce");
  await A.waitForSelector("[data-a=tbSend]");
  await shot(A, "annonce");
  check(await A.locator(".tbmyhand .tbc").count() === 5, "pendant l'annonce, on voit ses 5 câbles");
  if (process.env.DBG){ await A.click("[data-a=tbSend]"); await sleep(1500); console.log(await admin("return db.lg_actions.map(a=>a.k+' '+a.player.slice(0,4)+' '+a.v)")); console.log(errors); }

  console.log("Partie complète");
  const seenRounds = new Set(); let end = false, shotCut = false; const t0 = Date.now(); let r2ok = null;
  while (Date.now() - t0 < 240000){
    const r = await room(), g = r.lg, st = g && g.st;
    if (g) seenRounds.add(g.round);
    if (g && g.round === 2 && r2ok === null && st.t === "annonce") r2ok = Object.values(g.hands).every(h => h.length === 4);
    if (st && st.t === "coupe" && !shotCut){ for (const [, p] of humans) if (await p.locator("[data-a=tbCut]").count()){ await shot(p, "coupe"); shotCut = true; break; } }
    if (!shots.has("anim")) for (const [, p] of humans) if (await p.locator(".tbcut .tbres").count()){ await shot(p, "anim"); break; }
    if (st && st.t === "fin"){ end = true; break; }
    for (const [, p] of humans) await autoplay(p);
    await sleep(150);
  }
  check(end, "la partie va jusqu'au bout");
  const gf = (await room()).lg;
  console.log("  manches vues : " + [...seenRounds].join(", ") + " · fin : " + gf.st.win + " / " + gf.st.why + " · coupes : " + gf.cuts.length);
  if (r2ok !== null) check(r2ok, "manche 2 : 4 câbles chacun");
  check(gf.cuts.every(c => c.by !== c.from), "on ne coupe jamais chez soi");
  check(gf.cuts.every((c, i) => i === 0 || gf.cuts[i - 1].from === c.by), "la pince passe au joueur coupé");
  const why = gf.st.why;
  check(why === "bomb" ? gf.cuts[gf.cuts.length - 1].c === "b" : why === "defused" ? gf.found === 5 : gf.cuts.length === 20, "la fin respecte les règles (" + why + ")");
  check(await hasText(A, "a gagné", 8000), "écran de fin après l'animation");
  check(await A.locator(".tbcamp").count() === 2, "les deux camps révélés");
  await shot(A, "fin");

  console.log("Rejouer");
  await A.click("[data-a=restart][data-v=bomb]");
  check(await until(A, async () => (await room()).phase === "lobby", "lobby"), "retour en salle d'attente");
  check(await hasText(B, "Lancer") || await hasText(B, "va lancer"), "les autres sont en salle d'attente");

  console.log("\n" + ok + " réussis, " + fail + " échoués");
  if (errors.length) console.log("Erreurs :\n" + [...new Set(errors)].slice(0, 15).join("\n"));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})();
