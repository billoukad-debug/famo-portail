const TOKEN = process.env.AIRTABLE_TOKEN;
const STAFF_CODE = process.env.STAFF_CODE || "famo2026";
const BASE = "appcdduLth9iGX8I0";

async function at(path, opts){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
  return r.json();
}

// "Zalmfilet × 3 doos (in filets)"  ->  { nom:"Zalmfilet", qty:3 }
function parseLines(txt){
  return String(txt || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)\s*[×x]\s*([\d.,]+)/);
    if (!m) return null;
    return { nom: m[1].trim(), qty: parseFloat(m[2].replace(",", ".")) || 0 };
  }).filter(Boolean);
}

// Déduit les quantités du stock. Ne bloque jamais la commande : renvoie un rapport.
async function deductStock(lignes){
  const report = { done: [], missing: [] };
  const items = parseLines(lignes);
  if (!items.length) return report;

  const st = await at("Stock");
  const recs = st.records || [];
  const norm = s => String(s || "").toLowerCase().trim();

  for (const it of items){
    const rec = recs.find(r => norm(r.fields["Produit"]) === norm(it.nom));
    if (!rec){ report.missing.push(it.nom); continue; }
    const cur = Number(rec.fields["Quantité disponible"] || 0);
    const next = Math.round((cur - it.qty) * 1000) / 1000;
    await at(`Stock/${rec.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Quantité disponible": next } }) });
    report.done.push({ nom: it.nom, van: cur, naar: next });
  }
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

    const fields = {};
    if (paiement) fields["Statut paiement"] = paiement;
    if (typeof lignes === "string") fields["Lignes (produits / quantités)"] = lignes;
    if (typeof total === "number") fields["Total"] = total;
    if (statut) fields["Statut"] = statut;

    let stockReport = null, factuurnummer = null;

    // Stock déduit au moment où la marchandise part réellement
    if (statut === "Sortie en livraison" && !f["Stock afgeboekt"]) {
      const useLines = (typeof lignes === "string" ? lignes : f["Lignes (produits / quantités)"]);
      stockReport = await deductStock(useLines);
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
