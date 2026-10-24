/* global module, self */
// Bandeau « tij » de l'accueil (specs/037-x30-accueil, FR-002) : règles PURES, sans DOM. Chargé tel quel par la page
// (window.FamoTij, index.html) et par les tests Node (require("../assets/tij.js")).
//
// Même règle que le serveur (lib/levering.js) : avant la deadline (heure de Bruxelles), le premier jour livrable est
// demain ; après, après-demain ; puis le premier jour de livraison qui n'est pas fermé. On peut commander pour ce jour
// jusqu'à la veille à la deadline (checkCutoff ne limite que « demain »). Le serveur reste seul juge à la commande.
//
// Créneau : `rules.levervenster` au format normalisé « HH:MM-HH:MM » (lib/levering.parseSlot). Ce champ N'EXISTE PAS
// encore dans la configuration publique : sans lui, aucun créneau n'est jamais affiché (rien d'inventé).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FamoTij = api;
})(typeof self !== "undefined" ? self : this, function () {
  const KEYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const DEF = { deadline: "22:00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [] };
  const SOON = 30, NEAR = 6 * 60; // alerte à 30 min ; compte à rebours dans les 6 dernières heures

  let fmt = null;
  try { fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); } catch (e) { fmt = null; }
  /** Jour (AAAA-MM-JJ) et minute du jour à Bruxelles, quelle que soit l'horloge de l'appareil. */
  function brussels(now) {
    const d = now || new Date();
    if (!fmt) return { day: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
    const o = {}; fmt.formatToParts(d).forEach(x => { o[x.type] = x.value; });
    return { day: o.year + "-" + o.month + "-" + o.day, min: (Number(o.hour) % 24) * 60 + Number(o.minute) };
  }
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dow = iso => new Date(iso + "T12:00:00Z").getUTCDay();
  const dayDiff = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5);
  const hhmm = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "").trim()); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? m[1].padStart(2, "0") + ":" + m[2] : ""; };

  /** « HH:MM-HH:MM » (début < fin) → { van, tot } ; tout le reste → null. */
  function slot(v) {
    const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(typeof v === "string" ? v.trim() : "");
    if (!m || !hhmm(m[1]) || !hhmm(m[2]) || m[2] <= m[1]) return null;
    return { van: m[1], tot: m[2] };
  }

  /** Prochaine livraison possible et sa date limite. mode : countdown (ce soir, < 6 h) · today · later. */
  function plan(rules, now) {
    const r = Object.assign({}, DEF, rules || {});
    const deadline = hhmm(r.deadline) || DEF.deadline;
    const lever = Array.isArray(r.leverdagen) && r.leverdagen.some(k => KEYS.includes(k)) ? r.leverdagen : DEF.leverdagen;
    const closed = Array.isArray(r.geslotenDagen) ? r.geslotenDagen : [];
    const b = brussels(now), cut = Number(deadline.slice(0, 2)) * 60 + Number(deadline.slice(3));
    let d = addDays(b.day, b.min < cut ? 1 : 2), i = 0;
    while (!(lever.includes(KEYS[dow(d)]) && !closed.includes(d)) && i++ < 400) d = addDays(d, 1);
    const orderBy = addDays(d, -1), tonight = orderBy === b.day;
    const left = dayDiff(b.day, orderBy) * 1440 + cut - b.min;
    return { deliver: d, orderBy, deadline, tonight, left, mode: tonight ? (left <= NEAR ? "countdown" : "today") : "later", soon: tonight && left <= SOON, slot: slot(r.levervenster) };
  }

  /** 192 → « 3 u 12 » (nl) / « 3 h 12 » (fr) ; 42 → « 42 min » ; 120 → « 2 u ». */
  function duration(min, lang) {
    const m = Math.max(0, Math.round(min)), h = Math.floor(m / 60), r = m % 60, u = lang === "fr" ? "h" : "u";
    if (!h) return r + " min";
    return h + " " + u + (r ? " " + String(r).padStart(2, "0") : "");
  }

  return { brussels, plan, slot, duration, addDays };
});
