// Remplace supabase-js dans le navigateur de test
(function(){
  const post = (p, b) => fetch(p, { method: "POST", body: JSON.stringify(b) }).then(r => r.json()).catch(e => ({ error: { message: String(e) } })).then(j => ({ data: j.data === undefined ? null : j.data, error: j.error || null }));
  function builder(table){
    const q = { table, action: "select", filters: [], values: null };
    const b = {
      select(){ if (q.action !== "select") return b; q.action = "select"; return b; },
      eq(c, v){ q.filters.push(["eq", c, v]); return b; },
      in(c, v){ q.filters.push(["in", c, v]); return b; },
      order(c){ q.order = c; return b; },
      maybeSingle(){ q.single = true; return b; },
      update(v){ q.action = "update"; q.values = v; return b; },
      upsert(v, o){ q.action = "upsert"; q.values = v; q.onConflict = o && o.onConflict; return b; },
      insert(v){ q.action = "insert"; q.values = v; return b; },
      delete(){ q.action = "delete"; return b; },
      then(res, rej){ return post("/api/q", q).then(res, rej); }
    };
    return b;
  }
  const me = Math.random().toString(36).slice(2);
  window.supabase = { createClient(){
    return {
      from: builder,
      rpc: (name, args) => post("/api/rpc", { name, args }),
      channel(name){
        const h = { pg: [], bc: {} }; let timer = null, since = 0, ver = -1;
        const ch = {
          on(type, filt, fn){ if (type === "broadcast") h.bc[filt.event] = fn; else h.pg.push(fn); return ch; },
          subscribe(){
            fetch("/api/poll?ch=" + name + "&since=999999").then(r => r.json()).then(j => { ver = j.version; }).catch(() => {});
            timer = setInterval(async () => {
              const j = await fetch("/api/poll?ch=" + encodeURIComponent(name) + "&since=" + since).then(r => r.json()).catch(() => null);
              if (!j) return;
              j.bc.forEach(m => { since = Math.max(since, m.id); if (m.from !== me && h.bc[m.payload.event]) h.bc[m.payload.event]({ payload: m.payload.payload }); });
              if (j.version !== ver){ ver = j.version; h.pg.forEach(f => f({ eventType: "*" })); }
            }, 300);
            return ch;
          },
          send(m){ return post("/api/bc", { ch: name, from: me, payload: { event: m.event, payload: m.payload } }); },
          _stop(){ clearInterval(timer); }
        };
        return ch;
      },
      removeChannel(ch){ ch._stop(); }
    };
  } };
})();
