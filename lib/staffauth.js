// Session staff : cookie HttpOnly signé (HMAC), 8 h.
// Fail-closed : sans STAFF_CODE ni ADMIN_CODE, aucune auth staff possible.
// Le code ne circule que via POST /api/session (body). Les autres API = cookie only.
// Deux rôles : "staff" (Bestellingen/Magazijn/Leveringen) et "admin" (tout).
//
// Les codes sont modifiables depuis Beheer. Ils sont alors stockés HACHÉS (scrypt)
// dans Airtable — jamais en clair — et REMPLACENT celui de l'environnement pour ce
// rôle (sinon changer un code ne servirait à rien : l'ancien ouvrirait toujours).
// Porte de secours si le nouveau code est perdu : vider le champ hash dans Airtable,
// le code de la variable Vercel redevient alors valable.
//
// Option Beheer → Toegang « Enkel persoonlijke pincodes » (Configuratie « Enkel persoonlijke
// PIN ») : les codes partagés n'ouvrent plus rien, seuls les PIN personnels (api/session.js),
// plus l'accès de secours ADMIN_CODE pour le rôle beheerder (breakGlass ci-dessous).
//
// Les variables STAFF_CODE / ADMIN_CODE restent OBLIGATOIRES : elles sèment le
// secret HMAC des cookies. Sans elles ce secret serait devinable et n'importe qui
// pourrait forger une session — d'où le fail-closed de staffOk/adminOk.
//
// Révocation (sessions de 8 h) : chaque jeton porte une GÉNÉRATION signée.
//  - globale (Configuratie « Sessiegeneratie ») : +1 à « tout le monde déconnecter » et à
//    chaque changement de code → tous les jetons antérieurs tombent ;
//  - par Medewerker : id + empreinte courte du PIN haché ; supprimer, désactiver, changer le
//    PIN ou retirer le rôle beheerder invalide les sessions de cette personne.
// staffOk(req) reste SYNCHRONE (signature + ce que l'instance sait déjà des révocations,
// sans lecture). staffSession(req), asynchrone, relit la base au plus une fois par minute
// (cache mémoire 60 s) : GET /api/session (vérifié à chaque ouverture de page staff) et
// Beheer l'utilisent. Délai maximal d'une révocation : 60 s sur ces routes ; sur les autres
// API, qui n'appellent que staffOk, jusqu'à la fin de validité du jeton (8 h) tant qu'elles
// ne passent pas à staffSession — mais l'interface déconnecte dès la page suivante.
// Le secret HMAC dérive des variables d'environnement (stables), pas des codes stockés.
const crypto = require("crypto");
const STAFF_CODE = String(process.env.STAFF_CODE || "").trim();
const ADMIN_CODE = String(process.env.ADMIN_CODE || "").trim();
const TTL_MS = 8 * 3600 * 1000;
// scrypt : N = 2^17 (≈ 0,45 s par essai sur un cœur, 128 Mo) pour toute nouvelle empreinte.
// Le coût est écrit DANS l'empreinte (scrypt$<N>$<sel>$<empreinte>) : on pourra le relever
// plus tard sans casser les anciennes. L'ancien format scrypt$<sel>$<empreinte> (N=16384)
// reste lisible ; needsRehash() dit quand le remplacer (à la prochaine connexion réussie).
const SCRYPT_N = 131072;
const LEGACY_N = 16384;
const scryptOpts = N => ({ N, r: 8, p: 1, maxmem: 256 * N * 8 + 1024 * 1024 });

/** Hache un code pour stockage. Format : scrypt$<N>$<sel hex>$<empreinte hex>. */
function hashCode(code) {
  const value = String(code || "");
  if (!value) return "";
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(value, salt, 32, scryptOpts(SCRYPT_N));
  return "scrypt$" + SCRYPT_N + "$" + salt.toString("hex") + "$" + key.toString("hex");
}

// {N, salt, key} ou null. N borné (2^14..2^20) : une empreinte trafiquée en base ne doit
// pas pouvoir faire calculer un scrypt démesuré au serveur.
function parseHash(stored) {
  const parts = String(stored || "").split("$");
  if (parts[0] !== "scrypt" || (parts.length !== 3 && parts.length !== 4)) return null;
  const N = parts.length === 4 ? Number(parts[1]) : LEGACY_N;
  if (!Number.isInteger(N) || N < 16384 || N > 1048576 || (N & (N - 1))) return null;
  const [salt, key] = parts.slice(-2);
  if (!/^[0-9a-f]+$/i.test(salt) || !/^[0-9a-f]+$/i.test(key)) return null;
  return { N, salt: Buffer.from(salt, "hex"), key: Buffer.from(key, "hex") };
}

