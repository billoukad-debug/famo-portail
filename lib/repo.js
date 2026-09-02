"use strict";
// Toegang tot de gegevens: vertaalt Airtable-records naar duidelijke objecten en
// terug. Alle veldnamen komen uit config.js; de handlers kennen geen Airtable.
const crypto = require("crypto");
const at = require("./airtable");
const { T, F, STATUS, PAYMENT, DEFAULTS, REQUEST_STATUS } = require("./config");
const dom = require("./domain");

const f = (r) => (r && r.fields) || {};
const str = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const firstLink = (v) => (Array.isArray(v) && v.length ? v[0] : "");
const attachments = (v) => (Array.isArray(v) ? v : []).map((a) => ({ id: a.id || "", url: a.url || "", filename: a.filename || "", type: a.type || "", thumb: a.thumbnails && a.thumbnails.small ? a.thumbnails.small.url : "" }));

// ---- Configuratie ---------------------------------------------------------------
function mapConfig(r) {
  const c = f(r);
  const k = F.config;
  return {
    id: r ? r.id : null,
    companyName: str(c[k.companyName]) || DEFAULTS.companyName,
    street: str(c[k.street]),
    city: str(c[k.city]),
    vat: str(c[k.vat]),
    phone: str(c[k.phone]),
    email: str(c[k.email]),
    iban: str(c[k.iban]).replace(/\s+/g, ""),
    bic: str(c[k.bic]).replace(/\s+/g, ""),
    vatRate: c[k.vatRate] == null || c[k.vatRate] === "" || num(c[k.vatRate]) < 0 ? DEFAULTS.vatRate : num(c[k.vatRate]),
    paymentTerms: str(c[k.paymentTerms]) || DEFAULTS.paymentTerms,
    deliveryTerms: str(c[k.deliveryTerms]) || DEFAULTS.deliveryTerms,
    opsEmail: str(c[k.opsEmail]).toLowerCase(),
    adminHash: str(c[k.adminHash]),
    staffHash: str(c[k.staffHash]),
    cutoff: str(c[k.cutoff]) || DEFAULTS.cutoff,
    deliveryDays: str(c[k.deliveryDays]) || DEFAULTS.deliveryDays,
    hasCutoffField: Object.prototype.hasOwnProperty.call(c, k.cutoff),
    hasDeliveryDaysField: Object.prototype.hasOwnProperty.call(c, k.deliveryDays)
  };
}
// Korte cache per instantie: publieke pagina's en status raken de base niet bij elk bezoek.
let configCache = { at: 0, value: null };
const CONFIG_TTL_MS = 20000;
async function getConfig({ fresh = false } = {}) {
  if (!fresh && configCache.value && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.value;
  const rows = await at.list(T.CONFIG, { maxRecords: 1, pageSize: 1 });
  const value = mapConfig(rows[0] || null);
  configCache = { at: Date.now(), value };
  return value;
}
/** Wat het publiek en de klant mogen zien (nooit IBAN, hashes of de interne postbus). */
function publicConfig(c) {
  return {
    companyName: c.companyName, street: c.street, city: c.city, vat: c.vat, phone: c.phone, email: c.email,
    cutoff: c.cutoff, deliveryDays: c.deliveryDays, paymentTerms: c.paymentTerms, deliveryTerms: c.deliveryTerms
  };
}
function invalidateConfigCache() { configCache = { at: 0, value: null }; }
async function saveConfig(id, fields) {
  invalidateConfigCache();
  if (id) { const [r] = await at.update(T.CONFIG, [{ id, fields }]); return getConfig({ fresh: true }); }
  await at.create(T.CONFIG, [fields]);
  return getConfig({ fresh: true });
}

// ---- Klanten --------------------------------------------------------------------
function mapClient(r) {
  const c = f(r), k = F.client;
  return {
    id: r.id,
    name: str(c[k.name]),
    email: str(c[k.email]).toLowerCase(),
    phone: str(c[k.phone]),
    address: str(c[k.address]),
    usual: str(c[k.usual]),
    notes: str(c[k.notes]),
    username: str(c[k.username]).toLowerCase(),
    hasPassword: !!str(c[k.password]),
    vat: str(c[k.vat]),
    number: str(c[k.number]),
    createdTime: r.createdTime || ""
  };
}
async function listClients() {
  const rows = await at.list(T.CLIENTS);
  return rows.map(mapClient).sort((a, b) => a.name.localeCompare(b.name, "nl"));
}
async function getClient(id) {
  const r = await at.get(T.CLIENTS, id);
  return mapClient(r);
}
/** Korte, niet-omkeerbare vingerafdruk van het wachtwoord: zit in de sessie, zodat een gewijzigd wachtwoord oude sessies afsluit. */
function passwordVersion(stored) { return crypto.createHash("sha256").update("pv:" + String(stored || "")).digest("base64url").slice(0, 12); }
async function getClientPasswordVersion(id) {
  const r = await at.get(T.CLIENTS, id);
  return passwordVersion(f(r)[F.client.password]);
}
/** Voor de login: geeft ook het opgeslagen wachtwoord terug (verlaat deze module nooit). */
async function findClientForLogin(login) {
  const v = String(login || "").trim().toLowerCase();
  if (!v) return null;
  const formula = at.formula.or(at.formula.eqLower(F.client.username, v), at.formula.eqLower(F.client.email, v));
  const rows = await at.list(T.CLIENTS, { filterByFormula: formula, maxRecords: 5 });
  // Gebruikersnaam wint van e-mail als beide matchen.
  const byUser = rows.find((r) => str(f(r)[F.client.username]).toLowerCase() === v);
  const r = byUser || rows[0];
  if (!r) return null;
  return { client: mapClient(r), storedPassword: str(f(r)[F.client.password]), passwordVersion: passwordVersion(f(r)[F.client.password]) };
}
async function usernameTaken(username, exceptId) {
  const rows = await at.list(T.CLIENTS, { filterByFormula: at.formula.eqLower(F.client.username, username), maxRecords: 3 });
  return rows.some((r) => r.id !== exceptId);
}
async function createClient(fields) { const [r] = await at.create(T.CLIENTS, [fields]); return mapClient(r); }
async function updateClient(id, fields) { const [r] = await at.update(T.CLIENTS, [{ id, fields }]); return mapClient(r); }
async function deleteClient(id) { return at.remove(T.CLIENTS, [id]); }

// ---- Producten ------------------------------------------------------------------
function mapProduct(r) {
  const c = f(r), k = F.product;
  return {
    id: r.id,
    name: str(c[k.name]),
    basePrice: num(c[k.basePrice]),
    basePriceCents: dom.toCents(c[k.basePrice]),
    unit: str(c[k.unit]),
    unitLabel: dom.unitLabel(c[k.unit]),
    category: str(c[k.category]) || "Algemeen",
    categoryLabel: dom.categoryLabel(c[k.category]),
    active: !!c[k.active],
    createdTime: r.createdTime || ""
  };
}
async function listProducts({ activeOnly = false } = {}) {
  const q = activeOnly ? { filterByFormula: at.formula.isTrue(F.product.active) } : {};
  const rows = await at.list(T.CATALOGUE, q);
  return rows.map(mapProduct).sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel, "nl") || a.name.localeCompare(b.name, "nl"));
}
async function getProduct(id) { return mapProduct(await at.get(T.CATALOGUE, id)); }
async function createProduct(fields) { const [r] = await at.create(T.CATALOGUE, [fields]); return mapProduct(r); }
async function updateProduct(id, fields) { const [r] = await at.update(T.CATALOGUE, [{ id, fields }]); return mapProduct(r); }

