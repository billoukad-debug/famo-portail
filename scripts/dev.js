"use strict";
// Serveur local v2 : pages statiques + fonctions api/*.js (contrat Vercel) contre une
// Airtable et un Resend NABOOTSÉS — zéro appel réel, zéro quota consommé.
//   node scripts/dev.js              -> http://localhost:4200
//   FAMO_REAL=1 node scripts/dev.js  -> vraie Airtable via .env (à éviter : quota)
// Les api/*.js restent byte-identiques à la production : on redirige simplement
// fetch("https://api.airtable.com/…") et fetch("https://api.resend.com/…") vers les
// serveurs locaux, avant de charger les fonctions.
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 4200;

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, "utf8").split("\n").forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
}

async function main() {
  const real = process.env.FAMO_REAL === "1";
  if (real) loadDotEnv();
  else {
    const { FakeAirtable, startServer: startAt } = require("./fake-airtable");
    const { FakeResend, startServer: startRs } = require("./fake-resend");
    const { seed } = require("./seed");
    const db = new FakeAirtable({ file: path.join(ROOT, ".dev-data", "airtable.json") });
    if (!db.data.Configuratie.length || process.env.FAMO_RESEED === "1") seed(db);
    const box = new FakeResend({ file: path.join(ROOT, ".dev-data", "mails.json") });
    const at = await startAt(db, { port: 0 });
    const rs = await startRs(box, { port: 0 });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      let url = typeof input === "string" ? input : (input && input.url) || String(input);
      if (url.startsWith("https://api.airtable.com/v0")) url = at.url + url.slice("https://api.airtable.com/v0".length);
      else if (url.startsWith("https://content.airtable.com/v0")) url = at.url + url.slice("https://content.airtable.com/v0".length);
      else if (url.startsWith("https://api.resend.com")) url = rs.url + url.slice("https://api.resend.com".length);
      return realFetch(url, init);
    };
    process.env.AIRTABLE_TOKEN = "dev-token";
    process.env.RESEND_API_KEY = "dev-resend";
    process.env.MAIL_FROM = process.env.MAIL_FROM || "FAMO Seafood <bestellingen@famotrading.be>";
    process.env.ADMIN_CODE = process.env.ADMIN_CODE || "beheer-dev-code";
    process.env.STAFF_CODE = process.env.STAFF_CODE || "team-dev-code";
    process.env.FAMO_DEV = "1";
    globalThis.__famoDev = { db, box, at, rs, seed: () => { seed(db); box.reset(); } };
    console.log("Nagebootste Airtable op " + at.url + " · postvak " + rs.url + "/inbox");
    // DB_BACKEND=sqlite : le portail tourne sur le moteur Postgres/SQL (lib/at-engine.js),
    // amorcé avec les mêmes données de démo. C'est la répétition générale de la bascule.
    if (String(process.env.DB_BACKEND || "").toLowerCase() === "sqlite") {
      const ds = require("../lib/datastore");
      for (const [tbl, recs] of Object.entries(db.data)) await ds.state.store.replaceAll(tbl, recs);
      console.log("Database: SQLite (" + (process.env.DB_SQLITE_FILE || ":memory:") + ") via lib/at-engine.js");
    }
    console.log("Codes: personeel = team-dev-code · beheer = beheer-dev-code · klant: aloha / welkom123");
  }
  process.env.FAMO_INSECURE_COOKIES = "1";
  process.env.PORTAL_URL = process.env.PORTAL_URL || `http://localhost:${PORT}`;
  process.env.PORT = String(PORT);
  require("./dev-server.js");
}
main().catch((e) => { console.error(e); process.exit(1); });
