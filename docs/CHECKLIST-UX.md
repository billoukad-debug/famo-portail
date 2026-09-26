# Checklist UX — FAMO Portail

Date : 26/09/2026. Adaptée de la checklist « Billy Command Center » (même date) au portail FAMO :
pages HTML statiques + JavaScript sans framework (`assets/ui.js` = composants `K.*`, `assets/pages/*.js`),
un seul fichier de style `assets/ui.css`, trois portails (klant, personeel, beheer), en NL et FR.

## 0. Sources

| Source | Rôle ici |
|---|---|
| **Web Interface Guidelines** (Vercel — [dépôt][WIG], [site][WIG-site], [règles de revue][WIG-cmd]) | Checklist principale. |
| Standards d'animation d'Emil Kowalski ([STANDARDS.md][EK]) | Mouvement : durées, courbes. |
| WAI-ARIA Authoring Practices ([dialogue modal][APG-dialog], [bouton de menu][APG-menu]) | Clavier & focus. |
| 10 heuristiques de Nielsen ([nngroup.com][NN]) | Retour, contrôle, erreurs. |
| Laws of UX ([Doherty][LUX-doherty], Fitts) · WCAG 2.2 ([2.5.8][WCAG-258], [2.5.7][WCAG-257], [2.4.11][WCAG-2411], [4.1.3][WCAG-413]) | Seuils chiffrés. |

### Ce qui change par rapport à la version Billy

- Pas de Next.js ni de Tailwind : `router.push`, `loading.tsx`, `error.tsx`, `'use client'` sont remplacés par leurs
  équivalents FAMO (routeur sur le `#`, `K.c.skeleton`, `K.retryBox`, `K.c.error`).
- Pas de palette ⌘K d'actions, de chat, de feux ni de trésorerie multi-devises : les points CLA-06, CHI-04,
  CHI-06, CHI-10 sont **sans objet** ici.
- Deux langues : chaque libellé visible passe par `K.t()` (NL → FR). Le registre est le vouvoiement (« u » / « vous »)
  pour le client, NL simple pour l'équipe.
- Le portail client est utilisé autant sur ordinateur que sur téléphone : MEP-04 couvre 390, 1024, 1280, 1440 et 1680 px.

## 1. Comment l'utiliser

Colonnes : identifiant · règle · comment le vérifier chez FAMO · **état au 26/09/2026**.

États : ✅ conforme · 🔧 corrigé dans ce lot · ⚠️ écart assumé (raison donnée) · ⏳ reste à faire · — sans objet.

Contrôles automatiques (portail de dev lancé avec `node scripts/dev.js`) :

```
node scripts/ux-audit.js          # FOR-01, ACC-02/03/04, INT-01, INT-03, MEP-04 sur 27 écrans × 2 largeurs
node scripts/check.js             # règles métier + tests unitaires (dont K.eur)
grep -nE "transition:\s*all" assets/ui.css                        # vide attendu
grep -rnE "<(div|span|tr|li|td)[^>]*onclick" assets *.html         # vide attendu
grep -rn 'href="#"' assets/pages assets/ui.js                     # vide attendu (une action = <button>)
grep -rnE "window\.confirm|[^.K]alert\(" assets                    # vide attendu (K.confirm)
grep -rnE "\.\.\.[\"']" assets/pages assets/ui.js                  # « … » et non « ... »
```

Gravité : **bloquant** = empêche d'agir ou trompe ; **majeur** = on peut agir mais l'harmonie est cassée ; **mineur** = finition.

---

