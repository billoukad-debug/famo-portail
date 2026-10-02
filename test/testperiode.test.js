// Testperiode afsluiten (specs/021-testgegevens-opruimen) : Beheer → Systeemstatus. Sur la vraie chaîne
// api/*.js → lib/airtable.js → lib/datastore.js → moteur SQL (SQLite en mémoire), données de scripts/seed.js.
// Vérifie : aperçu sans écriture, périmètre calculé par le serveur, archivage qui masque partout,
// remise en place, purge (seulement les archivées, fichiers et mouvements liés, stock intact, journal),
// confirmations tapées et back-up fraîche exigées par le serveur, remise à zéro de la numérotation.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = "team-test-code-1";
process.env.ADMIN_CODE = "beheer-test-code-1";
process.env.AIRTABLE_TOKEN = "patTESTTOKEN.secret-value-not-to-leak";
process.env.SESSION_SECRET = "session-secret-not-to-leak";
// E-mails « activés » mais interceptés ci-dessous (ds.state.realFetch) : jamais un envoi réel.
process.env.RESEND_API_KEY = "test-key-intercepted";
process.removeAllListeners("warning"); // node:sqlite est « expérimental »

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const { FakeAirtable } = require(path.join(ROOT, "scripts", "fake-airtable.js"));
const { seed } = require(path.join(ROOT, "scripts", "seed.js"));
const { TABLES } = require(path.join(ROOT, "lib", "at-engine.js"));

// lib/datastore.js a remplacé fetch : Airtable → moteur SQL. Tout le reste (Resend…) est intercepté ici,
// jamais envoyé sur le réseau.
const MAILS = [];
const engineFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input && input.url) || String(input);
  if (url.startsWith("https://api.airtable.com/") || url.startsWith("https://content.airtable.com/")) return engineFetch(input, init);
  if (url.startsWith("https://api.resend.com/")) { MAILS.push(JSON.parse(init.body)); return { status: 200, ok: true, json: async () => ({ id: "mail" + MAILS.length }) }; }
  throw new Error("Réseau refusé dans les tests : " + url);
};

const ADMIN = { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin")) };
const STAFF = { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "staff")) };
const Y = auth.brusselsYear();
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
  const handler = require(path.join(ROOT, "api", name + ".js"));
  const res = mkRes();
  const headers = Object.assign({ "x-forwarded-for": "10.21.0." + (++ip % 250) }, req.headers || {});
  await handler(Object.assign({ method: "GET", query: {}, body: null }, req, { headers }), res);
  return res;
}
const beheer = (body, headers) => api("onboarding", { method: "POST", headers: headers || ADMIN, body });
const client = (name, body) => api(name, { method: "POST", body: Object.assign({ user: "aloha", pw: "welkom123" }, body || {}) });
const orders = async () => (await store().list("Commandes"));
const byRef = async (ref) => (await orders()).find((r) => r.fields["Référence"] === ref);
const ref = (n) => "CMD-" + Y + "-" + String(n).padStart(4, "0");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const HOUR = 3600000;
const CUTOFF = () => new Date(Date.now() - HOUR).toISOString();

// Tout ce que la base contient (tables métier, internes, fichiers, back-ups) : « rien n'est écrit ».
async function everything() {
  const out = {};
  for (const t of TABLES.concat(["Journaal", "Compteurs"])) out[t] = (await store().list(t)).map((r) => [r.id, r.version, r.fields]);
  out.files = await store().fileCount();
  out.snaps = (await store().snapshots()).length;
  return JSON.stringify(out);
}

