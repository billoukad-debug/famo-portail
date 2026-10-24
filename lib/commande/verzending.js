"use strict";
// Bijwerken · verzendstatus boekhouder / Peppol (specs/034) — de api/updateorder.js { verzending }.
// Beheerder seul ; règles et format dans lib/verzending.js (le même apply() servira à un envoi automatique).
// Journal : une ligne « Correcties » par changement (comme Betaald) + le journal d'audit de api/updateorder.js.
const { at, __auth, __atomic, correctionLine, journal } = require("./common");
const __verz = require("../verzending");

async function setVerzending(req, res, id, f, input){
  if (!__auth.adminOk(req)) return res.status(403).json({ error: "Enkel een beheerder past de verzendstatus aan" });
  const inp = input && typeof input === "object" ? input : {};
  const ctx = { door: __auth.actorOf(req), bron: "hand" }; // jamais « automatisch » depuis le navigateur
  const reden = String((inp && inp.reden) || "").slice(0, 200);
  const patchOf = (cur, r) => ({ [__verz.FIELD]: r.value, "Correcties": r.labels.reduce((acc, l) => journal({ Correcties: acc }, correctionLine(l, __auth.actorOf(req), reden)), (cur || {})["Correcties"] || "") });
  let result = null;
  const m = await __atomic.mutate("Commandes", id, cur => { result = __verz.apply(cur, inp, ctx); return result.error ? { refused: true } : { fields: patchOf(cur, result) }; });
  if (m === null) { // Airtable : pas d'écriture conditionnelle, le verrou de api/updateorder.js suffit
    result = __verz.apply(f, inp, ctx);
    if (result.error) return res.status(result.status).json({ error: result.error });
    const up = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: patchOf(f, result) }) });
    if (up.error) return res.status(500).json({ error: up.error.message || "Opslaan mislukt" });
  } else if (m && m.error) return res.status(404).json({ error: "Bestelling niet gevonden" });
  else if (result && result.error) return res.status(result.status).json({ error: result.error });
  return res.status(200).json({ ok: true, nummer: String(inp.nummer), verzending: result.entry });
}

module.exports = { setVerzending };
