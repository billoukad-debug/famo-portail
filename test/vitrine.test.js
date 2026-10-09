"use strict";
// Vitrine publique « Ons aanbod » (specs/027) : pages rendues par le serveur, indexables, sans aucune donnée privée.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
delete process.env.VERCEL_ENV;
process.removeAllListeners("warning");
global.fetch = async (u) => { throw new Error("Réseau interdit : " + u); };
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const V = require(path.join(ROOT, "lib", "vitrine.js"));
const rec = (id, fields) => ({ id, createdTime: "2026-01-01T00:00:00.000Z", fields });

function mkRes() {
  return { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; }, json(p) { this.body = JSON.stringify(p); return this; }, send(b) { this.body = String(b); return this; }, end(b) { if (b) this.body = String(b); return this; } };
}
async function get(query) {
  const res = mkRes();
  await require(path.join(ROOT, "api", "vitrine.js"))({ method: "GET", headers: { host: "www.famoseafood.be" }, query }, res);
  return res;
}

async function seed() {
  const st = ds.state.store;
  await st.replaceAll("Catalogue", [
    rec("recP1", { Produit: "Black Tiger", Kaliber: "16/20", "Catégorie": "Garnalen", "Unité": "kg", "Prix de base": 18.5, Omschrijving: "Rauw, gepeld <b>HOSO</b>", Actif: true, Volgorde: 1 }),
    rec("recP2", { Produit: "Black Tiger", Kaliber: "16/20", "Catégorie": "Garnalen", "Unité": "kg", "Prix de base": 17, Actif: true, Volgorde: 2 }),
    rec("recP3", { Produit: "Zalm <script>alert(1)</script>", "Catégorie": "Vis", "Unité": "pièce", "Prix de base": 0, Actif: true }),
    rec("recP4", { Produit: "Oud product", "Catégorie": "Vis", "Unité": "kg", "Prix de base": 9, Actif: false }),
    rec("recP5", { Produit: "Eieren", "Catégorie": "Overig", "Unité": "pièce", "Prix de base": 1, "Per verpakking": 6, Verpakking: "doos", Actif: true })
  ]);
  await st.replaceAll("Prix négociés", [rec("recN1", { Client: ["recC1"], Produit: ["recP1"], "Prix négocié": 11.11 })]);
  await st.replaceAll("Stock", [rec("recS1", { Produit: "Black Tiger", "Quantité disponible": 4321 })]);
  await st.replaceAll("Clients", [rec("recC1", { Nom: "Geheim Restaurant" })]);
  await st.replaceAll("Configuratie", [rec("recCfg", { Bedrijfsnaam: "Famo Trading BV", Adres: "Kaai 1", "Postcode en plaats": "2000 Antwerpen", Telefoon: "03 000 00 00", "E-mail": "info@famo.test", IBAN: "BE68539007547034", "Bestellingen e-mail": "intern@famo.test" })]);
}

test("slugs stables : nom + calibre, collision suffixée dans l'ordre des id", () => {
  assert.equal(V.slugify("Black Tiger 16/20"), "black-tiger-16-20");
  assert.equal(V.slugify("Crevettes grises — Ostende"), "crevettes-grises-ostende");
  const list = V.products([rec("recB", { Produit: "A", Actif: true }), rec("recA", { Produit: "A", Actif: true }), rec("recC", { Produit: "B", Actif: false })]);
  assert.deepEqual(list.map(p => [p.id, p.slug]), [["recA", "a"], ["recB", "a-2"]]);
});

test("prix « vanaf » : prix de base HTVA par unité, sinon prix sur demande", () => {
  assert.equal(V.priceText({ base: 18.5, unite: "kg" }, "nl"), "vanaf € 18,50 / kg excl. btw");
  assert.equal(V.priceText({ base: 1, unite: "pièce" }, "fr"), "à partir de € 1,00 / pièce HTVA");
  assert.equal(V.priceText({ base: 0, unite: "kg" }, "nl"), "Prijs op aanvraag");
  assert.equal(V.priceText({ base: 0, unite: "kg" }, "fr"), "Prix sur demande");
});

