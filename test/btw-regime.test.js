"use strict";
// Régime de TVA par client (audit C-10) et contrôle VIES (audit C-16) sur le moteur SQL (SQLite en
// mémoire) : validation régime ↔ numéro, facture à 0 % figée avec son régime, documents du client,
// UBL K / G / AE, contrôle VIES avec un FAUX service (aucun appel réseau réel), RGPD.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY; // e-mails inertes

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const bill = require(path.join(ROOT, "lib", "billing.js"));
const vies = require(path.join(ROOT, "lib", "vies.js"));
const vat = require(path.join(ROOT, "assets", "vat.js"));

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const H = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const hdr = (role) => Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) }, H);
function mkRes() { return { statusCode: 200, payload: null, body: "", headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, send(b) { this.body = b; return this; } }; }
let ip = 0;
async function call(file, body, opts) {
  const res = mkRes();
  await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: Object.assign({ "x-forwarded-for": "10.9.0." + (++ip % 250) }, (opts && opts.headers) || hdr("admin")), query: (opts && opts.query) || {} }, res);
  return res;
}
const ob = (body, role) => call("onboarding.js", body, { headers: hdr(role || "admin") });
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const tag = (xml, name) => { const m = new RegExp("<" + name + "(?: [^>]*)?>([^<]*)</" + name + ">").exec(xml); return m ? m[1] : null; };
const all = (xml, name) => Array.from(xml.matchAll(new RegExp("<" + name + "(?: [^>]*)?>([^<]*)</" + name + ">", "g"))).map((m) => m[1]);
const wellFormed = (xml) => { const f = path.join(os.tmpdir(), "famo-regime-test.xml"); fs.writeFileSync(f, xml); const lint = spawnSync("xmllint", ["--noout", f], { encoding: "utf8" }); if (!lint.error) assert.equal(lint.status, 0, lint.stderr); };

// Faux réseau : seules les requêtes vers VIES sont servies par `reply` ; toute autre adresse hors
// base de données fait échouer le test (aucun appel réseau réel). Le moteur SQL reste branché.
async function withNet(reply, fn) {
  const orig = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://ec.europa.eu/")) { calls.push({ url: u, init: init || {} }); return reply(u, init || {}); }
    if (!u.startsWith("https://api.airtable.com/") && !u.startsWith("https://content.airtable.com/")) throw new Error("Appel réseau interdit en test : " + u);
    return orig(url, init);
  };
  try { return await fn(calls); } finally { globalThis.fetch = orig; }
}
const viesOk = (extra) => async (u, init) => { const b = JSON.parse(init.body); return { ok: true, status: 200, json: async () => Object.assign({ countryCode: b.countryCode, vatNumber: b.vatNumber, requestDate: "2026-09-30T10:00:00.000Z", valid: true, name: "VISHANDEL MAAS B.V.", address: "MARKT 1\n6211CK MAASTRICHT" }, extra || {}) }; };

