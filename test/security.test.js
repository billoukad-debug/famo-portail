// Constats de l'audit de sécurité : chaque test reproduit l'attaque décrite et vérifie
// qu'elle échoue. Base SQLite en mémoire (lib/at-engine.js) : les vraies fonctions api/*.js
// tournent sans réseau, comme en production sur Postgres.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = "team-sec-code";
process.env.ADMIN_CODE = "beheer-sec-code";
process.env.AIRTABLE_TOKEN = "test-token";
process.env.SESSION_SECRET = "sessie-geheim-voor-de-tests-0123456789";
delete process.env.RESEND_API_KEY;
delete process.env.PORTAL_URL;
delete process.env.VERCEL;
process.removeAllListeners("warning"); // node:sqlite est « expérimental » : bruit inutile

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));

function mkRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = () => res;
  return res;
}
async function callApi(name, req) {
  const handler = require(path.join(ROOT, "api", name + ".js"));
  const res = mkRes();
  await handler(Object.assign({ method: "GET", headers: {}, query: {}, body: null }, req), res);
  return res;
}
const cookieOf = (res) => { const m = /famo_sess=([^;]*)/.exec(res.headers["set-cookie"] || ""); return m ? "famo_sess=" + m[1] : ""; };
const store = () => ds.state.store;
async function put(tbl, fields) {
  const id = "rec" + Math.random().toString(36).slice(2, 10).padEnd(14, "x").slice(0, 14);
  await store().insert(tbl, [{ id, createdTime: new Date().toISOString(), fields }]);
  return id;
}
async function patch(tbl, id, fields) {
  const cur = await store().get(tbl, id);
  await store().update(tbl, id, Object.assign({}, cur.fields, fields), cur.version);
}
// Le temps avance (cache de révocation, échéances) sans attendre.
async function later(ms, fn) {
  const real = Date.now;
  Date.now = () => real() + ms;
  try { return await fn(); } finally { Date.now = real; }
}

let CFG = "";
test.before(async () => {
  CFG = await put("Configuratie", { "Bedrijfsnaam": "FAMO Seafood" });
});

