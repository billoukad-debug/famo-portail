"use strict";
// Beheer (api/onboarding.js) : aides partagées par les modules d'actions de lib/beheer/ (audit I-10).
// Déplacées telles quelles depuis api/onboarding.js ; chemins require relatifs à lib/.
require("../datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, atBatch, escapeFormula } = require("../airtable");
const __ca = require("../clientauth");
const crypto = require("crypto");

const __auth = require("../staffauth");
const __mail = require("../mail");
const __prices = require("../prices");
const __terms = require("../terms");
const __kl = require("../klantlogin");
const __ordermail = require("../ordermail");
const __authmail = require("../authmail");
const __lev = require("../levering");
const __bill = require("../billing");
const __guard = require("../guardrails");
const __journal = require("../journal");
const __vies = require("../vies");
const BASE = "appcdduLth9iGX8I0";
const REC = /^[A-Za-z0-9]{1,40}$/;

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; }
  }
  return body || {};
}

// Type réel d'une image d'après ses octets magiques : lib/photo.js (partagé avec api/bewijs.js).
const { imageType } = require("../photo");

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

// Nom d'utilisateur déjà pris sur les DEUX tables de connexion (Clients, Klantgebruikers, H-08) ?
// → id de l'enregistrement qui l'a, ou "". Table Klantgebruikers absente (Airtable) : ignorée.
async function usernameOwner(user) {
  const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${escapeFormula(String(user || "").toLowerCase())}'`);
  const hit = await at(`Clients?filterByFormula=${f}&maxRecords=1`);
  if ((hit.records || []).length) return hit.records[0].id;
  const u = await at(`${encodeURIComponent(__kl.USERS)}?filterByFormula=${f}&maxRecords=1`).catch(() => null);
  return u && !u.error && (u.records || []).length ? u.records[0].id : "";
}

async function uniqueUsername(base) {
  let candidate = base;
  for (let i = 0; i < 20; i++) {
    if (!(await usernameOwner(candidate))) return candidate;
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
    enkelPin: !!c["Enkel persoonlijke PIN"], // audit L-06 : codes partagés refusés (api/session.js)
    mailFromConfigured: !!String(process.env.MAIL_FROM || "").trim(),
    // Règles de livraison et de facturation (lib/levering) — modifiables ici, lues partout.
    besteldeadline: String(c["Besteldeadline"] || "").trim(),
    leverdagen: String(c["Leverdagen"] || "").trim(),
    geslotenDagen: String(c["Gesloten dagen"] || "").trim(),
    minimumBestelling: Number(c["Minimum bestelling"]) > 0 ? Number(c["Minimum bestelling"]) : 0,
    betaaltermijnDagen: Number(c["Betaaltermijn dagen"]) > 0 ? Number(c["Betaaltermijn dagen"]) : 14,
    voorraadAfboeken: !!c["Voorraad afboeken"],
    voorwaarden: __terms.current(c),
    herinneringen: !!c["Herinneringen aan"],
    lotsVerplicht: !!c["Lots verplicht"]
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
    foto: require("../photo").photoUrl(r.fields["Foto"]),
    actif: !!r.fields["Actif"],
    volgorde: r.fields["Volgorde"] == null || r.fields["Volgorde"] === "" ? null : Number(r.fields["Volgorde"])
  })).sort((a, b) => a.nom.localeCompare(b.nom, "nl"));

  const clientList = (clients.records || []).map(r => ({
    id: r.id,
    nom: r.fields["Nom"] || "",
    adresse: r.fields["Lieu de livraison"] || "",
    facturatieadres: r.fields["Facturatieadres"] || "",
    tel: r.fields["Téléphone"] || "",
    btw: r.fields["BTW-nummer"] || "",
    klantnr: r.fields["Klantnummer"] || "",
    email: (r.fields["Email"] || "").trim(),
    user: r.fields["Gebruikersnaam"] || "",
    hasPassword: !!r.fields["Wachtwoord"],
    gearchiveerd: !!r.fields["Gearchiveerd"],
    voorwaardenVersie: r.fields["Voorwaarden versie"] || "",
    voorwaardenOp: r.fields["Voorwaarden aanvaard op"] || "",
    taal: String(r.fields["Taal"] || "").toUpperCase() === "FR" ? "FR" : "NL",
    // Régime de TVA (C-10) et dernier contrôle VIES (C-16).
    regime: __bill.vat.regime(r.fields["Régime TVA"]).key,
    vies: __vies.stored(r.fields)
  })).sort((a, b) => a.nom.localeCompare(b.nom, "nl"));

  const priceList = (prices.records || []).map(r => ({
    id: r.id,
    clientId: (r.fields["Client"] || [])[0] || "",
    productId: (r.fields["Produit"] || [])[0] || "",
    prix: __prices.negotiatedValue(r.fields["Prix négocié"]),
    van: __prices.periodOf(r.fields).van,
    tot: __prices.periodOf(r.fields).tot
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

// ---- Medewerkers (comptes individuels, PIN haché) ----
// Audit L-06 : avec l'option « Enkel persoonlijke PIN », Beheer ne s'ouvre plus que par le
// PIN d'une beheerder active (hors secours ADMIN_CODE). Cette modification (next = champs
// modifiés, null = suppression) retirerait-elle la dernière ? → {status, error}, sinon null.
const beheerderPin = f => !!(f && f["Actief"] && f["Rol"] === "beheerder" && String(f["PIN hash"] || "").trim());
const lastBeheerderBlock = async (id, next) => {
  const conf = await getConfigRecord();
  if (conf && conf.error) return { status: 500, error: "Configuratie onleesbaar. Probeer opnieuw." };
  if (!(conf && conf.fields && conf.fields["Enkel persoonlijke PIN"])) return null;
  const all = await atAll("Medewerkers");
  if (all.error) return { status: 500, error: "Medewerkers onleesbaar. Probeer opnieuw." };
  const recs = all.records || [];
  const after = recs.some(r => beheerderPin(r.id !== id ? r.fields : next && Object.assign({}, r.fields, next)));
  return after || !recs.some(r => beheerderPin(r.fields)) ? null : { status: 409, error: "Dit is de laatste actieve medewerker met rol Beheerder en een eigen PIN. Zolang „Enkel persoonlijke pincodes” aan staat, moet er minstens één blijven. Maak eerst een andere beheerder aan of zet de optie uit." };
};

module.exports = { at, atAll, atBatch, escapeFormula, __ca, crypto, __auth, __mail, __prices, __terms, __kl, __ordermail, __authmail, __lev, __bill, __guard, __journal, __vies, BASE, REC, parseBody, imageType, clean, slugUser, genPassword, usernameOwner, uniqueUsername, mapUnitIn, getConfigRecord, statusPayload, beheerderPin, lastBeheerderBlock };