## 2. Interactions (INT)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| INT-01 | Une navigation est un `<a href>` ; une action est un `<button>` ; jamais `<a href="#">` ni `<div onclick>`. | `grep 'href="#"'` et `ux-audit`. | 🔧 7 liens `href="#"` (Alles laden, Opnieuw proberen, Uitloggen, documents de la fiche commande) devenus des boutons `.linkbtn`. |
| INT-02 | Pas de zone morte : ce qui a l'air cliquable l'est. | Smoke test des clics (335 boutons, 0 erreur JS). Lignes du catalogue : tout le nom déplie. | ✅ |
| INT-03 | Cible ≥ 24 px, **44 px au tactile** ; agrandir la zone si le visuel est plus petit. Lien dans une phrase exempté (WCAG 2.5.8). | `ux-audit` (390 px, `pointer: coarse`). | 🔧 règle `@media (pointer:coarse)` : boutons, onglets, choix, tri, stepper ≥ 44 px ; liens isolés `.tlink`. Exception documentée : « Tonen » (dans un champ de 44 px, `data-ux-exempt`). |
| INT-04 | Mise à jour optimiste : l'écran change au clic, se réconcilie à la réponse. | Quantités, favoris, panier : instantanés (local). | ⚠️ Changements de statut côté équipe : on attend Airtable (bouton « …ing… » immédiat). Optimiste = risque de montrer une livraison qui n'a pas eu lieu. |
| INT-05 | Action destructive = **Annuler** (≈ 6 s) ou confirmation ; jamais immédiate sans recours. | Vertrekken, Betaald, retrait d'un article du panier → toast « Ongedaan maken ». Annuler une commande, supprimer un produit → `K.confirm`. | ✅ (🔧 retrait du panier depuis le panneau ordinateur, toast d'annulation 6 s). |
| INT-06 | L'URL porte l'état (onglet, vue, filtre). | Vues et onglets dans le `#` (`#/tabel`, `#/bord`, `#/catalogus`). | ⚠️ Filtres et recherche mémorisés par appareil (`localStorage`), pas dans l'URL : partager un lien filtré n'est pas un besoin à FAMO. |
| INT-07 | Retour arrière restaure le défilement. | Klant : ouvrir Winkelmand puis revenir au catalogue. | ⏳ Le routeur remonte en haut à chaque vue (`scrollTo(0,0)`). Mineur. |
| INT-08 | Tout glisser-déposer a un équivalent clic et clavier (WCAG 2.5.7). | Bord : boutons Valideren / Vertrekken / Geleverd. Leveringen : ▲▼. Beheer → Volgorde : ▲▼. | 🔧 ▲▼ de Leveringen **visibles sur téléphone** (étaient masqués ≤ 560 px) ; ▲▼ **ajoutés** en Beheer → Volgorde (catégories et produits). |
| INT-09 | Autofocus seulement avec clavier physique, sur le champ principal. | `K.panel` : premier champ focalisé si `pointer: fine`, sinon le panneau (pas de clavier qui surgit). | 🔧 |
| INT-10 | Jamais d'information indispensable seulement dans `title=`. | `grep ' title="'` : 17 occurrences ; les boutons icône ont aussi un `aria-label`. | ⏳ notes tronquées (Bestellingen, Leveringen, Entrepot) : vérifier une par une que le texte complet est lisible ailleurs. |
| INT-11 | Même menu au « ⋯ » et au clic droit. | — | — pas de menu contextuel : les actions sont visibles sur la ligne. |
| INT-12 | Cliquer un chiffre ouvre sa source. | Beheer → Overzicht : les cartes renvoient vers la liste concernée. | ⏳ non vérifié carte par carte. |

## 3. Clavier & focus (CLA)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| CLA-01 | Chaque parcours se fait au clavier. | Klant : commander, ouvrir une commande, l'annuler (test `kbd-e2e`). Beheer : réordonner (▲▼, Entrée). | ✅ pour ces parcours ; ⏳ pas de passe complète clavier sur chaque écran de l'équipe. |
| CLA-02 | Anneau de focus visible partout (`:focus-visible` 2 px `--p`). | `assets/ui.css` : règle globale `:focus-visible` ; champs : bordure + halo 3 px. | ✅ |
| CLA-03 | Rien de collant ne masque le focus ou une ancre. | `html { scroll-padding-top: 84px }` (barre de 64 px + 16 + marge). | 🔧 |
| CLA-04 | Panneau et dialogue = modal APG : `role="dialog"`, `aria-modal`, titre lié, Tab/Maj+Tab bouclent, Échap ferme **seulement le plus haut**, focus **rendu au déclencheur**. | `kbd-e2e` : 25× Tab et 25× Maj+Tab restent dans le panneau ; Échap sur la confirmation laisse le panneau ouvert ; le focus revient au bouton puis à la carte. | 🔧 (avant : pas de piège à focus, Échap fermait confirmation **et** panneau, focus perdu sur `body`). |
| CLA-05 | Menu « ⋯ » = bouton de menu APG. | — | — pas de menu déroulant. La recherche globale suit le motif liste (↑↓ Entrée Échap). |
| CLA-06 | Palette d'actions ⌘K. | — | — hors périmètre FAMO ; `/` ouvre la recherche globale (commande, klant, artikel, factuur). |
| CLA-07 | `?` affiche les raccourcis. | — | ⏳ un seul raccourci (`/`) : pas encore utile. |
| CLA-08 | Raccourcis cohérents entre écrans. | `/` = recherche sur toutes les pages de l'équipe. | ✅ |
| CLA-09 | Édition en ligne : Entrée valide, Échap annule. | `K.prompt` : Entrée valide, Échap annule. Grille des prix : saisie directe puis « Prijzen opslaan ». | ✅ |
| CLA-10 | Quand l'élément focalisé disparaît, le focus va au suivant. | Retrait d'un article dans le panneau panier → focus sur l'article suivant (ou « Bestellen »). | 🔧 pour le panier ; ⏳ ailleurs après un re-rendu complet. |

