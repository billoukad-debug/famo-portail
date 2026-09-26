"use strict";
// Lokale nabootsing van de Airtable REST API, met het echte schema van de base.
// Doel: de productiecode ongewijzigd laten draaien tegen een lokale server, met
// dezelfde fouten als Airtable (onbekend veld, ongeldige keuze) zodat typfouten
// hier al opvallen. Wordt enkel door scripts/dev.js en de tests gebruikt.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE_ID = "appcdduLth9iGX8I0";

// Schema: veldnamen + types, overgenomen uit de echte base (list_tables_for_base).
const SCHEMA = {
  Clients: {
    // Gearchiveerd : plus de connexion ni de présence dans les listes (api/catalogue authClient, api/staff).
    // Favorieten : JSON {favorieten:[ids], standaard:{id:qty}} synchronisé entre appareils (api/klantorder).
    fields: { "Nom": "text", "Email": "email", "Téléphone": "text", "Lieu de livraison": "text", "Articles habituels": "text", "Infos générales": "text", "Commandes": "links", "Prix négociés": "links", "Gebruikersnaam": "text", "Wachtwoord": "text", "BTW-nummer": "text", "Klantnummer": "text", "Gearchiveerd": "checkbox", "Favorieten": "text", "Taal": "select" },
    selects: { "Taal": ["NL", "FR"] }, primary: "Nom"
  },
  Catalogue: {
    // BTW-tarief : taux par produit (6 / 21) ; vide = taux de Configuratie.
    fields: { "Produit": "text", "Prix de base": "number", "Unité": "select", "Catégorie": "text", "Actif": "checkbox", "Stock": "links", "Prix négociés": "links", "Kaliber": "text", "Foto": "attachments", "BTW-tarief": "number", "Volgorde": "number", "Omschrijving": "text" },
    selects: { "Unité": ["kg", "pièce", "caisse", "carton"] }, primary: "Produit"
  },
  Commandes: {
    fields: {
      "Référence": "text", "Date": "date", "Lignes (produits / quantités)": "text", "Statut": "select", "Statut paiement": "select", "Total": "number", "Photo préparation": "attachments", "Notes": "text", "Client": "links", "Date livraison souhaitée": "date", "Factuurnummer": "text", "Stock afgeboekt": "checkbox", "Préparation validée": "checkbox", "Préparée le": "datetime", "Livrée le": "datetime", "Preuve de livraison": "attachments", "Facturée le": "datetime", "Réceptionné par": "text", "Livraison confirmée": "checkbox",
      // Corrections (api/updateorder applyCorrection) : journal + annulation.
      "Annulée le": "datetime", "Motif annulation": "text", "Correcties": "text",
      // Paiement : horodatage et mode, posés quand la facture passe sur « Payé ».
      "Payé le": "datetime", "Mode de paiement": "select",
      // Exception à la réception (absent, refusé, partiel, abîmé) + ordre de tournée.
      "Uitzondering levering": "select", "Uitzondering nota": "text", "Volgorde levering": "number",
      // Creditnota sur une facture : numéro CN-AAAA-NNNN, lignes créditées, montant aux prix figés.
      "Creditnota nummer": "text", "Creditnota lignes": "text", "Creditnota montant": "number", "Creditnota le": "datetime", "Creditnota motif": "text"
    },
    selects: {
      "Statut": ["Reçue", "Prête", "Sortie en livraison", "Facturée", "Annulée"], "Statut paiement": ["En attente", "Payé"],
      "Mode de paiement": ["Contant", "Overschrijving", "Bancontact", "Andere"],
      "Uitzondering levering": ["Afwezig", "Geweigerd", "Gedeeltelijk", "Beschadigd"]
    },
    fieldIds: { fldjCdOntoPXPKLIb: "Preuve de livraison", fld4P0uySgGI6P6yE: "Photo préparation" }, primary: "Référence"
  },
  Stock: { fields: { "Produit": "text", "Quantité disponible": "number", "Seuil bas": "number", "Produit lié": "links" }, primary: "Produit" },
  "Mouvements de stock": { fields: { "Mouvement": "text", "Date et heure": "datetime", "Type": "select", "Produit": "text", "Quantité": "number", "Stock avant": "number", "Stock après": "number", "Référence commande": "text", "Note": "text" }, selects: { "Type": ["Sortie livraison", "Correction inventaire", "Entrée stock", "Retour client", "Annulation sortie"] }, primary: "Mouvement" },
  "Prix négociés": { fields: { "Libellé": "text", "Client": "links", "Produit": "links", "Prix négocié": "number" }, primary: "Libellé" },
  Configuratie: {
    // Règles de livraison et de facturation lues par lib/levering.js : Besteldeadline "22:00",
    // Leverdagen "ma,di,wo,do,vr,za", Gesloten dagen (une date ISO par ligne), Minimum bestelling,
    // Betaaltermijn dagen, Voorraad afboeken (déduction du stock au départ).
    fields: { "Bedrijfsnaam": "text", "Adres": "text", "Postcode en plaats": "text", "BTW-nummer": "text", "Telefoon": "text", "E-mail": "email", "IBAN": "text", "BIC": "text", "BTW-tarief": "number", "Betalingsvoorwaarden": "text", "Leveringsvoorwaarden": "text", "Bestellingen e-mail": "email", "Beheerderscode hash": "text", "Personeelscode hash": "text", "Besteldeadline": "text", "Leverdagen": "text", "Gesloten dagen": "text", "Minimum bestelling": "number", "Betaaltermijn dagen": "number", "Voorraad afboeken": "checkbox" },
    primary: "Bedrijfsnaam"
  },
  Aanvragen: {
    fields: { "Bedrijfsnaam": "text", "Contactpersoon": "text", "Email": "email", "Telefoon": "text", "Adres": "text", "Notities": "text", "Status": "select", "Taal": "select" },
    selects: { "Status": ["Nieuw", "Verwerkt"], "Taal": ["NL", "FR"] }, primary: "Bedrijfsnaam"
  },
  // Comptes individuels du personnel (api/session : connexion par PIN, api/onboarding : gestion).
  Medewerkers: {
    fields: { "Naam": "text", "Rol": "select", "PIN hash": "text", "Actief": "checkbox", "Laatste aanmelding": "datetime" },
    selects: { "Rol": ["personeel", "beheerder"] }, primary: "Naam"
  }
};

