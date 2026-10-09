"use strict";
// Vitrine publique « Ons aanbod » (specs/027) : rendu HTML pur, côté serveur, pour que Google et un prospect sans
// JavaScript voient le catalogue. Entrées : enregistrements Catalogue + coordonnées publiques ; aucune autre donnée.
// Jamais de prix négocié, de stock, de client ni d'IBAN : ce module ne les reçoit pas.
const vat = require("../assets/vat.js");
const { photoUrls } = require("./photo");

const T = {
  nl: {
    title: "Ons aanbod", tagline: "Verse vis en zeevruchten, Antwerpen", cta: "Klant worden", login: "Aanmelden",
    offer: "Aanbod", home: "Start", intro: "Garnalen, vis en zeevruchten voor horeca. Prijzen op maat na aanmelding; hieronder de richtprijzen per eenheid.",
    from: "vanaf", excl: "excl. btw", onRequest: "Prijs op aanvraag", kaliber: "Gewicht", pack: "Verpakking", unit: "Eenheid",
    back: "Terug naar het aanbod", ask: "Interesse? Word klant: wij bellen u binnen 1 werkdag terug, met uw prijzen.",
    notFound: "Dit product vinden we niet (meer).", privacy: "Privacy", terms: "Voorwaarden", skip: "Naar de inhoud",
    desc: "Groothandel in vis en zeevruchten voor horeca in Antwerpen en omstreken: garnalen per kaliber, vis, schelp- en schaaldieren. Bekijk het aanbod en word klant.",
    other: "Français", otherLang: "fr", general: "Algemeen", photo: "Foto van {p}"
  },
  fr: {
    title: "Notre offre", tagline: "Poissons et fruits de mer, Anvers", cta: "Devenir client", login: "Se connecter",
    offer: "Offre", home: "Accueil", intro: "Crevettes, poissons et fruits de mer pour l'horeca. Prix sur mesure après inscription ; ci-dessous les prix indicatifs par unité.",
    from: "à partir de", excl: "HTVA", onRequest: "Prix sur demande", kaliber: "Grammage", pack: "Conditionnement", unit: "Unité",
    back: "Retour à l'offre", ask: "Intéressé ? Devenez client : nous vous rappelons sous 1 jour ouvrable, avec vos prix.",
    notFound: "Ce produit est introuvable.", privacy: "Confidentialité", terms: "Conditions", skip: "Aller au contenu",
    desc: "Grossiste en poissons et fruits de mer pour l'horeca à Anvers et environs : crevettes par calibre, poissons, coquillages et crustacés. Découvrez l'offre et devenez client.",
    other: "Nederlands", otherLang: "nl", general: "Général", photo: "Photo de {p}"
  }
};
// Catégories stockées en français (valeurs historiques) ; néerlandais comme K.NL.cat dans assets/ui.js.
const CAT_NL = { "poisson": "Vis", "poissons": "Vis", "coquillages": "Schelpdieren", "coquillage": "Schelpdieren", "crustacés": "Schaaldieren", "crustaces": "Schaaldieren", "crustacé": "Schaaldieren", "céphalopodes": "Inktvis", "fumé": "Gerookt", "surgelé": "Diepvries", "divers": "Algemeen", "général": "Algemeen" };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const langOf = (v) => (String(v || "").toLowerCase() === "fr" ? "fr" : "nl");

function slugify(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product";
}

// « Black Tiger » + « 16/20 » → « Black Tiger 16/20 » ; un nom qui contient déjà son calibre ne le répète pas.
function fullName(nom, kal) {
  const n = String(nom || "").trim(), k = String(kal || "").trim();
  return k && !("-" + slugify(n) + "-").includes("-" + slugify(k) + "-") ? n + " " + k : n; // « 13-15 » vaut « 13/15 »
}

/** Produits actifs, triés (catégorie, ordre, nom, calibre), avec un slug stable par produit. */
function products(records) {
  const act = (records || []).filter((r) => r && r.fields && r.fields["Actif"] && String(r.fields["Produit"] || "").trim());
  const seen = new Map();
  const slugOf = new Map();
  act.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).forEach((r) => {
    const base = slugify(fullName(r.fields["Produit"], r.fields["Kaliber"]));
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    slugOf.set(r.id, n === 1 ? base : base + "-" + n);
  });
  return act.map((r) => {
    const f = r.fields;
    const vol = f["Volgorde"] == null || f["Volgorde"] === "" ? null : Number(f["Volgorde"]);
    return {
      id: r.id, slug: slugOf.get(r.id), nom: String(f["Produit"]).trim(), cat: String(f["Catégorie"] || "").trim(),
      unite: String(f["Unité"] || "").trim(), base: Number(f["Prix de base"]) > 0 ? Number(f["Prix de base"]) : 0,
      kaliber: String(f["Kaliber"] || "").trim(), naam: fullName(f["Produit"], f["Kaliber"]), omschrijving: String(f["Omschrijving"] || "").trim(),
      fotos: photoUrls(f["Foto"]).slice(0, 6), pak: vat.pakOf(f), volgorde: Number.isFinite(vol) ? vol : null
    };
  }).sort((a, b) => a.cat.localeCompare(b.cat) || (a.volgorde == null) - (b.volgorde == null) || (a.volgorde || 0) - (b.volgorde || 0) || a.nom.localeCompare(b.nom) || a.kaliber.localeCompare(b.kaliber, undefined, { numeric: true }) || a.slug.localeCompare(b.slug));
}

