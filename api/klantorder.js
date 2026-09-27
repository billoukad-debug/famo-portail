require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, escapeFormula } = require("../lib/airtable");
const __ca = require("../lib/clientauth");
// Actions du client sur son propre compte et ses propres commandes.
// POST {user, pw, action, ...}. Le client vérifié par authClient ne touche jamais
// qu'à ses enregistrements (lien « Client »), jamais à un identifiant envoyé par le
// navigateur. Actions :
//   cancel    {ref}                  annule tant que la commande est « Reçue »
//   profile   {email, tel}           met à jour e-mail et téléphone de contact
//   favorites {favorieten, standaard} sauvegarde favoris + commande type (JSON) — synchro entre appareils
//   reset     (sans pw) {user, email} lien « choisir un mot de passe » (30 min, usage unique)
//             envoyé à l'adresse connue ; l'ancien mot de passe reste valable jusque-là.
//             Le mot de passe est ensuite posé par api/klantwachtwoord.js (setPassword).
const { authClient } = require("./catalogue");
const __mail = require("../lib/ordermail");
const __authmail = require("../lib/authmail");

const _rl = new Map();
function rateLimited(key, max, windowMs){
  const now = Date.now();
  const e = _rl.get(key) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++; _rl.set(key, e);
  return e.n > max;
}

function stamp(){
  return new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(",", "");
}
// Réponse du reset en temps constant : compte trouvé (lien + e-mail) ou non, la réponse
// ne part pas avant RESET_MIN_MS — la durée ne dit plus si le compte existe. Couvre
// l'envoi d'un e-mail ordinaire ; lib/mail.js coupe de toute façon à 4 s.
const RESET_MIN_MS = 800;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

