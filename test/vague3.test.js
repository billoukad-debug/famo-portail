"use strict";
// Vague 3 « facturation et paiement » (specs/034-vague-3-facturation) :
//   QR de virement EPC069-12 (contenu exact ligne par ligne, jamais en pro forma ni avec l'IBAN d'exemple),
//   export boekhouder par période (beheerder seul, liste et CSV exacts, UBL incomplet signalé),
//   statut d'envoi boekhouder / Peppol par document (beheerder, journalisé, bloque « ontvangst ongedaan maken »),
//   portail client (échéance, reste à payer ; relevé caché en mode boekhouder).
// Aucun appel réseau : tout ce qui n'est pas la base SQLite en mémoire jette. Rien n'est envoyé (ni Peppol, ni e-mail).
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY;
globalThis.fetch = async (url) => { throw new Error("réseau interdit dans les tests : " + String(url)); };

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const bill = require(path.join(ROOT, "lib", "billing.js"));
const E = require(path.join(ROOT, "assets", "epc.js"));
const V = require(path.join(ROOT, "lib", "verzending.js"));
const B = require(path.join(ROOT, "lib", "boekhouder.js"));

// IBAN de test : valide (modulo 97), fictif, ni l'exemple de bedrijf.js ni celui des registres.
const IBAN = "BE48001123456727";
const EXAMPLE = "BE68539007547034"; // assets/docs/bedrijf.js EXAMPLE et scripts/seed.js

const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
function mkRes() { return { statusCode: 200, payload: null, body: null, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, send(b) { this.body = b; return this; } }; }
async function call(file, body, opts) {
  const h = require(path.join(ROOT, "api", file));
  const res = mkRes();
  await h({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || {}, query: (opts && opts.query) || {} }, res);
  return res;
}
const exp = (query, headers) => call("export.js", null, { method: "GET", query, headers });
const upd = (body, role) => call("updateorder.js", body, { headers: cookie(role || "admin") });
const fieldsOf = async (id) => (await store().get("Commandes", id)).fields;

// ---------------------------------------------------------------- 1. EPC069-12
test("EPC : contenu exact ligne par ligne (version 002, UTF-8, SCT, BIC, bénéficiaire, IBAN, montant, OGM)", () => {
  const ogm = bill.structuredRef("FA-2026-0025");
  assert.equal(ogm, "+++202/6000/02519+++");
  const p = E.payload({ naam: "Famo Trading BV", iban: "be48 0011 2345 6727", bic: "gkccbebb", bedrag: 1234.5, mededeling: ogm });
  assert.ok(p.ok, JSON.stringify(p));
  assert.deepStrictEqual(p.text.split("\n"), ["BCD", "002", "1", "SCT", "GKCCBEBB", "Famo Trading BV", IBAN, "EUR1234.50", "", "+++202/6000/02519+++"]);
  assert.ok(!/\r|\n$/.test(p.text), "séparateur LF, rien après la dernière donnée remplie");
  // Sans BIC (facultatif en 002) ; sans OGM → communication libre en ligne 11, référence structurée vide.
  assert.deepStrictEqual(E.payload({ naam: "Famo", iban: IBAN, bedrag: 0.01, tekst: "Factuur FA-X\nregel 2" }).text.split("\n"), ["BCD", "002", "1", "SCT", "", "Famo", IBAN, "EUR0.01", "", "", "Factuur FA-X regel 2"]);
  // OGM au mauvais contrôle : jamais recopiée comme référence structurée.
  assert.equal(E.payload({ naam: "Famo", iban: IBAN, bedrag: 10, mededeling: "+++202/6000/02518+++" }).text.split("\n")[9], undefined);
  // Montants : point décimal, deux décimales, bornes EPC.
  assert.equal(E.amountTxt(12), "EUR12.00");
  assert.equal(E.amountTxt(999999999.99), "EUR999999999.99");
  assert.equal(E.amountTxt(0), "");
  assert.equal(E.amountTxt(-5), "");
  assert.equal(E.amountTxt(1e9), "");
  // Bénéficiaire ≤ 70 caractères, UTF-8 permis (jeu de caractères 1), sur une seule ligne.
  const long = E.payload({ naam: "Ö".repeat(90), iban: IBAN, bedrag: 1 }).text.split("\n")[5];
  assert.equal(Array.from(long).length, 70);
});

