// Session staff : cookie HttpOnly signé (HMAC), 8 h.
// Fail-closed : sans STAFF_CODE env, aucune auth staff possible.
// Le code ne circule que via POST /api/session (body). Les autres API = cookie only.
const crypto = require("crypto");
const CODE = String(process.env.STAFF_CODE || "").trim();
const TTL_MS = 8 * 3600 * 1000;

function secret() {
  return crypto.createHash("sha256").update("famo-session-v1:" + CODE).digest();
}

function sign(expMs) {
  const p = String(expMs);
  const h = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  return p + "." + h;
}

function verify(tok) {
  if (!CODE || !tok) return false;
  const parts = String(tok).split(".");
  if (parts.length !== 2) return false;
  let good;
  try {
    good = crypto.createHmac("sha256", secret()).update(parts[0]).digest("base64url");
  } catch (e) {
    return false;
  }
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(parts[0]) > Date.now();
}

function cookieFrom(req) {
  const c = (req.headers && req.headers.cookie) || "";
  const m = /(?:^|;\s*)famo_sess=([^;]+)/.exec(c);
  return m ? decodeURIComponent(m[1]) : null;
}

function codeEquals(provided) {
  if (!CODE || provided == null || provided === "") return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(CODE));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/** Cookie session only — never accept code from query/body on API handlers. */
function staffOk(req) {
  if (!CODE) return false;
  return verify(cookieFrom(req));
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
  setCookie,
  codeEquals,
  TTL_MS,
  hasCode: () => !!CODE,
  getCode: () => CODE,
  brusselsYear
};
