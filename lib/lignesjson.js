"use strict";
// Lignes de commande structurées (IDEAS B4, specs/016-lignes-structurees).
//
// Champ « Lignes JSON » de Commandes : [{ productId, naam, qty, unit, prijs, comment? }], écrit par le
// SERVEUR seul, à côté du texte « Lignes (produits / quantités) », partout où des lignes sont créées
// ou changées (api/order, api/staff, lib/commande/lignes, renommage lib/beheer/producten).
// Le texte fait foi (quantité, prix, document légal, anciennes commandes) ; le JSON ne sert qu'à
// rattacher une ligne à son produit par id quand le nom ne suffit plus (produit renommé, nom repris).
// Absent ou illisible = ancienne commande : appariement par nom, comme avant.
const { parseLines } = require("./lines");
const vat = require("../assets/vat.js");

const FIELD = "Lignes JSON";
const ID = /^[A-Za-z0-9]{1,40}$/; // même forme que REC (lib/airtable.js)
const norm = (s) => String(s || "").toLowerCase().trim();
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

/** Entrée d'une ligne : produit du catalogue (enregistrement lu par le serveur) + quantité/prix décidés par le serveur. */
function entry(product, line) {
  const f = (product && product.fields) || {};
  const e = { productId: String(product.id), naam: String(f["Produit"] || ""), qty: r3(line.qty), unit: String(line.unit || f["Unité"] || ""), prijs: line.price == null ? null : r2(line.price) };
  if (line.comment) e.comment = String(line.comment);
  // Verpakking (specs/023) : conditionnement FIGÉ avec la ligne (comme le prix) ; line.pak donné =
  // celui déjà enregistré sur la commande, sinon celui du produit. Absent = vendu à l'unité.
  const p = line.pak !== undefined ? line.pak : vat.pakOf(f);
  if (p) { e.per = p.per; e.verpakking = p.label; if (p.stuks) e.stuks = p.stuks; }
  return e;
}

/** Conditionnement figé de chaque ligne : { "nom en minuscules": { per, verpakking[, stuks] } } (vide = rien à annoter). */
function pakMap(raw) {
  const out = {};
  for (const e of parse(raw)) {
    const p = vat.pakOf(e);
    if (p) out[norm(e.naam)] = p.stuks ? { per: p.per, verpakking: p.label, stuks: p.stuks } : { per: p.per, verpakking: p.label };
  }
  return out;
}

/** Conditionnement figé par référence produit (lignes modifiées par le magasin) : Map(productId → pak). */
function pakById(raw) {
  return new Map(parse(raw).filter((e) => vat.pakOf(e)).map((e) => [String(e.productId), vat.pakOf(e)]));
}

/** Valeur du champ ("" = rien : le moteur n'enregistre pas une valeur vide). */
function serialize(entries) { return Array.isArray(entries) && entries.length ? JSON.stringify(entries) : ""; }

/** Entrées valides du champ (JSON abîmé ou entrée sans id valable : ignorés). */
function parse(raw) {
  if (!raw) return [];
  let arr;
  try { arr = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter((e) => e && typeof e === "object" && ID.test(String(e.productId || "")) && typeof e.naam === "string" && Number.isFinite(Number(e.qty)));
}

/**
 * Lignes du TEXTE (nom, quantité, unité, prix, commentaire) + `productId` de l'entrée JSON du même
 * nom (chaque entrée sert une fois). Ligne sans entrée correspondante : productId null (par nom).
 */
function linked(text, raw) {
  const pool = parse(raw).slice();
  return parseLines(text).map((l) => {
    const i = pool.findIndex((e) => norm(e.naam) === norm(l.nom));
    const e = i >= 0 ? pool.splice(i, 1)[0] : null;
    return Object.assign({}, l, { productId: e ? String(e.productId) : null });
  });
}

/** Renommage d'un produit : `naam` suit dans le JSON (comme le texte des commandes ouvertes). null = rien à changer. */
function renamed(raw, productId, nom) {
  const arr = parse(raw);
  if (!arr.some((e) => e.productId === productId && e.naam !== nom)) return null;
  return serialize(arr.map((e) => (e.productId === productId ? Object.assign({}, e, { naam: nom }) : e)));
}

module.exports = { FIELD, entry, serialize, parse, linked, renamed, pakMap, pakById };