## 4. Formulaires & saisie (FOR)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| FOR-01 | Chaque champ a un libellé lié (`for`) ou un `aria-label`. | `ux-audit`. | 🔧 **78 champs** sans libellé lié : `K.c.field` déduit maintenant le `for` de l'`id` du champ ; prix négociés et grille des prix : `aria-label` « produit · klant » ; sélecteur Klant d'Invoeren. |
| FOR-02 | Entrée soumet ; ⌘/Ctrl+Entrée dans un `textarea`. | Connexion, mot de passe, profil : Entrée soumet. | ✅ ; ⏳ ⌘+Entrée dans les notes. |
| FOR-03 | Bouton d'envoi : désactivé pendant l'envoi, indicateur, **pas de saut de largeur** ; deux clics = une action. | `K.busy` : `disabled`, `aria-busy`, largeur figée, « Opslaan… ». Serveur : verrou par commande (`updateorder`), numéros FA/CN uniques. | 🔧 largeur + `aria-busy` ; ✅ idempotence serveur. |
| FOR-04 | Ne pas pré-désactiver l'envoi. | Winkelmand sous le minimum : bouton désactivé **avec** le montant manquant affiché juste au-dessus. | ⚠️ assumé : la raison est visible, pas besoin de cliquer pour la voir. |
| FOR-05 | Erreur à côté du champ (`aria-invalid`), focus sur la première erreur. | `K.setErr` : message sous le champ + `aria-invalid`. Mot de passe faux : focus sur le champ. | ✅ ; ⏳ focus automatique sur la première erreur pas généralisé. |
| FOR-06 | Ne pas bloquer la frappe ; accepter « 12,5 » et « 12.5 ». | Quantités, prix, stock : virgule et point acceptés. | ✅ ; ⏳ « 1 404,48 » (espace de milliers) pas encore accepté dans les prix. |
| FOR-07 | Bons `type` / `inputmode` / `autocomplete`. | Prix `inputmode="decimal"`, e-mail `email`, téléphone `tel`, mots de passe `current/new-password`, recherche `type="search"` sans correcteur. | ✅ (🔧 recherche du catalogue). |
| FOR-08 | Placeholder = exemple réel terminé par « … ». | « Zoek een product… », « bv. dikke moot… ». | ⏳ quelques exemples sans « … » (« bv. 16/20 »). Mineur. |
| FOR-09 | Prévenir avant de perdre une saisie. | — | ⏳ panneaux Beheer : fermer ne prévient pas. |
| FOR-10 | Valeurs par défaut intelligentes. | Leverdag = premier jour livrable ; langue des documents = langue de la demande ; klant pré-rempli depuis une aanvraag. | ✅ |
| FOR-11 | Unité visible dans le champ montant. | Libellés « excl. btw », placeholder = prix de base. | ⚠️ pas de suffixe € dans le champ (une seule devise). |
| FOR-12 | Dates : raccourcis + saisie libre. | Winkelmand : 6 prochains jours + « Andere dag » ; équipe : Vandaag / Morgen + date. | ✅ |
| FOR-13 | Un seul jeu de champs. | `K.c.field`, `K.c.input`, `.input`, `K.c.stepper`, `K.c.check`. | ✅ |

