"use strict";
// Bestellen per e-mail (specs/020-bestellen-per-mail) : du webhook Resend vérifié à la commande
// « Reçue », ou à la file « Te controleren » du personnel. Le serveur décide (constitution II) :
// Claude ne fait que PROPOSER des lignes ; prix, TVA, règles de livraison, numéro et journal sont
// ceux d'une commande du portail (lib/bestelling.js, lib/levering.js, lib/ordernumber.js).
//
// Table « Inkomende mails » (docs/SCHEMA.md) : un enregistrement par message reçu, clé Bericht-id
// (id Resend). Sur le moteur SQL (production : Neon), l'id de l'enregistrement est dérivé du
// Bericht-id : deux livraisons simultanées du même webhook se heurtent à la clé primaire, une seule
// commande possible (idempotence, plusieurs instances Vercel comprises).
//
// Statuts : Verwerken (en cours) → Aangemaakt (commande créée) | Te controleren (le personnel
// décide) | Genegeerd (réponse automatique, boucle, trop de messages, ou écarté par le personnel).
// Un « Verwerken » de plus de 3 minutes (fonction interrompue) est montré comme à contrôler.
//
// Jamais de texte du message ni de clé dans les logs : ids, statut, raison.
const crypto = require("crypto");
const { at, atAll, escapeFormula, REC } = require("../airtable");
const __lev = require("../levering");
const __bestelling = require("../bestelling");
const __orderNumber = require("../ordernumber");
const __ordermail = require("../ordermail");
const __journal = require("../journal");
const __atomic = require("../atomic");
const __lj = require("../lignesjson");
const __kl = require("../klantlogin");
const __revision = require("../revision");
const resend = require("./resend");
const claude = require("./claude");
const svix = require("./svix");
const log = require("../log");

const TABLE = "Inkomende mails";
const T = encodeURIComponent(TABLE);
const ST = { busy: "Verwerken", review: "Te controleren", done: "Aangemaakt", ignored: "Genegeerd", creating: "Aanmaken" };
const MIN_CONFIDENCE = 0.8;
const MAX_PER_HOUR = 10;
const RETENTION_DAYS = 90;
const STUCK_MS = 3 * 60 * 1000;
const DEFAULT_ADDRESS = "bestel@orders.famoseafood.be";
// Plafond « sensé » par unité au-delà duquel une quantité lue dans un e-mail est vérifiée par le
// personnel (une faute de frappe « 500 kg » ne devient jamais une commande automatique).
const MAX_QTY = { kg: 200, "pièce": 1000, caisse: 50, carton: 50 };
const UNIT_NL = { kg: "kg", "pièce": "stuk", caisse: "kassa", carton: "doos" };
const aiPerDay = () => (Number(process.env.INBOUND_AI_DAILY_MAX) > 0 ? Number(process.env.INBOUND_AI_DAILY_MAX) : 200);

const nowIso = () => new Date().toISOString();
const json = (v) => JSON.stringify(v);
const parseJson = (v) => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const unitKey = (u) => { const s = String(u || "").toLowerCase().trim(); return s === "piece" ? "pièce" : s; };

function store() {
  const st = require("../datastore").state;
  return st.backend !== "airtable" && st.store ? st.store : null;
}

/** Id d'enregistrement dérivé du Bericht-id (moteur SQL) : la clé primaire fait l'idempotence. */
const recordIdFor = (emailId) => "recml" + crypto.createHash("sha256").update(String(emailId)).digest("hex").slice(0, 24);

const noEmpty = (f) => Object.fromEntries(Object.entries(f).filter(([, v]) => !(v === "" || v === null || v === undefined || v === false || (Array.isArray(v) && !v.length))));

async function update(id, fields) {
  const r = await at(`${T}/${id}`, { method: "PATCH", body: json({ fields }) });
  if (r.error) throw new Error("Inkomende mail niet bijgewerkt: " + (r.error.type || r.error.message || "fout"));
  return r;
}

async function getRecord(id) {
  if (!REC.test(String(id || ""))) return null;
  const r = await at(`${T}/${id}`);
  return r && !r.error ? r : null;
}