test("EPC : refus sans IBAN valide, avec un IBAN d'exemple, sans nom ou sans montant", () => {
  assert.equal(E.ibanValid(IBAN), true);
  assert.equal(E.ibanValid("BE48001123456728"), false, "contrôle modulo 97");
  assert.deepStrictEqual(E.payload({ naam: "F", iban: "BE48001123456728", bedrag: 1 }), { ok: false, reden: "iban" });
  for (const ex of E.EXAMPLE_IBANS) assert.deepStrictEqual(E.payload({ naam: "F", iban: ex, bedrag: 1 }), { ok: false, reden: "voorbeeld-iban" }, ex);
  assert.ok(E.EXAMPLE_IBANS.includes(EXAMPLE));
  assert.ok(read("assets/docs/bedrijf.js").includes('"BE68 5390 0754 7034"'), "l'exemple de bedrijf.js est dans la liste");
  assert.equal(E.payload({ naam: "", iban: IBAN, bedrag: 1 }).reden, "naam");
  assert.equal(E.payload({ naam: "F", iban: IBAN, bedrag: 0 }).reden, "bedrag");
});

test("EPC : QR seulement en mode Portaal avec un vrai IBAN (jamais en Boekhouder, jamais l'exemple)", () => {
  const portaal = { facturatie: "portaal", iban: IBAN, bic: "GKCCBEBB", nom: "FAMO Seafood", legal: { naam: "Famo Trading", rechtsvorm: "BV" } };
  assert.equal(E.allowed(portaal), true);
  assert.equal(E.allowed(Object.assign({}, portaal, { facturatie: "boekhouder" })), false);
  assert.equal(E.allowed(Object.assign({}, portaal, { facturatie: "" })), false, "défaut = boekhouder");
  assert.equal(E.allowed(Object.assign({}, portaal, { iban: EXAMPLE })), false);
  assert.equal(E.allowed(Object.assign({}, portaal, { exampleBank: true })), false);
  assert.equal(E.allowed(Object.assign({}, portaal, { iban: "" })), false);
  const q = E.forInvoice({ company: portaal, bedrag: 39.97, mededeling: bill.structuredRef("FA-2026-0010"), factuurnummer: "FA-2026-0010" });
  assert.deepStrictEqual(q.text.split("\n"), ["BCD", "002", "1", "SCT", "GKCCBEBB", "Famo Trading BV", IBAN, "EUR39.97", "", bill.structuredRef("FA-2026-0010")]);
  assert.match(q.svg, /^<svg [^>]*class="epc-qr"[^>]*role="img"/);
  assert.equal(E.forInvoice({ company: Object.assign({}, portaal, { facturatie: "boekhouder" }), bedrag: 10 }), null);
  assert.equal(E.forInvoice({ company: Object.assign({}, portaal, { iban: EXAMPLE }), bedrag: 10 }), null);
  assert.equal(E.forInvoice({ company: portaal, bedrag: 0 }), null, "facture soldée : pas de QR");
});

test("EPC : matrice QR (niveau M, taille minimale) et SVG net, identique pour le même contenu", () => {
  const p = E.payload({ naam: "Famo Trading BV", iban: IBAN, bic: "GKCCBEBB", bedrag: 1234.5, mededeling: bill.structuredRef("FA-2026-0025") });
  const m = E.matrix(p.text);
  assert.equal(m.length, 41, "version 6 (41 × 41) pour ~80 octets au niveau M");
  // Motifs de repérage aux trois coins (7 × 7, bord foncé) : la bibliothèque a bien produit un QR.
  for (const [r0, c0] of [[0, 0], [0, m.length - 7], [m.length - 7, 0]]) for (let i = 0; i < 7; i++) { assert.ok(m[r0][c0 + i] && m[r0 + 6][c0 + i] && m[r0 + i][c0] && m[r0 + i][c0 + 6]); }
  assert.equal(E.svg(p.text), E.svg(p.text));
  assert.match(E.svg(p.text), /viewBox="0 0 49 49"/, "zone calme de 4 modules");
  // Vérifié aussi en dehors de la CI : décodé par OpenCV 5 (QRCodeDetector) = texte identique (specs/034, « Vérification »).
});

