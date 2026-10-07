"use strict";
// Verpakking / verkoopeenheid (specs/023-verpakking) sur le moteur SQL (SQLite en mémoire), vraie
// chaîne API : Beheer → catalogue → commande client / personnel → documents, e-mails, UBL, stock,
// commande par e-mail. Le prix reste le prix par unité ; les lignes restent stockées EN UNITÉS
// (« Eieren × 12 pièce [€1.00] ») ; le conditionnement est une annotation figée dans « Lignes JSON ».
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY; // e-mails inertes
process.removeAllListeners("warning"); // node:sqlite est « expérimental »
// Aucun appel réseau réel : tout ce que le moteur SQL n'intercepte pas échoue.
global.fetch = async (url) => { throw new Error("Réseau interdit dans les tests : " + String(url)); };

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const V = require(path.join(ROOT, "assets", "vat.js"));

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
// Modifie quelques champs d'un enregistrement (le store bas niveau n'a pas de PATCH partiel).
const patch = async (table, id, fields) => store().replaceAll(table, (await store().list(table)).map((r) => (r.id === id ? Object.assign({}, r, { fields: Object.assign({}, r.fields, fields) }) : r)));
const json = (f) => { try { return JSON.parse(f[FIELD]); } catch (e) { return undefined; } };
const EGG = { Produit: "Eieren", "Prix de base": 1, "Unité": "pièce", "Catégorie": "Algemeen", Actif: true, "Per verpakking": 6, "Verpakking": "doos", "Enkel per verpakking": true };

async function seed(extra) {
  const pw = ca.hashPassword("geheim123");
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6, "Voorraad afboeken": true })]);
  await store().replaceAll("Catalogue", [
    rec("recEGG", EGG),
    rec("recOES", { Produit: "Oesters", "Prix de base": 0.85, "Unité": "pièce", "Catégorie": "Schelpdieren", Actif: true, "Per verpakking": 12, "Verpakking": "kist" }), // pas « enkel »
    rec("recTONG", { Produit: "Tong", "Prix de base": 16, "Unité": "kg", "Catégorie": "Vis", Actif: true })
  ].concat(extra || []));
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Gebruikersnaam: "a", Wachtwoord: pw }), rec("recCLF", { Nom: "Resto F", Gebruikersnaam: "f", Wachtwoord: pw, Taal: "FR" })]);
  await store().replaceAll("Prix négociés", []);
  await store().replaceAll("Commandes", []);
  await store().replaceAll("Compteurs", []);
  await store().replaceAll("Journaal", []);
  await store().replaceAll("Stock", [rec("recSTE", { Produit: "Eieren", "Quantité disponible": 60 }), rec("recSTO", { Produit: "Oesters", "Quantité disponible": 100 }), rec("recSTT", { Produit: "Tong", "Quantité disponible": 10 })]);
  await store().replaceAll("Mouvements de stock", []);
}
const tokenOf = async (id) => ca.issueToken({ id, fields: (await fieldsOf("Clients", id)) });
const order = async (clientId, items, more) => call("order.js", Object.assign({ token: await tokenOf(clientId), items }, more || {}));
const staffPost = (body) => call("staff.js", body, { headers: cookie("staff") });
const staff = (body) => call("updateorder.js", body, { headers: cookie("staff") });
const beheer = (body) => call("onboarding.js", body, { headers: cookie("admin") });

