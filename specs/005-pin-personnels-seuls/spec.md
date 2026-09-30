# Feature Specification: PIN personnels seuls (fin des codes partagés)

**Feature Branch**: `worktree-agent-a3d5367afd1aac533`
**Created**: 2026-09-30
**Status**: Ready
**Input**: Audit L-06 : « Les codes partagés (code personnel / code beheerder, variable
d'environnement ou code enregistré) ET les PIN personnels ouvrent tous une session. Un code
partagé ne dit pas qui agit. Ajouter dans Beheer → Toegang une option « Enkel persoonlijke
pincodes » : quand elle est active, le code partagé est refusé, les PIN personnels continuent de
fonctionner. »

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Le beheerder impose les PIN personnels (Priority: P1)

Tout le personnel a désormais son PIN. Le gérant ouvre Beheer → Toegang et active
« Enkel persoonlijke pincodes ». À partir de là, la teamcode affichée au mur du dépôt n'ouvre
plus rien : chaque connexion, et donc chaque action du journal, porte le nom de la personne.
Les sessions ouvertes avec la teamcode sont fermées tout de suite.

**Why this priority**: c'est le constat d'audit ; tant qu'un code partagé ouvre une session,
le journal peut dire « personeel » au lieu d'un nom.

**Independent Test**: portail de dev, créer une medewerker « beheerder » avec un PIN, activer
l'option, se déconnecter : `team-dev-code` est refusé, le PIN ouvre la session au nom de la
personne.

**Acceptance Scenarios**:

1. **Given** l'option active, **When** quelqu'un tape la teamcode (ou le code beheerder
   enregistré), **Then** la connexion est refusée avec le message habituel « Ongeldige
   personeelscode », sans dire pourquoi, et la tentative compte comme un échec (limite par
   appareil et verrou des PIN).
2. **Given** l'option active, **When** une personne tape son PIN personnel actif, **Then** elle
   est connectée à son nom, avec son rôle, comme avant.
3. **Given** des sessions ouvertes avec la teamcode, **When** le beheerder active l'option,
   **Then** ces sessions tombent (comme avec « Iedereen afmelden ») ; le beheerder qui active
   l'option avec son propre PIN reste connecté.
4. **Given** l'option active, **When** le beheerder la désactive, **Then** les codes partagés
   fonctionnent de nouveau.
5. **Given** un changement de l'option, **Then** le journal Beheer montre qui l'a changée,
   quand, et l'état avant → après.

---

### User Story 2 - Impossible de s'enfermer dehors (Priority: P1)

Le gérant n'a pas encore créé de PIN beheerder. Il essaie d'activer l'option : le portail
refuse et explique qu'il faut d'abord une medewerker active avec le rôle Beheerder.

**Why this priority**: sans ce garde-fou, activer l'option sans PIN beheerder fermerait Beheer
à tout le monde.

**Independent Test**: avec seulement des medewerkers « personeel » (ou un beheerder inactif),
activer l'option → refus clair en néerlandais, rien n'est changé.

**Acceptance Scenarios**:

1. **Given** aucune medewerker active avec le rôle beheerder et un PIN, **When** le beheerder
   active l'option, **Then** refus (conflit) avec un message néerlandais clair, rien n'est
   enregistré, personne n'est déconnecté.
2. **Given** l'option active et une seule beheerder active, **When** on la supprime, la
   désactive ou la passe en « personeel », **Then** refus avec le même type de message.

---

### User Story 3 - Accès de secours (break-glass) (Priority: P2)

Le seul beheerder a oublié son PIN (ou il est parti) alors que l'option est active. Le
propriétaire, qui a accès aux variables Vercel, se connecte à la page Beheer avec le code
beheerder de l'environnement (`ADMIN_CODE`) : l'accès lui est ouvert en rôle beheerder, marqué
« Noodtoegang », et l'événement est signalé bruyamment dans les logs et le journal.

**Why this priority**: évite de devoir modifier la base à la main pour rentrer ; reste
exceptionnel.

**Independent Test**: option active, aucune empreinte `Beheerderscode hash` : `ADMIN_CODE` sur
la page Beheer ouvre Beheer au nom « Noodtoegang », une ligne d'erreur « noodtoegang » apparaît
dans les logs ; le même code sur la page personnel est refusé.

**Acceptance Scenarios**:

1. **Given** l'option active et pas de code beheerder enregistré, **When** `ADMIN_CODE` est
   tapé sur la page de connexion Beheer, **Then** session beheerder « Noodtoegang », log
   d'erreur et ligne de journal.
2. **Given** l'option active, **When** `ADMIN_CODE` est tapé sur la page de connexion du
   personnel, ou quand un code beheerder enregistré (haché) est tapé, **Then** refus.
3. **Given** l'option active, **When** `STAFF_CODE` est tapé, **Then** refus, toujours.

### Edge Cases

- `ADMIN_CODE` et `STAFF_CODE` identiques : sur la page personnel, refus (le secours n'existe
  que pour le rôle beheerder, depuis la page Beheer).
- Code beheerder enregistré dans Beheer (empreinte) : il remplace `ADMIN_CODE` (règle
  existante) ; le secours passe alors par la base (vider l'empreinte ou décocher l'option),
  comme aujourd'hui — `docs/RUNBOOK.md`.
- Verrou global des PIN (20 échecs → 15 min) avec l'option active : plus de teamcode pour
  contourner ; seul l'accès de secours reste. Le message ne renvoie plus à la teamcode.
- Configuratie illisible au moment d'une connexion : l'instance garde en mémoire le dernier
  état connu de l'option ; sans état connu, comportement historique (codes d'environnement).
  Une session ainsi ouverte porte l'ancienne génération et tombe dès que la génération est
  relue.
