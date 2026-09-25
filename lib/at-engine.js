"use strict";
// Moteur compatible avec l'API REST d'Airtable, au-dessus d'un stockage SQL.
//
// Les fonctions api/*.js parlent le protocole Airtable (URL, filterByFormula, sort,
// offset, records[], typecast…). Plutôt que de réécrire 140 appels, lib/datastore.js
// redirige ces requêtes vers ce moteur quand DB_BACKEND=postgres : le code métier et
// ses tests restent inchangés, et on revient à Airtable en changeant une variable.
//
// Stockage : une table SQL unique `famo_records` (tbl, id, created_time, fields JSON,
// version). Mises à jour en concurrence optimiste sur `version` : deux PATCH simultanés
// sur la même commande ne s'écrasent jamais (relecture + nouvel essai).
//
// handle(method, url, body) -> { status, json }  (même forme que la vraie API).

const crypto = require("crypto");
const { compileFormula, truthy, err } = require("./at-formula");

// Tables de la base Famo (noms exacts, comme dans Airtable).
const TABLES = ["Clients", "Catalogue", "Commandes", "Stock", "Prix négociés", "Cadrage projet", "Mouvements de stock", "Configuratie", "Aanvragen", "Medewerkers"];

function newId(prefix) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = prefix;
  for (let i = 0; i < 14; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}