const CONF = rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "Juridische naam": "Famo Trading", Rechtsvorm: "BV", RPR: "RPR Antwerpen, afdeling Antwerpen", "BTW-nummer": "BE0788705713", Adres: "Jezusstraat 34", "Postcode en plaats": "2000 Antwerpen", IBAN: "BE71096123456769", BIC: "GKCCBEBB", "BTW-tarief": 6, "Betaaltermijn dagen": 14, Leverdagen: "ma,di,wo,do,vr,za,zo" });
const PW = ca.hashPassword("geheim-123");
const CLIENTS = () => [
  rec("recNL", { Nom: "Vishandel Maas", Gebruikersnaam: "maas", Wachtwoord: PW, "BTW-nummer": "NL123456789B01", "Régime TVA": "Intracommunautaire", Taal: "NL", "Lieu de livraison": "Markt 1\n6211 CK Maastricht" }),
  rec("recGB", { Nom: "Chippy Ltd", Gebruikersnaam: "chippy", Wachtwoord: PW, "BTW-nummer": "GB123456789", "Régime TVA": "Export", Taal: "FR", "Lieu de livraison": "1 Harbour Road\nDover CT17 9BU" }),
  rec("recBE", { Nom: "Bouw & Vis", Gebruikersnaam: "bouw", Wachtwoord: PW, "BTW-nummer": "BE0417497106", "Régime TVA": "Cocontractant", Taal: "FR", "Lieu de livraison": "Kaai 1\n2000 Antwerpen" }),
  rec("recN", { Nom: "Resto Normaal", Gebruikersnaam: "normaal", Wachtwoord: PW, "BTW-nummer": "BE0417497106", Taal: "NL", "Lieu de livraison": "Kaai 2\n2000 Antwerpen" })
];
const LINES = "Tong × 1.375 kg [€18.49]\nSaus × 2 pièce [€5.00]";
const SORTIE = (id, client, extra) => rec(id, Object.assign({ "Référence": "CMD-2026-" + id.slice(-4), Date: new Date().toISOString().slice(0, 10), Statut: "Sortie en livraison", "Préparation validée": true, Client: [client], "Lignes (produits / quantités)": LINES, Total: 35.42 }, extra || {}));
const FACT = (id, client, regime, extra) => rec(id, Object.assign({ "Référence": "CMD-2026-" + id.slice(-4), Statut: "Facturée", "Livraison confirmée": true, Factuurnummer: "FA-2026-" + id.slice(-4), "Facturée le": "2026-09-01T10:00:00.000Z", "Livrée le": "2026-09-01T09:00:00.000Z", Client: [client], "Lignes (produits / quantités)": LINES, Total: 35.42, "BTW per lijn": JSON.stringify(regime ? { tong: 0, saus: 0 } : { tong: 6, saus: 21 }) }, regime ? { "Régime TVA": regime } : {}, extra || {}));

async function seed(orders, clients) {
  await store().replaceAll("Configuratie", [CONF]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 18.49, "Unité": "kg", Actif: true, "BTW-tarief": 6 }), rec("recP2", { Produit: "Saus", "Prix de base": 5, "Unité": "pièce", Actif: true, "BTW-tarief": 21 })]);
  await store().replaceAll("Clients", clients || CLIENTS());
  await store().replaceAll("Commandes", orders || []);
  await store().replaceAll("Compteurs", []);
}
const client = async (id) => (await store().get("Clients", id)).fields;
const patchClient = async (id, fields) => { const c = await store().get("Clients", id); await store().update("Clients", id, Object.assign({}, c.fields, fields), c.version); };

// ---- Table unique des régimes (assets/vat.js) ----
test("régimes : défaut Normal, trois régimes à 0 % avec catégorie UBL, motif et mentions NL/FR", () => {
  assert.equal(vat.regime("").key, "Normal"); assert.equal(vat.regime("n'importe quoi").key, "Normal"); assert.equal(vat.regime(undefined).zero, false);
  const ic = vat.regime("intracommunautaire"), ex = vat.regime("Export"), ae = vat.regime("Cocontractant");
  assert.deepStrictEqual([ic.key, ic.zero, ic.ubl, ic.reasonCode], ["Intracommunautaire", true, "K", "VATEX-EU-IC"]);
  assert.deepStrictEqual([ex.ubl, ex.reasonCode, ae.ubl, ae.reasonCode], ["G", "VATEX-EU-G", "AE", "VATEX-EU-AE"]);
  assert.match(ic.nl, /intracommunautaire levering/); assert.match(ic.nl, /39bis/); assert.match(ic.fr, /livraison intracommunautaire/);
  assert.match(ex.nl, /uitvoer/); assert.match(ex.fr, /exportation/); assert.match(ex.fr, /art\. 39/);
  assert.match(ae.nl, /Verlegging van heffing/); assert.match(ae.fr, /Autoliquidation/); assert.match(ae.fr, /AR n° 1/);
  assert.deepStrictEqual(vat.REGIME_KEYS, ["Normal", "Intracommunautaire", "Export", "Cocontractant"]);
});

