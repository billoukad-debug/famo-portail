"use strict";
// Interrupteur de base de données. Chaque api/*.js fait require("../lib/datastore")
// en première ligne ; rien d'autre ne change dans le code métier.
//
//   DB_BACKEND absent ou "airtable" -> rien n'est touché : fetch part vers Airtable.
//   DB_BACKEND=postgres             -> les requêtes vers api.airtable.com /
//                                      content.airtable.com sont servies par
//                                      lib/at-engine.js sur Neon (DATABASE_URL).
//   DB_BACKEND=sqlite               -> idem sur un fichier SQLite (DB_SQLITE_FILE),
//                                      pour le banc local et les tests.
//
// Retour arrière : remettre DB_BACKEND=airtable (ou le supprimer) puis redéployer.
// Sans DATABASE_URL en mode postgres, les requêtes échouent (500) plutôt que de
// retomber en silence sur Airtable : deux bases divergentes seraient pires qu'une panne.

const BASE = "appcdduLth9iGX8I0";

function backend() {
  const b = String(process.env.DB_BACKEND || "airtable").trim().toLowerCase();
  return b === "postgres" || b === "sqlite" ? b : "airtable";
}

function databaseUrl() {
  return String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
}

function isAirtableUrl(url) {
  return url.startsWith("https://api.airtable.com/") || url.startsWith("https://content.airtable.com/");
}

// Une seule installation par processus, même si plusieurs fichiers api sont chargés.
function install() {
  const g = globalThis;
  if (g.__famoDatastore) return g.__famoDatastore;
  const realFetch = g.fetch;
  const state = { backend: backend(), realFetch, engine: null, store: null, sql: null, error: "" };
  g.__famoDatastore = state;
  if (state.backend === "airtable") return state;

  const { AtEngine, sqlStore } = require("./at-engine");
  const sqlLib = require("./sql");
  try {
    state.sql = state.backend === "postgres" ? sqlLib.neon(databaseUrl(), realFetch) : sqlLib.sqlite(process.env.DB_SQLITE_FILE || ":memory:");
    state.store = sqlStore(state.sql);
    state.engine = new AtEngine(state.store, { base: BASE });
  } catch (e) {
    state.error = e.message || String(e);
  }

  g.fetch = async function famoFetch(input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (!isAirtableUrl(url)) return realFetch(input, init);
    const o = init || {};
    let out;
    if (!state.engine) {
      out = { status: 500, json: { error: { type: "DATABASE_NOT_CONFIGURED", message: "Database niet geconfigureerd: " + (state.error || "DATABASE_URL ontbreekt") } } };
    } else {
      let body = null;
      if (o.body) { try { body = typeof o.body === "string" ? JSON.parse(o.body) : o.body; } catch (_) { body = null; } }
      out = await state.engine.handle(o.method || "GET", url, body);
    }
    return new Response(JSON.stringify(out.json), { status: out.status, headers: { "Content-Type": "application/json" } });
  };
  return state;
}

const state = install();

module.exports = {
  BASE,
  backend: () => state.backend,
  state,
  // fetch d'origine : sert à lire la vraie Airtable pendant la migration, même quand
  // l'interrupteur est déjà sur postgres.
  // En mode airtable, c'est le fetch courant (les tests le remplacent par un mock).
  realFetch: (...a) => (state.backend === "airtable" ? globalThis.fetch(...a) : state.realFetch(...a)),
  databaseUrl
};
