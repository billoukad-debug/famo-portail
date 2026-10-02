require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, REC } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __mail = require("../lib/ordermail");
const __prices = require("../lib/prices");
const __orderNumber = require("../lib/ordernumber");
const __lev = require("../lib/levering");
const __lj = require("../lib/lignesjson");
const __bestelling = require("../lib/bestelling");
function staffCodeReady(res){
  if (__auth.hasCode()) return true;
  res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt. Stel de omgevingsvariabele in op Vercel." });
  return false;
}

// Lignes décidées par le serveur (lib/bestelling.js, partagé avec api/order.js et la commande par e-mail).
function buildOrderLines(clientId, items){
  return __bestelling.buildOrderLines(clientId, items, __bestelling.MSG_PERSONEEL);
}

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  if (!staffCodeReady(res)) return;
  try {
    // ---------- POST : créer une commande au nom d'un client ----------
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      if (!body) body = {};
      // Le personnel prend aussi les commandes par téléphone : session staff suffit.
      if (!(await __auth.staffSession(req))) return res.status(401).json({ error: "Ongeldige personeelscode" });
      const { clientId, notes, bron } = body;
      const dateLivraison = body.dateLivraison ? String(body.dateLivraison).slice(0, 10) : "";
      if (!clientId || !REC.test(String(clientId))) return res.status(400).json({ error: "Klant en artikelen vereist" });
      if (dateLivraison) {
        const rules = await __lev.loadRules(at);
        const dateErr = __lev.checkDate(dateLivraison, rules);
        if (dateErr) return res.status(400).json({ error: dateErr });
      }
      let order;
      try { order = await buildOrderLines(clientId, body.items); }
      catch (e) { return res.status(400).json({ error: String(e.message || e) }); }

      const ref = await __orderNumber.nextOrderRef(at);
      const fields = {
        "Référence": ref,
        "Date": __lev.brusselsToday(), // jour de Bruxelles, pas UTC (00:00–02:00 = même jour)
        "Lignes (produits / quantités)": order.lignes,
        "Lignes besteld": order.lignes,
        [__lj.FIELD]: order.json,
        "Statut": "Reçue",
        "Statut paiement": "En attente",
        "Total": order.total,
        "Notes": (bron ? "[" + bron + "] " : "") + String(notes || "").slice(0, 500),
        "Client": [clientId]
      };
      if (dateLivraison) fields["Date livraison souhaitée"] = dateLivraison;

      const j = await at("Commandes", { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
      if (j.error) { console.error("[staff]", j.error.message || j.error); return res.status(500).json({ error: "Opslaan of lezen mislukt. Probeer opnieuw." }); }

      // Le client n'est jamais charge dans ce handler : on le lit APRES la
      // creation, pour qu'un echec de lecture ne puisse jamais bloquer
      // l'enregistrement de la commande. Le .catch est structurel (cf. order.js).
      let mail = null;
      if (__mail.enabled()) {
        mail = await (async () => {
          const cli = await at("Clients/" + encodeURIComponent(clientId)).catch(() => null);
          const cfg = await __mail.loadMailConfig(at);
          const url = __mail.portalUrl(req);
          return __mail.notifyNewOrder({
            ref,
            recordId: j.records[0].id,
            date: fields["Date"],
            dateLivraison,
            notes: notes || "",
            lignes: order.lignes,
            verpakking: __lj.pakMap(order.json), // conditionnement figé (specs/023)
            total: order.total,
            bron: bron || "Handmatig",
            orderUrl: url ? url + "/team/bestelling?id=" + encodeURIComponent(j.records[0].id) : "",
            klant: cli && !cli.error ? __mail.clientFrom(cli) : { nom: clientId },
            opsEmail: cfg.opsEmail,
            company: cfg
          });
        })().catch(() => null);
      }

      await require("../lib/revision").bump();
      return res.status(200).json({ ref, id: j.records[0].id, total: order.total, mail });
    }

    if (!(await __auth.staffSession(req))) return res.status(401).json({ error: "Ongeldige personeelscode" });

    // ---------- GET ----------
    const q = req.query || {};
    // Liste des clients
    if (!q.client) {
      const cl = await atAll("Clients");
      const clients = (cl.records || []).filter(r => !r.fields["Gearchiveerd"]).map(r => ({
        id: r.id,
        nom: r.fields["Nom"] || "",
        adresse: r.fields["Lieu de livraison"] || "",
        tel: r.fields["Téléphone"] || "",
        email: (r.fields["Email"] || "").trim()
      })).sort((a, b) => a.nom.localeCompare(b.nom));
      return res.status(200).json({ clients });
    }

    // Catalogue avec les prix négociés d'un client donné
    const clientId = q.client;
    const cat = await atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`);
    const neg = await atAll(`${encodeURIComponent("Prix négociés")}`);
    const negMap = __prices.negotiatedFor(neg.records, clientId);
    const products = (cat.records || []).map(r => ({
      id: r.id,
      nom: r.fields["Produit"],
      cat: r.fields["Catégorie"] || "",
      unite: r.fields["Unité"] || "",
      base: r.fields["Prix de base"] || 0,
      prix: __prices.unitPrice(r, negMap),
      kaliber: String(r.fields["Kaliber"] || "").trim(),
      // Vignette dans Invoeren (spec 018) : la photo principale, URL sûre.
      foto: require("../lib/photo").photoUrl(r.fields["Foto"]),
      volgorde: r.fields["Volgorde"] == null || r.fields["Volgorde"] === "" ? null : Number(r.fields["Volgorde"]),
      // Verpakking (specs/023) : stepper par conditionnement dans Invoeren ; le serveur refuse le reste.
      ...require("../lib/verpakking").apiFields(r.fields)
    }));
    const rules = await __lev.loadRules(at);
    return res.status(200).json({ products, levering: __lev.publicRules(rules) });
  } catch (e) {
    { console.error("[staff]", e && e.message || e); res.status(500).json({ error: "Serverfout. Probeer opnieuw." }); }
  }
};
