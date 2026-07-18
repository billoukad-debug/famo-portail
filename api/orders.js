const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = "appcdduLth9iGX8I0";
async function at(path){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}
module.exports = async (req, res) => {
  try {
    const email = String((req.query && req.query.email) || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "email requis" });
    const cl = await at(`Clients?filterByFormula=${encodeURIComponent(`LOWER({Email})='${email}'`)}`);
    if (!cl.records || !cl.records.length) return res.status(404).json({ error: "Client introuvable" });
    const clientId = cl.records[0].id;
    const cmd = await at(`Commandes?sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`);
    const orders = (cmd.records || [])
      .filter(r => (r.fields["Client"] || []).includes(clientId))
      .map(r => ({
        ref: r.fields["Référence"] || "",
        date: r.fields["Date"] || "",
        lignes: r.fields["Lignes (produits / quantités)"] || "",
        total: r.fields["Total"] || 0,
        statut: r.fields["Statut"] || "",
        paiement: r.fields["Statut paiement"] || ""
      }));
    res.status(200).json({ orders });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
