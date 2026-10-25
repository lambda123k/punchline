/* Punchline — jeu de cartes à trous multi-téléphones */
(function(){
"use strict";
const SB_URL = "https://pjywkbrqtntblxtwqjlj.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXdrYnJxdG50Ymx4dHdxamxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3ODE4OTgsImV4cCI6MjEwODM1Nzg5OH0.QCn_kmkkkc2m5idX3YGOFVD_VQS0wA-5Q_9fZKZK260";
const BLANK = "____";
const MIN_PLAYERS = 3;
const ABSENT_MS = 45000;      // sans signe de vie depuis 45 s : on ne l'attend plus
const REMOVE_MS = 5 * 60000;  // parti depuis 5 min : retiré de la partie
const PING_MS = 10000;
const REACTIONS = ["😂", "💀", "🔥"];
const ZERO_ID = "00000000-0000-4000-8000-000000000000";

const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

/* ---------- stockage local (facultatif) ---------- */
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem("pl-" + k)); } catch(e){ return null; } },
  set(k, v){ try { localStorage.setItem("pl-" + k, JSON.stringify(v)); } catch(e){} },
  del(k){ try { localStorage.removeItem("pl-" + k); } catch(e){} }
};
function uuid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> c / 4).toString(16));
}

/* ---------- état ---------- */
const me = { id: store.get("id") || uuid(), name: store.get("name") || "" };
store.set("id", me.id);
const qs = new URLSearchParams(location.search);
const urlTv = (qs.get("tv") || "").replace(/\D/g, "").slice(0, 4);
const urlCode = urlTv || (qs.get("c") || "").replace(/\D/g, "").slice(0, 4);

let code = null, room = null, players = [], answers = [], votes = [], reacts = [], gameRatings = [];
let channel = null, pollTimer = null, pingTimer = null, refreshTimer = null, busy = false;
let clock = 0; // décalage horloge serveur - horloge locale (ms)
const savedTimer = store.get("timer");
const TIMERS = [[15, "15 s"], [30, "30 s"], [60, "1 min"], [0, "Sans limite"]];
const ui = { creating: false, target: store.get("target") || 5, timer: savedTimer == null ? 30 : savedTimer,
  codeInput: urlCode, err: "", sel: null, editing: false, confirmLeave: false, draft: "",
  tv: false, tvReady: false, tvAsk: !!urlTv, page: "home", stats: null,
  sound: store.get("sound") !== false, ratings: store.get("ratings") || {} };

/* ---------- outils ---------- */
const $ = s => document.querySelector(s);
const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cleanAnswer = t => String(t || "").trim().replace(/\s+/g, " ").replace(/[.。]+$/, "");
const parseTs = t => t ? Date.parse(String(t).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1")) : NaN;
const serverNow = () => Date.now() + clock;
function fill(card, ans){
  const parts = String(card || "").split(BLANK);
  if (parts.length === 1) return esc(card) + (ans != null ? ` <mark>${esc(cleanAnswer(ans))}</mark>` : "");
  return parts.map(esc).join(ans != null && cleanAnswer(ans) ? `<mark>${esc(cleanAnswer(ans))}</mark>` : `<span class="blank"></span>`);
}
function hash(s){ let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seeded(seed){ return function(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seededShuffle(arr, seedStr){
  const a = arr.slice().sort((x, y) => x.id < y.id ? -1 : 1), r = seeded(hash(seedStr));
  for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function toast(msg){
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
const baseUrl = () => location.origin + location.pathname;
const joinUrl = c => baseUrl() + "?c=" + c;
const shortUrl = () => (location.host + location.pathname).replace(/\/$/, "");

/* ---------- dérivés ---------- */
const BOT_PREFIX = "b07b07b0-";
const isBot = id => String(id || "").startsWith(BOT_PREFIX);
const byId = id => players.find(p => p.id === id);
const nameOf = id => (byId(id) || {}).name || "Quelqu'un";
const lastSeen = p => parseTs(p.last_seen);
const present = p => !!p && (isBot(p.id) || !p.last_seen || isNaN(lastSeen(p)) || serverNow() - lastSeen(p) < ABSENT_MS);
const humans = () => players.filter(p => !isBot(p.id)).sort((a, b) => a.seat - b.seat);
const leader = () => humans().find(present) || humans()[0];
const isLeader = () => !ui.tv && !!leader() && leader().id === me.id;
const isJudge = () => !ui.tv && room && room.judge === me.id;
const judgeGone = () => room && room.judge && (!byId(room.judge) || !present(byId(room.judge)));
const roundAnswers = () => room ? answers.filter(a => a.round === room.round && byId(a.player)) : [];
const writers = () => players.filter(p => room && p.id !== room.judge && present(p));
const writersDone = () => { const ids = new Set(roundAnswers().map(a => a.player)); return writers().filter(p => ids.has(p.id)).length; };
const myAnswer = () => roundAnswers().find(a => a.player === me.id);
const roundVotes = () => room ? votes.filter(v => v.round === room.round) : [];
const myVote = () => roundVotes().find(v => v.voter === me.id);
const maxScore = () => Math.max(0, ...players.map(p => p.score));
const cardType = c => (window.CARD_TYPE || {})[c] || "autre";

/* ---------- sons et vibrations ---------- */
let actx = null;
function unlockAudio(){
  try {
    if (!actx){ const A = window.AudioContext || window.webkitAudioContext; if (A) actx = new A(); }
    if (actx && actx.state === "suspended") actx.resume();
  } catch(e){}
}
function tone(freq, start, dur, type, vol){
  const t0 = actx.currentTime + start;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type || "sine"; o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.05);
}
function buzz(pattern){ try { if (!ui.tv && navigator.vibrate) navigator.vibrate(pattern); } catch(e){} }
const sfx = {
  flip(){ buzz(25); play(() => { tone(520, 0, .09, "triangle", .18); tone(780, .05, .12, "triangle", .14); }); },
  card(){ buzz(40); play(() => { tone(392, 0, .18, "sine", .16); tone(587, .09, .25, "sine", .14); }); },
  tick(last){ buzz(last ? 120 : 30); play(() => tone(last ? 660 : 880, 0, last ? .3 : .08, "square", .07)); },
  win(big){ buzz(big ? [80, 60, 80, 60, 200] : 50); play(() => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .1, big ? .45 : .3, "triangle", big ? .2 : .12)); }); },
  pop(){ play(() => tone(1200, 0, .06, "sine", .06)); },
  badge(){ buzz([30, 40, 30]); play(() => { tone(988, 0, .12, "triangle", .12); tone(1319, .1, .28, "triangle", .12); }); }
};
function play(fn){ if (!ui.sound || !actx || actx.state !== "running") return; try { fn(); } catch(e){} }

/* ---------- réseau ---------- */
function scheduleRefresh(){ clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); }

async function refresh(){
  if (!code) return;
  const c = code;
  const [r, p, a, v, x] = await Promise.all([
    sb.from("rooms").select("*").eq("code", c).maybeSingle(),
    sb.from("players").select("*").eq("room", c).order("seat"),
    sb.from("answers").select("*").eq("room", c),
    sb.from("votes").select("*").eq("room", c),
    sb.from("reactions").select("round,answer,player").eq("room", c)
  ]);
  if (c !== code) return;
  if (r.error || p.error || a.error){ return; } // réseau instable : le prochain passage réessaiera
  if (!r.data){ leaveLocal("La partie n'existe plus."); return; }
  const prev = room;
  room = r.data; players = p.data || []; answers = a.data || []; votes = v.error ? votes : (v.data || []); reacts = x.error ? reacts : (x.data || []);
  if (!ui.tv && !byId(me.id)){ leaveLocal("Tu n'es plus dans la partie."); return; }
  if (!prev || prev.round !== room.round || prev.phase !== room.phase){
    ui.sel = null; ui.confirmLeave = false;
    if (!prev || prev.round !== room.round){ ui.editing = false; ui.draft = ""; }
  }
  if (prev) soundsFor(prev, room);
  if (room.phase === "end" && (!prev || prev.phase !== "end" || !gameRatings.loaded)) loadGameRatings();
  render();
  autoActions();
}

async function loadGameRatings(){
  const c = code;
  let q = sb.from("card_ratings").select("player,updated_at").eq("room", c);
  const { data, error } = await q;
  if (error || c !== code) return;
  const since = parseTs(room.started_at) || 0;
  gameRatings = (data || []).filter(r => (parseTs(r.updated_at) || 0) >= since - 2000);
  gameRatings.loaded = true;
  render();
}

function soundsFor(a, b){
  if (b.phase === "writing" && (a.phase !== "writing" || a.card !== b.card)) sfx.card();
  if (b.phase === "judging" && a.phase === "judging" && (b.revealed || 0) > (a.revealed || 0)) sfx.flip();
  if (b.phase === "result" && a.phase !== "result"){
    const w = answers.find(x => x.id === b.winner);
    sfx.win(ui.tv || (w && w.player === me.id));
  }
  if (b.phase === "end" && a.phase !== "end") sfx.win(true);
}

// Les mises à jour de présence (ping) arrivent très souvent : on les applique sans tout recharger
function onPlayers(payload){
  const n = payload && payload.new, old = n && byId(n.id);
  if (payload && payload.eventType === "UPDATE" && old){
    const same = Object.keys(n).every(k => k === "last_seen" || String(n[k]) === String(old[k]));
    if (same){ old.last_seen = n.last_seen; render(); return; }
  }
  scheduleRefresh();
}

async function ping(){
  if (!code) return;
  const { data, error } = await sb.rpc("ping", { p_player: ui.tv ? ZERO_ID : me.id, p_room: code });
  if (!error && data){ const t = parseTs(data); if (!isNaN(t)) clock = t - Date.now(); }
  const mine = byId(me.id); if (mine && !error) mine.last_seen = new Date(serverNow()).toISOString();
}

/* ---------- joueurs robots (pour tester seul) ---------- */
const BOT_NAMES = ["Robot Gégé", "Robot Josiane", "Robot Kévin", "Robot Monique", "Robot Jean-Mi", "Robot Brenda"];
const BOT_ANSWERS = [
  "un raton laveur en colère", "ma grand-mère en string", "une raclette à 3 h du matin", "le Wi-Fi de la SNCF",
  "un PowerPoint de 80 diapos", "Jul en featuring avec Mozart", "une chaussette mouillée", "le prof de SVT tout nu",
  "un kebab sans sauce", "les impôts", "un pigeon qui a tout vu", "mon ex, encore", "trois mamies en trottinette",
  "un câlin trop long", "la belle-mère de Booba", "un pet en plein silence", "une soirée Tupperware qui dégénère",
  "le chat de la voisine", "Didier Deschamps en colère", "un coloc qui ne paie jamais", "une tartiflette tiède",
  "un message vocal de 12 minutes", "le pain au chocolat (pas la chocolatine)", "un huissier très gentil",
  "une danse du ventre ratée", "mon compte en banque", "un nain de jardin possédé", "le slip de Jean-Pierre Pernaut",
  "des chaussettes avec des sandales", "une perruque en promo", "un goûter d'anniversaire qui tourne mal",
  "Patrick Sébastien en string", "une moustache de 3 jours", "le dernier Ricard de tonton", "un DM Instagram à 4 h du mat"
];
const botTimers = new Set();
function botOnce(key, delay, fn){
  if (botTimers.has(key)) return;
  botTimers.add(key);
  setTimeout(async () => { try { await fn(); } catch(e){} scheduleRefresh(); }, delay);
}
const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];

