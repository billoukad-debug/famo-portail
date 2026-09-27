require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, escapeFormula } = require("../lib/airtable");
const __bill = require("../lib/billing");
const { parseLines } = require("./updateorder");
// Documenten voor de klant (leveringsbon, factuur) : de gegevens die nodig zijn om
// het document in de browser op te bouwen, enkel voor de eigen bestellingen.
// POST {user, pw, ref} -> {order, config}. Geen IBAN/BIC voor niet-gefactureerde bestellingen.
const { authClient } = require("./catalogue");

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  if (req.method !== "POST") return res.status(405).json({ error: "Gebruik POST." });
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    const client = await authClient(q.user, q.pw, q.token);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    const ref = String(q.ref || "").slice(0, 40);
    if (!ref) return res.status(400).json({ error: "Referentie ontbreekt" });
    const found = await at(`Commandes?filterByFormula=${encodeURIComponent(`{Référence}='${escapeFormula(ref)}'`)}&maxRecords=10`);
    const rec = ((found && found.records) || []).find(r => (r.fields["Client"] || []).includes(client.id));
    if (!rec) return res.status(404).json({ error: "Bestelling niet gevonden" });
    const f = rec.fields || {};
    if (f["Statut"] === "Annulée") return res.status(409).json({ error: "Deze bestelling is geannuleerd: er zijn geen documenten." });
    const [conf, cat] = await Promise.all([at(`${encodeURIComponent("Configuratie")}?maxRecords=1`), atAll("Catalogue")]);
    const c = ((conf.records || [])[0] || {}).fields || {};
    const invoiced = f["Statut"] === "Facturée";
    const mode = __bill.modeOf(c), legal = __bill.legalOf(c), fallback = __bill.defaultRate(c);
    // Mêmes taux que le document du personnel : figés à la facturation, sinon catalogue actuel
    // (avant : un seul taux pour toute la facture côté client, audit B-05).
    const btwPerLine = __bill.linesRates(parseLines(f["Lignes (produits / quantités)"]), f, __bill.ratesFromCatalogue((cat && cat.records) || []), fallback);
    res.status(200).json({
      order: {
        id: rec.id, ref: f["Référence"] || "", date: f["Date"] || "", dateLiv: f["Date livraison souhaitée"] || "",
        lignes: f["Lignes (produits / quantités)"] || "", total: f["Total"] || 0, statut: f["Statut"] || "Reçue",
        paiement: f["Statut paiement"] || "En attente", factuurnummer: f["Factuurnummer"] || "", notes: f["Notes"] || "",
        client: client.fields["Nom"] || "",
        klant: { nom: client.fields["Nom"] || "", adresse: client.fields["Lieu de livraison"] || "", btw: client.fields["BTW-nummer"] || "", klantnr: client.fields["Klantnummer"] || "", taal: String(client.fields["Taal"] || "").toUpperCase() === "FR" ? "FR" : "NL" },
        livreeLe: f["Livrée le"] || "", receptionnePar: f["Réceptionné par"] || "",
        factureeLe: f["Facturée le"] || "", btwPerLine,
        besteld: f["Lignes besteld"] || "",
        lots: (() => { try { return f["Lots"] ? JSON.parse(f["Lots"]) : null; } catch (e) { return null; } })()
      },
      config: {
        bedrijfsnaam: c["Bedrijfsnaam"] || "FAMO Seafood", adres: c["Adres"] || "", plaats: c["Postcode en plaats"] || "", btw: c["BTW-nummer"] || "",
        telefoon: c["Telefoon"] || "", email: c["E-mail"] || "",
        // Coordonnées bancaires seulement si le portail émet la facture (mode Portaal) et qu'elle existe :
        // en mode Boekhouder, la facture et le paiement viennent du comptable.
        iban: invoiced && mode === "portaal" ? (c["IBAN"] || "").trim() : "", bic: invoiced && mode === "portaal" ? (c["BIC"] || "").trim() : "",
        btwTarief: fallback, facturatie: mode, legal,
        betalingsvoorwaarden: (c["Betalingsvoorwaarden"] || "").trim(), leveringsvoorwaarden: (c["Leveringsvoorwaarden"] || "").trim()
      }
    });
  } catch (e) {
    { console.error("[klantdoc]", e && e.message || e); res.status(500).json({ error: "Serverfout. Probeer opnieuw." }); }
  }
};
