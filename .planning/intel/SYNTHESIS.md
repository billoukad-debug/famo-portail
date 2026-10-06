# Synthèse d'ingestion — FAMO Portail (2026-10-02)

Point d'entrée unique de l'intel synthétisée pour la création du socle de planification.

## Corpus
- 37 documents ingérés par manifeste (sur 83 candidats) : 6 ADR (constitution + ADR 0001 à 0005), 23 SPEC (specs/001 à 023, spec.md seul), 8 DOC (README, DESIGN, CONTRIBUER, VERCEL_CHECKLIST, docs/COMPTES, docs/COUTS, docs/CHECKLIST-UX, docs/adr/README).
- Exclus pour casser un cycle de renvois : AGENTS.md, docs/RUNBOOK.md, docs/SCHEMA.md, docs/TRANSFERT.md, IDEAS.md (repris par `.planning/codebase/`).
- Classifications : `.planning/intel/classifications/` (37 fichiers JSON, type imposé par le manifeste).

## Décisions verrouillées (6)
- Constitution v1.0.1 (`.specify/memory/constitution.md`) — cinq principes non négociables.
- ADR 0001 sans build / sans dépendance ; ADR 0002 Neon via le moteur Airtable→SQL ; ADR 0003 sessions signées, cookie client HttpOnly ; ADR 0004 numérotation CMD/FA/CN ; ADR 0005 facturation légale chez le comptable (Billtobox), pas de Peppol depuis le portail.
- Détail : `decisions.md`.

## Exigences
- Aucun PRD. Capacités livrées = 23 contraintes SPEC (`constraints.md`) → exigences validées. Exigences actives du jalon = feuille de route du propriétaire (brief). Détail : `requirements.md`.

## Contraintes (23)
- schema : 5 (003, 015, 016, 018, 023) · protocol : 5 (005, 010, 013, 020, 021) · api-contract : 3 (004, 014, 022) · nfr : 10 (001, 002, 006, 007, 008, 009, 011, 012, 017, 019).
- Détail : `constraints.md`.

## Contexte (7 thèmes)
- Produit et utilisateurs, contextes d'usage, contribution et portes de qualité, checklist UX, exploitation/comptes/coûts, index ADR, faits du brief propriétaire. Détail : `context.md`.

## Conflits
- 0 BLOCKER, 0 WARNING (variante concurrente), 9 INFO (auto-résolus ou constats). Rapport : `.planning/INGEST-CONFLICTS.md`.
- Point d'attention : la constitution dit « e-mails en néerlandais » alors que le code et la spec 020 envoient les e-mails client dans la langue du client (constitution retenue, question ouverte).

## Statut
- READY — sûr à router (aucun blocage). Écriture de PROJECT/REQUIREMENTS/ROADMAP/STATE soumise au gate de routage humain.