function botActions(){
  // Seul le premier vrai joueur présent (l'hôte) fait jouer les robots
  if (!isLeader() || !players.some(p => isBot(p.id))) return;
  const r = room.round, c = code;
  const still = () => room && code === c && room.round === r;
  if (room.phase === "draw" && isBot(room.judge)){
    botOnce(`${r}:draw`, rand(1500, 2500), () => { if (still() && room.phase === "draw") return actions.draw(); });
  }
  if (room.phase === "writing"){
    writers().filter(p => isBot(p.id) && !roundAnswers().some(a => a.player === p.id)).forEach(p => {
      botOnce(`${r}:ans:${p.id}`, rand(2000, 6000), () => {
        if (!still() || room.phase !== "writing") return;
        return sb.from("answers").upsert({ room: c, round: r, player: p.id, text: pickOne(BOT_ANSWERS) }, { onConflict: "room,round,player" });
      });
    });
  }
  if (room.phase === "judging"){
    const n = roundAnswers().length, shown = room.revealed || 0;
    // les robots votent pour leur coup de cœur et réagissent de temps en temps
    if (n && shown >= n){
      players.filter(p => isBot(p.id) && p.id !== room.judge).forEach(p => {
        botOnce(`${r}:vote:${p.id}`, rand(800, 2500), () => {
          const opts = roundAnswers().filter(a => a.player !== p.id);
          if (!still() || room.phase !== "judging" || !opts.length) return;
          return sb.from("votes").upsert({ room: c, round: r, voter: p.id, answer: pickOne(opts).id }, { onConflict: "room,round,voter" });
        });
      });
    }
    if (shown > 0) players.filter(p => isBot(p.id)).forEach(p => {
      if (Math.random() < .5) botOnce(`${r}:react:${shown}:${p.id}`, rand(300, 1500), () => { if (still()) sendReaction(pickOne(REACTIONS), p.name, p.id); });
      else botTimers.add(`${r}:react:${shown}:${p.id}`);
    });
  }
  if (room.phase === "judging" && isBot(room.judge)){
    const n = roundAnswers().length, shown = room.revealed || 0;
    if (!n){ botOnce(`${r}:empty`, 2500, () => { if (still() && room.phase === "judging") return sb.rpc("next_round", { p_code: c, p_from: r }); }); return; }
    if (shown < n){
      botOnce(`${r}:flip:${shown}`, rand(2200, 3200), () => {
        if (!still() || room.phase !== "judging" || room.revealed !== shown) return;
        return sb.from("rooms").update({ revealed: shown + 1 }).eq("code", c).eq("phase", "judging").eq("revealed", shown);
      });
      return;
    }
    botOnce(`${r}:pick`, rand(4500, 6000), () => {
      const list = roundAnswers();
      if (!still() || room.phase !== "judging" || !list.length) return;
      return sb.rpc("pick_winner", { p_code: c, p_answer: pickOne(list).id });
    });
  }
}

const autoDone = new Set();
async function autoActions(){
  if (!room || busy || ui.tv) return;
  botActions();
  const r = room.round;
  // Le juge révèle dès que tous les joueurs présents ont écrit (l'hôte le fait si le juge est un robot)
  if (room.phase === "writing" && (isJudge() || (isBot(room.judge) && isLeader()))){
    const w = writers().length;
    if (w > 0 && writersDone() >= w) await setPhase("judging", "writing");
  }
  if (!isLeader()) return;
  // Le juge est parti (ou ne répond plus) : on passe à une nouvelle manche
  if (["draw","writing","judging"].includes(room.phase) && judgeGone() && !isBot(room.judge) && !autoDone.has("judge:" + r)){
    autoDone.add("judge:" + r);
    toast(`${nameOf(room.judge)} ne répond plus, on change de juge.`);
    await rpc("next_round", { p_code: code, p_from: r });
    return;
  }
  // Parti depuis longtemps : retiré de la partie
  players.filter(p => !isBot(p.id) && p.id !== me.id && p.last_seen && serverNow() - lastSeen(p) > REMOVE_MS).forEach(p => {
    if (autoDone.has("rm:" + p.id + ":" + p.last_seen)) return;
    autoDone.add("rm:" + p.id + ":" + p.last_seen);
    sb.from("players").delete().eq("id", p.id).eq("room", code).eq("last_seen", p.last_seen).then(scheduleRefresh);
  });
}

async function setPhase(phase, from){
  const q = sb.from("rooms").update({ phase, updated_at: new Date().toISOString() }).eq("code", code).eq("round", room.round);
  const { error } = from ? await q.eq("phase", from) : await q;
  if (error) toast("Connexion perdue, réessaie.");
  scheduleRefresh();
}

async function rpc(name, args){
  const { data, error } = await sb.rpc(name, args);
  if (error){ toast("Connexion perdue, réessaie."); return null; }
  scheduleRefresh();
  return data;
}

