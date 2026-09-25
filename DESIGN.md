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

**Toute l'interface est en néerlandais.** Le code interne (Airtable, variables) est en français ou en anglais — ne jamais laisser fuir ces termes à l'écran.

Règle absolue : l'unité Airtable `caisse` s'affiche **kassa**, jamais « caisse » ni « doos ». La traduction passe par `staff-i18n.js` (`famoNL.unit`, `famoNL.status`, `famoNL.pay`). Un contrôle automatique bloque le déploiement si un libellé français apparaît.

---

# Le système : Crème (sept. 2026)

Grammaire Airbnb DESIGN.md, radius Anthropic/Claude, une seule nuance d'action : un **bleu chaud pastel**. Tout vit dans **`assets/ui.css`** (feuille unique) ; les pages ne font que consommer les classes et variables. Les noms de variables (`--p`, `--ink`, `--line`, `st-*`…) sont figés : changer une valeur re-habille tout le portail sans toucher au JS.

## Jetons (`:root` de `assets/ui.css`)

```css
--canvas:  #FAF9F5   /* fond crème — jamais de blanc pur en fond */
--soft:    #F1EFE8   /* deuxième surface : totaux, lignes en creux */
--card:    #FFFFFF   /* cartes posées sur le canvas */
--ink:     #232323   /* texte uniquement — jamais un bouton noir */
--ink-2:   #6A6A6A   /* corps secondaire */
--ink-3:   #737169   /* méta, libellés discrets */
--line:    #E3E0D6   --line-soft: #EDEBE4   --line-strong: #C7C3B7
--p:       #4876A2   /* TOUTE action : bouton principal, lien, onglet actif, sélection */
--p-deep:  #3F6690   /* survol / pressé */
--p-soft:  #E4EDF5   /* fond d'un état sélectionné */
--klei:    #AD5830   /* « uw prijs » et favori actif, rien d'autre */
```

Statuts (fond doux + point, rayon 6px, même famille que `.chip`) : Nieuw `#B7841A`/`#F5EEDC` · Klaar = bleu · Onderweg `#2E4F70`/`#E1E7EE` · Geleverd `#5F7A48`/`#E8EEE0` · Gefactureerd `#8A8883` · Fout `#B8432E`/`#F7E6E1`.

## Typographie

**Plus Jakarta Sans** (Google Fonts, 400/500/600/700 — autorisée par la CSP de `vercel.json`), repli système. Titres 600 avec tracking négatif (−0.03em sur les grands titres). Chiffres en `tabular-nums`. Mono réservé aux références (`CMD-2026-0147`).

## Formes

Rayons **4 / 6 / 8 / 12** (`--r-xs`, `--r-sm`, `--r`, `--r-lg`) : 8px contrôles, 12px cartes et panneaux. **Aucune pilule sur ce qui s'actionne.** Ombres douces à plusieurs couches (`--shadow`, `--lift`) seulement pour ce qui flotte (login, panier, dialogue).

## Nom

« **FAMO Seafood** » partout : écran, documents, e-mails. Le nom imprimé sur les documents et dans les e-mails vient de Beheer → Bedrijfsgegevens (`Bedrijfsnaam`). Si la société légale doit figurer sur la facture, on l'écrit dans ce même champ, par exemple « FAMO Seafood (Famo Trading BV) ». On ne l'écrit jamais en dur dans le code.

## Appareils

- **Client** : téléphone et ordinateur ont la même importance. ≥ 1024px : onglets en haut, catalogue en grille, barre panier pleine largeur en bas. Les cartes produit réservent une vignette (photo à venir).
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
2. **Aucune dépendance externe** hors Google Fonts (seule origine tierce autorisée par la CSP de `vercel.json`). Ni librairie d'icônes, ni CDN de script.
3. **Garder les noms de classes et de variables** : le balisage est produit par le JavaScript. Changer l'apparence = changer les valeurs dans `ui.css`.
4. **`K.esc()` obligatoire** sur tout texte écrit dans `innerHTML`.
5. **`alert()` / `confirm()` / `prompt()` natifs interdits** : `K.toast`, `K.confirm`, `K.prompt`, `K.panel`.
6. **Cibles tactiles ≥ 44 px** partout où le personnel appuie (`--tap`).
7. **Portail client bilingue** : tout texte visible passe par `K.t()` et a sa traduction dans `K.FR` (`assets/ui.js`) ; un test échoue sinon. Personnel, Beheer, documents et e-mails restent en néerlandais.
8. **Documents** (`documents.js`) et **e-mails** (`lib/ordermail.js`) ont leur CSS en ligne ; ils reprennent les valeurs des jetons Crème (encre `#232323`, filet `#E3E0D6`, fond `#FAF9F5`, bleu `#4876A2`). Pas de ligne de signature sur les documents.
9. `node scripts/check.js` et `npx eslint@9 api/` doivent rester verts (la CI joue les deux).

---

# Reste à faire côté design

1. **Personnel à 5 h du matin** : une variante très contrastée (fond sombre, texte clair, cibles plus grandes) pour Magazijn et Leveringen, activable sur l'appareil.
2. **Documents A4** : couleurs alignées sur Crème, mais la mise en page n'a pas été redessinée. C'est l'objet qui arrive physiquement chez le client.
3. **E-mails** : couleurs alignées, gabarit à retravailler (en-tête, pied, mode sombre de Gmail et d'Outlook).
4. **Logo** : le monogramme « F-houle » bleu sert de favicon, de tuile et d'en-tête de document. Il reste à valider comme logo, avec un mot-symbole « FAMO Seafood ».
5. **Styles en ligne** encore présents dans `index.html` et `klant.html` : à déplacer dans `ui.css`.
6. **Design system sur claude.ai** (« FAMO Portail Design System ») : il porte encore « Famo Trading » et les valeurs d'avant Crème. À resynchroniser sur ce dépôt.

# Ce qu'il ne faut pas faire

- Inventer des produits pour remplir une maquette : le catalogue réel compte **4 produits actifs**.
- Ajouter des écrans qui n'existent pas côté serveur.
- Introduire du français visible chez le personnel ou dans Beheer.
- Des dégradés, des cartes à bordure gauche colorée, des emojis, des pilules de 44 px comme boutons.
- Prétendre avoir vérifié visuellement sans capture : la vérification passe par un audit navigateur (390 / 820 / 1280) sur `node scripts/dev.js`, le code et le calcul des contrastes.
