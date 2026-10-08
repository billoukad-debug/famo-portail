# Feature Specification: Plusieurs notes de crédit par facture et e-mail de correction

**Feature Branch**: `worktree-agent-ae0d81fc542803598`
**Created**: 2026-09-30
**Status**: Implemented
**Input**: « C-08 : plusieurs notes de crédit par commande livrée / facturée. L-08 : renvoyer un
e-mail de correction au client après une correction de commande ou une note de crédit. »

## Constat de départ (vérifié dans le code)

- Une seule note de crédit par commande : `api/updateorder.js` (makeCreditnota) répondait 409
  « Er bestaat al een creditnota » dès que `Creditnota nummer` était rempli ; l'écran masquait le
  bouton « Creditnota maken » et le panneau refusait de s'ouvrir.
- Un deuxième retour du même client sur la même facture (autre article abîmé, remise commerciale
  plus tard) était impossible sans bricolage.
- Aucun moyen de prévenir le client qu'une commande a été corrigée après sa confirmation
  (poids réel, article retiré, prix revu par le beheerder) ou qu'une note de crédit a été émise.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Une deuxième (troisième…) note de crédit sur la même facture (Priority: P1)

Le beheerder a déjà crédité 1 kg de saumon abîmé. Deux jours plus tard le client signale une
sauce cassée sur la même livraison. Il ouvre la fiche, clique « Nog een creditnota », coche la
sauce, donne la raison : une nouvelle note CN-… est créée, avec son numéro, ses lignes, son montant
et sa date, sans toucher à la première.

**Why this priority**: c'est la demande C-08 ; sans elle, le deuxième retour ne peut pas être
documenté légalement (une facture émise ne se modifie pas, on corrige par note de crédit).

**Independent Test**: portail de dev, commande « Geleverd » : créer deux notes, la fiche montre
« Creditnota's (2) », chaque note s'ouvre en PDF, Documenten liste deux lignes.

**Acceptance Scenarios**:

1. **Given** une facture avec une note, **When** le beheerder crée une deuxième note, **Then** elle
   reçoit le numéro CN suivant de la série (continue, toutes commandes confondues), ses propres
   lignes, montant et date ; la première est inchangée.
2. **Given** 2 kg livrés dont 1,5 kg déjà crédités, **When** on demande 1 kg, **Then** refus
   « tussen 0 en 0.5 » ; **When** tout est crédité, **Then** « al volledig gecrediteerd ».
3. **Given** des lignes dont l'arrondi au cent ferait dépasser la facture en plusieurs fois,
   **When** la somme des notes dépasserait le montant facturé à un taux de TVA, **Then** refus.
4. **Given** « Retour in voorraad » coché, **When** la note est créée, **Then** seules ses lignes
   reviennent en stock, une seule fois, même si la requête est rejouée (double clic, réseau).