/* ---------- réactions en direct ---------- */
let lastReact = 0;
// la réaction vise la carte qu'on est en train de lire (ou la gagnante au résultat)
function reactTarget(){
  if (!room) return null;
  if (room.phase === "result") return room.winner;
  if (room.phase !== "judging") return null;
  const list = seededShuffle(roundAnswers(), code + ":" + room.round), k = Math.min(room.revealed || 0, list.length) - 1;
  return k >= 0 ? list[k].id : null;
}
function sendReaction(e, name, who){
  if (!channel) return;
  showReaction(e, name);
  const target = reactTarget(), a = target && answers.find(x => x.id === target), pid = who || me.id;
  if (a && a.player !== pid) sb.from("reactions").insert({ room: code, round: room.round, answer: a.id, player: pid, emoji: e }).then(() => {});
  try { channel.send({ type: "broadcast", event: "react", payload: { e, n: name } }); } catch(x){}
}
function showReaction(e, name){
  if (!REACTIONS.includes(e)) return;
  const el = document.createElement("div");
  el.className = "fly";
  el.style.left = (8 + Math.random() * 78) + "%";
  el.innerHTML = `<span class="em">${e}</span>${name ? `<span class="who">${esc(String(name).slice(0, 20))}</span>` : ""}`;
  document.body.appendChild(el);
  sfx.pop();
  setTimeout(() => el.remove(), 2600);
}

function subscribe(c){
  unsubscribe();
  channel = sb.channel("room-" + c, { config: { broadcast: { self: false } } })
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: "code=eq." + c }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: "room=eq." + c }, onPlayers)
    .on("postgres_changes", { event: "*", schema: "public", table: "answers", filter: "room=eq." + c }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: "room=eq." + c }, scheduleRefresh)
    .on("broadcast", { event: "react" }, msg => { const p = msg && msg.payload; if (p) showReaction(p.e, p.n); })
    .subscribe();
  pollTimer = setInterval(refresh, 3000); // filet de sécurité si le temps réel décroche
  pingTimer = setInterval(ping, PING_MS);
}
function unsubscribe(){
  if (channel){ sb.removeChannel(channel); channel = null; }
  clearInterval(pollTimer); pollTimer = null;
  clearInterval(pingTimer); pingTimer = null;
}

let wakeLock = null;
async function keepAwake(){ try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch(e){} }

async function enterRoom(c, tv){
  code = c; ui.tv = !!tv;
  if (!tv) store.set("room", c);
  ui.err = ""; ui.creating = false; ui.tvAsk = false;
  if (location.search) history.replaceState(null, "", location.pathname);
  subscribe(c);
  keepAwake();
  await ping();
  await refresh();
}
function leaveLocal(msg){
  unsubscribe();
  code = null; room = null; players = []; answers = []; votes = [];
  if (!ui.tv) store.del("room");
  ui.tv = false; ui.tvReady = false;
  ui.err = msg || ""; ui.confirmLeave = false; ui.editing = false; ui.draft = "";
  render();
}

/* ---------- pioche pondérée par les notes ---------- */
async function cardWeights(){
  try {
    const { data, error } = await sb.from("card_scores").select("card,up,down");
    if (error || !data) return {};
    const w = {};
    data.forEach(s => { w[s.card] = Math.max(0.15, Math.min(4, (s.up + 1) / (s.down + 1))); });
    return w;
  } catch(e){ return {}; }
}
function weightedPick(list, w){
  const total = list.reduce((s, i) => s + (w[window.CARDS[i]] || 1), 0);
  let x = Math.random() * total;
  for (const i of list){ x -= (w[window.CARDS[i]] || 1); if (x <= 0) return i; }
  return list[list.length - 1];
}

/* ---------- actions ---------- */
function needName(){
  const n = (me.name || "").trim();
  if (!n){ ui.err = "Écris ton prénom d'abord."; render(); const el = $("#name"); if (el) el.focus(); return null; }
  return n.slice(0, 20);
}

const actions = {
  async create(){
    const n = needName(); if (!n) return;
    busy = true;
    const { data, error } = await sb.rpc("create_room", { p_host: me.id, p_name: n, p_target: ui.target, p_mode: "mix" });
    busy = false;
    if (error || !data){ ui.err = "Impossible de créer la partie. Vérifie ta connexion."; render(); return; }
    await sb.from("rooms").update({ timer: ui.timer }).eq("code", data);
    await enterRoom(data);
  },
  async join(){
    const n = needName(); if (!n) return;
    const c = (ui.codeInput || "").replace(/\D/g, "");
    if (c.length !== 4){ ui.err = "Le code fait 4 chiffres."; render(); return; }
    busy = true;
    const { data, error } = await sb.rpc("join_room", { p_code: c, p_player: me.id, p_name: n });
    busy = false;
    if (error){ ui.err = "Connexion impossible. Vérifie ta connexion."; render(); return; }
    if (data === "no_room"){ ui.err = `Aucune partie avec le code ${c}. Vérifie le code avec l'hôte.`; render(); return; }
    if (data === "name_taken"){ ui.err = "Ce prénom est déjà pris dans cette partie. Ajoute une initiale."; render(); return; }
    await enterRoom(c);
  },
  showCreate(){ ui.creating = !ui.creating; ui.tvAsk = false; ui.err = ""; render(); },
  showTv(){ ui.tvAsk = !ui.tvAsk; ui.menu = false; ui.creating = false; ui.err = ""; render(); },
  menu(){ ui.menu = !ui.menu; ui.tvAsk = false; ui.creating = false; ui.err = ""; render(); },
  async watch(){
    const c = (ui.codeInput || "").replace(/\D/g, "");
    if (c.length !== 4){ ui.err = "Le code fait 4 chiffres."; render(); return; }
    const { data, error } = await sb.from("rooms").select("code").eq("code", c).maybeSingle();
    if (error){ ui.err = "Connexion impossible. Vérifie ta connexion."; render(); return; }
    if (!data){ ui.err = `Aucune partie avec le code ${c}.`; render(); return; }
    await enterRoom(c, true);
  },
  tvGo(){
    ui.tvReady = true; unlockAudio();
    try { const d = document.documentElement; if (d.requestFullscreen) d.requestFullscreen().catch(() => {}); } catch(e){}
    render();
  },
  async stats(){
    ui.menu = false; ui.page = "stats"; ui.stats = null; render();
    const { data, error } = await sb.from("card_scores").select("*");
    ui.stats = error ? { error: true } : { rows: data || [] };
    render();
  },
  home(){ ui.page = "home"; render(); },
  sound(){ ui.sound = !ui.sound; store.set("sound", ui.sound); unlockAudio(); if (ui.sound) sfx.pop(); render(); },
  target(v){ ui.target = +v; store.set("target", ui.target); render(); },
  async timer(v){
    ui.timer = +v; store.set("timer", ui.timer);
    if (room && isLeader() && room.phase === "lobby"){ await sb.from("rooms").update({ timer: ui.timer }).eq("code", code); scheduleRefresh(); }
    else render();
  },
  async flip(){
    if (!room || room.phase !== "judging") return;
    await sb.from("rooms").update({ revealed: room.revealed + 1 }).eq("code", code).eq("phase", "judging").eq("revealed", room.revealed);
    scheduleRefresh();
  },
  async share(){
    const url = joinUrl(code);
    try {
      if (navigator.share){ await navigator.share({ title: "Punchline", text: `Rejoins ma partie de Punchline, code ${code}`, url }); return; }
    } catch(e){ if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); toast("Lien copié"); } catch(e){ toast(url); }
  },
  async addBot(){
    const taken = new Set(players.map(p => p.name));
    const name = BOT_NAMES.find(n => !taken.has(n));
    if (!name){ toast("Il y a déjà assez de robots."); return; }
    const id = BOT_PREFIX + uuid().slice(BOT_PREFIX.length);
    await rpc("join_room", { p_code: code, p_player: id, p_name: name });
  },
  async kick(id){ await sb.from("players").delete().eq("id", id).eq("room", code); scheduleRefresh(); },
  async start(){
    const pool = players.filter(present);
    if (pool.length < MIN_PLAYERS) return;
    const j = pickOne(pool).id;
    busy = true;
    await sb.from("rooms").update({ phase: "draw", round: room.round + 1, start_round: room.round + 1, started_at: new Date().toISOString(), judge: j, card: null, winner: null, fav: null, updated_at: new Date().toISOString() }).eq("code", code).eq("phase", "lobby");
    busy = false; scheduleRefresh();
  },
  async draw(){
    const C = window.CARDS;
    const pool = C.map((_, i) => i);
    let used = (room.used || []).filter(i => i < C.length);
    let free = pool.filter(i => !used.includes(i) && C[i] !== room.card);
    if (!free.length){ used = []; free = pool.filter(i => C[i] !== room.card); }
    const idx = weightedPick(free, await cardWeights());
    used.push(idx);
    busy = true;
    const { error } = await sb.from("rooms").update({ card: C[idx], used, phase: "writing", updated_at: new Date().toISOString() })
      .eq("code", code).eq("round", room.round).in("phase", ["draw", "writing"]);
    busy = false;
    if (error) toast("Connexion perdue, réessaie.");
    scheduleRefresh();
  },
  async send(){
    const t = cleanAnswer(ui.draft);
    if (!t) return;
    busy = true;
    const { error } = await sb.from("answers").upsert({ room: code, round: room.round, player: me.id, text: t.slice(0, 120) }, { onConflict: "room,round,player" });
    busy = false;
    if (error){ toast("Pas envoyé. Vérifie ta connexion et réessaie."); return; }
    ui.editing = false; ui.draft = "";
    scheduleRefresh();
  },
  edit(){ const a = myAnswer(); ui.editing = true; ui.draft = a ? a.text : ""; render(); const el = $("#ans"); if (el){ el.focus(); } },
  reveal(){ setPhase("judging", "writing"); },
  pick(id){ if (isJudge() && room.phase === "judging"){ ui.sel = id; render(); } },
  async confirmPick(){ if (!ui.sel) return; busy = true; await rpc("pick_winner", { p_code: code, p_answer: ui.sel }); busy = false; },
  async vote(id){
    if (!room || room.phase !== "judging" || isJudge()) return;
    const a = roundAnswers().find(x => x.id === id);
    if (!a || a.player === me.id) return;
    const r = room.round;
    // affichage immédiat, la base confirme ensuite
    votes = votes.filter(v => !(v.round === r && v.voter === me.id)).concat([{ room: code, round: r, voter: me.id, answer: id }]);
    buzz(15); render();
    const { error } = await sb.from("votes").upsert({ room: code, round: r, voter: me.id, answer: id }, { onConflict: "room,round,voter" });
    if (error) toast("Vote pas envoyé, réessaie.");
    scheduleRefresh();
  },
  react(e){
    const now = Date.now();
    if (now - lastReact < 350) return;
    lastReact = now; buzz(10);
    sendReaction(e, me.name);
  },
  async rate(v){
    if (!room || !room.card) return;
    const card = room.card, val = +v;
    const prev = ui.ratings[card];
    ui.ratings[card] = val; store.set("ratings", ui.ratings); render();
    const { error } = await sb.from("card_ratings").upsert({ card, player: me.id, rating: val, type: cardType(card), room: code, updated_at: new Date().toISOString() }, { onConflict: "card,player" });
    if (error){ if (prev == null) delete ui.ratings[card]; else ui.ratings[card] = prev; store.set("ratings", ui.ratings); toast("Note pas envoyée, réessaie."); render(); }
  },
  async next(){
    if (maxScore() >= room.target){ await setPhase("end", "result"); return; }
    await rpc("next_round", { p_code: code, p_from: room.round });
  },
  async skip(){ ui.confirmLeave = false; await rpc("next_round", { p_code: code, p_from: room.round }); },
  async restart(){ await rpc("restart_room", { p_code: code }); },
  askLeave(){ ui.confirmLeave = true; render(); },
  cancelLeave(){ ui.confirmLeave = false; render(); },
  async leave(){
    const c = code;
    if (!ui.tv) await sb.from("players").delete().eq("id", me.id).eq("room", c);
    leaveLocal("");
  }
};

