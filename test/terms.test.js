"use strict";
// Conditions générales (audit C-12) sur le moteur SQL : publication, demande d'accès,
// commande refusée tant que la version publiée n'est pas acceptée, acceptation journalisée.
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
const terms = require(path.join(ROOT, "lib", "terms.js"));
const H = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const admin = Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, "admin")) }, H);
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; }
async function call(file, body, opts) { const res = mkRes(); await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || H, query: (opts && opts.query) || {} }, res); return res; }
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;

async function seed() {
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-nummer": "BE0788705713", "BTW-tarief": 6, Leverdagen: "ma,di,wo,do,vr,za,zo" })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 30, "Unité": "kg", Actif: true })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "resto", Wachtwoord: ca.hashPassword("welkom-123") })]);
  await store().replaceAll("Commandes", []);
  await store().replaceAll("Prix négociés", []);
  await store().replaceAll("Aanvragen", []);
}
const order = () => call("order.js", { user: "resto", pw: "welkom-123", items: [{ productId: "recP1", quantity: 2 }] });

test("sans version publiée : rien n'est exigé (commande et demande d'accès)", async () => {
  await seed();
  const o = await order();
  assert.equal(o.statusCode, 200, JSON.stringify(o.payload));
  const s = await call("signup.js", { bedrijfsnaam: "Nieuw", contactpersoon: "Jan", email: "jan@nieuw.test", telefoon: "03 000 00 00" }, { headers: Object.assign({ "x-forwarded-for": "10.1.0.1" }, H) });
  assert.equal(s.statusCode, 200, JSON.stringify(s.payload));
});

test("publication → commande refusée (409 needTerms) → acceptation → commande acceptée", async () => {
  await seed();
  assert.equal((await call("onboarding.js", { action: "saveVoorwaarden", nl: "", fr: "", publish: true }, { headers: admin })).statusCode, 400, "rien à publier");
  const pub = await call("onboarding.js", { action: "saveVoorwaarden", nl: "# Artikel 1\nLevering franco.", fr: "# Article 1\nLivraison franco.", publish: true }, { headers: admin });
  assert.equal(pub.statusCode, 200, JSON.stringify(pub.payload));
  const versie = pub.payload.config.voorwaarden.versie;
  assert.match(versie, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  // Publique : version dans le bloc contact, texte sur ?voorwaarden=1.
  const pubCfg = await call("config.js", null, { method: "GET", query: { voorwaarden: "1" }, headers: {} });
  assert.equal(pubCfg.payload.voorwaarden.versie, versie); assert.match(pubCfg.payload.voorwaarden.fr, /Livraison franco/);
  const blocked = await order();
  assert.equal(blocked.statusCode, 409); assert.equal(blocked.payload.needTerms, true); assert.equal(blocked.payload.versie, versie);
  assert.equal((await store().list("Commandes")).length, 0, "rien n'est écrit");
  // Une autre version que celle en vigueur est refusée.
  const wrong = await call("klantorder.js", { user: "resto", pw: "welkom-123", action: "acceptTerms", versie: "2000-01-01 00:00" });
  assert.equal(wrong.statusCode, 409);
  const ok = await call("klantorder.js", { user: "resto", pw: "welkom-123", action: "acceptTerms", versie });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload));
  const cl = await store().get("Clients", "recCLA");
  assert.equal(cl.fields["Voorwaarden versie"], versie); assert.ok(Date.parse(cl.fields["Voorwaarden aanvaard op"]) > 0);
  const cat = await call("catalogue.js", { user: "resto", pw: "welkom-123" });
  assert.deepEqual(cat.payload.voorwaarden, { versie, aanvaard: true });
  assert.equal((await order()).statusCode, 200, "commande acceptée après acceptation");
  // Journal d'audit : qui a accepté quelle version.
  const j = (await store().list("Journaal")).map(r => r.fields).find(f => f.Actie === "Voorwaarden aanvaard");
  assert.ok(j && j.Referentie.includes(versie));
  // Une correction de texte sans « publish » ne redemande rien aux clients.
  await call("onboarding.js", { action: "saveVoorwaarden", nl: "# Artikel 1\nLevering franco (coquille).", fr: "x", publish: false }, { headers: admin });
  assert.equal((await order()).statusCode, 200);
});

test("demande d'accès : case obligatoire pour la version en vigueur, gardée comme preuve", async () => {
  await seed();
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "Voorwaarden NL": "x", "Voorwaarden versie": "2026-09-28 10:00" })]);
  const base = { bedrijfsnaam: "Nieuw", contactpersoon: "Jan", email: "jan@nieuw.test", telefoon: "03 000 00 00" };
  const hdr = Object.assign({ "x-forwarded-for": "10.1.0.2" }, H);
  const no = await call("signup.js", base, { headers: hdr });
  assert.equal(no.statusCode, 400); assert.equal(no.payload.needTerms, true);
  const yes = await call("signup.js", Object.assign({ voorwaarden: "2026-09-28 10:00" }, base), { headers: hdr });
  assert.equal(yes.statusCode, 200, JSON.stringify(yes.payload));
  const a = (await store().list("Aanvragen"))[0];
  assert.equal(a.fields["Voorwaarden versie"], "2026-09-28 10:00");
});

test("lib/terms : needs et version", () => {
  assert.equal(terms.needs({}, {}), false);
  assert.equal(terms.needs({ "Voorwaarden versie": "a" }, { "Voorwaarden versie": "b" }), true);
  assert.equal(terms.needs({ "Voorwaarden versie": "b" }, { "Voorwaarden versie": "b" }), false);
  assert.equal(terms.newVersion("2026-09-28T08:05:09Z"), "2026-09-28 10:05:09", "heure de Bruxelles (CEST)");
});
