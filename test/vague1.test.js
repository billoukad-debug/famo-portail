"use strict";
// Spec 032 (vague 1) : pied de page légal, champs WhatsApp / FAVV, santé publique réduite.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY; // e-mails inertes
process.removeAllListeners("warning"); // node:sqlite est « expérimental »
global.fetch = async (url) => { throw new Error("Réseau interdit dans les tests : " + String(url)); };

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));

const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, end() { return this; } }; }
async function call(file, body, opts) {
  const res = mkRes();
  await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || {}, query: (opts && opts.query) || {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fieldsOf = async (table, id) => (await store().get(table, id)).fields;
async function seed() {
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-nummer": "BE0788705713", "BTW-tarief": 6 })]);
  await store().replaceAll("Journaal", []);
}
const beheer = (body) => call("onboarding.js", body, { headers: cookie("admin") });

// assets/ui.js dans un faux navigateur, avec deux éléments du pied de page.
function loadK() {
  const els = { pubFtLegal: { textContent: "" }, pubFtContact: { innerHTML: "" } };
  const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: (id) => els[id] || null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: null, localStorage: null, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8"), Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => ({}) }));
  return { K: win.K, els };
}

test("K.waLink : numéros belges et internationaux, rien si illisible", () => {
  const { K } = loadK();
  assert.equal(K.waLink("+32 470 12 34 56"), "https://wa.me/32470123456");
  assert.equal(K.waLink("0032 470 12 34 56"), "https://wa.me/32470123456");
  assert.equal(K.waLink("0470/12.34.56"), "https://wa.me/32470123456");
  assert.equal(K.waLink("+32 (0)470 12 34 56"), "https://wa.me/32470123456", "« (0) » retiré");
  assert.equal(K.telHref("+32 (0)3 231 45 67"), "+3232314567");
  for (const bad of ["", null, "12345", "abc", "+1234567890123456"]) assert.equal(K.waLink(bad), "", JSON.stringify(bad));
});

test("pied de page : identité légale et contact, jamais de valeur inventée", () => {
  const { K, els } = loadK();
  assert.equal(K.legalNameOf({ legal: { naam: "Famo Trading", rechtsvorm: "BV" } }), "Famo Trading BV");
  assert.equal(K.legalNameOf({ legal: { naam: "Famo Trading BV", rechtsvorm: "BV" } }), "Famo Trading BV", "forme pas répétée");
  assert.equal(K.legalNameOf({}), "");
  const html = K.publicFooter();
  for (const href of ["/privacy", "/voorwaarden", "/colofon", "/team/aanmelden"]) assert.ok(html.includes('href="' + href + '"'), href);
  assert.ok(!html.includes("/beheer/aanmelden"), "plus de bouton Beheer sur les pages publiques");
  K.fillPublicFooter({ adres: "Jezusstraat 24", plaats: "2000 Antwerpen", btw: "BE0788705713", email: "info@example.be", telefoon: "+32 3 000 00 00", whatsapp: "0470 12 34 56", favv: "2.123.456", legal: { naam: "Famo Trading", rechtsvorm: "BV", ondernemingsnummer: "0788.705.713", rpr: "RPR Antwerpen, afdeling Antwerpen" } });
  assert.equal(els.pubFtLegal.textContent, "Famo Trading BV · Jezusstraat 24, 2000 Antwerpen · Ondernemingsnummer 0788.705.713 · Btw BE0788705713 · RPR Antwerpen, afdeling Antwerpen · FAVV 2.123.456");
  assert.ok(els.pubFtContact.innerHTML.includes('href="mailto:info@example.be"'));
  assert.ok(els.pubFtContact.innerHTML.includes('href="tel:+3230000000"'));
  assert.ok(els.pubFtContact.innerHTML.includes('href="https://wa.me/32470123456"'));
  K.fillPublicFooter({ btw: "BE0788705713" });
  assert.equal(els.pubFtLegal.textContent, "Btw BE0788705713", "champs vides absents");
  assert.equal(els.pubFtContact.innerHTML, "", "pas de contact inventé");
});

test("Beheer → Bedrijf : WhatsApp et FAVV enregistrés, publiés avec le contact (sans IBAN)", async () => {
  await seed();
  const r = await beheer({ action: "saveConfig", bedrijfsnaam: "FAMO Seafood", btw: "BE0788705713", iban: "BE68539007547034", juridischeNaam: "Famo Trading", rechtsvorm: "BV", rpr: "RPR Antwerpen, afdeling Antwerpen", whatsapp: "+32 470 12 34 56", favv: "2.123.456", leverdagen: "1,2,3,4,5" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const f = await fieldsOf("Configuratie", "recCONF");
  assert.equal(f.WhatsApp, "+32 470 12 34 56");
  assert.equal(f["FAVV-nummer"], "2.123.456");
  const pub = await call("config.js", null, { method: "GET", query: { public: "1" } });
  assert.equal(pub.statusCode, 200, JSON.stringify(pub.payload));
  assert.equal(pub.payload.config.whatsapp, "+32 470 12 34 56");
  assert.equal(pub.payload.config.favv, "2.123.456");
  assert.equal(pub.payload.config.legal.naam, "Famo Trading");
  assert.equal(pub.payload.config.iban, undefined, "IBAN jamais public");
  const bad = await beheer({ action: "saveConfig", bedrijfsnaam: "FAMO Seafood", btw: "BE0788705713", whatsapp: "12345", leverdagen: "1,2,3,4,5" });
  assert.equal(bad.statusCode, 400, "numéro WhatsApp illisible refusé");
  assert.match(bad.payload.error, /WhatsApp/);
});

test("/api/health : le public ne voit que ok et l'heure, l'équipe voit le détail", async () => {
  await seed();
  process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
  try {
    const pub = await call("health.js", null, { method: "GET" });
    assert.equal(pub.statusCode, 200, JSON.stringify(pub.payload));
    assert.deepStrictEqual(Object.keys(pub.payload).sort(), ["checks", "ok", "time"]);
    assert.ok(!/version|backend|region|database|"ms"/.test(JSON.stringify(pub.payload)), "ni version, ni base, ni région");
    assert.equal(pub.payload.ok, true);
    assert.match(JSON.stringify(pub.payload), /"ok":true/, "la sonde watch.yml lit toujours ok:true");
    const team = await call("health.js", null, { method: "GET", headers: cookie("staff") });
    assert.equal(team.payload.version, "abcdef1");
    assert.equal(team.payload.checks.database.ok, true);
    const forged = await call("health.js", null, { method: "GET", headers: { cookie: "famo_sess=nep" } });
    assert.equal(forged.payload.version, undefined, "cookie invalide = public");
  } finally { delete process.env.VERCEL_GIT_COMMIT_SHA; }
});
