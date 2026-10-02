"use strict";
// Verpakking / verkoopeenheid (specs/023-verpakking), côté serveur. La règle elle-même (lecture du
// conditionnement, multiple, textes NL/FR) est dans assets/vat.js, partagée avec le navigateur.
const vat = require("../assets/vat.js");

/** Champs envoyés au navigateur pour un produit du catalogue : { per, verpakking, enkel } ou {} (vendu à l'unité). */
function apiFields(fields) {
  const p = vat.pakOf(fields || {});
  return p ? { per: p.per, verpakking: p.label, enkel: p.only } : {};
}

/** Message (néerlandais) d'une quantité refusée pour un article « enkel per verpakking », sinon "". */
function refusal(product, qty) {
  const f = (product && product.fields) || {};
  const p = vat.pakOf(f);
  if (!p || !p.only || vat.pakFits(qty, p)) return "";
  const unit = f["Unité"] || "";
  return (f["Produit"] || "Artikel") + ": enkel per " + vat.pakOne(p, unit, "nl") + " te bestellen (u vroeg " + vat.pakQty(qty, unit, null, "nl") + ").";
}

module.exports = { apiFields, refusal, vat };
