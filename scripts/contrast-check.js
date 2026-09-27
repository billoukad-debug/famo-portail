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
  ["line-input", "card", 3, "bordure des champs (WCAG 1.4.11)"], ["line-input", "canvas", 3, "bordure des champs (fond crème)"], ["p", "canvas", 3, "anneau de focus"]
];
let bad = 0;
for (const [fg, bg, min, use] of PAIRS) {
  if (!T[fg] || !T[bg]) { console.log("?  " + fg + " / " + bg + " : variable absente"); bad++; continue; }
  const r = ratio(fg, bg), ok = r >= min;
  if (!ok) bad++;
  console.log((ok ? "✓ " : "✗ ") + r.toFixed(2).padStart(5) + " ≥ " + min + "  " + (fg + " / " + bg).padEnd(28) + use);
}
console.log(bad ? "\n" + bad + " couple(s) sous le seuil AA." : "\nTous les couples passent AA.");
process.exit(bad ? 1 : 0);
