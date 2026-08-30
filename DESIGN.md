# Brief design — FAMO Portail

Document de référence avant tout travail visuel. Il décrit ce qui existe, ce qui est intouchable, et ce qui attend une vraie direction artistique.

## Le produit en une phrase

Un grossiste en poisson d'Anvers vend à des restaurants : le client commande en ligne, le personnel prépare et livre le lendemain matin, le responsable administre le catalogue et facture.

## Qui regarde quoi

| Interface | Utilisateur réel | Contexte d'usage | Priorité |
|---|---|---|---|
| **Client** (`/`) | Chef ou gérant de restaurant | Le soir, souvent au téléphone, entre deux services. Commande rapide, produits habituels. | Rapidité, lisibilité des prix, confiance |
| **Personnel** | Préparateur, livreur | Tôt le matin, dans le froid, parfois avec des gants, sur téléphone | Grandes cibles tactiles, une action évidente par écran |
| **Administration** | Le responsable | Au bureau, sur ordinateur, tâches ponctuelles | Densité d'information acceptable, formulaires clairs |

Le mobile n'est pas un cas secondaire : le personnel travaille dessus.

## Langue

**Toute l'interface est en néerlandais.** Le code interne (Airtable, variables) est en français ou en anglais — ne jamais laisser fuir ces termes à l'écran.

Règle absolue : l'unité Airtable `caisse` s'affiche **kassa**, jamais « caisse » ni « doos ». La traduction passe par `staff-i18n.js` (`famoNL.unit`, `famoNL.status`, `famoNL.pay`). Un contrôle automatique bloque le déploiement si un libellé français apparaît.

## Système actuel (point de départ, pas une contrainte)

Défini dans `staff.css` :

```
--f-ink:#111111        texte principal
--f-muted:#6b6b6b      texte secondaire
--f-quiet:#989898      labels, méta
--f-line:#e5e5e5       bordures
--f-canvas:#f4f4f4     fond de page
--f-surface:#ffffff    cartes, panneaux
--f-brand:#235e86      accent (bleu)
--f-success:#28734d  --f-warning:#9a6700  --f-danger:#b33a2b
--f-radius:10px
```

Police : Geist, repli système. Chiffres en `Geist Mono` dans les tableaux et totaux.

**Faiblesses assumées du visuel actuel** — c'est précisément ce qui attend un vrai regard :
- Les icônes de navigation sont des caractères Unicode (`□`, `▦`, `✓`) dans `staff-nav-icon::before`. Ça fait bricolé.
- Le bleu `#235e86` est utilisé sans intention particulière ; il n'exprime ni la marée ni le métier.
- Aucun mode sombre.
- La densité varie d'un écran à l'autre : `bestellingen` est dense, `leveringen` est aéré, sans logique.
- Les états vides sont fonctionnels mais ternes.
- Aucune identité visuelle propre à Famo (pas de logo, juste un « F » dans un carré noir).

## Structure des écrans

Toutes les pages du personnel partagent le même squelette :

```
staff-shell
├── staff-sidebar        [data-famo-nav]      barre latérale (desktop)
├── staff-mobile-nav     [data-famo-mobile-nav]  onglets bas (mobile)
└── staff-main
    └── staff-page
        ├── staff-page-head    titre + actions
        └── contenu spécifique
```

La navigation est **générée par `staff-nav.js`**, pas écrite dans chaque page. Modifier le menu = modifier ce fichier uniquement.

Trois zones dans la barre latérale :
- **Dagelijks** — Bestellingen, Magazijn, Leveringen
- **Beheer** — Invoeren, Documenten, Beheer *(admin seulement)*
- pied — « Klantportaal bekijken ↗ » + identité de session

Le portail client (`/`) et la page de demande (`/aanvraag.html`) ont leur propre mise en page, indépendante de `staff.css`.

## Composants réutilisables

| Classe | Rôle |
|---|---|
| `.staff-action` / `.staff-action-secondary` / `.staff-ghost` | boutons, trois niveaux |
| `.staff-field` / `.staff-select` | champs de saisie |
| `.staff-chip` / `.staff-chips` | filtres rapides avec compteur |
| `.staff-status` | pastille de statut, couleur via `--status` |
| `.staff-empty` / `.staff-error` / `.staff-loading` | états de liste |
| `.staff-skeleton` | chargement |
| `.staff-setup-banner` / `.staff-request-banner` | bandeaux d'alerte en haut de page |
| `.staff-viewtabs` | onglets internes |

`beheer.html` définit en plus ses propres `.b-*` (onglets, cartes, listes, formulaires, toast). À harmoniser avec le reste lors du travail de design.

## Contraintes techniques à ne pas casser

1. **Pas de framework, pas de build.** HTML statique + JavaScript inline. Le CSS est un seul fichier, `staff.css`.
2. **Pas de dépendance externe.** Aucun CDN de police ou d'icônes : le site doit fonctionner sans requête tierce.
3. **Les `onclick` inline sont partout.** Une refonte qui les supprimerait casserait `scripts/check.js`, qui vérifie que chaque fonction appelée existe. Si vous les retirez, mettez à jour le contrôle.
4. **`esc()` est obligatoire.** Toute page qui écrit dans `innerHTML` doit définir une fonction d'échappement — c'est vérifié automatiquement.
5. **Pas de `alert()`, `confirm()`, `prompt()` natifs.** Utiliser les modales et toasts maison. Vérifié automatiquement.
6. **Cibles tactiles ≥ 44 px** sur tout ce que le personnel touche avec des gants.
7. `node scripts/check.js` doit rester vert.

## Ce qui mérite le plus d'attention

Par ordre d'impact réel sur les gens qui s'en servent :

1. **Le catalogue client** — c'est là que la commande se fait ou se perd. Lisibilité des prix négociés vs prix de base, ajout au panier sans ambiguïté.
2. **Magazijn (préparation)** — utilisé debout, au froid, dans l'urgence. Une seule action évidente à la fois.
3. **Les documents imprimés** (`documents.js`) — bon de livraison et facture. Ils sortent de l'écran et finissent chez le client : c'est la vitrine de l'entreprise. Le gabarit actuel est purement fonctionnel.
4. **Identité Famo** — il n'y en a aucune aujourd'hui. Poisson, Anvers, fraîcheur, métier de nuit : il y a matière.

## Ce qu'il ne faut pas faire

- Inventer des données pour remplir une maquette : le catalogue réel a huit produits, pas quarante.
- Ajouter des écrans qui n'existent pas côté serveur.
- Introduire du français visible.
- Rendre le stock proéminent : il est volontairement hors menu tant qu'il n'est pas fiable.
