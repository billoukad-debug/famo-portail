# Feature Specification: Rapportage (page à part entière, graphiques, filtres, tri, actions)

**Created**: 2026-10-02 · **Status**: Implemented
**Input** (propriétaire, verbatim) : « la page rapportage devrait avoir plus d'importance et être présente à gauche,
améliore-la avec graphique etc et modification et tri et filtrage, tout ce qu'il faut quoi ».

Aujourd'hui la Rapportage est un onglet de Beheer (`/beheer#/rapportage`) : un sélecteur d'année, quatre chiffres,
quatre tableaux (mois, TVA, top 20 clients, produits), la carte « Marge (schatting) » et les factures ouvertes. Aucun
graphique, aucun filtre (client, produit, période plus fine), aucun tri, aucune comparaison, aucune action.

## User Scenarios

- **Beheerder, au bureau (1280 px)** — il clique « Rapportage » dans la barre latérale (section Beheer). La page
  s'ouvre sur l'année en cours comparée à l'année précédente :
  1. un bandeau de chiffres clés : omzet excl. btw (moins les creditnota's), facturen, gemiddelde factuur, brutomarge
     (schatting), openstaand, actieve klanten — chacun avec l'écart en % et en € par rapport à la période de
     comparaison (flèche + signe + texte, jamais la couleur seule) ;
  2. le graphique « Omzet per maand » (colonnes = période choisie, ligne = même mois un an plus tôt) ;
  3. top klanten, top producten (omzet, quantité en étiquette), verdeling per categorie ou familie, marge per product ;
  4. les tableaux complets, triables, et les listes de factures (période) et de factures ouvertes (toutes années).
- **Il affine** : période (jaar, kwartaal, maand, vrije periode van–tot), vergelijking (vorige periode, zelfde periode
  vorig jaar, geen), filtres klant, categorie, product, betaling (openstaand / betaald), btw-regime (seulement si
  plusieurs régimes existent), recherche texte. Tout se recalcule ensemble. L'URL suit (`/beheer/rapportage?…`) :
  le lien se partage, « terug » du navigateur revient à l'état précédent.
- **Drill-down** : un clic (ou Entrée) sur un mois, un client, un produit, une catégorie — dans un graphique ou un
  tableau — applique ce filtre (mois → période « maand »). Une puce « × » retire chaque filtre ; « Alles wissen ».
- **Tri** : chaque en-tête de tableau est un bouton (asc ↔ desc, `aria-sort`), tri numérique correct, montants à
  droite en chiffres tabulaires.
- **Modification** (interprétation, voir FR-010) : depuis les listes, il ouvre la commande / la facture
  (`/team/bestelling?id=…`, où se font corrections et creditnota's), la fiche client (`/beheer#/klanten?klant=…`) ou
  les bestellingen du client. Sur une facture ouverte : « Betaald » (choix de la betaalwijze, confirmation, toast
  « Ongedaan maken »), par l'action serveur existante.
- **Export** : chaque vue a son bouton CSV, avec les filtres appliqués.
- **Téléphone (390 px)** — même page, une colonne, graphiques lisibles (le graphique mensuel défile à l'horizontale
  dans sa carte si les colonnes deviendraient trop étroites), cibles ≥ 44 px.
- **Personnel** — pas de lien « Rapportage » ; l'URL renvoie à la connexion Beheer ; les API de chiffres refusent
  sa session.
- **Ancien lien** `/beheer#/rapportage` → remplacé par `/beheer/rapportage`.

## Requirements

- **FR-001 Navigation** : entrée « Rapportage » (icône graphique) dans la barre latérale, section Beheer, entre
  Documenten et Beheer, **seulement pour la session beheerder** (`NAV_ADMIN`). Page `beheer/rapportage.html`,
  URL propre `/beheer/rapportage` (spec 014, `cleanUrls`), script `assets/pages/beheer/rapportage.js`. L'onglet
  « Rapportage » des onglets Beheer devient un **lien** vers la page (choix le plus simple : les onglets restent
  complets, aucune vue en double) ; `/beheer#/rapportage` redirige (`location.replace`) vers `/beheer/rapportage`.
- **FR-002 Accès serveur** : nouvelle API en lecture `GET /api/rapportage` (beheerder seul : 401 sans session, 403 pour
  une session personnel, y compris un PIN personnel ; 405 hors GET ; 500 si aucun code n'est configuré). Elle
  renvoie les commandes facturées et celles qui portent une creditnota (sans les commandes test, `lib/testorders.js`),
  réduites aux champs du calcul, le catalogue (nom, catégorie, unité), les clients (id, nom, régime), les taux par
  produit, le taux standard et le délai de paiement. `/api/marge` est déjà réservé au beheerder (test conservé) et
  accepte en plus `klant=<rec…>` (marge des factures et creditnota's de ce client). `allorders?all=1` **reste ouvert
  au personnel** : Bestellingen et Documenten en ont besoin (« volledige historiek ») et le personnel y voit chaque
  commande pour son travail ; aucun agrégat n'y est calculé. La page Rapportage n'appelle plus `allorders`.
- **FR-003 Règles de calcul (inchangées)** : date d'une facture = « Facturée le » (jour à Bruxelles), sinon date de
  livraison, sinon date de commande ; chaque creditnota est déduite à sa propre date (sinon celle de la facture) ;
  omzet = `Total` HTVA des factures − montants des creditnota's ; TVA par taux avec `window.FamoVat` (taux figés
  `BTW per lijn`, sinon taux du produit, sinon standard ; régime à 0 % ; commande sans ligne chiffrée = total au
  taux du régime) ; commandes test exclues (serveur). Openstaand = factures non payées, **toutes années** (comme
  avant). Marge = `/api/marge` (lot livré, sinon dernier prix d'achat ; « Facturée le » ; creditnota's déduites).
- **FR-004 Module pur** : `assets/rapport.js` (UMD comme `assets/vat.js` : `window.FamoRapport` / `require`),
  sans DOM, testé en Node (`test/rapportage.test.js`) : périodes, période de comparaison, mois, agrégats, tri, CSV.
  Les fonctions du navigateur (`K.parseLines`, `K.isoDay`, `FamoVat`) lui sont passées : une seule définition.
- **FR-005 Filtres** : klant (id), categorie (libellé affiché), familie (`K.familyKey`), product (nom en minuscules),
  betaling (`open` / `betaald`), regime, q (tous les mots dans référence, factuurnummer, client, lignes, numéro de
  creditnota). Filtre de ligne (categorie, familie, product) : seules les lignes concernées comptent (montant de ligne
  arrondi au cent, comme `FamoVat.net`) et une facture ne compte que si elle contient une telle ligne ; sans filtre de
  ligne, on garde `Total` et le montant de la creditnota. Brutomarge avec filtre de ligne = somme des lignes de
  marge filtrées (les creditnota's ne sont pas réparties par produit : dit à l'écran).
- **FR-006 Période et comparaison** : jaar (défaut : année en cours), kwartaal (`2026-Q3`), maand (`2026-09`), vrij
  (`van`, `tot`, ISO, `van ≤ tot`). Vorige periode : même nombre de mois entiers juste avant (année → année
  précédente, trimestre → trimestre précédent, mois → mois précédent), sinon même nombre de jours juste avant.
  Zelfde periode vorig jaar : mêmes dates un an plus tôt (29/02 → 28/02). Le graphique mensuel compare toujours
  au même mois de l'année précédente.
- **FR-007 Graphiques** : SVG en ligne, sans librairie ; `role="img"` avec `<title>` et `<desc>` (résumé chiffré),
  tableau équivalent sur la page ; marques focalisables (Entrée = filtre) avec info-bulle au survol et au focus
  (texte via `textContent`) ; couleurs par jetons (`--p` = période, `--chart-prev` = comparaison, ligne + points :
  la comparaison ne repose pas sur la couleur seule) ; lisibles en hoog contrast (jetons redéfinis, contrôlés par
  `scripts/contrast-check.js`) et à 390 px (étiquettes sur leur propre ligne, pas de texte rogné). Cibles ≥ 44 px au
  tactile (rangées de 44 px ; colonnes mensuelles ≥ 44 px au tactile, défilement horizontal dans la carte).
- **FR-008 KPIs** : omzet excl. btw, facturen (+ creditnota's), gemiddelde factuur (omzet brute des factures ÷
  nombre), brutomarge (schatting, %), openstaand (toutes années, dont vervallen), actieve klanten (clients avec au
  moins une facture dans la période), btw ; écart vs comparaison (% et €). Un seul bandeau (`.kpis`, DESIGN.md).
- **FR-009 Tri** : en-têtes `<button>` dans `<th aria-sort>` ; nombres comparés comme nombres, textes avec
  `Intl.Collator("nl", { numeric: true })`, vides en dernier ; état du tri dans la page (non partagé dans l'URL).
- **FR-010 Modification** : liens directs (commande / facture, fiche client, bestellingen du client) ; « Betaald » sur
  une facture ouverte = `POST /api/updateorder { id, paiement: "Payé", modePaiement }`, **action serveur existante**
  (beheerder seul, 409 si non facturée, ligne `Correcties` « Betaald (…) » et journal d'audit « Betaalstatus: Payé »),
  après le choix de la betaalwijze dans un panneau (= confirmation) ; « Ongedaan maken » = `paiement: "En attente"`
  avec raison. Aucun nouveau chemin d'écriture.
- **FR-011 Exports CSV** : un par vue (maanden, klanten, producten, categorieën/families, marge, btw, facturen,
  openstaand), filtres appliqués, nom de fichier avec la période ; format des exports actuels (BOM, `;`, CRLF,
  décimales à virgule, cellules commençant par = + - @ protégées — sauf un nombre pur, qui reste un nombre).
- **FR-012 Audits** : `scripts/ux-audit.js` (vue de base, filtre appliqué, à 1280 et 390 px) et
  `scripts/kbd-audit.js` (lien de la barre latérale, filtre au clavier, tri au clavier, drill-down au clavier).
- **FR-013 Données de démo** : `scripts/dev.js` ajoute un historique facturé (15 mois, creditnota, deux taux de TVA)
  pour que la page ait quelque chose à montrer ; `scripts/seed.js` utilisé par les tests reste identique par défaut.

## Hors périmètre

- Pas de nouveau champ ni de nouvelle table ; pas d'écriture nouvelle.
- Pas de rapport comptable légal (la facture légale vient du comptable, ADR 0005) : estimation de gestion.
- Pas de graphique en anneau ni d'axe double (skill dataviz : anti-patterns).

## Success Criteria

- **SC-001** Sur un jeu connu (creditnota, deux taux de TVA, période précédente, filtres client / produit / paiement),
  les totaux du module égalent les valeurs calculées à la main (`test/rapportage.test.js`).
- **SC-002** Personnel : 403 sur `/api/rapportage`, 401 sur `/api/marge` ; pas de lien Rapportage dans sa barre.
- **SC-003** Portes vertes : assets-version, check.js, ESLint 9.39.5, contrast-check, ux-audit, kbd-audit.