/** Vérifie un code contre une empreinte stockée. Comparaison à temps constant. */
function verifyHash(stored, provided) {
  const h = parseHash(stored);
  const value = String(provided || "");
  if (!h || !value || !h.key.length) return false;
  try {
    const actual = crypto.scryptSync(value, h.salt, h.key.length, scryptOpts(h.N));
    return crypto.timingSafeEqual(actual, h.key);
  } catch (e) {
    return false;
  }
}

/** L'empreinte date-t-elle d'un coût inférieur à l'actuel (ancien format compris) ? */
function needsRehash(stored) {
  const h = parseHash(stored);
  return !h || h.N < SCRYPT_N;
}

// Secret HMAC des sessions (staff ET client). SESSION_SECRET s'il existe ; sinon dérivé
// des codes ET du jeton de la base (AIRTABLE_TOKEN / DATABASE_URL), que le personnel
// ne connaît pas : un cookie staff ne permet donc plus de deviner ADMIN_CODE hors ligne.
// Sans SESSION_SECRET le repli reste en place (sinon la production déconnecterait tout le
// monde d'un coup), mais on le signale une fois par instance : Systeemstatus l'affiche aussi
// (hasSessionSecret), et un secret dédié ne change pas quand un code ou la base change.
let _warned = false;
function secret() {
  if (!_warned && !String(process.env.SESSION_SECRET || "").trim()) {
    _warned = true;
    console.warn("[staffauth] SESSION_SECRET ontbreekt : sessiesleutel afgeleid van de codes en de databasesleutel. Stel SESSION_SECRET in (32+ willekeurige tekens).");
  }
  const extra = String(process.env.SESSION_SECRET || "").trim() ||
    String(process.env.AIRTABLE_TOKEN || "") + ":" + String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "");
  return crypto.createHash("sha256").update("famo-session-v3:" + extra + ":" + STAFF_CODE + ":" + ADMIN_CODE).digest();
}

// Signature HMAC réutilisable (jeton client, lib/clientauth.js).
function hmac(payload) {
  return crypto.createHmac("sha256", secret()).update(String(payload)).digest("base64url");
}

// Jeton : exp.role.naam.gen.sig — naam en base64url (vide pour un code partagé) ; gen =
// « G » (génération globale) ou « G~<id Medewerker>~<empreinte PIN> ». Les anciens jetons
// (3 ou 4 segments, sans génération) sont refusés : une seule reconnexion au déploiement.
const REC = /^[A-Za-z0-9]{1,40}$/;
function genString(gen) {
  const g = gen || {};
  const G = Math.max(0, Math.floor(Number(g.g) || 0));
  return g.med && REC.test(String(g.med)) ? G + "~" + g.med + "~" + String(g.pfp || "") : String(G);
}
function sign(expMs, role, name, gen) {
  const n = name ? Buffer.from(String(name)).toString("base64url") : "";
  const p = [String(expMs), role, n, genString(gen)].join(".");
  const h = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  return p + "." + h;
}

function verify(tok) {
  if (!tok) return null;
  const parts = String(tok).split(".");
  if (parts.length !== 5) return null;
  const [expStr, role, n, genStr, sig] = parts;
  if (role !== "staff" && role !== "admin") return null;
  let good;
  try {
    good = crypto.createHmac("sha256", secret()).update(parts.slice(0, 4).join(".")).digest("base64url");
  } catch (e) {
    return null;
  }
  const a = Buffer.from(sig || "");
  const b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!(Number(expStr) > Date.now())) return null;
  const m = /^(\d{1,12})(?:~([A-Za-z0-9]{1,40})~([A-Za-z0-9_-]{0,20}))?$/.exec(genStr);
  if (!m) return null;
  let name = "";
  if (n) { try { name = Buffer.from(n, "base64url").toString("utf8").slice(0, 60); } catch (e) { name = ""; } }
  return { role, exp: Number(expStr), name, gen: { g: Number(m[1]), med: m[2] || "", pfp: m[3] || "" } };
}

