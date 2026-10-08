# Feature Specification: Documents A4 et e-mails redessinés (audit A10)

**Feature Branch**: `worktree-agent-ae288de1ce2b50cf0`
**Created**: 2026-10-01
**Status**: Implemented
**Input**: « A10 : redessiner la mise en page des documents A4 (bon de livraison, facture / pro
forma, note de crédit / bon de retour) et un gabarit unique pour les e-mails (commande, statut,
relance, correction, accès), sobre, Vismijn, imprimable, lisible dans Gmail / Outlook / Apple Mail
y compris en mode sombre. Garder tout le contenu et toutes les mentions légales. »

## Constat de départ (vérifié dans le code et sur rendu)

- `DESIGN.md` § « Reste à faire » 2 et 3 : documents « couleurs alignées, mise en page pas
  redessinée » ; e-mails « gabarit à retravailler (en-tête, pied, mode sombre) ».
- Documents (`documents.js`) : titre en Georgia, micro-libellés en capitales suivies (interdit par
  Vismijn), gris hérités de « Crème » (`rgba(35,35,35,…)`), police à chasse fixe pour les numéros,
  pas de taux de TVA par ligne (exigé par la constitution V et EN 16931), pas de récapitulatif TVA
  par taux, pas de marges A4 à l'impression (la page 2 commence au bord du papier).
- E-mails : deux gabarits recopiés (`lib/ordermail.js`, `lib/authmail.js`) qui divergent (l'un a la
  marque, l'autre seulement le nom en capitales), titres en Georgia, libellés en capitales, pas de
  texte d'aperçu (preheader), pas de `color-scheme` : Apple Mail et Outlook inversent les couleurs
  à leur façon, bouton en simple lien (zone cliquable réduite dans Outlook).
- `lib/correctie.js` ne contient pas de gabarit : l'e-mail de correction est construit par
  `lib/ordermail.js` (`buildCorrectionMail`, `buildCorrectionTeamMail`) et suit le gabarit commun.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un document A4 qu'on lit d'un coup d'œil (Priority: P1)

Le chef de cuisine reçoit le bon de livraison avec la marchandise à 6 h, la facture (ou la pro
forma) et parfois une note de crédit. Il trouve en haut à gauche qui envoie (marque F, nom,
adresse, TVA), en dessous à qui (client, adresse, TVA), à droite quel document (titre, numéro,
dates), puis les lignes (montants alignés à droite, chiffres tabulaires, taux de TVA par ligne sur
les documents chiffrés), le récapitulatif TVA par taux, les totaux, le bloc de paiement (IBAN, BIC,
communication structurée, montant, échéance) et en bas les mentions (régime TVA, conditions
générales, données légales de la société).

**Why this priority**: c'est l'objet qui arrive physiquement chez le client ; il porte des
mentions légales (WVV art. 2:20, régime TVA, CGV) et sert de preuve de livraison.

**Independent Test**: portail de dev, ouvrir une facture NL, une note de crédit FR et un bon de
livraison, imprimer / télécharger le PDF ; rendu Playwright (captures A4) relu.

**Acceptance Scenarios**:

1. **Given** une facture à deux taux (6 % et 21 %), **When** on l'ouvre, **Then** chaque ligne
   montre son taux, un récapitulatif donne base et TVA par taux, les totaux sont inchangés.
2. **Given** une note de crédit FR avec régime intracommunautaire, **Then** tout est en français,
   montants négatifs, mention d'exonération sous les totaux, motif et facture d'origine au pied.
3. **Given** un bon de livraison, **Then** aucun prix, aucun bloc TVA ni paiement ; lots et
   traçabilité, « besteld X » si le poids diffère, réceptionnaire et signature, conditions de
   livraison au pied.
4. **Given** 34 lignes, **When** on imprime, **Then** l'en-tête du tableau se répète sur la page
   suivante, aucune ligne n'est coupée, les marges A4 sont respectées sur chaque page, totaux et
   paiement ne sont pas coupés.
5. **Given** le mode « boekhouder » (défaut), **Then** PRO FORMA / bon de retour, ni IBAN ni
   communication structurée (inchangé). Le bandeau « Dit document is geen factuur… (via Peppol) » (et sa
   variante creditnota, NL/FR) a été retiré le 2026-10-08 à la demande du co-gérant : le titre et le numéro
   PF suffisent.

---

### User Story 2 - Des e-mails lisibles partout (Priority: P1)

Le client et l'équipe reçoivent les e-mails (confirmation, en route, livrée, annulée, relance,
correction, accès, demande d'accès) dans Gmail, Outlook ou Apple Mail, souvent en mode sombre sur
téléphone. Tous partagent un gabarit : marque F, titre, texte d'aperçu utile dans la liste de
messages, faits, tableau, un bouton principal net, pied avec les coordonnées. La version texte
reste complète.

**Why this priority**: un e-mail mal rendu (texte blanc sur blanc, bouton invisible) fait
manquer une livraison ou un paiement ; le gabarit unique évite que les e-mails d'accès divergent.

**Independent Test**: rendu Playwright de chaque e-mail (680 px et 390 px) + simulation
d'inversion des couleurs ; tests unitaires sur la structure.

**Acceptance Scenarios**:

1. **Given** n'importe quel e-mail, **Then** il déclare `color-scheme` (clair), chaque zone a un
   fond et une couleur de texte explicites, le texte blanc n'apparaît que sur un fond Noordzee.
2. **Given** la liste des messages, **Then** le texte d'aperçu résume le message (dans la langue
   du client), sans rien d'interne ni de confidentiel.
