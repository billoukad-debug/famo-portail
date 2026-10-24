require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Vitrine publique (specs/027) : pages HTML rendues ici, sans session, en lecture seule.
//   /aanbod               -> /api/vitrine?p=aanbod                  catalogue actif, prix « vanaf »
//   /aanbod/:slug         -> /api/vitrine?p=product&slug=:slug       fiche produit (+ JSON-LD Product)
//   /sitemap.xml          -> /api/vitrine?p=sitemap
// ?taal=fr pour le français. Seuls les champs publics du Catalogue et les coordonnées publiques sont lus :
// jamais « Prix négociés », Stock, Clients ni IBAN. Cache CDN 10 min (identique pour tous les visiteurs).
const { at, atAll } = require("../lib/airtable");
const V = require("../lib/vitrine");

// Fermée par défaut (propriétaire 2026-10-17 : « personne ne doit le voir pour l'instant ») : ouverte seulement
// avec VITRINE_OPEN=1 dans Vercel. Fermée : /aanbod et les fiches → 404 noindex, sitemap sans l'aanbod.
const isOpen = () => String(process.env.VITRINE_OPEN || "").trim() === "1";
const ORIGIN = String(process.env.SITE_ORIGIN || "https://www.famoseafood.be").replace(/\/+$/, "");
const FIELDS = ["Produit", "Catégorie", "Unité", "Prix de base", "Kaliber", "Omschrijving", "Foto", "Actif", "Volgorde", "Per verpakking", "Verpakking", "Enkel per verpakking", "Stuks per verpakking",
  // Visfiche (specs/035) : publique (mentions de l'art. 35 et allergènes), jamais un lot ni un client.
  "Wetenschappelijke naam", "FAO-code", "Productiemethode", "Vangstgebied", "Land van kweek", "Vistuig", "Staat", "Allergenen", "Bewaring"];

async function company() {
  try {
    const j = await at(`${encodeURIComponent("Configuratie")}?maxRecords=1`);
    const c = ((j.records || [])[0] || {}).fields || {};
    return { bedrijfsnaam: c["Bedrijfsnaam"] || "", adres: c["Adres"] || "", plaats: c["Postcode en plaats"] || "", btw: c["BTW-nummer"] || "", telefoon: c["Telefoon"] || "", email: c["E-mail"] || "" };
  } catch (e) { return {}; }
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "Alleen GET toegestaan" });
  const q = req.query || {};
  const p = String(q.p || "aanbod"), lang = V.langOf(q.taal);
  const noindex = process.env.VERCEL_ENV === "preview";
  // Spec 033 : vitrine fermée → sitemap des pages publiques seulement, sans lire le Catalogue.
  if (!isOpen() && p === "sitemap") {
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    return res.status(200).send(V.sitemap([], ORIGIN, { aanbod: false }));
  }
  if (!isOpen()) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send(V.renderClosed({ lang, origin: ORIGIN }));
  }
  try {
    const qs = FIELDS.map((f) => "fields%5B%5D=" + encodeURIComponent(f)).join("&");
    const [cat, comp] = await Promise.all([atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}&${qs}`), company()]);
    if (cat.error) throw new Error(String(cat.error.message || cat.error));
    const list = V.products(cat.records || []);
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    if (p === "sitemap") {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      return res.status(200).send(V.sitemap(list, ORIGIN, { aanbod: true }));
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const o = { lang, origin: ORIGIN, noindex };
    if (p === "product") {
      const slug = String(q.slug || "");
      const prod = /^[a-z0-9-]{1,90}$/.test(slug) ? list.find((x) => x.slug === slug) : null;
      if (!prod) return res.status(404).send(V.render404(comp, o));
      return res.status(200).send(V.renderProduct(prod, comp, o));
    }
    return res.status(200).send(V.renderList(list, comp, o));
  } catch (e) {
    console.error("[vitrine]", (e && e.message) || e);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(503).send(V.render404({}, { lang, origin: ORIGIN }).replace(V.esc(lang === "fr" ? "Ce produit est introuvable." : "Dit product vinden we niet (meer)."), lang === "fr" ? "Offre momentanément indisponible." : "Aanbod tijdelijk niet beschikbaar."));
  }
};
