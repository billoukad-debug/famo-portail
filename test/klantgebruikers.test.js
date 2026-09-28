"use strict";
// Plusieurs utilisateurs par client (audit H-08) sur le moteur SQL : création dans Beheer,
// connexion propre, commande attribuée, désactivation / nouveau mot de passe / déconnexion
// qui ne touchent QUE cet utilisateur, unicité du nom d'utilisateur sur les deux tables.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY;

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const H = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const admin = Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, "admin")) }, H);
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; }
let ip = 0;
async function call(file, body, opts) { const res = mkRes(); await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: Object.assign({ "x-forwarded-for": "10.8.0." + (++ip % 250) }, (opts && opts.headers) || H), query: (opts && opts.query) || {} }, res); return res; }
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const ob = (body) => call("onboarding.js", body, { headers: admin });

async function seed() {
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6, Leverdagen: "ma,di,wo,do,vr,za,zo" })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 30, "Unité": "kg", Actif: true })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "resto", Wachtwoord: ca.hashPassword("hoofd-login-1"), Email: "zaak@resto.test" }), rec("recCLB", { Nom: "Resto B", Gebruikersnaam: "anders", Wachtwoord: ca.hashPassword("ander-login-1") })]);
  await store().replaceAll("Prix négociés", [rec("recPN", { Client: ["recCLA"], Produit: ["recP1"], "Prix négocié": 25 })]);
  await store().replaceAll("Commandes", []);
  await store().replaceAll("Klantgebruikers", []);
}
async function addUser(extra) {
  const r = await ob(Object.assign({ action: "saveKlantgebruiker", clientId: "recCLA", naam: "Chef Marco", email: "chef@resto.test" }, extra || {}));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  return r.payload;
}

test("Beheer : ajout, unicité sur les deux tables, liste sans mot de passe", async () => {
  await seed();
  const d = await addUser();
  assert.ok(d.credentials && d.credentials.password.length >= 10, "mot de passe montré une fois");
  assert.equal(d.credentials.user, "chef.marco".slice(0, d.credentials.user.length) === d.credentials.user ? d.credentials.user : d.credentials.user);
  const stored = (await store().get("Klantgebruikers", d.id)).fields;
  assert.ok(ca.isHashed(stored.Wachtwoord), "haché, jamais en clair");
  assert.equal((await ob({ action: "saveKlantgebruiker", clientId: "recCLA", naam: "X", user: "resto" })).statusCode, 409, "déjà pris par un client");
  assert.equal((await ob({ action: "saveKlantgebruiker", clientId: "recCLA", naam: "Y", user: d.credentials.user })).statusCode, 409, "déjà pris par un utilisateur");
  assert.equal((await ob({ action: "saveClient", id: "recCLB", nom: "Resto B", user: d.credentials.user, generate: false })).statusCode, 409, "un client ne peut pas prendre le nom d'un utilisateur");
  const list = await ob({ action: "listKlantgebruikers", clientId: "recCLA" });
  assert.equal(list.payload.users.length, 1); assert.ok(!JSON.stringify(list.payload).includes("scrypt"));
  assert.equal((await call("onboarding.js", { action: "saveKlantgebruiker", clientId: "recCLA", naam: "Z" }, { headers: Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, "staff")) }, H) })).statusCode === 200, false, "personnel refusé");
});

test("connexion de l'utilisateur : prix du client, commande « Besteld door », jeton renouvelé", async () => {
  await seed();
  const { credentials } = await addUser();
  const cat = await call("catalogue.js", { user: credentials.user, pw: credentials.password });
  assert.equal(cat.statusCode, 200, JSON.stringify(cat.payload));
  assert.equal(cat.payload.client.id, "recCLA", "les données sont celles du client");
  assert.equal(cat.payload.products.find(p => p.id === "recP1").prix, 25, "prix négocié du client");
  const tok = cat.payload.token;
  assert.match(tok, /^k\./);
  const again = await call("catalogue.js", { token: tok });
  assert.equal(again.statusCode, 200, "le jeton de l'utilisateur est accepté");
  const o = await call("order.js", { token: tok, items: [{ productId: "recP1", quantity: 2 }] });
  assert.equal(o.statusCode, 200, JSON.stringify(o.payload));
  const cmd = (await store().list("Commandes"))[0].fields;
  assert.deepEqual(cmd.Client, ["recCLA"]); assert.equal(cmd["Besteld door"], "Chef Marco");
  // Le client principal ne voit pas « Besteld door » sur ses propres commandes.
  const own = await call("order.js", { user: "resto", pw: "hoofd-login-1", items: [{ productId: "recP1", quantity: 1 }], confirm: true });
  assert.equal(own.statusCode, 200, JSON.stringify(own.payload));
  assert.ok((await store().list("Commandes")).some(r => !r.fields["Besteld door"]));
});

