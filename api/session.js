const auth = require("../lib/staffauth");

// Anti-abus minimal (mémoire d'instance, best-effort sur serverless).
const _rl = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const e = _rl.get(key) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++; _rl.set(key, e);
  return e.n > max;
}
function clientIp(req) {
  const fwd = req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"]);
  if (!fwd) return "unknown";
  return String(fwd).split(",")[0].trim() || "unknown";
}

// POST {code}  -> ouvre une session (cookie HttpOnly, 8 h). Le code ne circule qu'ici, en body.
// GET          -> 200 si la session est valide, 401 sinon.
// DELETE       -> deconnexion (invalide le cookie).
module.exports = async (req, res) => {
  if (!auth.hasCode()) {
    return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt. Stel de omgevingsvariabele in op Vercel." });
  }
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
    if (!body) body = {};
    const rlKey = "staff-login:" + clientIp(req);
    if (rateLimited(rlKey, 5, 30000)) {
      return res.status(429).json({ error: "Te veel mislukte pogingen. Wacht 30 seconden en probeer opnieuw." });
    }
    if (!auth.staffOk(req, body.code)) {
      return res.status(401).json({ error: "Ongeldige personeelscode" });
    }
    _rl.delete(rlKey);
    const tok = auth.sign(Date.now() + auth.TTL_MS);
    auth.setCookie(res, tok, Math.floor(auth.TTL_MS / 1000));
    return res.status(200).json({ ok: true, expiresInSec: Math.floor(auth.TTL_MS / 1000) });
  }
  if (req.method === "GET") {
    if (auth.staffOk(req, null)) return res.status(200).json({ ok: true });
    return res.status(401).json({ error: "Sessie verlopen. Meld u opnieuw aan." });
  }
  if (req.method === "DELETE") {
    auth.setCookie(res, "uit", 0);
    return res.status(200).json({ ok: true });
  }
  res.status(405).json({ error: "Methode niet toegestaan" });
};
