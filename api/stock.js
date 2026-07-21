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
  const response = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
  return response.json();
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

async function logCorrection(record, after, note, movementType){
  const before = Number(record.fields["Quantité disponible"] || 0);
  const type = ["Correction inventaire", "Entrée stock", "Retour client"].includes(movementType) ? movementType : "Correction inventaire";
  const result = await at(encodeURIComponent("Mouvements de stock"), {
    method: "POST",
    body: JSON.stringify({ records: [{ fields: {
      "Mouvement": `${type} — ${record.fields["Produit"] || record.id}`,
      "Date et heure": new Date().toISOString(),
      "Type": type,
      "Produit": record.fields["Produit"] || "",
      "Quantité": Math.round((after - before) * 1000) / 1000,
      "Stock avant": before,
      "Stock après": after,
      "Note": note || "Correction manuelle depuis l’écran de stock"
    }}] })
  });
  return result.error ? (result.error.message || "Journal de stock non enregistré") : null;
}

function amount(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

module.exports = async (req, res) => {
  if (!staffCodeReady(res)) return;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const code = req.method === "GET" ? String((req.query || {}).code || "") : String(body.code || "");
    if (!__auth.staffOk(req, code)) return res.status(401).json({ error: "Code invalide" });

    if (req.method === "GET") {
      const stock = await atAll("Stock?sort%5B0%5D%5Bfield%5D=Produit&sort%5B0%5D%5Bdirection%5D=asc");
      if (stock.error) return res.status(500).json(stock);
      return res.status(200).json({ items: (stock.records || []).map(record => ({
        id: record.id,
        product: record.fields["Produit"] || "",
        quantity: Number(record.fields["Quantité disponible"] || 0),
        lowThreshold: Number(record.fields["Seuil bas"] || 0)
      })) });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    const quantity = amount(body.quantity);
    if (!body.id || quantity == null || quantity < 0 || quantity > 1000000) {
      return res.status(400).json({ error: "Ongeldige voorraadhoeveelheid" });
    }
    const note = String(body.note || "").trim().slice(0, 200);
    const movementType = String(body.movementType || "Correction inventaire");
    if (!note) return res.status(400).json({ error: "Vul een reden of referentie in voor deze voorraadwijziging" });
    if (!["Correction inventaire", "Entrée stock", "Retour client"].includes(movementType)) {
      return res.status(400).json({ error: "Ongeldig voorraadtype" });
    }
    const current = await at(`Stock/${body.id}`);
    if (current.error) return res.status(404).json({ error: "Artikel niet gevonden" });
    const rounded = Math.round(quantity * 1000) / 1000;
    const saved = await at(`Stock/${body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { "Quantité disponible": rounded } })
    });
    if (saved.error) return res.status(500).json(saved);
    const journalWarning = await logCorrection(current, rounded, note, movementType);
    return res.status(200).json({ ok: true, quantity: Number(saved.fields["Quantité disponible"] || 0), journalWarning });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
};
