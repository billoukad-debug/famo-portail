# Implementation Plan: Identité « Vismijn »

**Branch**: `claude/brave-lovelace-s4xk7h` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

Re-habillage par les jetons de `assets/ui.css` (noms de variables figés, donc aucun JS à toucher pour les couleurs), plus des corrections ciblées des défauts « générés » et une marque SVG. Accueil : bandeau « marée » calculé par `K.orderWindow` (nouveau, partagé avec le catalogue client : la règle « premier jour livrable » n'existe plus qu'une fois côté navigateur).

## Design plan (skill frontend-design : plan → revue contre le brief → code)

- **Couleurs** : IJs `#EFF3F3` · Diepzee `#0E2229` · Noordzee `#0B5A6C` · Boei `#E2531B` · Kaai `#E4EBEB` · Klei `#B2431A`.
- **Type** : Atkinson Hyperlegible Next, une famille ; 700 titres, 14,5 px corps.
- **Layout** : zone de travail claire, timonerie sombre à gauche (équipe) ; accueil = titre + bandeau sombre + formulaire.
- **Principes** : une seule audace (timonerie + marque) ; la structure porte l'information ; rien de décoratif.
- **Revue contre le générique** : le premier jet reprenait un « hero » avec trois chiffres → remplacé par le bandeau vivant, spécifique à FAMO (heure limite réelle). Un accent orange sur les boutons → refusé : l'orange reste à la marque.

## Technical Context

Aucune dépendance ; police et SVG servis par le site (CSP `font-src 'self'`, `img-src 'self'`) ; outils de contrôle hors dépôt : Impeccable (`npx impeccable detect`), Playwright (captures).

## Constitution Check

- I. Sans build : ✅ CSS/JS/SVG statiques, une feuille (style de l'accueil déplacé dedans).
- II. Le serveur décide : ✅ aucun changement serveur ; `K.orderWindow` n'est qu'un affichage (le serveur valide la date, `lib/levering.js`).
- III. Tests : ✅ `K.orderWindow` testé (avant/après limite, samedi, congé, défauts) ; audits navigateur.
- IV. Terrain : ✅ AA vérifié (`contrast-check` + ux-audit), cibles 44 px inchangées, NL/FR.
- V. Données : ✅ aucune.

## Complexity Tracking

`klant.html` garde son bloc `<style>` (sélecteurs génériques `.row`, risques de collision avec les tableaux de l'équipe) : migration à faire avec I-12.
