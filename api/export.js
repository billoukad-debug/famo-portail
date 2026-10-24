require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, REC } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __bill = require("../lib/billing");
const __ubl = require("../lib/ubl");
const __cn = require("../lib/creditnota");
const { parseLines } = require("./updateorder");
const __boek = require("../lib/boekhouder"); // export par période (specs/034)

// Export pour le comptable (Billtobox / Peppol) — beheerder uniquement.
//   GET /api/export?format=ubl&id=<recId>[&type=credit[&cn=<CN-AAAA-NNNN>]]
//     → facture (ou note de crédit : la note cn, sinon la première) UBL 2.1 Peppol BIS Billing 3.0, en pièce jointe.
//     → 422 { problems:[…] } si une donnée obligatoire manque (n° TVA du client, adresse…) :
//       mieux vaut le dire ici que de voir Billtobox refuser le fichier.
//   GET /api/export?format=lijst&van=JJJJ-MM-DD&tot=JJJJ-MM-DD  (specs/034, écran Beheer → Boekhouder)
//     → { van, tot, documenten:[{ soort, nummer, datum, klant, excl, btw, incl, betaald, verzending, problemen, ubl }] }
//   GET /api/export?format=csv&van=…&tot=…  → le même récapitulatif en CSV (une ligne par document + total).
//   Le CSV « Boekhouding » par taux reste construit dans le navigateur (assets/pages/team/documenten.js).
//   Sans session : 401 ; personnel sans droit beheerder : 403. Lecture seule : rien n'est écrit, rien n'est envoyé.
module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gebruik GET." });
  if (!(await __auth.staffSession(req))) return res.status(401).json({ error: "Niet aangemeld" });
  if (!(await __auth.adminSession(req))) return res.status(403).json({ error: "Enkel voor de beheerder" });
  try {
    const q = req.query || {};
    if (q.format === "lijst" || q.format === "csv") return await periodList(req, res, q);
    if (String(q.format || "") !== "ubl") return res.status(400).json({ error: "Onbekend formaat (ubl, lijst of csv)" });
    const id = String(q.id || "");
    if (!REC.test(id)) return res.status(400).json({ error: "Ongeldige bestelling" });
    const kind = String(q.type || "") === "credit" ? "credit" : "invoice";
    const orderRec = await at(`Commandes/${id}`);
    if (!orderRec || orderRec.error) return res.status(404).json({ error: "Bestelling niet gevonden" });
    const f = orderRec.fields || {};
    if (require("../lib/testorders").isTest(f)) return res.status(409).json({ error: require("../lib/testorders").REFUS }); // essai archivé : jamais exporté (specs/021)
    if (f["Statut"] !== "Facturée" || !f["Factuurnummer"]) return res.status(409).json({ error: "Enkel een gefactureerde bestelling" });
    // Plusieurs notes par facture (C-08) : &cn=<numéro> choisit la note ; sans numéro, la première (comme avant).
    const notes = __cn.list(f);
    if (kind === "credit" && !notes.length) return res.status(409).json({ error: "Geen creditnota op deze factuur" });
    const note = kind === "credit" ? (q.cn ? notes.find(n => n.nummer === String(q.cn)) : notes[0]) : null;
    if (kind === "credit" && !note) return res.status(404).json({ error: "Creditnota niet gevonden op deze factuur" });
    const order = note ? Object.assign({}, orderRec, { fields: Object.assign({}, f, { "Creditnota nummer": note.nummer, "Creditnota lignes": note.lignes, "Creditnota montant": note.montant, "Creditnota le": note.le, "Creditnota motif": note.motif }) }) : orderRec;
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

// Récapitulatif d'une période pour le comptable (lib/boekhouder.js).
async function periodList(req, res, q) {
  const p = __boek.periode(q);
  if (p.error) return res.status(400).json({ error: p.error });
  const [cmd, cl, cat, conf] = await Promise.all([atAll("Commandes?filterByFormula=" + encodeURIComponent("{Statut}='Facturée'")), atAll("Clients"), atAll("Catalogue"), at(`${encodeURIComponent("Configuratie")}?maxRecords=1`)]);
  if (cmd.error || cl.error || cat.error) return res.status(500).json({ error: "Gegevens onleesbaar. Probeer opnieuw." });
  const config = (((conf && conf.records) || [])[0] || {}).fields || {};
  const documenten = __boek.documenten({ orders: cmd.records || [], clients: new Map((cl.records || []).map((r) => [r.id, r])), config, catalogueRates: __bill.ratesFromCatalogue(cat.records || []), van: p.van, tot: p.tot });
  res.setHeader("Cache-Control", "private, no-store");
  if (q.format === "lijst") return res.status(200).json({ van: p.van, tot: p.tot, facturatie: __bill.modeOf(config), documenten });
  const csv = __boek.csvOf(documenten);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="Famo-boekhouder-${p.van}-${p.tot}.csv"`);
  if (typeof res.send === "function") return res.status(200).send(csv);
  res.statusCode = 200; return res.end(csv);
}
