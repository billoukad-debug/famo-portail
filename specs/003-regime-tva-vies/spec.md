# Feature Specification: Régime TVA par client et contrôle VIES

**Feature Branch**: `worktree-agent-a1926cfc4d1bceaa8`
**Created**: 2026-09-30
**Status**: Ready
**Input**: Audit C-10 (« un seul régime de TVA pour tous les clients : impossible de facturer
un restaurant néerlandais, français ou suisse à 0 % avec la bonne mention ») et C-16 (« le
numéro de TVA d'un client européen n'est jamais vérifié dans VIES »).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Facturer un client européen à 0 % avec la bonne mention (Priority: P1)

Le beheerder ouvre la fiche d'un restaurant de Maastricht, choisit le régime « Intracommunautaire
levering » et enregistre son numéro de TVA néerlandais. La commande suivante est livrée : la facture
(et la note de crédit éventuelle) porte 0 % de TVA sur toutes les lignes, quel que soit le taux des
produits, avec la mention légale d'exonération dans la langue du client. Le fichier UBL envoyé au
comptable porte la catégorie de TVA « K » et le motif d'exonération.

**Why this priority**: c'est l'erreur qui coûte : une facture à 6 % pour une livraison
intracommunautaire est fausse (TVA réclamée à tort au client, déclaration erronée) et se corrige par
une note de crédit.

**Independent Test**: portail de dev, fiche client → régime « Intracommunautaire », numéro
`NL123456789B01` ; confirmer une livraison : le document montre « btw 0% » et la mention ; l'export
UBL (Documenten → UBL) contient `<cbc:ID>K</cbc:ID>` et `VATEX-EU-IC`.

**Acceptance Scenarios**:

1. **Given** un client « Intracommunautaire » avec un numéro de TVA d'un autre pays de l'UE,
   **When** sa livraison est confirmée, **Then** la facture a 0 % sur chaque ligne, la TVA totale
   est 0 et le régime est figé sur la facture.
2. **Given** cette facture émise, **When** le beheerder repasse le client en « Normal » (ou change
   les taux du catalogue), **Then** la facture, sa note de crédit, le document client et l'UBL
   restent à 0 % avec la mention d'origine.
3. **Given** un client « Export » (hors UE), **When** il est facturé, **Then** 0 %, mention
   d'exonération à l'exportation, catégorie UBL « G ».
4. **Given** un client « Cocontractant » (autoliquidation belge), **When** il est facturé,
   **Then** 0 %, mention « Autoliquidation / Verlegging van heffing », catégorie UBL « AE ».
5. **Given** un client « Normal » (ou sans régime), **Then** rien ne change : taux par produit,
   aucune mention, catégories UBL S/Z.
6. **Given** un document d'un client FR, **Then** la mention est en français ; NL sinon.

---

### User Story 2 - Empêcher un régime incohérent (Priority: P1)

Le beheerder choisit « Intracommunautaire » pour un client dont le numéro est belge (ou vide) :
l'enregistrement est refusé avec un message clair en néerlandais. Même chose pour « Cocontractant »
sans numéro belge valide.

**Why this priority**: l'exonération intracommunautaire exige un numéro de TVA valable d'un autre
État membre ; l'autoliquidation belge exige un cocontractant assujetti belge.

**Independent Test**: Beheer → Klanten → régime « Intracommunautaire » + `BE0417497106` →
message d'erreur, rien n'est enregistré.

**Acceptance Scenarios**:

1. **Given** régime « Intracommunautaire » et numéro `BE…` ou vide, **When** on enregistre,
   **Then** 400 avec un message néerlandais qui dit quoi corriger.
2. **Given** régime « Cocontractant » et un numéro non belge ou aux chiffres de contrôle faux,
   **Then** 400.
3. **Given** un régime inconnu envoyé à l'API, **Then** 400.

---

### User Story 3 - Vérifier un numéro de TVA européen dans VIES (Priority: P2)

