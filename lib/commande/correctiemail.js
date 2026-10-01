"use strict";
// Bijwerken · « Correctie mailen » (audit L-08) — de api/updateorder.js (A6).
const { at, __auth, __mail, __bill, __atomic, __corr, money, parseLines, billingContext, correctionLine, journal, CANCELLED } = require("./common");

// « Correctie mailen » (audit L-08) : le personnel renvoie au client ce qui a changé depuis sa
// confirmation (ou depuis le dernier e-mail de correction) : lignes avant → après, nouveau total,
// notes de crédit émises depuis. Jamais bloquant : sans RESEND_API_KEY ou sans adresse, rien ne
// part et la réponse le dit (mail.skipped). Un seul envoi par état : l'état envoyé est réservé
// AVANT l'envoi (écriture conditionnelle sur le moteur SQL), libéré si l'envoi échoue.
async function reserveCorrectie(id, prev, next){
  const r = await __atomic.mutate("Commandes", id, cur => ((cur[__corr.FIELD] || "") === prev ? { fields: { [__corr.FIELD]: next } } : { taken: true }));
  if (r !== null) return !!(r && r.ok);
  const cur = await at(`Commandes/${id}`); // Airtable : relecture juste avant
  if (!cur || cur.error || ((cur.fields || {})[__corr.FIELD] || "") !== prev) return false;
  const up = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: { [__corr.FIELD]: next } }) });
  return !!(up && !up.error);
}
async function sendCorrectieMail(req, res, id, f){
  if (f["Statut"] === CANCELLED) return res.status(409).json({ error: "Geannuleerde bestelling: geen correctiemail." });
  const ch = __corr.changes(f);
  if (!ch.changed) return res.status(409).json({ error: "Niets gewijzigd sinds de laatste mail aan de klant.", al: true });
  if (!__mail.enabled()) return res.status(200).json({ ok: true, mail: { ok: false, skipped: "disabled" } });
  const clientId = (f["Client"] || [])[0];
  const cli = clientId ? await at("Clients/" + encodeURIComponent(clientId)) : null;
  if (!cli || cli.error) return res.status(500).json({ error: "Klant onleesbaar" });
  const klant = __mail.clientFrom(cli);
  if (!klant.email) return res.status(200).json({ ok: true, mail: { ok: false, skipped: "no-recipient" } });
  const prev = String(f[__corr.FIELD] || "");
  const snap = __corr.snapshot(f, new Date().toISOString());
  if (!(await reserveCorrectie(id, prev, JSON.stringify(snap)))) return res.status(409).json({ error: "Deze correctie werd net al gemaild.", al: true });
  const cfg = await __mail.loadMailConfig(at);
  const bill = await billingContext();
  const lines = parseLines(f["Lignes (produits / quantités)"]);
  const rates = __bill.linesRates(lines, f, bill.rates, bill.fallback);
  const priced = lines.some(l => l.price != null);
  const t = priced ? __bill.orderTotals(lines, rates, bill.fallback) : { htva: money(f["Total"]), total: __bill.vat.r2(money(f["Total"]) * (1 + bill.fallback / 100)) };
  const inclOf = n => { const l = parseLines(n.lignes); return l.some(x => x.price != null) ? Math.abs(__bill.orderTotals(l, rates, bill.fallback).total) : __bill.vat.r2((Number(n.montant) || 0) * (1 + bill.fallback / 100)); };
  const portal = __mail.portalUrl(req);
  const mail = await __mail.notifyCorrection({
    ref: f["Référence"] || "", recordId: id, klant, company: cfg, opsEmail: cfg.opsEmail, portalUrl: portal,
    orderUrl: portal ? portal + "/order.html?id=" + encodeURIComponent(id) : "", facturatie: bill.mode,
    wijzigingen: ch.wijzigingen, totalExcl: t.htva, totalIncl: t.total,
    creditnotas: ch.nieuweCreditnotas.map(n => ({ nummer: n.nummer, montantIncl: inclOf(n), motif: n.motif })),
    netIncl: ch.notes.length ? __bill.vat.r2(t.total - ch.notes.reduce((s, n) => s + inclOf(n), 0)) : null, sleutel: snap.sleutel
  });
  if (!mail || !mail.ok) {
    await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: { [__corr.FIELD]: prev || null } }) }); // libéré : on peut réessayer
    return res.status(502).json({ error: "Correctiemail niet verstuurd" + (mail && mail.status ? " (fout " + mail.status + ")" : "") + ". Probeer later opnieuw.", mail });
  }
  const wat = ch.wijzigingen.map(w => w.name).concat(ch.nieuweCreditnotas.map(n => n.nummer));
  const line = correctionLine("Correctiemail verstuurd aan klant (" + wat.join(", ") + ")", __auth.actorOf(req), "");
  await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Correcties": journal(f, line) } }) });
  return res.status(200).json({ ok: true, mail, correctie: line });
}

module.exports = { reserveCorrectie, sendCorrectieMail };
