"use strict";
// A4 (specs/010-updateorder-numerotation) : un numéro FA/CN réservé au compteur atomique (moteur SQL,
// lib/billing.js) n'est jamais perdu sans trace. Refus de validation, rejeu idempotent et stock
// illisible ne consomment aucun numéro ; un numéro réservé puis non écrit est rendu au compteur
// (refus certain) ou expliqué au journal d'audit (« Nummer vervallen »).
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY; // e-mails inertes

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const bill = require(path.join(ROOT, "lib", "billing.js"));
const CN = require(path.join(ROOT, "lib", "creditnota.js"));

const YEAR = auth.brusselsYear();
const pad = (n) => String(n).padStart(4, "0");
const cnr = (n) => "CN-" + YEAR + "-" + pad(n);
const fnr = (n) => "FA-" + YEAR + "-" + pad(n);
const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; }
// Une « instance » Vercel neuve : le point d'entrée ET ses modules (lib/commande/) rechargés.
const COMMANDE_DIR = path.join(ROOT, "lib", "commande") + path.sep;
const inst = () => {
  const p = path.join(ROOT, "api", "updateorder.js");
  delete require.cache[require.resolve(p)];
  Object.keys(require.cache).filter((k) => k.startsWith(COMMANDE_DIR)).forEach((k) => { delete require.cache[k]; });
  return require(p);
};
const go = async (h, body, role) => { const res = mkRes(); await h({ method: "POST", body, headers: cookie(role || "admin"), query: {} }, res); return res; };
const call = (body, role) => go(require(path.join(ROOT, "api", "updateorder.js")), body, role);
const credit = (id, cn) => call({ id, creditnota: Object.assign({ motif: "beschadigd" }, cn) });
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fieldsOf = async (id) => (await store().get("Commandes", id)).fields;
const vervallen = async () => (await store().list("Journaal")).map((r) => r.fields).filter((f) => f.Actie === "Nummer vervallen");

const FACT = (id, extra) => rec(id, Object.assign({
  "Référence": "CMD-" + YEAR + "-" + id.slice(-4), Date: new Date().toISOString().slice(0, 10), Statut: "Facturée", "Livraison confirmée": true,
  Factuurnummer: "FA-" + YEAR + "-" + id.slice(-4), "Facturée le": new Date().toISOString(), Client: ["recCLA"],
  "Lignes (produits / quantités)": "Tong × 2 kg [€16.00]\nSaus × 3 pièce [€5.00]", Total: 47, "BTW per lijn": JSON.stringify({ tong: 6, saus: 21 })
}, extra || {}));
const SORTIE = (id) => rec(id, { "Référence": "CMD-" + YEAR + "-" + id.slice(-4), Date: new Date().toISOString().slice(0, 10), Statut: "Sortie en livraison", "Préparation validée": true, Client: ["recCLA"], "Lignes (produits / quantités)": "Tong × 1 kg [€16.00]", Total: 16 });

async function seed(orders, stock) {
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6, Facturatie: "Portaal" })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 16, "Unité": "kg", Actif: true, "BTW-tarief": 6 }), rec("recP2", { Produit: "Saus", "Prix de base": 5, "Unité": "pièce", Actif: true, "BTW-tarief": 21 })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Taal: "NL" })]);
  await store().replaceAll("Commandes", orders || []);
  await store().replaceAll("Compteurs", []);
  await store().replaceAll("Stock", stock || []);
  await store().replaceAll("Mouvements de stock", []);
  await store().replaceAll("Journaal", []);
}
// Réponse du moteur remplacée pour UNE requête (méthode + morceau d'URL), le reste passe.
async function withEngineFault(method, urlPart, reply, fn) {
  const eng = ds.state.engine, orig = eng.handle;
  let armed = true;
  eng.handle = async function (m, url, body) {
    if (armed && String(m || "GET").toUpperCase() === method && String(url).includes(urlPart)) { armed = false; return reply; }
    return orig.call(this, m, url, body);
  };
  try { return await fn(); } finally { eng.handle = orig; }
}