// Medewerker de démonstration, présent dès que la table est vide : « Ilse », personeel,
// PIN 1234. scripts/seed.js ne connaît pas cette table ; la nabootsing la remplit
// elle-même (reset() et chargement d'un fichier .dev-data antérieur).
// Le hachage reproduit lib/staffauth.hashCode (scrypt$<sel hex>$<empreinte hex>, N=16384)
// SANS charger ce module : dev.js ne pose STAFF_CODE/ADMIN_CODE qu'après avoir construit
// la base, et staffauth lit ces variables une seule fois au chargement.
const DEMO_MEDEWERKER = { naam: "Ilse", rol: "personeel", pin: "1234" };
function scryptHash(code) {
  const salt = crypto.randomBytes(16);
  return "scrypt$" + salt.toString("hex") + "$" + crypto.scryptSync(String(code), salt, 32, { N: 16384 }).toString("hex");
}
function demoMedewerkers() {
  return [{ "Naam": DEMO_MEDEWERKER.naam, "Rol": DEMO_MEDEWERKER.rol, "PIN hash": scryptHash(DEMO_MEDEWERKER.pin), "Actief": true }];
}

function newId(prefix) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = prefix;
  for (let i = 0; i < 14; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

class FakeAirtable {
  constructor({ file } = {}) {
    this.file = file || null;
    this.data = {};
    Object.keys(SCHEMA).forEach((t) => { this.data[t] = []; });
    this.log = [];
    if (this.file && fs.existsSync(this.file)) {
      try { this.data = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (_) { /* opnieuw beginnen */ }
      Object.keys(SCHEMA).forEach((t) => { if (!this.data[t]) this.data[t] = []; });
      // Fichier .dev-data d'avant la table Medewerkers : on l'ajoute sans tout reseeder.
      if (this.data.Configuratie.length && !this.data.Medewerkers.length) this.ensureMedewerkers();
    }
  }
  save() { if (this.file) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1)); } }
  reset() { Object.keys(SCHEMA).forEach((t) => { this.data[t] = []; }); this.ensureMedewerkers(); this.save(); }
  ensureMedewerkers() { if (!this.data.Medewerkers.length) this.create("Medewerkers", demoMedewerkers(), false); }

  table(name) {
    const t = Object.keys(SCHEMA).find((k) => k.toLowerCase() === String(name).toLowerCase());
    if (!t) throw err(404, "TABLE_NOT_FOUND", `Could not find table ${name} in application ${BASE_ID}`);
    return t;
  }
  validate(table, fields, typecast) {
    const s = SCHEMA[table];
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (!(k in s.fields)) throw err(422, "UNKNOWN_FIELD_NAME", `Unknown field name: "${k}"`);
      const type = s.fields[k];
      if (v === "" || v === null || v === undefined || v === false || (Array.isArray(v) && !v.length)) continue;
      if (type === "select") {
        const choices = (s.selects || {})[k] || [];
        if (typeof v !== "string") throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value.`);
        if (!choices.includes(v)) {
          if (!typecast) throw err(422, "INVALID_MULTIPLE_CHOICE_OPTIONS", `Insufficient permissions to create new select option "${v}"`);
          choices.push(v);
        }
      }
      if (type === "number" && typeof v !== "number") throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected number`);
      if (type === "checkbox" && v !== true) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value.`);
      if (type === "links" && !Array.isArray(v)) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected array of record ids`);
      if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected date`);
      if (type === "datetime" && Number.isNaN(Date.parse(String(v)))) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected datetime`);
      if ((type === "text" || type === "email") && typeof v !== "string") throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${k}" cannot accept the provided value: expected string`);
      out[k] = v;
    }
    return out;
  }
  create(table, fieldsList, typecast) {
    return fieldsList.map((fields) => {
      const rec = { id: newId("rec"), createdTime: new Date().toISOString(), fields: this.validate(table, fields, typecast) };
      this.data[table].push(rec);
      return rec;
    });
  }
  update(table, records, typecast) {
    return records.map((r) => {
      const rec = this.data[table].find((x) => x.id === r.id);
      if (!rec) throw err(404, "NOT_FOUND", "Record not found");
      const validated = this.validate(table, r.fields, typecast);
      for (const [k, v] of Object.entries(r.fields || {})) {
        if (v === "" || v === null || v === undefined || v === false || (Array.isArray(v) && !v.length)) delete rec.fields[k];
        else rec.fields[k] = validated[k];
      }
      return rec;
    });
  }
  remove(table, ids) {
    return ids.map((id) => {
      const i = this.data[table].findIndex((x) => x.id === id);
      if (i < 0) throw err(404, "NOT_FOUND", "Record not found");
      this.data[table].splice(i, 1);
      return { id, deleted: true };
    });
  }
  list(table, q) {
    let rows = this.data[table].slice();
    if (q.filterByFormula) {
      // Formule hors du sous-ensemble compris ici : on renvoie TOUT plutôt qu'une erreur
      // (la vraie Airtable, elle, répondrait 422). Le message signale la lacune dans la
      // console du serveur de dev ; en production la formule reste évaluée par Airtable.
      let fn = null;
      try { fn = compileFormula(q.filterByFormula, table, this); }
      catch (e) { console.warn("[fake-airtable] formule non comprise, tout est renvoyé : " + q.filterByFormula + " (" + e.message + ")"); }
      if (fn) rows = rows.filter((r) => truthy(fn(r)));
    }
    (q.sort || []).slice().reverse().forEach((s) => {
      rows.sort((a, b) => {
        const av = a.fields[s.field], bv = b.fields[s.field];
        const c = av == null && bv == null ? 0 : av == null ? -1 : bv == null ? 1 : (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv)));
        return s.direction === "desc" ? -c : c;
      });
    });
    if (q.maxRecords) rows = rows.slice(0, q.maxRecords);
    const pageSize = Math.min(100, q.pageSize || 100);
    const start = q.offset ? Number(String(q.offset).replace(/^itr/, "")) || 0 : 0;
    const page = rows.slice(start, start + pageSize).map((r) => project(r, q.fields));
    const out = { records: page };
    if (start + pageSize < rows.length) out.offset = "itr" + (start + pageSize);
    return out;
  }
  get(table, id) {
    const rec = this.data[table].find((x) => x.id === id);
    if (!rec) throw err(404, "NOT_FOUND", "Record not found");
    return rec;
  }
  // Content-API : le segment est un id de champ (fldXXX) ou, comme le fait api/onboarding
  // pour « Foto », le nom du champ pièce jointe lui-même.
  upload(recordId, fieldId, body) {
    for (const [t, s] of Object.entries(SCHEMA)) {
      const fieldName = (s.fieldIds || {})[fieldId] || (s.fields[fieldId] === "attachments" ? fieldId : "");
      if (!fieldName) continue;
      const rec = this.data[t].find((x) => x.id === recordId);
      if (!rec) continue;
      const bytes = Math.floor(String(body.file || "").length * 3 / 4);
      if (bytes > 5 * 1024 * 1024) throw err(422, "INVALID_ATTACHMENT", "Attachment too large");
      const att = { id: newId("att"), url: `data:${body.contentType};base64,${body.file}`, filename: body.filename, size: bytes, type: body.contentType };
      rec.fields[fieldName] = (rec.fields[fieldName] || []).concat([att]);
      return { id: rec.id, createdTime: rec.createdTime, fields: { [fieldName]: rec.fields[fieldName] } };
    }
    throw err(404, "NOT_FOUND", "Record or field not found");
  }
}

