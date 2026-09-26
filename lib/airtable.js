"use strict";
// Accès REST Airtable partagé par toutes les fonctions api/*.js.
// Fonctionne aussi sur Postgres/SQLite : lib/datastore.js intercepte fetch.
//
// - Lecture (GET) : 3 nouvelles tentatives avec attente croissante sur 429 / 5xx
//   (limite Airtable : 5 requêtes par seconde et par base).
// - Écriture : jamais rejouée sur 5xx (l'écriture a peut-être eu lieu), seulement sur
//   429, qu'Airtable refuse AVANT de traiter la requête.
// - Une réponse sans JSON ou en erreur HTTP sans corps { error } devient
//   { error: { message } } : jamais une « page vide » prise pour une table vide.
const BASE = "appcdduLth9iGX8I0";
const ROOT = `https://api.airtable.com/v0/${BASE}/`;
const RETRIES = 3;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function at(path, opts) {
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({ Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" }, o.headers || {});
  const method = String(o.method || "GET").toUpperCase();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(ROOT + path, o);
    const status = Number(r.status) || 0;
    const retryable = status === 429 || (method === "GET" && status >= 500);
    if (retryable && attempt < RETRIES) { await sleep(250 * 2 ** attempt); continue; }
    let j;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!j || typeof j !== "object") return { error: { type: "INVALID_RESPONSE", message: `Ongeldig antwoord van de database (${status || "?"})` } };
    if (status >= 400 && !j.error) return { error: { type: "HTTP_" + status, message: `Database-fout (${status})` } };
    return j;
  }
}

async function atAll(path) {
  let offset = "", records = [];
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await at(path + (offset ? sep + "offset=" + encodeURIComponent(offset) : ""));
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
