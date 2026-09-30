# Feature Specification: Pastilles lues (compteurs du menu)

**Feature Branch**: `claude/brave-lovelace-s4xk7h`
**Created**: 2026-09-30
**Status**: Ready
**Input**: « Les bulles devraient partir après lecture des notifs, ou au moins avoir le choix. »

## User Scenarios & Testing *(mandatory)*

### User Story 1 - La pastille disparaît une fois la page ouverte (Priority: P1)

Un magasinier voit « 3 » sur Magazijn. Il ouvre Magazijn : la pastille disparaît. Elle revient
seulement quand un élément qu'il n'a pas encore vu arrive (une 4e commande à préparer → « 1 »).

**Why this priority**: c'est la demande ; une pastille qui ne part jamais n'attire plus l'œil.

**Independent Test**: portail de dev, ouvrir Bestellingen avec des commandes « Ontvangen » :
la pastille de Bestellingen disparaît ; aller sur Magazijn, créer une commande depuis Invoeren :
la pastille de Bestellingen montre « 1 ».

**Acceptance Scenarios**:

1. **Given** le mode « Nieuw » et 3 commandes à confirmer jamais vues, **When** la personne ouvre
   Bestellingen, **Then** la pastille de Bestellingen disparaît.
2. **Given** ces 3 commandes vues, **When** une 4e arrive et la personne est sur une autre page,
   **Then** la pastille de Bestellingen affiche « 1 ».
3. **Given** un client qui a une facture à payer non vue, **When** il ouvre l'onglet
   Bestellingen, **Then** la pastille disparaît et ne revient que pour une nouvelle facture.

---

### User Story 2 - Choisir le comportement, par appareil (Priority: P2)

Le gérant veut garder la pastille tant qu'il reste du travail (« Alles »), un chauffeur préfère
n'en voir aucune (« Uit »). Chacun choisit sur son appareil, sans compte ni réglage serveur.

**Why this priority**: la demande prévoit « au moins avoir le choix ».

**Independent Test**: changer le choix (personnel : bouton cloche de la barre du haut ; client :
page Account) ; les pastilles changent tout de suite et le choix reste après un rechargement.

**Acceptance Scenarios**:

1. **Given** le mode « Alles », **When** la personne ouvre la page, **Then** la pastille garde
   le nombre total d'éléments encore à traiter (comportement d'avant).
2. **Given** le mode « Uit », **Then** aucune pastille n'est affichée, nulle part.
3. **Given** un choix fait, **When** la page est rechargée ou une autre page ouverte,
   **Then** le choix est conservé sur cet appareil.

### Edge Cases

- Stockage du navigateur bloqué ou vide (fenêtre privée) : mode « Nieuw » par défaut, rien ne
  plante ; les éléments sont simplement « non vus ».
- Onglet en arrière-plan : une actualisation automatique ne marque rien comme vu.
- Compteur sans liste d'éléments (demandes Beheer) : « nouveau » = hausse depuis la dernière
  visite ; une baisse abaisse la référence.
- Un élément vu, traité puis revenu (rare) peut rester considéré comme vu : accepté.
- Plus de 99 éléments : « 99+ » comme avant.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Trois modes par appareil : « Nieuw » (défaut), « Alles », « Uit ».
- **FR-002**: En « Nieuw », une pastille compte les éléments pas encore vus sur cet appareil.
- **FR-003**: Un élément est vu quand la personne est sur la page (ou l'onglet) de la pastille,
  onglet du navigateur visible.
- **FR-004**: En « Alles », la pastille compte tout ce qui reste à traiter (comme avant).
- **FR-005**: En « Uit », aucune pastille.
- **FR-006**: Le choix est accessible au personnel (toutes pages) et au client (Account), en
  NL pour le personnel, NL/FR pour le client, au clavier, cibles ≥ 44 px.
- **FR-007**: Le libellé accessible dit si le nombre est « nouveau » ou « à traiter ».
- **FR-008**: Aucun appel serveur ni champ de base en plus.

### Key Entities

- **Mode de pastille** : nieuw | alles | uit, par appareil.
- **Éléments vus** : par pastille, la liste des identifiants vus (ou le nombre vu pour une
  pastille sans liste).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Après ouverture d'une page, sa pastille est à 0 en mode « Nieuw » (100 % des cas
  couverts par le test unitaire).
- **SC-002**: Le changement de mode s'applique en moins d'une seconde, sans rechargement.
- **SC-003**: Aucune régression des audits navigateur (ux-audit, kbd-audit) ni de check.js.

## Assumptions

- « Lu » = page ouverte ; il n'existe pas de notion de notification individuelle à cocher.
- Défaut « Nieuw » : c'est le comportement demandé ; « Alles » reste disponible.
- Préférence par appareil (tablettes partagées au dépôt) plutôt que par compte.
