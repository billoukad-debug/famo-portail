# Brief design — FAMO Portail

Document de référence pour tout travail visuel. À lire **entièrement** avant de toucher une ligne de CSS.

## Le produit en une phrase

Un grossiste en poisson d'Anvers vend à des restaurants : le client commande en ligne, le personnel prépare et livre le lendemain matin, le responsable administre le catalogue et facture.

## Qui regarde quoi

| Interface | Utilisateur réel | Contexte d'usage | Priorité |
|---|---|---|---|
| **Client** (`/`) | Chef ou gérant de restaurant | Le soir, souvent au téléphone, entre deux services | Rapidité, lisibilité des prix, confiance |
| **Personnel** | Préparateur, livreur | 5 h du matin, dans le froid, avec des gants, sur téléphone bon marché, écran parfois humide | Grandes cibles, une action évidente par écran |
| **Administration** | Le responsable | Au bureau, sur ordinateur | Densité acceptable, formulaires clairs |

Le mobile n'est pas un cas secondaire : le personnel travaille dessus.

## Langue

**L'interface du personnel et de Beheer est en néerlandais** ; le portail client est en NL et FR (`K.t()`, `K.FR`). Le code interne (Airtable, variables) est en français ou en anglais — ne jamais laisser fuir ces termes à l'écran.

Règle absolue : l'unité Airtable `caisse` s'affiche **kassa**, jamais « caisse » ni « doos ». La traduction passe par `famoNL` dans `assets/ui.js` (`famoNL.unit`, `famoNL.status`, `famoNL.pay`). `scripts/check.js` échoue (et la CI passe au rouge) si `caisse` est écrit tel quel dans une page (`>caisse<` ou `"caisse" +`) ; ce contrôle est étroit et ne détecte pas les autres libellés français. La CI ne bloque pas à elle seule le déploiement Vercel.

---

# Le système : Vismijn (30/09/2026, spec 002)

Remplace « Crème » (sept. 2026), qui cumulait les défauts des interfaces générées : fond crème chaud, cartes identiques partout, bleu pastel générique, lettre « F » dans un carré, trio de chiffres sur l'accueil, en-têtes en majuscules, bande colorée sur le côté (sources : skill `frontend-design` d'Anthropic, détecteur Impeccable ; voir `specs/002-identite-vismijn/`).

**Le monde du produit** : la criée (vismijn), la glace, l'inox, la mer du Nord à 5 h du matin, les caisses, la bouée. **Une seule audace** : la « timonerie » bleu-noir de l'équipe (barre latérale). La marque est un F sobre. Tout le reste est calme.

Tout vit dans **`assets/ui.css`** (feuille unique) ; les pages consomment les classes et variables. Les noms de variables (`--p`, `--ink`, `--line`, `st-*`…) sont figés : changer une valeur re-habille tout le portail sans toucher au JS.

## Jetons (`:root` de `assets/ui.css`)

```css
--canvas:  #EFF3F3   /* IJs : fond froid, jamais crème */
--soft:    #E4EBEB   /* Kaai : deuxième surface, survol */
--card:    #FFFFFF   /* ce qui contient */
--ink:     #0E2229   /* Diepzee : texte */
--ink-2:   #475A61   --ink-3: #56686E
--line:    #D3DDDF   --line-soft: #E3EAEB   --line-strong: #AAB8BB   --line-input: #788A8F
--p:       #0B5A6C   /* Noordzee : TOUTE action (bouton principal, lien, onglet actif, sélection) */
--p-deep:  #084453   --p-soft: #DDEBEE
--deep:    #0E2229   /* timonerie : barre latérale de l'équipe, connexion équipe */
--deep-ink:#C9D8DB   --deep-ink-2: #90A7AD
--klei:    #B2431A   /* « uw prijs » et favori actif */
```

Statuts : chaque couleur = un état défini (Ontvangen ambre, Klaar Noordzee, Onderweg bleu, Geleverd vert, Gefactureerd gris, retard/erreur rouge). Pastilles de la navigation : neutres (Noordzee ; blanches dans la timonerie) — le rouge est réservé à l'erreur et au retard. Tous les couples texte/fond passent AA (`node scripts/contrast-check.js`).

## Typographie

**Atkinson Hyperlegible Next** (OFL, hébergée dans `assets/fonts/`), une seule famille. Dessinée par le Braille Institute pour que chaque caractère se distingue (1/l/I, 0/O, 5/S) : c'est la raison du choix, pas la mode — l'équipe lit des références et des poids dans le froid, avec des gants. Conséquence assumée : **le zéro est barré** (pas de variante sans barre dans la police). Titres 700, léger tracking négatif ; corps 14,5 px ; chiffres tabulaires dans les colonnes de nombres seulement. Casse normale partout : aucun libellé en capitales.

