"use strict";
// Identifiants du portail client (audit H-08) : un client peut avoir plusieurs utilisateurs.
//   - l'identifiant « principal » vit sur la fiche Clients (Gebruikersnaam / Wachtwoord) ;
//   - les utilisateurs supplémentaires vivent dans la table « Klantgebruikers » :
//     Client (lien), Naam, Gebruikersnaam, Wachtwoord (scrypt), Email, Actief,
//     Sessiegeneratie, Echecs, Geblokkeerd tot.
// Mot de passe, jeton, verrou et déconnexion portent sur la fiche de CONNEXION ; commandes,
// prix, favoris et documents restent ceux du client. Un nom d'utilisateur est unique sur les
// deux tables (api/onboarding.js le vérifie).
const { at, escapeFormula } = require("./airtable");

const USERS = "Klantgebruikers";
const notFound = (err) => /NOT_FOUND/.test(String(err && (typeof err === "string" ? err : err.type || err.error || "")));
const down = (err) => Object.assign(new Error("Database tijdelijk onbereikbaar"), { code: "DB_UNAVAILABLE", cause: err });

// { table, rec } → forme commune : l'enregistrement qui porte le mot de passe.
const login = (table, rec) => ({ table, id: rec.id, fields: rec.fields || {} });

// Fiche client d'un utilisateur supplémentaire (null si le lien est cassé ou le client absent).
async function clientOfUser(u) {
  const cid = ((u.fields || {})["Client"] || [])[0];
  if (!cid) return null;
  const c = await at(`Clients/${cid}`);
  if (!c || (c.error && !notFound(c.error))) throw down(c && c.error);
  return c.error ? null : c;
}

// Par identifiant d'enregistrement (jeton, lien de mot de passe) : Clients puis Klantgebruikers.
// → { client, login } | null. Lève DB_UNAVAILABLE sur une panne (jamais « inconnu »).
async function byId(id) {
  const c = await at(`Clients/${id}`);
  if (!c || (c.error && !notFound(c.error))) throw down(c && c.error);
  if (!c.error) return { client: c, login: login("Clients", c) };
  const u = await at(`${USERS}/${id}`);
  if (!u || (u.error && !notFound(u.error))) throw down(u && u.error);
  if (u.error) return null;
  const client = await clientOfUser(u);
  return client ? { client, login: login(USERS, u) } : null;
}

// Par nom d'utilisateur (connexion, mot de passe oublié). → { client, login } | null.
async function byUser(user) {
  const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${escapeFormula(String(user || "").toLowerCase().trim())}'`);
  const c = await at(`Clients?filterByFormula=${f}&maxRecords=1`);
  if (!c || c.error) throw down(c && c.error);
  if (c.records && c.records[0]) return { client: c.records[0], login: login("Clients", c.records[0]) };
  const u = await at(`${encodeURIComponent(USERS)}?filterByFormula=${f}&maxRecords=1`);
  if (!u || u.error) {
    if (u && u.error && notFound(u.error)) return null; // table pas encore créée (Airtable)
    throw down(u && u.error);
  }
  const rec = u.records && u.records[0];
  if (!rec) return null;
  const client = await clientOfUser(rec);
  return client ? { client, login: login(USERS, rec) } : null;
}

// Connexion permise ? Client non archivé, utilisateur actif (case cochée ; une case décochée
// n'est pas enregistrée, comme dans Airtable : absent = inactif), mot de passe posé.
const usable = (r) => !!(r && r.client && !r.client.fields["Gearchiveerd"] && r.login.fields["Wachtwoord"] && (r.login.table === "Clients" || !!r.login.fields["Actief"]));

async function patch(lg, fields) {
  return at(`${encodeURIComponent(lg.table)}/${lg.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
}

// Nom affiché de la personne connectée (utilisateur supplémentaire) ; "" pour le principal.
const displayName = (lg) => lg && lg.table === USERS ? String(lg.fields["Naam"] || lg.fields["Gebruikersnaam"] || "").slice(0, 80) : "";
const email = (r) => String((r.login.table === USERS ? r.login.fields["Email"] : r.client.fields["Email"]) || "").trim();

module.exports = { USERS, byId, byUser, usable, patch, displayName, email, login };