// Premier passage d'un message : l'enregistrement est créé AVANT tout traitement (rien ne se perd,
// un second webhook du même message le retrouve). → { id, created, fields? }
async function reserve(info) {
  const fields = noEmpty({ "Bericht-id": info.emailId, "Status": ST.busy, "Ontvangen op": /^\d{4}-\d{2}-\d{2}T/.test(info.createdAt) ? info.createdAt : nowIso(), "Van": info.from, "Onderwerp": info.subject, "Message-ID": info.messageId });
  const st = store();
  if (st) {
    const id = recordIdFor(info.emailId);
    try { await st.insert(TABLE, [{ id, createdTime: nowIso(), fields }]); return { id, created: true }; }
    catch (e) { const cur = await st.get(TABLE, id); if (cur) return { id, created: false, fields: cur.fields }; throw e; }
  }
  // Airtable (banc local seulement) : pas d'écriture conditionnelle, lecture puis création.
  const f = encodeURIComponent(`{Bericht-id}='${escapeFormula(info.emailId)}'`);
  const ex = await at(`${T}?filterByFormula=${f}&maxRecords=1`);
  if (ex.error) throw new Error("Inkomende mails onleesbaar");
  if (ex.records && ex.records[0]) return { id: ex.records[0].id, created: false, fields: ex.records[0].fields };
  const c = await at(T, { method: "POST", body: json({ records: [{ fields }] }) });
  if (c.error) throw new Error("Inkomende mail niet bewaard");
  return { id: c.records[0].id, created: true };
}

// ---- Configuratie --------------------------------------------------------------------------------
async function loadSettings() {
  const conf = await at(encodeURIComponent("Configuratie") + "?maxRecords=1");
  const f = (conf && conf.records && conf.records[0] && conf.records[0].fields) || {};
  return { fields: f, auto: !!f["Mailbestellingen automatisch"], address: String(f["Bestel-e-mailadres"] || "").trim().toLowerCase() || DEFAULT_ADDRESS, rules: __lev.rulesFrom(f) };
}
function ownDomains(settings) {
  const fromEnv = resend.addressOf(String(process.env.MAIL_FROM || ""));
  return [resend.domainOf(settings.address), resend.domainOf(fromEnv)].filter(Boolean);
}

/** Publié dans Beheer (booléens seulement, jamais une valeur de secret). */
function status(fields) {
  const f = fields || {};
  return {
    adres: String(f["Bestel-e-mailadres"] || "").trim() || DEFAULT_ADDRESS,
    automatisch: !!f["Mailbestellingen automatisch"],
    webhookGeheim: !!svix.secretKey(process.env.RESEND_INBOUND_SECRET),
    aiSleutel: claude.enabled(),
    resendSleutel: !!String(process.env.RESEND_API_KEY || "").trim()
  };
}

// ---- Expéditeur ----------------------------------------------------------------------------------
const addressesOf = (v) => String(v || "").toLowerCase().split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

/** Clients (et utilisateurs supplémentaires actifs) dont l'e-mail est exactement `address`. */
async function findSender(address) {
  const a = String(address || "").toLowerCase();
  if (!a) return [];
  const cl = await atAll("Clients");
  if (cl.error) throw new Error("Klanten onleesbaar");
  const byId = new Map((cl.records || []).map((r) => [r.id, r]));
  const hits = new Map();
  for (const r of cl.records || []) if (addressesOf(r.fields["Email"]).includes(a)) hits.set(r.id, { client: r, user: null });
  const us = await atAll(encodeURIComponent("Klantgebruikers")).catch(() => ({ records: [] }));
  for (const u of (us && us.records) || []) {
    if (!u.fields["Actief"] || !addressesOf(u.fields["Email"]).includes(a)) continue;
    const c = byId.get(((u.fields["Client"] || [])[0]) || "");
    if (c && !hits.has(c.id)) hits.set(c.id, { client: c, user: u });
  }
  return Array.from(hits.values());
}

// SPF/DKIM/DMARC : l'adresse From se falsifie. DMARC « pass » suffit ; sans DMARC, SPF ou DKIM
// « pass » ; toute autre combinaison (fail, none, absent) → vérification par le personnel.
function senderVerified(mail) {
  if (mail.dmarc) return mail.dmarc === "pass";
  return mail.spf === "pass" || mail.dkim === "pass";
}

