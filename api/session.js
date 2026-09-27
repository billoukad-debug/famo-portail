require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at } = require("../lib/airtable");
const auth = require("../lib/staffauth");

// Codes enregistres depuis Beheer (haches) + generation de session (revocation, voir
// lib/staffauth.js). Lecture a la connexion ; les gardes des autres endpoints restent
// synchrones. En cas d'echec de lecture on renvoie {} : seuls les codes d'environnement
// fonctionnent alors, ce qui garde une porte d'entree plutot qu'un blocage total.
async function storedCodes() {
  try {
    const j = await at(`${encodeURIComponent("Configuratie")}?maxRecords=1`);
    const f = ((j && j.records) || [])[0];
    const fields = (f && f.fields) || {};
    if (j && !j.error) auth.noteGeneration(fields["Sessiegeneratie"]);
    return {
      id: (f && f.id) || "",
      gen: Number(fields["Sessiegeneratie"]) || 0,
      adminHash: String(fields["Beheerderscode hash"] || "").trim(),
      staffHash: String(fields["Personeelscode hash"] || "").trim(),
      pinFails: Number(fields["PIN echecs"]) || 0,
      pinLocked: Date.parse(fields["PIN geblokkeerd tot"] || "") > Date.now()
    };
  } catch (e) {
    return {};
  }
}

// Comptes individuels (table Medewerkers) : PIN haché, rôle, actif. Un PIN qui
// correspond ouvre une session AU NOM de la personne ; le journal des corrections,
// paiements et annulations porte alors son prénom au lieu de « personeel ».
// Les PIN de 4-5 chiffres créés avant la règle des 6 chiffres restent acceptés.
async function medewerkerFor(pin) {
  const value = String(pin || "");
  if (value.length < 4) return null;
  try {
    const j = await at(`Medewerkers?filterByFormula=${encodeURIComponent("{Actief}=1")}`);
    for (const r of (j && j.records) || []) {
      const f = r.fields || {};
      if (f["PIN hash"] && auth.verifyHash(f["PIN hash"], value)) {
        return { id: r.id, fields: f, name: String(f["Naam"] || "").trim(), role: f["Rol"] === "beheerder" ? "admin" : "staff" };
      }
    }
  } catch (e) { /* table absente ou illisible : codes partagés seulement */ }
  return null;
}

// Connexion réussie par PIN : horodatage, et PIN d'un ancien coût scrypt ré-haché. Le
// jeton porte l'empreinte du PIN : si le nouvel hash n'a pas pu être écrit, on garde
// l'ancien (sinon la session serait aussitôt révoquée).
async function touchMedewerker(m, pin) {
  const fields = { "Laatste aanmelding": new Date().toISOString() };
  if (!auth.needsRehash(m.fields["PIN hash"])) {
    at(`Medewerkers/${m.id}`, { method: "PATCH", body: JSON.stringify({ fields }) }).catch(() => null);
    return m.fields;
  }
  fields["PIN hash"] = auth.hashCode(pin);
  const up = await at(`Medewerkers/${m.id}`, { method: "PATCH", body: JSON.stringify({ fields }) }).catch(() => null);
  return up && !up.error ? Object.assign({}, m.fields, { "PIN hash": fields["PIN hash"] }) : m.fields;
}

// Anti-abus, première ligne : mémoire d'instance (5 échecs / 30 s par IP). La tentative est
// réservée AVANT tout await (des requêtes parallèles ne passent plus toutes) et rendue en
// cas de succès : seuls les échecs comptent.
const _rl = new Map();
function reserve(key, max, windowMs) {
  const now = Date.now();
  let e = _rl.get(key);
  if (!e || now - e.t > windowMs) {
    if (_rl.size > 5000) _rl.clear(); // borne mémoire
    e = { n: 0, t: now }; _rl.set(key, e);
  }
  if (e.n >= max) return null;
  e.n++;
  return () => { e.n = Math.max(0, e.n - 1); };
}

