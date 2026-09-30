"use strict";
// Plusieurs notes de crédit par facture (C-08) sur le moteur SQL (SQLite en mémoire) :
// numéros continus, lignes et montant propres, plafond cumulé par article ET par taux de TVA,
// retour en stock une seule fois par note, anciennes données (une seule note) toujours lues,
// documents client, export comptable, relances et marge sur toutes les notes.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY; // e-mails inertes

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const CN = require(path.join(ROOT, "lib", "creditnota.js"));

const YEAR = auth.brusselsYear();
const nr = (n) => "CN-" + YEAR + "-" + String(n).padStart(4, "0");
const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
function mkRes() { return { statusCode: 200, payload: null, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, send(b) { this.body = b; return this; } }; }
async function call(file, body, opts) {
  const h = require(path.join(ROOT, "api", file));
  const res = mkRes();
  await h({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || {}, query: (opts && opts.query) || {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fieldsOf = async (id) => (await store().get("Commandes", id)).fields;

const FACT = (id, extra) => rec(id, Object.assign({
  "Référence": "CMD-" + YEAR + "-" + id.slice(-4), Date: new Date().toISOString().slice(0, 10), Statut: "Facturée", "Livraison confirmée": true,
  Factuurnummer: "FA-" + YEAR + "-" + id.slice(-4), "Facturée le": new Date().toISOString(), Client: ["recCLA"],
  "Lignes (produits / quantités)": "Tong × 2 kg [€16.00]\nSaus × 3 pièce [€5.00]", Total: 47, "BTW per lijn": JSON.stringify({ tong: 6, saus: 21 })
}, extra || {}));

async function seed(orders, stock) {
  const pw = ca.hashPassword("geheim123");
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "Juridische naam": "Famo Trading", Rechtsvorm: "BV", "BTW-nummer": "BE0788705713", RPR: "RPR Antwerpen", Adres: "Kaai 1", "Postcode en plaats": "2000 Antwerpen", IBAN: "BE71096123456769", "BTW-tarief": 6, Facturatie: "Portaal" })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 16, "Unité": "kg", Actif: true, "BTW-tarief": 6 }), rec("recP2", { Produit: "Saus", "Prix de base": 5, "Unité": "pièce", Actif: true, "BTW-tarief": 21 })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "a", Wachtwoord: pw, Taal: "FR", "BTW-nummer": "BE0417497106", "Lieu de livraison": "Rue 1\n1000 Bruxelles", Email: "chef@resto.test" })]);
  await store().replaceAll("Commandes", orders || []);
  await store().replaceAll("Compteurs", []);
  await store().replaceAll("Stock", stock || []);
  await store().replaceAll("Mouvements de stock", []);
}
const credit = (id, cn, role) => call("updateorder.js", { id, creditnota: Object.assign({ motif: "beschadigd" }, cn) }, { headers: cookie(role || "admin") });

test("lib/creditnota : anciennes données (une note) et nouvelles (liste JSON) lues de la même façon", () => {
  assert.deepStrictEqual(CN.list({}), []);
  const legacy = { "Creditnota nummer": "CN-2026-0001", "Creditnota lignes": "Tong × 1 kg [€16.00]", "Creditnota montant": 16, "Creditnota le": "2026-09-01T10:00:00.000Z", "Creditnota motif": "oud" };
  assert.deepStrictEqual(CN.list(legacy).map((n) => [n.nummer, n.montant, n.motif]), [["CN-2026-0001", 16, "oud"]]);
  // Ajout d'une deuxième note sur une ancienne commande : la liste JSON reprend la première.
  const p = CN.patchFor(legacy, { nummer: "CN-2026-0005", lignes: "Tong × 0.5 kg [€16.00]", montant: 8, le: "2026-09-02T10:00:00.000Z", motif: "nieuw" });
  assert.equal(p["Creditnota nummer"], undefined, "les champs de la première note ne bougent pas");
  const all = CN.list(Object.assign({}, legacy, p));
  assert.deepStrictEqual(all.map((n) => n.nummer), ["CN-2026-0001", "CN-2026-0005"]);
  // Première note sur une commande neuve : champs historiques ET liste JSON.
  const q = CN.patchFor({}, { nummer: "CN-2026-0009", lignes: "Tong × 1 kg [€16.00]", montant: 16, le: "2026-09-02T10:00:00.000Z", motif: "x" });
  assert.equal(q["Creditnota nummer"], "CN-2026-0009"); assert.equal(q["Creditnota montant"], 16);
  assert.deepStrictEqual(CN.list(q).map((n) => n.nummer), ["CN-2026-0009"]);
  assert.equal(CN.totalMontant(Object.assign({}, legacy, p)), 24);
  // JSON illisible : on retombe sur la note historique, rien ne plante.
  assert.deepStrictEqual(CN.list(Object.assign({}, legacy, { Creditnotas: "{kapot" })).map((n) => n.nummer), ["CN-2026-0001"]);
});