test("désactivation, nouveau mot de passe, déconnexion : seul cet utilisateur est touché", async () => {
  await seed();
  const { id, credentials } = await addUser();
  const tok = (await call("catalogue.js", { user: credentials.user, pw: credentials.password })).payload.token;
  const mainTok = (await call("catalogue.js", { user: "resto", pw: "hoofd-login-1" })).payload.token;
  // Déconnexion de l'utilisateur : son jeton tombe, celui du client principal reste valable.
  assert.equal((await call("klantwachtwoord.js", { action: "logout", token: tok })).statusCode, 200);
  assert.equal((await call("catalogue.js", { token: tok })).statusCode, 401);
  assert.equal((await call("catalogue.js", { token: mainTok })).statusCode, 200, "client principal pas déconnecté");
  // Changement de son propre mot de passe (page Account).
  const ch = await call("klantwachtwoord.js", { user: credentials.user, pw: credentials.password, nieuw: "eigen-wachtwoord-9" });
  assert.equal(ch.statusCode, 200, JSON.stringify(ch.payload));
  assert.ok(ca.checkPassword((await store().get("Klantgebruikers", id)).fields.Wachtwoord, "eigen-wachtwoord-9"));
  assert.ok(ca.checkPassword((await store().get("Clients", "recCLA")).fields.Wachtwoord, "hoofd-login-1"), "mot de passe du client intact");
  // Désactivé dans Beheer : plus de connexion.
  assert.equal((await ob({ action: "saveKlantgebruiker", id, naam: "Chef Marco", user: credentials.user, email: "chef@resto.test", actief: false })).statusCode, 200);
  assert.equal((await call("catalogue.js", { user: credentials.user, pw: "eigen-wachtwoord-9" })).statusCode, 401);
  // Réactivé + nouveau mot de passe : l'ancien ne vaut plus.
  await ob({ action: "saveKlantgebruiker", id, naam: "Chef Marco", user: credentials.user, email: "chef@resto.test", actief: true });
  const nw = await ob({ action: "resetKlantgebruiker", id });
  assert.equal((await call("catalogue.js", { user: credentials.user, pw: "eigen-wachtwoord-9" })).statusCode, 401);
  assert.equal((await call("catalogue.js", { user: credentials.user, pw: nw.payload.credentials.password })).statusCode, 200);
  // Client archivé : aucun de ses utilisateurs ne se connecte.
  await ob({ action: "archiveClient", id: "recCLA" });
  assert.equal((await call("catalogue.js", { user: credentials.user, pw: nw.payload.credentials.password })).statusCode, 401);
  // Suppression.
  await ob({ action: "unarchiveClient", id: "recCLA" });
  assert.equal((await ob({ action: "deleteKlantgebruiker", id })).statusCode, 200);
  assert.equal((await call("catalogue.js", { user: credentials.user, pw: nw.payload.credentials.password })).statusCode, 401);
});

test("lien « choisir un mot de passe » (activation) pour un utilisateur", async () => {
  await seed();
  const { id } = await addUser();
  const u = await store().get("Klantgebruikers", id);
  const link = ca.issueResetToken({ id, fields: u.fields }, ca.ACTIVATION_TTL_MS);
  const set = await call("klantwachtwoord.js", { action: "setPassword", token: link, nieuw: "via-de-link-7" });
  assert.equal(set.statusCode, 200, JSON.stringify(set.payload));
  assert.equal((await call("catalogue.js", { token: set.payload.token })).statusCode, 200, "connecté dans la foulée");
  assert.equal((await call("klantwachtwoord.js", { action: "setPassword", token: link, nieuw: "tweede-keer-7" })).statusCode, 400, "usage unique");
});

test("D-06 : panne de base pendant la connexion → 503 sur toutes les routes client (export authUnavailable)", async () => {
  await seed();
  const real = store().list.bind(store()), realGet = store().get.bind(store());
  store().list = async () => { throw new Error("connection reset"); };
  store().get = async () => { throw new Error("connection reset"); };
  try {
    for (const f of ["catalogue.js", "order.js", "orders.js", "klantorder.js", "klantdoc.js", "klantwachtwoord.js"]) {
      const body = f === "klantwachtwoord.js" ? { user: "resto", pw: "hoofd-login-1", nieuw: "nieuw-wachtwoord-1" } : { user: "resto", pw: "hoofd-login-1", ref: "CMD-1", items: [{ productId: "recP1", quantity: 1 }] };
      const r = await call(f, body);
      assert.equal(r.statusCode, 503, f + " → " + r.statusCode + " " + JSON.stringify(r.payload));
    }
  } finally { store().list = real; store().get = realGet; }
});