test("billing : numéros de TVA, régime figé sur une facture, taux à 0 % avant facturation", () => {
  assert.deepStrictEqual(bill.parseVat("nl 1234.567.89 b01"), { prefix: "NL", number: "123456789B01", full: "NL123456789B01", iso: "NL", eu: true });
  assert.equal(bill.parseVat("EL123456789").iso, "GR");
  assert.equal(bill.parseVat("GB123456789").eu, false);
  assert.equal(bill.parseVat("0417497106"), null);
  assert.equal(bill.beCompanyNo("BE 0417.497.106"), "0417497106"); assert.equal(bill.beCompanyNo("BE0417497107"), "");
  // Facture émise : régime de la commande (absent = Normal), jamais celui du client actuel.
  assert.equal(bill.regimeOf({ Factuurnummer: "FA-1", "Régime TVA": "Export" }, { "Régime TVA": "Normal" }), "Export");
  assert.equal(bill.regimeOf({ Factuurnummer: "FA-1" }, { "Régime TVA": "Export" }), "Normal");
  assert.equal(bill.regimeOf({}, { "Régime TVA": "Export" }), "Export");
  const lines = [{ nom: "Tong" }, { nom: "Saus" }];
  assert.deepStrictEqual(bill.linesRates(lines, null, { tong: 6, saus: 21 }, 6, "Export"), { tong: 0, saus: 0 });
  assert.deepStrictEqual(bill.linesRates(lines, null, { tong: 6, saus: 21 }, 6, "Normal"), { tong: 6, saus: 21 });
  assert.deepStrictEqual(bill.linesRates(lines, { "BTW per lijn": '{"tong":6,"saus":21}' }, {}, 6, "Export"), { tong: 6, saus: 21 }, "taux figés prioritaires");
  assert.match(bill.regimeProblem("Intracommunautaire", "BE0417497106"), /ander EU-land/);
  assert.match(bill.regimeProblem("Intracommunautaire", ""), /ander EU-land/);
  assert.match(bill.regimeProblem("Intracommunautaire", "CHE123456789"), /ander EU-land/);
  assert.equal(bill.regimeProblem("Intracommunautaire", "FR12345678901"), "");
  assert.match(bill.regimeProblem("Cocontractant", "NL123456789B01"), /Belgisch/);
  assert.match(bill.regimeProblem("Cocontractant", "BE0417497107"), /Belgisch/);
  assert.equal(bill.regimeProblem("Cocontractant", "BE 0417.497.106"), "");
  assert.equal(bill.regimeProblem("Export", ""), ""); assert.equal(bill.regimeProblem("Normal", ""), "");
});

