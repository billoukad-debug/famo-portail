const TOKEN = process.env.AIRTABLE_TOKEN;
const STAFF_CODE = process.env.STAFF_CODE || "famo2026";
const BASE = "appcdduLth9iGX8I0";
async function at(path){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
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
module.exports = async (req, res) => {
  try {
    const code = String((req.query && req.query.code) || "");
    if (code !== STAFF_CODE) return res.status(401).json({ error: "Code invalide" });
    const cl = await atAll("Clients");
    const nameById = {}, infoById = {};
    (cl.records || []).forEach(r => {
      nameById[r.id] = r.fields["Nom"] || "";
      infoById[r.id] = {
        nom: r.fields["Nom"] || "",
        adresse: r.fields["Lieu de livraison"] || "",
        btw: r.fields["BTW-nummer"] || "",
        klantnr: r.fields["Klantnummer"] || ""
      };
    });
    const cmd = await atAll("Commandes?sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc");
    const orders = (cmd.records || []).map(r => ({
      id: r.id,
      ref: r.fields["Référence"] || "",
      date: r.fields["Date"] || "",
      dateLiv: r.fields["Date livraison souhaitée"] || "",
      client: (r.fields["Client"] || []).map(id => nameById[id] || id).join(", "),
      klant: infoById[(r.fields["Client"] || [])[0]] || null,
      lignes: r.fields["Lignes (produits / quantités)"] || "",
      total: r.fields["Total"] || 0,
      statut: r.fields["Statut"] || "Reçue",
      paiement: r.fields["Statut paiement"] || "En attente",
      notes: r.fields["Notes"] || "",
      factuurnummer: r.fields["Factuurnummer"] || "",
      stockAf: !!r.fields["Stock afgeboekt"],
      preparationValidee: !!r.fields["Préparation validée"],
      prepareeLe: r.fields["Préparée le"] || "",
      livreeLe: r.fields["Livrée le"] || "",
      livraisonConfirmee: !!r.fields["Livraison confirmée"],
      receptionnePar: r.fields["Réceptionné par"] || "",
      preuveLivraison: (r.fields["Preuve de livraison"] || []).map(file => ({ url: file.url || "", filename: file.filename || "" })),
      factureeLe: r.fields["Facturée le"] || ""
    }));
    res.status(200).json({ orders });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
