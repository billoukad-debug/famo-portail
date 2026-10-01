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
// Session client : jeton dans le cookie HttpOnly famo_klant (spec 013), plus dans le corps.
const klantTok = (res) => { const m = /famo_klant=([^;]*)/.exec([].concat(res.headers["set-cookie"] || []).join("\n")); return m ? decodeURIComponent(m[1]) : ""; };
const klantJar = (tok) => ({ cookie: "famo_klant=" + encodeURIComponent(tok) });
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
  assert.equal((await callApi("allorders", { method: "GET", headers: { cookie: staff } })).statusCode, 200, "témoin : allorders lisible avant révocation");
  assert.equal((await callApi("journaal", { method: "GET", headers: { cookie: admin } })).statusCode, 200, "témoin : journaal lisible avant révocation");
  // Personeel ne peut pas déconnecter tout le monde.
  assert.equal((await callApi("session", { method: "DELETE", query: { all: "1" }, headers: { cookie: staff } })).statusCode, 401);
  const out = await callApi("session", { method: "DELETE", query: { all: "1" }, headers: { cookie: admin } });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal((await store().get("Configuratie", CFG)).fields["Sessiegeneratie"], 1);
  assert.equal((await callApi("session", { headers: { cookie: staff } })).statusCode, 401, "staff déconnecté");
  assert.equal((await callApi("session", { headers: { cookie: admin } })).statusCode, 401, "admin aussi");
  // Toutes les API de travail, pas seulement /api/session (fin d'A-01) : un cookie révoqué ne lit plus rien.
  for (const [name, cookie] of [["allorders", staff], ["stock", staff], ["lots", staff], ["staff", staff], ["journaal", admin], ["dbadmin", admin]]) {
    const r = await callApi(name, { method: "GET", headers: { cookie } });
    assert.ok(r.statusCode === 401 || r.statusCode === 403, name + " : session révoquée refusée (" + r.statusCode + ")");
  }
  const cfg = await callApi("config", { method: "GET", headers: { cookie: admin } });
  assert.ok(!(cfg.body && cfg.body.config && cfg.body.config.iban !== undefined && cfg.body.status), "config : pas de vue beheerder avec un cookie révoqué");
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
  const locked = await callApi("session", { method: "POST", headers: { "x-forwarded-for": "203.0.113.99" }, body: { code: pin } });
  assert.equal(locked.statusCode, 429, "même le bon PIN"); assert.match(locked.body.error, /teamcode/);
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

// ---- A-08 : jeton client borné à 7 jours, révoqué à la déconnexion -----------------------------
test("A-08 : renouvellement sans fin impossible (7 jours après la connexion)", async () => {
  await put("Clients", { "Nom": "Duur", "Gebruikersnaam": "duur", "Wachtwoord": ca.hashPassword("goed-wachtwoord") });
  const login = await callApi("catalogue", { method: "POST", body: { user: "duur", pw: "goed-wachtwoord" } });
  assert.equal(login.statusCode, 200);
  let tok = klantTok(login);
  const iat = ca.readToken(tok).iat;
  // Le client rouvre le catalogue toutes les 11 h (jeton de 12 h) : renouvelé, l'iat reste celui de la connexion.
  let h = 11;
  for (; h < 7 * 24 - 11; h += 11) {
    const r = await later(h * 3600000, () => callApi("catalogue", { method: "POST", headers: klantJar(tok), body: {} }));
    assert.equal(r.statusCode, 200, "heure " + h);
    tok = klantTok(r);
  }
  const parts = tok.split(".");
  assert.equal(Number(parts[4]), iat, "iat conservé");
  assert.ok(Number(parts[2]) <= iat + ca.MAX_AGE_MS, "échéance jamais au-delà de 7 jours");
  const r7 = await later(7 * 86400000 + 60000, () => callApi("catalogue", { method: "POST", headers: klantJar(tok), body: {} }));
  assert.equal(r7.statusCode, 401, "après 7 jours : nouvelle connexion obligatoire");
  assert.equal(r7.body.expired, true);
});

