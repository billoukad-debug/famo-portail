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

# Le système : synthèse Notion × Revolut

Les deux références disent la même chose sous deux costumes. Ce qu'on en garde :

**De Notion** — canvas chaud jamais blanc pur · cartes blanches posées dessus · hiérarchie par l'alpha d'une **seule** encre · filets 1px **au lieu d'ombres** · 12px cartes / 8px boutons / pilules réservées aux étiquettes · un seul accent pour l'action principale · aplats stricts, zéro dégradé.

**De Revolut** — **graisse plafonnée à 500** au-dessus de 20px : l'autorité vient de la taille et du tracking, pas du gras · titres de section en **gris**, pas en encre, pour un rythme éditorial calme · tracking négatif croissant avec la taille · séparation par filet et changement de surface, jamais par élévation.

## Jetons

```css
--f-canvas:      #FAF6F0   /* crème chaud — JAMAIS de blanc pur en fond */
--f-panel:       #F2ECE3   /* deuxième surface : barres, en-têtes de tableau */
--f-surface:     #FFFFFF   /* uniquement ce qui doit flotter */
--f-ink:         #191512   /* une seule encre, déclinée par alpha */
--f-hairline:    #E5DDD3   /* filet 1px */
--f-accent:      #0C6157   /* action unique, lien, état actif */
--f-accent-2:    #084A42   /* survol / pressé */
--f-accent-wash: #E0EDE8   /* fond d'un état sélectionné */
--f-gold:        #A87D1B   /* favori actif, et rien d'autre — 3,47:1 sur canvas (#C79A2F tombait à 2,41:1) */
--f-danger:      #A8371F   /* erreur, suppression */
--f-warning-wash:#FBF3DF   /* fond de bandeau d'avertissement — texte #6B4E0B dessus : 6,9:1 */
--f-warning-line:#E7D6A9   /* filet assorti au lavis d'avertissement */
--f-success-wash:#E6F0E9   /* fond d'état de succès — texte #1F6D4E dessus : 5,2:1 */
--f-success-line:#C6DCCB   /* filet assorti au lavis de succès */
```

Les quatre lavis d'état sont déclarés une seule fois dans le `:root` de `staff.css` ; `beheer.html` les consomme avec des replis (`var(--f-warning-wash, #FBF3DF)`).

**Hiérarchie de l'encre** : 100 % titres · 70 % corps · **58 %** titres de section · 28 % inactif.

### Contrastes — calculés, pas estimés

| Usage | Ratio sur `#FAF6F0` | Verdict |
|---|---|---|
| Corps, encre 70 % | **6,4:1** | ✅ |
| Accent `#0C6157` | **6,8:1** | ✅ |
| Encre 45 % | **2,9:1** | ❌ échoue AA — d'où le 58 % |
| Canvas vs panel | **1,09:1** | ⚠️ 9 % d'écart seulement |

Ces deux dernières lignes sont la raison d'une règle non négociable : **sur les écrans du personnel, garder un filet 1px en plus de la teinte.** Un écart de 9 % est élégant sur un écran calibré et invisible à 5 h du matin sur un téléphone humide. Client et admin peuvent se contenter de la teinte.

Toute couleur ajoutée doit avoir son ratio **calculé et noté**. Pas d'appréciation à l'œil.

## Typographie

**Aucune webfont** — la CSP et l'absence de dépendances l'interdisent. On se sert de ce qui est déjà sur toutes les machines.

- **Serif système** `Georgia, "Iowan Old Style", serif` — **uniquement au-dessus de 22px**. Un seul moment par écran : le nom du client, le titre de page, le montant du total.
- **Sans système** en dessous de 18px pour tout le fonctionnel. Jamais l'inverse.
- **Graisse ≤ 500** partout au-dessus de 20px.
- **Tracking** négatif croissant avec la taille (≈ −0.024em à 88px, −0.010em à 24px). Seule exception positive : +0.015em sur les micro-libellés en capitales à 12px.
- **Chiffres** en sans avec `tabular-nums` — gros et serrés, jamais en mono.
- **Mono** réservé aux seules références (`CMD-2026-0147`).

## Formes

12px sur les cartes, 8px sur les contrôles. **Pas de pilules sur ce qui s'actionne** : une pilule de 46px a des zones mortes dans les coins et se confond avec sa voisine quand on porte des gants. Pilule réservée aux étiquettes (statuts, filtres).

La forme dit alors quelque chose : **arrondi = information, angle = action**.

Zéro ombre sur le contenu. Ombre uniquement pour une vraie élévation (panier mobile, dialogue), et teintée chaud `rgba(60,45,30,.10)` — jamais un gris neutre.

## Le geste signature : het prijzenpaar

Le couple prix négocié / prix public barré est l'objet le plus chargé de tout le portail : c'est la relation commerciale rendue visible. Il doit devenir **le moment typographique de l'écran** — chiffre grand et serré, prix public petit et barré au-dessus, « uw prijs » traité comme une annotation et non comme une étiquette.

Ce dispositif n'apparaît **nulle part ailleurs**. Sur un produit sans prix négocié, l'espace reste vide — ce qui le rend plus fort quand il apparaît.

## Amendements de charte — décidés, ne pas « corriger » dans l'autre sens

1. **Répétition de l'accent sur les boards et listes.** La règle « une seule action accent par écran » se lit : **un seul *type* d'action accent par écran**. Sur un board ou une liste, le même type d'action accent peut se répéter sur chaque carte (p. ex. « Bevestigen » sur chaque commande) — c'est une seule action, multipliée par les cartes, pas plusieurs actions concurrentes.
2. **L'annotation « uw prijs » du prijzenpaar** reste en **Georgia italique 12px**, sous le seuil des 22px réservé au serif. Exception signature assumée : c'est le seul endroit du portail où le serif descend sous le seuil, précisément parce que le prijzenpaar est le moment typographique de l'écran.

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
2. **Aucune dépendance externe.** Ni CDN de police, ni librairie d'icônes, rien qui parte vers un autre serveur.
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
- Prétendre avoir vérifié visuellement : **les outils navigateur ne sont pas disponibles**. La vérification passe par le code, les appels API et le calcul des contrastes.
