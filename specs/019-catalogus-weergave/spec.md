# Feature Specification: Catalogus — weergave kiezen, dichtere regels, vlotter navigeren

**Created**: 2026-10-02 · **Status**: Implemented
**Input**: le catalogue client est utilisé en production avec de vraies données : 69 produits, catégories
« Algemeen » (56), « VEGETARISCH » (5), « VIS » (6), « SURIMI » (2) ; noms du type « BLACK TIGER GARNALEN 8-12 »,
« BLACK TIGER GARNALEN BLOK 13-15 », « VANNAMEI … » ; beaucoup de photos (emballages). Le propriétaire, dans une
fenêtre d'environ 990 px : « il faut une meilleure disposition, il faut avoir le choix du type d'affichage, et
faciliter la navigation ». Ce qu'il voyait : la colonne téléphone de 560 px centrée (onglets en bas), chaque
produit sur deux lignes (~210 px de haut), vignette de 44 px, beaucoup de place perdue, des onglets de
catégorie horizontaux et un seul énorme groupe « Algemeen ».

## User Scenarios

- **Client sur ordinateur portable ou fenêtre moyenne (720–1180 px)** — Le catalogue prend toute la largeur :
  plus de colonne de téléphone. En-tête en haut (marque, onglets, panier). En « Lijst », un produit = une
  ligne d'environ 60 px : vignette, nom (kaliber · eenheid en petit dessous), prix, étoile, − quantité +.
  Le panier est la barre du bas (« Bestellen ») tant que la largeur ne permet pas une colonne.
- **Client sur grand écran (≥ 1240 px)** — Catégories à gauche, liste au centre, panier à droite (comme
  avant) ; entre 1100 et 1239 px : liste + panier, catégories en onglets au-dessus de la liste.
- **Client au téléphone (< 720 px)** — Même portail, onglets en bas ; une ligne produit tient en deux lignes
  compactes (≤ ~110 px) : vignette + nom + étoile, puis prix + quantité.
- **Choisir sa « Weergave »** — Trois boutons « Lijst / Tegels / Compact » (« Liste / Vignettes / Compact »)
  au-dessus de la liste. Le choix est retenu sur l'appareil, même après reconnexion ; il ne casse rien
  quand le stockage du navigateur est bloqué (navigation privée) : on retombe sur « Lijst ».
  - **Lijst** (par défaut) : décrit ci-dessus.
  - **Tegels** : cartes avec une grande photo (4:3, photo entière sur fond doux, car ce sont des emballages),
    nom, prix / unité, étoile et quantité ; 2 colonnes au téléphone, 3 à 5 plus large. Sans photo : une
    icône neutre à la place. Toucher la photo ou le nom ouvre le détail dans un panneau (galerie, infos,
    opmerking, quantité) ; Échap ou × le ferme et le focus revient sur la carte.
  - **Compact** : lignes de texte serrées (~46 px), sans vignette, pour le client qui sait ce qu'il
    commande : nom, kaliber, eenheid, prix, étoile, quantité.
  En Lijst et Compact, le détail (galerie spec 018) se déplie sur place comme avant.
- **Trier** — « Sorteren » : Standaard (ordre de Beheer), Naam A–Z (kaliber numérique : 8-12 avant 13-15),
  Prijs ↑, Prijs ↓. Retenu sur l'appareil.
- **Familles** — Dans une catégorie de plus de 12 produits (pas « Alles » ni « Favorieten »), des boutons « Alle · Black tiger garnalen · Black
  tiger garnalen blok · Vannamei garnalen · … · Overige » apparaissent sous la recherche : ils sont déduits
  des noms (les mots avant le kaliber). Un appui filtre, « Alle » remet tout. Ils n'apparaissent que si le
  découpage donne 3 à 12 familles d'au moins 2 produits ; sinon rien.
- **Rechercher** — La frappe filtre aussitôt (comme avant) ; le nombre de résultats est affiché et annoncé ;
  une croix vide le champ. La recherche trouve aussi le kaliber (« 16-20 » trouve « 16/20 ») et plusieurs
  mots dans le désordre (« tiger 16 »).
