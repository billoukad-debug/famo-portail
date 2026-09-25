require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, REC } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __mail = require("../lib/ordermail");
const __prices = require("../lib/prices");
const __orderNumber = require("../lib/ordernumber");
const __lev = require("../lib/levering");
function staffCodeReady(res){
  if (__auth.hasCode()) return true;
  res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt. Stel de omgevingsvariabele in op Vercel." });
  return false;
}

function numberOf(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanComment(value){
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/[()\[\]]/g, "").trim().slice(0, 200);
}

async function buildOrderLines(clientId, items){
  if (!Array.isArray(items) || !items.length) throw new Error("Klant en artikelen vereist");
  const cat = await atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`);
  const negotiated = await atAll(`${encodeURIComponent("Prix négociés")}`);
  const prices = __prices.negotiatedFor(negotiated.records, clientId);
  const products = new Map((cat.records || []).map(record => [record.id, record]));
  const merged = new Map();
  for (const item of items) {
    const productId = String(item && item.productId || "");
    const quantity = numberOf(item && item.quantity);
    if (!productId || quantity <= 0 || quantity > 100000 || !products.has(productId)) throw new Error("Ongeldig artikel of aantal");
    if (!/kg/i.test(String(products.get(productId).fields["Unité"] || "")) && !Number.isInteger(quantity)) {
      throw new Error("Alleen producten per kg mogen een decimale hoeveelheid hebben");
    }
    const old = merged.get(productId) || { quantity: 0, comment: "" };
    old.quantity += quantity;
    old.comment = cleanComment(item.comment) || old.comment;
    merged.set(productId, old);
  }
  let total = 0;
  const lines = [];
  for (const [productId, item] of merged) {
    const fields = products.get(productId).fields;
    const price = __prices.unitPrice(products.get(productId), prices);
    total += price * item.quantity;
    lines.push(`${fields["Produit"] || "Artikel"} × ${item.quantity}${fields["Unité"] ? " " + fields["Unité"] : ""} [€${price.toFixed(2)}]${item.comment ? " (" + item.comment + ")" : ""}`);
  }
  return { lignes: lines.join("\n"), total: Math.round(total * 100) / 100 };
}

module.exports = async (req, res) => {
  if (!staffCodeReady(res)) return;
  try {
    // ---------- POST : créer une commande au nom d'un client ----------
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      if (!body) body = {};
      // Le personnel prend aussi les commandes par téléphone : session staff suffit.
      if (!__auth.staffOk(req)) return res.status(401).json({ error: "Ongeldige personeelscode" });
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
            date: fields["Date"],
            dateLivraison,
            notes: notes || "",
            lignes: order.lignes,
            total: order.total,
            bron: bron || "Handmatig",
            orderUrl: url ? url + "/order.html?id=" + encodeURIComponent(j.records[0].id) : "",
            klant: cli && !cli.error ? __mail.clientFrom(cli) : { nom: clientId },
            opsEmail: cfg.opsEmail,
            company: cfg
          });
        })().catch(() => null);
      }

      return res.status(200).json({ ref, id: j.records[0].id, total: order.total, mail });
    }

    if (!__auth.staffOk(req)) return res.status(401).json({ error: "Ongeldige personeelscode" });

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
      volgorde: r.fields["Volgorde"] == null || r.fields["Volgorde"] === "" ? null : Number(r.fields["Volgorde"])
    }));
    const rules = await __lev.loadRules(at);
    return res.status(200).json({ products, levering: __lev.publicRules(rules) });
  } catch (e) {
    { console.error("[staff]", e && e.message || e); res.status(500).json({ error: "Serverfout. Probeer opnieuw." }); }
  }
};
