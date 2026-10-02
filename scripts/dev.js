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
// Geheim van de nagebootste webhook (lokaal, publiek bekend, nooit in productie).
const DEV_INBOUND_SECRET = "whsec_" + Buffer.from("famo-dev-inbound-secret-0123456789").toString("base64");

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, "utf8").split("\n").forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
}

// /api/foto?id=att… sur le faux Airtable (sans base SQL, api/foto.js n'a rien à servir) : mêmes
// règles que api/foto.js — photo produit publique, tout autre fichier (preuve de livraison) réservé
// au personnel. true = réponse envoyée ; false = api/foto.js répond (404).
async function serveFakeFile(db, req, res, id) {
  const f = /^att[A-Za-z0-9]{14}$/.test(String(id || "")) ? db.fileById(id) : null;
  if (!f || !/^image\/(jpeg|png|webp)$/.test(f.contentType)) return false;
  const isProduct = db.data.Catalogue.some((r) => r.id === f.recordId);
  if (!isProduct && !(await require("../lib/staffauth").staffSession(req))) return false;
  const buf = Buffer.from(f.data, "base64");
  res.setHeader("Content-Type", f.contentType);
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("Cache-Control", isProduct ? "public, max-age=3600" : "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.statusCode = 200;
  res.end(req.method === "HEAD" ? undefined : buf);
  return true;
}

async function main() {
  const real = process.env.FAMO_REAL === "1";
  if (real) loadDotEnv();
  else {
    const { FakeAirtable, startServer: startAt } = require("./fake-airtable");
    const { FakeResend, startServer: startRs } = require("./fake-resend");
    const { seed } = require("./seed");
    const db = new FakeAirtable({ file: path.join(ROOT, ".dev-data", "airtable.json") });
    if (!db.data.Configuratie.length || process.env.FAMO_RESEED === "1") seed(db, { fotos: true });
    const box = new FakeResend({ file: path.join(ROOT, ".dev-data", "mails.json") });
    const at = await startAt(db, { port: 0 });
    const rs = await startRs(box, { port: 0 });
    // Bestellen per e-mail (specs/020) : nagebootste Claude, en de adressen voor scripts/mail-inbound-test.js.
    const ai = await require("./fake-anthropic").startServer({ port: 0 });
    fs.mkdirSync(path.join(ROOT, ".dev-data"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, ".dev-data", "dev-ports.json"), JSON.stringify({ portal: "http://localhost:" + PORT, resend: rs.url, anthropic: ai.url }, null, 1));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      let url = typeof input === "string" ? input : (input && input.url) || String(input);
      if (url.startsWith("https://api.airtable.com/v0")) url = at.url + url.slice("https://api.airtable.com/v0".length);
      else if (url.startsWith("https://content.airtable.com/v0")) url = at.url + url.slice("https://content.airtable.com/v0".length);
      else if (url.startsWith("https://api.resend.com")) url = rs.url + url.slice("https://api.resend.com".length);
      else if (url.startsWith("https://api.anthropic.com")) url = ai.url + url.slice("https://api.anthropic.com".length);
      return realFetch(url, init);
    };
    process.env.AIRTABLE_TOKEN = "dev-token";
    process.env.RESEND_API_KEY = "dev-resend";
    process.env.MAIL_FROM = process.env.MAIL_FROM || "FAMO Seafood <bestellingen@famotrading.be>";
    // Webhook-geheim en AI-sleutel van de ontwikkelomgeving (nooit echte waarden) : zie scripts/mail-inbound-test.js.
    process.env.RESEND_INBOUND_SECRET = process.env.RESEND_INBOUND_SECRET || DEV_INBOUND_SECRET;
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "dev-anthropic";
    process.env.ADMIN_CODE = process.env.ADMIN_CODE || "beheer-dev-code";
    process.env.STAFF_CODE = process.env.STAFF_CODE || "team-dev-code";
    // Photos de démo (spec 018) : quelques produits ont 2–3 vues, générées par seed.js.
    globalThis.__famoDev = { db, box, at, rs, seed: () => { seed(db, { fotos: true }); box.reset(); }, serveFile: (req, res, id) => serveFakeFile(db, req, res, id) };
    console.log("Nagebootste Airtable op " + at.url + " · postvak " + rs.url + "/inbox");
    // DB_BACKEND=sqlite : le portail tourne sur le moteur Postgres/SQL (lib/at-engine.js),
    // amorcé avec les mêmes données de démo. C'est la répétition générale de la bascule.
    if (String(process.env.DB_BACKEND || "").toLowerCase() === "sqlite") {
      const ds = require("../lib/datastore");
      for (const [tbl, recs] of Object.entries(db.data)) await ds.state.store.replaceAll(tbl, recs);
      // Fichiers des pièces jointes (photos de démo) : dans famo_files, servis par api/foto.js.
      await ds.state.store.clearFiles();
      for (const [id, f] of Object.entries(db.files)) await ds.state.store.putFile({ id, recordId: f.recordId, contentType: f.contentType, filename: f.filename, size: f.size, data: f.data });
      globalThis.__famoDev.serveFile = null;
      console.log("Database: SQLite (" + (process.env.DB_SQLITE_FILE || ":memory:") + ") via lib/at-engine.js");
    }
    console.log("Codes: personeel = team-dev-code · beheer = beheer-dev-code · klant: aloha / welkom123");
    console.log("Bestelling per e-mail nabootsen: node scripts/mail-inbound-test.js (zie --help)");
  }
  process.env.PORTAL_URL = process.env.PORTAL_URL || `http://localhost:${PORT}`;
  process.env.PORT = String(PORT);
  require("./dev-server.js");
}
main().catch((e) => { console.error(e); process.exit(1); });
