---
last_mapped_commit: 87c2948d2b10ce5ae0c5e27550fcc1197acbf17e
last_mapped_at: 2026-10-02
---
<!-- refreshed: 2026-10-02 -->

# Architecture

**Analysis Date:** 2026-10-02

## System Overview

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                 Navigateur — trois portails, une peau « Vismijn »          │
├──────────────────────┬────────────────────────┬───────────────────────────┤
│ Klant (NL/FR)        │ Personeel (NL)         │ Beheer (NL, beheerder)    │
│ `index.html`         │ `team/*.html`          │ `beheer.html`             │
│ `klant.html`         │ `assets/pages/team/*`  │ `beheer/rapportage.html`  │
│ `assets/pages/klant.js` │ `assets/pages/staff-common.js` (S) │ `assets/pages/beheer.js` │
└──────────┬───────────┴───────────┬────────────┴─────────────┬─────────────┘
           │  `assets/ui.js` (K : K.api, K.shell, K.c, K.t…) + `assets/vat.js` (FamoVat)
           ▼                       ▼                          ▼
┌───────────────────────────────────────────────────────────────────────────┐
│          Fonctions Vercel `api/*.js` (Node CommonJS, une par route)        │
│  garde `lib/guard.js` → session (`lib/staffauth.js` / `lib/clientauth.js`) │
│  → aiguillage par domaine : `lib/commande/*` (updateorder),                │
│    `lib/beheer/*` (onboarding), `lib/inbound/*` (inbound-mail)             │
└──────────┬────────────────────────────────────────────────────────────────┘
           │ règles métier partagées `lib/*.js` (prix, TVA, livraison, stock, lots,
           │ numérotation, e-mails, documents UBL)
           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  Protocole REST Airtable (`lib/airtable.js` : `at()`, `atAll()`)            │
│  intercepté par `lib/datastore.js` selon `DB_BACKEND`                       │
├──────────────────────┬────────────────────────┬───────────────────────────┤
│ postgres (prod)      │ sqlite (tests, local)  │ airtable (historique)     │
│ `lib/at-engine.js` + `lib/sql.js` → Neon       │ `lib/at-engine.js` + node:sqlite │ api.airtable.com │
│ tables `famo_records`, `famo_files`            │                        │                           │
└──────────────────────┴────────────────────────┴───────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Couche UI partagée | API fetch, session, i18n NL/FR, composants, navigation, dialogues maison | `assets/ui.js` |
| Couche staff partagée | Chargement des commandes, actions (départ, documents, CSV), badges | `assets/pages/staff-common.js` |
| TVA / conditionnement | Calcul TVA par taux et régime, règles « verpakking » communes écran/serveur | `assets/vat.js` |
| Agrégation Rapportage | Module pur (navigateur + Node) des chiffres de la spec 022 | `assets/rapport.js` |
| Documents | Leveringsbon / factuur interne / creditnota, NL ou FR, A4, PDF | `assets/docs/documents.js`, `assets/docs/voorbeeld.js` |
| Garde CSRF | Origin/Referer + JSON exigé sur toute écriture | `lib/guard.js` |
| Auth personnel | Cookie `famo_sess`, codes, PIN, mode PIN seul, break-glass | `lib/staffauth.js`, `api/session.js` |
| Auth client | Cookie `famo_klant`, jeton signé, scrypt | `lib/clientauth.js`, `lib/klantlogin.js` |
| Commandes (client) | Création, prix recalculés serveur | `api/order.js`, `lib/bestelling.js`, `lib/prices.js` |
| Cycle de vie commande | Statut, lignes, paiement, départ, facture, corrections, creditnota | `api/updateorder.js` → `lib/commande/*.js` |
| Beheer | Configuration, produits, clients, prix, accès, testperiode | `api/onboarding.js` → `lib/beheer/*.js` |
| Numérotation | CMD max+1 ; FA/CN par compteur atomique `reserve`/`release` | `lib/ordernumber.js`, `lib/billing.js`, `lib/commande/nummering.js` |
| Livraison | Deadline, jours, fermetures, minimum, créneau | `lib/levering.js` |
| Traçabilité lots | Lots, instantané à la préparation, rappel | `lib/trace.js`, `api/lots.js`, `team/lots.html` |
| E-mails | Envoi Resend + gabarit commun | `lib/mail.js`, `lib/ordermail.js`, `lib/maillayout.js` |
| Commande par e-mail | Webhook, Svix, lecture Claude, file de contrôle | `api/inbound-mail.js`, `lib/inbound/*.js`, `api/mailcontrole.js` |
| Export comptable | UBL 2.1 Peppol BIS 3.0 (fichier), CSV navigateur | `api/export.js`, `lib/ubl.js` |
| Moteur de données | Rejoue Airtable sur SQL, concurrence optimiste | `lib/datastore.js`, `lib/at-engine.js`, `lib/at-formula.js`, `lib/sql.js` |
| Journal d'audit | Qui, quand, champ avant → après | `lib/journal.js`, `api/journaal.js` |

