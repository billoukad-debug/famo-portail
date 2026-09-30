# Tasks: Pastilles lues

**Input**: `specs/001-badges-lus/` (spec.md, plan.md)

## Phase 1: Foundational

- [x] T001 [US1] Tests de `K.badgeView` dans `test/ui.test.js` (échouent sans le code)
- [x] T002 [US1] `K.badgeView`, `K.badgeMode`, mémoire « vus » et nouveau `K.setBadges` dans `assets/ui.js`

## Phase 2: User Story 1 - La pastille disparaît une fois la page ouverte (P1) 🎯 MVP

- [x] T003 [P] [US1] `S.badges` / `S.stockBadge` passent des listes d'identifiants (`assets/pages/staff-common.js`)
- [x] T004 [P] [US1] Client : identifiants des factures à payer (`assets/pages/klant.js`)
- [x] T005 [US1] « Ici » = lien de la pastille actif (`aria-current` ou `.on`), onglet visible

## Phase 3: User Story 2 - Choisir le comportement (P2)

- [x] T006 [US2] `K.badgeSwitch()` + gestion des clics `[data-badgemode]` (`assets/ui.js`, `assets/ui.css`)
- [x] T007 [US2] Cloche dans la barre du personnel → panneau « Tellers in het menu »
- [x] T008 [US2] Ligne « Tellers in het menu » dans Account (NL/FR, `K.FR`)

## Phase 4: Polish

- [x] T009 `node scripts/assets-version.js`, `node scripts/check.js`, ESLint
- [x] T010 ux-audit + kbd-audit contre `node scripts/dev.js` (reseed)
- [x] T011 `docs/CHECKLIST-UX.md` / README : mention des modes