// Seconde ligne, PERSISTANTE (toutes instances) : un PIN n'identifie pas son compte (on
// l'essaie contre tous les Medewerkers), un verrou « par compte » n'a donc pas de sens.
// Le compteur est global, dans Configuratie : après PIN_LOCK_AFTER échecs sans connexion
// réussie par PIN, la connexion par PIN est suspendue PIN_LOCK_MS ; les codes partagés
// (≥ 10 caractères) restent utilisables, le magasin n'est donc jamais bloqué.
const PIN_LOCK_AFTER = 20, PIN_LOCK_MS = 15 * 60000;
async function notePinResult(stored, ok) {
  if (!stored.id || (ok && !stored.pinFails)) return;
  const n = ok ? 0 : stored.pinFails + 1;
  const fields = n >= PIN_LOCK_AFTER ? { "PIN echecs": 0, "PIN geblokkeerd tot": new Date(Date.now() + PIN_LOCK_MS).toISOString() } : { "PIN echecs": n };
  const up = await at(`${encodeURIComponent("Configuratie")}/${stored.id}`, { method: "PATCH", body: JSON.stringify({ fields }) }).catch(() => null);
  if (!up || up.error) console.error("[session] PIN echecs niet bewaard", up && up.error && up.error.type);
}
function clientIp(req) {
  const fwd = req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"]);
  if (!fwd) return "unknown";
  return String(fwd).split(",")[0].trim() || "unknown";
}

// POST {code}  -> ouvre une session (cookie HttpOnly, 8 h). Le code ne circule qu'ici, en body.
// GET          -> 200 si la session est valide ET non révoquée (base relue ≤ 60 s), 401 sinon.
// DELETE       -> deconnexion (invalide le cookie). DELETE ?all=1 (beheerder) : deconnecte
//                 TOUT le monde (generation globale +1), y compris l'appelant.
module.exports = async (req, res) => {
  if (!auth.hasCode()) {
    return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt. Stel de omgevingsvariabele in op Vercel." });
  }
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
    if (!body) body = {};
    const rlKey = "staff-login:" + clientIp(req);
    const release = reserve(rlKey, 5, 30000);
    if (!release) {
      return res.status(429).json({ error: "Te veel mislukte pogingen. Wacht 30 seconden en probeer opnieuw." });
    }
    const want = body.want === "admin" ? "admin" : "staff";
    // 1. Codes partagés (environnement ou Beheer → Toegang). 2. PIN personnel (Medewerkers).
    const stored = await storedCodes();
    let role = auth.roleForCode(body.code, stored, want);
    let name = "";
    const gen = { g: stored.gen || 0 };
    if (!role && !stored.pinLocked) {
      const m = await medewerkerFor(body.code);
      await notePinResult(stored, !!m);
      if (m) {
        role = m.role === "admin" && want !== "admin" ? "staff" : m.role;
        name = m.name;
        const fields = await touchMedewerker(m, body.code);
        auth.noteMedewerker(m.id, fields);
        Object.assign(gen, { med: m.id, pfp: auth.pinFingerprint(fields["PIN hash"]) });
      }
    }
    if (!role) {
      return res.status(401).json({ error: "Ongeldige personeelscode" });
    }
    release(); _rl.delete(rlKey);
    const tok = auth.sign(Date.now() + auth.TTL_MS, role, name, gen);
    auth.setCookie(res, tok, Math.floor(auth.TTL_MS / 1000));
    return res.status(200).json({ ok: true, role, name, expiresInSec: Math.floor(auth.TTL_MS / 1000) });
  }
  if (req.method === "GET") {
    const s = await auth.staffSession(req);
    if (s) return res.status(200).json({ ok: true, role: s.role, name: s.name || (s.role === "admin" ? "beheerder" : "personeel") });
    return res.status(401).json({ error: "Sessie verlopen. Meld u opnieuw aan." });
  }
  if (req.method === "DELETE") {
    const all = String((req.query && req.query.all) || "") === "1";
    if (all) {
      if (!(await auth.adminSession(req))) return res.status(401).json({ error: "Enkel voor beheerders" });
      const stored = await storedCodes();
      if (!stored.id) return res.status(500).json({ error: "Configuratie onleesbaar. Probeer opnieuw." });
      const next = (stored.gen || 0) + 1;
      const saved = await at(`${encodeURIComponent("Configuratie")}/${stored.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Sessiegeneratie": next } }) }).catch(e => ({ error: { message: String(e && e.message || e) } }));
      if (!saved || saved.error) {
        console.error("[session] logout-all", saved && saved.error && saved.error.message);
        return res.status(500).json({ error: "Iedereen afmelden mislukt. Probeer opnieuw." });
      }
      auth.noteGeneration(next);
    }
    auth.setCookie(res, "uit", 0);
    return res.status(200).json({ ok: true, all });
  }
  res.status(405).json({ error: "Methode niet toegestaan" });
};
