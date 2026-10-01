# Feature Specification: Lignes de commande structurées (B4)

**Feature Branch**: `worktree-agent-ac22256cd3f125bc4` (sur la spec 010, `lib/commande/*`)
**Created**: 2026-10-01
**Status**: Implemented
**Input**: IDEAS.md § B4 — les lignes d'une commande sont du texte (`Tong × 2 kg [€16.00]`) et le
stock est rattaché aux produits par **nom** normalisé : renommer un produit du catalogue casse la
déduction de stock, le retour en stock (note de crédit) et « Opnieuw bestellen » du portail client.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Le beheerder renomme un produit sans casser le stock (Priority: P1)

Mohsen renomme « Tong » en « Tongfilet » dans Beheer → Producten. Une commande annulée avant le
renommage (non réécrite : les commandes `Annulée` et `Facturée` gardent leur texte) est restaurée,
préparée et part : le stock de « Tongfilet » baisse. Aujourd'hui : « Voorraadcontrole mislukt —
onbekend product Tong » (409), la commande ne peut pas partir.

**Why this priority**: le départ est bloqué ou, pire, le mauvais article est décompté si un nouveau
produit reprend l'ancien nom.

**Independent Test**: `test/lignes-structurees.test.js` (SQLite en mémoire, vraie chaîne
`api/order.js` → `api/onboarding.js` → `api/updateorder.js`).

**Acceptance Scenarios**:

1. **Given** une commande passée sur « Tong » puis annulée, **When** « Tong » est renommé
   « Tongfilet », la commande restaurée, préparée puis envoyée, **Then** le stock « Tongfilet » est
   déduit et le mouvement « Sortie livraison » porte « Tongfilet ».
2. **Given** une commande ouverte sur « Tong », **When** le produit est renommé, **Then** son texte
   ET sa forme structurée suivent le nouveau nom (comme le texte aujourd'hui).

---

### User Story 2 - La note de crédit remet en stock le bon article (Priority: P1)

Une facture émise avant le renommage garde « Tong » (document figé). Le beheerder fait une note de
crédit avec retour en stock : le stock du produit renommé remonte — et pas celui d'un nouveau
produit qui aurait repris le nom « Tong ».

**Acceptance Scenarios**:

1. **Given** une facture sur « Tong », **When** « Tong » devient « Tongfilet » et un nouveau
   produit « Tong » est créé, puis une note de crédit avec retour en stock de 1 kg, **Then** le
   stock « Tongfilet » +1, le stock du nouveau « Tong » inchangé, mouvement « Retour client » sur
   « Tongfilet ».
2. **Given** la même facture, **Then** son texte (« Tong × 2 kg [€16.00] ») n'est jamais réécrit.

---

### User Story 3 - Le client recommande une ancienne commande après un renommage (Priority: P2)

Le resto ouvre une commande livrée et appuie sur « Opnieuw bestellen » : l'article renommé revient
dans la winkelmand (par sa référence produit), au prix actuel décidé par le serveur.

**Acceptance Scenarios**:

1. **Given** une commande livrée sur « Tong » et le renommage, **When** le client liste ses
   commandes (`/api/orders`), **Then** chaque ligne porte la référence produit (`items[].productId`)
   et le portail la met dans la winkelmand par cette référence ; la commande suivante porte le
   nouveau nom.

---

### User Story 4 - Rien ne change pour les anciennes commandes (Priority: P1)

Les commandes d'avant ce lot n'ont que le texte : départ, retour, note de crédit, documents et
« Opnieuw bestellen » fonctionnent exactement comme avant (appariement par nom).

### Edge Cases

- Le navigateur (client ou personnel) envoie une référence produit, un prix, un nom ou un champ
  « Lignes JSON » : ignorés ; seule la référence produit d'un article du catalogue est acceptée à
  la commande (inconnue ou inactive : 400, rien n'est écrit). Prix, nom, unité : serveur.
- Texte et forme structurée en désaccord (écriture partielle, donnée corrigée à la main) : le
  **texte fait foi** pour quantité et prix ; une ligne n'est rattachée à sa référence que si la
  forme structurée a une entrée du même nom ; sinon appariement par nom (comportement d'avant).
- Produit supprimé du catalogue : la référence ne résout plus, retour au nom de la ligne.
- Catalogue illisible alors qu'une ligne porte une référence : le mouvement de stock est refusé
  (fail-closed), jamais décompté sur un nom deviné.
- Hors périmètre (risque documenté) : lots/traçabilité, marge et taux de TVA d'une commande non
  facturée restent appariés par nom (commandes ouvertes renommées avec le catalogue ; factures :
  taux et lots figés).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Champ `Lignes JSON` (texte JSON) sur `Commandes` :
  `[{productId, naam, qty, unit, prijs, comment?}]`, écrit **par le serveur** à côté du texte partout
  où des lignes sont créées ou changées : commande client (`api/order.js`), invoer du personnel
  (`api/staff.js`), lignes modifiées par le magasin (`lib/commande/lignes.js`), renommage d'un
  produit (`lib/beheer/producten.js`, commandes ouvertes). Les corrections et notes de crédit ne
  changent pas les lignes de la commande.
- **FR-002**: Le texte `Lignes (produits / quantités)` reste l'affichage humain et légal (documents,
  e-mails, anciennes commandes), écrit comme avant ; une facture émise n'est jamais réécrite.
- **FR-003**: Mouvements de stock (`lib/commande/stock.js` : départ, retour arrière, annulation, note
  de crédit) : ligne rattachée à une référence → nom **actuel** du catalogue → ligne de stock ;
  sinon nom de la ligne (comme avant).
- **FR-004**: `/api/orders` (portail client) renvoie `items: [{productId|null, naam, qty, comment}]`
  par ligne ; « Opnieuw bestellen » / « Wijzigen » utilisent la référence, le nom seulement sans
  référence.
- **FR-005**: Lignes modifiées par le magasin : un article déjà sur la commande est retrouvé par la
  référence enregistrée avant son nom (renommé depuis, ou nom repris par un autre produit) ; un
  article ajouté, par son nom (comme avant).
- **FR-006**: Aucun champ envoyé par le navigateur n'alimente `Lignes JSON` ; le journal d'audit
  ignore ce champ technique (le texte montre déjà le changement).
- **FR-007**: `docs/SCHEMA.md`, `scripts/fake-airtable.js` à jour ; note de migration dans
  `docs/RUNBOOK.md` (rien n'est réécrit, pas de rattrapage).

### Key Entities

- **Commandes.`Lignes JSON`** : forme structurée des lignes, rattachement au catalogue par id.
  Absente = ancienne commande (appariement par nom).

## Success Criteria *(mandatory)*

- **SC-001**: Après renommage : déduction, retour (note de crédit) et recommande corrects (tests).
- **SC-002**: 0 prix, nom ou référence du navigateur repris tel quel (test).
- **SC-003**: 0 changement pour une commande texte seul (test + `scripts/workflow-check.js` inchangé).

## Assumptions

- Pas de table `Lignes` séparée : un champ JSON suffit, même mécanique que `Creditnotas`,
  `BTW per lijn`, `Lots` ; aucune migration de schéma SQL (moteur sans colonnes par champ).
- Pas de rattrapage des anciennes commandes : l'appariement par nom au moment du rattrapage
  attacherait la mauvaise référence si un produit a déjà été renommé et son nom repris ; la
  correction vaut pour les commandes créées ou modifiées après le déploiement.
- Les lignes de stock restent rattachées au catalogue par nom (renommées avec lui par
  `saveProduct`) ; seul le rattachement ligne de commande → produit change.
