"use strict";
// Notes de crédit multiples sur une commande facturée (audit C-08).
//
// Stockage (docs/SCHEMA.md, specs/004-avoirs-multiples-mail-correction/plan.md) :
//   - « Creditnotas » (texte JSON) : la liste COMPLÈTE des notes de la commande, dans l'ordre
//     d'émission : [{ nummer, lignes, montant, le, motif, retour, sleutel? }] ;
//   - les champs historiques « Creditnota nummer / lignes / montant / le / motif » gardent la
//     PREMIÈRE note, écrits une seule fois et jamais réécrits : le code et les données d'avant
//     (une seule note, sans JSON) restent valables, les gardes qui testent « Creditnota nummer »
//     (réception défaite, filtres) aussi.
// Lecture : list(fields) — JSON s'il existe, sinon la note historique seule.
// Montants HTVA aux prix figés de la facture, ligne arrondie au cent (assets/vat.js).
const vat = require("../assets/vat.js");

const FIELD = "Creditnotas";
const LEGACY = { nummer: "Creditnota nummer", lignes: "Creditnota lignes", montant: "Creditnota montant", le: "Creditnota le", motif: "Creditnota motif" };
const norm = (s) => String(s || "").toLowerCase().trim();
const r3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;

// "Zalm × 2 kg [€12.50]" -> { nom, qty, unit, price } (même grammaire que api/updateorder.js).
const { parseLines } = require("./lines"); // une seule définition (I-11)

function clean(n) {
  const out = { nummer: String(n.nummer || ""), lignes: String(n.lignes || ""), montant: Number(n.montant) || 0, le: String(n.le || ""), motif: String(n.motif || ""), retour: !!n.retour };
  if (n.sleutel) out.sleutel = String(n.sleutel);
  return out;
}
function legacyOf(f) {
  if (!f[LEGACY.nummer]) return null;
  return clean({ nummer: f[LEGACY.nummer], lignes: f[LEGACY.lignes], montant: f[LEGACY.montant], le: f[LEGACY.le], motif: f[LEGACY.motif] });
}

/** Toutes les notes de crédit d'une commande (champs d'enregistrement Commandes). */
function list(fields) {
  const f = fields || {};
  let arr = [];
  const raw = f[FIELD];
  if (raw) {
    try { const p = typeof raw === "string" ? JSON.parse(raw) : raw; if (Array.isArray(p)) arr = p.filter((n) => n && n.nummer).map(clean); } catch (e) { arr = []; }
  }
  const legacy = legacyOf(f);
  if (legacy && !arr.some((n) => n.nummer === legacy.nummer)) arr.unshift(legacy);
  return arr;
}

/** Montant total HTVA crédité. */
function totalMontant(fields) { return vat.r2(list(fields).reduce((s, n) => s + (Number(n.montant) || 0), 0)); }

/** Champs à écrire pour ajouter une note (la première remplit aussi les champs historiques). */
function patchFor(fields, note) {
  const f = fields || {};
  const n = clean(note);
  const out = { [FIELD]: JSON.stringify(list(f).concat([n])) };
  if (!f[LEGACY.nummer]) {
    out[LEGACY.nummer] = n.nummer; out[LEGACY.lignes] = n.lignes; out[LEGACY.montant] = n.montant;
    out[LEGACY.le] = n.le; out[LEGACY.motif] = n.motif;
  }
  return out;
}

/** Champs à écrire quand un numéro doit être repris (doublon détecté après écriture, Airtable). */
function renumberPatch(fields, from, to) {
  const f = fields || {};
  const out = { [FIELD]: JSON.stringify(list(f).map((n) => (n.nummer === from ? Object.assign({}, n, { nummer: to }) : n))) };
  if (f[LEGACY.nummer] === from) out[LEGACY.nummer] = to;
  return out;
}

