"use strict";
// Modifier sans annuler (specs/036, X3) : le client ajoute, retire ou change une quantité sur SA commande
// « Reçue » jusqu'à l'heure limite de la veille de la livraison (lib/levering.js checkCutoff, la règle de la
// commande elle-même). Une 2e commande pour le même jour de livraison s'ajoute à la première (api/order.js).
// Le SERVEUR revérifie tout (constitution II) : statut relu juste avant l'écriture, heure limite, produits
// actifs, prix du jour et prix négociés, conditionnement, minimum. Chaque changement s'inscrit dans « Correcties »
// (date Bruxelles · action · klant — détail), comme les corrections du personnel.
const { at } = require("./airtable");
const __bestelling = require("./bestelling");
const __lj = require("./lignesjson");
const __lev = require("./levering");
const __cor = require("./correctie");
const __test = require("./testorders");

const LINES = "Lignes (produits / quantités)";
const norm = (s) => String(s || "").toLowerCase().trim();

function stamp() {
  return new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(",", "");
}

/** Pourquoi cette commande ne se modifie plus ("" = modifiable). Messages néerlandais (traduits à l'écran). */
function refusal(fields, rules) {
  const f = fields || {};
  if (__test.isTest(f)) return __test.REFUS;
  if (f["Statut"] === "Annulée") return "Deze bestelling is geannuleerd.";
  if (f["Statut"] !== "Reçue") return "Deze bestelling wordt al klaargezet. Bel Famo om ze te wijzigen.";
  const dag = f["Date livraison souhaitée"];
  if (!dag || __lev.checkCutoff(dag, rules)) return "Wijzigen kan tot " + rules.deadline + " de dag vóór de levering. Bel Famo.";
  return "";
}

/**
 * Lignes actuelles d'une commande en { productId, quantity, comment } (catalogue ACTIF). null si une ligne ne
 * retrouve plus son produit (devenu inactif ou retiré) : on ne réécrit jamais une commande en perdant une ligne.
 */
function itemsOf(fields, products) {
  const byName = new Map();
  products.forEach((p, id) => byName.set(norm(p.fields["Produit"]), id));
  const out = [];
  for (const l of __lj.linked(fields[LINES], fields[__lj.FIELD])) {
    const id = l.productId && products.has(l.productId) ? l.productId : byName.get(norm(l.nom));
    if (!id) return null;
    out.push({ productId: id, quantity: Number(l.qty), comment: l.comment || "" });
  }
  return out;
}

/** Résumé court du changement pour le journal : « Zalm 4 → 5 kg · + Wakame 1 stuk · − Tonijn ». */
function diffText(before, after) {
  const q = (x) => String(Math.round(x.qty * 1000) / 1000).replace(".", ",");
  return __cor.diffLines(before, after).map((d) => (!d.voor ? "+ " + d.name + " " + q(d.na) + (d.unit ? " " + d.unit : "") : !d.na ? "− " + d.name : d.name + " " + q(d.voor) + " → " + q(d.na) + (d.unit ? " " + d.unit : ""))).join(" · ").slice(0, 400);
}

/**
 * Réécrit les lignes d'une commande du client. rec : enregistrement déjà retrouvé (findOwnOrder) ; items : lignes
 * VOULUES (tout le panier de la commande, pas un delta) ; opts.actie : texte du journal ; opts.fields : champs en plus.
 * → { status, error } ou { status: 200, fields, vorige (items d'avant, pour « ongedaan maken ») }.
 */
async function apply(client, rec, items, rules, opts) {
  const o = opts || {};
  const why = refusal(rec.fields, rules);
  if (why) return { status: 409, error: why };
  const catalogue = await __bestelling.catalogueFor(client.id);
  const vorige = itemsOf(rec.fields, catalogue.products);
  let built;
  try { built = await __bestelling.buildOrderLines(client.id, items, __bestelling.MSG_KLANT, { catalogue }); } catch (e) { return { status: 400, error: String(e.message || e) }; }
  if (rules.minimum > 0 && built.total < rules.minimum) {
    return { status: 400, error: `Minimum bestelling: € ${rules.minimum.toFixed(2).replace(".", ",")} excl. btw (nu € ${built.total.toFixed(2).replace(".", ",")})` };
  }
  // Relu juste avant l'écriture : le magasin a pu « Klaarzetten » entre-temps (ou la commande être annulée).
  const fresh = await at(`Commandes/${rec.id}`);
  if (!fresh || fresh.error || !fresh.fields) return { status: 500, error: "Opslaan of lezen mislukt. Probeer opnieuw." };
  const again = refusal(fresh.fields, rules);
  if (again) return { status: 409, error: again };
  const f = fresh.fields;
  const detail = diffText(f[LINES], built.lignes);
  if (!detail && !o.fields) return { status: 200, fields: f, vorige, ongewijzigd: true };
  const fields = Object.assign({
    [LINES]: built.lignes,
    // Ce que le client a commandé (référence des e-mails de correction, lib/correctie.js) : sa dernière version.
    "Lignes besteld": built.lignes,
    [__lj.FIELD]: built.json,
    "Total": built.total,
    "Correcties": (f["Correcties"] ? f["Correcties"] + "\n" : "") + `${stamp()} · ${o.actie || "Gewijzigd door klant"} · klant${detail ? " — " + detail : ""}`
  }, o.fields || {});
  if (f["Préparation validée"]) fields["Préparation validée"] = false; // lignes changées : le magasin revalide
  const saved = await at(`Commandes/${rec.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
  if (!saved || saved.error) { console.error("[klantwijziging]", rec.id, saved && saved.error && saved.error.type); return { status: 500, error: "Opslaan mislukt. Probeer opnieuw." }; }
  return { status: 200, fields: Object.assign({}, f, fields), vorige };
}

module.exports = { refusal, itemsOf, apply, diffText, stamp };
