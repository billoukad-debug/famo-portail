require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Beheer : point d'entrée HTTP unique (garde A-10, session beheerder, journal d'audit). Les actions
// vivent par domaine dans lib/beheer/ (config, producten, klanten, klantgebruikers, toegang, prijzen).
const { atAll, __auth, __journal, REC, parseBody, clean, statusPayload } = require("../lib/beheer/common");
// require statiques : Vercel (nft) n'embarque que les fichiers qu'il voit.
const BEHEER = [require("../lib/beheer/config"), require("../lib/beheer/producten"), require("../lib/beheer/klanten"),
  require("../lib/beheer/klantgebruikers"), require("../lib/beheer/toegang"), require("../lib/beheer/prijzen")];

const handler = async (req, res) => {
  if (!__auth.hasCode()) {
    return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  }

  try {
    if (req.method === "GET") {
      // adminOk (signature, sans lecture) puis adminSession : session non révoquée (base ≤ 60 s).
      if (!__auth.adminOk(req) || !(await __auth.adminSession(req))) {
        return res.status(401).json({ error: "Enkel voor beheerders" });
      }
      // Pastille « Beheer » de la navigation : seulement le nombre de demandes non traitées (un appel, un champ).
      if (req.query && req.query.counts) {
        const a = await atAll("Aanvragen?fields%5B%5D=Status");
        if (a.error) throw new Error(a.error.message || "Aanvragen");
        return res.status(200).json({ aanvragen: (a.records || []).filter(r => (r.fields["Status"] || "Nieuw") === "Nieuw").length });
      }
      const data = await statusPayload();
      return res.status(200).json(data);
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Alleen GET of POST toegestaan" });
    }

    const body = parseBody(req);
    const me = __auth.adminOk(req) ? await __auth.adminSession(req) : null;
    if (!me) {
      return res.status(401).json({ error: "Enkel voor beheerders" });
    }

    const action = clean(body.action, 40);

    // Actions par domaine : lib/beheer/*.js (audit I-10). Une action inconnue → 400.
    const mod = BEHEER.find(m => m.ACTIONS.includes(action));
    if (mod) return await mod.run({ req, res, body, me, action });
    return res.status(400).json({ error: "Onbekende actie" });
  } catch (e) {
    // Jamais le message brut (détails de la base) vers le navigateur : il reste dans les logs.
    console.error("[onboarding]", (req.body && req.body.action) || req.method, e && e.stack || e);
    return res.status(500).json({ error: "Serverfout in Beheer. Probeer opnieuw." });
  }
};

// Journal d'audit (lib/journal.js, moteur SQL) : chaque action Beheer réussie, avec l'état de
// l'enregistrement avant → après (prix de base, IBAN, taux de TVA, archivage, suppressions…).
// Codes, PIN et mots de passe : jamais la valeur, seulement « gewijzigd ».
const TARGET = { saveProduct: "Catalogue", deleteProduct: "Catalogue", saveClient: "Clients", checkVies: "Clients", archiveClient: "Clients", unarchiveClient: "Clients",
  resetPassword: "Clients", revokeAccess: "Clients", saveMedewerker: "Medewerkers", deleteMedewerker: "Medewerkers", closeAanvraag: "Aanvragen", deletePrice: "Prix négociés",
  saveKlantgebruiker: "Klantgebruikers", resetKlantgebruiker: "Klantgebruikers", deleteKlantgebruiker: "Klantgebruikers" };
module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  const st = __journal.store();
  if (req.method !== "POST" || !st) return handler(req, res);
  let body = {};
  try { body = parseBody(req) || {}; } catch (e) { return handler(req, res); }
  const action = clean(body.action, 40);
  if (!action || action === "previewCredentials") return handler(req, res);
  let table = TARGET[action] || "", id = table && REC.test(String(body.id || "")) ? String(body.id) : "";
  if (action === "saveConfig" || action === "saveVoorwaarden" || action === "saveEnkelPin") { table = "Configuratie"; try { id = ((await st.list("Configuratie"))[0] || {}).id || ""; } catch (e) { id = ""; } }
  const before = id ? await __journal.get(table, id) : null;
  await handler(req, res);
  if (res.statusCode !== 200) return;
  const after = id ? await __journal.get(table, id) : null;
  const skip = /^(action|foto|data|image|file)/i;
  const wijz = id ? __journal.diff(before, after) : Object.entries(body).filter(([k]) => !skip.test(k)).map(([k, v]) => ({ veld: k, voor: "", na: /wachtwoord|password|hash|code|token|pin|secret/i.test(k) ? "•••" : (typeof v === "string" ? v : JSON.stringify(v)).slice(0, 300) }));
  const f = after || before || {};
  await __journal.log({ wie: __auth.actorOf(req), rol: __auth.roleOf(req), actie: action, object: table || "Beheer", record: id,
    referentie: f["Produit"] || f["Nom"] || f["Bedrijfsnaam"] || f["Naam"] || body.nom || body.clientId || "", wijzigingen: wijz, reden: body.reden || "" });
};