## 5. Édition & annulation (EDI)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| EDI-01 | Chaque donnée est modifiable là où elle est affichée. | Beheer : klanten, producten (🔧 + omschrijving), prijzen, bedrijf, toegang. Équipe : correction d'une commande depuis la fiche. | ✅ |
| EDI-02 | Un seul panneau d'édition (`K.panel`), fermé par Échap. | `K.panel` partout. | ✅ ; ⏳ pas d'URL `?edit=` pour ouvrir un panneau directement. |
| EDI-03 | Édition en ligne pour les champs simples. | Grille des prix, notes du panier. | ✅ |
| EDI-04 | Écriture → toast « Annuler ». | Vertrekken, Betaald, retrait du panier. | ⚠️ partiel : enregistrer un produit ou un klant n'a pas d'annulation (modification visible et re-modifiable). |
| EDI-05 | Confirmation seulement pour l'irréversible ; le bouton destructif n'a **pas** le focus. | `K.confirm({ danger })` : focus sur « Annuleren / Behouden », `role="alertdialog"`. | 🔧 (avant : focus sur le bouton destructif). |
| EDI-06 | Journal consultable (qui, quoi, avant → après). | Champ `Correcties` par commande, affiché dans la fiche. | ✅ par commande ; ⏳ pas de journal global. |
| EDI-07 | Les chiffres dérivés se recalculent après une écriture. | Totaux du panier en direct (🔧 sans redessiner la liste) ; équipe : rechargement + `S.autoRefresh` (60 s). | ✅ |
| EDI-08 | Créer depuis le contexte. | Aanvraag → « Klant aanmaken » pré-rempli (nom, adresse, langue). | ✅ |
| EDI-09 | Tout ce qui se fait se défait. | Vertrekken ↔ Corrigeren, Betaald ↔ annuler (toast), commande annulée → « Opnieuw bestellen ». | ✅ |
| EDI-10 | Un seul chemin d'écriture. | `K.api()` (invalide le cache des commandes à chaque mutation). | ✅ |
| EDI-11 | Si la base a changé entre-temps, le dire. | `409` (déjà vertrokken, déjà gefactureerd, commande en cours) → message + rechargement. | ✅ |

## 6. Retour & états (ETA)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| ETA-01 | Retour visuel < 100 ms. | `K.busy` au clic, stepper local, dépliage instantané. | ✅ |
| ETA-02 | Toasts dans une zone `aria-live` **montée en permanence**. | `.toasts` `role="status"` créé au chargement de la page. | 🔧 (avant : créée avec le premier message, souvent non lue). |
| ETA-03 | Retour près de l'action ou pile fixe en bas. | Toasts fixes en bas ; ligne du catalogue surlignée ; panneau panier mis à jour. | ✅ |
| ETA-04 | Tous les états dessinés : vide, erreur, chargement. | `K.c.empty`, `K.c.error`, `K.c.skeleton`. | ✅ |
| ETA-05 | Squelette de chargement à la forme du contenu. | `K.c.skeleton` au démarrage de chaque écran. | ✅ ; ⚠️ pas de délai d'apparition ni de durée minimale. |
| ETA-06 | Erreur de chargement : phrase claire + « Opnieuw proberen ». | `K.retryBox`. | ✅ |
| ETA-07 | Bouton en cours : libellé « …ing… », largeur conservée. | `K.busy`. | 🔧 largeur conservée. |
| ETA-08 | Pas de cul-de-sac : l'état vide propose l'action suivante. | Winkelmand vide → « Naar de catalogus » ; pas de commande → idem. | ✅ |
| ETA-09 | Fraîcheur visible. | Équipe : rafraîchissement 60 s + alerte nouvelle commande + compteur dans l'onglet. | ⚠️ pas d'horodatage « mis à jour il y a… » affiché. |
| ETA-10 | Message d'erreur = ce qui s'est passé + la sortie. | « Sessie verlopen → opnieuw aanmelden », « Slechts 3 beschikbaar », minimum manquant. | ✅ |
| ETA-11 | Navigation lente : indicateur. | Squelette dès l'ouverture d'une page. | ✅ |