/* ---------- vues ---------- */
const ICON = {
  sndOn: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  sndOff: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3L3.2 9.3l2-3.4 1.9.7a7 7 0 0 1 1.7-1l.3-2h4l.3 2a7 7 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  heart: on => `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`
};
const sndBtn = () => `<button class="snd" data-a="sound" aria-label="${ui.sound ? "Couper le son" : "Activer le son"}" title="${ui.sound ? "Son activé" : "Son coupé"}">${ui.sound ? ICON.sndOn : ICON.sndOff}</button>`;
function head(){
  let tag = "";
  if (room){
    tag = room.phase === "lobby" ? `Partie ${esc(code)}` : room.phase === "end" ? "Fin de partie" : `Manche ${room.round} · ${esc(code)}`;
  }
  const snd = room ? sndBtn() : `<button class="snd" data-a="menu" aria-label="Paramètres" title="Paramètres">${ICON.gear}</button>`;
  return `<header><div class="logo">Punch<span>line</span></div><div class="hr">${tag ? `<div class="tag">${tag}</div>` : ""}${snd}</div></header>`;
}
const errBox = () => ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : "";
const wait = txt => `<div class="wait"><span>${txt}</span><span class="dots" aria-hidden="true"><span></span><span></span><span></span></span></div>`;

function scoreList(opts){
  opts = opts || {};
  const top = maxScore();
  return `<div class="players">${players.map(p => {
    let pill = "";
    const here = present(p);
    if (!here) pill = `<span class="pill gone">Parti</span>`;
    else if (opts.status && p.id === room.judge) pill = `<span class="pill judge">Juge</span>`;
    else if (opts.status) pill = roundAnswers().some(a => a.player === p.id) ? `<span class="pill ok">Écrit</span>` : `<span class="pill">Écrit…</span>`;
    else if (room && p.id === room.judge && !["lobby","end"].includes(room.phase)) pill = `<span class="pill judge">Juge</span>`;
    const kick = opts.kick && p.id !== me.id ? `<button class="x" data-a="kick" data-v="${p.id}" aria-label="Retirer ${esc(p.name)}">×</button>` : "";
    const score = opts.noScore ? "" : `<b>${p.score}</b>`;
    return `<div class="pl ${p.id === me.id && !ui.tv ? "me" : ""} ${!opts.noScore && top > 0 && p.score === top ? "top" : ""} ${here ? "" : "away"}"><span class="nm">${esc(p.name)}${p.id === me.id && !ui.tv ? " (toi)" : ""}</span><span class="rt">${pill}${score}${kick}</span></div>`;
  }).join("")}</div>`;
}

function blackCard(ans){
  return `<div class="black pop"><div>${fill(room.card, ans)}</div><div class="brand">Punchline</div></div>`;
}

function footer(){
  if (!room) return "";
  if (ui.confirmLeave){
    return `<div class="foot"><div class="row" style="width:100%"><button class="ghost small" data-a="cancelLeave">Rester</button><button class="btn small" data-a="leave">Quitter la partie</button></div></div>`;
  }
  const skip = isLeader() && ["draw","writing","judging"].includes(room.phase) ? `<button class="link" data-a="skip">Passer la manche</button>` : "";
  return `<div class="foot">${skip}<button class="link" data-a="askLeave">Quitter la partie</button></div>`;
}

const reactBar = () => `<div class="reacts" role="group" aria-label="Réagir">${REACTIONS.map(e => `<button data-a="react" data-v="${e}" aria-label="Réagir ${e}">${e}</button>`).join("")}</div>`;

// Coup de cœur : même règle que la base (sans le juge, sans voter pour soi, pas d'ex aequo)
function favTally(){
  const valid = roundVotes().filter(v => { const a = answers.find(x => x.id === v.answer); return a && a.player !== v.voter && v.voter !== room.judge; });
  const n = {}; valid.forEach(v => { n[v.answer] = (n[v.answer] || 0) + 1; });
  return { counts: n, total: valid.length };
}
function favBlock(){
  const { counts, total } = favTally();
  if (!total) return "";
  if (!room.fav) return `<div class="fav"><span class="label light">Coup de cœur du public</span><p>Égalité dans les votes, pas de point bonus cette fois.</p></div>`;
  const a = answers.find(x => x.id === room.fav);
  if (!a) return "";
  const n = counts[a.id] || 0;
  return `<div class="fav pop"><span class="label light">Coup de cœur du public · ${n} vote${n > 1 ? "s" : ""}</span>
    <div class="answer heartwin">${fill(room.card, a.text)}<span class="by">${esc(nameOf(a.player))} · +1 point bonus</span></div></div>`;
}
// Notation discrète, réservée à l'hôte (sert à améliorer le paquet)
function rateBlock(){
  if (!isLeader()) return "";
  const cur = ui.ratings[room.card];
  return `<div class="rate"><span>Cette carte :</span><button class="${cur === -1 ? "on" : ""}" data-a="rate" data-v="-1">nulle</button><button class="${cur === 1 ? "on" : ""}" data-a="rate" data-v="1">top</button></div>`;
}


