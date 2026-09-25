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

« **FAMO Seafood** » à l'écran ; « **Famo Trading BV** » sur le papier (factures, bons de livraison, e-mails légaux).

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

Toutes les pages du personnel partagent le même squelette :

```
staff-shell
├── staff-sidebar        [data-famo-nav]         barre latérale (desktop)
├── staff-mobile-nav     [data-famo-mobile-nav]  onglets bas (mobile)
└── staff-main
    └── staff-page
        ├── staff-page-head    titre + actions
        └── contenu spécifique
```

La navigation est **générée par `staff-nav.js`**, jamais écrite dans les pages. Trois zones :

- **Dagelijks** — Bestellingen · Magazijn · Leveringen
- **Beheer** — Invoeren · Documenten · Beheer *(admin uniquement)*
- pied — « Klantportaal bekijken ↗ » + identité de session

Le portail client (`/`) et `aanvraag.html` ont **leur propre CSS inline**, sans rapport avec `staff.css`. **C'est un défaut à corriger** : les trois interfaces doivent partager la même peau, seule la densité changeant.

## Composants existants à reprendre

| Classe | Rôle |
|---|---|
| `.staff-action` / `-secondary` / `.staff-ghost` | boutons, trois niveaux |
| `.staff-field` / `.staff-select` | champs |
| `.staff-chip` / `.staff-chips` | filtres avec compteur |
| `.staff-status` | pastille de statut, couleur via `--status` |
| `.staff-empty` / `.staff-error` / `.staff-loading` / `.staff-skeleton` | états de liste |
| `.staff-setup-banner` / `.staff-request-banner` | bandeaux d'alerte |
| `.staff-login-exit` | sorties injectées sous les écrans de connexion |
| `.b-*` (dans `beheer.html`) | onglets, cartes, listes, formulaires, toast |

Les `.b-*` de Beheer sont les plus récents et les plus propres — bonne base de densité pour l'admin, à harmoniser avec le reste.

---

# Contraintes techniques — ne pas casser

1. **HTML + CSS + JS pur.** Pas de framework, pas de build, pas de `package.json`.
2. **Aucune dépendance externe** hors Google Fonts (seule origine tierce autorisée par la CSP). Ni librairie d'icônes, ni CDN de script.
3. **Les icônes sont dans le CSS, pas dans le HTML.** `staff.css` lignes 19-20 et 51 : `.staff-nav-icon.orders::before{content:"□"}` etc. Le HTML est produit par `staff-nav.js` (`linkHtml`). Pour passer en SVG inline, modifier **ces deux fichiers**.
4. **`esc()` obligatoire** sur toute page qui écrit dans `innerHTML` — vérifié automatiquement.
5. **`alert()` / `confirm()` / `prompt()` natifs interdits** — modales et toasts maison.
6. **Cibles tactiles ≥ 44px** partout où le personnel touche avec des gants.
7. **Les `onclick` inline sont partout** et `scripts/check.js` vérifie que chaque fonction appelée existe. Il **ne comprend pas les appels chaînés** : `onclick="a.b()"` est signalé comme fonction manquante → passer par une fonction nommée.
8. **Menu figé** : `PRIMARY` = exactement 3 items dans l'ordre Bestellingen · Magazijn · Leveringen ; `MEER` contient Invoeren **et** Documenten ; `SETUP.label` = `Beheer`. Changer cela impose de mettre à jour `scripts/check.js` dans le même commit.
9. Chaque page staff doit inclure `staff-session.js`, `staff-i18n.js`, `staff-nav.js` et l'attribut `data-famo-nav`. `leveringen`/`entrepot` exigent en plus `staff-delivery.js` ; `documenten` exige `staff-doc-preview.js`.
10. `node scripts/check.js` doit rester vert. `npx --yes eslint@9 api/` aussi (c'est ce que joue la CI).

---

# Ce qui mérite le plus d'attention

Par ordre d'impact réel sur les gens qui s'en servent :

1. **Le catalogue client** — c'est là que la commande se fait ou se perd. Le couple de prix, l'ajout au panier sans ambiguïté.
2. **Magazijn** — utilisé debout, au froid, dans l'urgence. Une seule action évidente à la fois.
3. **Les documents imprimés** (`documents.js`) — bon de livraison et facture. **Seul artefact qui sort de l'écran et finit physiquement chez le client.** Purement fonctionnel aujourd'hui : c'est la vitrine de l'entreprise et elle ressemble à un tableur.
4. **Identité Famo** — il n'y en a aucune : juste un « F » blanc dans un carré noir.

# Ce qu'il ne faut pas faire

- Inventer des produits pour remplir une maquette : le catalogue réel en a **huit**.
- Ajouter des écrans qui n'existent pas côté serveur.
- Introduire du français visible.
- Rendre le stock proéminent : il est volontairement hors menu tant qu'il n'est pas fiable.
- Prétendre avoir vérifié visuellement sans capture : la vérification passe par un audit navigateur (390 / 820 / 1280) sur `node scripts/dev.js`, le code et le calcul des contrastes.
