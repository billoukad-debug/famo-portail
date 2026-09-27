require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { atAll } = require("../lib/airtable");
// Bestellingen van de aangemelde klant. POST {user, pw} -> {orders}.
// Détail suffisant pour une fiche côté client (nota, factuur, betaling, annulation),
// jamais rien d'interne (Correcties, boîte ops, notes préfixées d'une source restent
// visibles telles quelles : ce sont les notes du client lui-même).
const { authClient } = require("./catalogue");
const __bill = require("../lib/billing");
const { parseLines } = require("./updateorder");

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
    const client = await authClient(q.user, q.pw, q.token);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    const clientId = client.id;

    const cmd = await atAll(`Commandes?sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc&filterByFormula=${encodeURIComponent(WINDOW)}`);
    if (cmd.error) return res.status(500).json({ error: cmd.error.message || "Bestellingen onleesbaar" });
    // Montant TVAC par commande (même règle que les documents) : le client ne voit jamais un HT « à payer ».
    const [conf, catl] = await Promise.all([atAll(encodeURIComponent("Configuratie") + "?maxRecords=1"), atAll("Catalogue")]);
    const cf = ((conf.records || [])[0] || {}).fields || {};
    const fallback = __bill.defaultRate(cf), rates = __bill.ratesFromCatalogue(catl.records || []);
    const tvac = f => { const l = parseLines(f["Lignes (produits / quantités)"]); return l.some(x => x.price != null) ? __bill.orderTotals(l, __bill.linesRates(l, f, rates, fallback), fallback).total : __bill.vat.r2((Number(f["Total"]) || 0) * (1 + fallback / 100)); };
    const orders = (cmd.records || [])
      .filter(r => (r.fields["Client"] || []).includes(clientId))
      .map(r => ({
        ref: r.fields["Référence"] || "",
        date: r.fields["Date"] || "",
        dateLiv: r.fields["Date livraison souhaitée"] || "",
        lignes: r.fields["Lignes (produits / quantités)"] || "",
        total: r.fields["Total"] || 0,
        totalIncl: tvac(r.fields),
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
    { console.error("[orders]", e && e.message || e); res.status(500).json({ error: "Serverfout. Probeer opnieuw." }); }
  }
};
