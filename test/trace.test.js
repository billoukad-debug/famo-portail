"use strict";
// Traçabilité par lot (audit C-13) sur le moteur SQL : lot → préparation → bon de livraison → rappel.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY;

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
function mkRes() { return { statusCode: 200, payload: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; }
async function call(file, body, opts) { const res = mkRes(); await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || cookie("staff"), query: (opts && opts.query) || {} }, res); return res; }
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;

async function seed(conf) {
  await store().replaceAll("Configuratie", [rec("recCONF", Object.assign({ Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6 }, conf || {}))]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 30, "Unité": "kg", Actif: true }), rec("recP2", { Produit: "Mosselen", "Prix de base": 5, "Unité": "kg", Actif: true })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", "Téléphone": "03 000 00 00", Email: "chef@resto.test" })]);
  await store().replaceAll("Commandes", [rec("recORD1", { "Référence": "CMD-2026-0001", Date: new Date().toISOString().slice(0, 10), Statut: "Reçue", Client: ["recCLA"], "Lignes (produits / quantités)": "Tong × 2 kg [€30.00]\nMosselen × 3 kg [€5.00]", Total: 75 })]);
  await store().replaceAll("Lots", []);
}
const LOT = { lotnummer: "L-2026-117", produit: "Tong", leverancier: "Visserij Noordzee", ontvangenOp: "2026-09-26", wetenschappelijkeNaam: "Solea solea", vangstgebied: "FAO 27 IV", vistuig: "boomkor", productiemethode: "Gevangen op zee", ontdooid: false, tht: "2026-10-01" };

test("lot : validation (numéro, produit, méthode de production)", async () => {
  await seed();
  assert.equal((await call("lots.js", Object.assign({}, LOT, { lotnummer: "" }))).statusCode, 400);
  assert.equal((await call("lots.js", Object.assign({}, LOT, { productiemethode: "Uit de lucht" }))).statusCode, 400);
  assert.equal((await call("lots.js", LOT, { headers: {} })).statusCode, 401);
});

test("préparation avec lot → instantané figé, bon de livraison avec mentions art. 35, rappel → client", async () => {
  await seed();
  const l = await call("lots.js", LOT);
  assert.equal(l.statusCode, 200, JSON.stringify(l.payload));
  const lotId = l.payload.lot.id;
  // Un lot d'un autre produit est refusé.
  assert.equal((await call("updateorder.js", { id: "recORD1", statut: "Prête", preparationValidee: true, lots: { Mosselen: lotId } })).statusCode, 400);
  const r = await call("updateorder.js", { id: "recORD1", statut: "Prête", preparationValidee: true, lots: { Tong: lotId } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const snap = JSON.parse((await store().get("Commandes", "recORD1")).fields.Lots);
  assert.equal(snap.Tong[0].lotnummer, "L-2026-117");
  // La fiche du lot change ensuite : le bon de livraison garde l'instantané.
  await call("lots.js", Object.assign({}, LOT, { id: lotId, vangstgebied: "FAO 27 VII" }));
  const o = (await call("allorders.js", null, { method: "GET" })).payload.orders[0];
  assert.equal(o.lots.Tong[0].vangstgebied, "FAO 27 IV");
  // Bon de livraison (documents.js) : lot, nom scientifique, zone, méthode, engin, THT.
  const win = { console, Intl, Date }; win.window = win; vm.createContext(win);
  for (const f of ["assets/vat.js", "staff-company.js", "documents.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), win);
  win.FamoDocuments.setCompany({ bedrijfsnaam: "FAMO Seafood" });
  const html = win.FamoDocuments.build(Object.assign({}, o, { klant: { taal: "NL" } }), "delivery");
  assert.match(html, /Lot L-2026-117 · <i>Solea solea<\/i> · FAO 27 IV · Gevangen op zee · boomkor · THT 01\/10\/2026/);
  const fr = win.FamoDocuments.build(Object.assign({}, o, { klant: { taal: "FR" } }), "delivery");
  assert.match(fr, /Pêché en mer/); assert.match(fr, /DLC 01\/10\/2026/);
  // Rappel : qui a reçu le lot ?
  const t = await call("lots.js", null, { method: "GET", query: { trace: "L-2026-117" } });
  assert.equal(t.statusCode, 200);
  assert.deepStrictEqual(t.payload.leveringen.map((x) => [x.klant, x.ref, x.telefoon]), [["Resto A", "CMD-2026-0001", "03 000 00 00"]]);
});

test("« Lots verplicht » : pas de « Klaar » sans lot pour chaque article", async () => {
  await seed({ "Lots verplicht": true });
  const l = await call("lots.js", LOT);
  const r = await call("updateorder.js", { id: "recORD1", statut: "Prête", preparationValidee: true, lots: { Tong: l.payload.lot.id } });
  assert.equal(r.statusCode, 409); assert.match(r.payload.error, /Mosselen/);
  const l2 = await call("lots.js", Object.assign({}, LOT, { lotnummer: "M-55", produit: "Mosselen", wetenschappelijkeNaam: "Mytilus edulis", productiemethode: "Gekweekt" }));
  const ok = await call("updateorder.js", { id: "recORD1", statut: "Prête", preparationValidee: true, lots: { Tong: l.payload.lot.id, Mosselen: l2.payload.lot.id } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload));
});
