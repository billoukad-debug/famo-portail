const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = "appcdduLth9iGX8I0";

async function at(path){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}

async function authClient(user, pw){
  if (!user || !pw) return null;
  const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${String(user).toLowerCase().replace(/'/g, "")}'`);
  const cl = await at(`Clients?filterByFormula=${f}`);
  if (!cl.records || !cl.records.length) return null;
  const rec = cl.records[0];
  const stored = rec.fields["Wachtwoord"];
  if (!stored || String(stored) !== String(pw)) return null;
  return rec;
}

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

  const cat = await at(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`);
  const negotiated = await at(`${encodeURIComponent("Prix négociés")}`);
  const priceByProduct = new Map();
  (negotiated.records || []).forEach(record => {
    const clients = record.fields["Client"] || [];
    const products = record.fields["Produit"] || [];
    if (clients.includes(clientId) && products[0]) priceByProduct.set(products[0], numberOf(record.fields["Prix négocié"]));
  });
  const products = new Map((cat.records || []).map(record => [record.id, record]));

  const merged = new Map();
  for (const item of items) {
    const productId = String(item && item.productId || "");
    const quantity = numberOf(item && item.quantity);
    if (!productId || quantity <= 0 || quantity > 100000) throw new Error("Ongeldige hoeveelheid");
    if (!products.has(productId)) throw new Error("Artikel is niet beschikbaar");
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }

  const lines = [];
  let total = 0;
  for (const [productId, quantity] of merged) {
    const fields = products.get(productId).fields;
    const price = priceByProduct.has(productId) ? priceByProduct.get(productId) : numberOf(fields["Prix de base"]);
    const unit = fields["Unité"] || "";
    const name = fields["Produit"] || "Artikel";
    const comment = cleanComment(item.comment);
    // Keep the agreed unit price with the order. It makes a later invoice
    // reproducible even if the catalogue price changes in the meantime.
    lines.push(`${name} × ${quantity}${unit ? " " + unit : ""} [€${price.toFixed(2)}]${comment ? " (" + comment + ")" : ""}`);
    total += price * quantity;
  }
  return { lignes: lines.join("\n"), total: roundMoney(total) };
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

    const { notes, dateLivraison } = body;
    let order;
    try {
      order = await buildOrderLines(clientId, body.items);
    } catch (e) {
      return res.status(400).json({ error: String(e.message || e) });
    }

    const ref = "CMD-" + Date.now();
    const today = new Date().toISOString().slice(0, 10);
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
    res.status(200).json({ ref, id: j.records[0].id, total: order.total });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
