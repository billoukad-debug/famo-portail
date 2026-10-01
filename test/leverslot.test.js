"use strict";
// D4 (specs/015-chauffeur-creneau) : heure de livraison prévue (« Leverslot ») posée par le personnel,
// validée et normalisée par le serveur, lue par le client pour SES commandes seulement.
// SQLite en mémoire ; aucun appel réseau (e-mails inertes).
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY;
global.fetch = async (url) => { throw new Error("appel réseau inattendu : " + url); };

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const lev = require(path.join(ROOT, "lib", "levering.js"));

const H = { host: "portaal.famo.test", origin: "https://portaal.famo.test", "content-type": "application/json" };
const cookie = (role) => Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) }, H);
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; }
async function call(file, body, opts) {
  const res = mkRes();
  await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || cookie("staff"), query: (opts && opts.query) || {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fieldsOf = async (id) => (await store().get("Commandes", id)).fields;
const today = new Date().toISOString().slice(0, 10);
const ORDER = (id, client, extra) => rec(id, Object.assign({ "Référence": "CMD-" + id.slice(-4), Date: today, "Date livraison souhaitée": today, Statut: "Prête", "Préparation validée": true, Client: [client], "Lignes (produits / quantités)": "Zalm × 2 kg [€12.50]", Total: 25, "Statut paiement": "En attente" }, extra || {}));

async function seed(orders) {
  const pw = ca.hashPassword("geheim123");
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6 })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Zalm", "Prix de base": 12.5, "Unité": "kg", Actif: true, "BTW-tarief": 6 })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "a", Wachtwoord: pw, Taal: "FR" }), rec("recCLB", { Nom: "Resto B", Gebruikersnaam: "b", Wachtwoord: pw })]);
  await store().replaceAll("Commandes", orders || []);
  await store().replaceAll("Compteurs", []);
  await store().replaceAll("Journaal", []);
}
const slot = (id, leverslot, role) => call("updateorder.js", { id, leverslot }, { headers: role === null ? H : cookie(role || "staff") });

test("parseSlot : deux heures normalisées, tout le reste refusé", () => {
  for (const [inp, out] of [["06:00-08:00", "06:00-08:00"], ["6:00 – 8:00", "06:00-08:00"], ["6u-8u", "06:00-08:00"], ["tussen 6u30 en 8u", "06:30-08:00"], ["entre 6h et 8h15", "06:00-08:15"], ["7.45 tot 9.00", "07:45-09:00"], ["22-23:59", "22:00-23:59"]]) {
    assert.deepStrictEqual(lev.parseSlot(inp), { value: out }, inp);
  }
  for (const empty of ["", "   ", null, undefined]) assert.deepStrictEqual(lev.parseSlot(empty), { value: null }, String(empty));
  for (const bad of ["na de middag", "08:00-06:00", "08:00-08:00", "25:00-26:00", "06:60-08:00", "06:00", "06:00-08:00\n<b>", 42, {}, "6u-8u" + " ".repeat(40) + "x"]) {
    const r = lev.parseSlot(bad);
    assert.ok(r.error && !("value" in r), "refusé : " + JSON.stringify(bad));
  }
  assert.match(lev.parseSlot("08:00-06:00").error, /einduur/i);
  assert.ok(lev.parseSlot("x".repeat(41)).error);
});

test("le personnel pose, modifie et efface le créneau ; journal « Leverslot »", async () => {
  await seed([ORDER("recORD0001", "recCLA")]);
  let r = await slot("recORD0001", "6u - 8u");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.leverslot, "06:00-08:00");
  assert.equal((await fieldsOf("recORD0001"))["Leverslot"], "06:00-08:00");
  assert.equal((await fieldsOf("recORD0001"))["Statut"], "Prête", "rien d'autre ne bouge");
  const j = (await store().list("Journaal")).map((x) => x.fields);
  assert.ok(j.some((x) => x.Actie === "Leverslot"), "action journalisée : " + JSON.stringify(j.map((x) => x.Actie)));
  r = await slot("recORD0001", "07:00-09:30");
  assert.equal((await fieldsOf("recORD0001"))["Leverslot"], "07:00-09:30");
  r = await slot("recORD0001", "");
  assert.equal(r.statusCode, 200); assert.equal(r.payload.leverslot, null);
  assert.equal((await fieldsOf("recORD0001"))["Leverslot"], undefined, "vide = effacé");
});

test("créneau invalide, commande livrée ou annulée, sans session : refusé, rien d'écrit", async () => {
  await seed([ORDER("recORD0002", "recCLA"), ORDER("recORD0003", "recCLA", { Statut: "Facturée", Factuurnummer: "FA-2026-0003", "Livraison confirmée": true }), ORDER("recORD0004", "recCLA", { Statut: "Annulée" })]);
  let r = await slot("recORD0002", "na de middag");
  assert.equal(r.statusCode, 400); assert.equal((await fieldsOf("recORD0002"))["Leverslot"], undefined);
  r = await slot("recORD0002", "09:00-07:00");
  assert.equal(r.statusCode, 400);
  r = await slot("recORD0003", "06:00-08:00");
  assert.equal(r.statusCode, 409, "déjà livrée"); assert.equal((await fieldsOf("recORD0003"))["Leverslot"], undefined);
  r = await slot("recORD0004", "06:00-08:00");
  assert.equal(r.statusCode, 409, "annulée");
  r = await slot("recORD0002", "06:00-08:00", null);
  assert.equal(r.statusCode, 401, "sans session personnel"); assert.equal((await fieldsOf("recORD0002"))["Leverslot"], undefined);
  // Le jeton d'un client n'ouvre pas /api/updateorder.
  const token = ca.issueToken({ id: "recCLA", fields: (await store().get("Clients", "recCLA")).fields });
  r = await call("updateorder.js", { id: "recORD0002", leverslot: "06:00-08:00", token }, { headers: H });
  assert.equal(r.statusCode, 401);
});

test("lecture : le personnel voit tout, le client seulement ses commandes ; export RGPD complet", async () => {
  await seed([ORDER("recORD0005", "recCLA", { Leverslot: "06:00-08:00" }), ORDER("recORD0006", "recCLB", { Leverslot: "10:00-11:00" }), ORDER("recORD0007", "recCLA")]);
  const all = await call("allorders.js", null, { method: "GET", headers: cookie("staff") });
  assert.equal(all.statusCode, 200, JSON.stringify(all.payload));
  const by = Object.fromEntries(all.payload.orders.map((o) => [o.id, o]));
  assert.equal(by.recORD0005.leverslot, "06:00-08:00"); assert.equal(by.recORD0006.leverslot, "10:00-11:00"); assert.equal(by.recORD0007.leverslot, "");
  const token = ca.issueToken({ id: "recCLA", fields: (await store().get("Clients", "recCLA")).fields });
  const mine = await call("orders.js", { token }, { headers: H });
  assert.equal(mine.statusCode, 200, JSON.stringify(mine.payload));
  assert.deepStrictEqual(mine.payload.orders.map((o) => [o.ref, o.leverslot]).sort(), [["CMD-0005", "06:00-08:00"], ["CMD-0007", ""]]);
  assert.ok(!JSON.stringify(mine.payload).includes("10:00-11:00"), "jamais le créneau d'un autre client");
  const ex = await call("onboarding.js", { action: "exportClient", id: "recCLA" }, { headers: cookie("admin") });
  assert.equal(ex.statusCode, 200, JSON.stringify(ex.payload));
  assert.ok(ex.payload.export.bestellingen.some((b) => b.Leverslot === "06:00-08:00"), "export RGPD : le créneau suit la commande");
});
