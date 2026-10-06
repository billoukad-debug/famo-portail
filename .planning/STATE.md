---
gsd_state_version: '1.0'
milestone: v2.1
milestone_name: Usage réel
status: planning
last_updated: '2026-10-02'
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-02)

**Core value:** Une commande passée par un client arrive juste — bons produits, prix négociés, jour de livraison, stock et documents — parce que le serveur décide de tout.
**Current focus:** Phase 1 — Mise en service propre (jalon v2.1 « Usage réel »)

## Current Position

Phase: 1 of 4 (Mise en service propre)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-10-02 — onboarding brownfield : cartographie `.planning/codebase/`, ingestion de 37 documents, création du socle (non commité)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Décisions de fond : PROJECT.md § Key Decisions (ADR 0001-0005, constitution, coexistence spec-kit).

- 2026-10-02 (onboarding) : `.planning/` référence la méthode spec-kit, ne la remplace pas ; chaque phase se réalise par des specs `specs/NNN-nom/`.
- 2026-10-02 (onboarding) : ingestion limitée à 37 documents par manifeste ; AGENTS.md, docs/RUNBOOK.md, docs/SCHEMA.md, docs/TRANSFERT.md, IDEAS.md exclus pour casser un cycle de renvois (repris par la cartographie).
- 2026-10-02 (onboarding) : `config.json` créé sans `model_profile` (proposition : `balanced`, à faire valider), `commit_docs: false`, `granularity: coarse`, `mode: interactive`.

### Pending Todos

- AVANT le premier commit de `.planning/` : ajouter `/.planning` à `.vercelignore` (et une redirection `/.planning/:path*` + test dans `test/deploy.test.js`), sinon `config.json` serait publié — petite spec.
- Après le 31/10/2026 : retirer le chemin « jeton client dans le corps » (SEC-01).
- Dérives documentaires à corriger par une spec docs : AGENTS.md « Done so far » sans la 021 ; en-têtes « Status: Ready » des specs 001/003/005/013 et « non déployé » de la 020 ; README (une photo, relances).

### Blockers/Concerns

- En attente du propriétaire : nettoyage des tests (spec 021) ; avis du comptable (exports envoyés ? remise à zéro ? BT-127) ; réglages Resend inbound.
- Questions ouvertes (REQUIREMENTS.md) : Q-TRACE-1/2/3, Q-PIL-1/2, Q-CHAN-1, Q-LANG-1.
- Risque : comptes de service au nom d'une seule personne (`docs/COMPTES.md`).

## Deferred Items

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| facturation | Envoi Peppol direct | seulement si FAMO quitte Billtobox | 2026-10-02 | — |

## Session Continuity

Last session: 2026-10-02
Stopped at: socle `.planning/` créé, non commité, en relecture par vibeflow-head
Resume file: None
