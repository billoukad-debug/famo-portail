# Tasks: Bijwerken découpé (A6), numérotation sans trou inexpliqué (A4)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1 — Tests d'abord (A4)

- [x] T001 `test/nummering.test.js` : 409 plafond concurrent et rejeu idempotent concurrent ne
  consomment pas de numéro CN ; stock illisible ne consomme rien ; écriture FA en échec → ligne
  « Nummer vervallen » ; refus après réservation sans retour possible → ligne au journal ;
  `billing.release` (unité). Constaté rouge sur l'ancien code.

## Phase 2 — Numérotation (A4)

- [x] T002 `lib/billing.js` : `release(series, n)` (écriture conditionnelle, jamais si un numéro a été
  pris depuis)
- [x] T003 `lib/commande/nummering.js` : `vervallen()` (rendre si refus certain, sinon `Journaal` +
  logs)
- [x] T004 Note de crédit : stock avant la réservation, réservation dans `mutate` (moteur SQL), refus →
  `vervallen` ; Airtable : ordre historique
- [x] T005 Facture : écriture en échec ou exception → `vervallen` (jamais rendu)

## Phase 3 — Découpage (A6)

- [x] T006 `lib/commande/{common,lignes,stock,nummering,corrigeren,creditnota,correctiemail,bijwerken}.js`
  (code déplacé tel quel, `require` statiques)
- [x] T007 `api/updateorder.js` : point d'entrée seul (garde, session, verrou, aiguillage, journal) ;
  exports `parseLines` / `formatLine` conservés
- [x] T008 `test/commande-routes.test.js` : taille, garde en première ligne, `require` statiques,
  exports, aiguillage vers un seul module
- [x] T009 Harnais : `clearModule` (workflow-check) et `inst()` (3 tests) rechargent `lib/commande/*`

## Phase 4 — Documentation et portes

- [x] T010 `docs/RUNBOOK.md` § 6 : lire et vérifier une ligne « Nummer vervallen » ; ADR 0004 et
  README alignés (`AGENTS.md` laissé au propriétaire : instructions d'agent)
- [x] T011 `node scripts/assets-version.js`, `node scripts/check.js`, `npx -y eslint@9.39.5 .` : codes de
  sortie vérifiés un par un
