// Bestellingen van de aangemelde klant. POST {user, pw} -> {orders}.
// Détail suffisant pour une fiche côté client (nota, factuur, betaling, annulation),
// jamais rien d'interne (Correcties, boîte ops, notes préfixées d'une source restent
// visibles telles quelles : ce sont les notes du client lui-même).
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = "appcdduLth9iGX8I0";
const { authClient } = require("./catalogue");

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

// Ouvert + 365 jours d'historique (voir api/allorders.js). Le lien « Client » ne se
// filtre pas par id dans une formule Airtable : le tri par client reste côté serveur en JS.
const WINDOW = `OR(AND({Statut}!='Facturée',{Statut}!='Annulée'),IS_AFTER({Date},DATEADD(TODAY(),-365,'days')))`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Gebruik POST. Wachtwoorden horen niet in een URL." });
  }
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    const client = await authClient(q.user, q.pw);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    const clientId = client.id;

    const cmd = await atAll(`Commandes?sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc&filterByFormula=${encodeURIComponent(WINDOW)}`);
    if (cmd.error) return res.status(500).json({ error: cmd.error.message || "Bestellingen onleesbaar" });
    const orders = (cmd.records || [])
      .filter(r => (r.fields["Client"] || []).includes(clientId))
      .map(r => ({
        ref: r.fields["Référence"] || "",
        date: r.fields["Date"] || "",
        dateLiv: r.fields["Date livraison souhaitée"] || "",
        lignes: r.fields["Lignes (produits / quantités)"] || "",
        total: r.fields["Total"] || 0,
        statut: r.fields["Statut"] || "",
        paiement: r.fields["Statut paiement"] || "",
        payeLe: r.fields["Payé le"] || "",
        notes: r.fields["Notes"] || "",
        factuurnummer: r.fields["Factuurnummer"] || "",
        factureeLe: r.fields["Facturée le"] || "",
        livreeLe: r.fields["Livrée le"] || "",
        receptionnePar: r.fields["Réceptionné par"] || "",
        annuleeLe: r.fields["Annulée le"] || "",
        motifAnnulation: r.fields["Motif annulation"] || "",
        uitzondering: r.fields["Uitzondering levering"] || "",
        creditnota: r.fields["Creditnota nummer"] ? { nummer: r.fields["Creditnota nummer"], montant: Number(r.fields["Creditnota montant"] || 0), le: r.fields["Creditnota le"] || "" } : null
      }));
    res.status(200).json({ orders });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
