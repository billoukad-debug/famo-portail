# Feature Specification: Eenvoudig beheer — « Vandaag », l'écran de Mohsen

**Feature Branch**: `claude/brave-lovelace-s4xk7h` (sur `main` a159186)
**Created**: 2026-10-07
**Status**: Draft (design validé par le co-gérant le 2026-10-07)
**Input**: demande du co-gérant, verbatim : « J'ai besoin d'une version pour Mohsen car actuellement il
est le seul qui utilise l'app. Il aimerait ne pas avoir les étapes de magazijn, levering etc. où il peut
simplement recevoir les commandes et passer en 1 clic entre les étapes, ultra simpliste et parfait, qu'il
utilisera sur son iPhone et sur son ordi. Il s'agira du lieu d'utilisation principal de FAMO. C'est ça
le vrai beheer. » Décisions prises en séance (questions à choix) :
- **Étapes** : on garde les 4 étapes (Ontvangen → Klaar → Onderweg → Geleverd), **1 tap chacune**.
- **Sur le même écran** : saisir une commande téléphone/WhatsApp ; modifier / annuler ; documents et
  « Betaald » ; appeler / écrire (WhatsApp) au client.
- **Emplacement** : **interrupteur par appareil** « Eenvoudig / Uitgebreid » ; Uitgebreid = l'existant,
  inchangé.
- **Alertes** : lot 1 = e-mail existant + pastille / son quand l'app est ouverte ; **push iPhone = lot 2**
  (spec séparée).
- Contexte MiroFish (simulation du 2026-10-07, `~/ext/mirofish-famo/sortie/`) : la commande tardive
  sans réponse est le premier facteur de départ ; « aide humaine visible » et « 1-2 taps » retiennent.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mohsen fait avancer une commande en 1 tap par étape (Priority: P1)

Sur son iPhone, Mohsen ouvre FAMO (icône sur l'écran d'accueil). Il voit « Vandaag » : les commandes
à traiter, une carte par commande (client, date de livraison, montant, articles en une ligne). Sur la
carte d'une commande « Ontvangen », un seul grand bouton « ✓ Klaar ». Il tape : la carte passe dans
« Klaar », le bouton devient « 🚚 Onderweg ». Puis « ✓ Geleverd » (réceptionnaire = nom du client,
modifiable), puis « € Betaald ». Aucun autre écran n'est nécessaire.

**Why this priority**: c'est la raison d'être de la demande ; sans elle rien d'autre n'a de valeur.

**Independent Test**: scénario navigateur (`scripts/parcours-check.js`) sur `node scripts/dev.js` :
une commande Reçue passe à Facturée + Payé en 4 taps ; et test serveur que les appels envoyés sont
ceux des règles existantes (aucune règle serveur modifiée).

**Acceptance Scenarios**:

1. **Given** une commande « Ontvangen », **When** Mohsen tape « Klaar », **Then** la commande est
   « Klaar » côté serveur (préparation validée avec les quantités commandées), la carte change de
   groupe sans recharger la page, et le bouton suivant est « Onderweg ».
2. **Given** une commande « Klaar », **When** il tape « Onderweg », **Then** le serveur la met en
   livraison (stock déduit si « Voorraad afboeken » est actif, e-mail « onderweg » au client comme
   aujourd'hui).
3. **Given** une commande « Onderweg », **When** il tape « Geleverd », **Then** la livraison est
   confirmée avec le nom du client comme réceptionnaire (modifiable avant confirmation), le numéro
   FA est attribué par le serveur, l'e-mail « geleverd » part comme aujourd'hui ; photo / signature
   restent facultatives et ajoutables ensuite.
4. **Given** une commande « Geleverd » non payée, **When** il tape « Betaald » et choisit le mode
   (Contant / Overschrijving / Bancontact), **Then** la commande est payée ; elle quitte la liste du
   jour.
5. **Given** un tap qui vient de réussir, **Then** une barre « Ongedaan maken » reste visible 6 s ;
   la toucher remet la commande à l'étape précédente par la correction serveur existante (raison
   automatique « Ongedaan in Vandaag »), sauf « Geleverd » déjà facturé, qui suit la règle existante
   (retour possible pour le beheerder, numéro FA conservé).
6. **Given** le serveur refuse (stock insuffisant, lots obligatoires manquants, commande modifiée par
   ailleurs, réseau), **Then** le message du serveur s'affiche sur la carte, la commande ne bouge pas
   et rien n'est perdu ; si « Lots verplicht » est actif, le tap « Klaar » ouvre la saisie des lots au
   lieu d'échouer.

---

### User Story 2 - Mohsen voit tout de suite ce qui est nouveau (Priority: P1)

