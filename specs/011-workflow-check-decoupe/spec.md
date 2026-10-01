# Feature Specification: Scénarios métier découpés par domaine (workflow-check)

**Feature Branch**: `worktree-agent-af2b3642ce20a1e09`
**Created**: 2026-10-01
**Status**: Implemented
**Input**: audit F-10 — `scripts/workflow-check.js` (1 926 lignes, 36 blocs « ✓ » enchaînés dans une seule
fonction, état partagé : cookies, cache de `require`, `global.fetch`, `process.env`) : un échec arrête tout,
un bloc dépend sans le dire de ceux d'avant, impossible de lancer un seul domaine, aucun parallélisme.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un développeur vérifie seulement le domaine qu'il touche (Priority: P1)

Le repreneur du projet (docs/TRANSFERT.md) modifie la facturation : il lance les scénarios de facturation
seuls, en quelques secondes, sans attendre les sessions, le portail client ni les e-mails.

**Why this priority**: c'est le geste quotidien ; aujourd'hui il faut tout relancer (≈ 45 s) pour un bloc.

**Independent Test**: lancer un seul fichier de domaine, seul, réussit ; le lancer avec tous les autres aussi.

**Acceptance Scenarios**:
1. **Given** un fichier de domaine, **When** il est lancé seul, **Then** il réussit sans dépendre d'aucun autre.
2. **Given** tous les domaines, **When** ils sont lancés ensemble, **Then** ils tournent en parallèle sans
   interférence (chacun son processus, son environnement, ses réponses simulées).
3. **Given** un domaine en échec, **Then** les autres domaines vont quand même au bout et l'échec est nommé
   (domaine, bloc, message).

### User Story 2 - Aucune règle métier ne disparaît pendant le découpage (Priority: P1)

**Why this priority**: ces scénarios sont l'essentiel des contrôles (constitution III) ; un découpage qui
perd une assertion affaiblit la porte sans que personne ne le voie.

**Independent Test**: un contrôle automatique compare le découpage à la référence d'avant (blocs, assertions).

**Acceptance Scenarios**:
1. **Given** l'ancien script, **Then** chacun de ses 36 blocs existe exactement une fois, même libellé.
2. **Given** l'ancien script (752 appels `assert`), **Then** les nouveaux fichiers en comptent au moins autant,
   messages identiques (code des blocs déplacé tel quel).
3. **Given** un bloc ou une assertion retiré plus tard sans le dire, **Then** la porte échoue.

### User Story 3 - Les habitudes et la CI restent valables (Priority: P2)

**Acceptance Scenarios**:
1. `node scripts/check.js` reste la porte principale et lance tous les domaines (sortie lisible : un ✔ par
   ancien bloc, regroupés par domaine, puis un ✓ global).
2. `node scripts/workflow-check.js`, cité par la documentation, fonctionne toujours (point d'entrée).

### Edge Cases
- Modules qui lisent l'environnement au chargement (`lib/staffauth.js`, `lib/mail.js`) : l'environnement de
  test doit être posé avant tout `require` d'un module `api/` ou `lib/`.
- Caches par processus (génération de session 60 s, limiteurs anti-abus) : un bloc qui comptait sur un cache
  chauffé par un bloc précédent doit le chauffer lui-même (bloc K).
- Variables d'environnement du poste du développeur (vraie clé Resend, vrai jeton Airtable, `DB_BACKEND`) :
  elles ne doivent ni changer le résultat ni permettre un appel réel.
- Lancement accidentel de tous les fichiers dans un même processus : échec explicite, pas d'interférences
  silencieuses.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: Les scénarios sont répartis en fichiers par domaine métier (commandes, préparation-livraison,
  facturation, corrections, sessions-rôles, portail client, e-mails-documents, Beheer, interface).
- **FR-002**: Les aides communes (réponses simulées, environnement, cookies, dates) vivent dans un seul module.
- **FR-003**: Chaque fichier est autonome : environnement, cache de modules, `fetch` simulé, cookies.
- **FR-004**: Aucun appel réseau réel n'est possible depuis les scénarios (refus explicite).
- **FR-005**: Chaque assertion d'origine est conservée avec son message ; aucun bloc sauté ni affaibli.
- **FR-006**: Un contrôle d'inventaire (blocs, nombre d'assertions, autonomie des fichiers) fait partie de la porte.
- **FR-007**: `scripts/check.js` lance tous les domaines ; `scripts/workflow-check.js` reste un point d'entrée
  (tous les domaines, ou un seul par son nom).

## Success Criteria *(mandatory)*
- **SC-001**: 36/36 blocs, 752/752 assertions (référence : `scripts/workflow-check.js` au commit `f48b5cd`).
- **SC-002**: Chaque fichier réussit seul et avec les autres.
- **SC-003**: Durée des scénarios réduite (mesurée avant/après sur la même machine, voir plan.md).
- **SC-004**: `node scripts/assets-version.js`, `node scripts/check.js`, `npx -y eslint@9.39.5 .` : codes de
  sortie 0, vérifiés un par un.

## Assumptions
- Le code des blocs est déplacé tel quel (script de découpage par plages de lignes) ; seules changent les
  lignes de liaison : déclaration locale de `result`/`sres`, cookies obtenus par un `before()` commun,
  chauffe explicite du cache de génération de session au bloc K.
- `node --test` (Node 22) lance chaque fichier dans son propre processus (isolation par défaut) et plusieurs
  fichiers à la fois.
- Hors périmètre : `api/`, `lib/`, `assets/`, pages HTML, `documents.js` (aucun changement de comportement).
