"use strict";
// Session client par cookie HttpOnly (IDEAS B3, specs/013-cookie-client-httponly) sur le moteur
// SQL : le jeton signé ne quitte plus le serveur que dans le cookie famo_klant (HttpOnly, Secure,
// SameSite=Strict, Path=/api) ; les routes client le lisent ; le jeton dans le corps reste accepté
// jusqu'au 31/10/2026 inclus (transition) ; déconnexion = génération +1 et cookie effacé ;
// garde Origin + JSON avant toute authentification.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
process.env.SESSION_SECRET = "sessie-geheim-voor-de-cookietests-0123456789";
delete process.env.RESEND_API_KEY;
delete process.env.PORTAL_URL;
delete process.env.VERCEL;
delete process.env.FAMO_DEV_HTTP;
process.removeAllListeners("warning"); // node:sqlite est « expérimental » : bruit inutile

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));

const H = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
function mkRes() {
  return {
    statusCode: 200, payload: null, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.payload = p; return this; }
  };
}
let ip = 0;
// cookie : jeton client (chaîne) → en-tête Cookie ; headers : remplace H.
async function call(file, body, opts) {
  const o = opts || {};
  const headers = Object.assign({ "x-forwarded-for": "10.7.0." + (++ip % 250) }, o.headers || H);
  if (o.cookie) headers.cookie = "famo_klant=" + encodeURIComponent(o.cookie);
  const res = mkRes();
  await require(path.join(ROOT, "api", file))({ method: o.method || "POST", body, headers, query: {} }, res);
  return res;
}
const setCookies = (res) => [].concat(res.headers["set-cookie"] || []);
const klantCookie = (res) => setCookies(res).find((c) => /^famo_klant=/.test(String(c))) || "";
const tokenOf = (res) => { const m = /^famo_klant=([^;]*)/.exec(klantCookie(res)); return m ? decodeURIComponent(m[1]) : ""; };
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
async function patch(tbl, id, fields) {
  const cur = await store().get(tbl, id);
  await store().update(tbl, id, Object.assign({}, cur.fields, fields), cur.version);
}
// Horloge fixée (date de fin de transition) ; le temps continue de s'écouler à partir de là.
async function at(iso, fn) {
  const real = Date.now, start = real(), t0 = Date.parse(iso);
  Date.now = () => t0 + (real() - start);
  try { return await fn(); } finally { Date.now = real; }
}

async function seed() {
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6, Leverdagen: "ma,di,wo,do,vr,za,zo" })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 30, "Unité": "kg", Actif: true })]);
  await store().replaceAll("Clients", [
    rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "resto", Wachtwoord: ca.hashPassword("hoofd-login-1"), Email: "zaak@resto.test", Taal: "FR" }),
    rec("recCLB", { Nom: "Resto B", Gebruikersnaam: "anders", Wachtwoord: ca.hashPassword("ander-login-1") })
  ]);
  await store().replaceAll("Prix négociés", []);
  await store().replaceAll("Commandes", [rec("recORD1", { "Référence": "CMD-2026-0001", Client: ["recCLA"], Date: "2026-09-30", Statut: "Reçue", "Lignes (produits / quantités)": "Tong × 1 kg [€30.00]", Total: 30 })]);
  await store().replaceAll("Klantgebruikers", []);
}
const login = (user, pw) => call("catalogue.js", { user, pw });
// Une requête authentifiée par route client (corps sans jeton ni mot de passe).
const ROUTES = [
  ["catalogue.js", {}],
  ["orders.js", {}],
  ["klantdoc.js", { ref: "CMD-2026-0001" }],
  ["klantorder.js", { action: "favorites", favorieten: ["recP1"], standaard: {} }],
  ["order.js", { items: [{ productId: "recP1", quantity: 1 }], confirm: true }]
];

