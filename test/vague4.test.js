"use strict";
// Spec 035 (vague 4) : visfiche produit, champs de lot, instantané figé à la préparation, rattachement
// par identifiant produit, bon de livraison qui n'imprime que ce qui est rempli, lots livrés par client.
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
const VIS = require(path.join(ROOT, "assets", "visfiche.js"));

const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, send(p) { this.payload = p; return this; }, end() { return this; } }; }
async function call(file, body, opts) {
  const res = mkRes();
  await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || cookie("staff"), query: (opts && opts.query) || {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fieldsOf = async (table, id) => (await store().get(table, id)).fields;
// Modification directe d'un enregistrement (données d'avant la spec) : fusion + version, comme le moteur.
const patch = async (table, id, fields) => { const cur = await store().get(table, id); assert.ok(await store().update(table, id, Object.assign({}, cur.fields, fields), cur.version)); };
const beheer = (body) => call("onboarding.js", body, { headers: cookie("admin") });
const today = new Date().toISOString().slice(0, 10);

async function seed() {
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6 })]);
  await store().replaceAll("Catalogue", [
    rec("recP1", { Produit: "Tong", "Prix de base": 30, "Unité": "kg", Actif: true, "Catégorie": "Vis" }),
    rec("recP2", { Produit: "Mosselen", "Prix de base": 5, "Unité": "kg", Actif: true, "Catégorie": "Schelpdieren" }),
    rec("recP3", { Produit: "Citroen", "Prix de base": 1, "Unité": "pièce", Actif: true })
  ]);
  await store().replaceAll("Stock", []);
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Resto A", Taal: "NL" }), rec("recCLB", { Nom: "Sushi B", Taal: "FR" })]);
  const lines = "Tong × 2 kg [€30.00]\nMosselen × 3 kg [€5.00]\nCitroen × 4 pièce [€1.00]";
  const json = JSON.stringify([{ productId: "recP1", naam: "Tong", qty: 2, unit: "kg", prijs: 30 }, { productId: "recP2", naam: "Mosselen", qty: 3, unit: "kg", prijs: 5 }, { productId: "recP3", naam: "Citroen", qty: 4, unit: "pièce", prijs: 1 }]);
  await store().replaceAll("Commandes", [
    rec("recORD1", { "Référence": "CMD-2026-0001", Date: today, Statut: "Reçue", Client: ["recCLA"], "Date livraison souhaitée": today, "Lignes (produits / quantités)": lines, "Lignes JSON": json, Total: 79 }),
    rec("recORD2", { "Référence": "CMD-2026-0002", Date: today, Statut: "Reçue", Client: ["recCLB"], "Date livraison souhaitée": today, "Lignes (produits / quantités)": "Tong × 1 kg [€30.00]", "Lignes JSON": JSON.stringify([{ productId: "recP1", naam: "Tong", qty: 1, unit: "kg", prijs: 30 }]), Total: 30 })
  ]);
  await store().replaceAll("Lots", []);
  await store().replaceAll("Journaal", []);
}
const TONG = { wetenschappelijkeNaam: "Solea solea", faoCode: "sol", productiemethode: "Gevangen op zee", vangstgebied: "27.IV", vistuig: "Chaluts", staat: "Vers", allergenen: ["vis"], bewaring: "0 tot 2 °C, onder ijs", rauw: true, vriesbehandeling: "-20 °C 24 h" };
const saveTong = (vis) => beheer({ action: "saveProduct", id: "recP1", nom: "Tong", unite: "kg", base: 30, cat: "Vis", vis });
const LOT = { lotnummer: "L-77", produit: "Tong", leverancier: "Visserij Noordzee", ontvangenOp: today, tht: "2026-11-02", vangstdatum: "2026-10-20", vangstId: "Z-12/2026-118", nettoKg: "24,5" };
// Klaar : validation article par article + lot choisi pour la tong.
const klaar = (id, lots) => call("updateorder.js", { id, statut: "Prête", preparationValidee: true, lots });

