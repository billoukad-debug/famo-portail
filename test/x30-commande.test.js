"use strict";
// Spec 036 (x30 lot A) : « Zoals elke maandag » (commande probable), bandeau de l'heure, modifier sans annuler,
// une 2e commande du même jour qui s'ajoute, catalogue (groupes, noms, Rauw OK). Moteur SQL (SQLite en mémoire),
// vraie chaîne API ; aucun réseau, aucun e-mail.
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
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const FB = require(path.join(ROOT, "assets", "bestellen.js"));
const GW = require(path.join(ROOT, "lib", "gewoonte.js"));

function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, send(p) { this.payload = p; return this; }, end() { return this; } }; }
async function call(file, body, opts) {
  const res = mkRes();
  await require(path.join(ROOT, "api", file))({ method: "POST", body, headers: (opts && opts.headers) || {}, query: {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fieldsOf = async (table, id) => (await store().get(table, id)).fields;
const klant = async (id) => ({ headers: { cookie: "famo_klant=" + encodeURIComponent(ca.issueToken({ id, fields: await fieldsOf("Clients", id) })) } });
const staff = { headers: { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, "staff")) } };
const today = FB.brussel().iso;
const plus = (n) => FB.addDays(today, n);
const LINES = "Lignes (produits / quantités)";

// Deux jours plus tard (toujours modifiable, quelle que soit l'heure) et aujourd'hui (jamais modifiable).
const LATER = (() => { let d = plus(2); while (new Date(d + "T12:00:00Z").getUTCDay() === 0) d = FB.addDays(d, 1); return d; })();

async function seed(opts) {
  const o = opts || {};
  await store().replaceAll("Configuratie", [rec("recCONF", Object.assign({ Bedrijfsnaam: "FAMO Seafood", "BTW-tarief": 6, Besteldeadline: "22:00" }, o.conf || {}))]);
  await store().replaceAll("Catalogue", [
    rec("recZALM", { Produit: "Zalm", "Prix de base": 18.5, "Unité": "kg", "Catégorie": "Poisson", Actif: true }),
    rec("recTON", { Produit: "Tonijn", "Prix de base": 29.9, "Unité": "kg", "Catégorie": "Poisson", Actif: true }),
    rec("recVAN", { Produit: "VANNAMEI GARNALEN 26-30", "Prix de base": 12.9, "Unité": "pièce", "Catégorie": "Algemeen", Actif: true }),
    rec("recWAK", { Produit: "WAKAME 500G", "Prix de base": 6.5, "Unité": "pièce", "Catégorie": "Vegetarisch", Actif: true }),
    rec("recOUD", { Produit: "Oud artikel", "Prix de base": 3, "Unité": "caisse", "Catégorie": "Algemeen", Actif: false }),
    rec("recEI", { Produit: "Eieren", "Prix de base": 1, "Unité": "pièce", "Catégorie": "Algemeen", Actif: true, "Per verpakking": 6, "Verpakking": "doos", "Enkel per verpakking": true })
  ]);
  const pw = ca.hashPassword("geheim123");
  await store().replaceAll("Clients", [rec("recCLA", { Nom: "Aloha", Gebruikersnaam: "aloha", Wachtwoord: pw }), rec("recCLB", { Nom: "Kaai", Gebruikersnaam: "kaai", Wachtwoord: pw })]);
  await store().replaceAll("Prix négociés", [rec("recNEG", { Client: ["recCLA"], Produit: ["recZALM"], "Prix négocié": 16 })]);
  await store().replaceAll("Commandes", o.orders || []);
  await store().replaceAll("Compteurs", []);
  await store().replaceAll("Journaal", []);
  await store().replaceAll("Stock", []);
}
// Commande livrée (« Facturée ») d'un client, avec des lignes au prix d'ALORS (pour vérifier le recalcul).
let n = 0;
function geleverd(client, dag, lines, extra) {
  n++;
  return rec("recH" + String(n).padStart(4, "0"), Object.assign({ "Référence": "CMD-H-" + n, Date: FB.addDays(dag, -1), "Date livraison souhaitée": dag, Statut: "Facturée", Client: [client], [LINES]: lines.map(([nom, q, u, p]) => `${nom} × ${q} ${u} [€${p.toFixed(2)}]`).join("\n"), Total: 1 }, extra || {}));
}
const products = async () => new Map((await store().list("Catalogue")).filter((r) => r.fields.Actif).map((r) => [r.id, r]));
const qty = (p, id) => (p.items.find((i) => i.productId === id) || {}).quantity;

// ---------------------------------------------------------------------------------------------------------------
test("commande probable : médiane par produit sur les 8 dernières livraisons du même jour de semaine", async () => {
  const L = LATER;
  const hist = [
    // 9 livraisons le même jour de semaine (la plus ancienne ne compte pas), des quantités qui varient.
    ...[4, 4, 5, 4, 3, 4, 6, 4, 50].map((q, i) => geleverd("recCLA", FB.addDays(L, -7 * (i + 1)), [["Zalm", q, "kg", 16], ["Tonijn", i % 2 ? 2 : 1.5, "kg", 27.5]].concat(i < 3 ? [["WAKAME 500G", 1, "pièce", 6.5]] : []))),
    // Un autre jour de semaine : ignoré tant qu'il y a des livraisons le bon jour.
    geleverd("recCLA", FB.addDays(L, -3), [["VANNAMEI GARNALEN 26-30", 9, "pièce", 10]]),
    // Annulée, non livrée, ou d'un autre client : jamais.
    geleverd("recCLA", FB.addDays(L, -7), [["Zalm", 99, "kg", 16]], { Statut: "Annulée" }),
    geleverd("recCLB", FB.addDays(L, -7), [["Tonijn", 40, "kg", 27.5]])
  ];
  await seed({ orders: hist });
  const mine = hist.filter((r) => r.fields.Client[0] === "recCLA");
  const p = GW.probable(mine, await products(), L);
  assert.equal(p.basis, "weekdag"); assert.equal(p.n, 8, "8 commandes au plus");
  assert.equal(qty(p, "recZALM"), 4, "médiane de 4,4,5,4,3,4,6,4 = 4 ; le 50 d'il y a 9 semaines ne compte pas");
  assert.equal(qty(p, "recTON"), 2, "médiane 1,75 arrondie au pas de 0,5 kg");
  assert.equal(qty(p, "recWAK"), undefined, "pris 3 fois sur 8 : médiane 0, pas proposé");
  assert.equal(qty(p, "recVAN"), undefined, "autre jour de semaine : ignoré");
  assert.equal(GW.median([1, 2, 3, 10]), 2.5); assert.equal(GW.median([]), 0);
});

test("commande probable : produits inactifs ou retirés exclus ; conditionnement entier ; repli et absence", async () => {
  const L = LATER;
  const hist = [1, 2, 3].map((k) => geleverd("recCLA", FB.addDays(L, -7 * k), [["Zalm", 3, "kg", 16], ["Oud artikel", 2, "caisse", 3], ["Verdwenen product", 5, "kg", 9], ["Eieren", 7, "pièce", 1]]));
  await seed({ orders: hist });
  const p = GW.probable(hist, await products(), L);
  assert.deepStrictEqual(p.items.map((i) => i.productId).sort(), ["recEI", "recZALM"], "inactif et inconnu exclus");
  assert.equal(qty(p, "recEI"), 6, "7 œufs → une doos de 6 (enkel per verpakking)");
  // Aucune livraison ce jour-là : la dernière commande du client, quel que soit le jour.
  const last = [geleverd("recCLA", FB.addDays(L, -2), [["Tonijn", 1, "kg", 27.5]]), rec("recOPEN", { Date: today, "Date livraison souhaitée": FB.addDays(L, -1), Statut: "Reçue", Client: ["recCLA"], [LINES]: "Zalm × 5 kg [€16.00]" })];
  const r = GW.probable(last, await products(), L);
  assert.equal(r.basis, "laatste"); assert.equal(r.n, 1); assert.equal(qty(r, "recZALM"), 5);
  assert.equal(GW.probable([], await products(), L), null, "aucune commande : pas de carte");
  assert.equal(GW.probable([rec("recX", { Statut: "Annulée", Client: ["recCLA"], "Date livraison souhaitée": today, [LINES]: "Zalm × 1 kg" })], await products(), L), null);
  // Uw vaste : au moins 2 fois dans les 10 dernières livraisons.
  assert.deepStrictEqual(GW.vaste(hist, await products()).sort(), ["recEI", "recZALM"]);
});

test("/api/orders : la carte est recalculée au prix du jour (prix négocié), avec la date de livraison du bandeau", async () => {
  const k = FB.klok(require(path.join(ROOT, "lib", "levering.js")).rulesFrom({ Besteldeadline: "22:00" }));
  const hist = [1, 2].map((w) => geleverd("recCLA", FB.addDays(k.levering, -7 * w), [["Zalm", 4, "kg", 12.34], ["Tonijn", 2, "kg", 1]]));
  hist.push(rec("recOPEN", { "Référence": "CMD-OPEN", Date: today, "Date livraison souhaitée": LATER, Statut: "Reçue", Client: ["recCLA"], [LINES]: "Zalm × 1 kg [€16.00]", Total: 16 }));
  hist.push(rec("recTODAY", { "Référence": "CMD-TODAY", Date: today, "Date livraison souhaitée": today, Statut: "Reçue", Client: ["recCLA"], [LINES]: "Zalm × 1 kg [€16.00]", Total: 16 }));
  await seed({ orders: hist });
  const r = await call("orders.js", {}, await klant("recCLA"));
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const g = r.payload.gewoonte;
  assert.equal(g.levering, k.levering); assert.equal(g.basis, "weekdag"); assert.equal(g.n, 2);
  const zalm = g.items.find((i) => i.productId === "recZALM"), ton = g.items.find((i) => i.productId === "recTON");
  assert.equal(zalm.prijs, 16, "prix négocié d'aujourd'hui, pas le prix figé de l'historique");
  assert.equal(ton.prijs, 29.9, "prix de base d'aujourd'hui");
  assert.equal(g.total, Math.round((4 * 16 + 2 * 29.9) * 100) / 100);
  assert.deepStrictEqual(r.payload.vaste.slice().sort(), ["recTON", "recZALM"]);
  assert.equal(r.payload.orders.find((o) => o.ref === "CMD-OPEN").aanpasbaar, true, "dans deux jours : modifiable");
  assert.equal(r.payload.orders.find((o) => o.ref === "CMD-TODAY").aanpasbaar, false, "livrée aujourd'hui : plus modifiable");
  // Un autre client ne voit rien de tout cela.
  const b = await call("orders.js", {}, await klant("recCLB"));
  assert.equal(b.payload.gewoonte, null); assert.equal(b.payload.orders.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
const OPEN = (extra) => rec("recOPEN", Object.assign({ "Référence": "CMD-2026-0100", Date: today, "Date livraison souhaitée": LATER, Statut: "Reçue", "Statut paiement": "En attente", Client: ["recCLA"], [LINES]: "Zalm × 4 kg [€16.00]\nTonijn × 2 kg [€29.90]", "Lignes JSON": JSON.stringify([{ productId: "recZALM", naam: "Zalm", qty: 4, unit: "kg", prijs: 16 }, { productId: "recTON", naam: "Tonijn", qty: 2, unit: "kg", prijs: 29.9 }]), Total: 123.8, Idempotentie: "cle-panier-eerste" }, extra || {}));

test("modifier sans annuler : lignes, total, journal Correcties ; le magasin revalide", async () => {
  await seed({ orders: [OPEN({ "Préparation validée": true })] });
  const kl = await klant("recCLA");
  const r = await call("klantorder.js", { action: "wijzig", ref: "CMD-2026-0100", items: [{ productId: "recZALM", quantity: 5 }, { productId: "recWAK", quantity: 2 }] }, kl);
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const f = await fieldsOf("Commandes", "recOPEN");
  assert.equal(f.Statut, "Reçue", "pas d'annulation");
  assert.equal(f[LINES], "Zalm × 5 kg [€16.00]\nWAKAME 500G × 2 pièce [€6.50]");
  assert.equal(f["Lignes besteld"], f[LINES], "la dernière version du client");
  assert.equal(f.Total, 93);
  assert.ok(!f["Préparation validée"], "case décochée (absente = faux)");
  assert.match(f.Correcties, /Gewijzigd door klant · klant — .*Zalm 4 → 5 kg/);
  assert.match(f.Correcties, /\+ WAKAME 500G 2 pièce/); assert.match(f.Correcties, /− Tonijn/);
  assert.deepStrictEqual(r.payload.vorige.map((i) => [i.productId, i.quantity]), [["recZALM", 4], ["recTON", 2]], "de quoi annuler");
  // « Ongedaan maken » : les lignes d'avant, renvoyées telles quelles.
  const u = await call("klantorder.js", { action: "wijzig", ref: "CMD-2026-0100", items: r.payload.vorige }, kl);
  assert.equal(u.statusCode, 200);
  assert.equal((await fieldsOf("Commandes", "recOPEN"))[LINES], "Zalm × 4 kg [€16.00]\nTonijn × 2 kg [€29.90]");
  // Le serveur décide : produit inactif, quantité impossible, conditionnement, liste vide.
  for (const items of [[{ productId: "recOUD", quantity: 1 }], [{ productId: "recZALM", quantity: -1 }], [{ productId: "recEI", quantity: 7 }], []]) {
    const bad = await call("klantorder.js", { action: "wijzig", ref: "CMD-2026-0100", items }, kl);
    assert.equal(bad.statusCode, 400, JSON.stringify(items));
  }
  assert.equal((await fieldsOf("Commandes", "recOPEN")).Total, 123.8, "rien écrit sur un refus");
});

test("modifier : refusé après l'heure limite, hors « Reçue », pour la commande d'un autre ; minimum respecté", async () => {
  await seed({ orders: [OPEN({ "Date livraison souhaitée": today })] });
  const kl = await klant("recCLA");
  const items = [{ productId: "recZALM", quantity: 1 }];
  let r = await call("klantorder.js", { action: "wijzig", ref: "CMD-2026-0100", items }, kl);
  assert.equal(r.statusCode, 409); assert.match(r.payload.error, /Wijzigen kan tot 22:00/);
  for (const st of ["Prête", "Sortie en livraison", "Facturée", "Annulée"]) {
    await seed({ orders: [OPEN({ Statut: st })] });
    r = await call("klantorder.js", { action: "wijzig", ref: "CMD-2026-0100", items }, await klant("recCLA"));
    assert.equal(r.statusCode, 409, st);
  }
  await seed({ orders: [OPEN({ Test: true })] });
  assert.equal((await call("klantorder.js", { action: "wijzig", ref: "CMD-2026-0100", items }, await klant("recCLA"))).statusCode, 404, "commande d'essai : introuvable");
  await seed({ orders: [OPEN()] });
  assert.equal((await call("klantorder.js", { action: "wijzig", ref: "CMD-2026-0100", items }, await klant("recCLB"))).statusCode, 404, "jamais la commande d'un autre");
  await seed({ orders: [OPEN()], conf: { "Minimum bestelling": 50 } });
  r = await call("klantorder.js", { action: "wijzig", ref: "CMD-2026-0100", items }, await klant("recCLA"));
  assert.equal(r.statusCode, 400); assert.match(r.payload.error, /Minimum bestelling/);
  // Le magasin a « klaargezet » entre la lecture et l'écriture : relu, refusé.
  await seed({ orders: [OPEN()] });
  const KW = require(path.join(ROOT, "lib", "klantwijziging.js"));
  const found = await require(path.join(ROOT, "api", "klantorder.js")).findOwnOrder({ id: "recCLA" }, "CMD-2026-0100");
  const cur = await store().get("Commandes", "recOPEN");
  assert.ok(await store().update("Commandes", "recOPEN", Object.assign({}, cur.fields, { Statut: "Prête" }), cur.version));
  const late = await KW.apply({ id: "recCLA" }, found, items, require(path.join(ROOT, "lib", "levering.js")).rulesFrom({}), {});
  assert.equal(late.status, 409);
});

test("2e commande pour le même jour : elle s'ajoute à la première (pas de doublon, pas de question)", async () => {
  await seed({ orders: [OPEN()], conf: { "Minimum bestelling": 50 } });
  const kl = await klant("recCLA");
  const body = (key, items) => ({ items, dateLivraison: LATER, idempotencyKey: key, notes: "Graag in filets" });
  // Petit ajout sous le minimum : accepté, le minimum vaut pour la commande complétée.
  const r = await call("order.js", body("cle-panier-tweede", [{ productId: "recZALM", quantity: 1 }, { productId: "recWAK", quantity: 1 }]), kl);
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.samengevoegd, true); assert.equal(r.payload.ref, "CMD-2026-0100"); assert.equal(r.payload.toegevoegd, 2);
  const all = await store().list("Commandes");
  assert.equal(all.length, 1, "aucune nouvelle commande");
  const f = all[0].fields;
  assert.equal(f[LINES], "Zalm × 5 kg [€16.00]\nTonijn × 2 kg [€29.90]\nWAKAME 500G × 1 pièce [€6.50]", "mêmes articles additionnés, nouveaux ajoutés");
  assert.equal(f.Total, 146.3);
  assert.match(f.Correcties, /Aangevuld door klant · klant — Zalm 4 → 5 kg · \+ WAKAME 500G 1 pièce/);
  assert.equal(f.Notes, "Graag in filets");
  // Même panier renvoyé (réseau mobile) : rien n'est ajouté une seconde fois.
  const again = await call("order.js", body("cle-panier-tweede", [{ productId: "recZALM", quantity: 1 }]), kl);
  assert.equal(again.statusCode, 200); assert.equal(again.payload.duplicate, true);
  assert.equal((await fieldsOf("Commandes", "recOPEN")).Total, 146.3);
  // Un autre jour : une nouvelle commande, comme avant.
  let other = FB.addDays(LATER, 1); while (new Date(other + "T12:00:00Z").getUTCDay() === 0) other = FB.addDays(other, 1);
  const o = await call("order.js", { items: [{ productId: "recTON", quantity: 2 }], dateLivraison: other, idempotencyKey: "cle-panier-derde" }, kl);
  assert.equal(o.statusCode, 200, JSON.stringify(o.payload)); assert.ok(!o.payload.samengevoegd);
  assert.equal((await store().list("Commandes")).length, 2);
  // La commande d'un autre client n'est jamais complétée.
  const b = await call("order.js", { items: [{ productId: "recTON", quantity: 2 }], dateLivraison: LATER, idempotencyKey: "cle-panier-kaai1" }, await klant("recCLB"));
  assert.equal(b.statusCode, 200); assert.ok(!b.payload.samengevoegd);
});

test("2e commande : commande du jour déjà « Klaar » → nouvelle commande ; le personnel voit la commande complétée", async () => {
  await seed({ orders: [OPEN({ Statut: "Prête" })] });
  const r = await call("order.js", { items: [{ productId: "recZALM", quantity: 1 }], dateLivraison: LATER, idempotencyKey: "cle-panier-klaar1" }, await klant("recCLA"));
  assert.equal(r.statusCode, 200); assert.ok(!r.payload.samengevoegd);
  assert.equal((await store().list("Commandes")).length, 2);
  await seed({ orders: [OPEN()] });
  await call("order.js", { items: [{ productId: "recWAK", quantity: 3 }], dateLivraison: LATER, idempotencyKey: "cle-panier-team01" }, await klant("recCLA"));
  const all = await call("allorders.js", null, staff);
  const o = (all.payload.orders || []).find((x) => x.id === "recOPEN");
  assert.ok(o && /WAKAME 500G × 3/.test(o.lignes), "Bestellingen / Magazijn lisent la commande complétée");
});

// ---------------------------------------------------------------------------------------------------------------
// Bandeau de l'heure (heure de Bruxelles, indépendante du fuseau de l'appareil).
const at = (iso, hhmm) => { // instant UTC qui correspond à iso hhmm à Bruxelles
  for (const off of [1, 2]) { const d = new Date(iso + "T" + hhmm + ":00Z"); d.setUTCHours(d.getUTCHours() - off); const b = FB.brussel(d); if (b.iso === iso && b.min === Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) return d; }
  throw new Error("heure introuvable");
};
const RULES = { deadline: "22:00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [] };

test("bandeau : temps restant, jour livré, ambre la dernière demi-heure, jauge", () => {
  // Mercredi 21/10/2026 20:48 → livré jeudi 22/10, encore 1 u 12.
  let k = FB.klok(RULES, at("2026-10-21", "20:48"));
  assert.equal(k.levering, "2026-10-22"); assert.equal(k.minuten, 72); assert.equal(k.amber, false);
  assert.deepStrictEqual(FB.klokTekst(k, "nl"), { rest: "Nog 1 u 12", levering: "geleverd do 22/10", tot: "tot 22:00", dag: "do 22/10" });
  assert.deepStrictEqual(FB.klokTekst(k, "fr"), { rest: "Encore 1 h 12", levering: "livré jeu 22/10", tot: "jusqu'à 22:00", dag: "jeu 22/10" });
  assert.equal(Math.round(k.vulling * 100), 15, "72 min sur 8 h");
  k = FB.klok(RULES, at("2026-10-21", "21:35"));
  assert.equal(k.amber, true); assert.equal(FB.klokTekst(k, "nl").rest, "Nog 25 min");
  assert.equal(FB.klok(RULES, at("2026-10-21", "21:29")).amber, false, "ambre à partir de 30 minutes");
  assert.equal(FB.klok(RULES, at("2026-10-21", "09:00")).vulling, 1, "pleine le matin");
  // Rien n'est inventé : sans « Levervenster », aucune heure de livraison.
  assert.ok(!/tussen/.test(FB.klokTekst(FB.klok(RULES, at("2026-10-21", "20:00")), "nl").levering));
  // Emplacement prévu (futur réglage) : « tussen 6 en 8 u » seulement s'il est fourni.
  const v = FB.klokTekst(FB.klok(Object.assign({ levervenster: "06:00-08:30" }, RULES), at("2026-10-21", "20:00")), "nl");
  assert.equal(v.levering, "geleverd do 22/10 tussen 6 en 8:30 u");
  assert.equal(FB.venster("08:00-06:00"), null); assert.equal(FB.venster("6-8"), null);
});

test("bandeau : après l'heure limite, jour suivant ; dimanche et jours fermés sautés ; règles du serveur", () => {
  // Mercredi 22:00 pile : trop tard pour jeudi → vendredi, heure limite jeudi 22:00.
  let k = FB.klok(RULES, at("2026-10-21", "22:00"));
  assert.equal(k.levering, "2026-10-23"); assert.equal(k.deadlineDag, "2026-10-22"); assert.equal(k.minuten, 24 * 60);
  assert.equal(FB.klokTekst(k, "nl").rest, "Bestellen tot do 22/10 22:00");
  assert.equal(FB.klokTekst(k, "nl").tot, "tot do 22/10 22:00");
  k = FB.klok(RULES, at("2026-10-21", "23:30"));
  assert.equal(k.levering, "2026-10-23"); assert.equal(FB.klokTekst(k, "nl").rest, "Nog 22 u 30");
  // Samedi 20:00 : dimanche non livré → lundi ; on peut encore commander dimanche jusqu'à 22:00.
  k = FB.klok(RULES, at("2026-10-24", "20:00"));
  assert.equal(k.levering, "2026-10-26"); assert.equal(k.deadlineDag, "2026-10-25"); assert.equal(k.minuten, 26 * 60);
  // Lundi fermé (jour férié) : mardi, heure limite lundi 22:00.
  k = FB.klok(Object.assign({}, RULES, { geslotenDagen: ["2026-10-26"] }), at("2026-10-25", "18:00"));
  assert.equal(k.levering, "2026-10-27"); assert.equal(k.deadlineDag, "2026-10-26");
  // Heure limite configurée (21:30) et règles au format serveur (lib/levering.js rulesFrom).
  const srv = require(path.join(ROOT, "lib", "levering.js")).rulesFrom({ Besteldeadline: "21:30", Leverdagen: "di,do" });
  k = FB.klok(srv, at("2026-10-21", "21:00"));
  assert.equal(k.levering, "2026-10-22"); assert.equal(k.minuten, 30); assert.equal(k.amber, true);
  assert.equal(FB.klok(srv, at("2026-10-21", "21:31")).levering, "2026-10-27", "jeudi trop tard → mardi suivant");
  // Même règle que K.orderWindow et lib/levering.checkCutoff : le jour annoncé est accepté par le serveur.
  const lev = require(path.join(ROOT, "lib", "levering.js"));
  const live = FB.klok(lev.rulesFrom({}));
  assert.equal(lev.checkDate(live.levering, lev.rulesFrom({})), "");
  assert.equal(lev.checkCutoff(live.levering, lev.rulesFrom({})), "");
});

test("catalogue : groupes métier, casse normale, plaques, « Rauw OK » seulement avec un traitement choisi", () => {
  const g = (nom, cat) => FB.groep({ nom, cat });
  assert.equal(g("BLACK TIGER GARNALEN 8-12", "Algemeen"), "garnalen");
  assert.equal(g("Crevettes grises", "Crustacés"), "garnalen");
  assert.equal(g("INKTVIS TUBES U5", "Algemeen"), "inktvis");
  assert.equal(g("KREEFTENSTAARTEN 150-200", "Algemeen"), "schaaldieren");
  assert.equal(g("Moules (caisse)", "Coquillages"), "schelpdieren");
  assert.equal(g("MOSSELVLEES 1KG", "Algemeen"), "schelpdieren");
  assert.equal(g("Saumon frais", "Poisson"), "vis");
  assert.equal(g("Zeebaars heel 400-600", "Poisson"), "vis");
  assert.equal(g("VEGGIE GARNALEN 1KG", "Vegetarisch"), "overig", "végétarien : jamais dans les crevettes");
  assert.equal(g("SURIMI SNOW CRAB 500G", "Surimi"), "overig");
  assert.equal(g("Eieren", "Algemeen"), "overig");
  assert.equal(g("Iets onbekends", ""), "overig");
  assert.equal(FB.naam("BLACK TIGER GARNALEN 8-12"), "Black tiger garnalen 8-12");
  assert.equal(FB.naam("VANNAMEI GARNALEN 16-20 EP"), "Vannamei garnalen 16-20 EP");
  assert.equal(FB.naam("INKTVIS TUBES U5"), "Inktvis tubes U5");
  assert.equal(FB.naam("ZEEWIERSALADE 1KG"), "Zeewiersalade 1 kg", "spec 038 : poids collé détaché, unité en minuscules");
  assert.equal(FB.naam("Oesters Zeeuwse creuse nr. 3"), "Oesters Zeeuwse creuse nr. 3", "casse mixte : intacte");
  assert.equal(FB.naam("<b>EVIL</b>"), "<b>EVIL</b>", "rien d'interprété (l'échappement se fait à l'affichage)");
  assert.equal(FB.soort({ nom: "Saumon frais" }), "zalm"); assert.equal(FB.soort({ nom: "BLACK TIGER GARNALEN 8-12" }), "tiger");
  assert.equal(FB.soort({ nom: "INKTVIS RINGEN 1KG" }), "inktvis"); assert.equal(FB.soort({ nom: "INKTVIS TUBES U5" }), "tube");
  assert.equal(FB.soort({ nom: "Cabillaud" }), "vis");
  assert.equal(FB.rauwOk({ rauw: true, vriesbehandeling: "-20 °C 24 h" }), true);
  assert.equal(FB.rauwOk({ rauw: true, vriesbehandeling: "-35 °C 15 h" }), true);
  assert.equal(FB.rauwOk({ rauw: true, vriesbehandeling: "Niet van toepassing" }), false, "pas de barème : pas de badge");
  assert.equal(FB.rauwOk({ rauw: true }), false); assert.equal(FB.rauwOk({ vriesbehandeling: "-20 °C 24 h" }), false); assert.equal(FB.rauwOk(null), false);
  assert.equal(FB.stap({ unite: "kg" }), 0.5); assert.equal(FB.stap({ unite: "pièce", per: 6, enkel: true }), 6); assert.equal(FB.stap({ unite: "pièce", per: 12 }), 1);
  assert.equal(FB.weekdag("2026-10-26", "nl"), "maandag"); assert.equal(FB.weekdag("2026-10-26", "fr"), "lundi");
});
