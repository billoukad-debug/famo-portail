// Règles de livraison, lues dans Configuratie et appliquées PARTOUT (commande client,
// saisie personnel, modification de leverdag) : une seule source, sinon le panier
// accepte un jour que le serveur refuse, ou l'inverse.
//
//   Besteldeadline    "22:00"  → après cette heure (Bruxelles) le premier jour livrable est après-demain
//   Leverdagen        "ma,di,wo,do,vr,za" → jours de la semaine livrés (zo = dimanche)
//   Gesloten dagen    "2026-12-25\n2027-01-01" → jours fermés (fériés, congés)
//   Minimum bestelling 0 → montant minimum hors TVA d'une commande client
//   Betaaltermijn dagen 14 → échéance de facture
//   Voorraad afboeken  ☐  → déduction du stock au départ
//
// checkDate refuse l'impossible (passé, dimanche/jour non livré, jour fermé, trop loin).
// La coupure horaire des COMMANDES CLIENT est contrôlée à part (checkCutoff), avec une
// tolérance de 15 minutes : une commande passée à 21:59 dans le navigateur n'est pas
// refusée parce que la requête arrive à 22:00:30. Le personnel n'y est pas soumis.

const DAY_KEYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const DEFAULTS = { deadline: "22:00", dagen: [1, 2, 3, 4, 5, 6], gesloten: [], minimum: 0, betaaltermijn: 14, voorraadAfboeken: false, maxDagen: 60 };

function brusselsToday() {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}

function parseDays(text) {
  const out = String(text || "").toLowerCase().split(/[,\s;]+/).map(s => DAY_KEYS.indexOf(s.trim().slice(0, 2))).filter(i => i >= 0);
  return out.length ? Array.from(new Set(out)).sort() : DEFAULTS.dagen.slice();
}

function parseClosed(text) {
  return String(text || "").split(/[\n,;\s]+/).map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
}

/** Règles à partir des champs bruts de l'enregistrement Configuratie (ou {}). */
function rulesFrom(fields) {
  const f = fields || {};
  const deadline = /^\d{1,2}:\d{2}$/.test(String(f["Besteldeadline"] || "").trim()) ? String(f["Besteldeadline"]).trim().padStart(5, "0") : DEFAULTS.deadline;
  const minimum = Number(f["Minimum bestelling"]);
  const termijn = Number(f["Betaaltermijn dagen"]);
  return {
    deadline,
    dagen: parseDays(f["Leverdagen"]),
    gesloten: parseClosed(f["Gesloten dagen"]),
    minimum: Number.isFinite(minimum) && minimum > 0 ? Math.round(minimum * 100) / 100 : 0,
    betaaltermijn: Number.isFinite(termijn) && termijn > 0 ? Math.round(termijn) : DEFAULTS.betaaltermijn,
    voorraadAfboeken: !!f["Voorraad afboeken"],
    // Conditions générales publiées (lib/terms.js, audit C-12) : vide = rien à accepter.
    voorwaardenVersie: String(f["Voorwaarden versie"] || "").trim(),
    maxDagen: DEFAULTS.maxDagen
  };
}

/** Bloc public pour le navigateur (panier, saisie) : mêmes règles, sans le reste de la config. */
function publicRules(rules) {
  const r = rules || rulesFrom({});
  return { deadline: r.deadline, leverdagen: r.dagen.map(i => DAY_KEYS[i]), geslotenDagen: r.gesloten, minimum: r.minimum, maxDagen: r.maxDagen };
}

/** "" si la date est livrable, sinon le message (NL) à renvoyer au client. */
function checkDate(iso, rules) {
  const r = rules || rulesFrom({});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "Ongeldige leverdag";
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return "Ongeldige leverdag";
  const today = brusselsToday();
  if (iso < today) return "De leverdag ligt in het verleden";
  const max = new Date(today + "T12:00:00Z"); max.setUTCDate(max.getUTCDate() + r.maxDagen);
  if (iso > max.toISOString().slice(0, 10)) return `Kies een leverdag binnen de komende ${r.maxDagen} dagen`;
  const dow = d.getUTCDay();
  if (!r.dagen.includes(dow)) return dow === 0 ? "Op zondag leveren we niet" : "Op die dag leveren we niet";
  if (r.gesloten.includes(iso)) return "Op die dag zijn we gesloten";
  return "";
}

/** Charge Configuratie via le helper at() de l'appelant ; jamais d'exception (règles par défaut). */
async function loadRules(at) {
  try {
    const conf = await at(encodeURIComponent("Configuratie") + "?maxRecords=1");
    const rec = ((conf && conf.records) || [])[0];
    return rulesFrom((rec && rec.fields) || {});
  } catch (e) {
    return rulesFrom({});
  }
}

function brusselsClock(now) {
  try {
    const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now || new Date());
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  } catch (e) { const d = now || new Date(); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
}

const CUTOFF_GRACE_MIN = 15;
/** Commande client : "" si l'heure limite est respectée, sinon le message (NL). */
function checkCutoff(iso, rules, now) {
  const r = rules || rulesFrom({});
  const today = brusselsToday();
  if (String(iso) <= today) return "Voor vandaag kan niet meer besteld worden. Kies een latere leverdag.";
  const tomorrow = new Date(today + "T12:00:00Z"); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (String(iso) !== tomorrow.toISOString().slice(0, 10)) return "";
  const [h, m] = r.deadline.split(":").map(Number);
  if (brusselsClock(now) > h * 60 + m + CUTOFF_GRACE_MIN) return `Na ${r.deadline} kan niet meer voor morgen besteld worden. Kies een latere leverdag.`;
  return "";
}

// Heure de livraison prévue (« Leverslot », D4, specs/015) : deux heures, normalisées en "HH:MM-HH:MM".
// Pas de texte libre : le client la lit en NL ou en FR (« tussen … en … » / « entre … et … »).
// Accepte « 06:00-08:00 », « 6u - 8u », « tussen 6u30 en 8u », « entre 6h et 8h15 », « 7.45 tot 9.00 ».
// Vide (ou null) = effacer. Résultat : { value } ou { error } (néerlandais, affiché au personnel).
const SLOT_MAX = 40;
const SLOT_RE = /^(?:tussen|entre|van)?\s*(\d{1,2})(?:[:.hu](\d{2})?)?\s*(?:-|–|—|en|et|tot|à)\s*(\d{1,2})(?:[:.hu](\d{2})?)?$/i;
function parseSlot(v) {
  if (v === null || v === undefined) return { value: null };
  if (typeof v !== "string") return { error: "Ongeldig leveruur" };
  const s = v.trim();
  if (!s) return { value: null };
  if (s.length > SLOT_MAX) return { error: "Leveruur te lang (max. " + SLOT_MAX + " tekens)" };
  const m = SLOT_RE.exec(s);
  if (!m) return { error: "Ongeldig leveruur: geef twee uren, bv. 06:00-08:00" };
  const h1 = Number(m[1]), m1 = Number(m[2] || 0), h2 = Number(m[3]), m2 = Number(m[4] || 0);
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return { error: "Ongeldig leveruur: uren tussen 00:00 en 23:59" };
  if (h2 * 60 + m2 <= h1 * 60 + m1) return { error: "Het einduur moet na het beginuur liggen" };
  const hhmm = (h, mi) => String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
  return { value: hhmm(h1, m1) + "-" + hhmm(h2, m2) };
}

module.exports = { rulesFrom, publicRules, checkDate, checkCutoff, loadRules, brusselsToday, parseSlot, DAY_KEYS, DEFAULTS };
