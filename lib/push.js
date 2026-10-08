"use strict";
// Pushmeldingen (specs/025-pushmeldingen) : la règle métier au-dessus de lib/webpush.js.
//  - Clés VAPID : VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY si définies (les deux, valides ; sinon refus explicite,
//    jamais d'autres clés en silence), sinon une paire créée à la première demande dans Configuratie
//    (« Push publieke sleutel », « Push privésleutel ») : écriture conditionnelle sur le moteur SQL puis
//    relecture, deux instances gardent la même. La clé privée ne quitte jamais le serveur (ni API, ni journal,
//    ni log) ; elle fait partie de la sauvegarde complète, comme le reste de Configuratie.
//  - Appareils : table « Pushabonnementen », un par adresse ; liste blanche des services (Apple, Google, Mozilla,
//    Microsoft, en HTTPS : le serveur n'envoie jamais de requête vers une adresse choisie par le navigateur) ;
//    au plus 20 ; décrits par le serveur (User-Agent) ; « Sleutel » = empreinte de la clé publique au moment de
//    l'inscription (clés changées → l'appareil est retiré sans envoi : il ne pourrait que refuser).
//  - Envoi : tous les appareils en parallèle, 4 s chacun au plus (PUSH_TIMEOUT_MS) ; 2xx → « Laatst verstuurd » ;
//    404/410 → appareil retiré ; autre → « Laatste fout ». newOrder / mailToReview ne jettent jamais : une
//    commande n'échoue jamais à cause d'une notification.
//  - Contenu : client, montant, jour de livraison (ou expéditeur et sujet d'un e-mail à contrôler) ; jamais
//    l'adresse, le téléphone ni les lignes.
//  - Moteur SQL seulement (production : Postgres ; local : DB_BACKEND=sqlite) : sur Airtable, plus utilisé en
//    production et sans table Pushabonnementen, tout est inerte (aucune requête), comme le journal d'audit.
const crypto = require("crypto");
const { at, atAll, REC } = require("./airtable");
const W = require("./webpush");
const __atomic = require("./atomic");
const log = require("./log");

const TABLE = "Pushabonnementen";
const T = encodeURIComponent(TABLE);
const CONF = encodeURIComponent("Configuratie");
const MAX_DEVICES = 20;
const FIELDS = { pub: "Push publieke sleutel", priv: "Push privésleutel" };
const SITE = "https://www.famoseafood.be";
const SERVICES = [[/^([a-z0-9-]+\.)*push\.apple\.com$/, "Apple"], [/^fcm\.googleapis\.com$/, "Google"],
  [/^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, "Mozilla"], [/^([a-z0-9-]+\.)*notify\.windows\.com$/, "Microsoft"]];
const enabled = () => require("./datastore").backend() !== "airtable";
const OFF = "Meldingen vereisen de SQL-database (DB_BACKEND=postgres, of sqlite lokaal).";
const timeoutMs = () => (Number(process.env.PUSH_TIMEOUT_MS) > 0 ? Number(process.env.PUSH_TIMEOUT_MS) : 4000);
const nowIso = () => new Date().toISOString();