function cookieFrom(req) {
  const c = (req.headers && req.headers.cookie) || "";
  const m = /(?:^|;\s*)famo_sess=([^;]+)/.exec(c);
  return m ? decodeURIComponent(m[1]) : null;
}

function session(req) {
  return verify(cookieFrom(req));
}

// ---- Révocation : ce que l'instance sait (cache 60 s) ---------------------------------
const CHECK_TTL_MS = 60000;
const _gen = { value: null, at: 0 };   // génération globale, null = inconnue
const _med = new Map();                // id Medewerker -> { gone, actief, admin, pfp, at }

/** Empreinte courte du PIN haché : change avec le PIN, ne révèle rien du PIN. */
function pinFingerprint(pinHash) {
  return crypto.createHash("sha256").update("famo-pin-fp:" + String(pinHash || "")).digest("base64url").slice(0, 12);
}
function noteGeneration(value) { _gen.value = Math.max(0, Number(value) || 0); _gen.at = Date.now(); }
function noteMedewerker(id, fields) {
  if (!REC.test(String(id || ""))) return;
  if (_med.size > 500) _med.clear(); // borne mémoire
  const f = fields || null;
  _med.set(id, f ? { gone: false, actief: !!f["Actief"], admin: f["Rol"] === "beheerder", pfp: pinFingerprint(f["PIN hash"]), at: Date.now() } : { gone: true, at: Date.now() });
}
// Révoqué d'après le cache (quel que soit son âge) : aucune lecture, donc synchrone.
function revoked(s) {
  if (_gen.value !== null && s.gen.g < _gen.value) return true;
  if (!s.gen.med) return false;
  const m = _med.get(s.gen.med);
  if (!m) return false;
  return m.gone || !m.actief || m.pfp !== s.gen.pfp || (s.role === "admin" && !m.admin);
}
// Lectures en échec (réseau, 5xx) : on garde ce qu'on sait et on réessaie dans 60 s — une
// panne de base ne doit pas déconnecter tout le personnel. Un Medewerker introuvable
// (supprimé), lui, révoque.
async function refreshGeneration() {
  try {
    const { at } = require("./airtable");
    const j = await at(encodeURIComponent("Configuratie") + "?maxRecords=1&fields%5B%5D=Sessiegeneratie");
    if (j && !j.error) { noteGeneration((((j.records || [])[0] || {}).fields || {})["Sessiegeneratie"]); return; }
  } catch (e) { /* inconnue : repli ci-dessous */ }
  _gen.at = Date.now();
}
async function refreshMedewerker(id) {
  try {
    const { at } = require("./airtable");
    const j = await at("Medewerkers/" + id);
    const type = j && j.error ? String(typeof j.error === "string" ? j.error : j.error.type || "") : "";
    if (j && !j.error && j.fields) return noteMedewerker(id, j.fields);
    if (/NOT_FOUND/.test(type)) return noteMedewerker(id, null);
  } catch (e) { /* inconnu : repli ci-dessous */ }
  const m = _med.get(id);
  if (m) m.at = Date.now();
}

/** Session vérifiée contre la base (cache 60 s) : null si absente, expirée ou révoquée. */
async function staffSession(req) {
  if (!STAFF_CODE && !ADMIN_CODE) return null;
  const s = session(req);
  if (!s) return null;
  const now = Date.now();
  if (now - _gen.at > CHECK_TTL_MS) await refreshGeneration();
  if (s.gen.med && !(now - ((_med.get(s.gen.med) || {}).at || 0) <= CHECK_TTL_MS)) await refreshMedewerker(s.gen.med);
  return revoked(s) ? null : s;
}
async function adminSession(req) {
  if (!ADMIN_CODE) return null;
  const s = await staffSession(req);
  return s && s.role === "admin" ? s : null;
}

function matchesCode(provided, code) {
  if (!code || provided == null || provided === "") return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(code));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Quel rôle ce code ouvre-t-il ? null = refusé.
 * `stored` est optionnel : {adminHash, staffHash} lus dans Airtable. Pour un rôle
 * donné, le code enregistré remplace celui de l'environnement dès qu'il existe.
 * `want` : rôle demandé par la page de connexion ("admin" depuis Beheer, sinon "staff").
 * Il ne sert QUE si le code est valable pour les deux rôles (codes identiques) : le
 * serveur ne peut alors pas savoir qui le tape, le rôle suit donc la page — et vaut
 * "staff" par défaut, jamais "admin". Avec deux codes distincts, il est ignoré.
 */