Dans la fiche client, le beheerder appuie sur « Controleren via VIES » : le portail interroge le
service officiel de la Commission européenne et affiche « geldig / niet geldig », le nom et l'adresse
connus de VIES et la date du contrôle, qui restent sur la fiche (preuve pour le comptable).

**Why this priority**: la validité du numéro de l'acheteur conditionne l'exonération
intracommunautaire ; la preuve du contrôle est utile en cas de contrôle fiscal.

**Independent Test**: tests automatiques avec un faux service VIES (aucun appel réseau réel) ;
portail de dev : bouton présent, message clair si VIES ne répond pas.

**Acceptance Scenarios**:

1. **Given** un client avec un numéro `NL…`, **When** le beheerder lance le contrôle, **Then** le
   résultat (valide, nom, adresse, date) s'affiche et est enregistré sur le client.
2. **Given** VIES indisponible, lent (> 8 s) ou en erreur, **Then** message clair « VIES niet
   bereikbaar », rien n'est modifié, et l'enregistrement de la fiche client reste possible.
3. **Given** un numéro changé après un contrôle, **When** la fiche est enregistrée, **Then** l'ancien
   résultat VIES est effacé (il ne concerne plus ce numéro).
4. **Given** un membre du personnel (non beheerder), **Then** l'action est refusée.

### Edge Cases

- Commande non encore facturée d'un client à 0 % : les montants affichés (liste, portail client,
  bon, pro forma) suivent déjà le régime actuel du client ; le régime n'est figé qu'à la facture.
- Facture émise avant cette fonctionnalité : aucun régime figé = « Normal » (ses taux figés restent).
- Lecture du client impossible au moment de facturer : la confirmation est refusée (503) AVANT
  l'attribution du numéro de facture (pas de trou dans la numérotation) ; la file hors ligne rejoue.
