"use strict";
// I-11 : une seule lecture des lignes côté serveur (lib/lines.js), identique à celle du navigateur (K.parseLines).
const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { parseLines } = require("../lib/lines");
const src = fs.readFileSync(path.join(__dirname, "..", "assets", "ui.js"), "utf8");
const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: null, localStorage: null, addEventListener() {} };
vm.runInNewContext(src, Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => ({}) }));
const K = win.K;
const CASES = ["Tong × 1.5 kg [€18.49] (en filets)", "Scampi x 3 caisse [€15,00]", "Oesters × 48 pièce", "Zalm × 0,875 kg (dikke moot)", "  \nSaus × 2 pièce [€5.00]\n", ""];
test("serveur = navigateur sur les mêmes lignes", () => {
  for (const c of CASES) {
    const a = parseLines(c).map((l) => [l.nom, l.qty, l.unit, l.price, l.comment]);
    const b = K.parseLines(c).map((l) => [l.name, l.qty, l.unit, l.price, l.comment]);
    assert.equal(JSON.stringify(a), JSON.stringify(b), JSON.stringify(c)); // tableaux de deux contextes vm : on compare les valeurs
  }
});
test("ligne illisible : ignorée par le serveur (calculs), gardée par le navigateur (affichage)", () => {
  assert.equal(parseLines("geen lijn").length, 0);
  assert.equal(K.parseLines("geen lijn").length, 1);
});
test("les modules métier utilisent la même fonction", () => {
  for (const m of ["../lib/margin", "../lib/creditnota", "../lib/reminders"]) {
    const s = fs.readFileSync(path.join(__dirname, m + ".js"), "utf8");
    assert.ok(!/function parseLines/.test(s), m + " ne redéfinit plus parseLines");
  }
  assert.strictEqual(require("../api/updateorder").parseLines, parseLines);
});
