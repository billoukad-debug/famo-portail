// Performance du moteur SQL (E-01, E-04, E-05, E-06) sans changer ce qu'il répond :
// pré-filtre SQL = sur-ensemble exact de la formule JS, une lecture de table par requête
// logique, comptes légers. SQLite en mémoire ; le SQL Postgres est vérifié sur sa forme
// (paramètres liés) — il a été rejoué sur un vrai Postgres (PGlite) pendant le développement.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "team-test-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "beheer-test-code";
process.env.AIRTABLE_TOKEN = "test-token";
delete process.env.RESEND_API_KEY;
process.removeAllListeners("warning");

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const { AtEngine, sqlStore } = require(path.join(ROOT, "lib", "at-engine.js"));
const { compileFormula, sqlPrefilter, truthy } = require(path.join(ROOT, "lib", "at-formula.js"));
const sqlLib = require(path.join(ROOT, "lib", "sql.js"));
const U = (p) => `https://api.airtable.com/v0/${ds.BASE}/${p}`;
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const rid = (i) => "rec" + String(i).padStart(14, "0");

// Valeurs volontairement hétérogènes : texte, nombre, booléen, tableau, date avec fuseau,
// date non ISO, champ absent. Le pré-filtre ne doit perdre aucune ligne retenue par le JS.
const MIXED = [
  { Statut: "Reçue", Date: day(1) }, { Statut: "Facturée", Date: day(400) }, { Statut: "Facturée", Date: day(3) + "T23:30:00+05:00" },
  { Statut: "Annulée" }, { Date: "Sept 5, 2026" }, { Statut: 5 }, { Statut: ["Facturée"] }, { Actif: true }, { Actif: 1 }, { Actif: "1" }, { Actif: 0 },
  { Client: ["recAAAAAAAAAAAAAA", "recBBBBBBBBBBBBBB"] }, { Client: ["recBBBBBBBBBBBBBB"] }, { Gebruikersnaam: "Aloha" }, { Gebruikersnaam: "ÉLAN" },
  { "Référence": "CMD-2026-0001" }, { "Référence": "CMD-2026-00012" }, { "Référence": "cmd-2026-0003" }, { Date: day(0) + "T00:30:00.000Z" },
  { "Date et heure": new Date().toISOString(), Produit: "L'x" }, { Produit: "L'x" }, { Status: "Nieuw" }, { Foto: [{ id: "att1", url: "https://x.test/a.jpg", filename: "a.jpg" }] }
];
const FORMULAS = [
  "OR(AND({Statut}!='Facturée',{Statut}!='Annulée'),IS_AFTER({Date},DATEADD(TODAY(),-365,'days')))",
  "{Statut}='Facturée'", "{Statut}!='Facturée'", "{Statut}=''", "{Statut}!=''", "{Actif}=1", "{Actif}!=1", "{Actif}=0", "{Status}='Nieuw'",
  "FIND('recBBBBBBBBBBBBBB',ARRAYJOIN({Client}))", "OR(FIND('recAAAAAAAAAAAAAA',ARRAYJOIN({Client})),FIND('Aloha',ARRAYJOIN({Client})))",
  "LOWER({Gebruikersnaam})='aloha'", "LOWER({Gebruikersnaam})='élan'", "REGEX_MATCH({Référence}, \"^CMD-2026-[0-9]{4}$\")",
  "AND(IS_AFTER({Date et heure},DATEADD(NOW(),-7,'days')),{Produit}='L\\'x')", "RECORD_ID()='rec00000000000003'",
  "IS_BEFORE({Date},DATEADD(TODAY(),-2,'days'))", "NOT({Statut}='Reçue')", "{Produit}='L\\'x'", "FIND('a.jpg',{Foto})"
];

function fresh() {
  const store = sqlStore(sqlLib.sqlite(":memory:"));
  return { store, engine: new AtEngine(store, { base: ds.BASE }) };
}

test("pré-filtre SQL : même résultat que la formule JS, jamais une ligne perdue", async () => {
  const { store, engine } = fresh();
  await store.replaceAll("Commandes", MIXED.map((f, i) => ({ id: rid(i), createdTime: "2026-01-01T00:00:00.000Z", fields: f })));
  const all = await store.list("Commandes");
  let returned = 0;
  const realList = store.list;
  store.list = async (t, w) => { const rows = await realList(t, w); returned += rows.length; return rows; };
  for (const f of FORMULAS) {
    const fn = compileFormula(f);
    const expected = all.filter((r) => truthy(fn(r))).map((r) => r.id).sort();
    const got = (await engine.read("Commandes", f)).map((r) => r.id).sort();
    assert.deepEqual(got, expected, f);
  }
  store.list = realList;
  assert.equal(engine.stats.fallbacks, 0, "SQL généré accepté par SQLite");
  assert.ok(returned < all.length * FORMULAS.length / 2, "la base écarte réellement des lignes (" + returned + " lues)");
});

