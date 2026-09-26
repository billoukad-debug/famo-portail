const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
// Charge assets/ui.js dans un faux window pour tester les helpers purs.
const src = fs.readFileSync(path.join(__dirname, "..", "assets", "ui.js"), "utf8");
const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: null, localStorage: null, addEventListener() {} };
vm.runInNewContext(src, Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => ({}) }));
const K = win.K;
test("parseLines lit le format des commandes", () => {
  const l = K.parseLines("Zalmfilet × 2 kg [€16.00] (dikke moot)\nScampi × 3 caisse [€15.00]");
  assert.equal(l.length, 2); assert.equal(l[0].qty, 2); assert.equal(l[0].price, 16); assert.equal(l[0].comment, "dikke moot"); assert.equal(l[1].unit, "caisse");
});
test("formatLine ↔ parseLines aller-retour", () => { const s = "Scampi × 3 caisse [€15.00] (opm)"; assert.equal(K.formatLine(K.parseLines(s)[0]), s); });
test("unités traduites en néerlandais", () => { assert.equal(K.unit("caisse"), "kassa"); assert.equal(K.unit("pièce"), "stuk"); assert.equal(K.unit("kg"), "kg"); });
test("statuts et paiements en néerlandais", () => { assert.equal(K.status("Reçue"), "Ontvangen"); assert.equal(K.status("Facturée"), "Geleverd"); assert.equal(K.pay("Payé"), "Betaald"); });
test("eur au format belge", () => { assert.equal(K.eur(1284.5), "€\u00a01.284,50"); assert.equal(K.eur(9.5), "€\u00a09,50"); });
test("isLate : livraison passée et pas livrée", () => { assert.equal(K.isLate({ statut: "Reçue", dateLiv: "2000-01-01" }), true); assert.equal(K.isLate({ statut: "Facturée", dateLiv: "2000-01-01" }), false); assert.equal(K.isLate({ statut: "Reçue", dateLiv: "" }), ""); });
test("K.on remplace un gestionnaire délégué identique au lieu de le cumuler", () => {
  const listeners = new Map();
  const root = {
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev, fn) { if (listeners.get(ev) === fn) listeners.delete(ev); },
    contains: () => true
  };
  let first = 0, second = 0;
  K.on(root, "click", "[data-fav]", () => { first++; });
  K.on(root, "click", "[data-fav]", () => { second++; });
  listeners.get("click")({ target: { closest: () => ({}) } });
  assert.equal(first, 0);
  assert.equal(second, 1);
});