async function recentFrom(address, sinceMs, exceptId) {
  const f = encodeURIComponent(`{Van}='${escapeFormula(address)}'`);
  const r = await atAll(`${T}?filterByFormula=${f}`);
  return ((r && r.records) || []).filter((x) => x.id !== exceptId && Date.parse(x.createdTime || x.fields["Ontvangen op"] || 0) >= sinceMs).length;
}
async function aiCallsToday() {
  const today = __lev.brusselsToday();
  const r = await atAll(`${T}?fields%5B%5D=${encodeURIComponent("AI-gebruik")}`);
  return ((r && r.records) || []).filter((x) => x.fields["AI-gebruik"] && String(x.createdTime || "").slice(0, 10) >= today).length;
}

// ---- Proposition → lignes vérifiées --------------------------------------------------------------
/** Premier jour livrable (règles Configuratie, heure limite comprise), "" si aucun dans la fenêtre. */
function firstDeliverable(rules, now) {
  const today = __lev.brusselsToday();
  for (let i = 1; i <= (rules.maxDagen || 60); i++) {
    const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    if (!__lev.checkDate(iso, rules) && !__lev.checkCutoff(iso, rules, now)) return iso;
  }
  return "";
}

/**
 * Contrôle de la proposition de Claude avant toute création. → { problems: [raisons NL], items,
 * leverdag, notes }. Un seul problème suffit pour envoyer le message au personnel.
 */
function check(proposal, ctx) {
  const p = proposal || { lines: [] };
  const problems = [];
  const items = [];
  if (p.onduidelijk) problems.push("bericht onduidelijk of geen bestelling");
  if (!p.lines.length) problems.push("geen artikelen herkend");
  for (const l of p.lines) {
    const label = "«" + (l.naam_in_mail || "?") + "»";
    const product = l.productId ? ctx.products.get(l.productId) : null;
    if (!product) { problems.push(label + " niet gevonden in de catalogus"); continue; }
    const unit = unitKey(product.fields["Unité"]);
    if (l.confidence < MIN_CONFIDENCE) problems.push(label + " onzeker (" + Math.round(l.confidence * 100) + " %)" + (l.note ? ": " + l.note : ""));
    if (!(l.qty > 0)) problems.push(label + ": ongeldige hoeveelheid");
    else if (l.qty > (MAX_QTY[unit] || 100)) problems.push(label + ": ongewoon grote hoeveelheid (" + l.qty + " " + (UNIT_NL[unit] || unit) + ")");
    else if (unit !== "kg" && !Number.isInteger(l.qty)) problems.push(label + ": enkel kg mag een decimale hoeveelheid hebben");
    if (l.unit && l.unit !== unit) problems.push(label + ": eenheid in de mail (" + (UNIT_NL[l.unit] || l.unit) + ") verschilt van de catalogus (" + (UNIT_NL[unit] || unit) + ")");
    items.push({ productId: product.id, quantity: l.qty, comment: l.opmerking });
  }
  let leverdag = "";
  if (p.leverdag) {
    const err = __lev.checkDate(p.leverdag, ctx.rules) || __lev.checkCutoff(p.leverdag, ctx.rules, ctx.now);
    if (err) problems.push("gevraagde leverdag " + p.leverdag + ": " + err);
    else leverdag = p.leverdag;
  } else {
    leverdag = firstDeliverable(ctx.rules, ctx.now);
    if (!leverdag) problems.push("geen leverdag beschikbaar");
  }
  const versie = ctx.rules.voorwaardenVersie;
  if (versie && String(ctx.client.fields["Voorwaarden versie"] || "") !== versie) problems.push("de klant aanvaardde de nieuwe algemene voorwaarden nog niet");
  return { problems, items, leverdag, notes: p.opmerkingen || "" };
}

// ---- Création de la commande (chemin commun : webhook automatique, personnel depuis la file) -----
async function createOrder(o) {
  const ref = await __orderNumber.nextOrderRef(at);
  const today = __lev.brusselsToday();
  const fields = {
    "Référence": ref, "Date": today,
    "Lignes (produits / quantités)": o.order.lignes, "Lignes besteld": o.order.lignes, [__lj.FIELD]: o.order.json,
    "Statut": "Reçue", "Statut paiement": "En attente", "Total": o.order.total,
    "Notes": String(o.notes || "").slice(0, 500), "Client": [o.client.id],
    "Bron": "E-mail", "Inkomende mail": o.inboundId
  };
  if (o.leverdag) fields["Date livraison souhaitée"] = o.leverdag;
  if (o.door) fields["Besteld door"] = o.door;
  const j = await at("Commandes", { method: "POST", body: json({ records: [{ fields: noEmpty(fields) }] }) });
  if (j.error) throw new Error("Bestelling niet opgeslagen");
  await __revision.bump();
  return { ref, id: j.records[0].id, total: o.order.total, lignes: o.order.lignes, date: today };
}