/* ---------- insignes ---------- */
// Badge : nom, phrase, couleur, dessin (SVG 24x24, trait crème)
const BADGE_DEF = {
  double:    ["Doublé", "Manche et coup de cœur avec la même réponse", "#ff5a36", `<circle cx="9" cy="12" r="5" /><circle cx="15" cy="12" r="5" />`],
  feu:       ["En feu", "3 manches gagnées d'affilée", "#ff7a1a", `<path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 1.5 1 2 2.5 2 4 1.5-1.5 1-5 1-8z" />`],
  late:      ["Dernière seconde", "Gagné avec une réponse envoyée à la toute fin", "#7a5cff", `<circle cx="12" cy="13" r="7" /><path d="M12 9v4l2.5 2M10 3h4" />`],
  court:     ["Droit au but", "Gagné avec 1 ou 2 mots", "#16a37f", `<path d="M4 12h14M13 6l6 6-6 6" />`],
  juge:      ["Juge en or", "A choisi le coup de cœur du public", "#c99a00", `<path d="M4 17h16l-1.5-9-4.5 4-2-6-2 6-4.5-4z" />`],
  chouchou:  ["Chouchou du public", "Le plus de coups de cœur reçus", "#e8436b", `<path d="M12 19s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 9c0 5.6-7 10-7 10z" />`],
  incompris: ["Incompris", "Aimé du public, jamais choisi par le juge", "#5d7899", `<path d="M9 9a3 3 0 1 1 4 2.8c-.8.4-1 1-1 2.2M12 17.5v.5" />`],
  gachette:  ["Gâchette rapide", "Les réponses les plus rapides", "#1f8fff", `<path d="M13 3L6 13h5l-1 8 7-10h-5z" />`],
  romancier: ["Le romancier", "La réponse gagnante la plus longue", "#8a6a4a", `<path d="M5 6h14M5 10h14M5 14h14M5 18h8" />`],
  rires:     ["Faiseur de rires", "Le plus de réactions reçues", "#ffb000", `<circle cx="12" cy="12" r="8" /><path d="M8.5 13.5a4 4 0 0 0 7 0M9 9.5v.5M15 9.5v.5" />`],
  fantome:   ["Le fantôme", "Parti en pleine partie", "#7d7d8f", `<path d="M6 20V11a6 6 0 0 1 12 0v9l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z" /><path d="M10 11v.5M14 11v.5" />`]
};
function badgeArt(k, size){
  const d = BADGE_DEF[k];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="#fff7e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d[3]}</svg>`;
}
function badgeChip(k, n, who){
  const d = BADGE_DEF[k];
  const cnt = n > 1 ? `<span class="bx">×${n}</span>` : "";
  return `<span class="bmed" style="--bc:${d[2]}" title="${esc(d[1])}"><span class="disc">${badgeArt(k, 26)}${cnt}</span><span class="bn">${esc(d[0])}</span>${who ? `<span class="bw">${esc(who)}</span>` : ""}</span>`;
}
const words = t => cleanAnswer(t).split(" ").filter(Boolean).length;
// Réponses de la partie en cours
const gameAnswers = () => room ? answers.filter(a => a.round >= (room.start_round || 1)) : [];
// Insignes gagnés pendant une manche donnée : [{k, player}]
function roundBadges(round){
  const list = gameAnswers().filter(a => a.round === round), out = [];
  const w = list.find(a => a.won);
  if (!w) return out;
  if (w.fav){ out.push({ k: "double", player: w.player }); if (w.judge) out.push({ k: "juge", player: w.judge }); }
  if (w.late) out.push({ k: "late", player: w.player });
  if (words(w.text) <= 2) out.push({ k: "court", player: w.player });
  // série : manches gagnées d'affilée jusqu'à celle-ci
  const winners = {}; gameAnswers().filter(a => a.won).forEach(a => { winners[a.round] = a.player; });
  const rounds = Object.keys(winners).map(Number).filter(r => r <= round).sort((a, b) => a - b);
  let streak = 0;
  for (let i = rounds.length - 1; i >= 0 && winners[rounds[i]] === w.player; i--) streak++;
  if (streak >= 3 && streak % 3 === 0) out.push({ k: "feu", player: w.player });
  return out;
}
// Tous les insignes de la partie, par joueur : { id: {k: n} }
function gameBadges(){
  const res = {}, add = (id, k) => { if (!id || !byId(id)) return; (res[id] = res[id] || {})[k] = (res[id][k] || 0) + 1; };
  const G = gameAnswers();
  [...new Set(G.map(a => a.round))].forEach(r => roundBadges(r).forEach(b => add(b.player, b.k)));
  const best = (scores, k, min) => {
    const vals = Object.values(scores); if (!vals.length) return;
    const top = k === "gachette" ? Math.min(...vals) : Math.max(...vals);
    if (k !== "gachette" && top < (min || 1)) return;
    Object.keys(scores).filter(id => scores[id] === top).forEach(id => add(id, k));
  };
  // coups de cœur reçus (votes valides)
  const favs = {}, ansById = {}; G.forEach(a => { ansById[a.id] = a; });
  votes.forEach(v => { const a = ansById[v.answer]; if (a && a.player !== v.voter && v.voter !== a.judge && a.round === v.round) favs[a.player] = (favs[a.player] || 0) + 1; });
  best(favs, "chouchou");
  const wins = {}; G.filter(a => a.won).forEach(a => { wins[a.player] = 1; });
  Object.keys(favs).filter(id => !wins[id]).forEach(id => add(id, "incompris"));
  const t = {}; G.filter(a => a.secs != null).forEach(a => { (t[a.player] = t[a.player] || []).push(+a.secs); });
  const avg = {}; Object.keys(t).filter(id => t[id].length >= 2).forEach(id => { avg[id] = Math.round(t[id].reduce((x, y) => x + y, 0) / t[id].length * 10) / 10; });
  best(avg, "gachette");
  const wonList = G.filter(a => a.won); if (wonList.length){ const L = Math.max(...wonList.map(a => cleanAnswer(a.text).length)); wonList.filter(a => cleanAnswer(a.text).length === L).forEach(a => add(a.player, "romancier")); }
  const rr = {}; reacts.forEach(x => { const a = ansById[x.answer]; if (a && a.player !== x.player) rr[a.player] = (rr[a.player] || 0) + 1; });
  best(rr, "rires");
  players.filter(p => !isBot(p.id) && (p.ghost || !present(p))).forEach(p => add(p.id, "fantome"));
  return res;
}
function roundBadgeBlock(){
  const list = roundBadges(room.round);
  if (!list.length) return "";
  return `<div class="badges-now pop"><span class="label light">Insigne${list.length > 1 ? "s" : ""} débloqué${list.length > 1 ? "s" : ""}</span>
    <div class="bgrid">${list.map(b => badgeChip(b.k, 1, nameOf(b.player))).join("")}</div></div>`;
}
function endBadgeBlock(){
  const all = gameBadges();
  const rows = players.filter(p => all[p.id]).map(p => {
    const ks = Object.keys(BADGE_DEF).filter(k => all[p.id][k]);
    return `<div class="brow"><span class="nm">${esc(p.name)}${p.id === me.id && !ui.tv ? " (toi)" : ""}</span><div class="bgrid">${ks.map(k => badgeChip(k, all[p.id][k])).join("")}</div></div>`;
  });
  if (!rows.length) return "";
  return `<div class="stack"><span class="label light">Les insignes de la partie</span>${rows.join("")}</div>`;
}