function project(r, fields) {
  if (!fields || !fields.length) return { id: r.id, createdTime: r.createdTime, fields: Object.assign({}, r.fields) };
  const f = {};
  fields.forEach((k) => { if (r.fields[k] !== undefined) f[k] = r.fields[k]; });
  return { id: r.id, createdTime: r.createdTime, fields: f };
}
function err(status, type, message) { const e = new Error(message); e.status = status; e.type = type; return e; }
// ---- Formules : même interpréteur que la production (lib/at-formula.js) ----------
const __f = require("../lib/at-formula");
const truthy = __f.truthy;
function compileFormula(src, table, db) {
  // Comme Airtable, un champ lien lu dans une formule donne le champ primaire du lié.
  const linkedPrimary = (id) => { for (const t of Object.keys(SCHEMA)) { const rec = db.data[t].find((x) => x.id === id); if (rec) return rec.fields[SCHEMA[t].primary] || ""; } return id; };
  return __f.compileFormula(src, { linkedPrimary });
}

// ---- HTTP-server ------------------------------------------------------------------
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { const raw = Buffer.concat(chunks).toString("utf8"); try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(err(400, "INVALID_REQUEST_BODY", "Invalid JSON")); } });
    req.on("error", reject);
  });
}

function startServer(db, { port = 0, token = "dev-token", latencyMs = 0 } = {}) {
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    try {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const auth = String(req.headers.authorization || "");
      if (auth !== "Bearer " + token) return send(401, { error: { type: "AUTHENTICATION_REQUIRED", message: "Authentication required" } });
      const url = new URL(req.url, "http://x");
      const parts = url.pathname.split("/").filter(Boolean); // v0, base, table, id?
      if (parts[0] !== "v0" || parts[1] !== BASE_ID) return send(404, { error: { type: "NOT_FOUND", message: "Base not found" } });
      db.log.push({ method: req.method, path: url.pathname + url.search });
      // content-API: /v0/{base}/{recordId}/{fieldId}/uploadAttachment
      if (parts.length === 5 && parts[4] === "uploadAttachment" && req.method === "POST") {
        const body = await readJson(req);
        const out = db.upload(decodeURIComponent(parts[2]), decodeURIComponent(parts[3]), body);
        db.save(); return send(200, out);
      }
      const table = db.table(decodeURIComponent(parts[2] || ""));
      const id = parts[3] ? decodeURIComponent(parts[3]) : "";
      if (req.method === "GET" && id) return send(200, project(db.get(table, id)));
      if (req.method === "GET") {
        const q = { filterByFormula: url.searchParams.get("filterByFormula") || "", fields: url.searchParams.getAll("fields[]"), sort: [], maxRecords: Number(url.searchParams.get("maxRecords")) || 0, pageSize: Number(url.searchParams.get("pageSize")) || 100, offset: url.searchParams.get("offset") || "" };
        for (let k = 0; url.searchParams.has(`sort[${k}][field]`); k++) q.sort.push({ field: url.searchParams.get(`sort[${k}][field]`), direction: url.searchParams.get(`sort[${k}][direction]`) || "asc" });
        return send(200, db.list(table, q));
      }
      if (req.method === "POST") { const body = await readJson(req); if (!Array.isArray(body.records) || body.records.length > 10) return send(422, { error: { type: "INVALID_REQUEST_BODY", message: "records must be an array of at most 10" } }); const out = db.create(table, body.records.map((r) => r.fields || {}), !!body.typecast); db.save(); return send(200, { records: out }); }
      if (req.method === "PATCH" && id) { const body = await readJson(req); const out = db.update(table, [{ id, fields: body.fields || {} }], !!body.typecast); db.save(); return send(200, project(out[0])); }
      if (req.method === "DELETE" && id) { db.remove(table, [id]); db.save(); return send(200, { deleted: true, id }); }
      if (req.method === "PATCH") { const body = await readJson(req); if (!Array.isArray(body.records) || body.records.length > 10) return send(422, { error: { type: "INVALID_REQUEST_BODY", message: "records must be an array of at most 10" } }); const out = db.update(table, body.records, !!body.typecast); db.save(); return send(200, { records: out }); }
      if (req.method === "DELETE") { const ids = url.searchParams.getAll("records[]"); const out = db.remove(table, ids); db.save(); return send(200, { records: out }); }
      send(405, { error: { type: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    } catch (e) {
      send(e.status || 500, { error: { type: e.type || "SERVER_ERROR", message: e.message || String(e) } });
    }
  });
  return new Promise((resolve, reject) => { server.on("error", reject); server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/v0` })); });
}

module.exports = { FakeAirtable, startServer, SCHEMA, BASE_ID, compileFormula };
