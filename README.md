# FAMO Portail — v2

Portail B2B de FAMO Seafood (nom commercial de Famo Trading BV, BCE 0788.705.713 ; grossiste en produits de la mer, Anvers) : le client commande en ligne, le personnel prépare et livre, le responsable administre. Site statique + fonctions serverless Vercel ; en production, les données sont dans Postgres (Neon, `DB_BACKEND=postgres`), Airtable n'y est plus utilisé. Interface équipe en néerlandais, portail client en NL/FR, documentation en français.

Les documents FA-/CN- du portail sont des documents internes : la facture légale est émise par le comptable via Billtobox (Peppol), voir `docs/adr/0005-facturation-legale.md`. Données fictives jusqu'au 27/09/2026. Autres documents : `docs/SCHEMA.md` (tables et champs, glossaire FR/NL), `docs/RUNBOOK.md` (incidents), `docs/COMPTES.md`, `docs/TRANSFERT.md`, `docs/COUTS.md`, `docs/adr/`.

## Trois portails, une identité

| Portail | Pages | Accès |
|---|---|---|
| **Klant** | `/` (accueil + connexion), `/klant` (catalogus, winkelmand, bestellingen, favorieten, account), `/aanvraag`, `/wachtwoord` | gebruikersnaam + wachtwoord |
| **Personeel** | `/team/aanmelden` (connexion), `/team/bestellingen` (tabel · bord · kalender), `/team/bestelling`, `/team/magazijn` (dag · bord), `/team/leveringen`, `/team/documenten`, `/team/invoeren`, `/team/voorraad` | `STAFF_CODE` (ou code enregistré dans Beheer → Toegang) ou PIN personnel (cookie 8 h) |
| **Beheer** | `/beheer/aanmelden`, `/beheer` (overzicht, aanvragen, klanten, producten, prijzen, journaal, bedrijf, toegang, status), `/beheer/rapportage` + tout le personnel | `ADMIN_CODE` (ou code enregistré dans Beheer → Toegang) ou PIN beheerder |

Une seule peau « Vismijn » pour les trois portails (voir `DESIGN.md`) : fond froid, une couleur d'action (Noordzee), la barre de l'équipe en bleu-noir, un F sobre comme marque, la police Atkinson Hyperlegible Next. Les couleurs de statut sont identiques partout : ambre ontvangen, Noordzee klaar, bleu onderweg, vert geleverd, gris gefactureerd, rouge te laat.

## Structure

L'arborescence suit les adresses : `/team/magazijn` = `team/magazijn.html` + `assets/pages/team/magazijn.js`.
URL propres sans `.html` (`vercel.json` : `cleanUrls`) ; les anciennes adresses (`/team/magazijn`, `/team/bestelling?id=…`
des e-mails déjà envoyés…) redirigent en permanent vers les nouvelles.

```
index.html klant.html aanvraag.html wachtwoord.html privacy.html voorwaarden.html offline.html
                portail client (/, /klant, /aanvraag, /wachtwoord, /privacy, /voorwaarden) et page hors ligne
team/           personnel : aanmelden, bestellingen, bestelling (?id=…), magazijn, leveringen, invoeren, documenten, voorraad, lots
beheer.html     Beheer (/beheer) ; beheer/aanmelden.html = connexion Beheer (/beheer/aanmelden)
api/            fonctions serverless (+ api/klantdoc.js documents client, api/klantwachtwoord.js mot de passe client, api/klantorder.js annulation par le client ; api/updateorder.js aiguille vers lib/commande/ : statut, corrections, creditnota, correctiemail)
lib/            règles métier (prix négociés, numérotation, auth, mail) ; lib/beheer/ et lib/commande/ : un module par domaine
assets/ui.css   une seule feuille de style (jetons, composants, responsive, print, hoog contrast)
assets/ui.js    couche partagée : K.api, K.staff, K.klant, K.c (composants), K.shell (navigation), K.toast/confirm/panel
assets/pages/   un script par page client + beheer.js, aanmelden.js (connexion équipe et Beheer), staff-common.js (partagé équipe/Beheer)
assets/pages/team/  un script par page du personnel (même nom que la page)
assets/docs/    assets/docs/documents.js (leveringsbon / factuur / creditnota, NL ou FR selon le client), bedrijf.js (coordonnées), voorbeeld.js (aperçu A4, impression, PDF via vendor/html2pdf.bundle.min.js)
scripts/dev.js  serveur local avec Airtable et Resend nabootsés (zéro quota) ; scripts/dev-server.js reproduit cleanUrls et les redirections de vercel.json
scripts/check.js garde-fous (syntaxe, secrets, liens en URL propre, NL, contrastes, tests unitaires, scénarios métier)
scripts/ux-audit.js audit navigateur (Playwright) de 27 écrans à 1280 et 390 px
test/           tests unitaires node --test (moteur SQL, documents, e-mails, lib/airtable, Beheer…) ; test/workflow/ : scénarios métier par domaine
docs/           schéma des données, runbook, comptes, transfert, coûts, ADR, checklist UX
```

