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
// décide) | Genegeerd (réponse automatique, boucle, pas adressé à l'adresse de commande, ou écarté par
// le personnel). « Aanmaken » = réservé par un clic du personnel. Chaque réservation pose « Verwerking
// sinds » (jeton) : un Verwerken/Aanmaken dont le jeton a plus de 3 minutes (fonction interrompue)
// revient dans la file, avec la commande déjà liée s'il y en a une (jamais de seconde commande :
// avant toute création, on cherche une commande dont « Inkomende mail » = cet enregistrement).
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
const __bill = require("../billing");
const __pak = require("../verpakking"); // conditionnement (specs/023)
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
// Budget total du webhook (lecture Resend + Claude + écritures), bien sous maxDuration (vercel.json : 60 s).
const BUDGET_MS = 40000;
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
  const token = new Date().toISOString() + "#" + crypto.randomBytes(3).toString("hex");
  const fields = noEmpty({ "Bericht-id": info.emailId, "Status": ST.busy, "Verwerking sinds": token, "Ontvangen op": /^\d{4}-\d{2}-\d{2}T/.test(info.createdAt) ? info.createdAt : nowIso(), "Van": info.from, "Onderwerp": info.subject, "Message-ID": info.messageId });
  const st = store();
  if (st) {
    const id = recordIdFor(info.emailId);
    try { await st.insert(TABLE, [{ id, createdTime: nowIso(), fields }]); return { id, created: true, token }; }
    catch (e) { const cur = await st.get(TABLE, id); if (cur) return { id, created: false, fields: cur.fields }; throw e; }
  }
  // Airtable (banc local seulement) : pas d'écriture conditionnelle, lecture puis création.
  const f = encodeURIComponent(`{Bericht-id}='${escapeFormula(info.emailId)}'`);
  const ex = await at(`${T}?filterByFormula=${f}&maxRecords=1`);
  if (ex.error) throw new Error("Inkomende mails onleesbaar");
  if (ex.records && ex.records[0]) return { id: ex.records[0].id, created: false, fields: ex.records[0].fields };
  const c = await at(T, { method: "POST", body: json({ records: [{ fields }] }) });
  if (c.error) throw new Error("Inkomende mail niet bewaard");
  return { id: c.records[0].id, created: true, token };
}

// Pose un nouveau jeton « Verwerking sinds » + statut, seulement si `ok(fields)` est encore vrai
// (écriture conditionnelle sur le moteur SQL ; Airtable, banc local : lecture puis écriture).
// → le jeton posé, ou null si quelqu'un d'autre a pris l'enregistrement.
async function cas(id, ok, status) {
  const token = new Date().toISOString() + "#" + crypto.randomBytes(3).toString("hex");
  const fields = { "Status": status, "Verwerking sinds": token };
  const r = await __atomic.mutate(TABLE, id, (f) => (ok(f) ? { fields } : { skip: true }));
  if (r === null) { const cur = await getRecord(id); if (!cur || !ok(cur.fields)) return null; await update(id, fields); return token; }
  return r && r.ok ? token : null;
}
const sinceOf = (r) => Date.parse(String((r.fields || {})["Verwerking sinds"] || "").split("#")[0]) || Date.parse(r.createdTime || 0) || 0;

/** Commande déjà créée pour ce message (création réussie, écriture suivante perdue) ? */
async function linkedOrder(inboundId) {
  const f = encodeURIComponent(`{Inkomende mail}='${escapeFormula(inboundId)}'`);
  const r = await at(`Commandes?filterByFormula=${f}&maxRecords=1`);
  if (!r || r.error) throw new Error("Bestellingen onleesbaar");
  return (r.records || [])[0] || null;
}
async function adopt(id, order, who) {
  await update(id, { "Status": ST.done, "Commande": [order.id], "Referentie": order.fields["Référence"] || "", "Reden": "", "Behandeld door": who.wie, "Behandeld op": nowIso() });
  await __journal.log({ wie: who.wie, rol: who.rol || "", actie: "Mailbestelling gekoppeld", object: TABLE, record: id, referentie: order.fields["Référence"] || "", reden: "bestelling bestond al voor dit bericht" });
}