// Airtable n'enregistre pas les valeurs vides : "", null, false, [] effacent le champ.
const isEmpty = (v) => v === "" || v === null || v === undefined || v === false || (Array.isArray(v) && !v.length);
// Pièce jointe écrite par URL ({url}) : Airtable la complète (id, filename). On fait pareil.
function normAttachments(v) {
  if (!Array.isArray(v) || !v.length || typeof v[0] !== "object" || v[0] === null || !("url" in v[0])) return v;
  return v.map((a) => Object.assign({ id: a.id || newId("att"), filename: a.filename || String(a.url || "").split("/").pop().split("?")[0] || "bestand" }, a));
}
function cleanFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) if (!isEmpty(v)) out[k] = normAttachments(v);
  return out;
}
function project(r, fields) {
  if (!fields || !fields.length) return { id: r.id, createdTime: r.createdTime, fields: Object.assign({}, r.fields) };
  const f = {};
  fields.forEach((k) => { if (r.fields[k] !== undefined) f[k] = r.fields[k]; });
  return { id: r.id, createdTime: r.createdTime, fields: f };
}
function cmp(av, bv) {
  if (av == null && bv == null) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

// ---- Stockage SQL -----------------------------------------------------------------
// exec(query, params) -> Promise<rows (objets, valeurs texte)> ; batch(list) -> transaction.
const SCHEMA_SQL = [
  "CREATE TABLE IF NOT EXISTS famo_records (id TEXT PRIMARY KEY, tbl TEXT NOT NULL, created_time TEXT NOT NULL, fields TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)",
  "CREATE INDEX IF NOT EXISTS famo_records_tbl_idx ON famo_records (tbl)"
];
function sqlStore(db) {
  let ready = null;
  const init = () => (ready = ready || (async () => { for (const q of SCHEMA_SQL) await db.exec(q, []); })().catch((e) => { ready = null; throw e; }));
  const toRec = (row) => ({ id: row.id, createdTime: row.created_time, fields: JSON.parse(row.fields || "{}"), version: Number(row.version) || 1 });
  return {
    init,
    async list(tbl) { await init(); return (await db.exec("SELECT id, created_time, fields, version FROM famo_records WHERE tbl = $1 ORDER BY created_time, id", [tbl])).map(toRec); },
    async get(tbl, id) { await init(); const rows = await db.exec("SELECT id, created_time, fields, version FROM famo_records WHERE tbl = $1 AND id = $2", [tbl, id]); return rows[0] ? toRec(rows[0]) : null; },
    async insert(tbl, recs) {
      await init();
      await db.batch(recs.map((r) => ({ query: "INSERT INTO famo_records (id, tbl, created_time, fields, version) VALUES ($1, $2, $3, $4, 1)", params: [r.id, tbl, r.createdTime, JSON.stringify(r.fields)] })));
    },
    // true si la version lue est toujours la bonne (sinon quelqu'un a écrit entre-temps).
    async update(tbl, id, fields, version) {
      await init();
      const rows = await db.exec("UPDATE famo_records SET fields = $1, version = version + 1 WHERE tbl = $2 AND id = $3 AND version = $4 RETURNING id", [JSON.stringify(fields), tbl, id, version]);
      return rows.length > 0;
    },
    async remove(tbl, ids) {
      await init();
      let n = 0;
      for (const id of ids) n += (await db.exec("DELETE FROM famo_records WHERE tbl = $1 AND id = $2 RETURNING id", [tbl, id])).length;
      return n;
    },
    // Migration : remplace tout le contenu d'une table en une transaction.
    async replaceAll(tbl, recs) {
      await init();
      const qs = [{ query: "DELETE FROM famo_records WHERE tbl = $1", params: [tbl] }].concat(recs.map((r) => ({ query: "INSERT INTO famo_records (id, tbl, created_time, fields, version) VALUES ($1, $2, $3, $4, 1)", params: [r.id, tbl, r.createdTime || new Date().toISOString(), JSON.stringify(r.fields || {})] })));
      await db.batch(qs);
    },
    async counts() { await init(); const rows = await db.exec("SELECT tbl, COUNT(*) AS n FROM famo_records GROUP BY tbl", []); const out = {}; rows.forEach((r) => { out[r.tbl] = Number(r.n) || 0; }); return out; },
    async ping() { const rows = await db.exec("SELECT 1 AS ok", []); return rows.length === 1; }
  };
}

// ---- Moteur -------------------------------------------------------------------------
class AtEngine {
  constructor(store, opts) {
    this.store = store;
    this.base = (opts && opts.base) || "";
  }
  table(name) {
    const t = TABLES.find((k) => k.toLowerCase() === String(name).toLowerCase());
    if (!t) throw err(404, "TABLE_NOT_FOUND", `Could not find table ${name} in application ${this.base}`);
    return t;
  }
  async list(table, q) {
    let rows = await this.store.list(table);
    if (q.filterByFormula) {
      const fn = compileFormula(q.filterByFormula);
      rows = rows.filter((r) => truthy(fn(r)));
    }
    (q.sort || []).slice().reverse().forEach((s) => {
      rows.sort((a, b) => { const c = cmp(a.fields[s.field], b.fields[s.field]); return s.direction === "desc" ? -c : c; });
    });
    if (q.maxRecords) rows = rows.slice(0, q.maxRecords);
    const pageSize = Math.max(1, Math.min(100, q.pageSize || 100));
    const start = q.offset ? Number(String(q.offset).replace(/^itr/, "")) || 0 : 0;
    const out = { records: rows.slice(start, start + pageSize).map((r) => project(r, q.fields)) };
    if (start + pageSize < rows.length) out.offset = "itr" + (start + pageSize);
    return out;
  }
  async get(table, id) {
    const r = await this.store.get(table, id);
    if (!r) throw err(404, "NOT_FOUND", "Could not find record " + id);
    return project(r);
  }
  async create(table, fieldsList) {
    const recs = fieldsList.map((f) => ({ id: newId("rec"), createdTime: new Date().toISOString(), fields: cleanFields(f) }));
    await this.store.insert(table, recs);
    return recs.map((r) => project(r));
  }
  // PATCH fusionne, PUT remplace. Concurrence optimiste : 5 essais avant d'abandonner.
  async update(table, id, fields, replace) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await this.store.get(table, id);
      if (!cur) throw err(404, "NOT_FOUND", "Could not find record " + id);
      const next = replace ? {} : Object.assign({}, cur.fields);
      for (const [k, v] of Object.entries(fields || {})) {
        if (isEmpty(v)) delete next[k];
        else next[k] = normAttachments(v);
      }
      if (await this.store.update(table, id, next, cur.version)) return project({ id, createdTime: cur.createdTime, fields: next });
    }
    throw err(409, "CONFLICT", "Record werd tegelijk gewijzigd, probeer opnieuw");
  }
  async remove(table, ids) {
    const out = [];
    for (const id of ids) {
      const n = await this.store.remove(table, [id]);
      if (!n) throw err(404, "NOT_FOUND", "Could not find record " + id);
      out.push({ id, deleted: true });
    }
    return out;
  }

  // Point d'entrée : une requête REST Airtable -> { status, json }.
  async handle(method, urlStr, body) {
    try {
      const url = new URL(urlStr);
      if (url.hostname === "content.airtable.com") {
        throw err(501, "NOT_SUPPORTED", "Foto's uploaden kan nog niet met de nieuwe database. Voeg de foto later toe.");
      }
      const parts = url.pathname.split("/").filter(Boolean); // v0, base, table, id?
      if (parts[0] !== "v0" || (this.base && parts[1] !== this.base)) throw err(404, "NOT_FOUND", "Could not find what you are looking for");
      const table = this.table(decodeURIComponent(parts[2] || ""));
      const id = parts[3] ? decodeURIComponent(parts[3]) : "";
      const m = String(method || "GET").toUpperCase();
      const b = body || {};
      if (m === "GET" && id) return { status: 200, json: await this.get(table, id) };
      if (m === "GET") {
        const p = url.searchParams;
        const q = { filterByFormula: p.get("filterByFormula") || "", fields: p.getAll("fields[]"), sort: [], maxRecords: Number(p.get("maxRecords")) || 0, pageSize: Number(p.get("pageSize")) || 100, offset: p.get("offset") || "" };
        for (let k = 0; p.has(`sort[${k}][field]`); k++) q.sort.push({ field: p.get(`sort[${k}][field]`), direction: p.get(`sort[${k}][direction]`) || "asc" });
        return { status: 200, json: await this.list(table, q) };
      }
      if (m === "POST") {
        if (Array.isArray(b.records)) {
          if (b.records.length > 10) throw err(422, "INVALID_RECORDS", "You can create at most 10 records per request");
          return { status: 200, json: { records: await this.create(table, b.records.map((r) => (r && r.fields) || {})) } };
        }
        return { status: 200, json: (await this.create(table, [b.fields || {}]))[0] };
      }
      if ((m === "PATCH" || m === "PUT") && id) return { status: 200, json: await this.update(table, id, b.fields || {}, m === "PUT") };
      if (m === "PATCH" || m === "PUT") {
        if (!Array.isArray(b.records) || b.records.length > 10) throw err(422, "INVALID_RECORDS", "records must be an array of at most 10");
        const out = [];
        for (const r of b.records) out.push(await this.update(table, r.id, r.fields || {}, m === "PUT"));
        return { status: 200, json: { records: out } };
      }
      if (m === "DELETE" && id) { await this.remove(table, [id]); return { status: 200, json: { id, deleted: true } }; }
      if (m === "DELETE") {
        const ids = url.searchParams.getAll("records[]");
        if (!ids.length || ids.length > 10) throw err(422, "INVALID_RECORDS", "records[] must contain 1 to 10 ids");
        return { status: 200, json: { records: await this.remove(table, ids) } };
      }
      throw err(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500 && status !== 501) console.error("[at-engine]", e);
      return { status, json: { error: { type: e.type || "SERVER_ERROR", message: e.message || String(e) } } };
    }
  }
}

module.exports = { AtEngine, sqlStore, TABLES, newId, SCHEMA_SQL };
