const TOKEN = process.env.AIRTABLE_TOKEN;
const STAFF_CODE = process.env.STAFF_CODE || "famo2026";
const BASE = "appcdduLth9iGX8I0";

async function at(path, opts){
  const response = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
  return response.json();
}

function amount(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

module.exports = async (req, res) => {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const code = req.method === "GET" ? String((req.query || {}).code || "") : String(body.code || "");
    if (code !== STAFF_CODE) return res.status(401).json({ error: "Code invalide" });

    if (req.method === "GET") {
      const stock = await at("Stock?sort%5B0%5D%5Bfield%5D=Produit&sort%5B0%5D%5Bdirection%5D=asc");
      if (stock.error) return res.status(500).json(stock);
      return res.status(200).json({ items: (stock.records || []).map(record => ({
        id: record.id,
        product: record.fields["Produit"] || "",
        quantity: Number(record.fields["Quantité disponible"] || 0)
      })) });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    const quantity = amount(body.quantity);
    if (!body.id || quantity == null || quantity < 0 || quantity > 1000000) {
      return res.status(400).json({ error: "Ongeldige voorraadhoeveelheid" });
    }
    const saved = await at(`Stock/${body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { "Quantité disponible": Math.round(quantity * 1000) / 1000 } })
    });
    if (saved.error) return res.status(500).json(saved);
    return res.status(200).json({ ok: true, quantity: Number(saved.fields["Quantité disponible"] || 0) });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
};
