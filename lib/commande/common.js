"use strict";
// Bijwerken (api/updateorder.js) : aides partagées par les modules de lib/commande/ (dette A6,
// specs/010-updateorder-numerotation). Déplacées telles quelles depuis api/updateorder.js ;
// chemins require relatifs à lib/. Aucun état ici : le verrou par commande reste dans le point d'entrée.
require("../datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, atBatch, escapeFormula, REC } = require("../airtable");
const __auth = require("../staffauth");
const __prices = require("../prices");
const __lev = require("../levering");
const __mail = require("../ordermail");
const __bill = require("../billing");
const __atomic = require("../atomic");
const __guard = require("../guardrails");
const __journal = require("../journal");
const __trace = require("../trace");
const __cn = require("../creditnota");
const __corr = require("../correctie");

// Airtable accepte 10 enregistrements par requête : au-delà, tout est découpé.
function numberOf(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
const norm = s => String(s || "").toLowerCase().trim();
const money = v => Math.round((Number(v) || 0) * 100) / 100;

// "Zalmfilet × 3 doos [€12.50] (in filets)"  ->  { nom, qty, unit, price, comment }
const { parseLines } = require("../lines"); // une seule définition (I-11)
function formatLine(l){
  const q = String(Math.round(l.qty * 1000) / 1000);
  return `${l.nom} × ${q}${l.unit ? " " + l.unit : ""}${l.price != null ? " [€" + Number(l.price).toFixed(2) + "]" : ""}${l.comment ? " (" + String(l.comment).replace(/[()\[\]\r\n]/g, "") + ")" : ""}`;
}

// Mode de facturation, taux par défaut, taux du catalogue et régime de TVA du client (lib/billing.js).
// Client illisible (autre que « introuvable ») : erreur plutôt qu'une facture au mauvais régime
// (audit C-10) ; l'appelant la lève AVANT de réserver le numéro de facture.
async function billingContext(clientId){
  const [conf, cat, cli] = await Promise.all([at(`${encodeURIComponent("Configuratie")}?maxRecords=1`), atAll("Catalogue"), clientId ? at("Clients/" + encodeURIComponent(clientId)) : Promise.resolve(null)]);
  const c = ((conf && conf.records) || [])[0]; const cf = (c && c.fields) || {};
  if (cli && cli.error && !(cli.error.type === "NOT_FOUND" || /not found/i.test(String(cli.error.message || "")))) throw Object.assign(new Error("Klant onleesbaar"), { status: 503 });
  return { mode: __bill.modeOf(cf), fallback: __bill.defaultRate(cf), rates: __bill.ratesFromCatalogue((cat && cat.records) || []), regime: __bill.regimeOf(null, cli && !cli.error ? cli.fields : null) };
}

function correctionLine(label, actor, reden){
  const when = new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(",", "");
  return `${when} · ${label} · ${actor}${reden ? " — " + reden : ""}`;
}
function journal(f, line){ return (f["Correcties"] ? f["Correcties"] + "\n" : "") + line; }

const STATUSES = ["Reçue", "Prête", "Sortie en livraison", "Facturée"];
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

module.exports = { at, atAll, atBatch, escapeFormula, REC, __auth, __prices, __lev, __mail, __bill, __atomic, __guard, __journal, __trace, __cn, __corr,
  numberOf, norm, money, parseLines, formatLine, billingContext, correctionLine, journal, STATUSES, CANCELLED, CORRECTIONS, UITZONDERINGEN, BETAALWIJZEN, notifyStatus };
