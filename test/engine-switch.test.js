// Interrupteur de base (lib/datastore.js) mal configuré : DB_BACKEND=postgres sans
// DATABASE_URL (ni POSTGRES_URL). Attendu : une erreur explicite DATABASE_NOT_CONFIGURED
// (HTTP 500), JAMAIS un repli silencieux sur Airtable (deux bases divergentes seraient
// pires qu'une panne franche). Processus dédié (node --test) : les autres fichiers de
// test gardent leur propre configuration.
process.env.STAFF_CODE = process.env.STAFF_CODE || "team-test-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "beheer-test-code";
process.env.AIRTABLE_TOKEN = "test-token"; // présent : un repli vers Airtable serait possible
delete process.env.RESEND_API_KEY;

const test = require("node:test");
const { mock } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");

// Le « vrai » fetch vu par lib/datastore.js au moment de son installation : on le remplace
// AVANT le chargement pour voir passer toute requête qui partirait vers l'extérieur.
const outbound = [];
const originalFetch = globalThis.fetch;
const realImmediate = setImmediate;

function load(env) {
  for (const k of ["DB_BACKEND", "DATABASE_URL", "POSTGRES_URL", "DB_SQLITE_FILE"]) delete process.env[k];
  Object.assign(process.env, env);
  delete globalThis.__famoDatastore;
  outbound.length = 0;
  globalThis.fetch = async (url) => {
    outbound.push(String(url));
    return new Response(JSON.stringify({ records: [{ id: "recAIRTABLE", fields: {} }] }), { status: 200 });
  };
  for (const rel of ["lib/datastore.js", "lib/airtable.js", "lib/staffauth.js", "api/allorders.js"]) delete require.cache[require.resolve(path.join(ROOT, rel))];
  return require(path.join(ROOT, "lib", "datastore.js"));
}

// Fait avancer les timers simulés (reprise des lectures sur 5xx) sans attendre réellement.
async function run(fn) {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let done = false, value, error;
  fn().then(v => { done = true; value = v; }, e => { done = true; error = e; });
  try {
    for (let i = 0; i < 2000 && !done; i++) { await new Promise(r => realImmediate(r)); mock.timers.tick(60 * 1000); }
  } finally { mock.timers.reset(); }
  assert.ok(done, "appel jamais terminé");
  if (error) throw error;
  return value;
}

test.after(() => { delete globalThis.__famoDatastore; globalThis.fetch = originalFetch; });

for (const [label, env] of [
  ["DB_BACKEND=postgres sans DATABASE_URL", { DB_BACKEND: "postgres" }],
  ["DB_BACKEND=postgres avec une adresse invalide", { DB_BACKEND: "postgres", DATABASE_URL: "mysql://x@y/z" }],
  ["DB_BACKEND= Postgres (casse, espaces) sans DATABASE_URL", { DB_BACKEND: " Postgres " }]
]) {
  test(label + " → DATABASE_NOT_CONFIGURED, aucune requête vers Airtable", async () => {
    const ds = load(env);
    assert.equal(ds.backend(), "postgres");
    assert.ok(ds.state.error, "la cause est mémorisée");
    const r = await globalThis.fetch(`https://api.airtable.com/v0/${ds.BASE}/Clients`);
    assert.equal(r.status, 500);
    const j = await r.json();
    assert.equal(j.error.type, "DATABASE_NOT_CONFIGURED");
    assert.match(j.error.message, /DATABASE_URL|postgres/i, "message explicite");
    const w = await globalThis.fetch(`https://api.airtable.com/v0/${ds.BASE}/Commandes`, { method: "POST", body: "{}" });
    assert.equal(w.status, 500, "écriture refusée aussi");
    assert.deepEqual(outbound, [], "aucune requête n'est partie vers Airtable");
  });
}

test("lib/airtable (lecture reprise puis écriture) : l'erreur remonte telle quelle", async () => {
  const ds = load({ DB_BACKEND: "postgres" });
  const air = require(path.join(ROOT, "lib", "airtable.js"));
  const g = await run(() => air.at("Clients"));
  assert.equal(g.error.type, "DATABASE_NOT_CONFIGURED");
  const p = await air.at("Commandes", { method: "POST", body: "{}" });
  assert.equal(p.error.type, "DATABASE_NOT_CONFIGURED");
  assert.deepEqual(outbound, []);
  assert.equal(ds.backend(), "postgres");
});

test("un endpoint staff renvoie une erreur 500, pas une liste vide ni des données Airtable", async () => {
  load({ DB_BACKEND: "postgres" });
  const auth = require(path.join(ROOT, "lib", "staffauth.js"));
  const allorders = require(path.join(ROOT, "api", "allorders.js"));
  const res = { statusCode: 200, payload: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return p; }, setHeader(k, v) { this.headers[k] = v; } };
  const cookie = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 60000, "staff"));
  await run(() => allorders({ method: "GET", query: {}, headers: { cookie } }, res));
  assert.equal(res.statusCode, 500);
  assert.ok(!res.payload.orders, "pas de liste (vide ou non)");
  assert.deepEqual(outbound, []);
});

test("les autres adresses passent par le fetch d'origine (Resend, Neon…)", async () => {
  load({ DB_BACKEND: "postgres" });
  const r = await globalThis.fetch("https://api.resend.com/emails", { method: "POST" });
  assert.equal(r.status, 200);
  assert.deepEqual(outbound, ["https://api.resend.com/emails"]);
});

test("retour arrière : DB_BACKEND=airtable (ou absent) → fetch non intercepté", async () => {
  for (const env of [{ DB_BACKEND: "airtable" }, {}]) {
    const ds = load(env);
    assert.equal(ds.backend(), "airtable");
    const r = await globalThis.fetch(`https://api.airtable.com/v0/${ds.BASE}/Clients`);
    assert.equal(r.status, 200);
    assert.equal(outbound.length, 1, "la requête part bien vers Airtable");
  }
});
