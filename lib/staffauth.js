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
// Les variables STAFF_CODE / ADMIN_CODE restent OBLIGATOIRES : elles sèment le
// secret HMAC des cookies. Sans elles ce secret serait devinable et n'importe qui
// pourrait forger une session — d'où le fail-closed de staffOk/adminOk.
//
// IMPORTANT : staffOk(req) reste SYNCHRONE. Il ne vérifie que la signature du
// cookie, jamais la base. Seule la connexion (POST /api/session) consulte Airtable.
// C'est ce qui évite de rendre asynchrones les gardes de tous les endpoints.
// Le secret HMAC dérive des variables d'environnement (stables), pas des codes
// stockés : changer un code depuis Beheer n'invalide donc pas les sessions en cours.
const crypto = require("crypto");
const STAFF_CODE = String(process.env.STAFF_CODE || "").trim();
const ADMIN_CODE = String(process.env.ADMIN_CODE || "").trim();
const TTL_MS = 8 * 3600 * 1000;
const SCRYPT_N = 16384;

/** Hache un code pour stockage. Format : scrypt$<sel hex>$<empreinte hex>. */
function hashCode(code) {
  const value = String(code || "");
  if (!value) return "";
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(value, salt, 32, { N: SCRYPT_N });
  return "scrypt$" + salt.toString("hex") + "$" + key.toString("hex");
}

/** Vérifie un code contre une empreinte stockée. Comparaison à temps constant. */
function verifyHash(stored, provided) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const value = String(provided || "");
  if (!value) return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = crypto.scryptSync(value, salt, expected.length, { N: SCRYPT_N });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

function secret() {
  return crypto.createHash("sha256").update("famo-session-v2:" + STAFF_CODE + ":" + ADMIN_CODE).digest();
}

function sign(expMs, role) {
  const p = String(expMs) + "." + role;
  const h = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  return p + "." + h;
}

function verify(tok) {
  if (!tok) return null;
  const parts = String(tok).split(".");
  if (parts.length !== 3) return null;
  const [expStr, role, sig] = parts;
  if (role !== "staff" && role !== "admin") return null;
  let good;
  try {
    good = crypto.createHmac("sha256", secret()).update(expStr + "." + role).digest("base64url");
  } catch (e) {
    return null;
  }
  const a = Buffer.from(sig || "");
  const b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!(Number(expStr) > Date.now())) return null;
  return { role, exp: Number(expStr) };
}

function cookieFrom(req) {
  const c = (req.headers && req.headers.cookie) || "";
  const m = /(?:^|;\s*)famo_sess=([^;]+)/.exec(c);
  return m ? decodeURIComponent(m[1]) : null;
}

function session(req) {
  return verify(cookieFrom(req));
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
 * Quel rôle ce code ouvre-t-il ? null = refusé. L'admin est testé en premier.
 * `stored` est optionnel : {adminHash, staffHash} lus dans Airtable. Pour un rôle
 * donné, le code enregistré remplace celui de l'environnement dès qu'il existe.
 */
function roleForCode(provided, stored) {
  const s = stored || {};
  // Dès qu'un code est enregistré pour un rôle, il REMPLACE celui de
  // l'environnement : sans ça, changer un code ne servirait à rien puisque
  // l'ancien continuerait d'ouvrir la porte.
  if (s.adminHash) {
    if (verifyHash(s.adminHash, provided)) return "admin";
  } else if (matchesCode(provided, ADMIN_CODE)) {
    return "admin";
  }
  if (s.staffHash) {
    if (verifyHash(s.staffHash, provided)) return "staff";
  } else if (matchesCode(provided, STAFF_CODE)) {
    return "staff";
  }
  return null;
}

/** Any valid session (staff or admin) — never accept code from query/body on API handlers. */
function staffOk(req) {
  if (!STAFF_CODE && !ADMIN_CODE) return false;
  return !!session(req);
}

/** Admin-only session. False if ADMIN_CODE is not configured, even with a valid staff session. */
function adminOk(req) {
  if (!ADMIN_CODE) return false;
  const s = session(req);
  return !!s && s.role === "admin";
}

function roleOf(req) {
  const s = session(req);
  return s ? s.role : null;
}

function setCookie(res, tok, maxAgeSec) {
  res.setHeader(
    "Set-Cookie",
    "famo_sess=" + encodeURIComponent(tok) +
      "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + maxAgeSec
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
  roleOf,
  roleForCode,
  hashCode,
  verifyHash,
  setCookie,
  TTL_MS,
  hasCode: () => !!(STAFF_CODE || ADMIN_CODE),
  hasAdminCode: () => !!ADMIN_CODE,
  brusselsYear
};
