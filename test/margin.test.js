"use strict";
// Marge et valeur du stock (audit H-05/H-06/H-11) sur le moteur SQL. Le prix d'achat reste
// réservé au beheerder : ni le personnel (api/lots), ni le client (bon, klantdoc) ne le voient.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY;

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const margin = require(path.join(ROOT, "lib", "margin.js"));
const H = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const as = (role) => Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) }, H);
function mkRes() { return { statusCode: 200, payload: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; }
async function call(file, body, opts) { const res = mkRes(); await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || as("staff"), query: (opts && opts.query) || {} }, res); return res; }
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;

const LOTS = [
  rec("recL1", { Lotnummer: "L-1", Produit: "Tong", "Ontvangen op": "2026-09-01", Aankoopprijs: 18, Actief: true }),
  rec("recL2", { Lotnummer: "L-2", Produit: "Tong", "Ontvangen op": "2026-09-20", Aankoopprijs: 21, Actief: true }),
  rec("recL3", { Lotnummer: "L-3", Produit: "Mosselen", "Ontvangen op": "2026-09-15", Actief: true })
];
const ORDERS = [
  rec("recO1", { Statut: "Facturée", "Facturée le": "2026-09-10T08:00:00Z", "Lignes (produits / quantités)": "Tong × 2 kg [€30.00]\nMosselen × 4 kg [€5.00]", Lots: JSON.stringify({ Tong: [{ id: "recL1", lotnummer: "L-1" }] }), Client: ["recC"] }),
  rec("recO2", { Statut: "Facturée", "Facturée le": "2026-09-25T08:00:00Z", "Lignes (produits / quantités)": "Tong × 1 kg [€30.00]", Client: ["recC"], "Creditnota nummer": "CN-1", "Creditnota montant": 5, "Creditnota le": "2026-09-26T08:00:00Z" }),
  rec("recO3", { Statut: "Reçue", "Lignes (produits / quantités)": "Tong × 9 kg [€30.00]", Client: ["recC"] })
];

test("compute : coût du lot livré, sinon dernier prix ; lignes sans prix d'achat à part ; stock valorisé", () => {
  const m = margin.compute({ van: "2026-01-01", tot: "2026-12-31", orders: ORDERS, lots: LOTS, catalogue: [], stock: [rec("recS", { Produit: "Tong", "Quantité disponible": 10 }), rec("recS2", { Produit: "Mosselen", "Quantité disponible": 3 })] });
  const tong = m.producten.find(x => x.produit === "Tong");
  assert.equal(tong.omzet, 90); assert.equal(tong.kost, 2 * 18 + 1 * 21, "lot L-1 pour O1, dernier prix (L-2) pour O2");
  const mos = m.producten.find(x => x.produit === "Mosselen");
  assert.equal(mos.zonderKost, 20); assert.equal(mos.pct, null, "pas de marge inventée sans prix d'achat");
  assert.equal(m.totaal.credit, 5); assert.equal(m.totaal.marge, 90 - 57 - 5);
  assert.equal(m.voorraadWaarde, 210, "10 kg × 21 € (dernier prix)"); assert.equal(m.voorraadZonderPrijs, 1);
  assert.equal(m.orders, 2, "commande non facturée ignorée");
});

test("api : marge beheerder seul ; prix d'achat invisible et non modifiable par le personnel ; jamais chez le client", async () => {
  await store().replaceAll("Lots", LOTS); await store().replaceAll("Commandes", ORDERS);
  await store().replaceAll("Catalogue", []); await store().replaceAll("Stock", []);
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO" })]);
  assert.equal((await call("marge.js", null, { method: "GET" })).statusCode, 401);
  const a = await call("marge.js", null, { method: "GET", headers: as("admin"), query: { van: "2026-09-01", tot: "2026-09-30" } });
  assert.equal(a.statusCode, 200); assert.equal(a.payload.totaal.kost, 57);
  const s = await call("lots.js", null, { method: "GET" });
  assert.ok(s.payload.lots.every(l => !("aankoopprijs" in l)), "personnel : pas de prix d'achat");
  const ad = await call("lots.js", null, { method: "GET", headers: as("admin") });
  assert.equal(ad.payload.lots.find(l => l.id === "recL2").aankoopprijs, 21);
  // Le personnel modifie un lot : le prix d'achat existant n'est pas touché, même s'il en envoie un.
  const up = await call("lots.js", { id: "recL2", lotnummer: "L-2", produit: "Tong", aankoopprijs: 1 });
  assert.equal(up.statusCode, 200, JSON.stringify(up.payload));
  assert.equal((await store().get("Lots", "recL2")).fields.Aankoopprijs, 21);
  assert.equal((await call("lots.js", { lotnummer: "L-9", produit: "Tong", aankoopprijs: -3 }, { headers: as("admin") })).statusCode, 400);
  // L'instantané copié dans la commande (bon de livraison, portail client) ne contient pas de prix d'achat.
  const snap = require(path.join(ROOT, "lib", "trace.js")).snapshot(await store().get("Lots", "recL2"));
  assert.ok(!JSON.stringify(snap).includes("21") && !("aankoopprijs" in snap));
});
