"use strict";
// Plusieurs catégories par produit (specs/039) : « Catégorie » reste la catégorie principale (rapportage,
// vitrine, facture, mails) ; « Extra categorieën » liste les autres, une par ligne. Le produit apparaît dans
// chacune côté client ; l'ordre du catalogue reste celui de la catégorie principale.
const FIELD = "Extra categorieën";
const MAX = 10;
const key = (s) => String(s || "").trim().toLowerCase();
const tidy = (s) => String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/** Les catégories en plus, nettoyées : sans doublon ni la principale. */
function extrasOf(fields) {
  const f = fields || {}, main = key(f["Catégorie"] || "Algemeen"), seen = new Set([main]), out = [];
  String(f[FIELD] || "").split("\n").map(tidy).forEach((c) => { if (c && !seen.has(key(c)) && out.length < MAX) { seen.add(key(c)); out.push(c); } });
  return out;
}

/** [principale, ...extras] pour les API (la principale vide reste vide : « Algemeen » à l'affichage). */
function catsOf(fields) {
  return [String((fields || {})["Catégorie"] || "")].concat(extrasOf(fields));
}

/** Valeur à écrire depuis une liste envoyée par Beheer, ou { error }. */
function extrasIn(list, main) {
  if (!Array.isArray(list)) return { error: "Ongeldige lijst van categorieën" };
  const value = extrasOf({ "Catégorie": main, [FIELD]: list.slice(0, 50).map(tidy).join("\n") }).join("\n");
  return { value };
}

/** Renommage d'une catégorie (renameCategory) : nouvelle valeur du champ, ou null si rien ne change. */
function renamed(fields, froms, to) {
  const keys = froms.map(key), cur = String((fields || {})[FIELD] || "");
  if (!cur.split("\n").some((c) => keys.includes(key(c)))) return null;
  const main = keys.includes(key((fields || {})["Catégorie"] || "Algemeen")) ? to : (fields || {})["Catégorie"];
  return extrasOf({ "Catégorie": main, [FIELD]: cur.split("\n").map((c) => (keys.includes(key(c)) ? to : c)).join("\n") }).join("\n");
}

module.exports = { FIELD, MAX, extrasOf, catsOf, extrasIn, renamed };
