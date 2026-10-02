"use strict";
// Beheer · Producten, photos, ordre du catalogue, stock — actions de api/onboarding.js (audit I-10).
// Garde, session beheerder et journal d'audit restent dans api/onboarding.js (le seul point d'entrée HTTP).
const { at, atAll, atBatch, __guard, BASE, REC, imageType, clean, mapUnitIn, statusPayload } = require("./common");
const __lj = require("../lignesjson");

const ACTIONS = ["saveProduct", "uploadFoto", "setFotos", "reorderProducts", "deleteProduct", "saveStock"];
// Spec 018 : plusieurs vues par produit, la première = photo principale.
const MAX_FOTOS = 6;

async function run({ res, body, action }) {

  // ---- Catalogue product ----
  if (action === "saveProduct") {
    const nom = clean(body.nom, 120);
    const unite = mapUnitIn(body.unite);
    const base = Number(body.base);
    const cat = clean(body.cat, 80) || "Algemeen";
    if (!nom) return res.status(400).json({ error: "Productnaam is verplicht" });
    if (!Number.isFinite(base) || base < 0) return res.status(400).json({ error: "Ongeldige basisprijs" });
    // Garde-fous (audit L-04) : un prix de base à 0 ou à 1 500 000 € est une faute de frappe.
    if (base === 0 || base > __guard.MAX_BASE_PRICE) return res.status(400).json({ error: "Basisprijs moet tussen € 0,01 en € " + __guard.MAX_BASE_PRICE + " liggen" });
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
        // Forme structurée (B4, specs/016) : « naam » suit dans le même PATCH, la référence ne change pas.
        const json = next !== lines ? __lj.renamed(r.fields[__lj.FIELD], body.id, nom) : null;
        if (next !== lines) updates.push({ id: r.id, fields: Object.assign({ "Lignes (produits / quantités)": next }, json ? { [__lj.FIELD]: json } : {}) });
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
    // Le type déclaré ne prouve rien : les premiers octets doivent être ceux d'une vraie
    // image du même type (pas de HTML/SVG/script servi ensuite sous image/png).
    if (imageType(data) !== type.slice(6)) return res.status(400).json({ error: "Dit bestand is geen geldige JPEG-, PNG- of WebP-foto" });
    const filename = clean(body.filename, 80).replace(/[^\w.\-]+/g, "-") || "foto.jpg";
    if (body.add === true) {
      // Spec 018 : une vue de plus (max MAX_FOTOS), les autres restent ; l'upload Airtable (et le
      // moteur SQL) AJOUTE au champ. Le nombre est relu ici : le navigateur n'est pas cru.
      const cur = await at(`Catalogue/${body.id}`);
      if (cur.error) { if (cur.error.type !== "NOT_FOUND") console.error("[onboarding] uploadFoto", body.id, cur.error.type, cur.error.message); return res.status(cur.error.type === "NOT_FOUND" ? 404 : 500).json({ error: cur.error.type === "NOT_FOUND" ? "Product niet gevonden" : "Foto uploaden mislukt" }); }
      if ((Array.isArray(cur.fields["Foto"]) ? cur.fields["Foto"] : []).length >= MAX_FOTOS) return res.status(400).json({ error: "Maximaal " + MAX_FOTOS + " foto's per product. Verwijder er eerst een." });
    } else {
      // Sans « add » : une seule photo (comportement d'avant). L'upload AJOUTE au champ et le
      // catalogue montre la première : sans ce vidage, changer de photo ne changeait rien à l'écran.
      const cleared = await at(`Catalogue/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Foto": [] } }) });
      if (cleared.error) { if (cleared.error.type !== "NOT_FOUND") console.error("[onboarding] uploadFoto", body.id, cleared.error.type, cleared.error.message); return res.status(cleared.error.type === "NOT_FOUND" ? 404 : 500).json({ error: cleared.error.type === "NOT_FOUND" ? "Product niet gevonden" : "Foto uploaden mislukt" }); }
    }
    const r = await fetch(`https://content.airtable.com/v0/${BASE}/${body.id}/${encodeURIComponent("Foto")}/uploadAttachment`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: type, filename, file: data })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) { console.error("[onboarding] uploadFoto", body.id, r.status, j.error && (j.error.type || j.error)); return res.status(500).json({ error: "Foto uploaden mislukt" }); }
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }

  // Ordre et suppression des photos (spec 018) : {id, order: [ids de pièces jointes]}. Le serveur
  // relit la fiche et ne garde QUE les pièces jointes qui y sont déjà, dans l'ordre donné (la
  // première = photo principale) ; un id inconnu ou en double est ignoré, aucune URL du navigateur
  // n'est reprise. Liste vide = plus de photo. Le PATCH [{id}] garde chaque fichier tel quel
  // (Airtable comme moteur SQL) ; ceux qui ne sont plus cités sont effacés (moteur : famo_files).
  if (action === "setFotos") {
    if (!body.id || !REC.test(String(body.id))) return res.status(400).json({ error: "Ongeldig product-id" });
    if (!Array.isArray(body.order) || body.order.length > 20 || body.order.some(x => typeof x !== "string")) return res.status(400).json({ error: "Ongeldige fotolijst" });
    const cur = await at(`Catalogue/${body.id}`);
    if (cur.error) { if (cur.error.type !== "NOT_FOUND") console.error("[onboarding] setFotos", body.id, cur.error.type, cur.error.message); return res.status(cur.error.type === "NOT_FOUND" ? 404 : 500).json({ error: cur.error.type === "NOT_FOUND" ? "Product niet gevonden" : "Foto's opslaan mislukt" }); }
    const existing = new Set((Array.isArray(cur.fields["Foto"]) ? cur.fields["Foto"] : []).map(a => a && a.id).filter(Boolean));
    const keep = [];
    for (const id of body.order) if (existing.has(id) && !keep.includes(id)) keep.push(id);
    const saved = await at(`Catalogue/${body.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Foto": keep.slice(0, MAX_FOTOS).map(id => ({ id })) } }) });
    if (saved.error) { console.error("[onboarding] setFotos", body.id, saved.error.type, saved.error.message); return res.status(500).json({ error: "Foto's opslaan mislukt" }); }
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
  return res.status(400).json({ error: "Onbekende actie" });
}

module.exports = { ACTIONS, run };