test("A-08 : déconnexion serveur → les jetons du client sur tous ses appareils tombent", async () => {
  const id = await put("Clients", { "Nom": "Uit", "Gebruikersnaam": "uitlog", "Wachtwoord": ca.hashPassword("goed-wachtwoord") });
  const tablet = klantTok(await callApi("catalogue", { method: "POST", body: { user: "uitlog", pw: "goed-wachtwoord" } }));
  const phone = klantTok(await callApi("catalogue", { method: "POST", body: { user: "uitlog", pw: "goed-wachtwoord" } }));
  assert.equal((await callApi("catalogue", { method: "POST", headers: klantJar(phone), body: {} })).statusCode, 200);
  const out = await callApi("klantwachtwoord", { method: "POST", headers: klantJar(tablet), body: { action: "logout" } });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal((await store().get("Clients", id)).fields["Sessiegeneratie"], 1);
  assert.equal((await callApi("catalogue", { method: "POST", headers: klantJar(tablet), body: {} })).statusCode, 401);
  assert.equal((await callApi("catalogue", { method: "POST", headers: klantJar(phone), body: {} })).statusCode, 401, "l'autre appareil aussi");
  assert.equal((await callApi("klantwachtwoord", { method: "POST", headers: klantJar(tablet), body: { action: "logout" } })).statusCode, 200, "déconnexion répétée : neutre");
  const again = await callApi("catalogue", { method: "POST", body: { user: "uitlog", pw: "goed-wachtwoord" } });
  assert.equal(again.statusCode, 200);
  assert.equal(ca.readToken(klantTok(again)).gen, 1, "nouvelle connexion à la nouvelle génération");
  assert.equal((await callApi("catalogue", { method: "POST", headers: klantJar(klantTok(again)), body: {} })).statusCode, 200);
});

