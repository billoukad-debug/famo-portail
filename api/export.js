require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, REC } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __bill = require("../lib/billing");
const __ubl = require("../lib/ubl");
const { parseLines } = require("./updateorder");

// Export pour le comptable (Billtobox / Peppol) — beheerder uniquement.
//   GET /api/export?format=ubl&id=<recId>[&type=credit]
//     → facture (ou note de crédit) UBL 2.1 Peppol BIS Billing 3.0, en pièce jointe.
//     → 422 { problems:[…] } si une donnée obligatoire manque (n° TVA du client, adresse…) :
//       mieux vaut le dire ici que de voir Billtobox refuser le fichier.
//   Le CSV (une ligne par facture et par taux) est construit dans le navigateur à partir des
//   mêmes montants (assets/vat.js, taux figés) : assets/pages/documenten.js.
module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gebruik GET." });
  if (!(await __auth.adminSession(req))) return res.status(401).json({ error: "Enkel voor de beheerder" });
  try {
    const q = req.query || {};
    if (String(q.format || "") !== "ubl") return res.status(400).json({ error: "Onbekend formaat (ubl)" });
    const id = String(q.id || "");
    if (!REC.test(id)) return res.status(400).json({ error: "Ongeldige bestelling" });
    const kind = String(q.type || "") === "credit" ? "credit" : "invoice";
    const order = await at(`Commandes/${id}`);
    if (!order || order.error) return res.status(404).json({ error: "Bestelling niet gevonden" });
    const f = order.fields || {};
    if (f["Statut"] !== "Facturée" || !f["Factuurnummer"]) return res.status(409).json({ error: "Enkel een gefactureerde bestelling" });
    if (kind === "credit" && !f["Creditnota nummer"]) return res.status(409).json({ error: "Geen creditnota op deze factuur" });
    const clientId = (f["Client"] || [])[0];
    const [conf, cat, client] = await Promise.all([
      at(`${encodeURIComponent("Configuratie")}?maxRecords=1`), atAll("Catalogue"),
      clientId ? at(`Clients/${encodeURIComponent(clientId)}`) : Promise.resolve(null)
    ]);
    const config = (((conf && conf.records) || [])[0] || {}).fields || {};
    const ctx = __ubl.contextFrom({ order, client: client && !client.error ? client : null, config, catalogueRates: __bill.ratesFromCatalogue((cat && cat.records) || []), parseLines, kind });
    const problems = __ubl.problems(ctx);
    if (problems.length) return res.status(422).json({ error: "UBL onvolledig", problems });
    const { xml } = __ubl.build(ctx);
    const name = (kind === "credit" ? "Creditnota-" : "Factuur-") + String(ctx.number).replace(/[^\w.-]+/g, "-") + ".xml";
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-store");
    if (typeof res.send === "function") return res.status(200).send(xml);
    res.statusCode = 200; return res.end(xml);
  } catch (e) {
    console.error("[export]", e && e.message || e);
    return res.status(500).json({ error: "Serverfout. Probeer opnieuw." });
  }
};