// ---- Onderhandelde prijzen --------------------------------------------------------
function mapPrice(r) {
  const c = f(r), k = F.price;
  return { id: r.id, clientId: firstLink(c[k.client]), productId: firstLink(c[k.product]), priceCents: dom.toCents(c[k.price]) };
}
async function listPrices() {
  const rows = await at.list(T.PRICES);
  return rows.map(mapPrice).filter((p) => p.clientId && p.productId);
}
/** productId -> centen, voor één klant. */
async function negotiatedFor(clientId) {
  const all = await listPrices();
  const map = new Map();
  // Een lege of nul-prijs is geen klantprijs: dan geldt de basisprijs (nooit gratis leveren).
  all.filter((p) => p.clientId === clientId && p.priceCents > 0).forEach((p) => map.set(p.productId, p.priceCents));
  return map;
}
async function upsertPrice(clientId, productId, priceCents) {
  const all = await listPrices();
  const existing = all.find((p) => p.clientId === clientId && p.productId === productId);
  const fields = { [F.price.client]: [clientId], [F.price.product]: [productId], [F.price.price]: dom.fromCents(priceCents) };
  if (existing) { const [r] = await at.update(T.PRICES, [{ id: existing.id, fields }]); return mapPrice(r); }
  const [r] = await at.create(T.PRICES, [fields]);
  return mapPrice(r);
}
async function deletePriceFor(clientId, productId) {
  const all = await listPrices();
  const hits = all.filter((p) => p.clientId === clientId && (productId === "*" || p.productId === productId));
  if (hits.length) await at.remove(T.PRICES, hits.map((p) => p.id));
  return hits.length;
}