// ---- Aides partagées (assets/vat.js : écran, documents, e-mails, serveur) -------------------------
test("FamoVat.pak* : conditionnement lu du catalogue, d'une ligne figée ou de l'API ; textes NL/FR", () => {
  assert.deepStrictEqual(V.pakOf(EGG), { per: 6, label: "doos", only: true });
  assert.deepStrictEqual(V.pakOf({ per: 12, verpakking: "kist" }), { per: 12, label: "kist", only: false });
  assert.deepStrictEqual(V.pakOf({ per: 6 }), { per: 6, label: "doos", only: false }, "libellé par défaut : doos");
  for (const none of [null, {}, { "Per verpakking": 1 }, { "Per verpakking": "" }, { per: 0 }, { per: -6 }, { per: "abc" }, { per: 1001 }]) assert.equal(V.pakOf(none), null, JSON.stringify(none));
  const p = V.pakOf(EGG);
  assert.equal(V.pakFits(12, p), true); assert.equal(V.pakFits(7, p), false); assert.equal(V.pakFits(7, null), true, "sans conditionnement : tout passe");
  assert.deepStrictEqual(V.pakSplit(14, p), { n: 2, rest: 2 });
  assert.equal(V.pakQty(12, "pièce", p, "nl"), "2 doos · 12 stuks");
  assert.equal(V.pakQty(6, "pièce", p, "nl"), "1 doos · 6 stuks");
  assert.equal(V.pakQty(14, "pièce", p, "nl"), "2 doos + 2 st · 14 stuks");
  assert.equal(V.pakQty(4, "pièce", p, "nl"), "4 stuks");
  assert.equal(V.pakQty(1, "pièce", null, "nl"), "1 stuk");
  assert.equal(V.pakQty(12, "pièce", p, "fr"), "2 cartons · 12 pièces");
  assert.equal(V.pakQty(10, "kg", V.pakOf({ per: 5, verpakking: "kist" }), "nl"), "2 kist · 10 kg");
  assert.equal(V.pakOne(p, "pièce", "nl"), "doos van 6");
  assert.equal(V.pakOne(p, "pièce", "fr"), "carton de 6");
  assert.equal(V.pakOne(V.pakOf({ per: 5, verpakking: "kist" }), "kg", "nl"), "kist van 5 kg");
  assert.equal(V.pakCalc(12, "pièce", p, "nl"), "2 doos × 6 st = 12 st");
  assert.equal(V.pakCalc(12, "pièce", p, "fr"), "2 cartons × 6 pc = 12 pc");
  assert.equal(V.pakCalc(14, "pièce", p, "nl"), "2 doos × 6 st + 2 st = 14 st");
  const eur = (n) => "€ " + n.toFixed(2).replace(".", ",");
  assert.equal(V.pakCalc(12, "pièce", p, "nl", 1, eur), "2 doos × 6 st = 12 st × € 1,00 = € 12,00");
  assert.equal(V.pakCalc(18, "pièce", p, "nl", 0.85, eur), "3 doos × 6 st = 18 st × € 0,85 = € 15,30", "ligne arrondie au cent (EN 16931, comme la facture)");
  assert.equal(V.pakCalc(4, "pièce", p, "nl"), "", "moins d'un conditionnement : rien à expliquer");
  assert.equal(V.pakLabel("Tray", 2, "fr"), "plateaux"); assert.equal(V.pakLabel("schaal", 1, "fr"), "barquette"); assert.equal(V.pakLabel("bundel", 2, "fr"), "bundel", "mot inconnu : tel quel");
});