test("SQL généré : valeurs et noms de champs toujours liés, jamais collés dans le texte", () => {
  for (const dialect of ["pg", "sqlite"]) {
    for (const f of FORMULAS.concat(["{Nom}='x\\' OR 1=1 --'", "{a\"b}='x'"])) {
      const params = [];
      const sql = sqlPrefilter(f, dialect, (v) => { params.push(v); return "$" + (params.length + 1); });
      for (const p of params) if (String(p).length > 2 && !/^\$\."/.test(p)) assert.ok(!sql.includes(String(p)), dialect + " : " + p + " collé dans " + sql);
      assert.ok(!/Facturée|Aloha|recBBB|OR 1=1/.test(sql), dialect + " : " + sql);
    }
  }
  // Une formule hors du sous-ensemble traduit ne produit aucun pré-filtre (tout au JS).
  assert.equal(sqlPrefilter("{Total}>5", "pg", () => "$2"), "");
  assert.equal(sqlPrefilter("OR({Statut}='x',{Total}>5)", "sqlite", () => "$2"), "");
});

test("pré-filtre refusé par la base : relecture sans pré-filtre, résultat identique", async () => {
  const { store, engine } = fresh();
  await store.replaceAll("Commandes", MIXED.map((f, i) => ({ id: rid(i), createdTime: "2026-01-01T00:00:00.000Z", fields: f })));
  const realList = store.list;
  store.list = async (t, w) => { if (w) throw new Error("syntax error at or near"); return realList(t, w); };
  const log = require(path.join(ROOT, "lib", "log.js"));
  const lines = [], prev = log._setSink(lines);
  try {
    const got = await engine.read("Commandes", "{Statut}='Facturée'");
    assert.equal(got.length, 3);
  } finally { log._setSink(prev); store.list = realList; }
  assert.equal(engine.stats.fallbacks, 1);
  assert.equal(lines[0].niveau, "warn");
  assert.equal(lines[0].fn, "at-engine");
});

test("pages : une seule lecture de table par requête logique, curseurs compatibles", async () => {
  const { store, engine } = fresh();
  await store.replaceAll("Commandes", Array.from({ length: 250 }, (_, i) => ({ id: rid(i), createdTime: new Date(Date.parse("2026-01-01T00:00:00Z") + i * 1000).toISOString(), fields: { "Référence": "CMD-" + i, Total: i } })));
  let reads = 0;
  const realList = store.list;
  store.list = async (t, w) => { reads++; return realList(t, w); };
  const ids = [];
  let offset = "", pages = 0;
  do {
    const r = await engine.handle("GET", U("Commandes?sort%5B0%5D%5Bfield%5D=Total&sort%5B0%5D%5Bdirection%5D=desc" + (offset ? "&offset=" + encodeURIComponent(offset) : "")));
    assert.equal(r.status, 200);
    r.json.records.forEach((x) => ids.push(x.fields.Total));
    offset = r.json.offset || ""; pages++;
  } while (offset);
  assert.equal(pages, 3);
  assert.equal(reads, 1, "3 pages, 1 lecture (avant : une lecture complète par page)");
  assert.deepEqual(ids, Array.from({ length: 250 }, (_, i) => 249 - i));
  // Ancien format (itr100) ou curseur expiré : relecture puis découpe, comme avant.
  const old = await engine.handle("GET", U("Commandes?offset=itr200"));
  assert.equal(old.json.records.length, 50);
  const lost = await engine.handle("GET", U("Commandes?offset=itr100%2Fdeadbeef"));
  assert.equal(lost.json.records.length, 100);
  const all = await engine.handle("GET", U("Commandes?pageSize=all"));
  assert.equal(all.json.records.length, 250);
  assert.equal(all.json.offset, undefined);
  store.list = realList;
});

function mkRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = () => res;
  return res;
}
async function callApi(name, req) {
  const res = mkRes();
  await require(path.join(ROOT, "api", name + ".js"))(Object.assign({ method: "GET", headers: {}, query: {}, body: null }, req), res);
  return res;
}
const cookie = () => "famo_sess=" + encodeURIComponent(require(path.join(ROOT, "lib", "staffauth.js")).sign(Date.now() + 3600000, "admin", ""));