// ---- Services, appareils ------------------------------------------------------------------------
/** Service de notification d'une adresse (« Apple »…), "" si elle n'est pas sur la liste blanche. */
function dienst(endpoint) {
  let u;
  try { u = new URL(String(endpoint || "")); } catch (e) { return ""; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return "";
  const hit = SERVICES.find(([re]) => re.test(u.hostname.toLowerCase()));
  return hit ? hit[1] : "";
}

/** Libellé court de l'appareil, tiré du User-Agent par le serveur (« iPhone · Safari »). */
function toestel(ua) {
  const s = String(ua || "");
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows"
    : /CrOS/.test(s) ? "Chromebook" : /Macintosh|Mac OS X/.test(s) ? "Mac" : /Linux/.test(s) ? "Linux" : "";
  const br = /Edg(e|A|iOS)?\//.test(s) ? "Edge" : /Firefox\/|FxiOS/.test(s) ? "Firefox" : /OPR\//.test(s) ? "Opera" : /SamsungBrowser/.test(s) ? "Samsung"
    : /CriOS|Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ") || "Onbekend toestel";
}

/** PushSubscription.toJSON() du navigateur → { endpoint, p256dh, auth } normalisés, ou { error }. */
function parseSubscription(sub) {
  const s = sub && typeof sub === "object" ? sub : {};
  const endpoint = typeof s.endpoint === "string" ? s.endpoint.trim() : "";
  if (!endpoint || endpoint.length > 1000) return { error: "Ongeldig adres van de meldingsdienst" };
  if (!dienst(endpoint)) return { error: "Onbekende meldingsdienst: enkel Apple, Google, Mozilla of Microsoft (https)" };
  const k = s.keys && typeof s.keys === "object" ? s.keys : {};
  let p256dh, auth;
  try { p256dh = W.unb64u(String(k.p256dh || "")); auth = W.unb64u(String(k.auth || "")); } catch (e) { return { error: "Ongeldige sleutels van het toestel" }; }
  if (!W.validPoint(p256dh) || auth.length !== 16) return { error: "Ongeldige sleutels van het toestel" };
  return { endpoint, p256dh: W.b64u(p256dh), auth: W.b64u(auth) };
}

const fingerprint = (publicKey) => crypto.createHash("sha256").update(String(publicKey)).digest("base64url").slice(0, 16);

// ---- Clés -------------------------------------------------------------------------------------------
const validEmail = (s) => /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[A-Za-z]{2,}$/.test(String(s || ""));
function subjectOf(fields) {
  const env = String(process.env.VAPID_SUBJECT || "").trim();
  if (/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(env)) return env;
  const mail = String((fields || {})["E-mail"] || "").trim();
  return validEmail(mail) ? "mailto:" + mail : SITE;
}
const pairOf = (f) => {
  const publicKey = String((f || {})[FIELDS.pub] || ""), privateKey = String((f || {})[FIELDS.priv] || "");
  return publicKey && privateKey && W.validKeys(publicKey, privateKey) ? { publicKey, privateKey } : null;
};
async function configRecord() {
  const r = await at(CONF + "?maxRecords=1");
  if (!r || r.error) throw new Error("Configuratie onleesbaar");
  return (r.records || [])[0] || null;
}

async function loadKeys() {
  const envPub = String(process.env.VAPID_PUBLIC_KEY || "").trim(), envPriv = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  if (envPub || envPriv) {
    if (!W.validKeys(envPub, envPriv)) return { error: "Meldingen niet beschikbaar: VAPID_PUBLIC_KEY en VAPID_PRIVATE_KEY (Vercel) zijn onvolledig of vormen geen paar." };
    const rec = await configRecord().catch(() => null);
    return { publicKey: envPub, privateKey: envPriv, bron: "env", subject: subjectOf(rec && rec.fields) };
  }
  const rec = await configRecord();
  if (!rec) return { error: "Meldingen niet beschikbaar: vul eerst de bedrijfsgegevens in (Beheer → Bedrijfsgegevens)." };
  let pair = pairOf(rec.fields);
  if (!pair) {
    const fresh = W.generateKeys();
    const fields = { [FIELDS.pub]: fresh.publicKey, [FIELDS.priv]: fresh.privateKey };
    // Moteur SQL : écrire seulement si aucune paire valide n'existe encore (une autre instance a pu écrire avant).
    const r = await __atomic.mutate("Configuratie", rec.id, (f) => (pairOf(f) ? { skip: true } : { fields }));
    if (r === null) { // Airtable : pas d'écriture conditionnelle, la relecture tranche
      const w = await at(CONF + "/" + rec.id, { method: "PATCH", body: JSON.stringify({ fields }) });
      if (w && w.error) throw new Error("Meldingssleutels niet bewaard");
    } else if (r && r.error) throw new Error("Meldingssleutels niet bewaard");
    const again = await configRecord();
    pair = again && pairOf(again.fields);
    if (!pair) throw new Error("Meldingssleutels niet bewaard");
    log.info("push", "meldingssleutels aangemaakt in Configuratie", {});
  }
  return Object.assign(pair, { bron: "db", subject: subjectOf(rec.fields) });
}

// Une seule lecture / création à la fois par instance : deux premières activations simultanées reçoivent la même paire.
let inflight = null;
function keys() {
  if (!enabled()) return Promise.resolve({ error: OFF });
  if (!inflight) {
    inflight = loadKeys()
      .catch((e) => ({ error: "Meldingen niet beschikbaar: " + String((e && e.message) || e) }))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// ---- Appareils inscrits ---------------------------------------------------------------------------
async function all() {
  if (!enabled()) return [];
  const r = await atAll(T);
  if (!r || r.error) throw new Error("Pushabonnementen onleesbaar");
  return r.records || [];
}
async function patchRec(id, fields) {
  const r = await at(T + "/" + id, { method: "PATCH", body: JSON.stringify({ fields }) });
  if (r && r.error) throw new Error("Pushabonnement niet bijgewerkt");
  return r;
}
async function del(id) {
  const r = await at(T + "/" + id, { method: "DELETE" });
  if (r && r.error) throw new Error("Pushabonnement niet verwijderd");
  return r;
}

/** « Aanzetten » : { subscription, sleutel? } du navigateur ; who = { wie, rol, ua }. → { status, body }. */
async function subscribe(input, who) {
  const b = input && typeof input === "object" ? input : {};
  const s = parseSubscription(b.subscription);
  if (s.error) return { status: 400, body: { error: s.error } };
  const k = await keys();
  if (k.error) return { status: 503, body: { error: k.error } };
  // Le navigateur dit avec quelle clé publique il s'est inscrit : une autre que la nôtre ne recevra jamais rien.
  if (b.sleutel && String(b.sleutel) !== k.publicKey) return { status: 409, body: { error: "Dit toestel gebruikt nog een oude sleutel. Zet de meldingen opnieuw aan.", oudeSleutel: true } };
  const w = who || {};
  const fields = { Endpoint: s.endpoint, P256dh: s.p256dh, Auth: s.auth, Sleutel: fingerprint(k.publicKey), Wie: String(w.wie || "").slice(0, 60),
    Rol: String(w.rol || "").slice(0, 20), Toestel: toestel(w.ua), Dienst: dienst(s.endpoint) };
  const recs = await all();
  const same = recs.filter((r) => r.fields.Endpoint === s.endpoint);
  if (same.length) {
    await patchRec(same[0].id, Object.assign({}, fields, { "Laatste fout": "", "Fout op": "" }));
    for (const r of same.slice(1)) await del(r.id).catch(() => null); // doublon : deux « Aanzetten » en même temps
    return { status: 200, body: { ok: true, id: same[0].id, nieuw: false, toestel: fields.Toestel } };
  }
  if (recs.length >= MAX_DEVICES) return { status: 409, body: { error: "Maximum " + MAX_DEVICES + " toestellen met meldingen. Verwijder er eerst één in Beheer → Toegang." } };
  const j = await at(T, { method: "POST", body: JSON.stringify({ records: [{ fields: Object.assign({ "Aangemaakt op": nowIso() }, fields) }] }) });
  if (!j || j.error || !j.records) throw new Error("Pushabonnement niet bewaard");
  return { status: 200, body: { ok: true, id: j.records[0].id, nieuw: true, toestel: fields.Toestel } };
}

/** « Uitzetten » : retire cette adresse (rien à faire si elle n'est plus inscrite). */
async function unsubscribe(endpoint) {
  const ep = typeof endpoint === "string" ? endpoint : "";
  if (!ep || ep.length > 1000) return { status: 400, body: { error: "Toestel onbekend" } };
  const mine = (await all()).filter((r) => r.fields.Endpoint === ep);
  for (const r of mine) await del(r.id);
  return { status: 200, body: { ok: true, removed: mine.length, toestel: mine.length ? mine[0].fields.Toestel || "" : "" } };
}

/** L'appareil est-il inscrit, avec la clé publique actuelle ? */
async function isSubscribed(endpoint) {
  const ep = typeof endpoint === "string" ? endpoint : "";
  if (!ep) return false;
  const k = await keys();
  if (k.error) return false;
  const fp = fingerprint(k.publicKey);
  return (await all()).some((r) => r.fields.Endpoint === ep && r.fields.Sleutel === fp);
}

/** Beheer → Toegang : qui, quel appareil, depuis quand, dernier envoi, dernière erreur. Ni adresse ni clés. */
async function list() {
  return (await all()).map((r) => {
    const f = r.fields || {};
    return { id: r.id, wie: f.Wie || "", rol: f.Rol || "", toestel: f.Toestel || "", dienst: f.Dienst || "", sinds: f["Aangemaakt op"] || r.createdTime || "",
      laatst: f["Laatst verstuurd"] || "", fout: f["Laatste fout"] || "", foutOp: f["Fout op"] || "" };
  }).sort((a, b) => String(b.sinds).localeCompare(String(a.sinds)));
}

/** Beheer → Toegang : retirer un appareil. */
async function remove(id) {
  const rid = String(id || "");
  if (!REC.test(rid)) return { status: 400, body: { error: "Ongeldig toestel" } };
  const mine = (await all()).find((r) => r.id === rid);
  if (!mine) return { status: 404, body: { error: "Toestel niet gevonden" } };
  await del(rid);
  return { status: 200, body: { ok: true, toestel: mine.fields.Toestel || "" } };
}

// ---- Messages ---------------------------------------------------------------------------------------
const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
function dayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m || +m[2] < 1 || +m[2] > 12) return "";
  return DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).getUTCDay()] + " " + Number(m[3]) + " " + MONTHS[+m[2] - 1];
}
function eur(n) {
  const [i, d] = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).split(".");
  return "€ " + i.replace(/\B(?=(\d{3})+$)/g, ".") + "," + d;
}
const cut = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const message = {
  newOrder: (o) => {
    const day = dayLabel(o.dateLivraison);
    return { title: o.viaMail ? "Nieuwe bestelling (e-mail)" : "Nieuwe bestelling", body: [cut(o.klant || "Klant", 60), eur(o.total)].concat(day ? ["levering " + day] : []).join(" · "),
      url: "/team/vandaag", tag: "bestelling-" + String(o.id || "") };
  },
  review: (m) => {
    const who = cut(m.klant || m.van || "Onbekende afzender", 60), subj = cut(m.onderwerp, 80);
    return { title: "E-mail te controleren", body: subj ? who + ": " + subj : who, url: "/team/bestellingen#/controle", tag: "mail-" + String(m.id || "") };
  },
  test: () => ({ title: "FAMO · Test", body: "Meldingen werken op dit toestel.", url: "/team/vandaag", tag: "test" })
};

