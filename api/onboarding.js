require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, atBatch, escapeFormula } = require("../lib/airtable");
const __ca = require("../lib/clientauth");
const crypto = require("crypto");
const TOKEN = process.env.AIRTABLE_TOKEN;
const __auth = require("../lib/staffauth");
const __mail = require("../lib/mail");
const __prices = require("../lib/prices");
const __ordermail = require("../lib/ordermail");
const __authmail = require("../lib/authmail");
const __lev = require("../lib/levering");
const BASE = "appcdduLth9iGX8I0";
const REC = /^[A-Za-z0-9]{1,40}$/;

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
    const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${escapeFormula(candidate)}'`);
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
    bic: (c["BIC"] || "").trim(),
    btwTarief: Number(c["BTW-tarief"]) > 0 ? Number(c["BTW-tarief"]) : 6,
    betalingsvoorwaarden: c["Betalingsvoorwaarden"] || "",
    leveringsvoorwaarden: c["Leveringsvoorwaarden"] || "",
    bestellingenEmail: (c["Bestellingen e-mail"] || "").trim(),
    // On expose seulement l'EXISTENCE d'un code personnalisé, jamais l'empreinte.
    adminCodeCustom: !!String(c["Beheerderscode hash"] || "").trim(),
    staffCodeCustom: !!String(c["Personeelscode hash"] || "").trim(),
    mailFromConfigured: !!String(process.env.MAIL_FROM || "").trim(),
    // Règles de livraison et de facturation (lib/levering) — modifiables ici, lues partout.
    besteldeadline: String(c["Besteldeadline"] || "").trim(),
    leverdagen: String(c["Leverdagen"] || "").trim(),
    geslotenDagen: String(c["Gesloten dagen"] || "").trim(),
    minimumBestelling: Number(c["Minimum bestelling"]) > 0 ? Number(c["Minimum bestelling"]) : 0,
    betaaltermijnDagen: Number(c["Betaaltermijn dagen"]) > 0 ? Number(c["Betaaltermijn dagen"]) : 14,
    voorraadAfboeken: !!c["Voorraad afboeken"]
  };
  config.levering = __lev.publicRules(__lev.rulesFrom(c));

  const [cat, clients, prices, stock, orders, aanvragen, medewerkers] = await Promise.all([
    // Tous les produits, inactifs compris : Beheer → Producten doit pouvoir les réactiver ou les supprimer.
    atAll("Catalogue"),
    atAll("Clients"),
    atAll(encodeURIComponent("Prix négociés")),
    atAll("Stock"),
    atAll("Commandes?maxRecords=5"),
    // Toutes les demandes : les traitées restent consultables (historique).
    atAll("Aanvragen"),
    atAll("Medewerkers").catch(() => ({ records: [] }))
  ]);

  if (cat.error) throw new Error(cat.error.message || "Catalogue");
  if (clients.error) throw new Error(clients.error.message || "Clients");
  if (prices.error) throw new Error(prices.error.message || "Prijzen");
  if (stock.error) throw new Error(stock.error.message || "Stock");
  if (aanvragen.error) throw new Error(aanvragen.error.message || "Aanvragen");

  const products = (cat.records || []).map(r => ({
    id: r.id,
    nom: r.fields["Produit"] || "",
    cat: r.fields["Catégorie"] || "",
    unite: r.fields["Unité"] || "",
    base: Number(r.fields["Prix de base"] || 0),
    kaliber: String(r.fields["Kaliber"] || "").trim(),
    omschrijving: String(r.fields["Omschrijving"] || "").trim(),
    btwTarief: Number(r.fields["BTW-tarief"]) > 0 ? Number(r.fields["BTW-tarief"]) : null,
    foto: require("../lib/photo").photoUrl(r.fields["Foto"]),
    actif: !!r.fields["Actif"],
    volgorde: r.fields["Volgorde"] == null || r.fields["Volgorde"] === "" ? null : Number(r.fields["Volgorde"])
  })).sort((a, b) => a.nom.localeCompare(b.nom, "nl"));

  const clientList = (clients.records || []).map(r => ({
    id: r.id,
    nom: r.fields["Nom"] || "",
    adresse: r.fields["Lieu de livraison"] || "",
    tel: r.fields["Téléphone"] || "",
    btw: r.fields["BTW-nummer"] || "",
    klantnr: r.fields["Klantnummer"] || "",
    email: (r.fields["Email"] || "").trim(),
    user: r.fields["Gebruikersnaam"] || "",
    hasPassword: !!r.fields["Wachtwoord"],
    gearchiveerd: !!r.fields["Gearchiveerd"],
    taal: String(r.fields["Taal"] || "").toUpperCase() === "FR" ? "FR" : "NL"
  })).sort((a, b) => a.nom.localeCompare(b.nom, "nl"));

  const priceList = (prices.records || []).map(r => ({
    id: r.id,
    clientId: (r.fields["Client"] || [])[0] || "",
    productId: (r.fields["Produit"] || [])[0] || "",
    prix: __prices.negotiatedValue(r.fields["Prix négocié"])
  }));

  const stockList = (stock.records || []).map(r => ({
    id: r.id,
    product: r.fields["Produit"] || "",
    quantity: Number(r.fields["Quantité disponible"] || 0),
    lowThreshold: Number(r.fields["Seuil bas"] || 0)
  })).sort((a, b) => a.product.localeCompare(b.product, "nl"));

  const aanvraagList = (aanvragen.records || [])
    .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime))
    .map(r => ({
      id: r.id,
      bedrijfsnaam: r.fields["Bedrijfsnaam"] || "",
      contactpersoon: r.fields["Contactpersoon"] || "",
      email: r.fields["Email"] || "",
      telefoon: r.fields["Telefoon"] || "",
      adres: r.fields["Adres"] || "",
      notities: r.fields["Notities"] || "",
      status: r.fields["Status"] || "Nieuw",
      taal: String(r.fields["Taal"] || "").toUpperCase() === "FR" ? "FR" : "NL",
      ontvangen: r.createdTime || ""
    }));
  const medewerkerList = ((medewerkers && medewerkers.records) || []).map(r => ({
    id: r.id, naam: r.fields["Naam"] || "", rol: r.fields["Rol"] || "personeel", actief: !!r.fields["Actief"], laatste: r.fields["Laatste aanmelding"] || ""
  })).sort((a, b) => a.naam.localeCompare(b.naam, "nl"));

  return {
    config,
    products,
    clients: clientList,
    prices: priceList,
    stock: stockList,
    aanvragen: aanvraagList,
    medewerkers: medewerkerList,
    status: {
      identiteit: !!(config.bedrijfsnaam && config.btw && config.iban && config.bic),
      ibanOntbreekt: !config.iban || !config.bic,
      catalogue: products.filter(p => p.actif).length,
      clients: clientList.filter(c => !c.gearchiveerd).length,
      prijzen: priceList.length,
      stock: stockList.length,
      orders: (orders.records || []).length,
      credentials: clientList.filter(c => !c.gearchiveerd && c.user && c.hasPassword).length,
      aanvragen: aanvraagList.filter(a => a.status === "Nieuw").length,
      mailEnabled: __mail.enabled(),
      // Sans MAIL_FROM, Resend n'envoie qu'au propriétaire du compte : pas « prêt ».
      mailReady: __mail.enabled() && !!config.bestellingenEmail && config.mailFromConfigured,
      klantenZonderEmail: clientList.filter(c => !c.gearchiveerd && !c.email).length,
      medewerkers: medewerkerList.filter(m => m.actief).length
    }
  };
}

