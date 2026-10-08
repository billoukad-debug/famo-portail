"use strict";
// Pushmeldingen (specs/025-pushmeldingen) : chiffrement RFC 8291 (exemple de l'annexe A), signature VAPID
// (RFC 8292), clés (variables d'environnement, sinon Configuratie), api/push.js, et vraie chaîne de commande sur
// le moteur SQL (SQLite en mémoire) : commande du portail client → notification chiffrée, déchiffrée ici avec les
// clés de l'appareil ; saisie du personnel → rien ; service en panne, lent, 500, 410 → la commande répond 200.
// Service worker et état du panneau « Meldingen » (Vandaag). Réseau simulé : aucune requête réelle vers Apple,
// Google, Mozilla ou Microsoft.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY; // e-mails inertes : seule la notification part
for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "PORTAL_URL", "VERCEL"]) delete process.env[k];
process.env.PUSH_TIMEOUT_MS = "300"; // 4 s en production
process.removeAllListeners("warning"); // node:sqlite est « expérimental »

// Réseau simulé AVANT lib/datastore.js (il garde ce fetch pour tout ce qui n'est pas Airtable).
const PUSH = /^https:\/\/(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)\//;
const net = { pushes: [], reply: null };
global.fetch = async (url, init) => {
  const u = String(url), o = init || {};
  if (!PUSH.test(u)) throw new Error("Réseau réel interdit : " + u);
  const req = { url: u, method: o.method, headers: Object.assign({}, o.headers), body: Buffer.from(o.body || "") };
  net.pushes.push(req);
  return net.reply ? net.reply(req, o) : new Response(null, { status: 201 });
};

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const lev = require(path.join(ROOT, "lib", "levering.js"));
const W = require(path.join(ROOT, "lib", "webpush.js"));
const P = require(path.join(ROOT, "lib", "push.js"));
const V = require(path.join(ROOT, "assets", "vandaag.js"));
const { device, decrypt, vapid } = require("./_push-device");

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0"
};
const H = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const as = (role, name, ua) => Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role, name)), "user-agent": ua || UA.iphone }, H);
const MOHSEN = () => as("admin", "Mohsen");
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, getHeader(k) { return this.headers[String(k).toLowerCase()]; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, send(b) { this.payload = b; return this; }, end() { return this; } }; }
async function call(file, req) { const res = mkRes(); await require(path.join(ROOT, "api", file))(Object.assign({ method: "POST", headers: {}, query: {} }, req), res); return res; }
const push = (body, headers) => call("push.js", { body, headers: headers || MOHSEN() });
const getPush = (query, headers) => call("push.js", { method: "GET", query: query || {}, headers: headers || MOHSEN() });
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const subs = async () => store().list(P.TABLE);
const conf = async () => (await store().list("Configuratie"))[0];
const patch = async (table, id, fields) => store().replaceAll(table, (await store().list(table)).map((r) => (r.id === id ? Object.assign({}, r, { fields: Object.assign({}, r.fields, fields) }) : r)));
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const LATER = addDays(lev.brusselsToday(), 5); // jamais touché par l'heure limite

