# FAMO Portail

Portail B2B de Famo Trading : le client commande en ligne, le personnel prépare et livre, le responsable administre. Site statique + fonctions serverless Vercel, données dans Airtable.

## Les trois interfaces

| Interface | Pages | Accès |
|---|---|---|
| **Client** | `/` (catalogue, panier, historique), `/aanvraag.html` (demande d'accès) | identifiant + mot de passe client |
| **Personnel** — *Dagelijks* | `/bestellingen.html`, `/entrepot.html`, `/leveringen.html`, `/order.html` | `STAFF_CODE` ou `ADMIN_CODE` |
| **Administration** — *Beheer* | `/beheer.html`, `/invoer.html`, `/documenten.html` | `ADMIN_CODE` uniquement |

Chaque page du personnel porte le lien **« Klantportaal bekijken ↗ »** vers le portail client. La restriction admin n'est pas seulement visuelle : `api/onboarding.js`, `api/staff.js` et `api/stock.js` refusent une session personnel (`adminOk`).

Redirections conservées : `/overzicht.html` → Bestellingen, `/dagprep.html` → Magazijn (vue jour), `/aan-de-slag.html` → Beheer.

Hors menu : `/stock.html` reste accessible par URL directe mais n'est plus proposé — le stock Airtable n'est pas compté et aucune transition ne le déduit (voir « Politique de stock »).

## Le parcours d'une commande

1. Le client commande. **Le serveur relit le catalogue et recalcule le prix** : le navigateur ne décide jamais du montant (`api/order.js`).
2. Le personnel prépare : validation article par article dans Magazijn, ou raccourci **Snel voorbereiden** depuis la fiche commande.
3. Départ en livraison. La commande est alors **verrouillée** : lignes et total ne sont plus modifiables (verrou basé sur le statut, pas sur le stock).
4. Réception confirmée dans **Leveringen** — le nom du réceptionnaire est obligatoire.
5. Le numéro de facture est attribué une seule fois, au format `FA-2026-0001`.

Le total est recalculé côté serveur à chaque modification de lignes (`api/updateorder.js`), jamais accepté tel quel depuis le navigateur.

Les produits au kilo acceptent les décimales (`0,5 kg`). Les autres unités restent entières. L'unité Airtable `caisse` s'affiche **kassa** — jamais le mot français à l'écran (`staff-i18n.js`).

## Politique de stock

Le stock Airtable n'est pas fiable tant qu'un inventaire réel n'a pas été fait. En conséquence : **aucune transition ne déduit le stock** (`skipStock`), et Voorraad est retiré du menu. Une seule règle, partout — c'est volontaire, pas un oubli.

Pour réactiver : compter physiquement, remplir la table `Stock`, retirer `skipStock` de `entrepot.html` et `order.html`, remettre Voorraad dans `staff-nav.js`.

## Administration (`/beheer.html`)

Tout se règle ici, sans passer par Airtable :

- **Overzicht** — compteurs et alertes actionnables
- **Aanvragen** — demandes du site public ; « Klant aanmaken » pré-remplit et clôture la demande
- **Klanten** — création, édition, identifiants (affichés une seule fois, bouton copier)
- **Producten** — catalogue, prix de base, unité, catégorie, retrait
- **Prijzen** — prix négociés par client
- **Bedrijfsgegevens** — identité, IBAN/BIC, **taux de TVA**, conditions de paiement et de livraison

Le taux de TVA et les mentions légales des documents viennent de ces réglages : rien n'est codé en dur dans `documents.js`.

## Variables d'environnement (Vercel)

```text
AIRTABLE_TOKEN=...
ADMIN_CODE=...
STAFF_CODE=...
```

Sans `ADMIN_CODE` ni `STAFF_CODE`, le login est **refusé** (fail-closed, aucun code de secours). `ADMIN_CODE` donne l'accès complet ; `STAFF_CODE` limite au travail quotidien. Les deux peuvent être identiques au démarrage.

Après modification d'une variable : **Redeploy**.

## Contrôles avant publication

```bash
node scripts/check.js
```

Vérifie la syntaxe, les fonctions appelées depuis le HTML, l'échappement XSS, la navigation, et les règles métier critiques : prix serveur, verrou après départ, réceptionnaire obligatoire, numéro de facture unique, séparation des rôles. GitHub Actions rejoue le même contrôle à chaque push sur `main`.

## Limites connues

- Les mots de passe clients sont stockés en clair dans Airtable et transitent à chaque appel. À remplacer par des hachages et une vraie session serveur.
- Un seul code par rôle : pas d'identité individuelle ni de révocation ciblée.
- Aucun envoi d'email automatique — identifiants et documents se transmettent à la main.
- Les factures sont des **documents internes**. L'émission légale B2B belge (Peppol) doit passer par le prestataire comptable.
- La preuve de livraison accepte un lien HTTPS ; aucun fichier n'est stocké.
- La numérotation de facture est séquentielle mais pas atomique : deux facturations simultanées pourraient entrer en conflit.