Il ouvre l'app le soir : en haut, quatre filtres avec leur nombre « Nieuw 3 · Klaar 1 · Onderweg 2 ·
Geleverd ». Par défaut, il voit toutes les commandes à traiter, triées par date de livraison puis
heure de commande ; les nouvelles sont marquées. Quand une commande arrive pendant que l'app est
ouverte, elle apparaît en moins de 60 s avec un signal discret (pastille, nombre dans le titre, son
court désactivable).

**Why this priority**: recevoir les commandes est la première moitié de la demande.

**Acceptance Scenarios**:

1. **Given** 3 commandes Reçue et 2 Onderweg, **Then** les compteurs affichent 3 et 2, et la liste
   « à traiter » montre les 5, triées par date de livraison.
2. **Given** l'app ouverte, **When** un client passe commande, **Then** elle apparaît sans
   rechargement en ≤ 60 s, marquée « Nieuw », avec le son si activé.
3. **Given** aucune commande à traiter, **Then** un état vide clair (« Alles is bijgewerkt ») avec le
   bouton « + Bestelling ».

---

### User Story 3 - Mohsen saisit une commande reçue par téléphone ou WhatsApp (Priority: P1)

Un client appelle. Mohsen tape « + Bestelling », choisit le client (recherche), ajoute les articles
(favoris / habituels du client en premier, recherche, quantités avec les règles de carton), voit le
total, envoie. La commande apparaît dans « Nieuw ».

**Why this priority**: MiroFish et Mohsen : beaucoup de commandes arrivent encore par téléphone.

**Acceptance Scenarios**:

1. **Given** un client et deux articles, **When** il envoie, **Then** la commande est créée par la
   même voie que l'écran Invoeren (prix du client, règles serveur, e-mails), statut « Ontvangen ».
2. **Given** un article « enkel per doos van 6 », **Then** la quantité avance par doos et le
   serveur refuse un non-multiple comme aujourd'hui.

---

### User Story 4 - Modifier, annuler, documents, contact (Priority: P2)

