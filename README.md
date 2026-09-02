# Famo Kade — bestelportaal Famo Trading BV

Portail B2B complet pour un grossiste en poisson : les clients commandent le soir avec leurs prix, l'équipe prépare à 5 h sur tablette, livre, signe, facture ; le gérant administre tout depuis son navigateur. Tout ce que voit un utilisateur est en néerlandais (vouvoiement). Données dans la base Airtable existante, e-mails via Resend, hébergement Vercel.

## Les quatre surfaces

| URL | Pour qui | Accès |
|---|---|---|
| `/` | Clients (restaurants, poissonneries) | identifiant **ou e-mail** + mot de passe |
| `/aanvraag` | Prospects | public |
| `/team` | Magasin et chauffeur (tablette) | code équipe ou code admin |
| `/beheer` | Gérant | code admin |
| `/doc/leveringsbon/:id`, `/doc/factuur/:id`, `/doc/picklijst?dag=` | Documents imprimables | session équipe, session client (ses propres commandes) ou lien signé reçu par e-mail |

## Le parcours d'une commande

1. **Le client commande** (`/`) : catalogue avec ses prix négociés, « vaste bestelling » proposée à partir de ses dernières commandes, date de livraison choisie parmi les jours de livraison en respectant l'heure limite (par défaut 22 h → livraison le lendemain, après → le surlendemain). Le serveur recalcule toujours noms, unités et prix : le navigateur n'envoie que des quantités.
   → E-mail à l'équipe (boîte interne) + confirmation au client.
2. **Klaarzetten** (`/team`) : liste à cocher article par article, quantités ajustables tant que la commande n'est pas partie, photo de la commande préparée (optionnel), picklijst imprimable pour toute la journée.
3. **Onderweg** : un bouton. → E-mail au client avec le bon de livraison.
4. **Levering afronden** : nom du réceptionnaire + signature sur la tablette → preuve stockée dans Airtable, **numéro de facture** attribué (`FA-2026-0001`, séquentiel, jamais réattribué), facture envoyée au client, copie à l'équipe.
5. **Betaald / openstaand** : marqué depuis la commande ; visible dans Beheer → Facturen, export CSV pour le comptable (Billtobox).

## Beheer (`/beheer`)

Overzicht (alertes de configuration, chiffres clés) · Aanvragen (approuver = créer le client + envoyer les identifiants) · Klanten · Artikelen · Prijzen (grille par client) · Facturen (+ CSV) · Bedrijf (identité, IBAN, TVA, conditions, boîte interne, heure limite, jours de livraison) · Toegang (changer les codes équipe/admin, stockés hachés) · **Systeemcontrole** : parcourt toute la chaîne avec un client et une commande de test, puis les supprime.

## Design et ergonomie (v2)

