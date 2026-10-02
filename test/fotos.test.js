"use strict";
// Spec 018 : plusieurs photos par produit (max 6, la première = principale), ordre et suppression
// décidés par le serveur (ids existants seulement), réponses Beheer / catalogue / Voorraad / Invoeren.
// SQLite en mémoire, aucun appel réseau.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY;
global.fetch = async (url) => { throw new Error("appel réseau inattendu : " + url); };
process.removeAllListeners("warning"); // node:sqlite est « expérimental »

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const photo = require(path.join(ROOT, "lib", "photo.js"));

const H = { host: "portaal.famo.test", origin: "https://portaal.famo.test", "content-type": "application/json" };
const cookie = (role) => Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) }, H);
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, getHeader(k) { return this.headers[String(k).toLowerCase()]; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, end() { return this; } }; }
async function call(file, body, opts) {
  const res = mkRes();
  await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || cookie("admin"), query: (opts && opts.query) || {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fotos = async (id) => (await store().get("Catalogue", id)).fields["Foto"] || [];
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ffa6c1f10000000049454e44ae426082", "hex");
const png = (n) => Buffer.concat([PNG, Buffer.from([n])]).toString("base64"); // contenus distincts
const upload = (id, n, extra, headers) => call("onboarding.js", Object.assign({ action: "uploadFoto", id, contentType: "image/png", filename: "vis-" + n + ".png", base64: png(n) }, extra || {}), headers ? { headers } : undefined);
const setFotos = (id, order, headers) => call("onboarding.js", { action: "setFotos", id, order }, headers ? { headers } : undefined);

async function seed() {
  const pw = ca.hashPassword("geheim123");
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6 })]);
  await store().replaceAll("Catalogue", [
    rec("recP1", { Produit: "Scampi", Kaliber: "16/20", "Prix de base": 15, "Unité": "kg", Actif: true, Volgorde: 1 }),
    rec("recP2", { Produit: "Zalm", "Prix de base": 12.5, "Unité": "kg", Actif: true, Volgorde: 2 })
  ]);
  await store().replaceAll("Stock", [rec("recS1", { Produit: "Scampi", "Quantité disponible": 4, "Seuil bas": 1 }), rec("recS2", { Produit: "Zalm", "Quantité disponible": 2, "Seuil bas": 1 })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "a", Wachtwoord: pw })]);
  for (const t of ["Prix négociés", "Commandes", "Aanvragen", "Medewerkers", "Journaal"]) await store().replaceAll(t, []);
  await store().clearFiles();
}

test("lib/photo : photoUrls garde toutes les images sûres, dans l'ordre ; photoUrl = la première", () => {
  const list = [
    { id: "attA", type: "image/png", url: "/api/foto?id=attAAAAAAAAAAAAAA" },
    { id: "attB", type: "image/png", url: "data:image/png;base64,AAAA" },
    { id: "attC", type: "application/pdf", url: "https://dl.airtable.com/x.pdf" },
    { id: "attD", type: "image/jpeg", url: "https://dl.airtable.com/full.jpg", thumbnails: { large: { url: "https://dl.airtable.com/large.jpg" } } },
    { id: "attE", type: "image/png", url: "javascript:alert(1)" }
  ];
  assert.deepStrictEqual(photo.photoUrls(list), ["/api/foto?id=attAAAAAAAAAAAAAA", "https://dl.airtable.com/large.jpg"]);
  assert.deepStrictEqual(photo.photoList(list), [{ id: "attA", url: "/api/foto?id=attAAAAAAAAAAAAAA" }, { id: "attD", url: "https://dl.airtable.com/large.jpg" }]);
  assert.equal(photo.photoUrl(list), "/api/foto?id=attAAAAAAAAAAAAAA");
  assert.deepStrictEqual(photo.photoUrls(null), []);
  assert.equal(photo.photoUrl([]), "");
});

