# Requirements: FAMO Portail

**Defined:** 2026-10-02
**Core Value:** Une commande passée par un client arrive juste — bons produits, prix négociés, jour de livraison, stock et documents — parce que le serveur décide de tout, du panier au document remis.

> Chaque exigence se réalise par une spec spec-kit (`specs/NNN-nom/`) ou par un geste du propriétaire dans Beheer, selon sa nature (colonne « Voie » de la traçabilité). Les capacités déjà livrées (specs 001-023) sont dans `PROJECT.md` § Validated.

## v1 Requirements (jalon v2.1 « Usage réel »)

### Mise en service (OPS / DATA)

- [ ] **OPS-01**: Aucune commande ni aucun document d'essai n'apparaît plus dans Bestellingen, Magazijn, Leveringen, Documenten, la Rapportage ni le portail client, après une back-up conservée hors du portail (outil spec 021, geste du propriétaire, RUNBOOK § 8)
- [ ] **OPS-02**: La décision de redémarrer ou non la numérotation FA/CN est prise sur l'avis écrit du comptable et appliquée (« Nummering herstarten » seulement si aucun document d'essai n'a été transmis)
- [ ] **OPS-03**: Les comptes clients de test (dont `aloha`) ne peuvent plus se connecter et ne figurent plus dans les listes (Invoeren, statistiques, Rapportage)
- [ ] **OPS-04**: Dans « Testperiode afsluiten », le beheerder peut choisir d'archiver aussi les clients non cochés comme « vrais clients », avec aperçu sans écriture et retour arrière
- [ ] **DATA-01**: Le champ `Kaliber` de chaque produit actif contient un calibre (ex. « 16/20 », « U10 ») et plus aucun poids (ex. « 0.800 ») ; le poids, s'il compte, est porté ailleurs (unité, conditionnement ou nom)
- [ ] **DATA-02**: Chaque produit actif a une catégorie significative ; « Algemeen » ne reste que pour les produits réellement non classables (56 sur 69 au 2026-10-02)

### Traçabilité par lot (TRACE)

- [ ] **TRACE-01**: Pour chaque ligne livrée, le client reçoit sous forme numérique les informations de traçabilité du lot exigées par le règlement (UE) 2023/2842 (contenu exact et forme à fixer par la recherche de phase et les réponses Q-TRACE-1 à 3)
- [ ] **TRACE-02**: L'information transmise correspond exactement à l'instantané figé à la préparation (un lot corrigé ensuite ne réécrit jamais une information déjà transmise)
- [ ] **TRACE-03**: Le beheerder retrouve, pour un client et une période, toutes les informations de lot transmises (demande d'un client ou de l'AFSCA)
- [ ] **TRACE-04**: Le rattachement lot ↔ ligne de commande passe par l'identifiant produit (`Lignes JSON` `productId`) et non plus par le nom

### Canaux de commande (CHAN)

- [ ] **CHAN-01**: La commande par e-mail (spec 020) fonctionne en production : réglages Resend inbound faits, `privacy.html` cite Resend et Anthropic comme sous-traitants, premier essai depuis une fiche client de test arrivé dans « Te controleren » avec `dmarc=pass`, interrupteur « automatisch aanmaken » allumé par le propriétaire
- [ ] **CHAN-02**: Un client connu peut commander par WhatsApp, avec la même règle que l'e-mail : la lecture propose, le serveur décide (`lib/bestelling.js`), l'incertain va dans « Te controleren »

### Pilotage (PIL)