Sur chaque carte, « ⋯ » ouvre : modifier les quantités (tant que la commande n'est pas partie),
annuler avec une raison, ouvrir le bon de livraison / la pro forma, ajouter photo ou signature de
livraison, appeler le client (lien téléphone) ou lui écrire sur WhatsApp.

**Acceptance Scenarios**:

1. **Given** une commande Ontvangen ou Klaar, **When** il change une quantité, **Then** le serveur
   recalcule prix et total (mêmes règles que la feuille de commande actuelle).
2. **Given** une commande, **When** il l'annule avec une raison, **Then** elle passe « Geannuleerd »
   par la correction serveur existante et quitte la liste.
3. **Given** un client avec un numéro, **Then** « Bellen » ouvre l'appel et « WhatsApp » ouvre la
   conversation ; sans numéro, ces actions sont absentes (pas désactivées en silence).
4. **Given** une commande, **Then** le document s'ouvre dans l'aperçu existant (pro forma tant que
   « Facturatie: Boekhouder »).

---

### User Story 5 - Interrupteur Eenvoudig / Uitgebreid par appareil (Priority: P1)

Sur l'iPhone de Mohsen : mode Eenvoudig. L'app s'ouvre sur « Vandaag », le menu ne montre que
Vandaag, Beheer (producten, prijzen, klanten…), Rapportage et « Meer ». Un futur employé, sur un autre
appareil, garde Uitgebreid : tous les écrans actuels, inchangés.

**Acceptance Scenarios**:

1. **Given** un appareil en Eenvoudig, **When** on ouvre l'app ou on se connecte, **Then** on arrive
   sur Vandaag.
2. **Given** Uitgebreid (défaut d'un appareil jamais réglé : voir Assumptions), **Then** menu, pages
   et parcours sont identiques à avant (audits navigateur inchangés).
3. **Given** le stockage local bloqué ou vide, **Then** l'app fonctionne avec le mode par défaut,
   sans erreur.

### Edge Cases

- Deux appareils sur la même commande : le serveur refuse le second tap (verrou / étape) ; la carte
  se met à jour avec l'état réel.
- Perte de réseau pendant un tap : rien ne bouge, message « Geen verbinding », réessai possible ; la
  confirmation de livraison hors ligne garde la file d'attente existante.
- Commande « Annulée » ou archivée de test : jamais affichée dans Vandaag.
- Commande d'un client sans e-mail : les étapes marchent ; simplement aucun e-mail client.
- Commande du jour passée de date (livraison hier, toujours Klaar) : reste en tête, marquée « te laat ».
- Écran très étroit (iPhone SE, 320 px) et ordinateur large : aucune barre de défilement horizontale ;
  sur ordinateur la liste peut passer en deux colonnes.
- « Betaald » n'est proposé qu'au beheerder (règle serveur existante) ; un compte personnel voit
  l'étape s'arrêter à Geleverd.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Un écran « Vandaag » liste les commandes à traiter (Ontvangen, Klaar, Onderweg, et
  Geleverd non payées), avec 4 filtres comptés et un tri par date de livraison puis heure.
- **FR-002**: Chaque carte porte UNE action principale = l'étape suivante (Klaar → Onderweg →
  Geleverd → Betaald), en 1 tap (Geleverd : réceptionnaire prérempli ; Betaald : mode de paiement).
- **FR-003**: Chaque étape passe par les règles serveur existantes, inchangées (ordre des étapes,
  préparation validée, stock, lots, numéro FA, e-mails, journal d'audit, droits). Aucune nouvelle
  règle métier côté navigateur.
- **FR-004**: Après chaque tap réussi, « Ongedaan maken » pendant 6 s, via la correction serveur
  existante ; un refus serveur est affiché tel quel sur la carte.
- **FR-005**: « + Bestelling » crée une commande pour un client choisi, par la même voie serveur que
  l'écran Invoeren (prix, conditionnement, e-mails).
- **FR-006**: Menu « ⋯ » par carte : modifier les quantités (avant départ), annuler avec raison,
  ouvrir le document, ajouter photo / signature, appeler, WhatsApp (si numéro).
- **FR-007**: Actualisation automatique ≤ 60 s quand l'écran est visible ; nouvelle commande
  signalée (marque « Nieuw », compteur, titre, son court désactivable par appareil).
- **FR-008**: Interrupteur par appareil « Eenvoudig / Uitgebreid » (stockage local protégé) ;
  Eenvoudig : arrivée sur Vandaag et menu réduit ; Uitgebreid : existant inchangé.
- **FR-009**: L'app installée sur iPhone s'ouvre en plein écran sur la bonne page (manifeste, balises
  Apple manquantes ajoutées) ; la page marche aussi dans Safari et sur ordinateur.
- **FR-010**: Textes en néerlandais (règle du personnel), cibles ≥ 44 px (bouton principal ≥ 56 px),
  WCAG 2.2 AA, navigation clavier complète, focus visible, annonces ARIA des changements d'étape.
- **FR-011**: Accès réservé au personnel connecté (session existante) ; sans session → page de
  connexion ; aucune donnée sans session.
- **FR-012**: Documentation : AGENTS.md (liste des specs), RUNBOOK (« Vandaag » pour le gérant),
  SCHEMA (aucun champ nouveau prévu ; s'il en faut un, il est documenté dans le même commit).

### Key Entities

- **Commande** (existante) : statut, préparation, livraison, paiement, lignes — aucune modification.
- **Préférence d'appareil** (nouvelle, locale) : mode Eenvoudig / Uitgebreid, son on/off.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Une commande va de « Ontvangen » à « Betaald » en 4 taps (+ choix du mode de paiement)
  depuis un seul écran, sans ouvrir Magazijn, Leveringen ni la feuille de commande.
- **SC-002**: Saisir une commande téléphone de 3 articles prend ≤ 30 s pour un utilisateur habitué
  (mesuré au parcours navigateur, hors frappe).
- **SC-003**: Zéro écart sur `ux-audit`, `parcours-check`, `kbd-audit` et `contrast-check`, à 390 px et
  1280 px, en Eenvoudig ET en Uitgebreid.
- **SC-004**: Aucune règle serveur modifiée : `node scripts/check.js` (tous les tests métier existants)
  reste vert sans changer un test existant.
- **SC-005**: Mohsen valide en préversion sur son iPhone et son ordinateur avant fusion.

## Assumptions

- Mohsen se connecte avec son PIN personnel de beheerder : il a donc les droits « Betaald » et
  « retour après livraison ».
- Mode par défaut d'un appareil jamais réglé : **Uitgebreid** (aucune surprise pour un autre appareil) ;
  Mohsen bascule une fois sur son iPhone et son ordinateur. Au premier passage sur Vandaag, une
  invite propose « Altijd zo openen? » (Eenvoudig).
- « Klaar » valide la préparation avec les quantités commandées ; un écart se corrige d'abord par
  « ⋯ → Aantallen wijzigen ».
- Réceptionnaire par défaut : nom du client (commerce) ; Mohsen peut le changer.

## Out of Scope

- Notification push iPhone (lot 2, spec séparée).
- Commande par WhatsApp entrante (spec future) ; ici seulement « écrire au client ».
- Toute modification des règles serveur, des documents, des e-mails ou de la facturation.
- Suppression des écrans Magazijn / Leveringen / Bestellingen (ils restent pour Uitgebreid).