3. **Given** un e-mail avec action, **Then** un bouton plein (cellule colorée, ≥ 44 px de haut).
4. **Given** les liens existants (`/order.html?id=` dans les e-mails internes, portail client,
   `wachtwoord.html?t=`), **Then** ils sont inchangés.

### Edge Cases

- Société sans adresse / sans TVA : en-tête avec la mention « Bedrijfsgegevens niet geladen ».
- Facture sans prix de ligne (anciennes commandes) : un seul taux, colonne TVA au taux appliqué.
- Lignes très longues (nom + commentaire + lot) : retour à la ligne dans la colonne description,
  colonnes chiffrées jamais coupées.
- Bundle de plusieurs documents : une page par document, une seule feuille de style.
- Client e-mail sans support de `color-scheme` (Gmail app) : inversion partielle, mais fonds et
  textes explicites gardent le contraste.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Document : bloc fournisseur (marque F, nom, adresse, TVA, téléphone), bloc client,
  titre + numéro + dates, tableau, récapitulatif TVA par taux, totaux, paiement, mentions, pied.
- **FR-002**: Taux de TVA par ligne sur facture, pro forma et note de crédit (même règle de calcul
  que les totaux, régime 0 % compris).
- **FR-003**: Bloc de paiement de la facture : bénéficiaire, IBAN, BIC (si connu), communication
  structurée (si dérivable), montant TVAC, échéance.
- **FR-004**: Impression A4 : marges sur chaque page, en-tête de tableau répété, lignes et blocs
  de fin non coupés ; Helvetica / Arial seulement ; couleurs des jetons Vismijn ; aucun libellé en
  capitales, aucune bande colorée, aucune décoration.
- **FR-005**: Tout le contenu et toutes les mentions existants restent (tests et
  `scripts/workflow-check.js` inchangés), en NL et en FR.
- **FR-006**: Un gabarit d'e-mail unique (tableaux, CSS en ligne, pas de `<style>`, pas de
  flexbox, pas d'image externe) pour `lib/ordermail.js` et `lib/authmail.js`.
- **FR-007**: E-mails : `color-scheme` clair, fonds et couleurs explicites, texte d'aperçu,
  bouton plein, version texte conservée, liens inchangés.

### Key Entities

Aucune donnée nouvelle : rendu seulement (pas de champ, pas de table, pas de donnée personnelle).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Tous les tests existants des documents et e-mails passent sans modification de leurs
  assertions ; nouveaux tests sur taux par ligne, récapitulatif, impression, jetons, gabarit.
- **SC-002**: Captures relues : facture NL, note de crédit FR, bon de livraison, chaque e-mail ;
  facture longue imprimée sur 2 pages avec en-tête répété.
- **SC-003**: `node scripts/check.js`, ESLint 9.39.5 et `node scripts/assets-version.js` verts.

## Assumptions

- Le titre du document reste en capitales (FACTUUR, CREDITNOTA…) : c'est le nom légal du
  document, assertions de `scripts/workflow-check.js` ; les libellés, eux, passent en casse normale.
- Le PDF reste produit par html2pdf (capture) : l'en-tête répété n'existe qu'à l'impression
  navigateur ; dans le PDF, aucune ligne ni bloc de fin n'est coupé (liste `avoid` existante).
- Mode sombre : sans `<style>` (interdit par les tests M2c), on ne peut pas fournir un thème
  sombre ; on déclare « clair seulement » et on rend chaque couleur explicite.
