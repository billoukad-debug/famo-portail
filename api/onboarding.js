const crypto = require("crypto");
const TOKEN = process.env.AIRTABLE_TOKEN;
const __auth = require("../lib/staffauth");
const BASE = "appcdduLth9iGX8I0";

async function at(path, opts) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
  return r.json();
}

async function atAll(path) {
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

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; }
  }
  return body || {};
}

function clean(s, max) {
  return String(s || "").trim().slice(0, max || 200);
}

function slugUser(nom) {
  const base = String(nom || "klant")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 18);
  return base || "klant";
}

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

async function uniqueUsername(base) {
  let candidate = base;
  for (let i = 0; i < 20; i++) {
    const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${candidate.replace(/'/g, "")}'`);
    const hit = await at(`Clients?filterByFormula=${f}&maxRecords=1`);
    if (!(hit.records || []).length) return candidate;
    candidate = base.slice(0, 14) + "." + (i + 2);
  }
  return base + "." + crypto.randomInt(100, 999);
}

function mapUnitIn(u) {
  const v = String(u || "").toLowerCase().trim();
  if (v === "kassa" || v === "caisse") return "caisse";
  if (v === "doos" || v === "carton") return "carton";
  if (v === "stuk" || v === "pièce" || v === "piece") return "pièce";
  if (v === "kg") return "kg";
  return clean(u, 40) || "caisse";
}

async function getConfigRecord() {
  const conf = await at(`${encodeURIComponent("Configuratie")}?maxRecords=1`);
  if (conf.error) return conf;
  return (conf.records || [])[0] || null;
}

async function statusPayload() {
  const rec = await getConfigRecord();
  if (rec && rec.error) throw new Error(rec.error.message || "Configuratie onleesbaar");
  const c = (rec && rec.fields) || {};
  const config = {
    id: rec ? rec.id : null,
    bedrijfsnaam: c["Bedrijfsnaam"] || "",
    adres: c["Adres"] || "",
    plaats: c["Postcode en plaats"] || "",
    btw: c["BTW-nummer"] || "",
    telefoon: c["Telefoon"] || "",
    email: c["E-mail"] || "",
    iban: (c["IBAN"] || "").trim(),
    bic: (c["BIC"] || "").trim()
  };

  const [cat, clients, prices, stock, orders] = await Promise.all([
    atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`),
    atAll("Clients"),
    atAll(encodeURIComponent("Prix négociés")),
    atAll("Stock"),
    atAll("Commandes?maxRecords=5")
  ]);

  if (cat.error) throw new Error(cat.error.message || "Catalogue");
  if (clients.error) throw new Error(clients.error.message || "Clients");
  if (prices.error) throw new Error(prices.error.message || "Prijzen");
  if (stock.error) throw new Error(stock.error.message || "Stock");

  const products = (cat.records || []).map(r => ({
    id: r.id,
    nom: r.fields["Produit"] || "",
    cat: r.fields["Catégorie"] || "",
    unite: r.fields["Unité"] || "",
    base: Number(r.fields["Prix de base"] || 0),
    actif: !!r.fields["Actif"]
  })).sort((a, b) => a.nom.localeCompare(b.nom, "nl"));

  const clientList = (clients.records || []).map(r => ({
    id: r.id,
    nom: r.fields["Nom"] || "",
    adresse: r.fields["Lieu de livraison"] || "",
    tel: r.fields["Téléphone"] || "",
    btw: r.fields["BTW-nummer"] || "",
    klantnr: r.fields["Klantnummer"] || "",
    user: r.fields["Gebruikersnaam"] || "",
    hasPassword: !!r.fields["Wachtwoord"]
  })).sort((a, b) => a.nom.localeCompare(b.nom, "nl"));

  const priceList = (prices.records || []).map(r => ({
    id: r.id,
    clientId: (r.fields["Client"] || [])[0] || "",
    productId: (r.fields["Produit"] || [])[0] || "",
    prix: Number(r.fields["Prix négocié"] || 0)
  }));

  const stockList = (stock.records || []).map(r => ({
    id: r.id,
    product: r.fields["Produit"] || "",
    quantity: Number(r.fields["Quantité disponible"] || 0),
    lowThreshold: Number(r.fields["Seuil bas"] || 0)
  })).sort((a, b) => a.product.localeCompare(b.product, "nl"));

  return {
    config,
    products,
    clients: clientList,
    prices: priceList,
    stock: stockList,
    status: {
      identiteit: !!(config.bedrijfsnaam && config.btw && config.iban && config.bic),
      ibanOntbreekt: !config.iban || !config.bic,
      catalogue: products.length,
      clients: clientList.length,
      prijzen: priceList.length,
      stock: stockList.length,
      orders: (orders.records || []).length,
      credentials: clientList.filter(c => c.user && c.hasPassword).length
    }
  };
}

