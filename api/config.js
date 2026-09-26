require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __lev = require("../lib/levering");

// Pagine sur toute la table : au-dela de 100 lignes, un simple pageSize=100
// mentait sur le compte (plafonne silencieusement).
async function count(table, formula){
  const f = formula ? `?filterByFormula=${encodeURIComponent(formula)}` : "";
  const j = await atAll(`${encodeURIComponent(table)}${f}`);
  return (j.records || []).length;
}

// Identite societe (table Configuratie, une seule ligne) + etat de mise en service.
// Lecture seule : la saisie se fait dans Airtable, sans redeploiement.
module.exports = async (req, res) => {
  if (!__auth.hasCode()) return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  try {
    const q = req.query || {};
    const wantPublic = String(q.public || "") === "1";
    const staffOk = __auth.staffOk(req);
    const adminOk = __auth.adminOk(req);

    const conf = await at(`${encodeURIComponent("Configuratie")}?maxRecords=1`);
    const c = ((conf.records || [])[0] || {}).fields || {};
    const config = {
      bedrijfsnaam: c["Bedrijfsnaam"] || "",
      adres: c["Adres"] || "",
      plaats: c["Postcode en plaats"] || "",
      btw: c["BTW-nummer"] || "",
      telefoon: c["Telefoon"] || "",
      email: c["E-mail"] || "",
      iban: (c["IBAN"] || "").trim(),
      bic: (c["BIC"] || "").trim(),
      btwTarief: Number(c["BTW-tarief"]) > 0 ? Number(c["BTW-tarief"]) : 6,
      betalingsvoorwaarden: (c["Betalingsvoorwaarden"] || "").trim(),
      leveringsvoorwaarden: (c["Leveringsvoorwaarden"] || "").trim(),
      // Boite interne qui recoit les nouvelles commandes. PRIVEE : volontairement
      // absente de contactOnly ci-dessous, qui part au public et au staff non-admin.
      bestellingenEmail: (c["Bestellingen e-mail"] || "").trim()
    };
    const rules = __lev.rulesFrom(c);
    config.betaaltermijnDagen = rules.betaaltermijn;
    config.voorraadAfboeken = rules.voorraadAfboeken;
    config.levering = __lev.publicRules(rules);
    const contactOnly = {
      bedrijfsnaam: config.bedrijfsnaam || "FAMO Seafood",
      adres: config.adres,
      plaats: config.plaats,
      btw: config.btw,
      telefoon: config.telefoon,
      email: config.email,
      levering: config.levering
    };

    // Public contact block for the client portal (no IBAN/BIC).
    if (wantPublic && !staffOk) {
      return res.status(200).json({ config: contactOnly });
    }

    if (!staffOk) return res.status(401).json({ error: "Ongeldige personeelscode" });

    // Personeel (non beheerder) : tout ce qui s'imprime sur un bon ou une facture — IBAN, BIC,
    // taux de TVA, conditions — puisque ces documents sortent aussi du magasin. Sans cela, une
    // facture imprimée par le personnel retombait sur l'IBAN d'exemple et un taux de 6 % par défaut.
    // La boîte interne des commandes (bestellingenEmail) reste réservée au beheerder.
    if (!adminOk) {
      return res.status(200).json({ config: Object.assign({}, contactOnly, {
        iban: config.iban,
        bic: config.bic,
        btwTarief: config.btwTarief,
        betaaltermijnDagen: config.betaaltermijnDagen,
        voorraadAfboeken: config.voorraadAfboeken,
        betalingsvoorwaarden: config.betalingsvoorwaarden,
        leveringsvoorwaarden: config.leveringsvoorwaarden
      }) });
    }

    if (q.status === "1") {
      if (!adminOk) return res.status(401).json({ error: "Enkel voor beheerders" });
      const [catalogue, clients, prijzen, stock, orders, aanvragen] = await Promise.all([
        count("Catalogue", "{Actif}=1"),
        count("Clients"),
        count("Prix négociés"),
        count("Stock"),
        count("Commandes"),
        count("Aanvragen", "{Status}='Nieuw'")
      ]);
      return res.status(200).json({ config, status: {
        identiteit: !!(config.bedrijfsnaam && config.btw && config.iban && config.bic),
        ibanOntbreekt: !config.iban || !config.bic,
        catalogueReady: catalogue > 0,
        clientsReady: clients > 0,
        prijzenReady: prijzen > 0,
        stockReady: stock > 0,
        catalogue, clients, prijzen, stock, orders, aanvragen
      }});
    }
    res.status(200).json({ config });
  } catch (e) {
    { console.error("[config]", e && e.message || e); res.status(500).json({ error: "Serverfout. Probeer opnieuw." }); }
  }
};
