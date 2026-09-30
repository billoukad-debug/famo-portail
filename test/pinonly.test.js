"use strict";
// Audit L-06 : option Beheer → Toegang « Enkel persoonlijke pincodes » (specs/005-pin-personnels-seuls).
// Option active : codes partagés refusés (401 générique, échec compté), PIN personnels acceptés
// au nom de la personne, sessions existantes révoquées, activation impossible sans beheerder PIN
// active, dernière beheerder protégée, accès de secours ADMIN_CODE (page Beheer seulement,
// « Noodtoegang », log d'erreur + journal). Vraies fonctions api/*.js sur SQLite en mémoire.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = "team-pin-code-1";
process.env.ADMIN_CODE = "beheer-pin-code-1";
process.env.SESSION_SECRET = "sessie-geheim-pinonly-0123456789abcdef";
delete process.env.RESEND_API_KEY;
delete process.env.VERCEL;
process.removeAllListeners("warning"); // node:sqlite est « expérimental »

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const journal = require(path.join(ROOT, "lib", "journal.js"));
const log = require(path.join(ROOT, "lib", "log.js"));

const FIELD = "Enkel persoonlijke PIN";
const PIN_ANN = "246810", PIN_PIET = "135791";
// Empreintes calculées une fois (scrypt ≈ 0,45 s chacune).
const HASH_ANN = auth.hashCode(PIN_ANN), HASH_PIET = auth.hashCode(PIN_PIET);

function mkRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = () => res;
  return res;
}
let ip = 0;
async function callApi(name, req) {
  const handler = require(path.join(ROOT, "api", name + ".js"));
  const res = mkRes();
  const headers = Object.assign({ "x-forwarded-for": "10.77.0." + (++ip % 250) }, (req && req.headers) || {});
  await handler(Object.assign({ method: "GET", query: {}, body: null }, req, { headers }), res);
  return res;
}
const cookieOf = (res) => { const m = /famo_sess=([^;]*)/.exec(res.headers["set-cookie"] || ""); return m && m[1] && m[1] !== "uit" ? "famo_sess=" + m[1] : ""; };
const login = (code, want, extra) => callApi("session", Object.assign({ method: "POST", body: { code, want } }, extra || {}));
const check = (cookie) => callApi("session", { headers: { cookie } });
const beheer = (cookie, body) => callApi("onboarding", { method: "POST", headers: { cookie }, body });
const store = () => ds.state.store;
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const conf = async () => (await store().get("Configuratie", "recCONF")).fields;

async function seed(opts) {
  const o = opts || {};
  auth.noteGeneration(0);
  await store().replaceAll("Configuratie", [rec("recCONF", Object.assign({ "Bedrijfsnaam": "FAMO Seafood", "BTW-nummer": "BE0123456749" }, o.conf || {}))]);
  await store().replaceAll("Medewerkers", o.medewerkers || [
    rec("recANN", { "Naam": "Ann", "Rol": "beheerder", "PIN hash": HASH_ANN, "Actief": true }),
    rec("recPIET", { "Naam": "Piet", "Rol": "personeel", "PIN hash": HASH_PIET, "Actief": true })
  ]);
  await store().replaceAll("Journaal", []);
}
async function adminByPin() {
  const r = await login(PIN_ANN, "admin");
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.name, "Ann");
  return cookieOf(r);
}

test("activation refusée sans beheerder PIN active : 409, rien n'est écrit, personne n'est déconnecté", async () => {
  await seed({ medewerkers: [
    rec("recANN", { "Naam": "Ann", "Rol": "beheerder", "PIN hash": HASH_ANN }), // inactive (case absente)
    rec("recPIET", { "Naam": "Piet", "Rol": "personeel", "PIN hash": HASH_PIET, "Actief": true })
  ] });
  const admin = cookieOf(await login(process.env.ADMIN_CODE, "admin"));
  assert.ok(admin);
  const r = await beheer(admin, { action: "saveEnkelPin", aan: true });
  assert.equal(r.statusCode, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /Beheerder/);
  assert.match(r.body.error, /PIN/);
  const c = await conf();
  assert.ok(!c[FIELD], "case non cochée");
  assert.ok(!(Number(c["Sessiegeneratie"]) > 0), "génération inchangée");
  assert.equal((await check(admin)).statusCode, 200, "le beheerder reste connecté");
  assert.equal((await login(process.env.STAFF_CODE, "staff")).statusCode, 200, "teamcode toujours valable");
  assert.equal((await journal.list({})).filter(j => j.Actie === "saveEnkelPin").length, 0, "rien au journal pour un refus");
  // Le personnel ne peut pas activer l'option.
  const staff = cookieOf(await login(process.env.STAFF_CODE, "staff"));
  assert.equal((await beheer(staff, { action: "saveEnkelPin", aan: true })).statusCode, 401);
});

