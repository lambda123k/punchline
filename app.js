/* Punchline — jeu de cartes à trous multi-téléphones */
(function(){
"use strict";
const SB_URL = "https://pjywkbrqtntblxtwqjlj.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqeXdrYnJxdG50Ymx4dHdxamxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3ODE4OTgsImV4cCI6MjEwODM1Nzg5OH0.QCn_kmkkkc2m5idX3YGOFVD_VQS0wA-5Q_9fZKZK260";
const BLANK = "____";
const MIN_PLAYERS = 3;

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
const urlCode = (new URLSearchParams(location.search).get("c") || "").replace(/\D/g, "").slice(0, 4);

let code = null, room = null, players = [], answers = [];
let channel = null, pollTimer = null, refreshTimer = null, busy = false;
const ui = { creating: false, target: store.get("target") || 5, mode: store.get("mode") || "mix",
  codeInput: urlCode, err: "", sel: null, editing: false, confirmLeave: false, draft: "" };

/* ---------- outils ---------- */
const $ = s => document.querySelector(s);
const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cleanAnswer = t => String(t || "").trim().replace(/\s+/g, " ").replace(/[.。]+$/, "");
function fill(card, ans, cls){
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
const joinUrl = c => location.origin + location.pathname + "?c=" + c;

/* ---------- dérivés ---------- */
const byId = id => players.find(p => p.id === id);
const nameOf = id => (byId(id) || {}).name || "Quelqu'un";
const leader = () => players.slice().sort((a, b) => a.seat - b.seat)[0];
const isLeader = () => !!leader() && leader().id === me.id;
const isJudge = () => room && room.judge === me.id;
const roundAnswers = () => room ? answers.filter(a => a.round === room.round && byId(a.player)) : [];
const writers = () => players.filter(p => room && p.id !== room.judge);
const myAnswer = () => roundAnswers().find(a => a.player === me.id);
const maxScore = () => Math.max(0, ...players.map(p => p.score));

/* ---------- réseau ---------- */
function scheduleRefresh(){ clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); }

async function refresh(){
  if (!code) return;
  const c = code;
  const [r, p, a] = await Promise.all([
    sb.from("rooms").select("*").eq("code", c).maybeSingle(),
    sb.from("players").select("*").eq("room", c).order("seat"),
    sb.from("answers").select("*").eq("room", c)
  ]);
  if (c !== code) return;
  if (r.error || p.error || a.error){ return; } // réseau instable : le prochain passage réessaiera
  if (!r.data){ leaveLocal("La partie n'existe plus."); return; }
  const prevRound = room && room.round, prevPhase = room && room.phase;
  room = r.data; players = p.data || []; answers = a.data || [];
  if (!byId(me.id)){ leaveLocal("Tu n'es plus dans la partie."); return; }
  if (prevRound !== room.round || prevPhase !== room.phase){
    ui.sel = null; ui.confirmLeave = false;
    if (prevRound !== room.round){ ui.editing = false; ui.draft = ""; }
  }
  render();
  autoActions();
}

async function autoActions(){
  if (!room || busy) return;
  // Le juge révèle dès que tout le monde a écrit
  if (room.phase === "writing" && isJudge()){
    const w = writers().length, n = roundAnswers().length;
    if (w > 0 && n >= w) await setPhase("judging", "writing");
  }
  // Si le juge a quitté la partie, le premier joueur relance une manche
  if (["draw","writing","judging","result"].includes(room.phase) && room.judge && !byId(room.judge) && isLeader()){
    await rpc("next_round", { p_code: code, p_from: room.round });
  }
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

function subscribe(c){
  unsubscribe();
  channel = sb.channel("room-" + c)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: "code=eq." + c }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: "room=eq." + c }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "answers", filter: "room=eq." + c }, scheduleRefresh)
    .subscribe();
  pollTimer = setInterval(refresh, 4000); // filet de sécurité si le temps réel décroche
}
function unsubscribe(){
  if (channel){ sb.removeChannel(channel); channel = null; }
  clearInterval(pollTimer); pollTimer = null;
}

let wakeLock = null;
async function keepAwake(){ try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch(e){} }

