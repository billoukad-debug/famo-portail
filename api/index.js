"use strict";
// Eén serverless functie voor de hele API. vercel.json herschrijft /api/<pad> en
// /doc/<pad> naar /api/index?path=<pad>; de router in lib/http.js verdeelt verder.
const { createRouter, guard, json, html, pathSegments } = require("../lib/http");
const cfg = require("../lib/config");
const auth = require("../lib/auth");

const router = createRouter();
require("../lib/handlers/publiek")(router);
require("../lib/handlers/klant")(router);
require("../lib/handlers/team")(router);
require("../lib/handlers/beheer")(router);
require("../lib/handlers/doc")(router);

function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function docErrorPage(status, message) {
  const title = status === 401 || status === 403 ? "Geen toegang tot dit document" : status === 404 ? "Document niet gevonden" : "Dit document kan nu niet worden geopend";
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/ui.css"></head><body><main class="main"><div class="login-wrap"><div class="card center"><div style="font-size:3rem">📄</div><h1>${esc(title)}</h1><p class="muted">${esc(message)}</p><div class="stack" style="margin-top:14px"><a class="btn btn-accent" href="/">Aanmelden als klant</a><a class="btn btn-outline" href="/team">Teamportaal</a></div></div></div></main></body></html>`;
}

module.exports = (req, res) => guard(async (req, res) => {
  const segs = pathSegments(req);
  if (!cfg.isConfigured() && segs[0] !== "status") {
    return json(res, 503, { error: "Het portaal is nog niet geconfigureerd. Ontbrekende omgevingsvariabelen: " + cfg.missingEnv().join(", ") + ".", notConfigured: true, missing: cfg.missingEnv() });
  }
  auth.renewSessions(req, res);
  if (segs[0] === "doc") {
    try { await router.dispatch(req, res); }
    catch (e) {
      const status = Number(e && e.status) || 500;
      const known = e && (e.name === "HttpError" || e.name === "DomainError");
      if (!known) console.error("[doc]", (e && e.stack) || e);
      if (!res.headersSent) html(res, status, docErrorPage(status, known ? e.message : "Probeer het later opnieuw."));
    }
    return;
  }
  await router.dispatch(req, res);
}, req, res);
