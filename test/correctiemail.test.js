"use strict";
// « Correctie mailen » (L-08) : après une correction de lignes / prix ou une note de crédit, le
// personnel renvoie au client un e-mail qui résume ce qui a changé (avant → après, nouveau total).
// SQLite en mémoire ; Resend simulé (fetch) : jamais d'appel réseau réel, jamais de vraie clé.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
process.env.RESEND_API_KEY = "test-cle-factice"; // lib/mail.js la lit au chargement ; fetch est simulé
process.env.PORTAL_URL = "https://portaal.famo.test";

// Resend simulé AVANT lib/datastore.js : les requêtes vers l'API d'e-mail arrivent ici,
// celles vers la base restent servies par le moteur SQL.
const sent = [];
let failNext = 0;
global.fetch = async (url, opts) => {
  if (!/api\.resend\.com/.test(String(url))) throw new Error("appel réseau inattendu : " + url);
  const body = JSON.parse(opts.body);
  if (failNext > 0) { failNext--; return { status: 500, text: async () => "boom", json: async () => ({}) }; }
  sent.push({ body, key: opts.headers["Idempotency-Key"] });
  return { status: 200, json: async () => ({ id: "mail-" + sent.length }) };
};

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const om = require(path.join(ROOT, "lib", "ordermail.js"));
const corr = require(path.join(ROOT, "lib", "correctie.js"));

const YEAR = auth.brusselsYear();
const H = { host: "portaal.famo.test", origin: "https://portaal.famo.test", "content-type": "application/json" };
const cookie = (role) => Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) }, H);
function mkRes() { return { statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } }; }
async function call(file, body, opts) {
  const res = mkRes();
  await require(path.join(ROOT, "api", file))({ method: "POST", body, headers: (opts && opts.headers) || cookie("staff"), query: {} }, res);
  return res;
}
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const fieldsOf = async (id) => (await store().get("Commandes", id)).fields;
const mailen = (id, role) => call("updateorder.js", { id, correctieMail: true }, { headers: cookie(role || "staff") });

