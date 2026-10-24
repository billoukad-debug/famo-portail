"use strict";
// « Zoals elke maandag » (specs/036, X1) : la commande probable d'un client pour le prochain jour de livraison,
// calculée par le SERVEUR à partir de son historique. Module pur : les commandes et le catalogue sont lus par
// l'appelant (api/orders.js) ; les prix et les règles (actif, conditionnement, minimum) sont ensuite recalculés par
// lib/bestelling.js, exactement comme pour une commande normale. Le navigateur ne propose que des quantités.
//
// Règle :
//  1. les 8 dernières commandes LIVRÉES (statut « Facturée ») de ce client dont le jour de livraison tombe le même
//     jour de la semaine que la livraison visée ;
//  2. par produit, la médiane des quantités sur ces commandes, un produit absent d'une commande comptant 0 : un
//     produit pris une fois sur huit ne revient pas, un produit pris cinq fois sur huit revient ;
//  3. quantité arrondie au pas du produit (0,5 kg, 1, ou un conditionnement entier « enkel per verpakking ») ;
//  4. repli : aucune commande livrée ce jour-là → la dernière commande du client (tout jour, non annulée) ;
//  5. aucune commande → null (pas de carte) ;
//  6. un produit inactif, retiré du catalogue ou introuvable est exclu (jamais deviné).
// Les commandes d'essai (specs/021) ne comptent jamais.
const __lj = require("./lignesjson");
const __test = require("./testorders");
const FB = require("../assets/bestellen.js");

const MAX = 8;
const norm = (s) => String(s || "").toLowerCase().trim();
const dayOf = (f) => String(f["Date livraison souhaitée"] || f["Date"] || "").slice(0, 10);
const dow = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
const LINES = "Lignes (produits / quantités)";

function median(values) {
  const v = values.slice().sort((a, b) => a - b), n = v.length;
  if (!n) return 0;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

/**
 * Lignes d'une commande rattachées au catalogue ACTIF : Map(productId → quantité). Par référence (Lignes JSON,
 * spec 016), sinon par nom exact (anciennes commandes) ; une ligne qui ne retrouve pas de produit actif est ignorée.
 */
function linesOf(fields, products) {
  const byName = new Map();
  products.forEach((p, id) => byName.set(norm(p.fields["Produit"]), id));
  const out = new Map();
  for (const l of __lj.linked(fields[LINES], fields[__lj.FIELD])) {
    const id = l.productId && products.has(l.productId) ? l.productId : byName.get(norm(l.nom));
    if (!id || !(Number(l.qty) > 0)) continue;
    out.set(id, (out.get(id) || 0) + Number(l.qty));
  }
  return out;
}

/** Produit au format attendu par FB.stap / FB.rond (unité, conditionnement). */
const shape = (rec) => ({ unite: rec.fields["Unité"] || "", per: Number(rec.fields["Per verpakking"]) || 0, enkel: !!rec.fields["Enkel per verpakking"] });

/**
 * records : commandes du client (déjà filtrées sur ce client) ; products : Map(id → enregistrement Catalogue ACTIF) ;
 * levering : "AAAA-MM-JJ" visé. → null, ou { basis: "weekdag" | "laatste", n, weekdag (0–6), items: [{ productId, quantity }] }.
 */
function probable(records, products, levering) {
  const real = __test.real(records).filter((r) => r.fields["Statut"] !== "Annulée");
  const target = dow(levering);
  const sorted = (list) => list.slice().sort((a, b) => (dayOf(b.fields) + (b.fields["Date"] || "")).localeCompare(dayOf(a.fields) + (a.fields["Date"] || "")));
  const same = sorted(real.filter((r) => r.fields["Statut"] === "Facturée" && dayOf(r.fields) && dayOf(r.fields) < levering && dow(dayOf(r.fields)) === target)).slice(0, MAX);
  let basis = "weekdag", used = same;
  if (!same.length) { basis = "laatste"; used = sorted(real.filter((r) => dayOf(r.fields))).slice(0, 1); }
  if (!used.length) return null;
  const per = used.map((r) => linesOf(r.fields, products));
  const ids = [];
  per.forEach((m) => m.forEach((q, id) => { if (!ids.includes(id)) ids.push(id); }));
  const items = [];
  for (const id of ids) {
    const med = median(per.map((m) => m.get(id) || 0));
    if (!(med > 0)) continue;
    items.push({ productId: id, quantity: FB.rond(med, shape(products.get(id))) });
  }
  if (!items.length) return null;
  return { basis, n: used.length, weekdag: target, items };
}

/** « Uw vaste producten » : ce que le client a commandé dans au moins 2 de ses 10 dernières commandes livrées. */
function vaste(records, products) {
  const done = __test.real(records).filter((r) => r.fields["Statut"] === "Facturée").sort((a, b) => dayOf(b.fields).localeCompare(dayOf(a.fields))).slice(0, 10);
  const count = new Map();
  done.forEach((r) => linesOf(r.fields, products).forEach((q, id) => count.set(id, (count.get(id) || 0) + 1)));
  return Array.from(count).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

module.exports = { probable, vaste, median, linesOf, MAX };