test("billing.release : rend le dernier numéro seulement si personne n'en a pris depuis", async () => {
  await seed();
  assert.equal(await bill.reserve("FA-2031", 4), 5);
  assert.equal(await bill.reserve("FA-2031", 4), 6);
  assert.equal(await bill.release("FA-2031", 5), false, "6 est déjà pris : 5 ne peut plus être rendu");
  assert.equal(await bill.release("FA-2031", 6), true);
  assert.equal(await bill.reserve("FA-2031", 4), 6, "le numéro rendu est resservi : aucun trou");
  assert.equal(await bill.release("FA-2099", 1), false, "série inconnue : rien");
});

test("creditnota : 409 plafond (deux appareils) ne consomme aucun numéro", async () => {
  await seed([FACT("recORD0001")]);
  const [x, y] = await Promise.all([
    go(inst(), { id: "recORD0001", creditnota: { motif: "a-kant", lignes: "Tong × 1.5 kg", sleutel: "c1" } }),
    go(inst(), { id: "recORD0001", creditnota: { motif: "b-kant", lignes: "Tong × 1 kg", sleutel: "c2" } })
  ]);
  assert.deepStrictEqual([x.statusCode, y.statusCode].sort(), [200, 409], JSON.stringify([x.payload, y.payload]));
  assert.equal([x, y].find((r) => r.statusCode === 200).payload.creditnota.nummer, cnr(1));
  const next = await credit("recORD0001", { lignes: "Saus × 1", sleutel: "c3" });
  assert.equal(next.statusCode, 200, JSON.stringify(next.payload));
  assert.equal(next.payload.creditnota.nummer, cnr(2), "le refus n'a consommé aucun numéro");
  assert.deepStrictEqual(await vervallen(), [], "rien à expliquer : aucun trou");
});

test("creditnota : rejeu idempotent simultané (même sleutel, deux instances) ne consomme aucun numéro", async () => {
  await seed([FACT("recORD0002")]);
  const body = { id: "recORD0002", creditnota: { motif: "dubbel", lignes: "Tong × 1 kg", sleutel: "zelfde" } };
  const [x, y] = await Promise.all([go(inst(), body), go(inst(), body)]);
  assert.equal(x.statusCode, 200, JSON.stringify(x.payload)); assert.equal(y.statusCode, 200, JSON.stringify(y.payload));
  assert.equal([x, y].filter((r) => r.payload.al).length, 1, "une seule note créée, l'autre réponse la rend");
  assert.equal(x.payload.creditnota.nummer, y.payload.creditnota.nummer);
  assert.equal(CN.list(await fieldsOf("recORD0002")).length, 1);
  const next = await credit("recORD0002", { lignes: "Saus × 1", sleutel: "ander" });
  assert.equal(next.payload.creditnota.nummer, cnr(2), "le rejeu n'a consommé aucun numéro");
  assert.deepStrictEqual(await vervallen(), []);
});

test("creditnota : stock illisible (retour en stock) → refus AVANT la réservation du numéro", async () => {
  await seed([FACT("recORD0003")], [rec("recSTK1", { Produit: "Tong", "Quantité disponible": 4 })]);
  const r = await withEngineFault("GET", "/Stock", { status: 400, json: { error: { type: "KAPOT", message: "Voorraad onleesbaar" } } },
    () => credit("recORD0003", { lignes: "Tong × 1 kg", retourStock: true, sleutel: "s1" }));
  assert.equal(r.statusCode, 500, JSON.stringify(r.payload));
  assert.equal(CN.list(await fieldsOf("recORD0003")).length, 0);
  const next = await credit("recORD0003", { lignes: "Tong × 1 kg", retourStock: true, sleutel: "s2" });
  assert.equal(next.statusCode, 200, JSON.stringify(next.payload));
  assert.equal(next.payload.creditnota.nummer, cnr(1), "aucun numéro consommé par le refus");
  assert.equal((await store().get("Stock", "recSTK1")).fields["Quantité disponible"], 5);
});