5. **Given** une ancienne commande avec une seule note (données d'avant), **When** on ajoute une
   note, **Then** elle s'ajoute et la numérotation continue après le plus grand numéro existant.

---

### User Story 2 - Le client et le comptable voient toutes les notes (Priority: P1)

Le client ouvre sa commande dans le portail : il voit chaque note (numéro, montant, date) et peut
ouvrir chacune en PDF, dans sa langue. Le comptable reçoit toutes les notes dans la « Boekhouding
CSV » et un fichier UBL par note.

**Why this priority**: une note invisible pour le client ou le comptable n'existe pas en pratique.

**Independent Test**: portail client `aloha` : la commande créditée deux fois montre deux lignes
« Creditnota … » avec « Openen » ; Documenten → UBL télécharge facture + notes.

**Acceptance Scenarios**:

1. **Given** deux notes, **When** le client ouvre la commande, **Then** deux lignes et deux
   documents imprimables (FR pour un client FR).
2. **Given** deux notes, **When** le beheerder exporte, **Then** la Boekhouding CSV a une ligne par
   note et par taux, le UBL a un fichier par note (`&cn=<numéro>`).
3. Relances de paiement et marge déduisent toutes les notes.

---

### User Story 3 - « Correctie mailen » (Priority: P2)

Le magasin a livré 1,5 kg au lieu de 2 kg, ou le beheerder a émis une note : le personnel clique
« Correctie mailen » sur la fiche. Le client reçoit un e-mail (dans sa langue, comme les autres
e-mails client) : ce qui a changé (avant → après), le nouveau total, les notes de crédit émises
depuis ; la boîte interne reçoit une copie avec le lien vers la fiche (`/order.html?id=`).
Le journal de la commande le note.

**Why this priority**: demande L-08 ; aujourd'hui le personnel doit écrire le mail à la main.

**Independent Test**: portail de dev, modifier une quantité avant départ puis « Correctie
mailen » : le faux Resend reçoit deux messages, le bouton disparaît, le journal a une ligne.

**Acceptance Scenarios**:

1. **Given** des lignes différentes de la confirmation, **When** « Correctie mailen », **Then** un
   e-mail client + une copie interne, une ligne au journal, et le bouton disparaît.
2. **Given** rien de changé depuis le dernier e-mail, **Then** refus « Niets gewijzigd » (409).
3. **Given** un double clic ou deux appareils, **Then** un seul envoi.
4. **Given** pas de `RESEND_API_KEY` ou pas d'adresse client, **Then** rien ne part, la réponse
   le dit (skipped), rien n'est réservé ni journalisé, aucune erreur.
5. **Given** un envoi qui échoue, **Then** 502, rien n'est réservé : on peut réessayer.

### Edge Cases

- Arrondi au cent : 0,5 kg + 0,875 kg d'un article à 18,49 € dépasserait la ligne facturée
  (25,42 €) d'un cent : la deuxième note est refusée ; créditer 0,874 kg passe. Accepté (rare).
- Deux notes simultanées sur deux instances : aucune perdue ; si elles dépassent ensemble le
  livré, une seule passe (l'autre 409). Le numéro réservé par la note refusée est perdu (trou dans
  la série CN) — rare, documenté dans plan.md.
- Commande annulée : pas de correction mailée (409).
- Ancienne commande sans « Lignes besteld » : seules les notes de crédit comptent comme correction.
- Mode « Boekhouder » : l'e-mail client ne cite pas les numéros CN du portail (la note légale
  vient du comptable, via Peppol) ; la copie interne les cite. Depuis le 2026-10-08 (demande du co-gérant),
  l'e-mail client ne dit plus non plus « la note de crédit vous est envoyée par notre comptabilité (via Peppol) ».

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Plusieurs notes de crédit par commande facturée, beheerder seulement.
- **FR-002**: Chaque note a son numéro CN-AAAA-NNNN (même série continue, compteur atomique
  existant), ses lignes (prix figés de la facture), son montant HTVA, sa date, sa raison.
- **FR-003**: Toutes notes ensemble : par article, jamais plus que facturé ; par taux de TVA,
  jamais plus que la base et la TVA facturées.
- **FR-004**: Retour en stock optionnel par note, pour les seules lignes de la note, une seule fois
  (clé d'idempotence).
- **FR-005**: Données d'avant (une seule note) lues et complétées sans migration.
- **FR-006**: Fiche (NL) : liste des notes, bouton « Nog een creditnota » tant qu'il reste à créditer,
  chaque note imprimable ; Documenten : une ligne par note.
- **FR-007**: Portail client : toutes les notes listées et imprimables dans la langue du client.
- **FR-008**: Export comptable : CSV (une ligne par note et par taux) et UBL (un fichier par note).
- **FR-009**: « Correctie mailen » : personnel (et beheerder) ; e-mail client NL/FR selon la
  langue du client ; avant → après, nouveau total HTVA et TVAC, notes émises depuis, solde ;
  lien vers le portail client ; copie interne NL avec `/order.html?id=`.
- **FR-010**: Un seul e-mail par état (double clic, deux appareils) ; journal de la commande.
- **FR-011**: Sans clé e-mail ou sans adresse : rien n'est envoyé, la réponse le dit, jamais d'erreur.

### Key Entities

- **Note de crédit** : numéro, lignes, montant HTVA, date, raison, retour en stock (oui/non),
  clé d'idempotence.
- **Dernier e-mail de correction** : état envoyé (lignes, numéros des notes), date, clé.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % des scénarios ci-dessus couverts par `test/creditnotas.test.js`,
  `test/correctiemail.test.js` et le bloc AQ de `scripts/workflow-check.js`.
- **SC-002**: Aucun cent crédité au-delà de la facture (tests d'arrondi).
- **SC-003**: `check.js`, ESLint, ux-audit et kbd-audit verts.

## Assumptions

- « Avant » pour l'e-mail de correction = ce que le client a reçu : confirmation (`Lignes
  besteld`) ou dernier e-mail de correction.
- E-mails client dans la langue du client (comportement existant de `lib/ordermail.js`, C-15) ;
  copie interne en néerlandais.
- L'e-mail n'est jamais envoyé automatiquement : le personnel décide (un clic).
