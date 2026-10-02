"use strict";
// Rapportage (specs/022-rapportage) : module pur assets/rapport.js (mêmes règles que l'ancienne vue Beheer :
// date = factuurdatum sinon leverdatum, creditnota's à leur date, btw par taux via FamoVat, test exclus), API
// beheerder seul, marge par client, « Betaald » par l'action serveur existante, page et navigation.
// Aucun appel réseau : fetch est remplacé AVANT le chargement du moteur, tout ce qui n'est pas la base SQLite jette.
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
const margin = require(path.join(ROOT, "lib", "margin.js"));
const vat = require(path.join(ROOT, "assets", "vat.js"));
const R = require(path.join(ROOT, "assets", "rapport.js"));

// Les vraies fonctions du navigateur (K.parseLines, K.isoDay, K.cat, K.familyKey) : assets/ui.js dans un bac à sable.
const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: null, localStorage: null, addEventListener() {} };
vm.runInNewContext(read("assets/ui.js"), Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => { throw new Error("réseau interdit"); } }));
const K = win.K;
const TODAY = "2026-10-02";
const deps = { parseLines: K.parseLines, isoDay: K.isoDay, vat, catLabel: K.cat, familyOf: K.familyKey, today: TODAY };
const near = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, (msg || "") + " : " + a + " ≠ " + b);

// ---------------------------------------------------------------- jeu connu
// o2 est facturée le 31/03 à 23:30 UTC = 01/04 à Bruxelles (heure d'été) : elle compte en avril.
// o6 (2025) a une creditnota datée de janvier 2026 : déduite en 2026, à sa date.
// o4 : client à l'export, taux figés à 0 sur la facture ; o8 : aucune ligne chiffrée (repli : total au taux standard).
const ORDERS = [
  { id: "recO1", ref: "CMD-1", factuurnummer: "FA-2026-0001", statut: "Facturée", date: "2026-03-08", dateLiv: "2026-03-09", factureeLe: "2026-03-10T09:00:00Z", clientId: "recA", client: "Alpha", lignes: "Tong × 2 kg [€30.00]\nSaus × 1 pièce [€10.00]", total: 70, paiement: "Payé", btwRegime: "Normal", creditnotas: [] },
  { id: "recO2", ref: "CMD-2", factuurnummer: "FA-2026-0002", statut: "Facturée", date: "2026-03-30", dateLiv: "2026-03-31", factureeLe: "2026-03-31T23:30:00Z", clientId: "recA", client: "Alpha", lignes: "Mosselen × 4 kg [€5.00]", total: 20, paiement: "En attente", btwRegime: "Normal", creditnotas: [{ nummer: "CN-2026-0001", lignes: "Mosselen × 1 kg [€5.00]", montant: 5, le: "2026-05-02T08:00:00Z" }] },
  { id: "recO3", ref: "CMD-3", factuurnummer: "FA-2026-0003", statut: "Facturée", date: "2026-02-14", dateLiv: "2026-02-15", factureeLe: "", clientId: "recB", client: "Brasserie", lignes: "Tong × 1 kg [€30.00]", total: 30, paiement: "En attente", btwRegime: "Normal", creditnotas: [] },
  { id: "recO4", ref: "CMD-4", factuurnummer: "FA-2026-0004", statut: "Facturée", date: "2026-05-30", dateLiv: "2026-05-31", factureeLe: "2026-06-01T10:00:00Z", clientId: "recC", client: "Export SA", lignes: "Tong × 1 kg [€25.00]", total: 25, paiement: "Payé", btwRegime: "Export", btwFrozen: { tong: 0 }, creditnotas: [] },
  { id: "recO5", ref: "CMD-5", factuurnummer: "FA-2025-0001", statut: "Facturée", date: "2025-03-14", dateLiv: "2025-03-15", factureeLe: "2025-03-15T10:00:00Z", clientId: "recA", client: "Alpha", lignes: "Tong × 1 kg [€40.00]", total: 40, paiement: "Payé", btwRegime: "Normal", creditnotas: [] },
  { id: "recO6", ref: "CMD-6", factuurnummer: "FA-2025-0002", statut: "Facturée", date: "2025-12-19", dateLiv: "2025-12-20", factureeLe: "2025-12-20T10:00:00Z", clientId: "recB", client: "Brasserie", lignes: "Mosselen × 2 kg [€5.00]", total: 10, paiement: "Payé", btwRegime: "Normal", creditnotas: [{ nummer: "CN-2026-0002", lignes: "Mosselen × 2 kg [€5.00]", montant: 10, le: "2026-01-05T10:00:00Z" }] },
  { id: "recO7", ref: "CMD-7", factuurnummer: "", statut: "Reçue", date: "2026-03-01", dateLiv: "2026-03-02", factureeLe: "", clientId: "recA", client: "Alpha", lignes: "Tong × 30 kg [€33.30]", total: 999, paiement: "En attente", btwRegime: "Normal", creditnotas: [] },
  { id: "recO8", ref: "CMD-8", factuurnummer: "FA-2026-0005", statut: "Facturée", date: "2026-06-30", dateLiv: "2026-07-01", factureeLe: "2026-07-01T10:00:00Z", clientId: "recB", client: "Brasserie", lignes: "Zeewier × 3", total: 12, paiement: "Payé", btwRegime: "Normal", creditnotas: [] }
];
const DATA = {
  orders: ORDERS,
  producten: [{ nom: "Tong", cat: "Poisson", unit: "kg" }, { nom: "Saus", cat: "Divers", unit: "pièce" }, { nom: "Mosselen", cat: "Coquillages", unit: "kg" }],
  klanten: [{ id: "recA", nom: "Alpha", regime: "Normal" }, { id: "recB", nom: "Brasserie", regime: "Normal" }, { id: "recC", nom: "Export SA", regime: "Export" }],
  btwPerProduct: { saus: 21 },
  config: { btwTarief: 6, betaaltermijnDagen: 14 }
};
const run = (state) => R.rapport(DATA, state, deps);