## Formes

Rayons hiérarchisés : **6** ce qu'on touche (boutons, champs), **10** ce qui contient (cartes, groupes), **14** ce qui flotte (dialogues, recherche, aperçu de document). Ombres seulement sur ce qui flotte ; au survol une carte renforce son contour, elle ne « décolle » pas. Aucune bande colorée sur le côté d'un bloc. Chiffres clés de Beheer : un bandeau unique, pas quatre cartes.

## Marque

`assets/brand/famo-mark.svg` (fond clair : carré Noordzee, F blanc) et `famo-mark-light.svg` (timonerie : carré clair, F Diepzee) : un **F sobre**, dessiné en tracés (pas une lettre de police), coins arrondis 7/32. Choix du client le 30/09/2026 (le poisson de la spec 002 est retiré, spec 007). Utilisée par `.logo` (CSS), le favicon, les icônes PWA (`assets/icons/`) et l'en-tête des documents (`documents.js`). Le nom « FAMO Seafood » est écrit à côté.

## Accueil client

Titre « Vóór 22:00 besteld, morgen in uw keuken. » (heure limite lue dans la configuration), texte de service, formulaire de connexion. Pas de minuteur (retiré à la demande du client, spec 007), pas de trio de chiffres, pas de slogan.

## Nom

« **FAMO Seafood** » partout : écran, documents, e-mails. Le nom imprimé sur les documents et dans les e-mails vient de Beheer → Bedrijfsgegevens (`Bedrijfsnaam`). Nom juridique : **Famo Trading BV** (BCE 0788.705.713) ; nom commercial : **FAMO Seafood**. Si la société légale doit figurer sur un document, on l'écrit dans ce même champ, par exemple « FAMO Seafood (Famo Trading BV) ». La facture légale n'est pas produite par le portail (comptable, Billtobox). On ne l'écrit jamais en dur dans le code.

## Appareils

- **Client** : téléphone et ordinateur ont la même importance. ≥ 1024px : onglets en haut, catalogue en grille, barre panier pleine largeur en bas. Les lignes produit affichent la photo (`Foto`, envoyée depuis Beheer) au dépliage, une vignette neutre sinon.
- **Personnel** : tablette au magasin (820), téléphone en tournée (390), ordinateur au bureau (1280). Barre latérale 240px → rail 88px (≤ 1180px) → bandeau horizontal (≤ 720px). Cibles ≥ 44px, y compris les cases à cocher (zone 44px, case visible 22px).
- **Bestellingen** : un appui sur une commande la déplie, un second ouvre sa page.

## Le geste signature : het prijzenpaar

Prix négocié grand et serré, prix public petit et barré, « uw prijs » en **klei** comme annotation. N'apparaît nulle part ailleurs ; sans prix négocié, l'espace reste vide.

## Amendement

**Répétition de l'accent sur les boards et listes** : « une seule action accent par écran » se lit « un seul *type* d'action accent » — le même bouton bleu peut se répéter sur chaque carte.

---

# Structure des écrans

Chaque page HTML charge `assets/ui.css`, `assets/ui.js` puis son script `assets/pages/<page>.js`, qui dessine tout dans `#app`. La coque du personnel et de Beheer est produite par **`K.shell()`** (`assets/ui.js`) : barre latérale `.side` (desktop), rail (≤ 1180 px), bandeau (≤ 720 px), `.topbar`, onglets mobiles `.mtabs`.

Menu (figé par les tests, section I de `scripts/workflow-check.js`) :

- **Dagelijks** : Bestellingen · Magazijn · Leveringen (`NAV_DAILY`)
- **Meer** (personnel) : Invoeren · Documenten (`NAV_STAFF_MORE`) ; **Beheer** (beheerder) : Invoeren · Documenten · Beheer (`NAV_ADMIN`)
- **Voorraad** pour tous ; pied : Klantportaal, nom de la personne connectée, Uitloggen. Systeemstatus : beheerder seulement.

Le portail client (`klant.js`) a sa propre coque (onglets en bas sur téléphone, en haut ≥ 1024 px) mais la même feuille de style.

## Composants

