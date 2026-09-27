require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Le client change lui-même son mot de passe (Klant → Account).
// POST {user, pw, nieuw} : pw = le mot de passe ACTUEL, retapé par le client.
// POST {action:"logout", token} : déconnexion serveur (tous les appareils du client).
// POST {action:"setPassword", token, nieuw} : mot de passe choisi via le lien reçu par e-mail.
//
// Le client modifié est TOUJOURS celui que authClient vient de vérifier (gebruikersnaam
// + mot de passe actuel). Aucun identifiant de client n'est lu dans le body : sans le
// mot de passe actuel d'un autre client, impossible de toucher à son compte.
//
// Stockage : empreinte scrypt (lib/clientauth.js), jamais le texte clair. La réponse
// contient un nouveau jeton : l'ancien cesse de valoir dès que le mot de passe change.
const { authClient, authUnavailable } = require("./catalogue");
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
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
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

    // ---- Lien reçu par e-mail (reset ou activation) : POST {action:"setPassword", token, nieuw}.
    // Le jeton signé désigne le client et l'empreinte de son mot de passe actuel : dès que
    // celui-ci change, le lien ne vaut plus (usage unique). Même message pour un lien faux,
    // expiré ou déjà utilisé.
    if (q.action === "setPassword") {
      const nieuw = typeof q.nieuw === "string" ? q.nieuw : typeof q.nouveau === "string" ? q.nouveau : "";
      if (nieuw.length < MIN_LEN) return res.status(400).json({ error: `Het nieuwe wachtwoord moet minstens ${MIN_LEN} tekens hebben.` });
      if (nieuw.length > MAX_LEN) return res.status(400).json({ error: `Het nieuwe wachtwoord mag hoogstens ${MAX_LEN} tekens hebben.` });
      const gone = { error: "Deze link is verlopen of al gebruikt. Vraag een nieuwe aan.", expired: true };
      const t = __ca.readResetToken(q.token);
      if (!t) return res.status(400).json(gone);
      const rec = await at(`Clients/${encodeURIComponent(t.id)}`);
      const f = (rec && !rec.error && rec.fields) || null;
      if (!f || f["Gearchiveerd"] || __ca.fingerprint(f["Wachtwoord"]) !== t.fp) return res.status(400).json(gone);
      const fields = { "Wachtwoord": __ca.hashPassword(nieuw) };
      // Le client a prouvé qu'il lit la boîte de son établissement : le verrou anti-force brute
      // est levé (écrit seulement s'il existe, pour une base sans ces champs).
      if (Number(f["Echecs"]) > 0 || f["Geblokkeerd tot"]) Object.assign(fields, { "Echecs": 0, "Geblokkeerd tot": null });
      const saved = await at(`Clients/${encodeURIComponent(t.id)}`, { method: "PATCH", body: JSON.stringify({ fields }) });
      if (!saved || saved.error) {
        console.error("[klantwachtwoord] setPassword", t.id, saved && saved.error && saved.error.type);
        return res.status(500).json({ error: "Wachtwoord opslaan mislukt. Probeer het later opnieuw." });
      }
      // Connecté dans la foulée : jeton de session neuf (le mot de passe vient de changer).
      return res.status(200).json({ ok: true, user: f["Gebruikersnaam"] || "", token: __ca.issueToken({ id: t.id, fields: Object.assign({}, f, fields) }) });
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
    if (authUnavailable(res, e)) return;
    console.error("[klantwachtwoord]", e && e.message || e);
    return res.status(500).json({ error: "Wachtwoord wijzigen mislukt. Probeer het later opnieuw." });
  }
};