// ---------------------------------------------------------------- 2. Document factuur (navigateur)
function docs() {
  const win = { console, Intl, Date };
  win.window = win;
  vm.createContext(win);
  for (const f of ["assets/vat.js", "vendor/qrcode-generator.js", "assets/epc.js", "assets/docs/bedrijf.js", "assets/docs/documents.js"]) vm.runInContext(read(f), win);
  return win;
}
const CFG = { bedrijfsnaam: "FAMO Seafood", adres: "Jezusstraat 34", plaats: "2000 Antwerpen", btw: "BE0788705713", iban: IBAN, bic: "GKCCBEBB", btwTarief: 6, facturatie: "portaal", legal: { naam: "Famo Trading", rechtsvorm: "BV" } };
const ORDER = { ref: "CMD-2026-0500", client: "Resto Test", factuurnummer: "FA-2026-0500", lignes: "Kabeljauw × 5 kg [€20.00]", total: 100, factureeLe: "2026-03-10T09:30:00.000Z", taal: "nl" };

test("document factuur (NL/FR) : QR EPC sur la facture du portail, pas sur le pro forma ni avec l'IBAN d'exemple", () => {
  const w = docs(), D = w.FamoDocuments;
  D.setCompany(CFG);
  const html = D.build(ORDER, "invoice");
  const expected = w.FamoEpc.payload({ naam: "Famo Trading BV", iban: IBAN, bic: "GKCCBEBB", bedrag: 106, mededeling: "+++202/6000/50009+++" });
  assert.ok(html.includes(w.FamoEpc.svg(expected.text, { label: "QR-code voor overschrijving" })), "QR = montant TVAC, OGM, IBAN, BIC, nom juridique");
  assert.match(html, /<figcaption>Scan met uw bank-app om te betalen<\/figcaption>/);
  const fr = D.build(Object.assign({}, ORDER, { taal: "fr" }), "invoice");
  assert.match(fr, /aria-label="Code QR pour virement"/);
  assert.match(fr, /Scannez avec votre app bancaire pour payer/);
  // Payée, avec note de crédit, note de crédit elle-même, bon de livraison : pas de QR.
  assert.ok(!/epc-qr/.test(D.build(Object.assign({}, ORDER, { paiement: "Payé", payeLe: "2026-03-20" }), "invoice")));
  assert.ok(!/epc-qr/.test(D.build(Object.assign({}, ORDER, { creditnotas: [{ nummer: "CN-2026-0001", montant: 20 }] }), "invoice")));
  assert.ok(!/epc-qr/.test(D.build(Object.assign({}, ORDER, { creditnota: { nummer: "CN-2026-0001", lignes: "Kabeljauw × 1 kg [€20.00]", montant: 20, le: "2026-03-12" } }), "credit")));
  assert.ok(!/epc-qr/.test(D.build(ORDER, "delivery")));
  // Mode boekhouder (défaut) : pro forma, ni IBAN ni QR.
  D.setCompany(Object.assign({}, CFG, { facturatie: "boekhouder" }));
  const pf = D.build(ORDER, "invoice");
  assert.match(pf, /PRO FORMA/);
  assert.ok(!/epc-qr|IBAN/.test(pf));
  // IBAN d'exemple configuré (données de démo) : facture possible, jamais de QR.
  D.setCompany(Object.assign({}, CFG, { iban: EXAMPLE }));
  const ex = D.build(ORDER, "invoice");
  assert.match(ex, /BE68 5390 0754 7034/);
  assert.ok(!/epc-qr/.test(ex), "pas de QR avec l'IBAN d'exemple");
  // Module QR absent (ancien cache) : le document reste correct, sans QR.
  const w2 = { console, Intl, Date }; w2.window = w2; vm.createContext(w2);
  for (const f of ["assets/vat.js", "assets/docs/bedrijf.js", "assets/docs/documents.js"]) vm.runInContext(read(f), w2);
  w2.FamoDocuments.setCompany(CFG);
  assert.ok(!/epc-qr/.test(w2.FamoDocuments.build(ORDER, "invoice")));
});

