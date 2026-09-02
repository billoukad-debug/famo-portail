"use strict";
// HTTP-hulpjes en een kleine router voor de ene serverless functie.
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message || "Fout");
    this.name = "HttpError";
    this.status = status || 500;
    this.extra = extra || null;
  }
}

const MUTATION_HEADER = "x-requested-with";
const MUTATION_VALUE = "famo-kade";

function getUrl(req) {
  return new URL(req.url || "/", "http://local");
}

function pathSegments(req) {
  // Vercel: de rewrite in vercel.json levert ?path=<pad> (string); lokaal een array.
  const q = req.query || {};
  let p = q.path;
  if (Array.isArray(p)) return p.filter(Boolean);
  if (typeof p === "string" && p) return p.split("/").filter(Boolean);
  // Fallback (lokale server): pad uit de URL, zonder /api/
  const segs = getUrl(req).pathname.split("/").filter(Boolean);
  if (segs[0] === "api") segs.shift();
  return segs;
}

function query(req) {
  const out = {};
  getUrl(req).searchParams.forEach((v, k) => { if (k !== "path") out[k] = v; });
  return out;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") { try { return req.body ? JSON.parse(req.body) : {}; } catch (_) { throw new HttpError(400, "Ongeldige JSON."); } }
    if (Buffer.isBuffer(req.body)) { try { return req.body.length ? JSON.parse(req.body.toString("utf8")) : {}; } catch (_) { throw new HttpError(400, "Ongeldige JSON."); } }
    return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { throw new HttpError(400, "Ongeldige JSON."); }
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
function html(res, status, body, extraHeaders) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  Object.entries(extraHeaders || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end(body);
}
function text(res, status, body, contentType) {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType || "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

/** Mutaties vereisen een eigen header: een gewoon formulier of link kan die niet zetten (CSRF). */
function requireMutationHeader(req) {
  const v = String((req.headers && req.headers[MUTATION_HEADER]) || "");
  if (v !== MUTATION_VALUE) throw new HttpError(403, "Verzoek geweigerd (ontbrekende beveiligingsheader).");
}

// ---- Router ---------------------------------------------------------------------
function compile(pattern) {
  const parts = pattern.split("/").filter(Boolean);
  return { parts, match(segs) {
    if (parts.length !== segs.length) return null;
    const params = {};
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (parts[i] !== segs[i]) return null;
    }
    return params;
  } };
}

function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, re: compile(pattern), handler });
  return {
    get: (p, h) => add("GET", p, h),
    post: (p, h) => add("POST", p, h),
    async dispatch(req, res) {
      const segs = pathSegments(req);
      const method = String(req.method || "GET").toUpperCase();
      let pathMatched = false;
      for (const r of routes) {
        const params = r.re.match(segs);
        if (!params) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const ctx = { req, res, params, query: query(req), body: null };
        if (method === "POST") { requireMutationHeader(req); ctx.body = await readBody(req); }
        return r.handler(ctx);
      }
      throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "Methode niet toegestaan." : "Niet gevonden.");
    }
  };
}

/** Vangt alles op en antwoordt altijd netjes in JSON (of HTML voor documenten). */
async function guard(fn, req, res) {
  try {
    await fn(req, res);
  } catch (e) {
    const status = Number(e && e.status) || 500;
    const isAirtable = e && e.name === "AirtableError";
    const known = e && (e.name === "HttpError" || e.name === "DomainError");
    let message = known ? e.message : "Er liep iets mis. Probeer het opnieuw of bel ons.";
    let code = status;
    if (isAirtable) { message = e.status === 429 ? "De database is even overbelast. Wacht een halve minuut en probeer opnieuw." : "De verbinding met de database is tijdelijk niet beschikbaar. Probeer het opnieuw."; code = 503; }
    if (!known || status >= 500) console.error("[api]", (e && e.stack) || e);
    if (res.headersSent) return;
    json(res, code, Object.assign({ error: message }, (e && e.extra) || {}));
  }
}

module.exports = { HttpError, MUTATION_HEADER, MUTATION_VALUE, pathSegments, query, readBody, json, html, text, requireMutationHeader, createRouter, guard, getUrl };
