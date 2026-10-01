"use strict";
// Authentification client (portail klant).
//
// Mots de passe : stockés HACHÉS (scrypt, même format que les codes staff :
// scrypt$<N>$<sel>$<empreinte> ; l'ancien scrypt$<sel>$<empreinte> est ré-haché à la
// connexion). Un ancien mot de passe encore en clair reste accepté une fois puis est
// remplacé par son empreinte à la connexion réussie (migration douce, sans action du
// client ni de Beheer) ; Beheer peut aussi tout hacher d'un coup (action hashAllPasswords).
//
// Jeton client : après la connexion, le serveur pose un jeton signé (HMAC, 12 h, renouvelé à
// chaque ouverture du catalogue) dans le cookie HttpOnly famo_klant (voir plus bas) ; le
// navigateur ne garde ni le jeton ni le mot de passe. Format :
// k.<recId>.<exp>.<empreinte courte>.<iat>.<génération>.<signature>.
//  - l'empreinte courte dérive du mot de passe stocké : changer ou réinitialiser le mot de
//    passe invalide tous les jetons existants de ce client ;
//  - iat = instant de la connexion par mot de passe, conservé aux renouvellements : un
//    jeton ne vit jamais plus de 7 jours après elle (MAX_AGE_MS), même renouvelé ;
//  - génération = champ Clients « Sessiegeneratie », +1 à la déconnexion (action logout de
//    api/klantwachtwoord.js) : les jetons de ce client sur tous ses appareils tombent.
// Les jetons de l'ancien format (5 segments) sont refusés : une reconnexion.
const crypto = require("crypto");
const auth = require("./staffauth");

const TOKEN_TTL_MS = 12 * 3600 * 1000;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function isHashed(stored) {
  return /^scrypt\$(\d+\$)?[0-9a-f]+\$[0-9a-f]+$/i.test(String(stored || ""));
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

const generationOf = rec => Math.max(0, Math.floor(Number(rec && rec.fields && rec.fields["Sessiegeneratie"]) || 0));

// iat : celui du jeton renouvelé (authClient le pose sur rec.tokenIat), sinon maintenant.
function issueToken(rec, iat) {
  const now = Date.now();
  const born = Number(iat) > 0 && Number(iat) <= now ? Math.floor(Number(iat)) : now;
  const exp = Math.min(now + TOKEN_TTL_MS, born + MAX_AGE_MS);
  const payload = "k." + rec.id + "." + exp + "." + fingerprint(rec.fields && rec.fields["Wachtwoord"]) + "." + born + "." + generationOf(rec);
  return payload + "." + auth.hmac(payload);
}

// Renvoie { id, fp, iat, gen } si la signature et les échéances sont bonnes, sinon null.
// La génération et l'empreinte se comparent ensuite à l'enregistrement (authClient).
function readToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 7 || parts[0] !== "k") return null;
  const [, id, exp, fp, iat, gen, sig] = parts;
  const now = Date.now();
  if (!/^[A-Za-z0-9]{1,40}$/.test(id) || !(Number(exp) > now) || !/^\d{1,15}$/.test(iat) || !(Number(iat) + MAX_AGE_MS > now) || !/^\d{1,12}$/.test(gen)) return null;
  const good = Buffer.from(auth.hmac(parts.slice(0, 6).join(".")));
  const got = Buffer.from(String(sig));
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  return { id, fp, iat: Number(iat), gen: Number(gen) };
}

// Lien « choisir un mot de passe » (wachtwoord.html?t=…), envoyé par e-mail au lieu d'un
// mot de passe en clair : r.<recId>.<exp>.<empreinte du mot de passe ACTUEL>.<signature>.
// Lié à l'empreinte : dès que le mot de passe change (lien utilisé, changement via Account
// ou nouveau reset par Beheer), le lien ne vaut plus rien — usage unique sans table.
// Préfixe distinct : un jeton de session ne peut pas servir de lien, ni l'inverse.
const RESET_TTL_MS = 30 * 60000, ACTIVATION_TTL_MS = 72 * 3600000;
function issueResetToken(rec, ttlMs) {
  const exp = Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : RESET_TTL_MS);
  const payload = "r." + rec.id + "." + exp + "." + fingerprint(rec.fields && rec.fields["Wachtwoord"]);
  return payload + "." + auth.hmac("reset:" + payload);
}
function readResetToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 5 || parts[0] !== "r") return null;
  const [, id, exp, fp, sig] = parts;
  if (!/^[A-Za-z0-9]{1,40}$/.test(id) || !(Number(exp) > Date.now()) || Number(exp) > Date.now() + ACTIVATION_TTL_MS + 60000) return null;
  const good = Buffer.from(auth.hmac("reset:" + parts.slice(0, 4).join(".")));
  const got = Buffer.from(String(sig));
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  return { id, fp };
}

