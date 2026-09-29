"use strict";
// Facturation côté serveur : mode, identité légale, taux par produit, totaux, numéros.
//
// Deux modes (Configuratie → « Facturatie ») :
//   « Boekhouder » (défaut) : la facture légale est émise par le comptable (Billtobox, Peppol).
//     Les documents du portail sont des PRO FORMA : ni numéro de facture affiché, ni IBAN, ni
//     communication structurée, ni montant « à payer ». Sinon deux « factures » coexisteraient et
//     la TVA mentionnée sur celle du portail serait due en plus (art. 51 §1, 3° CTVA).
//   « Portaal » : le portail émet la facture (FA-…) et l'UBL que le comptable envoie tel quel via
//     Billtobox ; le PDF du portail est alors la copie lisible de cette même facture.
const vat = require("../assets/vat.js");

const MODES = ["Boekhouder", "Portaal"];
const modeOf = (c) => (String((c || {})["Facturatie"] || "").trim().toLowerCase() === "portaal" ? "portaal" : "boekhouder");

// Identité légale (Code des sociétés et associations, art. 2:20) : dénomination, forme,
// siège, numéro d'entreprise, « RPR/RPM » + division du tribunal de l'entreprise.
function legalOf(c) {
  c = c || {};
  const btw = String(c["BTW-nummer"] || "").trim();
  const digits = btw.replace(/\D/g, "");
  return {
    handelsnaam: String(c["Bedrijfsnaam"] || "").trim(),
    naam: String(c["Juridische naam"] || "").trim(),
    rechtsvorm: String(c["Rechtsvorm"] || "").trim(),
    rpr: String(c["RPR"] || "").trim(),
    ondernemingsnummer: digits.length === 10 ? digits.slice(0, 4) + "." + digits.slice(4, 7) + "." + digits.slice(7) : "",
    btw
  };
}
// Mentions manquantes pour des documents conformes (vide = complet).
function legalMissing(l) {
  const out = [];
  if (!l.naam) out.push("Juridische naam");
  if (!l.rechtsvorm) out.push("Rechtsvorm");
  if (!l.ondernemingsnummer) out.push("BTW-/ondernemingsnummer");
  if (!l.rpr) out.push("RPR (rechtbank en afdeling)");
  return out;
}

const defaultRate = (c) => vat.validRate((c || {})["BTW-tarief"] === "" ? null : (c || {})["BTW-tarief"], vat.DEFAULT_RATE);

// { "produit (minuscules)": taux } depuis les enregistrements Catalogue (vide = taux par défaut).
function ratesFromCatalogue(records) {
  const m = {};
  (records || []).forEach((r) => {
    const f = r.fields || {};
    const t = f["BTW-tarief"];
    if (t !== undefined && t !== null && t !== "" && Number.isFinite(Number(t)) && Number(t) >= 0) m[String(f["Produit"] || "").toLowerCase().trim()] = Number(t);
  });
  return m;
}

// Taux FIGÉS au passage en « Facturée » (champ « BTW per lijn », JSON) : un changement de taux
// au catalogue ne réécrit jamais une facture déjà émise (audit B-07).
function frozenRates(fields) {
  const raw = (fields || {})["BTW per lijn"];
  if (!raw) return null;
  try { const m = typeof raw === "string" ? JSON.parse(raw) : raw; return m && typeof m === "object" && !Array.isArray(m) ? m : null; } catch (e) { return null; }
}
// Table des taux des lignes d'une commande (figée si elle existe, sinon catalogue actuel).
function linesRates(lines, fields, catalogueRates, fallback) {
  const frozen = frozenRates(fields);
  if (frozen) return frozen;
  const m = {};
  (lines || []).forEach((l) => { const k = String(l.nom || l.name || "").trim().toLowerCase(); m[k] = vat.rateFrom(catalogueRates, k, fallback); });
  return m;
}

// Totaux d'une commande à partir des lignes parsées (api/updateorder.js parseLines : {nom, qty, price}).
function orderTotals(lines, rates, fallback, sign) {
  return vat.totals((lines || []).map((l) => ({ name: l.nom || l.name, qty: l.qty, price: l.price })), (n) => vat.rateFrom(rates, n, fallback), sign);
}

// Communication structurée belge (OGM) dérivée d'un numéro FA-AAAA-NNNN (mod 97).
function structuredRef(nr) {
  const m = String(nr || "").trim().match(/^FA-(\d{4})-(\d{1,6})$/i);
  if (!m) return "";
  const base = m[1] + m[2].padStart(6, "0");
  const digits = base + String(Number(base) % 97 || 97).padStart(2, "0");
  return "+++" + digits.slice(0, 3) + "/" + digits.slice(3, 7) + "/" + digits.slice(7) + "+++";
}

// ---- Numérotation atomique -------------------------------------------------------------------
// Sur le moteur SQL (production : Neon), un compteur par série (« FA-2026 », « CN-2026 »,
// « CMD-2026 ») dans la table interne Compteurs, incrémenté par écriture conditionnelle sur la
// version de l'enregistrement : deux appels simultanés ne peuvent pas lire le même numéro
// (audit B-01). Premier usage d'une série, ou après une restauration sans cette table : le
// compteur part du plus grand numéro existant (floor), jamais en dessous.
// Sur Airtable (pas d'écriture conditionnelle), renvoie null : l'appelant garde son ancien
// calcul max + 1 suivi d'ensureUnique.
const COUNTERS = "Compteurs";
const counterId = (series) => "reccnt" + String(series).replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
async function reserve(series, floor) {
  const st = require("./datastore").state;
  if (st.backend === "airtable" || !st.store) return null;
  const store = st.store;
  const id = counterId(series);
  for (let attempt = 0; attempt < 25; attempt++) {
    const cur = await store.get(COUNTERS, id);
    if (!cur) {
      const start = Math.max(0, Number(typeof floor === "function" ? await floor() : floor) || 0);
      try {
        await store.insert(COUNTERS, [{ id, createdTime: new Date().toISOString(), fields: { Serie: series, Waarde: start + 1 } }]);
        return start + 1;
      } catch (e) { continue; } // créé en même temps par un autre appel : on relit
    }
    const next = (Number(cur.fields && cur.fields.Waarde) || 0) + 1;
    if (await store.update(COUNTERS, id, Object.assign({}, cur.fields, { Waarde: next }), cur.version)) return next;
  }
  throw new Error("Nummering bezet: probeer opnieuw");
}

module.exports = { MODES, modeOf, legalOf, legalMissing, defaultRate, ratesFromCatalogue, frozenRates, linesRates, orderTotals, structuredRef, reserve, COUNTERS, vat };
