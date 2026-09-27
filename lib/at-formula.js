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

// Analyse -> arbre : { t: "str"|"num"|"field"|"fn"|"cmp", … }. Un seul analyseur sert
// à l'évaluation JS (compileFormula) et à la traduction SQL (sqlPrefilter).
function parseFormula(src) {
  let i = 0;
  const s = String(src);
  const peek = () => s[i];
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const bad = () => err(422, "INVALID_FILTER_BY_FORMULA", "The formula for filtering records is invalid: " + src);
  function parseExpr() { return parseCompare(); }
  function parseCompare() {
    const left = parsePrimary();
    ws();
    if (s.startsWith("!=", i)) { i += 2; return { t: "cmp", op: "!=", l: left, r: parsePrimary() }; }
    if (peek() === "=") { i++; return { t: "cmp", op: "=", l: left, r: parsePrimary() }; }
    if (peek() === ">" || peek() === "<") { const op = s[i]; i++; return { t: "cmp", op, l: left, r: parsePrimary() }; }
    return left;
  }
  function parsePrimary() {
    ws();
    const c = peek();
    if (c === "'" || c === '"') {
      i++; let out = "";
      while (i < s.length && s[i] !== c) { if (s[i] === "\\" && i + 1 < s.length) { i++; } out += s[i]; i++; }
      i++;
      return { t: "str", v: out };
    }
    if (c === "{") {
      const end = s.indexOf("}", i);
      const name = s.slice(i + 1, end); i = end + 1;
      return { t: "field", name };
    }
    if (c !== undefined && /[0-9.-]/.test(c)) { const m = s.slice(i).match(/^-?\d+(\.\d+)?/); if (!m) throw bad(); i += m[0].length; return { t: "num", v: Number(m[0]) }; }
    const m = s.slice(i).match(/^[A-Z_]+/);
    if (m) {
      const fn = m[0]; i += fn.length; ws();
      // Fonction inconnue : refusée dès l'analyse, jamais évaluée à moitié.
      if (!FORMULA_FUNCTIONS.has(fn)) throw err(422, "INVALID_FILTER_BY_FORMULA", "Unknown function " + fn);
      if (peek() !== "(") throw bad();
      i++;
      const args = [];
      ws();
      while (i < s.length && peek() !== ")") { args.push(parseExpr()); ws(); if (peek() === ",") { i++; ws(); } }
      if (peek() !== ")") throw bad();
      i++;
      return { t: "fn", name: fn, args };
    }
    throw bad();
  }
  const ast = parseExpr();
  ws();
  if (i < s.length) throw bad();
  return ast;
}

