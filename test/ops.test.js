// Exploitation : sauvegarde / restauration (D-01), copie protégée (L-03), vérification par
// empreinte (D-07), photos Airtable rapatriées (D-08), santé (D-03), journal (D-04).
// Démonstration de bout en bout sur SQLite : base peuplée -> export -> base vide ->
// restauration -> comparaison enregistrement par enregistrement (famo_files compris).
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "team-test-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "beheer-test-code";
process.env.AIRTABLE_TOKEN = "test-token";
delete process.env.RESEND_API_KEY;
delete process.env.CRON_SECRET;
process.removeAllListeners("warning");

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const zlib = require("zlib");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const backup = require(path.join(ROOT, "lib", "backup.js"));
const log = require(path.join(ROOT, "lib", "log.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ffa6c1f10000000049454e44ae426082", "hex");
const admin = () => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin", "")) });

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
const db = (body) => callApi("dbadmin", { method: "POST", headers: admin(), body });

// Données de démo + cas difficiles : texte avec accents/apostrophes/retours, liens,
// pièce jointe locale (famo_files), nombres, booléens, table hors liste standard.
async function populate() {
  const { FakeAirtable } = require(path.join(ROOT, "scripts", "fake-airtable.js"));
  const { seed } = require(path.join(ROOT, "scripts", "seed.js"));
  const demo = new FakeAirtable();
  seed(demo);
  await ds.state.store.restoreAll([], []);
  for (const [tbl, recs] of Object.entries(demo.data)) await ds.state.store.replaceAll(tbl, recs);
  await ds.state.store.replaceAll("Commandes", (await ds.state.store.list("Commandes")).concat([{ id: "recODDaaaaaaaaaaa", createdTime: "2026-09-01T10:00:00.000Z", fields: { "Référence": "CMD-2026-0999", Notes: "L'huître « spéciale »\nligne 2 — ✓", Total: 12.345, "Livraison confirmée": true, Client: ["recX", "recY"] } }]));
  const prod = (await ds.state.store.list("Catalogue"))[0];
  const up = await callApi("onboarding", { method: "POST", headers: admin(), body: { action: "uploadFoto", id: prod.id, contentType: "image/png", filename: "zalm.png", base64: PNG.toString("base64") } });
  assert.equal(up.statusCode, 200, JSON.stringify(up.body));
  return backup.fromStore(ds.state.store, "sqlite");
}

// Téléchargement comme le navigateur : un morceau à la fois, recollés.
async function download(id) {
  let b64 = "", parts = 1;
  for (let n = 0; n < parts; n++) {
    const r = await db({ action: "download", id, part: n });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    parts = r.body.parts; b64 += r.body.data;
  }
  return Buffer.from(b64, "base64");
}
// Envoi comme le navigateur, en N morceaux.
async function upload(buf, n) {
  const b64 = buf.toString("base64"), size = Math.ceil(b64.length / n);
  let id = "", last = null;
  for (let i = 0; i < n; i++) {
    last = await db({ action: "upload", id: id || undefined, part: i, parts: n, data: b64.slice(i * size, (i + 1) * size) });
    assert.equal(last.statusCode, 200, JSON.stringify(last.body));
    id = last.body.id || (last.body.snapshot && last.body.snapshot.id) || id;
  }
  return last.body;
}

test("D-01 : export -> base vide -> restauration -> 0 écart (enregistrements et famo_files)", async () => {
  const original = await populate();
  assert.ok(original.files.length === 1 && original.tables.Commandes.length >= 6);

  const exp = await db({ action: "export" });
  assert.equal(exp.statusCode, 200, JSON.stringify(exp.body));
  assert.equal(exp.body.summary.files, 1);
  const file = await download(exp.body.snapshot.id);
  assert.equal(file[0], 0x1f, "fichier gzip");
  const parsed = JSON.parse(zlib.gunzipSync(file).toString("utf8"));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.backend, "sqlite");
  assert.ok(parsed.exportedAt && parsed.tables && Array.isArray(parsed.files));

  // Base vide (nouvelle base Neon, ou catastrophe) : aucune confirmation demandée.
  await ds.state.store.restoreAll([], []);
  assert.deepEqual(await ds.state.store.counts(), {});
  assert.equal(await ds.state.store.fileCount(), 0);
  const sent = await upload(file, 3);
  assert.equal(sent.summary.files, 1);
  const rest = await db({ action: "restore", snapshot: sent.snapshot.id });
  assert.equal(rest.statusCode, 200, JSON.stringify(rest.body));
  assert.equal(rest.body.before, null, "base vide : rien à sauvegarder avant");

  const after = await backup.fromStore(ds.state.store, "sqlite");
  const cmp = backup.compare(original, after);
  assert.equal(cmp.ok, true, JSON.stringify(cmp));
  for (const t of cmp.tables) assert.deepEqual([t.onlyA, t.onlyB, t.changed], [0, 0, 0], t.table);
  assert.deepEqual([cmp.files.a, cmp.files.onlyA, cmp.files.onlyB, cmp.files.changed], [1, 0, 0, 0]);
  // Enregistrement par enregistrement, champ par champ (pas seulement l'empreinte).
  for (const [t, recs] of Object.entries(original.tables)) for (const r of recs) assert.deepEqual((await ds.state.store.get(t, r.id)) && (await ds.state.store.get(t, r.id)).fields, r.fields, t + " " + r.id);
  const odd = await ds.state.store.get("Commandes", "recODDaaaaaaaaaaa");
  assert.equal(odd.createdTime, "2026-09-01T10:00:00.000Z", "createdTime conservé");
  // La photo restaurée est servie à l'identique.
  const foto = original.files[0];
  const res = mkRes(); let body = null; res.end = (b) => { body = b; return res; };
  await require(path.join(ROOT, "api", "foto.js"))({ method: "GET", headers: {}, query: { id: foto.id } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(Buffer.isBuffer(body) && body.equals(PNG));
  // Le portail fonctionne sur la base restaurée.
  const cat = await callApi("catalogue", { method: "POST", body: { user: "aloha", pw: "welkom123" } });
  assert.equal(cat.statusCode, 200, JSON.stringify(cat.body));
});

test("D-01 : base non vide -> RESTORE tapé exigé, sauvegarde automatique préalable téléchargeable", async () => {
  const original = await populate();
  const small = { version: 1, exportedAt: new Date().toISOString(), backend: "test", tables: { Configuratie: [{ id: "recCFGzzzzzzzzzzz", createdTime: "2026-01-01T00:00:00.000Z", fields: { Bedrijfsnaam: "Autre" } }] }, files: [] };
  const refused = await db({ action: "restore", backup: small });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.needConfirm, "RESTORE");
  assert.equal((await ds.state.store.list("Commandes")).length, original.tables.Commandes.length, "rien touché");
  const wrong = await db({ action: "restore", backup: small, confirm: "restore" });
  assert.equal(wrong.statusCode, 409, "confirmation exacte, en majuscules");
  const ok = await db({ action: "restore", backup: small, confirm: "RESTORE" });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal((await ds.state.store.list("Commandes")).length, 0);
  assert.ok(ok.body.before && ok.body.before.id, "sauvegarde automatique renvoyée");
  // Retour arrière : la sauvegarde automatique restaure l'état d'avant, à l'identique.
  const before = backup.parse(await download(ok.body.before.id));
  assert.equal(backup.compare(original, before).ok, true);
  const back = await db({ action: "restore", snapshot: ok.body.before.id, confirm: "RESTORE" });
  assert.equal(back.statusCode, 200);
  assert.equal(backup.compare(original, await backup.fromStore(ds.state.store, "sqlite")).ok, true);
  const bad = await db({ action: "restore", backup: { version: 99, tables: {} }, confirm: "RESTORE" });
  assert.equal(bad.statusCode, 400, "fichier étranger refusé avant toute écriture");
  const listed = await callApi("dbadmin", { headers: admin() });
  assert.ok(listed.body.snapshots.length >= 2 && listed.body.snapshots.length <= 6, "instantanés listés et élagués");
});

test("D-01 : mode Airtable -> export seulement (lecture), restauration refusée", async () => {
  const original = await populate();
  ds.state.backend = "airtable"; // les lectures « Airtable » passent par le moteur REST (même contrat)
  try {
    const exp = await db({ action: "export" });
    assert.equal(exp.statusCode, 200, JSON.stringify(exp.body));
    const b = backup.parse(Buffer.from(exp.body.inline, "base64"));
    assert.equal(b.backend, "airtable");
    assert.equal(b.tables.Commandes.length, original.tables.Commandes.length);
    const rest = await db({ action: "restore", backup: b, confirm: "RESTORE" });
    assert.equal(rest.statusCode, 400);
    assert.match(rest.body.error, /Airtable wordt nooit overschreven/);
  } finally { ds.state.backend = "sqlite"; }
});

test("D-01 : cron nocturne -> CRON_SECRET exigé, gzip en pièce jointe à la boîte ops, résumé si trop gros", async () => {
  const original = await populate();
  const cfg = (await ds.state.store.list("Configuratie"))[0];
  await ds.state.store.update("Configuratie", cfg.id, Object.assign({}, cfg.fields, { "Bestellingen e-mail": "ops@famo.test" }), cfg.version);
  assert.equal((await callApi("backup-cron", {})).statusCode, 500, "sans CRON_SECRET : rien ne part");
  process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
  process.env.RESEND_API_KEY = "re_test";
  const mails = [], prev = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (String(u).startsWith("https://api.resend.com/")) { mails.push(JSON.parse(o.body)); return new Response(JSON.stringify({ id: "m" + mails.length }), { status: 200 }); }
    return prev(u, o);
  };
  try {
    assert.equal((await callApi("backup-cron", { headers: { authorization: "Bearer mauvais" } })).statusCode, 401);
    const r = await callApi("backup-cron", { headers: { authorization: "Bearer " + process.env.CRON_SECRET } });
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0].to, ["ops@famo.test"]);
    const att = mails[0].attachments[0];
    assert.match(att.filename, /^famo-backup-\d{4}-\d{2}-\d{2}\.json\.gz$/);
    const got = backup.parse(Buffer.from(att.content, "base64"));
    const cmp = backup.compare(original, got);
    assert.deepEqual(cmp.tables.filter((t) => !t.ok).map((t) => t.table), ["Configuratie"], "tout identique sauf l'adresse ops ajoutée pour le test");
    assert.equal(cmp.files.ok, true);

    process.env.BACKUP_MAX_BYTES = "100";
    const big = await callApi("backup-cron", { headers: { authorization: "Bearer " + process.env.CRON_SECRET } });
    assert.equal(big.statusCode, 502, "trop gros : l'envoi n'est pas une sauvegarde");
    assert.equal(mails[1].attachments, undefined);
    assert.match(mails[1].text, /handmatig/);
    const st = await callApi("dbadmin", { headers: admin() });
    assert.equal(st.body.lastBackup.big, true);
  } finally {
    globalThis.fetch = prev;
    delete process.env.CRON_SECRET; delete process.env.RESEND_API_KEY; delete process.env.BACKUP_MAX_BYTES;
  }
});

