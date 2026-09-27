// Prix négocié : UNE seule règle pour le catalogue client, la commande client,
// la saisie staff et le recalcul d'une commande modifiée. Tous passent par ce
// module, donc le prix affiché et le prix facturé ne peuvent pas diverger.
//
//   - cellule vide / champ absent  → aucun accord : prix de base du catalogue
//   - 0 saisi explicitement         → 0 (choix légitime du gérant)
//   - valeur illisible ou négative  → traitée comme vide (prix de base), jamais comme 0

function numberOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Valeur renseignée dans « Prix négocié », ou null s'il n'y en a pas.
function negotiatedValue(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Période de validité (audit H-07) : « Geldig van » / « Geldig tot » (JJJJ-MM-DD, inclus), vides =
// prix permanent. Un prix à période (actie, prix de la semaine) prime sur le prix permanent le
// temps de sa période ; entre deux périodes qui se chevauchent, la plus récente (« van ») gagne.
const iso = (v) => { const s = String(v || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; };
function periodOf(fields) { return { van: iso((fields || {})["Geldig van"]), tot: iso((fields || {})["Geldig tot"]) }; }
const isPeriod = (p) => !!(p.van || p.tot);
const covers = (p, day) => (!p.van || p.van <= day) && (!p.tot || day <= p.tot);

// productId → prix négocié applicable le jour « day » (défaut : aujourd'hui à Bruxelles).
function negotiatedFor(records, clientId, day) {
  const d = iso(day) || require("./levering").brusselsToday();
  const best = new Map();
  (records || []).forEach(record => {
    const fields = record.fields || {};
    const clients = fields["Client"] || [];
    const products = fields["Produit"] || [];
    const value = negotiatedValue(fields["Prix négocié"]);
    if (!(clientId && clients.includes(clientId) && products[0] && value !== null)) return;
    const p = periodOf(fields);
    if (!covers(p, d)) return;
    const rank = isPeriod(p) ? "1" + (p.van || "0000-00-00") : "0";
    const cur = best.get(products[0]);
    if (!cur || rank > cur.rank) best.set(products[0], { rank, value });
  });
  return new Map(Array.from(best, ([k, v]) => [k, v.value]));
}

// Prix unitaire appliqué à un enregistrement du catalogue.
function unitPrice(product, negotiated) {
  return negotiated.has(product.id) ? negotiated.get(product.id) : numberOf((product.fields || {})["Prix de base"]);
}

module.exports = { negotiatedValue, negotiatedFor, unitPrice, periodOf, isPeriod, iso };
