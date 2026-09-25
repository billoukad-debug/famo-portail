require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const TOKEN = process.env.AIRTABLE_TOKEN;
const __auth = require("../lib/staffauth");
const __prices = require("../lib/prices");
const __lev = require("../lib/levering");
const __mail = require("../lib/ordermail");
function staffCodeReady(res){
  if (__auth.hasCode()) return true;
  res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt. Stel de omgevingsvariabele in op Vercel." });
  return false;
}
const BASE = "appcdduLth9iGX8I0";
// Identifiant Airtable : alphanumérique seulement (jamais de « ../ » vers une autre table).
const REC = /^[A-Za-z0-9]{1,40}$/;

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

// Airtable accepte 10 enregistrements par requête : au-delà, tout est découpé.
async function atBatch(table, method, records, typecast){
  for (let i = 0; i < records.length; i += 10) {
    const body = { records: records.slice(i, i + 10) };
    if (typecast) body.typecast = true;
    const r = await at(table, { method, body: JSON.stringify(body) });
    if (r.error) return r;
  }
  return { ok: true };
}

function numberOf(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
const norm = s => String(s || "").toLowerCase().trim();
const money = v => Math.round((Number(v) || 0) * 100) / 100;

// "Zalmfilet × 3 doos [€12.50] (in filets)"  ->  { nom, qty, unit, price, comment }
function parseLines(txt){
  return String(txt || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*([^\[\(]*)(.*)$/);
    if (!m) return null;
    const tail = m[4] || "", price = tail.match(/\[€\s*([\d.,]+)\]/), comment = tail.match(/\((.*?)\)/);
    return { nom: m[1].trim(), qty: parseFloat(m[2].replace(",", ".")) || 0, unit: m[3].trim(), price: price ? Number(price[1].replace(",", ".")) : null, comment: comment ? comment[1] : "" };
  }).filter(Boolean);
}
function formatLine(l){
  const q = String(Math.round(l.qty * 1000) / 1000);
  return `${l.nom} × ${q}${l.unit ? " " + l.unit : ""}${l.price != null ? " [€" + Number(l.price).toFixed(2) + "]" : ""}${l.comment ? " (" + String(l.comment).replace(/[()\[\]\r\n]/g, "") + ")" : ""}`;
}

// Lignes modifiées par le magasin : chaque article doit exister au catalogue (actif ou
// non : un produit désactivé entre-temps reste livrable), les quantités décimales
// seulement au kg. Le prix reste celui FIGÉ dans la ligne ([€x]) ; une ligne ajoutée
// sans prix reçoit le prix négocié du client, sinon le prix de base. Renvoie les lignes
// normalisées (toutes avec prix) et le total, recalculés ici — jamais ceux du navigateur.
async function normalizeLines(txt, clientId){
  const lines = parseLines(txt);
  if (!lines.length || lines.some(line => line.qty <= 0)) throw new Error("Ongeldige hoeveelheid in de voorbereiding");
  const catalogue = await atAll("Catalogue");
  if (catalogue.error) throw new Error(catalogue.error.message || "Catalogus kon niet worden gelezen");
  const byName = new Map((catalogue.records || []).map(record => [norm(record.fields["Produit"]), record]));
  let negByProduct = new Map();
  if (clientId && lines.some(l => l.price == null)) {
    const neg = await atAll(encodeURIComponent("Prix négociés"));
    if (!neg.error) negByProduct = __prices.negotiatedFor(neg.records, clientId);
  }
  let total = 0;
  const out = [];
  for (const line of lines) {
    const product = byName.get(norm(line.nom));
    if (!product) throw new Error(`Artikel niet gevonden in de catalogus: ${line.nom}`);
    const unit = product.fields["Unité"] || line.unit || "";
    if (!/kg/i.test(String(unit)) && !Number.isInteger(line.qty)) {
      throw new Error("Alleen producten per kg mogen een decimale hoeveelheid hebben");
    }
    const price = line.price != null ? money(line.price) : money(__prices.unitPrice(product, negByProduct));
    total += price * line.qty;
    out.push(formatLine({ nom: product.fields["Produit"], qty: line.qty, unit, price, comment: line.comment }));
  }
  return { lignes: out.join("\n"), total: money(total) };
}

async function createStockMovements(report, reference, type){
  if (!report.done || !report.done.length) return null;
  const now = new Date().toISOString();
  const result = await atBatch(encodeURIComponent("Mouvements de stock"), "POST", report.done.map(item => ({ fields: {
    "Mouvement": `${reference} — ${item.nom}${type === "Annulation sortie" ? " (terug)" : ""}`,
    "Date et heure": now,
    "Type": type,
    "Produit": item.nom,
    "Quantité": type === "Sortie livraison" ? -item.qty : item.qty,
    "Stock avant": item.van,
    "Stock après": item.naar,
    "Référence commande": reference
  }})), true);
  return result.error ? (result.error.message || "Journal de stock non enregistré") : null;
}

// Déduit (sign -1) ou remet (sign +1) toutes les quantités. En déduction, aucune ligne
// ne part si un produit est inconnu ou insuffisant ; en remise, un produit disparu est ignoré.
async function moveStock(lignes, sign){
  const report = { done: [], missing: [], insufficient: [] };
  const items = parseLines(lignes);
  if (!items.length) return sign < 0 ? { ...report, error: "Geen geldige artikellijnen gevonden" } : report;
  const st = await atAll("Stock");
  if (st.error) return { ...report, error: st.error.message || "Voorraad onleesbaar" };
  const recs = st.records || [];
  const requested = new Map();
  for (const item of items) {
    if (item.qty <= 0) { if (sign < 0) return { ...report, error: "Ongeldige hoeveelheid in de bestelling" }; continue; }
    const key = norm(item.nom);
    const previous = requested.get(key) || { nom: item.nom, qty: 0 };
    previous.qty += item.qty;
    requested.set(key, previous);
  }
  const updates = [];
  for (const it of requested.values()){
    const rec = recs.find(r => norm(r.fields["Produit"]) === norm(it.nom));
    if (!rec){ report.missing.push(it.nom); continue; }
    const cur = numberOf(rec.fields["Quantité disponible"]);
    if (sign < 0 && cur < it.qty) { report.insufficient.push({ nom: it.nom, available: cur, requested: it.qty }); continue; }
    const next = Math.round((cur + sign * it.qty) * 1000) / 1000;
    updates.push({ id: rec.id, fields: { "Quantité disponible": next } });
    report.done.push({ nom: it.nom, qty: it.qty, van: cur, naar: next });
  }
  if (sign < 0 && (report.missing.length || report.insufficient.length)) return report;
  if (updates.length) {
    const saved = await atBatch("Stock", "PATCH", updates, false);
    if (saved.error) return { ...report, error: saved.error.message || "Voorraad kon niet worden bijgewerkt" };
  }
  return report;
}

// Numéros séquentiels FA-2026-0001 / CN-2026-0001 : max + 1 sur l'année (Bruxelles).
async function nextNumber(field, prefix){
  const year = __auth.brusselsYear();
  const j = await atAll(`Commandes?fields%5B%5D=${encodeURIComponent(field)}`);
  if (j.error) throw new Error(j.error.message || "Nummering onleesbaar");
  let max = 0;
  (j.records || []).forEach(r => {
    const v = r.fields[field];
    if (!v) return;
    const m = String(v).match(new RegExp("^" + prefix + "-" + year + "-(\\d+)$"));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
}

function correctionLine(label, actor, reden){
  const when = new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(",", "");
  return `${when} · ${label} · ${actor}${reden ? " — " + reden : ""}`;
}
function journal(f, line){ return (f["Correcties"] ? f["Correcties"] + "\n" : "") + line; }

const CANCELLED = "Annulée";
const CORRECTIONS = ["terug", "annuleren", "herstellen", "bewerken"];
const UITZONDERINGEN = ["Afwezig", "Geweigerd", "Gedeeltelijk", "Beschadigd"];
const BETAALWIJZEN = ["Contant", "Overschrijving", "Bancontact", "Andere"];

// E-mails de statut au client : jamais bloquants, jamais d'exception.
async function notifyStatus(req, f, status, extra){
  if (!__mail.enabled()) return null;
  try {
    const clientId = (f["Client"] || [])[0];
    const cli = clientId ? await at("Clients/" + encodeURIComponent(clientId)) : null;
    if (!cli || cli.error) return null;
    const cfg = await __mail.loadMailConfig(at);
    return await __mail.notifyStatus(Object.assign({
      status, ref: f["Référence"] || "", klant: __mail.clientFrom(cli), company: cfg, opsEmail: cfg.opsEmail,
      lignes: f["Lignes (produits / quantités)"] || "", total: f["Total"] || 0, dateLivraison: f["Date livraison souhaitée"] || "",
      portalUrl: __mail.portalUrl(req)
    }, extra || {}));
  } catch (e) { return null; }
}

async function applyCorrection(req, res, id, f, body, statuses){
  const isAdmin = __auth.adminOk(req);
  const actor = __auth.actorOf(req);
  const correction = String(body.correction || "");
  const reden = String(body.reden || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!CORRECTIONS.includes(correction)) return res.status(400).json({ error: "Onbekende correctie" });
  if (reden.length < 3) return res.status(400).json({ error: "Geef een reden op (minstens 3 tekens)" });

  const current = f["Statut"] || "Reçue";
  const idx = statuses.indexOf(current);
  const ref = f["Référence"] || id;
  const fields = {};
  let stockReport = null, label = "", target = current, mailStatus = "";

  if (correction === "terug") {
    if (current === CANCELLED) return res.status(409).json({ error: "Geannuleerde bestelling: gebruik Herstellen" });
    if (idx <= 0) return res.status(409).json({ error: "Deze bestelling staat al bij de eerste stap (Ontvangen)" });
    target = statuses[idx - 1];
    if (current === "Prête") {
      fields["Préparation validée"] = false; fields["Préparée le"] = null;
      label = "Terug naar te bereiden";
    } else if (current === "Sortie en livraison") {
      if (f["Stock afgeboekt"]) {
        stockReport = await moveStock(f["Lignes (produits / quantités)"], +1);
        if (stockReport.error) return res.status(500).json({ error: stockReport.error });
        const w = await createStockMovements(stockReport, ref, "Annulation sortie"); if (w) stockReport.journalWarning = w;
        fields["Stock afgeboekt"] = false;
      }
      label = "Terug naar klaar (vertrek ongedaan)";
    } else if (current === "Facturée") {
      if (!isAdmin) return res.status(403).json({ error: "Enkel een beheerder kan een ontvangst ongedaan maken" });
      if (f["Statut paiement"] === "Payé") return res.status(409).json({ error: "Deze factuur staat op betaald. Zet ze eerst terug op openstaand." });
      if (f["Creditnota nummer"]) return res.status(409).json({ error: "Er bestaat al een creditnota op deze factuur: de ontvangst kan niet meer ongedaan gemaakt worden." });
      fields["Livraison confirmée"] = false; fields["Réceptionné par"] = ""; fields["Livrée le"] = null; fields["Preuve de livraison"] = [];
      fields["Uitzondering levering"] = null; fields["Uitzondering nota"] = "";
      // Le factuurnummer reste sur la commande : réutilisé à la prochaine confirmation, jamais réattribué.
      label = "Ontvangst ongedaan gemaakt (factuur " + (f["Factuurnummer"] || "—") + " blijft voorbehouden)";
    }
    fields["Statut"] = target;
  }

  if (correction === "annuleren") {
    if (current === CANCELLED) return res.status(409).json({ error: "Deze bestelling is al geannuleerd" });
    if (current === "Facturée") return res.status(409).json({ error: "Een gefactureerde bestelling kan niet geannuleerd worden. Maak een creditnota." });
    // Une facture a déjà été émise (réception défaite ensuite) : annuler créerait une facture fantôme.
    if (f["Factuurnummer"]) return res.status(409).json({ error: `Factuur ${f["Factuurnummer"]} bestaat al voor deze bestelling: lever ze opnieuw of maak een creditnota.` });
    if (current === "Sortie en livraison") {
      if (!isAdmin) return res.status(403).json({ error: "Enkel een beheerder kan een bestelling annuleren die al onderweg is" });
      if (f["Stock afgeboekt"]) {
        stockReport = await moveStock(f["Lignes (produits / quantités)"], +1);
        if (stockReport.error) return res.status(500).json({ error: stockReport.error });
        const w = await createStockMovements(stockReport, ref, "Annulation sortie"); if (w) stockReport.journalWarning = w;
        fields["Stock afgeboekt"] = false;
      }
    }
    target = CANCELLED;
    fields["Statut"] = CANCELLED;
    fields["Annulée le"] = new Date().toISOString();
    fields["Motif annulation"] = reden;
    label = "Geannuleerd";
    mailStatus = "geannuleerd";
  }

  if (correction === "herstellen") {
    if (current !== CANCELLED) return res.status(409).json({ error: "Alleen een geannuleerde bestelling kan hersteld worden" });
    target = "Reçue";
    fields["Statut"] = "Reçue";
    fields["Annulée le"] = null; fields["Motif annulation"] = "";
    fields["Préparation validée"] = false; fields["Préparée le"] = null;
    label = "Hersteld (terug naar te bereiden)";
  }

  if (correction === "bewerken") {
    if (current === CANCELLED) return res.status(409).json({ error: "Geannuleerde bestelling: herstel ze eerst" });
    if (idx >= 2) return res.status(409).json({ error: "Deze levering is al onderweg: leverdag en nota liggen vast" });
    const changes = [];
    if (typeof body.dateLivraison === "string" && body.dateLivraison !== (f["Date livraison souhaitée"] || "")) {
      const iso = body.dateLivraison.slice(0, 10);
      const rules = await __lev.loadRules(at);
      const err = __lev.checkDate(iso, rules);
      if (err) return res.status(400).json({ error: err });
      fields["Date livraison souhaitée"] = iso;
      changes.push("leverdag " + (f["Date livraison souhaitée"] || "—") + " → " + iso);
    }
    if (typeof body.notes === "string" && body.notes !== (f["Notes"] || "")) {
      fields["Notes"] = String(body.notes).slice(0, 500);
      changes.push("nota gewijzigd");
    }
    if (!changes.length) return res.status(400).json({ error: "Niets gewijzigd" });
    label = changes.join(", ");
  }

  fields["Correcties"] = journal(f, correctionLine(label, actor, reden));
  const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ typecast: true, fields }) });
  if (j.error) return res.status(500).json({ error: j.error.message || "Bijwerken mislukt" });
  const mail = mailStatus ? await notifyStatus(req, f, mailStatus, { reden }) : null;
  return res.status(200).json({ ok: true, statut: target, correctie: fields["Correcties"].split("\n").pop(), stock: stockReport, mail });
}

