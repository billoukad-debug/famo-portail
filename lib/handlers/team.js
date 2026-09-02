"use strict";
// Team: magazijn (klaarzetten), vertrek, levering, telefonische bestellingen.
const { HttpError, json } = require("../http");
const auth = require("../auth");
const repo = require("../repo");
const dom = require("../domain");
const service = require("../service");
const mail = require("../mail");

function requireTeam(req) {
  const s = auth.teamSession(req);
  if (!s) throw new HttpError(401, "Meld u aan met de teamcode.");
  return s;
}

function clientBrief(c) {
  return c ? { id: c.id, name: c.name, address: c.address, phone: c.phone, email: c.email, number: c.number, vat: c.vat, notes: c.notes, usual: c.usual } : null;
}

function orderView(o, clientsById, req) {
  const c = clientsById ? clientsById[o.clientId] : null;
  const notes = dom.splitNotes(o.notes);
  const source = notes.source || "Klantportaal";
  return {
    id: o.id, ref: o.ref, date: o.date, deliveryDate: o.deliveryDate, deliveryLabel: dom.relativeDayLabel(o.deliveryDate),
    status: o.statusKey, statusLabel: o.statusLabel, statusIndex: dom.statusIndex(o.status), locked: dom.isLocked(o.status),
    paid: o.paid, paymentLabel: dom.paymentLabel(o.payment), totalCents: o.totalCents,
    lines: o.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, unitLabel: dom.unitLabel(l.unit), unitPlural: dom.unitPlural(l.unit, l.qty), priceCents: l.priceCents, comment: l.comment, decimals: dom.allowsDecimals(l.unit), unparsed: !!l.unparsed })),
    notes: notes.customer, internalNotes: notes.internal, source,
    invoiceNumber: o.invoiceNumber, prepValidated: o.prepValidated, preparedAt: o.preparedAt, deliveredAt: o.deliveredAt, invoicedAt: o.invoicedAt,
    receivedBy: o.receivedBy, proof: o.proof, prepPhoto: o.prepPhoto, createdTime: o.createdTime,
    client: clientBrief(c), clientId: o.clientId,
    docs: {
      deliveryNote: `/doc/leveringsbon/${encodeURIComponent(o.id)}`,
      invoice: `/doc/factuur/${encodeURIComponent(o.id)}`,
      deliveryNoteShare: service.docLinks(o, req).deliveryNote
    }
  };
}

async function clientsMap() {
  const list = await repo.listClients();
  const map = {};
  list.forEach((c) => { map[c.id] = c; });
  return { list, map };
}

