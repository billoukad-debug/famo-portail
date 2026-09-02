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
/** Zwaardere controle (één extra lezing): sluit sessies af waarvan het wachtwoord intussen gewijzigd is. */
async function requireClientVerified(req) {
  const s = requireClient(req);
  const pv = await repo.getClientPasswordVersion(s.clientId).catch(() => null);
  if (pv === null) throw new HttpError(401, "Meld u opnieuw aan.");
  if (pv !== s.passwordVersion) throw new HttpError(401, "Uw wachtwoord is gewijzigd. Meld u opnieuw aan.");
  return s;
}

function orderView(o, req, vatRate) {
  const links = service.docLinks(o, req);
  const vat = o.statusKey === "geleverd" ? dom.vatBreakdown(o.totalCents, vatRate) : null;
  return {
    vat,
    id: o.id, ref: o.ref, date: o.date, deliveryDate: o.deliveryDate, deliveryLabel: dom.relativeDayLabel(o.deliveryDate),
    status: o.statusKey, statusLabel: o.statusLabel, paid: o.paid, paymentLabel: dom.paymentLabel(o.payment),
    totalCents: o.totalCents, lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, unitLabel: dom.unitPlural(l.unit, l.qty), priceCents: l.priceCents, comment: l.comment })),
    notes: dom.splitNotes(o.notes).customer, invoiceNumber: o.invoiceNumber, preparedAt: o.preparedAt, deliveredAt: o.deliveredAt, receivedBy: o.receivedBy,
    cancelable: o.statusKey === "ontvangen",
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
    recentOrders: orders.slice(0, 20).map((o) => orderView(o, req, config.vatRate)),
    mailEnabled: require("../mail").enabled()
  };
}

module.exports = (router) => {
  router.post("klant/login", async ({ req, res, body }) => {
    const login = String(body.login || "").trim().toLowerCase();
    const pw = String(body.wachtwoord || "");
    if (!login || !pw) throw new HttpError(400, "Vul uw gebruikersnaam en wachtwoord in.");
    const keyIp = "klant-login-ip:" + auth.clientIp(req), keyUser = "klant-login-user:" + login;
    if (auth.rateLimited(keyIp, 30, 10 * 60 * 1000) || auth.rateLimited(keyUser, 8, 10 * 60 * 1000)) throw new HttpError(429, "Te veel pogingen. Wacht tien minuten en probeer opnieuw.");
    const hit = await repo.findClientForLogin(login);
    if (!hit || !auth.passwordMatches(hit.storedPassword, pw)) throw new HttpError(401, "Gebruikersnaam of wachtwoord klopt niet.");
    auth.rateReset(keyUser);
    auth.setClientSession(res, hit.client.id, hit.passwordVersion);
    json(res, 200, await profilePayload(hit.client.id, req));
  });

  router.post("klant/logout", async ({ res }) => { auth.clearClientSession(res); json(res, 200, { ok: true }); });

  router.post("klant/wachtwoord-vergeten", async ({ req, res, body }) => {
    const login = String(body.login || "").trim().toLowerCase();
    if (!login) throw new HttpError(400, "Vul uw gebruikersnaam of e-mailadres in.");
    if (auth.rateLimited("reset:" + auth.clientIp(req), 5, 15 * 60 * 1000) || auth.rateLimited("reset-user:" + login, 3, 15 * 60 * 1000)) throw new HttpError(429, "Te veel aanvragen. Probeer over een kwartier opnieuw of bel ons.");
    const r = await service.requestPasswordReset(login, req);
    // Nooit verklappen of een account bestaat.
    json(res, 200, { ok: true, hint: "Als dit account een e-mailadres heeft, ontvangt u binnen enkele minuten een link.", mailEnabled: require("../mail").enabled(), delivered: r.sent });
  });
  router.post("klant/wachtwoord-reset", async ({ req, res, body }) => {
    const r = await service.resetPasswordWithToken(body.token, String(body.nieuw || ""));
    auth.setClientSession(res, r.clientId, r.passwordVersion);
    json(res, 200, await profilePayload(r.clientId, req));
  });

  router.get("klant/mij", async ({ req, res }) => {
    const s = await requireClientVerified(req);
    json(res, 200, await profilePayload(s.clientId, req));
  });

  router.post("klant/bestellen", async ({ req, res, body }) => {
    const s = await requireClientVerified(req);
    if (auth.rateLimited("klant-bestel:" + s.clientId, 30, 3600 * 1000)) throw new HttpError(429, "Te veel bestellingen in korte tijd. Bel ons even.");
    const client = await repo.getClient(s.clientId);
    const items = Array.isArray(body.items) ? body.items.map((i) => ({ productId: i.productId, qty: i.qty, comment: i.comment })) : [];
    const r = await service.placeOrder({ client, items, deliveryDate: body.leverdatum, notes: body.opmerking, source: "Klantportaal", req });
    json(res, 200, { ok: true, order: orderView(r.order, req), mail: r.mail });
  });

  router.get("klant/bestellingen", async ({ req, res }) => {
    const s = requireClient(req);
    const [orders, config] = await Promise.all([repo.listOrders({ sinceDate: dom.addDays(dom.todayISO(), -400), clientId: s.clientId }), repo.getConfig()]);
    json(res, 200, { orders: orders.map((o) => orderView(o, req, config.vatRate)) });
  });

  router.get("klant/bestellingen/:id", async ({ req, res, params }) => {
    const s = requireClient(req);
    const o = await repo.getOrder(params.id).catch(() => null);
    if (!o || o.clientId !== s.clientId) throw new HttpError(404, "Bestelling niet gevonden.");
    const config = await repo.getConfig();
    json(res, 200, { order: orderView(o, req, config.vatRate) });
  });

  router.post("klant/bestellingen/:id/annuleren", async ({ req, res, params, body }) => {
    const s = await requireClientVerified(req);
    const o = await repo.getOrder(params.id).catch(() => null);
    if (!o || o.clientId !== s.clientId) throw new HttpError(404, "Bestelling niet gevonden.");
    const client = await repo.getClient(s.clientId);
    const r = await service.cancelOrderByClient(o, client, body.reden, req);
    json(res, 200, r);
  });

  router.post("klant/wachtwoord", async ({ req, res, body }) => {
    const s = requireClient(req);
    const client = await repo.getClient(s.clientId);
    const hit = await repo.findClientForLogin(client.username || client.email);
    if (!hit || !auth.passwordMatches(hit.storedPassword, String(body.huidig || ""))) throw new HttpError(401, "Uw huidige wachtwoord klopt niet.");
    await service.setPassword(s.clientId, String(body.nieuw || ""));
    // Nieuwe sessie met de nieuwe wachtwoordversie, anders sluit de volgende lading de klant uit.
    const fresh = await repo.getClientPasswordVersion(s.clientId);
    auth.setClientSession(res, s.clientId, fresh);
    json(res, 200, { ok: true });
  });

  router.post("klant/profiel", async ({ req, res, body }) => {
    const s = requireClient(req);
    const fields = {};
    if (body.email !== undefined) {
      const email = dom.normalizeEmail(body.email);
      if (email && !dom.isEmail(email)) throw new HttpError(400, "Het e-mailadres is ongeldig.");
      fields[F.client.email] = email;
    }
    if (body.phone !== undefined) fields[F.client.phone] = dom.clean(body.phone, 40);
    if (!Object.keys(fields).length) throw new HttpError(400, "Niets om op te slaan.");
    await repo.updateClient(s.clientId, fields);
    json(res, 200, { ok: true });
  });
};
