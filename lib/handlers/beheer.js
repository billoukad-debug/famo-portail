"use strict";
// Beheer: klanten, catalogus, prijzen, bedrijf, codes, aanvragen, facturen, systeemcontrole.
const { HttpError, json, text } = require("../http");
const auth = require("../auth");
const repo = require("../repo");
const dom = require("../domain");
const service = require("../service");
const mail = require("../mail");
const cfg = require("../config");
const { F, UNIT_CHOICES } = cfg;

function requireAdmin(req) {
  const s = auth.teamSession(req);
  if (!s) throw new HttpError(401, "Meld u aan met de beheerderscode.");
  if (s.role !== "admin") throw new HttpError(403, "Enkel voor de beheerder.");
  return s;
}

function configView(c) {
  return {
    id: c.id, companyName: c.companyName, street: c.street, city: c.city, vat: c.vat, phone: c.phone, email: c.email,
    iban: c.iban, bic: c.bic, vatRate: c.vatRate, paymentTerms: c.paymentTerms, deliveryTerms: c.deliveryTerms, opsEmail: c.opsEmail,
    cutoff: dom.fmtCutoff(dom.parseCutoff(c.cutoff)), deliveryDays: c.deliveryDays,
    adminCodeCustom: !!c.adminHash, staffCodeCustom: !!c.staffHash
  };
}

async function overview(req) {
  const [config, clients, products, prices, requests, orders] = await Promise.all([
    repo.getConfig(), repo.listClients(), repo.listProducts({}), repo.listPrices(), repo.listRequests(),
    repo.listOrders({ sinceDate: dom.addDays(dom.todayISO(), -400) })
  ]);
  const year = dom.brusselsYear();
  const invoices = orders.filter((o) => o.invoiceNumber).map((o) => ({
    id: o.id, invoiceNumber: o.invoiceNumber, ref: o.ref, date: o.invoicedAt ? dom.todayISO(new Date(o.invoicedAt)) : o.date, clientId: o.clientId,
    clientName: (clients.find((c) => c.id === o.clientId) || {}).name || "", totalCents: o.totalCents, vat: dom.vatBreakdown(o.totalCents, config.vatRate), paid: o.paid
  })).sort((a, b) => b.invoiceNumber.localeCompare(a.invoiceNumber));
  const openCents = invoices.filter((i) => !i.paid).reduce((s, i) => s + i.vat.inclCents, 0);
  const warnings = [];
  if (!config.id) warnings.push({ key: "config", section: "bedrijf", text: "Vul de bedrijfsgegevens in: ze staan op elke leveringsbon en factuur.", action: "Bedrijfsgegevens invullen" });
  if (!config.iban) warnings.push({ key: "iban", section: "bedrijf", text: "Het rekeningnummer (IBAN) ontbreekt: klanten kunnen de factuur niet betalen.", action: "IBAN invullen" });
  if (!mail.enabled()) warnings.push({ key: "mail", section: "controle", text: "E-mail staat uit: klanten en team krijgen geen bevestigingen, leveringsbonnen of facturen per e-mail. De e-mailsleutel (Resend) moet op Vercel ingesteld worden.", action: "Systeemcontrole" });
  else if (!config.opsEmail) warnings.push({ key: "ops", section: "bedrijf", text: "Geen interne postbus ingesteld: nieuwe bestellingen en aanvragen komen " + (config.email ? "op " + config.email : "nergens") + " toe.", action: "Postbus instellen" });
  if (!products.some((p) => p.active)) warnings.push({ key: "catalogue", section: "artikelen", text: "De catalogus heeft geen actieve artikelen: klanten kunnen niets bestellen.", action: "Artikel toevoegen" });
  const noEmail = clients.filter((c) => !c.email);
  if (noEmail.length) warnings.push({ key: "clientmail", section: "klanten", text: (noEmail.length === 1 ? noEmail[0].name + " heeft" : noEmail.length + " klanten hebben") + " geen e-mailadres: geen bevestigingen of facturen per e-mail.", action: "Klanten nakijken" });
  const noPassword = clients.filter((c) => !c.hasPassword);
  if (noPassword.length) warnings.push({ key: "clientpw", section: "klanten", text: (noPassword.length === 1 ? noPassword[0].name + " kan" : noPassword.length + " klanten kunnen") + " niet aanmelden: nog geen wachtwoord.", action: "Wachtwoord geven" });
  const waiting = requests.filter((r) => r.isNew && (Date.now() - Date.parse(r.createdTime)) > 24 * 3600 * 1000);
  if (waiting.length) warnings.push({ key: "requests", section: "aanvragen", text: (waiting.length === 1 ? waiting[0].company + " wacht" : waiting.length + " aanvragers wachten") + " al meer dan een werkdag op antwoord.", action: "Aanvragen behandelen" });
  const lastOrderByClient = {};
  orders.forEach((o) => { if (!lastOrderByClient[o.clientId]) lastOrderByClient[o.clientId] = o.date; });
  return {
    config: configView(config),
    env: { mailEnabled: mail.enabled(), mailFrom: cfg.mailFrom, portalUrl: service.portalUrl(req), missing: cfg.missingEnv() },
    clients: clients.map((c) => Object.assign({}, c, { lastOrder: lastOrderByClient[c.id] || "", orderCount: orders.filter((o) => o.clientId === c.id).length })),
    products, prices, requests,
    units: UNIT_CHOICES.map((u) => ({ value: u, label: dom.unitLabel(u) })),
    invoices, stats: {
      year, invoicesThisYear: invoices.filter((i) => i.invoiceNumber.startsWith("FA-" + year)).length, openCents,
      ordersOpen: orders.filter((o) => o.statusKey !== "geleverd").length, requestsNew: requests.filter((r) => r.isNew).length,
      revenueYearCents: invoices.filter((i) => i.date.startsWith(String(year))).reduce((s, i) => s + i.totalCents, 0)
    },
    warnings
  };
}