// ---------------------------------------------------------------- 3. Données (SQLite)
const CONF = rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "Juridische naam": "Famo Trading", Rechtsvorm: "BV", RPR: "RPR Antwerpen, afdeling Antwerpen", "BTW-nummer": "BE0788705713", Adres: "Jezusstraat 34", "Postcode en plaats": "2000 Antwerpen", IBAN, BIC: "GKCCBEBB", "BTW-tarief": 6, "Betaaltermijn dagen": 14, Facturatie: "Portaal" });
const SENT = JSON.stringify({ "FA-2026-0010": { boekhouder: { op: "2026-09-21", door: "Mohsen", bron: "hand" }, peppol: { status: "Verstuurd", op: "2026-09-21", bron: "hand" } } });
const ORDERS = () => [
  rec("recO1", { "Référence": "CMD-2026-0001", Date: "2026-09-04", Statut: "Facturée", "Statut paiement": "Payé", "Payé le": "2026-09-20T10:00:00.000Z", Factuurnummer: "FA-2026-0010", "Facturée le": "2026-09-05T10:00:00.000Z", Client: ["recCLA"],
    "Lignes (produits / quantités)": "Tong × 2 kg [€16.00]\nSaus × 1 pièce [€5.00]", Total: 37, "BTW per lijn": JSON.stringify({ tong: 6, saus: 21 }),
    "Creditnota nummer": "CN-2026-0003", "Creditnota lignes": "Tong × 1 kg [€16.00]", "Creditnota montant": 16, "Creditnota le": "2026-09-12T09:00:00.000Z", "Creditnota motif": "niet vers", Verzending: SENT }),
  // Facturée le 30/09 à 22:30 UTC = 01/10 à Bruxelles : hors septembre.
  rec("recO2", { "Référence": "CMD-2026-0002", Date: "2026-09-29", Statut: "Facturée", Factuurnummer: "FA-2026-0011", "Facturée le": "2026-09-30T22:30:00.000Z", Client: ["recCLA"], "Lignes (produits / quantités)": "Tong × 1 kg [€16.00]", Total: 16, "BTW per lijn": JSON.stringify({ tong: 6 }) }),
  rec("recO3", { "Référence": "CMD-2026-0003", Date: "2026-09-01", Statut: "Facturée", "Statut paiement": "En attente", Factuurnummer: "FA-2026-0009", "Facturée le": "2026-09-02T08:00:00.000Z", Client: ["recCLB"], "Lignes (produits / quantités)": "Mosselen × 3 kg [€5.00]", Total: 15, "BTW per lijn": JSON.stringify({ mosselen: 6 }) }),
  rec("recO4", { "Référence": "CMD-2026-0004", Date: "2026-09-10", Statut: "Facturée", Factuurnummer: "FA-2026-0012", "Facturée le": "2026-09-10T08:00:00.000Z", Client: ["recCLA"], "Lignes (produits / quantités)": "Tong × 1 kg [€16.00]", Total: 16, Test: true }),
  rec("recO5", { "Référence": "CMD-2026-0005", Date: "2026-09-15", Statut: "Reçue", Client: ["recCLA"], "Lignes (produits / quantités)": "Tong × 1 kg [€16.00]", Total: 16 })
];
async function seed(conf) {
  await store().replaceAll("Configuratie", [conf || CONF]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 16, "Unité": "kg", Actif: true, "BTW-tarief": 6 }), rec("recP2", { Produit: "Saus", "Prix de base": 5, "Unité": "pièce", Actif: true, "BTW-tarief": 21 })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "a", Wachtwoord: ca.hashPassword("geheim123"), "BTW-nummer": "BE0417497106", "Lieu de livraison": "Kaai 1\n2000 Antwerpen", Email: "a@resto.test" }), rec("recCLB", { Nom: "Bistro B", "Lieu de livraison": "Kaai 2\n2000 Antwerpen" })]);
  await store().replaceAll("Commandes", ORDERS());
  await store().replaceAll("Journaal", []);
}
const SEPT = { van: "2026-09-01", tot: "2026-09-30" };