async function enterRoom(c){
  code = c; store.set("room", c);
  ui.err = ""; ui.creating = false;
  if (location.search) history.replaceState(null, "", location.pathname);
  subscribe(c);
  keepAwake();
  await refresh();
}
function leaveLocal(msg){
  unsubscribe();
  code = null; room = null; players = []; answers = [];
  store.del("room");
  ui.err = msg || ""; ui.confirmLeave = false; ui.editing = false; ui.draft = "";
  render();
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
    const { data, error } = await sb.rpc("create_room", { p_host: me.id, p_name: n, p_target: ui.target, p_mode: ui.mode });
    busy = false;
    if (error || !data){ ui.err = "Impossible de créer la partie. Vérifie ta connexion."; render(); return; }
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
  showCreate(){ ui.creating = !ui.creating; ui.err = ""; render(); },
  target(v){ ui.target = +v; store.set("target", ui.target); render(); },
  mode(v){ ui.mode = v; store.set("mode", v); render(); },
  async share(){
    const url = joinUrl(code);
    try {
      if (navigator.share){ await navigator.share({ title: "Punchline", text: `Rejoins ma partie de Punchline, code ${code}`, url }); return; }
    } catch(e){ if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); toast("Lien copié"); } catch(e){ toast(url); }
  },
  async kick(id){ await sb.from("players").delete().eq("id", id).eq("room", code); scheduleRefresh(); },
  async start(){
    if (players.length < MIN_PLAYERS) return;
    const j = players[Math.floor(Math.random() * players.length)].id;
    busy = true;
    await sb.from("rooms").update({ phase: "draw", round: room.round + 1, judge: j, card: null, winner: null, updated_at: new Date().toISOString() }).eq("code", code).eq("phase", "lobby");
    busy = false; scheduleRefresh();
  },
  async draw(){
    const C = window.CARDS;
    let pool = [];
    if (room.mode !== "limite") C.soft.forEach((_, i) => pool.push(i));
    if (room.mode !== "soft") C.limite.forEach((_, i) => pool.push(1000 + i));
    let used = (room.used || []).slice();
    let free = pool.filter(i => !used.includes(i) && cardText(i) !== room.card);
    if (!free.length){ used = []; free = pool.filter(i => cardText(i) !== room.card); }
    const idx = free[Math.floor(Math.random() * free.length)];
    used.push(idx);
    busy = true;
    const { error } = await sb.from("rooms").update({ card: cardText(idx), used, phase: "writing", updated_at: new Date().toISOString() })
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
    await sb.from("players").delete().eq("id", me.id).eq("room", c);
    leaveLocal("");
  }
};
function cardText(i){ return i >= 1000 ? window.CARDS.limite[i - 1000] : window.CARDS.soft[i]; }

/* ---------- vues ---------- */
function head(){
  let tag = "";
  if (room){
    tag = room.phase === "lobby" ? `Partie ${esc(code)}` : room.phase === "end" ? "Fin de partie" : `Manche ${room.round} · ${esc(code)}`;
  }
  return `<header><div class="logo">Punch<span>line</span></div>${tag ? `<div class="tag">${tag}</div>` : ""}</header>`;
}
const errBox = () => ui.err ? `<div class="err" role="alert">${esc(ui.err)}</div>` : "";
const wait = txt => `<div class="wait"><span>${txt}</span><span class="dots" aria-hidden="true"><span></span><span></span><span></span></span></div>`;

