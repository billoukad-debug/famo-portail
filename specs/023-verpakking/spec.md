# Feature Specification: Verpakking / verkoopeenheid

**Feature Branch**: `worktree-agent-a83d259ff6d4efb98` (sur `main` 890baeb)
**Created**: 2026-10-02
**Status**: Implemented
**Input**: demande de Mohsen (gérant de FAMO), verbatim : « Pour chaque article il doit avoir l'option
d'indiquer la quantité dans laquelle il le vend. Par exemple 1 œuf 1 €, vendu par 6, prix 6 €. Car il ne
vend pas tout à l'unité, certains uniquement par doos (carton) de 12, de 6, etc. » et « producten
hoeveelheid stuks toevoegen ».

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Le beheerder indique le conditionnement d'un produit (Priority: P1)

Dans Beheer → Producten, Mohsen ouvre « Eieren » (prix de base € 1,00 par stuk) et remplit
« Per verpakking » = 6, « Verpakking » = doos, coche « Enkel per verpakking ». Le prix reste € 1,00
par stuk ; la liste des produits montre « stuk · doos van 6 ».

**Why this priority**: sans ce réglage, rien d'autre n'existe.

**Independent Test**: `test/verpakking.test.js` (SQLite en mémoire, vraie chaîne `api/onboarding.js`).

**Acceptance Scenarios**:

1. **Given** un produit, **When** le beheerder enregistre 6 / doos / enkel, **Then** les trois champs
   sont stockés au catalogue ; prix de base, prix négociés et commandes existantes sont inchangés.
2. **Given** une valeur absurde (2,5 pour un produit à la pièce, 1 500, texte), **Then** 400 avec un
   message néerlandais ; 1 ou vide = vendu à l'unité (champs effacés).

---

### User Story 2 - Le client commande 2 doos d'œufs (Priority: P1)

Dans le catalogue, Aloha voit « € 1,00 / stuk » et « doos van 6 · € 6,00 ». Le stepper avance par
doos (« − 2 doos + ») ; la winkelmand montre « 2 doos · 12 stuks » et € 12,00. La commande est
enregistrée en unités (12 stuks à € 1,00) ; la facture et le bon de livraison montrent
« 2 doos × 6 st = 12 st ».

**Acceptance Scenarios**:

1. **Given** « Eieren » enkel per doos van 6, **When** le client commande 12, **Then** 200, ligne
   « Eieren × 12 pièce [€1.00] », total € 12,00, `Lignes JSON` porte `per: 6, verpakking: "doos"`.
2. **Given** le même produit, **When** le client (ou un navigateur trafiqué) envoie 7, **Then** 400
   « Eieren: enkel per doos van 6 te bestellen (u vroeg 7 stuks). », affiché en français pour un
   client FR ; rien n'est écrit.
3. **Given** un produit avec conditionnement mais SANS « enkel », **When** le client commande 7,
   **Then** 200 (vente à l'unité permise) ; l'écran montre « 1 doos + 1 st · 7 stuks ».
4. **Given** un produit sans conditionnement, **Then** tout est identique à avant (texte, JSON,
   total, documents, e-mails, UBL).

---

### User Story 3 - Les documents et e-mails disent combien de cartons (Priority: P1)

Facture, pro forma, bon de livraison, note de crédit, confirmation de commande (équipe et client,
NL/FR) et e-mails de statut : sous l'article, « 2 doos × 6 st = 12 st » (et « × € 1,00 = € 12,00 »
sur les documents chiffrés). L'export UBL garde la quantité en unités (H87) et ajoute la note de
ligne « 2 doos × 6 st ». TVA, numérotation et montants inchangés au centime.

---

### User Story 4 - Le personnel prépare des cartons (Priority: P2)

Bestellingen, fiche commande, Magazijn (verzamellijst, validation, liste imprimée) et Leveringen
montrent « 2 doos · 12 stuks ». Invoeren (commande par téléphone) : même stepper par doos et même
refus serveur. Le stock reste en unités : le départ retire 12 stuks.

---

### User Story 5 - Commande par e-mail « 2 dozen eieren » (Priority: P2)

