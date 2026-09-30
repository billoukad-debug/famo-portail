"use strict";
// Contrôle d'un numéro de TVA européen dans VIES (audit C-16), par l'API REST officielle de la
// Commission européenne. Aucune clé, aucune donnée du portail envoyée : seulement le pays et le
// numéro. Délai maximal 8 s ; toute panne (réseau, service, État membre indisponible) devient une
// erreur 503 claire, jamais un « valide » ou « non valide » inventé. Jamais bloquant pour
// l'enregistrement d'un client : l'appelant (api/onboarding.js, action checkVies) ne fait que lire.
//
// check(btw, { fetch, timeoutMs }) → { valid, name, address, vatNumber, checkedAt }
//   erreur.status = 400 (numéro hors UE ou illisible) ou 503 (VIES indisponible, lent, en erreur).
// `fetch` injectable : les tests passent un faux service, jamais le vrai réseau.
const { parseVat } = require("./billing");

const URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const TIMEOUT_MS = 8000;

const fail = (status, message) => Object.assign(new Error(message), { status });
// « --- » : l'État membre ne publie pas le nom ou l'adresse.
const text = (v) => { const s = String(v == null ? "" : v).trim(); return /^-+$/.test(s) ? "" : s.slice(0, 300); };

async function check(btw, opts) {
  const o = opts || {};
  const v = parseVat(btw);
  if (!v || !v.eu) throw fail(400, "Enkel een btw-nummer van een EU-lidstaat (met landcode, bv. NL123456789B01) kan in VIES gecontroleerd worden.");
  const doFetch = o.fetch || globalThis.fetch;
  const ms = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let r, j;
  try {
    r = await doFetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ countryCode: v.prefix, vatNumber: v.number }), signal: ctrl.signal });
    j = await r.json().catch(() => null);
  } catch (e) {
    if (ctrl.signal.aborted || (e && e.name === "AbortError")) throw fail(503, "VIES antwoordt niet op tijd. Probeer later opnieuw; de klant opslaan kan gewoon.");
    throw fail(503, "VIES is niet bereikbaar. Probeer later opnieuw; de klant opslaan kan gewoon.");
  } finally { clearTimeout(timer); }
  if (!r || !r.ok || !j || typeof j !== "object") throw fail(503, "VIES gaf een fout (" + ((r && r.status) || "?") + "). Probeer later opnieuw.");
  const code = (Array.isArray(j.errorWrappers) && j.errorWrappers[0] && j.errorWrappers[0].error) || (j.userError && !/^(IN)?VALID$/.test(String(j.userError)) ? j.userError : "");
  if (code === "INVALID_INPUT") throw fail(400, "VIES aanvaardt dit btw-nummer niet (ongeldig formaat).");
  if (code || j.actionSucceed === false) throw fail(503, "VIES of de dienst van de lidstaat is niet beschikbaar (" + (code || "fout") + "). Probeer later opnieuw.");
  if (typeof j.valid !== "boolean") throw fail(503, "Onverwacht antwoord van VIES. Probeer later opnieuw.");
  return { valid: j.valid, name: text(j.name), address: text(j.address), vatNumber: v.full, checkedAt: new Date().toISOString() };
}

// Résultat stocké sur le client (Clients « VIES resultaat », JSON) ; illisible → null.
function stored(fields) {
  const f = fields || {};
  if (!f["VIES gecontroleerd op"] || !f["VIES resultaat"]) return null;
  try { const r = JSON.parse(f["VIES resultaat"]); return { valid: !!r.valid, name: String(r.name || ""), address: String(r.address || ""), vatNumber: String(r.vatNumber || ""), checkedAt: f["VIES gecontroleerd op"] }; } catch (e) { return null; }
}

module.exports = { check, stored, URL, TIMEOUT_MS };