test("plusieurs notes sur une facture : numéros continus, lignes, montant et date propres", async () => {
  await seed([FACT("recORD0001"), FACT("recORD0002")]);
  let r = await credit("recORD0001", { lignes: "Tong × 0.5 kg", sleutel: "k1" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.creditnota.nummer, nr(1)); assert.equal(r.payload.creditnota.montant, 8);
  r = await credit("recORD0002", { lignes: "Saus × 1", sleutel: "k2" });
  assert.equal(r.payload.creditnota.nummer, nr(2), "même série CN pour toutes les commandes");
  r = await credit("recORD0001", { lignes: "Saus × 2\nTong × 0.5 kg", motif: "tweede retour", sleutel: "k3" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.creditnota.nummer, nr(3)); assert.equal(r.payload.creditnota.montant, 18);
  assert.equal(r.payload.creditnotas.length, 2);
  const f = await fieldsOf("recORD0001");
  assert.equal(f["Creditnota nummer"], nr(1), "la première note reste dans les champs historiques");
  assert.equal(f["Creditnota montant"], 8);
  const notes = CN.list(f);
  assert.deepStrictEqual(notes.map((n) => [n.nummer, n.montant, n.motif]), [[nr(1), 8, "beschadigd"], [nr(3), 18, "tweede retour"]]);
  assert.equal(notes[1].lignes, "Saus × 2 pièce [€5.00]\nTong × 0.5 kg [€16.00]", "prix figés de la facture");
  assert.ok(Date.parse(notes[1].le) > 0);
  assert.match(f.Correcties, new RegExp("Creditnota " + nr(1) + " \\(€ 8,00\\)"));
  assert.match(f.Correcties, new RegExp("Creditnota " + nr(3) + " \\(€ 18,00\\) · beheerder — tweede retour$"));
  // Liste du personnel : toutes les notes, et « creditnota » = la première (compatibilité).
  const all = await call("allorders.js", null, { method: "GET", headers: cookie("staff") });
  const o = all.payload.orders.find((x) => x.id === "recORD0001");
  assert.equal(o.creditnota.nummer, nr(1));
  assert.deepStrictEqual(o.creditnotas.map((n) => n.nummer), [nr(1), nr(3)]);
  // Personnel : jamais de note de crédit.
  assert.equal((await credit("recORD0001", { lignes: "Saus × 1" }, "staff")).statusCode, 403);
});

test("plafond cumulé : jamais plus que livré par article, toutes notes confondues", async () => {
  await seed([FACT("recORD0003")]);
  assert.equal((await credit("recORD0003", { lignes: "Tong × 1.5 kg" })).statusCode, 200);
  let r = await credit("recORD0003", { lignes: "Tong × 1 kg" });
  assert.equal(r.statusCode, 400); assert.match(r.payload.error, /tussen 0 en 0\.5/);
  assert.equal((await credit("recORD0003", { lignes: "Tong × 0.5 kg" })).statusCode, 200);
  r = await credit("recORD0003", { lignes: "Tong × 0.1 kg" });
  assert.equal(r.statusCode, 400); assert.match(r.payload.error, /al volledig gecrediteerd/);
  assert.equal(CN.list(await fieldsOf("recORD0003")).length, 2, "aucune note refusée n'est écrite");
});

test("plafond par taux de TVA : la somme des notes ne dépasse jamais le montant facturé (arrondis)", async () => {
  // 1,375 kg × 18,49 = 25,42 facturé ; 0,5 kg (9,25) + 0,875 kg (16,18) = 25,43 : un cent de trop.
  await seed([FACT("recORD0004", { "Lignes (produits / quantités)": "Tong × 1.375 kg [€18.49]", Total: 25.42, "BTW per lijn": JSON.stringify({ tong: 6 }) })]);
  assert.equal((await credit("recORD0004", { lignes: "Tong × 0.5 kg" })).statusCode, 200);
  const r = await credit("recORD0004", { lignes: "Tong × 0.875 kg" });
  assert.equal(r.statusCode, 400, JSON.stringify(r.payload)); assert.match(r.payload.error, /6 % btw/);
  assert.equal((await credit("recORD0004", { lignes: "Tong × 0.874 kg" })).statusCode, 200);
});

test("retour en stock par note, une seule fois (clé d'idempotence : double clic, réseau)", async () => {
  await seed([FACT("recORD0005")], [rec("recSTK1", { Produit: "Tong", "Quantité disponible": 10 }), rec("recSTK2", { Produit: "Saus", "Quantité disponible": 4 })]);
  const stock = async (id) => (await store().get("Stock", id)).fields["Quantité disponible"];
  let r = await credit("recORD0005", { lignes: "Tong × 1 kg", retourStock: true, sleutel: "cn-a" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload)); assert.equal(await stock("recSTK1"), 11);
  r = await credit("recORD0005", { lignes: "Saus × 1", sleutel: "cn-b" });
  assert.equal(await stock("recSTK2"), 4, "sans retour : stock intact");
  r = await credit("recORD0005", { lignes: "Tong × 0.5 kg\nSaus × 2", retourStock: true, sleutel: "cn-c" });
  assert.equal(r.statusCode, 200); assert.equal(await stock("recSTK1"), 11.5); assert.equal(await stock("recSTK2"), 6);
  // Même requête rejouée : même note, aucun nouveau numéro, aucun deuxième retour.
  const again = await credit("recORD0005", { lignes: "Tong × 0.5 kg\nSaus × 2", retourStock: true, sleutel: "cn-c" });
  assert.equal(again.statusCode, 200); assert.equal(again.payload.al, true);
  assert.equal(again.payload.creditnota.nummer, r.payload.creditnota.nummer);
  assert.equal(await stock("recSTK1"), 11.5); assert.equal(await stock("recSTK2"), 6);
  const notes = CN.list(await fieldsOf("recORD0005"));
  assert.deepStrictEqual(notes.map((n) => n.retour), [true, false, true]);
  const mv = await store().list("Mouvements de stock");
  assert.equal(mv.filter((m) => m.fields.Type === "Retour client").length, 3, "1 + 2 mouvements, jamais rejoués");
});

test("deux notes simultanées sur deux instances : aucune perdue, plafond tenu", async () => {
  await seed([FACT("recORD0006")]);
  const inst = () => { const p = path.join(ROOT, "api", "updateorder.js"); delete require.cache[require.resolve(p)]; return require(p); };
  const go = async (h, body) => { const res = mkRes(); await h({ method: "POST", body, headers: cookie("admin"), query: {} }, res); return res; };
  let [x, y] = await Promise.all([go(inst(), { id: "recORD0006", creditnota: { motif: "a-kant", lignes: "Tong × 1 kg", sleutel: "p1" } }), go(inst(), { id: "recORD0006", creditnota: { motif: "b-kant", lignes: "Saus × 1", sleutel: "p2" } })]);
  assert.equal(x.statusCode, 200, JSON.stringify(x.payload)); assert.equal(y.statusCode, 200, JSON.stringify(y.payload));
  assert.equal(CN.list(await fieldsOf("recORD0006")).length, 2, "les deux notes sont gardées");
  [x, y] = await Promise.all([go(inst(), { id: "recORD0006", creditnota: { motif: "c-kant", lignes: "Tong × 1 kg", sleutel: "p3" } }), go(inst(), { id: "recORD0006", creditnota: { motif: "d-kant", lignes: "Tong × 1 kg", sleutel: "p4" } })]);
  assert.deepStrictEqual([x.statusCode, y.statusCode].sort(), [200, 409], "1 kg restant : une seule des deux passe");
  const notes = CN.list(await fieldsOf("recORD0006"));
  assert.equal(notes.length, 3);
  assert.equal(new Set(notes.map((n) => n.nummer)).size, 3);
});

test("ancienne commande avec une seule note : une deuxième s'ajoute, la numérotation continue", async () => {
  await seed([FACT("recORD0007", { "Creditnota nummer": nr(7), "Creditnota lignes": "Tong × 1 kg [€16.00]", "Creditnota montant": 16, "Creditnota le": "2026-09-01T10:00:00.000Z", "Creditnota motif": "oud" }),
    FACT("recORD0008", { Creditnotas: JSON.stringify([{ nummer: nr(9), lignes: "Saus × 1 pièce [€5.00]", montant: 5, le: "2026-09-02T10:00:00.000Z", motif: "json" }]), "Creditnota nummer": nr(9), "Creditnota lignes": "Saus × 1 pièce [€5.00]", "Creditnota montant": 5, "Creditnota le": "2026-09-02T10:00:00.000Z", "Creditnota motif": "json" })]);
  const r = await credit("recORD0007", { lignes: "Tong × 1 kg" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.creditnota.nummer, nr(10), "le compteur part du plus grand numéro existant, notes JSON comprises");
  const f = await fieldsOf("recORD0007");
  assert.equal(f["Creditnota nummer"], nr(7)); assert.equal(f["Creditnota motif"], "oud");
  assert.deepStrictEqual(CN.list(f).map((n) => n.nummer), [nr(7), nr(10)]);
  // Tong déjà créditée 1 kg par l'ancienne note + 1 kg : plus rien.
  assert.match((await credit("recORD0007", { lignes: "Tong × 0.5 kg" })).payload.error, /al volledig gecrediteerd/);
  // Réception défaite toujours refusée dès qu'une note existe.
  const t = await call("updateorder.js", { id: "recORD0007", correction: "terug", reden: "fout getekend" }, { headers: cookie("admin") });
  assert.equal(t.statusCode, 409);
});

test("portail client : toutes les notes (liste et documents), jamais celles d'un autre client", async () => {
  await seed([FACT("recORD0010")]);
  await credit("recORD0010", { lignes: "Tong × 1 kg" });
  await credit("recORD0010", { lignes: "Saus × 1", motif: "kapot" });
  const token = ca.issueToken({ id: "recCLA", fields: (await store().get("Clients", "recCLA")).fields });
  const list = await call("orders.js", { token });
  assert.equal(list.statusCode, 200, JSON.stringify(list.payload));
  const o = list.payload.orders[0];
  assert.deepStrictEqual(o.creditnotas.map((n) => n.nummer), [nr(1), nr(2)]);
  assert.equal(o.creditnota.nummer, nr(1));
  const doc = await call("klantdoc.js", { token, ref: o.ref });
  assert.equal(doc.statusCode, 200, JSON.stringify(doc.payload));
  assert.deepStrictEqual(doc.payload.order.creditnotas.map((n) => [n.nummer, n.montant, n.motif]), [[nr(1), 16, "beschadigd"], [nr(2), 5, "kapot"]]);
  assert.equal(doc.payload.order.creditnotas[1].lignes, "Saus × 1 pièce [€5.00]");
  assert.equal(doc.payload.order.klant.taal, "FR", "document dans la langue du client");
});

test("export comptable UBL : chaque note exportable par son numéro", async () => {
  await seed([FACT("recORD0011")]);
  await credit("recORD0011", { lignes: "Tong × 1 kg" });
  await credit("recORD0011", { lignes: "Saus × 2", motif: "tweede" });
  const get = (query) => call("export.js", null, { method: "GET", headers: cookie("admin"), query });
  let r = await get({ format: "ubl", id: "recORD0011", type: "credit", cn: nr(2) });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.match(r.body, new RegExp("<cbc:ID>" + nr(2) + "</cbc:ID>"));
  assert.match(r.body, /<cbc:Note>tweede<\/cbc:Note>/);
  assert.match(r.body, /<cbc:TaxExclusiveAmount currencyID="EUR">10\.00<\/cbc:TaxExclusiveAmount>/);
  assert.match(r.headers["Content-Disposition"], new RegExp("Creditnota-" + nr(2)));
  r = await get({ format: "ubl", id: "recORD0011", type: "credit" });
  assert.match(r.body, new RegExp("<cbc:ID>" + nr(1) + "</cbc:ID>"), "sans numéro : la première note (comme avant)");
  r = await get({ format: "ubl", id: "recORD0011", type: "credit", cn: "CN-1999-0001" });
  assert.equal(r.statusCode, 404);
});

test("relances et marge : toutes les notes sont déduites", async () => {
  const rem = require(path.join(ROOT, "lib", "reminders.js"));
  const margin = require(path.join(ROOT, "lib", "margin.js"));
  const f = Object.assign({}, FACT("recX").fields);
  Object.assign(f, CN.patchFor(f, { nummer: nr(1), lignes: "Tong × 1 kg [€16.00]", montant: 16, le: new Date().toISOString(), motif: "a" }));
  Object.assign(f, CN.patchFor(f, { nummer: nr(2), lignes: "Saus × 1 pièce [€5.00]", montant: 5, le: new Date().toISOString(), motif: "b" }));
  const a = rem.amounts(f, {}, 6);
  // Facture : 32 × 1,06 + 15 × 1,21 = 33,92 + 18,15 = 52,07 ; notes : 16,96 + 6,05 = 23,01.
  assert.equal(a.incl, 52.07); assert.equal(a.cnIncl, 23.01); assert.equal(a.open, 29.06);
  const m = margin.compute({ orders: [{ fields: f }], lots: [], catalogue: [], stock: [] });
  assert.equal(m.totaal.credit, 21);
});

test("sans RESEND_API_KEY : « Correctie mailen » ne plante pas, rien n'est réservé ni journalisé", async () => {
  await seed([FACT("recORD0012")]);
  await credit("recORD0012", { lignes: "Tong × 1 kg" });
  const before = (await fieldsOf("recORD0012")).Correcties;
  const r = await call("updateorder.js", { id: "recORD0012", correctieMail: true }, { headers: cookie("staff") });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.mail.skipped, "disabled");
  const f = await fieldsOf("recORD0012");
  assert.equal(f.Correctiemail, undefined); assert.equal(f.Correcties, before);
});