// Confirmations (équipe + client, dans sa langue). Ne jette jamais : la commande existe déjà.
async function notifyCreated(o) {
  try {
    if (!__ordermail.enabled()) return null;
    const cfg = await __ordermail.loadMailConfig(at);
    const url = __ordermail.portalUrl(o.req);
    const klant = Object.assign(__ordermail.clientFrom(o.client), o.to ? { email: o.to } : {});
    return await __ordermail.notifyNewOrder({ ref: o.created.ref, recordId: o.created.id, date: o.created.date, dateLivraison: o.leverdag, notes: o.notes,
      lignes: o.created.lignes, total: o.created.total, bron: "E-mail", viaMail: true,
      orderUrl: url ? url + "/team/bestelling?id=" + encodeURIComponent(o.created.id) : "", klant, opsEmail: cfg.opsEmail, company: cfg });
  } catch (e) { log.warn("inbound-mail", "bevestiging niet verstuurd", { recId: o.created && o.created.id, err: e }); return null; }
}

async function acknowledge(rec, mail, client) {
  try {
    if (!__ordermail.enabled() || !client || !mail.from) return null;
    const cfg = await __ordermail.loadMailConfig(at);
    const r = await __ordermail.notifyMailReceived({ klant: __ordermail.clientFrom(client), to: mail.from, onderwerp: mail.subject, emailId: mail.emailId, company: cfg });
    if (r && r.ok) await update(rec, { "Bevestiging": "ontvangst" }).catch(() => null);
    return r;
  } catch (e) { return null; }
}

// ---- Analyse d'un message (Claude + contrôles) : webhook et « Opnieuw laten lezen » --------------
async function analyse(id, mail, client, settings) {
  const cat = await __bestelling.catalogueFor(client.id);
  const r = await claude.parseOrder({ text: mail.text, subject: mail.subject, products: Array.from(cat.products.values()), today: __lev.brusselsToday() });
  if (r.usage) await update(id, { "AI-gebruik": json(r.usage) }).catch(() => null);
  if (!r.ok) return { reason: r.reason };
  const c = check(r.proposal, { products: cat.products, rules: settings.rules, client, now: new Date() });
  return { proposal: r.proposal, check: c, catalogue: cat };
}

const voorstelOf = (proposal, leverdag) => json(Object.assign({}, proposal, { leverdagVoorstel: leverdag || "" }));

// ---- Webhook « email.received » -----------------------------------------------------------------
/** payload déjà vérifié (signature). → { status, body } pour Resend (2xx = reçu, 5xx = réessayer). */
async function handleWebhook(payload, ctx) {
  const L = log.from(ctx && ctx.req, "inbound-mail");
  const info = resend.eventInfo(payload);
  if (info.type !== "email.received") return { status: 200, body: { ok: true, ignored: "type" } };
  if (!info.emailId) return { status: 400, body: { error: "email_id ontbreekt" } };

  const res = await reserve(info);
  const id = res.id;
  if (!res.created) {
    const f = res.fields || {};
    // Seul un message dont le contenu n'a pas pu être lu chez Resend est repris (nouvel essai de Resend).
    const retry = f["Status"] === ST.review && f["Inhoud ontbreekt"] && (await __atomic.claim(TABLE, id, "Status", ST.review, ST.busy)) !== false;
    if (!retry) { L.info("dubbel webhook genegeerd", { recId: id }); return { status: 200, body: { ok: true, duplicate: true } }; }
  }

  const fetched = await resend.fetchEmail(info.emailId);
  if (!fetched.ok) {
    await update(id, { "Status": ST.review, "Reden": "Inhoud niet opgehaald bij Resend (" + fetched.reason + ")", "Inhoud ontbreekt": true });
    L.warn("inhoud niet opgehaald", { recId: id, reason: fetched.reason });
    return fetched.transient ? { status: 503, body: { error: "Tijdelijk niet beschikbaar, later opnieuw" } } : { status: 200, body: { ok: true, status: ST.review } };
  }
  const mail = resend.normalise(fetched.email, info);
  const settings = await loadSettings();
  const out = await decide(id, mail, settings, ctx);
  L.info("inkomende mail verwerkt", { recId: id, status: out.status, ref: out.ref });
  return { status: 200, body: { ok: true, status: out.status, ref: out.ref } };
}