const views = {
  home(){
    if (ui.page === "stats") return views.stats();
    const viaLink = !!urlCode && ui.codeInput === urlCode && !urlTv;
    return `${head()}
    <h1>Le jeu où c'est vous qui écrivez la chute.</h1>
    <p class="lead">Une carte à trous s'affiche sur tous les téléphones. Chacun la complète avec la réponse la plus drôle possible, et le juge choisit la meilleure.</p>
    ${errBox()}
    ${ui.menu ? `
    <div class="card menu pop">
      <div class="mhead"><h2>Paramètres</h2><button class="ghost dark small" data-a="menu">Fermer</button></div>
      <button class="mrow" data-a="sound" role="switch" aria-checked="${ui.sound}"><span><b>Son</b><small>Chrono, retournement des cartes, victoire</small></span><span class="sw ${ui.sound ? "on" : ""}"></span></button>
      <button class="mrow" data-a="showTv"><span><b>Afficher sur un grand écran</b><small>La télé ou l'ordi montre la carte et les réponses, chacun écrit sur son téléphone</small></span><span class="chev">›</span></button>
      <button class="mrow" data-a="stats"><span><b>Notes des cartes</b><small>Quels styles de cartes vous font rire</small></span><span class="chev">›</span></button>
    </div>` : ui.tvAsk ? `
    <div class="card stack pop">
      <h2>Grand écran</h2>
      <p style="color:var(--muted)">Cet écran (télé, ordi) affichera la carte, le compte à rebours et les réponses pour tout le monde. Il ne joue pas : chacun écrit sur son téléphone.</p>
      <label for="code">Code de la partie</label>
      <input id="code" class="codein" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="0000" value="${esc(ui.codeInput)}" autocomplete="off">
      <button class="btn" data-a="watch">Afficher la partie</button>
      <button class="ghost dark small" data-a="showTv">Annuler</button>
    </div>` : `
    <div class="card stack">
      <label for="name">Ton prénom</label>
      <input id="name" maxlength="20" autocomplete="given-name" placeholder="Ex. Naim" value="${esc(me.name)}">
      <label for="code">Code de la partie</label>
      <div class="row"><input id="code" class="codein" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="0000" value="${esc(ui.codeInput)}" autocomplete="off"></div>
      <button class="btn" data-a="join">${viaLink ? `Rejoindre la partie ${esc(urlCode)}` : "Rejoindre"}</button>
    </div>
    <div class="or">ou</div>
    ${ui.creating ? `
    <div class="card stack pop">
      <h2>Nouvelle partie</h2>
      <span class="label">Points pour gagner</span>
      <div class="seg">${[3,5,7,10].map(n => `<button data-a="target" data-v="${n}" class="${ui.target === n ? "on" : ""}">${n}</button>`).join("")}</div>
      <span class="label">Temps pour répondre</span>
      ${timerSeg(ui.timer)}
      <button class="btn" data-a="create">Créer la partie</button>
      <button class="ghost dark small" data-a="showCreate">Annuler</button>
    </div>` : `<button class="ghost" data-a="showCreate">Créer une partie</button>`}`}
    <div class="stack" style="gap:6px;opacity:.85;font-size:14px">
      <span class="label light">Comment on joue</span>
      <p>1. Quelqu'un crée la partie, les autres scannent le QR code ou tapent le code.</p>
      <p>2. Le juge pioche une carte à trous et la lit à voix haute.</p>
      <p>3. Chacun écrit sa réponse en secret sur son téléphone.</p>
      <p>4. Le juge retourne les réponses et choisit sa préférée : 1 point. Le public vote pour son coup de cœur : 1 point bonus.</p>
    </div>`;
  },

  stats(){
    const s = ui.stats;
    let body;
    if (!s) body = wait("Chargement des notes");
    else if (s.error) body = `<div class="err">Impossible de charger les notes. Vérifie ta connexion.</div>`;
    else {
      const T = window.CARD_TYPES || {}, deck = window.CARD_DECK || {};
      const rows = s.rows.map(r => ({ ...r, type: cardType(r.card) !== "autre" ? cardType(r.card) : (r.type || "autre") }));
      const votesTotal = rows.reduce((t, r) => t + r.up + r.down, 0);
      const types = Object.keys(T).map(k => {
        const rs = rows.filter(r => r.type === k), up = rs.reduce((t, r) => t + r.up, 0), down = rs.reduce((t, r) => t + r.down, 0);
        return { k, label: T[k], up, down, n: rs.length, size: (deck[k] || []).length, pct: up + down ? Math.round(up / (up + down) * 100) : null };
      }).sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct));
      const score = r => (r.up - r.down) * 10 + r.up;
      const best = rows.filter(r => r.up > r.down).sort((a, b) => score(b) - score(a)).slice(0, 5);
      const worst = rows.filter(r => r.down > r.up).sort((a, b) => score(a) - score(b)).slice(0, 5);
      const line = r => `<div class="srow"><span>${fill(r.card)}</span><b>top ${r.up} · nulle ${r.down}</b></div>`;
      body = !votesTotal ? `<p class="lead">Aucune note pour l'instant. À la fin de chaque manche, touchez « Nulle » ou « Top » sous la carte : les cartes bien notées sortiront plus souvent, et cette page montrera quel genre vous fait rire.</p>`
      : `<p class="lead">${votesTotal} note${votesTotal > 1 ? "s" : ""} sur ${rows.length} carte${rows.length > 1 ? "s" : ""}. Les cartes bien notées sortent plus souvent, les mal notées plus rarement.</p>
        <div class="stack"><span class="label light">Par type de carte</span>
        ${types.map(t => `<div class="tbar"><div class="tl"><span>${esc(t.label)}</span><b>${t.pct == null ? "pas encore noté" : t.pct + " % top"}</b></div>
          <div class="bar"><i style="width:${t.pct || 0}%"></i></div><span class="hint">${t.n}/${t.size} cartes notées · top ${t.up} · nulle ${t.down}</span></div>`).join("")}</div>
        ${best.length ? `<div class="stack"><span class="label light">Les cartes préférées</span>${best.map(line).join("")}</div>` : ""}
        ${worst.length ? `<div class="stack"><span class="label light">Les cartes les moins aimées</span>${worst.map(line).join("")}</div>` : ""}`;
    }
    return `${head()}<h2>Quelles cartes plaisent ?</h2>${body}<button class="ghost" data-a="home">Retour</button>`;
  },

  lobby(){
    const n = players.length, missing = Math.max(0, MIN_PLAYERS - players.filter(present).length);
    return `${head()}
    <div class="stack center">
      <span class="label light">Code de la partie</span>
      <div class="codebig">${esc(code)}</div>
      <div class="qr" id="qr" aria-label="QR code pour rejoindre la partie">${qrSvg(joinUrl(code))}</div>
      <p class="lead" style="font-size:14px">Scanne avec l'appareil photo, ou tape le code dans l'appli.</p>
      <button class="ghost small" data-a="share">Partager le lien</button>
    </div>
    <div class="stack">
      <span class="label light">Joueurs · ${n}</span>
      ${scoreList({ noScore: true, kick: isLeader() })}
      <p style="font-size:14px;opacity:.8">Partie en ${room.target} points · ${timerLabel(room.timer)}</p>
      ${isLeader() ? `<span class="label light">Temps pour répondre</span>${timerSeg(room.timer)}` : ""}
    </div>
    ${isLeader()
      ? `<button class="btn" data-a="start" ${missing ? "disabled" : ""}>Lancer la partie</button>
         ${missing ? `<p class="center" style="font-size:14px;opacity:.85">Encore ${missing} joueur${missing > 1 ? "s" : ""} pour lancer.</p>` : ""}`
      : wait(`${esc(nameOf(leader() && leader().id))} va lancer la partie`)}
    ${isLeader() ? `<button class="ghost small" data-a="addBot">Ajouter un joueur robot</button>
      <p class="center" style="font-size:13px;opacity:.75">Pour tester seul : les robots répondent, votent et jugent au hasard.</p>
      <p class="center hint">Une télé ou un ordi ? Ouvre ${esc(shortUrl())} dessus, va dans « Grand écran » et tape ${esc(code)}.</p>` : ""}
    ${footer()}`;
  },

  draw(){
    if (isJudge()) return `${head()}
      <p class="lead">Cette manche, c'est toi le juge.</p>
      <div class="big-name pop">À toi de piocher</div>
      <button class="btn gold" data-a="draw">Piocher une carte</button>
      <p style="font-size:14px;opacity:.85">La carte s'affichera sur tous les téléphones. Lis-la à voix haute.</p>
      ${scoreList()}
      ${footer()}`;
    return `${head()}
      <p class="lead">Le juge de cette manche</p>
      <div class="big-name pop">${esc(nameOf(room.judge))}</div>
      ${wait("pioche une carte")}
      ${scoreList()}
      ${footer()}`;
  },

  writing(){
    const w = writers().length, n = writersDone();
    if (isJudge()) return `${head()}
      ${blackCard()}
      ${timerBox()}
      <p class="lead">Lis la carte à voix haute. Les autres écrivent leur réponse.</p>
      <div class="row" style="align-items:baseline;gap:10px"><span class="counter">${n}/${w}</span><span>réponses reçues</span></div>
      ${scoreList({ status: true, noScore: true })}
      ${roundAnswers().length === 0 ? `<button class="ghost small" data-a="draw">Changer de carte</button>` : ""}
      ${n > 0 && n < w ? `<button class="ghost small" data-a="reveal">Révéler sans attendre</button>` : ""}
      ${footer()}`;
    const mine = myAnswer();
    if (mine && !ui.editing) return `${head()}
      ${blackCard(mine.text)}
      ${timerBox()}
      <div class="stack center"><h2>Réponse envoyée</h2>${wait(`En attente des autres`)}</div>
      <button class="ghost small" data-a="edit">Modifier ma réponse</button>
      ${footer()}`;
    return `${head()}
      ${blackCard()}
      ${timerBox()}
      <div class="card stack">
        <label for="ans">Ta réponse</label>
        <textarea id="ans" maxlength="120" placeholder="Complète la carte…" enterkeyhint="send"></textarea>
        <p class="preview" id="preview" aria-live="polite"></p>
        <button class="btn" data-a="send" id="send" disabled>Envoyer</button>
      </div>
      <p style="font-size:14px;opacity:.85">${room.deadline ? "À la fin du temps, ce que tu as écrit part tout seul. " : ""}Le juge ne saura pas qui a écrit quoi avant d'avoir choisi.</p>
      ${footer()}`;
  },

  judging(){
    const list = seededShuffle(roundAnswers(), code + ":" + room.round);
    const judge = isJudge(), n = list.length, shown = Math.min(room.revealed || 0, n), all = shown >= n;
    const jn = esc(nameOf(room.judge));
    if (!n) return `${head()}
      <h2>Personne n'a répondu à temps</h2>
      ${blackCard()}
      ${judge || isLeader() ? `<button class="btn" data-a="skip">Manche suivante</button>` : wait(`${jn} passe à la suite`)}
      ${footer()}`;
    const mv = myVote();
    const cards = list.map((a, k) => {
      if (k >= shown) return `<div class="answer facedown" aria-label="Carte ${k + 1} face cachée"><span class="num">Carte ${k + 1}</span><span class="back">Punchline</span></div>`;
      const pop = k === shown - 1 && !all ? "pop" : "";
      if (judge) return `<button class="answer ${ui.sel === a.id ? "sel" : ""} ${pop}" data-a="pick" data-v="${a.id}" ${all ? "" : "disabled style=\"opacity:1;cursor:default\""}><span class="num">Carte ${k + 1}</span>${fill(room.card, a.text)}</button>`;
      const mine = a.player === me.id, on = mv && mv.answer === a.id;
      const heart = mine ? `<span class="mine">Ta réponse</span>`
        : `<button class="heart ${on ? "on" : ""}" data-a="vote" data-v="${a.id}" aria-pressed="${on}">${ICON.heart(on)}<span>${on ? "Ton coup de cœur" : "Coup de cœur"}</span></button>`;
      return `<div class="answer ${on ? "voted" : ""} ${pop}"><span class="num">Carte ${k + 1}</span>${fill(room.card, a.text)}${heart}</div>`;
    }).join("");
    let top, bottom;
    if (judge && !all){
      top = `<h2>Retourne les cartes une par une</h2><p class="lead">Lis chaque carte à voix haute avant de passer à la suivante.</p>`;
      bottom = `<button class="btn gold" data-a="flip">${shown === 0 ? "Retourner la première carte" : `Retourner la carte suivante (${shown + 1}/${n})`}</button>`;
    } else if (judge){
      top = `<h2>Choisis la meilleure carte</h2><p class="lead">Touche ta préférée puis valide. Pendant ce temps, les autres votent pour leur coup de cœur.</p>`;
      bottom = `<button class="btn" data-a="confirmPick" ${ui.sel ? "" : "disabled"}>Valider ce choix</button>`;
    } else {
      top = `<h2>${all ? `${jn} choisit la meilleure` : `${jn} lit les cartes`}</h2>
        <p class="lead">Vote pour ton coup de cœur (pas la tienne) : la carte la plus votée gagne 1 point bonus.</p>`;
      bottom = wait(all ? "Suspense" : `${shown}/${n} cartes retournées`);
    }
    return `${head()}
      ${top}
      <div class="answers">${cards}</div>
      ${shown > 0 ? reactBar() : ""}
      ${bottom}
      ${footer()}`;
  },

  result(){
    const list = seededShuffle(roundAnswers(), code + ":" + room.round);
    const win = list.find(a => a.id === room.winner);
    const others = list.filter(a => a.id !== room.winner && a.id !== room.fav);  // le coup de cœur est déjà affiché au-dessus
    const over = maxScore() >= room.target;
    const canNext = isJudge() || isLeader() || judgeGone();
    return `${head()}
      <p class="lead">Gagnant de la manche</p>
      <div class="big-name pop">${win ? esc(nameOf(win.player)) : "Personne"}</div>
      ${win ? `<div class="answer win pop">${fill(room.card, win.text)}</div>` : ""}
      ${win && !over ? `<p class="lead">${win.player === me.id ? "Tu deviens" : esc(nameOf(win.player)) + " devient"} juge pour la prochaine manche.</p>` : ""}
      ${favBlock()}
      ${reactBar()}
      ${scoreList()}
      ${canNext ? `<button class="btn" data-a="next">${over ? "Voir le classement final" : "Manche suivante"}</button>` : wait(`${esc(nameOf(room.judge))} lance la suite`)}
      ${others.length ? `<div class="stack"><span class="label light">Les autres cartes</span><div class="answers">${others.map(a => `<div class="answer" style="font-size:18px">${fill(room.card, a.text)}<span class="by">${esc(nameOf(a.player))}</span></div>`).join("")}</div></div>` : ""}
      ${rateBlock()}
      ${footer()}`;
  },

  end(){
    const top = maxScore();
    const champs = players.filter(p => p.score === top);
    return `${head()}
      <p class="lead">Champion${champs.length > 1 ? "s" : ""} de la soirée</p>
      <div class="big-name pop">${champs.map(p => esc(p.name)).join(" & ")}</div>
      <p class="lead">${top} point${top > 1 ? "s" : ""}.</p>
      ${scoreList()}
      ${endBadgeBlock()}
      ${isLeader() ? `<button class="btn" data-a="restart">Rejouer avec les mêmes</button>` : wait(`${esc(nameOf(leader() && leader().id))} peut relancer une partie`)}
      <button class="ghost" data-a="leave">Quitter</button>`;
  }
};

