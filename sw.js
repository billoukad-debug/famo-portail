// Service worker de l'équipe (audit H-12) : le portail s'ouvre et reste utilisable avec un
// réseau faible (camionnette, chambre froide).
//  - Fichiers statiques versionnés (?v=…) : cache d'abord (le nom change à chaque version).
//  - Pages HTML : réseau d'abord, copie en cache en secours, sinon /offline.
//  - /api/* : JAMAIS en cache (données clients, prix, sessions). La file hors ligne des
//    confirmations de livraison est dans la page (assets/offline-queue.js), pas ici.
const CACHE = "famo-static-v1";
const OFFLINE = "/offline";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // données : toujours le réseau
  if (url.searchParams.has("v") || url.pathname.startsWith("/assets/fonts/") || url.pathname.startsWith("/assets/icons/")) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req)) || (await caches.match(OFFLINE))));
  }
});
