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

// Redirections de vercel.json (« /x/:path* », « /x.html ») : même réponse qu'en production.
const VERCEL = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const REDIRECTS = (VERCEL.redirects || []).map((r) => {
  const keys = [];
  const src = r.source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)\\\*/g, (m, k) => { keys.push(k); return "(.*)"; }).replace(/:(\w+)/g, (m, k) => { keys.push(k); return "([^/]+)"; });
  return { re: new RegExp("^" + src + "$"), keys, to: r.destination, code: r.permanent ? 308 : 307 };
});
function redirect(res, to, code) { res.statusCode = code; res.setHeader("Location", to); res.end(); }
function vercelRedirect(pathname, search) {
  for (const r of REDIRECTS) {
    const m = r.re.exec(pathname); if (!m) continue;
    let to = r.to; r.keys.forEach((k, i) => { to = to.replace(new RegExp(":" + k + "\\*?"), m[i + 1]); });
    if (search) to += (to.includes("?") ? "&" : "?") + search.slice(1); // la requête d'origine suit, comme sur Vercel
    return { to, code: r.code };
  }
  return null;
}

// cleanUrls : /team/magazijn sert team/magazijn.html, /team/magazijn.html redirige vers /team/magazijn.
function serveStatic(res, urlPath, search) {
  let rel = decodeURIComponent(urlPath);
  // Même ordre que Vercel : trailingSlash et cleanUrls (x.html → x) d'abord, puis les redirections de vercel.json.
  // Une source « /x.html » n'y est donc jamais atteinte : les anciennes adresses se redirigent par « /x ».
  if (rel.length > 1 && rel.endsWith("/")) return redirect(res, rel.replace(/\/+$/, "") + (search || ""), 308);
  if (VERCEL.cleanUrls && rel.endsWith(".html")) return redirect(res, (rel.replace(/(\/index)?\.html$/, "") || "/") + (search || ""), 308);
  const r = vercelRedirect(rel, search || "");
  if (r) return redirect(res, r.to, r.code);
  if (rel === "/" || rel === "") rel = "/index.html";
  else if (VERCEL.cleanUrls && !path.extname(rel)) rel = fs.existsSync(path.join(root, rel + ".html")) ? rel + ".html" : rel + "/index.html";
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
      // node scripts/dev.js sur le faux Airtable : ses fichiers de pièces jointes (spec 018).
      const dev = globalThis.__famoDev;
      if (name === "foto" && dev && dev.serveFile && /^(GET|HEAD)$/.test(req.method) && (await dev.serveFile(req, res, req.query.id))) return;
      const handler = require(handlerPath);
      await handler(req, res);
    } catch (e) {
      if (!res.writableEnded) res.status(500).json({ error: String(e && e.stack || e) });
    }
    return;
  }

  serveStatic(res, parsed.pathname, parsed.search);
});

server.listen(PORT, () => {
  console.log("FAMO Portail dev server → http://localhost:" + PORT);
  console.log("STAFF_CODE=" + (process.env.STAFF_CODE ? "(défini)" : "(absent — pas de code de secours : sans STAFF_CODE ni ADMIN_CODE, /api/session répond 500)") +
    "  AIRTABLE_TOKEN=" + (process.env.AIRTABLE_TOKEN ? "(défini)" : "(absent — les appels Airtable échoueront)"));
});
