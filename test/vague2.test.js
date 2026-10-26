"use strict";
// Spec 033 (vague 2) : trouvable sur Google. robots, texte dans le HTML, métadonnées, JSON-LD, NL/FR dans l'adresse,
// sitemap, police chargée une seule fois, vitrine prête (fermée).
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
delete process.env.VERCEL_ENV;
process.removeAllListeners("warning");
global.fetch = async (u) => { throw new Error("Réseau interdit : " + u); };
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ORIGIN = "https://www.famoseafood.be";

// Coordonnées publiques : /api/config?public=1 en production, lu le 24/10/2026. Rien d'autre n'est écrit en dur.
const PUBLIC = ["FAMO Seafood", "Jezusstraat 34", "2000 Antwerpen, België", "+32483585854", "info@famoseafood.be", "BE0788705713", "0788.705.713"];
// Page → adresse et scripts dont le texte statique doit provenir.
const PAGES = {
  "index.html": { path: "/", src: ["assets/pages/start.js", "assets/ui.js", "lib/vitrine.js"] },
  "aanvraag.html": { path: "/aanvraag", src: ["assets/pages/aanvraag.js", "assets/ui.js"] },
  "privacy.html": { path: "/privacy", src: ["assets/pages/privacy.js", "assets/ui.js"] },
  "voorwaarden.html": { path: "/voorwaarden", src: ["assets/pages/voorwaarden.js", "assets/pages/privacy.js", "assets/ui.js"] },
  "colofon.html": { path: "/colofon", src: ["assets/pages/colofon.js", "assets/ui.js"] }
};

const head = (html) => (/<head>([\s\S]*?)<\/head>/.exec(html) || [])[1] || "";
const tag = (html, re) => (re.exec(head(html)) || [])[0] || "";
const attr = (t, a) => ((new RegExp("\\s" + a + '="([^"]*)"')).exec(t) || [])[1];
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// Contenu statique de #app : nœuds de texte, sans la ponctuation seule.
function staticTexts(html) {
  const m = /<(div|main) id="app"[^>]*>([\s\S]*?)<\/\1>\s*(?:<script|<\/body>)/.exec(html);
  if (!m) return [];
  return m[2].split(/<[^>]+>/).map((s) => unesc(s).replace(/\s+/g, " ").trim()).filter((s) => s && !/^[·,.:;\s–-]+$/.test(s));
}
// Chaînes littérales des scripts sources ; « {t} », « {d} » acceptent une valeur.
function literals(files) {
  const out = [];
  for (const f of files) { const s = read(f); const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g; let m; while ((m = re.exec(s))) out.push((m[1] != null ? m[1] : m[2]).replace(/\\(.)/g, "$1")); }
  return out;
}
const fromSource = (txt, lits) => PUBLIC.includes(txt) || lits.some((l) => l.includes(txt) || (l.includes("{") && new RegExp("^" + l.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[a-z]+\}/g, ".+?") + "$").test(txt)));

// assets/ui.js dans un faux navigateur : adresse, storage et <head> au choix.
function loadK(o) {
  o = o || {};
  const store = Object.assign({}, o.storage || {});
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const headEls = o.head || [];
  const nav = { href: null, reloaded: false };
  const loc = { href: ORIGIN + (o.url || "/"), pathname: (o.url || "/").split("?")[0], search: (o.url || "").includes("?") ? "?" + (o.url || "").split("?")[1] : "", hash: "", reload() { nav.reloaded = true; }, assign(u) { nav.href = u; } };
  const doc = { title: "", documentElement: {}, addEventListener() {}, getElementById: () => null, body: { classList: { add() {}, remove() {} } },
    querySelector: (sel) => (sel.includes("hreflang") ? headEls.find((e) => e.attrs.hreflang) || null : null),
    querySelectorAll: (sel) => (sel === "head [data-fr]" ? headEls.filter((e) => "data-fr" in e.attrs) : []) };
  const win = { document: doc, location: loc, sessionStorage: null, localStorage: ls, addEventListener() {} };
  vm.runInNewContext(read("assets/ui.js"), Object.assign(win, { window: win, URL, URLSearchParams, CustomEvent: class {}, fetch: async () => ({}) }));
  return { K: win.K, store, doc, nav };
}
const el = (tagName, attrs) => ({ tagName, attrs: Object.assign({}, attrs), getAttribute(a) { return a in this.attrs ? this.attrs[a] : null; }, setAttribute(a, v) { this.attrs[a] = String(v); } });