// ---- Envoi ------------------------------------------------------------------------------------------
/** Envoie msg à chaque appareil (ou au seul opts.only). → { sent, failed, removed, results[], error? }. */
async function sendAll(msg, opts) {
  const o = opts || {};
  const out = { sent: 0, failed: 0, removed: 0, results: [] };
  if (!enabled()) return Object.assign(out, { error: OFF });
  // Les appareils d'abord : sans appareil inscrit, une commande ne coûte qu'une lecture (ni clés, ni envoi).
  const recs = (await all()).filter((r) => !o.only || (r.fields || {}).Endpoint === o.only);
  if (!recs.length) return out;
  const k = await keys();
  if (k.error) { out.error = k.error; log.warn("push", "geen meldingssleutels: niets verstuurd", { reden: k.error }); return out; }
  const fp = fingerprint(k.publicKey);
  const seen = new Set(), targets = [], stale = [];
  for (const r of recs) {
    const f = r.fields || {};
    // Autre clé publique (clés changées) ou adresse hors liste blanche : jamais d'envoi, l'appareil est retiré.
    if (f.Sleutel !== fp || !dienst(f.Endpoint)) { stale.push(r); continue; }
    if (seen.has(f.Endpoint)) continue;
    seen.add(f.Endpoint); targets.push(r);
  }
  for (const r of stale) { await del(r.id).then(() => { out.removed++; }, () => null); }
  const payload = Buffer.from(JSON.stringify(msg), "utf8");
  await Promise.all(targets.map(async (r) => {
    const f = r.fields;
    const res = await W.send({ endpoint: f.Endpoint, keys: { p256dh: f.P256dh, auth: f.Auth } }, payload, { vapid: k, subject: k.subject, timeoutMs: timeoutMs() });
    out.results.push(Object.assign({ id: r.id }, res));
    if (res.ok) { out.sent++; await patchRec(r.id, { "Laatst verstuurd": nowIso(), "Laatste fout": "", "Fout op": "" }).catch(() => null); }
    else if (res.gone) { out.removed++; await del(r.id).catch(() => null); }
    else { out.failed++; await patchRec(r.id, { "Laatste fout": String(res.error || "fout").slice(0, 200), "Fout op": nowIso() }).catch(() => null); }
  }));
  if (out.failed || out.removed) log.warn("push", "niet alle meldingen verstuurd", { soort: String(msg.tag || "").split("-")[0], sent: out.sent, failed: out.failed, removed: out.removed });
  return out;
}

