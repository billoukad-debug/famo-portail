const TOKEN = process.env.AIRTABLE_TOKEN;
const STAFF_CODE = process.env.STAFF_CODE;
const __auth = require("../lib/staffauth");
function staffCodeReady(res){
  if (STAFF_CODE) return true;
  res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt. Stel de omgevingsvariabele in op Vercel." });
  return false;
}
const BASE = "appcdduLth9iGX8I0";

async function at(path, opts){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
  return r.json();
}

async function atAll(path){
  let offset = "", records = [];
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await at(path + (offset ? sep + "offset=" + encodeURIComponent(offset) : ""));
    if (page.error) return page;
    records = records.concat(page.records || []);
    offset = page.offset || "";
  } while (offset);
  return { records };
}

async function createStockMovements(report, reference){
  if (!report.done || !report.done.length) return null;
  const now = new Date().toISOString();
  const result = await at(encodeURIComponent("Mouvements de stock"), {
    method: "POST",
    body: JSON.stringify({ records: report.done.map(item => ({ fields: {
      "Mouvement": `${reference} — ${item.nom}`,
      "Date et heure": now,
      "Type": "Sortie livraison",
      "Produit": item.nom,
      "Quantité": -item.qty,
      "Stock avant": item.van,
      "Stock après": item.naar,
      "Référence commande": reference
    }})) })
  });
  return result.error ? (result.error.message || "Journal de stock non enregistré") : null;
}

function numberOf(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// "Zalmfilet × 3 doos (in filets)"  ->  { nom:"Zalmfilet", qty:3 }
function parseLines(txt){
  return String(txt || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)\s*[×x]\s*([\d.,]+)/);
    if (!m) return null;
    return { nom: m[1].trim(), qty: parseFloat(m[2].replace(",", ".")) || 0 };
  }).filter(Boolean);
}

async function validatePreparedLines(txt){
  const lines = parseLines(txt);
  if (!lines.length || lines.some(line => line.qty <= 0)) throw new Error("Ongeldige hoeveelheid in de voorbereiding");
  const catalogue = await atAll("Catalogue");
  if (catalogue.error) throw new Error(catalogue.error.message || "Catalogus kon niet worden gelezen");
  const normalize = value => String(value || "").toLowerCase().trim();
  const byName = new Map((catalogue.records || []).map(record => [normalize(record.fields["Produit"]), record]));
  for (const line of lines) {
    const product = byName.get(normalize(line.nom));
    if (!product) throw new Error(`Artikel niet gevonden in de catalogus: ${line.nom}`);
    if (!/kg/i.test(String(product.fields["Unité"] || "")) && !Number.isInteger(line.qty)) {
      throw new Error("Alleen producten per kg mogen een decimale hoeveelheid hebben");
    }
  }
}

// Déduit toutes les quantités en une seule mise à jour Airtable. Aucune ligne ne
// part si un produit est inconnu : le magasin peut corriger le BL sans dérive de stock.
async function deductStock(lignes){
  const report = { done: [], missing: [], insufficient: [] };
  const items = parseLines(lignes);
  if (!items.length) return { ...report, error: "Geen geldige artikellijnen gevonden" };

  const st = await atAll("Stock");
  const recs = st.records || [];
  const norm = s => String(s || "").toLowerCase().trim();

  const requested = new Map();
  for (const item of items) {
    if (item.qty <= 0) return { ...report, error: "Ongeldige hoeveelheid in de bestelling" };
    const key = norm(item.nom);
    const previous = requested.get(key) || { nom: item.nom, qty: 0 };
    previous.qty += item.qty;
    requested.set(key, previous);
  }

  const updates = [];
  for (const it of requested.values()){
    const rec = recs.find(r => norm(r.fields["Produit"]) === norm(it.nom));
    if (!rec){ report.missing.push(it.nom); continue; }
    const cur = numberOf(rec.fields["Quantité disponible"]);
    if (cur < it.qty) {
      report.insufficient.push({ nom: it.nom, available: cur, requested: it.qty });
      continue;
    }
    const next = Math.round((cur - it.qty) * 1000) / 1000;
    updates.push({ id: rec.id, fields: { "Quantité disponible": next } });
    report.done.push({ nom: it.nom, qty: it.qty, van: cur, naar: next });
  }
  if (report.missing.length || report.insufficient.length) return report;
  const saved = await at("Stock", { method: "PATCH", body: JSON.stringify({ records: updates }) });
  if (saved.error) return { ...report, error: saved.error.message || "Voorraad kon niet worden bijgewerkt" };
  return report;
}