// ---- A-15 : scrypt N=2^17, coût dans l'empreinte, ancien format toujours lu ----------------
test("A-15 : nouvelles empreintes scrypt$131072$…, ancien format lu et signalé à ré-hacher", () => {
  const t0 = Date.now();
  const h = auth.hashCode("EenSterkeCode2026");
  const ms = Date.now() - t0;
  assert.match(h, /^scrypt\$131072\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(ms < 1500, "hachage raisonnable (" + ms + " ms)");
  assert.equal(auth.verifyHash(h, "EenSterkeCode2026"), true);
  assert.equal(auth.verifyHash(h, "EenSterkeCode2027"), false);
  assert.equal(auth.needsRehash(h), false);
  // Ancien format (N=16384), tel qu'il existe en base.
  const crypto = require("crypto");
  const salt = crypto.randomBytes(16);
  const legacy = "scrypt$" + salt.toString("hex") + "$" + crypto.scryptSync("oud", salt, 32, { N: 16384 }).toString("hex");
  assert.equal(auth.verifyHash(legacy, "oud"), true, "ancien format encore accepté");
  assert.equal(auth.needsRehash(legacy), true, "ancien format à remplacer");
  assert.ok(ca.isHashed(h) && ca.isHashed(legacy));
  // Coût trafiqué en base : refusé sans calcul démesuré.
  assert.equal(auth.verifyHash(h.replace("$131072$", "$1073741824$"), "EenSterkeCode2026"), false);
  assert.equal(auth.verifyHash(h.replace("$131072$", "$100000$"), "EenSterkeCode2026"), false);
});

test("A-15 : un client à l'ancienne empreinte est ré-haché à la connexion", async () => {
  const crypto = require("crypto");
  const salt = crypto.randomBytes(16);
  const legacy = "scrypt$" + salt.toString("hex") + "$" + crypto.scryptSync("oud-wachtwoord", salt, 32, { N: 16384 }).toString("hex");
  const id = await put("Clients", { "Nom": "Oud", "Gebruikersnaam": "oudklant", "Wachtwoord": legacy });
  const r = await callApi("catalogue", { method: "POST", body: { user: "oudklant", pw: "oud-wachtwoord" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const now = (await store().get("Clients", id)).fields["Wachtwoord"];
  assert.match(now, /^scrypt\$131072\$/);
  assert.ok(ca.checkPassword(now, "oud-wachtwoord"));
});

// ---- A-14 : SESSION_SECRET signalé ------------------------------------------------------------
test("A-14 : hasSessionSecret reflète la variable", () => {
  assert.equal(auth.hasSessionSecret(), true);
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try { assert.equal(auth.hasSessionSecret(), false); } finally { process.env.SESSION_SECRET = saved; }
});

// ---- A-01 : sessions staff révocables ---------------------------------------------------------
test("A-01 : Medewerker désactivé ailleurs → GET /api/session 401 en ≤ 60 s", async () => {
  const id = await put("Medewerkers", { "Naam": "Sam", "Rol": "personeel", "PIN hash": auth.hashCode("135790"), "Actief": true });
  const login = await callApi("session", { method: "POST", body: { code: "135790" } });
  assert.equal(login.statusCode, 200, JSON.stringify(login.body));
  const cookie = cookieOf(login);
  assert.equal((await callApi("session", { headers: { cookie } })).statusCode, 200);
  // Désactivation écrite par une autre instance (directement en base) : le cache local ne le sait pas.
  await patch("Medewerkers", id, { "Actief": false });
  assert.equal((await callApi("session", { headers: { cookie } })).statusCode, 200, "cache encore frais");
  const after = await later(61000, () => callApi("session", { headers: { cookie } }));
  assert.equal(after.statusCode, 401, "après 60 s la base est relue : session révoquée");
  // staffOk (synchrone) profite de ce que l'instance a appris.
  assert.equal(auth.staffOk({ headers: { cookie } }), false);
});

test("A-01 : Medewerker supprimé, PIN changé ou rôle retiré → session révoquée", async () => {
  const admin = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin", "", { g: 0 }));
  const mk = async (naam, pin, rol) => {
    const id = await put("Medewerkers", { "Naam": naam, "Rol": rol || "personeel", "PIN hash": auth.hashCode(pin), "Actief": true });
    const r = await callApi("session", { method: "POST", body: { code: pin, want: "admin" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    return { id, cookie: cookieOf(r) };
  };
  const a = await mk("Ann", "246801");
  const del = await callApi("onboarding", { method: "POST", headers: { cookie: admin }, body: { action: "deleteMedewerker", id: a.id } });
  assert.equal(del.statusCode, 200, JSON.stringify(del.body));
  assert.equal((await callApi("session", { headers: { cookie: a.cookie } })).statusCode, 401, "supprimé → 401 immédiatement sur cette instance");

  const b = await mk("Bob", "975310");
  await patch("Medewerkers", b.id, { "PIN hash": auth.hashCode("975311") });
  assert.equal((await later(61000, () => callApi("session", { headers: { cookie: b.cookie } }))).statusCode, 401, "PIN changé → 401");

  const c = await mk("Cas", "864209", "beheerder");
  assert.equal((await callApi("session", { headers: { cookie: c.cookie } })).body.role, "admin");
  await patch("Medewerkers", c.id, { "Rol": "personeel" });
  assert.equal((await later(61000, () => callApi("session", { headers: { cookie: c.cookie } }))).statusCode, 401, "plus beheerder → la session admin tombe");
});

test("A-01 : « iedereen afmelden » et changement de code révoquent toutes les sessions", async () => {
  const staff = cookieOf(await callApi("session", { method: "POST", body: { code: "team-sec-code" } }));
  const adminLogin = await callApi("session", { method: "POST", body: { code: "beheer-sec-code", want: "admin" } });
  const admin = cookieOf(adminLogin);
  assert.equal((await callApi("session", { headers: { cookie: staff } })).statusCode, 200);
  // Personeel ne peut pas déconnecter tout le monde.
  assert.equal((await callApi("session", { method: "DELETE", query: { all: "1" }, headers: { cookie: staff } })).statusCode, 401);
  const out = await callApi("session", { method: "DELETE", query: { all: "1" }, headers: { cookie: admin } });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal((await store().get("Configuratie", CFG)).fields["Sessiegeneratie"], 1);
  assert.equal((await callApi("session", { headers: { cookie: staff } })).statusCode, 401, "staff déconnecté");
  assert.equal((await callApi("session", { headers: { cookie: admin } })).statusCode, 401, "admin aussi");
  // Autre instance : elle relit la génération au plus tard après 60 s.
  auth.noteGeneration(0);
  assert.equal((await later(61000, () => callApi("session", { headers: { cookie: staff } }))).statusCode, 401);

  // Changement de code : les autres tombent, le beheerder qui change reçoit un cookie neuf.
  const staff2 = cookieOf(await callApi("session", { method: "POST", body: { code: "team-sec-code" } }));
  const admin2 = cookieOf(await callApi("session", { method: "POST", body: { code: "beheer-sec-code", want: "admin" } }));
  const saved = await callApi("onboarding", { method: "POST", headers: { cookie: admin2 }, body: { action: "saveCode", which: "staff", code: "NieuweTeamCode77" } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal((await callApi("session", { headers: { cookie: staff2 } })).statusCode, 401, "ancien cookie staff révoqué");
  assert.equal((await callApi("session", { headers: { cookie: admin2 } })).statusCode, 401, "ancien cookie admin révoqué");
  const fresh = cookieOf(saved);
  assert.ok(fresh, "cookie renouvelé pour le beheerder");
  assert.equal((await callApi("session", { headers: { cookie: fresh } })).statusCode, 200);
  // Remise en état pour les tests suivants.
  await patch("Configuratie", CFG, { "Personeelscode hash": "" });
});

test("A-01 : anciens jetons sans génération refusés ; base injoignable → pas de déconnexion", async () => {
  const crypto = require("crypto");
  // Jeton à l'ancien format exp.role.sig, correctement signé : refusé.
  const p = (Date.now() + 3600000) + ".admin";
  const legacyKey = crypto.createHash("sha256").update("famo-session-v3:" + process.env.SESSION_SECRET + ":" + process.env.STAFF_CODE + ":" + process.env.ADMIN_CODE).digest();
  const legacy = p + "." + crypto.createHmac("sha256", legacyKey).update(p).digest("base64url");
  assert.equal(auth.verify(legacy), null);
  // Panne de base pendant la relecture : la session reste ouverte (fail-open documenté).
  const cookie = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "staff", "", { g: auth.currentGeneration() || 0 }));
  const saved = global.fetch;
  global.fetch = async () => { throw new Error("database down"); };
  try {
    const r = await later(120000, () => callApi("session", { headers: { cookie } }));
    assert.equal(r.statusCode, 200);
  } finally { global.fetch = saved; }
});

// ---- A-02 / A-07 / A-03 : force brute client ---------------------------------------------------
test("A-02 : 20 authClient parallèles au mauvais mot de passe → au plus 5 vérifications", async () => {
  await put("Clients", { "Nom": "Para", "Gebruikersnaam": "parallel", "Wachtwoord": ca.hashPassword("juist-wachtwoord") });
  const { authClient } = require(path.join(ROOT, "api", "catalogue.js"));
  const real = ca.checkPassword;
  let checks = 0;
  ca.checkPassword = (...a) => { checks++; return real(...a); };
  try {
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => authClient("parallel", "fout-" + i)));
    assert.ok(out.every((r) => r === null));
    assert.ok(checks <= 5, "vérifications réelles : " + checks);
    // Le bon mot de passe est lui aussi refusé tant que la fenêtre court.
    assert.equal(await authClient("parallel", "juist-wachtwoord"), null);
  } finally { ca.checkPassword = real; }
});

test("A-07 : seuls les échecs comptent (par IP et par identifiant)", async () => {
  await put("Clients", { "Nom": "Tel", "Gebruikersnaam": "teller", "Wachtwoord": ca.hashPassword("goed-wachtwoord") });
  const hdr = { "x-forwarded-for": "198.51.100.7" };
  const login = (user, pw) => callApi("catalogue", { method: "POST", headers: hdr, body: { user, pw } });
  for (let i = 0; i < 29; i++) assert.equal((await login("onbekend" + i, "x")).statusCode, 401, "échec " + (i + 1));
  assert.equal((await login("teller", "goed-wachtwoord")).statusCode, 200, "succès : ne compte pas");
  assert.equal((await login("teller", "goed-wachtwoord")).statusCode, 200, "succès : ne compte pas");
  assert.equal((await login("onbekend-30", "x")).statusCode, 401, "30e échec encore traité");
  assert.equal((await login("onbekend-31", "x")).statusCode, 429, "31e : limite IP (30 échecs / 5 min)");
});

test("A-03 : verrou client persistant (10 échecs, toutes instances) puis levée après 15 min", async () => {
  const id = await put("Clients", { "Nom": "Slot", "Gebruikersnaam": "slot", "Wachtwoord": ca.hashPassword("goed-wachtwoord") });
  const { authClient } = require(path.join(ROOT, "api", "catalogue.js"));
  // 10 échecs espacés de 31 s : le compteur mémoire (5 / 30 s) ne bloque jamais, comme si
  // chaque essai tombait sur une autre instance ; seul le compteur en base les voit.
  for (let i = 0; i < 10; i++) await later(31000 * (i + 1), () => authClient("slot", "fout-" + i));
  const f = (await store().get("Clients", id)).fields;
  assert.ok(Date.parse(f["Geblokkeerd tot"]) > Date.now() + 14 * 60000, "compte bloqué ~15 min");
  assert.equal(await later(400000, () => authClient("slot", "goed-wachtwoord")), null, "bloqué : même le bon mot de passe est refusé");
  const ok = await later(310000 + 16 * 60000, () => authClient("slot", "goed-wachtwoord")); // 10e échec à +310 s
  assert.ok(ok && ok.id === id, "après 15 min le bon mot de passe repasse");
  const g = (await store().get("Clients", id)).fields;
  assert.equal(g["Echecs"], 0); assert.equal(g["Geblokkeerd tot"], undefined, "verrou effacé au succès");
});

test("A-03 : verrou global des PIN (20 échecs) ; les codes partagés restent utilisables", async () => {
  const pin = "551177";
  await put("Medewerkers", { "Naam": "Lies", "Rol": "personeel", "PIN hash": auth.hashCode(pin), "Actief": true });
  for (let i = 0; i < 20; i++) {
    const r = await callApi("session", { method: "POST", headers: { "x-forwarded-for": "203.0.113." + i }, body: { code: "12" } });
    assert.equal(r.statusCode, 401);
  }
  const cfg = (await store().get("Configuratie", CFG)).fields;
  assert.ok(Date.parse(cfg["PIN geblokkeerd tot"]) > Date.now(), "connexion par PIN suspendue");
  assert.equal((await callApi("session", { method: "POST", headers: { "x-forwarded-for": "203.0.113.99" }, body: { code: pin } })).statusCode, 401, "même le bon PIN");
  assert.equal((await callApi("session", { method: "POST", headers: { "x-forwarded-for": "203.0.113.99" }, body: { code: "team-sec-code" } })).statusCode, 200, "code d'équipe OK");
  await patch("Configuratie", CFG, { "PIN geblokkeerd tot": "" });
  assert.equal((await callApi("session", { method: "POST", headers: { "x-forwarded-for": "203.0.113.98" }, body: { code: pin } })).statusCode, 200, "verrou levé : le PIN rouvre");
});

test("A-03 / A-09 : nouveau PIN 6-12 chiffres et unique", async () => {
  const admin = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin", "", { g: auth.currentGeneration() || 0 }));
  const save = (body) => callApi("onboarding", { method: "POST", headers: { cookie: admin }, body: Object.assign({ action: "saveMedewerker" }, body) });
  assert.equal((await save({ naam: "Kort", pin: "1234" })).statusCode, 400);
  assert.equal((await save({ naam: "Letters", pin: "12ab56" })).statusCode, 400);
  const first = await save({ naam: "Eerste", pin: "908172" });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const dup = await save({ naam: "Tweede", pin: "908172" });
  assert.equal(dup.statusCode, 409, "PIN déjà utilisé");
  const own = first.body.medewerkers.find((m) => m.naam === "Eerste");
  assert.equal((await save({ id: own.id, naam: "Eerste", pin: "908172" })).statusCode, 200, "son propre PIN n'est pas un doublon");
});
