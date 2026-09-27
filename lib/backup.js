"use strict";
// Sauvegarde et restauration complètes de la base (D-01), partagées par api/dbadmin.js
// (Beheer → Systeemstatus) et api/backup-cron.js (envoi nocturne par e-mail).
//
// Format (JSON, compressé gzip pour le transport) :
//   { version: 1, exportedAt, backend, tables: { <table>: [{ id, createdTime, fields }] },
//     files: [{ id, recordId, contentType, filename, size, data (base64), createdTime }] }
// Les ids d'enregistrement sont conservés tels quels : liens Client/Produit, numéros,
// URLs /api/foto?id=att… restent valides après restauration.
//
// Une réponse Vercel est limitée à 4,5 Mo : un export est rangé dans la base comme
// « instantané » découpé en morceaux base64 (famo_snapshots / famo_snapshot_parts), que
// le navigateur télécharge un par un et recolle. Même chemin en sens inverse pour
// envoyer un fichier à restaurer.
const zlib = require("zlib");
const crypto = require("crypto");
const ds = require("./datastore");
const { TABLES, newId } = require("./at-engine");

const VERSION = 1;
const PART_CHARS = 2 * 1024 * 1024; // ~1,5 Mo binaire par morceau : réponse JSON < 4,5 Mo
const KEEP = 6;                      // instantanés gardés (exports, avant restauration/copie, envois)
const KEEP_RUNS = 30;                // traces des envois nocturnes (métadonnées seules)

// ---- Lecture ---------------------------------------------------------------------------
async function fromStore(store, backend) {
  const names = Array.from(new Set(TABLES.concat(store.tables ? await store.tables() : [])));
  const tables = {};
  for (const t of names) tables[t] = (await store.list(t)).map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields }));
  const files = [];
  for (let off = 0; ; off += 20) {
    const page = await store.listFiles(off, 20);
    files.push(...page);
    if (page.length < 20) break;
  }
  return { version: VERSION, exportedAt: new Date().toISOString(), backend: backend || "sql", tables, files };
}

// Airtable (lecture seule) : même format, sans fichiers (les pièces jointes restent des
// liens Airtable qui expirent ; en mode Postgres elles sont dans famo_files).
async function readAirtable(table) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) throw new Error("AIRTABLE_TOKEN ontbreekt : kan Airtable niet lezen");
  let offset = "", records = [];
  do {
    const url = `https://api.airtable.com/v0/${ds.BASE}/${encodeURIComponent(table)}?pageSize=100` + (offset ? "&offset=" + encodeURIComponent(offset) : "");
    const r = await ds.realFetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const page = await r.json();
    // Une table absente de la base (ex. supprimée à la main) n'est pas une erreur.
    if (page.error && (page.error.type === "TABLE_NOT_FOUND" || r.status === 404)) return null;
    if (page.error) throw new Error(table + " : " + (page.error.message || page.error.type || "leesfout"));
    records = records.concat(page.records || []);
    offset = page.offset || "";
  } while (offset);
  return records;
}
async function fromAirtable(read) {
  const tables = {};
  for (const t of TABLES) { const recs = await (read || readAirtable)(t); if (recs) tables[t] = recs.map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })); }
  return { version: VERSION, exportedAt: new Date().toISOString(), backend: "airtable", tables, files: [], note: "Bijlagen: Airtable-links (verlopen na enkele uren), niet in dit bestand." };
}

// ---- Format ----------------------------------------------------------------------------
const gzip = (backup) => zlib.gzipSync(Buffer.from(JSON.stringify(backup), "utf8"), { level: 6 });
function parse(buf) {
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
  let b;
  try { b = JSON.parse(raw.toString("utf8")); } catch (e) { throw new Error("Geen geldig back-upbestand (JSON onleesbaar)"); }
  validate(b);
  return b;
}
const REC = /^[A-Za-z0-9]{1,40}$/;
function validate(b) {
  if (!b || typeof b !== "object" || b.version !== VERSION || !b.tables || typeof b.tables !== "object") throw new Error("Geen FAMO-back-up (versie " + VERSION + " verwacht)");
  const seen = new Set();
  for (const [t, recs] of Object.entries(b.tables)) {
    if (!Array.isArray(recs)) throw new Error("Tabel " + t + " : geen lijst");
    for (const r of recs) {
      if (!r || !REC.test(String(r.id || "")) || typeof r.fields !== "object" || r.fields === null) throw new Error("Tabel " + t + " : ongeldig record");
      if (seen.has(r.id)) throw new Error("Dubbel record-id " + r.id);
      seen.add(r.id);
    }
  }
  for (const f of b.files || []) {
    if (!f || !/^att[A-Za-z0-9]{14}$/.test(String(f.id || "")) || typeof f.data !== "string" || !/^[A-Za-z0-9+/]*=*$/.test(f.data)) throw new Error("Ongeldig bestand in de back-up");
  }
  return true;
}
function summary(b) {
  const tables = {};
  for (const [t, recs] of Object.entries(b.tables || {})) tables[t] = recs.length;
  return { version: b.version, exportedAt: b.exportedAt, backend: b.backend, tables, files: (b.files || []).length, records: Object.values(tables).reduce((s, n) => s + n, 0) };
}

