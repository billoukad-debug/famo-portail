"use strict";
// Journal d'audit en AJOUT SEUL (audit B-12, L-01, L-02) : qui a changé quoi, quand, avant → après.
//
// Écrit directement dans le stockage du moteur SQL (production : Neon), table « Journaal » :
// aucune route API ne permet de le modifier ou de l'effacer, et deux actions simultanées ne
// s'écrasent pas (une ligne par action, pas un champ texte réécrit en entier comme « Correcties »).
// Sur Airtable (plus utilisé en production), rien n'est écrit : log() renvoie null.
// Jamais bloquant : une action réussie reste réussie si le journal échoue (console.error).
const crypto = require("crypto");

const TABLE = "Journaal";
// Champs dont la valeur n'est jamais recopiée (empreintes, mots de passe, jetons).
const SECRET = /wachtwoord|hash|code|token|pin|secret/i;
// Réglages dont le NOM contient « PIN » mais dont la valeur (une case) n'a rien de secret :
// le journal doit montrer aan → uit (audit L-06).
const PUBLIC = new Set(["Enkel persoonlijke PIN"]);
// Champs techniques sans intérêt pour un humain.
const NOISE = new Set(["Correcties", "Favorieten"]);

function store() {
  const st = require("./datastore").state;
  return st.backend !== "airtable" && st.store ? st.store : null;
}

const short = (v) => { if (v === undefined || v === null || v === "") return ""; const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 300 ? s.slice(0, 297) + "…" : s; };

// Différences champ par champ entre deux états d'un enregistrement.
function diff(before, after) {
  const a = before || {}, b = after || {}, out = [];
  for (const k of Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).sort()) {
    if (NOISE.has(k)) continue;
    const x = short(a[k]), y = short(b[k]);
    if (x === y) continue;
    out.push(SECRET.test(k) && !PUBLIC.has(k) ? { veld: k, voor: x ? "•••" : "", na: y ? "••• (gewijzigd)" : "" } : { veld: k, voor: x, na: y });
  }
  return out;
}

async function get(table, id) {
  const s = store();
  if (!s || !id) return null;
  try { const r = await s.get(table, id); return r ? r.fields : null; } catch (e) { return null; }
}

async function log(entry) {
  const s = store();
  if (!s) return null;
  try {
    const now = new Date().toISOString();
    const fields = {
      Tijdstip: now, Wie: String(entry.wie || "—").slice(0, 60), Rol: String(entry.rol || "").slice(0, 20),
      Actie: String(entry.actie || "").slice(0, 60), Object: String(entry.object || "").slice(0, 40),
      Record: String(entry.record || "").slice(0, 40), Referentie: String(entry.referentie || "").slice(0, 120),
      Wijzigingen: JSON.stringify(entry.wijzigingen || []), Reden: String(entry.reden || "").slice(0, 200)
    };
    await s.insert(TABLE, [{ id: "recjnl" + crypto.randomBytes(8).toString("hex"), createdTime: now, fields }]);
    return true;
  } catch (e) { console.error("[journal]", e && e.message || e); return false; }
}

// Dernières entrées (plus récentes d'abord), filtrables par objet ou enregistrement.
async function list(opts) {
  const s = store();
  if (!s) return [];
  const o = opts || {};
  const rows = (await s.list(TABLE)).map((r) => Object.assign({ id: r.id }, r.fields, { Wijzigingen: (() => { try { return JSON.parse(r.fields.Wijzigingen || "[]"); } catch (e) { return []; } })() }));
  return rows.filter((r) => (!o.object || r.Object === o.object) && (!o.record || r.Record === o.record))
    .sort((a, b) => String(b.Tijdstip).localeCompare(String(a.Tijdstip))).slice(0, Math.min(Math.max(Number(o.limit) || 500, 1), 2000));
}

module.exports = { log, list, diff, get, store, TABLE };
