"use strict";
// Dunne, betrouwbare client voor de Airtable REST API.
// - paginatie afgehandeld (offset)
// - 429/5xx: wachten en opnieuw proberen
// - fouten worden AirtableError met HTTP-status
// - bijlagen via de content-API (base64), zonder externe URL
const cfg = require("./config");

class AirtableError extends Error {
  constructor(status, message, type) {
    super(message || "Airtable-fout");
    this.name = "AirtableError";
    this.status = status || 0;
    this.type = type || "";
  }
}

const TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, options, attempt = 1) {
  const opts = Object.assign({}, options);
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) opts.signal = AbortSignal.timeout(TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    if (attempt < MAX_ATTEMPTS) { await sleep(300 * attempt); return call(url, options, attempt + 1); }
    throw new AirtableError(0, "Airtable is niet bereikbaar: " + String(e && e.message || e));
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt < MAX_ATTEMPTS) { await sleep(res.status === 429 ? 1100 * attempt : 400 * attempt); return call(url, options, attempt + 1); }
  }
  let body = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = null; }
  if (!res.ok) {
    const err = (body && body.error) || {};
    const msg = typeof err === "string" ? err : (err.message || text || ("HTTP " + res.status));
    throw new AirtableError(res.status, "Airtable: " + msg, typeof err === "object" ? err.type : "");
  }
  return body;
}

function headers(json) {
  const h = { Authorization: "Bearer " + cfg.airtableToken };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function tablePath(table) {
  return `${cfg.airtableApi}/${cfg.BASE_ID}/${encodeURIComponent(table)}`;
}

/**
 * Haalt records op. Volgt de offset tot alles binnen is.
 * @param {string} table
 * @param {{filterByFormula?:string, fields?:string[], sort?:{field:string,direction?:string}[], maxRecords?:number, pageSize?:number}} [q]
 */
async function list(table, q = {}) {
  const params = new URLSearchParams();
  if (q.filterByFormula) params.set("filterByFormula", q.filterByFormula);
  (q.fields || []).forEach((f) => params.append("fields[]", f));
  (q.sort || []).forEach((s, i) => {
    params.set(`sort[${i}][field]`, s.field);
    params.set(`sort[${i}][direction]`, s.direction || "asc");
  });
  if (q.maxRecords) params.set("maxRecords", String(q.maxRecords));
  params.set("pageSize", String(q.pageSize || 100));
  const out = [];
  let offset = "";
  do {
    if (offset) params.set("offset", offset); else params.delete("offset");
    const page = await call(tablePath(table) + "?" + params.toString(), { headers: headers(false) });
    (page.records || []).forEach((r) => out.push(r));
    offset = page.offset || "";
    if (q.maxRecords && out.length >= q.maxRecords) break;
  } while (offset);
  return out;
}

async function get(table, id) {
  return call(`${tablePath(table)}/${encodeURIComponent(id)}`, { headers: headers(false) });
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Maakt records aan (max 10 per verzoek — de client verdeelt zelf). */
async function create(table, fieldsList, opts = {}) {
  const out = [];
  for (const part of chunks(fieldsList, 10)) {
    const body = { records: part.map((fields) => ({ fields })) };
    if (opts.typecast) body.typecast = true;
    const r = await call(tablePath(table), { method: "POST", headers: headers(true), body: JSON.stringify(body) });
    (r.records || []).forEach((x) => out.push(x));
  }
  return out;
}

/** Werkt records bij (PATCH: enkel de meegegeven velden). */
async function update(table, records, opts = {}) {
  const out = [];
  for (const part of chunks(records, 10)) {
    const body = { records: part.map((r) => ({ id: r.id, fields: r.fields })) };
    if (opts.typecast) body.typecast = true;
    const r = await call(tablePath(table), { method: "PATCH", headers: headers(true), body: JSON.stringify(body) });
    (r.records || []).forEach((x) => out.push(x));
  }
  return out;
}

async function remove(table, ids) {
  const out = [];
  for (const part of chunks(ids, 10)) {
    const params = new URLSearchParams();
    part.forEach((id) => params.append("records[]", id));
    const r = await call(tablePath(table) + "?" + params.toString(), { method: "DELETE", headers: headers(false) });
    (r.records || []).forEach((x) => out.push(x));
  }
  return out;
}

/**
 * Laadt een bijlage rechtstreeks op (base64), tot 5 MB. Geen publieke URL nodig.
 * @param {string} recordId
 * @param {string} fieldId  veld-ID (fld…), geen naam
 * @param {{filename:string, contentType:string, base64:string}} file
 */
async function uploadAttachment(recordId, fieldId, file) {
  const url = `${cfg.airtableContentApi}/${cfg.BASE_ID}/${encodeURIComponent(recordId)}/${encodeURIComponent(fieldId)}/uploadAttachment`;
  return call(url, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ contentType: file.contentType, filename: file.filename, file: file.base64 })
  });
}

// ---- Formulehulpjes: nooit zelf strings in een formule plakken ----------------
/** Tekstwaarde veilig in een formule (enkele aanhalingstekens). */
function fStr(value) {
  return "'" + String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}
function fField(name) { return "{" + String(name).replace(/[{}]/g, "") + "}"; }
function fEq(field, value) { return `${fField(field)}=${fStr(value)}`; }
function fEqLower(field, value) { return `LOWER(${fField(field)})=${fStr(String(value).toLowerCase())}`; }
function fAnd(...parts) { const p = parts.filter(Boolean); return p.length > 1 ? `AND(${p.join(",")})` : (p[0] || ""); }
function fOr(...parts) { const p = parts.filter(Boolean); return p.length > 1 ? `OR(${p.join(",")})` : (p[0] || ""); }
function fTrue(field) { return `${fField(field)}=1`; }
function fIsAfterOrSame(field, isoDate) { const d = `DATETIME_PARSE(${fStr(isoDate)},'YYYY-MM-DD')`; return `OR(IS_AFTER(${fField(field)},${d}),IS_SAME(${fField(field)},${d},'day'))`; }

module.exports = {
  AirtableError,
  list, get, create, update, remove, uploadAttachment,
  formula: { str: fStr, field: fField, eq: fEq, eqLower: fEqLower, and: fAnd, or: fOr, isTrue: fTrue, onOrAfter: fIsAfterOrSame }
};