// ---- Beheer → Producten -----------------------------------------------------------------------
test("Beheer : Per verpakking / Verpakking / Enkel per verpakking écrits, effacés et validés par le serveur", async () => {
  await seed();
  const save = (more) => beheer(Object.assign({ action: "saveProduct", id: "recTONG", nom: "Tong", unite: "kg", base: 16, cat: "Vis" }, more));
  let r = await beheer({ action: "saveProduct", nom: "Kwarteleitjes", unite: "stuk", base: 0.4, cat: "Algemeen", perVerpakking: "12", verpakking: " tray ", enkelPerVerpakking: true });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const k = (await store().list("Catalogue")).find((x) => x.fields.Produit === "Kwarteleitjes").fields;
  assert.equal(k["Per verpakking"], 12); assert.equal(k["Verpakking"], "tray"); assert.equal(k["Enkel per verpakking"], true);
  assert.equal(k["Prix de base"], 0.4, "le prix reste le prix par unité");
  const p = r.payload.products.find((x) => x.nom === "Kwarteleitjes");
  assert.deepStrictEqual([p.per, p.verpakking, p.enkel], [12, "tray", true], "Beheer relit les trois champs");
  // Produit au kg : conditionnement décimal permis, libellé par défaut « doos ».
  r = await save({ perVerpakking: "2,5", verpakking: "" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  let t = await fieldsOf("Catalogue", "recTONG");
  assert.deepStrictEqual([t["Per verpakking"], t["Verpakking"], !!t["Enkel per verpakking"]], [2.5, "doos", false]);
  // Vide ou 1 : vendu à l'unité, les trois champs effacés.
  r = await save({ perVerpakking: "1", verpakking: "kist", enkelPerVerpakking: true });
  assert.equal(r.statusCode, 200);
  t = await fieldsOf("Catalogue", "recTONG");
  assert.ok(!t["Per verpakking"] && !t["Verpakking"] && !t["Enkel per verpakking"], JSON.stringify(t));
  // Sans les clés (ancien navigateur, « Uit catalogus ») : rien n'est touché.
  r = await beheer({ action: "saveProduct", id: "recEGG", nom: "Eieren", unite: "stuk", base: 1, cat: "Algemeen" });
  assert.equal(r.statusCode, 200);
  assert.deepStrictEqual(V.pakOf(await fieldsOf("Catalogue", "recEGG")), { per: 6, label: "doos", only: true });
  // Refus : décimal hors kg, trop grand, texte.
  for (const bad of [{ id: "recEGG", nom: "Eieren", unite: "stuk", base: 1, cat: "A", perVerpakking: "2,5" }, { perVerpakking: "1500" }, { perVerpakking: "zes" }, { perVerpakking: "0" }]) {
    const x = await beheer(Object.assign({ action: "saveProduct", id: "recTONG", nom: "Tong", unite: "kg", base: 16, cat: "Vis" }, bad));
    assert.equal(x.statusCode, 400, JSON.stringify(bad));
    assert.match(x.payload.error, /verpakking/i);
  }
  // Catalogue client et Invoeren reçoivent le conditionnement.
  const c = await call("catalogue.js", { token: await tokenOf("recCLA") });
  assert.equal(c.statusCode, 200, JSON.stringify(c.payload));
  const egg = c.payload.products.find((x) => x.id === "recEGG");
  assert.deepStrictEqual([egg.per, egg.verpakking, egg.enkel, egg.prix], [6, "doos", true, 1]);
  assert.equal(c.payload.products.find((x) => x.id === "recTONG").per, undefined, "sans conditionnement : rien de plus");
  const s = await call("staff.js", null, { method: "GET", headers: cookie("staff"), query: { client: "recCLA" } });
  assert.deepStrictEqual(["per", "verpakking", "enkel"].map((x) => s.payload.products.find((y) => y.id === "recEGG")[x]), [6, "doos", true]);
});

// Retour de Mohsen : un carton de 12 pièces de 0,8 kg se saisit « 0,8 x 12 » (ou « 12 x 0,8 ») et pèse
// 9,6 kg. Avant, le champ refusait l'expression, Mohsen tapait 12 et le portail affichait « doos van 12 kg ».
test("Verpakking « 12 x 0,8 » kg : 12 stuks de 0,8 kg = 9,6 kg (décimale gardée), affiché, exposé et figé", async () => {
  for (const s of ["12 x 0,8", "0,8 x 12", "12×0,8", "12 X 0.8", "12*0,8", " 12 x 0,8 kg "]) assert.deepStrictEqual(V.pakParse(s), { per: 9.6, stuks: 12 }, s);
  assert.deepStrictEqual(V.pakParse("9,6"), { per: 9.6 });
  assert.deepStrictEqual(V.pakParse("6 x 2"), { per: 12, stuks: 6 }, "deux entiers : le premier compte les pièces");
  for (const bad of ["", "zes", "12 x", "x 0,8", "12 x 0,8 x 2", "-12 x 0,8", "12 x 0"]) assert.equal(V.pakParse(bad), null, bad);
  const p = V.pakOf({ per: 9.6, stuks: 12 });
  assert.deepStrictEqual(p, { per: 9.6, label: "doos", only: false, stuks: 12 });
  assert.deepStrictEqual(V.pakOf({ "Per verpakking": 9.6, "Stuks per verpakking": 12, "Verpakking": "doos" }), p);
  for (const s of [1, 2.5, 0, -3, 20000, "abc"]) assert.equal(V.pakOf({ per: 9.6, stuks: s }).stuks, undefined, "stuks invalide ignoré : " + s);
  assert.equal(V.pakOne(p, "kg", "nl"), "doos van 12 × 0,8 kg (9,6 kg)");
  assert.equal(V.pakOne(p, "kg", "fr"), "carton de 12 × 0,8 kg (9,6 kg)");
  assert.equal(V.pakOne(p, "pièce", "nl"), "doos van 9,6", "hors kg : pas de détail par pièce");
  assert.equal(V.pakQty(19.2, "kg", p, "nl"), "2 doos · 19,2 kg");
  assert.equal(V.pakCalc(19.2, "kg", p, "nl"), "2 doos × 9,6 kg = 19,2 kg");

  await seed();
  const save = (more) => beheer(Object.assign({ action: "saveProduct", id: "recTONG", nom: "Tong", unite: "kg", base: 16, cat: "Vis" }, more));
  for (const s of ["0,8 x 12", "12 x 0,8"]) {
    const r = await save({ perVerpakking: s, verpakking: "doos", enkelPerVerpakking: true });
    assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
    const t = await fieldsOf("Catalogue", "recTONG");
    assert.deepStrictEqual([t["Per verpakking"], t["Stuks per verpakking"]], [9.6, 12], s);
    const b = r.payload.products.find((x) => x.id === "recTONG");
    assert.deepStrictEqual([b.per, b.stuks, b.enkel], [9.6, 12, true], "Beheer relit le détail");
  }
  const c = await call("catalogue.js", { token: await tokenOf("recCLA") });
  const tong = c.payload.products.find((x) => x.id === "recTONG");
  assert.deepStrictEqual([tong.per, tong.stuks, tong.verpakking], [9.6, 12, "doos"]);
  // Commande d'un carton : 9,6 kg (pas 12), détail figé avec la ligne.
  const o = await order("recCLA", [{ productId: "recTONG", quantity: 9.6 }]);
  assert.equal(o.statusCode, 200, JSON.stringify(o.payload));
  const f = await fieldsOf("Commandes", o.payload.id);
  assert.deepStrictEqual(json(f)[0], { productId: "recTONG", naam: "Tong", qty: 9.6, unit: "kg", prijs: 16, per: 9.6, verpakking: "doos", stuks: 12 });
  assert.equal(f.Total, 153.6);
  const all = await call("allorders.js", null, { method: "GET", headers: cookie("staff") });
  assert.deepStrictEqual(all.payload.orders.find((x) => x.id === o.payload.id).verpakking, { tong: { per: 9.6, verpakking: "doos", stuks: 12 } });
  // Un poids simple efface le détail ; hors kg, l'expression doit donner un entier.
  let r = await save({ perVerpakking: "9,6", verpakking: "doos" });
  assert.equal(r.statusCode, 200);
  assert.ok(!(await fieldsOf("Catalogue", "recTONG"))["Stuks per verpakking"]);
  r = await beheer({ action: "saveProduct", id: "recEGG", nom: "Eieren", unite: "stuk", base: 1, cat: "Algemeen", perVerpakking: "2 x 6", verpakking: "tray" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const egg = await fieldsOf("Catalogue", "recEGG");
  assert.deepStrictEqual([egg["Per verpakking"], egg["Stuks per verpakking"] || null], [12, null], "stuks : détail réservé au kg");
  r = await beheer({ action: "saveProduct", id: "recEGG", nom: "Eieren", unite: "stuk", base: 1, cat: "Algemeen", perVerpakking: "12 x 0,8" });
  assert.equal(r.statusCode, 400);
  assert.match(r.payload.error, /verpakking/i);
});

// Chasse aux décimales perdues (même famille que « 12 x 0,8 ») : un nombre illisible n'est jamais 0.
test("décimales : taux TVA illisible refusé (jamais 0 %), stock / seuil illisibles = inchangés (jamais 0)", async () => {
  await seed();
  const cfg = (more) => beheer(Object.assign({ action: "saveConfig", bedrijfsnaam: "FAMO Seafood", btw: "BE0788705713", leverdagen: "1,2,3,4,5" }, more));
  for (const bad of [null, "", "6%", "zes", -1, 101]) {
    const r = await cfg({ btwTarief: bad });
    assert.equal(r.statusCode, 400, JSON.stringify(bad) + " " + JSON.stringify(r.payload));
    assert.match(r.payload.error, /BTW-tarief/);
  }
  assert.equal((await fieldsOf("Configuratie", "recCONF"))["BTW-tarief"], 6, "taux inchangé");
  let r = await cfg({ btwTarief: "5,5" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal((await fieldsOf("Configuratie", "recCONF"))["BTW-tarief"], 5.5);
  // Stock 0,375 : un enregistrement du produit sans stock lisible (null, "") ne le remet pas à 0.
  await patch("Stock", "recSTT", { "Quantité disponible": 0.375, "Seuil bas": 1.125 });
  for (const v of [null, ""]) {
    r = await beheer({ action: "saveProduct", id: "recTONG", nom: "Tong", unite: "kg", base: 16, cat: "Vis", stock: v, lowThreshold: v });
    assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
    const st = await fieldsOf("Stock", "recSTT");
    assert.deepStrictEqual([st["Quantité disponible"], st["Seuil bas"]], [0.375, 1.125], JSON.stringify(v));
  }
  r = await beheer({ action: "saveProduct", id: "recTONG", nom: "Tong", unite: "kg", base: 16, cat: "Vis", stock: 1.125 });
  assert.equal((await fieldsOf("Stock", "recSTT"))["Quantité disponible"], 1.125, "décimale gardée");
});

// ---- Commande client ---------------------------------------------------------------------------
test("client : 2 doos = 12 stuks au prix unitaire ; conditionnement figé dans Lignes JSON ; stock en unités", async () => {
  await seed();
  const r = await order("recCLA", [{ productId: "recEGG", quantity: 12, per: 1, verpakking: "gratis", enkel: false }], { [FIELD]: "[]" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const f = await fieldsOf("Commandes", r.payload.id);
  assert.equal(f[LINES], "Eieren × 12 pièce [€1.00]", "texte en unités, format inchangé");
  assert.equal(f["Lignes besteld"], f[LINES]);
  assert.equal(f.Total, 12);
  assert.deepStrictEqual(json(f), [{ productId: "recEGG", naam: "Eieren", qty: 12, unit: "pièce", prijs: 1, per: 6, verpakking: "doos" }], "conditionnement du catalogue, jamais du navigateur");
  // Le conditionnement change ensuite au catalogue : la commande garde le sien.
  await patch("Catalogue", "recEGG", { "Per verpakking": 10 });
  assert.equal((await fieldsOf("Catalogue", "recEGG"))["Per verpakking"], 10);
  // Stock : le départ retire 12 UNITÉS.
  const id = r.payload.id;
  for (const body of [{ statut: "Prête", preparationValidee: true }, { statut: "Sortie en livraison" }]) { const x = await staff(Object.assign({ id }, body)); assert.equal(x.statusCode, 200, JSON.stringify(x.payload)); }
  assert.equal((await fieldsOf("Stock", "recSTE"))["Quantité disponible"], 48);
  // Les listes du personnel et du client exposent le conditionnement figé (par nom de ligne).
  const all = await call("allorders.js", null, { method: "GET", headers: cookie("staff") });
  assert.deepStrictEqual(all.payload.orders.find((o) => o.id === id).verpakking, { eieren: { per: 6, verpakking: "doos" } });
  const mine = await call("orders.js", { token: await tokenOf("recCLA") });
  assert.equal(mine.statusCode, 200, JSON.stringify(mine.payload));
  assert.deepStrictEqual(mine.payload.orders.find((o) => o.id === id || o.ref === r.payload.ref).verpakking, { eieren: { per: 6, verpakking: "doos" } });
  const doc = await call("klantdoc.js", { token: await tokenOf("recCLA"), ref: r.payload.ref });
  assert.equal(doc.statusCode, 200, JSON.stringify(doc.payload));
  assert.deepStrictEqual(doc.payload.order.verpakking, { eieren: { per: 6, verpakking: "doos" } });
});

test("client : quantité non multiple d'un article « enkel per verpakking » refusée (NL, traduit en FR), rien n'est écrit", async () => {
  await seed();
  const r = await order("recCLA", [{ productId: "recEGG", quantity: 7 }]);
  assert.equal(r.statusCode, 400);
  assert.equal(r.payload.error, "Eieren: enkel per doos van 6 te bestellen (u vroeg 7 stuks).");
  // Même article en deux fois (fusionné par le serveur) : 3 + 4 = 7, refusé ; 3 + 3 = 6, accepté.
  assert.equal((await order("recCLA", [{ productId: "recEGG", quantity: 3 }, { productId: "recEGG", quantity: 4 }])).statusCode, 400);
  assert.equal((await store().list("Commandes")).length, 0);
  // Le portail client affiche le message en français pour un client FR (K.errText, sans appel au serveur).
  const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: null, localStorage: { getItem: (k) => (k === "famoLang" ? "fr" : null), setItem() {}, removeItem() {} }, addEventListener() {} };
  win.window = win; vm.createContext(Object.assign(win, { CustomEvent: class {}, fetch: async () => { throw new Error("réseau"); } }));
  vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "vat.js"), "utf8"), win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8"), win);
  assert.equal(win.K.errText(r.payload.error), "Eieren : uniquement par carton de 6 (vous avez demandé 7 pièces).");
  assert.equal(win.K.errText("Kreeft: enkel per kist van 5 kg te bestellen (u vroeg 7 kg)."), "Kreeft : uniquement par caisse de 5 kg (vous avez demandé 7 kg).");
  // Conditionnement SANS « enkel » : vente à l'unité permise.
  const ok = await order("recCLA", [{ productId: "recOES", quantity: 7 }]);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload));
  assert.deepStrictEqual(json(await fieldsOf("Commandes", ok.payload.id)), [{ productId: "recOES", naam: "Oesters", qty: 7, unit: "pièce", prijs: 0.85, per: 12, verpakking: "kist" }]);
});

test("Invoeren (personnel) : même règle serveur ; lignes corrigées par le magasin : quantité libre, conditionnement figé gardé", async () => {
  await seed();
  const bad = await staffPost({ clientId: "recCLA", items: [{ productId: "recEGG", quantity: 5 }] });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.payload.error, /enkel per doos van 6/);
  const r = await staffPost({ clientId: "recCLA", items: [{ productId: "recEGG", quantity: 18 }] });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  await patch("Catalogue", "recEGG", { "Per verpakking": 10 });
  assert.equal((await fieldsOf("Catalogue", "recEGG"))["Per verpakking"], 10);
  // 17 œufs livrés (un cassé) + un article ajouté : permis au magasin.
  const u = await staff({ id: r.payload.id, lignes: "Eieren × 17 pièce\nOesters × 12 pièce" });
  assert.equal(u.statusCode, 200, JSON.stringify(u.payload));
  const f = await fieldsOf("Commandes", r.payload.id);
  assert.equal(f[LINES], "Eieren × 17 pièce [€1.00]\nOesters × 12 pièce [€0.85]");
  assert.deepStrictEqual(json(f).map((e) => [e.naam, e.qty, e.per, e.verpakking]), [["Eieren", 17, 6, "doos"], ["Oesters", 12, 12, "kist"]], "déjà sur la commande : conditionnement figé ; ajouté : celui du catalogue");
});

test("non-régression : produit sans conditionnement → texte, JSON et total identiques au centime", async () => {
  await seed();
  const r = await order("recCLA", [{ productId: "recTONG", quantity: 1.5, comment: "in filets" }]);
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const f = await fieldsOf("Commandes", r.payload.id);
  assert.equal(f[LINES], "Tong × 1.5 kg [€16.00] (in filets)");
  assert.equal(f.Total, 24);
  assert.equal(f[FIELD], JSON.stringify([{ productId: "recTONG", naam: "Tong", qty: 1.5, unit: "kg", prijs: 16, comment: "in filets" }]), "JSON octet pour octet comme avant");
  const all = await call("allorders.js", null, { method: "GET", headers: cookie("staff") });
  assert.deepStrictEqual(all.payload.orders.find((o) => o.id === r.payload.id).verpakking, {}, "rien à annoter");
  const LJ = require(path.join(ROOT, "lib", "lignesjson.js"));
  assert.deepStrictEqual(LJ.pakMap(""), {}); assert.deepStrictEqual(LJ.pakMap("{kapot"), {});
  assert.deepStrictEqual(LJ.pakMap(JSON.stringify([{ productId: "recA", naam: "Eieren ", qty: 12, per: 6, verpakking: "doos" }, { productId: "recB", naam: "Tong", qty: 1 }])), { eieren: { per: 6, verpakking: "doos" } });
});

// ---- Documents (navigateur) --------------------------------------------------------------------
function docs() {
  const win = { console, Intl, Date };
  win.window = win; vm.createContext(win);
  for (const f of ["assets/vat.js", "assets/docs/bedrijf.js", "assets/docs/documents.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), win);
  win.FamoDocuments.setCompany({ bedrijfsnaam: "Famo Trading BV", adres: "Jezusstraat 34", plaats: "2000 Antwerpen", btw: "BE0788705713", iban: "BE71096123456769", bic: "GKCCBEBB", btwTarief: 6, facturatie: "portaal" });
  return win.FamoDocuments;
}
const DOC = { ref: "CMD-2026-0600", client: "Resto A", factuurnummer: "FA-2026-0600", factureeLe: "2026-10-01T09:00:00.000Z", klant: { klantnr: "K-1", btw: "BE0123456789" }, lignes: "Eieren × 12 pièce [€1.00]\nTong × 2 kg [€16.00]", total: 44 };

test("documents : facture et bon de livraison disent « 2 doos × 6 st = 12 st », montants inchangés ; FR ; ancien document identique", () => {
  const D = docs();
  const o = Object.assign({}, DOC, { verpakking: { eieren: { per: 6, verpakking: "doos" } } });
  const inv = D.build(o, "invoice"), plain = D.build(DOC, "invoice");
  assert.match(inv, /<small class="pak">2 doos × 6 st = 12 st × € 1,00 = € 12,00<\/small>/);
  assert.equal((inv.match(/class="pak"/g) || []).length, 1, "seulement la ligne avec conditionnement");
  // Totaux identiques au centime avec ou sans conditionnement : 12 + 32 = 44 HTVA, TVA 6 % = 2,64.
  const tot = (h) => Array.from(h.matchAll(/<div class="trow[^"]*"><span>[^<]*(?:<small>[^<]*<\/small>)?<\/span><span>([^<]+)<\/span><\/div>/g)).map((m) => m[1]);
  assert.deepStrictEqual(tot(inv), tot(plain));
  assert.ok(tot(inv).includes("€ 44,00") && tot(inv).includes("€ 46,64"), JSON.stringify(tot(inv)));
  assert.equal(inv.replace(/<small class="pak">[^<]*<\/small>/, ""), plain, "seule différence : la sous-ligne");
  const lb = D.build(o, "delivery");
  assert.match(lb, /<small class="pak">2 doos × 6 st = 12 st<\/small>/, "bon de livraison : sans prix");
  const fr = D.build(Object.assign({}, o, { klant: Object.assign({}, o.klant, { taal: "FR" }) }), "delivery");
  assert.match(fr, /<small class="pak">2 cartons × 6 pc = 12 pc<\/small>/);
  // Ancienne commande : aucune annotation, document octet pour octet.
  assert.equal(D.build(Object.assign({}, DOC, { verpakking: {} }), "invoice"), plain);
  assert.equal(D.build(Object.assign({}, DOC, { verpakking: { andere: { per: 6, verpakking: "doos" } } }), "delivery"), D.build(DOC, "delivery"));
  // Note de crédit sur 6 œufs : « 1 doos × 6 st = 6 st », montant négatif.
  const cn = D.build(Object.assign({}, o, { creditnota: { nummer: "CN-2026-0001", lignes: "Eieren × 6 pièce [€1.00]", montant: 6, le: "2026-10-02" } }), "credit");
  assert.match(cn, /<small class="pak">1 doos × 6 st = 6 st × € -1,00 = € -6,00<\/small>/);
});

// ---- E-mails ------------------------------------------------------------------------------------
test("e-mails : confirmation équipe et client (NL/FR) avec le conditionnement ; sans lui, e-mail identique", () => {
  const om = require(path.join(ROOT, "lib", "ordermail.js"));
  const base = { ref: "CMD-2026-0600", company: { bedrijfsnaam: "FAMO" }, opsEmail: "ops@famo.test", lignes: "Eieren × 12 pièce [€1.00]\nTong × 2 kg [€16.00]", total: 44, date: "2026-10-01", dateLivraison: "2026-10-02", klant: { nom: "Resto A", email: "a@resto.test" } };
  const pak = { eieren: { per: 6, verpakking: "doos" } };
  const team = om.buildTeamMail(Object.assign({}, base, { verpakking: pak }));
  assert.match(team.html, /2 doos × 6 st = 12 st/); assert.match(team.text, /Eieren × 12 stuk {2}€ 12,00 · 2 doos × 6 st = 12 st/);
  const nl = om.buildCustomerMail(Object.assign({}, base, { verpakking: pak }));
  assert.match(nl.html, /2 doos × 6 st = 12 st/);
  const fr = om.buildCustomerMail(Object.assign({}, base, { verpakking: pak, klant: { nom: "Resto F", email: "f@resto.test", taal: "FR" } }));
  assert.match(fr.html, /2 cartons × 6 pc = 12 pc/); assert.match(fr.text, /2 cartons × 6 pc = 12 pc/);
  assert.match(om.buildStatusMail(Object.assign({}, base, { status: "onderweg", verpakking: pak })).html, /2 doos × 6 st = 12 st/);
  for (const b of ["buildTeamMail", "buildCustomerMail"]) {
    const a = om[b](base), c = om[b](Object.assign({}, base, { verpakking: {} }));
    assert.equal(c.html, a.html, b + " : HTML inchangé sans conditionnement");
    assert.equal(c.text, a.text, b + " : texte inchangé sans conditionnement");
    assert.ok(!/doos ×/.test(a.html));
  }
});

// ---- UBL ----------------------------------------------------------------------------------------
test("UBL : quantité en unités (H87), note de ligne « 2 doos × 6 st » ; sans conditionnement, XML identique", () => {
  const ubl = require(path.join(ROOT, "lib", "ubl.js"));
  const { parseLines } = require(path.join(ROOT, "lib", "lines.js"));
  const order = (lj) => ({ fields: Object.assign({ "Référence": "CMD-1", Statut: "Facturée", Factuurnummer: "FA-2026-0001", "Facturée le": "2026-10-01T10:00:00.000Z", [LINES]: "Eieren × 12 pièce [€1.00]\nTong × 2 kg [€16.00]" }, lj ? { [FIELD]: lj } : {}) });
  const args = (o) => ({ order: o, client: { fields: { Nom: "Resto", "BTW-nummer": "BE0417497106", "Lieu de livraison": "Kaai 1\n2000 Antwerpen" } }, config: { "Juridische naam": "Famo", "BTW-nummer": "BE0788705713", Adres: "Jezusstraat 34", "Postcode en plaats": "2000 Antwerpen" }, catalogueRates: {}, parseLines, kind: "invoice" });
  const lj = JSON.stringify([{ productId: "recEGG", naam: "Eieren", qty: 12, unit: "pièce", prijs: 1, per: 6, verpakking: "doos" }, { productId: "recTONG", naam: "Tong", qty: 2, unit: "kg", prijs: 16 }]);
  const withPak = ubl.build(ubl.contextFrom(args(order(lj)))).xml;
  const before = ubl.build(ubl.contextFrom(args(order(null)))).xml;
  assert.match(withPak, /<cac:InvoiceLine><cbc:ID>1<\/cbc:ID><cbc:Note>2 doos × 6 st<\/cbc:Note><cbc:InvoicedQuantity unitCode="H87">12<\/cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">12.00<\/cbc:LineExtensionAmount>/);
  assert.equal((withPak.match(/<\/cbc:ID><cbc:Note>/g) || []).length, 1, "seulement la ligne avec conditionnement");
  assert.equal(withPak.replace("<cbc:Note>2 doos × 6 st</cbc:Note>", ""), before, "rien d'autre ne change (montants, TVA)");
  assert.ok(!/<cac:InvoiceLine><cbc:ID>\d+<\/cbc:ID><cbc:Note>/.test(before));
});

// ---- Commande par e-mail (spec 020) ------------------------------------------------------------
test("e-mail « 2 dozen eieren » : le serveur recalcule les unités ; désaccord, non multiple ou article sans doos → Te controleren", () => {
  const claude = require(path.join(ROOT, "lib", "inbound", "claude.js"));
  const mailorder = require(path.join(ROOT, "lib", "inbound", "mailorder.js"));
  const lev = require(path.join(ROOT, "lib", "levering.js"));
  const cat = claude.catalogueText([{ id: "recEGG", fields: EGG }, { id: "recTONG", fields: { Produit: "Tong", "Unité": "kg" } }]);
  assert.match(cat, /"verpakking":"doos van 6","enkel_per_verpakking":true/);
  assert.ok(!/recTONG[^\n]*verpakking/.test(cat), "pas de conditionnement : rien de plus");
  assert.ok(claude.SCHEMA.properties.lines.items.properties.verpakkingen, "le modèle peut rendre le nombre de conditionnements");
  assert.ok(claude.SCHEMA.properties.lines.items.required.includes("verpakkingen"));
  assert.equal(claude.sanitize({ lines: [{ productId: "recEGG", qty: 12, verpakkingen: "2" }] }).lines[0].verpakkingen, 2);
  assert.equal(claude.sanitize({ lines: [{ productId: "recEGG", qty: 12, verpakkingen: null }] }).lines[0].verpakkingen, undefined, "absent : comme avant");
  const products = new Map([["recEGG", { id: "recEGG", fields: EGG }], ["recTONG", { id: "recTONG", fields: { Produit: "Tong", "Unité": "kg" } }], ["recOES", { id: "recOES", fields: { Produit: "Oesters", "Unité": "pièce", "Per verpakking": 12, "Verpakking": "kist" } }]]);
  const ctx = { products, rules: lev.rulesFrom({ "Besteldeadline": "22:00", "Leverdagen": "ma,di,wo,do,vr,za" }), client: { fields: {} }, now: new Date() };
  const L = (o) => Object.assign({ productId: "recEGG", naam_in_mail: "eieren", qty: 12, unit: "pièce", confidence: 0.95, opmerking: "", note: "" }, o);
  const run = (lines) => mailorder.check({ lines, leverdag: null, opmerkingen: "", onduidelijk: false }, ctx);
  let c = run([L({ verpakkingen: 2 })]);
  assert.deepStrictEqual(c.problems, []); assert.deepStrictEqual(c.items.map((i) => i.quantity), [12]);
  c = run([L({ qty: 2, unit: "carton", verpakkingen: 2 })]);
  assert.deepStrictEqual(c.problems, [], "unité « doos » d'un article par doos : pas un conflit d'unité");
  assert.deepStrictEqual(c.items.map((i) => i.quantity), [12], "le serveur décide : 2 × 6");
  c = run([L({ qty: 24, verpakkingen: 2 })]);
  assert.match(c.problems.join(" | "), /«eieren»: 2 doos ≠ 24 stuk/);
  c = run([L({ qty: 7 })]);
  assert.match(c.problems.join(" | "), /«eieren»: enkel per doos van 6 \(gevraagd: 7 stuk\)/);
  c = run([L({ productId: "recTONG", naam_in_mail: "tong", qty: 2, unit: "carton", verpakkingen: 2 })]);
  assert.match(c.problems.join(" | "), /«tong»: per verpakking gevraagd, maar het artikel heeft geen verpakking/);
  c = run([L({ productId: "recOES", naam_in_mail: "oesters", qty: 30 })]);
  assert.deepStrictEqual(c.problems, [], "conditionnement sans « enkel » : 30 pièces permis");
});
