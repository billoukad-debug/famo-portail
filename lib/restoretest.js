"use strict";
// Restauration testée (specs/026, US2) : la sauvegarde de la nuit est remontée dans une base SQLite
// JETABLE en mémoire (jamais la vraie base), relue, puis comparée enregistrement par enregistrement
// (empreintes de champs) et fichier par fichier. Prouve chaque nuit qu'une restauration fonctionnerait.
const backup = require("./backup");
const sqlLib = require("./sql");
const { sqlStore } = require("./at-engine");

/** buf = sauvegarde gzip ; expected = l'objet d'origine (par défaut : relu de buf). → { ok, ms, records, error? } */
async function verifyAgainst(buf, expected) {
  const t0 = Date.now();
  try {
    const b = backup.parse(buf);
    const store = sqlStore(sqlLib.sqlite(":memory:"));
    await backup.restore(store, b);
    const back = await backup.fromStore(store, "restoretest");
    // Tables de la sauvegarde seulement (une base neuve n'en a pas d'autres).
    const cmp = backup.compare({ tables: expected.tables, files: expected.files || [] }, { tables: Object.fromEntries(Object.keys(expected.tables).map((t) => [t, back.tables[t] || []])), files: back.files || [] });
    const bad = cmp.tables.filter((t) => !t.ok).map((t) => t.table);
    const records = Object.values(b.tables).reduce((s, r) => s + r.length, 0);
    return cmp.ok ? { ok: true, ms: Date.now() - t0, records } : { ok: false, ms: Date.now() - t0, records, error: "verschil na terugzetten: " + (bad.join(", ") || "bestanden") };
  } catch (e) { return { ok: false, ms: Date.now() - t0, records: 0, error: String((e && e.message) || e).slice(0, 200) }; }
}
async function verify(buf) {
  let b; try { b = backup.parse(buf); } catch (e) { return { ok: false, ms: 0, records: 0, error: String(e.message || e).slice(0, 200) }; }
  return verifyAgainst(buf, b);
}
module.exports = { verify, verifyAgainst };
