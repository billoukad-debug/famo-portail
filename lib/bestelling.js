"use strict";
// Lignes d'une nouvelle commande, décidées par le SERVEUR (constitution II) : une seule
// implémentation pour la commande client (api/order.js), la saisie du personnel (api/staff.js) et
// la commande par e-mail (lib/inbound/mailorder.js, specs/020-bestellen-per-mail).
//
// L'appelant ne fournit que { productId, quantity, comment? } : nom, unité et prix viennent du
// catalogue actif et des prix négociés du client (lib/prices.js) ; le texte « Lignes (produits /
// quantités) » et le JSON structuré (lib/lignesjson.js, spec 016) sont écrits ici.
const { atAll } = require("./airtable");
const __prices = require("./prices");
const __lj = require("./lignesjson");
const __pak = require("./verpakking");
const vat = require("../assets/vat.js");

const MAX_QTY = 1000;

function numberOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanComment(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/[()[\]]/g, "").trim().slice(0, 200);
}

// Messages d'erreur (néerlandais) propres à chaque appelant : le portail client et la saisie du
// personnel gardent mot pour mot leurs textes historiques (tests).
const MSG_KLANT = { empty: "Geen artikelen", qty: "Ongeldige hoeveelheid", unavailable: "Artikel is niet beschikbaar", decimal: "Alleen producten per kg mogen een decimale hoeveelheid hebben" };
const MSG_PERSONEEL = { empty: "Klant en artikelen vereist", qty: "Ongeldig artikel of aantal", unavailable: "Ongeldig artikel of aantal", decimal: "Alleen producten per kg mogen een decimale hoeveelheid hebben" };

/** Catalogue actif + prix négociés du client : { products: Map(id → enregistrement), prices: Map(id → prix) }. */
async function catalogueFor(clientId) {
  const cat = await atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`);
  const negotiated = await atAll(`${encodeURIComponent("Prix négociés")}`);
  const prices = __prices.negotiatedFor(negotiated.records, clientId);
  return { products: new Map((cat.records || []).map(record => [record.id, record])), prices };
}

/**
 * Lignes, JSON structuré et total HTVA. Lève une Error (message NL de `msgs`) si un article est
 * inconnu ou inactif, une quantité ≤ 0 ou > 1000, ou décimale hors kg. Mêmes articles fusionnés.
 * opts.catalogue : résultat de catalogueFor (évite une seconde lecture).
 */
async function buildOrderLines(clientId, items, msgs, opts) {
  const m = Object.assign({}, MSG_KLANT, msgs || {});
  if (!Array.isArray(items) || !items.length) throw new Error(m.empty);
  const { products, prices } = (opts && opts.catalogue) || await catalogueFor(clientId);

  const merged = new Map();
  for (const item of items) {
    const productId = String(item && item.productId || "");
    const quantity = numberOf(item && item.quantity);
    if (!productId || quantity <= 0 || quantity > MAX_QTY) throw new Error(m.qty);
    if (!products.has(productId)) throw new Error(m.unavailable);
    if (!/kg/i.test(String(products.get(productId).fields["Unité"] || "")) && !Number.isInteger(quantity)) throw new Error(m.decimal);
    const prev = merged.get(productId) || { quantity: 0, comment: "" };
    prev.quantity += quantity;
    prev.comment = cleanComment(item && item.comment) || prev.comment;
    merged.set(productId, prev);
  }

  // Verpakking (specs/023) : un article « enkel per verpakking » se commande par conditionnements
  // entiers (quantité fusionnée, en unités). Message néerlandais, traduit à l'écran du client (K.errText).
  for (const [productId, entry] of merged) {
    const refused = __pak.refusal(products.get(productId), entry.quantity);
    if (refused) throw new Error(refused);
  }

  const lines = [], structured = [];
  let total = 0;
  for (const [productId, entry] of merged) {
    const product = products.get(productId);
    const fields = product.fields;
    const price = __prices.unitPrice(product, prices);
    const unit = fields["Unité"] || "";
    const name = fields["Produit"] || "Artikel";
    // Le prix convenu est figé dans la ligne : une facture ultérieure reste reproductible.
    lines.push(`${name} × ${entry.quantity}${unit ? " " + unit : ""} [€${price.toFixed(2)}]${entry.comment ? " (" + entry.comment + ")" : ""}`);
    // Même ligne, structurée (B4) : référence, nom, unité et prix du catalogue — rien de l'appelant.
    structured.push(__lj.entry(product, { qty: entry.quantity, unit, price, comment: entry.comment }));
    total += vat.r2(Math.round(price * 100) / 100 * entry.quantity); // = le prix écrit dans la ligne (B-09)
  }
  return { lignes: lines.join("\n"), json: __lj.serialize(structured), total: Math.round(total * 100) / 100 };
}

module.exports = { buildOrderLines, catalogueFor, cleanComment, MSG_KLANT, MSG_PERSONEEL, MAX_QTY };
