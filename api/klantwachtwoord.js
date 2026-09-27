require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Le client change lui-même son mot de passe (Klant → Account).
// POST {user, pw, nieuw} : pw = le mot de passe ACTUEL, retapé par le client.
// POST {action:"logout", token} : déconnexion serveur (tous les appareils du client).
//
// Le client modifié est TOUJOURS celui que authClient vient de vérifier (gebruikersnaam
// + mot de passe actuel). Aucun identifiant de client n'est lu dans le body : sans le
// mot de passe actuel d'un autre client, impossible de toucher à son compte.
//
// Stockage : empreinte scrypt (lib/clientauth.js), jamais le texte clair. La réponse
// contient un nouveau jeton : l'ancien cesse de valoir dès que le mot de passe change.
const { authClient } = require("./catalogue");
const { at } = require("../lib/airtable");
const __ca = require("../lib/clientauth");

const MIN_LEN = 8;
const MAX_LEN = 80;

// Anti-abus (mémoire d'instance, en plus du verrou persistant d'authClient) : même règle
// qu'à la connexion, sinon cette route permettrait de deviner un mot de passe sans limite.
// Tentative réservée AVANT l'await (requêtes parallèles), rendue au succès : seuls les
// échecs comptent.
const _rl = new Map();
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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Gebruik POST. Wachtwoorden horen niet in een URL." });
  }
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};

    // ---- Déconnexion : POST {action:"logout", token}. La génération du client (+1) révoque
    // tous ses jetons, sur tous ses appareils. Réponse identique si le jeton ne vaut plus rien.
    if (q.action === "logout") {
      const client = q.token ? await authClient(null, null, q.token) : null;
      if (client) {
        const saved = await at(`Clients/${encodeURIComponent(client.id)}`, { method: "PATCH", body: JSON.stringify({ fields: { "Sessiegeneratie": __ca.generationOf(client) + 1 } }) });
        if (!saved || saved.error) {
          console.error("[klantwachtwoord] logout", saved && saved.error && saved.error.type);
          return res.status(500).json({ error: "Afmelden mislukt. Probeer opnieuw." });
        }
      }
      return res.status(200).json({ ok: true });
    }

    const pw = typeof q.pw === "string" ? q.pw : "";
    const nieuw = typeof q.nieuw === "string" ? q.nieuw : "";

    // Contrôles de forme avant tout accès Airtable. Le nouveau mot de passe est
    // enregistré tel quel (pas de trim) : la connexion ne trime pas non plus.
    if (!pw) return res.status(400).json({ error: "Vul uw huidige wachtwoord in." });
    if (nieuw.length < MIN_LEN) return res.status(400).json({ error: `Het nieuwe wachtwoord moet minstens ${MIN_LEN} tekens hebben.` });
    if (nieuw.length > MAX_LEN) return res.status(400).json({ error: `Het nieuwe wachtwoord mag hoogstens ${MAX_LEN} tekens hebben.` });
    if (nieuw === pw) return res.status(400).json({ error: "Kies een nieuw wachtwoord dat verschilt van het huidige." });

    const rlKey = "klantwachtwoord:" + String(q.user || "").toLowerCase();
    if (!reserve(rlKey, 5, 30000)) {
      return res.status(429).json({ error: "Te veel mislukte pogingen. Wacht 30 seconden en probeer opnieuw." });
    }
    const client = await authClient(q.user, pw);
    if (!client) return res.status(401).json({ error: "Uw huidige wachtwoord klopt niet." });

    const hashed = __ca.hashPassword(nieuw);
    const saved = await at(`Clients/${encodeURIComponent(client.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { "Wachtwoord": hashed } })
    });
    if (!saved || saved.error) {
      return res.status(500).json({ error: "Wachtwoord wijzigen mislukt. Probeer het later opnieuw." });
    }
    _rl.delete(rlKey);
    return res.status(200).json({ ok: true, token: __ca.issueToken({ id: client.id, fields: Object.assign({}, client.fields, { "Wachtwoord": hashed }) }) });
  } catch (e) {
    console.error("[klantwachtwoord]", e && e.message || e);
    return res.status(500).json({ error: "Wachtwoord wijzigen mislukt. Probeer het later opnieuw." });
  }
};
