# Plan : x30 lot C « accueil public »

## Fichiers
- `assets/tij.js` (nouveau, module PUR `window.FamoTij`, testé en Node comme `assets/vandaag.js`) : heure de Bruxelles,
  prochain jour livré, date limite, minutes restantes, créneau optionnel, durée « 3 u 12 » / « 3 h 12 ».
- `assets/pages/start.js` : rendu de la page (en-tête, bandeau, héros, comptoir, fiche exemple, étapes, connexion,
  contact, pied de page) ; la logique de connexion est reprise telle quelle.
- `index.html` : même page en HTML statique (néerlandais, sans JavaScript), `<head>` mis à jour, JSON-LD, préchargement
  de la police serif, `assets/tij.js` chargé avant `start.js`.
- `assets/ui.css` : un bloc « x30 lot C » (classes `ac-*`, variable `--serif`) en fin de feuille + deux `@font-face`.
- `assets/ui.js` : traductions FR des nouveaux textes, dans un bloc `Object.assign(K.FR, …)` commenté « x30 lot C ».
- `assets/fonts/instrument-serif-latin-400-normal.woff2`, `…-400-italic.woff2`, `OFL-instrument-serif.txt`.
- `assets/nieuws.js`, `DESIGN.md` (deux voix typographiques, accueil), `AGENTS.md` (ligne 037).
- `test/x30-accueil.test.js`.

## Constitution Check
- I. Sans build ni dépendance : HTML + JS vanilla ; la police est un fichier copié du paquet officiel, pas une
  dépendance ; une seule feuille (`ui.css`), un seul module partagé (`ui.js`) + un module pur de page comme
  `vandaag.js` ; aucun style en ligne (`check.js`). OK.
- II. Le serveur décide : aucun changement dans `api/` ni `lib/`. Le bandeau reprend la règle de `lib/levering.js`
  pour l'affichage ; le serveur reste seul juge à la commande. OK.
- III. Tests d'abord, en local : `test/x30-accueil.test.js` écrit avant le code ; aucune écriture vers la production
  (la vérification se fait sur `scripts/dev.js`, localhost). OK.
- IV. NL/FR (`K.t` + `K.FR`), WCAG 2.2 AA (contrastes rendus contrôlés par `ux-audit.js`), cibles ≥ 44 px, clavier
  (`kbd-audit.js`), `prefers-reduced-motion`. OK.
- V. Aucune donnée nouvelle, aucun champ de schéma. OK.

## Complexity Tracking
- Deuxième famille de police (serif) : écart volontaire à « une seule famille » de `DESIGN.md`, demandé par l'audit x30
  (§ 3.1.7) ; limité aux titres et grands chiffres de l'accueil ; DESIGN.md amendé.
