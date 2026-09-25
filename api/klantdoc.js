require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, escapeFormula } = require("../lib/airtable");
// Documenten voor de klant (leveringsbon, factuur) : de gegevens die nodig zijn om
// het document in de browser op te bouwen, enkel voor de eigen bestellingen.
// POST {user, pw, ref} -> {order, config}. Geen IBAN/BIC voor niet-gefactureerde bestellingen.
const { authClient } = require("./catalogue");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Gebruik POST." });
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    const client = await authClient(q.user, q.pw, q.token);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    const ref = String(q.ref || "").slice(0, 40);
    if (!ref) return res.status(400).json({ error: "Referentie ontbreekt" });
    const found = await at(`Commandes?filterByFormula=${encodeURIComponent(`{Référence}='${escapeFormula(ref)}'`)}&maxRecords=1`);
    const rec = ((found && found.records) || [])[0];
    if (!rec || !(rec.fields["Client"] || []).includes(client.id)) return res.status(404).json({ error: "Bestelling niet gevonden" });
    const f = rec.fields || {};
    if (f["Statut"] === "Annulée") return res.status(409).json({ error: "Deze bestelling is geannuleerd: er zijn geen documenten." });
    const conf = await at(`${encodeURIComponent("Configuratie")}?maxRecords=1`);
    const c = ((conf.records || [])[0] || {}).fields || {};
    const invoiced = f["Statut"] === "Facturée";
    res.status(200).json({
      order: {
        id: rec.id, ref: f["Référence"] || "", date: f["Date"] || "", dateLiv: f["Date livraison souhaitée"] || "",
        lignes: f["Lignes (produits / quantités)"] || "", total: f["Total"] || 0, statut: f["Statut"] || "Reçue",
        paiement: f["Statut paiement"] || "En attente", factuurnummer: f["Factuurnummer"] || "", notes: f["Notes"] || "",
        client: client.fields["Nom"] || "",
        klant: { nom: client.fields["Nom"] || "", adresse: client.fields["Lieu de livraison"] || "", btw: client.fields["BTW-nummer"] || "", klantnr: client.fields["Klantnummer"] || "" },
        livreeLe: f["Livrée le"] || "", receptionnePar: f["Réceptionné par"] || ""
      },
      config: {
        bedrijfsnaam: c["Bedrijfsnaam"] || "FAMO Seafood", adres: c["Adres"] || "", plaats: c["Postcode en plaats"] || "", btw: c["BTW-nummer"] || "",
        telefoon: c["Telefoon"] || "", email: c["E-mail"] || "",
        iban: invoiced ? (c["IBAN"] || "").trim() : "", bic: invoiced ? (c["BIC"] || "").trim() : "",
        btwTarief: Number(c["BTW-tarief"]) > 0 ? Number(c["BTW-tarief"]) : 6,
        betalingsvoorwaarden: (c["Betalingsvoorwaarden"] || "").trim(), leveringsvoorwaarden: (c["Leveringsvoorwaarden"] || "").trim()
      }
    });
  } catch (e) {
    { console.error("[klantdoc]", e && e.message || e); res.status(500).json({ error: "Serverfout. Probeer opnieuw." }); }
  }
};