- **Se repérer en défilant** — La barre (recherche, catégories, familles, tri, weergave) reste en haut ;
  au téléphone, seules la recherche et les catégories restent (le tri, la weergave et les familles
  défilent avec la liste). Le titre de groupe reste visible sous la barre. Après un long défilement, un
  bouton « Naar boven » (« Haut ») ramène en haut.

## Requirements

- **FR-001** Disposition : `< 720` téléphone (onglets en bas) ; `≥ 720` en-tête en haut, catalogue pleine
  largeur, barre panier en bas ; `≥ 1100` colonne panier ; `≥ 1240` colonne des catégories. Les autres vues
  du portail (Bestellingen, Favorieten, Account, Winkelmand) gardent leur mise en page ; entre 720 et
  1023 px elles sont centrées (≤ 760 px). Le bloc `<style>` de `klant.html` part dans `assets/ui.css`.
- **FR-002** Les lignes s'adaptent à la largeur de la liste (container queries), pas de l'écran : Lijst une
  ligne de 56–64 px dès 600 px de liste, deux lignes compactes (≤ 110 px) en dessous ; Compact ~46 px ;
  Tegels `repeat(auto-fill, minmax(…))`.
- **FR-003** Weergave : groupe de 3 boutons (`role=group`, nom « Weergave », `aria-pressed`, ≥ 44 px), retenu
  par appareil (`famoKlantWeergave`, `K.pref` sur `K.store`, try/catch) ; valeur inconnue ou stockage bloqué
  → « lijst ». Changer de vue ne redessine que la liste ; le focus reste sur le bouton.
