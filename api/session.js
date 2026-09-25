require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const auth = require("../lib/staffauth");
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = "appcdduLth9iGX8I0";

async function at(path, opts) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
  return r.json();
}

// Codes enregistres depuis Beheer (haches). Lecture uniquement a la connexion :
// les gardes des autres endpoints restent synchrones (verification du cookie).
// En cas d'echec de lecture on renvoie {} : seuls les codes d'environnement
// fonctionnent alors, ce qui garde une porte d'entree plutot qu'un blocage total.
async function storedCodes() {
  try {
    const j = await at(`${encodeURIComponent("Configuratie")}?maxRecords=1`);
    const f = ((j && j.records) || [])[0];
    const fields = (f && f.fields) || {};
    return {
      adminHash: String(fields["Beheerderscode hash"] || "").trim(),
      staffHash: String(fields["Personeelscode hash"] || "").trim()
    };
  } catch (e) {
    return {};
  }
}

// Comptes individuels (table Medewerkers) : PIN haché, rôle, actif. Un PIN qui
// correspond ouvre une session AU NOM de la personne ; le journal des corrections,
// paiements et annulations porte alors son prénom au lieu de « personeel ».
async function medewerkerFor(pin) {
  const value = String(pin || "");
  if (value.length < 4) return null;
  try {
    const j = await at(`Medewerkers?filterByFormula=${encodeURIComponent("{Actief}=1")}`);
    for (const r of (j && j.records) || []) {
      const f = r.fields || {};
      if (f["PIN hash"] && auth.verifyHash(f["PIN hash"], value)) {
        return { id: r.id, name: String(f["Naam"] || "").trim(), role: f["Rol"] === "beheerder" ? "admin" : "staff" };
      }
    }
  } catch (e) { /* table absente ou illisible : codes partagés seulement */ }
  return null;
}

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
    const want = body.want === "admin" ? "admin" : "staff";
    // 1. Codes partagés (environnement ou Beheer → Toegang). 2. PIN personnel (Medewerkers).
    let role = auth.roleForCode(body.code, await storedCodes(), want);
    let name = "";
    if (!role) {
      const m = await medewerkerFor(body.code);
      if (m) {
        role = m.role === "admin" && want !== "admin" ? "staff" : m.role;
        name = m.name;
        at(`Medewerkers/${m.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Laatste aanmelding": new Date().toISOString() } }) }).catch(() => null);
      }
    }
    if (!role) {
      return res.status(401).json({ error: "Ongeldige personeelscode" });
    }
    _rl.delete(rlKey);
    const tok = auth.sign(Date.now() + auth.TTL_MS, role, name);
    auth.setCookie(res, tok, Math.floor(auth.TTL_MS / 1000));
    return res.status(200).json({ ok: true, role, name, expiresInSec: Math.floor(auth.TTL_MS / 1000) });
  }
  if (req.method === "GET") {
    if (auth.staffOk(req)) return res.status(200).json({ ok: true, role: auth.roleOf(req), name: auth.actorOf(req) });
    return res.status(401).json({ error: "Sessie verlopen. Meld u opnieuw aan." });
  }
  if (req.method === "DELETE") {
    auth.setCookie(res, "uit", 0);
    return res.status(200).json({ ok: true });
  }
  res.status(405).json({ error: "Methode niet toegestaan" });
};
