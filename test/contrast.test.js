const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
// Hoog contrast (vroege dienst) : keuze per toestel, sinon la préférence système « plus de contraste ».
const src = fs.readFileSync(path.join(__dirname, "..", "assets", "ui.js"), "utf8");
function load({ stored, prefersMore, storageBlocked } = {}) {
  const attrs = {}, data = stored === undefined ? {} : { famoContrast: JSON.stringify(stored) };
  const html = { lang: "", setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; } };
  const localStorage = storageBlocked
    ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} }
    : { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: k => { delete data[k]; } };
  const win = { document: { documentElement: html, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } },
    location: { hash: "", pathname: "/", search: "" }, localStorage, sessionStorage: localStorage,
    matchMedia: q => ({ matches: q === "(prefers-contrast: more)" && !!prefersMore }) };
  vm.runInNewContext(src, Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => ({}) }));
  return { K: win.K, attrs, data };
}
test("contrast : normaal par défaut, rien sur <html>", () => {
  const { K, attrs } = load();
  assert.equal(K.contrast(), "normaal"); assert.equal(attrs["data-contrast"], undefined);
});
test("contrast : suit « plus de contraste » du système tant qu'il n'y a pas de choix", () => {
  const { K, attrs } = load({ prefersMore: true });
  assert.equal(K.contrast(), "hoog"); assert.equal(attrs["data-contrast"], "hoog");
});
test("contrast : le choix de l'appareil prime sur le système, dans les deux sens", () => {
  assert.equal(load({ stored: "normaal", prefersMore: true }).attrs["data-contrast"], undefined);
  assert.equal(load({ stored: "hoog" }).attrs["data-contrast"], "hoog");
  assert.equal(load({ stored: "n'importe quoi" }).K.contrast(), "normaal");
});
test("contrast : bascule et réapplication ; storage bloqué = normaal, sans erreur", () => {
  const { K, attrs } = load();
  K.store.set("famoContrast", "hoog"); K.applyContrast(); assert.equal(attrs["data-contrast"], "hoog");
  K.store.set("famoContrast", "normaal"); K.applyContrast(); assert.equal(attrs["data-contrast"], undefined);
  const b = load({ storageBlocked: true });
  assert.equal(b.K.contrast(), "normaal"); assert.doesNotThrow(() => b.K.applyContrast());
});