module.exports = async (req, res) => {
  if (!__auth.hasCode()) {
    return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  }

  try {
    if (req.method === "GET") {
      if (!__auth.staffOk(req)) {
        return res.status(401).json({ error: "Ongeldige personeelscode" });
      }
      const data = await statusPayload();
      return res.status(200).json(data);
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Alleen GET of POST toegestaan" });
    }

    const body = parseBody(req);
    if (!__auth.staffOk(req)) {
      return res.status(401).json({ error: "Ongeldige personeelscode" });
    }

    const action = clean(body.action, 40);

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
        "BIC": clean(body.bic, 20).replace(/\s+/g, "").toUpperCase()
      };
      if (!fields["Bedrijfsnaam"] || !fields["BTW-nummer"]) {
        return res.status(400).json({ error: "Bedrijfsnaam en BTW-nummer zijn verplicht" });
      }
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

    // ---- Catalogue product ----
    if (action === "saveProduct") {
      const nom = clean(body.nom, 120);
      const unite = mapUnitIn(body.unite);
      const base = Number(body.base);
      const cat = clean(body.cat, 80) || "Algemeen";
      if (!nom) return res.status(400).json({ error: "Productnaam is verplicht" });
      if (!Number.isFinite(base) || base < 0) return res.status(400).json({ error: "Ongeldige basisprijs" });
      const fields = {
        "Produit": nom,
        "Catégorie": cat,
        "Unité": unite,
        "Prix de base": Math.round(base * 100) / 100,
        "Actif": body.actif === false ? false : true
      };
      let saved;
      if (body.id) {
        saved = await at(`Catalogue/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
      } else {
        saved = await at("Catalogue", { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
      }
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Product opslaan mislukt" });

      // Sync / create stock row by product name (existing Airtable Stock table).
      const stock = await atAll("Stock");
      if (!stock.error) {
        const norm = s => String(s || "").toLowerCase().trim();
        const existingStock = (stock.records || []).find(r => norm(r.fields["Produit"]) === norm(nom));
        const qtyRaw = body.stock;
        const qty = Number(qtyRaw);
        const low = Number(body.lowThreshold);
        const stockFields = { "Produit": nom };
        if (Number.isFinite(qty) && qty >= 0) stockFields["Quantité disponible"] = Math.round(qty * 1000) / 1000;
        if (Number.isFinite(low) && low >= 0) stockFields["Seuil bas"] = low;
        if (existingStock) {
          if (Object.keys(stockFields).length > 1) {
            await at(`Stock/${existingStock.id}`, { method: "PATCH", body: JSON.stringify({ fields: stockFields }) });
          }
        } else {
          if (!Number.isFinite(stockFields["Quantité disponible"])) stockFields["Quantité disponible"] = 0;
          if (!Number.isFinite(stockFields["Seuil bas"])) stockFields["Seuil bas"] = 0;
          await at("Stock", { method: "POST", body: JSON.stringify({ records: [{ fields: stockFields }] }) });
        }
      }
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // ---- Client + credentials ----
    if (action === "saveClient") {
      const nom = clean(body.nom, 120);
      if (!nom) return res.status(400).json({ error: "Klantnaam is verplicht" });
      let user = clean(body.user, 40).toLowerCase();
      let password = clean(body.password, 80);
      const generate = body.generate !== false;
      if (!user) user = await uniqueUsername(slugUser(nom));
      else {
        const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${user.replace(/'/g, "")}'`);
        const hit = await at(`Clients?filterByFormula=${f}&maxRecords=1`);
        const other = (hit.records || [])[0];
        if (other && other.id !== body.id) {
          return res.status(409).json({ error: "Deze gebruikersnaam bestaat al" });
        }
      }
      if (generate || !password) password = genPassword();
      if (password.length < 6) return res.status(400).json({ error: "Wachtwoord minstens 6 tekens" });

      const fields = {
        "Nom": nom,
        "Lieu de livraison": clean(body.adresse, 250),
        "Téléphone": clean(body.tel, 40),
        "BTW-nummer": clean(body.btw, 40),
        "Klantnummer": clean(body.klantnr, 40),
        "Gebruikersnaam": user,
        "Wachtwoord": password
      };

      let saved;
      if (body.id) {
        // On update: only set password if generate or password provided
        if (!generate && !clean(body.password, 80)) delete fields["Wachtwoord"];
        saved = await at(`Clients/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
      } else {
        saved = await at("Clients", { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
      }
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Klant opslaan mislukt" });
      const id = body.id || (saved.records && saved.records[0] && saved.records[0].id);
      return res.status(200).json({
        ok: true,
        credentials: { id, nom, user, password },
        ...(await statusPayload())
      });
    }

    if (action === "resetPassword") {
      if (!body.id) return res.status(400).json({ error: "Klant-id ontbreekt" });
      const password = body.password ? clean(body.password, 80) : genPassword();
      if (password.length < 6) return res.status(400).json({ error: "Wachtwoord minstens 6 tekens" });
      const cur = await at(`Clients/${body.id}`);
      if (cur.error) return res.status(404).json({ error: "Klant niet gevonden" });
      const saved = await at(`Clients/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { "Wachtwoord": password } })
      });
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Wachtwoord wijzigen mislukt" });
      return res.status(200).json({
        ok: true,
        credentials: {
          id: body.id,
          nom: cur.fields["Nom"] || "",
          user: cur.fields["Gebruikersnaam"] || "",
          password
        },
        ...(await statusPayload())
      });
    }

    // ---- Prix négocié ----
    if (action === "savePrice") {
      const clientId = clean(body.clientId, 40);
      const productId = clean(body.productId, 40);
      const prix = Number(body.prix);
      if (!clientId || !productId) return res.status(400).json({ error: "Klant en product zijn verplicht" });
      if (!Number.isFinite(prix) || prix < 0) return res.status(400).json({ error: "Ongeldige prijs" });

      const all = await atAll(encodeURIComponent("Prix négociés"));
      if (all.error) return res.status(500).json(all);
      const existing = (all.records || []).find(r => {
        const c = r.fields["Client"] || [];
        const p = r.fields["Produit"] || [];
        return c.includes(clientId) && p.includes(productId);
      });
      const fields = {
        "Client": [clientId],
        "Produit": [productId],
        "Prix négocié": Math.round(prix * 100) / 100
      };
      let saved;
      if (existing) {
        saved = await at(`${encodeURIComponent("Prix négociés")}/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ fields })
        });
      } else {
        saved = await at(encodeURIComponent("Prix négociés"), {
          method: "POST",
          body: JSON.stringify({ records: [{ fields }] })
        });
      }
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Prijs opslaan mislukt" });
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    if (action === "deletePrice") {
      const id = clean(body.id, 40);
      if (!id) return res.status(400).json({ error: "Prijs-id ontbreekt" });
      const del = await at(`${encodeURIComponent("Prix négociés")}/${id}`, { method: "DELETE" });
      if (del && del.error) return res.status(500).json({ error: del.error.message || "Prijs verwijderen mislukt" });
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // ---- Stock ----
    if (action === "saveStock") {
      const product = clean(body.product, 120);
      const quantity = Number(body.quantity);
      if (!product) return res.status(400).json({ error: "Productnaam is verplicht" });
      if (!Number.isFinite(quantity) || quantity < 0) return res.status(400).json({ error: "Ongeldige hoeveelheid" });
      const stock = await atAll("Stock");
      if (stock.error) return res.status(500).json(stock);
      const norm = s => String(s || "").toLowerCase().trim();
      const existing = (stock.records || []).find(r => norm(r.fields["Produit"]) === norm(product));
      const fields = {
        "Produit": product,
        "Quantité disponible": Math.round(quantity * 1000) / 1000
      };
      if (Number(body.lowThreshold) >= 0) fields["Seuil bas"] = Number(body.lowThreshold) || 0;
      let saved;
      if (existing) {
        saved = await at(`Stock/${existing.id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
      } else {
        saved = await at("Stock", { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
      }
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Voorraad opslaan mislukt" });
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // ---- Generate credentials preview (no save) ----
    if (action === "previewCredentials") {
      const nom = clean(body.nom, 120) || "klant";
      const user = await uniqueUsername(slugUser(nom));
      return res.status(200).json({ user, password: genPassword() });
    }

    return res.status(400).json({ error: "Onbekende actie" });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
