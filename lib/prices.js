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

// productId → prix négocié renseigné, pour un client donné.
function negotiatedFor(records, clientId) {
  const prices = new Map();
  (records || []).forEach(record => {
    const fields = record.fields || {};
    const clients = fields["Client"] || [];
    const products = fields["Produit"] || [];
    const value = negotiatedValue(fields["Prix négocié"]);
    if (clientId && clients.includes(clientId) && products[0] && value !== null) prices.set(products[0], value);
  });
  return prices;
}

// Prix unitaire appliqué à un enregistrement du catalogue.
function unitPrice(product, negotiated) {
  return negotiated.has(product.id) ? negotiated.get(product.id) : numberOf((product.fields || {})["Prix de base"]);
}

module.exports = { negotiatedValue, negotiatedFor, unitPrice };