test("activation : codes partagés refusés (générique, comptés), PIN au nom, sessions révoquées, journal", async () => {
  await seed();
  const shared = cookieOf(await login(process.env.STAFF_CODE, "staff"));
  const sharedAdmin = cookieOf(await login(process.env.ADMIN_CODE, "admin"));
  const ann = await adminByPin();
  const on = await beheer(ann, { action: "saveEnkelPin", aan: true });
  assert.equal(on.statusCode, 200, JSON.stringify(on.body));
  assert.equal(on.body.config.enkelPin, true);
  assert.equal(on.body.afgemeld, false, "connectée par PIN : reste connectée");
  const fresh = cookieOf(on);
  assert.ok(fresh, "cookie renouvelé à la nouvelle génération");
  const c = await conf();
  assert.equal(c[FIELD], true);
  assert.equal(c["Sessiegeneratie"], 1, "génération +1 (comme « Iedereen afmelden »)");
  assert.equal((await check(shared)).statusCode, 401, "session teamcode révoquée");
  assert.equal((await check(sharedAdmin)).statusCode, 401, "session code beheerder révoquée");
  const me = await check(fresh);
  assert.equal(me.statusCode, 200);
  assert.equal(me.body.name, "Ann");
  // Codes partagés refusés avec le message d'un code faux.
  for (const [code, want] of [[process.env.STAFF_CODE, "staff"], [process.env.ADMIN_CODE, "staff"]]) {
    const r = await login(code, want);
    assert.equal(r.statusCode, 401, code + " / " + want);
    assert.equal(r.body.error, "Ongeldige personeelscode");
    assert.ok(!cookieOf(r));
  }
  assert.ok(Number((await conf())["PIN echecs"]) >= 2, "comptés dans le verrou des PIN");
  // Comptés aussi par appareil : 5 essais puis 429.
  const same = { headers: { "x-forwarded-for": "198.51.100.7" } };
  for (let i = 0; i < 5; i++) assert.equal((await login(process.env.STAFF_CODE, "staff", same)).statusCode, 401);
  assert.equal((await login(process.env.STAFF_CODE, "staff", same)).statusCode, 429);
  // Les PIN personnels fonctionnent, au nom de la personne et avec son rôle.
  const piet = await login(PIN_PIET, "staff");
  assert.equal(piet.statusCode, 200);
  assert.equal(piet.body.name, "Piet");
  assert.equal(piet.body.role, "staff");
  assert.equal(auth.actorOf({ headers: { cookie: cookieOf(piet) } }), "Piet", "les actions portent le nom");
  // Journal : qui, avant → après.
  const j = (await journal.list({})).find(x => x.Actie === "saveEnkelPin");
  assert.ok(j, "entrée de journal");
  assert.equal(j.Wie, "Ann");
  assert.equal(j.Object, "Configuratie");
  const w = j.Wijzigingen.find(x => x.veld === FIELD);
  assert.deepEqual([w.voor, w.na], ["", "true"]);
});

test("activation depuis une session par code partagé : déconnecté aussi, sans nouveau cookie", async () => {
  await seed();
  const sharedAdmin = cookieOf(await login(process.env.ADMIN_CODE, "admin"));
  const r = await beheer(sharedAdmin, { action: "saveEnkelPin", aan: true });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.afgemeld, true);
  assert.ok(!cookieOf(r), "pas de session renouvelée pour un code partagé");
  assert.equal((await check(sharedAdmin)).statusCode, 401);
  const j = (await journal.list({})).find(x => x.Actie === "saveEnkelPin");
  assert.equal(j && j.Wie, "beheerder", "journalisé avant la déconnexion");
});

test("option active : la dernière beheerder PIN active ne peut être ni supprimée, ni désactivée, ni rétrogradée", async () => {
  await seed({ conf: { [FIELD]: true } });
  const ann = await adminByPin();
  for (const body of [{ action: "deleteMedewerker", id: "recANN" }, { action: "saveMedewerker", id: "recANN", naam: "Ann", rol: "beheerder", actief: false }, { action: "saveMedewerker", id: "recANN", naam: "Ann", rol: "personeel", actief: true }]) {
    const r = await beheer(ann, body);
    assert.equal(r.statusCode, 409, JSON.stringify(body) + " → " + JSON.stringify(r.body));
    assert.match(r.body.error, /Beheerder/);
  }
  const a = (await store().get("Medewerkers", "recANN")).fields;
  assert.deepEqual([a["Rol"], a["Actief"]], ["beheerder", true], "rien n'a changé");
  // Une autre medewerker (personeel) reste librement modifiable.
  assert.equal((await beheer(ann, { action: "saveMedewerker", id: "recPIET", naam: "Piet", rol: "personeel", actief: false })).statusCode, 200);
  // Avec une seconde beheerder active, Ann peut être désactivée.
  await store().insert("Medewerkers", [rec("recBOB", { "Naam": "Bob", "Rol": "beheerder", "PIN hash": HASH_PIET, "Actief": true })]);
  assert.equal((await beheer(ann, { action: "saveMedewerker", id: "recANN", naam: "Ann", rol: "beheerder", actief: false })).statusCode, 200);
});

