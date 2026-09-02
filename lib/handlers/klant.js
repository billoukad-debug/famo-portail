"use strict";
// Klantportaal: inloggen, catalogus met eigen prijzen, bestellen, bestellingen volgen.
const { HttpError, json } = require("../http");
const auth = require("../auth");
const repo = require("../repo");
const dom = require("../domain");
const service = require("../service");
const { F } = require("../config");

function requireClient(req) {
  const s = auth.clientSession(req);
  if (!s) throw new HttpError(401, "Meld u aan om verder te gaan.");
  return s;
}

function orderView(o, req) {
  const links = service.docLinks(o, req);
  return {
    id: o.id, ref: o.ref, date: o.date, deliveryDate: o.deliveryDate, deliveryLabel: dom.relativeDayLabel(o.deliveryDate),
    status: o.statusKey, statusLabel: o.statusLabel, paid: o.paid, paymentLabel: dom.paymentLabel(o.payment),
    totalCents: o.totalCents, lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, unitLabel: dom.unitPlural(l.unit, l.qty), priceCents: l.priceCents, comment: l.comment })),
    notes: o.notes.replace(/^\[[^\]]+\]\s*/, ""), invoiceNumber: o.invoiceNumber, preparedAt: o.preparedAt, deliveredAt: o.deliveredAt, receivedBy: o.receivedBy,
    docs: { deliveryNote: o.statusKey === "onderweg" || o.statusKey === "geleverd" ? links.deliveryNote : "", invoice: links.invoice }
  };
}

async function profilePayload(clientId, req) {
  const [client, config] = await Promise.all([repo.getClient(clientId), repo.getConfig()]);
  const [catalogue, orders] = await Promise.all([service.catalogueFor(clientId), repo.listOrders({ sinceDate: dom.addDays(dom.todayISO(), -180), clientId })]);
  const cutoff = dom.parseCutoff(config.cutoff);
  return {
    client: { id: client.id, name: client.name, email: client.email, phone: client.phone, address: client.address, username: client.username, number: client.number, vat: client.vat },
    company: repo.publicConfig(config),
    cutoff: dom.fmtCutoff(cutoff),
    deliveryDates: dom.nextDeliveryDates({ cutoff: config.cutoff, deliveryDays: config.deliveryDays, count: 10 }).map((iso) => ({ iso, label: dom.fmtDateNl(iso, { short: true, noYear: true }), relative: dom.relativeDayLabel(iso) })),
    catalogue,
    suggestions: service.suggestionsFrom(orders, catalogue),
    recentOrders: orders.slice(0, 20).map((o) => orderView(o, req)),
    mailEnabled: require("../mail").enabled()
  };
}

module.exports = (router) => {
  router.post("klant/login", async ({ req, res, body }) => {
    const login = String(body.login || "").trim().toLowerCase();
    const pw = String(body.wachtwoord || "");
    const key = "klant-login:" + auth.clientIp(req) + ":" + login;
    if (auth.rateLimited(key, 8, 10 * 60 * 1000)) throw new HttpError(429, "Te veel pogingen. Wacht tien minuten en probeer opnieuw.");
    if (!login || !pw) throw new HttpError(400, "Vul uw gebruikersnaam en wachtwoord in.");
    const hit = await repo.findClientForLogin(login);
    if (!hit || !auth.passwordMatches(hit.storedPassword, pw)) throw new HttpError(401, "Gebruikersnaam of wachtwoord klopt niet.");
    auth.rateReset(key);
    auth.setClientSession(res, hit.client.id);
    json(res, 200, await profilePayload(hit.client.id, req));
  });

  router.post("klant/logout", async ({ res }) => { auth.clearClientSession(res); json(res, 200, { ok: true }); });

  router.get("klant/mij", async ({ req, res }) => {
    const s = requireClient(req);
    json(res, 200, await profilePayload(s.clientId, req));
  });

  router.post("klant/bestellen", async ({ req, res, body }) => {
    const s = requireClient(req);
    if (auth.rateLimited("klant-bestel:" + s.clientId, 30, 3600 * 1000)) throw new HttpError(429, "Te veel bestellingen in korte tijd. Bel ons even.");
    const client = await repo.getClient(s.clientId);
    const items = Array.isArray(body.items) ? body.items.map((i) => ({ productId: i.productId, qty: i.qty, comment: i.comment })) : [];
    const r = await service.placeOrder({ client, items, deliveryDate: body.leverdatum, notes: body.opmerking, source: "Klantportaal", req });
    json(res, 200, { ok: true, order: orderView(r.order, req), mail: r.mail });
  });

  router.get("klant/bestellingen", async ({ req, res }) => {
    const s = requireClient(req);
    const orders = await repo.listOrders({ sinceDate: dom.addDays(dom.todayISO(), -400), clientId: s.clientId });
    json(res, 200, { orders: orders.map((o) => orderView(o, req)) });
  });

  router.get("klant/bestellingen/:id", async ({ req, res, params }) => {
    const s = requireClient(req);
    const o = await repo.getOrder(params.id).catch(() => null);
    if (!o || o.clientId !== s.clientId) throw new HttpError(404, "Bestelling niet gevonden.");
    json(res, 200, { order: orderView(o, req) });
  });

  router.post("klant/wachtwoord", async ({ req, res, body }) => {
    const s = requireClient(req);
    const client = await repo.getClient(s.clientId);
    const hit = await repo.findClientForLogin(client.username || client.email);
    if (!hit || !auth.passwordMatches(hit.storedPassword, String(body.huidig || ""))) throw new HttpError(401, "Uw huidige wachtwoord klopt niet.");
    await service.setPassword(s.clientId, String(body.nieuw || ""));
    json(res, 200, { ok: true });
  });

  router.post("klant/profiel", async ({ req, res, body }) => {
    const s = requireClient(req);
    const fields = {};
    const email = dom.normalizeEmail(body.email);
    if (email && !dom.isEmail(email)) throw new HttpError(400, "Het e-mailadres is ongeldig.");
    fields[F.client.email] = email;
    fields[F.client.phone] = dom.clean(body.phone, 40);
    await repo.updateClient(s.clientId, fields);
    json(res, 200, { ok: true });
  });
};
