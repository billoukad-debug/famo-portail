# Implementation Plan: Catalogus — weergave, dichtere regels, navigatie

**Branch**: `worktree-agent-a57627b5acb021eb6` (sur `origin/main` e3eedb7, spec 018) | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

| Partie | Où | Quoi |
|---|---|---|
| Aides pures | `assets/ui.js` | `K.familyKey`, `K.families`, `K.catalogSort`, `K.searchKey`, `K.searchHit`, `K.pref` ; icônes `vlist`, `tiles`, `rows`, `up` ; textes FR |
| Catalogue | `assets/pages/klant.js` | barre d'outils (`.ktools` : recherche + ×, compteur, Sorteren, Weergave, Naar boven, catégories, familles), trois rendus de la même ligne `.prod`, détail en panneau pour Tegels, filtres combinés par masquage, variable `--kt-h` mesurée |
| Mise en page | `assets/ui.css` (+ `klant.html`) | bloc `<style>` de `klant.html` déplacé en fin de feuille (sélecteurs identiques ; `.row` préfixé `.portal-klant`) ; points de rupture 720 / 1100 / 1240 ; container queries sur la liste ; `.seg`, `.fams`, `.ktools`, tuiles |
| Démo | `scripts/seed.js` | grande catégorie Algemeen, Vegetarisch, Surimi, photos d'emballage (PNG générés) |
| Audits | `scripts/ux-audit.js`, `scripts/kbd-audit.js` | catalogue en Lijst / Tegels / Compact à 1280, 990 et 390 ; familles ; barre collante après défilement ; clavier : changer de vue (focus reste, `aria-pressed`), famille, retour en haut, focus jamais sous la barre |
| Tests | `test/catalogus.test.js` | familles, tris, recherche, préférence (stockage bloqué) |

## Décisions

- **Une seule ligne `.prod` pour les trois vues** ; la vue est un attribut `data-view` sur la liste et la CSS
  place les zones (`grid-template-areas`). Seul le bouton du nom change de rôle en Tegels (ouvre un panneau,
  `aria-haspopup="dialog"`, pas d'`aria-expanded`). Changer de vue = redessiner la liste seule.
- **Container queries** (`container-type:inline-size` sur `#list`) : la même vue s'adapte à la largeur réelle
  de la liste (avec ou sans colonnes latérales), sans multiplier les media queries.
- **Barre collante au téléphone** : `.ktools` passe en `display:contents` ; la recherche (`top:0`) et les
  catégories (`top:60px`) collent, le tri / la weergave / les familles défilent. ≥ 720 : `.ktools` entier colle
  sous l'en-tête (64 px) ; sa hauteur est mesurée (`ResizeObserver`) dans `--kt-h` sur `<html>` pour les titres
  de groupe collants et `scroll-padding-top` (2.4.11).
- **« Naar boven » dans la barre** et non flottant : un bouton flottant aurait recouvert la colonne des
  quantités (2.4.11).
- **Familles = filtre** (masquage, comme la recherche), pas une catégorie : l'ordre et les groupes restent.
  Calculées sur la catégorie choisie seulement (pas « Alles » ni « Favorieten » : sur tout le catalogue, une
  famille « Surimi » doublait la catégorie du même nom et la rangée de boutons devenait trop longue).
- **Puces** : boutons rectangulaires rayon 6 (« ce qu'on touche »), pas de pilules (DESIGN.md).
- **Tegels** : photo `object-fit:contain` sur `--soft` (emballages), ratio 4:3 ; le stepper prend la largeur
  de la tuile (2 colonnes au téléphone).

## Constitution Check

- I. Sans build : ✅ JS vanilla, une feuille (`ui.css` ; le `<style>` de `klant.html` y migre), aucun style en
  ligne statique ajouté (les seules écritures `el.style` sont des valeurs calculées : variable `--kt-h`),
  aucune dépendance, `assets-version.js` relancé.
- II. Le serveur décide : ✅ aucun changement serveur ; le tri par prix utilise le prix déjà calculé par
  `/api/catalogue` ; rien n'est envoyé de plus.
- III. Tests d'abord : ✅ `test/catalogus.test.js` (familles, tris, recherche, préférence stockage bloqué) écrit
  avant les aides ; audits navigateur étendus (trois vues, trois largeurs, clavier) ; aucun test désactivé ;
  écritures seulement sur le portail de dev local.
- IV. Terrain : ✅ NL/FR (`K.t` + `K.FR`, test AN10), `aria-pressed` sur la weergave et les familles,
  `role=status` sur le compteur, cibles ≥ 44 px, focus gardé sur l'interrupteur, rien de collant ne cache le
  focus (2.4.11), `prefers-reduced-motion` respecté (défilement « Naar boven »).
- V. Données : ✅ aucun champ, aucune table ; préférences d'affichage par appareil dans `localStorage`
  (try/catch, comportement correct si bloqué) — exactement la règle « Préférences d'interface ».

## Complexity Tracking

- Déplacer le `<style>` de `klant.html` (≈ 70 règles, dette DESIGN.md « Reste à faire » 5) touche les vues non
  catalogue : sélecteurs et ordre conservés (le bloc est ajouté en fin de feuille, là où il s'appliquait) ;
  seul `.row` (aussi utilisé par le personnel) est préfixé `.portal-klant`. Vérifié par captures et ux-audit.
- Plus de produits de démo = parcours clavier plus long : `kbd-audit` parcourt toujours toute la liste (chaque
  arrêt est contrôlé sous la barre collante, 2.4.11) ; son plafond de Tab passe de 160 à 400.
