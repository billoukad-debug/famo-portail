# Feature Specification: x30 lot A « la commande » (X1, X2, X3, X6 + voix serif)

**Créée** : 2026-10-24 · **Statut** : implémentée sur la branche `x30-a-commande` (partie de `recette-vagues-2-3-4`),
non déployée (attend la validation du gérant puis le « go » du prestataire) · **Source** : audit design x30 du 24/10/2026
(`~/Documents/Plan Kameha/FAMO/audit-design-x30.md`, sections 2, 3.1 à 3.4, 3.7), maquette `maquette-x30/catalogue.html`,
plan `plan-x30.md` (lots X1, X2, X3, X6), benchmark `rea-benchmark-x30.md`.

## Principe
Le restaurateur ne fait plus ses courses : il **confirme**. Le portail ouvre sur la commande de demain, déjà prête,
la valide en un geste et la laisse modifier jusqu'à l'heure limite. Le serveur décide de tout (constitution II) :
il calcule la commande probable, recalcule les prix et les règles, refuse ce qui n'est plus possible et journalise.

## Exigences

- **FR-001 Commande probable (X1, serveur)** — `lib/gewoonte.js`, renvoyée par `POST /api/orders` (`gewoonte`) :
  pour ce client, les **8 dernières commandes livrées** (`Facturée`) dont la livraison tombe **le même jour de la
  semaine** que le prochain jour de livraison ; par produit, la **médiane** des quantités, un produit absent d'une
  commande comptant 0 (un produit pris 1 fois sur 8 ne revient pas) ; arrondi au pas du produit (0,5 kg, 1, un
  conditionnement entier « enkel per verpakking »). **Repli** : aucune livraison ce jour-là → la dernière commande du
  client (tout jour, non annulée). **Aucune commande** → `null`, pas de carte. Produits inactifs, retirés ou introuvables
  exclus. Lignes reconstruites par `lib/bestelling.js` (catalogue actif + prix négociés **du jour**), comme une vraie
  commande. Commandes d'essai (spec 021) jamais comptées. Aussi `vaste` : les produits pris dans au moins 2 des
  10 dernières livraisons (groupe « Uw vaste producten »).
- **FR-002 Carte « Zoals elke maandag » (X1, client)** — en tête de Bestellen (à droite, avec le panier, ≥ 1100 px) :
  « Uw bestelling voor ma 26/10 », titre serif « Zoals elke maandag » (« Zoals de vorige keer » en repli), lignes avec
  plaque, prix et − / + ; un bouton plein **« Bestellen voor ma 26/10 · € … »** (un geste) ; « Gebaseerd op uw laatste
  N maandagen · Aan te passen tot … ». Après l'envoi : toast **« Besteld · ma 26/10 · € … — Ongedaan maken »** pendant
  **8 s** (annule la commande ; un ajout remet les lignes d'avant). Minimum de commande respecté (bouton désactivé +
  message). Conditions générales (C-12) demandées avant l'envoi si une nouvelle version existe.
