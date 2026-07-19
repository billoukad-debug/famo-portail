const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = "appcdduLth9iGX8I0";

async function at(path){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}

async function authClient(user, pw){
  if (!user || !pw) return null;
  const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${String(user).toLowerCase().replace(/'/g, "")}'`);
  const cl = await at(`Clients?filterByFormula=${f}`);
  if (!cl.records || !cl.records.length) return null;
  const rec = cl.records[0];
  const stored = rec.fields["Wachtwoord"];
  if (!stored || String(stored) !== String(pw)) return null;
  return rec;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};

    // Le client est identifié côté serveur : on ne fait jamais confiance au clientId envoyé.
    const client = await authClient(body.user, body.pw);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    const clientId = client.id;

    const { lignes, total, notes, dateLivraison } = body;
    if (!lignes) return res.status(400).json({ error: "Geen artikelen" });

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

    const r = await fetch(`https://api.airtable.com/v0/${BASE}/Commandes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields }] })
    });
    const j = await r.json();
    if (j.error) return res.status(500).json(j);
    res.status(200).json({ ref, id: j.records[0].id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
