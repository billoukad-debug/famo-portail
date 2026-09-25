// Moteur compatible Airtable sur SQL (lib/at-engine.js, lib/sql.js, lib/datastore.js).
// Chaque fichier de test tourne dans son propre processus (node --test) : on peut donc
// activer ici DB_BACKEND=sqlite sans toucher aux autres tests, qui restent sur Airtable.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "team-test-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "beheer-test-code";
process.env.AIRTABLE_TOKEN = "test-token";
delete process.env.RESEND_API_KEY;
process.removeAllListeners("warning"); // node:sqlite est « expérimental » : bruit inutile

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const ds = require(path.join(ROOT, "lib", "datastore.js"));
const { AtEngine, sqlStore } = require(path.join(ROOT, "lib", "at-engine.js"));
const sqlLib = require(path.join(ROOT, "lib", "sql.js"));
const BASE = ds.BASE;
const U = (p) => `https://api.airtable.com/v0/${BASE}/${p}`;

function freshEngine() {
  const store = sqlStore(sqlLib.sqlite(":memory:"));
  return { store, engine: new AtEngine(store, { base: BASE }) };
}
async function ok(engine, method, url, body) {
  const r = await engine.handle(method, url, body);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
}

test("création, lecture, champs vides ignorés, lot limité à 10", async () => {
  const { engine } = freshEngine();
  const one = await ok(engine, "POST", U("Clients"), { fields: { Nom: "Resto", Email: "", Gearchiveerd: false, Tags: [] } });
  assert.match(one.id, /^rec[A-Za-z0-9]{14}$/);
  assert.deepEqual(one.fields, { Nom: "Resto" });
  const got = await ok(engine, "GET", U("Clients/" + one.id));
  assert.equal(got.fields.Nom, "Resto");
  const batch = await ok(engine, "POST", U("Clients"), { records: [{ fields: { Nom: "A" } }, { fields: { Nom: "B" } }], typecast: true });
  assert.equal(batch.records.length, 2);
  const tooMany = await engine.handle("POST", U("Clients"), { records: Array.from({ length: 11 }, () => ({ fields: { Nom: "x" } })) });
  assert.equal(tooMany.status, 422);
  const missing = await engine.handle("GET", U("Clients/recXXXXXXXXXXXXXX"));
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.type, "NOT_FOUND");
  assert.equal((await engine.handle("GET", U("Inconnue"))).status, 404);
});

test("formules du portail, tri, maxRecords, pages, fields[]", async () => {
  const { engine } = freshEngine();
  const today = new Date().toISOString().slice(0, 10);
  const old = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  await ok(engine, "POST", U("Clients"), { records: [
    { fields: { Nom: "Aloha", Gebruikersnaam: "Aloha" } }, { fields: { Nom: "O'Brien", Gebruikersnaam: "obrien" } }] });
  await ok(engine, "POST", U("Commandes"), { records: [
    { fields: { "Référence": "CMD-1", Statut: "Reçue", Date: old, Total: 10 } },
    { fields: { "Référence": "CMD-2", Statut: "Facturée", Date: old, Total: 20 } },
    { fields: { "Référence": "CMD-3", Statut: "Facturée", Date: today, Total: 30 } },
    { fields: { "Référence": "CMD-4", Statut: "Annulée", Date: old, Total: 40 } }] });
  const f = (formula) => U("Commandes?filterByFormula=" + encodeURIComponent(formula));
  // Fenêtre 365 jours de api/allorders et api/orders
  const WINDOW = "OR(AND({Statut}!='Facturée',{Statut}!='Annulée'),IS_AFTER({Date},DATEADD(TODAY(),-365,'days')))";
  assert.deepEqual((await ok(engine, "GET", f(WINDOW))).records.map((r) => r.fields["Référence"]).sort(), ["CMD-1", "CMD-3"]);
  assert.equal((await ok(engine, "GET", f("{Référence}='CMD-2'"))).records.length, 1);
  const login = await ok(engine, "GET", U("Clients?filterByFormula=" + encodeURIComponent("LOWER({Gebruikersnaam})='aloha'")));
  assert.equal(login.records[0].fields.Nom, "Aloha");
  const sorted = await ok(engine, "GET", U("Commandes?sort%5B0%5D%5Bfield%5D=Total&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=3"));
  assert.deepEqual(sorted.records.map((r) => r.fields.Total), [40, 30, 20]);
  const p1 = await ok(engine, "GET", U("Commandes?pageSize=3"));
  assert.equal(p1.records.length, 3);
  assert.ok(p1.offset);
  const p2 = await ok(engine, "GET", U("Commandes?pageSize=3&offset=" + p1.offset));
  assert.equal(p2.records.length, 1);
  assert.equal(p2.offset, undefined);
  const proj = await ok(engine, "GET", U("Commandes?fields%5B%5D=Total&maxRecords=1"));
  assert.deepEqual(Object.keys(proj.records[0].fields), ["Total"]);
  const bad = await engine.handle("GET", f("SUM({Total})>1"));
  assert.equal(bad.status, 422, "une formule inconnue est refusée, jamais « tout renvoyer » en production");
});

