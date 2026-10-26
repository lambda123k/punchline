// Faux backend Supabase pour tester Punchline en local (reproduit les fonctions SQL)
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const ROOT = process.argv[2], PORT = +process.argv[3] || 8787;
const db = { rooms: [], players: [], answers: [], votes: [], card_ratings: [], reactions: [], rankings: [] };
let version = 0, broadcasts = [];
const now = () => new Date().toISOString();
const isBot = id => String(id).startsWith("b07b07b0-");
const present = p => isBot(p.id) || Date.now() - Date.parse(p.last_seen) < 45000;
const keys = { rooms: ["code"], players: ["id"], answers: ["id"], votes: ["id"], card_ratings: ["card", "player"], reactions: ["id"], rankings: ["id"] };
const defaults = {
  rooms: () => ({ phase: "lobby", round: 0, judge: null, card: null, used: [], target: 5, mode: "mix", winner: null, fav: null, start_round: 1, started_at: null, writing_at: null, timer: 0, deadline: null, revealed: 0, game: "punchline", options: null, guess: null, qused: [], wrong: [], created_at: now(), updated_at: now() }),
  players: () => ({ ghost: false, score: 0, seat: 0, joined_at: now(), last_seen: now() }),
  answers: () => ({ id: crypto.randomUUID(), created_at: now(), won: false, fav: false, judge: null, secs: null, late: false }),
  reactions: () => ({ id: crypto.randomUUID(), created_at: now() }),
  votes: () => ({ id: crypto.randomUUID(), created_at: now() }),
  card_ratings: () => ({ updated_at: now() }),
  rankings: () => ({ id: crypto.randomUUID(), created_at: now() })
};
function hook(oldR, r){
  if (r.phase === "writing" && (oldR.phase !== "writing" || r.card !== oldR.card)){ r.deadline = r.timer > 0 ? new Date(Date.now() + r.timer * 1000).toISOString() : null; r.writing_at = now(); }
  else if (r.phase !== "writing") r.deadline = null;
  if (r.phase === "judging" && oldR.phase !== "judging") r.revealed = 0;
}
function match(row, filters){
  return filters.every(([op, col, val]) => op === "eq" ? String(row[col]) === String(val) : op === "in" ? val.map(String).includes(String(row[col])) : true);
}
function view(table){
  if (table !== "card_scores") return db[table];
  const m = {};
  db.card_ratings.forEach(r => { const s = m[r.card] = m[r.card] || { card: r.card, type: r.type, up: 0, down: 0 }; r.rating === 1 ? s.up++ : s.down++; });
  return Object.values(m);
}
const rpc = {
  create_room({ p_host, p_name, p_target, p_mode }){
    let c; do c = String(Math.floor(Math.random() * 10000)).padStart(4, "0"); while (db.rooms.some(r => r.code === c));
    db.rooms.push({ ...defaults.rooms(), code: c, host: p_host, target: p_target || 5, mode: p_mode });
    db.players = db.players.filter(p => p.id !== p_host);
    db.players.push({ ...defaults.players(), id: p_host, room: c, name: p_name.trim(), seat: 0 });
    return c;
  },
  join_room({ p_code, p_player, p_name }){
    if (!db.rooms.some(r => r.code === p_code)) return "no_room";
    if (db.players.some(p => p.room === p_code && p.id !== p_player && p.name.toLowerCase() === p_name.trim().toLowerCase())) return "name_taken";
    const ex = db.players.find(p => p.id === p_player);
    if (ex && ex.room === p_code){ ex.name = p_name.trim(); return "ok"; }
    const s = Math.max(-1, ...db.players.filter(p => p.room === p_code).map(p => p.seat)) + 1;
    db.players = db.players.filter(p => p.id !== p_player);
    db.players.push({ ...defaults.players(), id: p_player, room: p_code, name: p_name.trim(), seat: s });
    return "ok";
  },
  ping({ p_player, p_room }){
    const p = db.players.find(x => x.id === p_player && x.room === p_room);
    const r = db.rooms.find(x => x.code === p_room);
    if (p){ if (Date.now() - Date.parse(p.last_seen) > 45000 && r && !["lobby", "end"].includes(r.phase)) p.ghost = true; p.last_seen = now(); }
    return now();
  },
  pick_winner({ p_code, p_answer }){
    const r = db.rooms.find(x => x.code === p_code); if (!r || r.phase !== "judging") return null;
    const a = db.answers.find(x => x.id === p_answer && x.room === p_code && x.round === r.round); if (!a) return null;
    db.players.find(p => p.id === a.player).score++;
    const n = {};
    db.votes.filter(v => v.room === p_code && v.round === r.round).forEach(v => {
      const an = db.answers.find(x => x.id === v.answer && x.room === p_code && x.round === r.round);
      if (an && an.player !== v.voter && v.voter !== r.judge) n[an.id] = (n[an.id] || 0) + 1;
    });
    const s = Object.entries(n).sort((x, y) => y[1] - x[1]);
    let f = null;
    if (s.length && (s.length === 1 || s[0][1] > s[1][1])){ f = s[0][0]; const fa = db.answers.find(x => x.id === f); const pl = db.players.find(p => p.id === fa.player); if (pl) pl.score++; }
    db.answers.filter(x => x.room === p_code && x.round === r.round).forEach(x => { x.won = x.id === p_answer; x.fav = x.id === f; x.judge = r.judge; });
    const old = { ...r }; Object.assign(r, { winner: p_answer, fav: f, phase: "result", updated_at: now() }); hook(old, r);
    return null;
  },
  next_round({ p_code, p_from }){
    const r = db.rooms.find(x => x.code === p_code);
    if (!r || r.round !== p_from || ["lobby", "end"].includes(r.phase)) return null;
    const ps = db.players.filter(p => p.room === p_code).sort((a, b) => a.seat - b.seat);
    let nj = null;
    if (r.winner && r.game === "punchline"){ const a = db.answers.find(x => x.id === r.winner); const p = a && ps.find(x => x.id === a.player && present(x)); if (p) nj = p.id; }
    if (!nj){
      const js = (ps.find(p => p.id === r.judge) || {}).seat; const j = js == null ? -1 : js;
      nj = (ps.find(p => p.seat > j && present(p)) || ps.find(present) || ps[0] || {}).id || null;
    }
    const old = { ...r }; Object.assign(r, { phase: "draw", round: r.round + 1, judge: nj, card: null, winner: null, fav: null, options: null, guess: null, wrong: [], updated_at: now() }); hook(old, r);
    return null;
  },
  guess_question({ p_code, p_guess }){
    const r = db.rooms.find(x => x.code === p_code);
    if (!r || r.game !== "qui" || r.phase !== "judging") return null;
    r.wrong = r.wrong || [];
    if (p_guess != null && r.wrong.includes(p_guess)) return null;
    const tries = r.wrong.length + 1;
    if (p_guess != null && p_guess === r.card){
      const j = db.players.find(p => p.id === r.judge && p.room === p_code); if (j) j.score += Math.max(0, 4 - tries);
    } else if (tries < 3 && p_guess != null){ r.wrong = r.wrong.concat([p_guess]); r.updated_at = now(); return null; }
    const ks = db.rankings.filter(k => k.room === p_code && k.round === r.round && db.players.some(p => p.id === k.player && p.room === p_code));
    const sum = {}, cnt = {};
    ks.forEach(k => k.ranking.forEach((id, i) => { sum[id] = (sum[id] || 0) + i + 1; cnt[id] = (cnt[id] || 0) + 1; }));
    const avg = Object.keys(sum).map(id => [id, sum[id] / cnt[id]]);
    if (avg.length){ const best = Math.min(...avg.map(x => x[1])), tops = avg.filter(x => x[1] === best).map(x => x[0]);
      ks.filter(k => tops.includes(k.ranking[0])).forEach(k => { const p = db.players.find(x => x.id === k.player && x.room === p_code); if (p) p.score++; }); }
    const old = { ...r };
    Object.assign(r, { guess: p_guess == null ? "" : p_guess, wrong: p_guess != null && p_guess !== r.card ? r.wrong.concat([p_guess]) : r.wrong, phase: "result", updated_at: now() }); hook(old, r);
    return null;
  },
  restart_room({ p_code }){
    db.players.filter(p => p.room === p_code).forEach(p => { p.score = 0; p.ghost = false; });
    const r = db.rooms.find(x => x.code === p_code); const old = { ...r };
    Object.assign(r, { phase: "lobby", judge: null, card: null, winner: null, fav: null, used: [], options: null, guess: null, wrong: [], updated_at: now() }); hook(old, r);
    return null;
  }
};
function query(q){
  const t = q.table;
  if (q.action === "select"){
    let rows = view(t).filter(r => match(r, q.filters));
    if (q.order) rows = rows.slice().sort((a, b) => a[q.order] - b[q.order]);
    if (q.single) return rows[0] || null;
    return rows.map(r => ({ ...r }));
  }
  if (q.action === "update"){
    db[t].filter(r => match(r, q.filters)).forEach(r => { const old = { ...r }; Object.assign(r, q.values); if (t === "rooms") hook(old, r); });
    return null;
  }
  if (q.action === "delete"){ db[t] = db[t].filter(r => !match(r, q.filters)); return null; }
  const timing = (row, isNew) => {
    if (t !== "answers") return;
    const r = db.rooms.find(x => x.code === row.room) || {};
    if (isNew) row.secs = r.writing_at ? (Date.now() - Date.parse(r.writing_at)) / 1000 : null;
    row.late = !!r.deadline && Date.now() > Date.parse(r.deadline) - 3000;
  };
  if (q.action === "upsert" || q.action === "insert"){
    const conf = q.onConflict ? q.onConflict.split(",") : keys[t];
    [].concat(q.values).forEach(v => {
      const ex = db[t].find(r => conf.every(k => String(r[k]) === String(v[k])));
      if (ex && q.action === "upsert"){ Object.assign(ex, v); timing(ex, false); } else { const row = { ...defaults[t](), ...v }; timing(row, true); db[t].push(row); }
    });
    return null;
  }
}
const mime = { ".html": "text/html", ".js": "application/javascript", ".png": "image/png", ".json": "application/json" };
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "POST"){
    let body = ""; req.on("data", d => body += d); req.on("end", () => {
      const b = JSON.parse(body || "{}"); let out = null;
      try {
        if (u.pathname === "/api/rpc"){ out = rpc[b.name](b.args); version++; }
        else if (u.pathname === "/api/q"){ out = query(b); if (b.action !== "select") version++; }
        else if (u.pathname === "/api/bc"){ broadcasts.push({ id: broadcasts.length + 1, ch: b.ch, from: b.from, payload: b.payload }); }
        else if (u.pathname === "/api/admin"){ out = new Function("db", b.code)(db); version++; }
        res.end(JSON.stringify({ data: out }));
      } catch(e){ res.end(JSON.stringify({ error: { message: String(e) } })); }
    });
    return;
  }
  if (u.pathname === "/api/poll"){ res.end(JSON.stringify({ version, bc: broadcasts.filter(x => x.id > +u.searchParams.get("since") && x.ch === u.searchParams.get("ch")) })); return; }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  fs.readFile(f, (e, d) => { if (e){ res.statusCode = 404; res.end(); return; } res.setHeader("content-type", mime[path.extname(f)] || "text/plain"); res.end(d); });
}).listen(PORT, () => console.log("mock on " + PORT));