test("robots.txt : Google lit les scripts des pages, les zones privées restent fermées", () => {
  const r = read("robots.txt");
  assert.doesNotMatch(r, /^Disallow: \/assets/m, "plus de blocage de /assets/pages/");
  for (const p of ["/api/", "/klant", "/team/", "/beheer", "/wachtwoord", "/offline", "/aanbod"]) assert.match(r, new RegExp("^Disallow: " + p.replace(/\//g, "\\/") + "$", "m"), p);
  const allowApi = r.split("\n").filter((l) => /^Allow: \/api\//.test(l));
  assert.deepEqual(allowApi, ["Allow: /api/config?public=1", "Allow: /api/config?voorwaarden=1"], "seules exceptions sous /api/ : la config publique");
  assert.doesNotMatch(r, /^Disallow: \/$/m);
  assert.match(r, /^Sitemap: https:\/\/www\.famoseafood\.be\/sitemap\.xml$/m);
});

test("chaque page publique : titre, description, canonical, hreflang nl/fr/x-default, Open Graph (NL et FR)", () => {
  for (const [f, p] of Object.entries(PAGES)) {
    const html = read(f), url = ORIGIN + p.path, fr = url + "?taal=fr";
    assert.doesNotMatch(html, /noindex/, f);
    const title = tag(html, /<title[^>]*>[^<]*<\/title>/);
    assert.match(title, /FAMO Seafood/, f);
    assert.match(attr(title, "data-fr") || "", /FAMO Seafood/, f + " : titre FR");
    const desc = tag(html, /<meta name="description"[^>]*>/);
    assert.ok((attr(desc, "content") || "").length >= 50 && attr(desc, "content").length <= 170, f + " : description");
    assert.ok((attr(desc, "data-fr") || "").length >= 50, f + " : description FR");
    const canon = tag(html, /<link rel="canonical"[^>]*>/);
    assert.equal(attr(canon, "href"), url, f); assert.equal(attr(canon, "data-fr"), fr, f);
    assert.equal(attr(tag(html, /<link rel="alternate" hreflang="nl"[^>]*>/), "href"), url, f);
    assert.equal(attr(tag(html, /<link rel="alternate" hreflang="fr"[^>]*>/), "href"), fr, f);
    assert.equal(attr(tag(html, /<link rel="alternate" hreflang="x-default"[^>]*>/), "href"), url, f);
    const og = (k) => tag(html, new RegExp('<meta property="og:' + k + '"[^>]*>'));
    assert.equal(attr(og("url"), "content"), url, f); assert.equal(attr(og("url"), "data-fr"), fr, f);
    assert.equal(attr(og("type"), "content"), "website");
    assert.equal(attr(og("site_name"), "content"), "FAMO Seafood");
    assert.equal(attr(og("locale"), "content"), "nl_BE"); assert.equal(attr(og("locale"), "data-fr"), "fr_BE");
    assert.ok(attr(og("title"), "content") && attr(og("title"), "data-fr"), f + " og:title");
    assert.ok(attr(og("description"), "content") && attr(og("description"), "data-fr"), f + " og:description");
    const img = attr(og("image"), "content") || "";
    assert.match(img, /^https:\/\/www\.famoseafood\.be\/assets\//, f);
    assert.ok(fs.existsSync(path.join(ROOT, img.slice(ORIGIN.length + 1))), "image existante : " + img);
  }
  assert.match(attr(tag(read("index.html"), /<title[^>]*>/), "data-fr") || "", /./);
  assert.match(read("index.html"), /<title[^>]*>[^<]*[Gg]roothandel vis en zeevruchten[^<]*Antwerpen[^<]*<\/title>/);
  assert.match(read("aanvraag.html"), /<title[^>]*>[^<]*[Gg]roothandel vis en zeevruchten[^<]*Antwerpen[^<]*<\/title>/);
});

test("texte dans le HTML : titre et coordonnées lisibles sans JavaScript, rien d'inventé", () => {
  for (const [f, p] of Object.entries(PAGES)) {
    const html = read(f), texts = staticTexts(html), lits = literals(p.src);
    assert.ok(texts.length >= 3, f + " : du texte dans #app");
    assert.match(html, /<h1[^>]*>/, f + " : un titre h1");
    for (const t of texts) assert.ok(fromSource(t, lits), f + " : texte sans source dans les scripts ni dans la config publique : « " + t + " »");
    assert.ok(texts.includes("info@famoseafood.be") && texts.includes("+32483585854"), f + " : contact");
    assert.doesNotMatch(html.replace(/<head>[\s\S]*<\/head>/, ""), /€|\bprijs\b|vanaf/i, f + " : aucun prix");
  }
  const home = staticTexts(read("index.html"));
  for (const t of ["Vóór 22:00 besteld,", "morgen in uw keuken.", "Klant worden"]) assert.ok(home.includes(t), t);
  assert.ok(home.some((t) => /Antwerpen en omstreken/.test(t)), "zone de livraison");
  assert.ok(home.some((t) => /vis en zeevruchten/i.test(t)), "ce que FAMO vend");
  assert.match(read("index.html"), /href="mailto:info@famoseafood\.be"/);
  assert.match(read("index.html"), /href="tel:\+32483585854"/);
});

test("JSON-LD LocalBusiness de l'accueil : seulement les coordonnées publiques", () => {
  const html = read("index.html");
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head(html));
  assert.ok(m, "bloc JSON-LD dans le <head>");
  const ld = JSON.parse(m[1]);
  assert.equal(ld["@context"], "https://schema.org");
  assert.equal(ld["@type"], "LocalBusiness");
  assert.equal(ld.name, "FAMO Seafood");
  assert.equal(ld.url, ORIGIN + "/");
  assert.equal(ld.email, "info@famoseafood.be");
  assert.equal(ld.telephone, "+32483585854");
  assert.equal(ld.vatID, "BE0788705713");
  assert.deepEqual(ld.address, { "@type": "PostalAddress", streetAddress: "Jezusstraat 34", postalCode: "2000", addressLocality: "Antwerpen", addressCountry: "BE" });
  assert.equal(ld.areaServed, "Antwerpen en omstreken");
  assert.ok(fs.existsSync(path.join(ROOT, ld.logo.slice(ORIGIN.length + 1))), "logo existant");
  for (const k of ["legalName", "openingHours", "openingHoursSpecification", "priceRange", "aggregateRating", "review", "award"]) assert.ok(!(k in ld), "pas de " + k);
  for (const f of Object.keys(PAGES).filter((x) => x !== "index.html")) assert.doesNotMatch(read(f), /ld\+json/, f);
});

test("check.js : seul un bloc <script type=\"application/ld+json\"> au JSON valide passe la règle CSP", () => {
  const I = require(path.join(ROOT, "scripts", "inline-scripts.js"));
  assert.deepEqual(I.inlineProblems('<head><script src="/assets/ui.js" defer></script><script type="application/ld+json">{"@type":"LocalBusiness"}</script></head>'), []);
  assert.deepEqual(I.inlineScripts('<script type="application/ld+json">{"a":1}</script><script src="/x.js"></script>'), [], "le JSON n'est pas du JavaScript à compiler");
  for (const bad of ["<script>alert(1)</script>", '<script type="text/javascript">x()</script>', '<script type="module">x()</script>',
    '<script type="application/ld+json" onload="x()">{}</script>', '<script id="x" type="application/ld+json">{}</script>', '<img src="a" onerror="x()">'])
    assert.ok(I.inlineProblems(bad).length > 0, bad);
  assert.match(I.inlineProblems('<script type="application/ld+json">{"a":</script>').join(), /JSON-LD/);
  assert.deepEqual(I.inlineScripts("<script>var a = 1;</script>"), ["var a = 1;"]);
  assert.match(read("scripts/check.js"), /inline-scripts/);
});

test("langue dans l'adresse : ?taal=fr / ?taal=nl priment sur le choix enregistré et l'enregistrent", () => {
  let r = loadK({ url: "/?taal=fr" });
  assert.equal(r.K.lang, "fr"); assert.equal(r.store.famoLang, "fr");
  r = loadK({ url: "/aanvraag?taal=nl", storage: { famoLang: "fr" } });
  assert.equal(r.K.lang, "nl"); assert.equal(r.store.famoLang, "nl");
  r = loadK({ url: "/privacy", storage: { famoLang: "fr" } });
  assert.equal(r.K.lang, "fr", "sans paramètre : le choix enregistré");
  r = loadK({ url: "/?taal=de" });
  assert.equal(r.K.lang, "nl"); assert.ok(!("famoLang" in r.store), "valeur inconnue ignorée");
  assert.equal(loadK({ url: "/?taal=FR" }).K.lang, "fr");
});

test("K.applyLangMeta : en FR, les balises du <head> prennent leur variante data-fr ; en NL rien ne change", () => {
  const mk = () => [el("TITLE", { "data-fr": "FAMO Seafood · Grossiste" }), el("META", { name: "description", content: "NL", "data-fr": "FR" }),
    el("LINK", { rel: "canonical", href: ORIGIN + "/", "data-fr": ORIGIN + "/?taal=fr" }), el("LINK", { rel: "alternate", hreflang: "fr", href: ORIGIN + "/?taal=fr" })];
  let h = mk(), r = loadK({ url: "/?taal=fr", head: h });
  assert.equal(r.doc.title, "FAMO Seafood · Grossiste");
  assert.equal(h[1].attrs.content, "FR");
  assert.equal(h[2].attrs.href, ORIGIN + "/?taal=fr");
  h = mk(); r = loadK({ url: "/", head: h });
  assert.equal(r.doc.title, ""); assert.equal(h[1].attrs.content, "NL"); assert.equal(h[2].attrs.href, ORIGIN + "/");
});

test("K.setLang et K.langHref : une page publique change d'adresse, les autres rechargent", () => {
  const hreflang = [el("LINK", { rel: "alternate", hreflang: "fr", href: ORIGIN + "/?taal=fr" })];
  let r = loadK({ url: "/aanvraag", head: hreflang });
  r.K.setLang("fr");
  assert.equal(r.nav.href, ORIGIN + "/aanvraag?taal=fr"); assert.equal(r.store.famoLang, "fr");
  r = loadK({ url: "/aanvraag?taal=fr", head: hreflang });
  r.K.setLang("nl");
  assert.equal(r.nav.href, ORIGIN + "/aanvraag", "néerlandais : adresse sans paramètre"); assert.equal(r.store.famoLang, "nl");
  r = loadK({ url: "/klant" });
  r.K.setLang("fr");
  assert.equal(r.nav.href, null); assert.ok(r.nav.reloaded, "portail client : rechargement comme avant");
  assert.equal(loadK({ url: "/?taal=fr" }).K.langHref("/privacy"), "/privacy?taal=fr");
  assert.equal(loadK({ url: "/" }).K.langHref("/privacy"), "/privacy");
  const fr = loadK({ url: "/?taal=fr" }).K.publicFooter();
  for (const p of ["/privacy", "/voorwaarden", "/colofon"]) assert.ok(fr.includes('href="' + p + '?taal=fr"'), p);
  assert.ok(fr.includes('href="/team/aanmelden"'), "personnel : toujours en néerlandais");
});

test("sitemap : pages publiques en NL et en FR avec alternates ; vitrine fermée sans aanbod", async () => {
  const V = require(path.join(ROOT, "lib", "vitrine.js"));
  const xml = V.sitemap([], ORIGIN, { aanbod: false });
  assert.match(xml, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  for (const p of ["/", "/aanvraag", "/privacy", "/voorwaarden", "/colofon"]) {
    assert.ok(xml.includes("<loc>" + ORIGIN + p + "</loc>"), p);
    assert.ok(xml.includes("<loc>" + ORIGIN + p + "?taal=fr</loc>"), p + " FR");
    assert.ok(xml.includes('<xhtml:link rel="alternate" hreflang="fr" href="' + ORIGIN + p + '?taal=fr"/>'), p);
    assert.ok(xml.includes('<xhtml:link rel="alternate" hreflang="x-default" href="' + ORIGIN + p + '"/>'), p);
  }
  assert.doesNotMatch(xml, /aanbod/);
  const open = V.sitemap([{ slug: "zalm" }], ORIGIN, { aanbod: true });
  assert.ok(open.includes("<loc>" + ORIGIN + "/aanbod/zalm?taal=fr</loc>"));
  // api/vitrine.js : vitrine fermée → sitemap servi sans lire le Catalogue.
  delete process.env.VITRINE_OPEN;
  const ds = require(path.join(ROOT, "lib", "datastore.js"));
  const at = require(path.join(ROOT, "lib", "airtable.js"));
  const orig = at.atAll; let reads = 0;
  at.atAll = async (...a) => { reads++; return orig(...a); };
  try {
    await ds.state.store.replaceAll("Catalogue", []);
    const res = { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { this.body = String(b); return this; }, json(b) { this.body = JSON.stringify(b); return this; } };
    delete require.cache[require.resolve(path.join(ROOT, "api", "vitrine.js"))];
    await require(path.join(ROOT, "api", "vitrine.js"))({ method: "GET", headers: {}, query: { p: "sitemap" } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /xml/);
    assert.match(res.headers["cache-control"], /s-maxage=3600/);
    assert.ok(res.body.includes("<loc>" + ORIGIN + "/colofon?taal=fr</loc>"));
    assert.equal(reads, 0, "aucune lecture du Catalogue");
  } finally { at.atAll = orig; }
});

test("police : le préchargement et la feuille de style demandent la même adresse", () => {
  const css = read("assets/ui.css");
  const cssUrl = (/url\((\/assets\/fonts\/atkinson-hyperlegible-next-latin\.woff2[^)]*)\)/.exec(css) || [])[1];
  assert.match(cssUrl || "", /\?v=[0-9a-f]{10}$/, "adresse versionnée dans ui.css");
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".html"))) {
    const pre = (/<link rel="preload" href="([^"]+)" as="font"/.exec(read(f)) || [])[1];
    if (pre) assert.equal(pre, cssUrl, f);
  }
});

test("vitrine (fermée) prête à l'ouverture : canonical, hreflang nl/fr/x-default, og:url", () => {
  const V = require(path.join(ROOT, "lib", "vitrine.js"));
  const html = V.renderList([], { bedrijfsnaam: "FAMO Seafood" }, { lang: "fr", origin: ORIGIN });
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{50,}">/);
  assert.ok(html.includes('<link rel="canonical" href="' + ORIGIN + '/aanbod?taal=fr">'));
  assert.ok(html.includes('<link rel="alternate" hreflang="x-default" href="' + ORIGIN + '/aanbod">'));
  assert.ok(html.includes('<meta property="og:url" content="' + ORIGIN + '/aanbod?taal=fr">'));
  assert.match(read("robots.txt"), /^Disallow: \/aanbod$/m, "reste fermée : geste VITRINE_OPEN noté dans la spec");
  assert.match(read("specs/033-vague-2-trouvable/spec.md"), /VITRINE_OPEN=1/);
});