test("PATCH fusionne et efface, PUT remplace, DELETE simple et groupé", async () => {
  const { engine } = freshEngine();
  const rec = await ok(engine, "POST", U("Commandes"), { fields: { "Référence": "CMD-9", Statut: "Reçue", Notes: "bel", Total: 5 } });
  const p = await ok(engine, "PATCH", U("Commandes/" + rec.id), { fields: { Statut: "Prête", Notes: "" }, typecast: true });
  assert.deepEqual(p.fields, { "Référence": "CMD-9", Statut: "Prête", Total: 5 });
  const multi = await ok(engine, "PATCH", U("Commandes"), { records: [{ id: rec.id, fields: { Total: 6 } }] });
  assert.equal(multi.records[0].fields.Total, 6);
  const put = await ok(engine, "PUT", U("Commandes/" + rec.id), { fields: { "Référence": "CMD-9" } });
  assert.deepEqual(put.fields, { "Référence": "CMD-9" });
  const att = await ok(engine, "PATCH", U("Commandes/" + rec.id), { fields: { "Preuve de livraison": [{ url: "https://x.test/foto.jpg" }] } });
  assert.equal(att.fields["Preuve de livraison"][0].filename, "foto.jpg");
  const b = await ok(engine, "POST", U("Stock"), { records: [{ fields: { Produit: "A" } }, { fields: { Produit: "B" } }] });
  const del = await ok(engine, "DELETE", U("Stock?records%5B%5D=" + b.records[0].id + "&records%5B%5D=" + b.records[1].id));
  assert.equal(del.records.length, 2);
  assert.deepEqual(await ok(engine, "DELETE", U("Commandes/" + rec.id)), { id: rec.id, deleted: true });
  assert.equal((await engine.handle("DELETE", U("Commandes/" + rec.id))).status, 404);
  const up = await engine.handle("POST", "https://content.airtable.com/v0/" + BASE + "/" + rec.id + "/Foto/uploadAttachment", { file: "x" });
  assert.equal(up.status, 501, "upload de photo : message clair, pas de plantage");
});

test("concurrence : une écriture concurrente n'est jamais perdue", async () => {
  const { store, engine } = freshEngine();
  const rec = await ok(engine, "POST", U("Commandes"), { fields: { "Référence": "CMD-C", Statut: "Reçue" } });
  // Un autre processus écrit entre la lecture et l'écriture du premier : le moteur relit et fusionne.
  const realGet = store.get;
  let injected = false;
  store.get = async (tbl, id) => {
    const cur = await realGet(tbl, id);
    if (!injected) { injected = true; await store.update(tbl, id, Object.assign({}, cur.fields, { Notes: "écrit ailleurs" }), cur.version); }
    return cur;
  };
  const out = await ok(engine, "PATCH", U("Commandes/" + rec.id), { fields: { Statut: "Prête" } });
  store.get = realGet;
  assert.equal(out.fields.Statut, "Prête");
  assert.equal(out.fields.Notes, "écrit ailleurs", "la modification concurrente est conservée");
});

