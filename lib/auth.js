"use strict";
// Sessies, toegangscodes en wachtwoorden.
//
// Twee onafhankelijke sessies (aparte cookies): de klant (fk_klant) en het team
// (fk_team, rol "staff" of "admin"). Een cookie is een ondertekende, verlopende
// verklaring — de server bewaart niets. Het geheim komt uit de omgeving.
//
// Toegangscodes: de code uit de omgeving (ADMIN_CODE / STAFF_CODE) geldt, tenzij
// in Configuratie een scrypt-hash staat — dan vervangt die de omgevingscode voor
// die rol. Zelfde formaat en zelfde velden als het bestaande portaal, zodat een
// code die in het ene portaal wordt gewijzigd ook in het andere werkt.
const crypto = require("crypto");
const cfg = require("./config");

const COOKIE_CLIENT = "fk_klant";
const COOKIE_TEAM = "fk_team";
const TTL_CLIENT_MS = 30 * 24 * 3600 * 1000;
const TTL_TEAM_MS = 12 * 3600 * 1000;
const TTL_DOC_MS = 120 * 24 * 3600 * 1000;
const SCRYPT_N = 16384;

function secret() {
  return crypto.createHash("sha256")
    .update("famo-kade:v1:" + cfg.airtableToken + ":" + cfg.adminCode + ":" + cfg.staffCode + ":" + cfg.sessionSecret)
    .digest();
}

function b64u(buf) { return Buffer.from(buf).toString("base64url"); }

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + sig;
}

function verify(token) {
  if (!token || typeof token !== "string") return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const body = token.slice(0, i), sig = token.slice(i + 1);
  const good = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (_) { return null; }
  if (!payload || !(Number(payload.exp) > Date.now())) return null;
  return payload;
}

// ---- Cookies ------------------------------------------------------------------
function parseCookies(req) {
  const out = {};
  const raw = (req.headers && req.headers.cookie) || "";
  raw.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function cookieString(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` +
    (cfg.insecureCookies ? "" : "; Secure");
}

function appendSetCookie(res, str) {
  const prev = res.getHeader ? res.getHeader("Set-Cookie") : null;
  const list = prev ? (Array.isArray(prev) ? prev.slice() : [prev]) : [];
  list.push(str);
  res.setHeader("Set-Cookie", list);
}

// ---- Klantsessie ---------------------------------------------------------------
function setClientSession(res, clientId) {
  const exp = Date.now() + TTL_CLIENT_MS;
  appendSetCookie(res, cookieString(COOKIE_CLIENT, sign({ k: "klant", id: clientId, exp }), Math.floor(TTL_CLIENT_MS / 1000)));
}
function clearClientSession(res) { appendSetCookie(res, cookieString(COOKIE_CLIENT, "uit", 0)); }
function clientSession(req) {
  const p = verify(parseCookies(req)[COOKIE_CLIENT]);
  return p && p.k === "klant" && p.id ? { clientId: p.id, exp: p.exp } : null;
}

// ---- Teamsessie ----------------------------------------------------------------
function setTeamSession(res, role) {
  const exp = Date.now() + TTL_TEAM_MS;
  appendSetCookie(res, cookieString(COOKIE_TEAM, sign({ k: "team", role, exp }), Math.floor(TTL_TEAM_MS / 1000)));
}
function clearTeamSession(res) { appendSetCookie(res, cookieString(COOKIE_TEAM, "uit", 0)); }
function teamSession(req) {
  if (!cfg.adminCode && !cfg.staffCode) return null; // fail-closed
  const p = verify(parseCookies(req)[COOKIE_TEAM]);
  return p && p.k === "team" && (p.role === "staff" || p.role === "admin") ? { role: p.role, exp: p.exp } : null;
}
function isAdmin(req) { const s = teamSession(req); return !!s && s.role === "admin"; }

// ---- Documentlinks (in e-mails: openen zonder in te loggen) --------------------
function docToken(kind, id) {
  return sign({ k: "doc", kind, id, exp: Date.now() + TTL_DOC_MS });
}
function verifyDocToken(token, kind, id) {
  const p = verify(token);
  return !!p && p.k === "doc" && p.kind === kind && p.id === id;
}

// ---- Codes en wachtwoorden -----------------------------------------------------
function hashCode(code) {
  const value = String(code || "");
  if (!value) return "";
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(value, salt, 32, { N: SCRYPT_N });
  return "scrypt$" + salt.toString("hex") + "$" + key.toString("hex");
}
function verifyHash(stored, provided) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const value = String(provided || "");
  if (!value) return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = crypto.scryptSync(value, salt, expected.length, { N: SCRYPT_N });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a == null ? "" : a)), y = Buffer.from(String(b == null ? "" : b));
  if (!x.length || x.length !== y.length) { crypto.timingSafeEqual(y.length ? y : Buffer.from("x"), y.length ? y : Buffer.from("x")); return false; }
  return crypto.timingSafeEqual(x, y);
}

/** Welke rol opent deze code? null = geweigerd. `stored` = {adminHash, staffHash} uit Configuratie. */
function roleForCode(provided, stored) {
  const s = stored || {};
  const code = String(provided || "");
  if (!code) return null;
  if (s.adminHash) { if (verifyHash(s.adminHash, code)) return "admin"; }
  else if (cfg.adminCode && safeEqual(code, cfg.adminCode)) return "admin";
  if (s.staffHash) { if (verifyHash(s.staffHash, code)) return "staff"; }
  else if (cfg.staffCode && safeEqual(code, cfg.staffCode)) return "staff";
  return null;
}

/** Klantwachtwoord: opgeslagen in klare tekst (compatibel met de base) óf als scrypt-hash. */
function passwordMatches(stored, provided) {
  const s = String(stored || "");
  if (!s || !provided) return false;
  if (s.startsWith("scrypt$")) return verifyHash(s, provided);
  return safeEqual(provided, s);
}

function generatePassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

// ---- Eenvoudige, best-effort drempel tegen misbruik (geheugen per instantie) ---
const _buckets = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  if (_buckets.size > 5000) _buckets.clear();
  const b = _buckets.get(key) || { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++;
  _buckets.set(key, b);
  return b.n > max;
}
function rateReset(key) { _buckets.delete(key); }

function clientIp(req) {
  const h = (req && req.headers) || {};
  const v = h["x-forwarded-for"] || h["x-real-ip"] || "";
  return String(v).split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "onbekend";
}

module.exports = {
  COOKIE_CLIENT, COOKIE_TEAM,
  sign, verify, parseCookies,
  setClientSession, clearClientSession, clientSession,
  setTeamSession, clearTeamSession, teamSession, isAdmin,
  docToken, verifyDocToken,
  hashCode, verifyHash, roleForCode, passwordMatches, generatePassword, safeEqual,
  rateLimited, rateReset, clientIp
};
