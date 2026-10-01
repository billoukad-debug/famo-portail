const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
// Charge staff-company.js puis documents.js dans un faux window (mêmes helpers purs que le navigateur).
function load() {
  const win = { console, Intl, Date };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "vat.js"), "utf8"), win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "staff-company.js"), "utf8"), win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "documents.js"), "utf8"), win);
  return win.FamoDocuments;
}
// Mode « portaal » : le portail émet la facture (tests historiques de la facture). Le mode par défaut
// « boekhouder » (pro forma) est testé à la fin du fichier.
const CFG = { bedrijfsnaam: "Famo Trading BV", adres: "Jezusstraat 34", plaats: "2000 Antwerpen", btw: "BE0788705713", iban: "BE71096123456769", bic: "GKCCBEBB", btwTarief: 6, facturatie: "portaal" };
const meta = (html, label) => (new RegExp('<div class="metalabel">' + label + '</div><div class="metavalue[^"]*">([^<]+)</div>').exec(html) || [])[1];
const row = (html, label) => (new RegExp('<div class="trow[^"]*"><span>' + label + '(?:<small>[^<]*</small>)?</span><span>([^<]+)</span></div>').exec(html) || [])[1];
const ORDER = { ref: "CMD-2026-0500", client: "Resto Test", factuurnummer: "FA-2026-0500", lignes: "Kabeljauw × 5 kg [€20.00]", total: 100, factureeLe: "2026-03-10T09:30:00.000Z", klant: { klantnr: "K-0042", btw: "BE0123456789" } };

test("factuurdatum = Facturée le, vervaldatum = +14 dagen (standaard) of +30", () => {
  const D = load();
  D.setCompany(CFG);
  const f = D.build(ORDER, "invoice");
  assert.equal(meta(f, "Factuurdatum"), "10/03/2026");
  assert.equal(meta(f, "Vervaldatum"), "24/03/2026");
  assert.equal(meta(f, "Klantnummer"), "K-0042");
  assert.match(f, /BTW BE0123456789/);
  assert.match(f, /\+\+\+202\/6000\/50009\+\+\+/);
  assert.ok(!/Betaalstatus/.test(f), "pas de betaalstatus tant que non payé");
  D.setCompany({ ...CFG, betaaltermijnDagen: 30 });
  assert.equal(D.getCompany().betaaltermijnDagen, 30);
  assert.equal(meta(D.build(ORDER, "invoice"), "Vervaldatum"), "09/04/2026");
  const paid = D.build({ ...ORDER, paiement: "Payé", payeLe: "2026-03-20" }, "invoice");
  assert.equal(meta(paid, "Betaalstatus"), "Betaald op 20/03/2026");
});

test("btw gemengd : één rij per tarief (6 % en 21 %), totalen kloppen", () => {
  const D = load();
  D.setCompany(CFG);
  const o = { ...ORDER, lignes: "Saumon frais × 2 kg [€10.00]\nScampi × 1 caisse [€50.00]\nKabeljauw × 1 kg [€20.00]", total: 90, btwPerLine: { "saumon frais": 6, "Scampi ": 21 } };
  const f = D.build(o, "invoice");
  assert.equal(row(f, "Totaal excl\\. btw"), "€ 90,00");
  assert.equal(row(f, "btw 6% "), "€ 2,40", "6 % sur 20 + 20 (Kabeljauw : tarief bedrijf)");
  assert.equal(row(f, "btw 21% "), "€ 10,50", "21 % sur 50");
  assert.equal(row(f, "Totaal incl\\. btw"), "€ 102,90");
  assert.match(f, /btw 21% <small>\(op € 50,00\)<\/small>/);
});

test("btw enkel tarief : 6 % op het totaal zoals voorheen (geen btwPerLine)", () => {
  const D = load();
  D.setCompany(CFG);
  const f = D.build(ORDER, "invoice");
  assert.equal(row(f, "Totaal excl\\. btw"), "€ 100,00");
  assert.equal(row(f, "btw 6%"), "€ 6,00");
  assert.equal(row(f, "Totaal incl\\. btw"), "€ 106,00");
  assert.equal((f.match(/<span>btw /g) || []).length, 1);
  // Anciennes commandes sans prix de ligne : TVA sur le total stocké (avec prix : somme des lignes, EN 16931).
  const r = D.build({ ...ORDER, lignes: "Kabeljauw × 5 kg", total: 12.35 }, "invoice");
  assert.equal(row(r, "btw 6%"), "€ 0,74");
  assert.equal(row(r, "Totaal incl\\. btw"), "€ 13,09");
});