async function decide(id, mail, settings, ctx) {
  const ignore = async (reason) => { await update(id, { "Status": ST.ignored, "Reden": reason, "Van": mail.from, "Onderwerp": mail.subject, "Inhoud ontbreekt": false }); return { status: ST.ignored }; };
  // 1. Réponses automatiques, listes, nos propres domaines : jamais de réponse (pas de boucle), texte non gardé.
  const auto = resend.autoReplyReason(mail.headers, mail.from, ownDomains(settings));
  if (auto) return ignore(auto);
  // 2. Plafond par expéditeur (boucle, abus) : 10 messages par heure.
  if ((await recentFrom(mail.from, Date.now() - 3600e3, id)) >= MAX_PER_HOUR) return ignore("te veel berichten van deze afzender (max " + MAX_PER_HOUR + " per uur)");

  const base = { "Van": mail.from, "Aan": mail.to.join(", "), "Onderwerp": mail.subject, "Tekst": mail.text, "Message-ID": mail.messageId, "Ontvangen op": mail.receivedAt, "Verificatie": "spf=" + (mail.spf || "?") + " dkim=" + (mail.dkim || "?") + " dmarc=" + (mail.dmarc || "?"), "Inhoud ontbreekt": false };
  const review = async (reason, extra, client) => {
    await update(id, Object.assign({}, base, { "Status": ST.review, "Reden": reason.slice(0, 500) }, extra || {}));
    if (client) await acknowledge(id, mail, client);
    return { status: ST.review };
  };

  // 3. Expéditeur : adresse exacte d'un client (ou d'un utilisateur actif), sinon le personnel décide. Jamais de réponse à un inconnu.
  const senders = await findSender(mail.from);
  const verified = senderVerified(mail);
  if (!senders.length) return review("onbekende afzender");
  if (senders.length > 1) return review("meerdere klanten met dit e-mailadres");
  const { client, user } = senders[0];
  const link = { "Client": [client.id] };
  if (!verified) return review("afzender niet geverifieerd (SPF/DKIM/DMARC): mogelijk vervalst", link);
  if (client.fields["Gearchiveerd"]) return review("klant gearchiveerd", link);
  if (!mail.text) return review(mail.attachments ? "enkel een bijlage (bijlagen worden niet gelezen)" : "leeg bericht", link, client);
  if (mail.truncated) return review("bericht te lang om automatisch te lezen", link, client);
  if (!claude.enabled()) return review("ANTHROPIC_API_KEY ontbreekt: niet automatisch gelezen", link, client);
  if ((await aiCallsToday()) >= aiPerDay()) return review("daglimiet voor automatisch lezen bereikt (" + aiPerDay() + ")", link, client);

  // 4. Claude propose, le serveur vérifie.
  await update(id, Object.assign({}, base, link)); // texte gardé même si la suite échoue
  const a = await analyse(id, mail, client, settings);
  if (a.reason) return review(a.reason, link, client);
  const voorstel = { "Voorstel": voorstelOf(a.proposal, a.check.leverdag) };
  const problems = a.check.problems.slice();
  if (!settings.auto) problems.push("automatisch aanmaken staat uit (Beheer → Bedrijfsgegevens)");
  let order = null;
  if (!problems.length) {
    try { order = await __bestelling.buildOrderLines(client.id, a.check.items, __bestelling.MSG_PERSONEEL, { catalogue: a.catalogue }); }
    catch (e) { problems.push(String(e.message || e)); }
    if (order && settings.rules.minimum > 0 && order.total < settings.rules.minimum) problems.push("onder het minimumbedrag (€ " + settings.rules.minimum.toFixed(2).replace(".", ",") + ")");
  }
  if (problems.length) return review(problems.join("; "), Object.assign({}, link, voorstel), client);

  // 5. Commande créée comme une commande du portail, statut « Reçue ».
  let created;
  try {
    created = await createOrder({ order, client, leverdag: a.check.leverdag, notes: a.check.notes, inboundId: id, door: user ? __kl.displayName({ table: __kl.USERS, fields: user.fields }) : "" });
  } catch (e) {
    return review("bestelling aanmaken mislukt: " + String(e.message || e), Object.assign({}, link, voorstel), client);
  }
  await update(id, Object.assign({}, base, link, voorstel, { "Status": ST.done, "Reden": "", "Commande": [created.id], "Referentie": created.ref, "Behandeld door": "automatisch", "Behandeld op": nowIso(), "Bevestiging": "bestelling" }));
  await __journal.log({ wie: "E-mail (automatisch)", rol: "systeem", actie: "Mailbestelling aangemaakt", object: TABLE, record: id, referentie: created.ref, reden: "" });
  await notifyCreated({ created, client, leverdag: a.check.leverdag, notes: a.check.notes, to: mail.from, req: ctx && ctx.req });
  return { status: ST.done, ref: created.ref };
}

