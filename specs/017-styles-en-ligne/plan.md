# Implementation Plan: Derniers styles en ligne vers ui.css (A5)

**Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

## Summary

Migration outillée (script hors dépôt) : chaque `style="…"` statique est découpé en déclarations,
un bloc reconnu devient un composant, le reste un utilitaire ; la classe est fusionnée dans l'attribut
`class` de la balise (ou en crée un). Les formes conditionnelles (`(cond ? ' style="…"' : "")`, classes
construites en JS) sont réécrites à la main en classes conditionnelles.

| Fichier | Changement |
|---|---|
| `assets/ui.css` | bloc « I-12 (suite, A5) » : utilitaires `:where(.x){…!important}`, raccourcis avant propriétés longues ; composants ; `.duo-*` (grilles `#two`) ; `.mb-6` harmonisé (margin-bottom seul) ; sélecteurs morts `.stop>div[style*="flex:1"]` retirés |
| `assets/ui.js` | `K.c.input(id, { cls })` : classe en plus de `input` (champ code de connexion) ; styles des dialogues, squelette, barre latérale |
| `assets/pages/**/*.js`, pages HTML | `style="…"` → classes |
| `scripts/check.js` | 6b : plafond de styles en ligne statiques (7), valeurs calculées exclues |
| `test/workflow/commandes.test.js`, `scripts/kbd-audit.js` | lisaient le balisage : AM5 accepte des classes en plus de `input` sur `#otherDay` ; le klant non sélectionné se trouve par `:not(.bg-p-soft)` au lieu de `[style*='p-soft']` (même intention) |

## Décisions
- **`:where()` + `!important`** : même force qu'un style en ligne, y compris face aux règles `!important`
  de la feuille (un utilitaire de spécificité 0,1,0 placé plus bas les battrait, ex. `mh-38` contre
  `.input{min-height:44px!important}` au tactile). Les utilitaires I-12 existants (0,1,0) ne changent pas.
- **Raccourcis + longues** : `margin:0 0 8px` = `m-0 mb-8`, `padding:0 10px 0 6px` = `px-10 pl-6` (dans ce
  système `px-N` = `padding:0 N`, comme `px-8` existant). L'ordre de la feuille fait gagner la longue.
- **`#two`** : le JS passe la grille à une colonne (`style.gridTemplateColumns = "1fr"` sous 900/1000 px) ;
  le modèle de colonnes (`.duo-2`, `.duo-r320`, `.duo-r340`, `.duo-l300`) reste donc **sans** `!important`.
- **Barre groupée** (`bestellingen.js`) : la variable `st` (attribut style partagé) disparaît au profit de
  `btn-glass` ; bouton blanc `btn-light`.

## Vérification
Captures Playwright (hors dépôt) sur `PORT=4340 FAMO_RESEED=1 node scripts/dev.js`, horloge figée,
mouvement réduit : 50 écrans × 1280/390 px (liste de `ux-audit.js` + barre groupée, sneltoetsen,
Geleverd, creditnota, lots, détail klant, privacy, voorwaarden, offline, aanmelden refusé). Avant/après
dans la même session de serveur ; comparaison des PNG décodés (zlib, RGBA) et du style calculé
(`getComputedStyle`, toutes propriétés) + boîte de chaque élément dans l'ordre du DOM.

**Résultat** : 100 captures ; 99 identiques au pixel et au style calculé près ; 1 écart expliqué
(Journaal 1280 px : 51 px d'anticrénelage dans les pastilles du menu, styles calculés et boîtes
identiques). Bruit mesuré entre deux captures du code d'origine : pastille « nieuw sinds uw laatste
bezoek » (dépend de l'état « vu » créé par la capture précédente) et durées de Systeemstatus (« 0 ms »).
Non couverts : panneau « Ontvangst bevestigen » (aucune commande « Sortie en livraison » dans les données
de démo), états conditionnels jour choisi à la main, ligne hors catalogue de Voorraad, prix négocié
plus bas (relus dans le diff).

## Constitution Check
- I. Sans build, sans dépendance : ✅ une seule feuille `ui.css`, aucun fichier ajouté au front ; principe
  « aucun style en ligne ajouté » désormais vérifié par `check.js`.
- II. Le serveur décide : ✅ aucun code serveur touché.
- III. Tests d'abord, en local : ✅ garde 6b écrite avant la migration, constatée rouge (297 statiques) ;
  captures et audits en local uniquement ; aucune écriture hors local ; aucun test affaibli.
- IV. Terrain : ✅ rendu identique (pixels + styles calculés), cibles 44 px et contrastes inchangés
  (ux-audit, kbd-audit, contrast-check).
- V. Données et conformité : ✅ sans objet (aucun champ, aucune donnée).

## Complexity Tracking
- 13 `style="` restent (spec, « Exceptions justifiées »). Les utilitaires I-12 d'avant gardent leur
  spécificité 0,1,0 (non touchés) : mélange documenté dans `ui.css`.