- [ ] **PIL-01**: Le beheerder suit son activité réelle dans la Rapportage (commandes de test exclues, catégories corrigées) et les chiffres concordent avec les documents du mois
- [ ] **PIL-02**: Réassort en un clic (périmètre à préciser, Q-PIL-1 : recommande client d'une commande précédente, ou commande fournisseur à partir des seuils de stock)
- [ ] **PIL-03**: Un client qui n'a pas encore commandé pour le prochain jour de livraison reçoit un rappel avant la `Besteldeadline` (canal, délai et désinscription à préciser, Q-PIL-2)

## v2 Requirements

Reconnues, hors de ce jalon.

### Dette et sécurité

- **SEC-01**: Retirer le chemin de transition « jeton client dans le corps » après le 31/10/2026 (`lib/clientauth.js` `BODY_TOKEN_UNTIL`)
- **DEBT-01**: Activer les règles ESLint `no-useless-escape` et `no-regex-spaces` après correction des cas
- **NUM-01**: Dédoublonnage ou compteur atomique pour les références CMD (ADR 0004) quand plusieurs canaux créent des commandes en parallèle

### Exploitation

- **EXPL-01**: Comptes de service transférés à Famo Trading BV avec un second administrateur (`docs/TRANSFERT.md`)
- **EXPL-02**: Exports comptables alignés sur l'avis du comptable (CSV/UBL, note de ligne BT-127)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Envoi Peppol / factures légales depuis le portail | ADR 0005 VERROUILLÉE : le comptable émet via Billtobox ; seulement si FAMO quitte Billtobox |
| Optimisation de tournée, carte, suivi live | Hors version (`README.md`) |
| Import Excel | Hors version (`README.md`) |
| CRM, multi-entrepôts, app native, offline complet | `IDEAS.md` « Ce qu'on ne fera pas » |
| Dashboard analytics générique | Rapportage (spec 022) suffit |
| Build, framework, dépendances npm | ADR 0001, constitution § I |

## Traceability

| Requirement | Phase | Voie | Status |
|-------------|-------|------|--------|
| OPS-01 | Phase 1 | geste propriétaire (spec 021) | Pending |
| OPS-02 | Phase 1 | avis comptable + geste propriétaire | Pending |
| OPS-03 | Phase 1 | geste propriétaire (Beheer → Klanten) | Pending |
| OPS-04 | Phase 1 | nouvelle spec (extension 021) | Pending |
| DATA-01 | Phase 1 | correction de données (Beheer), outil si besoin | Pending |
| DATA-02 | Phase 1 | correction de données (Beheer) | Pending |
| TRACE-01 | Phase 2 | nouvelle spec | Pending |
| TRACE-02 | Phase 2 | nouvelle spec | Pending |
| TRACE-03 | Phase 2 | nouvelle spec | Pending |
| TRACE-04 | Phase 2 | nouvelle spec | Pending |
| CHAN-01 | Phase 3 | geste propriétaire (RUNBOOK § 7) + petite spec `privacy.html` | Pending |
| CHAN-02 | Phase 3 | nouvelle spec | Pending |
| PIL-01 | Phase 4 | vérification sur données réelles | Pending |
| PIL-02 | Phase 4 | nouvelle spec | Pending |
| PIL-03 | Phase 4 | nouvelle spec | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

## Open Questions (à ne pas trancher sans le propriétaire)

- **Q-TRACE-1** : qui demande l'information de traçabilité (le client, l'AFSCA, les deux) et à quel moment ?
- **Q-TRACE-2** : sous quelle forme les fournisseurs donnent-ils l'information de lot (papier, PDF, fichier, portail fournisseur) ?
- **Q-TRACE-3** : le préparateur saisit-il le lot à chaque préparation (option `Lots verplicht` active) ?
- **Q-PIL-1** : « réassort en un clic » vise-t-il le client (recommander) ou l'achat fournisseur (réapprovisionner le stock) ?
- **Q-PIL-2** : canal et délai du rappel avant la deadline (e-mail, WhatsApp ; combien de temps avant ; désinscription) ?
- **Q-CHAN-1** : fournisseur WhatsApp (API officielle Meta Cloud ou intermédiaire) et coût accepté ?
- **Q-LANG-1** : la constitution (§ IV « E-mails : néerlandais ») doit-elle être amendée pour refléter le code, qui envoie les e-mails client dans la langue du client (audit C-15, spec 020) ?

---
*Requirements defined: 2026-10-02*
*Last updated: 2026-10-02 after onboarding brownfield*
