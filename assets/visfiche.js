/* global module, self */
// Visfiche (specs/035) : UNE liste de valeurs et UNE règle d'affichage pour Beheer, la fiche de lot,
// le catalogue client, la vitrine et les documents. Chargé tel quel par le navigateur (window.FamoVis)
// et par le serveur (require("../assets/visfiche.js")).
//
// Base : recherche juridique du 24/10/2026 (~/Documents/Plan Kameha/FAMO/recherche-info-poisson-24-10.md).
//   Règl. (UE) 1379/2013 art. 35 et 38 : nom scientifique, méthode de production, zone de capture
//   (sous-zone ou division FAO, nom en clair) ou pays d'élevage, catégorie d'engin (annexe III col. 1),
//   mention « décongelé ». Règl. (CE) 1224/2009 art. 58 §5 (version 2023/2842) : code FAO alpha-3, date
//   de capture, identifiant de sortie de pêche ou d'unité aquacole. Règl. (UE) 1169/2011 annexe II :
//   les 14 allergènes. Règl. (CE) 853/2004 annexe III section VIII ch. III partie D : congélation
//   −20 °C 24 h ou −35 °C 15 h pour le poisson destiné à être consommé cru.
// Les valeurs stockées ne changent jamais (clés stables) ; seuls les libellés NL/FR changent.
// Les libellés NL des engins et des zones sont des traductions maison, à relire (INCERTAIN).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FamoVis = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Méthode de production (art. 35 §1 b) : mêmes valeurs que la fiche de lot depuis l'audit C-13.
  const METHODS = ["Gevangen op zee", "Gevangen in zoet water", "Gekweekt"];
  const METHOD_FR = { "Gevangen op zee": "Pêché en mer", "Gevangen in zoet water": "Pêché en eaux douces", "Gekweekt": "Élevé" };

  // Zones FAO courantes pour un grossiste d'Anvers (liste fermée, non exhaustive). Atlantique Nord-Est (27)
  // et Méditerranée (37) : sous-zone, comme le demande l'art. 38 ; ailleurs : la grande zone FAO.
  const ZONES = [
    ["27.I", "Barentszzee", "mer de Barents"],
    ["27.II", "Noorse Zee", "mer de Norvège"],
    ["27.III", "Skagerrak, Kattegat en Oostzee", "Skagerrak, Kattegat et mer Baltique"],
    ["27.IV", "Noordzee", "mer du Nord"],
    ["27.V", "IJsland en Faeröer", "Islande et îles Féroé"],
    ["27.VI", "West van Schotland", "ouest de l'Écosse"],
    ["27.VII", "Ierse Zee, Keltische Zee en Het Kanaal", "mer d'Irlande, mer Celtique et Manche"],
    ["27.VIII", "Golf van Biskaje", "golfe de Gascogne"],
    ["27.IX", "Portugese wateren", "eaux portugaises"],
    ["27.X", "Azoren", "Açores"],
    ["27.XIV", "Oost-Groenland", "est du Groenland"],
    ["37.1", "Westelijke Middellandse Zee", "Méditerranée occidentale"],
    ["37.2", "Centrale Middellandse Zee", "Méditerranée centrale"],
    ["37.3", "Oostelijke Middellandse Zee", "Méditerranée orientale"],
    ["37.4", "Zwarte Zee", "mer Noire"],
    ["18", "Noordelijke IJszee", "océan Arctique"],
    ["21", "Noordwestelijke Atlantische Oceaan", "Atlantique Nord-Ouest"],
    ["31", "Centraal-westelijke Atlantische Oceaan", "Atlantique Centre-Ouest"],
    ["34", "Centraal-oostelijke Atlantische Oceaan", "Atlantique Centre-Est"],
    ["41", "Zuidwestelijke Atlantische Oceaan", "Atlantique Sud-Ouest"],
    ["47", "Zuidoostelijke Atlantische Oceaan", "Atlantique Sud-Est"],
    ["51", "Westelijke Indische Oceaan", "océan Indien occidental"],
    ["57", "Oostelijke Indische Oceaan", "océan Indien oriental"],
    ["61", "Noordwestelijke Stille Oceaan", "Pacifique Nord-Ouest"],
    ["67", "Noordoostelijke Stille Oceaan", "Pacifique Nord-Est"],
    ["71", "Centraal-westelijke Stille Oceaan", "Pacifique Centre-Ouest"],
    ["77", "Centraal-oostelijke Stille Oceaan", "Pacifique Centre-Est"],
    ["81", "Zuidwestelijke Stille Oceaan", "Pacifique Sud-Ouest"],
    ["87", "Zuidoostelijke Stille Oceaan", "Pacifique Sud-Est"],
    ["48", "Atlantische Oceaan, Antarctisch", "Atlantique, Antarctique"],
    ["58", "Indische Oceaan, Antarctisch", "océan Indien, Antarctique"],
    ["88", "Stille Oceaan, Antarctisch", "Pacifique, Antarctique"]
  ].map(([code, nl, fr]) => ({ code, nl, fr }));
  const ZONE = new Map(ZONES.map((z) => [z.code, z]));

  // Catégories d'engin, R1379 annexe III colonne 1 : la valeur stockée est le libellé français du texte
  // (CONFIRMÉ par la recherche) ; le néerlandais est une traduction à relire.
  const GEARS = [
    ["Sennes", "Zegens"],
    ["Chaluts", "Sleepnetten"],
    ["Filets maillants et filets similaires", "Kieuwnetten en soortgelijke netten"],
    ["Filets tournants et filets soulevés", "Omringingsnetten en hefnetten"],
    ["Lignes et hameçons", "Lijnen en haken"],
    ["Dragues", "Dreggen"],
    ["Casiers et pièges", "Fuiken en vallen"]
  ].map(([fr, nl]) => ({ key: fr, nl, fr }));
  const GEAR = new Map(GEARS.map((g) => [g.key, g]));

  // État (R1379 art. 35 §1 d : « décongelé » obligatoire, sauf exemptions).
  const STATES = ["Vers", "Diepgevroren", "Ontdooid"];
  const STATE_FR = { "Vers": "Frais", "Diepgevroren": "Congelé", "Ontdooid": "Décongelé" };

  // Les 14 allergènes de l'annexe II du R1169/2011, dans l'ordre du texte.
  const ALLERGENS = [
    ["gluten", "Glutenbevattende granen", "Céréales contenant du gluten"],
    ["schaaldieren", "Schaaldieren", "Crustacés"],
    ["eieren", "Eieren", "Œufs"],
    ["vis", "Vis", "Poissons"],
    ["pinda", "Aardnoten (pinda's)", "Arachides"],
    ["soja", "Soja", "Soja"],
    ["melk", "Melk", "Lait"],
    ["noten", "Noten", "Fruits à coque"],
    ["selderij", "Selderij", "Céleri"],
    ["mosterd", "Mosterd", "Moutarde"],
    ["sesam", "Sesamzaad", "Graines de sésame"],
    ["sulfiet", "Zwaveldioxide en sulfieten", "Anhydride sulfureux et sulfites"],
    ["lupine", "Lupine", "Lupin"],
    ["weekdieren", "Weekdieren", "Mollusques"]
  ].map(([key, nl, fr]) => ({ key, nl, fr }));
  const ALLERGEN = new Map(ALLERGENS.map((a) => [a.key, a]));

  // Traitement antiparasitaire par congélation (R853, partie D) : les deux barèmes du texte, rien d'autre
  // (jamais « −18 °C 96 h », valeur de presse sans base dans le règlement).
  const FREEZES = [
    { key: "-20 °C 24 h", nl: "diepgevroren op −20 °C of kouder, minstens 24 uur in alle delen", fr: "congelé à −20 °C ou moins, au moins 24 heures en tous points" },
    { key: "-35 °C 15 h", nl: "diepgevroren op −35 °C of kouder, minstens 15 uur in alle delen", fr: "congelé à −35 °C ou moins, au moins 15 heures en tous points" },
    { key: "Niet van toepassing", nl: "niet van toepassing", fr: "sans objet" }
  ];
  const FREEZE = new Map(FREEZES.map((x) => [x.key, x]));

  // Champs du Catalogue (Beheer → Producten), tous facultatifs.
  const F = {
    wetenschappelijkeNaam: "Wetenschappelijke naam", faoCode: "FAO-code", productiemethode: "Productiemethode",
    vangstgebied: "Vangstgebied", landVanKweek: "Land van kweek", vistuig: "Vistuig", staat: "Staat",
    allergenen: "Allergenen", bewaring: "Bewaring", rauw: "Rauw te eten", vriesbehandeling: "Vriesbehandeling"
  };

  const txt = (v, n) => String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const langOf = (l) => (String(l || "").toLowerCase() === "fr" ? "fr" : "nl");

  /** Code FAO alpha-3 (base ASFIS) : trois lettres, en majuscules. "" = vide ; null = invalide. */
  function faoIn(v) {
    const s = txt(v, 10).toUpperCase();
    if (!s) return "";
    return /^[A-Z]{3}$/.test(s) ? s : null;
  }

  /** Allergènes : liste de clés (tableau ou texte « vis, weekdieren ») → clés connues, ordre du texte. null = clé inconnue. */
  function allergensIn(v) {
    const raw = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[,;\s]+/);
    const keys = raw.map((k) => String(k || "").trim().toLowerCase()).filter(Boolean);
    if (keys.some((k) => !ALLERGEN.has(k))) return null;
    return ALLERGENS.map((a) => a.key).filter((k) => keys.includes(k));
  }
  const allergensOf = (v) => allergensIn(v) || [];

  /**
   * Visfiche d'un produit depuis le corps de saveProduct ({ vis: {…} }) → { fields } ou { error } (néerlandais).
   * Tout est facultatif ; une valeur hors liste est refusée, jamais « corrigée ».
   */
  function productIn(vis) {
    const v = vis && typeof vis === "object" ? vis : {};
    const out = {};
    out[F.wetenschappelijkeNaam] = txt(v.wetenschappelijkeNaam, 120);
    const fao = faoIn(v.faoCode);
    if (fao === null) return { error: "FAO-code: drie letters, bv. SOL (tong) of COD (kabeljauw)" };
    out[F.faoCode] = fao;
    const m = txt(v.productiemethode, 40);
    if (m && !METHODS.includes(m)) return { error: "Productiemethode: " + METHODS.join(", ") };
    out[F.productiemethode] = m;
    const z = txt(v.vangstgebied, 20);
    if (z && !ZONE.has(z)) return { error: "Vangstgebied: kies een zone uit de lijst" };
    out[F.vangstgebied] = z;
    out[F.landVanKweek] = txt(v.landVanKweek, 80);
    const g = txt(v.vistuig, 60);
    if (g && !GEAR.has(g)) return { error: "Vistuig: kies een categorie uit de lijst" };
    if (g && m === "Gekweekt") return { error: "Vistuig enkel bij gevangen vis (niet bij kweek)" };
    out[F.vistuig] = g;
    const s = txt(v.staat, 20);
    if (s && !STATES.includes(s)) return { error: "Staat: " + STATES.join(", ") };
    out[F.staat] = s;
    const a = allergensIn(v.allergenen);
    if (a === null) return { error: "Allergenen: onbekende allergeen" };
    out[F.allergenen] = a.join(",");
    out[F.bewaring] = txt(v.bewaring, 80);
    out[F.rauw] = v.rauw === true;
    const fr = txt(v.vriesbehandeling, 30);
    if (fr && !FREEZE.has(fr)) return { error: "Vriesbehandeling: " + FREEZES.map((x) => x.key).join(", ") };
    // Sans « rauw te eten », le traitement n'a pas de sens : il n'est pas gardé (rien d'imprimé par erreur).
    out[F.vriesbehandeling] = out[F.rauw] ? fr : "";
    return { fields: out };
  }

  /** Visfiche lue d'un enregistrement Catalogue : seulement les valeurs remplies (objet vide = rien à montrer). */
  function fromFields(f) {
    f = f || {};
    const o = {};
    const put = (k, v) => { if (v !== "" && v != null && v !== false && !(Array.isArray(v) && !v.length)) o[k] = v; };
    put("wetenschappelijkeNaam", txt(f[F.wetenschappelijkeNaam], 120));
    put("faoCode", faoIn(f[F.faoCode]) || "");
    put("productiemethode", METHODS.includes(f[F.productiemethode]) ? f[F.productiemethode] : "");
    put("vangstgebied", ZONE.has(f[F.vangstgebied]) ? f[F.vangstgebied] : "");
    put("landVanKweek", txt(f[F.landVanKweek], 80));
    put("vistuig", GEAR.has(f[F.vistuig]) ? f[F.vistuig] : "");
    put("staat", STATES.includes(f[F.staat]) ? f[F.staat] : "");
    put("allergenen", allergensOf(f[F.allergenen]));
    put("bewaring", txt(f[F.bewaring], 80));
    if (f[F.rauw]) { o.rauw = true; put("vriesbehandeling", FREEZE.has(f[F.vriesbehandeling]) ? f[F.vriesbehandeling] : ""); }
    return o;
  }
  const isEmpty = (o) => !o || !Object.keys(o).length;

  // ---- Libellés ----
  const methodLabel = (m, lang) => (langOf(lang) === "fr" ? METHOD_FR[m] || m : m) || "";
  /** Zone : « FAO 27.IV Noordzee » ; une ancienne saisie libre (« FAO 27 IV ») est rendue telle quelle. */
  function zoneLabel(code, lang) {
    const z = ZONE.get(String(code || "").trim());
    if (!z) return txt(code, 120);
    return "FAO " + z.code + " " + (langOf(lang) === "fr" ? z.fr : z.nl);
  }
  const gearLabel = (g, lang) => { const x = GEAR.get(String(g || "").trim()); return x ? x[langOf(lang)] : txt(g, 120); };
  const stateLabel = (s, lang) => (langOf(lang) === "fr" ? STATE_FR[s] || s : s) || "";
  const allergenLabel = (k, lang) => { const a = ALLERGEN.get(k); return a ? a[langOf(lang)] : ""; };
  const allergenList = (keys, lang) => allergensOf(keys).map((k) => allergenLabel(k, lang)).join(", ");
  /** Mention du traitement antiparasitaire, ou "" (rien à imprimer : pas cru, pas de barème, ou « niet van toepassing »). */
  function freezeText(o, lang) {
    if (!o || !o.rauw) return "";
    const x = FREEZE.get(o.vriesbehandeling);
    if (!x || x.key === "Niet van toepassing") return "";
    return langOf(lang) === "fr" ? "Destiné à être consommé cru : " + x.fr + " (traitement contre les parasites)" : "Bestemd om rauw te eten: " + x.nl + " (behandeling tegen parasieten)";
  }

  /**
   * Herkomst en clair, dans l'ordre de l'art. 35 : méthode, zone (ou pays d'élevage), engin.
   * Seulement ce qui est rempli. o : visfiche (fromFields) ou instantané de lot.
   */
  function originParts(o, lang) {
    if (!o) return [];
    const L = langOf(lang);
    const zone = o.vangstgebied ? zoneLabel(o.vangstgebied, L) : "";
    const land = o.landVanKweek ? txt(o.landVanKweek, 80) : "";
    return [methodLabel(o.productiemethode, L), zone, land, o.vistuig ? gearLabel(o.vistuig, L) : ""].filter(Boolean);
  }

  return {
    METHODS, ZONES, GEARS, STATES, ALLERGENS, FREEZES, FIELDS: F,
    faoIn, allergensIn, productIn, fromFields, isEmpty,
    isZone: (z) => ZONE.has(String(z || "")), isGear: (g) => GEAR.has(String(g || "")),
    methodLabel, zoneLabel, gearLabel, stateLabel, allergenLabel, allergenList, freezeText, originParts, langOf
  };
});
