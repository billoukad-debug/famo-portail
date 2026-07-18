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
    const client = cl.records[0];
    const clientId = client.id;
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
    res.status(200).json({ client: { id: clientId, nom: client.fields["Nom"], adresse: client.fields["Lieu de livraison"] || "" }, products });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
