"use strict";
// Bedrijfsoperaties. Hier zit het verhaal van een bestelling: plaatsen,
// klaarzetten, vertrekken, leveren en factureren — met de e-mails die erbij horen.
// Wordt gebruikt door de klant-, team- en beheerhandlers en door de systeemcontrole.
const cfg = require("./config");
const repo = require("./repo");
const dom = require("./domain");
const auth = require("./auth");
const mail = require("./mail");
const { F, STATUS, PAYMENT, REQUEST_STATUS, UNIT_CHOICES } = cfg;
const { DomainError } = dom;

// ---- Context ----------------------------------------------------------------------
function portalUrl(req) {
  if (cfg.portalUrl) return cfg.portalUrl;
  const h = (req && req.headers) || {};
  const host = h["x-forwarded-host"] || h.host;
  if (!host) return "";
  const proto = h["x-forwarded-proto"] || (String(host).startsWith("localhost") || String(host).startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
function docLinks(order, req) {
  const base = portalUrl(req);
  if (!base) return { deliveryNote: "", invoice: "" };
  return {
    deliveryNote: `${base}/doc/leveringsbon/${encodeURIComponent(order.id)}?t=${auth.docToken("leveringsbon", order.id)}`,
    invoice: order.invoiceNumber ? `${base}/doc/factuur/${encodeURIComponent(order.id)}?t=${auth.docToken("factuur", order.id)}` : ""
  };
}
function opsRecipient(config) { return config.opsEmail || config.email || ""; }

// ---- Catalogus met prijzen voor een klant -------------------------------------------
async function catalogueFor(clientId) {
  const [products, negotiated] = await Promise.all([repo.listProducts({ activeOnly: true }), repo.negotiatedFor(clientId)]);
  return products.map((p) => {
    const cents = dom.priceFor(p, negotiated.get(p.id));
    return { id: p.id, name: p.name, unit: p.unit, unitLabel: p.unitLabel, category: p.category, categoryLabel: p.categoryLabel,
      decimals: dom.allowsDecimals(p.unit), priceCents: cents, negotiated: negotiated.has(p.id), basePriceCents: p.basePriceCents };
  });
}

/** Vaste bestelling: wat deze klant de laatste keren bestelde, met het laatste aantal. */
function suggestionsFrom(orders, products) {
  const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
  const seen = new Map();
  orders.slice(0, 6).forEach((o, idx) => o.lines.forEach((l) => {
    const p = byName.get(l.name.toLowerCase());
    if (!p) return;
    const s = seen.get(p.id) || { productId: p.id, qty: l.qty, count: 0, lastIdx: idx };
    s.count++;
    seen.set(p.id, s);
  }));
  return Array.from(seen.values()).sort((a, b) => b.count - a.count || a.lastIdx - b.lastIdx).slice(0, 12);
}

// ---- Bestelling plaatsen -------------------------------------------------------------
/**
 * @param {{client:object, items:any[], deliveryDate:string, notes:string, source:string, req:any, staff?:boolean, test?:boolean}} p
 */
async function placeOrder(p) {
  const [products, negotiated, config] = await Promise.all([repo.listProducts({ activeOnly: true }), repo.negotiatedFor(p.client.id), repo.getConfig()]);
  const map = new Map(products.map((x) => [x.id, x]));
  const built = dom.buildOrderLines(p.items, map, negotiated);
  const today = dom.todayISO();
  let deliveryDate = String(p.deliveryDate || "").trim();
  if (!dom.isISODate(deliveryDate)) throw new DomainError("Kies een leverdatum.");
  if (p.staff) {
    if (deliveryDate < today) throw new DomainError("De leverdatum ligt in het verleden.");
  } else if (!dom.isDeliveryDateAllowed(deliveryDate, { cutoff: config.cutoff, deliveryDays: config.deliveryDays })) {
    throw new DomainError(`Die leverdatum is niet meer beschikbaar. Bestel vóór ${dom.fmtCutoff(dom.parseCutoff(config.cutoff))} voor levering de volgende leverdag.`);
  }
  const notes = dom.cleanMultiline(p.notes, 800);
  const ref = dom.newOrderRef(today);
  const fields = {
    [F.order.ref]: ref,
    [F.order.date]: today,
    [F.order.lines]: built.text,
    [F.order.status]: STATUS.RECEIVED,
    [F.order.payment]: PAYMENT.OPEN,
    [F.order.total]: dom.fromCents(built.totalCents),
    [F.order.notes]: (p.source && p.source !== "Klantportaal" ? `[${p.source}] ` : "") + notes,
    [F.order.client]: [p.client.id],
    [F.order.deliveryDate]: deliveryDate
  };
  const order = await repo.createOrder(fields);
  const ctx = { order, client: p.client, company: config, portalUrl: portalUrl(p.req), source: p.source || "Klantportaal" };
  const messages = {};
  const team = mail.templates.orderTeam(ctx); team.to = opsRecipient(config);
  if (p.test) { team.subject = "[SYSTEEMTEST] " + team.subject; }
  messages.team = team;
  if (p.client.email) { const m = mail.templates.orderClient(ctx); if (p.test) m.subject = "[SYSTEEMTEST] " + m.subject; messages.client = m; }
  const sent = await mail.sendAll(messages).catch(() => ({}));
  return { order, mail: sent };
}

// ---- Klaarzetten: lijnen aanpassen ---------------------------------------------------
/**
 * @param {object} order
 * @param {{name?:string, productId?:string, qty:number, unit?:string, priceCents?:number, comment?:string}[]} input
 */
async function updateLines(order, input) {
  if (dom.isLocked(order.status)) throw new DomainError("Deze bestelling is al onderweg en kan niet meer worden gewijzigd.", 409);
  if (!Array.isArray(input) || !input.length) throw new DomainError("Een bestelling moet minstens één artikel bevatten.");
  if (input.length > 200) throw new DomainError("Te veel lijnen.");
  let products = null, negotiated = null;
  const existingByName = new Map(order.lines.map((l) => [l.name.toLowerCase(), l]));
  const lines = [];
  for (const raw of input) {
    const qty = Number(raw && raw.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10000) throw new DomainError("Ongeldig aantal.");
    let line;
    if (raw.productId) {
      if (!products) { products = await repo.listProducts({}); negotiated = await repo.negotiatedFor(order.clientId); }
      const p = products.find((x) => x.id === raw.productId);
      if (!p) throw new DomainError("Onbekend artikel.");
      line = { name: p.name, unit: p.unit, qty, priceCents: dom.priceFor(p, negotiated.get(p.id)), comment: dom.cleanComment(raw.comment) };
    } else {
      const name = dom.cleanName(raw.name);
      if (!name) throw new DomainError("Artikelnaam ontbreekt.");
      const prev = existingByName.get(name.toLowerCase());
      const unit = String(raw.unit || (prev && prev.unit) || "").trim();
      const priceCents = Number.isFinite(Number(raw.priceCents)) && raw.priceCents !== null ? Math.round(Number(raw.priceCents)) : (prev ? prev.priceCents : null);
      line = { name, unit, qty, priceCents, comment: dom.cleanComment(raw.comment != null ? raw.comment : (prev ? prev.comment : "")) };
    }
    if (line.unit && !UNIT_CHOICES.includes(line.unit) && !["stuk", "doos", "kg"].includes(line.unit)) throw new DomainError("Onbekende eenheid.");
    if (line.unit === "stuk") line.unit = "pièce";
    if (line.unit === "doos") line.unit = "caisse";
    if (!dom.allowsDecimals(line.unit) && !Number.isInteger(qty)) throw new DomainError(`${line.name}: enkel hele aantallen.`);
    if (line.priceCents != null && (line.priceCents < 0 || line.priceCents > 100000000)) throw new DomainError("Ongeldige prijs.");
    lines.push(line);
  }
  const text = dom.serializeLines(lines);
  const total = dom.linesTotalCents(lines);
  return repo.updateOrder(order.id, { [F.order.lines]: text, [F.order.total]: dom.fromCents(total) });
}

// ---- Foto's en handtekeningen ----------------------------------------------------------
function decodeImage(input, maxBytes) {
  if (!input) return null;
  const s = typeof input === "string" ? input : (input.base64 || input.dataUrl || "");
  const m = String(s).match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  const contentType = m ? m[1].toLowerCase().replace("jpg", "jpeg") : String((typeof input === "object" && input.contentType) || "image/jpeg").toLowerCase();
  const base64 = m ? m[2] : String(s).replace(/^data:[^,]*,/, "");
  if (!/^image\/(png|jpeg|webp)$/.test(contentType)) throw new DomainError("Enkel PNG, JPEG of WebP.");
  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new DomainError("Ongeldige afbeelding.");
  const bytes = Math.floor(base64.replace(/\s/g, "").length * 3 / 4);
  if (bytes > (maxBytes || 4 * 1024 * 1024)) throw new DomainError("Afbeelding te groot (max 4 MB).");
  const ext = contentType.split("/")[1];
  return { contentType, base64: base64.replace(/\s/g, ""), ext };
}

// ---- Statusovergangen ------------------------------------------------------------------
async function markReady(order, { photo } = {}) {
  if (order.status !== STATUS.RECEIVED && order.status !== STATUS.READY) throw new DomainError("Deze bestelling is al vertrokken.", 409);
  if (!order.lines.length) throw new DomainError("Deze bestelling heeft geen artikelen.", 409);
  const warnings = [];
  const img = decodeImage(photo, 4 * 1024 * 1024);
  if (img) {
    try { await repo.uploadOrderPrepPhoto(order.id, { filename: `klaargezet-${order.ref}.${img.ext}`, contentType: img.contentType, base64: img.base64 }); }
    catch (e) { warnings.push("De foto kon niet worden opgeslagen: " + (e.message || e)); }
  }
  const updated = await repo.updateOrder(order.id, { [F.order.status]: STATUS.READY, [F.order.prepValidated]: true, [F.order.preparedAt]: dom.nowISO() });
  return { order: updated, warnings };
}

async function markShipped(order, req, { test } = {}) {
  if (order.status === STATUS.SHIPPED) return { order, mail: {} };
  if (order.status !== STATUS.READY) throw new DomainError(order.status === STATUS.INVOICED ? "Deze bestelling is al geleverd." : "Zet de bestelling eerst op Klaar.", 409);
  const updated = await repo.updateOrder(order.id, { [F.order.status]: STATUS.SHIPPED });
  const [client, config] = await Promise.all([repo.getClient(order.clientId).catch(() => null), repo.getConfig()]);
  let sent = {};
  if (client && client.email) {
    const m = mail.templates.orderShipped({ order: updated, client, company: config, portalUrl: portalUrl(req), docLinks: docLinks(updated, req) });
    if (test) m.subject = "[SYSTEEMTEST] " + m.subject;
    sent = await mail.sendAll({ client: m }).catch(() => ({}));
  }
  return { order: updated, mail: sent };
}

/** Levering afronden = ontvangst bevestigen + factuurnummer toekennen + factuur mailen. */
async function markDelivered(order, { receivedBy, signature }, req, { dryRun } = {}) {
  if (order.status === STATUS.INVOICED) throw new DomainError("Deze levering is al afgerond.", 409);
  if (order.status !== STATUS.SHIPPED && order.status !== STATUS.READY) throw new DomainError("Zet de bestelling eerst op Klaar.", 409);
  const name = dom.clean(receivedBy, 80);
  if (!name) throw new DomainError("Vul in wie de levering in ontvangst nam.");
  const config = await repo.getConfig();
  const year = dom.brusselsYear();
  let invoiceNumber = order.invoiceNumber || dom.nextInvoiceNumber(await repo.listInvoiceNumbers(), year);
  if (dryRun) return { order, invoiceNumber, dryRun: true };
  const warnings = [];
  const img = decodeImage(signature, 2 * 1024 * 1024);
  if (img) {
    try { await repo.uploadOrderProof(order.id, { filename: `handtekening-${order.ref}.${img.ext}`, contentType: img.contentType, base64: img.base64 }); }
    catch (e) { warnings.push("De handtekening kon niet worden opgeslagen: " + (e.message || e)); }
  }
  const now = dom.nowISO();
  const fields = {
    [F.order.status]: STATUS.INVOICED,
    [F.order.deliveryConfirmed]: true,
    [F.order.receivedBy]: name,
    [F.order.deliveredAt]: now
  };
  if (!order.invoiceNumber) { fields[F.order.invoiceNumber] = invoiceNumber; fields[F.order.invoicedAt] = now; }
  let updated = await repo.updateOrder(order.id, fields);
  // Nummer moet uniek zijn: bij een gelijktijdige facturatie krijgt de laatste een nieuw nummer.
  for (let i = 0; i < 3 && !order.invoiceNumber; i++) {
    const all = await repo.listInvoiceNumbers();
    if (all.filter((n) => n === invoiceNumber).length <= 1) break;
    invoiceNumber = dom.nextInvoiceNumber(all, year);
    updated = await repo.updateOrder(order.id, { [F.order.invoiceNumber]: invoiceNumber });
  }
  const client = await repo.getClient(order.clientId).catch(() => null);
  const vat = dom.vatBreakdown(updated.totalCents, config.vatRate);
  const ctx = { order: updated, client: client || { name: "", email: "" }, company: config, portalUrl: portalUrl(req), docLinks: docLinks(updated, req), vat };
  const messages = {};
  if (client && client.email) messages.client = mail.templates.orderDelivered(ctx);
  const copy = mail.templates.invoiceTeamCopy(ctx); copy.to = opsRecipient(config); messages.team = copy;
  const sent = await mail.sendAll(messages).catch(() => ({}));
  return { order: updated, invoiceNumber: updated.invoiceNumber, mail: sent, warnings };
}

async function setPaid(order, paid) {
  return repo.updateOrder(order.id, { [F.order.payment]: paid ? PAYMENT.PAID : PAYMENT.OPEN });
}

/** Eén stap terug (vergissing op de tablet). Nooit vanaf Geleverd. */
async function stepBack(order) {
  if (order.status === STATUS.READY) return repo.updateOrder(order.id, { [F.order.status]: STATUS.RECEIVED, [F.order.prepValidated]: false });
  if (order.status === STATUS.SHIPPED) return repo.updateOrder(order.id, { [F.order.status]: STATUS.READY });
  throw new DomainError(order.status === STATUS.INVOICED ? "Een afgeronde levering kan niet worden teruggezet." : "Deze bestelling staat al op Ontvangen.", 409);
}

async function setNotes(order, notes) {
  return repo.updateOrder(order.id, { [F.order.notes]: dom.cleanMultiline(notes, 1000) });
}

async function deleteOrder(order) {
  if (order.status !== STATUS.RECEIVED) throw new DomainError("Enkel een bestelling met status Ontvangen kan worden verwijderd.", 409);
  await repo.deleteOrder(order.id);
  return { ok: true };
}

// ---- Klanten en aanvragen -------------------------------------------------------------
async function uniqueUsername(base, exceptId) {
  let candidate = base;
  for (let i = 0; i < 25; i++) {
    if (!(await repo.usernameTaken(candidate, exceptId))) return candidate;
    candidate = base.slice(0, 14) + "." + (i + 2);
  }
  return base + "." + Math.floor(100 + Math.random() * 899);
}

function clientFields(input, { forCreate } = {}) {
  const name = dom.clean(input.name, 120);
  if (!name) throw new DomainError("De klantnaam is verplicht.");
  const email = dom.normalizeEmail(input.email);
  if (email && !dom.isEmail(email)) throw new DomainError("Het e-mailadres is ongeldig.");
  const fields = {
    [F.client.name]: name,
    [F.client.email]: email,
    [F.client.phone]: dom.clean(input.phone, 40),
    [F.client.address]: dom.cleanMultiline(input.address, 300),
    [F.client.vat]: dom.normalizeVat(input.vat),
    [F.client.notes]: dom.cleanMultiline(input.notes, 2000),
    [F.client.usual]: dom.cleanMultiline(input.usual, 2000)
  };
  if (input.number !== undefined) fields[F.client.number] = dom.clean(input.number, 40);
  if (forCreate || input.username !== undefined) fields[F.client.username] = dom.normalizeUsername(input.username);
  return fields;
}

async function saveClient(input) {
  const fields = clientFields(input, { forCreate: !input.id });
  const wanted = fields[F.client.username];
  if (wanted !== undefined) {
    if (wanted && !/^[a-z0-9._@-]{3,40}$/.test(wanted)) throw new DomainError("Gebruikersnaam: 3 tot 40 tekens, letters, cijfers, punt of streepje.");
    if (!wanted && !input.id) fields[F.client.username] = await uniqueUsername(dom.slugUsername(fields[F.client.name]));
    else if (wanted && (await repo.usernameTaken(wanted, input.id))) throw new DomainError("Deze gebruikersnaam is al in gebruik.", 409);
  }
  if (!input.id && !fields[F.client.number]) {
    const all = await repo.listClients();
    fields[F.client.number] = dom.nextClientNumber(all.map((c) => c.number));
  }
  let password = null;
  if (!input.id) { password = auth.generatePassword(10); fields[F.client.password] = password; }
  const client = input.id ? await repo.updateClient(input.id, fields) : await repo.createClient(fields);
  return { client, password };
}

/** Nieuw wachtwoord (opgeslagen in klare tekst: de base deelt dit veld met het bestaande portaal). */
async function setPassword(clientId, password) {
  const pw = String(password || "").trim() || auth.generatePassword(10);
  if (pw.length < 8) throw new DomainError("Het wachtwoord moet minstens 8 tekens lang zijn.");
  if (pw.length > 80) throw new DomainError("Het wachtwoord is te lang.");
  await repo.updateClient(clientId, { [F.client.password]: pw });
  return pw;
}

async function sendCredentials(client, password, req) {
  if (!client.email) throw new DomainError("Deze klant heeft geen e-mailadres.");
  const config = await repo.getConfig();
  const m = mail.templates.credentials({ client, company: config, username: client.username, password, portalUrl: portalUrl(req), cutoff: dom.fmtCutoff(dom.parseCutoff(config.cutoff)) });
  return mail.send(m);
}

async function approveRequest(request, input, req) {
  if (!request.isNew) throw new DomainError("Deze aanvraag is al verwerkt.", 409);
  const { client, password } = await saveClient({
    name: input.name || request.company,
    email: input.email !== undefined ? input.email : request.email,
    phone: input.phone !== undefined ? input.phone : request.phone,
    address: input.address !== undefined ? input.address : request.address,
    vat: input.vat || "",
    username: input.username || "",
    notes: [request.contact ? "Contactpersoon: " + request.contact : "", request.notes].filter(Boolean).join("\n")
  });
  await repo.updateRequest(request.id, { [F.request.status]: REQUEST_STATUS.DONE });
  let sent = null;
  if (input.sendMail !== false && client.email) sent = await sendCredentials(client, password, req);
  return { client, password, mail: sent };
}

async function closeRequest(request, note) {
  const fields = { [F.request.status]: REQUEST_STATUS.DONE };
  if (note) fields[F.request.notes] = dom.cleanMultiline([request.notes, note].filter(Boolean).join("\n"), 1000);
  return repo.updateRequest(request.id, fields);
}

async function submitRequest(input, req) {
  const company = dom.clean(input.company, 120), contact = dom.clean(input.contact, 120);
  const email = dom.normalizeEmail(input.email), phone = dom.clean(input.phone, 40);
  if (!company || !contact || !email || !phone) throw new DomainError("Bedrijfsnaam, contactpersoon, e-mail en telefoon zijn verplicht.");
  if (!dom.isEmail(email)) throw new DomainError("Het e-mailadres is ongeldig.");
  const fields = {
    [F.request.company]: company, [F.request.contact]: contact, [F.request.email]: email, [F.request.phone]: phone,
    [F.request.address]: dom.cleanMultiline(input.address, 300), [F.request.notes]: dom.cleanMultiline(input.notes, 600), [F.request.status]: REQUEST_STATUS.NEW
  };
  const request = await repo.createRequest(fields);
  const config = await repo.getConfig();
  const ctx = { request, company: config, portalUrl: portalUrl(req) };
  const team = mail.templates.requestTeam(ctx); team.to = opsRecipient(config);
  const sent = await mail.sendAll({ team, prospect: mail.templates.requestProspect(ctx) }).catch(() => ({}));
  return { request, mail: sent };
}

// ---- Bedrijf, codes -------------------------------------------------------------------
async function saveCompany(config, input) {
  const k = F.config;
  const name = dom.clean(input.companyName, 120);
  if (!name) throw new DomainError("De bedrijfsnaam is verplicht.");
  const email = dom.normalizeEmail(input.email), ops = dom.normalizeEmail(input.opsEmail);
  if (email && !dom.isEmail(email)) throw new DomainError("Het e-mailadres is ongeldig.");
  if (ops && !dom.isEmail(ops)) throw new DomainError("De interne postbus is ongeldig.");
  const rate = Number(String(input.vatRate).replace(",", "."));
  const fields = {
    [k.companyName]: name,
    [k.street]: dom.clean(input.street, 200),
    [k.city]: dom.clean(input.city, 120),
    [k.vat]: dom.normalizeVat(input.vat),
    [k.phone]: dom.clean(input.phone, 40),
    [k.email]: email,
    [k.iban]: dom.clean(input.iban, 40).replace(/\s+/g, "").toUpperCase(),
    [k.bic]: dom.clean(input.bic, 20).replace(/\s+/g, "").toUpperCase(),
    [k.paymentTerms]: dom.clean(input.paymentTerms, 200),
    [k.deliveryTerms]: dom.cleanMultiline(input.deliveryTerms, 600),
    [k.opsEmail]: ops
  };
  if (Number.isFinite(rate) && rate >= 0 && rate <= 100) fields[k.vatRate] = rate;
  const cut = dom.parseCutoff(input.cutoff);
  const days = dom.parseDeliveryDays(input.deliveryDays);
  fields[k.cutoff] = dom.fmtCutoff(cut);
  fields[k.deliveryDays] = [1, 2, 3, 4, 5, 6, 7].filter((d) => days.has(d)).map((d) => dom.DAY_SHORT[d]).join(",");
  try {
    return await repo.saveConfig(config.id, fields);
  } catch (e) {
    // Oudere base zonder de twee extra velden: sla dan zonder op.
    if (e && e.status === 422 && /UNKNOWN_FIELD_NAME|Unknown field/i.test(String(e.message))) {
      delete fields[k.cutoff]; delete fields[k.deliveryDays];
      return repo.saveConfig(config.id, fields);
    }
    throw e;
  }
}

async function saveCode(config, which, code, reset) {
  if (which !== "admin" && which !== "staff") throw new DomainError("Onbekende rol.");
  if (!config.id) throw new DomainError("Vul eerst de bedrijfsgegevens in.");
  const field = which === "admin" ? F.config.adminHash : F.config.staffHash;
  if (reset) return repo.saveConfig(config.id, { [field]: "" });
  const value = String(code || "");
  if (value.length < 10) throw new DomainError("De code moet minstens 10 tekens lang zijn.");
  if (/famo/i.test(value)) throw new DomainError("Gebruik geen code met de bedrijfsnaam erin: te gemakkelijk te raden.");
  return repo.saveConfig(config.id, { [field]: auth.hashCode(value) });
}

// ---- Systeemcontrole: de hele keten, met opruiming ----------------------------------------
async function systemCheck(req) {
  const steps = [];
  const step = async (label, fn) => {
    const t = Date.now();
    try { const detail = await fn(); steps.push({ label, ok: true, ms: Date.now() - t, detail: detail || "" }); return detail; }
    catch (e) { steps.push({ label, ok: false, ms: Date.now() - t, detail: String(e && e.message || e) }); throw e; }
  };
  let client = null, order = null;
  const cleanup = async () => {
    if (order) { try { await repo.deleteOrder(order.id); steps.push({ label: "Testbestelling verwijderd", ok: true, ms: 0, detail: order.ref }); } catch (e) { steps.push({ label: "Testbestelling verwijderen", ok: false, ms: 0, detail: String(e.message || e) }); } order = null; }
    if (client) { try { await repo.deleteClient(client.id); steps.push({ label: "Testklant verwijderd", ok: true, ms: 0, detail: client.name }); } catch (e) { steps.push({ label: "Testklant verwijderen", ok: false, ms: 0, detail: String(e.message || e) }); } client = null; }
  };
  try {
    const config = await step("Bedrijfsgegevens lezen uit Airtable", async () => { const c = await repo.getConfig(); return c.companyName + (c.id ? "" : " (nog geen configuratieregel)"); }).then(() => repo.getConfig());
    const products = await step("Catalogus lezen", async () => { const p = await repo.listProducts({ activeOnly: true }); if (!p.length) throw new Error("Geen actieve artikelen in de catalogus."); return p.length + " actieve artikelen"; }).then(() => repo.listProducts({ activeOnly: true }));
    await step("Testklant aanmaken", async () => {
      const r = await saveClient({ name: "ZZ Systeemtest (wordt verwijderd)", email: opsRecipient(config), phone: "", address: "Testadres 1, 2000 Antwerpen", username: "systeemtest." + Math.floor(Math.random() * 1e6), notes: "Aangemaakt door de systeemcontrole." });
      client = r.client; return client.username;
    });
    await step("Klantlogin controleren", async () => {
      const hit = await repo.findClientForLogin(client.username);
      if (!hit || hit.client.id !== client.id) throw new Error("Klant niet gevonden via gebruikersnaam.");
      return "ok";
    });
    const dates = dom.nextDeliveryDates({ cutoff: config.cutoff, deliveryDays: config.deliveryDays, count: 1 });
    await step("Testbestelling plaatsen (met e-mails)", async () => {
      const r = await placeOrder({ client, items: [{ productId: products[0].id, qty: 1 }], deliveryDate: dates[0], notes: "Systeemcontrole — negeren.", source: "Systeemtest", req, test: true });
      order = r.order;
      const m = r.mail || {};
      const mailInfo = ["team", "client"].map((k) => m[k] ? `${k}: ${m[k].ok ? "verzonden" : (m[k].skipped || m[k].error || "mislukt")}` : "").filter(Boolean).join(" · ");
      return `${order.ref} · ${dom.fmtEur(order.totalCents)} · ${mailInfo || "geen e-mail"}`;
    });
    await step("Bestelling klaarzetten", async () => { const r = await markReady(order); order = r.order; return order.statusLabel; });
    await step("Bestelling onderweg zetten (e-mail aan klant)", async () => { const r = await markShipped(order, req, { test: true }); order = r.order; const m = r.mail && r.mail.client; return order.statusLabel + (m ? " · mail: " + (m.ok ? "verzonden" : (m.skipped || m.error)) : ""); });
    await step("Levering en factuurnummer (proefdraai, niets geboekt)", async () => { const r = await markDelivered(order, { receivedBy: "Systeemtest" }, req, { dryRun: true }); return "volgend factuurnummer: " + r.invoiceNumber; });
    await step("Documenten opbouwen", async () => {
      const docs = require("./docs");
      const dn = docs.renderDeliveryNote({ order, client, company: config });
      const inv = docs.renderInvoice({ order: Object.assign({}, order, { invoiceNumber: "FA-TEST" }), client, company: config });
      if (!dn.includes(order.ref) || !inv.includes("FA-TEST")) throw new Error("Document onvolledig.");
      return "leveringsbon en factuur ok";
    });
  } catch (_) {
    // de mislukte stap staat al in de lijst
  } finally {
    await cleanup();
  }
  return { ok: steps.every((s) => s.ok), steps, mailEnabled: mail.enabled() };
}

module.exports = {
  portalUrl, docLinks, opsRecipient, catalogueFor, suggestionsFrom,
  placeOrder, updateLines, markReady, markShipped, markDelivered, setPaid, stepBack, setNotes, deleteOrder,
  saveClient, setPassword, sendCredentials, approveRequest, closeRequest, submitRequest,
  saveCompany, saveCode, systemCheck, decodeImage
};