/* ---------- vues grand écran (télé / ordi) ---------- */
const tvHead = () => `<header><div class="logo">Punch<span>line</span></div><div class="hr"><div class="tag">${room.phase === "lobby" ? "Grand écran" : room.phase === "end" ? "Fin de partie" : `Manche ${room.round}`} · code ${esc(code)}</div>
  ${sndBtn()}<button class="link" data-a="leave">Quitter</button></div></header>`;
const tvSide = () => `<aside class="side"><span class="label light">Scores · partie en ${room.target}</span>${scoreList()}<div class="joinmini"><div class="qr small">${qrSvg(joinUrl(code))}</div><span>Rejoindre : <b>${esc(code)}</b></span></div></aside>`;
const tvViews = {
  start(){
    return `<header><div class="logo">Punch<span>line</span></div></header>
    <div class="tvstart"><h1>Grand écran prêt</h1><p class="lead">Partie ${esc(code)}. Touche le bouton pour lancer l'affichage et activer le son.</p>
    <button class="btn gold" data-a="tvGo" style="max-width:420px">Lancer l'affichage</button></div>`;
  },
  lobby(){
    return `${tvHead()}<div class="tvlobby">
      <div class="stack center"><span class="label light">Sortez vos téléphones</span><div class="codebig">${esc(code)}</div>
      <p class="lead">Scannez le QR code ou ouvrez <b>${esc(shortUrl())}</b> et tapez le code.</p></div>
      <div class="qr big">${qrSvg(joinUrl(code))}</div>
      <div class="stack"><span class="label light">Joueurs · ${players.length}</span>${scoreList({ noScore: true })}
      ${wait(`${esc(nameOf(leader() && leader().id))} va lancer la partie`)}</div></div>`;
  },
  draw(){
    return `${tvHead()}<div class="tvgrid"><main class="stack center tvmain">
      <p class="lead">Le juge de cette manche</p><div class="big-name pop">${esc(nameOf(room.judge))}</div>${wait("pioche une carte")}</main>${tvSide()}</div>`;
  },
  writing(){
    const w = writers().length, n = writersDone();
    return `${tvHead()}<div class="tvgrid"><main class="stack tvmain">${blackCard()}${timerBox()}
      <div class="row" style="align-items:baseline;gap:14px"><span class="counter">${n}/${w}</span><span class="lead">réponses reçues · écrivez sur vos téléphones</span></div>
      ${scoreList({ status: true, noScore: true })}</main>${tvSide()}</div>`;
  },
  judging(){
    const list = seededShuffle(roundAnswers(), code + ":" + room.round);
    const n = list.length, shown = Math.min(room.revealed || 0, n), all = shown >= n;
    const cards = list.map((a, k) => k < shown
      ? `<div class="answer ${k === shown - 1 && !all ? "pop" : ""}"><span class="num">Carte ${k + 1}</span>${fill(room.card, a.text)}</div>`
      : `<div class="answer facedown"><span class="num">Carte ${k + 1}</span><span class="back">Punchline</span></div>`).join("");
    return `${tvHead()}<div class="tvgrid"><main class="stack tvmain">
      <h2>${!n ? "Personne n'a répondu à temps" : all ? `${esc(nameOf(room.judge))} choisit la meilleure` : `${esc(nameOf(room.judge))} lit les cartes · ${shown}/${n}`}</h2>
      <div class="black slim"><div>${fill(room.card)}</div></div>
      <div class="answers tvans">${cards}</div>
      ${n ? `<p class="lead">Sur vos téléphones : votez pour votre coup de cœur et réagissez</p>` : ""}</main>${tvSide()}</div>`;
  },
  result(){
    const win = answers.find(a => a.id === room.winner);
    return `${tvHead()}<div class="tvgrid"><main class="stack tvmain">
      <p class="lead">Gagnant de la manche</p><div class="big-name pop">${win ? esc(nameOf(win.player)) : "Personne"}</div>
      ${win ? `<div class="answer win pop">${fill(room.card, win.text)}</div>` : ""}
      ${favBlock()}</main>${tvSide()}</div>`;
  },
  end(){
    const top = maxScore(), champs = players.filter(p => p.score === top);
    return `${tvHead()}<div class="tvgrid"><main class="stack center tvmain">
      <p class="lead">Champion${champs.length > 1 ? "s" : ""} de la soirée</p>
      <div class="big-name pop">${champs.map(p => esc(p.name)).join(" & ")}</div><p class="lead">${top} point${top > 1 ? "s" : ""}</p>${endBadgeBlock()}</main>${tvSide()}</div>`;
  }
};

