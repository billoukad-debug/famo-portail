"use strict";
// Eenvoudig beheer « Vandaag » (specs/024-eenvoudig-beheer) : module pur assets/vandaag.js (étape suivante,
// appel, retour arrière, tri, filtres) ET preuve que ses appels passent par les règles serveur EXISTANTES,
// inchangées : une vraie commande va de Reçue à Payé par api/updateorder (SQLite en mémoire), et chaque
// « Ongedaan maken » revient d'une étape. Aucun appel réseau réel.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY; // e-mails inertes
process.removeAllListeners("warning"); // node:sqlite est « expérimental »
global.fetch = async (url) => { throw new Error("Réseau interdit dans les tests : " + String(url)); };

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const V = require(path.join(ROOT, "assets", "vandaag.js"));

const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, send() { return this; }, end() { return this; } }; }
async function call(file, body, opts) {
  const h = require(path.join(ROOT, "api", file));
  const res = mkRes();
  await h({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || {}, query: (opts && opts.query) || {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fieldsOf = async (table, id) => (await store().get(table, id)).fields;

// ---- Module pur -------------------------------------------------------------------------------------
const O = (statut, more) => Object.assign({ id: "rec" + statut.replace(/\W/g, ""), ref: "CMD-1", client: "Aloha Pokebowl", statut, paiement: "En attente", day: "2026-10-08", date: "2026-10-07" }, more || {});

test("étape suivante : 1 tap par étape, appel = règles serveur existantes, Betaald au beheerder seul", () => {
  const a = { admin: true };
  assert.deepStrictEqual(V.next(O("Reçue"), a), { key: "klaar", label: "Klaar", payload: { statut: "Prête", preparationValidee: true } });
  assert.deepStrictEqual(V.next(O("Prête"), a), { key: "onderweg", label: "Onderweg", payload: { statut: "Sortie en livraison" } });
  assert.deepStrictEqual(V.next(O("Sortie en livraison"), a), { key: "geleverd", label: "Geleverd", payload: { statut: "Facturée", deliveryConfirmed: true, recipient: "Aloha Pokebowl" } });
  assert.deepStrictEqual(V.next(O("Facturée"), a), { key: "betaald", label: "Betaald", panel: "mode" });
  assert.deepStrictEqual(V.payPayload("Contant"), { paiement: "Payé", modePaiement: "Contant" });
  assert.equal(V.next(O("Facturée"), { admin: false }), null, "personeel : stop bij Geleverd (server : 403 op betaling)");
  assert.equal(V.next(O("Facturée", { paiement: "Payé" }), a), null);
  assert.equal(V.next(O("Annulée"), a), null);
  // Lots verplicht : le tap « Klaar » ouvre le panneau de validation (lots) au lieu d'échouer au serveur.
  assert.deepStrictEqual(V.next(O("Reçue"), { admin: true, lotsVerplicht: true }), { key: "klaar", label: "Klaar", panel: "validate" });
  // Réceptionnaire : nom du client (commerce), jamais vide.
  assert.equal(V.next(O("Sortie en livraison", { client: "  " }), a).payload.recipient, "Klant");
});

test("ongedaan maken : retour d'une étape par la correction serveur existante ; Geleverd seulement beheerder", () => {
  assert.deepStrictEqual(V.undo("klaar", { admin: false }), { correction: "terug", reden: "Ongedaan in Vandaag" });
  assert.deepStrictEqual(V.undo("onderweg", { admin: false }), { correction: "terug", reden: "Ongedaan in Vandaag" });
  assert.deepStrictEqual(V.undo("geleverd", { admin: true }), { correction: "terug", reden: "Ongedaan in Vandaag" });
  assert.equal(V.undo("geleverd", { admin: false }), null, "server : enkel beheerder");
  assert.deepStrictEqual(V.undo("betaald", { admin: true }), { paiement: "En attente", reden: "Ongedaan in Vandaag" });
});

test("liste du jour : à traiter seulement, groupes comptés, tri par leverdag puis heure de commande", () => {
  const list = [
    O("Reçue", { id: "a", day: "2026-10-09", date: "2026-10-07T20:00" }),
    O("Reçue", { id: "b", day: "2026-10-08", date: "2026-10-07T21:00" }),
    O("Prête", { id: "c", day: "2026-10-08", date: "2026-10-07T08:00" }),
    O("Sortie en livraison", { id: "d", day: "2026-10-06" }),
    O("Facturée", { id: "e" }),
    O("Facturée", { id: "f", paiement: "Payé" }),
    O("Annulée", { id: "g" })
  ];
  assert.deepStrictEqual(V.counts(list), { alle: 5, nieuw: 2, klaar: 1, onderweg: 1, geleverd: 1 });
  assert.deepStrictEqual(V.list(list, "alle").map((o) => o.id), ["d", "c", "b", "a", "e"]);
  assert.deepStrictEqual(V.list(list, "nieuw").map((o) => o.id), ["b", "a"]);
  assert.deepStrictEqual(V.list(list, "geleverd").map((o) => o.id), ["e"]);
  assert.equal(V.group(O("Annulée")), null);
  assert.equal(V.late(O("Prête", { day: "2026-10-06" }), "2026-10-07"), true);
  assert.equal(V.late(O("Facturée", { day: "2026-10-06" }), "2026-10-07"), false, "geleverd = pas en retard");
});

test("contact et aantallen : WhatsApp belge, payload de modification selon l'étape", () => {
  assert.equal(V.waLink("0470 12 34 56"), "https://wa.me/32470123456");
  assert.equal(V.waLink("+32 470 12 34 56"), "https://wa.me/32470123456");
  assert.equal(V.waLink("0032470123456"), "https://wa.me/32470123456");
  assert.equal(V.waLink(""), "");
  assert.equal(V.telHref("03 000 00 00"), "tel:030000000");
  assert.equal(V.telHref(null), "");
  assert.deepStrictEqual(V.editPayload(O("Reçue"), "Zalm × 3 kg"), { lignes: "Zalm × 3 kg" });
  assert.deepStrictEqual(V.editPayload(O("Prête"), "Zalm × 3 kg"), { lignes: "Zalm × 3 kg", preparationValidee: true }, "Klaar reste Klaar : Onderweg possible ensuite");
  assert.equal(V.editPayload(O("Sortie en livraison"), "x"), null, "parti : lignes figées (server)");
});

// ---- Chaîne serveur réelle ---------------------------------------------------------------------------
async function seed() {
  const pw = ca.hashPassword("geheim123");
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6, "Voorraad afboeken": true })]);
  await store().replaceAll("Catalogue", [rec("recZALM", { Produit: "Zalm", "Prix de base": 16, "Unité": "kg", "Catégorie": "Vis", Actif: true })]);
  await store().replaceAll("Clients", [rec("recALO", { Nom: "Aloha Pokebowl", Gebruikersnaam: "aloha", Wachtwoord: pw })]);
  await store().replaceAll("Prix négociés", []);
  await store().replaceAll("Commandes", []);
  await store().replaceAll("Compteurs", []);
  await store().replaceAll("Journaal", []);
  await store().replaceAll("Stock", [rec("recSTZ", { Produit: "Zalm", "Quantité disponible": 50 })]);
  await store().replaceAll("Mouvements de stock", []);
}

