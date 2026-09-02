"use strict";
// Publiek: toegangsaanvraag en status van het portaal.
const { HttpError, json } = require("../http");
const auth = require("../auth");
const repo = require("../repo");
const dom = require("../domain");
const service = require("../service");
const mail = require("../mail");
const cfg = require("../config");

module.exports = (router) => {
  router.get("status", async ({ res }) => {
    const missing = cfg.missingEnv();
    let airtable = "onbekend";
    if (!missing.includes("AIRTABLE_TOKEN")) {
      try { await repo.getConfig(); airtable = "ok"; } catch (e) { airtable = "fout: " + String(e.message || e).slice(0, 120); }
    }
    json(res, 200, { configured: cfg.isConfigured(), missing, optionalMissing: cfg.OPTIONAL_ENV.filter((k) => !cfg.env(k)), mail: mail.enabled(), airtable, version: "1.0.0" });
  });

  router.get("publiek/config", async ({ res }) => {
    if (!cfg.isConfigured()) return json(res, 200, { configured: false, company: { companyName: cfg.DEFAULTS.companyName } });
    const c = await repo.getConfig();
    json(res, 200, { configured: true, mailEnabled: mail.enabled(), company: repo.publicConfig(c), cutoff: dom.fmtCutoff(dom.parseCutoff(c.cutoff)), deliveryDays: Array.from(dom.parseDeliveryDays(c.deliveryDays)).map((d) => dom.DAY_LONG[d]) });
  });

  router.post("publiek/aanvraag", async ({ req, res, body }) => {
    const ip = auth.clientIp(req);
    if (auth.rateLimited("aanvraag:" + ip, 5, 3600 * 1000)) throw new HttpError(429, "Te veel aanvragen vanaf dit toestel. Probeer later opnieuw of bel ons.");
    // Honingpot: een echt formulier laat dit veld leeg.
    if (String(body.website || "").trim()) return json(res, 200, { ok: true });
    const r = await service.submitRequest({ company: body.bedrijfsnaam, contact: body.contactpersoon, email: body.email, phone: body.telefoon, address: body.adres, notes: body.bericht, vat: body.btw }, req);
    json(res, 200, { ok: true, id: r.request.id });
  });
};