test("export boekhouder : réservé au beheerder (401 sans session, 403 personnel), période contrôlée", async () => {
  await seed();
  for (const format of ["lijst", "csv"]) {
    assert.equal((await exp(Object.assign({ format }, SEPT), {})).statusCode, 401, format);
    assert.equal((await exp(Object.assign({ format }, SEPT), cookie("staff"))).statusCode, 403, format);
  }
  assert.equal((await exp({ format: "lijst", van: "2026-09-30", tot: "2026-09-01" }, cookie("admin"))).statusCode, 400);
  assert.equal((await exp({ format: "lijst", van: "2026-02-30", tot: "2026-03-01" }, cookie("admin"))).statusCode, 400, "date inexistante");
  assert.equal((await exp({ format: "lijst" }, cookie("admin"))).statusCode, 400);
  assert.equal((await exp({ format: "lijst", van: "2025-01-01", tot: "2026-12-31" }, cookie("admin"))).statusCode, 400, "plus de 400 jours");
});

test("export boekhouder : documents de la période (Bruxelles), montants UBL, payé, verzending, UBL incomplet signalé", async () => {
  await seed();
  const r = await exp(Object.assign({ format: "lijst" }, SEPT), cookie("admin"));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const d = r.payload.documenten;
  assert.deepStrictEqual(d.map((x) => [x.nummer, x.datum, x.soort]), [["FA-2026-0009", "2026-09-02", "factuur"], ["FA-2026-0010", "2026-09-05", "factuur"], ["CN-2026-0003", "2026-09-12", "creditnota"]], "FA-2026-0011 (01/10 à Bruxelles), la commande test et la commande non facturée sont exclues");
  const fa = d[1];
  assert.deepStrictEqual([fa.excl, fa.btw, fa.incl, fa.betaald, fa.betaaldOp], [37, 2.97, 39.97, true, "2026-09-20"]);
  assert.deepStrictEqual(fa.verzending.peppol.status, "Verstuurd");
  assert.equal(fa.ubl, "/api/export?format=ubl&id=recO1");
  assert.deepStrictEqual([d[2].excl, d[2].btw, d[2].incl, d[2].betaald, d[2].factuur], [-16, -0.96, -16.96, null, "FA-2026-0010"]);
  assert.equal(d[2].ubl, "/api/export?format=ubl&id=recO1&type=credit&cn=CN-2026-0003");
  assert.deepStrictEqual(d[0].problemen, ["BTW-nummer van de klant ontbreekt of is geen geldig Belgisch nummer (Peppol-adres)"]);
  assert.deepStrictEqual(d[1].problemen, []);
  assert.equal(r.payload.facturatie, "portaal");
  // L'UBL d'un document signalé comme incomplet est bien refusé par la route existante (422), le complet passe.
  assert.equal((await exp({ format: "ubl", id: "recO3" }, cookie("admin"))).statusCode, 422);
  assert.equal((await exp({ format: "ubl", id: "recO1", type: "credit", cn: "CN-2026-0003" }, cookie("admin"))).statusCode, 200);
});