// ---- A-05 / A-06 : lien de réinitialisation au lieu d'un mot de passe en clair ------------------
// E-mails activés, Resend simulé : on lit ce qui serait parti.
function withMail() {
  const sent = [];
  const mods = ["lib/mail.js", "lib/ordermail.js", "lib/authmail.js", "api/klantorder.js", "api/onboarding.js", ...["common", "config", "producten", "klanten", "klantgebruikers", "toegang", "prijzen"].map((m) => "lib/beheer/" + m + ".js")]; // actions Beheer découpées (I-10) : rechargées avec lib/mail
  const clear = () => mods.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  const prevFetch = global.fetch;
  process.env.RESEND_API_KEY = "re_test_security";
  process.env.PORTAL_URL = "https://portaal.famo.test";
  clear();
  global.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.resend.com/")) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200 }); }
    return prevFetch(url, init);
  };
  return { sent, done() { global.fetch = prevFetch; delete process.env.RESEND_API_KEY; delete process.env.PORTAL_URL; clear(); } };
}
const linkIn = (m) => decodeURIComponent((/\/wachtwoord\.html\?t=([^\s"]+)/.exec(m.text) || [])[1] || "");

test("A-05 : reset → lien à usage unique, l'ancien mot de passe vaut jusqu'au choix du nouveau", async () => {
  const mail = withMail();
  try {
    await put("Clients", { "Nom": "Reset BV", "Gebruikersnaam": "reset1", "Email": "chef@reset.test", "Wachtwoord": ca.hashPassword("oud-wachtwoord"), "Taal": "FR" });
    const r = await callApi("klantorder", { method: "POST", body: { action: "reset", user: "reset1", email: "chef@reset.test" } });
    assert.equal(r.statusCode, 200); assert.match(r.body.message, /link/);
    assert.equal(mail.sent.length, 1);
    const m = mail.sent[0];
    assert.deepEqual(m.to, ["chef@reset.test"]);
    assert.match(m.subject, /mot de passe/, "client FR : e-mail en français");
    const token = linkIn(m);
    assert.match(token, /^r\./, "lien wachtwoord.html?t=…");
    assert.ok(m.text.includes("https://portaal.famo.test/wachtwoord.html?t="), "lien absolu vers PORTAL_URL");
    assert.ok(!m.text.includes("oud-wachtwoord") && !/scrypt\$/.test(m.html), "aucun mot de passe dans l'e-mail");
    // Rien n'a changé tant que le client n'a pas choisi : l'ancien mot de passe ouvre toujours.
    assert.equal((await callApi("catalogue", { method: "POST", body: { user: "reset1", pw: "oud-wachtwoord" } })).statusCode, 200);
    const set = (nieuw, t) => callApi("klantwachtwoord", { method: "POST", body: { action: "setPassword", token: t || token, nieuw } });
    assert.equal((await set("kort")).statusCode, 400, "8 caractères minimum");
    assert.equal((await set("nieuw-wachtwoord", token.slice(0, -2) + "xx")).statusCode, 400, "lien falsifié");
    const ok = await set("nieuw-wachtwoord");
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user, "reset1");
    assert.equal((await callApi("catalogue", { method: "POST", headers: klantJar(klantTok(ok)), body: {} })).statusCode, 200, "connecté dans la foulée");
    assert.equal((await callApi("catalogue", { method: "POST", body: { user: "reset1", pw: "nieuw-wachtwoord" } })).statusCode, 200);
    assert.equal((await callApi("catalogue", { method: "POST", body: { user: "reset1", pw: "oud-wachtwoord" } })).statusCode, 401, "ancien mot de passe remplacé");
    const again = await set("encore-un-autre");
    assert.equal(again.statusCode, 400, "lien déjà utilisé"); assert.equal(again.body.expired, true);
    // Lien expiré après 30 min.
    const r2 = await callApi("klantorder", { method: "POST", body: { action: "reset", user: "reset1", email: "chef@reset.test" } });
    assert.equal(r2.statusCode, 200);
    const late = await later(31 * 60000, () => set("te-laat-gekozen", linkIn(mail.sent[1])));
    assert.equal(late.statusCode, 400, "lien de plus de 30 min refusé");
  } finally { mail.done(); }
});

test("A-06 : reset en temps constant, compte existant ou non", async () => {
  const mail = withMail();
  try {
    await put("Clients", { "Nom": "Tijd", "Gebruikersnaam": "tijd1", "Email": "chef@tijd.test", "Wachtwoord": ca.hashPassword("wat-dan-ook") });
    const time = async (user, email) => { const t0 = Date.now(); const r = await callApi("klantorder", { method: "POST", body: { action: "reset", user, email } }); assert.equal(r.statusCode, 200); return { ms: Date.now() - t0, body: r.body }; };
    const hit = await time("tijd1", "chef@tijd.test");
    const miss = await time("bestaat-niet", "chef@tijd.test");
    const wrong = await time("tijd1", "ander@tijd.test");
    assert.equal(mail.sent.length, 1, "un seul e-mail : le bon couple");
    assert.deepEqual(hit.body, miss.body); assert.deepEqual(hit.body, wrong.body);
    for (const x of [hit, miss, wrong]) assert.ok(x.ms >= 790, "durée plancher (" + x.ms + " ms)");
    assert.ok(Math.abs(hit.ms - miss.ms) < 150 && Math.abs(hit.ms - wrong.ms) < 150, "durées indiscernables : " + [hit.ms, miss.ms, wrong.ms].join(" / "));
  } finally { mail.done(); }
});

test("A-05 : e-mails de bienvenue et de reset Beheer = lien d'activation, jamais le mot de passe", async () => {
  const mail = withMail();
  try {
    const admin = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin", "", { g: auth.currentGeneration() || 0 }));
    const saved = await callApi("onboarding", { method: "POST", headers: { cookie: admin }, body: { action: "saveClient", nom: "Welkom BV", user: "welkom1", email: "chef@welkom.test", password: "Beheer-gekozen-1", generate: false } });
    assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.credentials.password, "Beheer-gekozen-1", "Beheer voit toujours le mot de passe (à dicter)");
    const w = mail.sent[0];
    assert.ok(w && !w.text.includes("Beheer-gekozen-1") && !w.html.includes("Beheer-gekozen-1"), "pas de mot de passe dans l'e-mail de bienvenue");
    assert.ok(w.text.includes("welkom1"), "l'identifiant y est");
    const act = await callApi("klantwachtwoord", { method: "POST", body: { action: "setPassword", token: linkIn(w), nieuw: "zelf-gekozen-1" } });
    assert.equal(act.statusCode, 200, "le lien d'activation fonctionne");
    assert.equal((await callApi("catalogue", { method: "POST", body: { user: "welkom1", pw: "zelf-gekozen-1" } })).statusCode, 200);

    const reset = await callApi("onboarding", { method: "POST", headers: { cookie: admin }, body: { action: "resetPassword", id: saved.body.credentials.id } });
    assert.equal(reset.statusCode, 200, JSON.stringify(reset.body));
    const pw = reset.body.credentials.password;
    const m = mail.sent[1];
    assert.ok(m && !m.text.includes(pw) && !m.html.includes(pw), "pas de mot de passe dans l'e-mail de reset Beheer");
    assert.ok(linkIn(m), "lien présent");
    assert.equal((await callApi("klantwachtwoord", { method: "POST", body: { action: "setPassword", token: linkIn(w), nieuw: "nog-eens-iets" } })).statusCode, 400, "l'ancien lien d'activation ne vaut plus");
  } finally { mail.done(); }
});

// ---- A-04 : mots de passe en clair hachés d'un coup depuis Beheer ------------------------------
test("A-04 : hashAllPasswords hache tout Wachtwoord en clair, compteur pour Systeemstatus", async () => {
  const admin = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin", "", { g: auth.currentGeneration() || 0 }));
  const staff = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "staff", "", { g: auth.currentGeneration() || 0 }));
  const a = await put("Clients", { "Nom": "Klaar A", "Gebruikersnaam": "klaar-a", "Wachtwoord": "klare-tekst-1" });
  const b = await put("Clients", { "Nom": "Klaar B", "Gebruikersnaam": "klaar-b", "Wachtwoord": "klare-tekst-2" });
  const act = (action, cookie) => callApi("onboarding", { method: "POST", headers: { cookie: cookie || admin }, body: { action } });
  assert.equal((await act("hashAllPasswords", staff)).statusCode, 401, "enkel beheerder");
  const before = await act("securityStatus");
  assert.equal(before.statusCode, 200, JSON.stringify(before.body));
  assert.ok(before.body.klareWachtwoorden >= 2);
  assert.equal(before.body.hasSessionSecret, true);
  let r = await act("hashAllPasswords");
  while (r.body.klareWachtwoorden > 0 && r.body.hashed > 0) r = await act("hashAllPasswords");
  assert.equal(r.statusCode, 200); assert.equal(r.body.klareWachtwoorden, 0);
  for (const [id, pw] of [[a, "klare-tekst-1"], [b, "klare-tekst-2"]]) {
    const stored = (await store().get("Clients", id)).fields["Wachtwoord"];
    assert.match(stored, /^scrypt\$131072\$/); assert.ok(ca.checkPassword(stored, pw), "le client garde son mot de passe");
  }
  assert.equal((await act("securityStatus")).body.klareWachtwoorden, 0);
});