/* ---------- minuteur ---------- */
const timerLabel = t => t ? (t >= 60 ? `${t / 60} min` : `${t} s`) + " pour répondre" : "temps illimité";
const timerSeg = cur => `<div class="seg">${TIMERS.map(([v, l]) => `<button data-a="timer" data-v="${v}" class="${cur === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
const timerBox = () => room && room.deadline ? `<div class="timer" id="timer" role="timer" aria-live="off"></div>` : "";
const remaining = () => room && room.deadline ? (parseTs(room.deadline) - serverNow()) / 1000 : null;
const once = new Set();
function tick(){
  if (!room || room.phase !== "writing" || !room.deadline) return;
  const left = remaining(), total = room.timer || 1;
  const sec = Math.max(0, Math.ceil(left));
  const el = $("#timer");
  if (el){
    const pct = Math.max(0, Math.min(100, left / total * 100));
    el.className = "timer" + (sec <= 5 ? " urgent" : "");
    el.innerHTML = `<span class="tnum">${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}</span><span class="bar"><i style="width:${pct}%"></i></span>`;
  }
  const key = room.round + ":" + room.card;
  // bip sur les 5 dernières secondes
  if (sec >= 1 && sec <= 5 && left > 0 && !once.has("beep:" + key + ":" + sec)){
    once.add("beep:" + key + ":" + sec);
    if (ui.tv || isJudge() || !myAnswer()) sfx.tick(sec === 1);
  }
  if (ui.tv) return;
  // à la fin du temps, la réponse en cours part toute seule
  if (left <= 0.7 && !isJudge() && !myAnswer() && cleanAnswer(ui.draft) && !once.has("send:" + key)){ once.add("send:" + key); actions.send(); }
  // puis on passe aux cartes
  const drives = isJudge() || (isLeader() && (isBot(room.judge) || judgeGone()));
  if (left <= -1 && drives && !once.has("reveal:" + key)){ once.add("reveal:" + key); setPhase("judging", "writing"); }
}
setInterval(tick, 250);
// la présence change avec le temps même sans message : on redessine de temps en temps
setInterval(() => { if (room) { render(); autoActions(); } }, 5000);

/* ---------- QR code ---------- */
const qrCache = {};
function qrSvg(url){
  if (qrCache[url] != null) return qrCache[url];
  try {
    const q = window.qrcode(0, "M"); q.addData(url); q.make();
    qrCache[url] = q.createSvgTag({ scalable: true, margin: 0 });
  } catch(e){ qrCache[url] = ""; }
  return qrCache[url];
}

/* ---------- rendu ---------- */
let lastHtml = "";
function render(){
  document.body.classList.toggle("tv", !!(ui.tv && room));
  let html;
  if (ui.tv && room) html = !ui.tvReady ? tvViews.start() : (tvViews[room.phase] || tvViews.lobby)();
  else { const v = !room ? "home" : room.phase; html = (views[v] || views.home)(); }
  if (html === lastHtml) return;
  const act = document.activeElement, actId = act && act.id, s = act && act.selectionStart, e = act && act.selectionEnd;
  $("#app").innerHTML = html;
  lastHtml = html;
  const ans = $("#ans");
  if (ans){ ans.value = ui.draft; updatePreview(); }
  tick();
  if (actId){ const el = document.getElementById(actId); if (el){ el.focus({ preventScroll: true }); try { if (s != null) el.setSelectionRange(s, e); } catch(x){} } }
}
function updatePreview(){
  const p = $("#preview"), b = $("#send");
  if (p) p.innerHTML = cleanAnswer(ui.draft) ? fill(room.card, ui.draft) : "";
  if (b) b.disabled = !cleanAnswer(ui.draft);
}

/* ---------- événements ---------- */
document.addEventListener("pointerdown", unlockAudio, { passive: true });
document.addEventListener("keydown", unlockAudio);
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-a]");
  if (!b || b.disabled) return;
  const fn = actions[b.dataset.a];
  if (!fn) return;
  unlockAudio();
  b.disabled = true;
  try { await fn(b.dataset.v); } finally { if (document.body.contains(b)) b.disabled = false; }
});
document.addEventListener("input", ev => {
  const t = ev.target;
  if (t.id === "name"){ me.name = t.value; store.set("name", t.value.trim()); }
  if (t.id === "code"){ t.value = t.value.replace(/\D/g, "").slice(0, 4); ui.codeInput = t.value; }
  if (t.id === "ans"){ ui.draft = t.value; updatePreview(); }
});
document.addEventListener("keydown", ev => {
  if (ev.key !== "Enter") return;
  if (ev.target.id === "code" || ev.target.id === "name"){ ev.preventDefault(); ui.tvAsk ? actions.watch() : actions.join(); }
  if (ev.target.id === "ans" && !ev.shiftKey){ ev.preventDefault(); actions.send(); }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && code){ ping().then(refresh); keepAwake(); }
});

/* ---------- démarrage ---------- */
(async function boot(){
  if (urlTv){
    const { data } = await sb.from("rooms").select("code").eq("code", urlTv).maybeSingle();
    if (data){ await enterRoom(urlTv, true); return; }
    ui.err = `Aucune partie avec le code ${urlTv}.`;
  }
  const saved = store.get("room");
  if (saved && !urlTv && (!urlCode || urlCode === saved)){
    const { data } = await sb.from("players").select("id").eq("id", me.id).eq("room", saved).maybeSingle();
    if (data){ await enterRoom(saved); return; }
    store.del("room");
  }
  render();
  if (urlCode && !urlTv && !me.name){ const n = $("#name"); if (n) n.focus(); }
})();
})();
