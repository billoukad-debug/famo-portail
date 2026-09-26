"use strict";
// Authentification client (portail klant).
//
// Mots de passe : stockés HACHÉS (scrypt, même format que les codes staff :
// scrypt$<sel>$<empreinte>). Un ancien mot de passe encore en clair reste accepté une
// fois puis est remplacé par son empreinte à la connexion réussie (migration douce,
// sans action du client ni de Beheer).
//
// Jeton client : après la connexion, le navigateur garde un jeton signé (HMAC, 12 h),
// plus jamais le mot de passe. Format : k.<recId>.<exp>.<empreinte courte>.<signature>.
// L'empreinte courte dérive du mot de passe stocké : changer ou réinitialiser le mot de
// passe invalide tous les jetons existants de ce client.
const crypto = require("crypto");
const auth = require("./staffauth");

const TOKEN_TTL_MS = 12 * 3600 * 1000;

function isHashed(stored) {
  return /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/i.test(String(stored || ""));
}

function hashPassword(pw) {
  return auth.hashCode(String(pw || ""));
}

// Comparaison à temps constant, empreinte ou (ancien) texte clair.
function checkPassword(stored, provided) {
  if (!stored || provided == null || provided === "") return false;
  if (isHashed(stored)) return auth.verifyHash(stored, provided);
  const a = crypto.createHash("sha256").update(String(stored)).digest();
  const b = crypto.createHash("sha256").update(String(provided)).digest();
  return crypto.timingSafeEqual(a, b);
}

function fingerprint(stored) {
  return crypto.createHash("sha256").update("famo-klant-fp:" + String(stored || "")).digest("base64url").slice(0, 12);
}

function issueToken(rec) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = "k." + rec.id + "." + exp + "." + fingerprint(rec.fields && rec.fields["Wachtwoord"]);
  return payload + "." + auth.hmac(payload);
}

// Renvoie { id, fp } si la signature et l'échéance sont bonnes, sinon null.
function readToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 5 || parts[0] !== "k") return null;
  const [, id, exp, fp, sig] = parts;
  if (!/^[A-Za-z0-9]{1,40}$/.test(id) || !(Number(exp) > Date.now())) return null;
  const good = Buffer.from(auth.hmac(parts.slice(0, 4).join(".")));
  const got = Buffer.from(String(sig));
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  return { id, fp };
}

module.exports = { isHashed, hashPassword, checkPassword, fingerprint, issueToken, readToken, TOKEN_TTL_MS };
