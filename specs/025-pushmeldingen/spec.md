# Feature Specification: Pushmeldingen — une notification sur l'iPhone à chaque nouvelle commande

**Feature Branch**: `claude/brave-lovelace-s4xk7h` (sur `main` 3739d89)
**Created**: 2026-10-08
**Status**: Implémenté, tests verts ; reste la validation sur l'iPhone de Mohsen (SC-005, T011). Design validé par le co-gérant le 2026-10-08 (« ok »)
**Input**: lot 2 de la spec 024 (« Push iPhone en 2e temps »), demande du co-gérant : « lance le lot 2 push
iphone ». Design présenté et validé (7 points) :
1. Web Push standard ; iPhone : iOS 16.4 ou plus, app ajoutée à l'écran d'accueil (Apple n'envoie pas de push à
   un onglet Safari).
2. Une notification à chaque nouvelle commande (portail client, commande par e-mail) ; toucher → Vandaag.
3. Activation par appareil depuis Vandaag ; sans app installée, l'explication pour l'ajouter.
4. Clés de notification générées par le serveur à la première activation, gardées en base, jamais affichées.
5. Table des appareils, nettoyage automatique, liste et retrait dans Beheer → Toegang.
6. Aucune dépendance : chiffrement standard (RFC 8291) et signature (RFC 8292) avec `node:crypto`.
7. Ne bloque jamais une commande (envoi après l'enregistrement, borné dans le temps).
Question ouverte sans réponse (« e-mails Te controleren aussi ? ») : recommandation appliquée — oui, en P2.
Contexte MiroFish (2026-10-07) : la commande tardive sans réaction est le premier facteur de départ.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mohsen active les notifications sur son iPhone (Priority: P1)

Sur l'iPhone, FAMO est sur l'écran d'accueil. Dans Vandaag, Mohsen touche « Meldingen », puis « Aanzetten » :
iOS demande l'autorisation, il accepte. L'écran confirme « Meldingen staan aan op dit toestel » et propose
« Test sturen » : une notification « FAMO · Test » arrive en quelques secondes.

**Why this priority**: sans abonnement, aucune notification n'est possible.

**Independent Test**: tests serveur (`test/push.test.js`, SQLite en mémoire, réseau simulé) : abonnement,
désabonnement, test ; parcours navigateur : le panneau « Meldingen » s'ouvre et explique l'état.

**Acceptance Scenarios**:

1. **Given** l'app installée et iOS ≥ 16.4, **When** Mohsen touche « Aanzetten » et accepte, **Then**
   l'appareil est enregistré côté serveur (une seule fois, même s'il recommence) et l'écran dit « aan ».
2. **Given** Safari sans app installée (iPhone), **Then** « Meldingen » explique en 3 étapes comment ajouter FAMO
   à l'écran d'accueil (Delen → Zet op beginscherm → openen vanaf het icoon) ; aucun bouton qui échoue.
3. **Given** un navigateur sans notification push, **Then** un message clair « Dit toestel ondersteunt geen
   meldingen » ; l'e-mail de nouvelle commande reste le filet.
4. **Given** l'autorisation refusée dans iOS, **Then** l'écran explique où la rétablir (Instellingen → Meldingen
   → FAMO).
5. **Given** les notifications actives, **When** il touche « Test sturen », **Then** une notification de test est
   envoyée à CET appareil seulement.

---

### User Story 2 - Une nouvelle commande arrive : notification sur l'écran verrouillé (Priority: P1)

Un client passe commande à 23 h 40 depuis le portail. Quelques secondes plus tard, l'iPhone de Mohsen affiche
« Nieuwe bestelling — Aloha Poke Bowls · € 164,80 · levering vr 9 okt ». Il touche la notification : FAMO
s'ouvre sur Vandaag.

**Why this priority**: c'est la raison du lot (MiroFish : la commande du soir sans réaction fait partir le client).

**Acceptance Scenarios**:

1. **Given** un appareil abonné, **When** une commande est passée au portail client ou créée depuis un e-mail,
   **Then** chaque appareil abonné reçoit une notification chiffrée (client, montant, jour de livraison) ; le
   toucher ouvre `/team/vandaag`.