async function seed(orders, clientExtra) {
  await store().replaceAll("Configuratie", [rec("recCONF", { Bedrijfsnaam: "FAMO Seafood", "E-mail": "info@famo.test", "Bestellingen e-mail": "ops@famo.test", "BTW-tarief": 6, Facturatie: "Portaal" })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Zalm", "Prix de base": 12.5, "Unité": "kg", Actif: true, "BTW-tarief": 6 }), rec("recP2", { Produit: "Saus", "Prix de base": 5, "Unité": "pièce", Actif: true, "BTW-tarief": 21 }), rec("recP3", { Produit: "Tong", "Prix de base": 20, "Unité": "kg", Actif: true })]);
  await store().replaceAll("Clients", [rec("recCLA", Object.assign({ Nom: "Resto A", Email: "chef@resto.test", Taal: "NL" }, clientExtra || {}))]);
  await store().replaceAll("Commandes", orders || []);
  await store().replaceAll("Compteurs", []);
  sent.length = 0; failNext = 0;
}
const LINES = "Zalm × 2 kg [€12.50]\nSaus × 3 pièce [€5.00]";
const ORDER = (id, extra) => rec(id, Object.assign({ "Référence": "CMD-" + YEAR + "-0042", Date: new Date().toISOString().slice(0, 10), Statut: "Reçue", Client: ["recCLA"], "Lignes (produits / quantités)": LINES, "Lignes besteld": LINES, Total: 40, "Statut paiement": "En attente" }, extra || {}));

const base = {
  ref: "CMD-2026-0042", recordId: "recORD0001", company: { bedrijfsnaam: "FAMO Seafood", email: "info@famo.test", telefoon: "03 111" }, opsEmail: "ops@famo.test",
  klant: { nom: "Resto <b>A</b>", email: "chef@resto.test", taal: "NL" }, portalUrl: "https://portaal.famo.test", orderUrl: "https://portaal.famo.test/order.html?id=recORD0001",
  wijzigingen: [{ name: "Zalm", unit: "kg", voor: { qty: 2, price: 12.5 }, na: { qty: 1.5, price: 12.5 } }, { name: "Saus", unit: "pièce", voor: { qty: 3, price: 5 }, na: null }, { name: "Tong", unit: "kg", voor: null, na: { qty: 1, price: 20 } }],
  totalExcl: 38.75, totalIncl: 41.08, creditnotas: [], sleutel: "abc123"
};

test("lib/correctie : avant = lignes commandées (ou dernier mail), après = lignes actuelles + nouvelles notes", () => {
  const f = { "Lignes besteld": LINES, "Lignes (produits / quantités)": "Zalm × 1.5 kg [€12.50]\nSaus × 3 pièce [€5.00]\nTong × 1 kg [€20.00]" };
  const c = corr.changes(f);
  assert.equal(c.changed, true);
  assert.deepStrictEqual(c.wijzigingen.map((w) => [w.name, w.voor && w.voor.qty, w.na && w.na.qty]), [["Zalm", 2, 1.5], ["Tong", null, 1]]);
  assert.deepStrictEqual(corr.changes({ "Lignes besteld": LINES, "Lignes (produits / quantités)": LINES }).changed, false);
  // Prix changé (remise du beheerder) : aussi une correction.
  assert.equal(corr.changes({ "Lignes besteld": LINES, "Lignes (produits / quantités)": "Zalm × 2 kg [€10.00]\nSaus × 3 pièce [€5.00]" }).wijzigingen[0].na.price, 10);
  // Après un mail : la référence devient l'état envoyé.
  const snap = corr.snapshot(f, "2026-09-30T10:00:00.000Z");
  assert.equal(corr.changes(Object.assign({}, f, { Correctiemail: JSON.stringify(snap) })).changed, false);
  // Nouvelle note de crédit : correction même si les lignes n'ont pas bougé.
  const g = Object.assign({}, f, { Correctiemail: JSON.stringify(snap), "Creditnota nummer": "CN-2026-0001", "Creditnota lignes": "Tong × 1 kg [€20.00]", "Creditnota montant": 20, "Creditnota le": "2026-09-30T11:00:00.000Z", "Creditnota motif": "kapot" });
  const cg = corr.changes(g);
  assert.equal(cg.changed, true); assert.deepStrictEqual(cg.nieuweCreditnotas.map((n) => n.nummer), ["CN-2026-0001"]); assert.equal(cg.wijzigingen.length, 0);
  assert.notEqual(corr.snapshot(g, "x").sleutel, snap.sleutel, "la clé suit l'état envoyé");
  // Sans « Lignes besteld » (anciennes commandes) : rien à comparer, pas de correction inventée.
  assert.equal(corr.changes({ "Lignes (produits / quantités)": LINES }).changed, false);
});

test("buildCorrectionMail (NL) : avant → après, nouveau total, lien portail client, rien d'interne", () => {
  const m = om.buildCorrectionMail(base);
  assert.equal(m.to, "chef@resto.test"); assert.equal(m.replyTo, "info@famo.test");
  assert.equal(m.subject, "Correctie van uw bestelling CMD-2026-0042");
  assert.equal(m.idempotencyKey, "correctie:recORD0001:abc123");
  for (const s of ["Uw bestelling werd aangepast", "Zalm", "2 kg", "1,5 kg", "geschrapt", "nieuw", "€ 38,75", "€ 41,08", "https://portaal.famo.test/klant.html#/bestellingen"]) assert.ok(m.html.includes(s), "html contient " + s);
  assert.ok(!m.html.includes("<b>A</b>"), "nom échappé");
  assert.ok(!m.html.includes("ops@famo.test") && !m.html.includes("order.html"), "ni boîte interne ni lien du personnel");
  assert.match(m.text, /Zalm: 2 kg → 1,5 kg/); assert.match(m.text, /Nieuw totaal incl\. btw: € 41,08/);
  assert.ok(!/<style|display\s*:\s*flex/i.test(m.html));
});

test("buildCorrectionMail (FR) et notes de crédit ; copie interne NL avec /order.html?id=", () => {
  const ctx = Object.assign({}, base, { klant: { nom: "Resto", email: "chef@resto.test", taal: "FR" }, facturatie: "portaal", wijzigingen: [], creditnotas: [{ nummer: "CN-2026-0003", montantIncl: 21.2, motif: "abîmé" }], netIncl: 19.88 });
  const m = om.buildCorrectionMail(ctx);
  assert.equal(m.subject, "Correction de votre commande CMD-2026-0042");
  assert.match(m.html, /lang="fr"/); assert.match(m.text, /Note de crédit CN-2026-0003/); assert.match(m.text, /-21,20\s€/); assert.match(m.text, /19,88\s€/);
  assert.ok(!/Uw bestelling|Totaal/.test(m.text), "aucun texte NL");
  // Mode boekhouder : pas de numéro CN du portail (la note légale vient du comptable).
  const b = om.buildCorrectionMail(Object.assign({}, ctx, { facturatie: "boekhouder" }));
  assert.ok(!b.text.includes("CN-2026-0003")); assert.match(b.text, /Peppol/);
  const t = om.buildCorrectionTeamMail(ctx);
  assert.equal(t.to, "ops@famo.test"); assert.equal(t.replyTo, "chef@resto.test");
  assert.match(t.subject, /^Correctiemail verstuurd — CMD-2026-0042/);
  assert.match(t.html, /\/order\.html\?id=recORD0001/); assert.match(t.text, /\/order\.html\?id=recORD0001/);
  assert.match(t.text, /CN-2026-0003/);
  assert.equal(t.idempotencyKey, "correctie:recORD0001:abc123:team");
});

test("lignes corrigées par le magasin → « Correctie mailen » : un e-mail client + copie interne, journal, pas de doublon", async () => {
  await seed([ORDER("recORD0001")]);
  let r = await mailen("recORD0001");
  assert.equal(r.statusCode, 409, "rien n'a changé depuis la confirmation"); assert.match(r.payload.error, /Niets gewijzigd/);
  assert.equal(sent.length, 0);
  r = await call("updateorder.js", { id: "recORD0001", lignes: "Zalm × 1.5 kg\nSaus × 3 pièce" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  r = await mailen("recORD0001");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.mail.ok, true);
  assert.equal(sent.length, 2, "client + boîte interne");
  const client = sent.find((m) => m.body.to[0] === "chef@resto.test"), team = sent.find((m) => m.body.to[0] === "ops@famo.test");
  assert.match(client.body.subject, /Correctie van uw bestelling CMD-/);
  assert.match(client.body.text, /Zalm: 2 kg → 1,5 kg/);
  assert.match(client.body.text, /Nieuw totaal excl\. btw: € 33,75/);
  assert.match(client.body.text, /Nieuw totaal incl\. btw: € 38,03/, "6 % sur le poisson, 21 % sur la sauce");
  assert.match(team.body.html, /\/order\.html\?id=recORD0001/);
  assert.ok(client.key && client.key.startsWith("correctie:recORD0001:"), "clé d'idempotence Resend");
  const f = await fieldsOf("recORD0001");
  assert.match(f.Correcties, /Correctiemail verstuurd aan klant \(Zalm\) · personeel$/, "sans l'adresse : le journal survit à l'anonymisation");
  assert.equal(JSON.parse(f.Correctiemail).lignes, f["Lignes (produits / quantités)"]);
  // Double clic : rien de neuf à envoyer.
  r = await mailen("recORD0001");
  assert.equal(r.statusCode, 409); assert.equal(sent.length, 2);
  // Journal d'audit (moteur SQL).
  const j = (await store().list("Journaal")).map((x) => x.fields).filter((x) => x.Record === "recORD0001");
  assert.ok(j.some((x) => x.Actie === "Correctiemail"), JSON.stringify(j.map((x) => x.Actie)));
});

test("deux clics simultanés sur deux instances : un seul envoi", async () => {
  await seed([ORDER("recORD0002", { "Lignes (produits / quantités)": "Zalm × 1 kg [€12.50]\nSaus × 3 pièce [€5.00]", Total: 27.5 })]);
  // Instance neuve : le point d'entrée ET ses modules lib/commande/ (A6, specs/010) rechargés.
  const inst = () => { const p = path.join(ROOT, "api", "updateorder.js"); delete require.cache[require.resolve(p)]; Object.keys(require.cache).filter((k) => k.startsWith(path.join(ROOT, "lib", "commande") + path.sep)).forEach((k) => { delete require.cache[k]; }); return require(p); };
  const go = async (h) => { const res = mkRes(); await h({ method: "POST", body: { id: "recORD0002", correctieMail: true }, headers: cookie("staff"), query: {} }, res); return res; };
  const [a, b] = await Promise.all([go(inst()), go(inst())]);
  assert.deepStrictEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  assert.equal(sent.filter((m) => m.body.to[0] === "chef@resto.test").length, 1);
});

test("après une note de crédit : correction mailée avec la note et le solde ; envoi raté → rien réservé", async () => {
  const facture = { Statut: "Facturée", Factuurnummer: "FA-" + YEAR + "-0042", "Facturée le": new Date().toISOString(), "Livraison confirmée": true, "BTW per lijn": JSON.stringify({ zalm: 6, saus: 21 }) };
  await seed([ORDER("recORD0003", facture)], { Taal: "FR" });
  const cn = await call("updateorder.js", { id: "recORD0003", creditnota: { lignes: "Saus × 1", motif: "abîmé" } }, { headers: cookie("admin") });
  assert.equal(cn.statusCode, 200, JSON.stringify(cn.payload));
  failNext = 1;
  let r = await mailen("recORD0003");
  assert.equal(r.statusCode, 502, JSON.stringify(r.payload)); assert.match(r.payload.error, /niet verstuurd/);
  let f = await fieldsOf("recORD0003");
  assert.equal(f.Correctiemail, undefined, "réservation libérée : on peut réessayer");
  assert.doesNotMatch(f.Correcties, /Correctiemail verstuurd/);
  r = await mailen("recORD0003");
  assert.equal(r.statusCode, 200, JSON.stringify(r.payload));
  const client = sent.find((m) => m.body.to[0] === "chef@resto.test");
  assert.match(client.body.subject, /^Correction de votre commande/);
  assert.match(client.body.text, new RegExp("Note de crédit CN-" + YEAR + "-0001"));
  assert.match(client.body.text, /-6,05\s€/, "5 € + 21 % TVA");
  f = await fieldsOf("recORD0003");
  assert.deepStrictEqual(JSON.parse(f.Correctiemail).cn, ["CN-" + YEAR + "-0001"]);
  assert.equal((await mailen("recORD0003")).statusCode, 409, "même note : déjà mailée");
});

test("client sans e-mail, commande annulée, sans session", async () => {
  await seed([ORDER("recORD0004", { "Lignes (produits / quantités)": "Zalm × 1 kg [€12.50]", Total: 12.5 }), ORDER("recORD0005", { Statut: "Annulée", "Lignes (produits / quantités)": "Zalm × 1 kg [€12.50]" })], { Email: "" });
  let r = await mailen("recORD0004");
  assert.equal(r.statusCode, 200); assert.equal(r.payload.mail.skipped, "no-recipient"); assert.equal(sent.length, 0);
  assert.equal((await fieldsOf("recORD0004")).Correctiemail, undefined);
  r = await mailen("recORD0005");
  assert.equal(r.statusCode, 409);
  r = await call("updateorder.js", { id: "recORD0004", correctieMail: true }, { headers: H });
  assert.equal(r.statusCode, 401);
});
