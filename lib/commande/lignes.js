"use strict";
// Bijwerken · lignes modifiées par le magasin (normalisation, prix figés) — de api/updateorder.js (A6).
const { atAll, __prices, __bill, __guard, norm, money, parseLines, formatLine } = require("./common");
const __lj = require("../lignesjson");

// Lignes modifiées par le magasin : chaque article doit exister au catalogue (actif ou
// non : un produit désactivé entre-temps reste livrable), les quantités décimales
// seulement au kg. Prix de chaque ligne :
//   1. celui FIGÉ dans la commande enregistrée (même article) ;
//   2. sinon le prix négocié du client, sinon le prix de base.
// Le prix [€x] envoyé par le navigateur n'est accepté que d'un beheerder (remise
// volontaire) ; pour le personnel il est ignoré. Total recalculé ici, jamais celui du navigateur.
// Lignes structurées (B4, specs/016) : un article déjà sur la commande est retrouvé par sa référence
// enregistrée (storedJson) avant son nom — renommé depuis, ou nom repris par un autre produit ;
// un article ajouté, par son nom. Renvoie aussi le JSON à écrire (jamais celui du navigateur).
async function normalizeLines(txt, clientId, storedTxt, allowPriceOverride, confirmPrice, storedJson){
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
  const byId = new Map((catalogue.records || []).map(record => [record.id, record]));
  const storedId = new Map(__lj.linked(storedTxt, storedJson).filter(l => l.productId).map(l => [norm(l.nom), l.productId]));
  const storedPak = __lj.pakById(storedJson);
  let negByProduct = new Map();
  if (clientId && lines.some(l => l.price == null)) {
    const neg = await atAll(encodeURIComponent("Prix négociés"));
    if (!neg.error) negByProduct = __prices.negotiatedFor(neg.records, clientId);
  }
  let total = 0;
  const out = [], structured = [];
  for (const line of lines) {
    // Référence enregistrée d'abord (même article que la commande, même renommé ou si un autre produit a repris son nom).
    const product = byId.get(storedId.get(norm(line.nom))) || byName.get(norm(line.nom));
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
    // Verpakking (specs/023) : un article déjà sur la commande garde le conditionnement enregistré
    // (comme son prix) ; un article ajouté prend celui du catalogue. Quantité libre ici : le magasin
    // corrige ce qui est réellement livré (la règle « enkel per verpakking » vaut à la commande).
    const kept = storedId.get(norm(line.nom)) === product.id;
    structured.push(__lj.entry(product, Object.assign({ qty: line.qty, unit, price, comment: line.comment }, kept ? { pak: storedPak.get(product.id) || null } : {})));
  }
  return { lignes: out.join("\n"), json: __lj.serialize(structured), total: money(total) };
}

module.exports = { normalizeLines };
