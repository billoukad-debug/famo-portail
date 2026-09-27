"use strict";
// Accès REST Airtable partagé par toutes les fonctions api/*.js.
// Fonctionne aussi sur Postgres/SQLite : lib/datastore.js intercepte fetch.
//
// - Lecture (GET) : 3 nouvelles tentatives avec attente croissante sur 5xx. Sur 429,
//   Airtable bloque la base 30 secondes (limite : 5 requêtes par seconde) : relancer
//   avant ne fait que prolonger la pénalité. Une lecture attend donc 30 s (ou le
//   Retry-After s'il est plus long) puis réessaie une fois.
// - Écriture : jamais rejouée sur 5xx (l'écriture a peut-être eu lieu), seulement sur
//   429, qu'Airtable refuse AVANT de traiter la requête.
// - Une réponse sans JSON ou en erreur HTTP sans corps { error } devient
//   { error: { message } } : jamais une « page vide » prise pour une table vide.
const BASE = "appcdduLth9iGX8I0";
const ROOT = `https://api.airtable.com/v0/${BASE}/`;
const RETRIES = 3;
// Surchargeable pour les tests uniquement (attendre 30 s dans un test n'apprend rien).
const WAIT_429_MS = () => (Number(process.env.AIRTABLE_429_WAIT_MS) >= 0 && process.env.AIRTABLE_429_WAIT_MS !== undefined ? Number(process.env.AIRTABLE_429_WAIT_MS) : 30000);
function retryAfterMs(r) {
  const h = r && r.headers && typeof r.headers.get === "function" ? r.headers.get("retry-after") : null;
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? Math.min(n * 1000, 60000) : 0;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function at(path, opts) {
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({ Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" }, o.headers || {});
  const method = String(o.method || "GET").toUpperCase();
  let waited429 = false;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(ROOT + path, o);
    const status = Number(r.status) || 0;
    if (status === 429 && method === "GET") {
      if (!waited429) { waited429 = true; await sleep(Math.max(WAIT_429_MS(), retryAfterMs(r))); continue; }
    } else {
      const retryable = status === 429 || (method === "GET" && status >= 500);
      if (retryable && attempt < RETRIES) { await sleep(250 * 2 ** attempt); continue; }
    }
    let j;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!j || typeof j !== "object") return { error: { type: "INVALID_RESPONSE", message: `Ongeldig antwoord van de database (${status || "?"})` } };
    if (status >= 400 && !j.error) return { error: { type: "HTTP_" + status, message: `Database-fout (${status})` } };
    return j;
  }
}

// Moteur SQL (DB_BACKEND=postgres/sqlite, lib/datastore.js) : tout d'un coup
// (pageSize=all, extension comprise du seul moteur), une requête au lieu d'une par page.
// Vers la vraie Airtable, rien ne change : pages de 100.
const sqlEngine = () => !!(globalThis.__famoDatastore && globalThis.__famoDatastore.engine);

async function atAll(path) {
  let offset = "", records = [];
  const sep = path.includes("?") ? "&" : "?";
  const all = sqlEngine() && !/[?&]pageSize=/.test(path) ? sep + "pageSize=all" : "";
  do {
    const page = await at(path + all + (offset ? (all ? "&" : sep) + "offset=" + encodeURIComponent(offset) : ""));
    if (page.error) return page;
    records = records.concat(page.records || []);
    offset = page.offset || "";
  } while (offset);
  return { records };
}

// Airtable accepte 10 enregistrements par requête : au-delà, tout est découpé.
// En cas d'échec, `done` liste les enregistrements déjà écrits (pour compenser).
async function atBatch(table, method, records, typecast) {
  const done = [];
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    const body = { records: chunk };
    if (typecast) body.typecast = true;
    const r = await at(table, { method, body: JSON.stringify(body) });
    if (r.error) return Object.assign({ done }, r);
    done.push(...chunk);
  }
  return { ok: true, done };
}

// Texte sûr dans une formule Airtable entre apostrophes : \ puis ' échappés,
// retours à la ligne retirés.
function escapeFormula(value) {
  return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Identifiant d'enregistrement : alphanumérique seulement (jamais « ../ » vers une autre table).
const REC = /^[A-Za-z0-9]{1,40}$/;

module.exports = { BASE, at, atAll, atBatch, escapeFormula, REC };
