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
- Le portail client est utilisé autant sur ordinateur que sur téléphone. Contrôle automatique (`ux-audit`) : 1280 et 390 px seulement ; les autres largeurs (1024, 1440, 1680 px) ont été vues à la main, sans script dans le dépôt.

## 1. Comment l'utiliser

Colonnes : identifiant · règle · comment le vérifier chez FAMO · **état au 26/09/2026**.

États : ✅ conforme · 🔧 corrigé dans ce lot · ⚠️ écart assumé (raison donnée) ou **à revérifier** · ⏳ reste à faire · — sans objet.

Preuves : seuls `scripts/ux-audit.js`, `scripts/check.js` (dont `contrast-check.js`) et les `grep` ci-dessous sont dans le dépôt et rejouables. Les passages manuels des 26 et 27/09 (parcours clavier, clics, mesures de largeur) avaient été faits avec des scripts jamais commités (`rest-e2e`, `kbd-e2e`, `design-e2e`, `kcat`) : ces mentions ont été retirées le 27/09/2026 ; un point qui n'a pas d'autre preuve est à revérifier à la main ou par `scripts/kbd-audit.js` quand il existera.

Contrôles automatiques (portail de dev lancé avec `node scripts/dev.js`) :

```
node scripts/ux-audit.js          # FOR-01, ACC-02/03/04, INT-01, INT-03, MEP-04 sur 27 écrans × 2 largeurs (1280, 390)
node scripts/kbd-audit.js         # parcours clavier seul (client 390/1440, équipe, Beheer) : focus masqué, anneau, nom, piège, Entrée ; BASE local uniquement
                                  # non couverts : order.html, beheer.html#/journaal
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
| INT-02 | Pas de zone morte : ce qui a l'air cliquable l'est. | À la main : cliquer ce qui a l'air cliquable ; `ux-audit` (CLA-01) vérifie l'accès clavier. Lignes du catalogue : tout le nom déplie. | ✅ |
| INT-03 | Cible ≥ 24 px, **44 px au tactile** ; agrandir la zone si le visuel est plus petit. Lien dans une phrase exempté (WCAG 2.5.8). | `ux-audit` (390 px, `pointer: coarse`). | 🔧 règle `@media (pointer:coarse)` : boutons, onglets, choix, tri, stepper ≥ 44 px ; liens isolés `.tlink`. Exception documentée : « Tonen » (dans un champ de 44 px, `data-ux-exempt`). |
| INT-04 | Mise à jour optimiste : l'écran change au clic, se réconcilie à la réponse. | Quantités, favoris, panier : instantanés (local). | ⚠️ Changements de statut côté équipe : on attend Airtable (bouton « …ing… » immédiat). Optimiste = risque de montrer une livraison qui n'a pas eu lieu. |
| INT-05 | Action destructive = **Annuler** (≈ 6 s) ou confirmation ; jamais immédiate sans recours. | Vertrekken, Betaald, retrait d'un article du panier → toast « Ongedaan maken ». Annuler une commande, supprimer un produit → `K.confirm`. | ✅ (🔧 retrait du panier depuis le panneau ordinateur, toast d'annulation 6 s). |
| INT-06 | L'URL porte l'état (onglet, vue, filtre). | Vues et onglets dans le `#` (`#/tabel`, `#/bord`, `#/catalogus`). | ⚠️ Filtres et recherche mémorisés par appareil (`localStorage`), pas dans l'URL : partager un lien filtré n'est pas un besoin à FAMO. |
| INT-07 | Retour arrière restaure le défilement. | Klant : descendre dans le catalogue, ouvrir Account, revenir. | ✅ **vérifié le 27/09/2026** (`kbd-audit` et `ux-audit` : 0 écart, fusion wip/ux) — chaque vue doit retrouver sa position (400 px → retour catalogue à 400 px). |
| INT-08 | Tout glisser-déposer a un équivalent clic et clavier (WCAG 2.5.7). | Bord : boutons Valideren / Vertrekken / Geleverd. Leveringen : ▲▼. Beheer → Volgorde : ▲▼. | 🔧 ▲▼ de Leveringen **visibles sur téléphone** (étaient masqués ≤ 560 px) ; ▲▼ **ajoutés** en Beheer → Volgorde (catégories et produits). |
| INT-09 | Autofocus seulement avec clavier physique, sur le champ principal. | `K.panel` : premier champ focalisé si `pointer: fine`, sinon le panneau (pas de clavier qui surgit). | 🔧 |
| INT-10 | Jamais d'information indispensable seulement dans `title=`. | `grep ' title="'` : 17 occurrences relues une par une. | 🔧 la note de commande est affichée en clair dans Entrepot et Leveringen (elle n'était visible qu'au survol, donc jamais sur téléphone) ; l'exception de livraison montre sa note dans l'étiquette. Restent en `title=` : des doublons d'un texte visible ou de la fiche (lignes, paiement). |
| INT-11 | Même menu au « ⋯ » et au clic droit. | — | — pas de menu contextuel : les actions sont visibles sur la ligne. |
| INT-12 | Cliquer un chiffre ouvre sa source. | Beheer → Overzicht, Bestellingen, Documenten : cliquer chaque chiffre. | 🔧 les 4 cartes d'Overzicht sont des liens (commandes, factures ouvertes, klanten, producten) ; « te laat » ouvre Bestellingen filtré, « onbetaalde facturen » ouvre Documenten → Openstaand. |