Node : la CI tourne en Node 22 ; Vercel exécute les fonctions dans la version choisie dans les réglages du projet (24.x au 27/09/2026). Le code n'utilise que des modules intégrés à Node et `fetch` ; `node:sqlite` (tests et banc local seulement) demande un Node 22 récent.

## Développer sans toucher à la vraie base

```bash
node scripts/dev.js
```

Ouvre http://localhost:4200. Les données de démo (`scripts/seed.js`) sont créées au premier lancement dans `.dev-data/airtable.json` (fichier local, à ne jamais commiter) ; `FAMO_RESEED=1 node scripts/dev.js` repart des données de démo. Codes : personeel `team-dev-code`, beheer `beheer-dev-code`, PIN de démo `1234` (Ilse), klant `aloha` / `welkom123`. Si `aloha` / `welkom123` est refusé, le fichier local vient d'une version plus ancienne : relancer avec `FAMO_RESEED=1`. Les fonctions `api/*.js` tournent telles quelles : seul `fetch` vers `api.airtable.com` et `api.resend.com` est redirigé vers les serveurs locaux.

Avant chaque push (voir `CONTRIBUER.md`) :

```bash
node scripts/assets-version.js && node scripts/check.js && npx -y eslint@9.39.5 .
```

## Parcours d'une commande

1. Le client commande (`/api/order`) — le serveur recalcule les prix.
2. Personnel : **valider article par article** puis Klaarzetten (`Prête`).
3. **Vertrekt** (`Sortie en livraison`) — la commande est verrouillée.
4. **Ontvangst bevestigen** (nom du réceptionnaire obligatoire, éventuellement une exception : Afwezig / Geweigerd / Gedeeltelijk / Beschadigd + note) → `Facturée`, numéro interne `FA-AAAA-0001`, document « factuur » du portail disponible pour le personnel et le client ; e-mail « geleverd » au client avec échéance et communication. Ce document n'est pas la facture légale (émise par le comptable via Billtobox).
5. **Betaald** (uniquement sur une commande facturée) : mode obligatoire (Contant / Overschrijving / Bancontact / Andere), `Payé le` horodaté, journalisé dans `Correcties`. En lot depuis Bestellingen.
6. **Creditnota** (beheerder, commande facturée) : lignes ⊆ lignes livrées, motif, retour en stock optionnel → numéro interne `CN-AAAA-0001`, montant aux prix figés, document « creditnota » du portail pour le personnel et le client (la note de crédit légale est émise par le comptable, comme la facture).

Le stock n'est déduit au départ que si Beheer → Bedrijfsgegevens → **Voorraad automatisch afboeken** est coché (le navigateur ne décide plus). La déduction et les retours (`Annulation sortie`, `Retour client`) passent tous par la table des mouvements.

### Règles de livraison (Beheer → Bedrijfsgegevens, table `Configuratie`)

`Besteldeadline` (HH:MM, Bruxelles), `Leverdagen`, `Gesloten dagen` (une date ISO par ligne), `Minimum bestelling` (€), `Betaaltermijn dagen` (échéance sur la facture). `lib/levering.js` applique les mêmes règles au panier client, à Invoeren (personnel) et à « Leverdag aanpassen » ; le serveur refuse ce que l'écran laisserait passer.

### Corriger une erreur (bouton « Corrigeren », partout où la commande s'affiche)

Chaque correction exige une raison et s'inscrit dans le champ `Correcties` de la commande (date Bruxelles · action · rôle — raison), visible dans la fiche.