test("creditnota : fout zonder creditnota, echt nummer en negatieve bedragen met creditnota", () => {
  const D = load();
  D.setCompany(CFG);
  assert.throws(() => D.build(ORDER, "credit"), /Nog geen creditnota voor deze bestelling\./);
  assert.throws(() => D.build({ ...ORDER, creditnota: { lignes: "x × 1" } }, "credit"), /Nog geen creditnota/);
  const o = { ...ORDER, creditnota: { nummer: "CN-2026-0001", lignes: "Kabeljauw × 2 kg [€20.00]", montant: 40, le: "2026-03-12T08:00:00.000Z", motif: "Beschadigde levering" } };
  assert.equal(D.number(o, "credit"), "CN-2026-0001");
  assert.equal(D.number(ORDER, "credit"), "CN-2026-0500");
  const c = D.build(o, "credit");
  assert.match(c, /<h1>CREDITNOTA<\/h1>/);
  assert.ok(!/VOORBEELD|Voorbeeld — niet geboekt|intern document/i.test(c));
  assert.equal(meta(c, "Document"), "CN-2026-0001");
  assert.equal(meta(c, "Creditnotadatum"), "12/03/2026");
  assert.equal(meta(c, "Factuur"), "FA-2026-0500");
  assert.equal(row(c, "Totaal excl\\. btw"), "€ -40,00");
  assert.equal(row(c, "btw 6%"), "€ -2,40");
  assert.equal(row(c, "Totaal incl\\. btw"), "€ -42,40");
  assert.match(c, /Creditnota op factuur FA-2026-0500\. Reden: Beschadigde levering\./);
  assert.equal(D.filename(o, "credit"), "Famo-Creditnota-CN-2026-0001.pdf");
});