## 7. Mise en page & typographie (MEP)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| MEP-01 | Titres `text-wrap: balance`, paragraphes `pretty`. | `assets/ui.css`. | 🔧 |
| MEP-02 | Contenus longs gérés (`min-width:0`, `overflow-wrap`). | Noms de produits en majuscules longues, adresses. | ✅ |
| MEP-03 | Tableau large : défile dans sa carte. | `.tblwrap`. | ✅ |
| MEP-04 | Vérifié à 390, 1024, 1280, 1440, 1680 px. | `ux-audit` (0 défilement horizontal) + `kcat` (5 largeurs). | 🔧 **portail client refait pour ordinateur** : en-tête avec onglets et panier, catégories à gauche (≥ 1200 px), liste en tableau, panier fixe à droite, colonnes calibre/unité à partir de 1600 px, pages en deux colonnes. |
| MEP-05 | Toute ancre visible sous les barres collantes. | `scroll-padding-top`. | 🔧 |
| MEP-06 | Une seule action primaire par zone. | Catalogue : « Bestellen » ; Winkelmand : « Bestelling plaatsen ». | ✅ |
| MEP-07 | Densité : l'essentiel au-dessus de la ligne de flottaison. | Catalogue : une ligne de ~56 px par produit (au lieu d'une carte de ~110 px) ; photo et détails au dépliage. | 🔧 |

## 8. Chiffres & données (CHI)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| CHI-01 | Chiffres tabulaires quand on compare. | `.mono` / `font-variant-numeric: tabular-nums`. | ✅ |
| CHI-02 | Montants alignés à droite ; espace **insécable** entre € et le montant ; dates `nl-BE`. | `K.eur` → `€ 1.284,50` (test `ui.test.js`). | 🔧 (un montant ne se coupe plus en fin de ligne). |
| CHI-03 | Toujours 2 décimales pour les montants. | `K.eur`, `documents.js`, `lib/ordermail.js` : même format (test de parité). | ✅ |
| CHI-04 | Jamais deux devises additionnées. | — | — une seule devise. |
| CHI-05 | Donnée absente clairement signalée. | « — » dans les tableaux, « Adres bij Famo bekend ». | ⚠️ « — » gardé (pas de composant « MANQUANT » dans FAMO). |
| CHI-06 | Valeur déduite vs prouvée. | — | — |
| CHI-07 | Un total montre son calcul. | Panier : quantité × prix par ligne, total excl. btw ; facture : détail btw. | ✅ |
| CHI-08 | Négatif = signe « − » + texte, pas la couleur seule. | Creditnota : montant signé + libellé. | ✅ |
| CHI-09 | Tableau > 10 lignes : tri (`aria-sort`) et filtre. | Bestellingen : tri + filtres + dates. | ✅ ; ⏳ Documenten, Klanten : filtre texte mais pas de tri par colonne. |
| CHI-10 | Graphique accessible. | — | — pas de graphique. |
| CHI-11 | Identifiants visibles et stables. | Référence commande, FA-/CN-, klantnummer. | ✅ |

## 9. Mouvement (MOU)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| MOU-01 | `prefers-reduced-motion` coupe transitions et animations. | Règle globale en fin de `assets/ui.css`. | 🔧 (avant : seulement squelette et boutons). |
| MOU-02 | Animer `transform`/`opacity` ; jamais `transition: all`. | `grep transition` : une seule sur `left` (bascule `.toggle`, 150 ms, petite). | ✅ ; ⚠️ bascule sur `left` gardée. |
| MOU-03 | Durées < 300 ms. | 120–160 ms. | ✅ |
| MOU-04 | `ease-out` fort pour entrer. | Chevron du catalogue `cubic-bezier(.23,1,.32,1)`. | ✅ |
| MOU-05 | Pas d'animation sur ce qui se répète au clavier. | Recherche, stepper : sans animation. | ✅ |
| MOU-06 | Retour de pression discret. | `.btn:active { transform: scale(.98) }`. | 🔧 |
| MOU-07 | Le mouvement explique. | Glisser : fantôme + emplacement ; chevron qui tourne au dépliage. | ✅ |

