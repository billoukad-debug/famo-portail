"use strict";
// Beheer · Bedrijfsgegevens et conditions (Configuratie) — actions de api/onboarding.js (audit I-10).
// Garde, session beheerder et journal d'audit restent dans api/onboarding.js (le seul point d'entrée HTTP).
const { at, __mail, __terms, __lev, __bill, clean, getConfigRecord, statusPayload } = require("./common");

const ACTIONS = ["saveConfig", "saveVoorwaarden", "saveMailBestellingen"];

async function run({ res, body, action }) {
  // ---- Configuratie société ----
  if (action === "saveConfig") {
    const fields = {
      "Bedrijfsnaam": clean(body.bedrijfsnaam, 120),
      "Adres": clean(body.adres, 200),
      "Postcode en plaats": clean(body.plaats, 120),
      "BTW-nummer": clean(body.btw, 40),
      "Telefoon": clean(body.telefoon, 40),
      "E-mail": clean(body.email, 120),
      "IBAN": clean(body.iban, 40).replace(/\s+/g, "").toUpperCase(),
      "BIC": clean(body.bic, 20).replace(/\s+/g, "").toUpperCase(),
      "Betalingsvoorwaarden": clean(body.betalingsvoorwaarden, 200),
      "Leveringsvoorwaarden": clean(body.leveringsvoorwaarden, 500),
      "Bestellingen e-mail": clean(body.bestellingenEmail, 120).toLowerCase(),
      // Mentions légales (WVV art. 2:20) et mode de facturation (lib/billing.js).
      "Juridische naam": clean(body.juridischeNaam, 120),
      "Rechtsvorm": clean(body.rechtsvorm, 40),
      "RPR": clean(body.rpr, 120),
      // Traçabilité : un lot par article obligatoire avant « Klaar » (api/updateorder.js).
      "Lots verplicht": body.lotsVerplicht === true,
      // Relances de paiement automatiques (H-01) : mode Portaal seulement (lib/reminders.js).
      "Herinneringen aan": body.herinneringen === true
    };
    const mode = clean(body.facturatie, 20);
    if (mode && !__bill.MODES.includes(mode)) return res.status(400).json({ error: "Ongeldige facturatie: Boekhouder of Portaal" });
    fields["Facturatie"] = mode || "Boekhouder";
    if (fields["Bestellingen e-mail"] && !__mail.isEmail(fields["Bestellingen e-mail"])) {
      return res.status(400).json({ error: "Ongeldig e-mailadres voor bestelmeldingen" });
    }
    const tarief = Number(body.btwTarief);
    if (Number.isFinite(tarief) && tarief >= 0 && tarief <= 100) fields["BTW-tarief"] = tarief;
    if (!fields["Bedrijfsnaam"] || !fields["BTW-nummer"]) {
      return res.status(400).json({ error: "Bedrijfsnaam en BTW-nummer zijn verplicht" });
    }
    // Contrôles de forme des identifiants bancaires et TVA : ils s'impriment sur chaque facture.
    const ibanOk = v => { const s = String(v || ""); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false; const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55)); let m = 0; for (const d of r) m = (m * 10 + Number(d)) % 97; return m === 1; };
    if (fields["IBAN"] && !ibanOk(fields["IBAN"])) return res.status(400).json({ error: "Ongeldig IBAN (controlecijfers kloppen niet)" });
    if (fields["BIC"] && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(fields["BIC"])) return res.status(400).json({ error: "Ongeldige BIC" });
    const btwDigits = fields["BTW-nummer"].replace(/[^0-9]/g, "");
    if (/^BE/i.test(fields["BTW-nummer"]) && !(btwDigits.length === 10 && 97 - (Number(btwDigits.slice(0, 8)) % 97) === Number(btwDigits.slice(8)))) return res.status(400).json({ error: "Ongeldig Belgisch BTW-nummer (controlecijfers kloppen niet)" });
    // Règles de livraison et de facturation.
    const dl = String(body.besteldeadline || "").trim();
    if (dl && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(dl)) return res.status(400).json({ error: "Besteldeadline: uur als UU:MM" });
    fields["Besteldeadline"] = dl;
    fields["Leverdagen"] = String(body.leverdagen || "").toLowerCase().split(/[,\s;]+/).filter(d => __lev.DAY_KEYS.includes(d)).join(",");
    const closed = String(body.geslotenDagen || "").split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (closed.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(d + "T12:00:00Z").getTime()))) return res.status(400).json({ error: "Gesloten dagen: één datum per regel, JJJJ-MM-DD" });
    fields["Gesloten dagen"] = Array.from(new Set(closed)).sort().join("\n");
    const minimum = Number(String(body.minimumBestelling || "0").replace(",", "."));
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100000) return res.status(400).json({ error: "Ongeldig minimumbedrag" });
    fields["Minimum bestelling"] = Math.round(minimum * 100) / 100;
    const termijn = Number(body.betaaltermijnDagen);
    if (body.betaaltermijnDagen !== undefined && body.betaaltermijnDagen !== "" && (!Number.isInteger(termijn) || termijn < 0 || termijn > 120)) return res.status(400).json({ error: "Betaaltermijn: 0 tot 120 dagen" });
    if (Number.isInteger(termijn) && termijn > 0) fields["Betaaltermijn dagen"] = termijn;
    fields["Voorraad afboeken"] = body.voorraadAfboeken === true;
    const existing = await getConfigRecord();
    if (existing && existing.error) return res.status(500).json(existing);
    let saved;
    if (existing && existing.id) {
      saved = await at(`${encodeURIComponent("Configuratie")}/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields })
      });
    } else {
      saved = await at(encodeURIComponent("Configuratie"), {
        method: "POST",
        body: JSON.stringify({ records: [{ fields }] })
      });
    }
    if (saved.error) return res.status(500).json({ error: saved.error.message || "Opslaan mislukt" });
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }

  // ---- Conditions générales (C-12) ----
  // Texte NL/FR ; « publish » = nouvelle version à faire accepter par chaque client avant sa
  // commande suivante (api/order.js). Sans publish, seul le texte change (coquille corrigée).
  if (action === "saveVoorwaarden") {
    const nl = __terms.clean(body.nl), fr = __terms.clean(body.fr);
    if (String(body.nl || "").length > __terms.MAX || String(body.fr || "").length > __terms.MAX) return res.status(400).json({ error: "Tekst te lang (max " + __terms.MAX + " tekens)" });
    if (body.publish === true && !nl && !fr) return res.status(400).json({ error: "Geen tekst om te publiceren" });
    const existing = await getConfigRecord();
    if (!existing || existing.error || !existing.id) return res.status(500).json({ error: "Configuratie onleesbaar. Sla eerst de bedrijfsgegevens op." });
    const fields = { "Voorwaarden NL": nl, "Voorwaarden FR": fr };
    if (body.publish === true) fields["Voorwaarden versie"] = __terms.newVersion();
    const saved = await at(`${encodeURIComponent("Configuratie")}/${existing.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    if (saved.error) { console.error("[onboarding] voorwaarden", saved.error.type, saved.error.message); return res.status(500).json({ error: "Opslaan mislukt. Probeer opnieuw." }); }
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }
  // ---- Bestellen per e-mail (specs/020) : adres om aan klanten te geven + automatisch aanmaken ----
  // Uit (standaard) = elke mail gaat naar Bestellingen → Te controleren ; het personeel beslist.
  if (action === "saveMailBestellingen") {
    const adres = clean(body.adres, 120).toLowerCase();
    if (adres && !__mail.isEmail(adres)) return res.status(400).json({ error: "Ongeldig e-mailadres voor bestellingen per e-mail" });
    const existing = await getConfigRecord();
    if (!existing || existing.error || !existing.id) return res.status(500).json({ error: "Configuratie onleesbaar. Sla eerst de bedrijfsgegevens op." });
    const fields = { "Bestel-e-mailadres": adres, "Mailbestellingen automatisch": body.automatisch === true };
    const saved = await at(`${encodeURIComponent("Configuratie")}/${existing.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    if (saved.error) { console.error("[onboarding] mailbestellingen", saved.error.type, saved.error.message); return res.status(500).json({ error: "Opslaan mislukt. Probeer opnieuw." }); }
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }
  return res.status(400).json({ error: "Onbekende actie" });
}

module.exports = { ACTIONS, run };
