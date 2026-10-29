// Dawa : garde l'appli en cache sur le téléphone pour qu'elle s'ouvre tout de suite.
// Page d'accueil : réseau d'abord (pour avoir la dernière version), cache si le réseau traîne plus de 2,5 s.
// Scripts, styles, polices, icônes : cache d'abord, mis à jour en arrière-plan (les fichiers ont un ?v=N).
// La base Supabase n'est jamais mise en cache.
const CACHE = "dawa-v1";
const STATIC_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function save(req, res){
  if (res && (res.ok || res.type === "opaque")){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !STATIC_HOSTS.includes(url.hostname)) return;
  if (same && url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate"){
    e.respondWith((async () => {
      const net = fetch(req).then(r => save(req, r));
      const slow = new Promise(r => setTimeout(r, 2500));
      try {
        const r = await Promise.race([net, slow.then(() => null)]);
        if (r) return r;
        return (await caches.match(req, { ignoreSearch: true })) || await net;
      } catch(x){
        return (await caches.match(req, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req);
    const net = fetch(req).then(r => save(req, r)).catch(() => null);
    if (hit){ e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  })());
});
