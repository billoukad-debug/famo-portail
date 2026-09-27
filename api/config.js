const ds = require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __lev = require("../lib/levering");
const __bill = require("../lib/billing");
const log = require("../lib/log");

// Compte léger (E-05 : avant, chaque compte téléchargeait la table entière, 164 appels à
// 15 000 commandes, en parallèle au-delà de la limite Airtable de 5 requêtes/s).
//   - moteur SQL : COUNT(*) (ou lecture pré-filtrée en SQL si formule), une requête ;
//   - Airtable : pagine toujours sur toute la table (un pageSize=100 mentait sur le compte)
//     mais ne rapatrie qu'un seul petit champ par enregistrement (fields[]).
// Un compte illisible vaut 0 et se trouve dans le journal, jamais une erreur de page.
const LIGHT_FIELD = { "Catalogue": "Produit", "Clients": "Nom", "Prix négociés": "Prix négocié", "Stock": "Produit", "Commandes": "Référence", "Aanvragen": "Status" };
async function count(table, formula, L){
  try {
    if (ds.state.engine) return await ds.state.engine.count(table, formula);
    const f = formula ? `&filterByFormula=${encodeURIComponent(formula)}` : "";
    const j = await atAll(`${encodeURIComponent(table)}?fields%5B%5D=${encodeURIComponent(LIGHT_FIELD[table] || "Nom")}${f}`);
    if (j.error) { L.warn("compte illisible", { table, err: j.error }); return 0; }
    return (j.records || []).length;
  } catch (e) { L.warn("compte illisible", { table, err: e }); return 0; }
}

// Identite societe (table Configuratie, une seule ligne) + etat de mise en service.
// Lecture seule : la saisie se fait dans Airtable, sans redeploiement.
module.exports = async (req, res) => {
  const L = log.from(req, "config");
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
      bestellingenEmail: (c["Bestellingen e-mail"] || "").trim(),
      // Mode de facturation et mentions légales (Code des sociétés, art. 2:20) : lib/billing.js.
      facturatie: __bill.modeOf(c),
      lotsVerplicht: !!c["Lots verplicht"],
      legal: __bill.legalOf(c)
    };
    config.legalMissing = __bill.legalMissing(config.legal);
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
      levering: config.levering,
      legal: config.legal
    };

    // Public contact block for the client portal (no IBAN/BIC).
    // E-06 : identique pour tous les visiteurs (page d'accueil, mot de passe oublié) ->
    // cache CDN 5 min, servi périmé 10 min de plus pendant le rafraîchissement. Uniquement
    // cette réponse : les variantes personnel/beheer (IBAN, boîte interne) ne sont jamais
    // mises en cache (aucun Cache-Control public ailleurs).
    if (wantPublic && !staffOk) {
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
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
      // L'une après l'autre : en parallèle, Airtable dépassait 5 requêtes/s (429, 30 s de blocage).
      const catalogue = await count("Catalogue", "{Actif}=1", L);
      const clients = await count("Clients", "", L);
      const prijzen = await count("Prix négociés", "", L);
      const stock = await count("Stock", "", L);
      const orders = await count("Commandes", "", L);
      const aanvragen = await count("Aanvragen", "{Status}='Nieuw'", L);
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
    { L.error("serverfout", { err: e }); res.status(500).json({ error: "Serverfout. Probeer opnieuw." }); }
  }
};
