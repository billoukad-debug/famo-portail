"use strict";
// Hors ligne (audit H-12) : file des confirmations de livraison, service worker et manifest.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const Q = require(path.join(ROOT, "assets", "offline-queue.js"));
const mem = (limit) => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { if (limit && v.length > limit) throw new Error("QuotaExceeded"); m.set(k, v); } }; };

test("file : une confirmation par commande, rejeu dans l'ordre, arrêt au premier « retry »", async () => {
  const q = Q.create(mem(), "k");
  q.add({ orderId: "recA", body: { id: "recA" } }); q.add({ orderId: "recB", body: { id: "recB" } });
  q.add({ orderId: "recA", body: { id: "recA", recipient: "2e essai" } });
  assert.equal(q.size(), 2); assert.equal(q.list()[1].body.recipient, "2e essai", "remplace, ne double pas");
  const seen = [];
  let out = await q.replay(async it => { seen.push(it.orderId); return "retry"; });
  assert.deepEqual(seen, ["recB"]); assert.equal(out.left, 2, "toujours hors ligne : rien perdu");
  out = await q.replay(async it => it.orderId === "recB" ? "ok" : "drop");
  assert.deepEqual(out, { sent: 1, dropped: 1, left: 0 });
});

test("file : stockage plein → confirmation gardée sans la photo", () => {
  const q = Q.create(mem(400), "k");
  const r = q.add({ orderId: "recA", body: { id: "recA" }, proofs: [{ soort: "foto", base64: "x".repeat(2000) }] });
  assert.equal(r.ok, true); assert.equal(r.proofsDropped, true); assert.deepEqual(q.list()[0].proofs, []);
});

test("service worker : jamais /api en cache, statiques versionnés, repli hors ligne ; manifest valide", () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)\) return;/, "les API ne passent jamais par le cache");
  assert.match(sw, /\/offline/);
  assert.ok(fs.existsSync(path.join(ROOT, "offline.html")));
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
  assert.equal(m.display, "standalone"); assert.equal(m.scope, "/");
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, i.src)), i.src);
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const h = (v.headers.find(x => x.source === "/sw.js") || {}).headers || [];
  assert.ok(h.some(x => x.key === "Cache-Control" && x.value === "no-cache"), "sw.js jamais figé en cache");
  for (const page of ["team/bestellingen.html", "team/leveringen.html", "team/bestelling.html", "team/magazijn.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(html, /rel="manifest"/, page); assert.match(html, /offline-queue\.js/, page);
  }
});