/** Nouvelle commande (portail client, e-mail). Ne jette jamais. o = { id, ref, klant, total, dateLivraison, viaMail }. */
async function newOrder(o) {
  if (!enabled()) return null;
  try { return await sendAll(message.newOrder(o || {})); }
  catch (e) { log.warn("push", "melding nieuwe bestelling niet verstuurd", { ref: o && o.ref, err: e }); return null; }
}

/** E-mail mis en « Te controleren ». Ne jette jamais. m = { id, van, klant, onderwerp }. */
async function mailToReview(m) {
  if (!enabled()) return null;
  try { return await sendAll(message.review(m || {})); }
  catch (e) { log.warn("push", "melding te controleren niet verstuurd", { recId: m && m.id, err: e }); return null; }
}

/** « Test sturen » : vers CET appareil seulement. → { status, body }. */
async function test(endpoint) {
  const ep = typeof endpoint === "string" ? endpoint : "";
  if (!ep || ep.length > 1000) return { status: 400, body: { error: "Toestel onbekend" } };
  if (!(await all()).some((r) => r.fields.Endpoint === ep)) return { status: 404, body: { error: "Dit toestel is niet ingeschreven. Zet de meldingen eerst aan." } };
  const out = await sendAll(message.test(), { only: ep });
  if (out.error) return { status: 503, body: { error: out.error } };
  if (out.sent) return { status: 200, body: { ok: true } };
  if (out.removed) return { status: 410, body: { error: "Dit toestel is niet meer ingeschreven bij de meldingsdienst. Zet de meldingen opnieuw aan.", uit: true } };
  const r = out.results[0];
  return { status: 502, body: { error: "Versturen mislukt: " + (r ? r.error : "onbekende fout") + ". Probeer later opnieuw." } };
}

module.exports = { TABLE, MAX_DEVICES, FIELDS, enabled, keys, fingerprint, dienst, toestel, parseSubscription, subscribe, unsubscribe, isSubscribed, list, remove,
  message, sendAll, newOrder, mailToReview, test };