function docs() {
  const win = { console, Intl, Date }; win.window = win; vm.createContext(win);
  for (const f of ["assets/vat.js", "assets/visfiche.js", "assets/docs/bedrijf.js", "assets/docs/documents.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), win);
  win.FamoDocuments.setCompany({ bedrijfsnaam: "FAMO Seafood" });
  return win.FamoDocuments;
}
const orderOf = async (id) => (await call("allorders.js", null, { method: "GET" })).payload.orders.find((o) => o.id === id);

test("visfiche produit : enregistrée (Beheer seul), lue par le catalogue ; valeurs hors liste refusées", async () => {
  await seed();
  const r = await saveTong(TONG);
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const f = await fieldsOf("Catalogue", "recP1");
  assert.equal(f["FAO-code"], "SOL", "code FAO en majuscules");
  assert.equal(f["Vangstgebied"], "27.IV"); assert.equal(f["Vistuig"], "Chaluts"); assert.equal(f["Allergenen"], "vis");
  assert.equal(f["Rauw te eten"], true); assert.equal(f["Vriesbehandeling"], "-20 °C 24 h");
  const p = r.payload.products.find((x) => x.id === "recP1");
  assert.deepEqual(JSON.parse(JSON.stringify(p.vis.allergenen)), ["vis"]);
  assert.equal(p.vis.wetenschappelijkeNaam, "Solea solea");
  // Refus : chaque liste fermée, le code FAO, l'engin pour un produit d'élevage.
  for (const bad of [{ vangstgebied: "Noordzee" }, { vistuig: "boomkor" }, { productiemethode: "Wild" }, { staat: "Gerookt" }, { allergenen: ["vis", "aardbei"] }, { faoCode: "SO" }, { faoCode: "SOLE" }, { vriesbehandeling: "-18 °C 96 h" }, { productiemethode: "Gekweekt", vistuig: "Chaluts" }]) {
    const res = await saveTong(Object.assign({}, TONG, bad));
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
  assert.equal((await fieldsOf("Catalogue", "recP1"))["Vangstgebied"], "27.IV", "rien écrit sur un refus");
  // « Rauw te eten » décoché : le traitement n'est pas gardé.
  assert.equal((await saveTong(Object.assign({}, TONG, { rauw: false }))).statusCode, 200);
  assert.ok(!(await fieldsOf("Catalogue", "recP1"))["Vriesbehandeling"]);
  // Sans « vis » dans le corps : la fiche n'est pas touchée (comme Kaliber).
  await saveTong(TONG);
  assert.equal((await beheer({ action: "saveProduct", id: "recP1", nom: "Tong", unite: "kg", base: 31, cat: "Vis" })).statusCode, 200);
  assert.equal((await fieldsOf("Catalogue", "recP1"))["Wetenschappelijke naam"], "Solea solea");
  // Le personnel n'enregistre pas de produit.
  assert.ok([401, 403].includes((await call("onboarding.js", { action: "saveProduct", id: "recP1", nom: "Tong", unite: "kg", base: 30, vis: TONG })).statusCode));
});

test("champs de lot : capture, identifiant, kg net ; produit rattaché par identifiant ; zone et engin en liste fermée", async () => {
  await seed();
  const l = await call("lots.js", LOT);
  assert.equal(l.statusCode, 200, JSON.stringify(l.payload));
  const f = await fieldsOf("Lots", l.payload.lot.id);
  assert.equal(f["Product-id"], "recP1", "TRACE-04 : identifiant du catalogue");
  assert.equal(f["Vangstdatum"], "2026-10-20"); assert.equal(f["Vangst-id"], "Z-12/2026-118"); assert.equal(f["Netto kg"], 24.5);
  assert.equal((await call("lots.js", Object.assign({}, LOT, { vangstgebied: "ergens" }))).statusCode, 400);
  assert.equal((await call("lots.js", Object.assign({}, LOT, { vistuig: "net" }))).statusCode, 400);
  assert.equal((await call("lots.js", Object.assign({}, LOT, { vangstdatum: "20/10" }))).statusCode, 400);
  assert.equal((await call("lots.js", Object.assign({}, LOT, { nettoKg: "-3" }))).statusCode, 400);
  assert.equal((await call("lots.js", Object.assign({}, LOT, { productId: "recNOPE" }))).statusCode, 400);
  // Ancienne saisie libre (avant la liste) : gardée telle quelle à la modification, pas imposée de nouveau.
  await patch("Lots", l.payload.lot.id, { Vangstgebied: "FAO 27 IV", Vistuig: "boomkor" });
  const keep = await call("lots.js", Object.assign({}, LOT, { id: l.payload.lot.id, vangstgebied: "FAO 27 IV", vistuig: "boomkor", nota: "ok" }));
  assert.equal(keep.statusCode, 200, JSON.stringify(keep.payload));
  // Produit renommé : la liste des lots suit le nom du catalogue (préparation par nom).
  const ren = await beheer({ action: "saveProduct", id: "recP1", nom: "Noordzeetong", unite: "kg", base: 30, cat: "Vis" });
  assert.equal(ren.statusCode, 200, JSON.stringify(ren.payload));
  const list = await call("lots.js", null, { method: "GET" });
  assert.equal(list.payload.lots[0].produit, "Noordzeetong");
  assert.ok(list.payload.producten.some((p) => p.id === "recP1"));
});

test("Klaar : lot + visfiche figés sur la commande ; corriger le lot ou le produit ensuite ne change rien (TRACE-02)", async () => {
  await seed();
  await saveTong(TONG);
  const l = await call("lots.js", LOT);
  const lotId = l.payload.lot.id;
  // Un lot d'un autre produit est refusé (rattachement par identifiant).
  assert.equal((await klaar("recORD1", { Mosselen: lotId })).statusCode, 400);
  const r = await klaar("recORD1", { Tong: lotId });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const f = await fieldsOf("Commandes", "recORD1");
  const snap = JSON.parse(f.Lots).Tong[0];
  assert.equal(snap.faoCode, "SOL"); assert.equal(snap.vangstgebied, "27.IV", "zone du produit reprise"); assert.equal(snap.vistuig, "Chaluts");
  assert.equal(snap.vangstdatum, "2026-10-20"); assert.equal(snap.vangstId, "Z-12/2026-118"); assert.equal(snap.productId, "recP1");
  assert.ok(!("aankoopprijs" in snap), "jamais le prix d'achat");
  const fiche = JSON.parse(f.Productfiche);
  assert.equal(fiche.Tong.vriesbehandeling, "-20 °C 24 h");
  assert.ok(!fiche.Citroen, "produit sans visfiche : rien de figé");
  // Après la préparation : le lot et le produit changent.
  await call("lots.js", Object.assign({}, LOT, { id: lotId, vangstgebied: "27.VII", vangstId: "AUTRE" }));
  await saveTong(Object.assign({}, TONG, { vangstgebied: "27.VIII", allergenen: ["vis", "sulfiet"] }));
  // Départ : plus aucun changement possible ; le document garde l'instantané.
  assert.equal((await call("updateorder.js", { id: "recORD1", statut: "Sortie en livraison" })).statusCode, 200);
  assert.equal((await call("updateorder.js", { id: "recORD1", lots: { Tong: lotId } })).statusCode, 409);
  const o = await orderOf("recORD1");
  assert.equal(o.lots.Tong[0].vangstgebied, "27.IV"); assert.equal(o.lots.Tong[0].vangstId, "Z-12/2026-118");
  assert.deepEqual(JSON.parse(JSON.stringify(o.fiche.Tong.allergenen)), ["vis"]);
});

test("TRACE-04 : un lot suit son produit renommé ; un ancien lot sans identifiant reste apparié par nom", async () => {
  await seed();
  const l = await call("lots.js", LOT);
  await patch("Lots", l.payload.lot.id, { Produit: "Oude naam" }); // nom périmé, identifiant juste
  assert.equal((await klaar("recORD2", { Tong: l.payload.lot.id })).statusCode, 200, "accepté par identifiant");
  await seed();
  await store().replaceAll("Lots", [rec("recLOTOLD", { Lotnummer: "OLD-1", Produit: "Tong", Actief: true })]);
  assert.equal((await klaar("recORD2", { Tong: "recLOTOLD" })).statusCode, 200, "ancien lot : par nom");
});

test("bon de livraison NL/FR : seulement ce qui est rempli, mention du traitement pour le cru", async () => {
  await seed();
  await saveTong(TONG);
  await beheer({ action: "saveProduct", id: "recP2", nom: "Mosselen", unite: "kg", base: 5, cat: "Schelpdieren", vis: { wetenschappelijkeNaam: "Mytilus edulis", productiemethode: "Gekweekt", landVanKweek: "Nederland", allergenen: ["weekdieren"], staat: "Ontdooid" } });
  const l = await call("lots.js", LOT);
  assert.equal((await klaar("recORD1", { Tong: l.payload.lot.id })).statusCode, 200);
  const D = docs(), o = await orderOf("recORD1");
  const nl = D.build(Object.assign({}, o, { klant: { taal: "NL" } }), "delivery");
  assert.match(nl, /Lot L-77 · <i>Solea solea<\/i> \(SOL\) · FAO 27\.IV Noordzee · Gevangen op zee · Sleepnetten · THT 02\/11\/2026 · vangstdatum 20\/10\/2026 · vangstreis Z-12\/2026-118/);
  assert.match(nl, /Vers · Allergenen: Vis · Bewaren: 0 tot 2 °C, onder ijs/);
  assert.match(nl, /Bestemd om rauw te eten: diepgevroren op −20 °C of kouder, minstens 24 uur in alle delen/);
  // Mosselen sans lot : la visfiche seule (élevage : pays, pas d'engin) ; « ontdooid » imprimé.
  assert.match(nl, /<i>Mytilus edulis<\/i> · Nederland · Gekweekt<\/small><small class="lot">Ontdooid · Allergenen: Weekdieren<\/small>/);
  // Citroen : aucune ligne ajoutée, aucune case vide.
  const citroen = nl.slice(nl.indexOf(">Citroen<"), nl.indexOf("</td>", nl.indexOf(">Citroen<")));
  assert.ok(!/class="lot"/.test(citroen), "rien sous un produit sans visfiche");
  for (const empty of [/· ·/, /: ·/, /:\s*<\/small>/, /<small class="lot"><\/small>/]) assert.ok(!empty.test(nl), "case vide : " + empty);
  const fr = D.build(Object.assign({}, o, { klant: { taal: "FR" } }), "delivery");
  assert.match(fr, /FAO 27\.IV mer du Nord · Pêché en mer · Chaluts · DLC 02\/11\/2026 · capturé le 20\/10\/2026 · sortie de pêche Z-12\/2026-118/);
  assert.match(fr, /Frais · Allergènes: Poissons · Conservation: 0 tot 2 °C/);
  assert.match(fr, /Destiné à être consommé cru : congelé à −20 °C ou moins, au moins 24 heures en tous points/);
  assert.match(fr, /Décongelé · Allergènes: Mollusques/);
  // « Niet van toepassing » : rien d'imprimé sur le traitement.
  assert.equal(VIS.freezeText({ rauw: true, vriesbehandeling: "Niet van toepassing" }, "nl"), "");
  assert.equal(VIS.freezeText({ rauw: false, vriesbehandeling: "-35 °C 15 h" }, "nl"), "");
});

test("lots livrés par client et période (TRACE-03) : beheerder seul, instantané transmis, CSV possible", async () => {
  await seed();
  await saveTong(TONG);
  const l = await call("lots.js", LOT);
  await klaar("recORD1", { Tong: l.payload.lot.id });
  await klaar("recORD2", { Tong: l.payload.lot.id });
  const q = { geleverd: "1", van: today, tot: today };
  // Rien n'est encore parti : la liste est vide.
  assert.equal((await call("lots.js", null, { method: "GET", headers: cookie("admin"), query: q })).payload.rows.length, 0);
  await call("updateorder.js", { id: "recORD1", statut: "Sortie en livraison" });
  await call("updateorder.js", { id: "recORD2", statut: "Sortie en livraison" });
  await call("lots.js", Object.assign({}, LOT, { id: l.payload.lot.id, vangstId: "GEWIJZIGD" })); // après coup
  assert.equal((await call("lots.js", null, { method: "GET", query: q })).statusCode, 403, "personnel refusé");
  const all = await call("lots.js", null, { method: "GET", headers: cookie("admin"), query: q });
  assert.equal(all.statusCode, 200);
  assert.equal(all.payload.rows.length, 2);
  assert.ok(all.payload.rows.every((r) => r.vangstId === "Z-12/2026-118"), "ce qui a été transmis, pas la fiche actuelle");
  assert.equal(all.payload.zonderLot, 2, "Mosselen et Citroen sans lot");
  assert.deepEqual(all.payload.klanten.map((k) => k.nom), ["Resto A", "Sushi B"]);
  const a = await call("lots.js", null, { method: "GET", headers: cookie("admin"), query: Object.assign({ klant: "recCLB" }, q) });
  assert.deepEqual(a.payload.rows.map((r) => [r.klant, r.ref, r.lotnummer, r.hoeveelheid]), [["Sushi B", "CMD-2026-0002", "L-77", 1]]);
  const later = await call("lots.js", null, { method: "GET", headers: cookie("admin"), query: { geleverd: "1", van: "2020-01-01", tot: "2020-01-31" } });
  assert.equal(later.payload.rows.length, 0, "hors période");
  assert.equal((await call("lots.js", null, { method: "GET", headers: cookie("admin"), query: { geleverd: "1", van: "2026-02-01", tot: "2026-01-01" } })).statusCode, 400);
});

test("visfiche : libellés NL/FR, zones et engins connus, catalogue client et vitrine", async () => {
  assert.equal(VIS.zoneLabel("27.IV", "fr"), "FAO 27.IV mer du Nord");
  assert.equal(VIS.zoneLabel("FAO 27 IV", "nl"), "FAO 27 IV", "ancienne saisie libre rendue telle quelle");
  assert.equal(VIS.ALLERGENS.length, 14);
  assert.equal(VIS.GEARS.length, 7);
  assert.deepEqual(VIS.originParts({ productiemethode: "Gekweekt", landVanKweek: "Noorwegen" }, "fr"), ["Élevé", "Noorwegen"]);
  await seed();
  await saveTong(TONG);
  // Catalogue client : la visfiche part avec le produit (seulement les valeurs remplies).
  const ca = require(path.join(ROOT, "lib", "clientauth.js"));
  await patch("Clients", "recCLA", { Gebruikersnaam: "resto", Wachtwoord: ca.hashPassword("geheim123") });
  const tok = ca.issueToken(await store().get("Clients", "recCLA"));
  const c = await call("catalogue.js", {}, { method: "POST", headers: { cookie: "famo_klant=" + encodeURIComponent(tok), host: "localhost", "x-forwarded-for": "10.4.4.4" } });
  assert.equal(c.statusCode, 200, JSON.stringify(c.payload));
  assert.equal(c.payload.products.find((x) => x.id === "recP1").vis.faoCode, "SOL");
  assert.deepEqual(JSON.parse(JSON.stringify(c.payload.products.find((x) => x.id === "recP3").vis)), {}, "rien d'inventé");
  // Vitrine : fiche produit avec nom scientifique et herkomst, en NL et en FR.
  const V = require(path.join(ROOT, "lib", "vitrine.js"));
  const recs = (await store().list("Catalogue"));
  const p = V.products(recs).find((x) => x.id === "recP1");
  const nl = V.renderProduct(p, {}, { lang: "nl", origin: "https://x.test" });
  assert.match(nl, /<i>Solea solea<\/i>/); assert.match(nl, /FAO 27\.IV Noordzee/); assert.match(nl, /Allergenen/);
  const fr = V.renderProduct(p, {}, { lang: "fr", origin: "https://x.test" });
  assert.match(fr, /Pêché en mer/); assert.match(fr, /Poissons/);
  const nofish = V.renderProduct(V.products(recs).find((x) => x.id === "recP3"), {}, { lang: "nl", origin: "https://x.test" });
  assert.ok(!/Allergenen|Herkomst|Wetenschappelijke/.test(nofish), "rien d'affiché sans visfiche");
});
