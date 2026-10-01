# Tasks: Documents A4 et e-mails redessinés (audit A10)

**Input**: `specs/012-documents-emails/` (spec.md, plan.md)

## Phase 1: Tests d'abord

- [x] T001 [US1] `test/documents.test.js` : taux de TVA par ligne (facture, note, pas sur le bon),
  récapitulatif `.vatsum` par taux, bloc paiement (montant TVAC, échéance), impression (`@page` A4,
  en-tête répété, lignes non coupées), jetons Vismijn seulement, aucune capitale CSS, aucune
  police web / chasse fixe, ordre des blocs, marque F — échouent sur l'ancien rendu
- [x] T002 [US2] `test/ordermail.test.js` : chaque e-mail (ordermail + authmail) passe par le
  gabarit commun (`lib/maillayout.js`), `color-scheme`, texte d'aperçu, fonds explicites, texte
  blanc seulement sur Noordzee, bouton plein, aucune capitale CSS ni Georgia — échouent avant

## Phase 2: User Story 1 - Documents A4 (P1) 🎯 MVP

- [x] T003 [US1] `documents.js` : traductions NL/FR des nouveaux libellés (taux, base, récap, montant)
- [x] T004 [US1] `documents.js` : en-tête deux colonnes (fournisseur + client / titre + faits)
- [x] T005 [US1] `documents.js` : tableau avec colonne taux, récapitulatif TVA, totaux, paiement
- [x] T006 [US1] `documents.js` : mentions (régime, conditions, CGV) et pied légal
- [x] T007 [US1] `documents.js` : CSS (Helvetica/Arial, jetons, `@page`, impression)
- [x] T008 [US1] Rendu Playwright local : facture NL, longue facture (2 pages), note de crédit FR,
  bon de livraison, pro forma, bundle — relu, corrigé, relu

## Phase 3: User Story 2 - E-mails (P1)

- [x] T009 [US2] `lib/maillayout.js` : gabarit commun
- [x] T010 [US2] `lib/ordermail.js` : briques remplacées, texte d'aperçu par e-mail
- [x] T011 [US2] `lib/authmail.js` : même gabarit, aperçu, lien de secours ; « valable 1 heure »
  (et non « 1 heures ») vu sur la capture FR
- [x] T012 [US2] Rendu Playwright local de chaque e-mail (680 / 390 px, simulation d'inversion) — relu

## Phase 4: Polish

- [x] T013 `DESIGN.md` : « Reste à faire » 2 et 3 mis à jour
- [x] T014 `node scripts/assets-version.js`, `node scripts/check.js`, `npx -y eslint@9.39.5 .`
  (codes de sortie vérifiés un par un)
