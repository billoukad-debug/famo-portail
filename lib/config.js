"use strict";
// Centrale configuratie: omgevingsvariabelen, Airtable-schema en vaste waarden.
// Alle veldnamen van de Airtable-base staan hier, nergens anders: een hernoeming
// in Airtable is dan één regel hier.

const env = (key) => String(process.env[key] || "").trim();

const BASE_ID = env("AIRTABLE_BASE") || "appcdduLth9iGX8I0";

// Tabellen (namen zoals in Airtable — worden URL-gecodeerd door de client).
const T = Object.freeze({
  CLIENTS: "Clients",
  CATALOGUE: "Catalogue",
  ORDERS: "Commandes",
  PRICES: "Prix négociés",
  CONFIG: "Configuratie",
  REQUESTS: "Aanvragen"
});

// Velden per tabel.
const F = Object.freeze({
  client: Object.freeze({
    name: "Nom",
    email: "Email",
    phone: "Téléphone",
    address: "Lieu de livraison",
    usual: "Articles habituels",
    notes: "Infos générales",
    orders: "Commandes",
    prices: "Prix négociés",
    username: "Gebruikersnaam",
    password: "Wachtwoord",
    vat: "BTW-nummer",
    number: "Klantnummer"
  }),
  product: Object.freeze({
    name: "Produit",
    basePrice: "Prix de base",
    unit: "Unité",
    category: "Catégorie",
    active: "Actif"
  }),
  order: Object.freeze({
    ref: "Référence",
    date: "Date",
    lines: "Lignes (produits / quantités)",
    status: "Statut",
    payment: "Statut paiement",
    total: "Total",
    prepPhoto: "Photo préparation",
    notes: "Notes",
    client: "Client",
    deliveryDate: "Date livraison souhaitée",
    invoiceNumber: "Factuurnummer",
    stockBooked: "Stock afgeboekt",
    prepValidated: "Préparation validée",
    preparedAt: "Préparée le",
    deliveredAt: "Livrée le",
    proof: "Preuve de livraison",
    invoicedAt: "Facturée le",
    receivedBy: "Réceptionné par",
    deliveryConfirmed: "Livraison confirmée"
  }),
  price: Object.freeze({
    label: "Libellé",
    client: "Client",
    product: "Produit",
    price: "Prix négocié"
  }),
  config: Object.freeze({
    companyName: "Bedrijfsnaam",
    street: "Adres",
    city: "Postcode en plaats",
    vat: "BTW-nummer",
    phone: "Telefoon",
    email: "E-mail",
    iban: "IBAN",
    bic: "BIC",
    vatRate: "BTW-tarief",
    paymentTerms: "Betalingsvoorwaarden",
    deliveryTerms: "Leveringsvoorwaarden",
    opsEmail: "Bestellingen e-mail",
    adminHash: "Beheerderscode hash",
    staffHash: "Personeelscode hash",
    // Toegevoegd door dit portaal (optioneel: ontbreken ze, dan gelden de standaardwaarden).
    cutoff: "Besteldeadline",
    deliveryDays: "Leverdagen"
  }),
  request: Object.freeze({
    company: "Bedrijfsnaam",
    contact: "Contactpersoon",
    email: "Email",
    phone: "Telefoon",
    address: "Adres",
    notes: "Notities",
    status: "Status"
  })
});

// Veld-ID's die nodig zijn voor bijlagen (upload-API werkt op ID, niet op naam).
const FIELD_IDS = Object.freeze({
  orderProof: "fldjCdOntoPXPKLIb",
  orderPrepPhoto: "fld4P0uySgGI6P6yE"
});

// Keuzelijsten zoals ze in Airtable bestaan (Franstalig — historisch). De
// Nederlandse etiketten staan in lib/domain.js.
const STATUS = Object.freeze({
  RECEIVED: "Reçue",
  READY: "Prête",
  SHIPPED: "Sortie en livraison",
  INVOICED: "Facturée"
});
const STATUS_FLOW = Object.freeze([STATUS.RECEIVED, STATUS.READY, STATUS.SHIPPED, STATUS.INVOICED]);
const PAYMENT = Object.freeze({ OPEN: "En attente", PAID: "Payé" });
const REQUEST_STATUS = Object.freeze({ NEW: "Nieuw", DONE: "Verwerkt" });
const UNIT_CHOICES = Object.freeze(["kg", "pièce", "caisse"]);

const DEFAULTS = Object.freeze({
  companyName: "Famo Trading BV",
  vatRate: 6,
  cutoff: "22:00",
  deliveryDays: "ma,di,wo,do,vr,za",
  paymentTerms: "Betaalbaar bij levering",
  deliveryTerms: "Controleer de goederen bij ontvangst. Klachten over verse producten melden wij graag dezelfde dag via telefoon of e-mail.",
  mailFrom: "Famo Trading <onboarding@resend.dev>"
});

const REQUIRED_ENV = Object.freeze(["AIRTABLE_TOKEN", "ADMIN_CODE", "STAFF_CODE"]);
const OPTIONAL_ENV = Object.freeze(["RESEND_API_KEY", "MAIL_FROM", "PORTAL_URL", "SESSION_SECRET"]);

module.exports = {
  env,
  BASE_ID,
  T, F, FIELD_IDS,
  STATUS, STATUS_FLOW, PAYMENT, REQUEST_STATUS, UNIT_CHOICES,
  DEFAULTS, REQUIRED_ENV, OPTIONAL_ENV,
  get airtableToken() { return env("AIRTABLE_TOKEN"); },
  get airtableApi() { return env("AIRTABLE_API_URL") || "https://api.airtable.com/v0"; },
  get airtableContentApi() { return env("AIRTABLE_CONTENT_URL") || "https://content.airtable.com/v0"; },
  get resendApi() { return env("RESEND_API_URL") || "https://api.resend.com"; },
  get resendKey() { return env("RESEND_API_KEY"); },
  get mailFrom() { return env("MAIL_FROM") || DEFAULTS.mailFrom; },
  get portalUrl() { return env("PORTAL_URL").replace(/\/+$/, ""); },
  get adminCode() { return env("ADMIN_CODE"); },
  get staffCode() { return env("STAFF_CODE"); },
  get sessionSecret() { return env("SESSION_SECRET"); },
  get insecureCookies() { return env("FAMO_INSECURE_COOKIES") === "1"; },
  /** Welke verplichte variabelen ontbreken? Leeg = klaar voor gebruik. */
  missingEnv() { return REQUIRED_ENV.filter((k) => !env(k)); },
  isConfigured() { return REQUIRED_ENV.every((k) => !!env(k)); },
  mailEnabled() { return !!env("RESEND_API_KEY"); }
};