## 3. Clavier & focus (CLA)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| CLA-01 | Chaque parcours se fait au clavier. | `ux-audit` (CLA-01) + parcours au clavier à la main. | 🔧 `ux-audit` vérifie maintenant que tout ce qui a un curseur main est atteignable au clavier : 0 écart sur 27 écrans × 2 largeurs. |
| CLA-02 | Anneau de focus visible partout (`:focus-visible` 2 px `--p`). | `assets/ui.css` : règle globale `:focus-visible` ; champs : bordure + halo 3 px. | ✅ |
| CLA-03 | Rien de collant ne masque le focus ou une ancre. | `html { scroll-padding-top: 84px }` (barre de 64 px + 16 + marge). | ✅ **vérifié le 27/09/2026** (`kbd-audit` et `ux-audit` : 0 écart, fusion wip/ux) — 🔧 |
| CLA-04 | Panneau et dialogue = modal APG : `role="dialog"`, `aria-modal`, titre lié, Tab/Maj+Tab bouclent, Échap ferme **seulement le plus haut**, focus **rendu au déclencheur**. | À la main : 25× Tab et 25× Maj+Tab restent dans le panneau ; Échap sur la confirmation laisse le panneau ouvert ; le focus revient au bouton puis à la carte. | ✅ **vérifié le 27/09/2026** (`kbd-audit` et `ux-audit` : 0 écart, fusion wip/ux) — 🔧 (avant : pas de piège à focus, Échap fermait confirmation **et** panneau, focus perdu sur `body`). |
| CLA-05 | Menu « ⋯ » = bouton de menu APG. | — | — pas de menu déroulant. La recherche globale suit le motif liste (↑↓ Entrée Échap). |
| CLA-06 | Palette d'actions ⌘K. | — | — hors périmètre FAMO ; `/` ouvre la recherche globale (commande, klant, artikel, factuur). |
| CLA-07 | `?` affiche les raccourcis. | Appuyer sur `?` sur n'importe quel écran ; taper `?` dans un champ : rien. | 🔧 `?` ouvre la liste des raccourcis (communs + ceux de la page), ignoré pendant la saisie, Échap ferme. |
| CLA-08 | Raccourcis cohérents entre écrans. | `/` = recherche sur toutes les pages de l'équipe et dans le catalogue client. | ✅ ; 🔧 `/` va aussi à la recherche du catalogue client (`aria-keyshortcuts`). |
| CLA-09 | Édition en ligne : Entrée valide, Échap annule. | `K.prompt` : Entrée valide, Échap annule. Grille des prix : saisie directe puis « Prijzen opslaan ». | ✅ |
| CLA-10 | Quand l'élément focalisé disparaît, le focus va au suivant. | Beheer : modifier un produit, enregistrer → focus sur son « Bewerken ». | ✅ **vérifié le 27/09/2026** (`kbd-audit` et `ux-audit` : 0 écart, fusion wip/ux) — 🔧 à la fermeture d'un panneau, le focus revient au bouton qui l'a ouvert, **même si la liste a été redessinée** (retrouvé par son identifiant) ; ⚠️ carte qui quitte une colonne après une action (Entrepot) : focus non repositionné. |

