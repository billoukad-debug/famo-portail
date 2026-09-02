"use strict";
// Documenten: leveringsbon, factuur, picklijst. Toegang via teamsessie, via de
// klantsessie (eigen bestellingen) of via een ondertekende link uit een e-mail.
const { HttpError, html } = require("../http");
const auth = require("../auth");
const repo = require("../repo");
const dom = require("../domain");
const docs = require("../docs");

function accessOrder(req, query, kind, order) {
  if (auth.teamSession(req)) return "team";
  const c = auth.clientSession(req);
  if (c && c.clientId === order.clientId) return "klant";
  if (query.t && auth.verifyDocToken(String(query.t), kind, order.id)) return "link";
  throw new HttpError(403, "Geen toegang tot dit document. Meld u aan of gebruik de link uit uw e-mail.");
}

module.exports = (router) => {
  router.get("doc/leveringsbon/:id", async ({ req, res, params, query }) => {
    const order = await repo.getOrder(params.id).catch(() => null);
    if (!order) throw new HttpError(404, "Document niet gevonden.");
    const who = accessOrder(req, query, "leveringsbon", order);
    const [client, company] = await Promise.all([repo.getClient(order.clientId).catch(() => ({ name: "—" })), repo.getConfig()]);
    html(res, 200, docs.renderDeliveryNote({ order, client, company, backHref: who === "team" ? "/team?bestelling=" + encodeURIComponent(order.id) : (who === "klant" ? "/?ga=bestellingen" : "") }));
  });

  router.get("doc/factuur/:id", async ({ req, res, params, query }) => {
    const order = await repo.getOrder(params.id).catch(() => null);
    if (!order) throw new HttpError(404, "Document niet gevonden.");
    const who = accessOrder(req, query, "factuur", order);
    if (!order.invoiceNumber && who !== "team") throw new HttpError(404, "Voor deze bestelling is nog geen factuur opgemaakt.");
    const [client, company] = await Promise.all([repo.getClient(order.clientId).catch(() => ({ name: "—" })), repo.getConfig()]);
    html(res, 200, docs.renderInvoice({ order, client, company, backHref: who === "team" ? "/team?bestelling=" + encodeURIComponent(order.id) : (who === "klant" ? "/?ga=bestellingen" : "") }));
  });

  router.get("doc/picklijst", async ({ req, res, query }) => {
    if (!auth.teamSession(req)) throw new HttpError(401, "Meld u aan met de teamcode.");
    const date = dom.isISODate(query.dag) ? query.dag : dom.todayISO();
    const [orders, clients, company] = await Promise.all([
      repo.listOrders({ openOnly: true, sinceDate: dom.addDays(date, -30), openOrSince: true }), repo.listClients(), repo.getConfig()
    ]);
    const list = orders.filter((o) => o.deliveryDate === date && o.statusKey !== "geleverd").sort((a, b) => a.ref.localeCompare(b.ref));
    const clientsById = {};
    clients.forEach((c) => { clientsById[c.id] = c; });
    html(res, 200, docs.renderPicklist({ date, orders: list, clientsById, company, backHref: "/team" }));
  });
};