// ---- Beheer : enregistrement du régime (US2) ----
test("saveClient : régime validé contre le n° de TVA (400 NL), Normal = champ absent", async () => {
  await seed();
  const base = { action: "saveClient", nom: "Poissons Lille", generate: false, password: "geheim-1234", sendMail: false };
  let r = await ob(Object.assign({}, base, { regime: "Intracommunautaire", btw: "BE0417497106" }));
  assert.equal(r.statusCode, 400); assert.match(r.payload.error, /ander EU-land/);
  r = await ob(Object.assign({}, base, { regime: "Intracommunautaire", btw: "" }));
  assert.equal(r.statusCode, 400);
  r = await ob(Object.assign({}, base, { regime: "Cocontractant", btw: "FR12345678901" }));
  assert.equal(r.statusCode, 400); assert.match(r.payload.error, /Belgisch/);
  r = await ob(Object.assign({}, base, { regime: "Onzin", btw: "FR12345678901" }));
  assert.equal(r.statusCode, 400); assert.match(r.payload.error, /btw-regime/i);
  assert.equal((await store().list("Clients")).length, 4, "rien n'est créé sur une erreur");
  r = await ob(Object.assign({}, base, { regime: "Intracommunautaire", btw: "FR12345678901", user: "lille" }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const id = r.payload.credentials.id;
  assert.equal((await client(id))["Régime TVA"], "Intracommunautaire");
  assert.equal(r.payload.clients.find((c) => c.id === id).regime, "Intracommunautaire");
  // Régime non envoyé (ancien onglet) : il reste, et reste contrôlé contre le nouveau numéro.
  r = await ob(Object.assign({}, base, { id, btw: "FR12345678901", user: "lille" }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload)); assert.equal((await client(id))["Régime TVA"], "Intracommunautaire");
  r = await ob(Object.assign({}, base, { id, btw: "BE0417497106", user: "lille" }));
  assert.equal(r.statusCode, 400, "régime conservé mais incompatible avec un n° belge");
  r = await ob(Object.assign({}, base, { id, regime: "Normal", btw: "FR12345678901", user: "lille" }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal((await client(id))["Régime TVA"], undefined, "Normal = champ absent");
  assert.equal(r.payload.clients.find((c) => c.id === id).regime, "Normal");
});

// ---- Facturation (US1) ----
test("facture d'un client intracommunautaire : 0 % sur chaque ligne, régime figé sur la commande", async () => {
  await seed([SORTIE("recORD0001", "recNL"), SORTIE("recORD0002", "recN")]);
  let r = await call("updateorder.js", { id: "recORD0001", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, { headers: hdr("staff") });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  let f = (await store().get("Commandes", "recORD0001")).fields;
  assert.deepStrictEqual(JSON.parse(f["BTW per lijn"]), { tong: 0, saus: 0 });
  assert.equal(f["Régime TVA"], "Intracommunautaire");
  const t = bill.orderTotals(require(path.join(ROOT, "api", "updateorder.js")).parseLines(f["Lignes (produits / quantités)"]), JSON.parse(f["BTW per lijn"]), 6);
  assert.equal(t.tva, 0); assert.equal(t.total, 35.42);
  // Client Normal : inchangé (taux du catalogue, aucun régime écrit).
  r = await call("updateorder.js", { id: "recORD0002", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, { headers: hdr("staff") });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  f = (await store().get("Commandes", "recORD0002")).fields;
  assert.deepStrictEqual(JSON.parse(f["BTW per lijn"]), { tong: 6, saus: 21 }); assert.equal(f["Régime TVA"], undefined);
});

test("facture émise : le client repasse en Normal, la facture, le document client et la liste gardent 0 %", async () => {
  await seed([SORTIE("recORD0003", "recNL")]);
  assert.equal((await call("updateorder.js", { id: "recORD0003", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, { headers: hdr("staff") })).statusCode, 200);
  await patchClient("recNL", { "Régime TVA": null });
  const list = await call("allorders.js", null, { method: "GET", headers: hdr("staff") });
  const o = list.payload.orders.find((x) => x.id === "recORD0003");
  assert.equal(o.btwRegime, "Intracommunautaire"); assert.deepStrictEqual(o.btwFrozen, { tong: 0, saus: 0 });
  assert.equal(o.klant.regime, "Normal", "le client a changé, pas la facture");
  const token = ca.issueToken({ id: "recNL", fields: await client("recNL") });
  const d = await call("klantdoc.js", { token, ref: "CMD-2026-0003" }, { headers: H });
  assert.equal(d.statusCode, 200, JSON.stringify(d.payload));
  assert.equal(d.payload.order.btwRegime, "Intracommunautaire"); assert.deepStrictEqual(d.payload.order.btwPerLine, { tong: 0, saus: 0 });
});

test("commande pas encore facturée d'un client Export : montants à 0 % partout (liste, document, portail)", async () => {
  await seed([SORTIE("recORD0004", "recGB")]);
  const list = await call("allorders.js", null, { method: "GET", headers: hdr("staff") });
  assert.equal(list.payload.orders[0].btwRegime, "Export");
  const token = ca.issueToken({ id: "recGB", fields: await client("recGB") });
  const d = await call("klantdoc.js", { token, ref: "CMD-2026-0004" }, { headers: H });
  assert.equal(d.payload.order.btwRegime, "Export"); assert.deepStrictEqual(d.payload.order.btwPerLine, { tong: 0, saus: 0 });
  const mine = await call("orders.js", { token }, { headers: H });
  assert.equal(mine.statusCode, 200, JSON.stringify(mine.payload));
  assert.equal(mine.payload.orders[0].totalIncl, 35.42, "TVAC = HTVA à 0 %");
});

test("client illisible au moment de facturer : 503 AVANT le numéro (aucun trou dans la numérotation)", async () => {
  await seed([SORTIE("recORD0005", "recNL")]);
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => (/\/Clients\/recNL$/.test(String(url)) && !(init && init.method && init.method !== "GET")
    ? { status: 403, json: async () => ({ error: { type: "INVALID_PERMISSIONS", message: "nope" } }) } : orig(url, init));
  let r;
  try { r = await call("updateorder.js", { id: "recORD0005", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, { headers: hdr("staff") }); } finally { globalThis.fetch = orig; }
  assert.equal(r.statusCode, 503); assert.match(r.payload.error, /btw-regime/i);
  assert.equal((await store().get("Commandes", "recORD0005")).fields.Factuurnummer, undefined);
  r = await call("updateorder.js", { id: "recORD0005", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, { headers: hdr("staff") });
  assert.equal(r.statusCode, 200); assert.match(r.payload.factuurnummer, /^FA-\d{4}-0001$/, "le numéro n'a pas été consommé");
});

// ---- UBL (US1) ----
const exp = (id, type) => call("export.js", null, { method: "GET", headers: hdr("admin"), query: Object.assign({ format: "ubl", id }, type ? { type } : {}) });

test("UBL intracommunautaire : catégorie K, motif VATEX-EU-IC, acheteur NL (TVA complète, 9944), pays de livraison", async () => {
  await seed([FACT("recORD0010", "recNL", "Intracommunautaire", { "Creditnota nummer": "CN-2026-0001", "Creditnota lignes": "Tong × 1 kg [€18.49]", "Creditnota montant": 18.49, "Creditnota le": "2026-09-03T08:00:00.000Z", "Creditnota motif": "Niet vers" })]);
  const r = await exp("recORD0010");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const xml = r.body;
  assert.match(xml, /<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">35\.42<\/cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">0\.00<\/cbc:TaxAmount><cac:TaxCategory><cbc:ID>K<\/cbc:ID><cbc:Percent>0<\/cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-EU-IC<\/cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Vrijgesteld van btw – intracommunautaire levering[^<]*<\/cbc:TaxExemptionReason><cac:TaxScheme><cbc:ID>VAT<\/cbc:ID><\/cac:TaxScheme><\/cac:TaxCategory><\/cac:TaxSubtotal>/);
  assert.equal((xml.match(/<cac:ClassifiedTaxCategory><cbc:ID>K<\/cbc:ID><cbc:Percent>0<\/cbc:Percent>/g) || []).length, 2, "chaque ligne en K");
  assert.ok(!/<cbc:ID>S<\/cbc:ID>/.test(xml));
  assert.deepStrictEqual(all(xml, "cbc:EndpointID"), ["0788705713", "NL123456789B01"]);
  assert.match(xml, /<cbc:EndpointID schemeID="9944">NL123456789B01<\/cbc:EndpointID>/);
  assert.match(xml, /<cac:AccountingCustomerParty>[\s\S]*<cac:PartyTaxScheme><cbc:CompanyID>NL123456789B01<\/cbc:CompanyID>/);
  assert.ok(!/<cac:AccountingCustomerParty>[\s\S]*schemeID="0208"/.test(xml), "pas de n° BCE belge pour un acheteur NL");
  assert.match(xml, /<cac:AccountingCustomerParty>[\s\S]*<cbc:PostalZone>6211 CK<\/cbc:PostalZone>[\s\S]*<cbc:IdentificationCode>NL<\/cbc:IdentificationCode>/);
  assert.match(xml, /<cac:Delivery><cbc:ActualDeliveryDate>2026-09-01<\/cbc:ActualDeliveryDate><cac:DeliveryLocation><cac:Address><cac:Country><cbc:IdentificationCode>NL<\/cbc:IdentificationCode><\/cac:Country><\/cac:Address><\/cac:DeliveryLocation><\/cac:Delivery>/);
  assert.match(tag(xml, "cbc:Note"), /^Vrijgesteld van btw – intracommunautaire levering/);
  assert.deepStrictEqual(all(xml, "cbc:TaxAmount"), ["0.00", "0.00"]);
  assert.equal(tag(xml, "cbc:PayableAmount"), "35.42");
  wellFormed(xml);
  // Note de crédit de cette facture : toujours K, 0 %, motif + mention.
  const c = await exp("recORD0010", "credit");
  assert.equal(c.statusCode, 200, JSON.stringify(c.payload));
  assert.match(c.body, /<cac:TaxCategory><cbc:ID>K<\/cbc:ID><cbc:Percent>0<\/cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-EU-IC/);
  assert.equal(tag(c.body, "cbc:PayableAmount"), "18.49");
  assert.match(tag(c.body, "cbc:Note"), /^Niet vers – Vrijgesteld van btw/);
  wellFormed(c.body);
});

test("UBL export (G, texte FR) et autoliquidation (AE) ; client Normal inchangé (S)", async () => {
  await seed([FACT("recORD0011", "recGB", "Export"), FACT("recORD0012", "recBE", "Cocontractant"), FACT("recORD0013", "recN", null)]);
  let r = await exp("recORD0011");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.match(r.body, /<cac:TaxCategory><cbc:ID>G<\/cbc:ID><cbc:Percent>0<\/cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-EU-G<\/cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Exonération de TVA – exportation/);
  assert.match(r.body, /<cbc:EndpointID schemeID="9932">GB123456789<\/cbc:EndpointID>/);
  assert.ok(!/<cac:DeliveryLocation>/.test(r.body), "pays de livraison seulement pour K");
  wellFormed(r.body);
  r = await exp("recORD0012");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.match(r.body, /<cac:TaxCategory><cbc:ID>AE<\/cbc:ID><cbc:Percent>0<\/cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-EU-AE<\/cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Autoliquidation/);
  assert.match(r.body, /<cbc:EndpointID schemeID="0208">0417497106<\/cbc:EndpointID>/);
  wellFormed(r.body);
  r = await exp("recORD0013");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.ok(!/TaxExemptionReason/.test(r.body)); assert.ok(!/<\/cbc:InvoiceTypeCode><cbc:Note>/.test(r.body), "pas de note de document (Normal)");
  assert.deepStrictEqual(all(r.body, "cbc:TaxAmount"), ["3.63", "1.53", "2.10"]);
});

test("UBL refusé avec la raison : export sans n° de TVA, pays sans adresse Peppol connue, facture K d'un client redevenu belge", async () => {
  const cl = CLIENTS();
  cl.push(rec("recX", { Nom: "Far Away", "BTW-nummer": "", "Régime TVA": "Export", "Lieu de livraison": "Somewhere" }));
  cl.push(rec("recDK", { Nom: "Fisk ApS", "BTW-nummer": "DK12345678", "Régime TVA": "Intracommunautaire", "Lieu de livraison": "Havnen 1\n8000 Aarhus" }));
  cl.push(rec("recNL2", { Nom: "Was NL", "BTW-nummer": "BE0417497106", "Lieu de livraison": "Kaai 3\n2000 Antwerpen" }));
  await seed([FACT("recORD0020", "recX", "Export"), FACT("recORD0021", "recDK", "Intracommunautaire"), FACT("recORD0022", "recNL2", "Intracommunautaire")], cl);
  let r = await exp("recORD0020");
  assert.equal(r.statusCode, 422); assert.ok(r.payload.problems.some((p) => /landcode/.test(p)), JSON.stringify(r.payload));
  r = await exp("recORD0021");
  assert.equal(r.statusCode, 422); assert.ok(r.payload.problems.some((p) => /Peppol/.test(p) && /DK/.test(p)), JSON.stringify(r.payload));
  r = await exp("recORD0022");
  assert.equal(r.statusCode, 422); assert.ok(r.payload.problems.some((p) => /ander EU-land/.test(p)), JSON.stringify(r.payload));
});

// ---- VIES (US3) ----
test("lib/vies : requête officielle, réponse normalisée, erreurs 400 / 503, délai", async () => {
  const seen = [];
  const f = async (u, init) => { seen.push({ u, init }); return viesOk({ name: "---", address: "---" })(u, init); };
  const v = await vies.check("nl 123456789b01", { fetch: f, timeoutMs: 500 });
  assert.equal(seen.length, 1); assert.equal(seen[0].u, VIES_URL);
  assert.equal(seen[0].init.method, "POST"); assert.match(seen[0].init.headers["Content-Type"], /application\/json/);
  assert.deepStrictEqual(JSON.parse(seen[0].init.body), { countryCode: "NL", vatNumber: "123456789B01" });
  assert.ok(seen[0].init.signal, "requête interruptible (délai)");
  assert.deepStrictEqual({ valid: v.valid, name: v.name, address: v.address, vatNumber: v.vatNumber }, { valid: true, name: "", address: "", vatNumber: "NL123456789B01" });
  assert.ok(Date.parse(v.checkedAt) > 0);
  assert.equal(vies.TIMEOUT_MS, 8000);
  const err = async (p) => { try { await p; } catch (e) { return e; } assert.fail("erreur attendue"); };
  let e = await err(vies.check("CHE123456789", { fetch: f }));
  assert.equal(e.status, 400); assert.equal(seen.length, 1, "pas d'appel pour un numéro hors UE");
  e = await err(vies.check("", { fetch: f })); assert.equal(e.status, 400);
  e = await err(vies.check("NL123456789B01", { fetch: async () => { throw new TypeError("fetch failed"); } }));
  assert.equal(e.status, 503); assert.match(e.message, /VIES/);
  e = await err(vies.check("NL123456789B01", { fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }));
  assert.equal(e.status, 503);
  e = await err(vies.check("NL123456789B01", { fetch: async () => ({ ok: true, status: 200, json: async () => ({ actionSucceed: false, errorWrappers: [{ error: "MS_UNAVAILABLE" }] }) }) }));
  assert.equal(e.status, 503); assert.match(e.message, /lidstaat/);
  e = await err(vies.check("NL123456789B01", { fetch: async () => ({ ok: true, status: 200, json: async () => ({ valid: false, userError: "MS_MAX_CONCURRENT_REQ" }) }) }));
  assert.equal(e.status, 503);
  const t0 = Date.now();
  e = await err(vies.check("NL123456789B01", { timeoutMs: 40, fetch: (u, init) => new Promise((_, ko) => init.signal.addEventListener("abort", () => ko(Object.assign(new Error("aborted"), { name: "AbortError" })))) }));
  assert.equal(e.status, 503); assert.match(e.message, /op tijd/); assert.ok(Date.now() - t0 < 2000);
  const inv = await vies.check("EL123456789", { fetch: async (u, init) => { assert.equal(JSON.parse(init.body).countryCode, "EL"); return { ok: true, status: 200, json: async () => ({ valid: false, name: "", address: "" }) }; } });
  assert.equal(inv.valid, false); assert.equal(inv.vatNumber, "EL123456789");
});

test("checkVies (Beheer) : résultat stocké sur le client ; VIES en panne → 503 sans rien modifier ; personnel refusé", async () => {
  await seed();
  await withNet(viesOk(), async (calls) => {
    const r = await ob({ action: "checkVies", id: "recNL" });
    assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
    assert.equal(calls.length, 1); assert.equal(calls[0].url, VIES_URL);
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { countryCode: "NL", vatNumber: "123456789B01" });
    assert.equal(r.payload.vies.valid, true); assert.equal(r.payload.vies.name, "VISHANDEL MAAS B.V.");
    assert.equal(r.payload.vies.address, "MARKT 1\n6211CK MAASTRICHT"); assert.ok(Date.parse(r.payload.vies.checkedAt) > 0);
    assert.equal(r.payload.stored, true);
    const f = await client("recNL");
    assert.equal(f["VIES gecontroleerd op"], r.payload.vies.checkedAt);
    assert.deepStrictEqual(JSON.parse(f["VIES resultaat"]), { valid: true, name: "VISHANDEL MAAS B.V.", address: "MARKT 1\n6211CK MAASTRICHT", vatNumber: "NL123456789B01" });
    assert.equal(r.payload.clients.find((c) => c.id === "recNL").vies.valid, true);
    // Numéro tapé mais pas encore enregistré : résultat montré, pas stocké.
    const other = await ob({ action: "checkVies", id: "recNL", btw: "DE123456789" });
    assert.equal(other.statusCode, 200); assert.equal(other.payload.stored, false);
    assert.equal(JSON.parse((await client("recNL"))["VIES resultaat"]).vatNumber, "NL123456789B01");
    assert.equal((await ob({ action: "checkVies", id: "recNL" }, "staff")).statusCode, 401);
  });
  await withNet(async () => { throw new TypeError("fetch failed"); }, async () => {
    const r = await ob({ action: "checkVies", id: "recBE" });
    assert.equal(r.statusCode, 503); assert.match(r.payload.error, /VIES/);
    assert.equal((await client("recBE"))["VIES gecontroleerd op"], undefined, "rien n'est écrit");
    // Enregistrer la fiche reste possible pendant la panne (aucun appel VIES).
    const s = await ob({ action: "saveClient", id: "recBE", nom: "Bouw & Vis", user: "bouw", btw: "BE0417497106", regime: "Cocontractant", taal: "FR", generate: false, sendMail: false });
    assert.equal(s.statusCode, 200, JSON.stringify(s.payload));
  });
  await withNet(viesOk(), async () => { assert.equal((await ob({ action: "checkVies", id: "recGB" })).statusCode, 400, "GB n'est pas dans VIES (hors UE)"); });
});

test("résultat VIES effacé quand le n° de TVA change, gardé sinon", async () => {
  await seed();
  await withNet(viesOk(), async () => assert.equal((await ob({ action: "checkVies", id: "recNL" })).statusCode, 200));
  const save = (btw) => ob({ action: "saveClient", id: "recNL", nom: "Vishandel Maas", user: "maas", btw, regime: "Intracommunautaire", generate: false, sendMail: false });
  let r = await withNet(async () => assert.fail("pas d'appel VIES à l'enregistrement"), () => save("NL 1234.567.89 B01"));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.ok((await client("recNL"))["VIES gecontroleerd op"], "même numéro (autre écriture) : gardé");
  r = await save("DE123456789");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const f = await client("recNL");
  assert.equal(f["VIES gecontroleerd op"], undefined); assert.equal(f["VIES resultaat"], undefined);
});

test("RGPD : régime et contrôle VIES dans l'export du client, conservés à l'anonymisation", async () => {
  await seed();
  await withNet(viesOk(), async () => assert.equal((await ob({ action: "checkVies", id: "recNL" })).statusCode, 200));
  const ex = await ob({ action: "exportClient", id: "recNL" });
  assert.equal(ex.statusCode, 200);
  assert.equal(ex.payload.export.client["Régime TVA"], "Intracommunautaire");
  assert.ok(ex.payload.export.client["VIES resultaat"] && ex.payload.export.client["VIES gecontroleerd op"]);
  assert.equal((await ob({ action: "archiveClient", id: "recNL" })).statusCode, 200);
  assert.equal((await ob({ action: "anonymizeClient", id: "recNL", confirm: "ANONIEM" })).statusCode, 200);
  const f = await client("recNL");
  assert.equal(f["Régime TVA"], "Intracommunautaire"); assert.ok(f["VIES resultaat"], "justificatif de l'exonération conservé");
});