module.exports = async (req, res) => {
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
        "BIC": clean(body.bic, 20).replace(/\s+/g, "").toUpperCase(),
        "Betalingsvoorwaarden": clean(body.betalingsvoorwaarden, 200),
        "Leveringsvoorwaarden": clean(body.leveringsvoorwaarden, 500),
        "Bestellingen e-mail": clean(body.bestellingenEmail, 120).toLowerCase()
      };
      if (fields["Bestellingen e-mail"] && !__mail.isEmail(fields["Bestellingen e-mail"])) {
        return res.status(400).json({ error: "Ongeldig e-mailadres voor bestelmeldingen" });
      }
      const tarief = Number(body.btwTarief);
      if (Number.isFinite(tarief) && tarief >= 0 && tarief <= 100) fields["BTW-tarief"] = tarief;
      if (!fields["Bedrijfsnaam"] || !fields["BTW-nummer"]) {
        return res.status(400).json({ error: "Bedrijfsnaam en BTW-nummer zijn verplicht" });
      }
      // Contrôles de forme des identifiants bancaires et TVA : ils s'impriment sur chaque facture.
      const ibanOk = v => { const s = String(v || ""); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false; const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55)); let m = 0; for (const d of r) m = (m * 10 + Number(d)) % 97; return m === 1; };
      if (fields["IBAN"] && !ibanOk(fields["IBAN"])) return res.status(400).json({ error: "Ongeldig IBAN (controlecijfers kloppen niet)" });
      if (fields["BIC"] && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(fields["BIC"])) return res.status(400).json({ error: "Ongeldige BIC" });
      const btwDigits = fields["BTW-nummer"].replace(/[^0-9]/g, "");
      if (/^BE/i.test(fields["BTW-nummer"]) && !(btwDigits.length === 10 && 97 - (Number(btwDigits.slice(0, 8)) % 97) === Number(btwDigits.slice(8)))) return res.status(400).json({ error: "Ongeldig Belgisch BTW-nummer (controlecijfers kloppen niet)" });
      // Règles de livraison et de facturation.
      const dl = String(body.besteldeadline || "").trim();
      if (dl && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(dl)) return res.status(400).json({ error: "Besteldeadline: uur als UU:MM" });
      fields["Besteldeadline"] = dl;
      fields["Leverdagen"] = String(body.leverdagen || "").toLowerCase().split(/[,\s;]+/).filter(d => __lev.DAY_KEYS.includes(d)).join(",");
      const closed = String(body.geslotenDagen || "").split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean);
      if (closed.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(new Date(d + "T12:00:00Z").getTime()))) return res.status(400).json({ error: "Gesloten dagen: één datum per regel, JJJJ-MM-DD" });
      fields["Gesloten dagen"] = Array.from(new Set(closed)).sort().join("\n");
      const minimum = Number(String(body.minimumBestelling || "0").replace(",", "."));
      if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100000) return res.status(400).json({ error: "Ongeldig minimumbedrag" });
      fields["Minimum bestelling"] = Math.round(minimum * 100) / 100;
      const termijn = Number(body.betaaltermijnDagen);
      if (body.betaaltermijnDagen !== undefined && body.betaaltermijnDagen !== "" && (!Number.isInteger(termijn) || termijn < 0 || termijn > 120)) return res.status(400).json({ error: "Betaaltermijn: 0 tot 120 dagen" });
      if (Number.isInteger(termijn) && termijn > 0) fields["Betaaltermijn dagen"] = termijn;
      fields["Voorraad afboeken"] = body.voorraadAfboeken === true;
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
      if (body.id && !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig product-id" });
      const fields = {
        "Produit": nom,
        "Catégorie": cat,
        "Unité": unite,
        "Prix de base": Math.round(base * 100) / 100,
        "Actif": body.actif === false ? false : true
      };
      // Kaliber : écrit seulement s'il est envoyé, pour que « Uit catalogus » ne l'efface pas.
      if (body.kaliber !== undefined) fields["Kaliber"] = clean(body.kaliber, 60);
      // Omschrijving : texte libre montré au client quand il déplie le produit (même règle d'écriture).
      if (body.omschrijving !== undefined) fields["Omschrijving"] = clean(body.omschrijving, 400);
      // TVA par produit (6 ou 21) ; vide = taux par défaut de Configuratie.
      if (body.btwTarief !== undefined) {
        const t = Number(body.btwTarief);
        if (body.btwTarief === "" || body.btwTarief === null) fields["BTW-tarief"] = null;
        else if (Number.isFinite(t) && t >= 0 && t <= 100) fields["BTW-tarief"] = t;
        else return res.status(400).json({ error: "Ongeldig btw-tarief" });
      }
      const norm = s => String(s || "").toLowerCase().trim();
      let oldName = "";
      if (body.id) {
        const before = await at(`Catalogue/${body.id}`);
        if (before.error) return res.status(404).json({ error: "Product niet gevonden" });
        oldName = String(before.fields["Produit"] || "");
        // Un nom déjà pris par un autre produit casserait l'appariement par nom des lignes et du stock.
        const dup = await atAll("Catalogue");
        if ((dup.records || []).some(r => r.id !== body.id && norm(r.fields["Produit"]) === norm(nom))) return res.status(409).json({ error: "Er bestaat al een product met die naam" });
      } else {
        const dup = await atAll("Catalogue");
        if ((dup.records || []).some(r => norm(r.fields["Produit"]) === norm(nom))) return res.status(409).json({ error: "Er bestaat al een product met die naam" });
      }
      let saved;
      // typecast : une unité nouvelle (doos/carton) est créée dans Airtable au lieu d'une erreur anglaise.
      if (body.id) {
        saved = await at(`Catalogue/${body.id}`, { method: "PATCH", body: JSON.stringify({ typecast: true, fields }) });
      } else {
        saved = await at("Catalogue", { method: "POST", body: JSON.stringify({ typecast: true, records: [{ fields }] }) });
      }
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Product opslaan mislukt" });
      const renamed = oldName && norm(oldName) !== norm(nom);

      // Sync / create stock row by product name (existing Airtable Stock table).
      const stock = await atAll("Stock");
      if (!stock.error) {
        const existingStock = (stock.records || []).find(r => norm(r.fields["Produit"]) === norm(renamed ? oldName : nom)) || (stock.records || []).find(r => norm(r.fields["Produit"]) === norm(nom));
        const qtyRaw = body.stock;
        const qty = Number(qtyRaw);
        const low = Number(body.lowThreshold);
        const stockFields = { "Produit": nom };
        if (Number.isFinite(qty) && qty >= 0) stockFields["Quantité disponible"] = Math.round(qty * 1000) / 1000;
        if (Number.isFinite(low) && low >= 0) stockFields["Seuil bas"] = low;
        if (existingStock) {
          const before = Number(existingStock.fields["Quantité disponible"] || 0);
          if (Object.keys(stockFields).length > 1 || renamed) {
            await at(`Stock/${existingStock.id}`, { method: "PATCH", body: JSON.stringify({ fields: stockFields }) });
          }
          // Toute variation de stock passe par le journal, comme sur l'écran Voorraad.
          if (Number.isFinite(stockFields["Quantité disponible"]) && stockFields["Quantité disponible"] !== before) {
            await at(encodeURIComponent("Mouvements de stock"), { method: "POST", body: JSON.stringify({ records: [{ fields: {
              "Mouvement": `Correction inventaire — ${nom}`, "Date et heure": new Date().toISOString(), "Type": "Correction inventaire", "Produit": nom,
              "Quantité": Math.round((stockFields["Quantité disponible"] - before) * 1000) / 1000, "Stock avant": before, "Stock après": stockFields["Quantité disponible"],
              "Note": "Aangepast via Beheer → Producten"
            }}] }) });
          }
        } else {
          if (!Number.isFinite(stockFields["Quantité disponible"])) stockFields["Quantité disponible"] = 0;
          if (!Number.isFinite(stockFields["Seuil bas"])) stockFields["Seuil bas"] = 0;
          await at("Stock", { method: "POST", body: JSON.stringify({ records: [{ fields: stockFields }] }) });
        }
      }
      // Renommage : les lignes des commandes OUVERTES suivent (appariées par nom), les
      // commandes livrées gardent le nom de l'époque (document figé).
      if (renamed) {
        const orders = await atAll("Commandes");
        const updates = [];
        for (const r of orders.records || []) {
          if (["Facturée", "Annulée"].includes(r.fields["Statut"] || "Reçue")) continue;
          const lines = String(r.fields["Lignes (produits / quantités)"] || "");
          const next = lines.split("\n").map(l => { const m = l.match(/^(.*?)(\s*[×x]\s*[\d.,].*)$/); return m && norm(m[1]) === norm(oldName) ? nom + m[2] : l; }).join("\n");
          if (next !== lines) updates.push({ id: r.id, fields: { "Lignes (produits / quantités)": next } });
        }
        for (let i = 0; i < updates.length; i += 10) await at("Commandes", { method: "PATCH", body: JSON.stringify({ records: updates.slice(i, i + 10) }) });
      }
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // Photo produit depuis Beheer (pièce jointe Airtable, upload direct en base64).
    if (action === "uploadFoto") {
      if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig product-id" });
      const type = String(body.contentType || "");
      if (!/^image\/(jpeg|png|webp)$/.test(type)) return res.status(400).json({ error: "Enkel JPEG, PNG of WebP" });
      const data = String(body.base64 || "").replace(/^data:[^;]+;base64,/, "");
      if (!data || data.length > 4200000) return res.status(400).json({ error: "Foto te groot (max 3 MB)" });
      const filename = clean(body.filename, 80).replace(/[^\w.\-]+/g, "-") || "foto.jpg";
      // Une seule photo par produit : l'upload Airtable AJOUTE au champ, et le catalogue
      // montre la première. Sans ce vidage, changer de photo ne changeait rien à l'écran.
      const cleared = await at(`Catalogue/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Foto": [] } }) });
      if (cleared.error) return res.status(cleared.error.type === "NOT_FOUND" ? 404 : 500).json({ error: cleared.error.type === "NOT_FOUND" ? "Product niet gevonden" : (cleared.error.message || "Foto uploaden mislukt") });
      const r = await fetch(`https://content.airtable.com/v0/${BASE}/${body.id}/${encodeURIComponent("Foto")}/uploadAttachment`, {
        method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: type, filename, file: data })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) return res.status(500).json({ error: (j.error && j.error.message) || "Foto uploaden mislukt" });
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // Ordre du catalogue (glisser-déposer dans Beheer → Producten) : la liste complète des
    // produits dans l'ordre voulu ; Volgorde = position (1, 2, 3…). Seuls les produits dont
    // la position change sont écrits (par paquets de 10). L'ordre des catégories suit.
    if (action === "reorderProducts") {
      const ids = Array.isArray(body.order) ? body.order.map(String) : [];
      if (!ids.length || ids.length > 2000 || ids.some(id => !REC.test(id)) || new Set(ids).size !== ids.length) return res.status(400).json({ error: "Ongeldige volgorde" });
      const cat = await atAll("Catalogue?fields%5B%5D=Volgorde");
      if (cat.error) return res.status(500).json({ error: "Catalogus onleesbaar" });
      const known = new Map((cat.records || []).map(r => [r.id, r.fields["Volgorde"]]));
      if (ids.some(id => !known.has(id))) return res.status(409).json({ error: "De productlijst is intussen gewijzigd. Herlaad de pagina." });
      const changes = ids.map((id, i) => ({ id, fields: { "Volgorde": i + 1 } })).filter(u => known.get(u.id) !== u.fields["Volgorde"]);
      const saved = await atBatch("Catalogue", "PATCH", changes, false);
      if (saved.error) return res.status(500).json({ error: "Volgorde opslaan mislukt (" + saved.done.length + " van " + changes.length + " bewaard). Probeer opnieuw." });
      return res.status(200).json({ ok: true, changed: changes.length, ...(await statusPayload()) });
    }

    // Supprimer un produit : refusé s'il figure encore dans une bestelling ouverte (les
    // lignes sont du texte apparié par nom ; le magasin ne pourrait plus corriger les
    // aantallen). Sinon : prix négociés du produit, ligne(s) de stock du même nom, puis
    // la fiche. Un produit déjà livré reste lisible dans l'historique (texte).
    if (action === "deleteProduct") {
      if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Product-id ontbreekt" });
      const cur = await at(`Catalogue/${body.id}`);
      if (cur.error) return res.status(404).json({ error: "Product niet gevonden" });
      const nom = cur.fields["Produit"] || "";
      const norm = s => String(s || "").toLowerCase().trim();
      const orders = await atAll("Commandes");
      const inUse = (orders.records || []).filter(r => !["Facturée", "Annulée"].includes(r.fields["Statut"] || "Reçue") && String(r.fields["Lignes (produits / quantités)"] || "").split("\n").some(l => norm(l.split(/\s*[×x]\s*[\d]/)[0]) === norm(nom)));
      if (inUse.length) return res.status(409).json({ error: `Nog in ${inUse.length} open bestelling${inUse.length === 1 ? "" : "en"} (${inUse.slice(0, 3).map(r => r.fields["Référence"]).join(", ")}). Zet het product op inactief, of lever die bestellingen eerst.` });
      const neg = await atAll(encodeURIComponent("Prix négociés"));
      const linked = (neg.records || []).filter(r => (r.fields["Produit"] || []).includes(body.id)).map(r => r.id);
      for (let i = 0; i < linked.length; i += 10) {
        await at(`${encodeURIComponent("Prix négociés")}?${linked.slice(i, i + 10).map(id => "records[]=" + id).join("&")}`, { method: "DELETE" });
      }
      const stock = await atAll("Stock");
      for (const r of (stock.records || []).filter(r => norm(r.fields["Produit"]) === norm(nom))) {
        await at(`Stock/${r.id}`, { method: "DELETE" });
      }
      const del = await at(`Catalogue/${body.id}`, { method: "DELETE" });
      if (del.error) return res.status(500).json({ error: del.error.message || "Product verwijderen mislukt" });
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // ---- Client + credentials ----
    if (action === "saveClient") {
      const nom = clean(body.nom, 120);
      if (!nom) return res.status(400).json({ error: "Klantnaam is verplicht" });
      if (body.id && !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig klant-id" });
      let user = clean(body.user, 40).toLowerCase().replace(/['"\s]+/g, "");
      let password = clean(body.password, 80);
      const generate = body.generate !== false;
      if (!user) user = await uniqueUsername(slugUser(nom));
      else {
        const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${escapeFormula(user)}'`);
        const hit = await at(`Clients?filterByFormula=${f}&maxRecords=1`);
        const other = (hit.records || [])[0];
        if (other && other.id !== body.id) {
          return res.status(409).json({ error: "Deze gebruikersnaam bestaat al" });
        }
      }
      if (generate || !password) password = genPassword();
      if (password.length < 8) return res.status(400).json({ error: "Wachtwoord minstens 8 tekens" });

      const fields = {
        "Nom": nom,
        "Lieu de livraison": clean(body.adresse, 250),
        "Téléphone": clean(body.tel, 40),
        "BTW-nummer": clean(body.btw, 40),
        "Klantnummer": clean(body.klantnr, 40),
        "Email": clean(body.email, 120).toLowerCase(),
        "Taal": String(body.taal || "").toUpperCase() === "FR" ? "FR" : "NL", // langue des documents
        "Gebruikersnaam": user,
        "Wachtwoord": __ca.hashPassword(password)
      };
      if (fields["Email"] && !__mail.isEmail(fields["Email"])) {
        return res.status(400).json({ error: "Ongeldig e-mailadres voor deze klant" });
      }

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
      // E-mail de bienvenue si le client a une adresse et qu'un (nouveau) mot de passe vient
      // d'être créé : gebruikersnaam + lien d'activation (72 h) où il choisit son propre mot
      // de passe — jamais le mot de passe en clair. Celui que Beheer affiche reste valable
      // (à dicter par téléphone) jusqu'à ce choix. Jamais bloquant.
      let mail = null;
      const newCreds = !body.id || generate || !!clean(body.password, 80);
      if (newCreds && id && fields["Email"] && __ordermail.enabled() && body.sendMail !== false) {
        mail = await (async () => {
          const cfg = await __ordermail.loadMailConfig(at);
          const link = __authmail.passwordLink(__ordermail.portalUrl(req), __ca.issueResetToken({ id, fields }, __ca.ACTIVATION_TTL_MS));
          return __authmail.notifyActivation({ klant: { nom, email: fields["Email"], taal: fields["Taal"] }, user, link, hours: __ca.ACTIVATION_TTL_MS / 3600000, company: cfg, opsEmail: cfg.opsEmail, at: Date.now() });
        })().catch(() => null);
      }
      return res.status(200).json({
        ok: true,
        credentials: { id, nom, user, password },
        mail,
        ...(await statusPayload())
      });
    }

    // Archiver / réactiver un client : plus de connexion ni de présence dans les listes,
    // fiche, prix et historique conservés. Rien n'est jamais supprimé.
    if (action === "archiveClient" || action === "unarchiveClient") {
      if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Klant-id ontbreekt" });
      const cur = await at(`Clients/${body.id}`);
      if (cur.error) return res.status(404).json({ error: "Klant niet gevonden" });
      const saved = await at(`Clients/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Gearchiveerd": action === "archiveClient" } }) });
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Opslaan mislukt" });
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // ---- Medewerkers (comptes individuels, PIN haché) ----
    if (action === "saveMedewerker") {
      const naam = clean(body.naam, 60);
      const rol = body.rol === "beheerder" ? "beheerder" : "personeel";
      const pin = String(body.pin || "");
      if (!naam) return res.status(400).json({ error: "Naam is verplicht" });
      if (body.id && !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig id" });
      // Nouveau PIN : 6 à 12 chiffres (un million de combinaisons au moins). Les PIN plus
      // courts déjà enregistrés continuent d'ouvrir (api/session.js) jusqu'à leur changement.
      if (!body.id && !pin) return res.status(400).json({ error: "PIN: 6 tot 12 cijfers" });
      if (pin && !/^\d{6,12}$/.test(pin)) return res.status(400).json({ error: "PIN: 6 tot 12 cijfers" });
      const fields = { "Naam": naam, "Rol": rol, "Actief": body.actief !== false };
      if (pin) {
        // Deux personnes au même PIN : la connexion ouvrirait au nom de la première trouvée
        // (journal faussé). On compare aux empreintes des autres comptes, actifs ou non.
        const all = await atAll("Medewerkers");
        if (all.error) { console.error("[onboarding] Medewerkers onleesbaar", all.error.type); return res.status(500).json({ error: "Medewerkers onleesbaar. Probeer opnieuw." }); }
        if ((all.records || []).some(r => r.id !== body.id && r.fields["PIN hash"] && __auth.verifyHash(r.fields["PIN hash"], pin))) return res.status(409).json({ error: "Deze PIN is al in gebruik. Kies een andere." });
        fields["PIN hash"] = __auth.hashCode(pin);
      }
      const saved = body.id
        ? await at(`Medewerkers/${body.id}`, { method: "PATCH", body: JSON.stringify({ typecast: true, fields }) })
        : await at("Medewerkers", { method: "POST", body: JSON.stringify({ typecast: true, records: [{ fields }] }) });
      if (saved.error) { console.error("[onboarding] saveMedewerker", saved.error.type, saved.error.message); return res.status(500).json({ error: "Medewerker opslaan mislukt" }); }
      // Désactivé, rôle retiré ou PIN changé : ses sessions tombent (tout de suite sur cette
      // instance, ≤ 60 s ailleurs — lib/staffauth.js).
      if (body.id && saved.fields) __auth.noteMedewerker(body.id, saved.fields);
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }
    if (action === "deleteMedewerker") {
      if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig id" });
      const del = await at(`Medewerkers/${body.id}`, { method: "DELETE" });
      if (del.error) { console.error("[onboarding] deleteMedewerker", del.error.type, del.error.message); return res.status(500).json({ error: "Verwijderen mislukt" }); }
      __auth.noteMedewerker(body.id, null);
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    if (action === "resetPassword") {
      if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Klant-id ontbreekt" });
      const password = body.password ? clean(body.password, 80) : genPassword();
      if (password.length < 8) return res.status(400).json({ error: "Wachtwoord minstens 8 tekens" });
      const cur = await at(`Clients/${body.id}`);
      if (cur.error) return res.status(404).json({ error: "Klant niet gevonden" });
      const hashed = __ca.hashPassword(password);
      const saved = await at(`Clients/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { "Wachtwoord": hashed } })
      });
      if (saved.error) { console.error("[onboarding] resetPassword", body.id, saved.error.type, saved.error.message); return res.status(500).json({ error: "Wachtwoord wijzigen mislukt" }); }
      // E-mail : lien (72 h, usage unique) pour choisir son mot de passe, jamais le mot de
      // passe lui-même ; celui de Beheer reste valable d'ici là.
      let mail = null;
      if (cur.fields["Email"] && __ordermail.enabled() && body.sendMail !== false) {
        mail = await (async () => {
          const cfg = await __ordermail.loadMailConfig(at);
          const link = __authmail.passwordLink(__ordermail.portalUrl(req), __ca.issueResetToken({ id: body.id, fields: { "Wachtwoord": hashed } }, __ca.ACTIVATION_TTL_MS));
          return __authmail.notifyResetLink({ klant: Object.assign(__ordermail.clientFrom(cur), { taal: cur.fields["Taal"] }), user: cur.fields["Gebruikersnaam"] || "", link, hours: __ca.ACTIVATION_TTL_MS / 3600000, company: cfg, opsEmail: cfg.opsEmail, at: Date.now() });
        })().catch(() => null);
      }
      return res.status(200).json({
        ok: true,
        credentials: {
          id: body.id,
          nom: cur.fields["Nom"] || "",
          user: cur.fields["Gebruikersnaam"] || "",
          password
        },
        mail,
        ...(await statusPayload())
      });
    }

    // Bloquer l'accès d'un client (fin de collaboration, compte compromis) : le mot de
    // passe est effacé, la connexion échoue, la fiche et l'historique restent intacts.
    // « Nieuw wachtwoord » rend l'accès.
    if (action === "revokeAccess") {
      if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Klant-id ontbreekt" });
      const cur = await at(`Clients/${body.id}`);
      if (cur.error) return res.status(404).json({ error: "Klant niet gevonden" });
      const saved = await at(`Clients/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { "Wachtwoord": "" } })
      });
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Toegang blokkeren mislukt" });
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // ---- Sécurité (Systeemstatus) : état et hachage des mots de passe clients en clair ----
    // securityStatus : { klareWachtwoorden, hasSessionSecret } (lecture seule).
    // hashAllPasswords : hache les Wachtwoord encore en clair (migration sans attendre la
    // connexion de chaque client). scrypt coûte ≈ 0,45 s par mot de passe : au plus
    // HASH_BATCH par appel (durée maximale d'une fonction) ; Beheer relance tant que
    // klareWachtwoorden > 0. Chaque fiche est relue juste avant l'écriture : un client qui
    // change son mot de passe pendant ce temps n'est pas écrasé.
    if (action === "securityStatus" || action === "hashAllPasswords") {
      const HASH_BATCH = 12, BUDGET_MS = 6000;
      const all = await atAll("Clients?fields%5B%5D=Wachtwoord");
      if (all.error) { console.error("[onboarding] " + action, all.error.type, all.error.message); return res.status(500).json({ error: "Klanten onleesbaar. Probeer opnieuw." }); }
      const plain = (all.records || []).filter(r => r.fields["Wachtwoord"] && !__ca.isHashed(r.fields["Wachtwoord"]));
      let hashed = 0, failed = 0;
      if (action === "hashAllPasswords") {
        const started = Date.now();
        for (const r of plain.slice(0, HASH_BATCH)) {
          if (Date.now() - started > BUDGET_MS) break;
          const hash = __ca.hashPassword(r.fields["Wachtwoord"]);
          const cur = await at(`Clients/${r.id}`);
          if (!cur || cur.error || cur.fields["Wachtwoord"] !== r.fields["Wachtwoord"]) continue; // changé entre-temps
          const up = await at(`Clients/${r.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Wachtwoord": hash } }) });
          if (up && !up.error) hashed++;
          else { failed++; console.error("[onboarding] hashAllPasswords", r.id, up && up.error && up.error.type); }
        }
      }
      return res.status(200).json({ ok: failed === 0, hashed, failed, klareWachtwoorden: plain.length - hashed, hasSessionSecret: __auth.hasSessionSecret() });
    }

    // ---- Codes d'accès (Instellingen) ----
    // Le code n'est jamais stocké en clair : seule son empreinte scrypt part en base.
    if (action === "saveCode") {
      const which = clean(body.which, 10);
      if (which !== "admin" && which !== "staff") {
        return res.status(400).json({ error: "Onbekend codetype" });
      }
      const code = String(body.code || "");
      const reset = body.reset === true;
      const field = which === "admin" ? "Beheerderscode hash" : "Personeelscode hash";

      if (!reset) {
        if (code.length < 10) {
          return res.status(400).json({ error: "De code moet minstens 10 tekens lang zijn" });
        }
        if (/^famo/i.test(code)) {
          return res.status(400).json({ error: "Gebruik geen code die met de bedrijfsnaam begint — te makkelijk te raden" });
        }
      }

      const existing = await getConfigRecord();
      if (existing && existing.error) return res.status(500).json(existing);
      if (!existing || !existing.id) {
        return res.status(400).json({ error: "Vul eerst de bedrijfsgegevens in" });
      }
      const fields = {};
      fields[field] = reset ? "" : __auth.hashCode(code);
      const saved = await at(`${encodeURIComponent("Configuratie")}/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields })
      });
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Code opslaan mislukt" });
      // Nouveau code : toutes les sessions ouvertes tombent (génération +1, écriture séparée
      // pour ne pas faire échouer le changement de code sur une base sans ce champ). Le
      // beheerder qui vient de changer le code reçoit un cookie à la nouvelle génération.
      const next = (Number(existing.fields && existing.fields["Sessiegeneratie"]) || 0) + 1;
      const bumped = await at(`${encodeURIComponent("Configuratie")}/${existing.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Sessiegeneratie": next } }) }).catch(() => null);
      if (bumped && !bumped.error) {
        __auth.noteGeneration(next);
        __auth.setCookie(res, __auth.sign(me.exp, me.role, me.name, Object.assign({}, me.gen, { g: next })), Math.max(0, Math.floor((me.exp - Date.now()) / 1000)));
      } else console.error("[onboarding] Sessiegeneratie niet verhoogd", bumped && bumped.error && bumped.error.type);
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // ---- Aanvraag (demande d'inscription publique) ----
    if (action === "closeAanvraag") {
      const id = clean(body.id, 40);
      if (!id) return res.status(400).json({ error: "Aanvraag-id ontbreekt" });
      const saved = await at(`Aanvragen/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { "Status": "Verwerkt" } })
      });
      if (saved.error) return res.status(500).json({ error: saved.error.message || "Aanvraag bijwerken mislukt" });
      return res.status(200).json({ ok: true, ...(await statusPayload()) });
    }

    // ---- Prix négocié ----
    if (action === "savePrice") {
      const clientId = clean(body.clientId, 40);
      const productId = clean(body.productId, 40);
      // Champ laissé vide : enregistré vide (le client paie le prix de base), jamais 0.
      const prixVide = body.prix === null || body.prix === undefined || String(body.prix).trim() === "";
      const prix = __prices.negotiatedValue(body.prix);
      if (!clientId || !productId) return res.status(400).json({ error: "Klant en product zijn verplicht" });
      if (!prixVide && prix === null) return res.status(400).json({ error: "Ongeldige prijs" });

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
        "Prix négocié": prix === null ? null : Math.round(prix * 100) / 100
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

    // ---- Prix négociés d'un client, depuis sa fiche : plusieurs produits en un envoi ----
    // Même règle que savePrice (vide → enregistré vide, 0 → 0). Une seule lecture des
    // accords, puis une écriture par produit, avec un résultat par produit : un prix
    // refusé ou une écriture en échec n'empêche pas les autres d'être enregistrés.
    if (action === "saveClientPrices") {
      const clientId = clean(body.clientId, 40);
      const rows = Array.isArray(body.prices) ? body.prices.slice(0, 200) : [];
      if (!clientId) return res.status(400).json({ error: "Klant is verplicht" });
      if (!rows.length) return res.status(400).json({ error: "Geen prijzen om op te slaan" });

      const all = await atAll(encodeURIComponent("Prix négociés"));
      if (all.error) return res.status(500).json(all);
      const results = [];
      for (const row of rows) {
        const productId = clean(row && row.productId, 40);
        const raw = row ? row.prix : undefined;
        const prixVide = raw === null || raw === undefined || String(raw).trim() === "";
        const prix = __prices.negotiatedValue(raw);
        if (!productId) { results.push({ productId: "", ok: false, error: "Product ontbreekt" }); continue; }
        if (!prixVide && prix === null) { results.push({ productId, ok: false, error: "Ongeldige prijs" }); continue; }
        const existing = (all.records || []).find(r => {
          const c = r.fields["Client"] || [];
          const p = r.fields["Produit"] || [];
          return c.includes(clientId) && p.includes(productId);
        });
        const fields = {
          "Client": [clientId],
          "Produit": [productId],
          "Prix négocié": prix === null ? null : Math.round(prix * 100) / 100
        };
        try {
          const saved = existing
            ? await at(`${encodeURIComponent("Prix négociés")}/${existing.id}`, { method: "PATCH", body: JSON.stringify({ fields }) })
            : await at(encodeURIComponent("Prix négociés"), { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
          if (saved && saved.error) results.push({ productId, ok: false, error: saved.error.message || "Prijs opslaan mislukt" });
          else results.push({ productId, ok: true });
        } catch (e) {
          results.push({ productId, ok: false, error: "Prijs opslaan mislukt" });
        }
      }
      return res.status(200).json({ ok: results.every(r => r.ok), results, ...(await statusPayload()) });
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
