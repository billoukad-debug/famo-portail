const TOKEN = process.env.AIRTABLE_TOKEN;
const __mail = require("../lib/ordermail");
const __prices = require("../lib/prices");
const __orderNumber = require("../lib/ordernumber");
const __lev = require("../lib/levering");
// Anti-abus minimal (memoire d'instance, best-effort sur serverless).
const _rl = new Map();
function rateLimited(key, max, windowMs){
  const now = Date.now();
  const e = _rl.get(key) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++; _rl.set(key, e);
  return e.n > max;
}

const BASE = "appcdduLth9iGX8I0";

async function at(path){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}

async function atAll(path){
  let offset = "", records = [];
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await at(path + (offset ? sep + "offset=" + encodeURIComponent(offset) : ""));
    if (page.error) return page;
    records = records.concat(page.records || []);
    offset = page.offset || "";
  } while (offset);
  return { records };
}

// Même authentification que les autres endpoints client (client archivé refusé,
// limite anti-force brute partagée) : une seule implémentation à maintenir.
const { authClient } = require("./catalogue");

function roundMoney(value){
  return Math.round((Number(value) || 0) * 100) / 100;
}

function numberOf(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanComment(value){
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/[()\[\]]/g, "").trim().slice(0, 200);
}

// The browser may choose quantities, but never product names or prices.  Those
// always come back from Airtable for the authenticated customer.
async function buildOrderLines(clientId, items){
  if (!Array.isArray(items) || !items.length) throw new Error("Geen artikelen");

  const cat = await atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`);
  const negotiated = await atAll(`${encodeURIComponent("Prix négociés")}`);
  const priceByProduct = __prices.negotiatedFor(negotiated.records, clientId);
  const products = new Map((cat.records || []).map(record => [record.id, record]));

  const merged = new Map();
  for (const item of items) {
    const productId = String(item && item.productId || "");
    const quantity = numberOf(item && item.quantity);
    if (!productId || quantity <= 0 || quantity > 100000) throw new Error("Ongeldige hoeveelheid");
    if (!products.has(productId)) throw new Error("Artikel is niet beschikbaar");
    if (!/kg/i.test(String(products.get(productId).fields["Unité"] || "")) && !Number.isInteger(quantity)) {
      throw new Error("Alleen producten per kg mogen een decimale hoeveelheid hebben");
    }
    const prev = merged.get(productId) || { quantity: 0, comment: "" };
    prev.quantity += quantity;
    prev.comment = cleanComment(item && item.comment) || prev.comment;
    merged.set(productId, prev);
  }

  const lines = [];
  let total = 0;
  for (const [productId, entry] of merged) {
    const quantity = entry.quantity;
    const fields = products.get(productId).fields;
    const price = __prices.unitPrice(products.get(productId), priceByProduct);
    const unit = fields["Unité"] || "";
    const name = fields["Produit"] || "Artikel";
    const comment = entry.comment;
    // Keep the agreed unit price with the order. It makes a later invoice
    // reproducible even if the catalogue price changes in the meantime.
    lines.push(`${name} × ${quantity}${unit ? " " + unit : ""} [€${price.toFixed(2)}]${comment ? " (" + comment + ")" : ""}`);
    total += price * quantity;
  }
  return { lignes: lines.join("\n"), total: roundMoney(total) };
}

// Prepare et envoie les deux confirmations. Ne jette jamais.
async function notifyOrderMail(ctx) {
  if (!__mail.enabled()) return null;
  const cfg = await __mail.loadMailConfig(at);
  return __mail.notifyNewOrder({
    ref: ctx.ref,
    date: ctx.date,
    dateLivraison: ctx.dateLivraison,
    notes: ctx.notes,
    lignes: ctx.lignes,
    total: ctx.total,
    bron: ctx.bron,
    orderUrl: __mail.portalUrl(ctx.req) ? __mail.portalUrl(ctx.req) + "/order.html?id=" + encodeURIComponent(ctx.recordId) : "",
    klant: __mail.clientFrom(ctx.client),
    opsEmail: cfg.opsEmail,
    company: cfg
  });
}

// Jour de livraison demandé par le client. Aujourd'hui = date civile à Bruxelles
// (Vercel tourne en UTC). Le serveur ne rejoue pas la coupure de 22:00 : une
// commande passée à 21:59 côté client ne doit pas être refusée parce que la
// requête arrive à 22:00:30. Il refuse seulement l'impossible.
// Règles par défaut (sans Configuratie) : même fonction que lib/levering, gardée ici
// pour les appelants qui n'ont pas encore chargé la configuration.
function checkDeliveryDate(iso, rules) {
  return __lev.checkDate(iso, rules);
}
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};

    // Le client est identifié côté serveur : on ne fait jamais confiance au clientId envoyé.
    const client = await authClient(body.user, body.pw);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    const clientId = client.id;
    // Contrôle de forme AVANT le compteur anti-abus : une date impossible dans un
    // panier ne doit pas consommer d'essai. Les règles Configuratie (jours, fermetures,
    // minimum) sont relues juste après, une seule fois.
    const { notes } = body;
    const dateLivraison = body.dateLivraison ? String(body.dateLivraison).slice(0, 10) : "";
    if (dateLivraison && checkDeliveryDate(dateLivraison)) {
      return res.status(400).json({ error: checkDeliveryDate(dateLivraison) });
    }
    const rules = await __lev.loadRules(at);
    if (dateLivraison) {
      const dateErr = __lev.checkDate(dateLivraison, rules);
      if (dateErr) return res.status(400).json({ error: dateErr });
    }

    if (rateLimited("order:" + clientId, 10, 3600000)) {
      return res.status(429).json({ error: "Te veel bestellingen in korte tijd. Wacht even en probeer opnieuw, of bel ons." });
    }
    let order;
    try {
      order = await buildOrderLines(clientId, body.items);
    } catch (e) {
      return res.status(400).json({ error: String(e.message || e) });
    }

    if (rules.minimum > 0 && order.total < rules.minimum) {
      return res.status(400).json({ error: `Minimum bestelling: € ${rules.minimum.toFixed(2).replace(".", ",")} excl. btw (nu € ${order.total.toFixed(2).replace(".", ",")})` });
    }

    const ref = await __orderNumber.nextOrderRef(at);
    const today = __lev.brusselsToday();
    const fields = {
      "Référence": ref,
      "Date": today,
      "Lignes (produits / quantités)": order.lignes,
      "Statut": "Reçue",
      "Statut paiement": "En attente",
      "Total": order.total,
      "Notes": notes || "",
      "Client": [clientId]
    };
    if (dateLivraison) fields["Date livraison souhaitée"] = dateLivraison;

    const r = await fetch(`https://api.airtable.com/v0/${BASE}/Commandes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields }] })
    });
    const j = await r.json();
    if (j.error) return res.status(500).json(j);

    // Notification e-mail : la commande est DEJA enregistree ici. Le .catch est
    // structurel — sans lui, un echec d'envoi remonterait au catch general qui
    // repond 500, transformant une commande valide en erreur pour le client.
    // On attend l'envoi car Vercel gele l'execution des que la reponse part.
    const mail = await notifyOrderMail({
      req, ref, date: today, dateLivraison, notes,
      lignes: order.lignes, total: order.total,
      recordId: j.records[0].id, client, bron: "Klantportaal"
    }).catch(() => null);

    res.status(200).json({ ref, id: j.records[0].id, total: order.total, mail });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
module.exports.checkDeliveryDate = checkDeliveryDate;
