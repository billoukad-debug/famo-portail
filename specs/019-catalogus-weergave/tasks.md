# Tasks: Catalogus — weergave, dichtere regels, navigatie
- [x] T001 Spec, plan (Constitution Check), tâches
- [x] T002 Tests d'abord : `test/catalogus.test.js` — `K.familyKey` (casse, 8-12, 16/20, U10, 400-600, 1KG, 2,5 kg, 10x1kg, nr., parenthèses), `K.families` (seuils 12 / 3–12 / ≥ 2, Overige, prolongement, premier mot, repli grossier, ids uniques, ordre), `K.catalogSort` (4 modes, prix absent), `K.searchKey` / `K.searchHit`, `K.pref` (valide, inconnu, stockage absent, stockage qui lève) — en échec avant le code
- [x] T003 `assets/ui.js` : aides pures, icônes `vlist` / `tiles` / `rows` / `up`, textes FR
- [x] T004 `assets/ui.css` : bloc `<style>` de `klant.html` déplacé (fin de feuille, `.portal-klant .row`) ; points de rupture 720 / 1100 / 1240 ; `.ktools`, `.seg`, `.fams`, `.ks-x`, `.totop` ; vues Lijst / Tegels / Compact (container queries) ; titres de groupe collants ; `scroll-padding` (2.4.11)
- [x] T005 `assets/pages/klant.js` : barre d'outils, compteur, ×, Sorteren, Weergave (liste seule redessinée, focus gardé), familles, Naar boven, détail en panneau (Tegels), `--kt-h`
- [x] T006 `scripts/seed.js` : Algemeen 22 produits (kaliber dans le nom), Vegetarisch, Surimi, photos d'emballage
- [x] T007 `scripts/ux-audit.js` : trois vues × 1280 / 990 / 390, familles, barre après défilement ; `scripts/kbd-audit.js` : weergave au clavier, famille, Naar boven, liste entière jusqu’à « Bestellen » (plafond 400 Tab)
- [x] T008 Captures (trois vues × trois largeurs, familles, barre collante) relues et corrigées
- [x] T009 Portes : assets-version, check.js, ESLint, contrast-check, ux-audit → kbd-audit (données neuves) ; AGENTS.md / DESIGN.md à jour
