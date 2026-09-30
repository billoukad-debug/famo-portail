"use strict";
// Beheer · Utilisateurs supplémentaires d'un client (H-08) — actions de api/onboarding.js (audit I-10).
// Garde, session beheerder et journal d'audit restent dans api/onboarding.js (le seul point d'entrée HTTP).
const { at, atAll, __ca, __mail, __kl, __ordermail, __authmail, REC, clean, slugUser, genPassword, usernameOwner, uniqueUsername } = require("./common");

const ACTIONS = ["listKlantgebruikers", "saveKlantgebruiker", "resetKlantgebruiker", "deleteKlantgebruiker"];

async function run({ req, res, body, action }) {

  // ---- Utilisateurs supplémentaires d'un client (H-08) : chef, gérant, second établissement…
  // Chacun son identifiant et son mot de passe ; commandes, prix et documents du client.
  if (action === "listKlantgebruikers") {
    const cid = clean(body.clientId, 40);
    if (!REC.test(cid)) return res.status(400).json({ error: "Ongeldig klant-id" });
    const all = await atAll(encodeURIComponent(__kl.USERS));
    if (all.error && !/NOT_FOUND/.test(String(all.error.type || ""))) return res.status(500).json({ error: "Gebruikers onleesbaar" });
    const users = ((all && all.records) || []).filter(r => (r.fields["Client"] || []).includes(cid)).map(r => ({ id: r.id, naam: r.fields["Naam"] || "", user: r.fields["Gebruikersnaam"] || "", email: r.fields["Email"] || "", actief: !!r.fields["Actief"], hasPassword: !!r.fields["Wachtwoord"] })).sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
    return res.status(200).json({ ok: true, users });
  }
  if (action === "saveKlantgebruiker" || action === "resetKlantgebruiker") {
    const id = clean(body.id, 40);
    if (id && !REC.test(id)) return res.status(400).json({ error: "Ongeldig gebruikers-id" });
    const cur = id ? await at(`${encodeURIComponent(__kl.USERS)}/${id}`) : null;
    if (id && (!cur || cur.error)) return res.status(404).json({ error: "Gebruiker niet gevonden" });
    const cid = id ? ((cur.fields["Client"] || [])[0] || "") : clean(body.clientId, 40);
    if (!REC.test(cid)) return res.status(400).json({ error: "Ongeldig klant-id" });
    const client = await at(`Clients/${cid}`);
    if (!client || client.error) return res.status(404).json({ error: "Klant niet gevonden" });
    const fields = {};
    let password = "";
    if (action === "saveKlantgebruiker") {
      const naam = clean(body.naam, 80), email = clean(body.email, 120).toLowerCase();
      let user = clean(body.user, 40).toLowerCase().replace(/['"\s]+/g, "");
      if (!naam) return res.status(400).json({ error: "Naam is verplicht" });
      if (email && !__mail.isEmail(email)) return res.status(400).json({ error: "Ongeldig e-mailadres" });
      if (!user) user = await uniqueUsername(slugUser(naam));
      else if (!/^[a-z0-9._-]{3,40}$/.test(user)) return res.status(400).json({ error: "Gebruikersnaam: 3 tot 40 tekens (letters, cijfers, . _ -)" });
      const owner = await usernameOwner(user);
      if (owner && owner !== id) return res.status(409).json({ error: "Deze gebruikersnaam bestaat al" });
      Object.assign(fields, { "Client": [cid], "Naam": naam, "Gebruikersnaam": user, "Email": email, "Actief": body.actief !== false });
    }
    if (!id || action === "resetKlantgebruiker") {
      password = genPassword();
      // Nouveau mot de passe : les sessions ouvertes de cet utilisateur tombent (génération +1).
      Object.assign(fields, { "Wachtwoord": __ca.hashPassword(password), "Echecs": 0, "Geblokkeerd tot": null, "Sessiegeneratie": (Number(cur && cur.fields["Sessiegeneratie"]) || 0) + 1 });
    } else if (fields["Actief"] === false && !!cur.fields["Actief"]) {
      fields["Sessiegeneratie"] = (Number(cur.fields["Sessiegeneratie"]) || 0) + 1; // désactivé : déconnecté partout
    }
    const saved = id
      ? await at(`${encodeURIComponent(__kl.USERS)}/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) })
      : await at(encodeURIComponent(__kl.USERS), { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
    if (!saved || saved.error) { console.error("[onboarding] klantgebruiker", saved && saved.error && saved.error.type); return res.status(500).json({ error: "Gebruiker opslaan mislukt" }); }
    const rec = saved.records ? saved.records[0] : saved;
    const all = Object.assign({}, (cur && cur.fields) || {}, fields);
    let mail = null;
    if (password && all["Email"] && __ordermail.enabled() && body.sendMail !== false) {
      mail = await (async () => {
        const cfg = await __ordermail.loadMailConfig(at);
        const link = __authmail.passwordLink(__ordermail.portalUrl(req), __ca.issueResetToken({ id: rec.id, fields: all }, __ca.ACTIVATION_TTL_MS));
        return __authmail.notifyActivation({ klant: { nom: all["Naam"] || client.fields["Nom"], email: all["Email"], taal: client.fields["Taal"] }, user: all["Gebruikersnaam"], link, hours: __ca.ACTIVATION_TTL_MS / 3600000, company: cfg, opsEmail: cfg.opsEmail, at: Date.now() });
      })().catch(() => null);
    }
    return res.status(200).json({ ok: true, id: rec.id, credentials: password ? { id: rec.id, nom: all["Naam"], user: all["Gebruikersnaam"], password } : null, mail });
  }
  if (action === "deleteKlantgebruiker") {
    const id = clean(body.id, 40);
    if (!REC.test(id)) return res.status(400).json({ error: "Ongeldig gebruikers-id" });
    const del = await at(`${encodeURIComponent(__kl.USERS)}/${id}`, { method: "DELETE" });
    if (del && del.error) return res.status(del.error.type === "NOT_FOUND" ? 404 : 500).json({ error: "Gebruiker verwijderen mislukt" });
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: "Onbekende actie" });
}

module.exports = { ACTIONS, run };
