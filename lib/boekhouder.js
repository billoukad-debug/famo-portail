"use strict";
// Export voor de boekhouder per periode (specs/034-vague-3-facturation) : facturen en creditnota's
// d'une période, avec les montants de l'UBL (lib/ubl.js, même règle assets/vat.js, taux figés), le statut
// payé, le statut d'envoi (lib/verzending.js) et ce qui empêcherait l'UBL (ubl.problems).
// Date d'une facture = « Facturée le » (jour de Bruxelles), sinon « Livrée le » ; note de crédit = sa date.
// Commandes test (lib/testorders.js) exclues ; seules les commandes facturées avec un numéro FA.
const vat = require("../assets/vat.js");
const bill = require("./billing");
const ubl = require("./ubl");
const __cn = require("./creditnota");
const __verz = require("./verzending");
const { parseLines } = require("./lines");
const R = require("../assets/rapport.js"); // csv / csvNum : mêmes règles que les CSV de la Rapportage (injection de formule)

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (s) => DAY.test(String(s || "")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
const MAX_DAGEN = 400;

/** Période demandée : { van, tot } (YYYY-MM-DD, bornes comprises) ou { error }. */
function periode(q) {
  const van = String((q || {}).van || ""), tot = String((q || {}).tot || "");
  if (!realDay(van) || !realDay(tot)) return { error: "Kies een periode: van en tot (JJJJ-MM-DD)" };
  if (van > tot) return { error: "De begindatum ligt na de einddatum" };
  if ((Date.parse(tot) - Date.parse(van)) / 864e5 > MAX_DAGEN) return { error: "Periode te lang: hoogstens " + MAX_DAGEN + " dagen" };
  return { van, tot };
}

// Montants d'un document à partir du contexte UBL : HTVA, TVA, TVAC (positifs ; une note de crédit est négative dans la liste).
function amounts(ctx, f, fallback) {
  if (ctx.lines.length) { const t = ubl.build(ctx).totals; return { excl: t.htva, btw: t.tva, incl: t.total }; }
  // Ancienne commande sans prix par ligne : total stocké au taux par défaut (comme les relances).
  const excl = vat.r2(Number(ctx.kind === "credit" ? f["Creditnota montant"] : f["Total"]) || 0), rate = vat.regime(ctx.regime).zero ? 0 : fallback;
  const btw = vat.r2(excl * rate / 100);
  return { excl, btw, incl: vat.r2(excl + btw) };
}

/**
 * Documents de la période. src : { orders (enregistrements Commandes), clients (Map id → enregistrement),
 * config (champs Configuratie), catalogueRates, van, tot } → lignes triées par date puis numéro.
 */
function documenten(src) {
  const s = src || {}, out = [], fallback = bill.defaultRate(s.config || {});
  const inPeriod = (d) => d && d >= s.van && d <= s.tot;
  for (const r of require("./testorders").real(s.orders || [])) {
    const f = r.fields || {};
    if (f["Statut"] !== "Facturée" || !f["Factuurnummer"]) continue;
    const client = (s.clients && s.clients.get((f["Client"] || [])[0])) || null;
    const cl = (client && client.fields) || {};
    const docs = __verz.documents(f);
    const base = { orderId: r.id, ref: f["Référence"] || "", klant: cl["Nom"] || "", klantBtw: cl["BTW-nummer"] || "" };
    docs.forEach((d, i) => {
      if (!inPeriod(d.datum)) return;
      const credit = d.soort === "creditnota";
      const note = credit ? __cn.list(f)[i - 1] : null;
      const order = note ? Object.assign({}, r, { fields: Object.assign({}, f, { "Creditnota nummer": note.nummer, "Creditnota lignes": note.lignes, "Creditnota montant": note.montant, "Creditnota le": note.le, "Creditnota motif": note.motif }) }) : r;
      const ctx = ubl.contextFrom({ order, client, config: s.config || {}, catalogueRates: s.catalogueRates || {}, parseLines, kind: credit ? "credit" : "invoice" });
      const a = amounts(ctx, order.fields, fallback), sign = credit ? -1 : 1;
      const v = __verz.of(f, d.nummer);
      out.push(Object.assign({}, base, {
        soort: d.soort, nummer: d.nummer, datum: d.datum, factuur: credit ? f["Factuurnummer"] : "",
        excl: vat.r2(sign * a.excl), btw: vat.r2(sign * a.btw), incl: vat.r2(sign * a.incl),
        betaald: credit ? null : f["Statut paiement"] === "Payé", betaaldOp: credit ? "" : (f["Statut paiement"] === "Payé" ? __verz.brusselsDay(f["Payé le"]) || "" : ""),
        verzending: v, problemen: ubl.problems(ctx),
        ubl: "/api/export?format=ubl&id=" + encodeURIComponent(r.id) + (credit ? "&type=credit&cn=" + encodeURIComponent(d.nummer) : "")
      }));
    });
  }
  return out.sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : String(x.nummer).localeCompare(String(y.nummer))));
}

const HEADER = ["Type", "Nummer", "Datum", "Oorspronkelijke factuur", "Klant", "BTW-nummer klant", "Bestelling", "Totaal excl. btw", "Btw", "Totaal incl. btw", "Betaald", "Betaald op", "Naar boekhouder op", "Peppol", "Peppol op", "UBL volledig"];
/** CSV (UTF-8 avec BOM, « ; », décimale « , ») : une ligne par document, puis le total de la période. */
function csvOf(rows) {
  const list = rows || [];
  const sum = (k) => vat.r2(list.reduce((t, d) => t + (Number(d[k]) || 0), 0));
  return R.csv([HEADER].concat(list.map((d) => [
    d.soort === "creditnota" ? "Creditnota" : "Factuur", d.nummer, d.datum, d.factuur, d.klant, d.klantBtw, d.ref,
    R.csvNum(d.excl), R.csvNum(d.btw), R.csvNum(d.incl),
    d.betaald === null ? "" : d.betaald ? "ja" : "nee", d.betaaldOp,
    (d.verzending.boekhouder && d.verzending.boekhouder.op) || "", (d.verzending.peppol && d.verzending.peppol.status) || "", (d.verzending.peppol && d.verzending.peppol.op) || "",
    d.problemen.length ? "nee: " + d.problemen.join("; ") : "ja"
  ]), [["Totaal", list.length + " documenten", "", "", "", "", "", R.csvNum(sum("excl")), R.csvNum(sum("btw")), R.csvNum(sum("incl")), "", "", "", "", "", ""]]));
}

module.exports = { periode, documenten, csvOf, HEADER, MAX_DAGEN };
