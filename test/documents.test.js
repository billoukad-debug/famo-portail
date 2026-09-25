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
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "staff-company.js"), "utf8"), win);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "documents.js"), "utf8"), win);
  return win.FamoDocuments;
}
const CFG = { bedrijfsnaam: "Famo Trading BV", adres: "Jezusstraat 34", plaats: "2000 Antwerpen", btw: "BE0788705713", iban: "BE71096123456769", bic: "GKCCBEBB", btwTarief: 6 };
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
  const r = D.build({ ...ORDER, total: 12.35 }, "invoice");
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