- **FR-003 Bandeau de l'heure (X2)** — `assets/bestellen.js` `klok` / `klokTekst`, sur **toutes** les vues du portail
  client, collé en haut : « **Nog 1 u 12** · geleverd ma 26/10 », point et jauge fine (pleine jusqu'à 8 h avant l'heure
  limite, vide à l'heure limite), **ambre dans la dernière demi-heure**, au-delà de 24 h « Bestellen tot zo 25/10 22:00 ».
  Règle identique à `lib/levering.js` / `K.orderWindow` : avant l'heure limite le premier jour possible est demain,
  après, après-demain, puis le premier jour de livraison non fermé ; **l'heure limite qui compte est celle de la veille**
  de ce jour (samedi soir → lundi, jusqu'à dimanche 22:00). **Heure de Bruxelles** quel que soit le fuseau de l'appareil.
  Mis à jour toutes les 30 s et au retour sur l'onglet ; si le jour change, la carte suit. Le texte passe à la ligne,
  il n'est jamais tronqué (390 px vérifié).
- **FR-004 Aucun créneau inventé** — le bandeau n'annonce **aucune heure de livraison** : il n'existe pas de réglage.
  Emplacement prévu : `FB.venster(rules.levervenster)` (« 06:00-08:00 » → « tussen 6 en 8 u »). Pour l'activer plus tard :
  un champ Configuratie `Levervenster` (HH:MM-HH:MM), lu par `lib/levering.js rulesFrom` et ajouté à `publicRules`
  (`levervenster`), avec Beheer → Bedrijfsgegevens. Non fait ici (décision n° 5 du plan : le créneau doit être vrai).
- **FR-005 Modifier sans annuler (X3)** — `POST /api/klantorder {action:"wijzig", ref, items}` (`lib/klantwijziging.js`) :
  le client remplace les lignes de **sa** commande `Reçue` (ajouter, retirer, changer une quantité) **jusqu'à l'heure
  limite de la veille de la livraison** (`checkCutoff`, tolérance de 15 min comprise). Le serveur relit la commande
  juste avant d'écrire (le magasin a pu « Klaarzetten »), recalcule prix et total, refuse inactif / quantité / conditionnement /
  minimum / liste vide (= annuler), remet « Préparation validée » à faux, met à jour « Lignes besteld » (référence des
  e-mails de correction) et inscrit dans `Correcties` : `date · Gewijzigd door klant · klant — Zalm 4 → 5 kg · + Wakame
  1 stuk · − Tonijn`. Réponse : `vorige` (les lignes d'avant, pour « Ongedaan maken »). Refus 409 après l'heure limite
  ou hors `Reçue` ; 404 pour la commande d'un autre ou une commande d'essai.
- **FR-006 Une 2e commande du même jour s'ajoute (X3)** — `POST /api/order` : si le client a déjà une commande `Reçue`
  encore modifiable pour la même date de livraison, le panier **s'y ajoute** (mêmes articles additionnés) au lieu de la
  question « doublon » : `Correcties` « Aangevuld door klant », notes ajoutées, clés d'idempotence **cumulées** (un panier
  renvoyé par le réseau n'est jamais ajouté deux fois), le minimum vaut pour la commande complétée. Réponse
  `samengevoegd: true, toegevoegd: n`. L'écran dit « 2 artikelen toegevoegd aan uw bestelling van ma 26/10 » (panier et
  confirmation). Commande déjà « Klaar », produit d'une ligne devenu inactif : nouvelle commande, comme avant. Sans
  date de livraison (anciens appels), le comportement d'avant (question doublon) est inchangé.
- **FR-007 Statut lisible** — une commande modifiable affiche **« Bevestigd · aanpasbaar tot zo 22:00 »** (« tot 22:00 »
  le jour même) dans la carte, Leveringen, la fiche et la confirmation (`aanpasbaar` calculé par le serveur dans
  `/api/orders`). « Wijzigen » ouvre un panneau − / + (plus d'annulation + remise au panier).
- **FR-008 Catalogue repensé (X6)** — une seule vue (les vues Lijst / Tegels / Compact et le tri de spec 019 sont
  retirés de l'écran : l'audit mesurait 268 px d'outils avant le premier produit et trois modes « imposés au client »).
  Recherche avec exemples réels, filtres **Alles · Uw vaste producten · Rauw OK · groupes métier** (Vis, Garnalen,
  Schaaldieren, Schelpdieren, Inktvis, Zeewier en overig) déduits du nom puis de la catégorie (`FB.groep` : la catégorie
  « Algemeen » de la production mêle tout) ; familles (spec 019) dans un groupe ; noms affichés en **casse normale**
  (`FB.naam`, la donnée reste intacte) ; **plaques d'espèce** (aplat + forme, `FB.soort`) au lieu du pictogramme gris
  quand il n'y a pas de photo ; ligne d'origine (nom latin en italique · herkomst de la visfiche) ; badges **Rauw OK**,
  Diepvries / Vers, ontdooid, stock ; **un seul « + » de 44 px** : un geste met un pas au panier, le bouton montre alors
  la quantité et ouvre la fiche avec le stepper (téléphone) ; sur une liste large il devient le stepper. L'étoile
  « Bij uw vaste producten » est dans la fiche (synchro entre appareils inchangée).
- **FR-009 Rauw OK** — badge et filtre **seulement** si la visfiche (spec 035) dit « bestemd om rauw te eten » **et**
  un barème choisi (−20 °C 24 h ou −35 °C 15 h) ; « niet van toepassing » ou rien → pas de badge (`FB.rauwOk`).
- **FR-010 Onglets** — **Bestellen · Leveringen · Facturen · Account** (`K.klantTabs`). Les adresses restent :
  `#/catalogus` (Bestellen) et `#/bestellingen` (Leveringen, liens des e-mails). **Facturen** (`#/facturen`) est une vue
  des commandes livrées (« Te betalen » d'abord, relevé et QR en mode Portaal, pastille des factures à payer).
  **Favorieten** reste joignable depuis Account (`#/favorieten`). Rien n'est cassé : aucune route supprimée.
- **FR-011 Identité visuelle** — voix éditoriale **Instrument Serif** pour les titres (h1 des vues, titre de la carte,
  confirmation), **Atkinson Hyperlegible Next** reste pour les données et les prix. Police hébergée dans `assets/fonts/`
  (CSP `font-src 'self'` : Google Fonts bloqué) : paquet npm officiel **`@fontsource/instrument-serif@5.2.8`**
  (tarball sha256 `2d854941b7fec70cdfc2634a6af7eac6e35ebebbd3c9952ac76caca9ff7ab775`), fichiers
  `instrument-serif-latin-400-normal.woff2`, `-latin-ext-400-normal.woff2`, `-latin-400-italic.woff2`, licence **SIL OFL
  1.1** jointe (`assets/fonts/OFL-instrument-serif.txt`). Versions `?v=` posées par `scripts/assets-version.js`.
- **FR-012** Note « Nieuw » pour le gérant (`assets/nieuws.js`), néerlandais simple.

## Jetons partagés (à reprendre à l'assemblage)
Ajoutés au `:root` de `assets/ui.css` (aucun jeton existant modifié) : `--serif`, `--rauw` (#1F6B3A), `--rauw-bg`
(#DCEFE2), `--tide-ok` (#7FE0A8), `--tide-amber` (#F2B84B) ; en hoog contrast `--rauw` #124A26. Couples ajoutés à
`scripts/contrast-check.js` (AA, AAA en hoog contrast) : Rauw OK sur son fond, la carte et le canevas ; texte du bandeau
sur la timonerie ; jauge et point (1.4.11). Les règles nouvelles sont dans le bloc « x30 lot A » en fin de `ui.css`,
préfixées `.x30` (coque client) ou `x-*`. **Lot C (accueil public)** : le `@font-face` Instrument Serif est déjà dans
ce bloc ; le réutiliser plutôt que d'en déclarer un second.

## Hors périmètre / pas fait
- E-mail ou push au client ou à l'équipe lors d'une modification ou d'un ajout : **rien n'est envoyé** (l'équipe voit
  la commande complétée et le journal `Correcties`). À décider avec le gérant (INCERTAIN).
- Apprentissage « si le client corrige 3 fois 4 → 5 kg, la proposition suit » (audit 3.4) : non fait ; la médiane suit
  déjà l'historique livré.
- « Vandaag binnen » (arrivages du matin) : aucune donnée d'arrivage n'existe côté client ; non inventé.
- Créneau de livraison : voir FR-004.
- Panier (commentaire par ligne, champ date « mm/dd/yyyy ») et écran Factures complet (X4) : lots suivants.

## Risques et points INCERTAIN
1. Le calcul de la carte dépend de l'historique **réel** : sur la démo, il y a 2 à 5 lundis livrés par client ; en
   production, le plan demandait de vérifier en lecture que l'historique suffit (non fait ici : aucune lecture de la
   production). Sans livraison le même jour, la carte reprend la dernière commande.
2. Les groupes métier sont déduits des noms (liste de mots NL/FR) quand la catégorie est « Algemeen » : un nom inattendu
   tombe dans « Zeewier en overig ». À relire avec le catalogue réel.
3. Une modification re-tarife toute la commande au prix du jour (comme l'ancien « annuler + recommander ») ; une commande
   non facturée n'a pas de prix figé contractuel. À confirmer avec le gérant.
4. Concurrence : la commande est relue juste avant l'écriture ; une préparation qui commence entre cette relecture et
   l'écriture (fenêtre de quelques millisecondes) n'est pas verrouillée (le moteur n'a pas d'écriture conditionnelle ici).
5. « Rauw OK » reste soumis à la question juridique ouverte n° 4 de la spec 035 (qui garantit la congélation).
6. Décision de marque : la voix serif amende la règle « une seule famille » de DESIGN.md (amendement écrit, à valider
   par le gérant).

## Mesure
« Refaire sa commande habituelle » sur téléphone (390 px), session ouverte : **avant 5 gestes** (Bestellingen → filtre
Geleverd → la commande → Opnieuw bestellen → Bestelling plaatsen), **après 1 geste** (« Bestellen voor ma 26/10 · € … »).
Chronométré par script Playwright sur `scripts/dev.js` (captures et chiffres : `captures-x30/lot-a/`).