test("secours : ADMIN_CODE depuis la page Beheer seulement, « Noodtoegang », log d'erreur et journal", async () => {
  await seed({ conf: { [FIELD]: true } });
  const lines = [];
  const prev = log._setSink(lines);
  let r;
  try { r = await login(process.env.ADMIN_CODE, "admin"); } finally { log._setSink(prev); }
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.role, "admin");
  assert.equal(r.body.name, "Noodtoegang");
  const me = await check(cookieOf(r));
  assert.equal(me.body.name, "Noodtoegang");
  const loud = lines.find(l => l.niveau === "error" && /noodtoegang/i.test(l.msg));
  assert.ok(loud, "log d'erreur : " + JSON.stringify(lines));
  assert.ok(!JSON.stringify(lines).includes(process.env.ADMIN_CODE), "jamais le code dans les logs");
  const j = (await journal.list({})).find(x => x.Actie === "noodtoegang");
  assert.ok(j, "ligne de journal");
  assert.equal(j.Wie, "Noodtoegang");
  // Les actions faites pendant le secours portent ce nom.
  assert.equal(auth.actorOf({ headers: { cookie: cookieOf(r) } }), "Noodtoegang");
  // Page personnel : refusé (le secours n'existe que pour le rôle beheerder).
  assert.equal((await login(process.env.ADMIN_CODE, "staff")).statusCode, 401);
  // Code beheerder enregistré : il remplace ADMIN_CODE ; ni l'un ni l'autre n'ouvre.
  await store().update("Configuratie", "recCONF", Object.assign({}, await conf(), { "Beheerderscode hash": auth.hashCode("EigenBeheerCode1") }), (await store().get("Configuratie", "recCONF")).version);
  assert.equal((await login(process.env.ADMIN_CODE, "admin")).statusCode, 401, "ADMIN_CODE remplacé");
  assert.equal((await login("EigenBeheerCode1", "admin")).statusCode, 401, "code enregistré partagé refusé");
  assert.equal((await login(PIN_ANN, "admin")).statusCode, 200, "le PIN reste valable");
});

test("verrou des PIN avec l'option active : message sans renvoi à la teamcode", async () => {
  await seed({ conf: { [FIELD]: true, "PIN geblokkeerd tot": new Date(Date.now() + 600000).toISOString() } });
  const r = await login(PIN_PIET, "staff");
  assert.equal(r.statusCode, 429);
  assert.doesNotMatch(r.body.error, /teamcode/i);
  assert.equal((await login(process.env.STAFF_CODE, "staff")).statusCode, 429, "la teamcode n'est plus une issue");
});

test("désactivation : codes partagés de nouveau acceptés, personne n'est déconnecté", async () => {
  await seed({ conf: { [FIELD]: true } });
  const ann = await adminByPin();
  const piet = cookieOf(await login(PIN_PIET, "staff"));
  const off = await beheer(ann, { action: "saveEnkelPin", aan: false });
  assert.equal(off.statusCode, 200, JSON.stringify(off.body));
  assert.equal(off.body.config.enkelPin, false);
  assert.ok(!(await conf())[FIELD]);
  assert.ok(!(Number((await conf())["Sessiegeneratie"]) > 0), "pas de révocation à la désactivation");
  assert.equal((await check(piet)).statusCode, 200);
  assert.equal((await check(ann)).statusCode, 200);
  assert.equal((await login(process.env.STAFF_CODE, "staff")).statusCode, 200);
});

test("Configuratie illisible : l'instance garde le dernier état connu de l'option", async () => {
  await seed({ conf: { [FIELD]: true } });
  assert.equal((await login(process.env.STAFF_CODE, "staff")).statusCode, 401, "état lu : option active");
  const real = store().list.bind(store()), realGet = store().get.bind(store());
  store().list = async () => { throw new Error("connection reset"); };
  store().get = async () => { throw new Error("connection reset"); };
  try {
    assert.equal((await login(process.env.STAFF_CODE, "staff")).statusCode, 401, "base injoignable : toujours refusé");
  } finally { store().list = real; store().get = realGet; }
});