// ---- Personnel : file « Te controleren » ---------------------------------------------------------
const isOpen = (r) => r.fields["Status"] === ST.review || (r.fields["Status"] === ST.busy && Date.now() - Date.parse(r.createdTime || 0) > STUCK_MS);

async function openIds() {
  const r = await atAll(`${T}?fields%5B%5D=Status`);
  if (r.error) throw new Error("Inkomende mails onleesbaar");
  return (r.records || []).filter(isOpen).map((x) => x.id);
}

function itemOf(r, clients, withText) {
  const f = r.fields || {};
  const cid = (f["Client"] || [])[0] || "";
  const c = cid ? clients.get(cid) : null;
  const stuck = f["Status"] === ST.busy;
  return {
    id: r.id, status: stuck ? ST.review : f["Status"], ontvangen: f["Ontvangen op"] || r.createdTime, van: f["Van"] || "", onderwerp: f["Onderwerp"] || "",
    tekst: withText ? String(f["Tekst"] || "") : undefined, inhoudOntbreekt: !!f["Inhoud ontbreekt"],
    reden: stuck ? "verwerking onderbroken: controleer en maak de bestelling zelf aan" : (f["Reden"] || ""), verificatie: f["Verificatie"] || "",
    client: c ? { id: c.id, nom: c.fields["Nom"] || "", gearchiveerd: !!c.fields["Gearchiveerd"] } : null,
    voorstel: parseJson(f["Voorstel"]), commande: (f["Commande"] || [])[0] ? { id: f["Commande"][0], ref: f["Referentie"] || "" } : null,
    behandeldDoor: f["Behandeld door"] || "", behandeldOp: f["Behandeld op"] || ""
  };
}

