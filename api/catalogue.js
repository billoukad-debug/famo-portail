require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const __prices = require("../lib/prices");
const __ca = require("../lib/clientauth");
const { at, atAll, escapeFormula } = require("../lib/airtable");
// Anti-abus (mémoire d'instance, best-effort sur serverless : chaque instance a sa propre
// table ; combiné au hachage scrypt, qui rend chaque essai coûteux).
const _rl = new Map();
function rateLimited(key, max, windowMs){
  const now = Date.now();
  const e = _rl.get(key) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++; _rl.set(key, e);
  if (_rl.size > 5000) _rl.clear(); // borne mémoire
  return e.n > max;
}
function ipOf(req){
  return String((req && req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "").split(",")[0].trim() || "?";
}

// Authentifie un client. Deux façons :
//  - jeton signé (lib/clientauth.js) : ce que le portail envoie après la connexion ;
//  - gebruikersnaam + wachtwoord : l'écran de connexion et le changement de mot de passe.
// Partagé par catalogue, orders, klantdoc, klantorder, order et klantwachtwoord : la limite
// anti-force brute (5 échecs / 30 s par gebruikersnaam) vaut pour TOUS les endpoints
// client. Un compte bloqué répond comme un mauvais mot de passe.
// Un mot de passe encore stocké en clair est remplacé par son empreinte dès qu'il sert.
const AUTH_MAX_FAILS = 5, AUTH_WINDOW_MS = 30000;
async function authClient(user, pw, token){
  if (token) {
    const t = __ca.readToken(token);
    if (!t) return null;
    const rec = await at(`Clients/${t.id}`);
    const stored = rec && !rec.error && rec.fields && !rec.fields["Gearchiveerd"] && rec.fields["Wachtwoord"];
    if (!stored || __ca.fingerprint(stored) !== t.fp) return null;
    return rec;
  }
  if (!user || !pw) return null;
  const key = "auth:" + String(user).toLowerCase().trim();
  const e = _rl.get(key);
  if (e && e.n >= AUTH_MAX_FAILS && Date.now() - e.t <= AUTH_WINDOW_MS) return null;
  const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${escapeFormula(String(user).toLowerCase().trim())}'`);
  const cl = await at(`Clients?filterByFormula=${f}`);
  const rec = cl.records && cl.records[0];
  const stored = rec && !rec.fields["Gearchiveerd"] && rec.fields["Wachtwoord"]; // archivé : plus de connexion, historique conservé
  if (!stored || !__ca.checkPassword(stored, pw)) { rateLimited(key, AUTH_MAX_FAILS, AUTH_WINDOW_MS); return null; }
  _rl.delete(key);
  if (!__ca.isHashed(stored)) {
    const hashed = __ca.hashPassword(pw);
    const up = await at(`Clients/${rec.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Wachtwoord": hashed } }) });
    if (up && !up.error) rec.fields["Wachtwoord"] = hashed;
  }
  return rec;
}
module.exports.authClient = authClient;
const __lev = require("../lib/levering");

// Photo du produit : lib/photo.js (Airtable https ou /api/foto de la base Postgres).
const photoOf = require("../lib/photo").photoUrl;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Gebruik POST. Wachtwoorden horen niet in een URL." });
  }
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    const rlKey = "login:" + String(q.user || "").toLowerCase();
    // Par identifiant (5 / 30 s) ET par adresse IP (30 / 5 min, contre l'essai d'un même
    // mot de passe sur beaucoup d'identifiants). Un jeton valide ne compte pas.
    if (!q.token && (rateLimited(rlKey, 5, 30000) || rateLimited("ip:" + ipOf(req), 30, 300000))) {
      return res.status(429).json({ error: "Te veel mislukte pogingen. Wacht 30 seconden en probeer opnieuw." });
    }
    const client = await authClient(q.user, q.pw, q.token);
    if (!client) return res.status(401).json({ error: q.token && !q.pw ? "Sessie verlopen. Meld u opnieuw aan." : "Ongeldige gebruikersnaam of wachtwoord", expired: !!(q.token && !q.pw) });
    _rl.delete(rlKey);
    const clientId = client.id;

    const [cat, neg, conf] = await Promise.all([
      atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`),
      atAll(`${encodeURIComponent("Prix négociés")}`),
      at(`${encodeURIComponent("Configuratie")}?maxRecords=1`)
    ]);
    const cfgFields = (((conf && conf.records) || [])[0] || {}).fields || {};
    const rules = __lev.rulesFrom(cfgFields);
    // Disponibilité : seulement quand le stock est fiable (déduction activée). Sinon rien n'est affiché.
    let stockByName = null;
    if (rules.voorraadAfboeken) {
      const st = await atAll("Stock");
      stockByName = new Map((st.records || []).map(r => [String(r.fields["Produit"] || "").toLowerCase().trim(), Number(r.fields["Quantité disponible"] || 0)]));
    }
    const negMap = __prices.negotiatedFor(neg.records, clientId);
    const products = (cat.records || []).map(r => {
      const key = String(r.fields["Produit"] || "").toLowerCase().trim();
      const p = {
        id: r.id,
        nom: r.fields["Produit"],
        cat: r.fields["Catégorie"] || "",
        unite: r.fields["Unité"] || "",
        base: r.fields["Prix de base"] || 0,
        prix: __prices.unitPrice(r, negMap),
        kaliber: String(r.fields["Kaliber"] || "").trim(),
        foto: photoOf(r.fields["Foto"]),
        volgorde: r.fields["Volgorde"] == null || r.fields["Volgorde"] === "" ? null : Number(r.fields["Volgorde"])
      };
      if (stockByName && stockByName.has(key)) p.voorraad = stockByName.get(key);
      return p;
    });
    let favorieten = { favorieten: [], standaard: {} };
    try { const j = JSON.parse(client.fields["Favorieten"] || "{}"); favorieten = { favorieten: Array.isArray(j.favorieten) ? j.favorieten : [], standaard: j.standaard && typeof j.standaard === "object" ? j.standaard : {} }; } catch (e) { /* JSON illisible : vide */ }

    res.status(200).json({
      client: { id: clientId, taal: String(client.fields["Taal"] || "").toUpperCase() === "FR" ? "FR" : "NL", nom: client.fields["Nom"], adresse: client.fields["Lieu de livraison"] || "", email: (client.fields["Email"] || "").trim(), tel: client.fields["Téléphone"] || "", klantnr: client.fields["Klantnummer"] || "", btw: client.fields["BTW-nummer"] || "", favorieten },
      products,
      token: __ca.issueToken(client),
      company: Object.assign(companyFrom(cfgFields), { levering: __lev.publicRules(rules), iban: rules ? (cfgFields["IBAN"] || "").trim() : "", bic: (cfgFields["BIC"] || "").trim() })
    });
  } catch (e) {
    console.error("[catalogue]", e && e.message || e);
    res.status(500).json({ error: "Catalogus laden mislukt. Probeer opnieuw." });
  }
};

// Configuratie déjà lue plus haut : pas de deuxième requête.
function companyFrom(c){
  c = c || {};
  return {
    bedrijfsnaam: c["Bedrijfsnaam"] || "FAMO Seafood",
    adres: c["Adres"] || "",
    plaats: c["Postcode en plaats"] || "",
    btw: c["BTW-nummer"] || "",
    telefoon: c["Telefoon"] || "",
    email: c["E-mail"] || ""
  };
}
module.exports.authClient = authClient;