// ---------------------------------------------------------------- périodes
test("périodes : jaar, kwartaal, maand, vrij ; valeurs illisibles → année en cours", () => {
  assert.deepStrictEqual([R.periode({}, TODAY).van, R.periode({}, TODAY).tot, R.periode({}, TODAY).kind], ["2026-01-01", "2026-12-31", "jaar"]);
  const q = R.periode({ periode: "kwartaal", kwartaal: "2026-Q1" }, TODAY);
  assert.deepStrictEqual([q.van, q.tot], ["2026-01-01", "2026-03-31"]);
  const m = R.periode({ periode: "maand", maand: "2024-02" }, TODAY);
  assert.deepStrictEqual([m.van, m.tot], ["2024-02-01", "2024-02-29"], "février bissextile");
  const v = R.periode({ periode: "vrij", van: "2026-03-05", tot: "2026-03-20" }, TODAY);
  assert.deepStrictEqual([v.van, v.tot, v.kind], ["2026-03-05", "2026-03-20", "vrij"]);
  const bad = R.periode({ periode: "vrij", van: "2026-04-01", tot: "2026-03-01" }, TODAY);
  assert.equal(bad.kind, "jaar", "tot vóór van : repli sur l'année");
  assert.equal(R.periode({ periode: "maand", maand: "2026-13" }, TODAY).van, "2026-10-01", "mois illisible : mois en cours");
  assert.equal(R.periode({ periode: "kwartaal" }, TODAY).van, "2026-10-01", "trimestre en cours");
  assert.equal(R.periode({ periode: "jaar", jaar: "abc" }, TODAY).van, "2026-01-01");
});