/** GET de l'écran : à contrôler (texte compris), traités des 14 derniers jours (sans texte), catalogue, clients. */
async function listForStaff() {
  const [mails, cl, cat] = await Promise.all([atAll(T), atAll("Clients"), atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`)]);
  if (mails.error || cl.error || cat.error) throw new Error("Gegevens onleesbaar");
  const clients = new Map((cl.records || []).map((r) => [r.id, r]));
  const recs = (mails.records || []).slice().sort((a, b) => String(b.fields["Ontvangen op"] || b.createdTime).localeCompare(String(a.fields["Ontvangen op"] || a.createdTime)));
  const since = Date.now() - 14 * 864e5;
  return {
    items: recs.filter(isOpen).map((r) => itemOf(r, clients, true)),
    afgehandeld: recs.filter((r) => !isOpen(r) && r.fields["Status"] !== ST.busy && Date.parse(r.createdTime || 0) >= since).slice(0, 50).map((r) => itemOf(r, clients, false)),
    products: (cat.records || []).map((r) => ({ id: r.id, nom: r.fields["Produit"] || "", unite: r.fields["Unité"] || "", kaliber: String(r.fields["Kaliber"] || "").trim(), cat: r.fields["Catégorie"] || "" })),
    clients: (cl.records || []).filter((r) => !r.fields["Gearchiveerd"]).map((r) => ({ id: r.id, nom: r.fields["Nom"] || "" })).sort((a, b) => a.nom.localeCompare(b.nom, "nl"))
  };
}

// Réserve l'élément (deux personnes, double clic) : seul un message encore « Te controleren » passe.
async function claimOpen(id) {
  const rec = await getRecord(id);
  if (!rec || !isOpen(rec)) return { error: "Dit bericht is al behandeld", status: 409 };
  const from = rec.fields["Status"];
  const c = await __atomic.claim(TABLE, id, "Status", from, ST.creating);
  if (c === false) return { error: "Dit bericht is al behandeld", status: 409 };
  if (c === null) await update(id, { "Status": ST.creating }); // Airtable (banc local) : sans écriture conditionnelle
  return { rec, from };
}

/**
 * « Bestelling aanmaken » : le personnel a corrigé la proposition. Tout est revérifié ici (client
 * actif, articles actifs, quantités, jour livrable — sans l'heure limite, comme Invoeren —, prix
 * négociés du serveur). → { status, body }.
 */
async function createFromQueue(input, who) {
  const id = String(input.id || "");
  if (!REC.test(id)) return { status: 400, body: { error: "Ongeldig bericht" } };
  const clientId = String(input.clientId || "");
  if (!REC.test(clientId)) return { status: 400, body: { error: "Kies eerst de klant" } };
  const items = (Array.isArray(input.lines) ? input.lines : []).slice(0, 50).map((l) => ({ productId: String(l && l.productId || ""), quantity: Number(l && l.qty), comment: String(l && l.comment || "") }));
  const leverdag = input.dateLivraison ? String(input.dateLivraison).slice(0, 10) : "";
  const settings = await loadSettings();
  if (leverdag) { const err = __lev.checkDate(leverdag, settings.rules); if (err) return { status: 400, body: { error: err } }; }
  const client = await at(`Clients/${clientId}`);
  if (!client || client.error) return { status: 400, body: { error: "Klant niet gevonden" } };
  if (client.fields["Gearchiveerd"]) return { status: 400, body: { error: "Deze klant is gearchiveerd" } };
  let order;
  try { order = await __bestelling.buildOrderLines(clientId, items, __bestelling.MSG_PERSONEEL); }
  catch (e) { return { status: 400, body: { error: String(e.message || e) } }; }

  const claimed = await claimOpen(id);
  if (claimed.error) return { status: claimed.status, body: { error: claimed.error } };
  const notes = String(input.notes == null ? "" : input.notes).slice(0, 500);
  let created;
  try { created = await createOrder({ order, client, leverdag, notes, inboundId: id }); }
  catch (e) { await update(id, { "Status": ST.review }).catch(() => null); return { status: 500, body: { error: "Opslaan mislukt. Probeer opnieuw." } }; }
  await update(id, { "Status": ST.done, "Client": [clientId], "Commande": [created.id], "Referentie": created.ref, "Behandeld door": who.wie, "Behandeld op": nowIso() });
  await __journal.log({ wie: who.wie, rol: who.rol, actie: "Mailbestelling aangemaakt", object: TABLE, record: id, referentie: created.ref, reden: claimed.rec.fields["Reden"] || "" });
  // Confirmation à l'expéditeur s'il est une adresse connue de CE client ; sinon à l'adresse de la fiche client.
  const van = String(claimed.rec.fields["Van"] || "");
  const known = van ? (await findSender(van).catch(() => [])).some((x) => x.client.id === clientId) : false;
  const mail = await notifyCreated({ created, client, leverdag, notes, to: known ? van : "", req: who.req });
  return { status: 200, body: { ok: true, ref: created.ref, id: created.id, total: created.total, mail } };
}

/** « Negeren » : avec une raison, journalisé. Aucun e-mail. */
async function ignoreFromQueue(input, who) {
  const id = String(input.id || "");
  const reden = String(input.reden || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!REC.test(id)) return { status: 400, body: { error: "Ongeldig bericht" } };
  if (reden.length < 3) return { status: 400, body: { error: "Geef een reden op" } };
  const claimed = await claimOpen(id);
  if (claimed.error) return { status: claimed.status, body: { error: claimed.error } };
  await update(id, { "Status": ST.ignored, "Reden": "genegeerd: " + reden, "Behandeld door": who.wie, "Behandeld op": nowIso() });
  await __journal.log({ wie: who.wie, rol: who.rol, actie: "Mailbestelling genegeerd", object: TABLE, record: id, referentie: String(claimed.rec.fields["Van"] || "").slice(0, 120), reden });
  return { status: 200, body: { ok: true } };
}

/** « Opnieuw laten lezen » : Claude relit le message pour le client choisi ; reste dans la file. */
async function reanalyse(input, who) {
  const id = String(input.id || ""), clientId = String(input.clientId || "");
  if (!REC.test(id) || !REC.test(clientId)) return { status: 400, body: { error: "Kies eerst de klant" } };
  const rec = await getRecord(id);
  if (!rec || !isOpen(rec)) return { status: 409, body: { error: "Dit bericht is al behandeld" } };
  if (!rec.fields["Tekst"]) return { status: 400, body: { error: "Geen tekst om te lezen" } };
  if (!claude.enabled()) return { status: 503, body: { error: "Automatisch lezen staat niet aan (ANTHROPIC_API_KEY ontbreekt)" } };
  if ((await aiCallsToday()) >= aiPerDay()) return { status: 429, body: { error: "Daglimiet voor automatisch lezen bereikt" } };
  const client = await at(`Clients/${clientId}`);
  if (!client || client.error) return { status: 400, body: { error: "Klant niet gevonden" } };
  const settings = await loadSettings();
  const a = await analyse(id, { text: rec.fields["Tekst"], subject: rec.fields["Onderwerp"] || "" }, client, settings);
  if (a.reason) return { status: 502, body: { error: a.reason } };
  await update(id, { "Client": [clientId], "Voorstel": voorstelOf(a.proposal, a.check.leverdag), "Reden": a.check.problems.join("; ").slice(0, 500) || "nagelezen: controleer en maak aan" });
  await __journal.log({ wie: who.wie, rol: who.rol, actie: "Mailbestelling nagelezen", object: TABLE, record: id, referentie: client.fields["Nom"] || "", reden: "" });
  return { status: 200, body: { ok: true } };
}

// ---- RGPD et conservation -----------------------------------------------------------------------
/** Messages d'un client (lien Client ou expéditeur = une de ses adresses), pour l'export et l'anonymisation. */
async function forClient(clientId, emails) {
  const r = await atAll(T).catch(() => ({ records: [] }));
  const adr = new Set((emails || []).flatMap(addressesOf));
  return ((r && r.records) || []).filter((x) => (x.fields["Client"] || []).includes(clientId) || adr.has(String(x.fields["Van"] || "").toLowerCase()));
}
const exportOf = (recs) => recs.map((r) => ({ ontvangen: r.fields["Ontvangen op"] || r.createdTime, van: r.fields["Van"] || "", onderwerp: r.fields["Onderwerp"] || "", tekst: r.fields["Tekst"] || "", status: r.fields["Status"] || "", reden: r.fields["Reden"] || "", referentie: r.fields["Referentie"] || "" }));

async function remove(ids) {
  let n = 0;
  for (const id of ids) { const r = await at(`${T}/${id}`, { method: "DELETE" }); if (r && !r.error) n++; }
  return n;
}

/** Conservation : messages de plus de 90 jours supprimés (cron quotidien api/reminders-cron.js). */
async function purge(nowMs) {
  const limit = (nowMs == null ? Date.now() : nowMs) - RETENTION_DAYS * 864e5;
  const r = await atAll(`${T}?fields%5B%5D=Status`);
  if (r.error) return { removed: 0, error: true };
  const old = (r.records || []).filter((x) => Date.parse(x.createdTime || 0) < limit).map((x) => x.id);
  const removed = await remove(old);
  if (removed) log.info("inbound-mail", "oude inkomende mails verwijderd", { removed, days: RETENTION_DAYS });
  return { removed };
}

module.exports = {
  TABLE, ST, MIN_CONFIDENCE, MAX_PER_HOUR, RETENTION_DAYS, MAX_QTY, DEFAULT_ADDRESS,
  handleWebhook, check, firstDeliverable, senderVerified, recordIdFor, status, loadSettings,
  openIds, listForStaff, createFromQueue, ignoreFromQueue, reanalyse, forClient, exportOf, remove, purge
};
