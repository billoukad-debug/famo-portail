# Implementation Plan: Pastilles lues

**Branch**: `claude/brave-lovelace-s4xk7h` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

`K.setBadges` accepte, par pastille, un nombre (comme avant) ou une liste d'identifiants.
Une fonction pure `K.badgeView(valeur, mode, vus, ici)` calcule le nombre affiché et la nouvelle
mémoire « vus ». Mode et « vus » sont en `localStorage` (appareil). Choix : bouton cloche dans
la barre du personnel (panneau), ligne « Tellers » dans Account côté client.

## Technical Context

**Language/Version**: JavaScript navigateur (ES2020), sans build
**Primary Dependencies**: aucune (`assets/ui.js`, objet `K`)
**Storage**: `localStorage` (`famoBadgeMode`, `famoBadgeSeen`) via `K.store` (try/catch)
**Testing**: `test/ui.test.js` (node:test + vm), audits Playwright existants
**Target Platform**: tablettes du dépôt, téléphones, PC
**Constraints**: aucun appel serveur en plus, aucune modification `api/` ou `lib/`

## Constitution Check

- I. Sans build : ✅ code dans `assets/ui.js` + pages existantes, style dans `ui.css`.
- II. Le serveur décide : ✅ préférence d'affichage uniquement, aucune donnée métier.
- III. Tests : ✅ `K.badgeView` testé (modes, vus, compteur sans liste, stockage absent).
- IV. Terrain : ✅ NL personnel, NL/FR client, boutons ≥ 44 px, `aria-pressed`, clavier.
- V. Données : ✅ aucun champ de base ; rien de personnel stocké (identifiants d'enregistrements).

## Project Structure

```text
specs/001-badges-lus/  spec.md · plan.md · tasks.md · checklists/requirements.md
assets/ui.js                  K.badgeView, K.badgeMode, K.badgeSwitch, K.setBadges, cloche du shell
assets/ui.css                 .badgesw (réutilise .lang)
assets/pages/staff-common.js  S.badges : listes d'identifiants
assets/pages/stock.js         (via S.stockBadge) identifiants des articles sous le seuil
assets/pages/klant.js         identifiants des factures à payer ; choix dans Account
test/ui.test.js               tests de K.badgeView
```

## Complexity Tracking

Aucun écart à la constitution.