## 4. Formulaires & saisie (FOR)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| FOR-01 | Chaque champ a un libellé lié (`for`) ou un `aria-label`. | `ux-audit`. | ✅ **vérifié le 27/09/2026** (`kbd-audit` et `ux-audit` : 0 écart, fusion wip/ux) — 🔧 **78 champs** sans libellé lié : `K.c.field` déduit maintenant le `for` de l'`id` du champ ; prix négociés et grille des prix : `aria-label` « produit · klant » ; sélecteur Klant d'Invoeren. |
| FOR-02 | Entrée soumet ; ⌘/Ctrl+Entrée dans un `textarea`. | Beheer → produit → Omschrijving : Ctrl+Entrée enregistre (à la main). | 🔧 ⌘/Ctrl+Entrée dans un champ multiligne déclenche le bouton principal de la zone (panneau, formulaire, carte). |
| FOR-03 | Bouton d'envoi : désactivé pendant l'envoi, indicateur, **pas de saut de largeur** ; deux clics = une action. | `K.busy` : `disabled`, `aria-busy`, largeur figée, « Opslaan… ». Serveur : une seule requête à la fois par commande **sur une même instance** (`inflight` en mémoire dans `updateorder`, pas de verrou entre instances Vercel), contrôles de statut (409), numéros FA/CN dédoublonnés après écriture (`ensureUnique`). | 🔧 largeur + `aria-busy` ; ⚠️ idempotence serveur partielle : deux requêtes simultanées sur deux instances ne sont pas exclues. |
| FOR-04 | Ne pas pré-désactiver l'envoi. | Winkelmand sous le minimum : bouton désactivé **avec** le montant manquant affiché juste au-dessus. | ⚠️ assumé : la raison est visible, pas besoin de cliquer pour la voir. |
| FOR-05 | Erreur à côté du champ (`aria-invalid`), focus sur la première erreur. | Nouveau produit vide → Opslaan : focus sur Naam (à la main). | 🔧 message lié au champ (`aria-describedby`) et focus automatique sur la première erreur après validation. |
| FOR-06 | Ne pas bloquer la frappe ; accepter « 12,5 » et « 12.5 ». | Prix « 1 404,48 » dans Beheer → enregistré 1404.48. | 🔧 `K.parseNum` : « 1 404,48 », « 1.404,48 », « 1404.48 », « € 12,50 », « 12,5 » ; utilisé pour prix, stock, seuils, btw, minimum, quantités (tests unitaires `test/ui.test.js`). |
| FOR-07 | Bons `type` / `inputmode` / `autocomplete`. | Prix `inputmode="decimal"`, e-mail `email`, téléphone `tel`, mots de passe `current/new-password`, recherche `type="search"` sans correcteur. | ✅ (🔧 recherche du catalogue). |
| FOR-08 | Placeholder = exemple réel terminé par « … ». | « Zoek een product… », « bv. dikke moot… ». | 🔧 les exemples (« bv. … ») finissent par « … » en NL et FR ; ⚠️ gardés tels quels : masques de format (« 22:00 », « BE 0xxx.xxx.xxx », IBAN) et consignes (« Leeg = automatisch »). |
| FOR-09 | Prévenir avant de perdre une saisie. | Beheer → produit → changer le nom → Échap (à la main). | 🔧 panneau modifié : ×, Échap, clic à côté ou « Annuleren » demandent « Sluiten zonder bewaren? » ; quitter la page avec un panneau modifié → alerte du navigateur. Enregistrer ferme sans question. |
| FOR-10 | Valeurs par défaut intelligentes. | Leverdag = premier jour livrable ; langue des documents = langue de la demande ; klant pré-rempli depuis une aanvraag. | ✅ |
| FOR-11 | Unité visible dans le champ montant. | Libellés « excl. btw », placeholder = prix de base. | ⚠️ pas de suffixe € dans le champ (une seule devise). |
| FOR-12 | Dates : raccourcis + saisie libre. | Winkelmand : 6 prochains jours + « Andere dag » ; équipe : Vandaag / Morgen + date. | ✅ |
| FOR-13 | Un seul jeu de champs. | `K.c.field`, `K.c.input`, `.input`, `K.c.stepper`, `K.c.check`. | ✅ |

