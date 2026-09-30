"use strict";
// Écritures atomiques sur le moteur SQL (production : Neon). Airtable n'offre pas d'écriture
// conditionnelle : ces fonctions renvoient alors null et l'appelant garde son ancien chemin.
//
// Principe : lire l'enregistrement et sa version, écrire « si la version n'a pas bougé »
// (lib/at-engine.js sqlStore.update), recommencer sinon. Tient sur plusieurs instances Vercel,
// contrairement à un verrou en mémoire.

function store() {
  const st = require("./datastore").state;
  return st.backend !== "airtable" && st.store ? st.store : null;
}

// Ajoute delta à un champ numérique. min : refuse si le résultat passerait sous ce seuil.
// → { ok:true, before, after } | { ok:false, before, reason:"min" } | null (Airtable).
async function adjust(table, id, field, delta, opts) {
  const s = store();
  if (!s) return null;
  const min = opts && opts.min != null ? opts.min : null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const cur = await s.get(table, id);
    if (!cur) return { ok: false, reason: "missing" };
    const before = Number(cur.fields[field]) || 0;
    const after = Math.round((before + delta) * 1000) / 1000;
    if (min != null && after < min) return { ok: false, before, reason: "min" };
    if (await s.update(table, id, Object.assign({}, cur.fields, { [field]: after }), cur.version)) return { ok: true, before, after };
  }
  throw new Error("Voorraad tegelijk gewijzigd: probeer opnieuw");
}

// Pose field=value seulement si le champ vaut encore « expected » (faux/absent pour false).
// → true (réservé par cet appel) | false (déjà pris) | null (Airtable).
async function claim(table, id, field, expected, value) {
  const s = store();
  if (!s) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const cur = await s.get(table, id);
    if (!cur) return false;
    const now = cur.fields[field];
    if ((expected === false ? !!now : now !== expected)) return false;
    if (await s.update(table, id, Object.assign({}, cur.fields, { [field]: value }), cur.version)) return true;
  }
  return false;
}

// Lecture → décision → écriture conditionnelle, recommencée si quelqu'un a écrit entre-temps.
// fn(fields) renvoie { fields: {…à fusionner} } pour écrire, ou n'importe quoi d'autre pour
// s'arrêter sans écrire (ce résultat est renvoyé tel quel). Valeurs vides interdites (pas
// d'effacement ici : passer par un PATCH normal).
// → { ok:true, fields } (état écrit) | résultat de fn | null (Airtable).
async function mutate(table, id, fn) {
  const s = store();
  if (!s) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const cur = await s.get(table, id);
    if (!cur) return { error: "missing" };
    const r = await fn(cur.fields);
    if (!r || !r.fields) return r;
    const next = Object.assign({}, cur.fields, r.fields);
    if (await s.update(table, id, next, cur.version)) return { ok: true, fields: next };
  }
  throw new Error("Tegelijk gewijzigd: probeer opnieuw");
}

module.exports = { store, adjust, claim, mutate };
