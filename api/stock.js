const TOKEN = process.env.AIRTABLE_TOKEN;
const __auth = require("../lib/staffauth");
function staffCodeReady(res){
  if (__auth.hasCode()) return true;
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

function escapeFormula(value){
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

module.exports = async (req, res) => {
  if (!staffCodeReady(res)) return;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const q = req.query || {};
    if (!__auth.staffOk(req)) return res.status(401).json({ error: "Ongeldige personeelscode" });

    if (req.method === "GET" && String(q.history || "") === "1") {
      const product = String(q.product || "").trim();
      let path = `${encodeURIComponent("Mouvements de stock")}?sort%5B0%5D%5Bfield%5D=${encodeURIComponent("Date et heure")}&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=40`;
      if (product) {
        path += `&filterByFormula=${encodeURIComponent(`{Produit}='${escapeFormula(product)}'`)}`;
      }
      const moves = await at(path);
      if (moves.error) return res.status(500).json(moves);
      return res.status(200).json({
        movements: (moves.records || []).map(record => ({
          id: record.id,
          type: record.fields["Type"] || "",
          product: record.fields["Produit"] || "",
          quantity: Number(record.fields["Quantité"] || 0),
          before: Number(record.fields["Stock avant"] || 0),
          after: Number(record.fields["Stock après"] || 0),
          note: record.fields["Note"] || "",
          at: record.fields["Date et heure"] || ""
        }))
      });
    }

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

    const hasThreshold = body.lowThreshold !== undefined && body.lowThreshold !== null && body.lowThreshold !== "";
    let lowRounded = null;
    if (hasThreshold) {
      const low = amount(body.lowThreshold);
      if (low == null || low < 0 || low > 1000000) {
        return res.status(400).json({ error: "Ongeldige drempel" });
      }
      lowRounded = Math.round(low * 1000) / 1000;
    }

    const current = await at(`Stock/${body.id}`);
    if (current.error) return res.status(404).json({ error: "Artikel niet gevonden" });
    const before = Number(current.fields["Quantité disponible"] || 0);
    const rounded = Math.round(quantity * 1000) / 1000;
    const fields = { "Quantité disponible": rounded };
    if (hasThreshold) fields["Seuil bas"] = lowRounded;

    const saved = await at(`Stock/${body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields })
    });
    if (saved.error) return res.status(500).json(saved);

    let journalWarning = null;
    if (rounded !== before) {
      journalWarning = await logCorrection(current, rounded, note, movementType);
    }
    return res.status(200).json({
      ok: true,
      quantity: Number(saved.fields["Quantité disponible"] || 0),
      lowThreshold: Number(saved.fields["Seuil bas"] || 0),
      journalWarning
    });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
};
