# Tasks: PIN personnels seuls

**Input**: `specs/005-pin-personnels-seuls/` (spec.md, plan.md)

## Phase 1: Tests d'abord

- [x] T001 [US1] [US2] [US3] `test/pinonly.test.js` (SQLite en mémoire) : activation refusée sans
  beheerder PIN active (409, rien écrit, personne déconnecté) ; activation → codes partagés
  refusés (401 générique, échec compté), PIN accepté au nom, sessions par code partagé révoquées,
  cookie renouvelé pour le beheerder PIN ; journal « saveEnkelPin » au nom de la personne ;
  dernière beheerder protégée ; secours `ADMIN_CODE` (page Beheer seulement, « Noodtoegang »,
  log d'erreur, journal) ; code beheerder enregistré refusé ; désactivation → codes partagés
  rouverts. Vérifier qu'il échoue sans le code.

## Phase 2: Serveur (US1, US2, US3)

- [x] T002 [US3] `breakGlass(code, stored)` dans `lib/staffauth.js` (fail-closed, contrôle
  textuel de `check.js` respecté)
- [x] T003 [US1] [US3] `api/session.js` : lecture de `Enkel persoonlijke PIN` (+ dernier état
  connu), refus des codes partagés, secours journalisé (`lib/log.js` + `lib/journal.js`),
  message 429 sans teamcode quand l'option est active
- [x] T004 [US1] [US2] `api/onboarding.js` : `config.enkelPin`, action `saveEnkelPin` (409 sans
  beheerder PIN, génération +1, cookie renouvelé pour une session PIN), journal via l'enveloppe
- [x] T005 [US2] `api/onboarding.js` : `saveMedewerker` / `deleteMedewerker` refusent de retirer
  la dernière beheerder PIN active quand l'option est active

## Phase 3: Interface (US1)

- [x] T006 [US1] `assets/pages/beheer.js` (Toegang) : carte « Enkel persoonlijke pincodes »
  (état, bouton, `K.confirm`, redirection si déconnecté), textes des cartes de codes adaptés,
  sans style en ligne

## Phase 4: Données et documentation

- [x] T007 [P] `scripts/fake-airtable.js` + `docs/SCHEMA.md` : champ `Enkel persoonlijke PIN`
- [x] T008 [P] `docs/RUNBOOK.md` (secours, verrou), `docs/COMPTES.md`, `AGENTS.md` (auth staff)

## Phase 5: Polish

- [x] T009 `node scripts/assets-version.js`, `node scripts/check.js`, `npx -y eslint@9.39.5 .`
  (codes de sortie vérifiés un par un) ; `scripts/workflow-check.js` : séquences de réponses
  simulées de `saveMedewerker` / `deleteMedewerker` complétées (lecture de Configuratie en tête)
- [x] T010 `node scripts/ux-audit.js` + `node scripts/kbd-audit.js` contre `node scripts/dev.js`
  (reseed) ; parcours manuel Toegang (409 sans beheerder, activation, teamcode refusée, secours)
