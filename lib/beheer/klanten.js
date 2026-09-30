"use strict";
// Beheer · Klanten : fiche, VIES, archivage, RGPD, mots de passe, demandes — actions de api/onboarding.js (audit I-10).
// Garde, session beheerder et journal d'audit restent dans api/onboarding.js (le seul point d'entrée HTTP).
const { at, atAll, atBatch, __ca, __auth, __mail, __prices, __kl, __ordermail, __authmail, __bill, __vies, REC, clean, slugUser, genPassword, usernameOwner, uniqueUsername, statusPayload } = require("./common");

const ACTIONS = ["saveClient", "checkVies", "archiveClient", "unarchiveClient", "exportClient", "anonymizeClient", "resetPassword", "revokeAccess", "securityStatus", "hashAllPasswords", "closeAanvraag", "previewCredentials"];

async function run({ req, res, body, action }) {

  // ---- Client + credentials ----
  if (action === "saveClient") {
    const nom = clean(body.nom, 120);
    if (!nom) return res.status(400).json({ error: "Klantnaam is verplicht" });
    if (body.id && !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig klant-id" });
    let user = clean(body.user, 40).toLowerCase().replace(/['"\s]+/g, "");
    let password = clean(body.password, 80);
    const generate = body.generate !== false;
    if (!user) user = await uniqueUsername(slugUser(nom));
    else {
      const other = await usernameOwner(user);
      if (other && other !== body.id) {
        return res.status(409).json({ error: "Deze gebruikersnaam bestaat al" });
      }
    }
    if (generate || !password) password = genPassword();
    if (password.length < 8) return res.status(400).json({ error: "Wachtwoord minstens 8 tekens" });

    const fields = {
      "Nom": nom,
      "Lieu de livraison": clean(body.adresse, 250),
      // Adresse du siège (facture, UBL) si différente du lieu de livraison (audit C-16).
      "Facturatieadres": clean(body.facturatieadres, 250),
      "Téléphone": clean(body.tel, 40),
      "BTW-nummer": clean(body.btw, 40),
      "Klantnummer": clean(body.klantnr, 40),
      "Email": clean(body.email, 120).toLowerCase(),
      "Taal": String(body.taal || "").toUpperCase() === "FR" ? "FR" : "NL", // langue des documents
      // Régime de TVA (C-10) : « Normal » = champ absent (valeur vide = effacé).
      "Régime TVA": "",
      "Gebruikersnaam": user,
      "Wachtwoord": __ca.hashPassword(password)
    };
    if (fields["Email"] && !__mail.isEmail(fields["Email"])) {
      return res.status(400).json({ error: "Ongeldig e-mailadres voor deze klant" });
    }
    // Régime de TVA (C-10) : valeur connue, cohérente avec le n° de TVA (intracommunautaire :
    // autre pays de l'UE ; cocontractant : n° belge valide). Rien n'est écrit sinon. Non envoyé
    // (ancien onglet, autre appelant) : celui déjà enregistré reste, et reste contrôlé.
    const cur = body.id ? await at(`Clients/${body.id}`) : null;
    const curFields = cur && !cur.error ? cur.fields || {} : {};
    const regime = body.regime === undefined ? __bill.vat.regime(curFields["Régime TVA"]).key : body.regime === null || body.regime === "" ? "Normal" : String(body.regime);
    if (!__bill.vat.REGIME_KEYS.includes(regime)) return res.status(400).json({ error: "Onbekend btw-regime" });
    const regimeErr = __bill.regimeProblem(regime, fields["BTW-nummer"]);
    if (regimeErr) return res.status(400).json({ error: regimeErr });
    if (regime !== "Normal") fields["Régime TVA"] = regime;
    // N° TVA belge : contrôle modulo 97 (il devient l'adresse Peppol du client dans l'UBL).
    const tva = fields["BTW-nummer"].toUpperCase().replace(/[\s.]/g, "");
    if (tva && /^(BE)?\d{9,10}$/.test(tva)) { const d = tva.replace(/\D/g, "").padStart(10, "0"); if (97 - (Number(d.slice(0, 8)) % 97) !== Number(d.slice(8))) return res.status(400).json({ error: "Ongeldig Belgisch BTW-nummer voor deze klant (controlecijfers)" }); }

    let saved;
    if (body.id) {
      // On update: only set password if generate or password provided
      if (!generate && !clean(body.password, 80)) delete fields["Wachtwoord"];
      // Contrôle VIES (C-16) d'un AUTRE numéro que celui enregistré : il ne vaut plus, effacé.
      const prev = __vies.stored(curFields);
      const now = (__bill.parseVat(fields["BTW-nummer"]) || {}).full || "";
      if (prev && prev.vatNumber !== now) { fields["VIES gecontroleerd op"] = null; fields["VIES resultaat"] = ""; }
      saved = await at(`Clients/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    } else {
      saved = await at("Clients", { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
    }
    if (saved.error) return res.status(500).json({ error: saved.error.message || "Klant opslaan mislukt" });
    const id = body.id || (saved.records && saved.records[0] && saved.records[0].id);
    // E-mail de bienvenue si le client a une adresse et qu'un (nouveau) mot de passe vient
    // d'être créé : gebruikersnaam + lien d'activation (72 h) où il choisit son propre mot
    // de passe — jamais le mot de passe en clair. Celui que Beheer affiche reste valable
    // (à dicter par téléphone) jusqu'à ce choix. Jamais bloquant.
    let mail = null;
    const newCreds = !body.id || generate || !!clean(body.password, 80);
    if (newCreds && id && fields["Email"] && __ordermail.enabled() && body.sendMail !== false) {
      mail = await (async () => {
        const cfg = await __ordermail.loadMailConfig(at);
        const link = __authmail.passwordLink(__ordermail.portalUrl(req), __ca.issueResetToken({ id, fields }, __ca.ACTIVATION_TTL_MS));
        return __authmail.notifyActivation({ klant: { nom, email: fields["Email"], taal: fields["Taal"] }, user, link, hours: __ca.ACTIVATION_TTL_MS / 3600000, company: cfg, opsEmail: cfg.opsEmail, at: Date.now() });
      })().catch(() => null);
    }
    return res.status(200).json({
      ok: true,
      credentials: { id, nom, user, password },
      mail,
      ...(await statusPayload())
    });
  }

  // ---- Contrôle VIES d'un n° de TVA européen (audit C-16) ----
  // Beheerder seul (adminOk + adminSession ci-dessus, garde lib/guard en tête du module). Le numéro
  // contrôlé est celui envoyé (champ du formulaire) ou, à défaut, celui du client. Le résultat
  // n'est enregistré sur le client que s'il porte sur SON numéro enregistré. VIES en panne ou lent
  // (8 s) → 503 clair, rien n'est écrit ; l'enregistrement de la fiche n'en dépend jamais.
  if (action === "checkVies") {
    if (body.id && !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig klant-id" });
    const cur = body.id ? await at(`Clients/${body.id}`) : null;
    if (cur && cur.error) return res.status(404).json({ error: "Klant niet gevonden" });
    const savedNr = cur ? String(cur.fields["BTW-nummer"] || "") : "";
    const nr = clean(body.btw, 40) || savedNr;
    let v;
    try { v = await __vies.check(nr); } catch (e) {
      if (e && (e.status === 400 || e.status === 503)) return res.status(e.status).json({ error: e.message });
      throw e;
    }
    const stored = !!cur && (__bill.parseVat(savedNr) || {}).full === v.vatNumber;
    if (stored) {
      const w = await at(`Clients/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "VIES gecontroleerd op": v.checkedAt, "VIES resultaat": JSON.stringify({ valid: v.valid, name: v.name, address: v.address, vatNumber: v.vatNumber }) } }) });
      if (w.error) return res.status(500).json({ error: "VIES-resultaat opslaan mislukt" });
    }
    return res.status(200).json({ ok: true, vies: v, stored, ...(await statusPayload()) });
  }

  // Archiver / réactiver un client : plus de connexion ni de présence dans les listes,
  // fiche, prix et historique conservés. Rien n'est jamais supprimé.
  if (action === "archiveClient" || action === "unarchiveClient") {
    if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Klant-id ontbreekt" });
    const cur = await at(`Clients/${body.id}`);
    if (cur.error) return res.status(404).json({ error: "Klant niet gevonden" });
    const saved = await at(`Clients/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Gearchiveerd": action === "archiveClient" } }) });
    if (saved.error) return res.status(500).json({ error: saved.error.message || "Opslaan mislukt" });
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }

  // ---- RGPD : droit d'accès (export) et droit à l'effacement (anonymisation) — audit C-11 ----
  if (action === "exportClient" || action === "anonymizeClient") {
    if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Klant-id ontbreekt" });
    const cur = await at(`Clients/${body.id}`);
    if (cur.error) return res.status(404).json({ error: "Klant niet gevonden" });
    const cmd = await atAll("Commandes");
    if (cmd.error) return res.status(500).json({ error: "Bestellingen onleesbaar" });
    const mine = (cmd.records || []).filter(r => (r.fields["Client"] || []).includes(body.id));
    if (action === "exportClient") {
      const neg = await atAll(encodeURIComponent("Prix négociés"));
      const client = Object.assign({}, cur.fields); delete client["Wachtwoord"]; delete client["Commandes"]; delete client["Prix négociés"];
      return res.status(200).json({ ok: true, export: { exportedAt: new Date().toISOString(), client,
        prijzen: (neg.records || []).filter(r => (r.fields["Client"] || []).includes(body.id)).map(r => Object.assign({ product: r.fields["Produit"], prijs: r.fields["Prix négocié"] }, __prices.periodOf(r.fields))),
        bestellingen: mine.map(r => { const f = Object.assign({}, r.fields); delete f["Client"]; delete f["Idempotentie"]; return f; }),
        gebruikers: ((await atAll(encodeURIComponent(__kl.USERS)).catch(() => ({ records: [] }))).records || []).filter(r => (r.fields["Client"] || []).includes(body.id)).map(r => ({ naam: r.fields["Naam"] || "", gebruikersnaam: r.fields["Gebruikersnaam"] || "", email: r.fields["Email"] || "", actief: !!r.fields["Actief"] })) } });
    }
    // Anonymiser : seulement un client archivé. On garde ce que les factures doivent montrer pendant
    // 10 ans (nom de la société, n° TVA, adresses) ; on efface les données de personnes.
    if (!cur.fields["Gearchiveerd"]) return res.status(409).json({ error: "Archiveer de klant eerst" });
    if (body.confirm !== "ANONIEM") return res.status(400).json({ error: "Typ ANONIEM om te bevestigen" });
    const anon = "anon-" + String(body.id).slice(-6).toLowerCase();
    const w = await at(`Clients/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Email": null, "Téléphone": "", "Gebruikersnaam": anon, "Wachtwoord": "", "Favorieten": "", "Infos générales": "", "Articles habituels": "" } }) });
    if (w.error) return res.status(500).json({ error: "Anonimiseren mislukt" });
    // Utilisateurs supplémentaires (H-08) : noms et e-mails de personnes → supprimés.
    const users = ((await atAll(encodeURIComponent(__kl.USERS)).catch(() => ({ records: [] }))).records || []).filter(r => (r.fields["Client"] || []).includes(body.id));
    for (const u of users) await at(`${encodeURIComponent(__kl.USERS)}/${u.id}`, { method: "DELETE" }).catch(() => null);
    const withNames = mine.filter(r => r.fields["Réceptionné par"] || r.fields["Besteld door"]);
    if (withNames.length) await atBatch("Commandes", "PATCH", withNames.map(r => ({ id: r.id, fields: Object.assign({}, r.fields["Réceptionné par"] ? { "Réceptionné par": "[geanonimiseerd]" } : {}, r.fields["Besteld door"] ? { "Besteld door": "[geanonimiseerd]" } : {}) })), false);
    return res.status(200).json({ ok: true, geanonimiseerd: { klant: anon, bestellingen: withNames.length, gebruikers: users.length }, ...(await statusPayload()) });
  }

  if (action === "resetPassword") {
    if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Klant-id ontbreekt" });
    const password = body.password ? clean(body.password, 80) : genPassword();
    if (password.length < 8) return res.status(400).json({ error: "Wachtwoord minstens 8 tekens" });
    const cur = await at(`Clients/${body.id}`);
    if (cur.error) return res.status(404).json({ error: "Klant niet gevonden" });
    const hashed = __ca.hashPassword(password);
    const saved = await at(`Clients/${body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { "Wachtwoord": hashed } })
    });
    if (saved.error) { console.error("[onboarding] resetPassword", body.id, saved.error.type, saved.error.message); return res.status(500).json({ error: "Wachtwoord wijzigen mislukt" }); }
    // E-mail : lien (72 h, usage unique) pour choisir son mot de passe, jamais le mot de
    // passe lui-même ; celui de Beheer reste valable d'ici là.
    let mail = null;
    if (cur.fields["Email"] && __ordermail.enabled() && body.sendMail !== false) {
      mail = await (async () => {
        const cfg = await __ordermail.loadMailConfig(at);
        const link = __authmail.passwordLink(__ordermail.portalUrl(req), __ca.issueResetToken({ id: body.id, fields: { "Wachtwoord": hashed } }, __ca.ACTIVATION_TTL_MS));
        return __authmail.notifyResetLink({ klant: Object.assign(__ordermail.clientFrom(cur), { taal: cur.fields["Taal"] }), user: cur.fields["Gebruikersnaam"] || "", link, hours: __ca.ACTIVATION_TTL_MS / 3600000, company: cfg, opsEmail: cfg.opsEmail, at: Date.now() });
      })().catch(() => null);
    }
    return res.status(200).json({
      ok: true,
      credentials: {
        id: body.id,
        nom: cur.fields["Nom"] || "",
        user: cur.fields["Gebruikersnaam"] || "",
        password
      },
      mail,
      ...(await statusPayload())
    });
  }

  // Bloquer l'accès d'un client (fin de collaboration, compte compromis) : le mot de
  // passe est effacé, la connexion échoue, la fiche et l'historique restent intacts.
  // « Nieuw wachtwoord » rend l'accès.
  if (action === "revokeAccess") {
    if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Klant-id ontbreekt" });
    const cur = await at(`Clients/${body.id}`);
    if (cur.error) return res.status(404).json({ error: "Klant niet gevonden" });
    const saved = await at(`Clients/${body.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { "Wachtwoord": "" } })
    });
    if (saved.error) return res.status(500).json({ error: saved.error.message || "Toegang blokkeren mislukt" });
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }

  // ---- Sécurité (Systeemstatus) : état et hachage des mots de passe clients en clair ----
  // securityStatus : { klareWachtwoorden, hasSessionSecret } (lecture seule).
  // hashAllPasswords : hache les Wachtwoord encore en clair (migration sans attendre la
  // connexion de chaque client). scrypt coûte ≈ 0,45 s par mot de passe : au plus
  // HASH_BATCH par appel (durée maximale d'une fonction) ; Beheer relance tant que
  // klareWachtwoorden > 0. Chaque fiche est relue juste avant l'écriture : un client qui
  // change son mot de passe pendant ce temps n'est pas écrasé.
  if (action === "securityStatus" || action === "hashAllPasswords") {
    const HASH_BATCH = 12, BUDGET_MS = 6000;
    const all = await atAll("Clients?fields%5B%5D=Wachtwoord");
    if (all.error) { console.error("[onboarding] " + action, all.error.type, all.error.message); return res.status(500).json({ error: "Klanten onleesbaar. Probeer opnieuw." }); }
    const plain = (all.records || []).filter(r => r.fields["Wachtwoord"] && !__ca.isHashed(r.fields["Wachtwoord"]));
    let hashed = 0, failed = 0;
    if (action === "hashAllPasswords") {
      const started = Date.now();
      for (const r of plain.slice(0, HASH_BATCH)) {
        if (Date.now() - started > BUDGET_MS) break;
        const hash = __ca.hashPassword(r.fields["Wachtwoord"]);
        const cur = await at(`Clients/${r.id}`);
        if (!cur || cur.error || cur.fields["Wachtwoord"] !== r.fields["Wachtwoord"]) continue; // changé entre-temps
        const up = await at(`Clients/${r.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Wachtwoord": hash } }) });
        if (up && !up.error) hashed++;
        else { failed++; console.error("[onboarding] hashAllPasswords", r.id, up && up.error && up.error.type); }
      }
    }
    return res.status(200).json({ ok: failed === 0, hashed, failed, klareWachtwoorden: plain.length - hashed, hasSessionSecret: __auth.hasSessionSecret() });
  }

  // ---- Aanvraag (demande d'inscription publique) ----
  if (action === "closeAanvraag") {
    const id = clean(body.id, 40);
    if (!id) return res.status(400).json({ error: "Aanvraag-id ontbreekt" });
    if (!REC.test(id)) return res.status(400).json({ error: "Ongeldig aanvraag-id" }); // jamais « ../Autre-table/rec… »
    const saved = await at(`Aanvragen/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { "Status": "Verwerkt" } })
    });
    if (saved.error) return res.status(500).json({ error: saved.error.message || "Aanvraag bijwerken mislukt" });
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }

  // ---- Generate credentials preview (no save) ----
  if (action === "previewCredentials") {
    const nom = clean(body.nom, 120) || "klant";
    const user = await uniqueUsername(slugUser(nom));
    return res.status(200).json({ user, password: genPassword() });
  }
  return res.status(400).json({ error: "Onbekende actie" });
}

module.exports = { ACTIONS, run };