test("uploadFoto add:true ajoute jusqu'à 6 photos ; la 7e est refusée ; sans add on remplace", async () => {
  await seed();
  for (let n = 1; n <= 6; n++) {
    const r = await upload("recP1", n, { add: true });
    assert.equal(r.statusCode, 200, "photo " + n + " : " + JSON.stringify(r.payload));
  }
  let list = await fotos("recP1");
  assert.equal(list.length, 6, "six photos gardées");
  assert.deepStrictEqual(list.map((a) => a.filename), [1, 2, 3, 4, 5, 6].map((n) => "vis-" + n + ".png"), "ordre d'ajout, la première reste principale");
  for (const a of list) assert.ok(await store().getFile(a.id), "fichier en base : " + a.id);
  const seventh = await upload("recP1", 7, { add: true });
  assert.equal(seventh.statusCode, 400);
  assert.match(seventh.payload.error, /Maximaal 6 foto's/);
  assert.equal((await fotos("recP1")).length, 6, "rien ajouté");
  // Type et octets toujours contrôlés en mode ajout.
  const gif = await call("onboarding.js", { action: "uploadFoto", id: "recP2", add: true, contentType: "image/gif", filename: "x.gif", base64: "R0lGODlhAQABAAAAACw=" });
  assert.equal(gif.statusCode, 400);
  const fake = await call("onboarding.js", { action: "uploadFoto", id: "recP2", add: true, contentType: "image/png", filename: "x.png", base64: Buffer.from("<svg onload=alert(1)>").toString("base64") });
  assert.equal(fake.statusCode, 400);
  assert.equal((await fotos("recP2")).length, 0);
  // Sans add : comportement d'avant (une seule photo, les anciens fichiers effacés).
  const old = (await fotos("recP1")).map((a) => a.id);
  const rep = await upload("recP1", 9);
  assert.equal(rep.statusCode, 200, JSON.stringify(rep.payload));
  list = await fotos("recP1");
  assert.equal(list.length, 1);
  assert.equal(list[0].filename, "vis-9.png");
  for (const id of old) assert.equal(await store().getFile(id), null, "ancien fichier supprimé : " + id);
});

test("uploadFoto add:true : beheerder seul, garde d'origine", async () => {
  await seed();
  assert.equal((await upload("recP1", 1, { add: true }, cookie("staff"))).statusCode, 401);
  assert.equal((await upload("recP1", 1, { add: true }, H)).statusCode, 401);
  const evil = Object.assign({}, cookie("admin"), { origin: "https://evil.example" });
  assert.equal((await upload("recP1", 1, { add: true }, evil)).statusCode, 403);
  assert.equal((await fotos("recP1")).length, 0);
});

test("setFotos : ordre du beheerder, ids inconnus ignorés, fichiers retirés supprimés, journal", async () => {
  await seed();
  for (let n = 1; n <= 3; n++) assert.equal((await upload("recP1", n, { add: true })).statusCode, 200);
  const [a, b, c] = (await fotos("recP1")).map((x) => x.id);
  // Nouvelle principale : c ; b retirée ; un id inconnu et une « URL » du navigateur ignorés.
  const r = await setFotos("recP1", [c, "attONBEKEND00000", a, "https://evil.example/x.png", c]);
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const after = await fotos("recP1");
  assert.deepStrictEqual(after.map((x) => x.id), [c, a], "ordre gardé, doublon et inconnus ignorés");
  assert.match(after[0].url, /^\/api\/foto\?id=att[A-Za-z0-9]{14}$/, "objet d'origine conservé (url, type)");
  assert.equal(after[0].type, "image/png");
  assert.equal(await store().getFile(b), null, "fichier retiré effacé de famo_files");
  assert.ok(await store().getFile(a) && await store().getFile(c), "les autres restent");
  const prod = r.payload.products.find((p) => p.id === "recP1");
  assert.deepStrictEqual(prod.fotos.map((f) => f.id), [c, a], "réponse Beheer à jour");
  assert.equal(prod.foto, prod.fotos[0].url);
  const j = (await store().list("Journaal")).map((x) => x.fields);
  const entry = j.find((x) => x.Actie === "setFotos");
  assert.ok(entry, "journalisé : " + JSON.stringify(j.map((x) => x.Actie)));
  assert.equal(entry.Object, "Catalogue");
  assert.equal(entry.Referentie, "Scampi");
  assert.match(entry.Wijzigingen, /Foto/);
  assert.doesNotMatch(entry.Wijzigingen, /base64/);
  // Tout supprimer est permis.
  const none = await setFotos("recP1", []);
  assert.equal(none.statusCode, 200, JSON.stringify(none.payload));
  assert.equal((await fotos("recP1")).length, 0);
  assert.equal(await store().getFile(a), null);
  assert.equal(await store().getFile(c), null);
});

test("setFotos : validation, personnel et sans session refusés, garde, produit inconnu", async () => {
  await seed();
  for (let n = 1; n <= 2; n++) await upload("recP1", n, { add: true });
  const ids = (await fotos("recP1")).map((x) => x.id);
  const rev = ids.slice().reverse();
  assert.equal((await setFotos("recP1", rev, cookie("staff"))).statusCode, 401, "personnel");
  assert.equal((await setFotos("recP1", rev, H)).statusCode, 401, "sans session");
  assert.equal((await setFotos("recP1", rev, Object.assign({}, cookie("admin"), { origin: "https://evil.example" }))).statusCode, 403, "garde A-10");
  assert.equal((await setFotos("recP1", rev, Object.assign({}, cookie("admin"), { "content-type": "text/plain" }))).statusCode, 415, "JSON exigé");
  assert.deepStrictEqual((await fotos("recP1")).map((x) => x.id), ids, "rien n'a bougé");
  assert.equal((await setFotos("recP1", "pas une liste")).statusCode, 400);
  assert.equal((await setFotos("recP1", new Array(40).fill(ids[0]))).statusCode, 400, "liste démesurée");
  assert.equal((await setFotos("../x", rev)).statusCode, 400);
  assert.equal((await setFotos("recPONBEKEND", rev)).statusCode, 404);
  assert.deepStrictEqual((await fotos("recP1")).map((x) => x.id), ids);
});

test("moteur : upload ajoute (comme Airtable) ; PATCH [{id}] garde la pièce jointe existante, id inconnu refusé", async () => {
  await seed();
  const up = (n) => ds.state.engine.handle("POST", "https://content.airtable.com/v0/appcdduLth9iGX8I0/recP2/Foto/uploadAttachment", { contentType: "image/png", filename: "z" + n + ".png", file: png(n) });
  assert.equal((await up(1)).status, 200);
  assert.equal((await up(2)).status, 200);
  const two = await fotos("recP2");
  assert.equal(two.length, 2, "ajoutée, pas remplacée");
  const patch = (fields) => ds.state.engine.handle("PATCH", "https://api.airtable.com/v0/appcdduLth9iGX8I0/Catalogue/recP2", { fields });
  const r = await patch({ Foto: [{ id: two[1].id }, { id: two[0].id }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual((await fotos("recP2")), [two[1], two[0]], "objets stockés repris tels quels");
  const bad = await patch({ Foto: [{ id: "attINCONNU000000" }] });
  assert.equal(bad.status, 422);
  assert.equal((await fotos("recP2")).length, 2, "rien changé");
  assert.equal((await patch({ Foto: [{ id: two[0].id }] })).status, 200);
  assert.equal(await store().getFile(two[1].id), null, "fichier retiré effacé");
});

test("réponses : catalogue client (fotos), Voorraad (foto + kaliber), Invoeren (foto), Beheer (fotos)", async () => {
  await seed();
  for (let n = 1; n <= 3; n++) await upload("recP1", n, { add: true });
  const ids = (await fotos("recP1")).map((x) => x.id);
  const urls = ids.map((id) => "/api/foto?id=" + id);
  const beheer = await call("onboarding.js", null, { method: "GET" });
  assert.equal(beheer.statusCode, 200);
  const bp = beheer.payload.products.find((p) => p.id === "recP1");
  assert.deepStrictEqual(bp.fotos, ids.map((id, i) => ({ id, url: urls[i] })));
  assert.equal(bp.foto, urls[0]);
  assert.deepStrictEqual(beheer.payload.products.find((p) => p.id === "recP2").fotos, []);

  const cat = await call("catalogue.js", { user: "a", pw: "geheim123" }, { headers: H });
  assert.equal(cat.statusCode, 200, JSON.stringify(cat.payload));
  const cp = cat.payload.products.find((p) => p.id === "recP1");
  assert.deepStrictEqual(cp.fotos, urls, "le client voit toutes les vues, dans l'ordre");
  assert.equal(cp.foto, urls[0], "foto = la principale (inchangé)");
  assert.deepStrictEqual(cat.payload.products.find((p) => p.id === "recP2").fotos, []);
  assert.ok(!JSON.stringify(cat.payload).includes("famo_files"), "rien d'interne");

  const st = await call("stock.js", null, { method: "GET", headers: cookie("staff") });
  assert.equal(st.statusCode, 200, JSON.stringify(st.payload));
  const si = st.payload.items.find((i) => i.product === "Scampi");
  assert.equal(si.foto, urls[0]);
  assert.equal(si.kaliber, "16/20");
  const zi = st.payload.items.find((i) => i.product === "Zalm");
  assert.equal(zi.foto, "");
  assert.equal(zi.kaliber, "");

  const inv = await call("staff.js", null, { method: "GET", headers: cookie("staff"), query: { client: "recCLA" } });
  assert.equal(inv.statusCode, 200, JSON.stringify(inv.payload));
  assert.equal(inv.payload.products.find((p) => p.id === "recP1").foto, urls[0]);
  assert.equal(inv.payload.products.find((p) => p.id === "recP2").foto, "");
});
