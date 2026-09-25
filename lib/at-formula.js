"use strict";
// Interpréteur du sous-ensemble de formules Airtable (filterByFormula) utilisé par le
// portail. Partagé par le faux Airtable du banc local (scripts/fake-airtable.js) et par
// le moteur Postgres de production (lib/at-engine.js) : une seule implémentation, donc
// le banc local teste exactement ce qui tourne en production.
//
// compileFormula(src, { linkedPrimary }) -> (record) => valeur
//   linkedPrimary(id) : optionnel, renvoie le champ primaire d'un enregistrement lié
//   (Airtable affiche le nom, pas l'id, quand une formule lit un champ lien). Aucune
//   formule du portail ne lit un champ lien ; sans fonction, l'id est renvoyé.

function err(status, type, message) { const e = new Error(message); e.status = status; e.type = type; return e; }
function truthy(v) { return v === true || (typeof v === "number" && v !== 0) || (typeof v === "string" && v !== ""); }

const FORMULA_FUNCTIONS = new Set(["AND", "OR", "NOT", "LOWER", "UPPER", "FIND", "ARRAYJOIN", "IS_AFTER", "IS_BEFORE", "IS_SAME", "RECORD_ID", "DATETIME_PARSE", "TODAY", "NOW", "DATEADD", "REGEX_MATCH"]);
function norm(v) { if (v === true) return 1; if (v === false || v === undefined || v === null) return v === false ? 0 : ""; return typeof v === "number" ? v : String(v); }
function dayNum(v) { if (!v) return NaN; const d = new Date(String(v).length === 10 ? v + "T00:00:00Z" : v); return Number.isNaN(d.getTime()) ? NaN : Math.floor(d.getTime() / 86400000); }
function dateAdd(v, n, unit) {
  const d = new Date(String(v).length === 10 ? v + "T00:00:00Z" : v);
  if (Number.isNaN(d.getTime())) return "";
  const u = String(unit).toLowerCase();
  if (/^year/.test(u)) d.setUTCFullYear(d.getUTCFullYear() + n);
  else if (/^month/.test(u)) d.setUTCMonth(d.getUTCMonth() + n);
  else if (/^hour/.test(u)) d.setTime(d.getTime() + n * 3600000);
  else if (/^week/.test(u)) d.setUTCDate(d.getUTCDate() + n * 7);
  else d.setUTCDate(d.getUTCDate() + n); // days par défaut
  return d.toISOString();
}

function compileFormula(src, opts) {
  const linkedPrimary = (opts && opts.linkedPrimary) || null;
  let i = 0;
  const s = String(src);
  const peek = () => s[i];
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function parseExpr() { return parseCompare(); }
  function parseCompare() {
    const left = parsePrimary();
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
        if (Array.isArray(v)) return v.map((x) => (typeof x === "string" && linkedPrimary ? linkedPrimary(x) : (x && typeof x === "object" ? (x.filename || x.url || "") : x))).join(",");
        return v === undefined ? "" : v;
      };
    }
    if (c !== undefined && /[0-9.-]/.test(c)) { const m = s.slice(i).match(/^-?\d+(\.\d+)?/); if (!m) throw err(422, "INVALID_FILTER_BY_FORMULA", "The formula for filtering records is invalid: " + src); i += m[0].length; const n = Number(m[0]); return () => n; }
    const m = s.slice(i).match(/^[A-Z_]+/);
    if (m) {
      const fn = m[0]; i += fn.length; ws();
      // Fonction inconnue : refusée dès l'analyse, jamais évaluée à moitié.
      if (!FORMULA_FUNCTIONS.has(fn)) throw err(422, "INVALID_FILTER_BY_FORMULA", "Unknown function " + fn);
      if (peek() !== "(") throw err(422, "INVALID_FILTER_BY_FORMULA", "The formula for filtering records is invalid: " + src);
      i++;
      const args = [];
      ws();
      while (i < s.length && peek() !== ")") { args.push(parseExpr()); ws(); if (peek() === ",") { i++; ws(); } }
      if (peek() !== ")") throw err(422, "INVALID_FILTER_BY_FORMULA", "The formula for filtering records is invalid: " + src);
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
          // Fenêtres temporelles (api/allorders, api/orders, api/stock history).
          case "TODAY": return new Date().toISOString().slice(0, 10);
          case "NOW": return new Date().toISOString();
          case "DATEADD": return dateAdd(vals[0], Number(vals[1]) || 0, String(vals[2] || "days"));
          // Numérotation des commandes (lib/ordernumber.js) : ^CMD-2026-[0-9]{4}$
          case "REGEX_MATCH": { try { return new RegExp(String(vals[1] || "")).test(String(vals[0] == null ? "" : vals[0])); } catch (e) { return false; } }
          default: return "";
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

module.exports = { compileFormula, truthy, err, FORMULA_FUNCTIONS };
