"use strict";
// Bijwerken · statut, lignes, paiement, volgorde, lots, départ (stock), réception et facture —
// de api/updateorder.js (A6). Numéro de facture vervallen journalisé (A4, specs/010).
// Garde, session, verrou et journal d'audit restent dans api/updateorder.js (seul point d'entrée HTTP).
const { at, atAll, __auth, __lev, __mail, __bill, __atomic, __guard, __journal, __trace, norm, parseLines, billingContext, correctionLine, journal,
  STATUSES, CANCELLED, UITZONDERINGEN, BETAALWIJZEN, notifyStatus } = require("./common");
const { normalizeLines } = require("./lignes");
const { createStockMovements, moveStock, undoStock } = require("./stock");
const { ensureUnique, nextNumber, vervallen } = require("./nummering");
const __lj = require("../lignesjson");

async function update(req, res, id, f, body){
  const { statut, paiement, lignes, total, preparationValidee, deliveryConfirmed, recipient, proofUrl } = body;
  const statuses = STATUSES;
  const departed = statuses.indexOf(f["Statut"] || "Reçue") >= 2;

  if (f["Statut"] === CANCELLED) {
    return res.status(409).json({ error: "Deze bestelling is geannuleerd. Herstel ze eerst (Corrigeren → Herstellen)." });
  }

  // Ordre de tournée : seul champ modifiable à tout moment avant la facture.
  if (body.volgorde !== undefined) {
    const n = body.volgorde === null || body.volgorde === "" ? null : Math.round(Number(body.volgorde));
    if (n !== null && !(n >= 1 && n <= 999)) return res.status(400).json({ error: "Ongeldige volgorde" });
    const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Volgorde levering": n } }) });
    if (j.error) return res.status(500).json({ error: j.error.message || "Volgorde opslaan mislukt" });
    return res.status(200).json({ ok: true, volgorde: n });
  }

  // Once goods left the warehouse, changing quantities would no longer match
  // the stock movement and the delivery note. Create a correction instead.
  if (f["Factuurnummer"] && (typeof lignes === "string" || typeof total === "number")) {
    return res.status(409).json({ error: `Factuur ${f["Factuurnummer"]} bestaat al voor deze bestelling: de lijnen liggen vast. Maak een retour/creditnota.` });
  }
  if (departed && (typeof lignes === "string" || typeof total === "number" || preparationValidee)) {
    return res.status(409).json({ error: "Deze levering is al onderweg en kan niet meer worden gewijzigd" });
  }
  // Lignes modifiées et départ dans la même requête : les nouvelles lignes n'ont pas été
  // validées article par article — elles le seront d'abord (panneau de validation).
  if (typeof lignes === "string" && statut === "Sortie en livraison") {
    return res.status(409).json({ error: "Valideer eerst de gewijzigde artikelen vóór vertrek" });
  }

  const fields = {};
  if (paiement && !["Payé", "En attente"].includes(paiement)) return res.status(400).json({ error: "Ongeldige betaalstatus" });
  if (paiement && !__auth.adminOk(req)) return res.status(403).json({ error: "Enkel een beheerder wijzigt de betaalstatus" });
  if (paiement) {
    if (paiement === "Payé" && f["Statut"] !== "Facturée" && statut !== "Facturée") return res.status(409).json({ error: "Enkel een gefactureerde bestelling kan op betaald gezet worden" });
    fields["Statut paiement"] = paiement;
    if (paiement === "Payé") {
      fields["Payé le"] = new Date().toISOString();
      const mode = String(body.modePaiement || "").trim();
      if (mode && !BETAALWIJZEN.includes(mode)) return res.status(400).json({ error: "Ongeldige betaalwijze" });
      if (mode) fields["Mode de paiement"] = mode;
      if (f["Statut paiement"] !== "Payé") fields["Correcties"] = journal(f, correctionLine("Betaald" + (mode ? " (" + mode + ")" : ""), __auth.actorOf(req), ""));
    } else {
      fields["Payé le"] = null; fields["Mode de paiement"] = null;
      if (f["Statut paiement"] === "Payé") fields["Correcties"] = journal(f, correctionLine("Terug op openstaand", __auth.actorOf(req), String(body.reden || "").slice(0, 200)));
    }
  }
  if (typeof lignes === "string") {
    let normalized;
    try {
      normalized = await normalizeLines(lignes, (f["Client"] || [])[0], f["Lignes (produits / quantités)"], __auth.adminOk(req), body.confirmPrice === true, f[__lj.FIELD]);
    } catch (error) {
      if (error.needConfirm) return __guard.needConfirm(res, error.message);
      return res.status(400).json({ error: String(error.message || error) });
    }
    fields["Lignes (produits / quantités)"] = normalized.lignes;
    fields[__lj.FIELD] = normalized.json; // forme structurée (B4), toujours du serveur
    if (f["Préparation validée"] && preparationValidee !== true && normalized.lignes !== f["Lignes (produits / quantités)"]) {
      fields["Préparation validée"] = false; // lignes changées après validation : à revalider
    }
    // Le total envoye par le navigateur n'est jamais utilise : prix figés des lignes,
    // prix négocié pour une ligne ajoutée.
    fields["Total"] = normalized.total;
  }
  if (statut && !statuses.includes(statut)) return res.status(400).json({ error: "Ongeldige bestelstatus" });
  if (statut) {
    const currentIndex = statuses.indexOf(f["Statut"] || "Reçue");
    const nextIndex = statuses.indexOf(statut);
    if (nextIndex !== currentIndex && nextIndex !== currentIndex + 1) {
      return res.status(409).json({ error: "Volg de bestelstappen in de juiste volgorde" });
    }
    fields["Statut"] = statut;
  }

  // La validation article par article doit etre EXPLICITE (envoyee par le
  // panneau de validation). Le simple passage de statut ne valide jamais.
  if (statut === "Prête" && preparationValidee !== true && !f["Préparation validée"]) {
    return res.status(409).json({ error: "Valideer eerst elk artikel afzonderlijk vóór u de bestelling op Klaar zet" });
  }
  if (preparationValidee === true) {
    fields["Préparation validée"] = true;
    fields["Préparée le"] = new Date().toISOString();
  }

  // Lots livrés (traçabilité, audit C-13) : choisis à la préparation, figés en instantané.
  if (body.lots !== undefined) {
    if (departed) return res.status(409).json({ error: "Deze levering is al onderweg: de loten liggen vast" });
    const lotRecs = await atAll("Lots");
    if (lotRecs.error) return res.status(500).json({ error: "Loten onleesbaar" });
    const cur0 = typeof lignes === "string" ? fields["Lignes (produits / quantités)"] : f["Lignes (produits / quantités)"];
    const r = __trace.resolve(body.lots, parseLines(cur0), lotRecs.records || []);
    if (r.error) return res.status(400).json({ error: r.error });
    fields["Lots"] = JSON.stringify(Object.assign({}, __trace.parseLots(f["Lots"]) || {}, r.lots));
  }
  // « Lots verplicht » (Configuratie) : pas de « Klaar » sans lot pour chaque article.
  if (statut === "Prête") {
    const st = __journal.store();
    const cf = st ? (((await st.list("Configuratie"))[0] || {}).fields || {}) : {};
    if (cf["Lots verplicht"]) {
      const have = __trace.parseLots(fields["Lots"] || f["Lots"]) || {};
      const cur1 = typeof lignes === "string" ? fields["Lignes (produits / quantités)"] : f["Lignes (produits / quantités)"];
      const zonder = parseLines(cur1).filter(l => !Object.keys(have).some(k => norm(k) === norm(l.nom)) ).map(l => l.nom);
      if (zonder.length) return res.status(409).json({ error: "Kies een lot voor: " + zonder.join(", ") });
    }
  }

  let stockReport = null, factuurnummer = null, mail = null;
  // Contexte de facturation (Configuratie + taux du catalogue) : lu au plus une fois par requête.
  let billCtx = null;
  const getBill = async () => billCtx || (billCtx = await billingContext((f["Client"] || [])[0]));

  // Stock déduit au moment où la marchandise part réellement, SI Configuratie le
  // demande (« Voorraad afboeken »). Le navigateur ne décide plus (ancien skipStock).
  // Garde d'entrée sur le statut pour empêcher une double déduction si l'appel est rejoué.
  if (statut === "Sortie en livraison" && !departed) {
    if (!f["Préparation validée"]) {
      return res.status(409).json({ error: "Valideer eerst alle artikelen van deze bestelling" });
    }
    const rules = await __lev.loadRules(at);
    if (rules.voorraadAfboeken && !f["Stock afgeboekt"]) {
      // Deux tablettes appuient sur « Vertrekt » en même temps, sur deux instances : une seule
      // réserve le décompte (écriture conditionnelle, audit B-11). Airtable : verrou mémoire seul.
      const claimed = await __atomic.claim("Commandes", id, "Stock afgeboekt", false, true);
      if (claimed === false) return res.status(409).json({ error: "Deze bestelling is al vertrokken (ander toestel)." });
      const useLines = (typeof lignes === "string" ? fields["Lignes (produits / quantités)"] : f["Lignes (produits / quantités)"]);
      stockReport = await moveStock(useLines, -1, typeof lignes === "string" ? fields[__lj.FIELD] : f[__lj.FIELD]);
      if (stockReport.error || stockReport.missing.length || stockReport.insufficient.length) {
        if (claimed) await __atomic.claim("Commandes", id, "Stock afgeboekt", true, false);
        return res.status(409).json({
          error: stockReport.error || "Voorraadcontrole mislukt",
          stock: stockReport
        });
      }
      fields["Stock afgeboekt"] = true;
    }
  }

  if (statut === "Facturée") {
    const alreadyConfirmed = !!f["Livraison confirmée"];
    // Une réception déjà confirmée ne se réécrit pas (double tap, deuxième appareil).
    if (alreadyConfirmed && deliveryConfirmed && f["Statut"] === "Facturée") {
      return res.status(409).json({ error: "De ontvangst van deze bestelling is al bevestigd" });
    }
    if (!alreadyConfirmed && !deliveryConfirmed) {
      return res.status(409).json({ error: "Bevestig eerst de ontvangst van de levering" });
    }
    // Refusée à la porte ou client absent : rien n'a été livré, donc pas de facture (audit B-16).
    // La commande reste « onderweg » avec l'exception au journal ; le magasin la reprend
    // (Corrigeren → Terug : remise en stock) ou la relivre.
    const uitz0 = String(body.uitzondering || "").trim();
    if (deliveryConfirmed && !alreadyConfirmed && (uitz0 === "Geweigerd" || uitz0 === "Afwezig")) {
      const nota = String(body.uitzonderingNota || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
      // Rejeu (file hors ligne, H-12) : la même exception déjà notée ne s'ajoute pas une deuxième fois au journal.
      if (f["Uitzondering levering"] === uitz0 && String(f["Uitzondering nota"] || "") === nota) {
        return res.status(200).json({ ok: true, geleverd: false, uitzondering: uitz0, statut: f["Statut"] || "Sortie en livraison", al: true });
      }
      const upd = { "Uitzondering levering": uitz0, "Uitzondering nota": nota, "Correcties": journal(f, correctionLine("Niet geleverd: " + uitz0 + " (geen factuur)", __auth.actorOf(req), nota)) };
      const w = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: upd }) });
      if (w.error) return res.status(500).json({ error: "Uitzondering opslaan mislukt" });
      return res.status(200).json({ ok: true, geleverd: false, uitzondering: uitz0, statut: f["Statut"] || "Sortie en livraison" });
    }
    if (deliveryConfirmed && !alreadyConfirmed) {
      const receivedBy = String(recipient || "").trim().slice(0, 80);
      if (!receivedBy) return res.status(400).json({ error: "Vul in wie de levering heeft ontvangen" });
      if (proofUrl && !/^https:\/\/[^\s]{1,500}$/i.test(String(proofUrl))) {
        return res.status(400).json({ error: "De link naar het leveringsbewijs moet met https:// beginnen" });
      }
      fields["Livraison confirmée"] = true;
      fields["Réceptionné par"] = receivedBy;
      fields["Livrée le"] = new Date().toISOString();
      if (proofUrl) fields["Preuve de livraison"] = [{ url: String(proofUrl), filename: "leveringsbewijs" }];
      // Exception de livraison (absent, refusé, partiel, abîmé) : gardée sur la commande et dans le journal.
      const uitz = String(body.uitzondering || "").trim();
      if (uitz && !UITZONDERINGEN.includes(uitz)) return res.status(400).json({ error: "Ongeldige uitzondering" });
      if (uitz) {
        fields["Uitzondering levering"] = uitz;
        fields["Uitzondering nota"] = String(body.uitzonderingNota || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
        fields["Correcties"] = journal(f, correctionLine("Uitzondering bij levering: " + uitz, __auth.actorOf(req), fields["Uitzondering nota"]));
      }
    }
  }

  // Numéro de facture attribué une seule fois
  // Taux ET régime de TVA du client (C-10) figés sur la facture ; lus AVANT la réservation du
  // numéro : une lecture impossible ne laisse aucun trou dans la numérotation. Tous les refus
  // possibles sont passés ici (A4) : après la réservation, seule l'écriture peut encore échouer.
  if (statut === "Facturée" && !f["Factuurnummer"]) {
    let bill;
    try { bill = await getBill(); } catch (e) { return res.status(503).json({ error: "Btw-regime van de klant niet leesbaar: probeer opnieuw (er is nog geen factuurnummer gebruikt)." }); }
    factuurnummer = await nextNumber("Factuurnummer", "FA");
    fields["Factuurnummer"] = factuurnummer;
    fields["Facturée le"] = new Date().toISOString();
    fields["BTW per lijn"] = JSON.stringify(__bill.linesRates(parseLines(f["Lignes (produits / quantités)"]), null, bill.rates, bill.fallback, bill.regime));
    if (bill.regime !== "Normal") fields["Régime TVA"] = bill.regime; // Normal = champ absent
  }

  if (!Object.keys(fields).length) return res.status(400).json({ error: "Niets om bij te werken" });

  // Écriture en échec après la réservation (A4) : l'issue est incertaine (elle a peut-être eu lieu),
  // le numéro n'est donc jamais rendu ni réattribué ; la ligne « Nummer vervallen » explique le trou.
  const lost = fout => factuurnummer ? vervallen(req, { id, ref: f["Référence"] || "", veld: "Factuurnummer", nummer: factuurnummer, fout,
    reden: "Opslaan van de bestelling mislukt nadat het nummer gereserveerd was (details in de Vercel-logs)" }) : null;
  let j;
  try { j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) }); } catch (e) { await lost(e && e.message); throw e; }
  if (j.error) { const w = await undoStock(stockReport, -1); if (w) console.error("[updateorder]", w); if (fields["Stock afgeboekt"]) await __atomic.claim("Commandes", id, "Stock afgeboekt", true, false); await lost(j.error.message); return res.status(500).json({ error: j.error.message || "Bijwerken mislukt" }); }
  if (stockReport && fields["Stock afgeboekt"]) {
    const movementError = await createStockMovements(stockReport, f["Référence"] || id, "Sortie livraison");
    if (movementError) stockReport.journalWarning = movementError;
  }
  if (factuurnummer) factuurnummer = await ensureUnique(id, "Factuurnummer", "FA", factuurnummer);

  // E-mails de statut (jamais bloquants) : onderweg au départ, geleverd + factuur à la réception.
  if (statut === "Sortie en livraison" && !departed) mail = await notifyStatus(req, f, "onderweg");
  if (statut === "Facturée" && deliveryConfirmed && !f["Livraison confirmée"]) {
    const rules = await __lev.loadRules(at);
    const nr = factuurnummer || f["Factuurnummer"] || "";
    const m = String(nr).match(/^FA-(\d{4})-(\d{1,6})$/i);
    const mededeling = m ? __bill.structuredRef(nr) : "";
    // Facture déjà émise (réception rejouée) : taux figés ; client illisible ici = pas d'erreur après l'écriture.
    const bill = await getBill().catch(() => billingContext(null));
    const t = __bill.orderTotals(parseLines(f["Lignes (produits / quantités)"]), fields["BTW per lijn"] ? JSON.parse(fields["BTW per lijn"]) : __bill.linesRates(parseLines(f["Lignes (produits / quantités)"]), f, bill.rates, bill.fallback, bill.regime), bill.fallback);
    mail = await notifyStatus(req, f, "geleverd", { facturatie: bill.mode, factuurnummer: nr, ontvangenDoor: fields["Réceptionné par"], vervaldatum: __mail.vervaldatum(__lev.brusselsToday(), rules.betaaltermijn), mededeling, totalExcl: t.htva, totalBtw: t.tva, totalIncl: t.total });
  }
  res.status(200).json({ ok: true, stock: stockReport, factuurnummer, mail });
}

module.exports = { update };