// Creditnota sur une commande facturée : lignes créditées (sous-ensemble des lignes de la
// commande, quantités ≤ livrées), numéro CN-AAAA-NNNN attribué une seule fois, montant
// recalculé aux prix figés, retour en stock optionnel (mouvement « Retour client »).
async function makeCreditnota(req, res, id, f, body){
  if (!__auth.adminOk(req)) return res.status(403).json({ error: "Enkel een beheerder maakt een creditnota" });
  if (f["Statut"] !== "Facturée" || !f["Factuurnummer"]) return res.status(409).json({ error: "Enkel op een gefactureerde bestelling" });
  if (f["Creditnota nummer"]) return res.status(409).json({ error: "Er bestaat al een creditnota (" + f["Creditnota nummer"] + ") op deze factuur" });
  const motif = String(body.motif || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (motif.length < 3) return res.status(400).json({ error: "Geef een reden op (minstens 3 tekens)" });
  const delivered = parseLines(f["Lignes (produits / quantités)"]);
  const wanted = parseLines(String(body.lignes || ""));
  if (!wanted.length) return res.status(400).json({ error: "Kies minstens één artikel om te crediteren" });
  let montant = 0;
  const out = [];
  for (const w of wanted) {
    const d = delivered.find(l => norm(l.nom) === norm(w.nom));
    if (!d) return res.status(400).json({ error: `Artikel staat niet op de factuur: ${w.nom}` });
    if (!(w.qty > 0) || w.qty > d.qty + 1e-9) return res.status(400).json({ error: `Aantal voor ${w.nom} moet tussen 0 en ${d.qty} liggen` });
    const price = d.price != null ? money(d.price) : 0;
    montant += price * w.qty;
    out.push(formatLine({ nom: d.nom, qty: w.qty, unit: d.unit, price, comment: "" }));
  }
  montant = money(montant);
  const nummer = await nextNumber("Creditnota nummer", "CN");
  const fields = {
    "Creditnota nummer": nummer, "Creditnota lignes": out.join("\n"), "Creditnota montant": montant,
    "Creditnota le": new Date().toISOString(), "Creditnota motif": motif,
    "Correcties": journal(f, correctionLine("Creditnota " + nummer + " (€ " + montant.toFixed(2).replace(".", ",") + ")", __auth.actorOf(req), motif))
  };
  let stockReport = null;
  if (body.retourStock === true) {
    stockReport = await moveStock(out.join("\n"), +1);
    if (stockReport.error) return res.status(500).json({ error: stockReport.error });
    const w = await createStockMovements(stockReport, f["Référence"] || id, "Retour client"); if (w) stockReport.journalWarning = w;
  }
  const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
  if (j.error) return res.status(500).json({ error: j.error.message || "Creditnota opslaan mislukt" });
  return res.status(200).json({ ok: true, creditnota: { nummer, lignes: out.join("\n"), montant, le: fields["Creditnota le"], motif }, stock: stockReport });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST toegestaan" });
  if (!staffCodeReady(res)) return;
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};
    const { id, statut, paiement, lignes, total, preparationValidee, deliveryConfirmed, recipient, proofUrl, correction } = body;
    if (!__auth.staffOk(req)) return res.status(401).json({ error: "Ongeldige personeelscode" });
    if (!id || !REC.test(String(id))) return res.status(400).json({ error: "Bestelling-id ontbreekt of is ongeldig" });

    const cur = await at(`Commandes/${id}`);
    if (cur.error) return res.status(cur.error.type === "NOT_FOUND" || /not found/i.test(String(cur.error.message || "")) ? 404 : 500).json({ error: cur.error.message || "Bestelling onleesbaar" });
    const f = cur.fields || {};
    const statuses = ["Reçue", "Prête", "Sortie en livraison", "Facturée"];
    const departed = statuses.indexOf(f["Statut"] || "Reçue") >= 2;

    if (correction !== undefined) return applyCorrection(req, res, id, f, body, statuses);
    if (body.creditnota && typeof body.creditnota === "object") return makeCreditnota(req, res, id, f, body.creditnota);
    if (f["Statut"] === CANCELLED) {
      return res.status(409).json({ error: "Deze bestelling is geannuleerd. Herstel ze eerst (Corrigeren → Herstellen)." });
    }

    // Ordre de tournée : seul champ modifiable à tout moment avant la facture.
    if (body.volgorde !== undefined) {
      const n = body.volgorde === null || body.volgorde === "" ? null : Math.round(Number(body.volgorde));
      if (n !== null && !(n >= 1 && n <= 999)) return res.status(400).json({ error: "Ongeldige volgorde" });
      const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Volgorde levering": n } }) });
      if (j.error) return res.status(500).json({ error: j.error.message || "Volgorde opslaan mislukt" });
      return res.status(200).json({ ok: true, volgorde: n });
    }

    // Once goods left the warehouse, changing quantities would no longer match
    // the stock movement and the delivery note. Create a correction instead.
    if (departed && (typeof lignes === "string" || typeof total === "number" || preparationValidee)) {
      return res.status(409).json({ error: "Deze levering is al onderweg en kan niet meer worden gewijzigd" });
    }

    const fields = {};
    if (paiement && !["Payé", "En attente"].includes(paiement)) return res.status(400).json({ error: "Ongeldige betaalstatus" });
    if (paiement) {
      if (paiement === "Payé" && f["Statut"] !== "Facturée" && statut !== "Facturée") return res.status(409).json({ error: "Enkel een gefactureerde bestelling kan op betaald gezet worden" });
      fields["Statut paiement"] = paiement;
      if (paiement === "Payé") {
        fields["Payé le"] = new Date().toISOString();
        const mode = String(body.modePaiement || "").trim();
        if (mode && !BETAALWIJZEN.includes(mode)) return res.status(400).json({ error: "Ongeldige betaalwijze" });
        if (mode) fields["Mode de paiement"] = mode;
        if (f["Statut paiement"] !== "Payé") fields["Correcties"] = journal(f, correctionLine("Betaald" + (mode ? " (" + mode + ")" : ""), __auth.actorOf(req), ""));
      } else {
        fields["Payé le"] = null; fields["Mode de paiement"] = null;
        if (f["Statut paiement"] === "Payé") fields["Correcties"] = journal(f, correctionLine("Terug op openstaand", __auth.actorOf(req), String(body.reden || "").slice(0, 200)));
      }
    }
    if (typeof lignes === "string") {
      let normalized;
      try {
        normalized = await normalizeLines(lignes, (f["Client"] || [])[0]);
      } catch (error) {
        return res.status(400).json({ error: String(error.message || error) });
      }
      fields["Lignes (produits / quantités)"] = normalized.lignes;
      // Le total envoye par le navigateur n'est jamais utilise : prix figés des lignes,
      // prix négocié pour une ligne ajoutée.
      fields["Total"] = normalized.total;
    }
    if (statut && !statuses.includes(statut)) return res.status(400).json({ error: "Ongeldige bestelstatus" });
    if (statut) {
      const currentIndex = statuses.indexOf(f["Statut"] || "Reçue");
      const nextIndex = statuses.indexOf(statut);
      if (nextIndex !== currentIndex && nextIndex !== currentIndex + 1) {
        return res.status(409).json({ error: "Volg de bestelstappen in de juiste volgorde" });
      }
      fields["Statut"] = statut;
    }

    // La validation article par article doit etre EXPLICITE (envoyee par le
    // panneau de validation). Le simple passage de statut ne valide jamais.
    if (statut === "Prête" && preparationValidee !== true && !f["Préparation validée"]) {
      return res.status(409).json({ error: "Valideer eerst elk artikel afzonderlijk vóór u de bestelling op Klaar zet" });
    }
    if (preparationValidee === true) {
      fields["Préparation validée"] = true;
      fields["Préparée le"] = new Date().toISOString();
    }

    let stockReport = null, factuurnummer = null, mail = null;

    // Stock déduit au moment où la marchandise part réellement, SI Configuratie le
    // demande (« Voorraad afboeken »). Le navigateur ne décide plus (ancien skipStock).
    // Garde d'entrée sur le statut pour empêcher une double déduction si l'appel est rejoué.
    if (statut === "Sortie en livraison" && !departed) {
      if (!f["Préparation validée"]) {
        return res.status(409).json({ error: "Valideer eerst alle artikelen van deze bestelling" });
      }
      const rules = await __lev.loadRules(at);
      if (rules.voorraadAfboeken && !f["Stock afgeboekt"]) {
        const useLines = (typeof lignes === "string" ? fields["Lignes (produits / quantités)"] : f["Lignes (produits / quantités)"]);
        stockReport = await moveStock(useLines, -1);
        if (stockReport.error || stockReport.missing.length || stockReport.insufficient.length) {
          return res.status(409).json({
            error: stockReport.error || "Voorraadcontrole mislukt",
            stock: stockReport
          });
        }
        fields["Stock afgeboekt"] = true;
        const movementError = await createStockMovements(stockReport, f["Référence"] || id, "Sortie livraison");
        if (movementError) stockReport.journalWarning = movementError;
      }
    }

    if (statut === "Facturée") {
      const alreadyConfirmed = !!f["Livraison confirmée"];
      // Une réception déjà confirmée ne se réécrit pas (double tap, deuxième appareil).
      if (alreadyConfirmed && deliveryConfirmed && f["Statut"] === "Facturée") {
        return res.status(409).json({ error: "De ontvangst van deze bestelling is al bevestigd" });
      }
      if (!alreadyConfirmed && !deliveryConfirmed) {
        return res.status(409).json({ error: "Bevestig eerst de ontvangst van de levering" });
      }
      if (deliveryConfirmed && !alreadyConfirmed) {
        const receivedBy = String(recipient || "").trim().slice(0, 80);
        if (!receivedBy) return res.status(400).json({ error: "Vul in wie de levering heeft ontvangen" });
        if (proofUrl && !/^https:\/\/[^\s]{1,500}$/i.test(String(proofUrl))) {
          return res.status(400).json({ error: "De link naar het leveringsbewijs moet met https:// beginnen" });
        }
        fields["Livraison confirmée"] = true;
        fields["Réceptionné par"] = receivedBy;
        fields["Livrée le"] = new Date().toISOString();
        if (proofUrl) fields["Preuve de livraison"] = [{ url: String(proofUrl), filename: "leveringsbewijs" }];
        // Exception de livraison (absent, refusé, partiel, abîmé) : gardée sur la commande et dans le journal.
        const uitz = String(body.uitzondering || "").trim();
        if (uitz && !UITZONDERINGEN.includes(uitz)) return res.status(400).json({ error: "Ongeldige uitzondering" });
        if (uitz) {
          fields["Uitzondering levering"] = uitz;
          fields["Uitzondering nota"] = String(body.uitzonderingNota || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
          fields["Correcties"] = journal(f, correctionLine("Uitzondering bij levering: " + uitz, __auth.actorOf(req), fields["Uitzondering nota"]));
        }
      }
    }

    // Numéro de facture attribué une seule fois
    if (statut === "Facturée" && !f["Factuurnummer"]) {
      factuurnummer = await nextNumber("Factuurnummer", "FA");
      fields["Factuurnummer"] = factuurnummer;
      fields["Facturée le"] = new Date().toISOString();
    }

    if (!Object.keys(fields).length) return res.status(400).json({ error: "Niets om bij te werken" });

    const j = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    if (j.error) return res.status(500).json({ error: j.error.message || "Bijwerken mislukt" });

    // E-mails de statut (jamais bloquants) : onderweg au départ, geleverd + factuur à la réception.
    if (statut === "Sortie en livraison" && !departed) mail = await notifyStatus(req, f, "onderweg");
    if (statut === "Facturée" && deliveryConfirmed && !f["Livraison confirmée"]) {
      const rules = await __lev.loadRules(at);
      const nr = factuurnummer || f["Factuurnummer"] || "";
      const m = String(nr).match(/^FA-(\d{4})-(\d{1,6})$/i);
      let mededeling = "";
      if (m) { const base = m[1] + m[2].padStart(6, "0"); const digits = base + String(Number(base) % 97 || 97).padStart(2, "0"); mededeling = "+++" + digits.slice(0, 3) + "/" + digits.slice(3, 7) + "/" + digits.slice(7) + "+++"; }
      mail = await notifyStatus(req, f, "geleverd", { factuurnummer: nr, ontvangenDoor: fields["Réceptionné par"], vervaldatum: __mail.vervaldatum(__lev.brusselsToday(), rules.betaaltermijn), mededeling });
    }
    res.status(200).json({ ok: true, stock: stockReport, factuurnummer, mail });
  } catch (e) {
    console.error("[updateorder]", e && e.message || e);
    res.status(500).json({ error: "Bijwerken mislukt. Probeer opnieuw." });
  }
};
module.exports.parseLines = parseLines;
module.exports.formatLine = formatLine;