test("interrupteur : fetch Airtable servi par la base, le reste passe", async () => {
  assert.equal(ds.backend(), "sqlite");
  const r = await fetch(U("Configuratie"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { Bedrijfsnaam: "FAMO Seafood" } }) });
  assert.equal(r.status, 200);
  const list = await (await fetch(U(encodeURIComponent("Configuratie") + "?maxRecords=1"))).json();
  assert.equal(list.records[0].fields.Bedrijfsnaam, "FAMO Seafood");
  await ds.state.store.replaceAll("Configuratie", []);
});

test("neon : adresse HTTP dérivée comme le pilote officiel, requêtes et transactions", async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init, body: JSON.parse(init.body) });
    const b = JSON.parse(init.body);
    const one = { fields: [{ name: "ok" }], rows: [["1"]] };
    return new Response(JSON.stringify(b.queries ? { results: b.queries.map(() => one) } : one), { status: 200 });
  };
  const db = sqlLib.neon("postgresql://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require", fakeFetch);
  assert.equal(db.endpoint, "https://api.eu-central-1.aws.neon.tech/sql");
  assert.deepEqual(await db.exec("SELECT $1 AS ok", [1]), [{ ok: "1" }]);
  assert.equal(seen[0].init.headers["Neon-Connection-String"].startsWith("postgresql://"), true);
  assert.deepEqual(seen[0].body.params, ["1"]);
  await db.batch([{ query: "SELECT 1", params: [] }, { query: "SELECT 2", params: [] }]);
  assert.equal(seen[1].body.queries.length, 2);
  const failing = sqlLib.neon("postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db", async () => new Response(JSON.stringify({ message: "relation does not exist" }), { status: 400 }));
  await assert.rejects(failing.exec("SELECT 1"), /relation does not exist/);
  assert.throws(() => sqlLib.neon("", fakeFetch), /DATABASE_URL/);
});

// Parcours réel : les vraies fonctions api/*.js, données de démo, base SQLite.
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

test("parcours complet sur la nouvelle base : connexion, commande, liste, statut", async () => {
  const { FakeAirtable } = require(path.join(ROOT, "scripts", "fake-airtable.js"));
  const { seed } = require(path.join(ROOT, "scripts", "seed.js"));
  const demo = new FakeAirtable();
  seed(demo);
  for (const [tbl, recs] of Object.entries(demo.data)) await ds.state.store.replaceAll(tbl, recs);

  const cat = await callApi("catalogue", { method: "POST", body: { user: "aloha", pw: "welkom123" } });
  assert.equal(cat.statusCode, 200, JSON.stringify(cat.body));
  assert.ok(cat.body.products.length > 3);
  const bad = await callApi("catalogue", { method: "POST", body: { user: "aloha", pw: "fout" } });
  assert.equal(bad.statusCode, 401);

  const day = new Date(Date.now() + 2 * 86400000);
  if (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
  const product = cat.body.products[0];
  const order = await callApi("order", { method: "POST", body: { user: "aloha", pw: "welkom123", items: [{ productId: product.id, quantity: 2 }], dateLivraison: day.toISOString().slice(0, 10) } });
  assert.equal(order.statusCode, 200, JSON.stringify(order.body));
  assert.match(order.body.ref || "", /^CMD-\d{4}-\d{4}$/);

  const auth = require(path.join(ROOT, "lib", "staffauth.js"));
  const cookie = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin", ""));
  const all = await callApi("allorders", { headers: { cookie } });
  assert.equal(all.statusCode, 200, JSON.stringify(all.body));
  const mine = all.body.orders.find((o) => o.ref === order.body.ref);
  assert.ok(mine, "la nouvelle commande apparaît chez le personnel");
  assert.equal(mine.statut, "Reçue");

  const upd = await callApi("updateorder", { method: "POST", headers: { cookie }, body: { id: mine.id, statut: "Prête", preparationValidee: true } });
  assert.equal(upd.statusCode, 200, JSON.stringify(upd.body));
  const again = await callApi("allorders", { headers: { cookie } });
  assert.equal(again.body.orders.find((o) => o.id === mine.id).statut, "Prête");

  const hist = await callApi("orders", { method: "POST", body: { user: "aloha", pw: "welkom123" } });
  assert.ok(hist.body.orders.some((o) => o.ref === order.body.ref), "le client voit sa commande");

  const st = await callApi("dbadmin", { headers: { cookie } });
  assert.equal(st.statusCode, 200, JSON.stringify(st.body));
  assert.equal(st.body.backend, "sqlite");
  assert.equal(st.body.reachable, true);
  assert.ok(st.body.counts.Commandes >= 1);
  const staffOnly = await callApi("dbadmin", { headers: { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "staff", "")) } });
  assert.equal(staffOnly.statusCode, 403);
});

