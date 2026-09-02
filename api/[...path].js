"use strict";
// Eén serverless functie voor de hele API: /api/<pad>. De router in lib/http.js
// verdeelt naar de handlers. Documenten (/doc/…) komen hier via een rewrite.
const { createRouter, guard, json, pathSegments } = require("../lib/http");
const cfg = require("../lib/config");

const router = createRouter();
require("../lib/handlers/publiek")(router);
require("../lib/handlers/klant")(router);
require("../lib/handlers/team")(router);
require("../lib/handlers/beheer")(router);
require("../lib/handlers/doc")(router);

module.exports = (req, res) => guard(async (req, res) => {
  const segs = pathSegments(req);
  if (!cfg.isConfigured() && segs[0] !== "status") {
    return json(res, 503, { error: "Het portaal is nog niet geconfigureerd. Ontbrekende omgevingsvariabelen: " + cfg.missingEnv().join(", ") + ".", notConfigured: true, missing: cfg.missingEnv() });
  }
  await router.dispatch(req, res);
}, req, res);
