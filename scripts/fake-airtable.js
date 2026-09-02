"use strict";
// Lokale nabootsing van de Airtable REST API, met het echte schema van de base.
// Doel: de productiecode ongewijzigd laten draaien tegen een lokale server, met
// dezelfde fouten als Airtable (onbekend veld, ongeldige keuze) zodat typfouten
// hier al opvallen. Wordt enkel door scripts/dev.js en de tests gebruikt.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE_ID = "appcdduLth9iGX8I0";

// Schema: veldnamen + types, overgenomen uit de echte base (list_tables_for_base).
const SCHEMA = {
  Clients: {
    fields: { "Nom": "text", "Email": "email", "Téléphone": "text", "Lieu de livraison": "text", "Articles habituels": "text", "Infos générales": "text", "Commandes": "links", "Prix négociés": "links", "Gebruikersnaam": "text", "Wachtwoord": "text", "BTW-nummer": "text", "Klantnummer": "text" },
    primary: "Nom"
  },
  Catalogue: {
    fields: { "Produit": "text", "Prix de base": "number", "Unité": "select", "Catégorie": "text", "Actif": "checkbox", "Stock": "links", "Prix négociés": "links" },
    selects: { "Unité": ["kg", "pièce", "caisse"] }, primary: "Produit"
  },
  Commandes: {
    fields: { "Référence": "text", "Date": "date", "Lignes (produits / quantités)": "text", "Statut": "select", "Statut paiement": "select", "Total": "number", "Photo préparation": "attachments", "Notes": "text", "Client": "links", "Date livraison souhaitée": "date", "Factuurnummer": "text", "Stock afgeboekt": "checkbox", "Préparation validée": "checkbox", "Préparée le": "datetime", "Livrée le": "datetime", "Preuve de livraison": "attachments", "Facturée le": "datetime", "Réceptionné par": "text", "Livraison confirmée": "checkbox" },
    selects: { "Statut": ["Reçue", "Prête", "Sortie en livraison", "Facturée"], "Statut paiement": ["En attente", "Payé"] },
    fieldIds: { fldjCdOntoPXPKLIb: "Preuve de livraison", fld4P0uySgGI6P6yE: "Photo préparation" }, primary: "Référence"
  },
  "Prix négociés": { fields: { "Libellé": "text", "Client": "links", "Produit": "links", "Prix négocié": "number" }, primary: "Libellé" },
  Configuratie: {
    fields: { "Bedrijfsnaam": "text", "Adres": "text", "Postcode en plaats": "text", "BTW-nummer": "text", "Telefoon": "text", "E-mail": "email", "IBAN": "text", "BIC": "text", "BTW-tarief": "number", "Betalingsvoorwaarden": "text", "Leveringsvoorwaarden": "text", "Bestellingen e-mail": "email", "Beheerderscode hash": "text", "Personeelscode hash": "text", "Besteldeadline": "text", "Leverdagen": "text" },
    primary: "Bedrijfsnaam"
  },
  Aanvragen: {
    fields: { "Bedrijfsnaam": "text", "Contactpersoon": "text", "Email": "email", "Telefoon": "text", "Adres": "text", "Notities": "text", "Status": "select" },
    selects: { "Status": ["Nieuw", "Verwerkt"] }, primary: "Bedrijfsnaam"
  }
};