// Compteur d'appels Claude par jour de Bruxelles (lib/billing.reserve : écriture conditionnelle, une
// ligne « Compteurs » par jour, aucune lecture de la table des messages). Relectures comprises.
const aiMem = new Map(); // Airtable (banc local seulement) : pas de compteur atomique
async function reserveAiCall() {
  const series = "AI-lezingen-" + __lev.brusselsToday();
  const n = await __bill.reserve(series, 0);
  if (n != null) return n;
  aiMem.set(series, (aiMem.get(series) || 0) + 1);
  return aiMem.get(series);
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

// SPF/DKIM/DMARC : l'adresse From (en-tête) se falsifie ; SPF ne couvre que l'enveloppe et une
// signature DKIM peut venir de n'importe quel domaine. Preuve exigée : DMARC « pass », ou DKIM « pass »
// avec un domaine de signature ALIGNÉ sur le domaine du From (relâché : égal ou sous-domaine), si
// Resend l'expose. Sinon → vérification par le personnel.
const aligned = (a, b) => !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));
function senderVerified(mail) {
  if (mail.dmarc === "pass") return true;
  if (mail.dmarc) return false;
  return mail.dkim === "pass" && aligned(String(mail.dkimDomain || ""), resend.domainOf(String(mail.from || "").toLowerCase()));
}

/** Messages VÉRIFIÉS d'un expéditeur connu depuis sinceMs (des faux à son nom ne le bloquent pas). */
async function recentFrom(address, sinceMs, exceptId) {
  const f = encodeURIComponent(`AND({Van}='${escapeFormula(address)}',{Afzender geverifieerd})`);
  const r = await atAll(`${T}?filterByFormula=${f}`);
  return ((r && r.records) || []).filter((x) => x.id !== exceptId && x.fields["Afzender geverifieerd"] && Date.parse(x.createdTime || x.fields["Ontvangen op"] || 0) >= sinceMs).length;
}

/** Commande identique déjà passée aujourd'hui (même client, mêmes lignes, même jour de livraison), comme api/order.js. */
async function twinOf(clientId, lignes, leverdag) {
  const f = encodeURIComponent(`AND({Date}='${__lev.brusselsToday()}',{Statut}!='Annulée')`);
  const r = await at(`Commandes?filterByFormula=${f}`);
  if (!r || r.error) return null;
  return ((r.records) || []).find((x) => (x.fields["Client"] || []).includes(clientId) && x.fields["Lignes (produits / quantités)"] === lignes && (x.fields["Date livraison souhaitée"] || "") === (leverdag || "")) || null;
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
  const totals = new Map(); // même agrégation que lib/bestelling.buildOrderLines : un article = une ligne
  for (const l of p.lines) {
    const label = "«" + (l.naam_in_mail || "?") + "»";
    const product = l.productId ? ctx.products.get(l.productId) : null;
    if (!product) { problems.push(label + " niet gevonden in de catalogus"); continue; }
    const unit = unitKey(product.fields["Unité"]);
    if (l.confidence < MIN_CONFIDENCE) problems.push(label + " onzeker (" + Math.round(l.confidence * 100) + " %)" + (l.note ? ": " + l.note : ""));
    // Verpakking (specs/023) : « 2 dozen eieren ». Claude rend le nombre de conditionnements ; le SERVEUR
    // calcule les unités (2 × 6). Quantité en « doos » d'un article qui n'est pas vendu par doos = compté
    // en conditionnements. Désaccord, nombre non entier ou article sans conditionnement : au personnel.
    const pak = __pak.vat.pakOf(product.fields);
    const inPak = !!pak && l.unit === "carton" && unit !== "carton";
    const vp = l.verpakkingen > 0 ? l.verpakkingen : (inPak ? l.qty : 0);
    let qty = l.qty;
    if (vp > 0) {
      if (!pak) problems.push(label + ": per verpakking gevraagd, maar het artikel heeft geen verpakking in de catalogus");
      else {
        const expected = Math.round(vp * pak.per * 1000) / 1000, claimed = inPak ? Math.round(l.qty * pak.per * 1000) / 1000 : l.qty;
        if (!Number.isInteger(vp)) problems.push(label + ": " + vp + " " + pak.label + " is geen geheel aantal");
        else if (l.qty > 0 && Math.abs(claimed - expected) > 1e-9) problems.push(label + ": " + vp + " " + pak.label + " ≠ " + l.qty + " " + (UNIT_NL[inPak ? "carton" : unit] || unit) + " (" + __pak.vat.pakOne(pak, unit, "nl") + "): hoeveelheid nakijken");
        qty = expected;
      }
    }
    if (!(qty > 0)) problems.push(label + ": ongeldige hoeveelheid");
    else if (unit !== "kg" && !Number.isInteger(qty)) problems.push(label + ": enkel kg mag een decimale hoeveelheid hebben");
    else if (pak && pak.only && !__pak.vat.pakFits(qty, pak)) problems.push(label + ": enkel per " + __pak.vat.pakOne(pak, unit, "nl") + " (gevraagd: " + qty + " " + (UNIT_NL[unit] || unit) + ")");
    if (l.unit && l.unit !== unit && !(pak && vp > 0)) problems.push(label + ": eenheid in de mail (" + (UNIT_NL[l.unit] || l.unit) + ") verschilt van de catalogus (" + (UNIT_NL[unit] || unit) + ")");
    if (qty > 0) { const t = totals.get(product.id) || { qty: 0, unit, label }; t.qty = Math.round((t.qty + qty) * 1000) / 1000; totals.set(product.id, t); }
    items.push({ productId: product.id, quantity: qty, comment: l.opmerking });
  }
  for (const t of totals.values()) if (t.qty > (MAX_QTY[t.unit] || 100)) problems.push(t.label + ": ongewoon grote hoeveelheid (" + t.qty + " " + (UNIT_NL[t.unit] || t.unit) + ")");
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
  return { ref, id: j.records[0].id, total: o.order.total, lignes: o.order.lignes, json: o.order.json, date: today };
}

