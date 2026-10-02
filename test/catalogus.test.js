"use strict";
// Spec 019 : catalogue client — familles, tris, recherche et préférence d'affichage (aides pures de assets/ui.js).
const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "assets", "ui.js"), "utf8");
const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: null, localStorage: null, addEventListener() {} };
vm.runInNewContext(src, Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => ({}) }));
const K = win.K;
const plain = v => JSON.parse(JSON.stringify(v)); // objets du contexte vm → objets locaux

test("familyKey : mots avant le kaliber, sans casse, sans poids ni unité", () => {
  const cases = {
    "BLACK TIGER GARNALEN 8-12": "black tiger garnalen",
    "Black Tiger Garnalen 13/15": "black tiger garnalen",
    "BLACK TIGER GARNALEN BLOK 13-15": "black tiger garnalen blok",
    "VANNAMEI GARNALEN 16-20 EP": "vannamei garnalen",
    "VANNAMEI GARNALEN GEPELD 16/20": "vannamei garnalen gepeld",
    "SCAMPI U10": "scampi",
    "Scampi U/15": "scampi",
    "Zeebaars heel 400-600": "zeebaars heel",
    "ZALMFILET 1KG": "zalmfilet",
    "Zalmfilet 2,5 kg": "zalmfilet",
    "INKTVIS RINGEN 10x1kg": "inktvis ringen",
    "Surimi sticks 500 g": "surimi sticks",
    "Oesters Zeeuwse creuse nr. 3": "oesters zeeuwse creuse",
    "Moules (caisse)": "moules",
    "  Saumon   frais ": "saumon frais",
    "Kreeft kg": "kreeft",
    "1KG GARNALEN": "garnalen",
    "": ""
  };
  for (const [name, key] of Object.entries(cases)) assert.equal(K.familyKey(name), key, JSON.stringify(name));
});

const P = (id, nom, extra) => Object.assign({ id, nom }, extra || {});
// Une grande catégorie « Algemeen » comme en production (noms en capitales, kaliber dans le nom).
const ALGEMEEN = [
  P("a1", "BLACK TIGER GARNALEN 8-12"), P("a2", "BLACK TIGER GARNALEN 13-15"), P("a3", "BLACK TIGER GARNALEN 16-20"),
  P("b1", "BLACK TIGER GARNALEN BLOK 8-12"), P("b2", "BLACK TIGER GARNALEN BLOK 13-15"),
  P("c1", "VANNAMEI GARNALEN 16-20 EP"), P("c2", "VANNAMEI GARNALEN 26-30"), P("c3", "VANNAMEI GARNALEN 31-40"),
  P("d1", "VANNAMEI GARNALEN GEPELD 16/20"), P("d2", "VANNAMEI GARNALEN GEPELD 26/30"),
  P("e1", "SCAMPI U10"), P("e2", "SCAMPI 16/20"),
  P("f1", "INKTVIS RINGEN 1KG"), P("f2", "INKTVIS TUBES U5"), P("f3", "INKTVIS TUBES U10"),
  P("g1", "MOSSELVLEES 1KG"), P("h1", "BLACK TIGER GARNALEN GEPELD 21-25")
];

test("families : les familles d'au moins deux produits, le reste en Overige, chaque id une fois", () => {
  const r = plain(K.families(ALGEMEEN));
  assert.ok(r, "17 produits, plusieurs familles : affiché");
  assert.deepStrictEqual(r.families.map(f => f.key), ["black tiger garnalen", "black tiger garnalen blok", "vannamei garnalen", "vannamei garnalen gepeld", "scampi", "inktvis"]);
  // libellé : casse de phrase quand le nom est en capitales
  assert.deepStrictEqual(r.families.map(f => f.label), ["Black tiger garnalen", "Black tiger garnalen blok", "Vannamei garnalen", "Vannamei garnalen gepeld", "Scampi", "Inktvis"]);
  // « BLACK TIGER GARNALEN GEPELD 21-25 » (seul) prolonge « black tiger garnalen » : il la rejoint
  assert.deepStrictEqual(r.families[0].ids, ["a1", "a2", "a3", "h1"]);
  // « INKTVIS RINGEN » (seul) + « INKTVIS TUBES » (2) : même premier mot → une famille « Inktvis »
  assert.deepStrictEqual(r.families[5].ids, ["f1", "f2", "f3"]);
  assert.deepStrictEqual(r.rest, ["g1"], "MOSSELVLEES seul → Overige");
  const all = r.families.flatMap(f => f.ids).concat(r.rest).sort();
  assert.deepStrictEqual(all, ALGEMEEN.map(p => p.id).sort(), "chaque produit une et une seule fois");
});

