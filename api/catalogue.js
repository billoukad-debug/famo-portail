require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const __prices = require("../lib/prices");
const __ca = require("../lib/clientauth");
const { at, atAll, escapeFormula } = require("../lib/airtable");
// Anti-abus, première ligne : mémoire d'instance (best-effort sur serverless, chaque
// instance a sa propre table). Seconde ligne, PERSISTANTE : le verrou par compte en base
// (Clients « Echecs » / « Geblokkeerd tot »), qui tient sur toutes les instances.
const _rl = new Map();
// Réserve une tentative de façon SYNCHRONE, avant tout await : 20 requêtes parallèles ne
// peuvent plus toutes lire « 0 échec » puis vérifier chacune un mot de passe. null =
// limite atteinte ; sinon la tentative est comptée (un échec) jusqu'à ce que l'appelant
// la rende (succès) : seuls les échecs restent au compteur.
function reserve(key, max, windowMs){
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
function blocked(key, max, windowMs){
  const e = _rl.get(key);
  return !!e && e.n >= max && Date.now() - e.t <= windowMs;
}
function ipOf(req){
  return String((req && req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "").split(",")[0].trim() || "?";
}

// Authentifie un client. Deux façons :
//  - jeton signé (lib/clientauth.js) : ce que le portail envoie après la connexion ;
//  - gebruikersnaam + wachtwoord : l'écran de connexion et le changement de mot de passe.
// Partagé par catalogue, orders, klantdoc, klantorder, order et klantwachtwoord : la limite
// anti-force brute (5 échecs / 30 s par gebruikersnaam et par instance, puis 10 échecs
// consécutifs en base → compte bloqué 15 min) vaut pour TOUS les endpoints client. Un
// compte bloqué répond comme un mauvais mot de passe, sans même vérifier celui-ci.
// Un mot de passe encore stocké en clair est remplacé par son empreinte dès qu'il sert.
const AUTH_MAX_FAILS = 5, AUTH_WINDOW_MS = 30000;
const LOCK_AFTER = 10, LOCK_MS = 15 * 60000;
// Échec sur un compte existant : compteur persistant. Deux échecs simultanés peuvent lire
// la même valeur (un incrément perdu) : borné par le compteur mémoire, sans conséquence.
// Écriture best-effort : une base sans ces champs (Airtable pas encore migrée) n'empêche rien.
async function noteFailure(rec){
  const n = (Number(rec.fields["Echecs"]) || 0) + 1;
  const fields = n >= LOCK_AFTER ? { "Echecs": 0, "Geblokkeerd tot": new Date(Date.now() + LOCK_MS).toISOString() } : { "Echecs": n };
  const up = await at(`Clients/${rec.id}`, { method: "PATCH", body: JSON.stringify({ fields }) }).catch(() => null);
  if (!up || up.error) console.error("[auth] Echecs niet bewaard", rec.id, up && up.error && up.error.type);
}
async function authClient(user, pw, token){
  if (token) {
    const t = __ca.readToken(token);
    if (!t) return null;
    const rec = await at(`Clients/${t.id}`);
    const stored = rec && !rec.error && rec.fields && !rec.fields["Gearchiveerd"] && rec.fields["Wachtwoord"];
    if (!stored || __ca.fingerprint(stored) !== t.fp || __ca.generationOf(rec) !== t.gen) return null;
    rec.tokenIat = t.iat; // renouvellement : la durée maximale court depuis la connexion
    return rec;
  }
  if (!user || !pw) return null;
  const key = "auth:" + String(user).toLowerCase().trim();
  const release = reserve(key, AUTH_MAX_FAILS, AUTH_WINDOW_MS);
  if (!release) return null;
  const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${escapeFormula(String(user).toLowerCase().trim())}'`);
  const cl = await at(`Clients?filterByFormula=${f}`);
  const rec = cl.records && cl.records[0];
  const stored = rec && !rec.fields["Gearchiveerd"] && rec.fields["Wachtwoord"]; // archivé : plus de connexion, historique conservé
  if (!stored) return null;
  if (Date.parse(rec.fields["Geblokkeerd tot"] || "") > Date.now()) return null; // verrou persistant
  if (!__ca.checkPassword(stored, pw)) { await noteFailure(rec); return null; }
  release(); _rl.delete(key);
  const fields = {};
  // Texte clair ou empreinte d'un coût dépassé : remplacée maintenant qu'on connaît le mot de passe.
  if (!__ca.isHashed(stored) || __ca.needsRehash(stored)) fields["Wachtwoord"] = __ca.hashPassword(pw);
  if (Number(rec.fields["Echecs"]) > 0 || rec.fields["Geblokkeerd tot"]) Object.assign(fields, { "Echecs": 0, "Geblokkeerd tot": null });
  if (Object.keys(fields).length) {
    const up = await at(`Clients/${rec.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    if (up && !up.error && fields["Wachtwoord"]) rec.fields["Wachtwoord"] = fields["Wachtwoord"];
  }
  return rec;
}
module.exports.authClient = authClient;
const __lev = require("../lib/levering");

// Photo du produit : lib/photo.js (Airtable https ou /api/foto de la base Postgres).
const photoOf = require("../lib/photo").photoUrl;

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Gebruik POST. Wachtwoorden horen niet in een URL." });
  }
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    // Par identifiant (5 échecs / 30 s, compté dans authClient) ET par adresse IP (30 échecs
    // / 5 min, contre l'essai d'un même mot de passe sur beaucoup d'identifiants). Seuls les
    // échecs comptent (la tentative réservée est rendue au succès) ; un jeton ne compte pas.
    let releaseIp = null;
    if (!q.token) {
      releaseIp = reserve("ip:" + ipOf(req), 30, 300000);
      if (!releaseIp || blocked("auth:" + String(q.user || "").toLowerCase().trim(), AUTH_MAX_FAILS, AUTH_WINDOW_MS)) {
        if (releaseIp) releaseIp();
        return res.status(429).json({ error: "Te veel mislukte pogingen. Wacht 30 seconden en probeer opnieuw." });
      }
    }
    const client = await authClient(q.user, q.pw, q.token);
    if (!client) return res.status(401).json({ error: q.token && !q.pw ? "Sessie verlopen. Meld u opnieuw aan." : "Ongeldige gebruikersnaam of wachtwoord", expired: !!(q.token && !q.pw) });
    if (releaseIp) releaseIp();
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
        omschrijving: String(r.fields["Omschrijving"] || "").trim(),
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
      token: __ca.issueToken(client, client.tokenIat),
      // Coordonnées bancaires seulement si le portail émet les factures (mode Portaal, lib/billing.js).
      company: Object.assign(companyFrom(cfgFields), { levering: __lev.publicRules(rules), facturatie: require("../lib/billing").modeOf(cfgFields), legal: require("../lib/billing").legalOf(cfgFields) }, require("../lib/billing").modeOf(cfgFields) === "portaal" ? { iban: (cfgFields["IBAN"] || "").trim(), bic: (cfgFields["BIC"] || "").trim() } : { iban: "", bic: "" })
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
