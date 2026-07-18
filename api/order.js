const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = "appcdduLth9iGX8I0";
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};
    const { clientId, lignes, total, notes, dateLivraison } = body;
    if (!clientId || !lignes) return res.status(400).json({ error: "données manquantes" });
    const ref = "CMD-" + Date.now();
    const today = new Date().toISOString().slice(0, 10);
    const fields = {
      "Référence": ref,
      "Date": today,
      "Lignes (produits / quantités)": lignes,
      "Statut": "Reçue",
      "Statut paiement": "En attente",
      "Total": total,
      "Notes": notes || "",
      "Client": [clientId]
    };
    if (dateLivraison) fields["Date livraison souhaitée"] = dateLivraison;
    const payload = { records: [{ fields }] };
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/Commandes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (j.error) return res.status(500).json(j);
    res.status(200).json({ ref, id: j.records[0].id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
