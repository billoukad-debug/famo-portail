// Retours de Mohsen (2026-10-09), sur la vraie chaîne api/*.js → moteur SQL (SQLite en mémoire), données de scripts/seed.js :
//  - le client annule sa commande jusqu'au départ en livraison (Ontvangen ou Klaar), plus après ;
//  - seul le beheerder annule une commande côté personnel (corrections.test.js : AN5) ;
//  - Beheer renomme une catégorie existante d'un coup (tous ses produits).
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = "team-test-code-1";
process.env.ADMIN_CODE = "beheer-test-code-1";
process.env.SESSION_SECRET = "session-secret-not-to-leak";
delete process.env.RESEND_API_KEY;
process.removeAllListeners("warning");

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const { FakeAirtable } = require(path.join(ROOT, "scripts", "fake-airtable.js"));
const { seed } = require(path.join(ROOT, "scripts", "seed.js"));

const engineFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input && input.url) || String(input);
  if (url.startsWith("https://api.airtable.com/") || url.startsWith("https://content.airtable.com/")) return engineFetch(input, init);
  throw new Error("Réseau refusé dans les tests : " + url);
};
const ADMIN = { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin")) };
const STAFF = { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "staff")) };
const store = () => ds.state.store;
let ip = 0;
function mkRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[String(k).toLowerCase()];
  res.end = () => res;
  return res;
}
async function api(name, req) {
  const res = mkRes();
  const headers = Object.assign({ "x-forwarded-for": "10.31.0." + (++ip % 250), origin: "http://localhost", host: "localhost", "content-type": "application/json" }, req.headers || {});
  await require(path.join(ROOT, "api", name + ".js"))(Object.assign({ method: "GET", query: {}, body: null }, req, { headers }), res);
  return res;
}
const beheer = (body, headers) => api("onboarding", { method: "POST", headers: headers || ADMIN, body });
const client = (body) => api("klantorder", { method: "POST", body: Object.assign({ user: "aloha", pw: "welkom123" }, body) });

let aloha;
test.beforeEach(async () => {
  auth.noteGeneration(0);
  const demo = new FakeAirtable();
  seed(demo);
  aloha = demo.data.Clients.find((c) => c.fields["Nom"] === "Aloha Poke Bowls").id;
  const mk = (id, ref, statut) => ({ id, createdTime: new Date().toISOString(), fields: { "Référence": ref, "Client": [aloha], "Statut": statut, "Date": new Date().toISOString().slice(0, 10), "Lignes (produits / quantités)": "Cabillaud × 1 kg [€22.00]" } });
  demo.data.Commandes.push(mk("recMOH0000000001", "CMD-T-0001", "Reçue"), mk("recMOH0000000002", "CMD-T-0002", "Prête"), mk("recMOH0000000003", "CMD-T-0003", "Sortie en livraison"));
  for (const [tbl, recs] of Object.entries(demo.data)) await store().replaceAll(tbl, recs);
});

test("client : annuler jusqu'au départ en livraison (Ontvangen, Klaar), plus une fois en route", async () => {
  for (const ref of ["CMD-T-0001", "CMD-T-0002"]) {
    const r = await client({ action: "cancel", ref });
    assert.equal(r.statusCode, 200, ref + " " + JSON.stringify(r.body));
    const rec = (await store().list("Commandes")).find((x) => x.fields["Référence"] === ref);
    assert.equal(rec.fields["Statut"], "Annulée");
  }
  const r = await client({ action: "cancel", ref: "CMD-T-0003" });
  assert.equal(r.statusCode, 409);
  assert.match(r.body.error, /onderweg/);
});

test("Beheer : renommer une catégorie existante renomme tous ses produits ; personnel refusé ; nom vide refusé", async () => {
  const before = (await store().list("Catalogue")).map((r) => r.fields["Catégorie"] || "");
  const from = before.find(Boolean);
  assert.ok(from, "la démo a des catégories");
  const n = before.filter((c) => c.trim().toLowerCase() === from.trim().toLowerCase()).length;
  assert.ok([401, 403].includes((await beheer({ action: "renameCategory", from, to: "Garnalen" }, STAFF)).statusCode), "personnel refusé");
  assert.equal((await beheer({ action: "renameCategory", from, to: "  " })).statusCode, 400);
  const r = await beheer({ action: "renameCategory", from, to: "Garnalen" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.updated, n);
  const after = (await store().list("Catalogue")).map((x) => x.fields["Catégorie"] || "");
  assert.equal(after.filter((c) => c === "Garnalen").length, n + before.filter((c) => c === "Garnalen").length);
  assert.equal(after.filter((c) => c === from).length, 0);
  assert.equal((await beheer({ action: "renameCategory", from: "bestaat niet", to: "X" })).statusCode, 404);
});