module.exports = (router) => {
  router.post("team/login", async ({ req, res, body }) => {
    const key = "team-login:" + auth.clientIp(req);
    if (auth.rateLimited(key, 8, 5 * 60 * 1000)) throw new HttpError(429, "Te veel pogingen. Wacht vijf minuten.");
    const config = await repo.getConfig();
    const role = auth.roleForCode(String(body.code || ""), { adminHash: config.adminHash, staffHash: config.staffHash });
    if (!role) throw new HttpError(401, "Die code klopt niet.");
    auth.rateReset(key);
    auth.setTeamSession(res, role);
    json(res, 200, { ok: true, role });
  });
  router.post("team/logout", async ({ res }) => { auth.clearTeamSession(res); json(res, 200, { ok: true }); });
  router.get("team/sessie", async ({ req, res }) => {
    const s = auth.teamSession(req);
    if (!s) throw new HttpError(401, "Geen sessie.");
    json(res, 200, { role: s.role, exp: s.exp });
  });

  // Overzicht: alles wat open staat + wat de laatste 14 dagen gebeurde.
  router.get("team/overzicht", async ({ req, res }) => {
    requireTeam(req);
    const today = dom.todayISO();
    const [{ map }, orders, config] = await Promise.all([
      clientsMap(),
      repo.listOrders({ openOnly: true, sinceDate: dom.addDays(today, -14), openOrSince: true }),
      repo.getConfig()
    ]);
    json(res, 200, {
      today, now: dom.nowISO(),
      role: auth.teamSession(req).role,
      company: repo.publicConfig(config),
      mailEnabled: mail.enabled(),
      orders: orders.map((o) => orderView(o, map, req))
    });
  });

  router.get("team/bestellingen", async ({ req, res, query }) => {
    requireTeam(req);
    const since = dom.isISODate(query.van) ? query.van : dom.addDays(dom.todayISO(), -120);
    const [{ map }, orders] = await Promise.all([clientsMap(), repo.listOrders({ sinceDate: since })]);
    const q = String(query.q || "").trim().toLowerCase();
    const list = orders.filter((o) => {
      if (query.tot && dom.isISODate(query.tot) && o.date > query.tot) return false;
      if (!q) return true;
      const c = map[o.clientId];
      return o.ref.toLowerCase().includes(q) || (c && c.name.toLowerCase().includes(q)) || o.invoiceNumber.toLowerCase().includes(q) || o.linesText.toLowerCase().includes(q);
    });
    json(res, 200, { orders: list.slice(0, 300).map((o) => orderView(o, map, req)) });
  });

  router.get("team/bestellingen/:id", async ({ req, res, params }) => {
    requireTeam(req);
    const o = await repo.getOrder(params.id).catch(() => null);
    if (!o) throw new HttpError(404, "Bestelling niet gevonden.");
    const c = o.clientId ? await repo.getClient(o.clientId).catch(() => null) : null;
    // Namen van vorige ontvangers bij deze klant: sneller invullen aan de deur.
    let receivers = [];
    if (o.clientId) { const past = await repo.listOrders({ sinceDate: dom.addDays(dom.todayISO(), -365), clientId: o.clientId }).catch(() => []); receivers = Array.from(new Set(past.map((x) => x.receivedBy).filter(Boolean))).slice(0, 6); }
    json(res, 200, { order: orderView(o, c ? { [c.id]: c } : {}, req), receivers });
  });

  const withOrder = (fn) => async (ctx) => {
    requireTeam(ctx.req);
    const o = await repo.getOrder(ctx.params.id).catch(() => null);
    if (!o) throw new HttpError(404, "Bestelling niet gevonden.");
    return fn(ctx, o);
  };
  const reply = async (res, o, extra, req) => {
    const c = o.clientId ? await repo.getClient(o.clientId).catch(() => null) : null;
    json(res, 200, Object.assign({ ok: true, order: orderView(o, c ? { [c.id]: c } : {}, req) }, extra || {}));
  };

  router.post("team/bestellingen/:id/lijnen", withOrder(async ({ req, res, body }, o) => {
    const updated = await service.updateLines(o, Array.isArray(body.lijnen) ? body.lijnen : []);
    await reply(res, updated, null, req);
  }));
  router.post("team/bestellingen/:id/klaar", withOrder(async ({ req, res, body }, o) => {
    const r = await service.markReady(o, { photo: body.foto });
    await reply(res, r.order, { warnings: r.warnings }, req);
  }));
  router.post("team/bestellingen/:id/onderweg", withOrder(async ({ req, res }, o) => {
    const r = await service.markShipped(o, req);
    await reply(res, r.order, { mail: r.mail }, req);
  }));
  router.post("team/bestellingen/:id/geleverd", withOrder(async ({ req, res, body }, o) => {
    const r = await service.markDelivered(o, { receivedBy: body.ontvanger, signature: body.handtekening }, req);
    let order = r.order;
    if (body.betaald === true) order = await service.setPaid(order, true);
    await reply(res, order, { mail: r.mail, warnings: r.warnings, invoiceNumber: r.invoiceNumber }, req);
  }));
  // Vertrek van de ronde: alles wat klaarstaat voor die dag (en eerder) in één keer onderweg.
  router.post("team/onderweg-alles", async ({ req, res, body }) => {
    requireTeam(req);
    const day = dom.isISODate(body.dag) ? body.dag : dom.todayISO();
    const orders = (await repo.listOrders({ openOnly: true })).filter((o) => o.statusKey === "klaar" && o.deliveryDate <= day);
    const r = await service.shipAll(orders, req);
    json(res, 200, Object.assign({ ok: true, day }, r));
  });
  router.post("team/bestellingen/:id/betaald", withOrder(async ({ req, res, body }, o) => {
    await reply(res, await service.setPaid(o, body.betaald !== false), null, req);
  }));
  router.post("team/bestellingen/:id/terug", withOrder(async ({ req, res }, o) => {
    await reply(res, await service.stepBack(o), null, req);
  }));
  router.post("team/bestellingen/:id/notitie", withOrder(async ({ req, res, body }, o) => {
    await reply(res, await service.setCustomerNote(o, body.notities), null, req);
  }));
  router.post("team/bestellingen/:id/interne-notitie", withOrder(async ({ req, res, body }, o) => {
    await reply(res, await service.setInternalNote(o, body.tekst, { replace: body.vervang === true }), null, req);
  }));
  router.post("team/bestellingen/:id/leverdatum", withOrder(async ({ req, res, body }, o) => {
    await reply(res, await service.setDeliveryDate(o, String(body.datum || ""), { staff: true }), null, req);
  }));
  router.post("team/bestellingen/:id/ontvanger", withOrder(async ({ req, res, body }, o) => {
    await reply(res, await service.setReceiver(o, body.ontvanger), null, req);
  }));
  router.post("team/bestellingen/:id/foto-levering", withOrder(async ({ req, res, body }, o) => {
    await reply(res, await service.addDeliveryPhoto(o, body.foto), null, req);
  }));
  // Niet kunnen leveren (niemand aanwezig, gesloten): terug naar Klaar met een interne reden.
  router.post("team/bestellingen/:id/niet-geleverd", withOrder(async ({ req, res, body }, o) => {
    if (o.status !== require("../config").STATUS.SHIPPED) throw new HttpError(409, "Enkel een bestelling die onderweg is, kan als niet geleverd worden gemeld.");
    const back = await service.stepBack(o);
    const noted = await service.setInternalNote(back, "Niet geleverd " + dom.fmtDateTimeNl(dom.nowISO()) + (body.reden ? ": " + dom.clean(body.reden, 200) : ""));
    await reply(res, noted, null, req);
  }));
  router.post("team/bestellingen/:id/mail", withOrder(async ({ req, res, body }, o) => {
    const r = await service.resendOrderMail(o, String(body.type || ""), req);
    json(res, 200, { ok: true, mail: r });
  }));
  router.post("team/bestellingen/:id/verwijderen", withOrder(async ({ res }, o) => {
    await service.deleteOrder(o);
    json(res, 200, { ok: true });
  }));

  // Telefonische bestelling namens een klant.
  router.get("team/klanten", async ({ req, res }) => {
    requireTeam(req);
    const { list } = await clientsMap();
    json(res, 200, { clients: list.map(clientBrief) });
  });
  router.get("team/klanten/:id/catalogus", async ({ req, res, params }) => {
    requireTeam(req);
    const client = await repo.getClient(params.id).catch(() => null);
    if (!client) throw new HttpError(404, "Klant niet gevonden.");
    const [catalogue, orders, config] = await Promise.all([service.catalogueFor(client.id), repo.listOrders({ sinceDate: dom.addDays(dom.todayISO(), -180), clientId: client.id }), repo.getConfig()]);
    const today = dom.todayISO();
    const dates = [today].concat(dom.nextDeliveryDates({ cutoff: "23:59", deliveryDays: config.deliveryDays, count: 8 }));
    json(res, 200, {
      client: clientBrief(client), catalogue, suggestions: service.suggestionsFrom(orders, catalogue),
      deliveryDates: Array.from(new Set(dates)).map((iso) => ({ iso, label: dom.fmtDateNl(iso, { short: true, noYear: true }), relative: dom.relativeDayLabel(iso) }))
    });
  });
  router.post("team/bestellingen", async ({ req, res, body }) => {
    requireTeam(req);
    const client = await repo.getClient(String(body.klantId || "")).catch(() => null);
    if (!client) throw new HttpError(400, "Kies een klant.");
    const items = Array.isArray(body.items) ? body.items.map((i) => ({ productId: i.productId, qty: i.qty, comment: i.comment })) : [];
    const r = await service.placeOrder({ client, items, deliveryDate: body.leverdatum, notes: body.opmerking, source: dom.clean(body.bron, 30) || "Telefoon", req, staff: true });
    json(res, 200, { ok: true, order: orderView(r.order, { [client.id]: client }, req), mail: r.mail });
  });
};