async function seed(confFields) {
  net.pushes.length = 0; net.reply = null;
  await store().replaceAll("Configuratie", confFields === null ? [] : [rec("recCONF", Object.assign({ Bedrijfsnaam: "FAMO Seafood", "E-mail": "info@famo.test", "BTW-tarief": 6, Besteldeadline: "22:00", Leverdagen: "ma,di,wo,do,vr,za,zo" }, confFields || {}))]);
  await store().replaceAll("Catalogue", [rec("recTONG", { Produit: "Tong", "Prix de base": 16, "Unité": "kg", "Catégorie": "Vis", Actif: true })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Aloha Poke Bowls", Gebruikersnaam: "aloha", Wachtwoord: ca.hashPassword("geheim123"), Adres: "Kerkstraat 1", Telefoon: "0470 12 34 56" })]);
  for (const t of ["Prix négociés", "Commandes", "Compteurs", "Journaal", "Stock", "Mouvements de stock", P.TABLE]) await store().replaceAll(t, []);
}
async function subscribed(...devs) {
  for (const d of devs) { const r = await push({ action: "subscribe", subscription: d.subscription }); assert.equal(r.statusCode, 200, JSON.stringify(r.payload)); }
  return (await getPush()).payload.publicKey;
}
const clientOrder = async (items, more) => call("order.js", { body: Object.assign({ token: ca.issueToken({ id: "recCLA", fields: (await store().get("Clients", "recCLA")).fields }), items }, more || {}) });

// ---------------------------------------------------------------------------------------------------
const RFC = { // RFC 8291, annexe A
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
};

test("RFC 8291 annexe A : le chiffrement reproduit exactement l'exemple ; l'appareil le déchiffre", () => {
  const out = W.encrypt(Buffer.from(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { asPrivate: RFC.asPrivate, salt: RFC.salt });
  assert.equal(Buffer.from(out).toString("base64url"), RFC.body);
  const ua = device(null, { privateKey: RFC.uaPrivate, auth: RFC.auth });
  assert.equal(ua.subscription.keys.p256dh, RFC.uaPublic);
  assert.equal(decrypt(out, ua), RFC.plaintext);
});

test("chiffrement : aller-retour, sel et clé éphémère neufs à chaque message ; clés d'appareil invalides et message trop long refusés", () => {
  const ua = device();
  const a = Buffer.from(W.encrypt(Buffer.from('{"title":"x"}'), ua.subscription.keys)), b = Buffer.from(W.encrypt('{"title":"x"}', ua.subscription.keys));
  assert.equal(decrypt(a, ua), '{"title":"x"}'); assert.equal(decrypt(b, ua), '{"title":"x"}');
  assert.notEqual(a.subarray(0, 16).toString("hex"), b.subarray(0, 16).toString("hex"), "sel neuf");
  assert.notEqual(a.subarray(21, 86).toString("hex"), b.subarray(21, 86).toString("hex"), "clé éphémère neuve");
  assert.equal(a.readUInt32BE(16), 4096, "taille d'enregistrement 4096");
  assert.throws(() => decrypt(a, device()), "un autre appareil ne lit rien");
  assert.throws(() => W.encrypt("x", { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: ua.subscription.keys.auth }), "point hors de la courbe P-256");
  assert.throws(() => W.encrypt("x", { p256dh: ua.subscription.keys.p256dh.slice(0, 40), auth: ua.subscription.keys.auth }));
  assert.throws(() => W.encrypt("x", { p256dh: ua.subscription.keys.p256dh, auth: "AAAA" }), "auth = 16 octets");
  assert.doesNotThrow(() => W.encrypt(Buffer.alloc(3993, 0x61), ua.subscription.keys), "3 993 octets : la limite de RFC 8291");
  assert.throws(() => W.encrypt(Buffer.alloc(3994, 0x61), ua.subscription.keys), /te groot/);
});

test("VAPID (RFC 8292) : clés P-256, JWT ES256 vérifiable, aud = origine du service, exp ≤ 24 h, sub", () => {
  const k = W.generateKeys();
  assert.match(k.publicKey, /^B[A-Za-z0-9_-]{86}$/); assert.match(k.privateKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(W.validKeys(k.publicKey, k.privateKey), true);
  assert.equal(W.validKeys(k.publicKey, W.generateKeys().privateKey), false, "paire mélangée");
  assert.equal(W.validKeys("abc", k.privateKey), false);
  assert.equal(W.validKeys(k.publicKey, ""), false);
  const now = Date.now();
  const claims = vapid({ headers: { Authorization: W.vapidHeader("https://web.push.apple.com/QGabc", k, "mailto:info@famo.test", now) } }, k.publicKey);
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "mailto:info@famo.test");
  assert.ok(claims.exp > now / 1000 + 3600 && claims.exp <= now / 1000 + 24 * 3600, "exp entre 1 h et 24 h");
  assert.equal(vapid({ headers: { Authorization: W.vapidHeader("https://fcm.googleapis.com/fcm/send/x?y=1", k, "https://www.famoseafood.be", now) } }).aud, "https://fcm.googleapis.com");
});

test("clés : variables d'environnement prioritaires, sinon créées une fois dans Configuratie et relues ; jamais exposées", async () => {
  await seed();
  const a = await P.keys();
  assert.equal(a.bron, "db"); assert.equal(W.validKeys(a.publicKey, a.privateKey), true);
  const c = (await conf()).fields;
  assert.equal(c["Push publieke sleutel"], a.publicKey); assert.equal(c["Push privésleutel"], a.privateKey);
  assert.equal((await P.keys()).privateKey, a.privateKey, "relue, pas recréée");
  // Deux demandes en même temps (première activation) : une seule paire, la même pour les deux.
  await seed();
  const [x, y] = await Promise.all([P.keys(), P.keys()]);
  assert.equal(x.publicKey, y.publicKey);
  assert.equal((await conf()).fields["Push publieke sleutel"], x.publicKey);
  // Variables d'environnement : prioritaires ; une seule, ou illisible → refus explicite, jamais d'autres clés en silence.
  const envK = W.generateKeys();
  process.env.VAPID_PUBLIC_KEY = envK.publicKey; process.env.VAPID_PRIVATE_KEY = envK.privateKey;
  try {
    const e = await P.keys();
    assert.deepStrictEqual([e.bron, e.publicKey, e.privateKey], ["env", envK.publicKey, envK.privateKey]);
    assert.equal((await getPush()).payload.publicKey, envK.publicKey);
    process.env.VAPID_PRIVATE_KEY = "pas-une-cle";
    const bad = await getPush();
    assert.equal(bad.statusCode, 503); assert.match(bad.payload.error, /VAPID/);
    delete process.env.VAPID_PRIVATE_KEY;
    assert.equal((await getPush()).statusCode, 503, "une seule des deux variables");
  } finally { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; }
  // La clé privée ne quitte jamais le serveur : ni /api/push, ni /api/config, ni les données de Beheer.
  const k = await P.keys();
  for (const [name, r] of [["push", await getPush()], ["config", await call("config.js", { method: "GET", headers: MOHSEN() })], ["onboarding", await call("onboarding.js", { method: "GET", headers: MOHSEN() })]]) {
    assert.equal(r.statusCode, 200, name + " " + JSON.stringify(r.payload).slice(0, 200));
    assert.ok(!JSON.stringify(r.payload).includes(k.privateKey), name + " : clé privée absente");
  }
  assert.deepStrictEqual(Object.keys((await getPush()).payload), ["publicKey"]);
  // Journal d'audit (Beheer → Bedrijfsgegevens enregistré pendant la création des clés) : jamais la valeur.
  assert.deepStrictEqual(require(path.join(ROOT, "lib", "journal.js")).diff({}, { "Push privésleutel": k.privateKey }), [{ veld: "Push privésleutel", voor: "", na: "••• (gewijzigd)" }]);
  // Sans Configuratie : 503 explicite (fail-closed).
  await seed(null);
  const none = await getPush();
  assert.equal(none.statusCode, 503); assert.ok(none.payload.error);
});

test("api/push : session obligatoire, garde, liste blanche des services, doublon, maximum 20, statut, uitzetten", async () => {
  await seed();
  const dev = device(), sub = dev.subscription;
  assert.equal((await getPush({}, H)).statusCode, 401, "GET sans session");
  assert.equal((await push({ action: "subscribe", subscription: sub }, H)).statusCode, 401, "POST sans session");
  assert.equal((await push({ action: "subscribe", subscription: sub }, Object.assign(as("staff"), { origin: "https://evil.test" }))).statusCode, 403, "garde A-10");
  assert.equal((await call("push.js", { method: "PUT", headers: as("staff") })).statusCode, 405);
  const g = await getPush({}, as("staff"));
  assert.equal(g.statusCode, 200); assert.match(g.payload.publicKey, /^B[A-Za-z0-9_-]{86}$/);

  const ok = await push({ action: "subscribe", subscription: sub, sleutel: g.payload.publicKey }, as("staff", "Mohsen", UA.iphone));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload)); assert.equal(ok.payload.ok, true);
  let list = await subs();
  assert.equal(list.length, 1);
  const f = list[0].fields;
  assert.deepStrictEqual([f.Endpoint, f.P256dh, f.Auth, f.Wie, f.Rol, f.Toestel, f.Dienst], [sub.endpoint, sub.keys.p256dh, sub.keys.auth, "Mohsen", "staff", "iPhone · Safari", "Apple"]);
  assert.ok(f.Sleutel && f["Aangemaakt op"]);
  // « Aanzetten » une seconde fois sur le même appareil : une seule ligne.
  assert.equal((await push({ action: "subscribe", subscription: sub }, as("staff", "Mohsen"))).statusCode, 200);
  assert.equal((await subs()).length, 1);
  assert.deepStrictEqual((await push({ action: "status", endpoint: sub.endpoint }, as("staff"))).payload, { ok: true, aan: true });
  // Abonnement fait avec une autre clé publique (clés changées) : refusé, le navigateur doit se réinscrire.
  const other = await push({ action: "subscribe", subscription: device().subscription, sleutel: W.generateKeys().publicKey }, as("staff"));
  assert.equal(other.statusCode, 409); assert.match(other.payload.error, /opnieuw/i);

  // Liste blanche : seulement les services connus, en HTTPS, sans identifiants ni port exotique (pas de requête serveur vers n'importe où).
  const bad = ["http://web.push.apple.com/QGx", "https://evil.test/push/x", "https://web.push.apple.com.evil.test/x", "https://evil.test/https://web.push.apple.com/x",
    "https://user:pw@fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com:8443/fcm/send/x", "https://localhost/x", "https://127.0.0.1/x", "https://notify.windows.com.evil.test/x",
    "https://fcm.googleapis.com/fcm/send/" + "x".repeat(1100), "javascript:alert(1)", "", null];
  for (const endpoint of bad) {
    const r = await push({ action: "subscribe", subscription: Object.assign({}, sub, { endpoint }) }, as("staff"));
    assert.equal(r.statusCode, 400, String(endpoint).slice(0, 60));
  }
  for (const keys of [{ p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: sub.keys.auth }, { p256dh: sub.keys.p256dh.slice(0, 40), auth: sub.keys.auth }, { p256dh: sub.keys.p256dh, auth: "AAAA" }, {}, null]) {
    assert.equal((await push({ action: "subscribe", subscription: { endpoint: device().subscription.endpoint, keys } }, as("staff"))).statusCode, 400, JSON.stringify(keys));
  }
  assert.equal((await push({ action: "subscribe" }, as("staff"))).statusCode, 400);
  assert.equal((await subs()).length, 1, "rien d'enregistré");
  // Les quatre services acceptés ; l'appareil est décrit par le serveur (User-Agent), jamais par le navigateur.
  const more = [["https://fcm.googleapis.com/fcm/send/", UA.android, "Android · Chrome", "Google"], ["https://updates.push.services.mozilla.com/wpush/v2/", UA.firefox, "Linux · Firefox", "Mozilla"],
    ["https://wns2-par02p.notify.windows.com/w/?token=", UA.edge, "Windows · Edge", "Microsoft"], ["https://web.push.apple.com/", UA.mac, "Mac · Safari", "Apple"]];
  for (const [base, ua, toestel, dienst] of more) {
    const d = device(base);
    assert.equal((await push({ action: "subscribe", subscription: d.subscription, toestel: "<b>faux</b>" }, as("staff", "", ua))).statusCode, 200, base);
    const r = (await subs()).find((x) => x.fields.Endpoint === d.subscription.endpoint);
    assert.deepStrictEqual([r.fields.Toestel, r.fields.Dienst, r.fields.Wie], [toestel, dienst, "personeel"]);
  }
  // Au plus 20 appareils : le 21e est refusé ; un appareil déjà inscrit se réinscrit toujours.
  await store().insert(P.TABLE, Array.from({ length: 15 }, (_, i) => rec("recPS" + String(i).padStart(2, "0") + "AAAAAAAAAA", { Endpoint: "https://fcm.googleapis.com/fcm/send/old" + i, P256dh: sub.keys.p256dh, Auth: sub.keys.auth, Sleutel: f.Sleutel, Wie: "x" })));
  assert.equal((await subs()).length, 20);
  const full = await push({ action: "subscribe", subscription: device().subscription }, as("staff"));
  assert.equal(full.statusCode, 409); assert.match(full.payload.error, /20/);
  assert.equal((await push({ action: "subscribe", subscription: sub }, as("staff"))).statusCode, 200, "déjà inscrit : accepté");
  // Uitzetten : retiré du serveur.
  assert.equal((await push({ action: "unsubscribe", endpoint: sub.endpoint }, as("staff"))).statusCode, 200);
  assert.ok(!(await subs()).some((r) => r.fields.Endpoint === sub.endpoint));
  assert.deepStrictEqual((await push({ action: "status", endpoint: sub.endpoint }, as("staff"))).payload, { ok: true, aan: false });
  assert.equal((await push({ action: "unsubscribe", endpoint: sub.endpoint }, as("staff"))).statusCode, 200, "déjà retiré : rien à faire");
  assert.equal((await push({ action: "nope" }, as("staff"))).statusCode, 400);
  const j = (await store().list("Journaal")).map((x) => x.fields.Actie);
  assert.ok(j.includes("Meldingen aangezet") && j.includes("Meldingen uitgezet"), "journalisé : " + j.join(", "));
});

test("Test sturen : chiffré pour CET appareil seulement, signé ; appareil inconnu → 404 ; 404/410 du service → appareil retiré", async () => {
  await seed();
  const a = device(), b = device("https://fcm.googleapis.com/fcm/send/");
  const pub = await subscribed(a, b);
  net.pushes.length = 0;
  const t = await push({ action: "test", endpoint: a.subscription.endpoint });
  assert.equal(t.statusCode, 200, JSON.stringify(t.payload));
  assert.equal(net.pushes.length, 1, "un seul envoi");
  const req = net.pushes[0];
  assert.equal(req.url, a.subscription.endpoint); assert.equal(req.method, "POST");
  assert.deepStrictEqual([req.headers["Content-Encoding"], req.headers["Content-Type"], req.headers.TTL, req.headers.Urgency], ["aes128gcm", "application/octet-stream", "86400", "high"]);
  const claims = vapid(req, pub);
  assert.equal(claims.aud, "https://web.push.apple.com"); assert.equal(claims.sub, "mailto:info@famo.test");
  const msg = JSON.parse(decrypt(req.body, a));
  assert.deepStrictEqual([msg.title, msg.url], ["FAMO · Test", "/team/vandaag"]);
  assert.ok((await subs()).find((r) => r.fields.Endpoint === a.subscription.endpoint).fields["Laatst verstuurd"]);
  assert.equal((await push({ action: "test", endpoint: device().subscription.endpoint })).statusCode, 404, "appareil non inscrit");
  net.reply = () => new Response("", { status: 410 });
  const gone = await push({ action: "test", endpoint: a.subscription.endpoint });
  assert.equal(gone.statusCode, 410); assert.match(gone.payload.error, /opnieuw/i);
  assert.deepStrictEqual((await subs()).map((r) => r.fields.Endpoint), [b.subscription.endpoint], "retiré automatiquement");
  net.reply = () => new Response("", { status: 500 });
  const fail = await push({ action: "test", endpoint: b.subscription.endpoint });
  assert.equal(fail.statusCode, 502); assert.match(fail.payload.error, /500/);
  assert.match((await subs())[0].fields["Laatste fout"], /500/);
  // Sujet VAPID : VAPID_SUBJECT si défini, sinon l'e-mail de l'entreprise, sinon le site.
  net.reply = null; net.pushes.length = 0;
  await patch("Configuratie", "recCONF", { "E-mail": "" });
  await push({ action: "test", endpoint: b.subscription.endpoint });
  assert.equal(vapid(net.pushes[0]).sub, "https://www.famoseafood.be");
  process.env.VAPID_SUBJECT = "mailto:mohsen@famo.test";
  try { await push({ action: "test", endpoint: b.subscription.endpoint }); assert.equal(vapid(net.pushes[1]).sub, "mailto:mohsen@famo.test"); }
  finally { delete process.env.VAPID_SUBJECT; }
});

test("Beheer → Toegang : liste des appareils et retrait, beheerder seul ; clés de l'appareil jamais renvoyées ; journal", async () => {
  await seed();
  const a = device();
  await subscribed(a);
  assert.equal((await getPush({ lijst: "1" }, as("staff"))).statusCode, 403);
  const l = await getPush({ lijst: "1" });
  assert.equal(l.statusCode, 200);
  assert.equal(l.payload.toestellen.length, 1);
  const d = l.payload.toestellen[0];
  assert.deepStrictEqual(Object.keys(d).sort(), ["dienst", "fout", "foutOp", "id", "laatst", "rol", "sinds", "toestel", "wie"]);
  assert.deepStrictEqual([d.wie, d.rol, d.toestel, d.dienst], ["Mohsen", "admin", "iPhone · Safari", "Apple"]);
  const raw = JSON.stringify(l.payload);
  assert.ok(!raw.includes(a.subscription.keys.auth) && !raw.includes(a.subscription.keys.p256dh) && !raw.includes(a.subscription.endpoint), "ni clés ni adresse de l'appareil");
  assert.equal((await push({ action: "remove", id: d.id }, as("staff"))).statusCode, 403);
  assert.equal((await push({ action: "remove", id: "../x" })).statusCode, 400);
  assert.equal((await push({ action: "remove", id: d.id })).statusCode, 200);
  assert.equal((await subs()).length, 0);
  assert.equal((await push({ action: "remove", id: d.id })).statusCode, 404);
  assert.ok((await store().list("Journaal")).some((j) => j.fields.Actie === "Meldingstoestel verwijderd" && j.fields.Wie === "Mohsen" && j.fields.Referentie === "iPhone · Safari"));
});

test("commande du portail client → une notification chiffrée par appareil (client, montant, jour), toucher → Vandaag", async () => {
  await seed();
  const a = device(), b = device("https://fcm.googleapis.com/fcm/send/");
  const pub = await subscribed(a, b);
  net.pushes.length = 0;
  const o = await clientOrder([{ productId: "recTONG", quantity: 2.5 }], { dateLivraison: LATER });
  assert.equal(o.statusCode, 200, JSON.stringify(o.payload));
  assert.deepStrictEqual(net.pushes.map((r) => r.url).sort(), [a.subscription.endpoint, b.subscription.endpoint].sort());
  for (const d of [a, b]) {
    const req = net.pushes.find((r) => r.url === d.subscription.endpoint);
    vapid(req, pub);
    const msg = JSON.parse(decrypt(req.body, d));
    assert.equal(msg.title, "Nieuwe bestelling");
    assert.match(msg.body, /^Aloha Poke Bowls · € 40,00 · levering (ma|di|wo|do|vr|za|zo) (\d{1,2}) (jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)$/);
    assert.equal(Number(/ (\d{1,2}) [a-z]{3}$/.exec(msg.body)[1]), Number(LATER.slice(8)), "jour de livraison");
    assert.deepStrictEqual([msg.url, msg.tag], ["/team/vandaag", "bestelling-" + o.payload.id]);
    assert.ok(!/Kerkstraat|0470|Tong|kg/.test(JSON.stringify(msg)), "jamais l'adresse, le téléphone ni les lignes");
  }
  assert.ok((await subs()).every((r) => r.fields["Laatst verstuurd"] && !r.fields["Laatste fout"]));
  // Sans jour de livraison : client et montant seulement.
  net.pushes.length = 0;
  assert.equal((await clientOrder([{ productId: "recTONG", quantity: 1 }])).statusCode, 200);
  assert.equal(JSON.parse(decrypt(net.pushes.find((r) => r.url === a.subscription.endpoint).body, a)).body, "Aloha Poke Bowls · € 16,00");
});

test("commande saisie par le personnel (Invoeren, « + Bestelling » de Vandaag) → aucune notification", async () => {
  await seed();
  await subscribed(device());
  net.pushes.length = 0;
  const r = await call("staff.js", { body: { clientId: "recCLA", bron: "Telefoon", items: [{ productId: "recTONG", quantity: 1 }] }, headers: as("staff") });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal(net.pushes.length, 0);
});

test("service en panne, 500, trop lent, 410 : la commande répond 200, « Laatste fout » notée, 410 → retiré ; ancienne clé → retiré sans envoi", { timeout: 15000 }, async () => {
  await seed();
  const a = device();
  await subscribed(a);
  const order = () => clientOrder([{ productId: "recTONG", quantity: 1 }]);
  const last = async () => ((await subs())[0] || { fields: {} }).fields;
  net.reply = () => { throw new TypeError("fetch failed"); };
  let r = await order();
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.match((await last())["Laatste fout"], /netwerk/i); assert.ok((await last())["Fout op"]);
  net.reply = () => new Response("oops", { status: 500 });
  assert.equal((await order()).statusCode, 200);
  assert.match((await last())["Laatste fout"], /500/);
  net.reply = (req, o) => new Promise((resolve, reject) => { if (o.signal) o.signal.addEventListener("abort", () => reject(o.signal.reason || new Error("aborted"))); });
  const t0 = Date.now();
  r = await order();
  assert.equal(r.statusCode, 200);
  assert.ok(Date.now() - t0 < 3000, "attente bornée (" + (Date.now() - t0) + " ms)");
  assert.match((await last())["Laatste fout"], /time-out/i);
  // Le service répond de nouveau : l'erreur disparaît.
  net.reply = null;
  assert.equal((await order()).statusCode, 200);
  assert.equal((await last())["Laatste fout"], undefined);
  net.reply = () => new Response(null, { status: 404 });
  assert.equal((await order()).statusCode, 200);
  assert.equal((await subs()).length, 0, "404 : appareil retiré");
  // Clés changées : un abonnement fait avec une autre clé publique est retiré sans envoi (il ne pourrait que refuser).
  net.reply = null;
  await subscribed(a);
  await patch(P.TABLE, (await subs())[0].id, { Sleutel: "oude-sleutel" });
  net.pushes.length = 0;
  assert.equal((await order()).statusCode, 200);
  assert.equal(net.pushes.length, 0); assert.equal((await subs()).length, 0);
});

test("lib/push : messages (montant belge, jour, sans détails), appareil et service décrits par le serveur", () => {
  assert.deepStrictEqual(P.message.newOrder({ id: "recX", klant: "Resto A", total: 1234.5, dateLivraison: "2026-10-09" }),
    { title: "Nieuwe bestelling", body: "Resto A · € 1.234,50 · levering vr 9 okt", url: "/team/vandaag", tag: "bestelling-recX" });
  assert.equal(P.message.newOrder({ id: "recX", klant: "Resto A", total: 12, viaMail: true }).title, "Nieuwe bestelling (e-mail)");
  assert.deepStrictEqual(P.message.review({ id: "recM", klant: "", van: "chef@resto-a.be", onderwerp: "Bestelling vrijdag" }),
    { title: "E-mail te controleren", body: "chef@resto-a.be: Bestelling vrijdag", url: "/team/bestellingen#/controle", tag: "mail-recM" });
  assert.equal(P.message.review({ id: "recM", klant: "Resto A", van: "chef@resto-a.be", onderwerp: "" }).body, "Resto A");
  assert.ok(P.message.newOrder({ id: "r", klant: "x".repeat(500), total: 1 }).body.length < 140, "texte court");
  assert.equal(P.toestel(UA.iphone), "iPhone · Safari"); assert.equal(P.toestel(UA.android), "Android · Chrome"); assert.equal(P.toestel(""), "Onbekend toestel");
  assert.equal(P.dienst("https://web.push.apple.com/x"), "Apple"); assert.equal(P.dienst("https://evil.test/x"), "");
});

test("service worker : la notification s'affiche (titre, texte, tag, icône) ; le toucher ouvre la page, même origine seulement", async () => {
  const code = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const shown = [], opened = [], handlers = {};
  let windows = [];
  const win = { url: "https://www.famoseafood.be/team/bestellingen", focused: false, navigated: null, focus() { this.focused = true; return Promise.resolve(this); }, navigate(u) { this.navigated = u; return Promise.resolve(this); } };
  const self = {
    location: new URL("https://www.famoseafood.be/sw.js"),
    addEventListener: (t, fn) => { handlers[t] = fn; },
    registration: { showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); } },
    clients: { matchAll: async () => windows, openWindow: async (u) => { opened.push(u); return null; }, claim: async () => {} },
    skipWaiting: () => Promise.resolve()
  };
  vm.runInContext(code, vm.createContext({ self, caches: {}, URL, fetch: () => { throw new Error("pas de réseau"); }, console }));
  const fire = async (type, ev) => { const waits = []; ev.waitUntil = (p) => waits.push(p); handlers[type](ev); await Promise.all(waits); };
  await fire("push", { data: { json: () => ({ title: "Nieuwe bestelling", body: "Aloha · € 40,00", url: "/team/vandaag", tag: "bestelling-recX" }), text: () => "" } });
  assert.equal(shown[0].title, "Nieuwe bestelling");
  assert.deepStrictEqual([shown[0].opts.body, shown[0].opts.tag, shown[0].opts.data.url], ["Aloha · € 40,00", "bestelling-recX", "/team/vandaag"]);
  assert.match(shown[0].opts.icon, /famo-192\.png/);
  // Contenu illisible ou absent : une notification quand même (Safari retire l'abonnement d'un site qui n'en montre pas).
  await fire("push", { data: { json: () => { throw new SyntaxError("x"); }, text: () => "brut" } });
  await fire("push", { data: null });
  assert.deepStrictEqual(shown.slice(1).map((s) => s.title), ["FAMO", "FAMO"]);
  // Toucher : fenêtre existante ramenée et dirigée vers la page ; sinon nouvelle fenêtre ; jamais une autre origine.
  const click = (url) => { const n = { data: { url }, closed: false, close() { this.closed = true; } }; return fire("notificationclick", { notification: n }).then(() => n); };
  windows = [win];
  assert.equal((await click("/team/vandaag")).closed, true);
  assert.equal(win.focused, true); assert.equal(win.navigated, "https://www.famoseafood.be/team/vandaag");
  windows = [];
  await click("https://evil.test/phish");
  await click("/team/bestellingen#/controle");
  await click(undefined);
  assert.deepStrictEqual(opened, ["https://www.famoseafood.be/team/vandaag", "https://www.famoseafood.be/team/bestellingen#/controle", "https://www.famoseafood.be/team/vandaag"]);
});