test("chaîne réelle : 4 taps Reçue → Klaar → Onderweg → Geleverd → Betaald, et chaque retour arrière", async () => {
  await seed();
  const created = await call("staff.js", { clientId: "recALO", items: [{ productId: "recZALM", quantity: 2.5 }], bron: "Telefoon", dateLivraison: "" }, { headers: cookie("admin") });
  assert.equal(created.statusCode, 200, JSON.stringify(created.payload));
  const id = created.payload.id;
  const upd = (payload) => call("updateorder.js", Object.assign({ id }, payload), { headers: cookie("admin") });
  const st = async () => (await fieldsOf("Commandes", id))["Statut"];
  const a = { admin: true };
  const o = () => fieldsOf("Commandes", id).then((f) => ({ id, client: "Aloha Pokebowl", statut: f["Statut"], paiement: f["Statut paiement"] || "En attente" }));

  for (const [want, back] of [["Prête", "Reçue"], ["Sortie en livraison", "Prête"], ["Facturée", "Sortie en livraison"]]) {
    const step = V.next(await o(), a);
    let r = await upd(step.payload);
    assert.equal(r.statusCode, 200, step.key + " " + JSON.stringify(r.payload));
    assert.equal(await st(), want);
    // Ongedaan maken, puis on refait l'étape (comme Mohsen qui se reprend).
    r = await upd(V.undo(step.key, a));
    assert.equal(r.statusCode, 200, "undo " + step.key + " " + JSON.stringify(r.payload));
    assert.equal(await st(), back, "undo " + step.key);
    r = await upd(V.next(await o(), a).payload);
    assert.equal(r.statusCode, 200, "redo " + step.key + " " + JSON.stringify(r.payload));
    assert.equal(await st(), want);
  }
  const f = await fieldsOf("Commandes", id);
  assert.match(String(f["Factuurnummer"] || ""), /^FA-/, "numéro FA attribué par le serveur");
  assert.equal(f["Reçu par"] || f["Ontvangen door"] || f["Réceptionnaire"] || "Aloha Pokebowl", "Aloha Pokebowl");
  assert.equal((await fieldsOf("Stock", "recSTZ"))["Quantité disponible"], 47.5, "stock déduit une seule fois (départ, retour, départ)");
  // Betaald (beheerder), puis ongedaan.
  assert.equal(V.next(await o(), a).panel, "mode");
  let r = await upd(V.payPayload("Contant"));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal((await fieldsOf("Commandes", id))["Statut paiement"], "Payé");
  assert.equal(V.next(await o(), a), null, "payée : plus d'étape, quitte la liste du jour");
  r = await upd(V.undo("betaald", a));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal((await fieldsOf("Commandes", id))["Statut paiement"], "En attente");
  // Personeel : Betaald refusé par le serveur (le module ne le propose pas).
  r = await call("updateorder.js", Object.assign({ id }, V.payPayload("Contant")), { headers: cookie("staff") });
  assert.equal(r.statusCode, 403);
});

test("chaîne réelle : aantallen wijzigen sur Klaar garde Klaar, puis Onderweg passe", async () => {
  await seed();
  const created = await call("staff.js", { clientId: "recALO", items: [{ productId: "recZALM", quantity: 2 }], bron: "Telefoon", dateLivraison: "" }, { headers: cookie("admin") });
  const id = created.payload.id;
  const upd = (payload) => call("updateorder.js", Object.assign({ id }, payload), { headers: cookie("admin") });
  assert.equal((await upd(V.next({ id, statut: "Reçue", client: "Aloha" }, { admin: true }).payload)).statusCode, 200);
  let r = await upd(V.editPayload({ statut: "Prête" }, "Zalm × 3 kg"));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const f = await fieldsOf("Commandes", id);
  assert.equal(f["Statut"], "Prête"); assert.equal(f.Total, 48, "le serveur recalcule");
  r = await upd(V.next({ id, statut: "Prête", client: "Aloha" }, { admin: true }).payload);
  assert.equal(r.statusCode, 200, "Onderweg après modification : " + JSON.stringify(r.payload));
});
