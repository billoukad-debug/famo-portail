"use strict";
// Spec 018 : volgorde per kaliber — aides pures de assets/ui.js, testées sous Node.
const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "assets", "ui.js"), "utf8");
const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: null, localStorage: null, addEventListener() {} };
vm.runInNewContext(src, Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => ({}) }));
const K = win.K;
const shuffle = (a) => a.slice().reverse(); // ordre de départ inversé, déterministe

test("kaliberKey : U10 d'abord, puis par premier nombre, sans nombre à la fin", () => {
  const order = ["U10", "U/10", "8/12", "13/15", "16/20", "21/25", "26/30", "100/200", "geen", ""];
  const keys = order.map(K.kaliberKey);
  for (let i = 0; i < keys.length - 1; i++) {
    const c = K.cmpKaliber(order[i], order[i + 1]);
    assert.ok(c <= 0, JSON.stringify(order[i]) + " ≤ " + JSON.stringify(order[i + 1]) + " (" + c + ")");
  }
  assert.equal(K.cmpKaliber("U10", "U/10"), 0, "U10 et U/10 : même rang");
  assert.ok(K.cmpKaliber("8/12", "13/15") < 0, "8/12 < 13/15 (numérique, pas texte)");
  assert.ok(K.cmpKaliber("1-2 kg", "2-3 kg") < 0, "par premier nombre");
  assert.ok(K.cmpKaliber("400-600", "600-800") < 0);
  assert.ok(K.cmpKaliber("0,5-1 kg", "1-2 kg") < 0, "décimales belges");
  assert.ok(K.cmpKaliber("16/20", "groot") < 0, "nombre avant texte");
  assert.ok(K.cmpKaliber("groot", "klein") < 0, "texte entre eux");
  assert.ok(K.cmpKaliber("klein", "") < 0, "vide en dernier");
  assert.ok(K.cmpKaliber("16/20", "16/25") < 0, "même premier nombre : le second départage");
  assert.equal(typeof keys[0], "object");
});

test("byNameKaliber : nom (sans casse, numérique) puis kaliber", () => {
  const P = (nom, kaliber) => ({ nom, kaliber });
  const list = [P("Scampi", "21/25"), P("scampi", "8/12"), P("Zalm", ""), P("Scampi", "U10"), P("Scampi", "16/20"), P("Garnalen 26/30", ""), P("Garnalen 8/12", ""), P("Scampi", "13/15")];
  const sorted = shuffle(list).sort(K.byNameKaliber).map((p) => p.nom + "|" + p.kaliber);
  assert.deepStrictEqual(sorted, ["Garnalen 8/12|", "Garnalen 26/30|", "Scampi|U10", "scampi|8/12", "Scampi|13/15", "Scampi|16/20", "Scampi|21/25", "Zalm|"]);
  // Voorraad : items { product, kaliber }.
  const items = [{ product: "Scampi", kaliber: "21/25" }, { product: "Scampi", kaliber: "16/20" }, { product: "Kreeft" }];
  assert.deepStrictEqual(items.sort(K.byNameKaliber).map((i) => i.product + (i.kaliber || "")), ["Kreeft", "Scampi16/20", "Scampi21/25"]);
});

test("kaliberOrder : par catégorie, ordre de première apparition des noms, kaliber croissant", () => {
  const P = (id, nom, kaliber, cat, volgorde) => ({ id, nom, kaliber, cat, volgorde });
  const products = [
    P("a", "Zalm", "", "Vis", 1),
    P("b", "Scampi", "21/25", "Schaaldieren", 2),
    P("c", "Kabeljauw", "", "Vis", 3),
    P("d", "Scampi", "8/12", "Schaaldieren", 4),
    P("e", "Oesters", "nr. 3", "Schaaldieren", 5),
    P("f", "SCAMPI ", "16/20", "Schaaldieren", 6),
    P("g", "Vannamei 26/30", "", "Schaaldieren", 7),
    P("h", "Scampi", "U10", "Schaaldieren", 8),
    P("i", "Vannamei 16/20", "", "Schaaldieren", 9),
    P("j", "Zeebaars", "600-800", "Vis", 10),
    P("k", "Zeebaars", "400-600", "Vis", 11)
  ];
  const ids = Array.from(K.kaliberOrder(products)); // tableau du contexte vm → tableau local
  assert.deepStrictEqual(ids, ["a", "c", "k", "j", "h", "d", "f", "b", "e", "i", "g"]);
  assert.equal(ids.length, products.length, "aucun produit perdu");
  assert.deepStrictEqual(Array.from(K.kaliberOrder([])), []);
  // Déjà trié : rien ne bouge (idempotent).
  const again = ids.map((id) => products.find((p) => p.id === id)).map((p, i) => Object.assign({}, p, { volgorde: i + 1 }));
  assert.deepStrictEqual(Array.from(K.kaliberOrder(again)), ids);
});
