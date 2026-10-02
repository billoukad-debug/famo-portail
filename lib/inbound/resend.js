"use strict";
// Resend Receiving (e-mail entrant), specs/020-bestellen-per-mail. TOUT ce qui dépend du format de
// Resend vit ici ; le reste du code ne voit que la forme normalisée :
//   { emailId, messageId, from, fromRaw, to:[…], subject, text, receivedAt, spf, dkim, dmarc,
//     headers:{nom en minuscules: valeur}, attachments, truncated }
//
// D'après la documentation Resend (consultée le 02/10/2026) :
//  - webhook « email.received » : { type, created_at, data: { email_id, created_at, from, to[], cc[],
//    bcc[], received_for[], message_id, subject, attachments[] } } — MÉTADONNÉES SEULEMENT, ni corps
//    ni en-têtes ;
//  - le contenu se lit par GET https://api.resend.com/emails/receiving/{email_id} (Authorization:
//    Bearer RESEND_API_KEY) : { id, from, to[], subject, text (peut être null), html, html_format,
//    headers{}, authentication: { spf, dkim, dmarc }, message_id, created_at, attachments[] }.
// Hypothèses à vérifier sur le premier vrai message (spec, risque R1) : `html_format` « data_uri »
// (html en data: URI), `authentication` absent sur certains messages, `headers` en objet. La
// normalisation est défensive : un champ absent ou d'une autre forme ne fait jamais planter.
const RECEIVING = "https://api.resend.com/emails/receiving/";
const MAX_TEXT = 20000; // caractères gardés du corps (au-delà : « te controleren », bericht te lang)
const TIMEOUT_MS = Number(process.env.RESEND_FETCH_TIMEOUT_MS) > 0 ? Number(process.env.RESEND_FETCH_TIMEOUT_MS) : 8000;
const ID = /^[A-Za-z0-9-]{1,80}$/;

const str = (v) => (v == null ? "" : String(v));

/** « Naam <a@b.be> » ou « a@b.be » → « a@b.be » en minuscules ("" si illisible). */
function addressOf(value) {
  const v = Array.isArray(value) ? value[0] : value;
  const s = str(v && typeof v === "object" ? (v.email || v.address || "") : v).trim();
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(s) || /([^\s<>"',;]+@[^\s<>"',;]+)/.exec(s);
  const a = m ? m[1].toLowerCase().replace(/^mailto:/, "") : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a) ? a.slice(0, 254) : "";
}
const domainOf = (address) => str(address).split("@")[1] || "";

/** Événement du webhook (déjà vérifié) → type + métadonnées. */
function eventInfo(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const d = p.data && typeof p.data === "object" ? p.data : {};
  const emailId = str(d.email_id || d.id || d.emailId).trim();
  return {
    type: str(p.type),
    emailId: ID.test(emailId) ? emailId : "",
    createdAt: str(d.created_at || p.created_at),
    from: addressOf(d.from),
    to: (Array.isArray(d.to) ? d.to : [d.to]).map(addressOf).filter(Boolean).slice(0, 10),
    subject: str(d.subject).replace(/[\r\n]+/g, " ").trim().slice(0, 300),
    messageId: str(d.message_id).trim().slice(0, 300),
    attachments: Array.isArray(d.attachments) ? d.attachments.length : 0
  };
}

// En-têtes : objet { nom: valeur } ou liste [{ name, value }] → objet, noms en minuscules.
function headersOf(raw) {
  const out = {};
  const put = (k, v) => { const key = str(k).toLowerCase().trim(); if (key && !(key in out)) out[key] = str(Array.isArray(v) ? v[0] : v).slice(0, 500); };
  if (Array.isArray(raw)) raw.forEach((h) => h && put(h.name || h.key, h.value));
  else if (raw && typeof raw === "object") Object.entries(raw).forEach(([k, v]) => put(k, v));
  return out;
}

// Résultat d'authentification : « pass », { result: "pass" }, « Pass » → « pass » ; absent → "".
function authOf(v) {
  const s = str(v && typeof v === "object" ? (v.result || v.status || "") : v).trim().toLowerCase();
  return /^[a-z]{1,20}$/.test(s) ? s : "";
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** HTML → texte lisible (le texte brut manque parfois) : balises retirées, blocs = retours à la ligne. */
function htmlToText(html, format) {
  let h = str(html);
  if (format === "data_uri" || /^data:text\/html/i.test(h)) {
    const m = /^data:text\/html[^,]*?(;base64)?,(.*)$/is.exec(h);
    if (m) { try { h = m[1] ? Buffer.from(m[2], "base64").toString("utf8") : decodeURIComponent(m[2]); } catch (e) { h = ""; } }
  }
  return h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m0, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] || m0))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Réponse de GET /emails/receiving/{id} (+ métadonnées du webhook en repli) → forme normalisée. */