function newId(prefix) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = prefix;
  for (let i = 0; i < 14; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

class FakeAirtable {
  constructor({ file } = {}) {
    this.file = file || null;
    this.data = {};
    Object.keys(SCHEMA).forEach((t) => { this.data[t] = []; });
    this.log = [];
    if (this.file && fs.existsSync(this.file)) {
      try { this.data = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (_) { /* opnieuw beginnen */ }
      Object.keys(SCHEMA).forEach((t) => { if (!this.data[t]) this.data[t] = []; });
    }
  }
  save() { if (this.file) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1)); } }
  reset() { Object.keys(SCHEMA).forEach((t) => { this.data[t] = []; }); this.save(); }

  table(name) {
    const t = Object.keys(SCHEMA).find((k) => k.toLowerCase() === String(name).toLowerCase());
    if (!t) throw err(404, "TABLE_NOT_FOUND", `Could not find table ${name} in application ${BASE_ID}`);
    return t;
  }
  validate(table, fields, typecast) {
    const s = SCHEMA[table];
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (!(k in s.fields)) throw err(422, "UNKNOWN_FIELD_NAME", `Unknown field name: "${k}"`);
      const type = s.fields[k];
      if (v === "" || v === null || v === undefined || v === false || (Array.isArray(v) && !v.length)) continue;
      if (type === "select") {
        const choices = (s.selects || {})[k] || [];
        if (typeof v !== "string") throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value.`);
        if (!choices.includes(v)) {
          if (!typecast) throw err(422, "INVALID_MULTIPLE_CHOICE_OPTIONS", `Insufficient permissions to create new select option "${v}"`);
          choices.push(v);
        }
      }
      if (type === "number" && typeof v !== "number") throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected number`);
      if (type === "checkbox" && v !== true) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value.`);
      if (type === "links" && !Array.isArray(v)) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected array of record ids`);
      if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected date`);
      if (type === "datetime" && Number.isNaN(Date.parse(String(v)))) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected datetime`);
      if ((type === "text" || type === "email") && typeof v !== "string") throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected string`);
      out[k] = v;
    }
    return out;
  }
  create(table, fieldsList, typecast) {
    return fieldsList.map((fields) => {
      const rec = { id: newId("rec"), createdTime: new Date().toISOString(), fields: this.validate(table, fields, typecast) };
      this.data[table].push(rec);
      return rec;
    });
  }
  update(table, records, typecast) {
    return records.map((r) => {
      const rec = this.data[table].find((x) => x.id === r.id);
      if (!rec) throw err(404, "NOT_FOUND", "Record not found");
      const validated = this.validate(table, r.fields, typecast);
      for (const [k, v] of Object.entries(r.fields || {})) {
        if (v === "" || v === null || v === undefined || v === false || (Array.isArray(v) && !v.length)) delete rec.fields[k];
        else rec.fields[k] = validated[k];
      }
      return rec;
    });
  }
  remove(table, ids) {
    return ids.map((id) => {
      const i = this.data[table].findIndex((x) => x.id === id);
      if (i < 0) throw err(404, "NOT_FOUND", "Record not found");
      this.data[table].splice(i, 1);
      return { id, deleted: true };
    });
  }
  list(table, q) {
    let rows = this.data[table].slice();
    if (q.filterByFormula) {
      const fn = compileFormula(q.filterByFormula, table, this);
      rows = rows.filter((r) => truthy(fn(r)));
    }
    (q.sort || []).slice().reverse().forEach((s) => {
      rows.sort((a, b) => {
        const av = a.fields[s.field], bv = b.fields[s.field];
        const c = av == null && bv == null ? 0 : av == null ? -1 : bv == null ? 1 : (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv)));
        return s.direction === "desc" ? -c : c;
      });
    });
    if (q.maxRecords) rows = rows.slice(0, q.maxRecords);
    const pageSize = Math.min(100, q.pageSize || 100);
    const start = q.offset ? Number(String(q.offset).replace(/^itr/, "")) || 0 : 0;
    const page = rows.slice(start, start + pageSize).map((r) => project(r, q.fields));
    const out = { records: page };
    if (start + pageSize < rows.length) out.offset = "itr" + (start + pageSize);
    return out;
  }
  get(table, id) {
    const rec = this.data[table].find((x) => x.id === id);
    if (!rec) throw err(404, "NOT_FOUND", "Record not found");
    return rec;
  }
  upload(recordId, fieldId, body) {
    for (const [t, s] of Object.entries(SCHEMA)) {
      const fieldName = (s.fieldIds || {})[fieldId];
      if (!fieldName) continue;
      const rec = this.data[t].find((x) => x.id === recordId);
      if (!rec) continue;
      const bytes = Math.floor(String(body.file || "").length * 3 / 4);
      if (bytes > 5 * 1024 * 1024) throw err(422, "INVALID_ATTACHMENT", "Attachment too large");
      const att = { id: newId("att"), url: `data:${body.contentType};base64,${body.file}`, filename: body.filename, size: bytes, type: body.contentType };
      rec.fields[fieldName] = (rec.fields[fieldName] || []).concat([att]);
      return { id: rec.id, createdTime: rec.createdTime, fields: { [fieldName]: rec.fields[fieldName] } };
    }
    throw err(404, "NOT_FOUND", "Record or field not found");
  }
}

function project(r, fields) {
  if (!fields || !fields.length) return { id: r.id, createdTime: r.createdTime, fields: Object.assign({}, r.fields) };
  const f = {};
  fields.forEach((k) => { if (r.fields[k] !== undefined) f[k] = r.fields[k]; });
  return { id: r.id, createdTime: r.createdTime, fields: f };
}
function err(status, type, message) { const e = new Error(message); e.status = status; e.type = type; return e; }
function truthy(v) { return v === true || (typeof v === "number" && v !== 0) || (typeof v === "string" && v !== ""); }

// ---- Mini-formule-evaluator (het deel van Airtable-formules dat de app gebruikt) ----
function compileFormula(src, table, db) {
  let i = 0;
  const s = String(src);
  const peek = () => s[i];
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function parseExpr() { return parseCompare(); }
  function parseCompare() {
    let left = parsePrimary();
    ws();
    if (s.startsWith("!=", i)) { i += 2; const right = parsePrimary(); return (r) => norm(left(r)) !== norm(right(r)); }
    if (peek() === "=") { i++; const right = parsePrimary(); return (r) => norm(left(r)) === norm(right(r)); }
    if (peek() === ">" || peek() === "<") { const op = s[i]; i++; const right = parsePrimary(); return (r) => (op === ">" ? Number(left(r)) > Number(right(r)) : Number(left(r)) < Number(right(r))); }
    return left;
  }
  function parsePrimary() {
    ws();
    const c = peek();
    if (c === "'" || c === '"') {
      i++; let out = "";
      while (i < s.length && s[i] !== c) { if (s[i] === "\\" && i + 1 < s.length) { i++; } out += s[i]; i++; }
      i++;
      return () => out;
    }
    if (c === "{") {
      const end = s.indexOf("}", i);
      const name = s.slice(i + 1, end); i = end + 1;
      return (r) => {
        const v = r.fields[name];
        if (Array.isArray(v)) {
          // gekoppelde records geven hun primaire veld terug, zoals in Airtable
          const linked = v.map((id) => { for (const t of Object.keys(SCHEMA)) { const rec = db.data[t].find((x) => x.id === id); if (rec) return rec.fields[SCHEMA[t].primary] || ""; } return id; });
          return linked.join(",");
        }
        return v === undefined ? "" : v;
      };
    }
    if (/[0-9.-]/.test(c)) { const m = s.slice(i).match(/^-?\d+(\.\d+)?/); i += m[0].length; const n = Number(m[0]); return () => n; }
    const m = s.slice(i).match(/^[A-Z_]+/);
    if (m) {
      const fn = m[0]; i += fn.length; ws();
      if (peek() !== "(") throw err(422, "INVALID_FILTER_BY_FORMULA", "The formula for filtering records is invalid: " + src);
      i++;
      const args = [];
      ws();
      while (peek() !== ")") { args.push(parseExpr()); ws(); if (peek() === ",") { i++; ws(); } }
      i++;
      return (r) => {
        const vals = args.map((a) => a(r));
        switch (fn) {
          case "AND": return vals.every(truthy);
          case "OR": return vals.some(truthy);
          case "NOT": return !truthy(vals[0]);
          case "LOWER": return String(vals[0] == null ? "" : vals[0]).toLowerCase();
          case "UPPER": return String(vals[0] == null ? "" : vals[0]).toUpperCase();
          case "FIND": return String(vals[1] || "").indexOf(String(vals[0] || "")) + 1;
          case "ARRAYJOIN": return String(vals[0] || "");
          case "IS_AFTER": return dayNum(vals[0]) > dayNum(vals[1]);
          case "IS_BEFORE": return dayNum(vals[0]) < dayNum(vals[1]);
          case "IS_SAME": return dayNum(vals[0]) === dayNum(vals[1]) && !!vals[0];
          case "RECORD_ID": return r.id;
          case "DATETIME_PARSE": return String(vals[0] || "");
          default: throw err(422, "INVALID_FILTER_BY_FORMULA", "Unknown function " + fn);
        }
      };
    }
    throw err(422, "INVALID_FILTER_BY_FORMULA", "The formula for filtering records is invalid: " + src);
  }
  const fn = parseExpr();
  ws();
  if (i < s.length) throw err(422, "INVALID_FILTER_BY_FORMULA", "The formula for filtering records is invalid: " + src);
  return fn;
}
function norm(v) { if (v === true) return 1; if (v === false || v === undefined || v === null) return v === false ? 0 : ""; return typeof v === "number" ? v : String(v); }
function dayNum(v) { if (!v) return NaN; const d = new Date(String(v).length === 10 ? v + "T00:00:00Z" : v); return Number.isNaN(d.getTime()) ? NaN : Math.floor(d.getTime() / 86400000); }

// ---- HTTP-server ------------------------------------------------------------------
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { const raw = Buffer.concat(chunks).toString("utf8"); try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(err(400, "INVALID_REQUEST_BODY", "Invalid JSON")); } });
    req.on("error", reject);
  });
}

function startServer(db, { port = 0, token = "dev-token", latencyMs = 0 } = {}) {
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    try {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const auth = String(req.headers.authorization || "");
      if (auth !== "Bearer " + token) return send(401, { error: { type: "AUTHENTICATION_REQUIRED", message: "Authentication required" } });
      const url = new URL(req.url, "http://x");
      const parts = url.pathname.split("/").filter(Boolean); // v0, base, table, id?
      if (parts[0] !== "v0" || parts[1] !== BASE_ID) return send(404, { error: { type: "NOT_FOUND", message: "Base not found" } });
      db.log.push({ method: req.method, path: url.pathname + url.search });
      // content-API: /v0/{base}/{recordId}/{fieldId}/uploadAttachment
      if (parts.length === 5 && parts[4] === "uploadAttachment" && req.method === "POST") {
        const body = await readJson(req);
        const out = db.upload(decodeURIComponent(parts[2]), decodeURIComponent(parts[3]), body);
        db.save(); return send(200, out);
      }
      const table = db.table(decodeURIComponent(parts[2] || ""));
      const id = parts[3] ? decodeURIComponent(parts[3]) : "";
      if (req.method === "GET" && id) return send(200, project(db.get(table, id)));
      if (req.method === "GET") {
        const q = { filterByFormula: url.searchParams.get("filterByFormula") || "", fields: url.searchParams.getAll("fields[]"), sort: [], maxRecords: Number(url.searchParams.get("maxRecords")) || 0, pageSize: Number(url.searchParams.get("pageSize")) || 100, offset: url.searchParams.get("offset") || "" };
        for (let k = 0; url.searchParams.has(`sort[${k}][field]`); k++) q.sort.push({ field: url.searchParams.get(`sort[${k}][field]`), direction: url.searchParams.get(`sort[${k}][direction]`) || "asc" });
        return send(200, db.list(table, q));
      }
      if (req.method === "POST") { const body = await readJson(req); if (!Array.isArray(body.records) || body.records.length > 10) return send(422, { error: { type: "INVALID_REQUEST_BODY", message: "records must be an array of at most 10" } }); const out = db.create(table, body.records.map((r) => r.fields || {}), !!body.typecast); db.save(); return send(200, { records: out }); }
      if (req.method === "PATCH") { const body = await readJson(req); if (!Array.isArray(body.records) || body.records.length > 10) return send(422, { error: { type: "INVALID_REQUEST_BODY", message: "records must be an array of at most 10" } }); const out = db.update(table, body.records, !!body.typecast); db.save(); return send(200, { records: out }); }
      if (req.method === "DELETE") { const ids = url.searchParams.getAll("records[]"); const out = db.remove(table, ids); db.save(); return send(200, { records: out }); }
      send(405, { error: { type: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    } catch (e) {
      send(e.status || 500, { error: { type: e.type || "SERVER_ERROR", message: e.message || String(e) } });
    }
  });
  return new Promise((resolve, reject) => { server.on("error", reject); server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/v0` })); });
}

module.exports = { FakeAirtable, startServer, SCHEMA, BASE_ID, compileFormula };
