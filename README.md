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
4. **Ontvangst bevestigen** (nom du réceptionnaire obligatoire, éventuellement une exception : Afwezig / Geweigerd / Gedeeltelijk / Beschadigd + note) → `Facturée`, numéro `FA-AAAA-0001`, facture disponible pour le personnel et le client ; e-mail « geleverd » au client avec échéance et communication.
5. **Betaald** (uniquement sur une commande facturée) : mode obligatoire (Contant / Overschrijving / Bancontact / Andere), `Payé le` horodaté, journalisé dans `Correcties`. En lot depuis Bestellingen.
6. **Creditnota** (beheerder, commande facturée) : lignes ⊆ lignes livrées, motif, retour en stock optionnel → numéro `CN-AAAA-0001`, montant aux prix figés, document Creditnota pour le personnel et le client.

Le stock n'est déduit au départ que si Beheer → Bedrijfsgegevens → **Voorraad automatisch afboeken** est coché (le navigateur ne décide plus). La déduction et les retours (`Annulation sortie`, `Retour client`) passent tous par la table des mouvements.

### Règles de livraison (Beheer → Bedrijfsgegevens, table `Configuratie`)

`Besteldeadline` (HH:MM, Bruxelles), `Leverdagen`, `Gesloten dagen` (une date ISO par ligne), `Minimum bestelling` (€), `Betaaltermijn dagen` (échéance sur la facture). `lib/levering.js` applique les mêmes règles au panier client, à Invoeren (personnel) et à « Leverdag aanpassen » ; le serveur refuse ce que l'écran laisserait passer.

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

Beheer → Producten → Bewerken → **Verwijderen** supprime le produit, ses prix négociés et sa ligne de stock ; refusé tant qu'il figure dans une commande ouverte (mettre inactif à la place). Renommer un produit renomme aussi sa ligne de stock et les lignes des commandes ouvertes. Chaque produit peut porter un `BTW-tarief` propre (sinon le taux de Configuratie) — la facture affiche une ligne de TVA par taux — et une photo (`Foto`, upload depuis Beheer, ≤ 3 Mo). Voorraad signale les lignes « niet in catalogus » (produit renommé ou supprimé à la main) et permet de les retirer ; l'historique se filtre par produit et période.

### Clients (Beheer → Klanten)

**Archiveren** ferme l'accès et sort le client des listes (Invoeren, statistiques) en gardant tout l'historique ; **Herstellen** le réactive. **Toegang blokkeren** efface le mot de passe sans toucher à la fiche. À la création d'un accès avec e-mail, un mail de bienvenue part avec les identifiants (désactivable). « Bestellingen » ouvre Bestellingen filtré sur ce client.

### Comptes du personnel (Beheer → Toegang, table `Medewerkers`)

En plus des deux codes partagés, chaque personne peut avoir un **PIN personnel** (haché, ≥ 4 chiffres, rôle personeel ou beheerder, activable). Une session ouverte par PIN porte le prénom : le journal `Correcties`, les paiements, annulations et creditnotas indiquent qui a agi au lieu de « personeel ».

### Rapportage (Beheer)

Chiffre d'affaires facturé par mois, par client et par produit, impayés, TVA par taux ; calculé dans le navigateur depuis `/api/allorders?all=1` (par défaut les listes ne chargent que l'ouvert + 365 jours). Export CSV, cellules protégées contre l'injection de formule.

## Comptes clients

Le client se connecte avec `Gebruikersnaam` + `Wachtwoord` (table `Clients`). Il n'y a pas de session serveur : l'onglet garde les deux et les renvoie à chaque appel, le serveur revérifie à chaque fois.

- **Changer son mot de passe** : Klant → Account → Wachtwoord → Wijzigen (`/api/klantwachtwoord`). Le client retape son mot de passe actuel, vérifié côté serveur ; seul le compte qui vient d'être vérifié est modifié, jamais un identifiant envoyé par le navigateur. Nouveau mot de passe : 8 à 80 caractères, différent de l'actuel ; 5 essais ratés par 30 s.
- **Mot de passe oublié** : `/wachtwoord.html` → gebruikersnaam + e-mail connu → nouveau mot de passe envoyé par e-mail (`/api/klantorder`, action `reset`, réponse neutre, 3 demandes par heure). Sans `RESEND_API_KEY`, Famo le remet depuis Beheer.
- **Compte** : e-mail et téléphone modifiables par le client ; favoris et « standaardbestelling » synchronisés entre appareils (`Favorieten`, JSON) ; relevé des factures ouvertes avec IBAN/BIC et communication ; détail de chaque commande (statut, facture, livraison, exception, creditnota) ; annulation ou modification (annule + remet au panier) tant que la commande est « Reçue ».
- **Anti-force brute** : 5 échecs par 30 s par gebruikersnaam, sur tous les endpoints client (`authClient` partagé) ; un client archivé ne peut plus se connecter.
- **À faire** : les mots de passe restent stockés **en clair** dans `Wachtwoord` (choix assumé pour l'instant). Hachage et session client : voir `IDEAS.md`, B3.

## Variables d'environnement Vercel

`AIRTABLE_TOKEN`, `ADMIN_CODE`, `STAFF_CODE` (obligatoires), `RESEND_API_KEY` + `MAIL_FROM` (e-mails : confirmation, annulation, onderweg, geleverd + facture, bienvenue, nouvelle demande d'accès, mot de passe), `PORTAL_URL` (liens dans les e-mails). En local seulement : `FAMO_DEV_HTTP=1` retire l'attribut `Secure` du cookie staff pour tester depuis une IP du réseau. Voir `VERCEL_CHECKLIST.md`.

`vercel.json` pose une Content-Security-Policy (scripts et connexions du site uniquement, images https/data/blob pour les photos Airtable et les PDF, pas d'iframe externe).

## Pas dans cette version

Optimisation automatique de tournée (l'ordre se règle à la main dans Leveringen), carte intégrée, suivi live pour le client, rappels de paiement automatiques, import Excel, Peppol, session client par cookie et hachage des mots de passe clients.