## Pattern Overview

**Overall:** Site statique multi-pages + fonctions serverless « une route = un fichier », avec un moteur de données à protocole fixe (REST Airtable) et des modules métier par domaine.

**Key Characteristics:**
- Le serveur décide (constitution § II) : prix, TVA, stock, numéros, droits et états recalculés et revérifiés côté serveur ; le navigateur n'envoie que des intentions (quantités, actions).
- Fail-closed : sans secret ou backend configuré, refus explicite (500/503), jamais de code de secours ni de repli silencieux.
- Indépendance du backend : le code métier ne voit que `at()` ; `lib/datastore.js` patche `fetch` en première ligne de chaque `api/*.js`.
- Points d'entrée minces + modules de domaine (`lib/commande/`, `lib/beheer/`, `lib/inbound/`) chargés par `require` statiques (traçage de fichiers Vercel nft).
- Valeurs de base en français, affichage traduit (NL staff, NL/FR client) ; glossaire `docs/SCHEMA.md`.

## Layers

**Pages (présentation) :**
- Purpose : HTML minimal (squelette + scripts `defer`), rendu côté navigateur par chaînes HTML échappées (`K.esc`).
- Location : `*.html`, `team/*.html`, `beheer/*.html` ; scripts `assets/pages/**`
- Contains : un script par page, même arborescence que l'URL
- Depends on : `assets/ui.js`, `assets/vat.js`, `assets/pages/staff-common.js`
- Used by : navigateurs (URL propres via `cleanUrls`)

**API (contrôle) :**
- Purpose : contrat HTTP, garde, session, aiguillage
- Location : `api/*.js` (28 fichiers)
- Contains : handlers `module.exports = async (req, res) => {}`
- Depends on : `lib/*`
- Used by : `K.api` côté navigateur, crons Vercel, webhook Resend

**Métier (domaine) :**
- Purpose : règles partagées entre routes et entre canaux (client, Invoeren, e-mail)
- Location : `lib/*.js`, `lib/commande/`, `lib/beheer/`, `lib/inbound/`
- Depends on : `lib/airtable.js`
- Used by : `api/*.js`, tests

**Données (persistance) :**
- Purpose : stockage indépendant du fournisseur
- Location : `lib/datastore.js`, `lib/at-engine.js`, `lib/sql.js`
- Contains : tables `famo_records` (JSON + `version`) et `famo_files`
- Used by : tout `at()`

## Data Flow

### Primary Request Path (commande client)

1. Le client ajoute au panier dans `/klant` (`assets/pages/klant.js`), `K.api("/api/order", { json })` avec le cookie `famo_klant`.
2. `api/order.js` : garde, `authRequest` (partagée avec `api/catalogue.js`), anti-abus en mémoire, règles de livraison `lib/levering.js`.
3. `lib/bestelling.js` `buildOrderLines` : noms, unités, prix négociés et conditionnement décidés par le serveur ; refus d'un non-multiple « enkel per verpakking ».
4. Numéro `CMD-AAAA-NNNN` (`lib/ordernumber.js`), écriture `Commandes` (texte des lignes + `Lignes JSON`), e-mails de confirmation (`lib/ordermail.js`, sans jamais bloquer).

### Cycle de vie d'une commande (personnel)

1. `Reçue` → validation article par article + lot par article (si `Lots verplicht`) → `Prête` (`lib/commande/bijwerken.js`, instantané des lots).
2. `Sortie en livraison` (verrouillage ; stock déduit une seule fois si `Voorraad afboeken`, `lib/commande/stock.js`).
3. Réception confirmée (réceptionnaire obligatoire, exception éventuelle, preuve `api/bewijs.js`) → `Facturée`, numéro interne `FA-AAAA-NNNN` réservé par `lib/billing.js` `reserve`.
4. `Betaald` (mode + date), creditnota `CN-AAAA-NNNN` (beheerder, lignes ⊆ livrées, retour stock optionnel), corrections journalisées (`Correcties`, `lib/journal.js`).

### Commande par e-mail (spec 020, inactive)

1. Resend → `POST /api/inbound-mail` ; signature Svix sur le corps brut ; idempotence par id Resend (`Inkomende mails`).
2. Expéditeur reconnu (fiche client) ; Claude lit et propose (`lib/inbound/claude.js`) ; `lib/bestelling.js` revérifie tout.
3. Certitude + DMARC pass + interrupteur Beheer → commande créée ; sinon file « Te controleren » (`api/mailcontrole.js`).

