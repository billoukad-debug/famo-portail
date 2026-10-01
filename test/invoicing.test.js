"use strict";
// Facturation sur le moteur SQL (production : Neon ; ici SQLite en mémoire) :
// numéros atomiques, facture figée, notes de crédit plafonnées, livraison refusée, parité client/personnel.
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
const bill = require(path.join(ROOT, "lib", "billing.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const vat = require(path.join(ROOT, "assets", "vat.js"));

const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
const klant = (token) => ({ headers: { cookie: "famo_klant=" + encodeURIComponent(token) } }); // session client (spec 013)
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; }
async function call(file, body, opts) {
  const h = require(path.join(ROOT, "api", file));
  const res = mkRes();
  await h({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || {}, query: (opts && opts.query) || {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;

async function seed(orders) {
  const pw = ca.hashPassword("geheim123");
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-nummer": "BE0788705713", IBAN: "BE71096123456769", "BTW-tarief": 6 })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 18.49, "Unité": "kg", Actif: true, "BTW-tarief": 6 }), rec("recP2", { Produit: "Saus", "Prix de base": 5, "Unité": "pièce", Actif: true, "BTW-tarief": 21 })]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "a", Wachtwoord: pw, Taal: "NL" }), rec("recCLB", { Nom: "Resto B", Gebruikersnaam: "b", Wachtwoord: pw })]);
  await store().replaceAll("Commandes", orders || []);
}
const SORTIE = (id, extra) => rec(id, Object.assign({ "Référence": "CMD-2026-" + id.slice(-4), Date: new Date().toISOString().slice(0, 10), Statut: "Sortie en livraison", "Préparation validée": true, Client: ["recCLA"], "Lignes (produits / quantités)": "Tong × 1.375 kg [€18.49]\nSaus × 2 pièce [€5.00]", Total: 35.42 }, extra || {}));

test("règle unique de TVA (EN 16931) : ligne arrondie au cent, TVA par taux", () => {
  const t = vat.totals([{ name: "Tong", qty: 1.375, price: 18.49 }, { name: "Saus", qty: 2, price: 5 }], (n) => (n === "Saus" ? 21 : 6));
  assert.deepStrictEqual(t.groups, [{ rate: 6, base: 25.42, tva: 1.53 }, { rate: 21, base: 10, tva: 2.1 }]);
  assert.equal(t.htva, 35.42); assert.equal(t.tva, 3.63); assert.equal(t.total, 39.05);
  assert.equal(vat.r2(1.005), 1.01); assert.equal(vat.r2(-1.005), -1.01);
});

test("numéros atomiques : 10 réservations simultanées → 10 numéros distincts sans trou", async () => {
  await seed();
  const got = await Promise.all(Array.from({ length: 10 }, () => bill.reserve("FA-2026", () => 7)));
  assert.deepStrictEqual(got.sort((a, b) => a - b), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

test("10 réceptions simultanées → 10 factures FA distinctes", async () => {
  const ids = Array.from({ length: 10 }, (_, i) => "recORD" + String(i).padStart(4, "0"));
  await seed(ids.map((id) => SORTIE(id)));
  const res = await Promise.all(ids.map((id) => call("updateorder.js", { id, statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, { headers: cookie("staff") })));
  res.forEach((r) => assert.equal(r.statusCode, 200, JSON.stringify(r.payload)));
  const nrs = res.map((r) => r.payload.factuurnummer);
  assert.equal(new Set(nrs).size, 10, "doublon : " + nrs.join(","));
});

test("taux figés à la facturation, lignes verrouillées ensuite (même après « ontvangst ongedaan »)", async () => {
  await seed([SORTIE("recORD0001")]);
  let r = await call("updateorder.js", { id: "recORD0001", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, { headers: cookie("staff") });
  assert.equal(r.statusCode, 200);
  const f = (await store().get("Commandes", "recORD0001")).fields;
  assert.deepStrictEqual(JSON.parse(f["BTW per lijn"]), { tong: 6, saus: 21 });
  // Le catalogue change : la facture émise ne bouge pas.
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 99, "Unité": "kg", Actif: true, "BTW-tarief": 21 }), rec("recP2", { Produit: "Saus", "Prix de base": 5, "Unité": "pièce", Actif: true, "BTW-tarief": 21 })]);
  const all = await call("allorders.js", null, { method: "GET", headers: cookie("staff") });
  assert.deepStrictEqual(all.payload.orders[0].btwFrozen, { tong: 6, saus: 21 });
  // Réception défaite puis retour à « Prête » : les lignes restent figées (audit B-03).
  await store().update("Commandes", "recORD0001", Object.assign({}, f, { Statut: "Prête", "Livraison confirmée": false }), (await store().get("Commandes", "recORD0001")).version);
  r = await call("updateorder.js", { id: "recORD0001", lignes: "Tong × 1 kg [€0.01]" }, { headers: cookie("admin") });
  assert.equal(r.statusCode, 409);
  assert.match(r.payload.error, /liggen vast/);
});

test("document client = document personnel : taux par ligne et date de facture", async () => {
  await seed([SORTIE("recORD0002", { Statut: "Facturée", Factuurnummer: "FA-2026-0003", "Facturée le": "2026-08-03T10:00:00.000Z", "Livraison confirmée": true, "BTW per lijn": JSON.stringify({ tong: 6, saus: 21 }) })]);
  const token = ca.issueToken({ id: "recCLA", fields: (await store().get("Clients", "recCLA")).fields });
  const r = await call("klantdoc.js", { ref: "CMD-2026-0002" }, klant(token));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.deepStrictEqual(r.payload.order.btwPerLine, { tong: 6, saus: 21 });
  assert.equal(r.payload.order.factureeLe, "2026-08-03T10:00:00.000Z");
  assert.equal(r.payload.config.facturatie, "boekhouder");
  assert.equal(r.payload.config.iban, "", "mode boekhouder : pas d'IBAN chez le client");
  // Un autre client ne voit pas cette commande.
  const tb = ca.issueToken({ id: "recCLB", fields: (await store().get("Clients", "recCLB")).fields });
  assert.equal((await call("klantdoc.js", { ref: "CMD-2026-0002" }, klant(tb))).statusCode, 404);
});

test("livraison refusée ou client absent : pas de facture, exception au journal", async () => {
  await seed([SORTIE("recORD0003")]);
  const r = await call("updateorder.js", { id: "recORD0003", statut: "Facturée", deliveryConfirmed: true, recipient: "—", uitzondering: "Geweigerd", uitzonderingNota: "vis niet vers" }, { headers: cookie("staff") });
  assert.equal(r.statusCode, 200);
  assert.equal(r.payload.geleverd, false);
  const f = (await store().get("Commandes", "recORD0003")).fields;
  assert.equal(f.Statut, "Sortie en livraison"); assert.equal(f.Factuurnummer, undefined);
  assert.equal(f["Uitzondering levering"], "Geweigerd"); assert.match(f.Correcties, /Niet geleverd: Geweigerd \(geen factuur\)/);
});

test("note de crédit : quantités cumulées par article, jamais plus que livré", async () => {
  await seed([SORTIE("recORD0004", { Statut: "Facturée", Factuurnummer: "FA-2026-0004", "Livraison confirmée": true, "Lignes (produits / quantités)": "Tong × 2 kg [€16.00]" })]);
  let r = await call("updateorder.js", { id: "recORD0004", creditnota: { lignes: "Tong × 2 kg\nTong × 2 kg", motif: "Retour" } }, { headers: cookie("admin") });
  assert.equal(r.statusCode, 400, "4 kg crédités sur 2 kg livrés");
  r = await call("updateorder.js", { id: "recORD0004", creditnota: { lignes: "Tong × 1 kg\nTong × 1 kg", motif: "Retour" } }, { headers: cookie("admin") });
  assert.equal(r.statusCode, 200); assert.equal(r.payload.creditnota.montant, 32);
});

test("statut de paiement réservé au beheerder", async () => {
  await seed([SORTIE("recORD0005", { Statut: "Facturée", Factuurnummer: "FA-2026-0005", "Livraison confirmée": true })]);
  assert.equal((await call("updateorder.js", { id: "recORD0005", paiement: "Payé" }, { headers: cookie("staff") })).statusCode, 403);
  assert.equal((await call("updateorder.js", { id: "recORD0005", paiement: "Payé" }, { headers: cookie("admin") })).statusCode, 200);
});

// ---- Stock sous concurrence (audit B-10, B-11) ----
async function seedStock(orders, qty) {
  await seed(orders);
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6, "Voorraad afboeken": true })]);
  await store().replaceAll("Stock", [rec("recSTK1", { Produit: "Tong", "Quantité disponible": qty })]);
  await store().replaceAll("Mouvements de stock", []);
}
const PRETE = (id, qty) => rec(id, { "Référence": "CMD-2026-" + id.slice(-4), Date: new Date().toISOString().slice(0, 10), Statut: "Prête", "Préparation validée": true, Client: ["recCLA"], "Lignes (produits / quantités)": "Tong × " + qty + " kg [€18.49]", Total: 18.49 * qty });

test("3 commandes du même produit partent ensemble : 3 décomptes (8 → 5)", async () => {
  await seedStock([PRETE("recDEP0001", 1), PRETE("recDEP0002", 1), PRETE("recDEP0003", 1)], 8);
  const r = await Promise.all(["recDEP0001", "recDEP0002", "recDEP0003"].map((id) => call("updateorder.js", { id, statut: "Sortie en livraison" }, { headers: cookie("staff") })));
  r.forEach((x) => assert.equal(x.statusCode, 200, JSON.stringify(x.payload)));
  assert.equal((await store().get("Stock", "recSTK1")).fields["Quantité disponible"], 5);
});

test("double « Vertrekt » sur deux instances : un seul décompte", async () => {
  await seedStock([PRETE("recDEP0004", 2)], 8);
  const inst = () => { const p = path.join(ROOT, "api", "updateorder.js"); delete require.cache[require.resolve(p)]; return require(p); };
  const a = inst(), b = inst();
  const go = async (h) => { const res = mkRes(); await h({ method: "POST", body: { id: "recDEP0004", statut: "Sortie en livraison" }, headers: cookie("staff"), query: {} }, res); return res; };
  const [x, y] = await Promise.all([go(a), go(b)]);
  assert.deepStrictEqual([x.statusCode, y.statusCode].sort(), [200, 409]);
  assert.equal((await store().get("Stock", "recSTK1")).fields["Quantité disponible"], 6);
});

test("stock insuffisant : rien n'est décompté, départ refusé", async () => {
  await seedStock([PRETE("recDEP0005", 5)], 3);
  const r = await call("updateorder.js", { id: "recDEP0005", statut: "Sortie en livraison" }, { headers: cookie("staff") });
  assert.equal(r.statusCode, 409);
  assert.equal((await store().get("Stock", "recSTK1")).fields["Quantité disponible"], 3);
  assert.ok(!(await store().get("Commandes", "recDEP0005")).fields["Stock afgeboekt"], "réservation annulée");
});

// ---- Commande client : idempotence et doublons (audit B-19, L-07) ----
test("même clé renvoyée → même commande ; mêmes articles le même jour → confirmation", async () => {
  await seed([]);
  const token = ca.issueToken({ id: "recCLA", fields: (await store().get("Clients", "recCLA")).fields });
  const body = (key, extra) => Object.assign({ items: [{ productId: "recP1", quantity: 2 }], idempotencyKey: key }, extra || {});
  const kl = klant(token); // session client : cookie famo_klant (spec 013)
  const a = await call("order.js", body("cle-panier-0001"), kl);
  assert.equal(a.statusCode, 200, JSON.stringify(a.payload));
  const b = await call("order.js", body("cle-panier-0001"), kl);
  assert.equal(b.statusCode, 200); assert.equal(b.payload.id, a.payload.id); assert.equal(b.payload.duplicate, true);
  const c = await call("order.js", body("cle-panier-0002"), kl);
  assert.equal(c.statusCode, 409); assert.equal(c.payload.needConfirm, true);
  const d = await call("order.js", body("cle-panier-0002", { confirm: true }), kl);
  assert.equal(d.statusCode, 200); assert.notEqual(d.payload.id, a.payload.id);
  assert.equal((await store().list("Commandes")).length, 2);
});

// ---- Journal d'audit en ajout seul (audit B-12, L-01, L-02) ----
test("journal : prix de base, IBAN, code et action sur commande — qui, avant → après, jamais un secret", async () => {
  await seed([SORTIE("recORD0009")]);
  await store().replaceAll("Journaal", []);
  const post = (body) => call("onboarding.js", body, { headers: cookie("admin") });
  let r = await post({ action: "saveProduct", id: "recP1", nom: "Tong", unite: "kg", base: 21.5, cat: "Vis" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  r = await post({ action: "saveConfig", bedrijfsnaam: "FAMO Seafood", btw: "BE0788705713", iban: "BE68539007547034", leverdagen: "ma,di" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  r = await post({ action: "saveCode", role: "staff", code: "geheim-nieuw-123" });
  r = await call("updateorder.js", { id: "recORD0009", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, { headers: cookie("staff") });
  assert.equal(r.statusCode, 200);
  const j = await call("journaal.js", null, { method: "GET", headers: cookie("admin") });
  assert.equal(j.statusCode, 200); assert.equal(j.payload.enabled, true);
  const rows = j.payload.rows;
  const prod = rows.find((x) => x.Actie === "saveProduct");
  assert.deepStrictEqual(prod.Wijzigingen.find((w) => w.veld === "Prix de base"), { veld: "Prix de base", voor: "18.49", na: "21.5" });
  assert.equal(prod.Wie, "beheerder");
  const conf = rows.find((x) => x.Actie === "saveConfig");
  assert.deepStrictEqual(conf.Wijzigingen.find((w) => w.veld === "IBAN"), { veld: "IBAN", voor: "BE71096123456769", na: "BE68539007547034" });
  const ord = rows.find((x) => x.Object === "Commandes");
  assert.equal(ord.Actie, "Status → Facturée"); assert.equal(ord.Wie, "personeel"); assert.equal(ord.Referentie, "CMD-2026-0009");
  assert.ok(ord.Wijzigingen.some((w) => w.veld === "Factuurnummer" && /^FA-/.test(w.na)));
  assert.ok(!JSON.stringify(rows).includes("geheim-nieuw-123"), "jamais un code en clair dans le journal");
  assert.equal((await call("journaal.js", null, { method: "GET", headers: cookie("staff") })).statusCode, 401);
});

// ---- Liste du personnel : pagination et révision (audit E-02, E-03) ----
test("allorders : pages de ≤ limit, révision inchangée → { unchanged } sans relire la liste", async () => {
  const many = Array.from({ length: 250 }, (_, i) => SORTIE("recPAG" + String(i).padStart(4, "0")));
  await seed(many);
  await store().replaceAll("Compteurs", []);
  const get = (query) => call("allorders.js", null, { method: "GET", headers: cookie("staff"), query });
  const p1 = await get({ limit: "100" });
  assert.equal(p1.statusCode, 200); assert.equal(p1.payload.orders.length, 100); assert.ok(p1.payload.next);
  let n = p1.payload.orders.length, next = p1.payload.next;
  while (next) { const p = await get({ limit: "100", cursor: next }); n += p.payload.orders.length; next = p.payload.next; }
  assert.equal(n, 250);
  const rev = p1.payload.rev;
  assert.deepStrictEqual((await get({ limit: "100", rev: String(rev) })).payload, { unchanged: true, rev });
  // Une écriture sur une commande fait bouger la révision → liste renvoyée.
  const u = await call("updateorder.js", { id: "recPAG0001", volgorde: 3 }, { headers: cookie("staff") });
  assert.equal(u.statusCode, 200);
  const after = await get({ limit: "100", rev: String(rev) });
  assert.ok(!after.payload.unchanged); assert.equal(after.payload.rev, rev + 1);
});

// ---- RGPD : inzage en wissing (audit C-11) ----
test("export des données d'un client (sans mot de passe) ; anonymisation seulement après archivage", async () => {
  await seed([SORTIE("recORD0010", { Statut: "Facturée", Factuurnummer: "FA-2026-0010", "Réceptionné par": "Jan Peeters" })]);
  await store().update("Clients", "recCLA", Object.assign({}, (await store().get("Clients", "recCLA")).fields, { Email: "jan@resto.test", "Téléphone": "0470 00 00 00", "BTW-nummer": "BE0417497106" }), (await store().get("Clients", "recCLA")).version);
  const post = (body) => call("onboarding.js", body, { headers: cookie("admin") });
  const ex = await post({ action: "exportClient", id: "recCLA" });
  assert.equal(ex.statusCode, 200);
  assert.equal(ex.payload.export.client.Email, "jan@resto.test");
  assert.equal(ex.payload.export.client.Wachtwoord, undefined, "jamais le mot de passe");
  assert.equal(ex.payload.export.bestellingen.length, 1);
  assert.equal((await post({ action: "anonymizeClient", id: "recCLA", confirm: "ANONIEM" })).statusCode, 409, "archiver d'abord");
  assert.equal((await post({ action: "archiveClient", id: "recCLA" })).statusCode, 200);
  assert.equal((await post({ action: "anonymizeClient", id: "recCLA" })).statusCode, 400, "confirmation tapée exigée");
  const an = await post({ action: "anonymizeClient", id: "recCLA", confirm: "ANONIEM" });
  assert.equal(an.statusCode, 200, JSON.stringify(an.payload));
  const c = (await store().get("Clients", "recCLA")).fields;
  assert.equal(c.Email, undefined); assert.equal(c.Wachtwoord || "", ""); assert.match(c.Gebruikersnaam, /^anon-/);
  assert.equal(c.Nom, "Resto A"); assert.equal(c["BTW-nummer"], "BE0417497106", "les factures gardent la société et la TVA");
  const o = (await store().get("Commandes", "recORD0010")).fields;
  assert.equal(o["Réceptionné par"], "[geanonimiseerd]"); assert.equal(o.Factuurnummer, "FA-2026-0010");
});
