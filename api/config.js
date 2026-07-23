const TOKEN = process.env.AIRTABLE_TOKEN;
const __auth = require("../lib/staffauth");
const BASE = "appcdduLth9iGX8I0";

async function at(path){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}
async function count(table, formula){
  const f = formula ? `&filterByFormula=${encodeURIComponent(formula)}` : "";
  const j = await at(`${encodeURIComponent(table)}?pageSize=100${f}`);
  return (j.records || []).length;
}

// Identite societe (table Configuratie, une seule ligne) + etat de mise en service.
// Lecture seule : la saisie se fait dans Airtable, sans redeploiement.
module.exports = async (req, res) => {
  if (!__auth.hasCode()) return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  try {
    const q = req.query || {};
    const wantPublic = String(q.public || "") === "1";
    const staffOk = __auth.staffOk(req, q.code);

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
      bic: (c["BIC"] || "").trim()
    };

    // Public contact block for the client portal (no IBAN/BIC).
    if (wantPublic && !staffOk) {
      return res.status(200).json({
        config: {
          bedrijfsnaam: config.bedrijfsnaam || "Famo Trading BV",
          adres: config.adres,
          plaats: config.plaats,
          btw: config.btw,
          telefoon: config.telefoon,
          email: config.email
        }
      });
    }

    if (!staffOk) return res.status(401).json({ error: "Ongeldige personeelscode" });

    if (q.status === "1") {
      const [catalogue, clients, prijzen, stock, orders] = await Promise.all([
        count("Catalogue", "{Actif}=1"),
        count("Clients"),
        count("Prix négociés"),
        count("Stock"),
        count("Commandes")
      ]);
      return res.status(200).json({ config, status: {
        identiteit: !!(config.bedrijfsnaam && config.btw && config.iban && config.bic),
        ibanOntbreekt: !config.iban || !config.bic,
        catalogueReady: catalogue > 0,
        clientsReady: clients > 0,
        prijzenReady: prijzen > 0,
        stockReady: stock > 0,
        catalogue, clients, prijzen, stock, orders
      }});
    }
    res.status(200).json({ config });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