test("comparaison : vorige periode (mois entiers ou jours), zelfde periode vorig jaar, geen", () => {
  const p = (s) => R.periode(s, TODAY);
  const prev = (s, c) => { const x = R.vergelijk(p(s), c); return x && [x.van, x.tot]; };
  assert.deepStrictEqual(prev({ periode: "jaar", jaar: "2026" }, "vorige"), ["2025-01-01", "2025-12-31"]);
  assert.deepStrictEqual(prev({ periode: "kwartaal", kwartaal: "2026-Q1" }, "vorige"), ["2025-10-01", "2025-12-31"]);
  assert.deepStrictEqual(prev({ periode: "maand", maand: "2026-03" }, "vorige"), ["2026-02-01", "2026-02-28"]);
  assert.deepStrictEqual(prev({ periode: "vrij", van: "2026-03-05", tot: "2026-03-20" }, "vorige"), ["2026-02-17", "2026-03-04"], "16 jours juste avant");
  assert.deepStrictEqual(prev({ periode: "vrij", van: "2026-02-01", tot: "2026-04-30" }, "vorige"), ["2025-11-01", "2026-01-31"], "3 mois entiers");
  assert.deepStrictEqual(prev({ periode: "maand", maand: "2026-03" }, "jaar"), ["2025-03-01", "2025-03-31"]);
  assert.deepStrictEqual(prev({ periode: "vrij", van: "2028-02-29", tot: "2028-03-10" }, "jaar"), ["2027-02-28", "2027-03-10"], "29 février → 28");
  assert.equal(R.vergelijk(p({}), "geen"), null);
  assert.deepStrictEqual(prev({}, "n'importe quoi"), ["2025-01-01", "2025-12-31"], "défaut : vorige periode");
  assert.deepStrictEqual(R.maanden("2025-11-15", "2026-02-03"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});

// ---------------------------------------------------------------- totaux
test("année 2026 : omzet, creditnota's à leur date, facturen, gemiddelde, klanten, btw par taux", () => {
  const r = run({ periode: "jaar", jaar: "2026" });
  assert.equal(r.kpi.facturen, 5, "o1 o2 o3 o4 o8 (o7 non facturée, o5 o6 en 2025)");
  near(r.kpi.bruto, 157, "factures brutes");
  assert.equal(r.kpi.creditnotas, 2); near(r.kpi.credit, 15, "CN-1 (mai) + CN-2 (janvier, facture de 2025)");
  near(r.kpi.omzet, 142, "omzet = factures − creditnota's");
  near(r.kpi.gemiddeld, 31.4, "gemiddelde factuur = brut / nombre");
  assert.equal(r.kpi.klanten, 3);
  const g = Object.fromEntries(r.btw.map((x) => [x.rate, x]));
  near(g[6].base, 107, "6 % : 60 + 20 + 30 + 12 − 5 − 10"); near(g[6].tva, 6.42);
  near(g[21].base, 10, "21 % : Saus (taux du produit)"); near(g[21].tva, 2.1);
  near(g[0].base, 25, "0 % : taux figés de la facture export"); near(g[0].tva, 0);
  near(r.kpi.btw, 8.52);
  // Mois : zéros compris, creditnota en déduction le mois de sa date, o2 en avril (Bruxelles).
  assert.equal(r.maanden.length, 12);
  const m = Object.fromEntries(r.maanden.map((x) => [x.key, x]));
  near(m["2026-01"].omzet, -10); near(m["2026-02"].omzet, 30); near(m["2026-03"].omzet, 70); near(m["2026-04"].omzet, 20);
  near(m["2026-05"].omzet, -5); near(m["2026-06"].omzet, 25); near(m["2026-07"].omzet, 12); near(m["2026-12"].omzet, 0);
  assert.equal(m["2026-03"].n, 1); assert.equal(m["2026-01"].n, 0, "une creditnota n'est pas une facture");
  near(m["2026-03"].vorigJaar, 40, "même mois un an plus tôt"); near(m["2026-12"].vorigJaar, 10);
  near(r.maanden.reduce((s, x) => s + x.omzet, 0), r.kpi.omzet, "les mois font le total");
});

test("klanten, producten, categorieën : creditnota's déduites, parts, lignes sans prix signalées", () => {
  const r = run({ periode: "jaar", jaar: "2026" });
  assert.deepStrictEqual(r.klanten.map((x) => [x.id, x.naam, x.n]), [["recA", "Alpha", 2], ["recB", "Brasserie", 2], ["recC", "Export SA", 1]]);
  near(r.klanten[0].omzet, 85); near(r.klanten[1].omzet, 32); near(r.klanten[2].omzet, 25);
  near(r.klanten.reduce((s, x) => s + x.aandeel, 0), 100, "parts en %");
  const p = Object.fromEntries(r.producten.map((x) => [x.key, x]));
  near(p.tong.qty, 4); near(p.tong.omzet, 115); assert.equal(p.tong.cat, "Vis", "catégorie traduite (K.cat)");
  near(p.mosselen.qty, 1, "4 − 1 − 2 crédités"); near(p.mosselen.omzet, 5);
  near(p.saus.omzet, 10); assert.equal(p.zeewier.noPrice, 1, "ligne sans prix comptée à part"); near(p.zeewier.omzet, 0);
  assert.equal(p.zeewier.cat, "Niet in catalogus");
  assert.equal(r.producten[0].key, "tong", "trié par omzet");
  const c = Object.fromEntries(r.categorieen.map((x) => [x.key, x.omzet]));
  near(c["Vis"], 115); near(c["Schelpdieren"], 5); near(c["Algemeen"], 10);
  assert.ok(r.families.length >= 1 && r.families.every((f) => typeof f.key === "string"));
});

test("comparaison : KPIs de la période précédente et écarts ; geen = sans comparaison", () => {
  const r = run({ periode: "jaar", jaar: "2026", vergelijk: "vorige" });
  near(r.kpiVorig.omzet, 50, "2025 : o5 40 + o6 10"); assert.equal(r.kpiVorig.facturen, 2);
  near(r.delta.omzet.abs, 92); near(r.delta.omzet.pct, 184);
  const q = run({ periode: "kwartaal", kwartaal: "2026-Q1" });
  near(q.kpi.omzet, 90, "Q1 : o3 30 + o1 70 − CN-2 10 ; o2 est en avril"); near(q.kpiVorig.omzet, 10, "Q4 2025 : o6");
  const m = run({ periode: "maand", maand: "2026-04" });
  near(m.kpi.omzet, 20); near(m.kpiVorig.omzet, 70, "mars");
  const v = run({ periode: "vrij", van: "2026-03-05", tot: "2026-03-20", vergelijk: "jaar" });
  near(v.kpi.omzet, 70); near(v.kpiVorig.omzet, 40, "même période 2025 : o5");
  const z = run({ periode: "vrij", van: "2026-03-05", tot: "2026-03-20", vergelijk: "vorige" });
  near(z.kpiVorig.omzet, 0); assert.equal(z.delta.omzet.pct, null, "pas de % sur une base nulle");
  const g = run({ periode: "jaar", jaar: "2026", vergelijk: "geen" });
  assert.equal(g.kpiVorig, null); assert.equal(g.delta.omzet, null);
});

test("filtres : klant, product, categorie, betaling, regime, q", () => {
  const a = run({ jaar: "2026", klant: "recA" });
  near(a.kpi.omzet, 85); assert.equal(a.kpi.facturen, 2); assert.equal(a.kpi.klanten, 1);
  const t = run({ jaar: "2026", product: "tong" });
  near(t.kpi.omzet, 115, "lignes Tong seulement"); assert.equal(t.kpi.facturen, 3, "factures qui contiennent du Tong");
  near(t.kpiVorig.omzet, 40); assert.deepStrictEqual(t.producten.map((x) => x.key), ["tong"]);
  const s = run({ jaar: "2026", categorie: "Schelpdieren" });
  near(s.kpi.omzet, 5, "Mosselen 20 − 5 − 10"); assert.equal(s.kpi.facturen, 1);
  const o = run({ jaar: "2026", betaling: "open" });
  near(o.kpi.omzet, 45, "o2 20 + o3 30 − CN-1 5 (CN-2 : facture payée)"); assert.equal(o.kpi.facturen, 2);
  const b = run({ jaar: "2026", betaling: "betaald" });
  near(b.kpi.omzet, 70 + 25 + 12 - 10);
  const e = run({ jaar: "2026", regime: "Export" });
  near(e.kpi.omzet, 25); assert.equal(e.kpi.facturen, 1);
  const q = run({ jaar: "2026", q: "fa-2026-0003" });
  near(q.kpi.omzet, 30); assert.equal(q.facturen.length, 1);
  const w = run({ jaar: "2026", q: "alpha mosselen" });
  near(w.kpi.omzet, 15, "tous les mots : o2 20 − CN-1 5");
  // Openstaand : toutes années, filtres de commande ; vervallen d'après le délai de paiement.
  const r = run({ jaar: "2026" });
  near(r.kpi.openstaand, 50); assert.equal(r.kpi.openN, 2); assert.equal(r.kpi.vervallenN, 2);
  assert.deepStrictEqual(r.open.map((x) => x.id).sort(), ["recO2", "recO3"]);
  near(r.open.find((x) => x.id === "recO2").incl, 21.2, "incl. btw 6 %");
  near(run({ jaar: "2025", klant: "recB" }).kpi.openstaand, 30, "openstaand ne dépend pas de la période");
  // Options des filtres.
  assert.deepStrictEqual(r.opties.klanten.map((x) => x.id), ["recA", "recB", "recC"]);
  assert.ok(r.opties.producten.some((x) => x.key === "zeewier"));
  assert.deepStrictEqual(r.opties.regimes.sort(), ["Export", "Normal"]);
});

test("liste des factures et creditnota's de la période : montant, incl. btw, type", () => {
  const r = run({ jaar: "2026" });
  assert.equal(r.facturen.length, 7, "5 factures + 2 creditnota's");
  const cn = r.facturen.find((x) => x.nummer === "CN-2026-0002");
  assert.equal(cn.type, "creditnota"); near(cn.bedrag, -10); near(cn.incl, -10.6); assert.equal(cn.dag, "2026-01-05"); assert.equal(cn.id, "recO6");
  const o1 = r.facturen.find((x) => x.id === "recO1" && x.type === "factuur");
  near(o1.incl, 70 + 3.6 + 2.1); assert.equal(o1.dag, "2026-03-10");
  assert.equal(r.facturen.find((x) => x.id === "recO3").dag, "2026-02-15", "sans factuurdatum : leverdatum");
});

// ---------------------------------------------------------------- tri et CSV
test("tri : nombres comme nombres, textes naturels, vides en dernier dans les deux sens", () => {
  const rows = [{ n: 10, t: "Zalm 16/20" }, { n: 9, t: "Zalm 8/12" }, { n: null, t: "" }, { n: 100, t: "aal" }];
  assert.deepStrictEqual(R.sortRows(rows, "n", "asc").map((x) => x.n), [9, 10, 100, null]);
  assert.deepStrictEqual(R.sortRows(rows, "n", "desc").map((x) => x.n), [100, 10, 9, null]);
  assert.deepStrictEqual(R.sortRows(rows, "t", "asc").map((x) => x.t), ["aal", "Zalm 8/12", "Zalm 16/20", ""]);
  assert.deepStrictEqual(rows.map((x) => x.n), [10, 9, null, 100], "la liste d'origine n'est pas modifiée");
});

test("CSV : BOM, point-virgule, virgule décimale, CRLF, cellules protégées sauf nombres purs", () => {
  const out = R.csv([["Klant", "Omzet"], ["=HYPERLINK(1)", R.csvNum(-12.5)], ["a;b \"c\"", R.csvNum(1234.567)], ["-x", R.csvNum(null)]]);
  assert.ok(out.startsWith("﻿"));
  assert.deepStrictEqual(out.slice(1).split("\r\n"), ["Klant;Omzet", "'=HYPERLINK(1);-12,50", "\"a;b \"\"c\"\"\";1234,57", "'-x;"]);
});

// ---------------------------------------------------------------- API
const H = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const as = (role, name, gen) => Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role, name, gen)) }, H);
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; }
async function call(file, opts) { const o = opts || {}; const res = mkRes(); await require(path.join(ROOT, "api", file))({ method: o.method || "GET", body: o.body, headers: o.headers || {}, query: o.query || {} }, res); return res; }
const rec = (id, fields) => ({ id, createdTime: "2026-01-01T00:00:00.000Z", fields });
const store = () => ds.state.store;
async function seedDb() {
  auth.noteGeneration(0);
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO", "BTW-tarief": 6, "Betaaltermijn dagen": 21 })]);
  await store().replaceAll("Clients", [rec("recA0000000001", { Nom: "Alpha", Wachtwoord: "geheim-hash" }), rec("recC0000000001", { Nom: "Export SA", "Régime TVA": "Export" })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Catégorie": "Poisson", "Unité": "kg", "Prix de base": 30 }), rec("recP2", { Produit: "Saus", "Catégorie": "Divers", "Unité": "pièce", "BTW-tarief": 21 })]);
  await store().replaceAll("Lots", [rec("recL1", { Lotnummer: "L-1", Produit: "Tong", "Ontvangen op": "2026-01-01", Aankoopprijs: 20, Actief: true })]);
  await store().replaceAll("Stock", []);
  await store().replaceAll("Medewerkers", [rec("recPIET", { Naam: "Piet", Rol: "personeel", "PIN hash": "h-piet", Actief: true }), rec("recANN", { Naam: "Ann", Rol: "beheerder", "PIN hash": "h-ann", Actief: true })]);
  await store().replaceAll("Commandes", [
    rec("recO1000000001", { "Référence": "CMD-1", Statut: "Facturée", "Statut paiement": "En attente", Total: 70, Client: ["recA0000000001"], Factuurnummer: "FA-2026-0001", "Facturée le": "2026-03-10T09:00:00Z", "Date": "2026-03-08", "Date livraison souhaitée": "2026-03-09", "Lignes (produits / quantités)": "Tong × 2 kg [€30.00]\nSaus × 1 pièce [€10.00]", "BTW per lijn": JSON.stringify({ tong: 6, saus: 21 }), Notes: "geheime notitie", Idempotentie: "sleutel-1" }),
    rec("recO2000000001", { "Référence": "CMD-2", Statut: "Facturée", "Statut paiement": "Payé", Total: 25, Client: ["recC0000000001"], Factuurnummer: "FA-2026-0002", "Facturée le": "2026-04-10T09:00:00Z", "Lignes (produits / quantités)": "Tong × 1 kg [€25.00]", "Régime TVA": "Export", "Creditnota nummer": "CN-2026-0001", "Creditnota lignes": "Tong × 1 kg [€25.00]", "Creditnota montant": 25, "Creditnota le": "2026-04-12T09:00:00Z" }),
    rec("recO3000000001", { "Référence": "CMD-3", Statut: "Reçue", "Statut paiement": "En attente", Total: 30, Client: ["recA0000000001"], "Lignes (produits / quantités)": "Tong × 1 kg [€30.00]" }),
    rec("recO4000000001", { "Référence": "CMD-4", Statut: "Facturée", "Statut paiement": "En attente", Total: 500, Client: ["recA0000000001"], Factuurnummer: "FA-2026-0003", "Facturée le": "2026-03-11T09:00:00Z", "Lignes (produits / quantités)": "Tong × 10 kg [€50.00]", Test: true, "Test gemarkeerd op": "2026-09-01T00:00:00Z" })
  ]);
}

test("api/rapportage : beheerder seul (401 sans session, 403 personnel par code ou par PIN, 405 hors GET)", async () => {
  await seedDb();
  assert.equal((await call("rapportage.js")).statusCode, 401);
  const staff = await call("rapportage.js", { headers: as("staff") });
  assert.equal(staff.statusCode, 403); assert.ok(!staff.payload.orders);
  const pin = await call("rapportage.js", { headers: as("staff", "Piet", { g: 0, med: "recPIET", pfp: auth.pinFingerprint("h-piet") }) });
  assert.equal(pin.statusCode, 403, "PIN personnel refusé");
  const ann = await call("rapportage.js", { headers: as("admin", "Ann", { g: 0, med: "recANN", pfp: auth.pinFingerprint("h-ann") }) });
  assert.equal(ann.statusCode, 200, "PIN beheerder accepté");
  assert.equal((await call("rapportage.js", { method: "POST", headers: as("admin") })).statusCode, 405);
  // Marge : déjà beheerder seul (personnel et PIN personnel refusés).
  assert.equal((await call("marge.js", { headers: as("staff") })).statusCode, 401);
  assert.equal((await call("marge.js", { headers: as("staff", "Piet", { g: 0, med: "recPIET", pfp: auth.pinFingerprint("h-piet") }) })).statusCode, 401);
});

test("api/rapportage : factures et commandes avec creditnota, sans les commandes test ni champs inutiles", async () => {
  await seedDb();
  const r = await call("rapportage.js", { headers: as("admin") });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const d = r.payload;
  assert.deepStrictEqual(d.orders.map((o) => o.ref).sort(), ["CMD-1", "CMD-2"], "ni la commande Reçue, ni la commande test");
  const o1 = d.orders.find((o) => o.ref === "CMD-1");
  assert.deepStrictEqual(Object.keys(o1).sort(), ["btwFrozen", "btwRegime", "client", "clientId", "creditnotas", "date", "dateLiv", "factureeLe", "factuurnummer", "id", "lignes", "paiement", "payeLe", "ref", "statut", "total"]);
  assert.equal(o1.client, "Alpha"); assert.deepStrictEqual(o1.btwFrozen, { tong: 6, saus: 21 });
  const o2 = d.orders.find((o) => o.ref === "CMD-2");
  assert.equal(o2.btwRegime, "Export"); assert.deepStrictEqual(o2.creditnotas.map((n) => [n.nummer, n.montant]), [["CN-2026-0001", 25]]);
  assert.deepStrictEqual(d.producten.map((p) => [p.nom, p.cat, p.unit]), [["Tong", "Poisson", "kg"], ["Saus", "Divers", "pièce"]]);
  assert.deepStrictEqual(d.btwPerProduct, { saus: 21 });
  assert.equal(d.config.btwTarief, 6); assert.equal(d.config.betaaltermijnDagen, 21);
  assert.deepStrictEqual(d.klanten.map((k) => [k.id, k.nom, k.regime]), [["recA0000000001", "Alpha", "Normal"], ["recC0000000001", "Export SA", "Export"]]);
  const txt = JSON.stringify(d);
  for (const secret of ["geheime notitie", "geheim-hash", "sleutel-1", "h-piet"]) assert.ok(!txt.includes(secret), "pas de " + secret);
  // Le module agrège ce que l'API renvoie : omzet mars–avril = 70 + 25 − 25.
  const rep = R.rapport(d, { periode: "vrij", van: "2026-03-01", tot: "2026-04-30" }, deps);
  near(rep.kpi.omzet, 70); assert.equal(rep.kpi.facturen, 2);
});

test("marge par client : lib/margin et /api/marge?klant=", async () => {
  await seedDb();
  const all = await call("marge.js", { headers: as("admin"), query: { van: "2026-01-01", tot: "2026-12-31" } });
  assert.equal(all.statusCode, 200);
  near(all.payload.totaal.omzet, 95); near(all.payload.totaal.credit, 25);
  const a = await call("marge.js", { headers: as("admin"), query: { van: "2026-01-01", tot: "2026-12-31", klant: "recA0000000001" } });
  near(a.payload.totaal.omzet, 70, "Alpha seule"); near(a.payload.totaal.credit, 0, "la creditnota d'Export SA n'est pas à Alpha");
  near(a.payload.totaal.kost, 2 * 20, "Tong au dernier prix d'achat ; Saus sans prix");
  const c = await call("marge.js", { headers: as("admin"), query: { van: "2026-01-01", tot: "2026-12-31", klant: "recC0000000001" } });
  near(c.payload.totaal.omzet, 25); near(c.payload.totaal.credit, 25);
  const bad = await call("marge.js", { headers: as("admin"), query: { van: "2026-01-01", tot: "2026-12-31", klant: "x' OR 1" } });
  near(bad.payload.totaal.omzet, 95, "identifiant illisible : ignoré");
  const m = margin.compute({ van: "2026-01-01", tot: "2026-12-31", klant: "recZ", orders: [], lots: [], catalogue: [], stock: [] });
  assert.equal(m.orders, 0);
});

test("Betaald depuis la Rapportage : l'action existante (payload de la page), beheerder seul, journalisée", async () => {
  await seedDb();
  const page = read("assets/pages/beheer/rapportage.js");
  assert.match(page, /K\.api\("\/api\/updateorder", \{ json: \{ id: [\w.]+, paiement: "Payé", modePaiement: \w+ \} \}\)/, "la page envoie l'action existante");
  assert.match(page, /paiement: "En attente", reden: /, "Ongedaan maken avec une raison");
  const body = { id: "recO1000000001", paiement: "Payé", modePaiement: "Overschrijving" };
  const staff = await call("updateorder.js", { method: "POST", headers: as("staff"), body });
  assert.equal(staff.statusCode, 403, "le personnel n'encaisse pas");
  const ok = await call("updateorder.js", { method: "POST", headers: as("admin"), body });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload));
  const f = (await store().get("Commandes", "recO1000000001")).fields;
  assert.equal(f["Statut paiement"], "Payé"); assert.equal(f["Mode de paiement"], "Overschrijving");
  assert.match(f.Correcties, /Betaald \(Overschrijving\)/);
  const j = (await store().list("Journaal")).map((x) => x.fields).find((x) => x.Actie === "Betaalstatus: Payé" && x.Record === "recO1000000001");
  assert.ok(j, "ligne du journal d'audit");
  const back = await call("updateorder.js", { method: "POST", headers: as("admin"), body: { id: "recO1000000001", paiement: "En attente", reden: "Betaling meteen ongedaan gemaakt" } });
  assert.equal(back.statusCode, 200);
  assert.equal((await store().get("Commandes", "recO1000000001")).fields["Statut paiement"], "En attente");
  const notInvoiced = await call("updateorder.js", { method: "POST", headers: as("admin"), body: { id: "recO3000000001", paiement: "Payé" } });
  assert.equal(notInvoiced.statusCode, 409, "jamais sur une commande non facturée");
});

