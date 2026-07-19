const TOKEN = process.env.AIRTABLE_TOKEN;
const STAFF_CODE = process.env.STAFF_CODE || "famo2026";
const BASE = "appcdduLth9iGX8I0";

async function at(path, opts){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
  return r.json();
}

module.exports = async (req, res) => {
  try {
    // ---------- POST : créer une commande au nom d'un client ----------
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      if (!body) body = {};
      if (body.code !== STAFF_CODE) return res.status(401).json({ error: "Code invalide" });
      const { clientId, lignes, total, notes, dateLivraison, bron } = body;
      if (!clientId || !lignes) return res.status(400).json({ error: "Klant en artikelen vereist" });

      const ref = "CMD-" + Date.now();
      const fields = {
        "Référence": ref,
        "Date": new Date().toISOString().slice(0, 10),
        "Lignes (produits / quantités)": lignes,
        "Statut": "Reçue",
        "Statut paiement": "En attente",
        "Total": total,
        "Notes": (bron ? "[" + bron + "] " : "") + (notes || ""),
        "Client": [clientId]
      };
      if (dateLivraison) fields["Date livraison souhaitée"] = dateLivraison;

      const j = await at("Commandes", { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
      if (j.error) return res.status(500).json(j);
      return res.status(200).json({ ref, id: j.records[0].id });
    }

    // ---------- GET ----------
    const q = req.query || {};
    if (q.code !== STAFF_CODE) return res.status(401).json({ error: "Code invalide" });

    // Liste des clients
    if (!q.client) {
      const cl = await at("Clients");
      const clients = (cl.records || []).map(r => ({
        id: r.id,
        nom: r.fields["Nom"] || "",
        adresse: r.fields["Lieu de livraison"] || "",
        tel: r.fields["Téléphone"] || ""
      })).sort((a, b) => a.nom.localeCompare(b.nom));
      return res.status(200).json({ clients });
    }

    // Catalogue avec les prix négociés d'un client donné
    const clientId = q.client;
    const cat = await at(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`);
    const neg = await at(`${encodeURIComponent("Prix négociés")}`);
    const negMap = {};
    (neg.records || []).forEach(r => {
      const cli = r.fields["Client"] || [];
      const prod = r.fields["Produit"] || [];
      if (cli.includes(clientId) && prod.length) negMap[prod[0]] = r.fields["Prix négocié"];
    });
    const products = (cat.records || []).map(r => ({
      id: r.id,
      nom: r.fields["Produit"],
      cat: r.fields["Catégorie"] || "",
      unite: r.fields["Unité"] || "",
      base: r.fields["Prix de base"] || 0,
      prix: (negMap[r.id] != null ? negMap[r.id] : (r.fields["Prix de base"] || 0))
    }));
    return res.status(200).json({ products });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
