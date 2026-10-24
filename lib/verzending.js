"use strict";
// Verzending naar de boekhouder en via Peppol (specs/034-vague-3-facturation) : statut PAR DOCUMENT
// (facture FA-… et chaque note de crédit CN-…) d'une commande facturée.
//
// Stockage : champ Commandes « Verzending » (texte JSON), une entrée par numéro de document :
//   { "FA-2026-0025": { boekhouder: { op: "2026-10-24", door: "Mohsen", bron: "hand" },
//                       peppol: { status: "Verstuurd" | "Aanvaard" | "Geweigerd", op, reden, bron, id, door } } }
// Aujourd'hui le beheerder le remplit à la main (bron « hand », via /api/updateorder { verzending }).
// Un futur envoi automatique (point d'accès Peppol, réponse du comptable attendue) appelle la même
// fonction apply() avec bron « automatisch » et l'identifiant du message (id) : même champ, même journal.
// Rien n'est jamais envoyé d'ici : ce module ne fait qu'écrire un statut.
const __cn = require("./creditnota");

const FIELD = "Verzending";
const PEPPOL = ["Verstuurd", "Aanvaard", "Geweigerd"];
const BRON = ["hand", "automatisch"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const brusselsDay = (d) => { const x = d ? new Date(d) : new Date(); return Number.isNaN(x.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(x); };
const realDay = (s) => DAY.test(String(s || "")) && new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
const nlDay = (s) => (DAY.test(String(s || "")) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "");
const txt = (s, n) => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").trim().slice(0, n);

function cleanEntry(e) {
  const out = { boekhouder: null, peppol: null };
  if (e && e.boekhouder && realDay(e.boekhouder.op)) out.boekhouder = { op: e.boekhouder.op, door: txt(e.boekhouder.door, 60), bron: BRON.includes(e.boekhouder.bron) ? e.boekhouder.bron : "hand" };
  if (e && e.peppol && PEPPOL.includes(e.peppol.status) && realDay(e.peppol.op)) {
    out.peppol = { status: e.peppol.status, op: e.peppol.op, reden: txt(e.peppol.reden, 200), bron: BRON.includes(e.peppol.bron) ? e.peppol.bron : "hand", id: txt(e.peppol.id, 120), door: txt(e.peppol.door, 60) };
  }
  return out;
}
/** Tous les statuts d'une commande : { nummer: { boekhouder, peppol } } (JSON illisible = rien). */
function all(fields) {
  const raw = (fields || {})[FIELD];
  if (!raw) return {};
  let p = null;
  try { p = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return {}; }
  if (!p || typeof p !== "object" || Array.isArray(p)) return {};
  const out = {};
  Object.keys(p).forEach((k) => { const e = cleanEntry(p[k]); if (e.boekhouder || e.peppol) out[k] = e; });
  return out;
}
const of = (fields, nummer) => all(fields)[nummer] || { boekhouder: null, peppol: null };

/** Numéros des documents de la commande : la facture puis chaque note de crédit, avec leur date (Bruxelles). */
function documents(fields) {
  const f = fields || {};
  if (f["Statut"] !== "Facturée" || !f["Factuurnummer"]) return [];
  return [{ nummer: f["Factuurnummer"], soort: "factuur", datum: brusselsDay(f["Facturée le"] || f["Livrée le"]) }]
    .concat(__cn.list(f).map((n) => ({ nummer: n.nummer, soort: "creditnota", datum: brusselsDay(n.le) })));
}

/** La facture est-elle partie (boekhouder ou Peppol) ? Alors la réception ne se défait plus : note de crédit. */
const invoiceSent = (fields) => { const e = of(fields, (fields || {})["Factuurnummer"]); return !!(e.boekhouder || e.peppol); };

// Texte court pour l'écran et le journal (néerlandais).
function label(e) {
  const x = e || {}, parts = [];
  if (x.boekhouder) parts.push("Naar boekhouder " + nlDay(x.boekhouder.op));
  if (x.peppol) parts.push("Peppol " + x.peppol.status.toLowerCase() + " " + nlDay(x.peppol.op) + (x.peppol.reden ? " (" + x.peppol.reden + ")" : ""));
  return parts.join(" · ");
}

/**
 * Applique une mise à jour. input : { nummer, boekhouder?: "YYYY-MM-DD" | null, peppol?: { status, op, reden?, id? } | null }
 * (absent = inchangé, null = effacé). ctx : { door, bron ("hand" par défaut), today ("YYYY-MM-DD", tests) }.
 * → { status, error } ou { value (JSON du champ, "{}" si vide), entry, labels: [texte du journal…] }.
 */
function apply(fields, input, ctx) {
  const f = fields || {}, inp = input || {}, c = ctx || {};
  const bron = BRON.includes(c.bron) ? c.bron : "hand", door = txt(c.door, 60), today = c.today || brusselsDay();
  if (f["Statut"] !== "Facturée" || !f["Factuurnummer"]) return { status: 409, error: "Enkel een gefactureerde bestelling heeft een verzendstatus" };
  const doc = documents(f).find((d) => d.nummer === String(inp.nummer || ""));
  if (!doc) return { status: 400, error: "Onbekend documentnummer voor deze bestelling" };
  const dateErr = (s, wat) => {
    if (!realDay(s)) return "Ongeldige datum (" + wat + ")";
    if (s > today) return "De datum (" + wat + ") ligt in de toekomst";
    if (doc.datum && s < doc.datum) return "De datum (" + wat + ") ligt vóór de datum van " + doc.nummer;
    return "";
  };
  const map = all(f), cur = map[doc.nummer] || { boekhouder: null, peppol: null }, next = { boekhouder: cur.boekhouder, peppol: cur.peppol }, labels = [];
  if (inp.boekhouder !== undefined) {
    if (inp.boekhouder === null || inp.boekhouder === "") {
      if (cur.boekhouder) { next.boekhouder = null; labels.push("Naar boekhouder gewist: " + doc.nummer); }
    } else {
      const err = dateErr(String(inp.boekhouder), "boekhouder");
      if (err) return { status: 400, error: err };
      if (!cur.boekhouder || cur.boekhouder.op !== inp.boekhouder) { next.boekhouder = { op: String(inp.boekhouder), door, bron }; labels.push("Naar boekhouder: " + doc.nummer + " op " + nlDay(inp.boekhouder)); }
    }
  }
  if (inp.peppol !== undefined) {
    if (inp.peppol === null || (inp.peppol && !inp.peppol.status)) {
      if (cur.peppol) { next.peppol = null; labels.push("Peppol-status gewist: " + doc.nummer); }
    } else {
      const p = inp.peppol || {};
      if (!PEPPOL.includes(p.status)) return { status: 400, error: "Ongeldige Peppol-status (Verstuurd, Aanvaard of Geweigerd)" };
      const err = dateErr(String(p.op || ""), "Peppol");
      if (err) return { status: 400, error: err };
      const reden = txt(p.reden, 200);
      if (p.status === "Geweigerd" && !reden) return { status: 400, error: "Waarom geweigerd? Vul de reden in." };
      const np = { status: p.status, op: String(p.op), reden: p.status === "Geweigerd" ? reden : "", bron, id: bron === "automatisch" ? txt(p.id, 120) : "", door };
      if (!cur.peppol || cur.peppol.status !== np.status || cur.peppol.op !== np.op || cur.peppol.reden !== np.reden) { next.peppol = np; labels.push("Peppol " + doc.nummer + ": " + np.status.toLowerCase() + " op " + nlDay(np.op) + (np.reden ? " (" + np.reden + ")" : "")); }
    }
  }
  if (!labels.length) return { status: 400, error: "Geen wijziging" };
  if (next.boekhouder || next.peppol) map[doc.nummer] = next; else delete map[doc.nummer];
  return { value: JSON.stringify(map), entry: next, labels }; // "{}" = plus rien (lib/atomic.mutate n'efface pas)
}

module.exports = { FIELD, PEPPOL, BRON, all, of, documents, invoiceSent, label, apply, brusselsDay };
