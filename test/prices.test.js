const test = require("node:test");
const assert = require("node:assert");
const P = require("../lib/prices");

// Prix à période (audit H-07) : action / prix de la semaine prioritaire pendant sa période.
const R = [
  { fields: { Client: ["recC"], Produit: ["recP"], "Prix négocié": 10 } },
  { fields: { Client: ["recC"], Produit: ["recP"], "Prix négocié": 8, "Geldig van": "2026-09-28", "Geldig tot": "2026-10-04" } },
  { fields: { Client: ["recC"], Produit: ["recP"], "Prix négocié": 7.5, "Geldig van": "2026-10-01", "Geldig tot": "2026-10-02" } },
  { fields: { Client: ["recAutre"], Produit: ["recP"], "Prix négocié": 1, "Geldig van": "2026-01-01" } }
];

test("prix permanent hors période, prix de période pendant, la période la plus récente gagne", () => {
  assert.equal(P.negotiatedFor(R, "recC", "2026-09-27").get("recP"), 10);
  assert.equal(P.negotiatedFor(R, "recC", "2026-09-28").get("recP"), 8, "van inclus");
  assert.equal(P.negotiatedFor(R, "recC", "2026-10-01").get("recP"), 7.5, "chevauchement : van le plus récent");
  assert.equal(P.negotiatedFor(R, "recC", "2026-10-04").get("recP"), 8, "tot inclus");
  assert.equal(P.negotiatedFor(R, "recC", "2026-10-05").get("recP"), 10);
});

test("sans prix permanent : base du catalogue hors période ; autre client jamais appliqué", () => {
  const only = R.slice(1, 2);
  assert.equal(P.negotiatedFor(only, "recC", "2026-09-01").has("recP"), false);
  assert.equal(P.unitPrice({ id: "recP", fields: { "Prix de base": 12 } }, P.negotiatedFor(only, "recC", "2026-09-01")), 12);
  assert.equal(P.negotiatedFor(R, "recC", "2026-09-30").get("recP"), 8);
  assert.equal(P.negotiatedFor(R, "recAutre", "2026-09-30").get("recP"), 1);
});

test("jour par défaut = aujourd'hui (Bruxelles), dates invalides ignorées", () => {
  const today = require("../lib/levering").brusselsToday();
  const r = [{ fields: { Client: ["c"], Produit: ["p"], "Prix négocié": 3, "Geldig van": today, "Geldig tot": today } }, { fields: { Client: ["c"], Produit: ["p"], "Prix négocié": 4 } }];
  assert.equal(P.negotiatedFor(r, "c").get("p"), 3);
  assert.deepEqual(P.periodOf({ "Geldig van": "31/12/2026", "Geldig tot": "" }), { van: "", tot: "" });
});

// Enregistrement depuis Beheer sur le moteur SQL : un prix de période s'ajoute À CÔTÉ du prix
// permanent (la grille ne l'écrase pas) et le catalogue client applique la bonne valeur.
test("savePrice avec période : enregistrement séparé, grille intacte, dates contrôlées", async () => {
  process.env.DB_BACKEND = "sqlite"; process.env.DB_SQLITE_FILE = ":memory:";
  process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code"; process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
  const path = require("path"), ROOT = path.join(__dirname, "..");
  const ds = require(path.join(ROOT, "lib", "datastore.js")), auth = require(path.join(ROOT, "lib", "staffauth.js"));
  const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
  await ds.state.store.replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO" })]);
  await ds.state.store.replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 30, "Unité": "kg", Actif: true })]);
  await ds.state.store.replaceAll("Clients", [rec("recCLA", { Nom: "Resto A" })]);
  await ds.state.store.replaceAll("Prix négociés", []);
  const headers = { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, "admin")), origin: "http://localhost", "content-type": "application/json" };
  const post = async (body) => { const res = { statusCode: 200, payload: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; await require(path.join(ROOT, "api", "onboarding.js"))({ method: "POST", body, headers, query: {} }, res); return res; };
  assert.equal((await post({ action: "savePrice", clientId: "recCLA", productId: "recP1", prix: 28 })).statusCode, 200);
  const today = require("../lib/levering").brusselsToday();
  assert.equal((await post({ action: "savePrice", clientId: "recCLA", productId: "recP1", prix: 25, van: today, tot: "2000-01-01" })).statusCode, 400, "tot < van");
  assert.equal((await post({ action: "savePrice", clientId: "recCLA", productId: "recP1", prix: 25, van: "demain" })).statusCode, 400);
  const ok = await post({ action: "savePrice", clientId: "recCLA", productId: "recP1", prix: 25, van: today, tot: today });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload));
  // La grille (prix permanents) met à jour le permanent, jamais le prix de période.
  assert.equal((await post({ action: "saveClientPrices", clientId: "recCLA", prices: [{ productId: "recP1", prix: 27 }] })).statusCode, 200);
  const rows = await ds.state.store.list("Prix négociés");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.fields["Prix négocié"]).sort(), [25, 27]);
  assert.equal(P.negotiatedFor(rows, "recCLA").get("recP1"), 25, "aujourd'hui : prix de période");
});
