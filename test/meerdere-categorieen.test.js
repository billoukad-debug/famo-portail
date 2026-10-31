"use strict";
// Spec 039 : un produit dans plusieurs catégories (« Catégorie » = principale, « Extra categorieën » = en plus),
// sur la vraie chaîne api/*.js → moteur SQL (SQLite en mémoire), données de scripts/seed.js.
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

const C = require(path.join(ROOT, "lib", "categorieen.js"));
test.beforeEach(async () => {
  auth.noteGeneration(0);
  const demo = new FakeAirtable();
  seed(demo);
  for (const [tbl, recs] of Object.entries(demo.data)) await store().replaceAll(tbl, recs);
});
const prod = async (nom) => (await store().list("Catalogue")).find((r) => r.fields["Produit"] === nom);

test("extrasOf : nettoyé, sans doublon ni la principale, 10 au plus", () => {
  assert.deepStrictEqual(C.extrasOf({ "Catégorie": "Vis", [C.FIELD]: " Sushi \nvis\nSUSHI\n\nPoke  bowl " }), ["Sushi", "Poke bowl"]);
  assert.deepStrictEqual(C.extrasOf({ "Catégorie": "", [C.FIELD]: "Algemeen\nSushi" }), ["Sushi"]);
  assert.deepStrictEqual(C.extrasOf({ "Catégorie": "Vis" }), []);
  const many = Array.from({ length: 14 }, (_, i) => "Cat " + i).join("\n");
  assert.equal(C.extrasOf({ "Catégorie": "Vis", [C.FIELD]: many }).length, C.MAX);
  assert.deepStrictEqual(C.catsOf({ "Catégorie": "Vis", [C.FIELD]: "Sushi" }), ["Vis", "Sushi"]);
});

test("extrasIn : une liste, sinon erreur ; retours à la ligne neutralisés", () => {
  assert.equal(C.extrasIn(["Sushi", "vis", "Poke\nbowl"], "Vis").value, "Sushi\nPoke bowl");
  assert.equal(C.extrasIn([], "Vis").value, "");
  assert.ok(C.extrasIn("Sushi", "Vis").error);
});

test("renamed : la catégorie suit dans les extras ; null si rien ne change", () => {
  assert.equal(C.renamed({ "Catégorie": "Vis", [C.FIELD]: "sushi\nPoke" }, ["Sushi"], "Sushi & poke"), "Sushi & poke\nPoke");
  assert.equal(C.renamed({ "Catégorie": "Vis", [C.FIELD]: "Poke" }, ["Sushi"], "X"), null);
  // L'extra renommé vers la principale disparaît (pas de doublon).
  assert.equal(C.renamed({ "Catégorie": "Vis", [C.FIELD]: "Sushi\nPoke" }, ["Sushi"], "Vis"), "Poke");
});

test("Beheer : enregistrer un produit avec des catégories en plus ; absence = inchangé ; non-liste refusée", async () => {
  const p = await prod("Cabillaud");
  const base = { action: "saveProduct", id: p.id, nom: "Cabillaud", cat: "Poisson", unite: "kg", base: 22 };
  let r = await beheer(Object.assign({ extraCats: ["Sushi & poke", "poisson", "Promo", "promo"] }, base));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal((await prod("Cabillaud")).fields[C.FIELD], "Sushi & poke\nPromo");
  r = await beheer(base);
  assert.equal(r.statusCode, 200);
  assert.equal((await prod("Cabillaud")).fields[C.FIELD], "Sushi & poke\nPromo", "sans extraCats : rien n'est effacé");
  assert.equal((await beheer(Object.assign({ extraCats: "Promo" }, base))).statusCode, 400);
  assert.equal((await beheer(Object.assign({ extraCats: ["Promo"] }, base), STAFF)).statusCode < 300, false, "personnel refusé");
  // Beheer relit les extras (sans la principale).
  const g = await api("onboarding", { method: "GET", headers: ADMIN });
  assert.equal(g.statusCode, 200);
  assert.deepStrictEqual(g.body.products.find((x) => x.nom === "Cabillaud").extraCats, ["Sushi & poke", "Promo"]);
  // Vider les extras.
  assert.equal((await beheer(Object.assign({ extraCats: [] }, base))).statusCode, 200);
  assert.equal((await prod("Cabillaud")).fields[C.FIELD] || "", "");
});

test("Client : le catalogue donne toutes les catégories du produit, la principale d'abord", async () => {
  const r = await api("catalogue", { method: "POST", body: { user: "aloha", pw: "welkom123" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const t = r.body.products.find((x) => x.nom === "Tonijn sashimi blok");
  assert.deepStrictEqual(t.cats, ["Poisson", "Sushi & poke"]);
  assert.equal(t.cat, "Poisson", "la catégorie principale ne change pas");
  const c = r.body.products.find((x) => x.nom === "Cabillaud");
  assert.deepStrictEqual(c.cats, ["Poisson"]);
});

test("Beheer : renommer une catégorie la renomme aussi là où elle est en plus", async () => {
  const r = await beheer({ action: "renameCategory", from: ["Sushi & poke"], to: "Sushi" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.updated, 1);
  const t = await prod("Tonijn sashimi blok");
  assert.equal(t.fields["Catégorie"], "Poisson");
  assert.equal(t.fields[C.FIELD], "Sushi");
  // La principale renommée vers un nom présent en extra : pas de doublon.
  const r2 = await beheer({ action: "renameCategory", from: ["Poisson"], to: "Sushi" });
  assert.equal(r2.statusCode, 200);
  const t2 = await prod("Tonijn sashimi blok");
  assert.equal(t2.fields["Catégorie"], "Sushi");
  assert.equal(t2.fields[C.FIELD] || "", "");
});