test("connexion : cookie HttpOnly + Secure + SameSite=Strict + Path=/api, aucun jeton dans la réponse", async () => {
  await seed();
  const r = await login("resto", "hoofd-login-1");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const c = klantCookie(r);
  assert.ok(c, "Set-Cookie famo_klant présent");
  assert.match(c, /;\s*HttpOnly(;|$)/i);
  assert.match(c, /;\s*Secure(;|$)/i);
  assert.match(c, /;\s*SameSite=Strict(;|$)/i);
  assert.match(c, /;\s*Path=\/api(;|$)/);
  const maxAge = Number((/Max-Age=(\d+)/.exec(c) || [])[1]);
  assert.ok(maxAge > 43000 && maxAge <= 43200, "Max-Age = durée du jeton (12 h) : " + maxAge);
  const tok = tokenOf(r);
  assert.match(tok, /^k\.recCLA\./, "le cookie porte le jeton signé existant");
  assert.ok(ca.readToken(tok), "jeton valable");
  assert.equal(r.payload.token, undefined, "plus de jeton dans le corps");
  assert.ok(!JSON.stringify(r.payload).includes(tok), "le jeton n'apparaît nulle part dans la réponse");
  assert.ok(!JSON.stringify(r.payload).includes("hoofd-login-1"), "jamais le mot de passe");
  // Mauvais mot de passe : ni cookie, ni jeton.
  const bad = await login("resto", "fout-wachtwoord");
  assert.equal(bad.statusCode, 401); assert.equal(klantCookie(bad), "");
});

test("toutes les routes client s'authentifient par le cookie seul", async () => {
  await seed();
  const tok = tokenOf(await login("resto", "hoofd-login-1"));
  for (const [file, body] of ROUTES) {
    const r = await call(file, Object.assign({ user: "resto" }, body), { cookie: tok });
    assert.equal(r.statusCode, 200, file + " → " + r.statusCode + " " + JSON.stringify(r.payload));
    assert.equal(r.payload.token, undefined, file + " : pas de jeton dans le corps");
  }
  // Sans identifiant annoncé (outils, tests) : le cookie suffit aussi.
  assert.equal((await call("orders.js", {}, { cookie: tok })).statusCode, 200);
  // Sans cookie ni jeton : 401 partout.
  for (const [file, body] of ROUTES) {
    const r = await call(file, Object.assign({ user: "resto" }, body));
    assert.equal(r.statusCode, 401, file + " sans session → " + r.statusCode);
  }
  const anon = await call("catalogue.js", { user: "resto" });
  assert.equal(anon.payload.expired, true, "sans mot de passe : « Sessie verlopen »");
  // La commande passée par cookie est bien celle du client du cookie.
  const cmd = (await store().list("Commandes")).find((x) => x.id !== "recORD1");
  assert.deepEqual(cmd.fields.Client, ["recCLA"]);
});

test("renouvellement : le catalogue repose un cookie neuf, iat de la connexion conservé", async () => {
  await seed();
  const first = tokenOf(await login("resto", "hoofd-login-1"));
  const iat = ca.readToken(first).iat;
  const r = await at(new Date(Date.now() + 3 * 3600e3).toISOString(), () => call("catalogue.js", { user: "resto" }, { cookie: first }));
  assert.equal(r.statusCode, 200);
  const renewed = tokenOf(r);
  assert.ok(renewed && renewed !== first, "cookie renouvelé");
  assert.equal(ca.readToken(renewed).iat, iat, "durée maximale comptée depuis la connexion");
  // Les autres routes ne reposent pas de cookie quand le cookie a servi.
  assert.equal(klantCookie(await call("orders.js", { user: "resto" }, { cookie: first })), "");
});

test("transition : jeton du corps accepté jusqu'au 31/10/2026 inclus, converti en cookie, puis ignoré", async () => {
  await seed();
  assert.equal(ca.BODY_TOKEN_UNTIL, Date.parse("2026-11-01T00:00:00+01:00"), "fin : 01/11/2026 00:00 à Bruxelles");
  await at("2026-10-31T21:00:00Z", async () => {
    // Jeton émis par l'ancienne version (gardé dans l'onglet) : sans cookie, dans le corps.
    const old = ca.issueToken({ id: "recCLA", fields: (await store().get("Clients", "recCLA")).fields });
    for (const [file, body] of ROUTES) {
      const r = await call(file, Object.assign({ user: "resto", token: old }, body));
      assert.equal(r.statusCode, 200, file + " (transition) → " + r.statusCode + " " + JSON.stringify(r.payload));
      const moved = tokenOf(r);
      assert.ok(moved, file + " : le jeton du corps est converti en cookie");
      assert.equal(ca.readToken(moved).iat, ca.readToken(old).iat, file + " : même connexion (iat)");
    }
  });
  const fields = (await store().get("Clients", "recCLA")).fields;
  const old = await at("2026-10-31T22:00:00Z", () => ca.issueToken({ id: "recCLA", fields }));
  assert.equal(await at("2026-10-31T22:59:58Z", () => ca.bodyTokenAllowed()), true, "31/10 23:59 à Bruxelles : encore accepté");
  const before = await at("2026-10-31T22:59:58Z", () => call("orders.js", { user: "resto", token: old }));
  assert.equal(before.statusCode, 200, "dernière minute de la transition");
  const after = await at("2026-10-31T23:00:01Z", () => call("orders.js", { user: "resto", token: old }));
  assert.equal(after.statusCode, 401, "01/11 00:00 à Bruxelles : le jeton du corps est ignoré");
  assert.equal(klantCookie(after), "");
  const cookie = await at("2026-10-31T23:00:01Z", () => call("orders.js", { user: "resto" }, { cookie: old }));
  assert.equal(cookie.statusCode, 200, "le même jeton dans le cookie reste valable");
});