- Client « Export » sans numéro de TVA : facture PDF correcte ; l'UBL est refusé avec la raison
  (pas d'adresse Peppol connue).
- Client UE dont le pays n'a pas de schéma d'adresse Peppol connu du portail (DK, SE, XI) : UBL
  refusé avec la raison ; le PDF reste correct.
- Grèce : préfixe TVA `EL`, pays ISO `GR`.
- Réponse VIES « nom : --- » (État membre qui ne publie pas le nom) : nom vide.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Chaque client a un régime de TVA parmi `Normal` (défaut, champ absent),
  `Intracommunautaire`, `Export`, `Cocontractant`.
- **FR-002**: Pour un régime autre que `Normal`, toute facture et note de crédit est calculée à
  0 % sur chaque ligne, quels que soient les taux du catalogue ; le serveur décide.
- **FR-003**: Le régime est figé sur la facture au moment où elle est émise, comme les taux par
  ligne ; un changement ultérieur du client ne modifie aucune facture émise ni sa note de crédit.
- **FR-004**: Les documents (facture, pro forma, note de crédit, bon de retour) d'un régime à 0 %
  portent la mention légale du régime dans la langue du client (NL/FR).
- **FR-005**: L'UBL utilise la catégorie de TVA `K` (intracommunautaire), `G` (export) ou `AE`
  (autoliquidation), avec code et texte de motif d'exonération ; `S`/`Z` inchangés pour `Normal`.
  Pour `K`, le pays de livraison et la date de livraison sont présents ; l'acheteur étranger est
  identifié par son numéro de TVA complet.
- **FR-006**: `Intracommunautaire` exige un numéro de TVA avec le préfixe d'un autre État membre ;
  `Cocontractant` exige un numéro belge valide (modulo 97) ; sinon 400 avec message néerlandais.
- **FR-007**: Beheer → Klanten : liste de choix du régime (libellés néerlandais) avec aide ; le
  régime est visible sur la fiche.
- **FR-008**: Beheer peut contrôler un numéro de TVA européen via l'API REST officielle VIES ;
  délai maximal 8 s ; en cas d'échec, message clair (503) sans rien modifier ; jamais bloquant pour
  l'enregistrement du client.
- **FR-009**: Le résultat VIES (valide, nom, adresse, numéro contrôlé) et sa date sont enregistrés
  sur le client et effacés si le numéro de TVA change.
- **FR-010**: Action VIES réservée au beheerder, derrière la garde d'origine (`lib/guard`),
  journalisée comme les autres actions Beheer.
- **FR-011**: Export comptable CSV (Documenten) : colonne « Btw-regime » ajoutée en fin de ligne.

### Key Entities

- **Régime TVA du client** : valeur stockée en français sur le client (absent = `Normal`).
- **Régime TVA de la facture** : copie figée sur la commande au passage en « Facturée ».
- **Contrôle VIES** : date du contrôle + résultat (valide, nom, adresse, numéro contrôlé).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % des factures d'un client à régime 0 % ont une TVA totale de 0 et la mention
  (tests automatiques document + UBL, 3 régimes, 2 langues).
- **SC-002**: Une facture émise garde son régime après changement du client (test automatique).
- **SC-003**: Le contrôle VIES répond ou échoue proprement en 8 s au plus ; aucun test ne contacte
  le réseau.
- **SC-004**: Aucune régression : `node scripts/check.js` et ESLint verts.

## Assumptions

- **Mentions légales — à valider par le comptable (action client)** : le texte retenu est
  - Intracommunautaire : « Vrijgesteld van btw – intracommunautaire levering (art. 39bis, eerste
    lid, 1° WBTW – art. 138 Richtlijn 2006/112/EG) » / « Exonération de TVA – livraison
    intracommunautaire (art. 39bis, alinéa 1er, 1° CTVA – art. 138 directive 2006/112/CE) ».
    La demande proposait « Autoliquidation – art. 196 directive » : l'art. 196 vise les
    **prestations de services** B2B ; pour une **livraison de biens** (poisson) vers un autre État
    membre, la base est l'exonération des art. 138 de la directive / 39bis du Code belge. Le texte
    ci-dessus suit donc la règle des biens.
  - Export : « Vrijgesteld van btw – uitvoer buiten de Europese Unie (art. 39, § 1 WBTW – art. 146
    Richtlijn 2006/112/EG) » / « Exonération de TVA – exportation hors de l'Union européenne
    (art. 39, § 1er CTVA – art. 146 directive 2006/112/CE) ».
  - Cocontractant : « Verlegging van heffing – btw te voldoen door de medecontractant (art. 51, § 2
    WBTW – art. 20 KB nr. 1) » / « Autoliquidation – TVA due par le cocontractant (art. 51, § 2
    CTVA – art. 20 AR n° 1) ». L'art. 20 de l'AR n° 1 vise surtout les travaux immobiliers : pour un
    grossiste en produits de la mer, ce régime devrait être rare ; il existe pour être complet.
  Le comptable confirme ou corrige ces textes (une seule table dans `assets/vat.js`).
- **Adresses Peppol étrangères — à valider** : l'UBL identifie l'acheteur étranger par un schéma
  EAS fondé sur son numéro de TVA (ex. 9944 NL, 9930 DE, 9957 FR, 0211 IT, 0213 FI, 9932 GB,
  9927 CH). Sans schéma connu (DK, SE, XI, pays sans numéro), l'UBL est refusé avec la raison.
- Pour `K`, le pays de livraison est celui du préfixe du numéro de TVA de l'acheteur (le portail n'a
  pas de champ « pays » ; le lieu de livraison est un texte libre).
- Le régime s'applique à la facture entière (un client = un régime), pas ligne par ligne.
- Les e-mails restent en néerlandais et montrent les montants à 0 % ; ils ne reprennent pas la
  mention (elle est sur le document).
- **RGPD** : régime et numéro de TVA d'une société ne sont pas des données personnelles. Le
  résultat VIES d'une entreprise individuelle peut contenir le nom et l'adresse d'une personne : il
  est inclus dans l'export du client (fiche complète) et, comme le nom, le numéro de TVA et les
  adresses de la fiche, il est conservé lors de l'anonymisation (justificatif de l'exonération,
  conservation fiscale de 10 ans).
