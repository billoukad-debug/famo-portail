const TOKEN = process.env.AIRTABLE_TOKEN;
const STAFF_CODE = process.env.STAFF_CODE || "famo2026";
const BASE = "appcdduLth9iGX8I0";

async function at(path, opts){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
  return r.json();
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

// Déduit toutes les quantités en une seule mise à jour Airtable. Aucune ligne ne
// part si un produit est inconnu : le magasin peut corriger le BL sans dérive de stock.
async function deductStock(lignes){
  const report = { done: [], missing: [], insufficient: [] };
  const items = parseLines(lignes);
  if (!items.length) return { ...report, error: "Geen geldige artikellijnen gevonden" };

  const st = await at("Stock");
  const recs = st.records || [];
  const norm = s => String(s || "").toLowerCase().trim();

  const updates = [];
  for (const it of items){
    const rec = recs.find(r => norm(r.fields["Produit"]) === norm(it.nom));
    if (!rec){ report.missing.push(it.nom); continue; }
    const cur = numberOf(rec.fields["Quantité disponible"]);
    if (cur < it.qty) {
      report.insufficient.push({ nom: it.nom, available: cur, requested: it.qty });
      continue;
    }
    const next = Math.round((cur - it.qty) * 1000) / 1000;
    updates.push({ id: rec.id, fields: { "Quantité disponible": next } });
    report.done.push({ nom: it.nom, van: cur, naar: next });
  }
  if (report.missing.length || report.insufficient.length) return report;
  const saved = await at("Stock", { method: "PATCH", body: JSON.stringify({ records: updates }) });
  if (saved.error) return { ...report, error: saved.error.message || "Voorraad kon niet worden bijgewerkt" };
  return report;
}

// Numéro de facture séquentiel : FA-2026-0001
async function nextInvoiceNumber(){
  const year = new Date().getFullYear();
  const j = await at(`Commandes?fields%5B%5D=${encodeURIComponent("Factuurnummer")}`);
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
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};
    const { code, id, statut, paiement, lignes, total } = body;
    if (code !== STAFF_CODE) return res.status(401).json({ error: "Code invalide" });
    if (!id) return res.status(400).json({ error: "id requis" });

    const cur = await at(`Commandes/${id}`);
    if (cur.error) return res.status(500).json(cur);
    const f = cur.fields || {};

    // Once goods left the warehouse, changing quantities would no longer match
    // the stock movement and the delivery note. Create a correction instead.
    if (f["Stock afgeboekt"] && (typeof lignes === "string" || typeof total === "number")) {
      return res.status(409).json({ error: "Deze levering is al uit voorraad geboekt en kan niet meer worden gewijzigd" });
    }

    const fields = {};
    if (paiement && !["Payé", "En attente"].includes(paiement)) return res.status(400).json({ error: "Ongeldige betaalstatus" });
    if (paiement) fields["Statut paiement"] = paiement;
    if (typeof lignes === "string") fields["Lignes (produits / quantités)"] = lignes;
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

    let stockReport = null, factuurnummer = null;

    // Stock déduit au moment où la marchandise part réellement
    if (statut === "Sortie en livraison" && !f["Stock afgeboekt"]) {
      const useLines = (typeof lignes === "string" ? lignes : f["Lignes (produits / quantités)"]);
      stockReport = await deductStock(useLines);
      if (stockReport.error || stockReport.missing.length || stockReport.insufficient.length) {
        return res.status(409).json({
          error: stockReport.error || "Voorraadcontrole mislukt",
          stock: stockReport
        });
      }
      fields["Stock afgeboekt"] = true;
    }

    // Numéro de facture attribué une seule fois
    if (statut === "Facturée" && !f["Factuurnummer"]) {
      factuurnummer = await nextInvoiceNumber();
      fields["Factuurnummer"] = factuurnummer;
    }

    if (!Object.keys(fields).length) return res.status(400).json({ error: "rien à mettre à jour" });

    const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    if (j.error) return res.status(500).json(j);
    res.status(200).json({ ok: true, stock: stockReport, factuurnummer });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