// ---- A-10 : Origin + JSON sur les requêtes qui modifient ----------------------------------------
test("A-10 : garde Origin / Content-Type", async () => {
  const guard = require(path.join(ROOT, "lib", "guard.js"));
  const req = (headers, method) => ({ method: method || "POST", headers: Object.assign({ host: "portaal.famo.test" }, headers) });
  assert.equal(guard.sameOrigin(req({ origin: "https://portaal.famo.test" })), true);
  assert.equal(guard.sameOrigin(req({ origin: "https://evil.test" })), false);
  assert.equal(guard.sameOrigin(req({ origin: "https://portaal.famo.test.evil.test" })), false);
  assert.equal(guard.sameOrigin(req({ origin: "null" })), false, "Origin null (iframe sandbox, no-referrer)");
  assert.equal(guard.sameOrigin(req({ referer: "https://portaal.famo.test/beheer.html" })), true, "Referer à défaut d'Origin");
  assert.equal(guard.sameOrigin(req({ referer: "https://evil.test/x" })), false);
  assert.equal(guard.sameOrigin(req({ "content-type": "application/json" })), true, "sans Origin ni Referer : JSON accepté");
  assert.equal(guard.sameOrigin(req({ "content-type": "text/plain" })), false, "sans Origin ni Referer : formulaire refusé");
  assert.equal(guard.sameOrigin(req({ origin: "http://localhost:4401", host: "localhost:4401" })), true, "serveur de dev");
  assert.equal(guard.sameOrigin(req({ origin: "https://www.famoseafood.be", host: "famo-portail.vercel.app", "x-forwarded-host": "famo-portail.vercel.app" })), false);
  process.env.PORTAL_URL = "https://www.famoseafood.be";
  try { assert.equal(guard.sameOrigin(req({ origin: "https://www.famoseafood.be", host: "famo-portail.vercel.app" })), true, "PORTAL_URL accepté"); } finally { delete process.env.PORTAL_URL; }
  assert.equal(guard.requireJson(req({ "content-type": "application/json; charset=utf-8" })), true);
  for (const ct of ["application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "text/plain;charset=UTF-8"]) assert.equal(guard.requireJson(req({ "content-type": ct })), false, ct);
  // Sur les vrais handlers : refus AVANT toute lecture de la base.
  const evil = await callApi("session", { method: "POST", headers: { host: "portaal.famo.test", origin: "https://evil.test", "content-type": "application/json" }, body: { code: "team-sec-code" } });
  assert.equal(evil.statusCode, 403); assert.equal(evil.headers["set-cookie"], undefined);
  const form = await callApi("klantorder", { method: "POST", headers: { host: "portaal.famo.test", origin: "https://portaal.famo.test", "content-type": "application/x-www-form-urlencoded" }, body: { action: "reset" } });
  assert.equal(form.statusCode, 415);
  const good = await callApi("session", { method: "POST", headers: { host: "portaal.famo.test", origin: "https://portaal.famo.test", "content-type": "application/json" }, body: { code: "team-sec-code" } });
  assert.equal(good.statusCode, 200);
  const del = await callApi("session", { method: "DELETE", headers: { host: "portaal.famo.test", origin: "https://evil.test" } });
  assert.equal(del.statusCode, 403, "DELETE aussi");
  assert.equal((await callApi("session", { method: "GET", headers: { host: "portaal.famo.test", origin: "https://evil.test" } })).statusCode, 401, "GET non concerné");
  // Chaque handler qui accepte POST porte la garde en première ligne.
  const fs = require("fs");
  for (const f of fs.readdirSync(path.join(ROOT, "api")).filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(ROOT, "api", f), "utf8");
    if (!/method\s*(!==|===)\s*"POST"|method\s*===\s*"DELETE"/.test(src)) continue;
    assert.match(src, /module\.exports = async \(req, res\) => \{\n {2}if \(require\("\.\.\/lib\/guard"\)\.blocked\(req, res\)\) return;/, "garde absente de api/" + f);
  }
});

// ---- A-16 : pas de message brut de la base vers le navigateur ----------------------------------
test("A-16 : erreurs de la base remplacées par un message générique (détail dans les logs)", async () => {
  await put("Clients", { "Nom": "Fout", "Gebruikersnaam": "foutje", "Wachtwoord": ca.hashPassword("goed-wachtwoord") });
  const prev = global.fetch;
  const logs = [];
  const prevErr = console.error;
  console.error = (...a) => logs.push(a.join(" "));
  global.fetch = async (url, init) => {
    if (init && init.method === "PATCH" && /\/Clients\//.test(String(url)) && /Téléphone|Favorieten/.test(String(init.body))) return new Response(JSON.stringify({ error: { type: "INVALID_VALUE_FOR_COLUMN", message: "Field Téléphone of table tblGEHEIM cannot accept value" } }), { status: 422 });
    return prev(url, init);
  };
  try {
    for (const body of [{ action: "profile", tel: "03 1" }, { action: "favorites", favorieten: [] }]) {
      const r = await callApi("klantorder", { method: "POST", body: Object.assign({ user: "foutje", pw: "goed-wachtwoord" }, body) });
      assert.equal(r.statusCode, 500);
      assert.ok(!/tblGEHEIM|INVALID_VALUE/.test(JSON.stringify(r.body)), "rien de la base dans la réponse : " + JSON.stringify(r.body));
    }
    assert.ok(logs.some((l) => /tblGEHEIM/.test(l)), "le détail reste dans les logs");
  } finally { global.fetch = prev; console.error = prevErr; }
});

// ---- A-18 : les logs d'e-mail ne contiennent pas le nom du client -------------------------------
test("A-18 : log d'échec d'e-mail = type + référence, jamais le sujet", async () => {
  const mail = require(path.join(ROOT, "lib", "mail.js"));
  const subject = "Nieuwe bestelling CMD-2026-0042 — Resto Geheim — € 56,00";
  assert.equal(mail.logLabel({ idempotencyKey: "order:CMD-2026-0042:team" }, subject), "order CMD-2026-0042");
  assert.equal(mail.logLabel({ idempotencyKey: "welcome:jan.peeters:2026" }, "Uw toegang — Jan Peeters"), "welcome");
  assert.equal(mail.logLabel({ tag: "activatie" }, "x"), "activatie");
  // Envoi réel en échec : on lit ce qui part dans console.warn.
  process.env.RESEND_API_KEY = "re_test_log";
  delete require.cache[require.resolve(path.join(ROOT, "lib", "mail.js"))];
  const fresh = require(path.join(ROOT, "lib", "mail.js"));
  const prev = global.fetch, prevWarn = console.warn, logs = [];
  console.warn = (...a) => logs.push(a.join(" "));
  global.fetch = async () => new Response("domain not verified", { status: 422 });
  try {
    const r = await fresh.send({ to: "chef@resto.test", subject, text: "x", idempotencyKey: "order:CMD-2026-0042:team" });
    assert.equal(r.ok, false);
    global.fetch = async () => { throw new Error("offline"); };
    await fresh.send({ to: "chef@resto.test", subject, text: "x", idempotencyKey: "order:CMD-2026-0042:client" });
  } finally {
    global.fetch = prev; console.warn = prevWarn; delete process.env.RESEND_API_KEY;
    delete require.cache[require.resolve(path.join(ROOT, "lib", "mail.js"))];
  }
  assert.equal(logs.length, 2);
  for (const l of logs) { assert.ok(!/Resto Geheim|chef@resto/.test(l), l); assert.match(l, /CMD-2026-0042/); }
});

// ---- A-19 : lien du portail jamais construit depuis Host en production --------------------------
test("A-19 : portalUrl ignore Host sur Vercel", () => {
  const om = require(path.join(ROOT, "lib", "ordermail.js"));
  const req = { headers: { host: "evil.test", "x-forwarded-host": "evil.test" } };
  assert.equal(om.portalUrl(req), "https://evil.test", "local : Host (serveur de dev)");
  process.env.VERCEL = "1";
  try {
    assert.equal(om.portalUrl(req), "https://www.famoseafood.be");
    process.env.PORTAL_URL = "https://portaal.famo.test/";
    assert.equal(om.portalUrl(req), "https://portaal.famo.test");
  } finally { delete process.env.VERCEL; delete process.env.PORTAL_URL; }
});

// ---- A-21 : pot de miel sur la demande d'accès -------------------------------------------------
test("A-21 : champ pot de miel rempli → 200 neutre, rien d'écrit", async () => {
  const count = async () => (await store().list("Aanvragen")).length;
  const before = await count();
  const body = { bedrijfsnaam: "Bot BV", contactpersoon: "Bot", email: "bot@spam.test", telefoon: "000" };
  const bot = await callApi("signup", { method: "POST", headers: { "x-forwarded-for": "192.0.2.10" }, body: Object.assign({ bijkomend: "http://spam.test" }, body) });
  assert.equal(bot.statusCode, 200); assert.equal(bot.body.ok, true);
  assert.equal(await count(), before, "aucune demande enregistrée");
  const human = await callApi("signup", { method: "POST", headers: { "x-forwarded-for": "192.0.2.11" }, body: Object.assign({ bijkomend: "" }, body, { bedrijfsnaam: "Echt BV" }) });
  assert.equal(human.statusCode, 200);
  assert.equal(await count(), before + 1);
  const src = require("fs").readFileSync(path.join(ROOT, "assets", "pages", "aanvraag.js"), "utf8");
  assert.match(src, /id="bijkomend"[^>]*tabindex="-1"/, "champ présent, hors tabulation");
  assert.match(src, /bijkomend: v\("bijkomend"\)/, "envoyé avec la demande");
});

// ---- A-22 : upload photo = vraie image ---------------------------------------------------------
test("A-22 : upload photo refusé si les octets ne sont pas ceux du type annoncé", async () => {
  const admin = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin", "", { g: auth.currentGeneration() || 0 }));
  const prod = await put("Catalogue", { "Produit": "Fotovis", "Prix de base": 10, "Unité": "kg", "Actif": true });
  const up = (contentType, buf) => callApi("onboarding", { method: "POST", headers: { cookie: admin }, body: { action: "uploadFoto", id: prod, contentType, filename: "x", base64: buf.toString("base64") } });
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ffa6c1f10000000049454e44ae426082", "hex");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  const html = Buffer.from("<!doctype html><script>alert(1)</script>");
  assert.equal((await up("image/png", svg)).statusCode, 400, "SVG déguisé en PNG");
  assert.equal((await up("image/jpeg", html)).statusCode, 400, "HTML déguisé en JPEG");
  assert.equal((await up("image/jpeg", png)).statusCode, 400, "PNG annoncé JPEG");
  assert.equal((await up("image/gif", Buffer.from("GIF89a\x01\x00\x01\x00"))).statusCode, 400, "GIF : type non accepté");
  const ok = await up("image/png", png);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(8)]);
  assert.equal((await up("image/jpeg", jpeg)).statusCode, 200, "JPEG");
  assert.equal((await up("image/webp", webp)).statusCode, 200, "WebP");
});
