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

  return { r2, num, totals, net, rateFrom, validRate, DEFAULT_RATE, regime, REGIME_KEYS };
});
