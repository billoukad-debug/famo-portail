"use strict";
// Relances de paiement (audit H-01) sur le moteur SQL, envoi d'e-mail simulé.
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
const om = require(path.join(ROOT, "lib", "ordermail.js"));
const R = require(path.join(ROOT, "lib", "reminders.js"));
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;

let sent = [], fail = false;
om.enabled = () => true;
om.notifyReminder = async (ctx) => { const m = om.buildReminderMail(ctx); sent.push(m); return fail ? { ok: false, error: "resend" } : { ok: true }; };

const INV = "2026-09-01T09:00:00.000Z"; // facturée le 01/09, échéance 15/09 (14 j)
async function seed(conf, orders) {
  sent = []; fail = false;
  await store().replaceAll("Configuratie", [rec("recCONF", Object.assign({ Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6, Facturatie: "Portaal", "Herinneringen aan": true, IBAN: "BE71096123456769", BIC: "GKCCBEBB" }, conf || {}))]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Zalm", "Prix de base": 20, "Unité": "kg", Actif: true })]);
  await store().replaceAll("Clients", [rec("recNL", { Nom: "Resto NL", Email: "nl@resto.test", Taal: "NL" }), rec("recFR", { Nom: "Chez Paul", Email: "fr@resto.test", Taal: "FR" }), rec("recNO", { Nom: "Zonder mail" })]);
  const base = { Statut: "Facturée", "Statut paiement": "En attente", "Facturée le": INV, "Lignes (produits / quantités)": "Zalm × 5 kg [€20.00]", Total: 100 };
  await store().replaceAll("Commandes", orders || [
    rec("recA", Object.assign({}, base, { "Référence": "CMD-A", Factuurnummer: "FA-2026-0001", Client: ["recNL"] })),
    rec("recB", Object.assign({}, base, { "Référence": "CMD-B", Factuurnummer: "FA-2026-0002", Client: ["recFR"] })),
    rec("recC", Object.assign({}, base, { "Référence": "CMD-C", Factuurnummer: "FA-2026-0003", Client: ["recNL"], "Statut paiement": "Payé" })),
    rec("recD", Object.assign({}, base, { "Référence": "CMD-D", Factuurnummer: "FA-2026-0004", Client: ["recNO"] })),
    rec("recE", Object.assign({}, base, { "Référence": "CMD-E", Factuurnummer: "FA-2026-0005", Client: ["recNL"], "Creditnota nummer": "CN-2026-0001", "Creditnota lignes": "Zalm × 5 kg [€20.00]", "Creditnota montant": 100 }))
  ]);
}
const get = async (id) => (await store().get("Commandes", id)).fields;

test("mode Boekhouder ou interrupteur éteint : rien n'est envoyé", async () => {
  await seed({ Facturatie: "Boekhouder" });
  assert.equal((await R.run({ now: "2026-10-20T08:00:00Z" })).skipped, "boekhouder");
  await seed({ "Herinneringen aan": false });
  assert.equal((await R.run({ now: "2026-10-20T08:00:00Z" })).skipped, "uit");
  assert.equal(sent.length, 0);
});

test("niveaux 1 puis 2, langue du client, idempotence, payée / sans e-mail / créditée ignorées", async () => {
  await seed();
  let out = await R.run({ now: "2026-09-17T08:00:00Z" }); // échéance + 2 j : trop tôt
  assert.equal(out.sent, 0);
  out = await R.run({ now: "2026-09-18T08:00:00Z" }); // échéance + 3 j
  assert.equal(out.sent, 2, JSON.stringify(out)); assert.equal(out.noEmail, 1); assert.equal(out.credited, 1);
  const nl = sent.find(m => m.to === "nl@resto.test"), fr = sent.find(m => m.to === "fr@resto.test");
  assert.equal(nl.subject, "Herinnering: factuur FA-2026-0001 is vervallen");
  assert.match(nl.text, /€ 106,00/, "montant TVAC (6 %)"); assert.match(nl.text, /\+\+\+202\/6000\/00196\+\+\+|\+\+\+/);
  assert.match(fr.subject, /FA-2026-0002/); assert.match(fr.text, /106,00\s€/);
  assert.ok(!/Herinnering|factuur/.test(fr.text), "e-mail FR sans néerlandais");
  assert.ok((await get("recA"))["Herinnering 1 op"]);
  assert.match((await get("recA")).Correcties, /Betalingsherinnering 1 verstuurd/);
  assert.equal((await get("recC"))["Herinnering 1 op"], undefined, "payée : rien");
  // Deuxième passage le même jour : rien de nouveau.
  sent = [];
  assert.equal((await R.run({ now: "2026-09-18T15:00:00Z" })).sent, 0);
  // Échéance + 17 j : deuxième relance.
  out = await R.run({ now: "2026-10-02T08:00:00Z" });
  assert.equal(out.sent, 2); assert.match(sent[0].subject, /Tweede herinnering|Second|deuxième|rappel/i);
  assert.ok((await get("recA"))["Herinnering 2 op"]);
  // Plus rien ensuite.
  sent = [];
  assert.equal((await R.run({ now: "2026-11-30T08:00:00Z" })).sent, 0);
  const j = (await store().list("Journaal")).filter(r => /Betalingsherinnering/.test(r.fields.Actie));
  assert.equal(j.length, 4);
});

test("envoi en échec : le niveau est libéré et retenté au passage suivant", async () => {
  await seed();
  fail = true;
  const out = await R.run({ now: "2026-09-18T08:00:00Z" });
  assert.equal(out.failed, 2); assert.equal(out.sent, 0);
  assert.equal((await get("recA"))["Herinnering 1 op"] || null, null);
  fail = false;
  assert.equal((await R.run({ now: "2026-09-19T08:00:00Z" })).sent, 2);
});

test("levelFor : échéance selon le délai de paiement, jamais le niveau 2 avant le 1", () => {
  const f = { Statut: "Facturée", "Statut paiement": "En attente", Factuurnummer: "FA-1", "Facturée le": INV };
  assert.equal(R.levelFor(f, 30, "2026-10-03").level, 0);
  assert.equal(R.levelFor(f, 30, "2026-10-04").level, 1);
  assert.equal(R.levelFor(f, 14, "2026-12-01").level, 1, "très en retard sans 1re relance : on commence par la 1re");
  assert.equal(R.levelFor(Object.assign({}, f, { Statut: "Annulée" }), 14, "2026-12-01").level, 0);
});
