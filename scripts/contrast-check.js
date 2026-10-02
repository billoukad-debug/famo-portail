#!/usr/bin/env node
"use strict";
// ACC-05 (docs/CHECKLIST-UX.md) : contraste WCAG 2.2 des couples texte / fond réellement utilisés,
// lus dans les variables :root de assets/ui.css. AA : 4,5 pour le texte courant, 3 pour le grand texte
// et les éléments d'interface (bordures de champ, icônes, anneau de focus).
//   node scripts/contrast-check.js      (sortie 1 si un couple échoue)
const fs = require("fs");
const path = require("path");
const css = fs.readFileSync(path.join(__dirname, "..", "assets", "ui.css"), "utf8");
const root = (css.match(/:root\s*\{([^}]*)\}/) || [])[1] || "";
const T = {}; root.replace(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})/gi, (m, k, v) => { T[k] = v; return m; });
T.white = "#FFFFFF";
const rgb = h => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
const lum = h => { const [r, g, b] = rgb(h).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(T[a]), y = lum(T[b]); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// [texte, fond, minimum, usage]
const PAIRS = [
  ["ink", "canvas", 4.5, "texte principal"], ["ink", "card", 4.5, "texte des cartes"],
  ["ink-2", "canvas", 4.5, "texte secondaire"], ["ink-2", "card", 4.5, "texte secondaire (carte)"], ["ink-2", "soft", 4.5, "texte secondaire (zone douce)"],
  ["ink-3", "canvas", 4.5, "texte discret"], ["ink-3", "card", 4.5, "texte discret (carte)"], ["ink-3", "th-bg", 4.5, "en-tête de tableau"],
  ["p", "card", 4.5, "liens"], ["p", "canvas", 4.5, "liens (fond crème)"], ["p-deep", "p-soft", 4.5, "sélection (onglet actif)"],
  ["white", "p", 4.5, "bouton principal"], ["white", "danger", 4.5, "bouton destructif"],
  ["danger", "card", 4.5, "message d'erreur"], ["danger", "danger-bg", 4.5, "alerte"], ["klei", "card", 4.5, "« uw prijs »"],
  ["st-new-ink", "st-new-bg", 4.5, "statut Ontvangen"], ["st-ready-ink", "st-ready-bg", 4.5, "statut Klaar"], ["st-road-ink", "st-road-bg", 4.5, "statut Onderweg"],
  ["st-done-ink", "st-done-bg", 4.5, "statut Geleverd"], ["st-inv-ink", "st-inv-bg", 4.5, "statut Gefactureerd"],
  ["line-input", "card", 3, "bordure des champs (WCAG 1.4.11)"], ["line-input", "canvas", 3, "bordure des champs (fond crème)"], ["p", "canvas", 3, "anneau de focus"],
  // Couples relevés par le contrôle du rendu (evidence G-07 / G-16) : ce que l'écran affiche vraiment.
  ["p-deep", "p-soft", 4.5, "choix .opt / catégorie sélectionnés"], ["ink-2", "p-soft", 4.5, "texte discret sur une ligne choisie"],
  ["white", "p", 4.5, "barre panier, connexion équipe (sans opacité)"], ["white", "ink", 4.5, "toast"], ["p-soft", "ink", 4.5, "action d'un toast"],
  ["p-soft", "danger", 4.5, "action d'un toast d'erreur"], ["white", "p-deep", 4.5, "bouton principal survolé"],
  ["line-input", "card", 3, "contour de la recherche et des filtres (.search, dates van / tot)"], ["p", "card", 3, "anneau du champ quantité (stepper)"],
  // Rapportage (spec 022) : marques des graphiques contre la carte (WCAG 1.4.11) — barres (--p) et comparaison.
  ["p", "card", 3, "barres et colonnes des graphiques"], ["chart-prev", "card", 3, "ligne « un an plus tôt » des graphiques"], ["p-deep", "card", 3, "barre survolée ou focalisée"]
];
// Le rendu réel (opacités, fonds superposés) est vérifié par scripts/ux-audit.js (ACC-05) sur chaque écran.
let bad = 0;
for (const [fg, bg, min, use] of PAIRS) {
  if (!T[fg] || !T[bg]) { console.log("?  " + fg + " / " + bg + " : variable absente"); bad++; continue; }
  const r = ratio(fg, bg), ok = r >= min;
  if (!ok) bad++;
  console.log((ok ? "✓ " : "✗ ") + r.toFixed(2).padStart(5) + " ≥ " + min + "  " + (fg + " / " + bg).padEnd(28) + use);
}
// Variante « hoog contrast » (:root[data-contrast="hoog"]) : mêmes couples, seuils relevés à AAA
// (7 pour le texte, 4,5 pour les lignes, icônes et focus).
const hoog = (css.match(/:root\[data-contrast="hoog"\]\s*\{([^}]*)\}/) || [])[1] || "";
if (!hoog) { console.log("?  variante hoog contrast absente de ui.css"); bad++; }
const T0 = Object.assign({}, T);
hoog.replace(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})/gi, (m, k, v) => { T[k] = v; return m; });
console.log("\nHoog contrast (AAA) :");
for (const [fg, bg, min, use] of PAIRS) {
  const need = min >= 4.5 ? 7 : 4.5, r = ratio(fg, bg), ok = r >= need;
  if (!ok) bad++;
  console.log((ok ? "✓ " : "✗ ") + r.toFixed(2).padStart(5) + " ≥ " + need + "  " + (fg + " / " + bg).padEnd(28) + use);
}
Object.assign(T, T0);
console.log(bad ? "\n" + bad + " couple(s) sous le seuil (AA, ou AAA en hoog contrast)." : "\nTous les couples passent AA, et AAA en hoog contrast.");
process.exit(bad ? 1 : 0);
