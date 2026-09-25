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
api/            fonctions serverless (inchangées depuis la v1, + api/klantdoc.js pour les documents client, + api/klantwachtwoord.js pour le mot de passe client)
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

## Comptes clients

Le client se connecte avec `Gebruikersnaam` + `Wachtwoord` (table `Clients`). Il n'y a pas de session serveur : l'onglet garde les deux et les renvoie à chaque appel, le serveur revérifie à chaque fois.

- **Changer son mot de passe** : Klant → Account → Wachtwoord → Wijzigen (`/api/klantwachtwoord`). Le client retape son mot de passe actuel, vérifié côté serveur ; seul le compte qui vient d'être vérifié est modifié, jamais un identifiant envoyé par le navigateur. Nouveau mot de passe : 8 à 80 caractères, différent de l'actuel ; 5 essais ratés par 30 s.
- **Mot de passe oublié** : `/wachtwoord.html`, Famo en remet un depuis Beheer.
- **À faire** : les mots de passe restent stockés **en clair** dans `Wachtwoord` (choix assumé pour l'instant). Hachage et session client : voir `IDEAS.md`, B3.

## Variables d'environnement Vercel

`AIRTABLE_TOKEN`, `ADMIN_CODE`, `STAFF_CODE` (obligatoires), `RESEND_API_KEY` + `MAIL_FROM` (e-mails), `PORTAL_URL` (liens dans les e-mails). Voir `VERCEL_CHECKLIST.md`.

## Pas dans cette version (v2 proposée)

Optimisation de tournée, carte intégrée, suivi live pour le client, rappels de paiement automatiques, import Excel, upload de photos de preuve, déduction automatique du stock (désactivée tant que la table n'est pas fiable).
