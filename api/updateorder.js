const TOKEN = process.env.AIRTABLE_TOKEN;
const STAFF_CODE = process.env.STAFF_CODE || "famo2026";
const BASE = "appcdduLth9iGX8I0";
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};
    const { code, id, statut, paiement } = body;
    if (code !== STAFF_CODE) return res.status(401).json({ error: "Code invalide" });
    if (!id) return res.status(400).json({ error: "id requis" });
    const fields = {};
    if (statut) fields["Statut"] = statut;
    if (paiement) fields["Statut paiement"] = paiement;
    if (!Object.keys(fields).length) return res.status(400).json({ error: "rien à mettre à jour" });
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/Commandes/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    const j = await r.json();
    if (j.error) return res.status(500).json(j);
    res.status(200).json({ ok: true, statut: (j.fields && j.fields["Statut"]) || statut });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
