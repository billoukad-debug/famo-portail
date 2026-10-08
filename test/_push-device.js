"use strict";
// Appareil simulé pour les tests des pushmeldingen (specs/025) : la moitié « navigateur » de RFC 8291, écrite
// SANS lib/webpush.js (indépendante de ce qu'elle vérifie) : paire ECDH P-256 et secret d'authentification de
// l'appareil, déchiffrement aes128gcm (RFC 8188), vérification de l'en-tête VAPID (RFC 8292).
const crypto = require("crypto");
const assert = require("node:assert");

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, len));

/** Nouvel appareil inscrit chez un service de notification (Apple par défaut). */
function device(base, opts) {
  const o = opts || {};
  const ecdh = crypto.createECDH("prime256v1");
  if (o.privateKey) ecdh.setPrivateKey(Buffer.from(o.privateKey, "base64url")); else ecdh.generateKeys();
  const auth = o.auth ? Buffer.from(o.auth, "base64url") : crypto.randomBytes(16);
  const endpoint = (base || "https://web.push.apple.com/") + crypto.randomBytes(24).toString("base64url");
  return { ecdh, auth, subscription: { endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } } };
}

/** Corps aes128gcm reçu par le service → texte en clair (un seul enregistrement, délimiteur 0x02). */
function decrypt(body, dev) {
  const b = Buffer.from(body);
  const salt = b.subarray(0, 16), rs = b.readUInt32BE(16), idlen = b[20];
  assert.equal(idlen, 65, "keyid = clé publique éphémère du serveur (65 octets)");
  const asPublic = b.subarray(21, 21 + idlen), ct = b.subarray(21 + idlen);
  assert.ok(ct.length > 16 && ct.length <= rs, "un seul enregistrement");
  const uaPublic = dev.ecdh.getPublicKey();
  const secret = dev.ecdh.computeSecret(asPublic);
  const ikm = hkdf(dev.auth, secret, Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const padded = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let i = padded.length - 1;
  while (i >= 0 && padded[i] === 0) i--;
  assert.equal(padded[i], 2, "délimiteur du dernier enregistrement (0x02)");
  return padded.subarray(0, i).toString("utf8");
}

/** En-tête « Authorization: vapid t=<JWT>, k=<clé> » d'une requête → revendications du JWT, signature vérifiée. */
function vapid(req, publicKey) {
  const h = (req && req.headers) || {};
  const raw = String(h.Authorization || h.authorization || "");
  const m = /^vapid t=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(raw);
  assert.ok(m, "Authorization: vapid t=…, k=… (reçu : " + raw.slice(0, 40) + ")");
  if (publicKey) assert.equal(m[2], publicKey, "k = clé publique du serveur");
  const [h64, c64, s64] = m[1].split(".");
  assert.deepStrictEqual(JSON.parse(Buffer.from(h64, "base64url")), { typ: "JWT", alg: "ES256" });
  const pub = Buffer.from(m[2], "base64url");
  assert.equal(pub.length, 65); assert.equal(pub[0], 4);
  const key = crypto.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") } });
  assert.ok(crypto.verify("sha256", Buffer.from(h64 + "." + c64), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s64, "base64url")), "signature ES256 valide");
  return JSON.parse(Buffer.from(c64, "base64url"));
}

module.exports = { device, decrypt, vapid, hkdf };