test("creditnota : refus après réservation, un autre appareil a pris le numéro suivant → « Nummer vervallen » au journal", async () => {
  await seed([FACT("recORD0004")]);
  const s = store(), orig = s.update;
  let armed = true;
  // L'autre appareil réserve CN-2 et écrit sa note (toute la tong) juste avant notre écriture : notre
  // relecture dépasse le plafond (409) et CN-1 ne peut plus être rendu (CN-2 existe).
  s.update = async function (tbl, id, fields, version) {
    if (armed && tbl === "Commandes" && id === "recORD0004") {
      armed = false;
      const other = await bill.reserve("CN-" + YEAR, 0);
      const cur = await s.get("Commandes", id);
      await orig.call(s, "Commandes", id, Object.assign({}, cur.fields, CN.patchFor(cur.fields, { nummer: cnr(other), lignes: "Tong × 2 kg [€16.00]", montant: 32, le: new Date().toISOString(), motif: "ander toestel" })), cur.version);
    }
    return orig.call(s, tbl, id, fields, version);
  };
  let r;
  try { r = await credit("recORD0004", { lignes: "Tong × 1 kg", sleutel: "laat" }); } finally { s.update = orig; }
  assert.equal(r.statusCode, 409, JSON.stringify(r.payload));
  assert.deepStrictEqual(CN.list(await fieldsOf("recORD0004")).map((n) => n.nummer), [cnr(2)]);
  const v = await vervallen();
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].Object, "Commandes"); assert.equal(v[0].Record, "recORD0004"); assert.equal(v[0].Referentie, "CMD-" + YEAR + "-0004");
  assert.deepStrictEqual(JSON.parse(v[0].Wijzigingen), [{ veld: "Creditnota nummer", voor: cnr(1), na: "niet gebruikt" }]);
  assert.match(v[0].Reden, /geweigerd/i); assert.equal(v[0].Wie, "beheerder");
});

test("facture : écriture en échec après la réservation → « Nummer vervallen » au journal, numéro suivant ensuite", async () => {
  await seed([SORTIE("recORD0005")]);
  const body = { id: "recORD0005", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" };
  const r = await withEngineFault("PATCH", "/Commandes/recORD0005", { status: 500, json: { error: { type: "SERVER_ERROR", message: "schijf vol" } } },
    () => call(body, "staff"));
  assert.equal(r.statusCode, 500, JSON.stringify(r.payload));
  assert.equal((await fieldsOf("recORD0005")).Factuurnummer, undefined);
  const v = await vervallen();
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.deepStrictEqual(JSON.parse(v[0].Wijzigingen), [{ veld: "Factuurnummer", voor: fnr(1), na: "niet gebruikt" }]);
  assert.equal(v[0].Record, "recORD0005"); assert.equal(v[0].Referentie, "CMD-" + YEAR + "-0005"); assert.equal(v[0].Wie, "personeel");
  assert.match(v[0].Reden, /mislukt/); assert.ok(!/schijf vol/.test(v[0].Reden), "jamais le message brut de la base dans le journal");
  const again = await call(body, "staff");
  assert.equal(again.statusCode, 200, JSON.stringify(again.payload));
  assert.equal(again.payload.factuurnummer, fnr(2), "FA-1 n'est jamais réattribué (écriture peut-être faite) ; le trou est expliqué");
});

test("facture : refus de validation (réception non confirmée, régime illisible) → aucun numéro réservé", async () => {
  await seed([SORTIE("recORD0006")]);
  let r = await call({ id: "recORD0006", statut: "Facturée" }, "staff");
  assert.equal(r.statusCode, 409);
  r = await call({ id: "recORD0006", statut: "Facturée", deliveryConfirmed: true, recipient: "  " }, "staff");
  assert.equal(r.statusCode, 400);
  r = await withEngineFault("GET", "/Clients/recCLA", { status: 400, json: { error: { type: "KAPOT", message: "x" } } },
    () => call({ id: "recORD0006", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, "staff"));
  assert.equal(r.statusCode, 503, JSON.stringify(r.payload));
  r = await call({ id: "recORD0006", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, "staff");
  assert.equal(r.payload.factuurnummer, fnr(1));
  assert.deepStrictEqual(await vervallen(), []);
});