2. **Given** une commande saisie par le personnel (Invoeren, « + Bestelling » de Vandaag), **Then** aucune
   notification (FAMO l'a saisie elle-même).
3. **Given** le service de notification lent ou en panne, **Then** la commande est enregistrée et confirmée
   comme avant ; l'attente supplémentaire est bornée (≤ 4 s) ; l'échec est noté sur l'appareil.
4. **Given** un appareil désinstallé (le service répond 404 / 410), **Then** l'appareil est retiré
   automatiquement de la liste.

---

### User Story 3 - Un e-mail est à contrôler (Priority: P2)

Quand la commande par e-mail sera activée : un e-mail qui arrive dans « Te controleren » envoie
« E-mail te controleren — Resto A: 2 dozen eieren… » ; le toucher ouvre Bestellingen → Te controleren.

**Acceptance Scenarios**:

1. **Given** un e-mail mis en « Te controleren », **Then** une notification part vers les appareils abonnés ; au plus
   une par 10 minutes (une vague de messages, spam compris, ne fait pas sonner le téléphone à chaque fois ; la file
   montre le nombre).
2. **Given** un e-mail ignoré (réponse automatique, autre adresse), **Then** aucune notification.

---

### User Story 4 - Gérer les appareils (Priority: P2)

Dans Vandaag → Meldingen, « Uitzetten » arrête les notifications sur cet appareil. Dans Beheer → Toegang, le
beheerder voit la liste des appareils (qui, quel appareil, depuis quand, dernier envoi, dernière erreur) et peut
en retirer un.

**Acceptance Scenarios**:

1. **Given** un appareil abonné, **When** « Uitzetten », **Then** il est retiré du serveur et ne reçoit plus rien.
2. **Given** Beheer → Toegang, **Then** la liste est visible au beheerder seul (le personnel : refus serveur).

### Edge Cases

- Deux instances serveur génèrent les clés en même temps : une seule paire est gardée (relecture après écriture).
- Adresse d'abonnement qui ne vient pas d'un service de notification connu (Apple, Google, Mozilla, Microsoft) :
  refusée (le serveur n'envoie jamais de requête vers une adresse arbitraire).
- Plus de 20 appareils : refus clair.
- Clés changées (nouvelle paire) : les anciens abonnements échouent puis sont retirés ; il suffit de réactiver.
- Session expirée sur l'iPhone : la notification arrive quand même (elle ne dépend pas de la session) ; le toucher
  ouvre Vandaag, qui demande la connexion si besoin.
- Contenu : jamais de prix détaillé ni d'adresse ; client, montant total et jour de livraison seulement.
- Plusieurs commandes pendant que le téléphone est hors ligne : chacune est livrée (pas d'en-tête `Topic`, qui
  remplacerait la précédente chez le service).
- Base Airtable (historique, plus utilisée en production) : notifications inertes, aucune requête (comme le journal).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le serveur expose la clé publique de notification au personnel connecté et enregistre /
  retire l'abonnement d'un appareil (session personnel obligatoire, garde Origin + JSON).
- **FR-002**: Les clés (VAPID, P-256) viennent des variables `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` si elles
  sont définies, sinon elles sont générées une fois et gardées dans Configuratie ; la clé privée n'est jamais
  envoyée au navigateur ni écrite dans un journal.
- **FR-003**: Chaque notification est chiffrée de bout en bout (RFC 8291, aes128gcm) et signée (RFC 8292) ;
  aucune dépendance npm.
- **FR-004**: Nouvelle commande du portail client ou créée depuis un e-mail → notification à chaque appareil
  abonné ; commande saisie par le personnel → aucune.
- **FR-005**: E-mail mis en « Te controleren » → notification (P2), au plus une par 10 minutes.
- **FR-006**: L'envoi ne peut ni faire échouer ni bloquer durablement une commande : en parallèle de l'e-mail,
  ≤ 4 s par appareil, erreurs capturées et notées.
- **FR-007**: Réponse 404 / 410 du service → appareil retiré ; autre erreur → « Laatste fout » notée.
- **FR-008**: Seules les adresses des services de notification connus (HTTPS) sont acceptées ; au plus 20
  appareils.
- **FR-009**: Vandaag → « Meldingen » : état de l'appareil, Aanzetten / Uitzetten / Test sturen, son dans l'app ;
  explications pour l'app non installée, le navigateur sans push, l'autorisation refusée. Textes NL, 44 px,
  WCAG 2.2 AA, clavier.
- **FR-010**: Le service worker affiche la notification et ouvre la bonne page au toucher (même origine).
- **FR-011**: Beheer → Toegang : liste des appareils et retrait (beheerder seul).
- **FR-012**: Documentation : SCHEMA (table `Pushabonnementen`, champs Configuratie), faux Airtable, RUNBOOK
  (activer sur l'iPhone, retirer un appareil, changer les clés), AGENTS.md, page vie privée (service de
  notification du fabricant de l'appareil).

### Key Entities

- **Pushabonnement** (nouvelle table `Pushabonnementen`) : adresse du service, clés de l'appareil, qui
  (medewerker / rôle), appareil (libellé court), créé le, dernier envoi, dernière erreur.
- **Clés de notification** (Configuratie) : clé publique, clé privée (serveur seulement).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Le chiffrement reproduit exactement l'exemple de la RFC 8291 (annexe A) ; la signature est vérifiable
  avec la clé publique.
- **SC-002**: Une commande client avec un appareil abonné déclenche un envoi au bon service, chiffré pour cet
  appareil et déchiffrable avec ses clés (test serveur, réseau simulé).
- **SC-003**: Zéro commande en échec à cause des notifications (service en panne, lent, 410, 500 : la commande
  répond 200).
- **SC-004**: `check.js`, ESLint, `contrast-check`, `ux-audit` → `parcours-check` → `kbd-audit` sans écart.
- **SC-005**: Sur l'iPhone de Mohsen (préversion ou production) : « Test sturen » puis une vraie commande de test
  font apparaître la notification (validation manuelle, hors CI).

## Assumptions

- Les notifications partent vers les services Apple / Google / Mozilla / Microsoft (chiffrées : ils ne lisent pas
  le contenu) ; c'est le fonctionnement standard des notifications web.
- Un seul utilisateur réel (Mohsen) ; tous les appareils abonnés reçoivent tout.
- Pas d'heures calmes dans ce lot : la commande du soir doit justement être vue.

## Out of Scope

- Heures calmes, choix des types de notification par appareil.
- Notifications aux clients.
- Commande par WhatsApp.