test("families : masquées si ≤ 12 produits, si < 3 ou > 12 familles", () => {
  assert.equal(K.families(ALGEMEEN.slice(0, 12)), null, "12 produits : pas de familles");
  assert.equal(K.families([]), null);
  assert.equal(K.families(null), null);
  // 14 produits en deux familles seulement
  const two = Array.from({ length: 7 }, (_, i) => P("x" + i, "ZALM " + (i + 1) + "KG")).concat(Array.from({ length: 7 }, (_, i) => P("y" + i, "KABELJAUW " + (i + 1) + "KG")));
  assert.equal(K.families(two), null, "2 familles : rien");
  // 14 produits tous différents : aucune famille de 2
  const solo = ["Zalm", "Kabeljauw", "Tong", "Schol", "Heek", "Tarbot", "Griet", "Zeeduivel", "Rog", "Wijting", "Poon", "Makreel", "Haring", "Sprot"].map((n, i) => P("s" + i, n));
  assert.equal(K.families(solo), null);
  // seuils réglables
  assert.ok(K.families(ALGEMEEN.slice(0, 12), { min: 10 }), "opts.min");
});

test("families : plus de 12 familles → regroupement par premier mot", () => {
  const words = ["ZALM", "KABELJAUW", "TONG", "SCHOL"];
  const list = [];
  // 4 premiers mots × 4 variantes × 2 kalibers = 16 familles fines de 2 produits
  words.forEach((w, i) => ["FILET", "MOOT", "HEEL", "GEROOKT"].forEach((v, j) => ["1KG", "2KG"].forEach((k, n) => list.push(P(w + j + n, w + " " + v + " " + k)))));
  const r = plain(K.families(list));
  assert.ok(r, "repli grossier");
  assert.deepStrictEqual(r.families.map(f => f.label), ["Zalm", "Kabeljauw", "Tong", "Schol"]);
  assert.equal(r.families[0].ids.length, 8);
  assert.deepStrictEqual(r.rest, []);
});

test("families : libellé en casse d'origine si le nom n'est pas en capitales", () => {
  const list = ["Zalm filet 1kg", "Zalm filet 2kg", "Zalm moot 1kg", "Zalm moot 2kg", "Tong filet 1kg", "Tong filet 2kg", "Schol 1kg", "Schol 2kg", "Heek 1kg", "Heek 2kg", "Rog 1kg", "Rog 2kg", "Poon"].map((n, i) => P("z" + i, n));
  const r = plain(K.families(list));
  assert.deepStrictEqual(r.families.map(f => f.label), ["Zalm filet", "Zalm moot", "Tong filet", "Schol", "Heek", "Rog"]);
  assert.deepStrictEqual(r.rest, ["z12"]);
});

