"use strict";
// Beheer · Toegang : medewerkers, codes, « enkel persoonlijke PIN » — actions de api/onboarding.js (audit I-10).
// Garde, session beheerder et journal d'audit restent dans api/onboarding.js (le seul point d'entrée HTTP).
const { at, atAll, __auth, REC, clean, getConfigRecord, statusPayload, beheerderPin, lastBeheerderBlock } = require("./common");

const ACTIONS = ["saveMedewerker", "deleteMedewerker", "saveCode", "saveEnkelPin"];

async function run({ res, body, me, action }) {
  if (action === "saveMedewerker") {
    const naam = clean(body.naam, 60);
    const rol = body.rol === "beheerder" ? "beheerder" : "personeel";
    const pin = String(body.pin || "");
    if (!naam) return res.status(400).json({ error: "Naam is verplicht" });
    if (body.id && !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig id" });
    // Nouveau PIN : 6 à 12 chiffres (un million de combinaisons au moins). Les PIN plus
    // courts déjà enregistrés continuent d'ouvrir (api/session.js) jusqu'à leur changement.
    if (!body.id && !pin) return res.status(400).json({ error: "PIN: 6 tot 12 cijfers" });
    if (pin && !/^\d{6,12}$/.test(pin)) return res.status(400).json({ error: "PIN: 6 tot 12 cijfers" });
    const fields = { "Naam": naam, "Rol": rol, "Actief": body.actief !== false };
    if (body.id && (rol !== "beheerder" || !fields["Actief"])) {
      const block = await lastBeheerderBlock(body.id, fields);
      if (block) return res.status(block.status).json({ error: block.error });
    }
    if (pin) {
      // Deux personnes au même PIN : la connexion ouvrirait au nom de la première trouvée
      // (journal faussé). On compare aux empreintes des autres comptes, actifs ou non.
      const all = await atAll("Medewerkers");
      if (all.error) { console.error("[onboarding] Medewerkers onleesbaar", all.error.type); return res.status(500).json({ error: "Medewerkers onleesbaar. Probeer opnieuw." }); }
      if ((all.records || []).some(r => r.id !== body.id && r.fields["PIN hash"] && __auth.verifyHash(r.fields["PIN hash"], pin))) return res.status(409).json({ error: "Deze PIN is al in gebruik. Kies een andere." });
      fields["PIN hash"] = __auth.hashCode(pin);
    }
    const saved = body.id
      ? await at(`Medewerkers/${body.id}`, { method: "PATCH", body: JSON.stringify({ typecast: true, fields }) })
      : await at("Medewerkers", { method: "POST", body: JSON.stringify({ typecast: true, records: [{ fields }] }) });
    if (saved.error) { console.error("[onboarding] saveMedewerker", saved.error.type, saved.error.message); return res.status(500).json({ error: "Medewerker opslaan mislukt" }); }
    // Désactivé, rôle retiré ou PIN changé : ses sessions tombent (tout de suite sur cette
    // instance, ≤ 60 s ailleurs — lib/staffauth.js).
    if (body.id && saved.fields) __auth.noteMedewerker(body.id, saved.fields);
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }
  if (action === "deleteMedewerker") {
    if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig id" });
    const block = await lastBeheerderBlock(body.id, null);
    if (block) return res.status(block.status).json({ error: block.error });
    const del = await at(`Medewerkers/${body.id}`, { method: "DELETE" });
    if (del.error) { console.error("[onboarding] deleteMedewerker", del.error.type, del.error.message); return res.status(500).json({ error: "Verwijderen mislukt" }); }
    __auth.noteMedewerker(body.id, null);
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }

  // ---- Codes d'accès (Instellingen) ----
  // Le code n'est jamais stocké en clair : seule son empreinte scrypt part en base.
  if (action === "saveCode") {
    const which = clean(body.which, 10);
    if (which !== "admin" && which !== "staff") {
      return res.status(400).json({ error: "Onbekend codetype" });
    }
    const code = String(body.code || "");
    const reset = body.reset === true;
    const field = which === "admin" ? "Beheerderscode hash" : "Personeelscode hash";

    if (!reset) {
      if (code.length < 10) {
        return res.status(400).json({ error: "De code moet minstens 10 tekens lang zijn" });
      }
      if (/^famo/i.test(code)) {
        return res.status(400).json({ error: "Gebruik geen code die met de bedrijfsnaam begint — te makkelijk te raden" });
      }
    }

    const existing = await getConfigRecord();
    if (existing && existing.error) { console.error("[onboarding] saveCode Configuratie", existing.error.type, existing.error.message); return res.status(500).json({ error: "Configuratie onleesbaar. Probeer opnieuw." }); }
    if (!existing || !existing.id) {
      return res.status(400).json({ error: "Vul eerst de bedrijfsgegevens in" });
    }
    const fields = {};
    fields[field] = reset ? "" : __auth.hashCode(code);
    const saved = await at(`${encodeURIComponent("Configuratie")}/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields })
    });
    if (saved.error) { console.error("[onboarding] saveCode", saved.error.type, saved.error.message); return res.status(500).json({ error: "Code opslaan mislukt" }); }
    // Nouveau code : toutes les sessions ouvertes tombent (génération +1, écriture séparée
    // pour ne pas faire échouer le changement de code sur une base sans ce champ). Le
    // beheerder qui vient de changer le code reçoit un cookie à la nouvelle génération.
    const next = (Number(existing.fields && existing.fields["Sessiegeneratie"]) || 0) + 1;
    const bumped = await at(`${encodeURIComponent("Configuratie")}/${existing.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Sessiegeneratie": next } }) }).catch(() => null);
    if (bumped && !bumped.error) {
      __auth.noteGeneration(next);
      __auth.setCookie(res, __auth.sign(me.exp, me.role, me.name, Object.assign({}, me.gen, { g: next })), Math.max(0, Math.floor((me.exp - Date.now()) / 1000)));
    } else console.error("[onboarding] Sessiegeneratie niet verhoogd", bumped && bumped.error && bumped.error.type);
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }

  // ---- Enkel persoonlijke pincodes (audit L-06, specs/005-pin-personnels-seuls) ----
  // Active : api/session.js refuse les codes partagés, seuls les PIN (et le secours
  // ADMIN_CODE) ouvrent. Jamais activée sans beheerder PIN active (sinon Beheer serait fermé).
  // Activation : génération +1 dans la même écriture (toutes les sessions tombent, comme
  // « Iedereen afmelden ») ; seul un beheerder connecté par PIN reçoit un cookie neuf. Le
  // journal (avant → après sur Configuratie) est écrit par l'enveloppe en bas de ce fichier.
  if (action === "saveEnkelPin") {
    const aan = body.aan === true;
    const existing = await getConfigRecord();
    if (existing && existing.error) { console.error("[onboarding] saveEnkelPin Configuratie", existing.error.type); return res.status(500).json({ error: "Configuratie onleesbaar. Probeer opnieuw." }); }
    if (!existing || !existing.id) return res.status(400).json({ error: "Vul eerst de bedrijfsgegevens in" });
    const fields = { "Enkel persoonlijke PIN": aan };
    const bump = aan && !existing.fields["Enkel persoonlijke PIN"];
    if (aan) {
      const all = await atAll("Medewerkers");
      if (all.error) { console.error("[onboarding] saveEnkelPin Medewerkers", all.error.type); return res.status(500).json({ error: "Medewerkers onleesbaar. Probeer opnieuw." }); }
      if (!(all.records || []).some(r => beheerderPin(r.fields))) {
        return res.status(409).json({ error: "Maak eerst een actieve medewerker aan met rol Beheerder en een eigen PIN (hierboven, Medewerkers). Anders kan niemand Beheer nog openen." });
      }
    }
    const next = (Number(existing.fields["Sessiegeneratie"]) || 0) + 1;
    if (bump) fields["Sessiegeneratie"] = next;
    const saved = await at(`${encodeURIComponent("Configuratie")}/${existing.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    if (!saved || saved.error) { console.error("[onboarding] saveEnkelPin", saved && saved.error && saved.error.type); return res.status(500).json({ error: "Instelling opslaan mislukt. Probeer opnieuw." }); }
    const viaPin = !!(me.gen && me.gen.med);
    if (bump) {
      __auth.noteGeneration(next);
      if (viaPin) __auth.setCookie(res, __auth.sign(me.exp, me.role, me.name, Object.assign({}, me.gen, { g: next })), Math.max(0, Math.floor((me.exp - Date.now()) / 1000)));
    }
    return res.status(200).json({ ok: true, afgemeld: bump && !viaPin, ...(await statusPayload()) });
  }
  return res.status(400).json({ error: "Onbekende actie" });
}

module.exports = { ACTIONS, run };