/** Note déjà enregistrée sous cette clé d'idempotence (double clic, renvoi réseau). */
function byKey(fields, sleutel) {
  if (!sleutel) return null;
  return list(fields).find((n) => n.sleutel === sleutel) || null;
}

// Plafond (B-13 étendu à N notes) : par article, la somme des quantités de TOUTES les notes ne
// dépasse jamais la quantité facturée ; par taux de TVA, la somme des bases (et de la TVA) des
// notes ne dépasse jamais celle de la facture — l'arrondi au cent par ligne pourrait sinon
// créditer un cent de trop en plusieurs fois.
// wanted : lignes parsées demandées ; rates : taux figés (« BTW per lijn ») ou {} ; fallback : taux par défaut.
// -> { error } | { lines: [{nom, qty, unit, price, comment}], montant }
function check(fields, wanted, rates, fallback) {
  const f = fields || {};
  const delivered = parseLines(f["Lignes (produits / quantités)"]);
  const previous = list(f);
  const livre = new Map(), deja = new Map(), demande = new Map();
  delivered.forEach((l) => livre.set(norm(l.nom), (livre.get(norm(l.nom)) || 0) + l.qty));
  previous.forEach((n) => parseLines(n.lignes).forEach((l) => deja.set(norm(l.nom), (deja.get(norm(l.nom)) || 0) + l.qty)));
  if (!wanted.length) return { error: "Kies minstens één artikel om te crediteren" };
  let montant = 0;
  const out = [];
  for (const w of wanted) {
    const k = norm(w.nom);
    const d = delivered.find((l) => norm(l.nom) === k);
    if (!d) return { error: `Artikel staat niet op de factuur: ${w.nom}` };
    const max = Math.max(0, r3((livre.get(k) || 0) - (deja.get(k) || 0)));
    demande.set(k, (demande.get(k) || 0) + (w.qty > 0 ? w.qty : 0));
    if (max <= 1e-9 && previous.length) return { error: `${d.nom} is al volledig gecrediteerd (eerdere creditnota's)` };
    if (!(w.qty > 0) || demande.get(k) > max + 1e-9) return { error: `Aantal voor ${w.nom} moet tussen 0 en ${max} liggen (alle lijnen samen${previous.length ? ", na eerdere creditnota's" : ""})` };
    const price = d.price != null ? vat.r2(d.price) : 0;
    montant += vat.r2(price * w.qty);
    out.push({ nom: d.nom, qty: w.qty, unit: d.unit, price, comment: "" });
  }
  const rateOf = (n) => vat.rateFrom(rates || {}, n, fallback);
  const asVat = (ls) => ls.filter((l) => l.price != null).map((l) => ({ name: l.nom, qty: l.qty, price: l.price }));
  const inv = vat.totals(asVat(delivered), rateOf).groups;
  const cred = new Map();
  previous.map((n) => parseLines(n.lignes)).concat([out]).forEach((ls) => vat.totals(asVat(ls), rateOf).groups.forEach((g) => {
    const c = cred.get(g.rate) || { base: 0, tva: 0 };
    cred.set(g.rate, { base: vat.r2(c.base + g.base), tva: vat.r2(c.tva + g.tva) });
  }));
  for (const [rate, c] of cred) {
    const g = inv.find((x) => x.rate === rate) || { base: 0, tva: 0 };
    if (c.base > g.base + 0.001 || c.tva > g.tva + 0.001) {
      const eur = (v) => "€ " + Number(v).toFixed(2).replace(".", ",");
      return { error: `De creditnota's samen (${eur(c.base + c.tva)} incl. btw) zouden meer crediteren dan gefactureerd aan ${rate} % btw (${eur(g.base + g.tva)}). Crediteer een iets kleinere hoeveelheid.` };
    }
  }
  return { lines: out, montant: vat.r2(montant) };
}

module.exports = { FIELD, LEGACY, list, totalMontant, patchFor, renumberPatch, byKey, check, parseLines };
