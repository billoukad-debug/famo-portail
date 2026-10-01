"use strict";
// Bijwerken · mouvements de stock (départ, retour, compensation) — de api/updateorder.js (A6).
const { atAll, atBatch, __atomic, numberOf, norm, parseLines, formatLine } = require("./common");

async function createStockMovements(report, reference, type){
  if (!report.done || !report.done.length) return null;
  const now = new Date().toISOString();
  const result = await atBatch(encodeURIComponent("Mouvements de stock"), "POST", report.done.map(item => ({ fields: {
    "Mouvement": `${reference} — ${item.nom}${type === "Annulation sortie" ? " (terug)" : ""}`,
    "Date et heure": now,
    "Type": type,
    "Produit": item.nom,
    "Quantité": type === "Sortie livraison" ? -item.qty : item.qty,
    "Stock avant": item.van,
    "Stock après": item.naar,
    "Référence commande": reference
  }})), true);
  return result.error ? (result.error.message || "Journal de stock non enregistré") : null;
}

// Déduit (sign -1) ou remet (sign +1) toutes les quantités. En déduction, aucune ligne
// ne part si un produit est inconnu ou insuffisant ; en remise, un produit disparu est ignoré.
async function moveStock(lignes, sign){
  const report = { done: [], missing: [], insufficient: [] };
  const items = parseLines(lignes);
  if (!items.length) return sign < 0 ? { ...report, error: "Geen geldige artikellijnen gevonden" } : report;
  const st = await atAll("Stock");
  if (st.error) return { ...report, error: st.error.message || "Voorraad onleesbaar" };
  const recs = st.records || [];
  const requested = new Map();
  for (const item of items) {
    if (item.qty <= 0) { if (sign < 0) return { ...report, error: "Ongeldige hoeveelheid in de bestelling" }; continue; }
    const key = norm(item.nom);
    const previous = requested.get(key) || { nom: item.nom, qty: 0 };
    previous.qty += item.qty;
    requested.set(key, previous);
  }
  // Moteur SQL (production) : variations atomiques par article. Trois commandes du même produit
  // qui partent ensemble décomptent bien trois fois (avant : lecture puis écriture d'une valeur
  // absolue, la dernière écrasait les autres — audit B-10).
  if (__atomic.store()) {
    for (const it of requested.values()){
      const rec = recs.find(r => norm(r.fields["Produit"]) === norm(it.nom));
      if (!rec){ report.missing.push(it.nom); continue; }
      const r = await __atomic.adjust("Stock", rec.id, "Quantité disponible", sign * it.qty, sign < 0 ? { min: 0 } : null);
      if (!r.ok) { report.insufficient.push({ nom: it.nom, available: r.before || 0, requested: it.qty }); continue; }
      report.done.push({ nom: it.nom, qty: it.qty, van: r.before, naar: r.after, id: rec.id });
    }
    if (sign < 0 && (report.missing.length || report.insufficient.length)) {
      for (const d of report.done) await __atomic.adjust("Stock", d.id, "Quantité disponible", d.qty); // rien de partiel
      return { ...report, done: [] };
    }
    report.done.forEach(d => { delete d.id; });
    return report;
  }
  const updates = [];
  for (const it of requested.values()){
    const rec = recs.find(r => norm(r.fields["Produit"]) === norm(it.nom));
    if (!rec){ report.missing.push(it.nom); continue; }
    const cur = numberOf(rec.fields["Quantité disponible"]);
    if (sign < 0 && cur < it.qty) { report.insufficient.push({ nom: it.nom, available: cur, requested: it.qty }); continue; }
    const next = Math.round((cur + sign * it.qty) * 1000) / 1000;
    updates.push({ id: rec.id, fields: { "Quantité disponible": next } });
    report.done.push({ nom: it.nom, qty: it.qty, van: cur, naar: next });
  }
  if (sign < 0 && (report.missing.length || report.insufficient.length)) return report;
  if (updates.length) {
    const saved = await atBatch("Stock", "PATCH", updates, false);
    if (saved.error) {
      // Écriture interrompue en cours de lot : les paquets déjà écrits reprennent leur valeur.
      const before = new Map(report.done.map((d, i) => [updates[i].id, d.van]));
      if (saved.done && saved.done.length) await atBatch("Stock", "PATCH", saved.done.map(u => ({ id: u.id, fields: { "Quantité disponible": before.get(u.id) } })), false);
      return { ...report, done: [], error: saved.error.message || "Voorraad kon niet worden bijgewerkt" };
    }
  }
  return report;
}

// Annule un mouvement de stock déjà écrit quand l'enregistrement de la commande échoue
// ensuite : sans ça, un nouvel essai déduirait (ou remettrait) une deuxième fois.
// Compensation après un enregistrement refusé. moveStock renvoie {error} au lieu de lever :
// l'échec n'était jamais vu (audit D-13). Renvoie un avertissement lisible, ou null.
async function undoStock(report, sign){
  if (!report || !report.done || !report.done.length) return null;
  const lines = report.done.map(d => formatLine({ nom: d.nom, qty: d.qty, unit: "", price: null, comment: "" })).join("\n");
  try {
    const r = await moveStock(lines, -sign);
    if (r && r.error) { console.error("[updateorder] undoStock", r.error, lines); return "Voorraad niet teruggezet: " + r.error; }
    if (r && r.missing && r.missing.length) return "Niet teruggezet (onbekend product): " + r.missing.join(", ");
    return null;
  } catch (e) { console.error("[updateorder] undoStock", e && e.message || e); return "Voorraad niet teruggezet: " + (e.message || e); }
}

module.exports = { createStockMovements, moveStock, undoStock };