## 5. Édition & annulation (EDI)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| EDI-01 | Chaque donnée est modifiable là où elle est affichée. | Beheer : klanten, producten (🔧 + omschrijving), prijzen, bedrijf, toegang. Équipe : correction d'une commande depuis la fiche. | ✅ |
| EDI-02 | Un seul panneau d'édition (`K.panel`), fermé par Échap. | Copier l'URL avec le panneau ouvert, la rouvrir (à la main). | 🔧 Beheer : `#/producten?edit=product:<id>` et `#/klanten?edit=klant:<id>` ouvrent le panneau ; l'URL suit l'ouverture et la fermeture. |
| EDI-03 | Édition en ligne pour les champs simples. | Grille des prix, notes du panier. | ✅ |
| EDI-04 | Écriture → toast « Annuler ». | Vertrekken, Betaald, retrait du panier. | ⚠️ partiel : enregistrer un produit ou un klant n'a pas d'annulation (modification visible et re-modifiable). |
| EDI-05 | Confirmation seulement pour l'irréversible ; le bouton destructif n'a **pas** le focus. | `K.confirm({ danger })` : focus sur « Annuleren / Behouden », `role="alertdialog"`. | 🔧 (avant : focus sur le bouton destructif). |
| EDI-06 | Journal consultable (qui, quoi, avant → après). | Beheer → Journaal : une ligne par correction (ex. « Betaald (Contant) · beheerder »). | 🔧 Beheer → **Journaal** : toutes les corrections, paiements, creditnota's et exceptions de toutes les commandes, du plus récent au plus ancien, avec recherche et lien vers la commande. |
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
| ETA-12 | **Pastilles de compteur** dans la navigation pour ce qui attend une action : Bestellingen (à confirmer), Magazijn (à préparer aujourd'hui), Leveringen (à livrer aujourd'hui), Documenten (factures ouvertes), Voorraad (sous le seuil), Beheer et onglet Aanvragen (demandes nouvelles), Bestellingen client (factures à payer). Le chiffre = celui de la page ; nommé pour les lecteurs d'écran ; aucun appel en plus pour les commandes, ≤ 1 appel / 15 min pour Voorraad et Beheer. Pourquoi : on sait où agir sans ouvrir chaque écran (Nielsen #1). | Chaque pastille égale le compteur de sa page (à la main). | ✅ **vérifié le 27/09/2026** (`kbd-audit` et `ux-audit` : 0 écart, fusion wip/ux) — 🔧 (27/09) — demande de Bilal. |

## 7. Mise en page & typographie (MEP)

