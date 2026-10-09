"use strict";
// Lignes de commande structurées (IDEAS B4, specs/016-lignes-structurees) sur le moteur SQL
// (SQLite en mémoire), vraie chaîne API : commande client / personnel → renommage Beheer →
// départ, note de crédit, recommande. Le texte reste l'affichage et le document légal ; le champ
// « Lignes JSON », écrit par le serveur seul, rattache chaque ligne à son produit par id.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY; // e-mails inertes
process.removeAllListeners("warning"); // node:sqlite est « expérimental »

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));

const FIELD = "Lignes JSON";
const LINES = "Lignes (produits / quantités)";
const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
function mkRes() { return { statusCode: 200, payload: null, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, send(b) { this.body = b; return this; }, end() { return this; } }; }
async function call(file, body, opts) {
  const h = require(path.join(ROOT, "api", file));
  const res = mkRes();
  await h({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || {}, query: (opts && opts.query) || {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fieldsOf = async (table, id) => (await store().get(table, id)).fields;
const json = (f) => { try { return JSON.parse(f[FIELD]); } catch (e) { return undefined; } };
const qtyOf = async (id) => (await fieldsOf("Stock", id))["Quantité disponible"];

async function seed(orders) {
  const pw = ca.hashPassword("geheim123");
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6, "Voorraad afboeken": true })]);
  await store().replaceAll("Catalogue", [
    rec("recP1", { Produit: "Tong", "Prix de base": 16, "Unité": "kg", "Catégorie": "Vis", Actif: true }),
    rec("recP2", { Produit: "Saus", "Prix de base": 5, "Unité": "pièce", "Catégorie": "Saus", Actif: true }),
    rec("recP3", { Produit: "Kreeft", "Prix de base": 40, "Unité": "kg", "Catégorie": "Vis" }) // inactif
  ]);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "a", Wachtwoord: pw }), rec("recCLB", { Nom: "Resto B", Gebruikersnaam: "b", Wachtwoord: pw })]);
  await store().replaceAll("Commandes", orders || []);
  await store().replaceAll("Compteurs", []);
  await store().replaceAll("Journaal", []);
  await store().replaceAll("Stock", [rec("recSTK1", { Produit: "Tong", "Quantité disponible": 10 }), rec("recSTK2", { Produit: "Saus", "Quantité disponible": 10 })]);
  await store().replaceAll("Mouvements de stock", []);
}
const tokenOf = async (id) => ca.issueToken({ id, fields: (await fieldsOf("Clients", id)) });
const staff = (body) => call("updateorder.js", body, { headers: cookie("staff") });
const admin = (body) => call("updateorder.js", body, { headers: cookie("admin") });
const beheer = (body) => call("onboarding.js", body, { headers: cookie("admin") });
const rename = (nom) => beheer({ action: "saveProduct", id: "recP1", nom, unite: "kg", base: 16, cat: "Vis" });
async function order(clientId, items) {
  const r = await call("order.js", { token: await tokenOf(clientId), items });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  return r.payload.id;
}
async function step(id, body) { const r = await staff(Object.assign({ id }, body)); assert.equal(r.statusCode, 200, JSON.stringify(r.payload)); return r; }
async function deliver(id) {
  await step(id, { statut: "Prête", preparationValidee: true });
  await step(id, { statut: "Sortie en livraison" });
  await step(id, { statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" });
}
const moves = async (type) => (await store().list("Mouvements de stock")).filter((m) => m.fields.Type === type).map((m) => [m.fields.Produit, m.fields["Quantité"]]);

test("lib/lignesjson : le texte fait foi, la référence vient de l'entrée JSON du même nom", () => {
  const LJ = require(path.join(ROOT, "lib", "lignesjson.js"));
  assert.equal(LJ.FIELD, FIELD);
  assert.deepStrictEqual(LJ.parse("{kapot"), []);
  assert.deepStrictEqual(LJ.parse(JSON.stringify([{ productId: "rec ; DROP", naam: "X", qty: 1 }, { productId: "recP1", naam: "Tong", qty: 2, unit: "kg", prijs: 16 }])).map((e) => e.productId), ["recP1"], "id invalide écarté");
  const raw = JSON.stringify([{ productId: "recP2", naam: "Saus", qty: 1, unit: "pièce", prijs: 5 }, { productId: "recP1", naam: "Tong", qty: 9, unit: "kg", prijs: 1 }]);
  const l = LJ.linked("Tong × 2 kg [€16.00]\nSaus × 3 pièce [€5.00]\nMosselen × 1 caisse [€26.00]", raw);
  assert.deepStrictEqual(l.map((x) => [x.nom, x.qty, x.price, x.productId]), [["Tong", 2, 16, "recP1"], ["Saus", 3, 5, "recP2"], ["Mosselen", 1, 26, null]], "quantité et prix du texte ; ligne sans entrée = par nom");
  assert.deepStrictEqual(LJ.linked("Tong × 1 kg", "").map((x) => x.productId), [null], "ancienne commande : aucune référence");
  const p = { id: "recP1", fields: { Produit: "Tong", "Unité": "kg" } };
  assert.deepStrictEqual(LJ.entry(p, { qty: 1.25, unit: "kg", price: 16.004, comment: "" }), { productId: "recP1", naam: "Tong", qty: 1.25, unit: "kg", prijs: 16 });
  assert.equal(LJ.serialize([]), "");
  const ren = JSON.parse(LJ.renamed(raw, "recP1", "Tongfilet"));
  assert.deepStrictEqual(ren.map((e) => e.naam), ["Saus", "Tongfilet"]);
  assert.equal(LJ.renamed(raw, "recP9", "Iets"), null, "rien à changer");
});

test("commande client : Lignes JSON écrite par le serveur ; prix, nom, référence ou JSON du navigateur ignorés", async () => {
  await seed();
  const token = await tokenOf("recCLA");
  const r = await call("order.js", { token, items: [{ productId: "recP1", quantity: 2, comment: "in filets", prijs: 0.01, price: 0.01, naam: "Gratis", unit: "doos" }],
    [FIELD]: JSON.stringify([{ productId: "recP2", naam: "Saus", qty: 99, prijs: 0 }]), lignesJson: "[]", total: 1 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const f = await fieldsOf("Commandes", r.payload.id);
  assert.equal(f[LINES], "Tong × 2 kg [€16.00] (in filets)", "texte inchangé (affichage, documents)");
  assert.equal(f.Total, 32);
  assert.deepStrictEqual(json(f), [{ productId: "recP1", naam: "Tong", qty: 2, unit: "kg", prijs: 16, comment: "in filets" }]);
  // Référence inconnue, ou d'un produit inactif : refus, rien n'est écrit.
  assert.equal((await call("order.js", { token, items: [{ productId: "recNOPE", quantity: 1 }] })).statusCode, 400);
  assert.equal((await call("order.js", { token, items: [{ productId: "recP3", quantity: 1 }] })).statusCode, 400);
  assert.equal((await store().list("Commandes")).length, 1);
});

test("invoer personnel et lignes modifiées par le magasin : référence résolue par le serveur, JSON du navigateur ignoré", async () => {
  await seed();
  const r = await call("staff.js", { clientId: "recCLB", items: [{ productId: "recP2", quantity: 3, prijs: 0 }], [FIELD]: "[]" }, { headers: cookie("staff") });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const id = r.payload.id;
  assert.deepStrictEqual(json(await fieldsOf("Commandes", id)), [{ productId: "recP2", naam: "Saus", qty: 3, unit: "pièce", prijs: 5 }]);
  // Le personnel ajoute une ligne avec un prix et tente d'imposer une référence : prix et référence du serveur.
  const u = await staff({ id, lignes: "Saus × 4 pièce\nTong × 1 kg [€1.00]", [FIELD]: JSON.stringify([{ productId: "recP2", naam: "Tong", qty: 1, prijs: 1 }]), lignesJson: "[]" });
  assert.equal(u.statusCode, 200, JSON.stringify(u.payload));
  const f = await fieldsOf("Commandes", id);
  assert.equal(f[LINES], "Saus × 4 pièce [€5.00]\nTong × 1 kg [€16.00]");
  assert.deepStrictEqual(json(f), [{ productId: "recP2", naam: "Saus", qty: 4, unit: "pièce", prijs: 5 }, { productId: "recP1", naam: "Tong", qty: 1, unit: "kg", prijs: 16 }]);
  const journaal = await store().list("Journaal");
  assert.ok(journaal.length > 0, "action journalisée");
  assert.ok(!JSON.stringify(journaal).includes('"veld":"' + FIELD + '"'), "champ technique hors du journal d'audit (le texte montre la différence)");
});

test("renommage puis départ : le stock du produit renommé est déduit (commande annulée puis restaurée)", async () => {
  await seed();
  const id = await order("recCLA", [{ productId: "recP1", quantity: 2 }]);
  const open = (await call("staff.js", { clientId: "recCLB", items: [{ productId: "recP1", quantity: 1 }] }, { headers: cookie("staff") })).payload.id;
  assert.equal((await admin({ id, correction: "annuleren", reden: "klant belt terug" })).statusCode, 200);
  const r = await rename("Tongfilet");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal((await fieldsOf("Stock", "recSTK1")).Produit, "Tongfilet", "la ligne de stock suit le catalogue");
  // Commande ouverte : texte ET forme structurée suivent ; commande annulée : intacte.
  const fo = await fieldsOf("Commandes", open);
  assert.equal(fo[LINES], "Tongfilet × 1 kg [€16.00]");
  assert.deepStrictEqual(json(fo).map((e) => [e.productId, e.naam]), [["recP1", "Tongfilet"]]);
  assert.equal((await fieldsOf("Commandes", id))[LINES], "Tong × 2 kg [€16.00]");
  await step(id, { correction: "herstellen", reden: "toch leveren" });
  await step(id, { statut: "Prête", preparationValidee: true });
  const dep = await staff({ id, statut: "Sortie en livraison" });
  assert.equal(dep.statusCode, 200, "départ accepté : " + JSON.stringify(dep.payload));
  assert.equal(await qtyOf("recSTK1"), 8);
  assert.deepStrictEqual(await moves("Sortie livraison"), [["Tongfilet", -2]]);
  // Retour arrière : la même quantité revient sur la même ligne de stock.
  await step(id, { correction: "terug", reden: "vergissing" });
  assert.equal(await qtyOf("recSTK1"), 10);
});

test("renommage puis lignes modifiées par le magasin : l'article reste le même produit, même si un autre reprend son nom", async () => {
  await seed();
  const id = await order("recCLB", [{ productId: "recP1", quantity: 2 }]);
  assert.equal((await admin({ id, correction: "annuleren", reden: "klant belt terug" })).statusCode, 200);
  assert.equal((await rename("Tongfilet")).statusCode, 200);
  assert.equal((await beheer({ action: "saveProduct", nom: "Tong", unite: "kg", base: 30, cat: "Vis" })).statusCode, 200);
  await step(id, { correction: "herstellen", reden: "toch leveren" });
  // L'écran du magasin renvoie le texte de la commande (ancien nom) avec une quantité changée.
  await step(id, { lignes: "Tong × 3 kg [€16.00]" });
  const f = await fieldsOf("Commandes", id);
  assert.equal(f[LINES], "Tongfilet × 3 kg [€16.00]", "même produit (renommé), prix figé de la commande");
  assert.deepStrictEqual(json(f).map((e) => [e.productId, e.naam, e.qty]), [["recP1", "Tongfilet", 3]]);
  assert.equal(f.Total, 48);
});

test("renommage (et nom repris par un nouveau produit) puis note de crédit : retour sur le bon produit, facture intacte", async () => {
  await seed();
  const id = await order("recCLA", [{ productId: "recP1", quantity: 2 }, { productId: "recP2", quantity: 1 }]);
  await deliver(id);
  assert.equal(await qtyOf("recSTK1"), 8);
  const facture = await fieldsOf("Commandes", id);
  assert.ok(facture.Factuurnummer);
  assert.equal((await rename("Tongfilet")).statusCode, 200);
  const nieuw = await beheer({ action: "saveProduct", nom: "Tong", unite: "kg", base: 30, cat: "Vis", stock: 50 });
  assert.equal(nieuw.statusCode, 200, JSON.stringify(nieuw.payload));
  const newStock = (await store().list("Stock")).find((s) => s.fields.Produit === "Tong");
  assert.ok(newStock, "nouvelle ligne de stock « Tong »");
  const cn = await admin({ id, creditnota: { lignes: "Tong × 1 kg", motif: "beschadigd", retourStock: true, sleutel: "ren-1" } });
  assert.equal(cn.statusCode, 200, JSON.stringify(cn.payload));
  assert.equal(await qtyOf("recSTK1"), 9, "retour sur le produit renommé");
  assert.equal(await qtyOf(newStock.id), 50, "le nouveau produit du même nom n'est pas touché");
  assert.deepStrictEqual(await moves("Retour client"), [["Tongfilet", 1]]);
  const f = await fieldsOf("Commandes", id);
  assert.equal(f[LINES], facture[LINES], "facture émise jamais réécrite");
  assert.equal(f[FIELD], facture[FIELD]);
  assert.equal(f[LINES], "Tong × 2 kg [€16.00]\nSaus × 1 pièce [€5.00]");
});

test("renommage puis « Opnieuw bestellen » : le portail reçoit la référence, la nouvelle commande porte le nouveau nom", async () => {
  await seed();
  const id = await order("recCLA", [{ productId: "recP1", quantity: 2, comment: "gefileerd" }]);
  await deliver(id);
  assert.equal((await rename("Tongfilet")).statusCode, 200);
  const token = await tokenOf("recCLA");
  const list = await call("orders.js", { token });
  assert.equal(list.statusCode, 200, JSON.stringify(list.payload));
  const o = list.payload.orders.find((x) => x.lignes.startsWith("Tong ×"));
  assert.equal(o.lignes, "Tong × 2 kg [€16.00] (gefileerd)", "document : nom de l'époque");
  assert.deepStrictEqual(o.items, [{ productId: "recP1", naam: "Tong", qty: 2, comment: "gefileerd" }]);
  // Ce que fait le portail (assets/pages/klant.js linesToCart) : la référence, pas le nom.
  const again = await order("recCLA", o.items.map((i) => ({ productId: i.productId, quantity: i.qty, comment: i.comment })));
  const f = await fieldsOf("Commandes", again);
  assert.equal(f[LINES], "Tongfilet × 2 kg [€16.00] (gefileerd)");
  assert.deepStrictEqual(json(f).map((e) => [e.productId, e.naam]), [["recP1", "Tongfilet"]]);
  // Le portail apparie par référence d'abord, par nom seulement sans référence.
  const src = fs.readFileSync(path.join(ROOT, "assets", "pages", "klant.js"), "utf8");
  const fn = src.slice(src.indexOf("function linesToCart"), src.indexOf("function reorder"));
  assert.match(fn, /o\.items/, "linesToCart lit items[] de /api/orders");
  assert.match(fn, /productId/, "linesToCart apparie par référence produit");
});

test("ancienne commande (texte seul) : départ, note de crédit et liste client comme avant, aucun JSON ajouté", async () => {
  await seed([rec("recOLD1", { "Référence": "CMD-2026-0001", Date: "2026-09-01", [LINES]: "Tong × 2 kg [€16.00]\nSaus × 1 pièce [€5.00]", Statut: "Prête", "Préparation validée": true, "Statut paiement": "En attente", Total: 37, Client: ["recCLA"] })]);
  await step("recOLD1", { statut: "Sortie en livraison" });
  assert.equal(await qtyOf("recSTK1"), 8); assert.equal(await qtyOf("recSTK2"), 9);
  await step("recOLD1", { statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" });
  const cn = await admin({ id: "recOLD1", creditnota: { lignes: "Saus × 1", motif: "kapot", retourStock: true, sleutel: "old-1" } });
  assert.equal(cn.statusCode, 200, JSON.stringify(cn.payload));
  assert.equal(await qtyOf("recSTK2"), 10);
  const f = await fieldsOf("Commandes", "recOLD1");
  assert.equal(f[FIELD], undefined, "rien n'est rattrapé ni réécrit");
  assert.equal(f[LINES], "Tong × 2 kg [€16.00]\nSaus × 1 pièce [€5.00]");
  const list = await call("orders.js", { token: await tokenOf("recCLA") });
  assert.deepStrictEqual(list.payload.orders[0].items.map((i) => [i.productId, i.naam, i.qty]), [[null, "Tong", 2], [null, "Saus", 1]], "sans référence : le portail apparie par nom (comme avant)");
});