- **Style** : `assets/ui.css` reprend les principes de Shopify Polaris (canevas gris `#f1f1f1`, cartes blanches, bouton principal sombre `#303030`, badges de statut doux, police Inter, rayons 8/12 px, barre supérieure `#1a1a1a`). Les composants Polaris natifs (`s-*`) ne fonctionnent que dans l'admin Shopify ; les jetons et la grammaire visuelle sont donc réimplémentés en CSS pur. Tout le rendu passe par la couche de composants `K.c` de `assets/ui.js` : changer le style se fait en un seul endroit.
- **Les trois portails sont reliés** : page de connexion client → lien Team et Beheer ; barre supérieure du Team → Klantportaal (+ Beheer pour l'admin) ; Beheer → Klantportaal, Team ; chaque facture/commande dans Beheer ouvre la commande dans le Team (`/team?bestelling=…`), chaque client ouvre sa grille de prix (`/beheer#/prijzen?klant=…`).
- **Navigation adressable** : écrans en `#/…` (retour du navigateur, liens partageables, retour au bon écran après une session expirée).
- **Audit d'utilisabilité** : 178 constats relevés sur la v1 (`.dev-data/audit-ranked.json`, 60 retenus et classés), dont : confirmation avant « Onderweg », lignes « niet geleverd » et articles de remplacement sans casser la facture, montant TTC et paiement comptant à la porte, « volgende stop », en-têtes par jour et filtre « Vandaag + te laat », historique par période, vocabulaire unique Ontvangen / Klaargezet / Onderweg / Geleverd, KPI et alertes cliquables dans Beheer, flux d'approbation avec détection de doublon, identifiants suivis d'étapes suivantes, prix client saisis en ligne, codes d'accès expliqués sans jargon.

## Mise en service (Vercel)

Le code est sur GitHub : **billoukad-debug/famo-kade** (privé). Créer le projet Vercel (3 minutes) :

1. vercel.com → **Add New… → Project** → importer `billoukad-debug/famo-kade` (framework « Other », rien à changer).
2. Avant de cliquer **Deploy**, ouvrir **Environment Variables** et coller les variables ci-dessous (mêmes valeurs que le projet `famo-portail` : Settings → Environment Variables).
3. Deploy. Le portail est alors sur `famo-kade.vercel.app` (ou le nom choisi). Chaque `git push` sur `main` redéploie.

Variables d'environnement (Production) :

```text
AIRTABLE_TOKEN     obligatoire — même valeur que le projet famo-portail
ADMIN_CODE         obligatoire — code gérant (sème aussi le secret des sessions)
STAFF_CODE         obligatoire — code équipe
RESEND_API_KEY     sans elle, aucun e-mail ne part (tout le reste fonctionne)
MAIL_FROM          "Famo Trading <bestellingen@famotrading.be>" — domaine vérifié chez Resend
PORTAL_URL         optionnel, déduit de l'hôte sinon
SESSION_SECRET     optionnel, renforce le secret des cookies
```

Tant que les trois variables obligatoires manquent, chaque page affiche un écran de configuration (NL/FR) et l'API répond 503 proprement. Après modification : **Redeploy**.

**E-mails** : le compte Resend est encore en mode bac à sable (aucun domaine vérifié) — il n'accepte que l'adresse du propriétaire du compte. Pour que clients et équipe reçoivent les e-mails : Resend → Domains → ajouter `famotrading.be` (SPF + DKIM chez le registrar) → puis `MAIL_FROM=Famo Trading <bestellingen@famotrading.be>`. En attendant, tout fonctionne sans e-mail ; Beheer → Overzicht le signale.

Deux champs ont été ajoutés à la table `Configuratie` de la base : `Besteldeadline` (ex. `22:00`) et `Leverdagen` (ex. `ma,di,wo,do,vr,za`). Vides = valeurs par défaut.

## Compatibilité avec la base et l'ancien portail

- Mêmes tables, mêmes champs, même format de lignes (`Produit × 2 pièce [€16.00] (opmerking)`), mêmes statuts et même numérotation de facture : les deux portails peuvent lire les commandes de l'autre.
- Les codes changés dans Toegang (hash scrypt dans `Configuratie`) valent pour les deux portails.
- Mots de passe clients stockés en clair dans `Wachtwoord` (contrainte de la base partagée) ; jamais renvoyés par l'API ; comparaison à temps constant ; format `scrypt$…` accepté pour l'avenir.
- Le stock n'est jamais touché.

## Développer et tester

```bash
node scripts/dev.js          # http://localhost:4100 — Airtable et Resend émulés, données de démo, boîte mail sur /dev/inbox
node scripts/check.js        # syntaxe + tests (unitaires + chaîne complète via l'API)
FAMO_REAL=1 node scripts/dev.js   # avec un fichier .env réel (jamais commité)
```

Codes locaux : équipe `team-dev-code`, admin `beheer-dev-code` ; client `aloha` / `welkom123`.

## Structure

```text
api/index.js          une seule fonction serverless (rewrites /api/* et /doc/* dans vercel.json), routeur interne
lib/config.js         schéma Airtable (tous les noms de champs), constantes, env
lib/airtable.js       client REST (pagination, retry 429, upload de pièces jointes)
lib/repo.js           enregistrements ⇄ objets métier
lib/domain.js         règles pures : argent en centimes, lignes, statuts, dates Bruxelles, jours de livraison, numérotation
lib/service.js        opérations : commander, klaarzetten, onderweg, leveren+facturer, clients, aanvragen, bedrijf, codes, systeemcontrole
lib/mail.js           e-mails Resend (NL, tables + CSS inline)
lib/docs.js           leveringsbon, factuur, picklijst (HTML imprimable A4)
lib/handlers/*.js     klant, team, beheer, publiek, doc
assets/ui.css|ui.js   système de design partagé, helpers
assets/klant.js, team.js, beheer.js + index.html, team.html, beheer.html, aanvraag.html
scripts/              serveur local, émulateurs Airtable/Resend, données de démo, contrôle, bundle de déploiement
test/                 node --test
```

## Limites connues

- Un seul code par rôle (équipe / admin), pas d'identité individuelle.
- L'attribution du numéro de facture n'est pas atomique ; une vérification après écriture corrige une collision improbable (deux facturations à la même seconde).
- Les factures sont des documents internes ; l'e-facturation légale (Peppol) passe par le comptable (export CSV).
- Rate limiting en mémoire d'instance (best effort sur serverless).
- La preuve de livraison (signature PNG) et la photo de préparation transitent en base64 (max 4 Mo) vers l'API d'upload Airtable.
