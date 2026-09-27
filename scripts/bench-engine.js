#!/usr/bin/env node
// Banc de charge du moteur SQL (lib/at-engine.js) sur les vrais handlers api/*.js.
//   node scripts/bench-engine.js            -> 1 000, 10 000 et 50 000 commandes
//   node scripts/bench-engine.js 5000 20000 -> tailles au choix
// SQLite en mémoire, aucune donnée réelle, aucun réseau. Mesure /api/allorders (fenêtre
// par défaut et ?all=1), /api/orders (commandes d'un client) et /api/config?status=1.
// Postgres (Neon) ajoute la latence réseau Francfort ↔ fonction à chaque requête SQL :
// le nombre de requêtes par appel compte autant que le temps mesuré ici.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "bench-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "bench-admin-code";
process.env.AIRTABLE_TOKEN = "bench";
delete process.env.RESEND_API_KEY;
process.removeAllListeners("warning");

const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const { hashPassword } = require(path.join(ROOT, "lib", "clientauth.js"));

const STATUTS = ["Reçue", "Prête", "Sortie en livraison", "Facturée", "Facturée", "Facturée", "Facturée", "Annulée"];
const id = (p, i) => p + String(i).padStart(14, "0").slice(-14);
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function res() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = () => r;
  return r;
}
async function call(name, req) {
  const h = require(path.join(ROOT, "api", name + ".js"));
  const r = res();
  const t0 = process.hrtime.bigint();
  await h(Object.assign({ method: "GET", headers: {}, query: {}, body: null }, req), r);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.statusCode !== 200) throw new Error(name + " " + r.statusCode + " " + JSON.stringify(r.body).slice(0, 200));
  return { ms, body: r.body, bytes: Buffer.byteLength(JSON.stringify(r.body)) };
}

async function populate(n) {
  const store = ds.state.store;
  const clients = Array.from({ length: 200 }, (_, i) => ({ id: id("recCLI", i), createdTime: "2025-01-01T00:00:00.000Z", fields: { Nom: "Klant " + i, Gebruikersnaam: "klant" + i, Wachtwoord: i === 7 ? hashPassword("bench-pw-7") : "x", Email: "k" + i + "@example.test", "Lieu de livraison": "Straat " + i + ", Antwerpen" } }));
  const cat = Array.from({ length: 80 }, (_, i) => ({ id: id("recPRD", i), createdTime: "2025-01-01T00:00:00.000Z", fields: { Produit: "Product " + i, "Prix de base": 10 + i, "Unité": "kg", Actif: i % 5 !== 0 } }));
  const orders = Array.from({ length: n }, (_, i) => ({
    id: id("recORD", i), createdTime: new Date(Date.parse("2024-09-01T00:00:00Z") + i * 60000).toISOString(),
    fields: {
      "Référence": "CMD-2026-" + String(i + 1).padStart(5, "0"), Date: day(Math.floor((i * 7919) % 730)), Statut: STATUTS[i % STATUTS.length],
      "Statut paiement": i % 3 ? "Payé" : "En attente", Total: Math.round((i % 900) * 1.37 * 100) / 100, Client: [clients[i % clients.length].id],
      "Lignes (produits / quantités)": "Product " + (i % 80) + " × 3 kg [€12.00]\nProduct " + ((i + 5) % 80) + " × 1 kg [€19.50]",
      "Date livraison souhaitée": day(Math.floor((i * 7919) % 730) - 1), Notes: i % 4 ? "" : "Levering achteraan", Factuurnummer: i % 8 > 2 ? "FA-2026-" + i : ""
    }
  }));
  for (const [t, recs] of [["Clients", clients], ["Catalogue", cat], ["Commandes", orders], ["Configuratie", [{ id: "recCFG00000000000", createdTime: "2025-01-01T00:00:00.000Z", fields: { Bedrijfsnaam: "Bench" } }]], ["Stock", []], ["Prix négociés", []], ["Aanvragen", []]]) {
    await store.replaceAll(t, recs.map((r) => Object.assign({}, r, { fields: Object.fromEntries(Object.entries(r.fields).filter(([, v]) => v !== "" && v !== false)) })));
  }
}

async function main() {
  const sizes = process.argv.slice(2).map(Number).filter((x) => x > 0);
  const cookie = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin", ""));
  const rows = [];
  for (const n of sizes.length ? sizes : [1000, 10000, 50000]) {
    await populate(n);
    const eng = ds.state.engine, reads0 = eng.stats ? eng.stats.reads : NaN;
    const win = await call("allorders", { headers: { cookie } });
    const all = await call("allorders", { headers: { cookie }, query: { all: "1" } });
    const mine = await call("orders", { method: "POST", body: { user: "klant7", pw: "bench-pw-7" } });
    const st = await call("config", { headers: { cookie }, query: { status: "1" } });
    rows.push({ commandes: n, "allorders (fenêtre) ms": Math.round(win.ms), "allorders ?all=1 ms": Math.round(all.ms), "réponse all=1 Mo": +(all.bytes / 1048576).toFixed(1), "orders (client) ms": Math.round(mine.ms), "config?status=1 ms": Math.round(st.ms), "lectures de table": eng.stats ? eng.stats.reads - reads0 : "?" });
    if (all.body.orders.length !== n) throw new Error("all=1 : " + all.body.orders.length + " au lieu de " + n);
  }
  console.table(rows);
}
main().catch((e) => { console.error(e); process.exit(1); });
