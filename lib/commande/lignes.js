"use strict";
// Bijwerken · lignes modifiées par le magasin (normalisation, prix figés) — de api/updateorder.js (A6).
const { atAll, __prices, __bill, __guard, norm, money, parseLines, formatLine } = require("./common");

// Lignes modifiées par le magasin : chaque article doit exister au catalogue (actif ou
// non : un produit désactivé entre-temps reste livrable), les quantités décimales
// seulement au kg. Prix de chaque ligne :
//   1. celui FIGÉ dans la commande enregistrée (même article) ;
//   2. sinon le prix négocié du client, sinon le prix de base.
// Le prix [€x] envoyé par le navigateur n'est accepté que d'un beheerder (remise
// volontaire) ; pour le personnel il est ignoré. Total recalculé ici, jamais celui du navigateur.
async function normalizeLines(txt, clientId, storedTxt, allowPriceOverride, confirmPrice){
  const frozen = new Map(parseLines(storedTxt).filter(l => l.price != null).map(l => [norm(l.nom), l.price]));
  const lines = parseLines(txt).map(l => {
    const keep = frozen.has(norm(l.nom)) ? frozen.get(norm(l.nom)) : null;
    const price = allowPriceOverride && l.price != null ? l.price : keep;
    return Object.assign({}, l, { price });
  });
  if (!lines.length || lines.some(line => line.qty <= 0)) throw new Error("Ongeldige hoeveelheid in de voorbereiding");
  if (lines.some(line => line.qty > __guard.MAX_QTY)) throw new Error("Hoeveelheid boven " + __guard.MAX_QTY + " per lijn: controleer de invoer");
  const catalogue = await atAll("Catalogue");
  if (catalogue.error) throw new Error(catalogue.error.message || "Catalogus kon niet worden gelezen");
  const byName = new Map((catalogue.records || []).map(record => [norm(record.fields["Produit"]), record]));
  let negByProduct = new Map();
  if (clientId && lines.some(l => l.price == null)) {
    const neg = await atAll(encodeURIComponent("Prix négociés"));
    if (!neg.error) negByProduct = __prices.negotiatedFor(neg.records, clientId);
  }
  let total = 0;
  const out = [];
  for (const line of lines) {
    const product = byName.get(norm(line.nom));
    if (!product) throw new Error(`Artikel niet gevonden in de catalogus: ${line.nom}`);
    const unit = product.fields["Unité"] || line.unit || "";
    if (!/kg/i.test(String(unit)) && !Number.isInteger(line.qty)) {
      throw new Error("Alleen producten per kg mogen een decimale hoeveelheid hebben");
    }
    const price = line.price != null ? money(line.price) : money(__prices.unitPrice(product, negByProduct));
    // Prix forcé par le beheerder, suspect (0, < ½ ou > 2 × le prix normal) : confirmation (audit L-04).
    if (allowPriceOverride && line.price != null && !confirmPrice && money(line.price) !== money(frozen.get(norm(line.nom)))) {
      const why = __guard.suspiciousPrice(price, __prices.unitPrice(product, negByProduct));
      if (why) throw Object.assign(new Error("Controleer de prijs van " + product.fields["Produit"] + ": " + why + ". Toch opslaan?"), { needConfirm: true });
    }
    total += __bill.vat.r2(price * line.qty); // ligne arrondie au cent (règle unique, audit B-09)
    out.push(formatLine({ nom: product.fields["Produit"], qty: line.qty, unit, price, comment: line.comment }));
  }
  return { lignes: out.join("\n"), total: money(total) };
}

module.exports = { normalizeLines };