function scoreList(opts){
  opts = opts || {};
  const top = maxScore();
  return `<div class="players">${players.map(p => {
    let pill = "";
    if (opts.status && p.id === room.judge) pill = `<span class="pill judge">Juge</span>`;
    else if (opts.status) pill = roundAnswers().some(a => a.player === p.id) ? `<span class="pill ok">Écrit</span>` : `<span class="pill">Écrit…</span>`;
    else if (room && p.id === room.judge && !["lobby","end"].includes(room.phase)) pill = `<span class="pill judge">Juge</span>`;
    const kick = opts.kick && p.id !== me.id ? `<button class="x" data-a="kick" data-v="${p.id}" aria-label="Retirer ${esc(p.name)}">×</button>` : "";
    const score = opts.noScore ? "" : `<b>${p.score}</b>`;
    return `<div class="pl ${p.id === me.id ? "me" : ""} ${!opts.noScore && top > 0 && p.score === top ? "top" : ""}"><span class="nm">${esc(p.name)}${p.id === me.id ? " (toi)" : ""}</span><span class="rt">${pill}${score}${kick}</span></div>`;
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

const views = {
  home(){
    const viaLink = !!urlCode && ui.codeInput === urlCode;
    return `${head()}
    <h1>Le jeu où c'est vous qui écrivez la chute.</h1>
    <p class="lead">Une carte à trous s'affiche sur tous les téléphones. Chacun la complète avec la réponse la plus drôle possible, et le juge choisit la meilleure.</p>
    ${errBox()}
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
      <span class="label">Ton des cartes</span>
      <div class="seg">${[["soft","Soft"],["mix","Mélange"],["limite","Limite"]].map(([v,l]) => `<button data-a="mode" data-v="${v}" class="${ui.mode === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <button class="btn" data-a="create">Créer la partie</button>
      <button class="ghost dark small" data-a="showCreate">Annuler</button>
    </div>` : `<button class="ghost" data-a="showCreate">Créer une partie</button>`}
    <div class="stack" style="gap:6px;opacity:.85;font-size:14px">
      <span class="label light">Comment on joue</span>
      <p>1. Quelqu'un crée la partie, les autres scannent le QR code ou tapent le code.</p>
      <p>2. Le juge pioche une carte à trous et la lit à voix haute.</p>
      <p>3. Chacun écrit sa réponse en secret sur son téléphone.</p>
      <p>4. Les réponses s'affichent sans les noms, le juge choisit sa préférée : 1 point.</p>
    </div>`;
  },

  lobby(){
    const n = players.length, missing = Math.max(0, MIN_PLAYERS - n);
    const modeLabel = { soft: "Soft", mix: "Mélange", limite: "Limite" }[room.mode];
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
      <p style="font-size:14px;opacity:.8">Partie en ${room.target} points · Cartes ${modeLabel}</p>
    </div>
    ${isLeader()
      ? `<button class="btn" data-a="start" ${missing ? "disabled" : ""}>Lancer la partie</button>
         ${missing ? `<p class="center" style="font-size:14px;opacity:.85">Encore ${missing} joueur${missing > 1 ? "s" : ""} pour lancer.</p>` : ""}`
      : wait(`${esc(nameOf(leader() && leader().id))} va lancer la partie`)}
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
    const w = writers().length, n = roundAnswers().length;
    if (isJudge()) return `${head()}
      ${blackCard()}
      <p class="lead">Lis la carte à voix haute. Les autres écrivent leur réponse.</p>
      <div class="row" style="align-items:baseline;gap:10px"><span class="counter">${n}/${w}</span><span>réponses reçues</span></div>
      ${scoreList({ status: true, noScore: true })}
      ${n === 0 ? `<button class="ghost small" data-a="draw">Changer de carte</button>` : ""}
      ${n > 0 && n < w ? `<button class="ghost small" data-a="reveal">Révéler sans attendre</button>` : ""}
      ${footer()}`;
    const mine = myAnswer();
    if (mine && !ui.editing) return `${head()}
      ${blackCard(mine.text)}
      <div class="stack center"><h2>Réponse envoyée</h2>${wait(`En attente des autres`)}</div>
      <button class="ghost small" data-a="edit">Modifier ma réponse</button>
      ${footer()}`;
    return `${head()}
      ${blackCard()}
      <div class="card stack">
        <label for="ans">Ta réponse</label>
        <textarea id="ans" maxlength="120" placeholder="Complète la carte…" enterkeyhint="send"></textarea>
        <p class="preview" id="preview" aria-live="polite"></p>
        <button class="btn" data-a="send" id="send" disabled>Envoyer</button>
      </div>
      <p style="font-size:14px;opacity:.85">Le juge ne saura pas qui a écrit quoi avant d'avoir choisi.</p>
      ${footer()}`;
  },

  judging(){
    const list = seededShuffle(roundAnswers(), code + ":" + room.round);
    const judge = isJudge();
    return `${head()}
      <h2>${judge ? "Choisis la meilleure carte" : `${esc(nameOf(room.judge))} choisit la meilleure`}</h2>
      ${judge ? `<p class="lead">Lis-les à voix haute, touche ta préférée puis valide.</p>` : ""}
      <div class="answers">${list.map((a, k) => `<button class="answer ${ui.sel === a.id ? "sel" : ""}" data-a="pick" data-v="${a.id}" ${judge ? "" : "disabled style=\"opacity:1;cursor:default\""}><span class="num">Carte ${k + 1}</span>${fill(room.card, a.text)}</button>`).join("") || `<p>Personne n'a répondu.</p>`}</div>
      ${judge ? `<button class="btn" data-a="confirmPick" ${ui.sel ? "" : "disabled"}>Valider ce choix</button>` : wait("Suspense")}
      ${footer()}`;
  },

  result(){
    const list = seededShuffle(roundAnswers(), code + ":" + room.round);
    const win = list.find(a => a.id === room.winner);
    const others = list.filter(a => a.id !== room.winner);
    const over = maxScore() >= room.target;
    const canNext = isJudge() || isLeader() || (room.judge && !byId(room.judge));
    return `${head()}
      <p class="lead">Gagnant de la manche</p>
      <div class="big-name pop">${win ? esc(nameOf(win.player)) : "Personne"}</div>
      ${win ? `<div class="answer win pop">${fill(room.card, win.text)}</div>` : ""}
      ${scoreList()}
      ${canNext ? `<button class="btn" data-a="next">${over ? "Voir le classement final" : "Manche suivante"}</button>` : wait(`${esc(nameOf(room.judge))} lance la suite`)}
      ${others.length ? `<div class="stack"><span class="label light">Les autres cartes</span><div class="answers">${others.map(a => `<div class="answer" style="font-size:18px">${fill(room.card, a.text)}<span class="by">${esc(nameOf(a.player))}</span></div>`).join("")}</div></div>` : ""}
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
      ${isLeader() ? `<button class="btn" data-a="restart">Rejouer avec les mêmes</button>` : wait(`${esc(nameOf(leader() && leader().id))} peut relancer une partie`)}
      <button class="ghost" data-a="leave">Quitter</button>`;
  }
};

/* ---------- QR code ---------- */
let qrCache = { url: "", svg: "" };
function qrSvg(url){
  if (qrCache.url === url) return qrCache.svg;
  try {
    const q = window.qrcode(0, "M"); q.addData(url); q.make();
    qrCache = { url, svg: q.createSvgTag({ scalable: true, margin: 0 }) };
  } catch(e){ qrCache = { url, svg: "" }; }
  return qrCache.svg;
}

/* ---------- rendu ---------- */
let lastHtml = "";
function render(){
  const v = !room ? "home" : room.phase;
  const html = (views[v] || views.home)();
  if (html === lastHtml) return;
  const act = document.activeElement, actId = act && act.id, s = act && act.selectionStart, e = act && act.selectionEnd;
  $("#app").innerHTML = html;
  lastHtml = html;
  const ans = $("#ans");
  if (ans){ ans.value = ui.draft; updatePreview(); }
  if (actId){ const el = document.getElementById(actId); if (el){ el.focus({ preventScroll: true }); try { if (s != null) el.setSelectionRange(s, e); } catch(x){} } }
}
function updatePreview(){
  const p = $("#preview"), b = $("#send");
  if (p) p.innerHTML = cleanAnswer(ui.draft) ? fill(room.card, ui.draft) : "";
  if (b) b.disabled = !cleanAnswer(ui.draft);
}

/* ---------- événements ---------- */
document.addEventListener("click", async ev => {
  const b = ev.target.closest("[data-a]");
  if (!b || b.disabled) return;
  const fn = actions[b.dataset.a];
  if (!fn) return;
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
  if (ev.target.id === "code" || ev.target.id === "name"){ ev.preventDefault(); actions.join(); }
  if (ev.target.id === "ans" && !ev.shiftKey){ ev.preventDefault(); actions.send(); }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && code){ refresh(); keepAwake(); }
});

/* ---------- démarrage ---------- */
(async function boot(){
  const saved = store.get("room");
  const target = urlCode || saved;
  if (saved && (!urlCode || urlCode === saved)){
    const { data } = await sb.from("players").select("id").eq("id", me.id).eq("room", saved).maybeSingle();
    if (data){ await enterRoom(saved); return; }
    store.del("room");
  }
  render();
  if (urlCode && !me.name){ const n = $("#name"); if (n) n.focus(); }
  void target;
})();
})();