test("cookie prioritaire : le jeton du corps ne sert que si le cookie manque ou ne vaut rien", async () => {
  await seed();
  const a = tokenOf(await login("resto", "hoofd-login-1"));
  const b = tokenOf(await login("anders", "ander-login-1"));
  // Cookie de A + jeton de B dans le corps, sans identifiant annoncé : c'est A.
  const r = await call("catalogue.js", { token: b }, { cookie: a });
  assert.equal(r.statusCode, 200); assert.equal(r.payload.client.id, "recCLA", "le cookie prime");
  // Cookie illisible + jeton du corps valable (transition) : le corps sert, le cookie est remplacé.
  const r2 = await call("catalogue.js", { user: "anders", token: b }, { cookie: "k.rommel" });
  assert.equal(r2.statusCode, 200); assert.equal(r2.payload.client.id, "recCLB");
  assert.match(tokenOf(r2), /^k\.recCLB\./);
});

test("deux onglets, deux comptes : identifiant annoncé ≠ session du cookie → 401", async () => {
  await seed();
  const b = tokenOf(await login("anders", "ander-login-1"));
  const before = (await store().list("Commandes")).length;
  for (const [file, body] of ROUTES) {
    const r = await call(file, Object.assign({ user: "resto" }, body), { cookie: b });
    assert.equal(r.statusCode, 401, file + " : l'onglet de « resto » ne doit pas agir au nom de « anders »");
  }
  assert.equal((await store().list("Commandes")).length, before, "aucune commande au nom du mauvais compte");
  assert.equal((await call("orders.js", { user: "  ANDERS " }, { cookie: b })).statusCode, 200, "même identifiant (casse, espaces) : accepté");
});

test("déconnexion : génération +1, cookie effacé (même sans session), anciens cookies refusés partout", async () => {
  await seed();
  const tablet = tokenOf(await login("resto", "hoofd-login-1"));
  const phone = tokenOf(await login("resto", "hoofd-login-1"));
  const out = await call("klantwachtwoord.js", { action: "logout" }, { cookie: tablet });
  assert.equal(out.statusCode, 200, JSON.stringify(out.payload));
  const clear = klantCookie(out);
  assert.match(clear, /^famo_klant=;/, "valeur vidée");
  assert.match(clear, /Max-Age=0/); assert.match(clear, /Path=\/api/); assert.match(clear, /HttpOnly/);
  assert.equal((await store().get("Clients", "recCLA")).fields["Sessiegeneratie"], 1);
  for (const tok of [tablet, phone]) {
    for (const [file, body] of ROUTES) {
      const r = await call(file, Object.assign({ user: "resto" }, body), { cookie: tok });
      assert.equal(r.statusCode, 401, file + " : cookie révoqué → " + r.statusCode);
    }
  }
  // Déconnexion sans session (cookie absent ou révoqué) : neutre, cookie effacé quand même.
  const again = await call("klantwachtwoord.js", { action: "logout" }, { cookie: tablet });
  assert.equal(again.statusCode, 200); assert.match(klantCookie(again), /Max-Age=0/);
  const none = await call("klantwachtwoord.js", { action: "logout" });
  assert.equal(none.statusCode, 200); assert.match(klantCookie(none), /Max-Age=0/);
  assert.equal((await store().get("Clients", "recCLA")).fields["Sessiegeneratie"], 1, "rien d'écrit sans session");
  // Transition : un ancien onglet déconnecte avec le jeton du corps.
  const fresh = tokenOf(await login("resto", "hoofd-login-1"));
  const viaBody = await call("klantwachtwoord.js", { action: "logout", token: fresh });
  assert.equal(viaBody.statusCode, 200); assert.equal((await store().get("Clients", "recCLA")).fields["Sessiegeneratie"], 2);
  assert.equal((await call("orders.js", {}, { cookie: fresh })).statusCode, 401);
});

