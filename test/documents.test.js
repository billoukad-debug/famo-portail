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
