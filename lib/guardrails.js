"use strict";
// Garde-fous contre les erreurs coûteuses de saisie (audit L-04) : un saumon à 0,16 € au lieu
// de 16 €, 99 999 kg au lieu de 9. Limites dures (refus) et prix « suspects » (confirmation).
const MAX_BASE_PRICE = 2000;  // € par unité : au-delà, c'est une faute de frappe
const MAX_QTY = 1000;         // par ligne de commande (kg, pièces, caisses)

// Prix « suspect » par rapport au prix de base : 0, moins de la moitié ou plus du double.
// Renvoie le motif (texte) ou "" si le prix est plausible.
function suspiciousPrice(price, base) {
  const p = Number(price), b = Number(base);
  if (!Number.isFinite(p)) return "";
  if (p === 0) return "prijs € 0,00";
  if (!(b > 0)) return "";
  if (p < b / 2) return "minder dan de helft van de basisprijs (€ " + b.toFixed(2).replace(".", ",") + ")";
  if (p > b * 2) return "meer dan het dubbele van de basisprijs (€ " + b.toFixed(2).replace(".", ",") + ")";
  return "";
}

// Réponse 409 « à confirmer » : le navigateur redemande avec { confirm: true } après accord.
function needConfirm(res, message) {
  return res.status(409).json({ error: message, needConfirm: true });
}

module.exports = { MAX_BASE_PRICE, MAX_QTY, suspiciousPrice, needConfirm };