| Correction | Depuis | Qui | Effet |
|---|---|---|---|
| Terug naar te bereiden | Prête | personeel | validation effacée, le magasin revalide |
| Terug naar klaar (vertrek ongedaan) | Sortie en livraison | personeel | stock remis si déduit (mouvement `Annulation sortie`) |
| Ontvangst ongedaan maken | Facturée, non payée, sans creditnota | beheerder | retour Onderweg ; le factuurnummer reste sur la commande et resservira à la prochaine confirmation. (À l'attribution, deux confirmations simultanées peuvent lire le même maximum : `ensureUnique` renumérote alors la commande au plus grand identifiant.) |
| Bestelling annuleren | Reçue, Prête | personeel | statut `Annulée`, `Annulée le` + `Motif annulation` ; disparaît du Magazijn, des Leveringen et des Documenten |
| Bestelling annuleren (onderweg) | Sortie en livraison | beheerder | idem + stock remis |
| Herstellen | Annulée | personeel | retour Reçue |
| Leverdag / nota aanpassen | Reçue, Prête | personeel | mêmes règles de date que le panier |

Une commande facturée ne s'annule jamais : creditnota. Le client annule lui-même tant que la commande est « Reçue » (`/api/klantorder`) ; après, il appelle Famo.

### Portail client en FR ou NL

Bouton NL | FR sur l'accueil, la demande d'accès, « mot de passe oublié » et Account. Choix mémorisé sur l'appareil (`localStorage.famoLang`). Un seul dictionnaire (`K.FR` dans `assets/ui.js`, clé = texte néerlandais), y compris les messages d'erreur du serveur, qui reste unilingue. Le contrôle `node scripts/check.js` échoue si une clé `K.t(...)` n'a pas de traduction. Le personnel et Beheer restent en néerlandais, les e-mails aussi. Les documents (leveringsbon, factuur, creditnota) suivent la langue du client (`Clients.Taal`, NL par défaut, FR possible).

### Produits et stock

Beheer → Producten → Bewerken → **Verwijderen** supprime le produit, ses prix négociés et sa ligne de stock ; refusé tant qu'il figure dans une commande ouverte (mettre inactif à la place). Renommer un produit renomme aussi sa ligne de stock et les lignes des commandes ouvertes. Chaque produit peut porter un `BTW-tarief` propre (sinon le taux de Configuratie) — le document factuur affiche une ligne de TVA par taux — et une photo (`Foto`, upload depuis Beheer, ≤ 3 Mo). Voorraad signale les lignes « niet in catalogus » (produit renommé ou supprimé à la main) et permet de les retirer ; l'historique se filtre par produit et période.

### Clients (Beheer → Klanten)

**Archiveren** ferme l'accès et sort le client des listes (Invoeren, statistiques) en gardant tout l'historique ; **Herstellen** le réactive. **Toegang blokkeren** efface le mot de passe sans toucher à la fiche. À la création d'un accès avec e-mail, un mail de bienvenue part avec les identifiants (désactivable). « Bestellingen » ouvre Bestellingen filtré sur ce client.

### Comptes du personnel (Beheer → Toegang, table `Medewerkers`)

En plus des deux codes partagés, chaque personne peut avoir un **PIN personnel** (haché, ≥ 4 chiffres, rôle personeel ou beheerder, activable). Une session ouverte par PIN porte le prénom : le journal `Correcties`, les paiements, annulations et creditnotas indiquent qui a agi au lieu de « personeel ».

### Rapportage (`/beheer/rapportage`, spec 022)

Page à part dans la barre latérale, **beheerder seul** (l'ancien `/beheer#/rapportage` y renvoie). Chiffres clés (omzet excl. btw après creditnota's, facturen, gemiddelde factuur, brutomarge, openstaand, actieve klanten) avec l'écart par rapport à la période précédente ou à la même période l'an passé ; graphiques SVG sans librairie (omzet per maand avec l'année précédente, top klanten, top producten, categorie / familie, marge per product) ; période (jaar, kwartaal, maand, vrij) et filtres (klant, categorie, product, betaling, btw-regime, zoekterm) dans l'URL ; clic sur un mois, un client ou un produit = filtre ; tableaux triables ; CSV par vue avec les filtres ; « Betaald » sur une facture ouverte (action existante de `/api/updateorder`). Données : `GET /api/rapportage` (beheerder : 401 sans session, 403 pour le personnel ; commandes test exclues) et `/api/marge` (`&klant=`) ; calcul dans `assets/rapport.js` (module pur, `test/rapportage.test.js`) : date = factuurdatum sinon leverdatum, creditnota's à leur date, btw par taux comme les documents (`assets/vat.js`).

## Comptes clients

Le client se connecte avec `Gebruikersnaam` + `Wachtwoord` (table `Clients`). Le serveur pose alors un jeton signé (HMAC, 12 h, `lib/clientauth.js`) dans le cookie `famo_klant` (HttpOnly, Secure, SameSite=Strict, chemin `/api`) : ni le jeton ni le mot de passe ne sont lisibles par la page, l'onglet ne garde que l'identifiant et le nom de la zaak (`specs/013-cookie-client-httponly`) ; chaque appel est revérifié (signature, échéance, empreinte du mot de passe : changer ou réinitialiser le mot de passe invalide les jetons existants).

- **Changer son mot de passe** : Klant → Account → Wachtwoord → Wijzigen (`/api/klantwachtwoord`). Le client retape son mot de passe actuel, vérifié côté serveur ; seul le compte qui vient d'être vérifié est modifié, jamais un identifiant envoyé par le navigateur. Nouveau mot de passe : 8 à 80 caractères, différent de l'actuel ; 5 essais ratés par 30 s.
- **Mot de passe oublié** : `/wachtwoord` → gebruikersnaam + e-mail connu → nouveau mot de passe envoyé par e-mail (`/api/klantorder`, action `reset`, réponse neutre, 3 demandes par heure). Sans `RESEND_API_KEY`, Famo le remet depuis Beheer.
- **Compte** : e-mail et téléphone modifiables par le client ; favoris et « standaardbestelling » synchronisés entre appareils (`Favorieten`, JSON) ; relevé des factures ouvertes avec IBAN/BIC et communication ; détail de chaque commande (statut, facture, livraison, exception, creditnota) ; annulation ou modification (annule + remet au panier) tant que la commande est « Reçue ».
- **Anti-force brute** : 5 échecs par 30 s par gebruikersnaam (et 30 par 5 min par IP) à la connexion (`authClient` partagé). Le compteur est en mémoire de chaque instance serverless : sur Vercel, c'est un frein, pas une limite globale garantie. Un client archivé ne peut plus se connecter.
- **Mots de passe** : stockés hachés (scrypt, `scrypt$<sel>$<empreinte>`) dans `Wachtwoord`. Un ancien mot de passe encore en clair est accepté une fois puis remplacé par son empreinte à la connexion.

## Base de données : Postgres (Neon) en production

Le code métier parle le protocole REST d'Airtable (historique, voir `docs/adr/0002-airtable-puis-neon.md`). `lib/datastore.js` (première ligne de chaque `api/*.js`) choisit où vont ces requêtes :

| `DB_BACKEND` | Données | Usage |
|---|---|---|
| absent ou `airtable` | Airtable (`AIRTABLE_TOKEN`) | défaut du code, comportement historique ; plus utilisé en production |
| `postgres` | Neon, table unique `famo_records`, via `DATABASE_URL` (ou `POSTGRES_URL`) | **production** |
| `sqlite` | SQLite intégré à Node (`DB_SQLITE_FILE`, défaut en mémoire) | tests et banc local : `DB_BACKEND=sqlite node scripts/dev.js` |

`lib/at-engine.js` rejoue le contrat Airtable (formules via `lib/at-formula.js`, partagé avec le faux Airtable du banc local ; tri, pages, lots de 10, champs vides effacés, 404/422) et gère la concurrence par numéro de version. `lib/sql.js` parle à Neon en HTTPS avec le `fetch` natif : toujours aucune dépendance npm. Photos produit : en mode Postgres, elles sont stockées dans la table `famo_files` et servies par `/api/foto?id=att…` (cache d'un an, un nouvel id à chaque photo). Beheer les réduit dans le navigateur à 1600 px (JPEG 85 %) avant l'envoi. Une nouvelle photo remplace l'ancienne, dont le fichier est supprimé ; supprimer un produit supprime aussi sa photo.

**Bascule (effectuée : la production tourne sur Neon ; procédure gardée pour mémoire et pour un nouvel environnement) :**
1. Vercel → Storage → Neon relié au projet (fournit `DATABASE_URL`), puis redéployer.
2. Beheer → Systeemstatus → **Database** : « bereikbaar » doit apparaître.
3. **Kopieer Airtable naar de nieuwe database**, puis **Vergelijken** : toutes les lignes « OK ».
4. Un moment sans commande : recopier, vérifier, mettre `DB_BACKEND=postgres` dans Vercel, redéployer.
5. Retour arrière vers Airtable : techniquement `DB_BACKEND=airtable` et redéployer, mais les commandes enregistrées depuis la bascule ne sont que dans Neon : ce n'est plus une option d'exploitation. En cas d'incident sur Neon, voir `docs/RUNBOOK.md` (restauration point-in-time).

`DB_BACKEND=postgres` sans `DATABASE_URL` valable : chaque requête répond 500 `DATABASE_NOT_CONFIGURED`, jamais de repli silencieux sur Airtable (test `test/engine-switch.test.js`). Attention : une valeur mal orthographiée (`postgresql`, `neon`…) est lue comme `airtable`.

Une fois basculé, la copie est refusée (409) : elle écraserait les nouvelles commandes avec une Airtable périmée.

## Variables d'environnement Vercel

Liste complète des variables lues par `api/` et `lib/` (`grep -rn process.env api lib`) ; détail et valeurs dans `VERCEL_CHECKLIST.md`.

| Variable | Rôle |
|---|---|
| `ADMIN_CODE`, `STAFF_CODE` | codes d'accès partagés. **Au moins un des deux** doit exister, sinon toute auth staff est fermée (500). Sans `ADMIN_CODE`, Beheer est fermé pour tout le monde, PIN beheerder compris (`adminOk`). |
| `SESSION_SECRET` | secret HMAC des cookies staff et des jetons clients. **À poser en production** : sans elle, le secret dérive de `AIRTABLE_TOKEN`, `DATABASE_URL`, `STAFF_CODE` et `ADMIN_CODE`, et changer l'une de ces variables déconnecte tout le monde. |
| `DB_BACKEND` | `postgres` en production (voir ci-dessus). |
| `DATABASE_URL` (ou `POSTGRES_URL`) | adresse Neon, fournie par l'intégration Vercel ↔ Neon. |
| `NEON_HTTP_URL` | facultatif : point d'entrée HTTP de Neon si celui déduit de l'adresse ne convient pas. |
| `AIRTABLE_TOKEN` | lecture de l'ancienne base Airtable (copie/vérification dans Systeemstatus). Plus nécessaire au fonctionnement courant ; voir `SESSION_SECRET` avant de la retirer. |
| `RESEND_API_KEY`, `MAIL_FROM` | e-mails (confirmation, annulation, onderweg, geleverd, bienvenue, nouvelle demande d'accès, mot de passe). Sans clé : aucun e-mail, tout le reste fonctionne. |
| `MAIL_TIMEOUT_MS` | facultatif : délai max d'un envoi Resend (4000 ms par défaut). |
| `PORTAL_URL` | adresse publique du portail pour les liens des e-mails (sinon déduite de la requête). |
| `CRON_SECRET` | **Obligatoire** : protège les deux tâches planifiées de `vercel.json` (`/api/backup-cron` 02:17 UTC, `/api/reminders-cron` 07:43 UTC). Sans elle, les deux répondent 500 et ne font rien. 16 caractères aléatoires minimum. La sauvegarde nocturne part **par e-mail** : il faut aussi `RESEND_API_KEY` et un destinataire (`BACKUP_EMAIL` ou Beheer → Bedrijfsgegevens → Bestellingen e-mail). |

Local seulement : `FAMO_DEV_HTTP=1` retire l'attribut `Secure` du cookie staff (test depuis une IP du réseau, jamais sur Vercel), `DB_SQLITE_FILE`, `PORT`, `FAMO_RESEED`, `FAMO_REAL`.

`vercel.json` pose une Content-Security-Policy (scripts et connexions du site uniquement, images https/data/blob pour les photos Airtable et les PDF, pas d'iframe externe).

## Pas dans cette version

Optimisation automatique de tournée (l'ordre se règle à la main dans Leveringen), carte intégrée, suivi live pour le client, rappels de paiement automatiques, import Excel, envoi Peppol depuis le portail (la facture légale part du comptable via Billtobox).
