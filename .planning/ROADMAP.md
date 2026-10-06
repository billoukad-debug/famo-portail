# Roadmap: FAMO Portail

## Overview

Le portail est en production (version 333125a, specs 001-023). Le jalon **v2.1 « Usage réel »** fait passer FAMO de la période de test à l'exploitation réelle : d'abord des données propres et un catalogue juste, puis la conformité de la traçabilité par lot, l'ouverture de nouveaux canaux de commande, et enfin le pilotage de l'activité réelle. Chaque phase se réalise par des specs spec-kit (`specs/NNN-nom/`) et/ou des gestes du propriétaire dans Beheer ; les portes de qualité du dépôt (constitution, `node scripts/check.js`, ESLint 9.39.5, audits navigateur) s'appliquent à toute phase qui touche le code.

## Milestones

- ✅ **v2.0 Portail en production** - specs 001-023 + correctif des favoris (shipped, version 333125a)
- 🚧 **v2.1 Usage réel** - Phases 1-4 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Mise en service propre** - Plus aucune donnée de test, catalogue corrigé, comptes de test archivés, option d'archivage des clients non cochés
- [ ] **Phase 2: Traçabilité numérique par lot** - Transmission numérique au client de l'information de lot (règlement (UE) 2023/2842)
- [ ] **Phase 3: Canaux de commande** - Commande par e-mail activée en production, puis WhatsApp
- [ ] **Phase 4: Pilotage** - Rapportage en usage réel, réassort en un clic, rappel avant la deadline

## Phase Details

### Phase 1: Mise en service propre
**Goal**: L'exploitation réelle démarre sur une base propre : aucune trace d'essai visible, un catalogue dont les calibres et les catégories sont justes, et des comptes clients réels seulement.
**Depends on**: Nothing (first phase)
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, DATA-01, DATA-02
**Entrée** : back-up fraîche prise par le propriétaire ; avis du comptable demandé (exports déjà envoyés ? remise à zéro ?).
**Success Criteria** (what must be TRUE):
  1. Après « Testperiode afsluiten » (Beheer → Systeemstatus), Bestellingen, Magazijn, Leveringen, Documenten, la Rapportage et le portail d'un client de test ne montrent plus aucun essai, et une back-up de l'état d'avant est rangée hors du portail.
  2. La numérotation FA/CN suit la décision écrite du comptable : soit elle redémarre à `FA-2026-0001` (aucun document d'essai transmis), soit elle continue, et le Journaal le trace.
  3. Les comptes clients de test ne peuvent plus se connecter et n'apparaissent plus dans Invoeren, les listes ni la Rapportage.
  4. Dans l'outil de fin de période de test, le beheerder peut archiver aussi les clients non cochés comme vrais clients, voit l'aperçu sans écriture, et peut revenir en arrière ; un test échoue sans le code.
  5. Aucun produit actif n'a de poids dans `Kaliber`, et la catégorie « Algemeen » ne concerne plus que des produits réellement non classables (vérifié dans Beheer → Producten et la Rapportage par catégorie).
**Plans**: TBD (une spec pour OPS-04 ; le reste = gestes guidés du propriétaire)

### Phase 2: Traçabilité numérique par lot
**Goal**: Chaque client reçoit, sous forme numérique, l'information de traçabilité des lots qui lui ont été livrés, conforme au règlement (UE) 2023/2842, à partir des lots déjà gérés par le portail.
**Depends on**: Phase 1 (catalogue juste, plus de commandes d'essai dans les traces)
**Requirements**: TRACE-01, TRACE-02, TRACE-03, TRACE-04
**Entrée** : réponses du propriétaire à Q-TRACE-1 (qui demande l'info), Q-TRACE-2 (forme fournie par les fournisseurs), Q-TRACE-3 (saisie du lot à chaque préparation) ; recherche documentaire sur le contenu exact exigé par le règlement.
**Success Criteria** (what must be TRUE):
  1. Pour une commande livrée avec lots, le client dispose sous forme numérique (forme retenue après Q-TRACE-1/2) de l'information de lot de chaque ligne, dans sa langue.
  2. L'information transmise est identique à l'instantané figé à la préparation, même si la fiche du lot est corrigée ensuite.
  3. Le beheerder retrouve en une recherche toutes les informations de lot transmises à un client sur une période.
  4. Le rattachement lot ↔ ligne passe par l'identifiant produit ; renommer un produit ne casse plus la traçabilité (test qui échoue sans le code).
**Plans**: TBD

### Phase 3: Canaux de commande
**Goal**: Les clients peuvent commander autrement que par le portail — d'abord par e-mail (déjà livré, à activer), ensuite par WhatsApp — sans que le serveur cesse de décider.
**Depends on**: Phase 1 (catalogue juste : la lecture automatique s'appuie sur les noms et calibres)
**Requirements**: CHAN-01, CHAN-02
**Entrée** : réglages Resend inbound faits par le propriétaire (RUNBOOK § 7.1) ; réponse à Q-CHAN-1 avant la partie WhatsApp.
**Success Criteria** (what must be TRUE):
  1. Un e-mail envoyé depuis l'adresse d'une fiche client de test à l'adresse de commande apparaît dans « Te controleren » avec une proposition lisible et `dmarc=pass`, puis, interrupteur allumé, crée une commande et une confirmation au client.
  2. `privacy.html` cite Resend (réception) et Anthropic (lecture automatique) comme sous-traitants avant l'activation.
  3. Un client connu peut envoyer sa commande par WhatsApp ; ce qui est certain devient une commande, ce qui est incertain va dans « Te controleren », jamais de commande pour un inconnu.
**Plans**: TBD

### Phase 4: Pilotage
**Goal**: Le gérant pilote son activité réelle depuis le portail et fait revenir les clients au bon moment.
**Depends on**: Phase 1 (données réelles propres) ; Phase 3 pour un rappel par WhatsApp
**Requirements**: PIL-01, PIL-02, PIL-03
**Entrée** : réponses à Q-PIL-1 (périmètre du réassort) et Q-PIL-2 (canal et délai du rappel).
**Success Criteria** (what must be TRUE):
  1. Sur un mois réel, les chiffres de la Rapportage (omzet, factures, marge, top clients et produits, catégories) concordent avec les documents du mois et n'incluent aucun essai.
  2. Le réassort se déclenche en un clic depuis l'écran retenu (Q-PIL-1) et le serveur revérifie prix, stock et règles de livraison.
  3. Un client qui n'a pas encore commandé pour le prochain jour de livraison reçoit un rappel avant la `Besteldeadline`, une seule fois, et peut s'en désinscrire.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 (la partie e-mail de la phase 3 peut démarrer dès que les réglages du propriétaire sont faits ; elle ne touche pas les fichiers de la phase 2)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Mise en service propre | 0/TBD | Not started | - |
| 2. Traçabilité numérique par lot | 0/TBD | Not started | - |
| 3. Canaux de commande | 0/TBD | Not started | - |
| 4. Pilotage | 0/TBD | Not started | - |