function compileNode(node, linkedPrimary) {
  switch (node.t) {
    case "str": case "num": { const v = node.v; return () => v; }
    case "field": {
      const name = node.name;
      return (r) => {
        const v = r.fields[name];
        if (Array.isArray(v)) return v.map((x) => (typeof x === "string" && linkedPrimary ? linkedPrimary(x) : (x && typeof x === "object" ? (x.filename || x.url || "") : x))).join(",");
        return v === undefined ? "" : v;
      };
    }
    case "cmp": {
      const left = compileNode(node.l, linkedPrimary), right = compileNode(node.r, linkedPrimary), op = node.op;
      if (op === "!=") return (r) => norm(left(r)) !== norm(right(r));
      if (op === "=") return (r) => norm(left(r)) === norm(right(r));
      return (r) => (op === ">" ? Number(left(r)) > Number(right(r)) : Number(left(r)) < Number(right(r)));
    }
    default: {
      // Sous-expression sans champ ni RECORD_ID (DATEADD(TODAY(),-365,'days')) : calculée une
      // fois par formule compilée, pas une fois par enregistrement (50 000 dates sinon).
      if (!hasRecordDep(node)) { let done = false, val; const f = compileFn(node, linkedPrimary); return (r) => { if (!done) { val = f(r); done = true; } return val; }; }
      return compileFn(node, linkedPrimary);
    }
  }
}
function compileFn(node, linkedPrimary) {
  const fn = node.name, args = node.args.map((a) => compileNode(a, linkedPrimary));
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

function compileFormula(src, opts) {
  return compileNode(parseFormula(src), (opts && opts.linkedPrimary) || null);
}

// ---- Traduction SQL (pré-filtre) ------------------------------------------------------
// sqlPrefilter(src, dialect, param) -> texte SQL booléen, ou "" (rien de traduisible).
//
// Contrat : le pré-filtre renvoie un SUR-ENSEMBLE des enregistrements retenus par la
// formule, jamais moins. Le moteur réévalue ensuite la formule exacte en JS sur ce qui
// revient de la base : la sémantique reste celle de compileFormula (tests existants),
// la base se contente d'écarter l'essentiel des lignes. Tout ce qui n'est pas traduit
// avec certitude vaut « vrai » (AND l'ignore, OR entier non traduit).
//
// dialect : "pg" (colonne j = fields::jsonb) ou "sqlite" (json_extract sur fields).
// param(valeur) -> "$n" : les valeurs de la formule sont TOUJOURS liées, jamais collées
// dans le texte SQL (noms de champs compris).
const ISO_DAY_RE = { pg: "'^[0-9]{4}-[0-9]{2}-[0-9]{2}'", sqlite: "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'" };
function hasRecordDep(node) {
  if (node.t === "field") return true;
  if (node.t === "fn") return node.name === "RECORD_ID" || node.args.some(hasRecordDep);
  if (node.t === "cmp") return hasRecordDep(node.l) || hasRecordDep(node.r);
  return false;
}
// Valeur d'une sous-expression constante (TODAY(), DATEADD(TODAY(),-365,'days')…).
const constValue = (node) => compileNode(node, null)({ id: "", fields: {} });

function sqlPrefilter(src, dialect, param) {
  const ast = typeof src === "string" ? parseFormula(src) : src;
  const pg = dialect === "pg";
  // Accès typé à un champ JSON. Clé liée en paramètre ; SQLite veut un chemin JSON.
  const acc = (name) => {
    if (pg) { const k = param(name) + "::text"; return { type: `jsonb_typeof(j->${k})`, text: `(j->>${k})` }; }
    if (/["\\]/.test(name)) return null; // chemin JSON non exprimable sans concaténation
    const p = param('$."' + name + '"');
    return { type: `json_type(fields, ${p})`, text: `CAST(json_extract(fields, ${p}) AS TEXT)`, raw: `json_extract(fields, ${p})` };
  };
  const T = pg ? { str: "'string'" } : { str: "'text'" };
  const txt = (v) => param(String(v)) + (pg ? "::text" : "");
  const num = (v) => (pg ? param(String(v)) + "::numeric" : param(Number(v)));

  function eqString(f, lit, negate) {
    const a = acc(f); if (!a) return "";
    // Chaîne : comparaison exacte. Absent : la formule lit "". Nombre/booléen : jamais égal
    // à un texte. Tableau (lien, pièce jointe) ou objet : laissé au filtre JS.
    const cmpSql = `${a.text} ${negate ? "<>" : "="} ${txt(lit)}`;
    const missing = negate ? (lit !== "" ? "TRUE" : "FALSE") : (lit === "" ? "TRUE" : "FALSE");
    const scalar = negate ? "TRUE" : "FALSE";
    const numTypes = pg ? "'number','boolean'" : "'integer','real','true','false'";
    return `(CASE WHEN ${a.type} IS NULL THEN ${missing} WHEN ${a.type} = ${T.str} THEN ${cmpSql} WHEN ${a.type} IN (${numTypes}) THEN ${scalar} ELSE TRUE END)`;
  }
  function eqNumber(f, n, negate) {
    const a = acc(f); if (!a) return "";
    // norm(true) = 1, norm(false) = 0 ; un texte n'est jamais égal à un nombre.
    const isNum = pg ? `${a.type} = 'number'` : `${a.type} IN ('integer','real')`;
    const numVal = pg ? `(${a.text})::numeric` : a.raw;
    const boolTrue = pg ? `(${a.type} = 'boolean' AND ${a.text} = 'true')` : `${a.type} = 'true'`;
    const boolFalse = pg ? `(${a.type} = 'boolean' AND ${a.text} = 'false')` : `${a.type} = 'false'`;
    const eq = `(CASE WHEN ${isNum} THEN ${numVal} = ${num(n)} WHEN ${boolTrue} THEN ${n === 1 ? "TRUE" : "FALSE"} WHEN ${boolFalse} THEN ${n === 0 ? "TRUE" : "FALSE"} ELSE FALSE END)`;
    return negate ? `(NOT ${eq})` : eq;
  }
  function cmp(node) {
    if (node.op !== "=" && node.op !== "!=") return "";
    let l = node.l, r = node.r;
    const isLower = (x) => x.t === "fn" && x.name === "LOWER" && x.args.length === 1 && x.args[0].t === "field";
    if (l.t !== "field" && !(l.t === "fn" && l.name === "RECORD_ID") && !isLower(l)) { const x = l; l = r; r = x; }
    const negate = node.op === "!=";
    // LOWER({Gebruikersnaam})='aloha' (connexion client, à chaque appel du portail client).
    // lower() SQL = toLowerCase() JS pour l'ASCII ; une valeur non ASCII est laissée au JS.
    if (isLower(l) && r.t === "str" && !negate) {
      const a = acc(l.args[0].name); if (!a) return "";
      const nonAscii = pg ? `${a.text} ~ '[^ -~]'` : `${a.text} GLOB '*[^ -~]*'`;
      return `(CASE WHEN ${a.type} IS NULL THEN ${r.v === "" ? "TRUE" : "FALSE"} WHEN ${a.type} = ${T.str} THEN (lower(${a.text}) = ${txt(r.v)} OR ${nonAscii}) ELSE TRUE END)`;
    }
    if (l.t === "fn" && l.name === "RECORD_ID" && !l.args.length && r.t === "str") return `id ${negate ? "<>" : "="} ${txt(r.v)}`;
    if (l.t !== "field") return "";
    if (r.t === "str") return eqString(l.name, r.v, negate);
    if (r.t === "num") return eqNumber(l.name, r.v, negate);
    return "";
  }
  // Date : jour UTC du champ comparé à une constante. Un préfixe AAAA-MM-JJ décalé d'un
  // fuseau peut différer d'un jour du jour UTC : on garde un jour de marge (sur-ensemble).
  function dateCmp(node) {
    const [f, c] = node.args;
    if (!f || !c || f.t !== "field" || hasRecordDep(c)) return "";
    const d = dayNum(constValue(c));
    if (!Number.isFinite(d)) return "";
    const a = acc(f.name); if (!a) return "";
    const day = new Date(d * 86400000).toISOString().slice(0, 10);
    const head = pg ? `left(${a.text}, 10)` : `substr(${a.text}, 1, 10)`;
    const isoLike = pg ? `${a.text} ~ ${ISO_DAY_RE.pg}` : `${a.text} GLOB ${ISO_DAY_RE.sqlite}`;
    const test = node.name === "IS_AFTER" ? `${head} >= ${txt(day)}` : `${head} <= ${txt(day)}`;
    // Absent : dayNum("") = NaN, jamais vrai. Autre forme de date : laissée au filtre JS.
    return `(CASE WHEN ${a.type} IS NULL THEN FALSE WHEN ${a.type} = ${T.str} AND ${isoLike} THEN ${test} ELSE TRUE END)`;
  }
  // FIND('texte', ARRAYJOIN({Lien})) ou FIND('texte', {Champ}) : contenu dans le texte
  // brut du champ (JSON pour un tableau). Aiguille sans guillemet, virgule ni crochet :
  // sa présence dans la valeur jointe implique sa présence dans le JSON.
  function find(node) {
    const [needle, hay0] = node.args;
    if (!needle || needle.t !== "str" || !needle.v || /["\\,[\]\u0000-\u001f]/.test(needle.v) || /true|false/.test(needle.v)) return "";
    const hay = hay0 && hay0.t === "fn" && hay0.name === "ARRAYJOIN" && hay0.args.length === 1 ? hay0.args[0] : hay0;
    if (!hay || hay.t !== "field") return "";
    const a = acc(hay.name); if (!a) return "";
    // Postgres : ->> d'un tableau jsonb renvoie son texte JSON ; SQLite : idem via CAST.
    return `(${a.type} IS NOT NULL AND ${pg ? "strpos" : "instr"}(${a.text}, ${txt(needle.v)}) > 0)`;
  }
  // REGEX_MATCH({Champ}, "^CMD-2026-…") : le préfixe littéral de l'expression suffit.
  function regex(node) {
    const [f, re] = node.args;
    if (!f || !re || f.t !== "field" || re.t !== "str") return "";
    // Alternative (|) : le préfixe ne s'applique plus à tout ; quantificateur après le
    // préfixe (ab*, ab?, ab{0}) : son dernier caractère devient facultatif.
    const m = /^\^([A-Za-z0-9 _-]+)(.?)/.exec(re.v);
    if (!m || re.v.includes("|")) return "";
    const prefix = /[*?{]/.test(m[2]) ? m[1].slice(0, -1) : m[1];
    if (!prefix) return "";
    const a = acc(f.name); if (!a) return "";
    const head = pg ? `left(${a.text}, ${prefix.length})` : `substr(${a.text}, 1, ${prefix.length})`;
    return `(${a.type} = ${T.str} AND ${head} = ${txt(prefix)})`;
  }
  function cond(node) {
    if (node.t === "cmp") return cmp(node);
    if (node.t !== "fn") return "";
    if (node.name === "AND") { const parts = node.args.map(cond).filter(Boolean); return parts.length ? "(" + parts.join(" AND ") + ")" : ""; }
    if (node.name === "OR") { const parts = node.args.map(cond); return parts.length && parts.every(Boolean) ? "(" + parts.join(" OR ") + ")" : ""; }
    if (node.name === "IS_AFTER" || node.name === "IS_BEFORE") return dateCmp(node);
    if (node.name === "FIND") return find(node);
    if (node.name === "REGEX_MATCH") return regex(node);
    return "";
  }
  return cond(ast);
}

module.exports = { compileFormula, parseFormula, sqlPrefilter, truthy, err, FORMULA_FUNCTIONS, dayNum };