| ID | Règle | Vérifier chez FAMO | État |
|---|---|---|---|
| MEP-01 | Titres `text-wrap: balance`, paragraphes `pretty`. | `assets/ui.css`. | 🔧 |
| MEP-02 | Contenus longs gérés (`min-width:0`, `overflow-wrap`). | Noms de produits en majuscules longues, adresses. | ✅ |
| MEP-03 | Tableau large : défile dans sa carte. | `.tblwrap`. | ✅ |
| MEP-04 | Pas de défilement horizontal, de 390 à 1680 px. | `ux-audit` : 0 défilement horizontal à 1280 et 390 px ; 1024, 1440 et 1680 px vus à la main (pas de script). | 🔧 **portail client refait pour ordinateur** : en-tête avec onglets et panier, catégories à gauche (≥ 1200 px), liste en tableau, panier fixe à droite, colonnes calibre/unité à partir de 1600 px, pages en deux colonnes. |
| MEP-05 | Toute ancre visible sous les barres collantes. | `scroll-padding-top` ; `kbd-audit` vérifie à chaque arrêt de tabulation que l'élément focalisé n'est jamais caché par un élément fixe ou collant (2.4.11). | ✅ **vérifié le 01/10/2026** (`kbd-audit` : 0 écart, ordre CI ux-audit → kbd-audit sur données neuves) |
| MEP-06 | Une seule action primaire par zone. | Catalogue : « Bestellen » ; Winkelmand : « Bestelling plaatsen ». | ✅ |
| MEP-07 | Densité : l'essentiel au-dessus de la ligne de flottaison. | Catalogue : une ligne de ~56 px par produit (au lieu d'une carte de ~110 px) ; photo et détails au dépliage. | 🔧 |
| MEP-08 | **Pas de trou** : des cartes de hauteurs différentes côte à côte se répartissent en colonnes (`.masonry`), jamais en grille à rangées fixes qui laisse du vide sous la plus courte. Pourquoi : un écran « à moitié vide » paraît cassé. | Bedrijfsgegevens, Rapportage, Account (client) à 1440 px : pas d'espace > 20 px entre deux cartes d'une même colonne (à la main). | 🔧 (27/09) — remarque de Bilal sur Account. |
| MEP-09 | **Une liste qui grandit est en lignes**, pas en bulles : commandes, documents, produits. Une ligne = l'essentiel lisible d'un coup d'œil ; le détail et les actions rares au clic. Pourquoi : avec 50 commandes, des cartes de 200 px obligent à faire défiler sans fin. | Commandes client : 1 ligne ≈ 63 px ordinateur, < 140 px téléphone (contre ~200 px en carte). | 🔧 (27/09) — remarque de Bilal sur les documents client. |
| MEP-10 | **Colonnes alignées** : plusieurs tableaux de même nature (groupes Vandaag / Morgen…) ont les mêmes largeurs de colonnes ; les boutons d'action occupent des emplacements fixes. Pourquoi : l'œil suit une colonne d'un groupe à l'autre. | Bestellingen : colonne Klant au même x dans chaque groupe ; Documenten : « Openen / PDF » au même x sur chaque ligne (à la main). | 🔧 (27/09) |
| MEP-11 | Même largeur de page pour toutes les vues d'un portail (pas une vue à 1100 px et la suivante pleine largeur) ; une ligne d'infos garde sa place avant ses boutons (les boutons passent dessous). Pourquoi : cohérence d'une page à l'autre. | Favorieten, Account = largeur du catalogue ; Magazijn : nom, référence et articles lisibles, boutons dessous si besoin. | 🔧 (27/09) |

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
| CHI-09 | Tableau > 10 lignes : tri (`aria-sort`) et filtre. | Documenten : cliquer « Bedrag » → croissant (à la main). | 🔧 Documenten : tri par colonne (`aria-sort`), mémorisé ; Klanten : tri par nom, numéro ou « sans e-mail d'abord ». |
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
| ACC-04 | Lien d'évitement, `lang`, `<title>`, un seul `h1`. | `ux-audit` + à la main (Tab 1 = « Naar de inhoud », Entrée = focus sur le contenu). | 🔧 lien d'évitement + `<main>` sur les portails équipe, beheer, client et la page d'accueil (le lien déplace le focus sans toucher au `#` du routeur) ; titres de pages client en `h1`. |
| ACC-05 | Contraste AA ; survol et focus plus contrastés. | `node scripts/contrast-check.js`. | ✅ **vérifié le 27/09/2026** (`kbd-audit` et `ux-audit` : 0 écart, fusion wip/ux) — 🔧 mesuré par `scripts/contrast-check.js` (dans `check.js` et la CI) : 24 couples texte / fond, tous AA. Corrigés : texte discret sur en-tête de tableau (4,45 → 4,71), texte d'alerte (4,47 → 4,68), **bordure des champs** (1,76 → 3,19 sur blanc, 3,03 sur crème ; WCAG 1.4.11). |
| ACC-06 | États annoncés : `aria-current`, `aria-pressed`, `aria-expanded`, `aria-busy`. | Onglets, favoris, catégories (🔧 `aria-pressed`), dépliage (🔧), boutons en cours (🔧). | ✅ **vérifié le 27/09/2026** (`kbd-audit` et `ux-audit` : 0 écart, fusion wip/ux) — ✅ |
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

## Bilan

- **Passage du 26/09/2026** : 26 points corrigés, dont :
  - le portail client en vraie version ordinateur (MEP-04, MEP-07) ;
  - les dialogues APG (CLA-04) ;
  - les ▲▼ en alternative au glisser (INT-08) ;
  - les libellés liés (FOR-01).