// ---- Instantanés (morceaux en base) ----------------------------------------------------
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
async function saveSnapshot(store, kind, buf, note) {
  const b64 = buf.toString("base64"), parts = [];
  for (let i = 0; i < b64.length; i += PART_CHARS) parts.push(b64.slice(i, i + PART_CHARS));
  if (!parts.length) parts.push("");
  const meta = { id: newId("snp"), createdTime: new Date().toISOString(), kind, size: buf.length, parts: parts.length, sha256: sha256(buf), note: note || "" };
  await store.putSnapshot(meta, parts);
  await prune(store);
  return meta;
}
async function loadSnapshot(store, id) {
  const meta = await store.snapshot(id);
  if (!meta || !meta.parts) throw Object.assign(new Error("Back-up niet gevonden"), { status: 404 });
  let b64 = "";
  for (let n = 0; n < meta.parts; n++) {
    const p = await store.snapshotPart(id, n);
    if (p == null) throw new Error("Back-up onvolledig (deel " + (n + 1) + " ontbreekt)");
    b64 += p;
  }
  const buf = Buffer.from(b64, "base64");
  if (meta.sha256 && sha256(buf) !== meta.sha256) throw new Error("Back-up beschadigd (controlesom)");
  return { meta, buf };
}
async function prune(store) {
  const all = await store.snapshots();
  const full = all.filter((s) => s.parts > 0), runs = all.filter((s) => !s.parts);
  for (const s of full.slice(KEEP).concat(runs.slice(KEEP_RUNS))) await store.deleteSnapshot(s.id);
}
// Trace d'un envoi nocturne (sans les données) : Systeemstatus et /api/health la lisent.
async function recordRun(store, info) {
  await store.putSnapshot({ id: newId("snp"), createdTime: new Date().toISOString(), kind: "nachtelijk", size: info.size || 0, sha256: info.sha256 || "", note: JSON.stringify({ ok: !!info.ok, big: !!info.big, error: info.error ? String(info.error).slice(0, 200) : "" }) }, []);
  await prune(store);
}

// ---- Restauration ----------------------------------------------------------------------
async function restore(store, b) {
  validate(b);
  const records = [];
  for (const [tbl, recs] of Object.entries(b.tables)) for (const r of recs) records.push({ tbl, id: r.id, createdTime: r.createdTime, fields: r.fields });
  await store.restoreAll(records, b.files || []);
  return summary(b);
}

// ---- Comparaison enregistrement par enregistrement ------------------------------------
// Empreinte des champs : clés triées. Pièces jointes réduites à { filename, type, size } :
// une photo recopiée d'Airtable vers famo_files change d'URL, pas de contenu (D-07/D-08).
function canon(v, loose) {
  if (Array.isArray(v)) {
    if (loose && v.length && v.every((a) => a && typeof a === "object" && typeof a.url === "string")) return v.map((a) => canon({ filename: a.filename || "", type: a.type || "", size: Number(a.size) || 0 }));
    return v.map((x) => canon(x, loose));
  }
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = canon(v[k], loose); return o; }
  return v;
}
const recordHash = (fields, loose) => crypto.createHash("sha256").update(JSON.stringify(canon(fields || {}, loose))).digest("hex");
function compareRecords(a, b, loose) {
  const ha = new Map((a || []).map((r) => [r.id, recordHash(r.fields, loose)]));
  const hb = new Map((b || []).map((r) => [r.id, recordHash(r.fields, loose)]));
  const onlyA = [...ha.keys()].filter((id) => !hb.has(id)), onlyB = [...hb.keys()].filter((id) => !ha.has(id));
  const changed = [...ha.keys()].filter((id) => hb.has(id) && ha.get(id) !== hb.get(id));
  return { a: ha.size, b: hb.size, onlyA: onlyA.length, onlyB: onlyB.length, changed: changed.length, changedIds: changed.slice(0, 5), ok: !onlyA.length && !onlyB.length && !changed.length };
}
function compare(x, y) {
  const names = Array.from(new Set(Object.keys(x.tables || {}).concat(Object.keys(y.tables || {})))).sort();
  const tables = names.map((t) => Object.assign({ table: t }, compareRecords(x.tables[t], y.tables[t], false)));
  const fh = (f) => sha256(Buffer.from(JSON.stringify([f.recordId, f.contentType, f.filename, f.size, f.data])));
  const files = compareRecords((x.files || []).map((f) => ({ id: f.id, fields: fh(f) })), (y.files || []).map((f) => ({ id: f.id, fields: fh(f) })), false);
  return { ok: tables.every((t) => t.ok) && files.ok, tables, files };
}

module.exports = { VERSION, PART_CHARS, fromStore, fromAirtable, readAirtable, gzip, parse, validate, summary, saveSnapshot, loadSnapshot, recordRun, restore, recordHash, compareRecords, compare, sha256 };
