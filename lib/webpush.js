"use strict";
// Web Push standard sans dépendance (specs/025-pushmeldingen), node:crypto seulement.
//  - RFC 8291 : message chiffré de bout en bout pour l'appareil — ECDH P-256 avec une clé éphémère neuve par
//    message, secret d'authentification de l'appareil, HKDF-SHA-256, AES-128-GCM ; codage « aes128gcm » de
//    RFC 8188 (un seul enregistrement de 4096 octets, délimiteur 0x02, sans remplissage).
//  - RFC 8292 (VAPID) : le serveur prouve qui il est au service de notification par un JWT ES256 (aud = origine
//    du service, exp = 12 h, sub = contact) et donne sa clé publique dans « k ».
//  - RFC 8030 : POST vers l'adresse de l'appareil, TTL et Urgency, borné dans le temps (AbortController),
//    sans suivre de redirection.
// Les services (Apple, Google, Mozilla, Microsoft) transportent des octets chiffrés : ils ne lisent pas le contenu.
const crypto = require("crypto");

const RS = 4096;
const MAX_PLAINTEXT = 3993; // RFC 8291 §4 : 4096 − 86 (en-tête) − 1 (délimiteur) − 16 (étiquette GCM)
const JWT_TTL_S = 12 * 3600; // RFC 8292 : 24 h au plus

const b64u = (buf) => Buffer.from(buf).toString("base64url");
// base64url strict (accepte aussi le base64 classique et le remplissage « = ») ; Buffer.from seul ignorerait les
// caractères étrangers sans rien dire.
function unb64u(s) {
  if (Buffer.isBuffer(s)) return s;
  const str = String(s == null ? "" : s).trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("ongeldige base64url");
  return Buffer.from(str, "base64url");
}
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));
const pad32 = (b) => (b.length >= 32 ? b : Buffer.concat([Buffer.alloc(32 - b.length), b]));

/** Point P-256 non compressé (65 octets, 0x04‖x‖y) réellement sur la courbe. */
function validPoint(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 65 || buf[0] !== 4) return false;
  try { const e = crypto.createECDH("prime256v1"); e.generateKeys(); e.computeSecret(buf); return true; } catch (e) { return false; }
}

/** Nouvelle paire VAPID : clé publique (65 octets) et privée (32 octets) en base64url, le format usuel. */
function generateKeys() {
  const e = crypto.createECDH("prime256v1");
  e.generateKeys();
  return { publicKey: b64u(e.getPublicKey()), privateKey: b64u(pad32(e.getPrivateKey())) };
}

/** Les deux clés sont lisibles et forment une paire. */
function validKeys(publicKey, privateKey) {
  try {
    const p = unb64u(publicKey), d = unb64u(privateKey);
    if (p.length !== 65 || p[0] !== 4 || d.length !== 32) return false;
    const e = crypto.createECDH("prime256v1");
    e.setPrivateKey(d);
    return e.getPublicKey().equals(p);
  } catch (e) { return false; }
}

function signingKey(keys) {
  const p = unb64u(keys.publicKey), d = unb64u(keys.privateKey);
  return crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: b64u(d), x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)) } });
}

/** « Authorization » de RFC 8292 pour cette adresse : vapid t=<JWT ES256>, k=<clé publique>. */
function vapidHeader(endpoint, keys, subject, nowMs) {
  const now = Math.floor((nowMs || Date.now()) / 1000);
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + JWT_TTL_S, sub: subject }));
  const sig = crypto.sign("sha256", Buffer.from(head + "." + claims), { key: signingKey(keys), dsaEncoding: "ieee-p1363" });
  return "vapid t=" + head + "." + claims + "." + b64u(sig) + ", k=" + keys.publicKey;
}

/**
 * Corps « aes128gcm » (RFC 8291) pour l'appareil dont les clés sont { p256dh, auth } (base64url).
 * opts.asPrivate / opts.salt : seulement pour rejouer l'exemple de la RFC (tests) ; sinon neufs à chaque appel.
 */
function encrypt(payload, keys, opts) {
  const o = opts || {};
  const plain = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload || []);
  if (plain.length > MAX_PLAINTEXT) throw new Error("Bericht te groot voor een pushmelding (max " + MAX_PLAINTEXT + " bytes)");
  const k = keys || {};
  let uaPublic, authSecret;
  try { uaPublic = unb64u(k.p256dh); authSecret = unb64u(k.auth); } catch (e) { throw new Error("Ongeldige sleutels van het toestel"); }
  if (!validPoint(uaPublic)) throw new Error("Ongeldige sleutel van het toestel (p256dh)");
  if (authSecret.length !== 16) throw new Error("Ongeldige sleutel van het toestel (auth)");
  const as = crypto.createECDH("prime256v1");
  if (o.asPrivate) as.setPrivateKey(pad32(unb64u(o.asPrivate))); else as.generateKeys();
  const asPublic = as.getPublicKey();
  const salt = o.salt ? unb64u(o.salt) : crypto.randomBytes(16);
  if (salt.length !== 16) throw new Error("Ongeldig zout");
  const ikm = hkdf(authSecret, as.computeSecret(uaPublic), Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12);
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([c.update(plain), c.update(Buffer.from([2])), c.final(), c.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RS, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, record]);
}

/**
 * Envoie un message à un appareil { endpoint, keys }. Ne jette jamais.
 * opts : { vapid: { publicKey, privateKey }, subject, ttl (s), urgency, timeoutMs }.
 * → { ok:true, status } | { ok:false, gone:true, status, error } (404/410 : plus inscrit) | { ok:false, status, error }.
 */
async function send(sub, payload, opts) {
  const o = opts || {};
  const ms = Math.max(50, Number(o.timeoutMs) || 4000);
  let body, auth;
  try { body = encrypt(payload, sub && sub.keys); auth = vapidHeader(sub.endpoint, o.vapid, o.subject); }
  catch (e) { return { ok: false, status: 0, error: String((e && e.message) || e).slice(0, 200) }; }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("time-out")), ms);
  try {
    const r = await globalThis.fetch(sub.endpoint, {
      method: "POST", body, signal: ac.signal, redirect: "error",
      headers: { TTL: String(o.ttl || 86400), Urgency: o.urgency || "high", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: auth }
    });
    try { if (r.body && typeof r.body.cancel === "function") await r.body.cancel(); } catch (e) { /* corps sans intérêt */ }
    const status = Number(r.status) || 0;
    if (status >= 200 && status < 300) return { ok: true, status };
    if (status === 404 || status === 410) return { ok: false, gone: true, status, error: "toestel niet meer ingeschreven (" + status + ")" };
    return { ok: false, status, error: "meldingsdienst antwoordde " + status };
  } catch (e) {
    return { ok: false, status: 0, error: ac.signal.aborted ? "time-out na " + String(Math.round(ms / 100) / 10).replace(".", ",") + " s" : "netwerkfout: geen verbinding met de meldingsdienst" };
  } finally { clearTimeout(timer); }
}

module.exports = { RS, MAX_PLAINTEXT, b64u, unb64u, validPoint, generateKeys, validKeys, vapidHeader, encrypt, send };
