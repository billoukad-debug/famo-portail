// Service worker de l'équipe (audit H-12) : le portail s'ouvre et reste utilisable avec un
// réseau faible (camionnette, chambre froide).
//  - Fichiers statiques versionnés (?v=…) : cache d'abord (le nom change à chaque version).
//  - Pages HTML : réseau d'abord, copie en cache en secours, sinon /offline.
//  - /api/* : JAMAIS en cache (données clients, prix, sessions). La file hors ligne des
//    confirmations de livraison est dans la page (assets/offline-queue.js), pas ici.
//  - Pushmeldingen (specs/025) : la notification envoyée par le serveur (chiffrée, { title, body, url, tag }) est
//    affichée ; la toucher ramène FAMO sur la bonne page (même origine seulement).
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

// Toujours une notification visible, même si le contenu est illisible : Safari retire l'abonnement d'un site
// qui reçoit des messages sans en montrer.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = (e.data && e.data.json()) || {}; } catch (err) { d = {}; }
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  e.waitUntil(self.registration.showNotification(str(d.title, 80) || "FAMO", {
    body: str(d.body, 200),
    tag: str(d.tag, 64) || undefined,
    icon: "/assets/icons/famo-192.png",
    data: { url: str(d.url, 300) || "/team/vandaag" }
  }));
});

// Page à ouvrir : un chemin du portail ; toute autre origine → Vandaag.
function pageUrl(u) {
  try { const x = new URL(u || "/team/vandaag", self.location.origin); if (x.origin === self.location.origin) return x.href; } catch (err) { /* adresse illisible */ }
  return new URL("/team/vandaag", self.location.origin).href;
}
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = pageUrl(e.notification.data && e.notification.data.url);
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = wins.find((c) => { try { return new URL(c.url).origin === self.location.origin; } catch (err) { return false; } });
    if (w) {
      try { await w.focus(); } catch (err) { /* déjà au premier plan */ }
      if (typeof w.navigate === "function") { try { await w.navigate(url); return; } catch (err) { /* fenêtre non contrôlée : nouvelle fenêtre */ } }
    }
    await self.clients.openWindow(url);
  })());
});