// Numéro de facture séquentiel : FA-2026-0001
async function nextInvoiceNumber(){
  const year = __auth.brusselsYear();
  const j = await atAll(`Commandes?fields%5B%5D=${encodeURIComponent("Factuurnummer")}`);
  let max = 0;
  (j.records || []).forEach(r => {
    const v = r.fields["Factuurnummer"];
    if (!v) return;
    const m = String(v).match(new RegExp("^FA-" + year + "-(\\d+)$"));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `FA-${year}-${String(max + 1).padStart(4, "0")}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST toegestaan" });
  if (!staffCodeReady(res)) return;
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};
    const { code, id, statut, paiement, lignes, total, preparationValidee, deliveryConfirmed, recipient, proofUrl } = body;
    if (!__auth.staffOk(req, code)) return res.status(401).json({ error: "Ongeldige personeelscode" });
    if (!id) return res.status(400).json({ error: "Bestelling-id ontbreekt" });

    const cur = await at(`Commandes/${id}`);
    if (cur.error) return res.status(500).json(cur);
    const f = cur.fields || {};

    // Once goods left the warehouse, changing quantities would no longer match
    // the stock movement and the delivery note. Create a correction instead.
    if (f["Stock afgeboekt"] && (typeof lignes === "string" || typeof total === "number" || preparationValidee)) {
      return res.status(409).json({ error: "Deze levering is al uit voorraad geboekt en kan niet meer worden gewijzigd" });
    }

    const fields = {};
    if (paiement && !["Payé", "En attente"].includes(paiement)) return res.status(400).json({ error: "Ongeldige betaalstatus" });
    if (paiement) fields["Statut paiement"] = paiement;
    if (typeof lignes === "string") {
      try {
        await validatePreparedLines(lignes);
      } catch (error) {
        return res.status(400).json({ error: String(error.message || error) });
      }
      fields["Lignes (produits / quantités)"] = lignes;
    }
    if (typeof total === "number") fields["Total"] = total;
    const statuses = ["Reçue", "Prête", "Sortie en livraison", "Facturée"];
    if (statut && !statuses.includes(statut)) return res.status(400).json({ error: "Ongeldige bestelstatus" });
    if (statut) {
      const currentIndex = statuses.indexOf(f["Statut"] || "Reçue");
      const nextIndex = statuses.indexOf(statut);
      if (nextIndex !== currentIndex && nextIndex !== currentIndex + 1) {
        return res.status(409).json({ error: "Volg de bestelstappen in de juiste volgorde" });
      }
      fields["Statut"] = statut;
    }

    // La validation article par article doit etre EXPLICITE (envoyee par le
    // panneau de validation). Le simple passage de statut ne valide jamais.
    if (statut === "Prête" && preparationValidee !== true && !f["Préparation validée"]) {
      return res.status(409).json({ error: "Valideer eerst elk artikel afzonderlijk vóór u de bestelling op Klaar zet" });
    }
    if (preparationValidee === true) {
      fields["Préparation validée"] = true;
      fields["Préparée le"] = new Date().toISOString();
    }

    let stockReport = null, factuurnummer = null;

    // Stock déduit au moment où la marchandise part réellement
    if (statut === "Sortie en livraison" && !f["Stock afgeboekt"]) {
      if (!f["Préparation validée"]) {
        return res.status(409).json({ error: "Valideer eerst alle artikelen van deze bestelling" });
      }
      const useLines = (typeof lignes === "string" ? lignes : f["Lignes (produits / quantités)"]);
      stockReport = await deductStock(useLines);
      if (stockReport.error || stockReport.missing.length || stockReport.insufficient.length) {
        return res.status(409).json({
          error: stockReport.error || "Voorraadcontrole mislukt",
          stock: stockReport
        });
      }
      fields["Stock afgeboekt"] = true;
      const movementError = await createStockMovements(stockReport, f["Référence"] || id);
      if (movementError) stockReport.journalWarning = movementError;
    }

    if (statut === "Facturée") {
      const alreadyConfirmed = !!f["Livraison confirmée"];
      if (!alreadyConfirmed && !deliveryConfirmed) {
        return res.status(409).json({ error: "Bevestig eerst de ontvangst van de levering" });
      }
      if (deliveryConfirmed) {
        const receivedBy = String(recipient || "").trim();
        if (!receivedBy) return res.status(400).json({ error: "Vul in wie de levering heeft ontvangen" });
        if (proofUrl && !/^https:\/\//i.test(String(proofUrl))) {
          return res.status(400).json({ error: "De link naar het leveringsbewijs moet met https:// beginnen" });
        }
        fields["Livraison confirmée"] = true;
        fields["Réceptionné par"] = receivedBy;
        fields["Livrée le"] = new Date().toISOString();
        if (proofUrl) fields["Preuve de livraison"] = [{ url: String(proofUrl), filename: "leveringsbewijs" }];
      }
    }

    // Numéro de facture attribué une seule fois
    if (statut === "Facturée" && !f["Factuurnummer"]) {
      factuurnummer = await nextInvoiceNumber();
      fields["Factuurnummer"] = factuurnummer;
      fields["Facturée le"] = new Date().toISOString();
    }

    if (!Object.keys(fields).length) return res.status(400).json({ error: "Niets om bij te werken" });

    const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    if (j.error) return res.status(500).json(j);
    res.status(200).json({ ok: true, stock: stockReport, factuurnummer });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
