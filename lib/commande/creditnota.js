"use strict";
// Bijwerken · notes de crédit — de api/updateorder.js (A6) ; numéro réservé en dernier (A4,
// specs/010-updateorder-numerotation).
const { at, __auth, __bill, __atomic, __cn, money, parseLines, formatLine, correctionLine, journal } = require("./common");
const { createStockMovements, moveStock, undoStock } = require("./stock");
const { nextNumber, ensureUniqueCN, vervallen } = require("./nummering");

// Creditnota sur une commande facturée (plusieurs possibles, audit C-08) : lignes créditées
// (sous-ensemble des lignes de la facture), quantités et montants CUMULÉS de toutes les notes
// plafonnés à la facture (par article et par taux de TVA, lib/creditnota.js), numéro CN-AAAA-NNNN
// propre à chaque note, montant recalculé aux prix figés, retour en stock optionnel (mouvement
// « Retour client ») pour les seules lignes de CETTE note. Clé « sleutel » (navigateur) : un double
// clic ou un renvoi réseau rend la note déjà créée, sans nouveau numéro ni deuxième retour.
async function makeCreditnota(req, res, id, f, body){
  if (!__auth.adminOk(req)) return res.status(403).json({ error: "Enkel een beheerder maakt een creditnota" });
  if (f["Statut"] !== "Facturée" || !f["Factuurnummer"]) return res.status(409).json({ error: "Enkel op een gefactureerde bestelling" });
  const sleutel = /^[\w-]{1,64}$/.test(String(body.sleutel || "")) ? String(body.sleutel) : "";
  const known = __cn.byKey(f, sleutel);
  if (known) return res.status(200).json({ ok: true, al: true, creditnota: known, creditnotas: __cn.list(f), stock: null });
  const motif = String(body.motif || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (motif.length < 3) return res.status(400).json({ error: "Geef een reden op (minstens 3 tekens)" });
  const wanted = parseLines(String(body.lignes || ""));
  // Taux figés à la facturation ; sans eux (anciennes factures), un seul groupe : le plafond porte alors sur le total.
  const rates = __bill.frozenRates(f) || {}, fallback = __bill.vat.DEFAULT_RATE;
  const chk = __cn.check(f, wanted, rates, fallback);
  if (chk.error) return res.status(400).json({ error: chk.error });
  const lignes = chk.lines.map(formatLine).join("\n"), montant = money(chk.montant);
  // Numéro (A4) : sur le moteur SQL, le compteur n'est touché qu'en dernier, DANS l'écriture
  // conditionnelle, quand l'état relu est accepté — stock illisible, plafond dépassé ou rejeu ne
  // consomment rien. Airtable : « max + 1 » recalculé à chaque appel (rien n'est consommé par un
  // échec), ordre historique des lectures gardé.
  let note = null, jline = "";
  const numbered = async () => {
    if (note) return;
    const nummer = await nextNumber(__cn.LEGACY.nummer, "CN");
    note = { nummer, lignes, montant, le: new Date().toISOString(), motif, retour: body.retourStock === true, sleutel };
    jline = correctionLine("Creditnota " + nummer + " (€ " + montant.toFixed(2).replace(".", ",") + ")", __auth.actorOf(req), motif);
  };
  if (!__atomic.store()) await numbered();
  const patchOf = cur => Object.assign(__cn.patchFor(cur, note), { "Correcties": journal(cur, jline) });
  const lost = (reden, zeker) => vervallen(req, { id, ref: f["Référence"] || "", veld: __cn.LEGACY.nummer, nummer: note && note.nummer, reden, zeker });
  let stockReport = null;
  if (body.retourStock === true) {
    stockReport = await moveStock(lignes, +1);
    if (stockReport.error) return res.status(500).json({ error: stockReport.error });
    const w = await createStockMovements(stockReport, f["Référence"] || id, "Retour client"); if (w) stockReport.journalWarning = w;
  }
  // Moteur SQL : écriture conditionnelle, plafond revérifié sur l'état relu (deux appareils, deux instances :
  // aucune note perdue, jamais plus que facturé). Airtable : simple PATCH (verrou mémoire seul).
  let written, m;
  try {
    m = await __atomic.mutate("Commandes", id, async cur => {
      const again = __cn.byKey(cur, sleutel);
      if (again) return { al: again, cur };
      const c = __cn.check(cur, wanted, rates, fallback);
      if (c.error) return { error: c.error };
      await numbered();
      return { fields: patchOf(cur) };
    });
  } catch (e) {
    await lost("Creditnota opslaan mislukt nadat het nummer gereserveerd was (details in de Vercel-logs)", false);
    throw e;
  }
  if (m === null) {
    const fields = patchOf(f);
    const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    if (j.error) { const w = await undoStock(stockReport, +1); return res.status(500).json({ error: j.error.message || "Creditnota opslaan mislukt", stockWarning: w || undefined }); }
    written = Object.assign({}, f, fields);
  } else if (m.ok) {
    written = m.fields;
  } else {
    const w = await undoStock(stockReport, +1);
    // Refus décidé sur une relecture APRÈS la réservation (un autre appareil a écrit entre-temps) :
    // rien n'a été écrit, le numéro est rendu au compteur, ou expliqué au journal s'il ne peut plus l'être.
    await lost(m.al ? "Creditnota geweigerd na de reservering: al aangemaakt door een ander toestel (zelfde aanvraag)"
      : "Creditnota geweigerd na de reservering (ander toestel was sneller): " + (m.error || "opslaan mislukt"), true);
    if (m.al) return res.status(200).json({ ok: true, al: true, creditnota: m.al, creditnotas: __cn.list(m.cur), stock: null, stockWarning: w || undefined });
    return res.status(409).json({ error: m.error || "Creditnota opslaan mislukt", stockWarning: w || undefined });
  }
  // Numéro repris (collision, Airtable) : liste, première note et journal citent le numéro réellement attribué (audit B-18).
  const nummer = note.nummer;
  const finalNummer = __atomic.store() ? nummer : await ensureUniqueCN(id, nummer, written);
  return res.status(200).json({ ok: true, creditnota: Object.assign({}, __cn.list(written).find(n => n.nummer === finalNummer) || note, { nummer: finalNummer }), creditnotas: __cn.list(written), stock: stockReport });
}

module.exports = { makeCreditnota };