- **FR-004** Sorteren : `<select>` (Standaard, Naam A–Z, Prijs ↑, Prijs ↓), retenu (`famoKlantSortering`).
  Comparateurs purs `K.catalogSort(mode)` : Standaard = `K.byVolgorde` (sans volgorde : nom, nombres
  numériques) ; Naam = `K.byNameKaliber` ; Prijs = le prix que voit ce client (`prix` de `/api/catalogue` :
  prix négocié sinon prix de base, **hors TVA, par son unité de vente** — kg, kassa ou stuk ne sont pas
  convertis), à égalité par nom/kaliber ; prix absent (donnée incomplète) en dernier dans les deux sens.
  Le tri s'applique **à l'intérieur de chaque groupe** (Favorieten en tête sous « Alles », puis chaque
  catégorie dans l'ordre de Beheer) : les groupes et leurs titres restent.
- **FR-005** Familles : fonction pure `K.families(products, opts)` → `null` ou `{ families: [{key, label,
  ids}], rest: [ids] }`. Clé (`K.familyKey`) : nom sans casse, sans parenthèses, coupé au premier mot qui
  contient un chiffre (kaliber 8-12, 16/20, U10, 400-600, poids 1KG, 2,5 kg, 10x1kg…), sans mot d'unité ou de
  liaison en fin (kg, kilo, g, gr, gram, l, ml, cl, st, stk, stuks, pcs, pc, x, nr., n°, no., ca., ±, en, et,
  met, avec). Un produit seul dont la clé prolonge une famille la rejoint (« BLACK TIGER GARNALEN GEPELD
  21-25 » → « Black tiger garnalen ») ; sinon il rejoint la seule famille avec laquelle il partage le plus
  long début (« INKTVIS RINGEN » + « INKTVIS TUBES » → « Inktvis ») ; les seuls restants qui partagent leur
  premier mot forment une famille (libellé = début commun). Plus de 12 familles → regroupement par premier
  mot. Affichées seulement dans une catégorie (pas « Alles » ni « Favorieten ») de > 12 produits qui donne
  3–12 familles de ≥ 2 produits ; le reste = « Overige » (FR « Autres »). Ordre : première apparition dans
  l'ordre de Beheer. Libellé en capitales → casse de phrase. Chaque id apparaît une seule fois.
  Les libellés viennent des noms de produits (données) : toujours écrits via `K.esc` (XSS), jamais en HTML brut.
- **FR-006** Recherche : `K.searchKey` (minuscules, sans accents, « 16-20 » = « 16/20 ») et `K.searchHit`
  (tous les mots présents), entièrement dans le navigateur (le terme n'est ni envoyé ni journalisé). Compteur
  `role=status` « {n} producten » / « {n} produits » (mis à jour par la recherche et la famille) ; bouton ×
  (44 px, nom « Zoekterm wissen » / « Effacer la recherche ») qui vide et rend le focus au champ. Recherche,
  catégorie et famille se combinent ; la recherche est gardée au changement de catégorie, la famille revient
  à « Alle ». Le terme réaffiché (« Niets gevonden voor „…” ») passe par `K.esc`.
- **FR-007** Barre collante : ≥ 720 sous l'en-tête ; < 720 la ligne de recherche (avec « Naar boven ») puis les
  catégories restent en haut, le tri, la weergave et les familles défilent. Titres de groupe collants sous la
  barre ; `scroll-padding-top` suit la hauteur réelle de la barre (variable CSS mesurée) et
  `scroll-padding-bottom` réserve la barre panier du bas (< 720 : onglets + barre ; 720–1099 : barre panier)
  pour qu'aucun élément focalisé ne soit caché (WCAG 2.4.11, vérifié au clavier à 390, 990 et 1440 px).
  « Naar boven » est dans la ligne de recherche, donc dans la partie collante à toutes les largeurs (jamais
  flottant au-dessus de la colonne des quantités) ; `hidden` tant qu'on n'a pas défilé d'une hauteur de
  fenêtre (`innerHeight`) ; il défile en haut (instantané si `prefers-reduced-motion`) et met le focus sur le
  titre.
- **FR-008** Tegels : le détail s'ouvre dans `K.panel` (piège Tab, Échap, focus rendu à la carte) avec la
  galerie (spec 018), les infos, l'opmerking (n'arme pas la garde « non enregistré ») et la quantité.
- **FR-009** Inchangé : favoris, panier, stepper (une modification ne redessine que sa ligne et le panier),
  « uw prijs », stock, opmerkingen, position de défilement, raccourci « / ». NL/FR pour tout texte
  (`K.t`, `K.FR`). Aucun style en ligne statique, aucune dépendance, pas de changement serveur.
- **FR-010** Démo (`scripts/seed.js`) : une grande catégorie « Algemeen » (22 produits, Black tiger /
  Vannamei / Scampi / Inktvis… avec kaliber dans le nom), « Vegetarisch » et « Surimi », photos
  d'emballage de formats variés ; les 13 premiers produits ne changent pas (tests).

## Edge Cases

- Stockage bloqué ou valeur corrompue : vue « lijst », tri « standaard », sans erreur.
- Catégorie « Alles » ou « Favorieten », ou catégorie de ≤ 12 produits : pas de familles ; recherche sans
  résultat : message « Niets gevonden voor „…” » (FR « Aucun résultat pour »).
- Changer de catégorie remet la famille à « Alle » (une famille active qui n'existe plus est oubliée).
- Produit sans photo : icône neutre (vignette ou tuile) ; photo cassée : icône (écouteur `data-thumb`) ; dans la
  galerie (liste ou panneau), la vue cassée disparaît (spec 018).
- Produit épuisé : même ligne dans les trois vues, étiquette « Uitverkocht » dans la métaligne, le stepper
  refuse au-delà du stock (comportement existant).
- Des centaines de produits : images `loading="lazy"`, `content-visibility:auto`, filtre par masquage
  (aucun redessin à la frappe), stepper sans redessin.

## Sécurité, vie privée

- Préférences par appareil (`famoKlantWeergave`, `famoKlantSortering`) : seulement un mot parmi une liste fixe,
  aucune donnée personnelle ni identifiant ; partagées par les comptes d'un même appareil (assumé : ce n'est
  qu'une mise en page). Favoris et panier restent par compte (inchangé).
- Tout texte venu des données (noms, libellés de familles, catégories, terme de recherche) est échappé (`K.esc`).

## Success Criteria

- **SC-001** Fenêtre 990 × 760 px, catalogue défilé : ≥ 9 produits visibles en Lijst et ≥ 12 en Compact
  (avant : ~3) ; Tegels : 4 colonnes à 990 px, 3 à 1280 px (colonnes latérales), 2 à 390 px.
- **SC-002** Un client trouve « Black tiger blok 13-15 » parmi 56 produits en deux appuis (famille, ligne)
  ou en tapant « blok 13 ».
- **SC-003** check.js, ESLint, contrast-check, ux-audit (1280 / 990 / 390, trois vues) puis kbd-audit
  (390 / 990 / 1440) : 0 écart.