test("révocation : mot de passe changé ailleurs ou génération augmentée → cookie refusé", async () => {
  await seed();
  const tok = tokenOf(await login("resto", "hoofd-login-1"));
  assert.equal((await call("orders.js", {}, { cookie: tok })).statusCode, 200);
  await patch("Clients", "recCLA", { Wachtwoord: ca.hashPassword("door-beheer-gezet") });
  const r = await call("catalogue.js", { user: "resto" }, { cookie: tok });
  assert.equal(r.statusCode, 401); assert.equal(r.payload.expired, true);
  const tok2 = tokenOf(await login("resto", "door-beheer-gezet"));
  await patch("Clients", "recCLA", { Sessiegeneratie: 5 }); // déconnexion depuis un autre appareil
  assert.equal((await call("orders.js", {}, { cookie: tok2 })).statusCode, 401);
});

test("changement de mot de passe (Account) et lien e-mail : nouveau cookie, jamais de jeton en réponse", async () => {
  await seed();
  const tok = tokenOf(await login("resto", "hoofd-login-1"));
  const ch = await call("klantwachtwoord.js", { user: "resto", pw: "hoofd-login-1", nieuw: "nieuw-login-22" }, { cookie: tok });
  assert.equal(ch.statusCode, 200, JSON.stringify(ch.payload));
  assert.equal(ch.payload.token, undefined, "pas de jeton dans le corps");
  const nt = tokenOf(ch);
  assert.match(nt, /^k\.recCLA\./, "nouveau cookie posé");
  assert.match(klantCookie(ch), /HttpOnly/);
  assert.equal((await call("orders.js", {}, { cookie: tok })).statusCode, 401, "l'ancien cookie ne vaut plus");
  assert.equal((await call("orders.js", {}, { cookie: nt })).statusCode, 200, "le nouveau fonctionne");
  // Mauvais mot de passe actuel : aucun cookie.
  const bad = await call("klantwachtwoord.js", { user: "resto", pw: "fout", nieuw: "nog-een-login" }, { cookie: nt });
  assert.equal(bad.statusCode, 401); assert.equal(klantCookie(bad), "");
  // Lien « choisir un mot de passe » : connecté dans la foulée, par cookie.
  const link = ca.issueResetToken({ id: "recCLB", fields: (await store().get("Clients", "recCLB")).fields }, ca.ACTIVATION_TTL_MS);
  const set = await call("klantwachtwoord.js", { action: "setPassword", token: link, nieuw: "via-de-link-7" });
  assert.equal(set.statusCode, 200, JSON.stringify(set.payload));
  assert.equal(set.payload.user, "anders"); assert.equal(set.payload.token, undefined);
  const st = tokenOf(set);
  assert.match(st, /^k\.recCLB\./);
  assert.equal((await call("catalogue.js", { user: "anders" }, { cookie: st })).statusCode, 200, "connecté dans la foulée");
  const used = await call("klantwachtwoord.js", { action: "setPassword", token: link, nieuw: "tweede-keer-7" });
  assert.equal(used.statusCode, 400); assert.equal(klantCookie(used), "", "lien déjà utilisé : aucun cookie");
});

