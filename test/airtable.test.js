// lib/airtable.js : reprise sur 429 / 5xx et normalisation des erreurs HTTP.
// Le mock de fetch renvoie de vraies réponses HTTP (statut + corps), contrairement au
// mock ordonné de scripts/workflow-check.js (réponses sans statut).
// Les attentes entre deux essais passent par des timers simulés (mock.timers) : le
// test reste instantané quelle que soit la durée du backoff choisie dans lib/airtable.js.
// On teste le CONTRAT, pas le nombre exact d'essais ni les délais :
//   - lecture (GET) : réessayée après 429 et après 5xx ;
//   - écriture : jamais rejouée sur 5xx (elle a peut-être eu lieu) ;
//   - toute erreur HTTP ou réponse illisible devient { error: { message } }.
delete process.env.DB_BACKEND; // mode Airtable : fetch n'est pas intercepté
process.env.AIRTABLE_TOKEN = "test-token";

const test = require("node:test");
const { mock } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const air = require(path.join(__dirname, "..", "lib", "airtable.js"));
const realFetch = globalThis.fetch;
const realImmediate = setImmediate;

// Chaque élément de `replies` : [statut, corps] (corps null = aucun corps, chaîne = texte brut).
function installFetch(replies) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: String((opts && opts.method) || "GET").toUpperCase(), headers: (opts && opts.headers) || {} });
    const [status, body] = replies.length > 1 ? replies.shift() : replies[0]; // la dernière réponse se répète
    const text = body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

// Exécute `fn` en faisant avancer les timers simulés jusqu'à ce qu'elle rende la main.
async function run(fn) {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let done = false;
  let value;
  let error;
  fn().then(v => { done = true; value = v; }, e => { done = true; error = e; });
  try {
    for (let i = 0; i < 2000 && !done; i++) {
      await new Promise(resolve => realImmediate(resolve));
      mock.timers.tick(60 * 1000);
    }
  } finally {
    mock.timers.reset();
  }
  assert.ok(done, "l'appel ne s'est jamais terminé (reprise sans fin ?)");
  if (error) throw error;
  return value;
}

test.afterEach(() => { globalThis.fetch = realFetch; });

test("lecture : 429 puis 200 → réessayée, résultat renvoyé", async () => {
  const calls = installFetch([[429, { error: { type: "TOO_MANY_REQUESTS" } }], [200, { records: [{ id: "rec1" }] }]]);
  const j = await run(() => air.at("Commandes"));
  assert.deepEqual(j, { records: [{ id: "rec1" }] });
  assert.equal(calls.length, 2, "un seul nouvel essai suffit");
  assert.match(calls[0].headers.Authorization, /^Bearer /, "jeton en en-tête");
});

test("lecture : 503 puis 200 → réessayée", async () => {
  const calls = installFetch([[503, null], [200, { records: [] }]]);
  const j = await run(() => air.at("Stock"));
  assert.deepEqual(j, { records: [] });
  assert.equal(calls.length, 2);
});

test("lecture : 503 persistant → plusieurs essais, puis erreur normalisée (jamais une table vide)", async () => {
  const calls = installFetch([[503, null]]);
  const j = await run(() => air.at("Stock"));
  assert.ok(calls.length >= 2 && calls.length <= 10, "réessayée, mais un nombre borné de fois (" + calls.length + ")");
  assert.ok(j && j.error && typeof j.error.message === "string" && j.error.message, "erreur { error: { message } }");
  assert.equal(j.records, undefined, "pas de liste vide");
});

test("écriture : 5xx jamais rejouée (l'écriture a peut-être eu lieu)", async () => {
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const calls = installFetch([[503, null], [200, { id: "recNEW" }]]);
    const j = await run(() => air.at("Commandes", { method, body: JSON.stringify({ fields: { Statut: "Reçue" } }) }));
    assert.equal(calls.length, 1, method + " : un seul envoi");
    assert.ok(j.error && j.error.message, method + " : erreur normalisée");
  }
});

test("écriture : 429 (refusée AVANT traitement par Airtable) finit par passer", async () => {
  const calls = installFetch([[429, { error: { type: "TOO_MANY_REQUESTS" } }], [200, { id: "recNEW", fields: {} }]]);
  const j = await run(() => air.at("Commandes", { method: "POST", body: "{}" }));
  assert.equal(j.id, "recNEW");
  assert.equal(calls.length, 2);
});

test("normalisation : erreur HTTP sans corps { error } → { error: { message } }", async () => {
  installFetch([[404, {}]]);
  let j = await run(() => air.at("Commandes/recX", { method: "PATCH", body: "{}" }));
  assert.ok(j.error && typeof j.error.message === "string" && j.error.message, "404 {} → erreur");
  installFetch([[422, null]]);
  j = await run(() => air.at("Commandes", { method: "POST", body: "{}" }));
  assert.ok(j.error && j.error.message, "422 sans corps → erreur");
  installFetch([[200, "<html>proxy</html>"]]);
  j = await run(() => air.at("Commandes"));
  assert.ok(j.error && j.error.message, "200 mais pas du JSON → erreur, pas une page vide");
});

test("normalisation : l'erreur Airtable d'origine est conservée", async () => {
  installFetch([[422, { error: { type: "INVALID_VALUE_FOR_COLUMN", message: "Field Statut cannot accept value" } }]]);
  const j = await run(() => air.at("Commandes", { method: "POST", body: "{}" }));
  assert.equal(j.error.type, "INVALID_VALUE_FOR_COLUMN");
  assert.match(j.error.message, /cannot accept/);
});

test("atAll : pages enchaînées ; une page en erreur → erreur, jamais une liste tronquée", async () => {
  let calls = installFetch([[200, { records: [{ id: "a" }], offset: "p2" }], [200, { records: [{ id: "b" }] }]]);
  let j = await run(() => air.atAll("Catalogue?view=x"));
  assert.deepEqual(j.records.map(r => r.id), ["a", "b"]);
  assert.match(calls[1].url, /[?&]offset=p2/);
  installFetch([[200, { records: [{ id: "a" }], offset: "p2" }], [500, null]]);
  j = await run(() => air.atAll("Catalogue"));
  assert.ok(j.error, "erreur remontée");
  assert.equal(j.records, undefined);
});

test("atBatch : lots de 10 ; en cas d'échec, `done` liste ce qui est déjà écrit", async () => {
  const recs = Array.from({ length: 23 }, (_, i) => ({ id: "rec" + i, fields: { N: i } }));
  let calls = installFetch([[200, { records: [] }]]);
  let j = await run(() => air.atBatch("Stock", "PATCH", recs));
  assert.equal(j.ok, true);
  assert.deepEqual(calls.map(c => c.method), ["PATCH", "PATCH", "PATCH"]);
  calls = installFetch([[200, { records: [] }], [503, null]]);
  j = await run(() => air.atBatch("Stock", "PATCH", recs));
  assert.ok(j.error, "échec signalé");
  assert.equal(j.done.length, 10, "seul le premier lot est écrit");
  assert.equal(calls.length, 2, "le lot en échec n'est pas rejoué (écriture sur 5xx)");
});