- Activer l'option alors que le beheerder est connecté avec un code partagé : il est déconnecté
  lui aussi et doit revenir avec son PIN (l'interface le prévient).
- Une case décochée n'est pas stockée : absent = option inactive.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Une option « Enkel persoonlijke pincodes » dans Beheer → Toegang, réservée aux
  beheerders, enregistrée dans la configuration du portail.
- **FR-002**: Option active : tout code partagé (teamcode, code beheerder enregistré) est refusé
  à la connexion avec le message générique d'un code invalide ; la tentative compte comme un
  échec pour les limites anti-abus existantes.
- **FR-003**: Option active : les PIN personnels actifs ouvrent la session au nom de la personne,
  comme avant.
- **FR-004**: Activation refusée (conflit, message néerlandais) s'il n'existe aucune medewerker
  active, rôle beheerder, avec un PIN. Option active : suppression, désactivation ou
  rétrogradation de la dernière beheerder active refusées de la même manière.
- **FR-005**: Activation : toutes les sessions ouvertes sont révoquées (génération globale +1) ;
  le beheerder connecté par PIN reçoit une session à la nouvelle génération, celui connecté par
  code partagé est déconnecté.
- **FR-006**: Accès de secours : le code beheerder de l'environnement (`ADMIN_CODE`), s'il n'est
  pas remplacé par un code enregistré, reste accepté depuis la page de connexion Beheer
  seulement, en rôle beheerder, sous le nom « Noodtoegang » ; chaque usage est journalisé
  (log d'erreur + journal Beheer).
- **FR-007**: Chaque changement de l'option est journalisé (qui, quand, avant → après).
- **FR-008**: Chaque session et chaque action gardent le nom de la personne (PIN) ou
  « Noodtoegang » (secours) ; jamais un anonyme « personeel » quand l'option est active.
- **FR-009**: Textes visibles en néerlandais ; aucun code, PIN ou empreinte dans les logs ou les
  réponses.

### Key Entities

- **Option « Enkel persoonlijke PIN »** : case de la configuration (une ligne), absente = faux.
- **Medewerker** : nom, rôle (personeel / beheerder), PIN haché, actif (existant).
- **Génération de session** : compteur global de révocation (existant).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Option active, 100 % des connexions par code partagé refusées (hors secours
  documenté), couvertes par test automatique.
- **SC-002**: 0 activation possible sans beheerder PIN actif (test automatique).
- **SC-003**: Après activation, toute session ouverte par code partagé est refusée à la requête
  suivante sur l'instance, en ≤ 60 s sur les autres (délai de révocation existant).
- **SC-004**: Aucune régression de `node scripts/check.js` ni d'ESLint.

## Assumptions

- Le secours par `ADMIN_CODE` est acceptable parce que la variable n'est connue que de qui
  administre Vercel ; elle n'est pas tapée au quotidien sur les tablettes.
- Désactiver l'option ne déconnecte personne (rien ne devient plus strict).
- Le message de refus reste générique (pas d'indice pour un attaquant) ; le beheerder informe
  son équipe.
