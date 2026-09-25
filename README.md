# FAMO Portail — v2

Portail B2B de FAMO Seafood (grossiste poisson, Anvers) : le client commande en ligne, le personnel prépare et livre, le responsable administre. Site statique + fonctions serverless Vercel, données dans Airtable. Interface en néerlandais, documentation en français.

## Trois portails, une identité

| Portail | Couleur | Pages | Accès |
|---|---|---|---|
| **Klant** | indigo | `/` (accueil + connexion), `/klant.html` (catalogus, winkelmand, bestellingen, favorieten, account), `/aanvraag.html`, `/wachtwoord.html` | gebruikersnaam + wachtwoord |
| **Personeel** | vert | `/personeel.html` (connexion), `/bestellingen.html` (tabel · bord · kalender), `/order.html`, `/entrepot.html` (dag · bord), `/leveringen.html`, `/documenten.html` | `STAFF_CODE` (cookie 8 h) |
| **Beheer** | ambre | `/beheer-login.html`, `/beheer.html` (overzicht, aanvragen, klanten, producten, prijzen, bedrijf, toegang, status), `/invoer.html`, `/stock.html` | `ADMIN_CODE` |

Les couleurs de statut sont identiques partout : orange ontvangen, bleu klaar, violet onderweg, vert geleverd, rouge te laat.

## Structure

```
api/            fonctions serverless (+ api/klantdoc.js documents client, api/klantwachtwoord.js mot de passe client, api/klantorder.js annulation par le client ; api/updateorder.js porte aussi les corrections)
lib/            règles métier (prix négociés, numérotation, auth, mail)
assets/ui.css   une seule feuille de style (jetons, composants, responsive, print)
assets/ui.js    couche partagée : K.api, K.staff, K.klant, K.c (composants), K.shell (navigation), K.toast/confirm/panel
assets/pages/   un script par page (klant.js, bestellingen.js, order.js, entrepot.js, leveringen.js, invoer.js, documenten.js, beheer.js, stock.js, start.js, login.js, aanvraag.js, staff-common.js)
documents.js    génération leveringsbon / factuur / creditnota (inchangé)
staff-doc-preview.js  aperçu A4, impression, PDF (inchangé)
scripts/dev.js  serveur local avec Airtable et Resend nabootsés (zéro quota)
scripts/check.js garde-fous (syntaxe, secrets, liens, NL, tests)
```

## Développer sans toucher à la vraie base

```bash
node scripts/dev.js
```

Ouvre http://localhost:4200. Codes : personeel `team-dev-code`, beheer `beheer-dev-code`, klant `aloha` / `welkom123`. Les données vivent dans `.dev-data/airtable.json` ; `FAMO_RESEED=1 node scripts/dev.js` repart des données de démo. Les fonctions `api/*.js` tournent telles quelles : seul `fetch` vers `api.airtable.com` et `api.resend.com` est redirigé vers les serveurs locaux.

Avant chaque push :

```bash
node scripts/check.js
```

## Parcours d'une commande

1. Le client commande (`/api/order`) — le serveur recalcule les prix.
2. Personnel : **valider article par article** puis Klaarzetten (`Prête`).
3. **Vertrekt** (`Sortie en livraison`) — la commande est verrouillée.
4. **Ontvangst bevestigen** (nom du réceptionnaire obligatoire) → `Facturée`, numéro `FA-AAAA-0001`, facture disponible pour le personnel et le client.
5. Betaald / openstaand se gère séparément (Documenten ou fiche).

### Corriger une erreur (bouton « Corrigeren », partout où la commande s'affiche)

Chaque correction exige une raison et s'inscrit dans le champ `Correcties` de la commande (date Bruxelles · action · rôle — raison), visible dans la fiche.

| Correction | Depuis | Qui | Effet |
|---|---|---|---|
| Terug naar te bereiden | Prête | personeel | validation effacée, le magasin revalide |
| Terug naar klaar (vertrek ongedaan) | Sortie en livraison | personeel | stock remis si déduit (mouvement `Annulation sortie`) |
| Ontvangst ongedaan maken | Facturée, non payée | beheerder | retour Onderweg ; le factuurnummer reste réservé à la commande, jamais réattribué |
| Bestelling annuleren | Reçue, Prête | personeel | statut `Annulée`, `Annulée le` + `Motif annulation` ; disparaît du Magazijn, des Leveringen et des Documenten |
| Bestelling annuleren (onderweg) | Sortie en livraison | beheerder | idem + stock remis |
| Herstellen | Annulée | personeel | retour Reçue |
| Leverdag / nota aanpassen | Reçue, Prête | personeel | mêmes règles de date que le panier |

Une commande facturée ne s'annule jamais : creditnota. Le client annule lui-même tant que la commande est « Reçue » (`/api/klantorder`) ; après, il appelle Famo.

### Portail client en FR ou NL

Bouton NL | FR sur l'accueil, la demande d'accès, « mot de passe oublié » et Account. Choix mémorisé sur l'appareil (`localStorage.famoLang`). Un seul dictionnaire (`K.FR` dans `assets/ui.js`, clé = texte néerlandais), y compris les messages d'erreur du serveur, qui reste unilingue. Le contrôle `node scripts/check.js` échoue si une clé `K.t(...)` n'a pas de traduction. Le personnel et Beheer restent en néerlandais ; les documents PDF et les e-mails aussi.

### Produits et stock

Beheer → Producten → Bewerken → **Verwijderen** supprime le produit, ses prix négociés et sa ligne de stock ; refusé tant qu'il figure dans une commande ouverte (mettre inactif à la place). Voorraad signale les lignes « niet in catalogus » (produit renommé ou supprimé à la main) et permet de les retirer. Beheer → Klanten → **Toegang blokkeren** efface le mot de passe d'un client sans toucher à sa fiche.

## Comptes clients

Le client se connecte avec `Gebruikersnaam` + `Wachtwoord` (table `Clients`). Il n'y a pas de session serveur : l'onglet garde les deux et les renvoie à chaque appel, le serveur revérifie à chaque fois.

- **Changer son mot de passe** : Klant → Account → Wachtwoord → Wijzigen (`/api/klantwachtwoord`). Le client retape son mot de passe actuel, vérifié côté serveur ; seul le compte qui vient d'être vérifié est modifié, jamais un identifiant envoyé par le navigateur. Nouveau mot de passe : 8 à 80 caractères, différent de l'actuel ; 5 essais ratés par 30 s.
- **Mot de passe oublié** : `/wachtwoord.html`, Famo en remet un depuis Beheer.
- **À faire** : les mots de passe restent stockés **en clair** dans `Wachtwoord` (choix assumé pour l'instant). Hachage et session client : voir `IDEAS.md`, B3.

## Variables d'environnement Vercel

`AIRTABLE_TOKEN`, `ADMIN_CODE`, `STAFF_CODE` (obligatoires), `RESEND_API_KEY` + `MAIL_FROM` (e-mails), `PORTAL_URL` (liens dans les e-mails). Voir `VERCEL_CHECKLIST.md`.

## Pas dans cette version (v2 proposée)

Optimisation de tournée, carte intégrée, suivi live pour le client, rappels de paiement automatiques, import Excel, upload de photos de preuve, déduction automatique du stock (désactivée tant que la table n'est pas fiable).
