// Serveur de développement local — sert les pages statiques et route /api/*
// vers les fonctions serverless (contrat Vercel). Aucune dépendance externe.
//
//   node scripts/dev-server.js            # port 3000 par défaut
//   PORT=4000 node scripts/dev-server.js  # port personnalisé
//
// Les fonctions api/*.js utilisent la signature Vercel `module.exports = async (req, res) => {}`
// avec req.query / req.body (parsé) et res.status().json(). Ce harnais reproduit ces aides
// au-dessus du module http natif afin de faire tourner l'application sans le CLI Vercel.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const root = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8"
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

// Ajoute les aides Vercel (res.status / res.json / res.send) à la réponse http native.
function decorateRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (data) => {
    if (data == null) { res.end(); return res; }
    if (typeof data === "object" && !Buffer.isBuffer(data)) return res.json(data);
    res.end(data);
    return res;
  };
  return res;
}

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === "/" || rel === "") rel = "/index.html";
  // Empêche la traversée de répertoire.
  const filePath = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(root)) {
    res.statusCode = 403; res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found: " + rel);
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream");
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  decorateRes(res);
  const parsed = new URL(req.url, "http://localhost:" + PORT);

  if (parsed.pathname.startsWith("/api/")) {
    const name = parsed.pathname.slice("/api/".length).replace(/\/+$/, "");
    const handlerPath = path.join(root, "api", name + ".js");
    if (!fs.existsSync(handlerPath)) {
      res.status(404).json({ error: "Onbekende API-route: /api/" + name });
      return;
    }
    // req.query
    req.query = {};
    for (const [k, v] of parsed.searchParams.entries()) req.query[k] = v;
    // req.body (parsé JSON si applicable, comme Vercel)
    const raw = await readBody(req);
    const ct = String(req.headers["content-type"] || "");
    if (raw && ct.includes("application/json")) {
      try { req.body = JSON.parse(raw); } catch (e) { req.body = {}; }
    } else if (raw) {
      req.body = raw;
    } else {
      req.body = undefined;
    }
    try {
      const handler = require(handlerPath);
      await handler(req, res);
    } catch (e) {
      if (!res.writableEnded) res.status(500).json({ error: String(e && e.stack || e) });
    }
    return;
  }

  serveStatic(res, parsed.pathname);
});

server.listen(PORT, () => {
  console.log("FAMO Portail dev server → http://localhost:" + PORT);
  console.log("STAFF_CODE=" + (process.env.STAFF_CODE ? "(défini)" : "famo2026 (fallback)") +
    "  AIRTABLE_TOKEN=" + (process.env.AIRTABLE_TOKEN ? "(défini)" : "(absent — les appels Airtable échoueront)"));
});