test("export boekhouder : CSV exact (une ligne par document, puis le total)", async () => {
  await seed();
  const r = await exp(Object.assign({ format: "csv" }, SEPT), cookie("admin"));
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"], /text\/csv/);
  assert.match(r.headers["content-disposition"], /Famo-boekhouder-2026-09-01-2026-09-30\.csv/);
  assert.equal(r.body, "﻿" + [
    "Type;Nummer;Datum;Oorspronkelijke factuur;Klant;BTW-nummer klant;Bestelling;Totaal excl. btw;Btw;Totaal incl. btw;Betaald;Betaald op;Naar boekhouder op;Peppol;Peppol op;UBL volledig",
    "Factuur;FA-2026-0009;2026-09-02;;Bistro B;;CMD-2026-0003;15,00;0,90;15,90;nee;;;;;nee: BTW-nummer van de klant ontbreekt of is geen geldig Belgisch nummer (Peppol-adres)",
    "Factuur;FA-2026-0010;2026-09-05;;Resto A;BE0417497106;CMD-2026-0001;37,00;2,97;39,97;ja;2026-09-20;2026-09-21;Verstuurd;2026-09-21;ja",
    "Creditnota;CN-2026-0003;2026-09-12;FA-2026-0010;Resto A;BE0417497106;CMD-2026-0001;-16,00;-0,96;-16,96;;;;;;ja",
    "Totaal;3 documenten;;;;;;36,00;2,91;38,91;;;;;;"
  ].join("\r\n"));
  // Une cellule qui commence par « = » ne devient jamais une formule (même règle que la Rapportage).
  assert.match(B.csvOf([{ soort: "factuur", nummer: "=1+1", datum: "", factuur: "", klant: "@x", klantBtw: "", ref: "", excl: 1, btw: 0, incl: 1, betaald: false, betaaldOp: "", verzending: { boekhouder: null, peppol: null }, problemen: [] }]), /;'=1\+1;.*;'@x;/);
});

// ---------------------------------------------------------------- 4. Statut d'envoi
test("verzending : beheerder seul, commande facturée, document de la commande, dates contrôlées", async () => {
  await seed();
  const v = (verzending, role) => upd({ id: "recO3", verzending }, role);
  assert.equal((await v({ nummer: "FA-2026-0009", boekhouder: "2026-09-21" }, "staff")).statusCode, 403);
  assert.equal((await upd({ id: "recO5", verzending: { nummer: "FA-2026-0009", boekhouder: "2026-09-21" } })).statusCode, 409, "commande non facturée");
  assert.match((await v({ nummer: "FA-2026-0010", boekhouder: "2026-09-21" })).payload.error, /Onbekend documentnummer/);
  assert.match((await v({ nummer: "FA-2026-0009", boekhouder: "2099-01-01" })).payload.error, /toekomst/);
  assert.match((await v({ nummer: "FA-2026-0009", boekhouder: "2026-09-01" })).payload.error, /vóór de datum van FA-2026-0009/);
  assert.match((await v({ nummer: "FA-2026-0009", boekhouder: "21/09/2026" })).payload.error, /Ongeldige datum/);
  assert.match((await v({ nummer: "FA-2026-0009", peppol: { status: "Kwijt", op: "2026-09-21" } })).payload.error, /Ongeldige Peppol-status/);
  assert.match((await v({ nummer: "FA-2026-0009", peppol: { status: "Geweigerd", op: "2026-09-21" } })).payload.error, /reden/);
  assert.equal((await fieldsOf("recO3")).Verzending, undefined, "aucun refus n'écrit");
});