// ---------------------------------------------------------------- page et navigation
test("navigation : Rapportage dans la barre du beheerder seulement, page propre, ancien lien redirigé", () => {
  const ui = read("assets/ui.js");
  assert.match(ui, /const NAV_ADMIN\s*=\s*\[[^;]*\["rapportage\.html",\s*"\/beheer\/rapportage",\s*"Rapportage",\s*"chart"\][^;]*\["beheer\.html"/, "Rapportage avant Beheer");
  assert.ok(!/const NAV_STAFF_MORE\s*=[^;]*rapportage/.test(ui), "pas pour le personnel");
  assert.match(ui, /chart: '<path/, "icône");
  const html = read("beheer/rapportage.html");
  for (const s of ["/assets/vat.js", "/assets/rapport.js", "/assets/ui.js", "/assets/pages/staff-common.js", "/assets/pages/beheer/rapportage.js", "/assets/ui.css"]) assert.ok(html.includes(s), s);
  assert.match(html, /<html lang="nl">/); assert.match(html, /<title>[^<]*Rapportage<\/title>/);
  const page = read("assets/pages/beheer/rapportage.js");
  assert.match(page, /K\.requireStaff\(\{ admin: true \}\)/);
  assert.match(page, /K\.api\("\/api\/rapportage"\)/); assert.ok(!/\/api\/allorders/.test(page), "plus d'allorders pour les chiffres");
  assert.match(page, /FamoRapport\.rapport\(/); assert.match(page, /role="img"/); assert.match(page, /aria-sort/);
  assert.match(page, /history\.pushState/); assert.match(page, /popstate/);
  const beheer = read("assets/pages/beheer.js");
  assert.match(beheer, /location\.replace\("\/beheer\/rapportage"\)/, "#/rapportage redirigé");
  assert.ok(!/function margeCard|async function rapportage/.test(beheer), "ancienne vue retirée");
  assert.match(read("scripts/check.js"), /"assets\/pages\/beheer"/, "check.js contrôle aussi assets/pages/beheer/");
  assert.ok(read("scripts/ux-audit.js").includes("/beheer/rapportage"));
  assert.ok(read("scripts/kbd-audit.js").includes("/beheer/rapportage"));
});