// Airtable simulée pour copy / verify / fixPhotos : tables en mémoire + fichiers d'images.
function fakeAirtable(tables, images) {
  const saved = ds.state.realFetch;
  ds.state.realFetch = async (url) => {
    if (images[url]) return new Response(images[url], { status: 200, headers: { "Content-Type": "image/png" } });
    const u = new URL(url);
    const seg = u.pathname.split("/");
    const tbl = decodeURIComponent(seg[3]);
    if (seg[4]) { const rec = (tables[tbl] || []).find((r) => r.id === seg[4]); return new Response(JSON.stringify(rec || { error: { type: "NOT_FOUND" } }), { status: rec ? 200 : 404 }); }
    if (tbl === "Cadrage projet") return new Response(JSON.stringify({ error: { type: "TABLE_NOT_FOUND", message: "x" } }), { status: 404 });
    return new Response(JSON.stringify({ records: tables[tbl] || [] }), { status: 200 });
  };
  return () => { ds.state.realFetch = saved; };
}

test("L-03 + D-08 + D-07 : copie protégée, photos rapatriées dans famo_files, champ modifié détecté", async () => {
  await populate();
  const imgUrl = "https://v5.airtableusercontent.com/v3/u/abc/zalm.png?expires=1";
  const at = {
    Catalogue: [{ id: "recPRDaaaaaaaaaaa", createdTime: "2026-01-01T00:00:00.000Z", fields: { Produit: "Zalm", Foto: [{ id: "attAIRTABLE000001", url: imgUrl, filename: "zalm.png", size: PNG.length, type: "image/png", thumbnails: { large: { url: imgUrl } } }] } }],
    Commandes: [{ id: "recORDaaaaaaaaaaa", createdTime: "2026-01-01T00:00:00.000Z", fields: { "Référence": "CMD-2026-0001", Total: 10, "Preuve de livraison": [{ id: "attPDF", url: "https://v5.airtableusercontent.com/bon.pdf", filename: "bon.pdf", type: "application/pdf", size: 3 }] } }],
    Clients: [{ id: "recCLIaaaaaaaaaaa", createdTime: "2026-01-01T00:00:00.000Z", fields: { Nom: "Aloha" } }]
  };
  const restore = fakeAirtable(at, { [imgUrl]: PNG });
  try {
    // Base vivante avec des commandes absentes d'Airtable et plus récentes : refus, rien écrit.
    const n0 = (await ds.state.store.list("Commandes")).length;
    const refused = await db({ action: "copy", force: true, confirm: "OVERWRITE" });
    assert.equal(refused.statusCode, 409);
    assert.ok(refused.body.newer >= 1);
    assert.equal((await ds.state.store.list("Commandes")).length, n0);

    await ds.state.store.replaceAll("Commandes", []);
    const copy = await db({ action: "copy", force: true, confirm: "OVERWRITE" });
    assert.equal(copy.statusCode, 200, JSON.stringify(copy.body));
    assert.ok(copy.body.before && copy.body.before.id, "export automatique avant d'écraser");
    assert.deepEqual([copy.body.photos.downloaded, copy.body.photos.failed, copy.body.photos.kept], [1, 0, 1]);
    const foto = (await ds.state.store.get("Catalogue", "recPRDaaaaaaaaaaa")).fields.Foto[0];
    assert.match(foto.url, /^\/api\/foto\?id=att[A-Za-z0-9]{14}$/, "plus de lien Airtable qui expire");
    assert.equal(Buffer.from((await ds.state.store.getFile(foto.id)).data, "base64").equals(PNG), true);

    const ver = await db({ action: "verify" });
    assert.equal(ver.body.ok, true, JSON.stringify(ver.body.report.filter((r) => !r.ok)));
    const cur = await ds.state.store.get("Commandes", "recORDaaaaaaaaaaa");
    await ds.state.store.update("Commandes", cur.id, Object.assign({}, cur.fields, { Notes: "gewijzigd" }), cur.version);
    const ver2 = await db({ action: "verify" });
    const row = ver2.body.report.find((r) => r.table === "Commandes");
    assert.equal(ver2.body.ok, false, "même ids, même total : l'empreinte voit le champ modifié");
    assert.deepEqual([row.onlyAirtable, row.onlyPostgres, row.changed, row.changedIds[0]], [0, 0, 1, "recORDaaaaaaaaaaa"]);
    assert.equal(row.totalAirtable, row.totalPostgres);

    // fixPhotos : une photo restée sur un lien Airtable expiré est rapatriée avec un lien frais.
    const p = await ds.state.store.get("Catalogue", "recPRDaaaaaaaaaaa");
    await ds.state.store.update("Catalogue", p.id, Object.assign({}, p.fields, { Foto: [{ id: "attOLD", url: "https://v5.airtableusercontent.com/expired.png", filename: "zalm.png", type: "image/png", size: PNG.length }] }), p.version);
    const fix = await db({ action: "fixPhotos" });
    assert.equal(fix.statusCode, 200, JSON.stringify(fix.body));
    assert.equal(fix.body.photos.downloaded, 1);
    assert.match((await ds.state.store.get("Catalogue", p.id)).fields.Foto[0].url, /^\/api\/foto\?id=att/);
  } finally { restore(); }
});

test("D-04 : journal JSON corrélable (x-vercel-id), secrets masqués", () => {
  const lines = [], prev = log._setSink(lines);
  try {
    const L = log.from({ headers: { "x-vercel-id": "fra1::iad1::abc-123" } }, "updateorder");
    L.warn("retour de stock non enregistré", { ref: "CMD-2026-0042", recId: "recABC", pw: "geheim", token: "t", err: Object.assign(new Error("boom"), { status: 503 }) });
    log.info("at-engine", "hors requête", { table: "Commandes" });
  } finally { log._setSink(prev); }
  assert.deepEqual(Object.assign({}, lines[0], { t: undefined }), { niveau: "warn", msg: "retour de stock non enregistré", fn: "updateorder", reqId: "fra1::iad1::abc-123", ref: "CMD-2026-0042", recId: "recABC", pw: "***", token: "***", err: { message: "boom", status: 503 }, t: undefined });
  assert.equal(lines[1].reqId, undefined);
  assert.ok(!Number.isNaN(Date.parse(lines[0].t)));
});
