"use strict";
// Bedrijfsregels, los van HTTP en van Airtable: geld, orderlijnen, statussen,
// prijzen, data, leverdagen, nummering. Alles hier is puur en testbaar.
const crypto = require("crypto");
const { STATUS, STATUS_FLOW, PAYMENT } = require("./config");

// ---- Geld (altijd in centen rekenen) -------------------------------------------
function toCents(value) {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
function fromCents(cents) { return Math.round(cents) / 100; }
function fmtNumber(value, decimals) {
  const n = Number(value) || 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? "-" : "") + grouped + (frac ? "," + frac : "");
}
/** 1250 -> "€ 12,50" */
function fmtEur(cents) { return "€ " + fmtNumber(fromCents(cents), 2); }
/** 0.5 -> "0,5" ; 3 -> "3" */
function fmtQty(q) {
  const n = Number(q) || 0;
  return Number.isInteger(n) ? String(n) : fmtNumber(n, 3).replace(/0+$/, "").replace(/,$/, "");
}

// ---- Eenheden en categorieën ---------------------------------------------------
const UNIT_LABELS = { kg: "kg", "pièce": "stuk", piece: "stuk", caisse: "doos", carton: "doos", doos: "doos", stuk: "stuk" };
function unitLabel(unit) { return UNIT_LABELS[String(unit || "").toLowerCase()] || String(unit || ""); }
function unitPlural(unit, qty) {
  const u = unitLabel(unit);
  if (Number(qty) === 1) return u;
  if (u === "stuk") return "stuks";
  if (u === "doos") return "dozen";
  return u;
}
function allowsDecimals(unit) { return /kg/i.test(String(unit || "")); }
const CATEGORY_LABELS = { poisson: "Vis", vis: "Vis", coquillages: "Schelpdieren", "crustacés": "Schaaldieren", crustaces: "Schaaldieren", algemeen: "Algemeen" };
function categoryLabel(cat) {
  const c = String(cat || "").trim();
  return CATEGORY_LABELS[c.toLowerCase()] || c || "Algemeen";
}

// ---- Orderlijnen (tekstformaat van de base, identiek aan het bestaande portaal) --
// "Product × 2 pièce [€16.00] (opmerking)"
function cleanComment(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/[()\[\]]/g, "").trim().slice(0, 200);
}
function cleanName(value) {
  return String(value || "").replace(/[\r\n×]+/g, " ").replace(/[\[\]]/g, "").trim().slice(0, 120);
}
function fmtQtyDot(q) {
  const n = Number(q) || 0;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}
function serializeLine(l) {
  const qty = fmtQtyDot(l.qty);
  const unit = l.unit ? " " + l.unit : "";
  const price = Number.isFinite(l.priceCents) ? ` [€${fromCents(l.priceCents).toFixed(2)}]` : "";
  const comment = l.comment ? ` (${cleanComment(l.comment)})` : "";
  return `${cleanName(l.name)} × ${qty}${unit}${price}${comment}`;
}
function serializeLines(lines) { return lines.map(serializeLine).join("\n"); }

