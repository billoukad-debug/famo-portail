# Feature Specification: Dette technique — Beheer découpé, lecture des lignes unique

**Feature Branch**: `claude/brave-lovelace-s4xk7h`
**Created**: 2026-09-30
**Status**: Implemented
**Input**: audit I-10 (`api/onboarding.js` monolithique, 1 136 lignes), I-11 (`parseLines` copié 5 fois).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un développeur retrouve une action Beheer en une minute (Priority: P1)

Le repreneur du projet (docs/TRANSFERT.md) cherche « où est enregistré un prix négocié » : il ouvre
`lib/beheer/prijzen.js`, pas un fichier de 1 100 lignes.

**Acceptance Scenarios**:
1. **Given** n'importe quelle action envoyée par l'interface à `/api/onboarding`, **Then** exactement un module de `lib/beheer/` la traite (test).
2. **Given** le découpage, **Then** aucun comportement ne change : les 208 tests, workflow-check, ux-audit et kbd-audit restent verts.

### User Story 2 - Une ligne de commande se lit partout de la même façon (Priority: P1)

**Acceptance Scenarios**:
1. Serveur et navigateur lisent « Tong × 1,5 kg [€18.49] (en filets) » identiquement (test de parité).
2. Une ligne illisible est ignorée par les calculs serveur, affichée par le navigateur (comportement voulu, testé).

### Edge Cases
- Déploiement Vercel : les modules doivent être requis statiquement (traçage nft), sinon absents en production.
- Tests qui rechargent `lib/mail` (clé Resend lue au chargement) : les modules Beheer doivent être rechargés aussi.

## Requirements *(mandatory)*
- **FR-001**: `api/onboarding.js` = garde A-10, session beheerder, GET statut, aiguillage, journal d'audit ; < 120 lignes.
- **FR-002**: Six modules par domaine (config, producten, klanten, klantgebruikers, toegang, prijzen) + `common.js`.
- **FR-003**: Une seule `parseLines` serveur (`lib/lines.js`), utilisée par updateorder (et ses importeurs), margin, creditnota, reminders.
- **FR-004**: `lib/ordermail.js` garde sa lecture d'affichage (documenté).

## Success Criteria *(mandatory)*
- **SC-001**: 0 changement de comportement (toutes les portes vertes).
- **SC-002**: plus aucun fichier `api/` > 800 lignes (le plus gros : `updateorder.js`, 749).

## Assumptions
- Le corps des actions est déplacé tel quel (script de découpage) : aucune réécriture logique.
