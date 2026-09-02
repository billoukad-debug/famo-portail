"use strict";
// Lokale server: statische bestanden + de API-functie, met nagebootste Airtable en
// Resend (standaard) of met echte omgevingsvariabelen uit .env (FAMO_REAL=1).
//
//   node scripts/dev.js            -> http://localhost:4100  (postvak: /dev/inbox)
//   FAMO_REAL=1 node scripts/dev.js -> echte Airtable/Resend via .env
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 4100;

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
  let fakes = null;
  if (real) {
    loadDotEnv();
  } else {
    const { FakeAirtable, startServer: startAt } = require("./fake-airtable");
    const { FakeResend, startServer: startRs } = require("./fake-resend");
    const { seed } = require("./seed");
    const db = new FakeAirtable({ file: path.join(ROOT, ".dev-data", "airtable.json") });
    if (!db.data.Configuratie.length || process.env.FAMO_RESEED === "1") seed(db);
    const box = new FakeResend({ file: path.join(ROOT, ".dev-data", "mails.json") });
    const at = await startAt(db, { port: Number(process.env.FAKE_AIRTABLE_PORT) || 0 });
    const rs = await startRs(box, { port: Number(process.env.FAKE_RESEND_PORT) || 0 });
    process.env.AIRTABLE_API_URL = at.url;
    process.env.AIRTABLE_CONTENT_URL = at.url;
    process.env.AIRTABLE_TOKEN = "dev-token";
    process.env.RESEND_API_URL = rs.url;
    process.env.RESEND_API_KEY = "dev-resend";
    process.env.MAIL_FROM = process.env.MAIL_FROM || "Famo Trading <bestellingen@famotrading.be>";
    process.env.ADMIN_CODE = process.env.ADMIN_CODE || "beheer-dev-code";
    process.env.STAFF_CODE = process.env.STAFF_CODE || "team-dev-code";
    fakes = { db, box, at, rs };
  }
  process.env.FAMO_INSECURE_COOKIES = "1";
  process.env.PORTAL_URL = process.env.PORTAL_URL || `http://localhost:${PORT}`;

  const api = require(path.join(ROOT, "api", "[...path].js"));
  const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".json": "application/json", ".txt": "text/plain; charset=utf-8" };

  function serveStatic(res, file) {
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("niet gevonden"); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  }
  function readBody(req) {
    return new Promise((resolve) => { const c = []; req.on("data", (x) => c.push(x)); req.on("end", () => resolve(Buffer.concat(c).toString("utf8"))); });
  }
  async function runApi(req, res, segs) {
    req.query = { path: segs };
    const ct = String(req.headers["content-type"] || "");
    if (req.method !== "GET" && req.method !== "HEAD") {
      const raw = await readBody(req);
      if (ct.includes("application/json")) { try { req.body = raw ? JSON.parse(raw) : {}; } catch (_) { req.body = raw; } }
      else req.body = raw;
    }
    return api(req, res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    try {
      if (!real && p === "/dev/inbox") { res.writeHead(302, { Location: fakes.rs.url + "/inbox" }); return res.end(); }
      if (!real && p === "/dev/reseed") { require("./seed").seed(fakes.db); fakes.box.reset(); res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("opnieuw gevuld"); }
      if (p.startsWith("/api/")) return await runApi(req, res, p.slice(5).split("/").filter(Boolean).map(decodeURIComponent));
      if (p.startsWith("/doc/") || p === "/doc") return await runApi(req, res, p.slice(1).split("/").filter(Boolean).map(decodeURIComponent));
      // cleanUrls: /team -> team.html
      let file = path.join(ROOT, p === "/" ? "index.html" : p);
      if (!path.extname(file) && fs.existsSync(file + ".html")) file += ".html";
      if (!file.startsWith(ROOT) || /\/(lib|api|scripts|test|node_modules|\.dev-data)\//.test(file + "/")) { res.writeHead(404); return res.end("niet gevonden"); }
      return serveStatic(res, file);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: String(e.message || e) })); }
    }
  });
  server.listen(PORT, () => {
    console.log(`Famo Kade lokaal: http://localhost:${PORT}  (${real ? "ECHTE Airtable/Resend via .env" : "nagebootste Airtable op " + fakes.at.url + ", postvak op " + fakes.rs.url + "/inbox"})`);
    if (!real) console.log("Codes: team = team-dev-code, beheer = beheer-dev-code · klant: aloha / welkom123");
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
