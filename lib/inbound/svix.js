"use strict";
// Signature des webhooks Resend (format Svix), specs/020-bestellen-per-mail.
//
// En-têtes : svix-id, svix-timestamp (secondes Unix), svix-signature (« v1,<base64> », plusieurs
// séparées par des espaces lors d'une rotation de secret). Secret « whsec_<base64> » : on décode la
// partie après « whsec_ », HMAC-SHA256 sur `${id}.${timestamp}.${corps brut}`, comparaison en temps
// constant avec chaque signature v1. Un horodatage à plus de 5 minutes (passé ou futur) est refusé :
// un webhook capturé ne peut pas être rejoué plus tard.
// Le corps doit être celui reçu, octet pour octet : jamais un JSON re-sérialisé.
const crypto = require("crypto");

const TOLERANCE_S = 5 * 60;

/** Octets de la clé HMAC, ou null si le secret est vide ou illisible. */
function secretKey(secret) {
  const s = String(secret || "").trim();
  if (!s) return null;
  const b64 = s.startsWith("whsec_") ? s.slice(6) : s;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(b64)) return null;
  const key = Buffer.from(b64, "base64");
  return key.length ? key : null;
}

function headerOf(headers, name) {
  const h = headers || {};
  let v = h[name];
  if (v === undefined) { const k = Object.keys(h).find((x) => x.toLowerCase() === name); v = k ? h[k] : undefined; }
  if (Array.isArray(v)) v = v[0];
  return v == null ? "" : String(v).trim();
}

/** Signature v1 attendue (base64) — exportée pour les tests et le script de démonstration. */
function sign(secret, id, timestamp, rawBody) {
  const key = secretKey(secret);
  if (!key) throw new Error("secret illisible");
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody == null ? "" : rawBody), "utf8");
  return crypto.createHmac("sha256", key).update(Buffer.concat([Buffer.from(id + "." + timestamp + ".", "utf8"), body])).digest("base64");
}

/**
 * → { ok: true, id, timestamp } | { ok: false, reason } (reason : missing-secret, missing-headers,
 * bad-timestamp, stale, bad-signature). Ne jette jamais.
 */
function verify(secret, headers, rawBody, nowMs) {
  const key = secretKey(secret);
  if (!key) return { ok: false, reason: "missing-secret" };
  const id = headerOf(headers, "svix-id"), ts = headerOf(headers, "svix-timestamp"), sigs = headerOf(headers, "svix-signature");
  if (!id || !ts || !sigs) return { ok: false, reason: "missing-headers" };
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, reason: "bad-timestamp" };
  const now = Math.floor((nowMs == null ? Date.now() : nowMs) / 1000);
  if (Math.abs(now - Number(ts)) > TOLERANCE_S) return { ok: false, reason: "stale" };
  const expected = Buffer.from(sign(secret, id, ts, rawBody), "base64");
  for (const part of sigs.split(/\s+/)) {
    const comma = part.indexOf(",");
    if (comma < 0 || part.slice(0, comma) !== "v1") continue;
    let given;
    try { given = Buffer.from(part.slice(comma + 1), "base64"); } catch (e) { continue; }
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return { ok: true, id, timestamp: Number(ts) };
  }
  return { ok: false, reason: "bad-signature" };
}

module.exports = { verify, sign, secretKey, TOLERANCE_S };
