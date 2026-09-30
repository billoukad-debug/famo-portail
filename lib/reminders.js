"use strict";
// Relances de paiement automatiques (audit H-01) — mode « Portaal » uniquement.
//   En mode « Boekhouder » (défaut), la facture légale et son suivi sont chez le comptable :
//   rien n'est envoyé. En mode Portaal, seulement si Beheer → Bedrijf → « Automatische
//   betalingsherinneringen » est coché (Configuratie « Herinneringen aan »).
// Règles : échéance = « Facturée le » (jour de Bruxelles) + « Betaaltermijn dagen » (14 par défaut).
//   1re relance à échéance + 3 jours, 2e à échéance + 17 jours (seulement après la 1re), puis
//   plus rien d'automatique. Chaque niveau n'est envoyé qu'une fois (« Herinnering N op »,
//   réservé de façon atomique sur le moteur SQL avant l'envoi, libéré si l'envoi échoue).
// Ignorées : payées, annulées, sans e-mail client, entièrement créditées.
const { at, atAll } = require("./airtable");
const __bill = require("./billing");
const __lev = require("./levering");
const __mail = require("./ordermail");
const __journal = require("./journal");
const __atomic = require("./atomic");
const __cn = require("./creditnota");

const LEVELS = [{ level: 1, field: "Herinnering 1 op", after: 3 }, { level: 2, field: "Herinnering 2 op", after: 17 }];
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

function brusselsDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDays(day, n) { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function parseLines(txt) {
  return String(txt || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*([^[(]*)(.*)$/);
    if (!m) return null;
    const price = (m[4] || "").match(/\[€\s*([\d.,]+)\]/);
    return { nom: m[1].trim(), qty: parseFloat(m[2].replace(",", ".")) || 0, price: price ? Number(price[1].replace(",", ".")) : null };
  }).filter(Boolean);
}

// Niveau à envoyer aujourd'hui pour une commande (0 = rien), avec l'échéance.
function levelFor(fields, termijn, today) {
  const f = fields || {};
  if (f["Statut"] !== "Facturée" || f["Statut paiement"] === "Payé" || !f["Factuurnummer"]) return { level: 0 };
  const inv = brusselsDay(f["Facturée le"]);
  if (!inv) return { level: 0 };
  const verval = addDays(inv, termijn);
  if (!f["Herinnering 1 op"]) return { level: today >= addDays(verval, LEVELS[0].after) ? 1 : 0, verval, factuurdatum: inv };
  if (!f["Herinnering 2 op"]) return { level: today >= addDays(verval, LEVELS[1].after) ? 2 : 0, verval, factuurdatum: inv };
  return { level: 0, verval, factuurdatum: inv };
}

// Montants TVAC de la facture et de la note de crédit, avec les taux figés à la facturation.
function amounts(f, catRates, fallback) {
  const lines = parseLines(f["Lignes (produits / quantités)"]);
  const rates = __bill.linesRates(lines, f, catRates, fallback);
  const inv = lines.some((l) => l.price != null) ? __bill.orderTotals(lines, rates, fallback) : null;
  const incl = inv ? inv.total : r2(Number(f["Total"] || 0) * (1 + fallback / 100));
  // Toutes les notes de crédit (C-08), chacune TVAC aux taux figés de la facture.
  let cnIncl = 0;
  __cn.list(f).forEach((n) => {
    const cl = parseLines(n.lignes);
    cnIncl += cl.some((l) => l.price != null) ? Math.abs(__bill.orderTotals(cl, rates, fallback).total) : r2(Number(n.montant || 0) * (1 + fallback / 100));
  });
  return { incl: r2(incl), cnIncl: r2(cnIncl), open: r2(incl - cnIncl) };
}

async function reserveLevel(id, field, stamp) {
  const got = await __atomic.claim("Commandes", id, field, false, stamp);
  if (got === null) { // Airtable : pas d'écriture conditionnelle, on relit juste avant.
    const cur = await at(`Commandes/${id}`);
    if (!cur || cur.error || cur.fields[field]) return false;
    const up = await at(`Commandes/${id}`, { method: "PATCH", body: JSON.stringify({ fields: { [field]: stamp } }) });
    return !!(up && !up.error);
  }
  return got;
}

/** Une passe du cron. opts.now (Date/ISO) pour les tests. Ne jette pas pour une commande isolée. */
async function run(opts) {
  const o = opts || {};
  const now = o.now ? new Date(o.now) : new Date();
  const today = brusselsDay(now.toISOString());
  const conf = await at(encodeURIComponent("Configuratie") + "?maxRecords=1");
  if (!conf || conf.error) throw new Error("Configuratie onleesbaar");
  const cf = (((conf.records || [])[0]) || {}).fields || {};
  if (__bill.modeOf(cf) !== "portaal") return { skipped: "boekhouder", sent: 0 };
  if (!cf["Herinneringen aan"]) return { skipped: "uit", sent: 0 };
  if (!__mail.enabled()) return { skipped: "geen-mail", sent: 0 }; // RESEND_API_KEY absente : rien à réserver
  const termijn = __lev.rulesFrom(cf).betaaltermijn;
  const [cmd, cl, cat] = await Promise.all([atAll("Commandes?filterByFormula=" + encodeURIComponent("{Statut}='Facturée'")), atAll("Clients"), atAll("Catalogue")]);
  if (cmd.error || cl.error) throw new Error("Commandes of klanten onleesbaar");
  const clients = new Map((cl.records || []).map((r) => [r.id, r]));
  const catRates = __bill.ratesFromCatalogue((cat && cat.records) || []), fallback = __bill.defaultRate(cf);
  const company = await __mail.loadMailConfig(at);
  const out = { sent: 0, failed: 0, noEmail: 0, credited: 0, checked: 0, details: [] };
  for (const r of cmd.records || []) {
    const f = r.fields || {};
    const d = levelFor(f, termijn, today);
    if (!d.level) continue;
    out.checked++;
    const client = clients.get((f["Client"] || [])[0]);
    const klant = client ? __mail.clientFrom(client) : null;
    if (!klant || !klant.email) { out.noEmail++; continue; }
    const m = amounts(f, catRates, fallback);
    if (m.open <= 0.005) { out.credited++; continue; }
    const L = LEVELS[d.level - 1], stamp = now.toISOString();
    if (!(await reserveLevel(r.id, L.field, stamp))) continue; // un autre passage l'a pris
    const nr = f["Factuurnummer"];
    const res = await __mail.notifyReminder({
      level: d.level, ref: f["Référence"] || "", factuurnummer: nr, factuurdatum: d.factuurdatum, vervaldatum: d.verval,
      totalIncl: m.incl, openstaand: m.open, creditnota: f["Creditnota nummer"] ? { nummer: __cn.list(f).map((n) => n.nummer).join(", "), montantIncl: m.cnIncl } : null,
      mededeling: __bill.structuredRef(nr), klant, company, opsEmail: company.opsEmail, portalUrl: o.portalUrl || ""
    }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
    if (!res || !res.ok) {
      out.failed++; // on libère le niveau : nouvel essai au prochain passage
      await at(`Commandes/${r.id}`, { method: "PATCH", body: JSON.stringify({ fields: { [L.field]: null } }) }).catch(() => null);
      out.details.push({ ref: f["Référence"], level: d.level, ok: false });
      continue;
    }
    out.sent++;
    const line = `${new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(now)} · Betalingsherinnering ${d.level} verstuurd · systeem`;
    await at(`Commandes/${r.id}`, { method: "PATCH", body: JSON.stringify({ fields: { "Correcties": (f["Correcties"] ? f["Correcties"] + "\n" : "") + line } }) }).catch(() => null);
    await __journal.log({ wie: "systeem", rol: "cron", actie: "Betalingsherinnering " + d.level, object: "Commandes", record: r.id, referentie: (f["Référence"] || "") + " · " + nr, wijzigingen: [{ veld: L.field, voor: "", na: stamp }] });
    out.details.push({ ref: f["Référence"], level: d.level, ok: true });
  }
  return out;
}

module.exports = { run, levelFor, amounts, LEVELS, brusselsDay, addDays };