const money = (n) => "€ " + Number(n).toFixed(2).replace(".", ",");
function priceText(p, lang) {
  const t = T[langOf(lang)];
  if (!(p.base > 0)) return t.onRequest;
  return t.from + " " + money(p.base) + " / " + vat.pakUnit(1, p.unite, langOf(lang)) + " " + t.excl;
}
function catLabel(c, lang) {
  const k = String(c || "").trim().toLowerCase();
  if (!k) return T[lang].general;
  if (lang === "nl") return CAT_NL[k] || c;
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function page(o) {
  const t = T[o.lang];
  const href = (p) => p + (o.lang === "fr" ? "?taal=fr" : "");
  const alt = (l) => o.origin + o.path + (l === "fr" ? "?taal=fr" : "");
  const c = o.company || {};
  const foot = [c.bedrijfsnaam || "FAMO Seafood", c.adres, c.plaats, c.btw].filter(Boolean).map(esc).join(", ");
  const contact = [c.telefoon ? '<a class="tlink" href="tel:' + esc(String(c.telefoon).replace(/[^\d+]/g, "")) + '">' + esc(c.telefoon) + "</a>" : "", c.email ? '<a class="tlink" href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : ""].filter(Boolean).join("");
  return '<!doctype html>\n<html lang="' + o.lang + '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    "<title>" + esc(o.title) + "</title>\n" +
    '<meta name="description" content="' + esc(o.desc) + '">\n' +
    (o.noindex ? '<meta name="robots" content="noindex">\n' : '<link rel="canonical" href="' + esc(alt(o.lang)) + '">\n<link rel="alternate" hreflang="nl" href="' + esc(alt("nl")) + '">\n<link rel="alternate" hreflang="fr" href="' + esc(alt("fr")) + '">\n') +
    '<meta property="og:type" content="website">\n<meta property="og:title" content="' + esc(o.title) + '">\n<meta property="og:description" content="' + esc(o.desc) + '">\n' +
    (o.image ? '<meta property="og:image" content="' + esc(/^https:/.test(o.image) ? o.image : o.origin + o.image) + '">\n' : "") +
    '<link rel="icon" href="/assets/brand/famo-mark.svg" type="image/svg+xml">\n<link rel="stylesheet" href="' + esc(o.css || "/assets/ui.css") + '">\n' +
    (o.ld ? '<script type="application/ld+json">' + JSON.stringify(o.ld).replace(/</g, "\\u003c") + "</script>\n" : "") +
    '</head>\n<body class="portal-klant vt">\n<div class="start">\n<a class="skip" href="#main">' + t.skip + "</a>\n" +
    '<header class="start-hd"><a class="brand" href="' + href("/") + '"><span class="logo logo-lg" aria-hidden="true"></span><span><b>FAMO Seafood</b><small>' + t.tagline + "</small></span></a>" +
    '<nav class="mini" aria-label="FAMO"><a class="tlink" href="' + href("/aanbod") + '">' + t.offer + '</a><a class="tlink" href="' + esc(o.path + (t.otherLang === "fr" ? "?taal=fr" : "")) + '" lang="' + t.otherLang + '" hreflang="' + t.otherLang + '">' + t.other + '</a><a class="tlink" href="/">' + t.login + '</a><a class="btn btn-p btn-sm" href="/aanvraag">' + t.cta + "</a></nav></header>\n" +
    '<main class="vt-main" id="main" tabindex="-1">\n' + o.body + "\n</main>\n" +
    '<footer class="start-ft"><span class="quiet">' + foot + '</span><nav class="mini" aria-label="Contact">' + contact + '<a class="tlink" href="/privacy">' + t.privacy + '</a><a class="tlink" href="/voorwaarden">' + t.terms + "</a></nav></footer>\n</div>\n</body>\n</html>\n";
}

function card(p, lang) {
  const href = "/aanbod/" + p.slug + (lang === "fr" ? "?taal=fr" : "");
  const img = p.fotos[0] ? '<img class="vt-img" src="' + esc(p.fotos[0]) + '" alt="" loading="lazy" decoding="async" width="320" height="240">' : '<span class="vt-img vt-noimg" aria-hidden="true"></span>';
  return '<li class="vt-card"><a class="vt-link" href="' + esc(href) + '">' + img + '<span class="vt-body"><b class="vt-name">' + esc(p.nom) + "</b>" +
    (p.kaliber && p.naam !== p.nom ? '<span class="vt-kal">' + esc(p.kaliber) + "</span>" : "") +
    '<span class="vt-price">' + esc(priceText(p, lang)) + "</span></span></a></li>";
}

function renderList(list, company, o) {
  const lang = langOf(o.lang), t = T[lang];
  const groups = new Map();
  list.forEach((p) => { const k = catLabel(p.cat, lang); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
  const body = '<section class="vt-hero"><h1 class="h1">' + t.title + '</h1><p class="sub">' + t.intro + '</p><p><a class="btn btn-p" href="/aanvraag">' + t.cta + "</a></p></section>\n" +
    Array.from(groups, ([g, ps]) => '<section class="vt-group" aria-labelledby="g-' + esc(slugify(g)) + '"><h2 class="h2" id="g-' + esc(slugify(g)) + '">' + esc(g) + ' <small class="quiet">' + ps.length + '</small></h2><ul class="vt-grid">' + ps.map((p) => card(p, lang)).join("") + "</ul></section>").join("\n");
  return page({ lang, origin: o.origin, path: "/aanbod", css: o.css, noindex: o.noindex, company, title: t.title + " · FAMO Seafood", desc: t.desc, image: (list.find((p) => p.fotos[0]) || { fotos: [] }).fotos[0], body });
}

function renderProduct(p, company, o) {
  const lang = langOf(o.lang), t = T[lang];
  const rows = [[t.kaliber, p.kaliber], [t.unit, vat.pakUnit(1, p.unite, lang)], [t.pack, p.pak ? vat.pakOne(p.pak, p.unite, lang) : ""]].filter((r) => r[1]);
  const gallery = p.fotos.length ? '<div class="vt-gallery">' + p.fotos.map((u, i) => '<img class="vt-photo" src="' + esc(u) + '" alt="' + (i === 0 ? esc(t.photo.replace("{p}", p.nom)) : "") + '" decoding="async"' + (i ? ' loading="lazy"' : "") + ' width="640" height="480">').join("") + "</div>" : "";
  const name = p.naam;
  const ld = { "@context": "https://schema.org", "@type": "Product", name, category: catLabel(p.cat, lang), brand: { "@type": "Brand", name: "FAMO Seafood" } };
  if (p.omschrijving) ld.description = p.omschrijving;
  if (p.fotos[0]) ld.image = p.fotos.map((u) => (/^https:/.test(u) ? u : o.origin + u));
  if (p.base > 0) ld.offers = { "@type": "Offer", price: p.base.toFixed(2), priceCurrency: "EUR", availability: "https://schema.org/InStock", url: o.origin + "/aanbod/" + p.slug, seller: { "@type": "Organization", name: (company && company.bedrijfsnaam) || "FAMO Seafood" } };
  const body = '<p class="vt-crumb"><a class="tlink" href="' + (lang === "fr" ? "/aanbod?taal=fr" : "/aanbod") + '">← ' + t.back + "</a></p>\n" +
    '<article class="vt-product">' + gallery + '<div class="vt-info"><p class="quiet">' + esc(catLabel(p.cat, lang)) + '</p><h1 class="h1">' + esc(p.nom) + (p.kaliber && p.naam !== p.nom ? ' <span class="vt-kal">' + esc(p.kaliber) + "</span>" : "") + "</h1>" +
    '<p class="vt-price vt-price-lg">' + esc(priceText(p, lang)) + "</p>" +
    (p.omschrijving ? '<p class="vt-desc">' + esc(p.omschrijving) + "</p>" : "") +
    (rows.length ? '<dl class="vt-specs">' + rows.map((r) => "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>").join("") + "</dl>" : "") +
    '<p class="sub">' + t.ask + '</p><p><a class="btn btn-p btn-lg" href="/aanvraag">' + t.cta + "</a></p></div></article>";
  return page({ lang, origin: o.origin, path: "/aanbod/" + p.slug, css: o.css, noindex: o.noindex, company, title: name + " · FAMO Seafood", desc: (p.omschrijving || t.desc).slice(0, 160), image: p.fotos[0], ld, body });
}

function render404(company, o) {
  const lang = langOf(o.lang), t = T[lang];
  const body = '<section class="vt-hero"><h1 class="h1">' + t.notFound + '</h1><p><a class="btn btn-p" href="' + (lang === "fr" ? "/aanbod?taal=fr" : "/aanbod") + '">' + t.back + "</a></p></section>";
  return page({ lang, origin: o.origin, path: "/aanbod", css: o.css, noindex: true, company, title: t.notFound + " · FAMO Seafood", desc: t.desc, body });
}

function sitemap(list, origin) {
  const urls = ["/", "/aanbod", "/aanvraag"].concat(list.map((p) => "/aanbod/" + p.slug));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((u) => "<url><loc>" + esc(origin + u) + "</loc></url>").join("\n") + "\n</urlset>\n";
}

module.exports = { slugify, products, priceText, renderList, renderProduct, render404, sitemap, esc, langOf };