test("/aanbod : tout le catalogue actif, aucun prix négocié, aucun stock, aucune donnée privée, tout échappé", async () => {
  await seed();
  const r = await get({ p: "aanbod" });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.headers["cache-control"], /s-maxage=600/);
  const h = r.body;
  assert.match(h, /Black Tiger/); assert.match(h, /16\/20/); assert.match(h, /vanaf € 18,50 \/ kg excl\. btw/);
  assert.match(h, /href="\/aanbod\/black-tiger-16-20-2"/);
  assert.match(h, /Prijs op aanvraag/);
  assert.match(h, /href="\/aanvraag"/);
  assert.doesNotMatch(h, /Oud product/, "produit inactif absent");
  assert.doesNotMatch(h, /11,11|11\.11/, "prix négocié jamais publié");
  assert.doesNotMatch(h, /4321/, "stock jamais publié");
  assert.doesNotMatch(h, /Geheim Restaurant|BE68539007547034|intern@famo\.test/, "aucune donnée privée");
  assert.doesNotMatch(h, /<script>alert/, "nom échappé");
  assert.doesNotMatch(h, /<b>HOSO<\/b>/);
  assert.doesNotMatch(h, /style="/, "aucun style inline (CSP, spec 017)");
  assert.doesNotMatch(h, /<script(?! type="application\/ld\+json")/, "aucun script exécutable");
  assert.doesNotMatch(h, /noindex/);
  assert.match(h, /<link rel="canonical" href="https:\/\/www\.famoseafood\.be\/aanbod">/);
  assert.match(h, /hreflang="fr"/);
  assert.match(h, /Famo Trading BV/); assert.match(h, /2000 Antwerpen/);
});

test("/aanbod/<slug> : fiche produit avec données structurées Product, et FR", async () => {
  await seed();
  const r = await get({ p: "product", slug: "black-tiger-16-20" });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /<h1[^>]*>Black Tiger/);
  assert.match(r.body, /Rauw, gepeld &lt;b&gt;HOSO&lt;\/b&gt;/);
  const ld = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(r.body);
  assert.ok(ld, "JSON-LD présent");
  const j = JSON.parse(ld[1]);
  assert.equal(j["@type"], "Product"); assert.equal(j.offers.price, "18.50"); assert.equal(j.offers.priceCurrency, "EUR");
  const fr = await get({ p: "product", slug: "eieren", taal: "fr" });
  assert.equal(fr.statusCode, 200);
  assert.match(fr.body, /<html lang="fr">/);
  assert.match(fr.body, /Devenir client/);
  assert.match(fr.body, /carton de 6/);
  const x = await get({ p: "product", slug: "zalm-script-alert-1-script" });
  assert.equal(x.statusCode, 200);
  assert.doesNotMatch(x.body, /<script>alert/);
  assert.doesNotMatch(x.body, /"offers"/, "pas d'offre sans prix");
});

test("produit inactif ou inconnu → 404 noindex ; méthode autre que GET → 405", async () => {
  await seed();
  for (const slug of ["oud-product", "n-existe-pas", "../../etc"]) {
    const r = await get({ p: "product", slug });
    assert.equal(r.statusCode, 404, slug);
    assert.match(r.body, /noindex/);
  }
  const res = mkRes();
  await require(path.join(ROOT, "api", "vitrine.js"))({ method: "POST", headers: {}, query: { p: "aanbod" } }, res);
  assert.equal(res.statusCode, 405);
});

test("sitemap.xml : accueil, aanbod, aanvraag et chaque produit actif", async () => {
  await seed();
  const r = await get({ p: "sitemap" });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"], /xml/);
  for (const u of ["/", "/aanbod", "/aanvraag", "/aanbod/black-tiger-16-20", "/aanbod/black-tiger-16-20-2", "/aanbod/eieren"]) assert.ok(r.body.includes("<loc>https://www.famoseafood.be" + (u === "/" ? "/" : u) + "</loc>"), u);
  assert.doesNotMatch(r.body, /oud-product/);
});

test("préversion Vercel : jamais indexée", async () => {
  await seed();
  process.env.VERCEL_ENV = "preview";
  try { const r = await get({ p: "aanbod" }); assert.match(r.body, /noindex/); } finally { delete process.env.VERCEL_ENV; }
});

test("robots.txt, accueil et routes : vitrine ouverte, portail fermé", () => {
  const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
  assert.match(robots, /^Allow: \/aanbod/m); assert.match(robots, /^Disallow: \/api\//m); assert.match(robots, /^Disallow: \/klant/m);
  assert.match(robots, /^Disallow: \/team\//m); assert.match(robots, /^Disallow: \/beheer/m); assert.match(robots, /^Sitemap: https:\/\/www\.famoseafood\.be\/sitemap\.xml/m);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), /noindex/);
  assert.match(fs.readFileSync(path.join(ROOT, "klant.html"), "utf8"), /noindex/);
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const rw = (vj.rewrites || []).map(r => r.source + " → " + r.destination);
  assert.ok(rw.includes("/aanbod → /api/vitrine?p=aanbod"), rw.join("; "));
  assert.ok(rw.includes("/aanbod/:slug → /api/vitrine?p=product&slug=:slug"));
  assert.ok(rw.includes("/sitemap.xml → /api/vitrine?p=sitemap"));
});
