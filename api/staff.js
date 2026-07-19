const TOKEN = process.env.AIRTABLE_TOKEN;
const STAFF_CODE = process.env.STAFF_CODE || "famo2026";
const BASE = "appcdduLth9iGX8I0";

async function at(path, opts){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
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
  const prices = new Map();
  (negotiated.records || []).forEach(record => {
    const clients = record.fields["Client"] || [];
    const products = record.fields["Produit"] || [];
    if (clients.includes(clientId) && products[0]) prices.set(products[0], numberOf(record.fields["Prix négocié"]));
  });
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
    const price = prices.has(productId) ? prices.get(productId) : numberOf(fields["Prix de base"]);
    total += price * item.quantity;
    lines.push(`${fields["Produit"] || "Artikel"} × ${item.quantity}${fields["Unité"] ? " " + fields["Unité"] : ""} [€${price.toFixed(2)}]${item.comment ? " (" + item.comment + ")" : ""}`);
  }
  return { lignes: lines.join("\n"), total: Math.round(total * 100) / 100 };
}

module.exports = async (req, res) => {
  try {
    // ---------- POST : créer une commande au nom d'un client ----------
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      if (!body) body = {};
      if (body.code !== STAFF_CODE) return res.status(401).json({ error: "Code invalide" });
      const { clientId, notes, dateLivraison, bron } = body;
      if (!clientId) return res.status(400).json({ error: "Klant en artikelen vereist" });
      let order;
      try { order = await buildOrderLines(clientId, body.items); }
      catch (e) { return res.status(400).json({ error: String(e.message || e) }); }

      const ref = "CMD-" + Date.now();
      const fields = {
        "Référence": ref,
        "Date": new Date().toISOString().slice(0, 10),
        "Lignes (produits / quantités)": order.lignes,
        "Statut": "Reçue",
        "Statut paiement": "En attente",
        "Total": order.total,
        "Notes": (bron ? "[" + bron + "] " : "") + (notes || ""),
        "Client": [clientId]
      };
      if (dateLivraison) fields["Date livraison souhaitée"] = dateLivraison;

      const j = await at("Commandes", { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
      if (j.error) return res.status(500).json(j);
      return res.status(200).json({ ref, id: j.records[0].id, total: order.total });
    }

    // ---------- GET ----------
    const q = req.query || {};
    if (q.code !== STAFF_CODE) return res.status(401).json({ error: "Code invalide" });

    // Liste des clients
    if (!q.client) {
      const cl = await atAll("Clients");
      const clients = (cl.records || []).map(r => ({
        id: r.id,
        nom: r.fields["Nom"] || "",
        adresse: r.fields["Lieu de livraison"] || "",
        tel: r.fields["Téléphone"] || ""
      })).sort((a, b) => a.nom.localeCompare(b.nom));
      return res.status(200).json({ clients });
    }

    // Catalogue avec les prix négociés d'un client donné
    const clientId = q.client;
    const cat = await atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`);
    const neg = await atAll(`${encodeURIComponent("Prix négociés")}`);
    const negMap = {};
    (neg.records || []).forEach(r => {
      const cli = r.fields["Client"] || [];
      const prod = r.fields["Produit"] || [];
      if (cli.includes(clientId) && prod.length) negMap[prod[0]] = r.fields["Prix négocié"];
    });
    const products = (cat.records || []).map(r => ({
      id: r.id,
      nom: r.fields["Produit"],
      cat: r.fields["Catégorie"] || "",
      unite: r.fields["Unité"] || "",
      base: r.fields["Prix de base"] || 0,
      prix: (negMap[r.id] != null ? negMap[r.id] : (r.fields["Prix de base"] || 0))
    }));
    return res.status(200).json({ products });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