test("CSRF : origine étrangère ou null → 403, pas du JSON → 415, GET → 405, même avec un cookie valable", async () => {
  await seed();
  const tok = tokenOf(await login("resto", "hoofd-login-1"));
  const files = ["catalogue.js", "orders.js", "order.js", "klantorder.js", "klantdoc.js", "klantwachtwoord.js"];
  const realGet = store().get.bind(store()), realList = store().list.bind(store());
  let reads = 0;
  store().get = async (...a) => { reads++; return realGet(...a); };
  store().list = async (...a) => { reads++; return realList(...a); };
  try {
    for (const f of files) {
      const body = { user: "resto", action: f === "klantwachtwoord.js" ? "logout" : "favorites", items: [{ productId: "recP1", quantity: 1 }], ref: "CMD-2026-0001" };
      const evil = await call(f, body, { cookie: tok, headers: { host: "localhost", origin: "https://evil.example", "content-type": "application/json" } });
      assert.equal(evil.statusCode, 403, f + " : origine étrangère → " + evil.statusCode);
      const nul = await call(f, body, { cookie: tok, headers: { host: "localhost", origin: "null", "content-type": "application/json" } });
      assert.equal(nul.statusCode, 403, f + " : origine null → " + nul.statusCode);
      const ref = await call(f, body, { cookie: tok, headers: { host: "localhost", referer: "https://evil.example/page", "content-type": "application/json" } });
      assert.equal(ref.statusCode, 403, f + " : Referer étranger sans Origin → " + ref.statusCode);
      const form = await call(f, body, { cookie: tok, headers: { host: "localhost", origin: "http://localhost", "content-type": "text/plain" } });
      assert.equal(form.statusCode, 415, f + " : text/plain → " + form.statusCode);
      const get = await call(f, null, { method: "GET", cookie: tok, headers: { host: "localhost" } });
      assert.equal(get.statusCode, 405, f + " : GET → " + get.statusCode);
      for (const r of [evil, nul, ref, form, get]) assert.equal(klantCookie(r), "", f + " : aucun cookie posé ni effacé");
    }
    assert.equal(reads, 0, "refus avant toute lecture de la base");
  } finally { store().get = realGet; store().list = realList; }
  assert.equal((await store().get("Clients", "recCLA")).fields["Sessiegeneratie"] || 0, 0, "aucune déconnexion forcée par un autre site");
  // Chaque route client commence par la garde (contrôle textuel, comme les autres handlers).
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, "api", f), "utf8");
    assert.match(src, /module\.exports = async \(req, res\) => \{\s*\n\s*if \(require\("\.\.\/lib\/guard"\)\.blocked\(req, res\)\) return;/, f + " : garde en première ligne");
  }
});

test("cookie falsifié, d'un autre format ou illisible → 401 sans lecture de la base", async () => {
  await seed();
  const good = tokenOf(await login("resto", "hoofd-login-1"));
  const realGet = store().get.bind(store());
  let reads = 0;
  store().get = async (...a) => { reads++; return realGet(...a); };
  try {
    for (const bad of [good.replace(/^k\.recCLA\./, "k.recCLB."), good.slice(0, -3) + "abc", "r.recCLA.9999999999999.abc.sig", "%E0%A4%A", "k"]) {
      const res = mkRes();
      await require(path.join(ROOT, "api", "orders.js"))({ method: "POST", body: {}, headers: Object.assign({ cookie: "famo_klant=" + bad }, H), query: {} }, res);
      assert.equal(res.statusCode, 401, bad);
    }
    assert.equal(reads, 0, "signature vérifiée avant toute lecture");
  } finally { store().get = realGet; }
});

test("base injoignable pendant la vérification du cookie → 503, cookie gardé", async () => {
  await seed();
  const tok = tokenOf(await login("resto", "hoofd-login-1"));
  const realGet = store().get.bind(store());
  store().get = async () => { throw new Error("connection reset"); };
  try {
    for (const [file, body] of ROUTES) {
      const r = await call(file, Object.assign({ user: "resto" }, body), { cookie: tok });
      assert.equal(r.statusCode, 503, file + " → " + r.statusCode);
      assert.equal(klantCookie(r), "", file + " : le cookie n'est pas effacé");
    }
  } finally { store().get = realGet; }
});

test("FAMO_DEV_HTTP=1 (test http local) retire Secure, jamais sur Vercel", async () => {
  await seed();
  process.env.FAMO_DEV_HTTP = "1";
  try {
    assert.doesNotMatch(klantCookie(await login("resto", "hoofd-login-1")), /Secure/i);
    process.env.VERCEL = "1";
    assert.match(klantCookie(await login("resto", "hoofd-login-1")), /;\s*Secure/i);
  } finally { delete process.env.FAMO_DEV_HTTP; delete process.env.VERCEL; }
});

test("navigateur : aucun jeton client gardé ni lu par les pages ; le service worker ignore /api/", () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const start = read("assets/pages/start.js"), pw = read("assets/pages/wachtwoord.js"), klant = read("assets/pages/klant.js");
  assert.ok(!/token:\s*d\.token/.test(start + pw), "start / wachtwoord : jeton de réponse jamais stocké");
  assert.ok(!/setToken|d\.token|changed\.token/.test(klant), "klant.js : plus de jeton renouvelé côté navigateur");
  assert.match(read("sw.js"), /if \(url\.pathname\.startsWith\("\/api\/"\)\) return;/, "sw.js : /api/ jamais en cache, cookie envoyé par le navigateur");
  assert.match(read("assets/ui.js"), /credentials: "include"/, "K.api envoie le cookie");
});