// Confirmations (équipe + client, dans sa langue). Ne jette jamais : la commande existe déjà.
async function notifyCreated(o) {
  try {
    if (!__ordermail.enabled()) return null;
    const cfg = await __ordermail.loadMailConfig(at);
    const url = __ordermail.portalUrl(o.req);
    const klant = Object.assign(__ordermail.clientFrom(o.client), o.to ? { email: o.to } : {});
    return await __ordermail.notifyNewOrder({ ref: o.created.ref, recordId: o.created.id, date: o.created.date, dateLivraison: o.leverdag, notes: o.notes,
      lignes: o.created.lignes, verpakking: __lj.pakMap(o.created.json), total: o.created.total, bron: "E-mail", viaMail: true,
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
async function analyse(id, mail, client, settings, deadline) {
  const cat = await __bestelling.catalogueFor(client.id);
  const r = await claude.parseOrder({ text: mail.text, subject: mail.subject, products: Array.from(cat.products.values()), today: __lev.brusselsToday(), deadline });
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
  const t0 = (ctx && ctx.t0) || Date.now();
  const info = resend.eventInfo(payload);
  if (info.type !== "email.received") return { status: 200, body: { ok: true, ignored: "type" } };
  if (!info.emailId) return { status: 400, body: { error: "email_id ontbreekt" } };

  const res = await reserve(info);
  const id = res.id;
  let token = res.token;
  if (!res.created) {
    const f = res.fields || {};
    // Seul un message dont le contenu n'a pas pu être lu chez Resend est repris (nouvel essai de Resend),
    // avec un nouveau jeton « Verwerking sinds » (sinon il paraîtrait bloqué pendant qu'on le traite).
    const retry = f["Status"] === ST.review && f["Inhoud ontbreekt"];
    if (retry) {
      const done = await linkedOrder(id);
      if (done) { await adopt(id, done, { wie: "automatisch", rol: "systeem" }); return { status: 200, body: { ok: true, duplicate: true, ref: done.fields["Référence"] } }; }
      token = await cas(id, (x) => x["Status"] === ST.review && !!x["Inhoud ontbreekt"], ST.busy);
    }
    if (!retry || !token) { L.info("dubbel webhook genegeerd", { recId: id }); return { status: 200, body: { ok: true, duplicate: true } }; }
  }

  const fetched = await resend.fetchEmail(info.emailId);
  if (!fetched.ok) {
    await update(id, { "Status": ST.review, "Reden": "Inhoud niet opgehaald bij Resend (" + fetched.reason + ")", "Inhoud ontbreekt": true });
    L.warn("inhoud niet opgehaald", { recId: id, reason: fetched.reason });
    return fetched.transient ? { status: 503, body: { error: "Tijdelijk niet beschikbaar, later opnieuw" } } : { status: 200, body: { ok: true, status: ST.review } };
  }
  const mail = resend.normalise(fetched.email, info);
  const settings = await loadSettings();
  const out = await decide(id, mail, settings, Object.assign({}, ctx, { token, deadline: t0 + BUDGET_MS }));
  L.info("inkomende mail verwerkt", { recId: id, status: out.status, ref: out.ref });
  return { status: 200, body: { ok: true, status: out.status, ref: out.ref } };
}

async function decide(id, mail, settings, ctx) {
  const ignore = async (reason) => { await update(id, { "Status": ST.ignored, "Reden": reason, "Van": mail.from, "Onderwerp": mail.subject, "Inhoud ontbreekt": false }); return { status: ST.ignored }; };
  // 1. Réponses automatiques, listes, nos propres domaines : jamais de réponse (pas de boucle), texte non gardé.
  const auto = resend.autoReplyReason(mail.headers, mail.from, ownDomains(settings));
  if (auto) return ignore(auto);
  // 2. Seulement ce qui est adressé (to, cc, destinataire d'enveloppe) à l'adresse de commande ; le reste du sous-domaine est ignoré sans AI.
  if (![].concat(mail.to || [], mail.cc || [], mail.receivedFor || []).includes(settings.address)) return ignore("niet aan het bestel-adres gericht (" + settings.address + ")");

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
  if (!verified) return review("afzender niet geverifieerd (DMARC, of DKIM van het eigen domein): mogelijk vervalst", { "Client": [client.id] });
  const link = { "Client": [client.id], "Afzender geverifieerd": true };
  // Plafond APRÈS la vérification : seuls ses messages vérifiés comptent ; au-delà, le personnel décide (texte gardé, pas d'accusé).
  if ((await recentFrom(mail.from, Date.now() - 3600e3, id)) >= MAX_PER_HOUR) return review("te veel berichten van deze afzender (max " + MAX_PER_HOUR + " per uur)", link);
  if (client.fields["Gearchiveerd"]) return review("klant gearchiveerd", link);
  if (!mail.text) return review(mail.attachments ? "enkel een bijlage (bijlagen worden niet gelezen)" : "leeg bericht", link, client);
  if (mail.truncated) return review("bericht te lang om automatisch te lezen", link, client);
  if (!claude.enabled()) return review("ANTHROPIC_API_KEY ontbreekt: niet automatisch gelezen", link, client);
  if ((await reserveAiCall()) > aiPerDay()) return review("daglimiet voor automatisch lezen bereikt (" + aiPerDay() + ")", link, client);

  // 4. Claude propose, le serveur vérifie.
  await update(id, Object.assign({}, base, link)); // texte gardé même si la suite échoue
  const a = await analyse(id, mail, client, settings, ctx.deadline ? ctx.deadline - 3000 : undefined);
  if (a.reason) return review(a.reason, link, client);
  const voorstel = { "Voorstel": voorstelOf(a.proposal, a.check.leverdag) };
  const problems = a.check.problems.slice();
  if (!settings.auto) problems.push("automatisch aanmaken staat uit (Beheer → Bedrijfsgegevens)");
  let order = null;
  if (!problems.length) {
    try { order = await __bestelling.buildOrderLines(client.id, a.check.items, __bestelling.MSG_PERSONEEL, { catalogue: a.catalogue }); }
    catch (e) { problems.push(String(e.message || e)); }
    if (order && settings.rules.minimum > 0 && order.total < settings.rules.minimum) problems.push("onder het minimumbedrag (€ " + settings.rules.minimum.toFixed(2).replace(".", ",") + ")");
    const twin = order ? await twinOf(client.id, order.lignes, a.check.leverdag) : null;
    if (twin) problems.push("mogelijk dubbele bestelling (" + (twin.fields["Référence"] || "") + ")");
  }
  if (problems.length) return review(problems.join("; "), Object.assign({}, link, voorstel), client);

  // 5. Commande créée comme une commande du portail, statut « Reçue ». Jamais deux : une commande déjà liée
  // est reprise, et l'enregistrement doit être encore le NÔTRE (jeton) au moment de créer.
  const mine = await getRecord(id);
  if (!mine || mine.fields["Status"] !== ST.busy || (ctx.token && mine.fields["Verwerking sinds"] !== ctx.token)) {
    log.warn("inbound-mail", "overgenomen door het personeel: geen bestelling aangemaakt", { recId: id });
    return { status: "overgenomen" };
  }
  const already = await linkedOrder(id);
  if (already) { await adopt(id, already, { wie: "automatisch", rol: "systeem" }); return { status: ST.done, ref: already.fields["Référence"] }; }
  if (!(await cas(id, (x) => x["Status"] === ST.busy && (!ctx.token || x["Verwerking sinds"] === ctx.token), ST.creating))) {
    log.warn("inbound-mail", "overgenomen door het personeel: geen bestelling aangemaakt", { recId: id });
    return { status: "overgenomen" };
  }
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
const isStuck = (r) => (r.fields["Status"] === ST.busy || r.fields["Status"] === ST.creating) && Date.now() - sinceOf(r) > STUCK_MS;
const isOpen = (r) => r.fields["Status"] === ST.review || isStuck(r);

async function openIds() {
  const r = await atAll(`${T}?fields%5B%5D=Status&fields%5B%5D=${encodeURIComponent("Verwerking sinds")}`);
  if (r.error) throw new Error("Inkomende mails onleesbaar");
  return (r.records || []).filter(isOpen).map((x) => x.id);
}

function itemOf(r, clients, withText, linked) {
  const f = r.fields || {};
  const cid = (f["Client"] || [])[0] || "";
  const c = cid ? clients.get(cid) : null;
  const stuck = isStuck(r);
  const ref = linked ? linked.fields["Référence"] || "" : "";
  return {
    id: r.id, status: stuck ? ST.review : f["Status"], ontvangen: f["Ontvangen op"] || r.createdTime, van: f["Van"] || "", onderwerp: f["Onderwerp"] || "",
    tekst: withText ? String(f["Tekst"] || "") : undefined, inhoudOntbreekt: !!f["Inhoud ontbreekt"],
    reden: linked ? "bestelling " + ref + " werd al aangemaakt voor dit bericht (verwerking onderbroken): « Bestelling aanmaken » sluit het af zonder tweede bestelling"
      : stuck ? "verwerking onderbroken: controleer en maak de bestelling zelf aan" : (f["Reden"] || ""), verificatie: f["Verificatie"] || "",
    client: c ? { id: c.id, nom: c.fields["Nom"] || "", gearchiveerd: !!c.fields["Gearchiveerd"] } : null,
    voorstel: parseJson(f["Voorstel"]), commande: linked ? { id: linked.id, ref } : (f["Commande"] || [])[0] ? { id: f["Commande"][0], ref: f["Referentie"] || "" } : null,
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
  const open = recs.filter(isOpen);
  const links = new Map();
  for (const r of open.filter(isStuck)) links.set(r.id, await linkedOrder(r.id).catch(() => null));
  return {
    items: open.map((r) => itemOf(r, clients, true, links.get(r.id))),
    afgehandeld: recs.filter((r) => !isOpen(r) && r.fields["Status"] !== ST.busy && r.fields["Status"] !== ST.creating && Date.parse(r.createdTime || 0) >= since).slice(0, 50).map((r) => itemOf(r, clients, false)),
    products: (cat.records || []).map((r) => Object.assign({ id: r.id, nom: r.fields["Produit"] || "", unite: r.fields["Unité"] || "", kaliber: String(r.fields["Kaliber"] || "").trim(), cat: r.fields["Catégorie"] || "" }, __pak.apiFields(r.fields))),
    clients: (cl.records || []).filter((r) => !r.fields["Gearchiveerd"]).map((r) => ({ id: r.id, nom: r.fields["Nom"] || "" })).sort((a, b) => a.nom.localeCompare(b.nom, "nl"))
  };
}

// Réserve l'élément (deux personnes, double clic) : seul un message encore « Te controleren » passe.
// Une commande déjà créée pour ce message (création réussie, suite perdue) est rattachée, jamais refaite.
async function claimOpen(id, who) {
  const rec = await getRecord(id);
  if (!rec || !isOpen(rec)) return { error: "Dit bericht is al behandeld", status: 409 };
  const done = await linkedOrder(id);
  if (done) { await adopt(id, done, who); return { error: "Bestelling " + (done.fields["Référence"] || "") + " bestond al voor dit bericht; het bericht is afgesloten.", status: 409 }; }
  const from = rec.fields["Status"], since = rec.fields["Verwerking sinds"] || "";
  const token = await cas(id, (x) => x["Status"] === from && String(x["Verwerking sinds"] || "") === String(since), ST.creating);
  if (!token) return { error: "Dit bericht is al behandeld", status: 409 };
  return { rec, from, token };
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

  const claimed = await claimOpen(id, who);
  if (claimed.error) return { status: claimed.status, body: { error: claimed.error } };
  const notes = String(input.notes == null ? "" : input.notes).slice(0, 500);
  let created;
  try { created = await createOrder({ order, client, leverdag, notes, inboundId: id }); }
  catch (e) { await update(id, { "Status": ST.review }).catch(() => null); return { status: 500, body: { error: "Opslaan mislukt. Probeer opnieuw." } }; }
  // Si cette écriture échoue, l'enregistrement reste « Aanmaken » : il revient dans la file après 3 min avec la commande liée.
  const linkedOk = await update(id, { "Status": ST.done, "Client": [clientId], "Commande": [created.id], "Referentie": created.ref, "Behandeld door": who.wie, "Behandeld op": nowIso() }).then(() => true, () => false);
  await __journal.log({ wie: who.wie, rol: who.rol, actie: "Mailbestelling aangemaakt", object: TABLE, record: id, referentie: created.ref, reden: claimed.rec.fields["Reden"] || "" });
  // Confirmation à l'expéditeur s'il est une adresse connue de CE client ; sinon à l'adresse de la fiche client.
  const van = String(claimed.rec.fields["Van"] || "");
  const known = van ? (await findSender(van).catch(() => [])).some((x) => x.client.id === clientId) : false;
  const mail = await notifyCreated({ created, client, leverdag, notes, to: known ? van : "", req: who.req });
  return { status: 200, body: Object.assign({ ok: true, ref: created.ref, id: created.id, total: created.total, mail }, linkedOk ? {} : { waarschuwing: "Bestelling aangemaakt; het bericht wordt later afgesloten." }) };
}

/** « Negeren » : avec une raison, journalisé. Aucun e-mail. */
async function ignoreFromQueue(input, who) {
  const id = String(input.id || "");
  const reden = String(input.reden || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!REC.test(id)) return { status: 400, body: { error: "Ongeldig bericht" } };
  if (reden.length < 3) return { status: 400, body: { error: "Geef een reden op" } };
  const claimed = await claimOpen(id, who);
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
  const client = await at(`Clients/${clientId}`);
  if (!client || client.error) return { status: 400, body: { error: "Klant niet gevonden" } };
  if ((await reserveAiCall()) > aiPerDay()) return { status: 429, body: { error: "Daglimiet voor automatisch lezen bereikt" } };
  const settings = await loadSettings();
  const a = await analyse(id, { text: rec.fields["Tekst"], subject: rec.fields["Onderwerp"] || "" }, client, settings, Date.now() + 30000);
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
  TABLE, ST, MIN_CONFIDENCE, MAX_PER_HOUR, RETENTION_DAYS, MAX_QTY, DEFAULT_ADDRESS, BUDGET_MS, STUCK_MS,
  handleWebhook, check, firstDeliverable, senderVerified, recordIdFor, status, loadSettings,
  openIds, listForStaff, createFromQueue, ignoreFromQueue, reanalyse, forClient, exportOf, remove, purge
};
