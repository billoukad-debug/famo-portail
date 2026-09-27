"use strict";
// UBL Peppol BIS Billing 3.0 : structure, sommes EN 16931, contrôles avant export, accès beheerder.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ubl = require(path.join(ROOT, "lib", "ubl.js"));

const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
function mkRes() { return { statusCode: 200, payload: null, body: "", headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, send(b) { this.body = b; return this; } }; }
async function exp(query, headers) { const h = require(path.join(ROOT, "api", "export.js")); const res = mkRes(); await h({ method: "GET", query, headers, body: null }, res); return res; }
const tag = (xml, name) => { const m = new RegExp("<" + name + "(?: [^>]*)?>([^<]*)</" + name + ">").exec(xml); return m ? m[1] : null; };
const all = (xml, name) => Array.from(xml.matchAll(new RegExp("<" + name + "(?: [^>]*)?>([^<]*)</" + name + ">", "g"))).map((m) => m[1]);

const CONF = rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "Juridische naam": "Famo Trading", Rechtsvorm: "BV", RPR: "RPR Antwerpen, afdeling Antwerpen", "BTW-nummer": "BE0788705713", Adres: "Jezusstraat 34", "Postcode en plaats": "2000 Antwerpen", IBAN: "BE71096123456769", BIC: "GKCCBEBB", "BTW-tarief": 6, "Betaaltermijn dagen": 14 });
const CLIENT = (btw) => rec("recCLA", { Nom: "Resto & Co <b>", "BTW-nummer": btw, "Lieu de livraison": "Kaai 1\n2000 Antwerpen", Email: "chef@resto.test" });
const ORDER = rec("recORD1", { "Référence": "CMD-2026-0042", Statut: "Facturée", Factuurnummer: "FA-2026-0007", "Facturée le": "2026-09-01T22:30:00.000Z", "Livrée le": "2026-09-01T10:00:00.000Z", Client: ["recCLA"], "Lignes (produits / quantités)": "Tong × 1.375 kg [€18.49]\nSaus × 2 pièce [€5.00]\nMosselen × 3 caisse [€4.99]", Total: 50.39, "BTW per lijn": JSON.stringify({ tong: 6, saus: 21, mosselen: 6 }), "Creditnota nummer": "CN-2026-0001", "Creditnota lignes": "Tong × 1 kg [€18.49]", "Creditnota montant": 18.49, "Creditnota le": "2026-09-03T08:00:00.000Z", "Creditnota motif": "Niet vers" });

async function seed(client) {
  const s = ds.state.store;
  await s.replaceAll("Configuratie", [CONF]);
  await s.replaceAll("Catalogue", []);
  await s.replaceAll("Clients", [client]);
  await s.replaceAll("Commandes", [ORDER]);
}

test("numéro d'entreprise belge (modulo 97)", () => {
  assert.equal(ubl.beCompanyNo("BE 0788.705.713"), "0788705713");
  assert.equal(ubl.beCompanyNo("BE0788705714"), "");
  assert.equal(ubl.beCompanyNo("FR12345678901"), "");
});

test("export réservé au beheerder", async () => {
  await seed(CLIENT("BE0417497106"));
  assert.equal((await exp({ format: "ubl", id: "recORD1" }, cookie("staff"))).statusCode, 401);
});

test("n° TVA client manquant → 422 avec la liste des manques (pas de fichier refusé par Billtobox)", async () => {
  await seed(CLIENT(""));
  const r = await exp({ format: "ubl", id: "recORD1" }, cookie("admin"));
  assert.equal(r.statusCode, 422);
  assert.ok(r.payload.problems.some((p) => /BTW-nummer van de klant/.test(p)));
});

test("facture UBL : profil Peppol, parties, TVA par taux, sommes EN 16931, OGM", async () => {
  await seed(CLIENT("BE0417497106"));
  const r = await exp({ format: "ubl", id: "recORD1" }, cookie("admin"));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const xml = r.body;
  assert.match(r.headers["content-disposition"], /Factuur-FA-2026-0007\.xml/);
  assert.equal(tag(xml, "cbc:CustomizationID"), "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0");
  assert.equal(tag(xml, "cbc:ProfileID"), "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0");
  assert.equal(tag(xml, "cbc:ID"), "FA-2026-0007");
  assert.equal(tag(xml, "cbc:IssueDate"), "2026-09-02", "date civile à Bruxelles (22:30 UTC le 1er = 00:30 le 2)");
  assert.equal(tag(xml, "cbc:DueDate"), "2026-09-16");
  assert.equal(tag(xml, "cbc:InvoiceTypeCode"), "380");
  assert.deepStrictEqual(all(xml, "cbc:EndpointID"), ["0788705713", "0417497106"]);
  assert.match(xml, /<cbc:RegistrationName>Famo Trading BV<\/cbc:RegistrationName>/);
  assert.match(xml, /<cbc:CompanyLegalForm>RPR Antwerpen, afdeling Antwerpen<\/cbc:CompanyLegalForm>/);
  assert.match(xml, /Resto &amp; Co &lt;b&gt;/, "texte échappé");
  assert.equal(tag(xml, "cbc:PaymentID"), "+++202/6000/00701+++");
  // Sommes : lignes 25,42 + 10,00 + 14,97 ; bases 6 % = 40,39 et 21 % = 10,00.
  assert.deepStrictEqual(all(xml, "cbc:LineExtensionAmount"), ["50.39", "25.42", "10.00", "14.97"]);
  assert.deepStrictEqual(all(xml, "cbc:TaxableAmount"), ["40.39", "10.00"]);
  assert.deepStrictEqual(all(xml, "cbc:TaxAmount"), ["4.52", "2.42", "2.10"]);
  assert.equal(tag(xml, "cbc:TaxInclusiveAmount"), "54.91");
  assert.equal(tag(xml, "cbc:PayableAmount"), "54.91");
  assert.deepStrictEqual(Array.from(xml.matchAll(/unitCode="([A-Z0-9]+)"/g)).map((m) => m[1]), ["KGM", "H87", "XBX"]);
  // Bien formé (xmllint si disponible sur la machine).
  const f = path.join(os.tmpdir(), "famo-ubl-test.xml"); fs.writeFileSync(f, xml);
  const lint = spawnSync("xmllint", ["--noout", f], { encoding: "utf8" });
  if (!lint.error) assert.equal(lint.status, 0, lint.stderr);
});

test("note de crédit UBL : CreditNote 381, référence à la facture d'origine", async () => {
  await seed(CLIENT("BE0417497106"));
  const r = await exp({ format: "ubl", id: "recORD1", type: "credit" }, cookie("admin"));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const xml = r.body;
  assert.match(xml, /^<\?xml[^>]*>\n<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/);
  assert.equal(tag(xml, "cbc:CreditNoteTypeCode"), "381");
  assert.match(xml, /<cac:InvoiceDocumentReference><cbc:ID>FA-2026-0007<\/cbc:ID><cbc:IssueDate>2026-09-02<\/cbc:IssueDate>/);
  assert.equal(tag(xml, "cbc:PayableAmount"), "19.60");
  assert.equal(tag(xml, "cbc:Note"), "Niet vers");
});