const LINE_RE = /^(.*?)\s*×\s*([\d.,]+)\s*([^\[\(]*?)\s*(?:\[€\s*([\d.,]+)\])?\s*(?:\((.*)\))?\s*$/;
const LINE_RE_X = /^(.*?)\s+x\s+([\d.,]+)\s*([^\[\(]*?)\s*(?:\[€\s*([\d.,]+)\])?\s*(?:\((.*)\))?\s*$/i;
function parseLine(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(LINE_RE) || s.match(LINE_RE_X);
  if (!m) return { name: s, qty: 0, unit: "", priceCents: null, comment: "", raw: s, unparsed: true };
  return {
    name: m[1].trim(),
    qty: Number(String(m[2]).replace(",", ".")) || 0,
    unit: (m[3] || "").trim(),
    priceCents: m[4] != null ? toCents(String(m[4]).replace(",", ".")) : null,
    comment: (m[5] || "").trim(),
    raw: s
  };
}
function parseLines(text) {
  return String(text || "").split("\n").map(parseLine).filter(Boolean);
}
function lineTotalCents(l) {
  if (!Number.isFinite(l.priceCents)) return 0;
  return Math.round(l.priceCents * (Number(l.qty) || 0));
}
function linesTotalCents(lines) { return lines.reduce((s, l) => s + lineTotalCents(l), 0); }

// ---- Status --------------------------------------------------------------------
const STATUS_LABELS = {
  [STATUS.RECEIVED]: "Ontvangen",
  [STATUS.READY]: "Klaar",
  [STATUS.SHIPPED]: "Onderweg",
  [STATUS.INVOICED]: "Geleverd"
};
const PAYMENT_LABELS = { [PAYMENT.OPEN]: "Openstaand", [PAYMENT.PAID]: "Betaald" };
function statusLabel(s) { return STATUS_LABELS[s] || STATUS_LABELS[STATUS.RECEIVED]; }
function statusIndex(s) { const i = STATUS_FLOW.indexOf(s); return i < 0 ? 0 : i; }
function statusKey(s) { return ["ontvangen", "klaar", "onderweg", "geleverd"][statusIndex(s)]; }
function paymentLabel(p) { return PAYMENT_LABELS[p] || PAYMENT_LABELS[PAYMENT.OPEN]; }
function isLocked(status) { return statusIndex(status) >= 2; } // vanaf Onderweg: lijnen vast

// ---- Prijzen -------------------------------------------------------------------
/** Prijs in centen voor een product en klant: onderhandelde prijs, anders basisprijs. */
function priceFor(product, negotiatedCents) {
  if (Number.isFinite(negotiatedCents)) return negotiatedCents;
  return toCents(product.basePrice);
}

class DomainError extends Error {
  constructor(message, status) { super(message); this.name = "DomainError"; this.status = status || 400; }
}

/**
 * Bouwt de orderlijnen vanuit wat de browser stuurt. De browser kiest enkel
 * product en aantal; naam, eenheid en prijs komen altijd van de server.
 * @param {{productId:string, qty:number, comment?:string}[]} items
 * @param {Map<string, {id:string,name:string,unit:string,basePrice:number,active:boolean}>} products
 * @param {Map<string, number>} negotiated productId -> centen
 */
function buildOrderLines(items, products, negotiated) {
  if (!Array.isArray(items) || !items.length) throw new DomainError("Uw bestelling bevat geen artikelen.");
  if (items.length > 200) throw new DomainError("Te veel artikelen in één bestelling.");
  const merged = new Map();
  for (const it of items) {
    const id = String((it && it.productId) || "");
    const qty = Number(it && it.qty);
    const p = products.get(id);
    if (!p || p.active === false) throw new DomainError("Een artikel is niet (meer) beschikbaar. Vernieuw de pagina.");
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10000) throw new DomainError(`Ongeldig aantal voor ${p.name}.`);
    if (!allowsDecimals(p.unit) && !Number.isInteger(qty)) throw new DomainError(`${p.name}: enkel hele aantallen (${unitLabel(p.unit)}).`);
    const prev = merged.get(id) || { productId: id, name: p.name, unit: p.unit || "", qty: 0, comment: "", priceCents: priceFor(p, negotiated.get(id)) };
    prev.qty = Math.round((prev.qty + qty) * 1000) / 1000;
    prev.comment = cleanComment(it && it.comment) || prev.comment;
    merged.set(id, prev);
  }
  const lines = Array.from(merged.values());
  return { lines, text: serializeLines(lines), totalCents: linesTotalCents(lines) };
}

// ---- Referenties en nummering --------------------------------------------------
const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newOrderRef(isoDate) {
  const d = String(isoDate || todayISO()).replace(/-/g, "").slice(2, 8);
  let s = "";
  for (let i = 0; i < 4; i++) s += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  return `B-${d}-${s}`;
}
/** FA-2026-0007 : opeenvolgend per jaar, hoogste bestaande + 1. */
function nextInvoiceNumber(existingNumbers, year) {
  const re = new RegExp("^FA-" + year + "-(\\d+)$");
  let max = 0;
  (existingNumbers || []).forEach((v) => {
    const m = String(v || "").match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `FA-${year}-${String(max + 1).padStart(4, "0")}`;
}
/** K-008 : hoogste numerieke suffix van bestaande klantnummers + 1. */
function nextClientNumber(existing) {
  let max = 0;
  (existing || []).forEach((v) => {
    const m = String(v || "").match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "K-" + String(max + 1).padStart(3, "0");
}

// ---- Datum en tijd (Europe/Brussels) ---------------------------------------------
const TZ = "Europe/Brussels";
function partsInBrussels(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });
  const o = {};
  f.formatToParts(d).forEach((p) => { o[p.type] = p.value; });
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday] || 0;
  return { iso: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour === "24" ? 0 : o.hour), minute: Number(o.minute), weekday: wd, year: Number(o.year) };
}
function todayISO(now) { return partsInBrussels(now).iso; }
function brusselsYear(now) { return partsInBrussels(now).year; }
function nowISO() { return new Date().toISOString(); }
function isISODate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(Date.parse(s + "T00:00:00Z")); }
function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(iso) {
  const d = new Date(iso + "T12:00:00Z").getUTCDay(); // 0=zo
  return d === 0 ? 7 : d;
}
const DAY_SHORT = ["", "ma", "di", "wo", "do", "vr", "za", "zo"];
const DAY_LONG = ["", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const MONTH_LONG = ["", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
/** "2026-09-02" -> "woensdag 2 september 2026" */
function fmtDateNl(iso, opts = {}) {
  if (!isISODate(iso)) return String(iso || "—");
  const [y, m, d] = iso.split("-").map(Number);
  const wd = weekdayOf(iso);
  const day = opts.short ? DAY_SHORT[wd] : DAY_LONG[wd];
  return `${opts.noWeekday ? "" : day + " "}${d} ${MONTH_LONG[m]}${opts.noYear ? "" : " " + y}`;
}
/** "2026-09-02" -> "02/09/2026" */
function fmtDateShort(iso) {
  if (!isISODate(iso)) return String(iso || "—");
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
/** ISO-tijdstip -> "02/09/2026 om 06:14" (Brussel) */
function fmtDateTimeNl(isoTs) {
  if (!isoTs) return "—";
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return String(isoTs);
  const p = partsInBrussels(d);
  return `${fmtDateShort(p.iso)} om ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
/** Relatief etiket voor leverdatum: Vandaag / Morgen / weekdag */
function relativeDayLabel(iso, now) {
  const today = todayISO(now);
  if (iso === today) return "Vandaag";
  if (iso === addDays(today, 1)) return "Morgen";
  if (iso === addDays(today, -1)) return "Gisteren";
  return fmtDateNl(iso, { short: true, noYear: true });
}

// ---- Leverdagen en besteldeadline ------------------------------------------------
function parseDeliveryDays(text) {
  const map = { ma: 1, di: 2, wo: 3, do: 4, vr: 5, za: 6, zo: 7, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
  const set = new Set();
  String(text || "").toLowerCase().split(/[\s,;]+/).forEach((w) => { if (map[w]) set.add(map[w]); });
  return set.size ? set : new Set([1, 2, 3, 4, 5, 6]);
}
function parseCutoff(text) {
  const s = String(text || "").trim();
  const m = s.match(/^(\d{1,2})[:h.](\d{1,2})$/) || s.match(/^(\d{1,2})\s*(?:u|h)?$/);
  if (!m) return { hour: 22, minute: 0 };
  const h = Math.min(23, Math.max(0, Number(m[1]))), mi = Math.min(59, Math.max(0, Number(m[2] || 0)));
  return { hour: h, minute: mi };
}
function fmtCutoff(c) { return `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`; }
/**
 * Eerstvolgende leverdatums. Vóór de deadline mag morgen nog; erna pas overmorgen.
 * Vandaag zelf is nooit een keuze (er wordt 's nachts voorbereid).
 */
function nextDeliveryDates({ now, deliveryDays, cutoff, count = 7 } = {}) {
  const p = partsInBrussels(now || new Date());
  const days = deliveryDays instanceof Set ? deliveryDays : parseDeliveryDays(deliveryDays);
  const c = typeof cutoff === "object" && cutoff ? cutoff : parseCutoff(cutoff);
  const afterCutoff = p.hour > c.hour || (p.hour === c.hour && p.minute >= c.minute);
  const start = addDays(p.iso, afterCutoff ? 2 : 1);
  const out = [];
  for (let i = 0; i < 21 && out.length < count; i++) {
    const iso = addDays(start, i);
    if (days.has(weekdayOf(iso))) out.push(iso);
  }
  return out;
}
function isDeliveryDateAllowed(iso, opts) {
  if (!isISODate(iso)) return false;
  const list = nextDeliveryDates(Object.assign({ count: 30 }, opts || {}));
  return list.includes(iso);
}

// ---- BTW -------------------------------------------------------------------------
function vatBreakdown(exclCents, ratePct) {
  const rate = Number.isFinite(Number(ratePct)) ? Number(ratePct) : 6;
  const vat = Math.round(exclCents * rate / 100);
  return { exclCents, ratePct: rate, vatCents: vat, inclCents: exclCents + vat };
}

// ---- Opschonen invoer --------------------------------------------------------------
function clean(value, max) { return String(value == null ? "" : value).replace(/\u00a0/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max || 200); }
function cleanMultiline(value, max) { return String(value == null ? "" : value).replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max || 1000); }
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim()); }
function normalizeEmail(value) { return clean(value, 120).toLowerCase(); }
function normalizeUsername(value) { return clean(value, 40).toLowerCase().replace(/\s+/g, ""); }
function slugUsername(name) {
  const base = String(name || "klant").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 18);
  return base || "klant";
}
function normalizeVat(value) {
  const v = clean(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!v) return "";
  if (/^BE\d{10}$/.test(v)) return "BE " + v.slice(2, 6) + "." + v.slice(6, 9) + "." + v.slice(9);
  if (/^\d{10}$/.test(v)) return "BE " + v.slice(0, 4) + "." + v.slice(4, 7) + "." + v.slice(7);
  return clean(value, 40);
}

module.exports = {
  DomainError,
  toCents, fromCents, fmtEur, fmtNumber, fmtQty,
  unitLabel, unitPlural, allowsDecimals, categoryLabel,
  serializeLine, serializeLines, parseLine, parseLines, lineTotalCents, linesTotalCents, cleanComment, cleanName,
  STATUS_LABELS, PAYMENT_LABELS, statusLabel, statusIndex, statusKey, paymentLabel, isLocked,
  priceFor, buildOrderLines,
  newOrderRef, nextInvoiceNumber, nextClientNumber,
  TZ, partsInBrussels, todayISO, brusselsYear, nowISO, isISODate, addDays, weekdayOf,
  fmtDateNl, fmtDateShort, fmtDateTimeNl, relativeDayLabel, DAY_SHORT, DAY_LONG, MONTH_LONG,
  parseDeliveryDays, parseCutoff, fmtCutoff, nextDeliveryDates, isDeliveryDateAllowed,
  vatBreakdown,
  clean, cleanMultiline, isEmail, normalizeEmail, normalizeUsername, slugUsername, normalizeVat
};