function roleForCode(provided, stored, want) {
  const s = stored || {};
  // Dès qu'un code est enregistré pour un rôle, il REMPLACE celui de
  // l'environnement : sans ça, changer un code ne servirait à rien puisque
  // l'ancien continuerait d'ouvrir la porte.
  const opensAdmin = s.adminHash ? verifyHash(s.adminHash, provided) : matchesCode(provided, ADMIN_CODE);
  if (opensAdmin) {
    const opensStaff = s.staffHash ? verifyHash(s.staffHash, provided) : matchesCode(provided, STAFF_CODE);
    return opensStaff && want !== "admin" ? "staff" : "admin";
  }
  if (s.staffHash) {
    if (verifyHash(s.staffHash, provided)) return "staff";
  } else if (matchesCode(provided, STAFF_CODE)) {
    return "staff";
  }
  return null;
}

/**
 * Accès de secours (audit L-06, specs/005-pin-personnels-seuls) : quand Beheer n'accepte plus que
 * les PIN personnels (Configuratie « Enkel persoonlijke PIN »), le code beheerder de
 * l'ENVIRONNEMENT reste une porte d'urgence, pour le rôle beheerder seulement (api/session.js
 * vérifie la page demandée et journalise). Uniquement s'il est le code beheerder effectif : un
 * code enregistré dans Beheer le remplace, comme dans roleForCode. Fail-closed : sans
 * ADMIN_CODE, jamais vrai.
 */
function breakGlass(provided, stored) {
  if (!ADMIN_CODE) return false;
  if ((stored || {}).adminHash) return false;
  return matchesCode(provided, ADMIN_CODE);
}

/** Any valid session (staff or admin) — never accept code from query/body on API handlers. */
function staffOk(req) {
  if (!STAFF_CODE && !ADMIN_CODE) return false;
  const s = session(req);
  return !!s && !revoked(s);
}

/** Admin-only session. False if ADMIN_CODE is not configured, even with a valid staff session. */
function adminOk(req) {
  if (!ADMIN_CODE) return false;
  const s = session(req);
  return !!s && s.role === "admin" && !revoked(s);
}

function roleOf(req) {
  const s = session(req);
  return s ? s.role : null;
}

/** Qui agit : le prénom du compte Medewerkers, sinon le rôle (« personeel » / « beheerder »). */
function actorOf(req) {
  const s = session(req);
  if (!s) return "";
  return s.name || (s.role === "admin" ? "beheerder" : "personeel");
}

// « Secure » toujours en production. Les navigateurs traitent http://localhost comme
// contexte sécurisé ; pour un test sur une IP du réseau local (http://192.168…),
// FAMO_DEV_HTTP=1 retire l'attribut. Jamais sur Vercel (la variable n'y existe pas).
const DEV_HTTP = process.env.FAMO_DEV_HTTP === "1" && !process.env.VERCEL;
function setCookie(res, tok, maxAgeSec) {
  res.setHeader(
    "Set-Cookie",
    "famo_sess=" + encodeURIComponent(tok) +
      "; HttpOnly;" + (DEV_HTTP ? "" : " Secure;") + " SameSite=Lax; Path=/; Max-Age=" + maxAgeSec
  );
}

function brusselsYear() {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric" }).format(new Date())
  );
}

module.exports = {
  sign,
  verify,
  staffOk,
  adminOk,
  staffSession,
  adminSession,
  pinFingerprint,
  noteGeneration,
  noteMedewerker,
  currentGeneration: () => _gen.value,
  roleOf,
  actorOf,
  roleForCode,
  breakGlass,
  hashCode,
  verifyHash,
  needsRehash,
  hmac,
  setCookie,
  TTL_MS,
  hasCode: () => !!(STAFF_CODE || ADMIN_CODE),
  hasAdminCode: () => !!ADMIN_CODE,
  hasSessionSecret: () => !!String(process.env.SESSION_SECRET || "").trim(),
  brusselsYear
};
