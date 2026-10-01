"use strict";
// Bijwerken · corrections (terug, annuleren, herstellen, bewerken) — de api/updateorder.js (A6).
// Garde, session, verrou et journal d'audit restent dans api/updateorder.js (seul point d'entrée HTTP).
const { at, __auth, __lev, correctionLine, journal, CANCELLED, CORRECTIONS, notifyStatus } = require("./common");
const { createStockMovements, moveStock, undoStock } = require("./stock");
const __lj = require("../lignesjson");

async function applyCorrection(req, res, id, f, body, statuses){
  const isAdmin = __auth.adminOk(req);
  const actor = __auth.actorOf(req);
  const correction = String(body.correction || "");
  const reden = String(body.reden || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!CORRECTIONS.includes(correction)) return res.status(400).json({ error: "Onbekende correctie" });
  if (reden.length < 3) return res.status(400).json({ error: "Geef een reden op (minstens 3 tekens)" });

  const current = f["Statut"] || "Reçue";
  const idx = statuses.indexOf(current);
  const ref = f["Référence"] || id;
  const fields = {};
  let stockReport = null, label = "", target = current, mailStatus = "";

  if (correction === "terug") {
    if (current === CANCELLED) return res.status(409).json({ error: "Geannuleerde bestelling: gebruik Herstellen" });
    if (idx <= 0) return res.status(409).json({ error: "Deze bestelling staat al bij de eerste stap (Ontvangen)" });
    target = statuses[idx - 1];
    if (current === "Prête") {
      fields["Préparation validée"] = false; fields["Préparée le"] = null;
      label = "Terug naar te bereiden";
    } else if (current === "Sortie en livraison") {
      if (f["Stock afgeboekt"]) {
        stockReport = await moveStock(f["Lignes (produits / quantités)"], +1, f[__lj.FIELD]);
        if (stockReport.error) return res.status(500).json({ error: stockReport.error });
        if (stockReport.missing.length) stockReport.journalWarning = "Niet in voorraad teruggezet: " + stockReport.missing.join(", ");
        const w = await createStockMovements(stockReport, ref, "Annulation sortie"); if (w) stockReport.journalWarning = w;
        fields["Stock afgeboekt"] = false;
      }
      label = "Terug naar klaar (vertrek ongedaan)";
    } else if (current === "Facturée") {
      if (!isAdmin) return res.status(403).json({ error: "Enkel een beheerder kan een ontvangst ongedaan maken" });
      if (f["Statut paiement"] === "Payé") return res.status(409).json({ error: "Deze factuur staat op betaald. Zet ze eerst terug op openstaand." });
      if (f["Creditnota nummer"]) return res.status(409).json({ error: "Er bestaat al een creditnota op deze factuur: de ontvangst kan niet meer ongedaan gemaakt worden." });
      fields["Livraison confirmée"] = false; fields["Réceptionné par"] = ""; fields["Livrée le"] = null; fields["Preuve de livraison"] = [];
      fields["Uitzondering levering"] = null; fields["Uitzondering nota"] = "";
      // Le factuurnummer reste sur la commande : réutilisé à la prochaine confirmation, jamais réattribué.
      label = "Ontvangst ongedaan gemaakt (factuur " + (f["Factuurnummer"] || "—") + " blijft voorbehouden)";
    }
    fields["Statut"] = target;
  }

  if (correction === "annuleren") {
    if (current === CANCELLED) return res.status(409).json({ error: "Deze bestelling is al geannuleerd" });
    if (current === "Facturée") return res.status(409).json({ error: "Een gefactureerde bestelling kan niet geannuleerd worden. Maak een creditnota." });
    // Une facture a déjà été émise (réception défaite ensuite) : annuler créerait une facture fantôme.
    if (f["Factuurnummer"]) return res.status(409).json({ error: `Factuur ${f["Factuurnummer"]} bestaat al voor deze bestelling: lever ze opnieuw of maak een creditnota.` });
    if (current === "Sortie en livraison") {
      if (!isAdmin) return res.status(403).json({ error: "Enkel een beheerder kan een bestelling annuleren die al onderweg is" });
      if (f["Stock afgeboekt"]) {
        stockReport = await moveStock(f["Lignes (produits / quantités)"], +1, f[__lj.FIELD]);
        if (stockReport.error) return res.status(500).json({ error: stockReport.error });
        if (stockReport.missing.length) stockReport.journalWarning = "Niet in voorraad teruggezet: " + stockReport.missing.join(", ");
        const w = await createStockMovements(stockReport, ref, "Annulation sortie"); if (w) stockReport.journalWarning = w;
        fields["Stock afgeboekt"] = false;
      }
    }
    target = CANCELLED;
    fields["Statut"] = CANCELLED;
    fields["Annulée le"] = new Date().toISOString();
    fields["Motif annulation"] = reden;
    label = "Geannuleerd";
    mailStatus = "geannuleerd";
  }

  if (correction === "herstellen") {
    if (current !== CANCELLED) return res.status(409).json({ error: "Alleen een geannuleerde bestelling kan hersteld worden" });
    target = "Reçue";
    fields["Statut"] = "Reçue";
    fields["Annulée le"] = null; fields["Motif annulation"] = "";
    fields["Préparation validée"] = false; fields["Préparée le"] = null;
    label = "Hersteld (terug naar te bereiden)";
  }

  if (correction === "bewerken") {
    if (current === CANCELLED) return res.status(409).json({ error: "Geannuleerde bestelling: herstel ze eerst" });
    if (idx >= 2) return res.status(409).json({ error: "Deze levering is al onderweg: leverdag en nota liggen vast" });
    const changes = [];
    if (typeof body.dateLivraison === "string" && body.dateLivraison !== (f["Date livraison souhaitée"] || "")) {
      const iso = body.dateLivraison.slice(0, 10);
      const rules = await __lev.loadRules(at);
      const err = __lev.checkDate(iso, rules);
      if (err) return res.status(400).json({ error: err });
      fields["Date livraison souhaitée"] = iso;
      changes.push("leverdag " + (f["Date livraison souhaitée"] || "—") + " → " + iso);
    }
    if (typeof body.notes === "string" && body.notes !== (f["Notes"] || "")) {
      fields["Notes"] = String(body.notes).slice(0, 500);
      changes.push("nota gewijzigd");
    }
    if (!changes.length) return res.status(400).json({ error: "Niets gewijzigd" });
    label = changes.join(", ");
  }

  fields["Correcties"] = journal(f, correctionLine(label, actor, reden));
  const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ typecast: true, fields }) });
  if (j.error) { const w = await undoStock(stockReport, +1); return res.status(500).json({ error: j.error.message || "Bijwerken mislukt", stockWarning: w || undefined }); }
  const mail = mailStatus ? await notifyStatus(req, f, mailStatus, { reden }) : null;
  return res.status(200).json({ ok: true, statut: target, correctie: fields["Correcties"].split("\n").pop(), stock: stockReport, mail });
}

module.exports = { applyCorrection };