test("families : un nom hostile reste une donnée — libellé brut, toujours écrit via K.esc dans le portail", () => {
  const evil = '<img src=x onerror="alert(1)"> GARNALEN';
  const list = ALGEMEEN.slice(0, 12).concat([P("x1", evil + " 8-12"), P("x2", evil + " 13-15")]);
  const r = plain(K.families(list));
  const fam = r.families.find(f => f.ids.includes("x1"));
  assert.ok(fam, "les deux produits hostiles forment une famille");
  assert.equal(fam.label.indexOf("<img"), 0, "K.families ne transforme pas le texte (l'échappement se fait à l'affichage)");
  assert.ok(!/[<>"]/.test(K.esc(fam.label)), "K.esc neutralise le libellé");
  // Le portail écrit libellés, catégories, noms et terme de recherche par K.esc (contrat textuel, spec 019 FR-005/006).
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "pages", "klant.js"), "utf8");
  assert.match(src, /'<button type="button" data-fam="' \+ K\.esc\(key\)[^\n]*K\.esc\(label\)/, "familles : clé et libellé échappés");
  assert.match(src, /'<h2 class="sec">' \+ K\.esc\(K\.t\(g\)\)/, "titres de groupe échappés");
  assert.match(src, /<span class="pn">' \+ K\.esc\(p\.nom\)/, "noms échappés");
  assert.match(src, /K\.c\.empty\(K\.t\("Niets gevonden voor"\) \+ " „" \+ q\.trim\(\) \+ "”"/, "terme de recherche réaffiché via K.c.empty (qui échappe)");
  assert.match(fs.readFileSync(path.join(__dirname, "..", "assets", "ui.js"), "utf8"), /c\.empty = \(title, text, action\) => '[^\n]*K\.esc\(title\)/, "K.c.empty échappe son titre");
});

test("catalogSort : Standaard (Beheer), Naam (kaliber numérique), Prijs ↑ / ↓ (prix absent en dernier)", () => {
  const list = [
    P("p1", "Scampi 21/25", { volgorde: 3, prix: 15 }),
    P("p2", "scampi 8/12", { volgorde: 1, prix: 18 }),
    P("p3", "Zalm", { volgorde: 2, prix: 15 }),
    P("p4", "Kreeft", { volgorde: 4 }),
    P("p5", "Scampi 13/15", { volgorde: 5, prix: 9.5 })
  ];
  const ids = mode => list.slice().sort(K.catalogSort(mode)).map(p => p.id);
  assert.deepStrictEqual(ids("standaard"), ["p2", "p3", "p1", "p4", "p5"]);
  assert.deepStrictEqual(ids("naam"), ["p4", "p2", "p5", "p1", "p3"], "8/12 < 13/15 < 21/25, sans casse");
  assert.deepStrictEqual(ids("prijs-op"), ["p5", "p1", "p3", "p2", "p4"], "à prix égal : par nom ; sans prix : à la fin");
  assert.deepStrictEqual(ids("prijs-af"), ["p2", "p1", "p3", "p5", "p4"], "sans prix : à la fin aussi");
  assert.deepStrictEqual(ids("onbekend"), ids("standaard"), "mode inconnu → Standaard");
  assert.deepStrictEqual(Array.from(K.CATALOG_SORTS), ["standaard", "naam", "prijs-op", "prijs-af"]);
  assert.deepStrictEqual(Array.from(K.CATALOG_VIEWS), ["lijst", "tegels", "compact"]);
});

test("searchKey / searchHit : sans casse ni accents, 16-20 = 16/20, tous les mots", () => {
  const hay = K.searchKey("BLACK TIGER GARNALEN BLOK 13-15 · Crevettes décortiquées");
  assert.ok(K.searchHit(hay, K.searchKey("blok 13/15")));
  assert.ok(K.searchHit(hay, K.searchKey("tiger 13")), "mots dans le désordre, partiels");
  assert.ok(K.searchHit(hay, K.searchKey("DECORTIQUEES")), "accents ignorés");
  assert.ok(K.searchHit(hay, K.searchKey("13 - 15")), "espaces autour du tiret");
  assert.ok(!K.searchHit(hay, K.searchKey("vannamei 13")), "tous les mots doivent y être");
  assert.ok(K.searchHit(hay, K.searchKey("   ")), "recherche vide : tout");
});

test("pref : valeur retenue par appareil, inconnue → défaut, stockage absent ou bloqué → défaut sans erreur", () => {
  const mem = new Map();
  win.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const view = K.pref("famoKlantWeergave", K.CATALOG_VIEWS, "lijst");
  assert.equal(view.get(), "lijst", "rien de stocké");
  view.set("tegels");
  assert.equal(view.get(), "tegels");
  assert.equal(mem.get("famoKlantWeergave"), JSON.stringify("tegels"));
  view.set("raar");
  assert.equal(view.get(), "tegels", "valeur refusée : rien ne change");
  mem.set("famoKlantWeergave", "{pas du json");
  assert.equal(view.get(), "lijst", "valeur corrompue → défaut");
  mem.set("famoKlantWeergave", JSON.stringify("compact"));
  assert.equal(view.get(), "compact");
  // Navigation privée stricte : l'accès au stockage lève une exception.
  win.localStorage = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceededError"); }, removeItem() { throw new Error("SecurityError"); } };
  assert.equal(view.get(), "lijst");
  assert.doesNotThrow(() => view.set("compact"));
  assert.equal(view.get(), "lijst");
  // Pas de stockage du tout.
  win.localStorage = null;
  assert.equal(K.pref("famoKlantSortering", K.CATALOG_SORTS, "standaard").get(), "standaard");
  assert.doesNotThrow(() => K.pref("famoKlantSortering", K.CATALOG_SORTS, "standaard").set("naam"));
});

test("textes du catalogue traduits (FR)", () => {
  for (const k of ["Weergave", "Lijst", "Tegels", "Compact", "Sorteren", "Standaard", "Naam A–Z", "Prijs ↑", "Prijs ↓", "Naar boven", "Zoekterm wissen", "Soort", "Alle", "Overige", "{n} producten", "1 product"]) assert.ok(K.FR[k], "FR manquant : " + k);
});