test("buildMany : twee documenten, één style, pagina-einde ertussen", () => {
  const D = load();
  D.setCompany(CFG);
  const html = D.buildMany([ORDER, { ...ORDER, ref: "CMD-2026-0501", factuurnummer: "" }], "delivery");
  assert.equal((html.match(/<style>/g) || []).length, 1);
  assert.equal((html.match(/<h1>LEVERINGSBON<\/h1>/g) || []).length, 2);
  assert.equal((html.match(/page-break-after:always/g) || []).length, 1);
  assert.match(html, /LB-2026-0500/);
  assert.match(html, /LB-2026-0501/);
  assert.match(D.filenameMany("delivery"), /^Famo-Leveringsbonnen-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.throws(() => D.buildMany([], "delivery"));
});

test("structuredRef ongewijzigd", () => {
  const D = load();
  assert.equal(D.structuredRef("FA-2026-0001"), "+++202/6000/00192+++");
  assert.equal(D.structuredRef("CMD-1"), "");
});

// ---- Mode « boekhouder » (défaut) : la facture légale vient du comptable (Billtobox / Peppol) ----
const PRO = { ...CFG, facturatie: "", legal: { naam: "Famo Trading", rechtsvorm: "BV", ondernemingsnummer: "0788.705.713", rpr: "RPR Antwerpen, afdeling Antwerpen", handelsnaam: "FAMO Seafood" } };

test("boekhouder : PRO FORMA, geen factuurnummer/IBAN/OGM, vermelding « geen factuur »", () => {
  const D = load();
  D.setCompany(PRO);
  const html = D.build(ORDER, "invoice");
  assert.match(html, /<h1>PRO FORMA<\/h1>/);
  assert.doesNotMatch(html, /FACTUUR|FA-2026-0500|BE71|\+\+\+|Vervaldatum/);
  assert.match(html, /geen factuur/);
  assert.equal(D.number(ORDER, "invoice"), "PF-2026-0500");
  assert.match(D.filename(ORDER, "invoice"), /ProForma/);
});

test("boekhouder : retourbon in plaats van creditnota, FR vertaald", () => {
  const D = load();
  D.setCompany(PRO);
  const o = { ...ORDER, klant: { ...ORDER.klant, taal: "FR" }, creditnota: { nummer: "CN-2026-0001", lignes: "Kabeljauw × 1 kg [€20.00]", montant: 20, le: "2026-03-12T10:00:00.000Z", motif: "Retour" } };
  const html = D.build(o, "credit");
  assert.match(html, /BON DE RETOUR/);
  assert.match(html, /n'est pas une note de crédit/);
  assert.equal(D.number(o, "credit"), "RB-2026-0001");
});

test("vermeldingen WVV art. 2:20 onderaan elk document", () => {
  const D = load();
  D.setCompany(PRO);
  for (const type of ["invoice", "delivery"]) {
    const html = D.build(ORDER, type);
    assert.match(html, /Famo Trading BV · Ondernemingsnummer 0788\.705\.713 · RPR Antwerpen, afdeling Antwerpen · handelsnaam FAMO Seafood/, type);
  }
});

test("portaal : IBAN ontbreekt → geen voorbeeld-IBAN, factuur geblokkeerd", () => {
  const D = load();
  D.setCompany({ ...CFG, iban: "", bic: "" });
  assert.equal(D.canInvoice(), false);
  assert.throws(() => D.build(ORDER, "invoice"), /IBAN ontbreekt/);
});

test("afronding EN 16931 : 1,375 kg × 18,49 → lijn 25,42 ; btw per tarief", () => {
  const D = load();
  D.setCompany(CFG);
  const html = D.build({ ...ORDER, lignes: "Tong × 1.375 kg [€18.49]\nMosselen × 3 kg [€4.99]", total: 40.39 }, "invoice");
  assert.equal(row(html, "Totaal excl. btw"), "€ 40,39");
  assert.equal(row(html, "btw 6%"), "€ 2,42");
  assert.equal(row(html, "Totaal incl. btw"), "€ 42,81");
});

test("poids réel (H-04) : « besteld X » seulement là où la livraison diffère de la commande", () => {
  const D = load();
  D.setCompany(CFG);
  const o = { ...ORDER, lignes: "Kabeljauw × 5.4 kg [€20.00]\nZalm × 2 kg [€30.00]", besteld: "Kabeljauw × 5 kg [€20.00]\nZalm × 2 kg [€30.00]", total: 168 };
  const bon = D.build(o, "delivery");
  assert.match(bon, /<small class="ordered">besteld 5 kg<\/small>/);
  assert.equal((bon.match(/class="ordered"/g) || []).length, 1, "Zalm inchangé : pas de mention");
  assert.ok(!/class="ordered"/.test(D.build({ ...o, besteld: "" }, "delivery")), "anciennes commandes sans champ : rien");
  const fr = D.build({ ...o, klant: { ...o.klant, taal: "FR" } }, "delivery");
  assert.match(fr, /commandé 5/);
});

test("CGV (C-12) : mention au pied du document quand une version est publiée, NL et FR", () => {
  const D = load();
  D.setCompany({ ...CFG, voorwaardenVersie: "2026-09-28 10:05" });
  assert.match(D.build(ORDER, "delivery"), /Onze algemene verkoopsvoorwaarden zijn van toepassing \(versie 2026-09-28 10:05\) : \/voorwaarden\.html/);
  assert.match(D.build({ ...ORDER, klant: { ...ORDER.klant, taal: "FR" } }, "invoice"), /Nos conditions générales de vente s'appliquent \(version 2026-09-28 10:05\)/);
  D.setCompany(CFG);
  assert.ok(!/verkoopsvoorwaarden zijn van toepassing/.test(D.build(ORDER, "delivery")), "rien sans version publiée");
});

// ---- Régime de TVA du client (C-10) : 0 % forcé + mention légale dans la langue du client ----
test("régime intracommunautaire : 0 % sur chaque ligne malgré les taux, mention NL sous les totaux", () => {
  const D = load();
  D.setCompany(CFG);
  const o = { ...ORDER, lignes: "Kabeljauw × 5 kg [€20.00]\nScampi × 1 caisse [€50.00]", total: 150, btwPerLine: { kabeljauw: 6, scampi: 21 }, btwRegime: "Intracommunautaire" };
  const f = D.build(o, "invoice");
  assert.equal(row(f, "btw 0%"), "€ 0,00");
  assert.equal((f.match(/<span>btw /g) || []).length, 1, "un seul groupe à 0 %");
  assert.equal(row(f, "Totaal incl\\. btw"), "€ 150,00");
  assert.match(f, /<div class="regime">Vrijgesteld van btw – intracommunautaire levering \(art\. 39bis/);
  // Anciennes lignes sans prix : 0 % aussi.
  assert.equal(row(D.build({ ...o, lignes: "Kabeljauw × 5 kg", total: 100 }, "invoice"), "btw 0%"), "€ 0,00");
  assert.ok(!/class="regime"/.test(D.build(o, "delivery")), "pas de mention sur le bon de livraison (sans prix)");
});

test("régime export en FR, autoliquidation sur la note de crédit, Normal sans mention", () => {
  const D = load();
  D.setCompany(CFG);
  const fr = D.build({ ...ORDER, klant: { ...ORDER.klant, taal: "FR" }, btwRegime: "Export" }, "invoice");
  assert.match(fr, /<div class="regime">Exonération de TVA – exportation hors de l'Union européenne \(art\. 39, § 1er CTVA/);
  assert.equal(row(fr, "TVA 0%"), "€ 0,00");
  const cn = D.build({ ...ORDER, btwRegime: "Cocontractant", creditnota: { nummer: "CN-2026-0002", lignes: "Kabeljauw × 1 kg [€20.00]", montant: 20, le: "2026-03-12T08:00:00.000Z", motif: "Retour" } }, "credit");
  assert.match(cn, /<div class="regime">Verlegging van heffing – btw te voldoen door de medecontractant/);
  assert.equal(row(cn, "Totaal incl\\. btw"), "€ -20,00");
  const n = D.build({ ...ORDER, btwRegime: "Normal" }, "invoice");
  assert.ok(!/class="regime"/.test(n)); assert.equal(row(n, "btw 6%"), "€ 6,00");
});

// ---- Mise en page A4 (spec 012, audit A10) : hiérarchie, TVA par ligne, impression, jetons ----
const styleOf = html => (/<style>([\s\S]*?)<\/style>/.exec(html) || [])[1] || "";
const bodyOf = html => html.slice(html.indexOf("<body>"));
const MIXED = { ...ORDER, lignes: "Saumon frais × 2 kg [€10.00]\nScampi × 1 caisse [€50.00]", total: 70, btwPerLine: { "saumon frais": 6, scampi: 21 } };

test("A10 : taux de TVA par ligne sur les documents chiffrés, jamais sur le bon de livraison", () => {
  const D = load();
  D.setCompany(CFG);
  const f = D.build(MIXED, "invoice");
  assert.match(f, /<th class="num">BTW<\/th>/, "colonne taux (NL)");
  assert.match(f, /Saumon frais[\s\S]*?<td class="num rate">6%<\/td>[\s\S]*?Scampi[\s\S]*?<td class="num rate">21%<\/td>/);
  const fr = D.build({ ...MIXED, klant: { taal: "FR" }, btwRegime: "Intracommunautaire" }, "invoice");
  assert.match(fr, /<th class="num">TVA<\/th>/, "colonne taux (FR)");
  assert.equal((fr.match(/<td class="num rate">0%<\/td>/g) || []).length, 2, "régime 0 % : 0 % sur chaque ligne");
  const cn = D.build({ ...MIXED, creditnota: { nummer: "CN-2026-0001", lignes: "Scampi × 1 caisse [€50.00]", montant: 50, le: "2026-03-12" } }, "credit");
  assert.match(cn, /<td class="num rate">21%<\/td>/);
  assert.ok(!/class="num rate"/.test(D.build(MIXED, "delivery")), "aucun taux sur le bon de livraison");
  // Anciennes commandes sans prix de ligne : le taux appliqué au total.
  assert.match(D.build({ ...ORDER, lignes: "Kabeljauw × 5 kg" }, "invoice"), /<td class="num rate">6%<\/td>/);
});

test("A10 : récapitulatif TVA par taux (base, TVA), NL et FR, absent du bon de livraison", () => {
  const D = load();
  D.setCompany(CFG);
  const f = D.build(MIXED, "invoice");
  const recap = (/<table class="vatsum">([\s\S]*?)<\/table>/.exec(f) || [])[1] || "";
  assert.match(recap, /<th>Btw-tarief<\/th><th class="num">Maatstaf<\/th><th class="num">Btw<\/th>/);
  assert.match(recap, /<td>6%<\/td><td class="num">€ 20,00<\/td><td class="num">€ 1,20<\/td>/);
  assert.match(recap, /<td>21%<\/td><td class="num">€ 50,00<\/td><td class="num">€ 10,50<\/td>/);
  const fr = D.build({ ...MIXED, klant: { taal: "FR" } }, "invoice");
  assert.match(fr, /<th>Taux TVA<\/th><th class="num">Base<\/th><th class="num">TVA<\/th>/);
  assert.ok(!/class="vatsum"/.test(D.build(MIXED, "delivery")));
});

test("A10 : bloc de paiement complet (montant TVAC, échéance), facture portaal seulement", () => {
  const D = load();
  D.setCompany(CFG);
  const f = D.build(ORDER, "invoice");
  const bank = (/<section class="bank">([\s\S]*?)<\/section>/.exec(f) || [])[1] || "";
  assert.match(bank, /<span>Bedrag<\/span><b class="mono">€ 106,00<\/b>/);
  assert.match(bank, /<span>Vervaldatum<\/span><b>24\/03\/2026<\/b>/);
  assert.match(bank, /<span>IBAN<\/span><b class="mono">BE71 0961 2345 6769<\/b>/);
  const fr = D.build({ ...ORDER, klant: { taal: "FR" } }, "invoice");
  assert.match(fr, /<span>Montant<\/span><b class="mono">€ 106,00<\/b>/);
  D.setCompany(PRO);
  assert.ok(!/class="bank"/.test(D.build(ORDER, "invoice")), "pro forma : pas de paiement");
});

test("A10 : hiérarchie — fournisseur, document, client, lignes, TVA, totaux, mentions, paiement, pied légal", () => {
  const D = load();
  D.setCompany({ ...PRO, facturatie: "portaal", iban: "BE71096123456769", bic: "GKCCBEBB", voorwaardenVersie: "2026-09-28 10:05" });
  const f = bodyOf(D.build({ ...ORDER, btwRegime: "Export" }, "invoice"));
  const order = ['class="mast"', 'class="supplier"', "<svg", "<h1>FACTUUR</h1>", 'class="party"', 'class="metaband"', '<table class="lines">', 'class="vatsum"', 'class="totals"', 'class="regime"', 'class="bank"', 'class="foot"', 'class="legal"'];
  let at = -1;
  for (const marker of order) {
    const i = f.indexOf(marker);
    assert.ok(i > at, "ordre : " + marker + " (" + i + " après " + at + ")");
    at = i;
  }
  assert.match(f, /<div class="legal">Famo Trading BV · Ondernemingsnummer 0788\.705\.713/);
  assert.match(f, /<div class="foot">[\s\S]*?Onze algemene verkoopsvoorwaarden zijn van toepassing/);
});

test("A10 : impression A4 (marges, en-tête répété, lignes non coupées), Helvetica/Arial, jetons Vismijn", () => {
  const D = load();
  D.setCompany(CFG);
  for (const type of ["invoice", "delivery"]) {
    const css = styleOf(D.build(ORDER, type));
    assert.match(css, /@page\{size:A4;margin:[^}]+\}/, "marges A4 à l'impression");
    assert.match(css, /thead\{display:table-header-group\}/, "en-tête de tableau répété");
    assert.match(css, /tr\{break-inside:avoid;page-break-inside:avoid\}/, "ligne jamais coupée");
    assert.match(css, /font-family:Helvetica,Arial,sans-serif/);
    assert.doesNotMatch(css, /Georgia|serif"|monospace|Menlo|Consolas|@font-face|@import/, "aucune police web, serif ou chasse fixe");
    assert.doesNotMatch(css, /text-transform:uppercase/, "aucun libellé en capitales");
    assert.doesNotMatch(css, /rgba\(|border-left:[^;}]*#0B5A6C|gradient/i, "ni gris Crème, ni bande colorée, ni dégradé");
    const allowed = ["#0E2229", "#475A61", "#56686E", "#D3DDDF", "#E3EAEB", "#AAB8BB", "#EFF3F3", "#E4EBEB", "#0B5A6C", "#FFFFFF", "#7A5410"];
    for (const hex of css.match(/#[0-9A-Fa-f]{6}\b/g) || []) assert.ok(allowed.includes(hex.toUpperCase()), "couleur hors jetons : " + hex);
    assert.doesNotMatch(css, /page-break-after:always/, "le saut de page du bundle reste le seul (test buildMany)");
  }
});