function csvCell(v) { const s = String(v == null ? "" : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

module.exports = (router) => {
  router.get("beheer/overzicht", async ({ req, res }) => { requireAdmin(req); json(res, 200, await overview(req)); });

  router.post("beheer/klanten", async ({ req, res, body }) => {
    requireAdmin(req);
    const r = await service.saveClient({ id: body.id ? String(body.id) : "", name: body.naam, email: body.email, phone: body.telefoon, address: body.adres, vat: body.btw, number: body.klantnummer, username: body.gebruikersnaam, notes: body.notities, usual: body.vasteArtikelen, force: body.force === true });
    let sent = null;
    if (r.password && body.stuurMail === true && r.client.email) sent = await service.sendCredentials(r.client, r.password, req);
    json(res, 200, { ok: true, client: r.client, password: r.password, mail: sent, overview: await overview(req) });
  });
  router.post("beheer/klanten/:id/wachtwoord", async ({ req, res, params, body }) => {
    requireAdmin(req);
    const client = await repo.getClient(params.id).catch(() => null);
    if (!client) throw new HttpError(404, "Klant niet gevonden.");
    const password = await service.setPassword(client.id, body.wachtwoord);
    let sent = null;
    if (body.stuurMail && client.email) sent = await service.sendCredentials(client, password, req);
    json(res, 200, { ok: true, username: client.username, password, mail: sent });
  });
  router.post("beheer/klanten/:id/verwijderen", async ({ req, res, params }) => {
    requireAdmin(req);
    const client = await repo.getClient(params.id).catch(() => null);
    if (!client) throw new HttpError(404, "Klant niet gevonden.");
    const orders = await repo.listOrders({ clientId: client.id });
    if (orders.length) throw new HttpError(409, `Deze klant heeft ${orders.length} bestelling${orders.length > 1 ? "en" : ""}. Verwijder liever de toegang (wachtwoord leegmaken) in plaats van de klant.`);
    await repo.deletePriceFor(client.id, "*");
    await repo.deleteClient(client.id);
    json(res, 200, { ok: true, overview: await overview(req) });
  });

  router.post("beheer/producten", async ({ req, res, body }) => {
    requireAdmin(req);
    const name = dom.clean(body.naam, 120);
    if (!name) throw new HttpError(400, "De artikelnaam is verplicht.");
    const unit = String(body.eenheid || "").trim();
    if (!UNIT_CHOICES.includes(unit)) throw new HttpError(400, "Kies een eenheid.");
    const price = dom.toCents(body.basisprijs);
    if (price < 0 || price > 100000000) throw new HttpError(400, "Ongeldige basisprijs.");
    const fields = { [F.product.name]: name, [F.product.category]: dom.clean(body.categorie, 60) || "Algemeen", [F.product.unit]: unit, [F.product.basePrice]: dom.fromCents(price), [F.product.active]: body.actief !== false };
    const product = body.id ? await repo.updateProduct(String(body.id), fields) : await repo.createProduct(fields);
    json(res, 200, { ok: true, product, overview: await overview(req) });
  });

  router.post("beheer/prijzen/kopieer", async ({ req, res, body }) => {
    requireAdmin(req);
    const n = await service.copyPrices(String(body.van || ""), String(body.naar || ""));
    json(res, 200, { ok: true, copied: n, prices: await repo.listPrices() });
  });
  router.post("beheer/aanvragen/:id/verwijderen", async ({ req, res, params }) => {
    requireAdmin(req);
    await repo.deleteRequest(params.id);
    json(res, 200, { ok: true, overview: await overview(req) });
  });

  router.post("beheer/prijzen", async ({ req, res, body }) => {
    requireAdmin(req);
    const clientId = String(body.klantId || ""), productId = String(body.productId || "");
    if (!clientId || !productId) throw new HttpError(400, "Klant en artikel zijn verplicht.");
    if (body.prijs === null || body.prijs === "" || body.prijs === undefined) {
      await repo.deletePriceFor(clientId, productId);
    } else {
      const cents = dom.toCents(body.prijs);
      if (cents < 0 || cents > 100000000) throw new HttpError(400, "Ongeldige prijs.");
      await repo.upsertPrice(clientId, productId, cents);
    }
    json(res, 200, { ok: true, prices: await repo.listPrices() });
  });

  router.post("beheer/bedrijf", async ({ req, res, body }) => {
    requireAdmin(req);
    const config = await repo.getConfig();
    const saved = await service.saveCompany(config, body);
    json(res, 200, { ok: true, config: configView(saved) });
  });

  router.post("beheer/codes", async ({ req, res, body }) => {
    requireAdmin(req);
    const config = await repo.getConfig();
    const saved = await service.saveCode(config, String(body.rol || ""), body.code, body.reset === true);
    json(res, 200, { ok: true, config: configView(saved) });
  });

  router.post("beheer/aanvragen/:id/goedkeuren", async ({ req, res, params, body }) => {
    requireAdmin(req);
    const request = await repo.getRequest(params.id).catch(() => null);
    if (!request) throw new HttpError(404, "Aanvraag niet gevonden.");
    const r = await service.approveRequest(request, { name: body.naam, email: body.email, phone: body.telefoon, address: body.adres, vat: body.btw, username: body.gebruikersnaam, sendMail: body.stuurMail !== false, force: body.force === true }, req);
    json(res, 200, { ok: true, client: r.client, password: r.password, mail: r.mail, overview: await overview(req) });
  });
  router.post("beheer/aanvragen/:id/afhandelen", async ({ req, res, params, body }) => {
    requireAdmin(req);
    const request = await repo.getRequest(params.id).catch(() => null);
    if (!request) throw new HttpError(404, "Aanvraag niet gevonden.");
    const r = await service.closeRequest(request, dom.clean(body.notitie, 300), { sendMail: body.stuurMail === true, message: body.bericht });
    json(res, 200, { ok: true, mail: r.mail, overview: await overview(req) });
  });

  router.post("beheer/bestellingen/:id/betaald", async ({ req, res, params, body }) => {
    requireAdmin(req);
    const o = await repo.getOrder(params.id).catch(() => null);
    if (!o) throw new HttpError(404, "Bestelling niet gevonden.");
    const updated = await service.setPaid(o, body.betaald !== false);
    json(res, 200, { ok: true, paid: updated.paid });
  });

  router.get("beheer/facturen", async ({ req, res, query }) => {
    requireAdmin(req);
    const o = await overview(req);
    let list = o.invoices;
    if (query.jaar) list = list.filter((i) => i.date.startsWith(String(query.jaar)));
    if (query.maand) list = list.filter((i) => i.date.slice(5, 7) === String(query.maand).padStart(2, "0"));
    if (query.formaat === "csv") {
      const clients = o.clients;
      const head = ["Factuurnummer", "Factuurdatum", "Klant", "Klantnummer", "Btw-nummer klant", "Referentie", "Excl. btw", "Btw %", "Btw", "Incl. btw", "Betaald"].join(";");
      const rows = list.map((i) => {
        const c = clients.find((x) => x.id === i.clientId) || {};
        return [i.invoiceNumber, dom.fmtDateShort(i.date), c.name || i.clientName, c.number || "", c.vat || "", i.ref, dom.fmtNumber(dom.fromCents(i.vat.exclCents), 2), i.vat.ratePct, dom.fmtNumber(dom.fromCents(i.vat.vatCents), 2), dom.fmtNumber(dom.fromCents(i.vat.inclCents), 2), i.paid ? "ja" : "nee"].map(csvCell).join(";");
      });
      res.setHeader("Content-Disposition", `attachment; filename="facturen-${query.jaar || o.stats.year}${query.maand ? "-" + String(query.maand).padStart(2, "0") : ""}.csv"`);
      return text(res, 200, "﻿" + [head].concat(rows).join("\r\n"), "text/csv; charset=utf-8");
    }
    json(res, 200, { invoices: list });
  });

  router.post("beheer/systeemcontrole", async ({ req, res }) => {
    requireAdmin(req);
    json(res, 200, await service.systemCheck(req));
  });
};