// ---- Bestellingen ---------------------------------------------------------------
function mapOrder(r) {
  const c = f(r), k = F.order;
  const linesText = str(c[k.lines]);
  const lines = dom.parseLines(linesText);
  return {
    id: r.id,
    ref: str(c[k.ref]),
    date: str(c[k.date]),
    linesText,
    lines,
    status: str(c[k.status]) || STATUS.RECEIVED,
    statusKey: dom.statusKey(str(c[k.status]) || STATUS.RECEIVED),
    statusLabel: dom.statusLabel(str(c[k.status]) || STATUS.RECEIVED),
    payment: str(c[k.payment]) || PAYMENT.OPEN,
    paid: str(c[k.payment]) === PAYMENT.PAID,
    totalCents: dom.toCents(c[k.total]),
    notes: str(c[k.notes]),
    clientId: firstLink(c[k.client]),
    deliveryDate: str(c[k.deliveryDate]),
    invoiceNumber: str(c[k.invoiceNumber]),
    prepValidated: !!c[k.prepValidated],
    preparedAt: str(c[k.preparedAt]),
    deliveredAt: str(c[k.deliveredAt]),
    invoicedAt: str(c[k.invoicedAt]),
    receivedBy: str(c[k.receivedBy]),
    deliveryConfirmed: !!c[k.deliveryConfirmed],
    proof: attachments(c[k.proof]),
    prepPhoto: attachments(c[k.prepPhoto]),
    createdTime: r.createdTime || ""
  };
}
function sortOrders(list) {
  return list.sort((a, b) => (b.date.localeCompare(a.date)) || (b.createdTime.localeCompare(a.createdTime)));
}
/**
 * @param {{sinceDate?:string, clientId?:string, openOnly?:boolean}} opts
 * sinceDate: enkel bestellingen met Date >= sinceDate (formule), de rest filtert JS.
 */
async function listOrders(opts = {}) {
  const parts = [];
  if (opts.sinceDate) parts.push(at.formula.onOrAfter(F.order.date, opts.sinceDate));
  if (opts.openOnly) parts.push(`NOT(${at.formula.eq(F.order.status, STATUS.INVOICED)})`);
  let formula = "";
  if (parts.length === 2 && opts.openOrSince) formula = at.formula.or(parts[0], parts[1]);
  else formula = at.formula.and(...parts);
  const rows = await at.list(T.ORDERS, formula ? { filterByFormula: formula } : {});
  let list = rows.map(mapOrder);
  if (opts.clientId) list = list.filter((o) => o.clientId === opts.clientId);
  return sortOrders(list);
}
async function getOrder(id) { return mapOrder(await at.get(T.ORDERS, id)); }
async function createOrder(fields) { const [r] = await at.create(T.ORDERS, [fields]); return mapOrder(r); }
async function updateOrder(id, fields) { const [r] = await at.update(T.ORDERS, [{ id, fields }]); return mapOrder(r); }
async function deleteOrder(id) { return at.remove(T.ORDERS, [id]); }
async function listInvoiceNumbers() {
  const rows = await at.list(T.ORDERS, { fields: [F.order.invoiceNumber], filterByFormula: `NOT(${at.formula.field(F.order.invoiceNumber)}='')` });
  return rows.map((r) => str(f(r)[F.order.invoiceNumber])).filter(Boolean);
}
async function uploadOrderProof(orderId, file) { return at.uploadAttachment(orderId, require("./config").FIELD_IDS.orderProof, file); }
async function uploadOrderPrepPhoto(orderId, file) { return at.uploadAttachment(orderId, require("./config").FIELD_IDS.orderPrepPhoto, file); }

// ---- Aanvragen ------------------------------------------------------------------
function mapRequest(r) {
  const c = f(r), k = F.request;
  return {
    id: r.id,
    company: str(c[k.company]),
    contact: str(c[k.contact]),
    email: str(c[k.email]).toLowerCase(),
    phone: str(c[k.phone]),
    address: str(c[k.address]),
    notes: str(c[k.notes]),
    status: str(c[k.status]) || REQUEST_STATUS.NEW,
    isNew: (str(c[k.status]) || REQUEST_STATUS.NEW) === REQUEST_STATUS.NEW,
    createdTime: r.createdTime || ""
  };
}
async function listRequests() {
  const rows = await at.list(T.REQUESTS);
  return rows.map(mapRequest).sort((a, b) => b.createdTime.localeCompare(a.createdTime));
}
async function getRequest(id) { return mapRequest(await at.get(T.REQUESTS, id)); }
async function createRequest(fields) { const [r] = await at.create(T.REQUESTS, [fields]); return mapRequest(r); }
async function updateRequest(id, fields) { const [r] = await at.update(T.REQUESTS, [{ id, fields }]); return mapRequest(r); }
async function deleteRequest(id) { return at.remove(T.REQUESTS, [id]); }

module.exports = {
  mapConfig, getConfig, publicConfig, saveConfig, invalidateConfigCache,
  mapClient, listClients, getClient, findClientForLogin, usernameTaken, createClient, updateClient, deleteClient, getClientPasswordVersion, passwordVersion,
  mapProduct, listProducts, getProduct, createProduct, updateProduct,
  mapPrice, listPrices, negotiatedFor, upsertPrice, deletePriceFor,
  mapOrder, listOrders, getOrder, createOrder, updateOrder, deleteOrder, listInvoiceNumbers, uploadOrderProof, uploadOrderPrepPhoto,
  mapRequest, listRequests, getRequest, createRequest, updateRequest, deleteRequest
};
