"use strict";
// A4 « chauffeur d'abord » et D4 (specs/015-chauffeur-creneau) : aides pures de assets/ui.js —
// ordre de tournée, prochain stop non afgehandeld, lecture du créneau — et préférence d'appareil.
const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8");
// Stockage bloqué (navigation privée stricte) : tout accès lève.
const blocked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); }, removeItem() { throw new Error("SecurityError"); } };
const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: blocked, localStorage: blocked, addEventListener() {} };
vm.runInNewContext(src, Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => ({}) }));
const K = win.K;

const stop = (id, volgorde, client, statut, extra) => Object.assign({ id, volgorde, client, statut: statut || "Sortie en livraison" }, extra || {});

test("ronde.order : volgorde d'abord, sans volgorde à la fin par nom ; livrés gardent leur rang", () => {
  const list = [stop("c", null, "Zeta"), stop("a", 2, "Beta", "Facturée"), stop("b", 1, "Alfa"), stop("d", null, "Delta")];
  assert.deepStrictEqual(K.ronde.order(list).map((o) => o.id), ["b", "a", "d", "c"]);
  assert.deepStrictEqual(list.map((o) => o.id), ["c", "a", "b", "d"], "la liste d'origine n'est pas modifiée");
});

test("ronde.done : livré, en file hors ligne, Afwezig / Geweigerd", () => {
  assert.equal(K.ronde.done(stop("a", 1, "A", "Facturée")), true);
  assert.equal(K.ronde.done(stop("a", 1, "A")), false);
  assert.equal(K.ronde.done(stop("a", 1, "A"), true), true, "en file hors ligne");
  assert.equal(K.ronde.done(stop("a", 1, "A", "Sortie en livraison", { uitzondering: "Afwezig" })), true);
  assert.equal(K.ronde.done(stop("a", 1, "A", "Sortie en livraison", { uitzondering: "Geweigerd" })), true);
  assert.equal(K.ronde.done(stop("a", 1, "A", "Prête")), false);
});

test("ronde.next : prochain stop non afgehandeld après le courant, en bouclant ; null en fin de ronde", () => {
  const r = K.ronde.order([stop("a", 1, "A"), stop("b", 2, "B", "Facturée"), stop("c", 3, "C"), stop("d", 4, "D"), stop("e", 5, "E")]);
  const done = (o) => K.ronde.done(o);
  assert.equal(K.ronde.next(r, "a", done), "c", "saute le stop déjà livré");
  assert.equal(K.ronde.next(r, "e", done), "a", "boucle au début");
  assert.equal(K.ronde.next(r, null, done), "a", "sans courant : le premier à faire");
  assert.equal(K.ronde.next(r, "inconnu", done), "a");
  assert.equal(K.ronde.next(r, "c", (o) => o.id !== "c" ? true : false), null, "le courant seul reste : rien d'autre");
  assert.equal(K.ronde.next(r, "a", () => true), null, "tout est fait");
  // Cinq stops d'affilée (DoD IDEAS A4) : chaque « Volgende stop » mène au suivant, puis fin de ronde.
  const seen = new Set(), visited = []; let cur = K.ronde.next(r, null, (o) => seen.has(o.id));
  while (cur) { visited.push(cur); seen.add(cur); cur = K.ronde.next(r, cur, (o) => seen.has(o.id)); }
  assert.deepStrictEqual(visited, ["a", "b", "c", "d", "e"]);
});

test("K.slot lit « HH:MM-HH:MM », rien d'autre", () => {
  assert.deepStrictEqual(Object.assign({}, K.slot("06:00-08:30")), { van: "06:00", tot: "08:30" });
  for (const bad of ["", null, undefined, "tussen 6 en 8", "06:00"]) assert.equal(K.slot(bad), null, String(bad));
});

test("traductions du créneau côté client (NL/FR)", () => {
  assert.equal(K.FR["tussen {van} en {tot}"], "entre {van} et {tot}");
  assert.ok(K.FR["Verwacht leveruur"], "libellé de la fiche traduit");
});

test("préférence d'appareil : stockage bloqué → valeur par défaut, aucune exception", () => {
  assert.equal(K.store.get("famoLevMode", "lijst"), "lijst");
  assert.doesNotThrow(() => K.store.set("famoLevMode", "chauffeur"));
});

test("Leveringen : le mode chauffeur réutilise les actions existantes (pas de logique serveur dupliquée)", () => {
  const js = fs.readFileSync(path.join(ROOT, "assets", "pages", "leveringen.js"), "utf8");
  assert.match(js, /MODE_KEY = "famoLevMode"/); assert.match(js, /K\.store\.get\(MODE_KEY/, "mode mémorisé par appareil via K.store (try/catch)"); assert.match(js, /K\.store\.set\(MODE_KEY/);
  assert.match(js, /data-act="deliver"/); assert.match(js, /data-act="depart"/);
  assert.ok(!/api\/bewijs/.test(js), "la preuve passe par S.confirmDelivery");
  assert.match(js, /S\.queue/, "file hors ligne prise en compte");
  assert.ok(!/style="/.test(js.split("// --- chauffeur ---")[1] || "x"), "aucun style en ligne dans le mode chauffeur");
});