function normalise(api, meta) {
  const a = api && typeof api === "object" ? api : {};
  const m = meta || {};
  const auth = a.authentication && typeof a.authentication === "object" ? a.authentication : {};
  let text = str(a.text).replace(/\r\n?/g, "\n").trim();
  if (!text && a.html) text = htmlToText(a.html, a.html_format);
  const truncated = text.length > MAX_TEXT;
  const headers = headersOf(a.headers);
  return {
    emailId: m.emailId || str(a.id),
    messageId: str(a.message_id || m.messageId || headers["message-id"]).trim().slice(0, 300),
    from: addressOf(a.from) || addressOf(headers.from) || m.from || "",
    fromRaw: str(a.from || headers.from || m.from).replace(/[\r\n]+/g, " ").slice(0, 300),
    to: (Array.isArray(a.to) ? a.to : m.to || []).map(addressOf).filter(Boolean).slice(0, 10),
    subject: str(a.subject != null ? a.subject : m.subject).replace(/[\r\n]+/g, " ").trim().slice(0, 300),
    text: truncated ? text.slice(0, MAX_TEXT) : text,
    truncated,
    receivedAt: str(a.created_at || m.createdAt) || new Date().toISOString(),
    spf: authOf(auth.spf), dkim: authOf(auth.dkim), dmarc: authOf(auth.dmarc),
    headers,
    attachments: Array.isArray(a.attachments) ? a.attachments.length : (m.attachments || 0)
  };
}

/** Contenu d'un message reçu. → { ok:true, email } | { ok:false, reason, transient }. Ne jette jamais. */
async function fetchEmail(emailId) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, reason: "RESEND_API_KEY ontbreekt", transient: false };
  if (!ID.test(String(emailId || ""))) return { ok: false, reason: "ongeldig bericht-id", transient: false };
  try {
    const r = await fetch(RECEIVING + encodeURIComponent(emailId), { method: "GET", headers: { Authorization: "Bearer " + key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const status = Number(r.status) || 0;
    if (status < 200 || status >= 300) return { ok: false, reason: "Resend " + (status || "?"), transient: status === 429 || status >= 500 };
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== "object") return { ok: false, reason: "Resend: onleesbaar antwoord", transient: true };
    return { ok: true, email: j };
  } catch (e) {
    return { ok: false, reason: "Resend onbereikbaar (" + String(e && e.name === "TimeoutError" ? "time-out" : "netwerk") + ")", transient: true };
  }
}

/**
 * Réponse automatique, liste ou boucle ? → raison (NL) ou "". RFC 3834 (Auto-Submitted), Precedence,
 * en-têtes des répondeurs courants, et expéditeur sur l'un de nos domaines (jamais se répondre).
 */
function autoReplyReason(headers, from, ownDomains) {
  const h = headers || {};
  const auto = str(h["auto-submitted"]).toLowerCase().trim();
  if (auto && auto !== "no") return "automatisch bericht (Auto-Submitted)";
  if (/\b(bulk|auto_reply|junk|list)\b/i.test(str(h.precedence))) return "automatisch bericht (Precedence)";
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-autoresponder"]) return "automatisch antwoord";
  if (/^(mailer-daemon|postmaster|no-?reply|noreply)@/i.test(str(from))) return "automatisch bericht (afzender)";
  const d = domainOf(from);
  if (d && (ownDomains || []).some((o) => o && (d === o || d.endsWith("." + o)))) return "afzender op ons eigen domein (lus vermeden)";
  return "";
}

module.exports = { eventInfo, normalise, fetchEmail, autoReplyReason, addressOf, domainOf, htmlToText, headersOf, MAX_TEXT };
