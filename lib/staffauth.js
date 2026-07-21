// Session staff commune : cookie HttpOnly signe (HMAC), duree 8 h.
// Retro-compatible : les API acceptent AUSSI l'ancien parametre code
// pour ne casser aucune page existante pendant la migration.
const crypto = require("crypto");
const CODE = process.env.STAFF_CODE;
const TTL_MS = 8 * 3600 * 1000;

function secret(){ return crypto.createHash("sha256").update("famo-session-v1:" + CODE).digest(); }
function sign(expMs){
  const p = String(expMs);
  const h = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  return p + "." + h;
}
function verify(tok){
  if (!CODE || !tok) return false;
  const parts = String(tok).split(".");
  if (parts.length !== 2) return false;
  const good = crypto.createHmac("sha256", secret()).update(parts[0]).digest("base64url");
  const a = Buffer.from(parts[1]), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(parts[0]) > Date.now();
}
function cookieFrom(req){
  const c = (req.headers && req.headers.cookie) || "";
  const m = /(?:^|;\s*)famo_sess=([^;]+)/.exec(c);
  return m ? decodeURIComponent(m[1]) : null;
}
// Autorise : session cookie valide OU code exact (legacy).
function staffOk(req, legacyCode){
  if (!CODE) return false;
  if (legacyCode && legacyCode === CODE) return true;
  return verify(cookieFrom(req));
}
function setCookie(res, tok, maxAgeSec){
  res.setHeader("Set-Cookie",
    "famo_sess=" + encodeURIComponent(tok) +
    "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + maxAgeSec);
}
module.exports = { sign, verify, staffOk, setCookie, TTL_MS, hasCode: () => !!CODE };
