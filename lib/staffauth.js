// Session staff : cookie HttpOnly signé (HMAC), 8 h.
// Fail-closed : sans STAFF_CODE ni ADMIN_CODE, aucune auth staff possible.
// Le code ne circule que via POST /api/session (body). Les autres API = cookie only.
// Deux rôles : "staff" (Bestellingen/Magazijn/Leveringen) et "admin" (tout, y compris
// Invoeren/Voorraad/Documenten/Aan de slag). ADMIN_CODE absent => aucun accès admin.
const crypto = require("crypto");
const STAFF_CODE = String(process.env.STAFF_CODE || "").trim();
const ADMIN_CODE = String(process.env.ADMIN_CODE || "").trim();
const TTL_MS = 8 * 3600 * 1000;

function secret() {
  return crypto.createHash("sha256").update("famo-session-v2:" + STAFF_CODE + ":" + ADMIN_CODE).digest();
}

function sign(expMs, role) {
  const p = String(expMs) + "." + role;
  const h = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  return p + "." + h;
}

function verify(tok) {
  if (!tok) return null;
  const parts = String(tok).split(".");
  if (parts.length !== 3) return null;
  const [expStr, role, sig] = parts;
  if (role !== "staff" && role !== "admin") return null;
  let good;
  try {
    good = crypto.createHmac("sha256", secret()).update(expStr + "." + role).digest("base64url");
  } catch (e) {
    return null;
  }
  const a = Buffer.from(sig || "");
  const b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!(Number(expStr) > Date.now())) return null;
  return { role, exp: Number(expStr) };
}

function cookieFrom(req) {
  const c = (req.headers && req.headers.cookie) || "";
  const m = /(?:^|;\s*)famo_sess=([^;]+)/.exec(c);
  return m ? decodeURIComponent(m[1]) : null;
}

function session(req) {
  return verify(cookieFrom(req));
}

function matchesCode(provided, code) {
  if (!code || provided == null || provided === "") return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(code));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/** Which role does this login code grant? null = invalid. Admin checked first. */
function roleForCode(provided) {
  if (matchesCode(provided, ADMIN_CODE)) return "admin";
  if (matchesCode(provided, STAFF_CODE)) return "staff";
  return null;
}

/** Any valid session (staff or admin) — never accept code from query/body on API handlers. */
function staffOk(req) {
  if (!STAFF_CODE && !ADMIN_CODE) return false;
  return !!session(req);
}

/** Admin-only session. False if ADMIN_CODE is not configured, even with a valid staff session. */
function adminOk(req) {
  if (!ADMIN_CODE) return false;
  const s = session(req);
  return !!s && s.role === "admin";
}

function roleOf(req) {
  const s = session(req);
  return s ? s.role : null;
}

function setCookie(res, tok, maxAgeSec) {
  res.setHeader(
    "Set-Cookie",
    "famo_sess=" + encodeURIComponent(tok) +
      "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + maxAgeSec
  );
}

function brusselsYear() {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric" }).format(new Date())
  );
}

module.exports = {
  sign,
  verify,
  staffOk,
  adminOk,
  roleOf,
  roleForCode,
  setCookie,
  TTL_MS,
  hasCode: () => !!(STAFF_CODE || ADMIN_CODE),
  hasAdminCode: () => !!ADMIN_CODE,
  brusselsYear
};