test("verzending : écrit par document, journalisé (Correcties + journal d'audit), effaçable, visible dans allorders", async () => {
  await seed();
  let r = await upd({ id: "recO1", verzending: { nummer: "CN-2026-0003", boekhouder: "2026-09-13", peppol: { status: "Geweigerd", op: "2026-09-14", reden: "Klant niet op Peppol" } } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  let f = await fieldsOf("recO1");
  const all = JSON.parse(f.Verzending);
  assert.deepStrictEqual(Object.keys(all).sort(), ["CN-2026-0003", "FA-2026-0010"], "la facture garde son statut");
  assert.deepStrictEqual(all["CN-2026-0003"].peppol, { status: "Geweigerd", op: "2026-09-14", reden: "Klant niet op Peppol", bron: "hand", id: "", door: all["CN-2026-0003"].peppol.door });
  assert.equal(all["CN-2026-0003"].boekhouder.bron, "hand");
  const lines = f.Correcties.split("\n");
  assert.match(lines[0], /· Naar boekhouder: CN-2026-0003 op 13\/09\/2026 · /);
  assert.match(lines[1], /· Peppol CN-2026-0003: geweigerd op 14\/09\/2026 \(Klant niet op Peppol\) · /);
  const j = (await store().list("Journaal")).map((x) => x.fields);
  assert.ok(j.some((x) => x.Actie === "Verzending boekhouder/Peppol" && x.Referentie === "CMD-2026-0001"), JSON.stringify(j));
  // Même état : refusé (rien à journaliser).
  assert.match((await upd({ id: "recO1", verzending: { nummer: "CN-2026-0003", boekhouder: "2026-09-13" } })).payload.error, /Geen wijziging/);
  // Effacer : la ligne de journal le dit, l'entrée disparaît quand plus rien n'est noté.
  r = await upd({ id: "recO1", verzending: { nummer: "CN-2026-0003", boekhouder: null, peppol: null, reden: "vergissing" } });
  assert.equal(r.statusCode, 200);
  f = await fieldsOf("recO1");
  assert.deepStrictEqual(Object.keys(JSON.parse(f.Verzending)), ["FA-2026-0010"]);
  assert.match(f.Correcties, /Naar boekhouder gewist: CN-2026-0003 · .* — vergissing/);
  assert.match(f.Correcties, /Peppol-status gewist: CN-2026-0003/);
  // Bestellingen et la fiche lisent le statut (api/allorders).
  const ao = await call("allorders.js", null, { method: "GET", headers: cookie("staff"), query: { all: "1" } });
  assert.equal(ao.statusCode, 200, JSON.stringify(ao.payload));
  const o1 = ao.payload.orders.find((o) => o.id === "recO1");
  assert.equal(o1.verzending["FA-2026-0010"].peppol.status, "Verstuurd");
  assert.equal(V.label(o1.verzending["FA-2026-0010"]), "Naar boekhouder 21/09/2026 · Peppol verstuurd 21/09/2026");
});

test("verzending : une facture remise au comptable ne se « dé-réceptionne » plus (note de crédit)", async () => {
  await seed();
  assert.equal((await upd({ id: "recO3", verzending: { nummer: "FA-2026-0009", boekhouder: "2026-09-03" } })).statusCode, 200);
  const t = await upd({ id: "recO3", correction: "terug", reden: "fout getekend" });
  assert.equal(t.statusCode, 409);
  assert.match(t.payload.error, /al naar de boekhouder of via Peppol verstuurd/);
  assert.equal((await fieldsOf("recO3")).Statut, "Facturée");
});

test("verzending : le même apply() servira à un envoi automatique (bron, identifiant du message)", () => {
  const f = ORDERS()[2].fields;
  const r = V.apply(f, { nummer: "FA-2026-0009", peppol: { status: "Aanvaard", op: "2026-09-03", id: "msg-123" } }, { bron: "automatisch", door: "Peppol", today: "2026-09-30" });
  assert.deepStrictEqual(JSON.parse(r.value)["FA-2026-0009"].peppol, { status: "Aanvaard", op: "2026-09-03", reden: "", bron: "automatisch", id: "msg-123", door: "Peppol" });
  // Depuis le navigateur, bron est toujours « hand » et l'id ignoré (lib/commande/verzending.js).
  assert.match(read("lib/commande/verzending.js"), /bron: "hand" \}; \/\/ jamais « automatisch » depuis le navigateur/);
  assert.deepStrictEqual(V.all({ Verzending: "{pas du json" }), {});
  assert.equal(V.invoiceSent(f), false);
});

// ---------------------------------------------------------------- 5. Portail client
test("portail client : échéance et reste à payer par facture (serveur), mêmes règles que les relances", async () => {
  await seed();
  const token = ca.issueToken({ id: "recCLA", fields: (await store().get("Clients", "recCLA")).fields });
  const r = await call("orders.js", {}, { headers: { cookie: "famo_klant=" + encodeURIComponent(token) } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const o1 = r.payload.orders.find((o) => o.ref === "CMD-2026-0001"), o2 = r.payload.orders.find((o) => o.ref === "CMD-2026-0002");
  assert.equal(o1.vervaldatum, "2026-09-19", "05/09 + 14 jours");
  assert.equal(o1.openstaand, 23.01, "39,97 − 16,96 (note de crédit TVAC)");
  assert.equal(o2.vervaldatum, "2026-10-15", "facturée le 01/10 à Bruxelles + 14");
  assert.equal(o2.openstaand, 16.96);
  assert.ok(!r.payload.orders.some((o) => o.ref === "CMD-2026-0004"), "commande test invisible");
  assert.equal(r.payload.orders.find((o) => o.ref === "CMD-2026-0005").vervaldatum, "");
  assert.ok(!("verzending" in o1), "statut d'envoi interne : pas chez le client");
});

test("portail client : relevé et QR seulement en mode Portaal ; mode boekhouder inchangé (relevé caché, pas d'échéance)", () => {
  const src = read("assets/pages/klant.js");
  // Le relevé reste vide en mode boekhouder (demande du gérant du 08/10/2026, ADR 0005).
  assert.match(src, /function statement\(list\) \{\n\s*const co = cat\.company \|\| \{\};\n[^\n]*\n\s*if \(co\.facturatie !== "portaal"\) return "";/);
  assert.match(src, /portaal\(\) && o\.statut === "Facturée" \? row\(K\.t\("Vervaldatum"\)/, "échéance seulement en mode Portaal");
  assert.match(src, /window\.FamoEpc\.forInvoice\(\{ company,/, "QR par la règle commune (refuse boekhouder et IBAN d'exemple)");
  assert.match(src, /if \(st\) fillQr\(\);/, "QR seulement quand le relevé est affiché");
  // Le module QR est chargé avec les documents (même version K.DOCS_VER).
  assert.match(read("assets/ui.js"), /"\/vendor\/qrcode-generator\.js", "\/assets\/epc\.js", "\/assets\/docs\/bedrijf\.js"/);
  assert.match(read("scripts/assets-version.js"), /"vendor\/qrcode-generator\.js", "assets\/epc\.js"/);
  // Bibliothèque figée, licence MIT et origine notées.
  const lic = read("vendor/qrcode-generator.LICENSE");
  assert.match(lic, /qrcode-generator 2\.0\.4/);
  assert.match(lic, /The MIT License/);
  assert.match(lic, /sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe\/c\+5XxCuetEenqmNFf1FH\/ftXPCtFG5\/TDobjsjz6sSNL0Sr8Z9g==/);
});

test("Beheer : écran Export boekhouder (beheerder) relié dans les deux sens", () => {
  assert.match(read("assets/pages/beheer.js"), /\["boekhouder", "Boekhouder"\]/);
  assert.match(read("assets/pages/beheer.js"), /k === "boekhouder" \? "\/beheer\/boekhouder"/);
  const page = read("assets/pages/beheer/boekhouder.js");
  assert.match(page, /K\.requireStaff\(\{ admin: true \}\)/);
  assert.match(page, /href="\/beheer"/);
  assert.match(page, /href="\/team\/documenten"/);
  assert.match(page, /\/api\/export\?format=lijst&/);
  assert.match(page, /\/api\/export\?format=csv&/);
  assert.match(read("assets/pages/team/documenten.js"), /href="\/beheer\/boekhouder"/);
  assert.match(read("beheer/boekhouder.html"), /assets\/pages\/beheer\/boekhouder\.js/);
  assert.match(read("assets/pages/staff-common.js"), /S\.verzendingHtml = /);
  assert.match(read("assets/pages/team/bestelling.js"), /S\.verzendingHtml\(o\)/);
  assert.match(read("assets/pages/team/bestellingen.js"), /S\.verzTag\(o\)/);
});