// Données : la démo de seed.js, dont les 7 commandes deviennent des essais d'il y a 2 h (CMD-Y-0001 … 0007,
// FA-Y-0001 / 0002, CN-Y-0001), plus UNE vraie commande créée maintenant (CMD-Y-0008), des fichiers,
// des mouvements de stock et des lignes de journal.
test.beforeEach(async () => {
  auth.noteGeneration(0);
  MAILS.length = 0;
  const demo = new FakeAirtable();
  seed(demo);
  const old = new Date(Date.now() - 2 * HOUR).toISOString();
  demo.data.Commandes.forEach((r, i) => {
    r.createdTime = old;
    r.fields["Référence"] = ref(i + 1);
    if (r.fields["Factuurnummer"]) r.fields["Factuurnummer"] = r.fields["Factuurnummer"].replace(/^FA-\d{4}-/, "FA-" + Y + "-");
  });
  const o2 = demo.data.Commandes[1].fields;
  o2["Creditnotas"] = JSON.stringify([{ nummer: "CN-" + Y + "-0001", lignes: "Saumon frais × 1 kg [€16.00]", montant: 16, le: new Date().toISOString(), motif: "Test" }]);
  o2["Creditnota nummer"] = "CN-" + Y + "-0001"; o2["Creditnota montant"] = 16; o2["Creditnota lignes"] = "Saumon frais × 1 kg [€16.00]";
  const aloha = demo.data.Clients.find((c) => c.fields["Nom"] === "Aloha Poke Bowls").id;
  demo.data.Commandes.push({ id: "recREAL0000000001", createdTime: new Date().toISOString(), fields: { "Référence": ref(8), "Date": new Date().toISOString().slice(0, 10), "Lignes (produits / quantités)": "Cabillaud × 1 kg [€22.00]", "Statut": "Reçue", "Statut paiement": "En attente", "Total": 22, "Client": [aloha] } });
  for (const [tbl, recs] of Object.entries(demo.data)) await store().replaceAll(tbl, recs);
  await store().replaceAll("Journaal", []);
  await store().replaceAll("Compteurs", []);
  await store().clearFiles();
  for (const s of await store().snapshots()) await store().deleteSnapshot(s.id);
  const first = await byRef(ref(1));
  // Signature de livraison (pièce jointe hébergée) + un fichier orphelin de la même commande + un fichier de la vraie commande.
  const up = await (await fetch("https://content.airtable.com/v0/appcdduLth9iGX8I0/" + first.id + "/" + encodeURIComponent("Preuve de livraison") + "/uploadAttachment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: "image/png", filename: "handtekening-x.png", file: PNG }) })).json();
  assert.ok(!up.error, JSON.stringify(up));
  await store().putFile({ id: "attORPHAN00000001", recordId: first.id, contentType: "image/png", filename: "foto-y.png", size: 10, data: PNG });
  await store().putFile({ id: "attREAL0000000001", recordId: "recREAL0000000001", contentType: "image/png", filename: "foto-z.png", size: 10, data: PNG });
  const mv = (r, f) => ({ id: r, createdTime: old, fields: Object.assign({ "Date et heure": old, "Quantité": -1, "Produit": "Saumon frais" }, f) });
  await store().replaceAll("Mouvements de stock", [
    mv("recMV1", { "Mouvement": ref(1) + " — Saumon frais", Type: "Sortie livraison", "Référence commande": ref(1) }),
    mv("recMV2", { "Mouvement": ref(2) + " — Saumon frais", Type: "Sortie livraison", "Référence commande": ref(2) }),
    mv("recMV3", { "Mouvement": ref(8) + " — Cabillaud", Type: "Sortie livraison", "Référence commande": ref(8) }),
    mv("recMV4", { "Mouvement": "Inventaris", Type: "Correction inventaire", "Quantité": 12, "Note": "Hertelling" })
  ]);
  const J = require(path.join(ROOT, "lib", "journal.js"));
  await J.log({ wie: "Mohsen", rol: "staff", actie: "Status → Facturée", object: "Commandes", record: first.id, referentie: ref(1), wijzigingen: [{ veld: "Réceptionné par", voor: "", na: "Kenji" }] });
});

const voorbeeld = (extra) => beheer(Object.assign({ action: "testVoorbeeld", voor: CUTOFF() }, extra || {}));
async function archiveer(extra) {
  const v = await voorbeeld(extra);
  assert.equal(v.statusCode, 200, JSON.stringify(v.body));
  const r = await beheer(Object.assign({ action: "testArchiveren", voor: CUTOFF(), verwacht: v.body.scope.bestellingen }, extra || {}));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  return r.body;
}
const backup = async () => { const r = await api("dbadmin", { method: "POST", headers: ADMIN, body: { action: "export" } }); assert.equal(r.statusCode, 200, JSON.stringify(r.body)); };

test("voorbeeld : comptes exacts, périmètre du serveur, et rien n'est écrit (ni commande, ni journal, ni compteur)", async () => {
  const before = await everything();
  const r = await voorbeeld();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const s = r.body.scope;
  assert.equal(s.bestellingen, 7, "les 7 essais, pas la vraie commande créée après la date");
  assert.deepStrictEqual(s.perStatus, { "Facturée": 2, "Prête": 3, "Reçue": 2 });
  assert.deepStrictEqual(s.facturen, ["FA-" + Y + "-0001", "FA-" + Y + "-0002"]);
  assert.deepStrictEqual(s.creditnotas, ["CN-" + Y + "-0001"]);
  assert.equal(s.leveringsbonnen, 5);
  assert.equal(s.bestanden, 2, "signature + fichier orphelin de la commande");
  assert.equal(s.voorraadbewegingen, 2);
  assert.equal(s.journaal, 1);
  assert.deepStrictEqual(s.referenties, { eerste: ref(1), laatste: ref(7) });
  assert.equal(s.klanten.reduce((n, k) => n + k.bestellingen, 0), 7);
  assert.equal(r.body.buiten.bestellingen, 1, "la vraie commande reste en dehors");
  assert.equal(r.body.gearchiveerd.bestellingen, 0);
  assert.equal(r.body.backup.serverCheck, true);
  assert.equal(r.body.backup.vers, false);
  const fa = r.body.nummering.find((n) => n.serie === "FA-" + Y);
  assert.equal(fa.magHerstarten, false);
  assert.match(fa.reden, /2/);
  // behalve : une référence gardée sort du périmètre.
  const b = await voorbeeld({ behalve: [ref(3), "  "] });
  assert.equal(b.body.scope.bestellingen, 6);
  assert.equal(b.body.buiten.bestellingen, 2);
  // Date dans le futur refusée, date illisible refusée.
  assert.equal((await voorbeeld({ voor: new Date(Date.now() + 2 * HOUR).toISOString() })).statusCode, 400);
  assert.equal((await voorbeeld({ voor: "gisteren" })).statusCode, 400);
  assert.equal(await everything(), before, "aucune écriture, pas même au journal");
});

test("personnel et sans session refusés, garde A-10 d'abord ; rien n'est écrit", async () => {
  const before = await everything();
  for (const action of ["testVoorbeeld", "testArchiveren", "testTerugzetten", "testVerwijderen", "testNummering"]) {
    const body = { action, voor: CUTOFF(), verwacht: 7, confirm: "VERWIJDER TESTS", series: ["FA-" + Y] };
    const s = await beheer(body, STAFF);
    assert.ok(s.statusCode === 401 || s.statusCode === 403, action + " personnel : " + s.statusCode);
    const n = await beheer(body, {});
    assert.ok(n.statusCode === 401 || n.statusCode === 403, action + " sans session : " + n.statusCode);
    const g = await beheer(body, Object.assign({ origin: "https://evil.example", host: "portaal.example", "content-type": "application/json" }, ADMIN));
    assert.equal(g.statusCode, 403, action + " autre origine");
  }
  assert.equal(await everything(), before);
});

test("archiveren : comptes attendus vérifiés, puis les essais disparaissent partout (personnel, client, documents, rapports)", async () => {
  const v = await voorbeeld();
  const stale = await beheer({ action: "testArchiveren", voor: CUTOFF(), verwacht: v.body.scope.bestellingen + 1 });
  assert.equal(stale.statusCode, 409, "aperçu périmé");
  assert.equal((await orders()).filter((r) => r.fields.Test).length, 0, "rien n'est marqué");
  assert.equal((await beheer({ action: "testArchiveren", voor: new Date(Date.now() - 48 * HOUR).toISOString(), verwacht: 0 })).statusCode, 400, "périmètre vide");

  const r = await archiveer();
  assert.equal(r.gearchiveerd, 7);
  const all = await orders();
  assert.equal(all.filter((o) => o.fields.Test && o.fields["Test gemarkeerd op"]).length, 7);
  assert.ok(!(await byRef(ref(8))).fields.Test, "la vraie commande n'est pas touchée");
  const jl = (await store().list("Journaal")).map((x) => x.fields).find((f) => f.Actie === "Testperiode: gearchiveerd");
  assert.ok(jl, "ligne de journal");
  assert.match(jl.Wijzigingen, /"7"/);

  // Personnel : listes, pastilles, documents, rapportage (allorders, avec et sans fenêtre, paginé).
  for (const q of [{}, { all: "1" }, { limit: "100" }]) {
    const a = await api("allorders", { headers: STAFF, query: q });
    assert.equal(a.statusCode, 200);
    assert.deepStrictEqual(a.body.orders.map((o) => o.ref), [ref(8)], JSON.stringify(q));
  }
  // Client : liste, document, annulation.
  const mine = await client("orders");
  assert.equal(mine.statusCode, 200, JSON.stringify(mine.body));
  assert.deepStrictEqual(mine.body.orders.map((o) => o.ref), [ref(8)]);
  assert.equal((await client("klantdoc", { ref: ref(1) })).statusCode, 404);
  assert.equal((await client("klantorder", { action: "cancel", ref: ref(6) })).statusCode, 404);
  assert.equal((await byRef(ref(6))).fields["Statut"], "Reçue", "commande test non annulée");
  // Beheer : comptes, marge.
  const st = await api("onboarding", { headers: ADMIN });
  assert.equal(st.body.status.orders, 1);
  const cs = await api("config", { headers: ADMIN, query: { status: "1" } });
  assert.equal(cs.body.status.orders, 1);
  const m = await api("marge", { headers: ADMIN, query: { van: Y - 1 + "-01-01", tot: Y + 1 + "-12-31" } });
  assert.equal(m.statusCode, 200);
  assert.equal(m.body.totaal.omzet, 0, "aucun chiffre d'affaires d'essai");
  // Écritures refusées sur une commande test.
  const t1 = (await byRef(ref(1))).id, t6 = (await byRef(ref(6))).id;
  const u = await api("updateorder", { method: "POST", headers: STAFF, body: { id: t6, statut: "Prête" } });
  assert.equal(u.statusCode, 409); assert.match(u.body.error, /[Tt]est/);
  assert.equal((await api("bewijs", { method: "POST", headers: STAFF, body: { id: t1, soort: "foto", contentType: "image/png", base64: PNG } })).statusCode, 409);
  assert.equal((await api("export", { headers: ADMIN, query: { format: "ubl", id: t1 } })).statusCode, 409);
});

test("archiveren : traçabilité des lots, détection de doublon et relances ignorent les essais", async () => {
  // Lot livré dans un essai ET dans la vraie commande ; config Portaal + relances pour le cron.
  const lot = { id: "recLOT0000000001", createdTime: new Date().toISOString(), fields: { Lotnummer: "L-1", Produit: "Cabillaud", Actief: true } };
  await store().insert("Lots", [lot]);
  const snap = JSON.stringify({ Cabillaud: [{ id: lot.id, lotnummer: "L-1" }] });
  const t4 = await byRef(ref(4)), real = await byRef(ref(8));
  await store().update("Commandes", t4.id, Object.assign({}, t4.fields, { Lots: snap }), t4.version);
  // Facture d'essai et vraie facture, toutes deux échues depuis longtemps.
  const old = new Date(Date.now() - 60 * 86400000).toISOString();
  const t2 = await byRef(ref(2));
  await store().update("Commandes", t2.id, Object.assign({}, t2.fields, { "Facturée le": old }), t2.version);
  await store().update("Commandes", real.id, Object.assign({}, real.fields, { Lots: snap, Statut: "Facturée", Factuurnummer: "FA-" + Y + "-0003", "Facturée le": old }), real.version);
  const cfg = (await store().list("Configuratie"))[0];
  await store().update("Configuratie", cfg.id, Object.assign({}, cfg.fields, { Facturatie: "Portaal", "Herinneringen aan": true }), cfg.version);
  // Doublon : la même commande que l'essai d'aujourd'hui, déjà passée par le client.
  const body = { items: [{ productId: (await store().list("Catalogue")).find((p) => p.fields.Produit === "Cabillaud").id, quantity: 2 }] };
  const firstOrder = await client("order", Object.assign({ idempotencyKey: "key-aaaaaaaa-1" }, body));
  assert.equal(firstOrder.statusCode, 200, JSON.stringify(firstOrder.body));
  const twin = await client("order", Object.assign({ idempotencyKey: "key-aaaaaaaa-2" }, body));
  assert.equal(twin.statusCode, 409, "témoin : doublon détecté avant l'archivage");
  // La commande du jour est un essai aussi : on la vieillit pour qu'elle tombe dans le périmètre.
  const fo = (await orders()).find((o) => o.id === firstOrder.body.id);
  await store().replaceAll("Commandes", (await orders()).map((o) => o.id === fo.id ? Object.assign({}, o, { createdTime: new Date(Date.now() - 2 * HOUR).toISOString() }) : o));

  await archiveer();
  const tr = await api("lots", { headers: STAFF, query: { trace: "L-1" } });
  assert.equal(tr.statusCode, 200);
  assert.deepStrictEqual(tr.body.leveringen.map((l) => l.ref), [ref(8)]);
  const again = await client("order", Object.assign({ idempotencyKey: "key-aaaaaaaa-3" }, body));
  assert.equal(again.statusCode, 200, "plus de doublon contre un essai : " + JSON.stringify(again.body));
  const same = await client("order", Object.assign({ idempotencyKey: "key-aaaaaaaa-1" }, body));
  assert.notEqual(same.body.id, firstOrder.body.id, "la clé d'un essai ne renvoie pas l'essai");
  MAILS.length = 0;
  const out = await require(path.join(ROOT, "lib", "reminders.js")).run({ now: new Date() });
  assert.deepStrictEqual(out.details.map((d) => [d.ref, d.ok]), [[ref(8), true]], "relance seulement pour la vraie facture");
  assert.equal(MAILS.filter((m) => /FA-\d{4}-0002/.test(JSON.stringify(m))).length, 0, "aucun e-mail pour la facture d'essai");
  assert.ok(!(await byRef(ref(2))).fields["Herinnering 1 op"]);
});

test("terugzetten : tout redevient exactement comme avant", async () => {
  const before = JSON.stringify((await orders()).map((o) => [o.id, o.fields]));
  await archiveer();
  const r = await beheer({ action: "testTerugzetten" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.teruggezet, 7);
  assert.equal(JSON.stringify((await orders()).map((o) => [o.id, o.fields])), before);
  assert.equal((await api("allorders", { headers: STAFF, query: { all: "1" } })).body.orders.length, 8);
  assert.ok((await store().list("Journaal")).some((x) => x.fields.Actie === "Testperiode: teruggezet"));
  // Une seule référence.
  await archiveer();
  await beheer({ action: "testTerugzetten", refs: [ref(3)] });
  assert.equal((await orders()).filter((o) => o.fields.Test).length, 6);
});

test("verwijderen : confirmation tapée et back-up fraîche exigées par le serveur", async () => {
  assert.equal((await beheer({ action: "testVerwijderen", confirm: "VERWIJDER TESTS", verwacht: 0 })).statusCode, 400, "rien d'archivé : rien à supprimer");
  await archiveer();
  const before = await everything();
  assert.equal((await beheer({ action: "testVerwijderen", confirm: "verwijder", verwacht: 7 })).statusCode, 400);
  assert.equal((await beheer({ action: "testVerwijderen", verwacht: 7 })).statusCode, 400);
  const nb = await beheer({ action: "testVerwijderen", confirm: "VERWIJDER TESTS", verwacht: 7 });
  assert.equal(nb.statusCode, 409); assert.equal(nb.body.needBackup, true);
  assert.equal(await everything(), before, "aucune écriture sur un refus");
  // Back-up trop vieille (31 min) : toujours refusé.
  await store().putSnapshot({ id: "snpOLD00000000001", createdTime: new Date(Date.now() - 31 * 60000).toISOString(), kind: "export", size: 1, sha256: "", note: "" }, ["eA=="]);
  const before2 = await everything();
  assert.equal((await beheer({ action: "testVerwijderen", confirm: "VERWIJDER TESTS", verwacht: 7 })).statusCode, 409);
  assert.equal(await everything(), before2, "aucune écriture sur un refus");
  await backup();
  assert.equal((await beheer({ action: "testVerwijderen", confirm: "VERWIJDER TESTS", verwacht: 6 })).statusCode, 409, "compte attendu périmé");
});

test("verwijderen : seulement les essais archivés ; fichiers et mouvements liés effacés, stock intact, une ligne de journal", async () => {
  await archiveer({ behalve: [ref(3)] }); // CMD-…-0003 gardée : pas archivée, donc jamais supprimée
  const stock = JSON.stringify(await store().list("Stock"));
  await backup();
  const r = await beheer({ action: "testVerwijderen", confirm: " VERWIJDER TESTS ", verwacht: 6 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.verwijderd.bestellingen, 6);
  assert.deepStrictEqual((await orders()).map((o) => o.fields["Référence"]).sort(), [ref(3), ref(8)]);
  assert.deepStrictEqual((await store().list("Mouvements de stock")).map((m) => m.id).sort(), ["recMV3", "recMV4"]);
  assert.equal(await store().fileCount(), 1, "seul le fichier de la vraie commande reste");
  assert.ok(await store().getFile("attREAL0000000001"));
  assert.equal(JSON.stringify(await store().list("Stock")), stock, "quantités en stock identiques");
  const lines = (await store().list("Journaal")).map((x) => x.fields);
  const sum = lines.filter((f) => f.Actie === "Testperiode: definitief verwijderd");
  assert.equal(sum.length, 1);
  assert.match(sum[0].Wijzigingen, /FA-\d{4}-0001/);
  assert.doesNotMatch(JSON.stringify(sum[0]), /Kenji|Aloha|Nora|Kaai|keuken@/, "aucune donnée personnelle dans la synthèse");
  assert.ok(lines.some((f) => f.Actie === "Status → Facturée"), "les lignes d'audit existantes restent");
  // Plus rien à supprimer.
  assert.equal((await beheer({ action: "testVerwijderen", confirm: "VERWIJDER TESTS", verwacht: 0 })).statusCode, 400);
});

test("nummering : refusée tant qu'un document numéroté existe ; après la purge, la facture suivante est 0001 (SQL et Airtable)", async () => {
  const N = require(path.join(ROOT, "lib", "commande", "nummering.js"));
  // Compteur déjà en route : le prochain FA serait 0003.
  assert.equal(await N.nextNumber("Factuurnummer", "FA"), "FA-" + Y + "-0003");
  await backup();
  const blocked = await beheer({ action: "testNummering", series: ["FA-" + Y], confirm: "HERSTART NUMMERING" });
  assert.equal(blocked.statusCode, 409); assert.match(blocked.body.error, /FA-/);
  await archiveer();
  assert.equal((await beheer({ action: "testNummering", series: ["FA-" + Y], confirm: "HERSTART NUMMERING" })).statusCode, 409, "essais archivés mais encore là : refus (pas de doublon possible)");
  await beheer({ action: "testVerwijderen", confirm: "VERWIJDER TESTS", verwacht: 7 });
  const v = await voorbeeld();
  const by = Object.fromEntries(v.body.nummering.map((n) => [n.serie, n]));
  assert.equal(by["FA-" + Y].magHerstarten, true);
  assert.equal(by["CN-" + Y].magHerstarten, true);
  assert.equal(by["CMD-" + Y].magHerstarten, false, "la vraie commande CMD-…-0008 garde la série");
  assert.equal((await beheer({ action: "testNummering", series: ["FA-" + Y], confirm: "ja" })).statusCode, 400);
  assert.equal((await beheer({ action: "testNummering", series: ["CMD-" + Y], confirm: "HERSTART NUMMERING" })).statusCode, 409);
  assert.equal((await beheer({ action: "testNummering", series: ["XX-" + Y], confirm: "HERSTART NUMMERING" })).statusCode, 400);
  // Back-up trop vieille : refus.
  for (const s of await store().snapshots()) await store().deleteSnapshot(s.id);
  assert.equal((await beheer({ action: "testNummering", series: ["FA-" + Y], confirm: "HERSTART NUMMERING" })).statusCode, 409);
  await backup();
  const ok = await beheer({ action: "testNummering", series: ["FA-" + Y, "CN-" + Y], confirm: "HERSTART NUMMERING" });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(await N.nextNumber("Factuurnummer", "FA"), "FA-" + Y + "-0001", "moteur SQL : compteur remis à zéro");
  assert.equal(await N.maxNumber("Factuurnummer", "FA", Y), 0, "chemin Airtable (max + 1) : plus aucun numéro restant");
  assert.equal(await N.maxNumber("Creditnota nummer", "CN", Y), 0);
  assert.ok((await store().list("Journaal")).some((x) => x.fields.Actie === "Testperiode: nummering herstart"));
});