test("migration : copie Airtable -> base, refus sans force une fois basculé, vérification", async () => {
  const auth = require(path.join(ROOT, "lib", "staffauth.js"));
  const cookie = "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin", ""));
  // Airtable simulée : 150 commandes (2 pages), 2 clients, les autres tables vides ou absentes.
  const orders = Array.from({ length: 150 }, (_, i) => ({ id: "recORD" + String(i).padStart(11, "0"), createdTime: "2026-09-01T10:00:00.000Z", fields: { "Référence": "CMD-2026-" + String(i + 1).padStart(4, "0"), Total: 10 } }));
  const tables = { Commandes: orders, Clients: [{ id: "recCLIaaaaaaaaaaa", createdTime: "2026-08-01T10:00:00.000Z", fields: { Nom: "Aloha" } }, { id: "recCLIbbbbbbbbbbb", createdTime: "2026-08-02T10:00:00.000Z", fields: { Nom: "Kaai" } }] };
  const saved = ds.state.realFetch;
  ds.state.realFetch = async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer test-token");
    const u = new URL(url);
    const tbl = decodeURIComponent(u.pathname.split("/")[3]);
    if (tbl === "Cadrage projet") return new Response(JSON.stringify({ error: { type: "TABLE_NOT_FOUND", message: "nope" } }), { status: 404 });
    const all = tables[tbl] || [];
    const start = Number(u.searchParams.get("offset") || 0);
    const body = { records: all.slice(start, start + 100) };
    if (start + 100 < all.length) body.offset = String(start + 100);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const refused = await callApi("dbadmin", { method: "POST", headers: { cookie }, body: { action: "copy" } });
    assert.equal(refused.statusCode, 409, "déjà basculé : pas d'écrasement sans force");
    const copy = await callApi("dbadmin", { method: "POST", headers: { cookie }, body: { action: "copy", force: true } });
    assert.equal(copy.statusCode, 200, JSON.stringify(copy.body));
    assert.equal(copy.body.ok, true);
    const cmd = copy.body.report.find((r) => r.table === "Commandes");
    assert.deepEqual([cmd.airtable, cmd.postgres], [150, 150]);
    const kept = await ds.state.store.get("Commandes", orders[7].id);
    assert.equal(kept.fields["Référence"], "CMD-2026-0008", "les ids Airtable sont conservés");
    assert.equal(kept.createdTime, "2026-09-01T10:00:00.000Z");
    const ver = await callApi("dbadmin", { method: "POST", headers: { cookie }, body: { action: "verify" } });
    assert.equal(ver.body.ok, true, JSON.stringify(ver.body));
    await ds.state.store.remove("Commandes", [orders[0].id]);
    const ver2 = await callApi("dbadmin", { method: "POST", headers: { cookie }, body: { action: "verify" } });
    const row = ver2.body.report.find((r) => r.table === "Commandes");
    assert.equal(ver2.body.ok, false);
    assert.equal(row.onlyAirtable, 1);
    assert.equal(row.totalAirtable - row.totalPostgres, 10);
  } finally {
    ds.state.realFetch = saved;
  }
});
