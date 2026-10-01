"use strict";
// Aides communes des scénarios métier (test/workflow/*.test.js), découpés de l'ancien
// scripts/workflow-check.js (audit F-10, specs/011-workflow-check-decoupe).
//
// Chaque fichier de scénarios fait `require("./_helpers")` EN PREMIER, puis `isolate(__filename)` :
//   - environnement de test fixé ici, avant le chargement de tout module api/ ou lib/ (certains
//     lisent process.env au chargement : lib/staffauth.js, lib/mail.js) ;
//   - aucun appel réseau réel possible : fetch global remplacé par un refus explicite (chaque
//     scénario installe ses propres réponses simulées via call() ou son propre mock) ;
//   - un fichier = un processus (node --test, isolation par processus, défaut de Node 22) :
//     les fichiers modifient global.fetch, process.env et le cache de require ; isolate()
//     échoue bruyamment si deux fichiers se retrouvent dans le même processus.
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

// Codes de test (jamais ceux d'un vrai environnement) ; tout ce qui pourrait joindre un vrai
// service ou changer le chemin du code est retiré : mêmes conditions que la CI.
process.env.STAFF_CODE = "testcode-ci";
process.env.ADMIN_CODE = "admincode-ci";
for (const k of Object.keys(process.env)) if (/^AIRTABLE_/.test(k)) delete process.env[k];
for (const k of ["DB_BACKEND", "DB_SQLITE_FILE", "DATABASE_URL", "POSTGRES_URL", "NEON_HTTP_URL", "RESEND_API_KEY",
  "SESSION_SECRET", "FAMO_DEV_HTTP", "VERCEL", "MAIL_FROM", "PORTAL_URL"]) delete process.env[k];
global.fetch = async url => { throw new Error("Réseau réel interdit dans les scénarios métier (test/workflow) : " + url); };

const ROOT = path.join(__dirname, "..", "..");

const OWNER = Symbol.for("famo.workflow.file");
/** Un seul fichier de scénarios par processus (voir en tête). */
function isolate(file) {
  const prev = globalThis[OWNER];
  if (prev && prev !== file) {
    throw new Error("test/workflow : " + path.basename(file) + " partage son processus avec " + path.basename(prev) +
      " (isolation par processus requise, pas --experimental-test-isolation=none : les fichiers modifient fetch, process.env et le cache de require)");
  }
  globalThis[OWNER] = file;
}

// Mots de passe clients tels qu'ils sont stockés : empreinte scrypt (lib/clientauth.js).
// famoNL (dictionnaire d'affichage) vit dans assets/ui.js : on l'exécute une fois dans un bac
// à sable minimal et on l'injecte là où un test chargeait l'ancien staff-i18n.js.
const UI_NL = (() => {
  const sb = { console, document: { documentElement: {}, addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem() { return null; }, setItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, navigator: { language: "nl" }, location: { search: "", pathname: "/", hash: "" } };
  sb.window = sb; vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8"), sb);
  return { famoNL: sb.famoNL, FAMO_NL: sb.FAMO_NL };
})();
const HP = (() => { const cache = {}; return pw => cache[pw] || (cache[pw] = require(path.join(ROOT, "lib/clientauth")).hashPassword(pw)); })();

function json(payload) {
  return { json: async () => payload };
}

function mkRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
    setHeader(k, v) { this.headers[k] = v; }
  };
}

function clearModule(rel) {
  const abs = require.resolve(path.join(ROOT, rel));
  delete require.cache[abs];
  // api/updateorder.js découpé (A6, specs/010) : ses modules lib/commande/ sont rechargés avec lui.
  if (rel === "api/updateorder.js") Object.keys(require.cache).filter(k => k.startsWith(path.join(ROOT, "lib", "commande") + path.sep)).forEach(k => { delete require.cache[k]; });
}

// Facturation (api/updateorder.js billingContext) : Configuratie, Catalogue puis le client (régime de
// TVA, C-10), lus une fois AVANT l'attribution du numéro de facture (taux et régime figés, lib/billing.js).
const BILL = () => [{ records: [{ fields: {} }] }, { records: [] }, { fields: {} }];

async function call(handler, body, replies, opts) {
  opts = opts || {};
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    // Relecture de la génération de session (lib/staffauth.js, cache 60 s) : hors scénario.
    if (/fields%5B%5D=Sessiegeneratie/.test(String(url))) return json({ records: [] });
    // Utilisateurs supplémentaires (H-08, lib/klantlogin.js) : aucun dans ces scénarios historiques
    // (test/klantgebruikers.test.js les couvre sur SQLite).
    if (/\/Klantgebruikers(\?|$)/.test(String(url)) && !(options && options.method && options.method !== "GET")) return json({ records: [] });
    calls.push({ url: String(url), options: options || {} });
    assert(replies.length, `Appel Airtable inattendu: ${url}`);
    return json(replies.shift());
  };
  const res = mkRes();
  const req = {
    method: opts.method || "POST",
    body,
    headers: opts.headers || {},
    query: opts.query || {}
  };
  try {
    await handler(req, res);
    return { res, calls };
  } finally {
    global.fetch = originalFetch;
  }
}

// Réponse Airtable à la requête de numérotation (lib/ordernumber.js), juste avant
// l'enregistrement d'une commande : aucune référence CMD-<année>-NNNN encore.
const NO_ORDER_REFS = { records: [] };

/** Cookies staff et beheerder (codes d'environnement), comme l'ancien « relogin » commun. */
async function staffCookies() {
  const session = require(path.join(ROOT, "api", "session.js"));
  const sres = mkRes();
  await session({ method: "POST", body: { code: process.env.STAFF_CODE }, headers: {} }, sres);
  const tok = decodeURIComponent(/famo_sess=([^;]+)/.exec(sres.headers["Set-Cookie"])[1]);
  const ares = mkRes();
  await session({ method: "POST", body: { code: process.env.ADMIN_CODE }, headers: {} }, ares);
  const tokAdmin = decodeURIComponent(/famo_sess=([^;]+)/.exec(ares.headers["Set-Cookie"])[1]);
  return {
    cookieHdr: { cookie: "famo_sess=" + encodeURIComponent(tok) },
    adminCookieHdr: { cookie: "famo_sess=" + encodeURIComponent(tokAdmin) }
  };
}

// Aides communes aux sections AO–AW : dates civiles (Bruxelles), lecture des PATCH simulés.
function datesX() {
  const lev = require(path.join(ROOT, "lib", "levering.js"));
  const todayX = lev.brusselsToday();
  const plusX = n => { const d = new Date(todayX + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dowX = iso => new Date(iso + "T12:00:00Z").getUTCDay();
  const nextDowX = dow => { let n = 1; while (dowX(plusX(n)) !== dow) n++; return plusX(n); };
  const okDayX = dowX(plusX(1)) === 0 ? plusX(2) : plusX(1);
  const sundayX = nextDowX(0), saturdayX = nextDowX(6);
  const yearX = require(path.join(ROOT, "lib", "staffauth.js")).brusselsYear();
  return { lev, todayX, plusX, dowX, nextDowX, okDayX, sundayX, saturdayX, yearX };
}
const patchOfX = (r, re) => JSON.parse(r.calls.find(c => re.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH").options.body);
const methodCallsX = (r, m) => r.calls.filter(c => (c.options.method || "GET").toUpperCase() === m);

module.exports = {
  ROOT, isolate, UI_NL, HP, json, mkRes, clearModule, BILL, call, NO_ORDER_REFS,
  staffCookies, datesX, patchOfX, methodCallsX
};
