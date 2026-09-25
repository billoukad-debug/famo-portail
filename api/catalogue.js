require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const TOKEN = process.env.AIRTABLE_TOKEN;
const __prices = require("../lib/prices");
// Anti-abus minimal (memoire d'instance, best-effort sur serverless).
const _rl = new Map();
function rateLimited(key, max, windowMs){
  const now = Date.now();
  const e = _rl.get(key) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++; _rl.set(key, e);
  return e.n > max;
}

const BASE = "appcdduLth9iGX8I0";

async function at(path){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}

async function atAll(path){
  let offset = "", records = [];
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await at(path + (offset ? sep + "offset=" + encodeURIComponent(offset) : ""));
    if (page.error) return page;
    records = records.concat(page.records || []);
    offset = page.offset || "";
  } while (offset);
  return { records };
}

// Authentifie par gebruikersnaam + wachtwoord. Renvoie l'enregistrement client ou null.
// Partagé par catalogue, orders, klantdoc, klantorder et order : la limite anti-force
// brute (5 échecs / 30 s par gebruikersnaam) vaut donc pour TOUS les endpoints client,
// pas seulement pour l'écran de connexion. Un compte bloqué répond comme un mauvais
// mot de passe (rien à apprendre pour l'attaquant), la limite se lève après 30 s.
const AUTH_MAX_FAILS = 5, AUTH_WINDOW_MS = 30000;
async function authClient(user, pw){
  if (!user || !pw) return null;
  const key = "auth:" + String(user).toLowerCase().trim();
  const e = _rl.get(key);
  if (e && e.n >= AUTH_MAX_FAILS && Date.now() - e.t <= AUTH_WINDOW_MS) return null;
  const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${String(user).toLowerCase().replace(/'/g, "")}'`);
  const cl = await at(`Clients?filterByFormula=${f}`);
  const rec = cl.records && cl.records[0];
  const stored = rec && !rec.fields["Gearchiveerd"] && rec.fields["Wachtwoord"]; // archivé : plus de connexion, historique conservé
  if (!stored || String(stored) !== String(pw)) { rateLimited(key, AUTH_MAX_FAILS, AUTH_WINDOW_MS); return null; }
  _rl.delete(key);
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
    if (rateLimited(rlKey, 5, 30000)) {
      return res.status(429).json({ error: "Te veel mislukte pogingen. Wacht 30 seconden en probeer opnieuw." });
    }
    const client = await authClient(q.user, q.pw);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
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
        foto: photoOf(r.fields["Foto"])
      };
      if (stockByName && stockByName.has(key)) p.voorraad = stockByName.get(key);
      return p;
    });
    let favorieten = { favorieten: [], standaard: {} };
    try { const j = JSON.parse(client.fields["Favorieten"] || "{}"); favorieten = { favorieten: Array.isArray(j.favorieten) ? j.favorieten : [], standaard: j.standaard && typeof j.standaard === "object" ? j.standaard : {} }; } catch (e) { /* JSON illisible : vide */ }

    res.status(200).json({
      client: { id: clientId, nom: client.fields["Nom"], adresse: client.fields["Lieu de livraison"] || "", email: (client.fields["Email"] || "").trim(), tel: client.fields["Téléphone"] || "", klantnr: client.fields["Klantnummer"] || "", btw: client.fields["BTW-nummer"] || "", favorieten },
      products,
      company: Object.assign(await loadCompany(), { levering: __lev.publicRules(rules), iban: rules ? (cfgFields["IBAN"] || "").trim() : "", bic: (cfgFields["BIC"] || "").trim() })
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

async function loadCompany(){
  try {
    const conf = await at(`${encodeURIComponent("Configuratie")}?maxRecords=1`);
    const c = ((conf.records || [])[0] || {}).fields || {};
    return {
      bedrijfsnaam: c["Bedrijfsnaam"] || "FAMO Seafood",
      adres: c["Adres"] || "",
      plaats: c["Postcode en plaats"] || "",
      btw: c["BTW-nummer"] || "",
      telefoon: c["Telefoon"] || "",
      email: c["E-mail"] || ""
    };
  } catch (_) {
    return { bedrijfsnaam: "FAMO Seafood", adres: "", plaats: "", btw: "", telefoon: "", email: "" };
  }
}
module.exports.authClient = authClient;
