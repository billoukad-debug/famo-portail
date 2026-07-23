# FAMO Portail

Portail B2B FAMO pour la prise de commande, la préparation magasin, le stock et le suivi jusqu’à la facture.

## Parcours opérationnel

1. Le client ou un membre de l’équipe encode une commande. Le serveur relit le catalogue Airtable et recalcule les prix : le navigateur ne décide jamais du prix final.
2. Au magasin, chaque article est validé séparément et la quantité réellement préparée est saisie. Cette validation est nécessaire avant le départ.
3. Au départ en livraison, le stock est contrôlé et déduit. Une ligne de journal est créée par produit avec quantité avant/après.
4. À la réception, le magasin enregistre la personne qui a réceptionné la commande et peut joindre un lien HTTPS vers la photo ou signature de preuve. La facture est ensuite numérotée.
5. Les corrections de stock demandent un type de mouvement et une raison/référence, et sont journalisées.

Les produits vendus au kilo acceptent des quantités décimales (par exemple `0,5 kg`). Les unités Airtable `caisse` restent en quantités entières et s’affichent **kassa** dans l’interface (jamais le mot français « caisse » à l’écran).

## Parcours staff (UI)

Navigation quotidienne (≤ 4 destinations + Meer) :

| Destination | Page | Rôle |
|---|---|---|
| **Bestellingen** | `/bestellingen.html` | Accueil opérationnel (liste, chips, attention) |
| **Magazijn** | `/entrepot.html` | Board kanban (**Bord**) + vue journée (**Dag** via `?view=dag`) |
| **Invoeren** | `/invoer.html` | Saisie manuelle téléphone / WhatsApp |
| **Leveringen** | `/leveringen.html` | File livreur : Maps + confirmation réception |
| Meer → Voorraad | `/stock.html` | Inventaire et seuils |
| Meer → Documenten | `/documenten.html` | LB / facture / creditnota (`?order=` & `?type=lb\|facture\|credit`) |
| Setup (hors nav) | `/aan-de-slag.html` | Onboarding — lien footer seulement |

Deep-link (pas une entrée de menu) : `/order.html?id=…`.

Redirects conservés :

- `/overzicht.html` → `/bestellingen.html`
- `/dagprep.html` → `/entrepot.html?view=dag`

Shell unique : `staff-shell` + `data-famo-nav` (`staff-nav.js`) + design tokens `staff.css`. Login unique via `staff-session.js` (`bindLogin` / `.staff-login`). Confirmation de livraison partagée : `staff-delivery.js` (`famoStaff.openDeliveryConfirm`).

Documents staff (LB, facture, creditnota, picking) : aperçu in-app via `staff-doc-preview.js` (fermer / imprimer / télécharger un vrai PDF). Aucun `window.open` pour l’export côté pages staff.

Le portail client `/` est hors scope du redesign staff.

Auth staff : cookie de session HttpOnly (`POST /api/session`), durée 8 h. Le code personnel ne doit plus apparaître dans les URL ni dans le stockage navigateur.

## Données Airtable utilisées

- `Clients`, `Catalogue`, `Prix négociés`, `Commandes`, `Stock`;
- `Mouvements de stock` pour les entrées, retours, corrections et sorties;
- dans `Commandes` : préparation validée, dates de préparation/livraison/facture, confirmation de réception, réceptionnaire et preuve de livraison.

## Développement et contrôles

Les fonctions Vercel lisent les variables d’environnement suivantes :

```text
AIRTABLE_TOKEN=...
STAFF_CODE=...
```

Si `STAFF_CODE` est absent, un **fallback temporaire** `famo2026` est utilisé (demande produit). Préférez quand même définir `STAFF_CODE` dans Vercel dès que possible.

Exécuter les contrôles avant publication :

```bash
node scripts/check.js
```

Ils vérifient la syntaxe des API et des scripts HTML, les fonctions appelées depuis le HTML, la nav staff (4 + Meer, redirects, pas de warehouse-sidebar), et les règles métier critiques : prix serveur, validation de préparation et confirmation de réception. GitHub Actions exécute le même contrôle à chaque push sur `main`.

## Limites à raccorder avant exploitation comptable complète

- La facture générée par le portail est un document interne. L’envoi légal B2B via Peppol doit être relié au prestataire comptable choisi (par exemple Billtobox).
- La preuve de livraison accepte aujourd’hui un lien HTTPS vers une photo ou une signature. Un dépôt direct de fichiers nécessite de choisir et connecter un stockage (Vercel Blob, Drive ou équivalent).
- La numérotation actuelle est séquentielle pour un usage normal. La garantie atomique multi-utilisateur doit être fournie par le système comptable/Peppol avant d’émettre des factures légales en parallèle.

Les factures historiques ne sont pas automatiquement complétées avec une preuve de livraison fictive : elles restent traçables comme données antérieures au nouveau processus.