async function findOwnOrder(client, ref){
  const safe = escapeFormula(String(ref || "").slice(0, 40));
  if (!safe) return null;
  const found = await at(`Commandes?filterByFormula=${encodeURIComponent(`{Référence}='${safe}'`)}&maxRecords=1`);
  const rec = ((found && found.records) || [])[0];
  if (!rec || !(rec.fields["Client"] || []).includes(client.id)) return null;
  return rec;
}

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  if (req.method !== "POST") return res.status(405).json({ error: "Gebruik POST." });
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    const action = String(q.action || "");

    // ---- Mot de passe oublié : sans mot de passe, mais gebruikersnaam + e-mail connu doivent concorder.
    if (action === "reset") {
      const user = String(q.user || "").toLowerCase().trim().slice(0, 80);
      const email = String(q.email || "").toLowerCase().trim();
      if (!user || !isEmail(email)) return res.status(400).json({ error: "Vul uw gebruikersnaam en e-mailadres in." });
      if (rateLimited("reset:" + user, 3, 3600000)) return res.status(429).json({ error: "Te veel aanvragen. Probeer over een uur opnieuw of bel ons." });
      // Même réponse dans tous les cas : ne jamais révéler si un compte existe.
      const neutral = { ok: true, message: "Als de gegevens kloppen, ontvangt u binnen enkele minuten een e-mail met een link om een nieuw wachtwoord te kiezen." };
      if (!__mail.enabled()) return res.status(200).json(Object.assign({}, neutral, { mail: false }));
      const started = Date.now();
      const answer = async () => { const wait = RESET_MIN_MS - (Date.now() - started); if (wait > 0) await sleep(wait); return res.status(200).json(neutral); };
      const cl = await at(`Clients?filterByFormula=${encodeURIComponent(`LOWER({Gebruikersnaam})='${escapeFormula(user)}'`)}&maxRecords=1`);
      const rec = ((cl && cl.records) || [])[0];
      // Accès bloqué par Beheer (mot de passe effacé) : pas de réouverture en libre-service.
      if (!rec || rec.fields["Gearchiveerd"] || !rec.fields["Wachtwoord"] || String(rec.fields["Email"] || "").toLowerCase().trim() !== email) return answer();
      const cfg = await __mail.loadMailConfig(at);
      const link = __authmail.passwordLink(__mail.portalUrl(req), __ca.issueResetToken(rec, __ca.RESET_TTL_MS));
      await __authmail.notifyResetLink({ klant: Object.assign(__mail.clientFrom(rec), { taal: rec.fields["Taal"] }), user: rec.fields["Gebruikersnaam"] || user, link, hours: __ca.RESET_TTL_MS / 3600000, company: cfg, opsEmail: cfg.opsEmail, at: Date.now() });
      return answer();
    }

    const client = await authClient(q.user, q.pw, q.token);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });

    if (action === "cancel") {
      const rec = await findOwnOrder(client, q.ref);
      if (!rec) return res.status(404).json({ error: "Bestelling niet gevonden" });
      const f = rec.fields || {};
      const statut = f["Statut"] || "Reçue";
      if (statut === "Annulée") return res.status(409).json({ error: "Deze bestelling is al geannuleerd." });
      if (statut !== "Reçue") return res.status(409).json({ error: "Deze bestelling wordt al klaargezet. Bel Famo om ze te wijzigen of te annuleren." });
      const journal = `${stamp()} · Geannuleerd · klant`;
      const fields = {
        "Statut": "Annulée",
        "Annulée le": new Date().toISOString(),
        "Motif annulation": "Geannuleerd door klant",
        "Correcties": (f["Correcties"] ? f["Correcties"] + "\n" : "") + journal
      };
      // typecast : l'option « Annulée » est créée dans Airtable au premier usage.
      const saved = await at(`Commandes/${rec.id}`, { method: "PATCH", body: JSON.stringify({ typecast: true, fields }) });
      if (saved.error) { console.error("[klantorder] cancel", rec.id, saved.error.type, saved.error.message); return res.status(500).json({ error: "Annuleren mislukt. Probeer opnieuw of bel ons." }); }
      // L'équipe est prévenue : une annulation silencieuse finit en colis préparé pour rien.
      let mail = null;
      if (__mail.enabled()) {
        mail = await (async () => {
          const cfg = await __mail.loadMailConfig(at);
          const url = __mail.portalUrl(req);
          return __mail.notifyCancel({ ref: f["Référence"] || "", door: "klant", reden: "Geannuleerd door klant", dateLivraison: f["Date livraison souhaitée"] || "", lignes: f["Lignes (produits / quantités)"] || "", total: f["Total"] || 0, klant: __mail.clientFrom(client), opsEmail: cfg.opsEmail, company: cfg, orderUrl: url ? url + "/order.html?id=" + encodeURIComponent(rec.id) : "" });
        })().catch(() => null);
      }
      return res.status(200).json({ ok: true, ref: f["Référence"] || "", statut: "Annulée", mail });
    }

    if (action === "profile") {
      const email = String(q.email || "").trim().toLowerCase().slice(0, 120);
      const tel = String(q.tel || "").trim().slice(0, 40);
      if (email && !isEmail(email)) return res.status(400).json({ error: "Ongeldig e-mailadres" });
      const fields = {};
      if (q.email !== undefined) fields["Email"] = email;
      if (q.tel !== undefined) fields["Téléphone"] = tel;
      if (!Object.keys(fields).length) return res.status(400).json({ error: "Niets gewijzigd" });
      const saved = await at(`Clients/${client.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
      if (saved.error) { console.error("[klantorder] profile", client.id, saved.error.type, saved.error.message); return res.status(500).json({ error: "Opslaan mislukt. Probeer opnieuw." }); }
      return res.status(200).json({ ok: true, email, tel });
    }

    if (action === "favorites") {
      // JSON borné : ids de produits (favoris) + commande type {productId: qty}.
      const favs = Array.isArray(q.favorieten) ? q.favorieten.filter(x => /^rec[A-Za-z0-9]{14}$/.test(String(x))).slice(0, 200) : [];
      const std = {};
      if (q.standaard && typeof q.standaard === "object") {
        for (const [k, v] of Object.entries(q.standaard).slice(0, 200)) { const n = Number(v); if (/^rec[A-Za-z0-9]{14}$/.test(k) && Number.isFinite(n) && n > 0 && n <= 100000) std[k] = Math.round(n * 1000) / 1000; }
      }
      const saved = await at(`Clients/${client.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Favorieten": JSON.stringify({ favorieten: favs, standaard: std }) } }) });
      if (saved.error) { console.error("[klantorder] favorites", client.id, saved.error.type, saved.error.message); return res.status(500).json({ error: "Opslaan mislukt. Probeer opnieuw." }); }
      return res.status(200).json({ ok: true, favorieten: favs, standaard: std });
    }

    return res.status(400).json({ error: "Onbekende actie" });
  } catch (e) {
    { console.error("[klantorder]", e && e.message || e); res.status(500).json({ error: "Serverfout. Probeer opnieuw." }); }
  }
};