test("Vandaag → Meldingen : état de l'appareil (iPhone sans app, sans support, refusé, aan, uit) ; clé de l'abonnement", () => {
  const base = { ios: false, standalone: false, sw: true, push: true, notification: true, permission: "default", server: false };
  const st = (o) => V.pushState(Object.assign({}, base, o));
  assert.equal(st({ ios: true, push: false, notification: false }), "installeren", "Safari sans app : l'ajouter à l'écran d'accueil");
  assert.equal(st({ ios: true, standalone: true, push: false }), "geen", "iOS trop ancien (< 16.4)");
  assert.equal(st({ sw: false }), "geen"); assert.equal(st({ push: false }), "geen"); assert.equal(st({ notification: false }), "geen");
  assert.equal(st({ permission: "denied" }), "geweigerd");
  assert.equal(st({ ios: true, standalone: true, permission: "denied" }), "geweigerd");
  assert.equal(st({ permission: "granted", server: true }), "aan");
  assert.equal(st({ permission: "granted", server: false }), "uit", "retiré par le beheerder ou nettoyé : à rallumer");
  assert.equal(st({}), "uit");
  assert.equal(V.isIos(UA.iphone, "iPhone", 5), true);
  assert.equal(V.isIos(UA.mac, "MacIntel", 5), true, "iPad en mode bureau");
  assert.equal(V.isIos(UA.mac, "MacIntel", 0), false);
  assert.equal(V.isIos(UA.android, "Linux armv8l", 5), false);
  const k = W.generateKeys().publicKey, bytes = V.keyBytes(k);
  assert.equal(bytes.length, 65); assert.equal(bytes[0], 4);
  assert.equal(V.sameKey(bytes.buffer, k), true); assert.equal(V.sameKey(V.keyBytes(W.generateKeys().publicKey).buffer, k), false);
  assert.equal(V.sameKey(null, k), true, "clé inconnue (navigateur ancien) : le serveur tranche");
});
