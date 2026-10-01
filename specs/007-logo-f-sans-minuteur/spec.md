# Feature Specification: Logo « F » sobre, accueil sans minuteur

**Created**: 2026-09-30 · **Status**: Implemented
**Input**: « Enlève le logo en poisson, génère un F sobre comme logo et enlève le minuteur. »

## User Scenarios & Testing
### User Story 1 (P1) — La marque est un F sobre partout
**Acceptance**: navigation (claire et timonerie), accueil, connexions équipe, documents A4, favicon, icônes PWA : un carré arrondi avec un F géométrique ; plus aucun poisson.
### User Story 2 (P1) — L'accueil n'a plus de minuteur
**Acceptance**: plus de bandeau « Nog x u y min » ; le titre garde l'heure limite réelle (« Vóór 22:00 besteld, morgen in uw keuken. »).

## Requirements
- **FR-001**: mêmes fichiers `assets/brand/famo-mark*.svg` (aucune page à rebrancher), F en tracés (indépendant de la police).
- **FR-002**: retirer le bandeau, son CSS, l'orange « bouée » (plus utilisé) et les traductions mortes.
- **FR-003**: garder `K.orderWindow` (premier jour livrable du catalogue client, testé).

## Success Criteria
- check.js, ESLint, contrast-check, ux-audit, kbd-audit : 0 écart ; captures relues.
