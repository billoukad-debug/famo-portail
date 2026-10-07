/* global module, self */
// Montants et TVA : UNE règle pour tout le portail (écran, documents, e-mails, CSV, UBL, rapportage).
// Chargé tel quel par le navigateur (window.FamoVat) et par le serveur (require("../assets/vat.js")).
//
// Règle EN 16931 / Peppol BIS 3.0, celle que le comptable et Billtobox recalculent :
//   montant de ligne = quantité × prix unitaire, arrondi au cent ;
//   base par taux     = somme des montants de ligne de ce taux ;
//   TVA par taux      = base × taux / 100, arrondie au cent ;
//   total TVAC        = somme des bases + somme des TVA.
// Avant, l'écran arrondissait par taux, les documents via toFixed et les e-mails sur le total brut :
// un centime d'écart entre écran, facture et e-mail (audit B-08).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FamoVat = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Arrondi commercial au cent, symétrique pour les montants négatifs (retours, notes de crédit).
  // Le petit décalage absorbe les erreurs binaires (1,005 → 1,01 et non 1,00).
  const r2 = (n) => { const v = Number(n) || 0; const s = v < 0 ? -1 : 1; return s * Math.round(Math.abs(v) * 100 + 1e-6) / 100; };
  const num = (v) => { const n = Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const DEFAULT_RATE = 6; // poisson, crustacés, mollusques (KB nr. 20, tableau A, rubrique III)

  // Taux valide : nombre ≥ 0 (0 accepté : export, intra-UE). Sinon le taux par défaut.
  function validRate(r, fallback) { const n = Number(r); if (Number.isFinite(n) && n >= 0 && r !== "" && r !== null && r !== undefined) return n; return fallback == null ? DEFAULT_RATE : fallback; }

  // Taux d'une ligne depuis une table { "nom de produit (minuscules)": taux }.
  function rateFrom(map, name, fallback) {
    if (!map || typeof map !== "object") return validRate(null, fallback);
    const key = String(name || "").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(map, key)) return validRate(map[key], fallback);
    const found = Object.keys(map).find((k) => String(k).trim().toLowerCase() === key);
    return found == null ? validRate(null, fallback) : validRate(map[found], fallback);
  }

  // lines : [{ name, qty, price }] (price = prix unitaire HT, null = ligne sans prix).
  // rateOf : fonction(nom) → taux ; sign : -1 pour un retour / une note de crédit.
  function totals(lines, rateOf, sign) {
    const k = sign === -1 ? -1 : 1;
    const out = [];
    const acc = new Map();
    (lines || []).forEach((l) => {
      if (l == null || l.price == null || l.price === "") { out.push(Object.assign({}, l, { amount: null, rate: null })); return; }
      const qty = num(l.qty), price = num(l.price);
      const amount = r2(qty * price * k);
      const rate = typeof rateOf === "function" ? validRate(rateOf(l.name), DEFAULT_RATE) : DEFAULT_RATE;
      acc.set(rate, (acc.get(rate) || 0) + amount);
      out.push(Object.assign({}, l, { amount, rate }));
    });
    const groups = Array.from(acc.entries()).sort((a, b) => a[0] - b[0]).map(([rate, base]) => {
      const b = r2(base);
      return { rate, base: b, tva: r2(b * rate / 100) };
    });
    const htva = r2(groups.reduce((s, g) => s + g.base, 0));
    const tva = r2(groups.reduce((s, g) => s + g.tva, 0));
    return { lines: out, groups, htva, tva, total: r2(htva + tva) };
  }

  // Total HT d'une commande (ce que le serveur stocke dans « Total ») : somme des lignes arrondies.
  function net(lines) { return r2((lines || []).reduce((s, l) => s + (l && l.price != null ? r2(num(l.qty) * num(l.price)) : 0), 0)); }

  // Régime de TVA du client (audit C-10). Valeur stockée en français (Clients / Commandes
  // « Régime TVA ») ; absente ou inconnue = « Normal » (taux par produit, aucune mention).
  // Les trois autres : 0 % sur toute la facture, catégorie UBL (EN 16931, UNCL5305), motif
  // d'exonération (liste CEF VATEX) et mention légale du document dans la langue du client.
  // Mentions À VALIDER PAR LE COMPTABLE (specs/003-regime-tva-vies/spec.md, « Assumptions ») :
  // livraison intracommunautaire de BIENS = exonération (art. 138 directive, 39bis CTVA), pas
  // l'autoliquidation des services (art. 196).
  const REGIMES = {
    Normal: { zero: false, ubl: "", reasonCode: "", label: "Normaal – Belgische btw", short: "Normaal", nl: "", fr: "" },
    Intracommunautaire: {
      zero: true, ubl: "K", reasonCode: "VATEX-EU-IC", label: "Intracommunautaire levering (EU-klant, 0 %)", short: "Intracommunautair",
      nl: "Vrijgesteld van btw – intracommunautaire levering (art. 39bis, eerste lid, 1° WBTW – art. 138 Richtlijn 2006/112/EG).",
      fr: "Exonération de TVA – livraison intracommunautaire (art. 39bis, alinéa 1er, 1° CTVA – art. 138 directive 2006/112/CE)."
    },
    Export: {
      zero: true, ubl: "G", reasonCode: "VATEX-EU-G", label: "Uitvoer buiten de EU (0 %)", short: "Uitvoer",
      nl: "Vrijgesteld van btw – uitvoer buiten de Europese Unie (art. 39, § 1 WBTW – art. 146 Richtlijn 2006/112/EG).",
      fr: "Exonération de TVA – exportation hors de l'Union européenne (art. 39, § 1er CTVA – art. 146 directive 2006/112/CE)."
    },
    Cocontractant: {
      zero: true, ubl: "AE", reasonCode: "VATEX-EU-AE", label: "Verlegging van heffing – medecontractant (0 %)", short: "Medecontractant",
      nl: "Verlegging van heffing – btw te voldoen door de medecontractant (art. 51, § 2 WBTW – art. 20 KB nr. 1).",
      fr: "Autoliquidation – TVA due par le cocontractant (art. 51, § 2 CTVA – art. 20 AR n° 1)."
    }
  };
  const REGIME_KEYS = Object.keys(REGIMES);
  function regime(v) {
    const s = String(v == null ? "" : v).trim().toLowerCase();
    const key = REGIME_KEYS.find((k) => k.toLowerCase() === s) || "Normal";
    return Object.assign({ key }, REGIMES[key]);
  }

  // ---- Verpakking / verkoopeenheid (specs/023-verpakking) ----------------------------------------
  // Le prix reste le prix PAR UNITÉ et la ligne reste comptée en unités (« Eieren × 12 pièce [€1.00] ») :
  // le conditionnement n'est qu'une façon de la lire (« 2 doos × 6 st = 12 st »). Même règle à l'écran,
  // sur les documents, dans les e-mails et sur le serveur (validation, UBL).
  // Source : champs du catalogue (« Per verpakking », « Verpakking », « Enkel per verpakking »), entrée
  // figée de « Lignes JSON » ({ per, verpakking }) ou produit de l'API ({ per, verpakking, enkel }).
  const PAK_MAX = 1000;
  const pick = (o, a, b) => (o[a] !== undefined && o[a] !== null ? o[a] : o[b]);
  function pakOf(src) {
    if (!src || typeof src !== "object") return null;
    const raw = pick(src, "Per verpakking", "per");
    const per = typeof raw === "number" ? raw : (typeof raw === "string" && /^\s*\d+([.,]\d+)?\s*$/.test(raw) ? num(raw) : NaN);
    if (!(per > 1) || per > PAK_MAX) return null;
    const label = String(pick(src, "Verpakking", "verpakking") || "").trim().slice(0, 30) || "doos";
    const out = { per: Math.round(per * 1000) / 1000, label, only: !!pick(src, "Enkel per verpakking", "enkel") };
    // Détail « 12 × 0,8 kg » (retour Mohsen) : nombre de pièces du conditionnement, le poids total reste « per ».
    const stuks = pick(src, "Stuks per verpakking", "stuks");
    if (typeof stuks === "number" && Number.isInteger(stuks) && stuks > 1 && stuks <= PAK_MAX * 10) out.stuks = stuks;
    return out;
  }
  // Saisie du conditionnement (Beheer) : « 9,6 » → { per: 9.6 } ; « 12 x 0,8 », « 0,8 × 12 », « 12*0,8 kg »
  // → { per: 9.6, stuks: 12 } (12 pièces de 0,8 kg ; deux entiers : le premier compte les pièces). Sinon null.
  function pakParse(raw) {
    const t = String(raw == null ? "" : raw).trim().toLowerCase().replace(/\s*kg$/, "");
    const n = "(\\d+(?:[.,]\\d+)?)";
    let m = new RegExp("^" + n + "$").exec(t);
    if (m) { const per = num(m[1]); return per > 0 ? { per: Math.round(per * 1000) / 1000 } : null; }
    m = new RegExp("^" + n + "\\s*[x×*]\\s*" + n + "$").exec(t);
    if (!m) return null;
    const a = num(m[1]), b = num(m[2]);
    if (!(a > 0) || !(b > 0)) return null;
    const stuks = Number.isInteger(a) ? a : Number.isInteger(b) ? b : null;
    if (stuks == null) return null;
    const per = Math.round(a * b * 1000) / 1000;
    return stuks > 1 ? { per, stuks } : { per };
  }
  const EPS = 1e-9;
  // Quantité = nombre entier de conditionnements (sans conditionnement : toujours vrai).
  function pakFits(qty, p) { if (!p) return true; const n = num(qty) / p.per; return Math.abs(n - Math.round(n)) < EPS; }
  function pakSplit(qty, p) { const q = num(qty), n = Math.floor(q / p.per + EPS); return { n, rest: Math.round((q - n * p.per) * 1000) / 1000 }; }
  // Mots d'unité (valeur stockée en français, comme famoNL) : [singulier, pluriel, abrégé].
  const UNIT_WORDS = {
    nl: { "pièce": ["stuk", "stuks", "st"], kg: ["kg", "kg", "kg"], caisse: ["kassa", "kassa's", "kassa"], carton: ["doos", "dozen", "doos"] },
    fr: { "pièce": ["pièce", "pièces", "pc"], kg: ["kg", "kg", "kg"], caisse: ["caisse", "caisses", "caisse"], carton: ["carton", "cartons", "carton"] }
  };
  const unitKey = (u) => { const s = String(u || "").trim().toLowerCase(); return s === "piece" || s === "stuk" ? "pièce" : s === "kassa" ? "caisse" : s === "doos" ? "carton" : s; };
  const fmtQ = (q, lang) => { const n = Math.round(num(q) * 1000) / 1000; return lang === "fr" || lang === "nl" ? String(n).replace(".", ",") : String(n); };
  function pakUnit(qty, unit, lang, short) {
    const w = (UNIT_WORDS[lang === "fr" ? "fr" : "nl"])[unitKey(unit)];
    if (!w) return String(unit || "");
    return short ? w[2] : w[Math.abs(num(qty) - 1) < EPS ? 0 : 1];
  }
  // Libellé libre (Beheer, en néerlandais) ; en français, les mots courants sont traduits.
  const LABEL_FR = { doos: ["carton", "cartons"], dozen: ["carton", "cartons"], kist: ["caisse", "caisses"], kisten: ["caisse", "caisses"], zak: ["sac", "sacs"], zakken: ["sac", "sacs"], tray: ["plateau", "plateaux"], trays: ["plateau", "plateaux"], bak: ["bac", "bacs"], bakken: ["bac", "bacs"], schaal: ["barquette", "barquettes"], schalen: ["barquette", "barquettes"], emmer: ["seau", "seaux"], net: ["filet", "filets"], pak: ["paquet", "paquets"], pakket: ["paquet", "paquets"], karton: ["carton", "cartons"], doosje: ["boîte", "boîtes"] };
  function pakLabel(label, n, lang) {
    const l = String(label || "doos");
    if (lang !== "fr") return l;
    const t = LABEL_FR[l.trim().toLowerCase()];
    return t ? t[Math.abs(num(n)) > 1 ? 1 : 0] : l;
  }
  // « doos van 6 » · « kist van 5 kg » · « carton de 6 ».
  function pakOne(p, unit, lang) {
    if (!p) return "";
    const k = unitKey(unit), u = k === "pièce" ? "" : " " + pakUnit(p.per, unit, lang);
    const head = pakLabel(p.label, 1, lang) + (lang === "fr" ? " de " : " van ");
    if (p.stuks && k === "kg") return head + p.stuks + " × " + fmtQ(p.per / p.stuks, lang) + u + " (" + fmtQ(p.per, lang) + u + ")";
    return head + fmtQ(p.per, lang) + u;
  }
  // « 2 doos · 12 stuks » · « 2 doos + 2 st · 14 stuks » · « 4 stuks » (moins d'un conditionnement).
  function pakQty(qty, unit, p, lang) {
    const total = fmtQ(qty, lang) + " " + pakUnit(qty, unit, lang);
    if (!p) return total;
    const s = pakSplit(qty, p);
    if (!s.n) return total;
    return s.n + " " + pakLabel(p.label, s.n, lang) + (s.rest > 0 ? " + " + fmtQ(s.rest, lang) + " " + pakUnit(s.rest, unit, lang, true) : "") + " · " + total;
  }
  // Ligne de document : « 2 doos × 6 st = 12 st » (+ « × € 1,00 = € 12,00 » si price et fmt sont donnés :
  // prix au cent, ligne arrondie au cent, comme totals()). Moins d'un conditionnement : "".
  function pakCalc(qty, unit, p, lang, price, fmt) {
    if (!p) return "";
    const s = pakSplit(Math.abs(num(qty)), p);
    if (!s.n) return "";
    const st = (q) => fmtQ(q, lang) + " " + pakUnit(q, unit, lang, true);
    let out = s.n + " " + pakLabel(p.label, s.n, lang) + " × " + st(p.per) + (s.rest > 0 ? " + " + st(s.rest) : "") + " = " + st(Math.abs(num(qty)));
    if (price != null && price !== "" && typeof fmt === "function") { const pr = r2(num(price)); out += " × " + fmt(pr) + " = " + fmt(r2(num(qty) * pr)); }
    return out;
  }

  return { r2, num, totals, net, rateFrom, validRate, DEFAULT_RATE, regime, REGIME_KEYS, pakOf, pakParse, pakFits, pakSplit, pakUnit, pakLabel, pakOne, pakQty, pakCalc, PAK_MAX };
});