- **Passage du 27/09/2026** : les 15 points ⏳ traités :
  - FOR-09 : prévenir avant de perdre une saisie ;
  - INT-07 : position gardée ;
  - FOR-06 : saisie de nombres ;
  - CHI-09 : tri ;
  - ACC-05 : contrastes mesurés et corrigés, contrôle ajouté à la CI ;
  - FOR-08 : placeholders ;
  - EDI-02 : panneaux par URL ;
  - CLA-07 : `?` ;
  - EDI-06 : Journaal global ;
  - INT-10 : notes visibles sur téléphone ;
  - INT-12 : chiffres cliquables ;
  - FOR-02 : Ctrl+Entrée ;
  - FOR-05 : focus sur l'erreur ;
  - CLA-10 : focus après re-rendu ;
  - CLA-01 : contrôle clavier automatique.
- **Passage du 27/09/2026 (bis)** : nouvelle revue avec les principes relevés par Bilal. 12 manques trouvés et corrigés :
  - pas de trou (MEP-08) : Account, Bedrijfsgegevens, Rapportage ;
  - listes en lignes (MEP-09) : commandes et documents côté client ;
  - colonnes et boutons alignés (MEP-10) : Bestellingen, Documenten ;
  - largeurs et lignes cohérentes (MEP-11) : Favorieten, Magazijn, Klanten ;
  - pastilles de compteur (ETA-12) : toute la navigation.
- **Mise à jour du 27/09/2026 (audit qualité)** : preuves vers des scripts absents du dépôt retirées ; MEP-04 ramené aux deux largeurs réellement contrôlées ; FOR-03 corrigé (pas de verrou entre instances) ; ACC-05, ACC-06, CLA-03, CLA-04, CLA-10, MEP-05, INT-07, FOR-01, ETA-12 marqués « à revérifier » (corrections en cours par ailleurs).
- **Écarts assumés (⚠️)** : chacun est justifié dans sa ligne. CLA-10 (carte qui change de colonne dans Magazijn Bord) n'est plus un écart : mesuré le 01/10/2026, le focus suit la carte sur sa nouvelle action (Klaarzetten → Klaar, Vertrekt → Onderweg) ; scénario ajouté à `scripts/kbd-audit.js`.
- **Contrôles à relancer après chaque changement d'interface** :
  - `node scripts/check.js`, qui inclut les contrastes ;
  - `node scripts/ux-audit.js` (lancé aussi par la CI, job « Navigateur »).

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

- **Mise à jour du 27/09/2026 (lot accessibilité fusionné)** : INT-07, CLA-03, CLA-04, CLA-10, FOR-01, FOR-02, ETA-12, ACC-05, ACC-06 vérifiés par `scripts/kbd-audit.js` et `scripts/ux-audit.js` (0 écart, les deux tournent dans la CI) ; pastille Magazijn = à préparer aujourd'hui et demain ; `--ink-3` = #66645D.
- **Mise à jour du 30/09/2026 (spec 001, `specs/001-badges-lus/`)** : ETA-12 — les pastilles ont trois modes par appareil : « Nieuw » (défaut : seuls les éléments pas encore vus ; ouvrir la page les marque vus), « Alles » (tout ce qui reste à faire, l'ancien comportement), « Uit » (aucune). Choix : cloche de la barre du haut (personnel/Beheer), ligne « Tellers in het menu » dans Account (client, NL/FR). Mémoire en `localStorage` (`famoBadgeMode`, `famoBadgeSeen`), aucun appel serveur. Test : `test/ui.test.js` (K.badgeView) ; `ux-audit` et `kbd-audit` : 0 écart.
- **Mise à jour du 30/09/2026 (spec 002, `specs/002-identite-vismijn/`)** : identité « Vismijn » — jetons froids AA (`contrast-check`), police Atkinson Hyperlegible Next, marque SVG, timonerie sombre de l'équipe, compteurs neutres, plus de bandes latérales ni de capitales, chiffres clés en bandeau, accueil avec bandeau « marée » (`K.orderWindow`, testé). Détecteur Impeccable 5 → 0 ; `ux-audit` (un écart trouvé et corrigé : lien Privacy 42 px → 44 px) et `kbd-audit` : 0 écart.
