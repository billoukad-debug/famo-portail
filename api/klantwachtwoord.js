require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Le client change lui-même son mot de passe (Klant → Account).
// POST {user, pw, nieuw} : pw = le mot de passe ACTUEL, retapé par le client.
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

// Anti-abus minimal (mémoire d'instance, best-effort sur serverless) : même règle qu'à la
// connexion, sinon cette route permettrait de deviner un mot de passe sans limite.
const _rl = new Map();
function rateLimited(key, max, windowMs){
  const now = Date.now();
  const e = _rl.get(key) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++; _rl.set(key, e);
  return e.n > max;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Gebruik POST. Wachtwoorden horen niet in een URL." });
  }
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    const pw = typeof q.pw === "string" ? q.pw : "";
    const nieuw = typeof q.nieuw === "string" ? q.nieuw : "";

    // Contrôles de forme avant tout accès Airtable. Le nouveau mot de passe est
    // enregistré tel quel (pas de trim) : la connexion ne trime pas non plus.
    if (!pw) return res.status(400).json({ error: "Vul uw huidige wachtwoord in." });
    if (nieuw.length < MIN_LEN) return res.status(400).json({ error: `Het nieuwe wachtwoord moet minstens ${MIN_LEN} tekens hebben.` });
    if (nieuw.length > MAX_LEN) return res.status(400).json({ error: `Het nieuwe wachtwoord mag hoogstens ${MAX_LEN} tekens hebben.` });
    if (nieuw === pw) return res.status(400).json({ error: "Kies een nieuw wachtwoord dat verschilt van het huidige." });

    const rlKey = "klantwachtwoord:" + String(q.user || "").toLowerCase();
    if (rateLimited(rlKey, 5, 30000)) {
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
    return res.status(200).json({ ok: true, token: __ca.issueToken({ id: client.id, fields: { "Wachtwoord": hashed } }) });
  } catch (e) {
    return res.status(500).json({ error: "Wachtwoord wijzigen mislukt. Probeer het later opnieuw." });
  }
};