async function seedPortal(nOrders) {
  const { hashPassword } = require(path.join(ROOT, "lib", "clientauth.js"));
  const clients = [
    { id: "recCLIaaaaaaaaaaa", createdTime: "2026-01-01T00:00:00.000Z", fields: { Nom: "Aloha", Gebruikersnaam: "aloha", Wachtwoord: hashPassword("welkom123") } },
    { id: "recCLIbbbbbbbbbbb", createdTime: "2026-01-01T00:00:00.000Z", fields: { Nom: "Aloha Poke", Gebruikersnaam: "poke", Wachtwoord: hashPassword("x") } }
  ];
  const orders = Array.from({ length: nOrders }, (_, i) => ({ id: rid(i), createdTime: new Date(Date.parse("2026-01-01T00:00:00Z") + i * 1000).toISOString(), fields: { "Référence": "CMD-2026-" + String(i).padStart(4, "0"), Statut: i % 3 ? "Facturée" : "Reçue", Date: day(i % 500), Total: 10, Client: [clients[i % 2].id] } }));
  for (const [t, recs] of [["Clients", clients], ["Commandes", orders], ["Catalogue", [{ id: "recPRDaaaaaaaaaaa", createdTime: "2026-01-01T00:00:00.000Z", fields: { Produit: "Zalm", Actif: true } }, { id: "recPRDbbbbbbbbbbb", createdTime: "2026-01-01T00:00:00.000Z", fields: { Produit: "Oud" } }]], ["Configuratie", [{ id: "recCFGaaaaaaaaaaa", createdTime: "2026-01-01T00:00:00.000Z", fields: { Bedrijfsnaam: "FAMO", Telefoon: "03", IBAN: "BE68539007547034" } }]], ["Aanvragen", [{ id: "recAANaaaaaaaaaaa", createdTime: "2026-01-01T00:00:00.000Z", fields: { Status: "Nieuw" } }, { id: "recAANbbbbbbbbbbb", createdTime: "2026-01-01T00:00:00.000Z", fields: { Status: "Verwerkt" } }]]]) await ds.state.store.replaceAll(t, recs);
  return orders;
}

test("api/allorders : une lecture de table par table, quel que soit le nombre de pages", async () => {
  await seedPortal(250);
  const perTable = {};
  const realList = ds.state.store.list;
  ds.state.store.list = async (t, w) => { perTable[t] = (perTable[t] || 0) + 1; return realList(t, w); };
  try {
    const r = await callApi("allorders", { headers: { cookie: cookie() }, query: { all: "1" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.orders.length, 250);
    assert.deepEqual(perTable, { Clients: 1, Catalogue: 1, Commandes: 1 }, "E-01 : 1 lecture complète de Commandes par appel");
  } finally { ds.state.store.list = realList; }
});

test("api/orders : filtre client dans la formule, sur les deux moteurs (ids en SQL, noms dans Airtable)", async () => {
  const orders = await seedPortal(120);
  let returned = 0;
  const realList = ds.state.store.list;
  ds.state.store.list = async (t, w) => { const rows = await realList(t, w); if (t === "Commandes") returned += rows.length; return rows; };
  try {
    const r = await callApi("orders", { method: "POST", body: { user: "aloha", pw: "welkom123" } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    const mine = orders.filter((o, i) => i % 2 === 0);
    const inWindow = compileFormula("OR(AND({Statut}!='Facturée',{Statut}!='Annulée'),IS_AFTER({Date},DATEADD(TODAY(),-365,'days')))");
    assert.deepEqual(r.body.orders.map((o) => o.ref).sort(), mine.filter((o) => truthy(inWindow(o))).map((o) => o.fields["Référence"]).sort());
    assert.ok(returned <= 60, "E-04 : seules les commandes du client sortent de la base (" + returned + ")");
  } finally { ds.state.store.list = realList; }
  // Sémantique Airtable (scripts/fake-airtable.js) : un lien se lit par le nom du lié.
  const { clientFormula } = require(path.join(ROOT, "api", "orders.js"));
  const f = clientFormula({ id: "recCLIaaaaaaaaaaa", fields: { Nom: "Aloha" } });
  const names = { recCLIaaaaaaaaaaa: "Aloha", recCLIbbbbbbbbbbb: "Aloha Poke" };
  const asAirtable = compileFormula(f, { linkedPrimary: (id) => names[id] || id });
  const kept = orders.filter((o) => truthy(asAirtable(o)));
  assert.ok(kept.some((o) => o.fields.Client[0] === "recCLIaaaaaaaaaaa"), "Airtable retrouve le client par son nom");
  assert.ok(kept.some((o) => o.fields.Client[0] === "recCLIbbbbbbbbbbb"), "nom partiel : sur-ensemble, le filtre JS par id tranche");
  assert.equal(clientFormula({ id: "recX", fields: {} }).includes("FIND"), false, "client sans nom : fenêtre seule");
  assert.ok(clientFormula({ id: "recCLIaaaaaaaaaaa", fields: { Nom: "O'Brien" } }).includes("O\\'Brien"), "nom échappé");
});
