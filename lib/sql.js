"use strict";
// Deux exécuteurs SQL au même contrat, sans aucune dépendance npm :
//   exec(query, params) -> Promise<lignes (objets)>
//   batch([{query, params}]) -> Promise (une transaction : tout ou rien)
//
// neon(url)   : Postgres Neon par HTTPS (« SQL over HTTP », le protocole du pilote
//               @neondatabase/serverless), avec le fetch natif de Node.
// sqlite(file): SQLite intégré à Node 22 (node:sqlite), pour les tests et le banc local.
// Les requêtes utilisent les paramètres $1, $2… (Postgres) ; SQLite les lit en ?1, ?2…

function neon(connectionString, fetchFn) {
  const doFetch = fetchFn || globalThis.fetch;
  const conn = String(connectionString || "").trim();
  if (!/^postgres(ql)?:\/\//.test(conn)) throw new Error("DATABASE_URL ontbreekt of is geen postgres://-adres");
  const host = new URL(conn.replace(/^postgres(ql)?:/, "http:")).hostname;
  // ep-xxx(-pooler).<regio>.aws.neon.tech -> api.<regio>.aws.neon.tech/sql (zoals de officiële driver)
  const endpoint = process.env.NEON_HTTP_URL || "https://" + host.replace(/^[^.]+\./, "api.") + "/sql";
  const prep = (params) => (params || []).map((v) => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v)));
  async function post(body) {
    const r = await doFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Neon-Connection-String": conn, "Neon-Raw-Text-Output": "true", "Neon-Array-Mode": "true" },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* texte brut */ }
    if (!r.ok) throw new Error("Database-fout (" + r.status + "): " + ((json && json.message) || text || "onbekend").slice(0, 300));
    return json || {};
  }
  const toRows = (res) => {
    const names = (res.fields || []).map((f) => f.name);
    return (res.rows || []).map((row) => (Array.isArray(row) ? Object.fromEntries(names.map((n, i) => [n, row[i]])) : row));
  };
  return {
    kind: "neon",
    endpoint,
    async exec(query, params) { return toRows(await post({ query, params: prep(params) })); },
    async batch(list) {
      if (!list.length) return [];
      const json = await post({ queries: list.map((q) => ({ query: q.query, params: prep(q.params) })) });
      if (!Array.isArray(json.results)) throw new Error("Database-fout: onverwacht antwoord op transactie");
      return json.results.map(toRows);
    }
  };
}

function sqlite(file) {
  // Chargé à la demande : node:sqlite affiche un avertissement « expérimental » au require.
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file || ":memory:");
  const conv = (q) => q.replace(/\$(\d+)/g, "?$1");
  const run = (query, params) => {
    const st = db.prepare(conv(query));
    const p = (params || []).map((v) => (v === undefined ? null : typeof v === "object" && v !== null ? JSON.stringify(v) : v));
    return /^\s*(select|with)\b|\breturning\b/i.test(query) ? st.all(...p) : (st.run(...p), []);
  };
  return {
    kind: "sqlite",
    async exec(query, params) { return run(query, params); },
    async batch(list) {
      db.exec("BEGIN");
      try { const out = list.map((q) => run(q.query, q.params)); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    close() { db.close(); }
  };
}

module.exports = { neon, sqlite };