| Élément | Où |
|---|---|
| Boutons `.btn` + `.btn-p` / `.btn-o` / `.btn-ghost` / `.btn-danger`, taille `.btn-sm` | `ui.css`, `K.c.btn` |
| Champs `.field` / `.input`, erreurs `K.setErr` | `K.c.field`, `K.c.input` |
| Statuts `.chip.st-*` (pastille) et `.cell-st.c-*` (cellule) | `K.stChip`, `K.stCell` |
| Cartes `.card` (`.card-h`, `.card-b`), groupes `.grp`, tableaux `.tbl` | pages |
| Bandeaux `.notice` (err / warn / ok), états vides `.state`, squelettes `.sk` | `K.c.error/warn/ok/empty/skeleton` |
| Toast, dialogue, panneau latéral | `K.toast`, `K.confirm`, `K.prompt`, `K.panel` |
| Icônes : SVG en ligne, trait 1,7, `currentColor` | `K.icon(name)` |
| Tijdlijn `.tl`, stepper `.stepper`, cases `.check`, barre d'actions `.bulk`, barre panier `.cartbar` | `ui.css` |

---

# Contraintes techniques — ne pas casser

1. **HTML + CSS + JS pur.** Pas de framework, pas de build, pas de `package.json`. Une seule feuille : `assets/ui.css`.
2. **Aucune dépendance chargée depuis l'extérieur** hors Google Fonts (seule origine tierce autorisée par la CSP de `vercel.json`). Ni librairie d'icônes, ni CDN de script. Exception locale : `vendor/html2pdf.bundle.min.js` (≈ 900 Ko, copie dans le dépôt, PDF des documents).
3. **Garder les noms de classes et de variables** : le balisage est produit par le JavaScript. Changer l'apparence = changer les valeurs dans `ui.css`.
4. **`K.esc()` obligatoire** sur tout texte écrit dans `innerHTML`.
5. **`alert()` / `confirm()` / `prompt()` natifs interdits** : `K.toast`, `K.confirm`, `K.prompt`, `K.panel`.
6. **Cibles tactiles ≥ 44 px** partout où le personnel appuie (`--tap`).
7. **Portail client bilingue** : tout texte visible passe par `K.t()` et a sa traduction dans `K.FR` (`assets/ui.js`) ; un test échoue sinon. Personnel, Beheer et e-mails restent en néerlandais ; les documents suivent la langue du client (NL/FR).
8. **Documents** (`documents.js`) et **e-mails** (`lib/ordermail.js`) ont leur CSS en ligne ; ils reprennent les valeurs des jetons Vismijn (encre `#0E2229`, filet `#D3DDDF`, fond `#EFF3F3`, action `#0B5A6C`) ; police système (Arial dans les e-mails, Helvetica dans les PDF) : les polices web y sont peu fiables. Pas de ligne de signature sur les documents.
9. `node scripts/check.js` et `npx -y eslint@9.39.5 .` (tout le dépôt) doivent rester verts ; la CI joue les deux, plus `scripts/ux-audit.js` dans un navigateur.

---

# Reste à faire côté design

1. **Personnel à 5 h du matin** : une variante très contrastée (fond sombre, texte clair, cibles plus grandes) pour Magazijn et Leveringen, activable sur l'appareil.
2. **Documents A4** : couleurs alignées sur Crème, mais la mise en page n'a pas été redessinée. C'est l'objet qui arrive physiquement chez le client.
3. **E-mails** : couleurs alignées, gabarit à retravailler (en-tête, pied, mode sombre de Gmail et d'Outlook).
4. **Logo** : le F sobre (spec 007) sert de marque, favicon, icône d'app et en-tête de document. Reste à décider : un mot-symbole « FAMO Seafood » dessiné, ou le nom en texte comme aujourd'hui.
5. **Styles en ligne** : 264 `style="` dans le JavaScript des pages au 01/10/2026 (234 déjà migrés vers les utilitaires I-12 de `ui.css`), une quinzaine dans les pages HTML et le bloc `<style>` de `klant.html` : à déplacer dans `ui.css`.
6. **Design system sur claude.ai** (« FAMO Portail Design System ») : il porte encore « Famo Trading » et les valeurs d'avant Crème. À resynchroniser sur ce dépôt.

# Ce qu'il ne faut pas faire

- Inventer des produits pour remplir une maquette : le catalogue est petit (quelques produits actifs ; données fictives jusqu'au 27/09/2026, à vérifier dans Beheer → Producten).
- Ajouter des écrans qui n'existent pas côté serveur.
- Introduire du français visible chez le personnel ou dans Beheer.
- Des dégradés, des cartes à bordure gauche colorée, des emojis, des pilules de 44 px comme boutons.
- Prétendre avoir vérifié visuellement sans capture : la vérification passe par un audit navigateur (390 / 820 / 1280) sur `node scripts/dev.js`, le code et le calcul des contrastes.
