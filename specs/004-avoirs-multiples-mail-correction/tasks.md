# Tasks: Plusieurs notes de crédit par facture et e-mail de correction

**Input**: `specs/004-avoirs-multiples-mail-correction/` (spec.md, plan.md)

## Phase 1: Tests d'abord

- [x] T001 [US1] [US2] `test/creditnotas.test.js` (SQLite en mémoire) : lecture ancienne/nouvelle forme,
  N notes numérotées, plafond cumulé par article et par taux (arrondi), retour en stock une fois
  (clé), deux instances simultanées, ancienne commande, portail client, UBL `&cn=`, relances et
  marge, « Correctie mailen » sans clé e-mail — échouent sans le code (modules absents)
- [x] T002 [US3] `test/correctiemail.test.js` (SQLite + Resend simulé) : différences avant/après,
  e-mail NL/FR, copie interne `/order.html?id=`, journal, double clic, deux instances, note de
  crédit, envoi raté libéré, sans adresse, annulée, sans session

## Phase 2: Foundational

- [x] T003 `lib/creditnota.js` : `list`, `totalMontant`, `patchFor`, `renumberPatch`, `byKey`, `check`
- [x] T004 `lib/atomic.js` : `mutate` (lecture → décision → écriture conditionnelle)
- [x] T005 [P] `lib/correctie.js` : `baseline`, `diffLines`, `changes`, `snapshot`
- [x] T006 [P] Schéma : `docs/SCHEMA.md` + `scripts/fake-airtable.js` (`Creditnotas`, `Correctiemail`)

## Phase 3: User Story 1 - Plusieurs notes par facture (P1) 🎯 MVP

- [x] T007 [US1] `api/updateorder.js` makeCreditnota : N notes, plafond cumulé, clé d'idempotence,
  écriture conditionnelle, retour en stock de la seule note
- [x] T008 [US1] Numérotation : `maxNumber` lit aussi le JSON ; `ensureUniqueCN` (Airtable) aux deux endroits
- [x] T009 [US1] `scripts/workflow-check.js` bloc AQ5 : « une seule note » remplacé par « deuxième note + plafond »
- [x] T010 [US1] `assets/pages/staff-common.js` : `S.cns`, `S.withCn`, `S.cnRest`, liste des notes,
  bouton « Nog een creditnota », panneau (reste à créditer, clé), impression par note
- [x] T011 [P] [US1] `assets/pages/order.js` : carte « Creditnota's (n) », journal, documents par note
- [x] T012 [P] [US1] `assets/pages/bestellingen.js`, `assets/pages/beheer.js` (rapport annuel : toutes les notes)

## Phase 4: User Story 2 - Client et comptable (P1)

- [x] T013 [US2] `api/allorders.js`, `api/orders.js`, `api/klantdoc.js` : `creditnotas`
- [x] T014 [US2] `api/export.js` : UBL `&cn=<numéro>` (défaut : première note)
- [x] T015 [US2] `assets/pages/documenten.js` : une ligne par note, Boekhouding CSV et Facturen CSV,
  UBL facture + notes
- [x] T016 [US2] `assets/pages/klant.js` : toutes les notes, « Openen » par note (FR/NL) ; clé FR dans `assets/ui.js`
- [x] T017 [P] [US2] `lib/reminders.js`, `lib/margin.js` : toutes les notes

## Phase 5: User Story 3 - « Correctie mailen » (P2)

- [x] T018 [US3] `lib/ordermail.js` : textes NL/FR, `buildCorrectionMail`, `buildCorrectionTeamMail`, `notifyCorrection`
- [x] T019 [US3] `api/updateorder.js` : `{ correctieMail: true }` → réservation, envoi, libération si échec, journal
- [x] T020 [US3] `assets/pages/staff-common.js` + `order.js` : `S.correctieNodig`, bouton « Correctie mailen »,
  proposition dans le toast après une note de crédit

## Phase 6: Polish

- [x] T021 Classes `.cn-*` / `.doc-row` à la fin de `assets/ui.css` (aucun jeton touché), `node scripts/assets-version.js`
- [x] T022 `node scripts/check.js`, `npx -y eslint@9.39.5 .`
- [x] T023 ux-audit + kbd-audit contre `node scripts/dev.js` (reseed, port local), essai manuel Playwright
  (deux notes, PDF par note, « Correctie mailen », portail client)
