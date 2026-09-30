# Tasks: Régime TVA par client et contrôle VIES

**Input**: `specs/003-regime-tva-vies/` (spec.md, plan.md)

## Phase 1: Foundational (tests d'abord)

- [x] T001 [US1][US2][US3] Tests `test/btw-regime.test.js` (SQLite en mémoire) : validation régime ↔
  numéro, facture figée à 0 % + régime, document client, UBL K/G/AE, VIES mocké (succès, échec,
  indisponible, délai, droits), effacement VIES, RGPD — échouent sans le code
- [x] T002 [P] [US1] Tests documents `test/documents.test.js` : mention NL/FR, 0 % forcé, Normal inchangé
- [x] T003 [US1] `assets/vat.js` : table `REGIMES` + `regime()` (taux 0, catégorie, motif, mentions, libellé)
- [x] T004 [US1][US2] `lib/billing.js` : `parseVat`, `beCompanyNo`, `regimeOf`, `regimeProblem`,
  `linesRates(…, regime)`

## Phase 2: User Story 1 - Facturer à 0 % avec la bonne mention (P1) 🎯 MVP

- [x] T005 [US1] `api/updateorder.js` : client lu avec la facturation, AVANT le numéro ; 503 si
  illisible ; taux 0 + `Régime TVA` figés sur la commande
- [x] T006 [P] [US1] `api/allorders.js`, `api/klantdoc.js`, `api/orders.js` : `btwRegime` et taux selon le régime
- [x] T007 [P] [US1] `documents.js` : taux 0 forcé, mention dans la langue du client
- [x] T008 [P] [US1] `assets/pages/staff-common.js` (`S.btwPerLine`) et `assets/pages/documenten.js` (colonne CSV)
- [x] T009 [US1] `lib/ubl.js` : catégories K/G/AE + motifs, acheteur étranger, livraison K, note, contrôles
- [x] T010 [US1] `scripts/workflow-check.js` : réponses simulées de la facturation (client lu avant le numéro)

## Phase 3: User Story 2 - Régime cohérent (P1)

- [x] T011 [US2] `api/onboarding.js` saveClient : régime, validation (400 NL), régime dans `statusPayload`
- [x] T012 [US2] `assets/pages/beheer.js` : select « Btw-regime » + aide, régime sur la fiche

## Phase 4: User Story 3 - Contrôle VIES (P2)

- [x] T013 [US3] `lib/vies.js` : API REST officielle, délai 8 s, erreurs → 503/400
- [x] T014 [US3] `api/onboarding.js` : action `checkVies` (beheerder), stockage, effacement si numéro
  changé, journal
- [x] T015 [US3] `assets/pages/beheer.js` : bouton « Controleren via VIES », résultat `aria-live`

## Phase 5: Polish

- [x] T016 `docs/SCHEMA.md` + `scripts/fake-airtable.js` : nouveaux champs et valeurs
- [x] T017 `node scripts/assets-version.js`, `node scripts/check.js`, ESLint (codes de sortie un par un)
- [x] T018 ux-audit + kbd-audit contre `node scripts/dev.js` si Playwright est disponible
