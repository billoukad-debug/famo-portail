"use strict";
// Bijwerken · numérotation FA / CN — de api/updateorder.js (A6) ; numéros vervallen (A4,
// specs/010-updateorder-numerotation).
const { at, atAll, escapeFormula, __auth, __bill, __atomic, __journal, __cn } = require("./common");

// Numéros séquentiels FA-2026-0001 / CN-2026-0001 : max + 1 sur l'année (Bruxelles).
// Airtable n'a pas de transaction : deux validations simultanées peuvent lire le même
// maximum. D'où ensureUnique() juste APRÈS l'écriture : si le numéro existe deux fois,
// l'enregistrement à l'identifiant le plus petit le garde, l'autre en reprend un
// nouveau (jusqu'à 5 fois). Résultat : jamais deux factures sous le même numéro.
async function ensureUnique(id, field, prefix, number){
  let current = number;
  for (let attempt = 0; attempt < 5; attempt++) {
    const f = encodeURIComponent(`{${field}}='${escapeFormula(current)}'`);
    const same = await at(`Commandes?filterByFormula=${f}&fields%5B%5D=${encodeURIComponent(field)}`);
    if (same.error) return current; // lecture impossible : le numéro écrit reste, rien de pire
    const ids = (same.records || []).map(r => r.id).sort();
    if (ids.length <= 1 || ids[0] === id) return current;
    current = await nextNumber(field, prefix);
    const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: { [field]: current } }) });
    if (j.error) throw new Error(j.error.message || "Nummering bijwerken mislukt");
  }
  throw new Error("Nummering bezet: probeer opnieuw");
}

async function nextNumber(field, prefix){
  const year = __auth.brusselsYear();
  const n = await __bill.reserve(prefix + "-" + year, () => maxNumber(field, prefix, year));
  if (n != null) return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
  return `${prefix}-${year}-${String(await maxNumber(field, prefix, year) + 1).padStart(4, "0")}`;
}
async function maxNumber(field, prefix, year){
  // Notes de crédit : la première dans « Creditnota nummer », les suivantes dans la liste JSON (C-08).
  const cn = field === __cn.LEGACY.nummer;
  const j = await atAll(`Commandes?fields%5B%5D=${encodeURIComponent(field)}` + (cn ? `&fields%5B%5D=${encodeURIComponent(__cn.FIELD)}` : ""));
  if (j.error) throw new Error(j.error.message || "Nummering onleesbaar");
  let max = 0;
  const re = new RegExp("^" + prefix + "-" + year + "-(\\d+)$");
  (j.records || []).forEach(r => {
    const values = cn ? __cn.list(r.fields).map(n => n.nummer) : [r.fields[field]];
    values.forEach(v => {
      if (!v) return;
      const m = String(v).match(re);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
  });
  return max;
}

// Doublon de numéro CN (Airtable seulement : sur le moteur SQL, le compteur de lib/billing.js est
// atomique) : cherché aux deux endroits, première note ET liste JSON. Le plus petit identifiant
// garde le numéro, l'autre en reprend un (numéro, liste et journal réécrits ensemble, audit B-18).
async function ensureUniqueCN(id, number, written){
  let current = number;
  for (let attempt = 0; attempt < 5; attempt++) {
    const e = escapeFormula(current);
    const f = encodeURIComponent(`OR({${__cn.LEGACY.nummer}}='${e}',FIND('"${e}"',{${__cn.FIELD}}))`);
    const same = await at(`Commandes?filterByFormula=${f}&fields%5B%5D=${encodeURIComponent(__cn.LEGACY.nummer)}`);
    if (same.error) return current; // lecture impossible : le numéro écrit reste, rien de pire
    const ids = Array.from(new Set((same.records || []).map(r => r.id))).sort();
    if (ids.length <= 1 || ids[0] === id) return current;
    const next = await nextNumber(__cn.LEGACY.nummer, "CN");
    const patch = Object.assign(__cn.renumberPatch(written, current, next), { "Correcties": String(written["Correcties"] || "").split(current).join(next) });
    const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: patch }) });
    if (j.error) throw new Error(j.error.message || "Nummering bijwerken mislukt");
    Object.assign(written, patch);
    current = next;
  }
  throw new Error("Nummering bezet: probeer opnieuw");
}

// Numéro réservé au compteur (moteur SQL) mais jamais écrit sur la commande (A4). Les refus de
// validation passent AVANT la réservation ; ce qui reste :
//   - zeker (refus décidé sur l'état relu, AUCUNE écriture faite) : le numéro est rendu au compteur
//     s'il est encore le dernier réservé → aucun trou ;
//   - sinon (écriture en échec : elle a peut-être eu lieu ; ou un autre numéro a été pris depuis) :
//     ligne « Nummer vervallen » au journal d'audit (Beheer → Journaal) + logs Vercel, pour que la
//     série reste explicable (docs/RUNBOOK.md § 6). Jamais le message brut de la base au journal.
// Airtable : « max + 1 » recalculé à chaque appel, rien n'est consommé → rien à faire.
// → "teruggegeven" | "vervallen" | null.
async function vervallen(req, o){
  if (!__atomic.store() || !o || !o.nummer) return null;
  const m = /^([A-Z]+-\d{4})-(\d+)$/.exec(String(o.nummer));
  try {
    if (o.zeker && m && await __bill.release(m[1], parseInt(m[2], 10))) return "teruggegeven";
  } catch (e) { /* compteur illisible : on journalise ci-dessous */ }
  console.error("[updateorder] nummer vervallen", o.nummer, o.id || "", o.fout || o.reden || "");
  await __journal.log({ wie: __auth.actorOf(req), rol: __auth.roleOf(req), actie: "Nummer vervallen", object: "Commandes", record: o.id || "", referentie: o.ref || "",
    wijzigingen: [{ veld: o.veld, voor: o.nummer, na: "niet gebruikt" }], reden: o.reden || "" });
  return "vervallen";
}

module.exports = { ensureUnique, nextNumber, maxNumber, ensureUniqueCN, vervallen };