// ---- Cookie de session client (IDEAS B3, specs/013-cookie-client-httponly) ----------------------
// Le jeton ci-dessus ne passe plus par JavaScript : le serveur le pose dans le cookie famo_klant
// (HttpOnly : illisible par un script injecté ; Secure ; SameSite=Strict : seuls les fetch des
// pages du portail l'envoient ; Path=/api : jamais joint aux pages ni aux fichiers statiques).
// Max-Age = durée restante du jeton : la vérité reste le jeton signé (échéance, 7 jours,
// empreinte, génération), un cookie trafiqué ne prolonge rien.
const COOKIE = "famo_klant";
// Transition : le jeton dans le CORPS (ancienne version des pages, gardé dans l'onglet) reste
// accepté jusqu'au 31/10/2026 inclus, heure de Bruxelles, puis il est ignoré. Un jeton vit au plus
// 7 jours après la connexion : tout jeton émis avant le déploiement est mort bien avant.
// Suivi : retirer ce chemin après cette date (specs/013-cookie-client-httponly/tasks.md).
const BODY_TOKEN_UNTIL = Date.parse("2026-11-01T00:00:00+01:00");
const bodyTokenAllowed = () => Date.now() < BODY_TOKEN_UNTIL;

function cookieToken(req) {
  const c = String((req && req.headers && req.headers.cookie) || "");
  const m = new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]*)").exec(c);
  if (!m || !m[1]) return "";
  try { return decodeURIComponent(m[1]); } catch (e) { return ""; }
}

// Même règle que le cookie du personnel (lib/staffauth.js) : Secure toujours, sauf test http sur
// une IP locale (FAMO_DEV_HTTP=1), jamais sur Vercel. Lu à chaque appel.
function attrs(maxAgeSec) {
  const devHttp = process.env.FAMO_DEV_HTTP === "1" && !process.env.VERCEL;
  return "; HttpOnly;" + (devHttp ? "" : " Secure;") + " SameSite=Strict; Path=/api; Max-Age=" + Math.max(0, Math.floor(maxAgeSec));
}
// Ajoute (ou remplace) famo_klant sans écraser un autre Set-Cookie de la même réponse.
function putCookie(res, value) {
  if (!res || typeof res.setHeader !== "function") return;
  const prev = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : undefined;
  const others = (prev == null || prev === "" ? [] : [].concat(prev)).filter(x => !String(x).startsWith(COOKIE + "="));
  res.setHeader("Set-Cookie", others.length ? others.concat(value) : value);
}
function setSessionCookie(res, token) {
  const exp = Number(String(token || "").split(".")[2]) || 0;
  putCookie(res, COOKIE + "=" + encodeURIComponent(token) + attrs((exp - Date.now()) / 1000));
}
function clearSessionCookie(res) {
  putCookie(res, COOKIE + "=" + attrs(0));
}

// L'identifiant affiché par l'onglet (non secret) correspond-il à la fiche de connexion ?
const sameUser = (login, user) => String((login && login.fields && login.fields["Gebruikersnaam"]) || "").toLowerCase().trim() === String(user || "").toLowerCase().trim();

module.exports = { isHashed, needsRehash: auth.needsRehash, hashPassword, checkPassword, fingerprint, issueToken, readToken, generationOf, issueResetToken, readResetToken, TOKEN_TTL_MS, MAX_AGE_MS, RESET_TTL_MS, ACTIVATION_TTL_MS, COOKIE, BODY_TOKEN_UNTIL, bodyTokenAllowed, cookieToken, setSessionCookie, clearSessionCookie, sameUser };