Claude reçoit le conditionnement de chaque article (« doos van 6, enkel per doos ») et rend, en plus
de la quantité, le nombre de conditionnements demandé. Le serveur recalcule les unités
(2 × 6 = 12) ; un désaccord entre les deux, une quantité qui n'est pas un multiple pour un article
« enkel », ou un article sans conditionnement commandé « par doos » → « Te controleren » avec la
raison.

### Edge Cases

- Ancienne commande (texte seul, ou JSON sans `per`) : rien n'est affiché en plus.
- Le conditionnement change après la commande : les documents gardent celui de la commande (figé
  dans `Lignes JSON`, comme le prix). Lignes modifiées par le magasin : un article déjà présent garde
  le conditionnement enregistré ; un article ajouté prend celui du catalogue.
- Le magasin peut livrer une quantité qui n'est pas un multiple (œufs cassés) : la règle « enkel »
  ne vaut qu'à la prise de commande (client, Invoeren, e-mail), pas pour la correction de la quantité
  livrée ni pour une note de crédit.
- Stock affiché au client (Voorraad afboeken) : le plafond est arrondi au conditionnement inférieur.
- Produit au kg avec conditionnement (« kist van 5 kg ») : permis ; conditionnement décimal seulement
  au kg.
- Navigateur ancien (cache) qui envoie une quantité non multiple : refus serveur, message clair.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Catalogue : `Per verpakking` (nombre > 1, ≤ 1000, entier sauf kg), `Verpakking`
  (texte ≤ 30, défaut « doos »), `Enkel per verpakking` (case). Vide / 1 = vendu à l'unité.
- **FR-002**: Le prix reste le prix par unité (`Prix de base`, `Prix négociés`) ; aucune migration.
- **FR-003**: Les lignes restent stockées **en unités** : texte `Nom × 12 pièce [€1.00]` inchangé
  (format, parseurs, total, TVA, stock) ; `Lignes JSON` reçoit `per` et `verpakking` (figés).
- **FR-004**: `lib/bestelling.js` refuse (400) une quantité non multiple d'un article « enkel » :
  portail client, Invoeren, commande par e-mail. Message NL, traduit FR par `K.errText`.
- **FR-005**: Catalogue client, Invoeren, panier, favoris, commande type, « Opnieuw bestellen » :
  stepper par conditionnement pour « enkel », quantités en conditionnements + unités.
- **FR-006**: `/api/allorders`, `/api/orders`, `/api/klantdoc` exposent `verpakking`
  ({ nom en minuscules: { per, verpakking } }) lu dans `Lignes JSON` ; documents, écrans du
  personnel et e-mails l'affichent ; UBL : `cbc:Note` de ligne.
- **FR-007**: Commande par e-mail : catalogue envoyé à Claude avec le conditionnement, champ
  `verpakkingen` dans le schéma ; le serveur décide des unités ; ambigu → Te controleren.
- **FR-008**: `docs/SCHEMA.md`, `scripts/fake-airtable.js`, seed (« Eieren », per 6, enkel),
  AGENTS.md.

### Key Entities

- **Catalogue.Per verpakking / Verpakking / Enkel per verpakking** : conditionnement de vente.
- **Commandes.Lignes JSON[].per / .verpakking** : conditionnement figé à la commande.

## Success Criteria *(mandatory)*

- **SC-001**: 2 doos d'œufs commandés → facture et bon « 2 doos × 6 st = 12 st », € 12,00 + 6 %.
- **SC-002**: quantité non multiple refusée par le serveur (client, personnel, e-mail).
- **SC-003**: commandes et documents existants identiques au centime (tests de non-régression sur le
  texte, `Lignes JSON`, documents, e-mails, UBL).

## Assumptions (à valider avec Mohsen)

- « Enkel per verpakking » s'applique aussi au personnel dans Invoeren (même règle serveur) ; le
  magasin peut toujours corriger la quantité livrée.
- Le libellé est libre (doos, kist, tray…) ; en français, doos/kist/zak/tray/bak/schaal sont
  traduits (carton, caisse, sac, plateau, bac, barquette), un autre mot reste tel quel.
- « dozen » en néerlandais = pluriel de doos (2 dozen eieren = 2 doos) ; dans une mail en anglais
  (« 2 dozen eggs » = 24), Claude baisse sa confiance et la ligne va dans Te controleren.