## 10. Accessibilité (ACC)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| ACC-01 | Sémantique native avant ARIA. | Catalogue : bouton de dépliage `aria-expanded` ; tableaux `th`. | ✅ ; ⚠️ carte de commande client = `div role="button"` (clavier géré : Tab, Entrée, Espace). |
| ACC-02 | Bouton icône = `aria-label`. | `ux-audit`. | 🔧 case « Voorraad automatisch afboeken » sans nom. |
| ACC-03 | Icônes décoratives `aria-hidden`. | `K.icon` pose `aria-hidden="true"`. | ✅ |
| ACC-04 | Lien d'évitement, `lang`, `<title>`, un seul `h1`. | `ux-audit` + `kbd-e2e` (Tab 1 = « Naar de inhoud », Entrée = focus sur le contenu). | 🔧 lien d'évitement + `<main>` sur les portails équipe, beheer, client et la page d'accueil (le lien déplace le focus sans toucher au `#` du routeur) ; titres de pages client en `h1`. |
| ACC-05 | Contraste AA ; survol et focus plus contrastés. | Palette crème (PR #15). | ⏳ pas re-mesuré après ce lot. |
| ACC-06 | États annoncés : `aria-current`, `aria-pressed`, `aria-expanded`, `aria-busy`. | Onglets, favoris, catégories (🔧 `aria-pressed`), dépliage (🔧), boutons en cours (🔧). | ✅ |
| ACC-07 | Couleur jamais seule. | Statuts : pastille + texte ; « uw prijs » + prix barré. | ✅ |

## 11. Performance perçue (PER)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| PER-01 | Écriture < 500 ms, sinon indicateur. | Airtable ≈ 300–900 ms : `K.busy` immédiat. | ⚠️ dépend d'Airtable. |
| PER-02 | Longues listes : `content-visibility` ou pagination. | Catalogue : `content-visibility: auto` par ligne ; équipe : fenêtre de jours + « Alles laden ». | 🔧 catalogue. |
| PER-03 | Frappe fluide. | Recherches `K.debounce` 150 ms ; quantités sans redessiner la liste. | 🔧 |
| PER-04 | Pages légères. | Aucun framework, aucun build ; scripts `defer` + cache long versionné (`?v=`). | ✅ |

## 12. Contenu & ton (TON)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| TON-01 | Verbe d'abord (« Bestelling plaatsen », « Volgorde bewaren »). | Libellés des boutons. | ✅ |
| TON-02 | Jamais « OK ». | `grep '>OK<\|"OK"'`. | 🔧 bouton par défaut de `K.confirm` / `K.prompt` : « Bevestigen » / « Confirmer ». |
| TON-03 | Sentence case, pas de point final sur un libellé. | NL et FR. | ✅ |
| TON-04 | « … », guillemets « », apostrophe ’. | `grep '\.\.\.'` vide. | ✅ |
| TON-05 | Un seul nom par chose, un seul registre. | Klant : « u » / « vous ». Équipe : NL direct. | ✅ |
| TON-06 | Erreurs positives avec la sortie. | Voir ETA-10. | ✅ |
| TON-07 | Aucun texte daté en dur. | `grep` des dates dans `assets/pages` : vide. | ✅ |

---

## Bilan du passage (26/09/2026)

- **Corrigé dans ce lot (🔧)** : 26 points, dont les 4 qui changent le plus la sensation :
  - le portail client en vraie version ordinateur, avec des lignes produit dépliables (MEP-04, MEP-07) ;
  - les dialogues et panneaux conformes APG : focus piégé puis rendu, Échap qui ne ferme que le plus haut (CLA-04) ;
  - les ▲▼ partout où l'on peut glisser (INT-08) ;
  - les libellés liés sur tous les champs (FOR-01).
- **Écarts assumés (⚠️)** : chacun est justifié dans sa ligne (statuts non optimistes, filtres par appareil, « — », etc.).
- **Reste à faire (⏳)**, par ordre d'utilité :
  - FOR-09 (prévenir avant de perdre une saisie dans Beheer) ;
  - INT-07 (garder la position dans le catalogue) ;
  - FOR-06 (« 1 404,48 ») ;
  - CHI-09 (tri Documenten / Klanten) ;
  - ACC-05 (mesure des contrastes) ;
  - FOR-08 (placeholders avec « … ») ;
  - EDI-02 (panneau adressable par l'URL) ;
  - CLA-07 (`?`).

[WIG]: https://github.com/vercel-labs/web-interface-guidelines
[WIG-site]: https://vercel.com/design/guidelines
[WIG-cmd]: https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md
[EK]: https://github.com/emilkowalski/skills/blob/main/skills/review-animations/STANDARDS.md
[APG-dialog]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
[APG-menu]: https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
[NN]: https://www.nngroup.com/articles/ten-usability-heuristics/
[LUX-doherty]: https://lawsofux.com/doherty-threshold/
[WCAG-2411]: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
[WCAG-258]: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
[WCAG-257]: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
[WCAG-413]: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