**State Management:**
- Serveur sans état hors base (sauf compteurs anti-abus et verrou `inflight` en mémoire d'instance, best-effort).
- Navigateur : `sessionStorage` (cache des commandes staff, affichage client), `localStorage` (langue, préférences d'appareil, sous `try/catch`), file hors ligne `assets/offline-queue.js`.

## Key Abstractions

**`at(path, opts)` — protocole REST Airtable :**
- Purpose : unique API de données du code métier
- Examples : `lib/airtable.js`, `lib/commande/common.js`, `lib/beheer/common.js`
- Pattern : adaptateur ; moteur substituable par interception de `fetch`

**Objets globaux navigateur `K` et `S` :**
- Purpose : une seule couche partagée (constitution § I)
- Examples : `assets/ui.js` (`K.api`, `K.shell`, `K.c`, `K.t`, `K.confirm`, `K.pref`, `K.thumb`), `assets/pages/staff-common.js` (`S.load`, `S.update`, `S.openDoc`)
- Pattern : module IIFE exposant un espace de noms

**Modules de domaine avec `ACTIONS` :**
- Purpose : router une action POST vers son module
- Examples : `lib/beheer/*.js` (`ACTIONS`, `run({ req, res, body, me, action })`), `lib/commande/*.js`
- Pattern : table d'aiguillage, testée par `test/beheer-routes.test.js` et `test/commande-routes.test.js`

**Instantanés figés :**
- Purpose : un document remis ne change jamais
- Examples : prix et conditionnement dans `Lignes JSON` (`lib/lignesjson.js`), lots livrés (`lib/trace.js`), taux de TVA figés (`lib/billing.js` `frozenRates`)

## Entry Points

**Pages :**
- Location : `index.html` (accueil/connexion client), `klant.html`, `team/aanmelden.html`, `beheer/aanmelden.html`, `beheer.html`, `beheer/rapportage.html`
- Triggers : navigation (URL propres, `vercel.json`)
- Responsibilities : charger `ui.css`, `ui.js`, le script de page

**Fonctions :**
- Location : `api/*.js`
- Triggers : `fetch` des pages, crons (`/api/backup-cron`, `/api/reminders-cron`), webhook Resend (`/api/inbound-mail`), sonde (`/api/health`)

**Banc local :**
- Location : `scripts/dev.js` (port 4200), `scripts/dev-server.js` (port 3000)

## Architectural Constraints

- **Threading :** boucle d'événements Node unique par instance serverless ; plusieurs instances possibles en parallèle sur Vercel.
- **Global state :** `_rl` (anti-abus) dans `api/order.js` et équivalents, `inflight` dans `api/updateorder.js`, état du moteur `lib/datastore.js` `state` — tous par instance, jamais une garantie globale.
- **Circular imports :** `api/export.js` importe `parseLines` depuis `api/updateorder.js` (api → api) ; `api/order.js` importe `authRequest` depuis `api/catalogue.js`.
- **Sans build :** aucun module ES côté navigateur ; ordre des `<script defer>` significatif ; `?v=` à régénérer après chaque modification front.
- **CSP stricte :** `script-src 'self'` sans inline ; pas d'attribut `on*=` (contrôlé par `scripts/check.js`).

## Anti-Patterns

### Décision côté navigateur

**What happens :** une règle (prix, stock, droit, statut) calculée seulement dans `assets/`.
**Why it's wrong :** constitution § II ; le navigateur n'est jamais cru.
**Do this instead :** règle dans `lib/` (ex. `lib/bestelling.js`, `lib/levering.js`), partagée avec l'écran si besoin via un module UMD (`assets/vat.js`).

### Modifier `api/` ou `lib/` pour un besoin d'affichage

**What happens :** adapter le contrat serveur à un écran.
**Why it's wrong :** règle de la maison (`CONTRIBUER.md`) : le front s'adapte à l'API.
**Do this instead :** transformer dans `assets/pages/*` ou `assets/ui.js`.

### Style en ligne statique

**What happens :** `style="…"` dans une page ou un template.
**Why it's wrong :** `scripts/check.js` plafonne à 7 les styles en ligne statiques (spec 017).
**Do this instead :** utilitaire de `assets/ui.css` (`fs-*`, `mt-*`, `d-flex`…) ou nouvelle classe.

## Error Handling

**Strategy :** messages utilisateur en néerlandais, jamais le message brut de la base ; détail dans les logs.

**Patterns :**
- `try { … } catch (e) { console.error("[route]", …); res.status(500).json({ error: "<message NL>" }) }` (`api/onboarding.js`, `api/updateorder.js`)
- `{ error: { message } }` normalisé par `lib/airtable.js` (jamais une page vide prise pour une table vide)
- Refus métier en 400/409 avec texte explicite ; 401/403 pour la session et le rôle

## Cross-Cutting Concerns

**Logging :** `lib/log.js` (JSON structuré), `lib/journal.js` (audit métier en base), champ `Correcties` par commande.
**Validation :** serveur uniquement fait foi (`lib/beheer/common.js` `clean`, `lib/trace.js` `lotFields`, `lib/levering.js`) ; contrôles écran = confort.
**Authentication :** `lib/guard.js` puis `staffSession` / `adminSession` / jeton client, en tête de chaque handler qui écrit.

---

*Architecture analysis: 2026-10-02*
