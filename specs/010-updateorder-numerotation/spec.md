# Feature Specification: Bijwerken découpé, numérotation FA/CN sans trou inexpliqué

**Feature Branch**: `worktree-agent-a07319f4a008fdab4`
**Created**: 2026-10-01
**Status**: Implemented
**Input**: dette A6 (`api/updateorder.js` monolithique, 749 lignes, suite de T008 de la spec 006) ;
A4 (trous de numérotation : un numéro FA/CN réservé au compteur atomique peut être perdu sans trace).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Le comptable comprend chaque numéro de la série (Priority: P1)

Le comptable (ou un contrôleur TVA) parcourt les notes de crédit CN-2026-0001, 0002, 0004 : il manque
0003. Aujourd'hui, personne ne peut dire pourquoi. Après ce lot, soit le numéro n'a jamais été perdu
(refus décidé avant de réserver, ou numéro rendu au compteur), soit Beheer → Journaal montre
« Nummer vervallen — Creditnota nummer: CN-2026-0003 → niet gebruikt » avec la raison et l'heure.

**Why this priority**: une facture et une note de crédit doivent avoir une numérotation continue
(constitution V) ; un trou inexpliqué est un constat d'audit.

**Independent Test**: tests sur SQLite en mémoire (`test/nummering.test.js`).

**Acceptance Scenarios**:

1. **Given** deux appareils qui créditent en même temps la même facture et dont un seul tient sous le
   plafond, **When** le second est refusé (409), **Then** la note suivante reçoit le numéro qui suit
   immédiatement la note acceptée (aucun numéro consommé par le refus).
2. **Given** la même note envoyée deux fois en même temps (même clé « sleutel », deux instances),
   **When** la seconde rend la note déjà créée, **Then** aucun numéro n'est consommé.
3. **Given** un retour en stock demandé et le stock illisible, **When** la note est refusée (500),
   **Then** aucun numéro n'a été réservé.
4. **Given** la réception d'une livraison dont l'écriture échoue après la réservation du FA,
   **When** la réponse est 500, **Then** le journal d'audit porte une ligne « Nummer vervallen »
   (numéro, commande, raison) et la confirmation suivante prend le numéro suivant.
5. **Given** un refus décidé après la réservation alors qu'un autre appareil a déjà pris le numéro
   suivant (le numéro ne peut plus être rendu), **Then** la ligne « Nummer vervallen » l'explique.

---

### User Story 2 - Un développeur retrouve une action « Bijwerken » en une minute (Priority: P2)

Le repreneur (docs/TRANSFERT.md) cherche « où est créée une note de crédit » : il ouvre
`lib/commande/creditnota.js`, pas un fichier de 750 lignes.

**Acceptance Scenarios**:

1. **Given** n'importe quelle requête vers `/api/updateorder` (correction, creditnota, correctiemail,
   statut / lignes / paiement / volgorde), **Then** exactement un module de `lib/commande/` la traite.
2. **Given** le découpage, **Then** aucun comportement ne change : tests, workflow-check (réponses
   Airtable simulées dans le même ordre) et ESLint restent verts.

### Edge Cases

- Déploiement Vercel : les modules doivent être requis statiquement (traçage nft).
- Harnais qui vident le cache de `api/updateorder.js` (deux « instances », rechargement de
  `lib/staffauth.js`) : les modules de `lib/commande/` doivent être rechargés avec lui.
- Airtable (plus utilisé en production) : pas de compteur ; le numéro est « max + 1 » recalculé à
  chaque appel, un échec ne consomme rien. L'ordre des lectures Airtable reste identique.
- Écriture en échec : l'issue est incertaine (l'écriture a peut-être eu lieu) ; le numéro n'est donc
  jamais rendu au compteur dans ce cas, seulement journalisé.
- Hors périmètre (risque résiduel documenté) : deux appareils qui confirment la **même** réception au
  même instant sur deux instances réservent chacun un FA ; le dernier écrit gagne et l'autre numéro
  n'est pas journalisé (verrou mémoire par instance seulement, comme avant).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `api/updateorder.js` = seul point d'entrée HTTP : garde A-10 en première ligne du
  handler exporté, configuration, session, verrou par commande, lecture de la commande, aiguillage,
  journal d'audit ; < 150 lignes. Exports `parseLines` et `formatLine` conservés.
- **FR-002**: modules par domaine dans `lib/commande/` : corrections, creditnota, correctiemail,
  statut/lignes/paiement/facturation, stock, lignes, numérotation + `common.js` ; `require`
  statiques uniquement.
- **FR-003**: Note de crédit : toutes les vérifications qui peuvent refuser (rôle, statut, clé
  d'idempotence, motif, plafond, lecture du stock) passent AVANT la réservation du numéro ; sur le
  moteur SQL, le numéro est réservé seulement quand l'état relu est accepté.
- **FR-004**: Un numéro réservé puis non utilisé à cause d'un refus certain (aucune écriture) est
  rendu au compteur s'il est encore le dernier ; sinon il est journalisé « Nummer vervallen ».
- **FR-005**: Un numéro réservé puis non écrit à cause d'une écriture en échec est journalisé
  « Nummer vervallen » (journal d'audit, moteur SQL) et dans les logs Vercel ; jamais rendu.
- **FR-006**: `docs/RUNBOOK.md` explique comment lire et vérifier une ligne « Nummer vervallen ».

### Key Entities

- **Compteurs** (table interne) : `Waarde` d'une série (`FA-2026`, `CN-2026`) ; peut redescendre
  d'une unité quand le dernier numéro réservé est rendu.
- **Journaal** : ligne `Actie = "Nummer vervallen"`, `Object = Commandes`, `Record`, `Referentie`
  (référence CMD), `Wijzigingen = [{veld, voor: numéro, na: "niet gebruikt"}]`, `Reden`.

## Success Criteria *(mandatory)*

- **SC-001**: 0 numéro FA/CN consommé par un refus de validation, un rejeu idempotent ou un stock
  illisible (tests).
- **SC-002**: 100 % des numéros perdus après réservation ont une ligne au journal (test).
- **SC-003**: plus aucun fichier `api/` > 600 lignes ; `api/updateorder.js` < 150 lignes.
- **SC-004**: 0 changement de comportement du découpage (toutes les portes vertes).

## Assumptions

- Le code est déplacé tel quel (aucune réécriture logique) hormis l'ordre de réservation des numéros
  (A4) et la trace des numéros vervallen.
- Les numéros FA/CN restent des numéros internes du portail (ADR 0005) ; la règle s'applique
  quand même : une série interne explicable évite les questions du comptable.
