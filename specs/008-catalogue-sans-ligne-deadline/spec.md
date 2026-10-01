# Feature Specification: Catalogue client sans la ligne « Vóór 22:00 besteld »

**Created**: 2026-10-01 · **Status**: Implemented
**Input**: « Enlève aussi la ligne vóór 22:00 du catalogue. »

## Acceptance
- L'en-tête du catalogue client (téléphone et ordinateur) n'affiche plus que le titre « Catalogus ».
- Inchangé : panier (« Bestel vóór 22:00 voor levering morgen »), choix de la leverdag (`firstDay`, `K.orderWindow`).

## Requirements
- FR-001 : retirer le sous-titre, l'aide `shortDay` devenue inutile et sa traduction FR.

## Success Criteria
- check.js, ESLint, ux-audit, kbd-audit : 0 écart ; captures relues.
