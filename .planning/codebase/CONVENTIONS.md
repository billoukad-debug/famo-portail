---
last_mapped_commit: 87c2948d2b10ce5ae0c5e27550fcc1197acbf17e
last_mapped_at: 2026-10-02
---
# Coding Conventions

**Analysis Date:** 2026-10-02

> Règles normatives : `.specify/memory/constitution.md` (v1.0.1), `CONTRIBUER.md`, `DESIGN.md`. Ce document les résume pour la planification ; en cas d'écart, ces sources priment.

## Naming Patterns

**Files:**
- Pages et scripts de page : néerlandais, nom = segment d'URL (`team/voorraad.html` ↔ `assets/pages/team/voorraad.js`)
- Modules serveur : minuscules, un domaine par fichier (`lib/levering.js`, `lib/verpakking.js`, `lib/commande/creditnota.js`)

**Functions:**
- camelCase, verbes courts, français ou anglais selon le module : `buildOrderLines`, `checkDate`, `reserve`, `release`, `lotFields`, `notifyOrderMail`
- Handlers : export par défaut `module.exports = async (req, res) => {}` ; modules de domaine : `ACTIONS` + `run({ req, res, body, me, action })`

**Variables:**
- camelCase ; préfixe `__` pour un module importé dans un handler (`const __mail = require("../lib/ordermail")`, `__auth`, `__journal`)
- Constantes en MAJUSCULES (`BASE`, `STATUSES`, `METHODS`, `BODY_TOKEN_UNTIL`, `REC`)

**Données (base) :**
- Noms de tables et de champs hérités d'Airtable, en français ou néerlandais, avec espaces et accents : `Commandes`, `Lignes (produits / quantités)`, `Lignes JSON`, `Statut`, `Kaliber`, `Lots verplicht`
- Valeurs en français (`Reçue`, `Prête`, `Sortie en livraison`, `Facturée`, `Annulée`, unité `caisse`), traduites à l'affichage (`famoNL.status`, `famoNL.unit` → `kassa`) ; glossaire `docs/SCHEMA.md`

## Code Style

**Formatting:**
- Pas de formateur automatique (pas de Prettier). Style dense, lignes longues, `"use strict";` en tête des modules serveur, guillemets doubles, points-virgules.
- Rendu HTML par concaténation de chaînes, toujours échappées par `K.esc()` côté navigateur (défense XSS avec la CSP).

**Linting:**
- ESLint 9.39.5 figé, `eslint.config.js` : règles `eslint:recommended` recopiées (en erreur) + `no-unused-vars` (`args: none`, `caughtErrors: none`, `varsIgnorePattern: ^_`) ; `no-useless-escape` et `no-regex-spaces` désactivées (dette connue).
- Globaux navigateur déclarés : `K`, `S`, `FamoDocuments`, `famoDocPreview`, `famoCompany`, `famoNL`, `FAMO_NL`, `html2pdf`. `alert`/`confirm`/`prompt` volontairement absents.

## Import Organization

**Order:**
1. `require("../lib/datastore")` — TOUJOURS en première ligne de chaque `api/*.js` (interrupteur de backend)
2. Accès aux données : `const { at } = require("../lib/airtable")`
3. Modules métier `lib/*` (préfixe `__`)

**Path Aliases:**
- Aucun. Chemins relatifs ; `require` STATIQUES obligatoires pour que Vercel (nft) embarque les fichiers (`api/onboarding.js`, `api/updateorder.js`).

## Error Handling

**Patterns:**
- Écriture : `if (require("../lib/guard").blocked(req, res)) return;` puis contrôle de session, avant toute lecture du corps.
- Fail-closed : variable manquante → 500/503 explicite (`DATABASE_NOT_CONFIGURED`, « STAFF_CODE ontbreekt », « RESEND_INBOUND_SECRET ontbreekt »).
- Message au navigateur en néerlandais, jamais le détail technique ; détail dans `console.error("[route]", …)`.
- Contrôles qui peuvent refuser AVANT toute réservation de numéro (`lib/commande/nummering.js`, ADR 0004 mise à jour).
- Une case décochée n'est pas stockée : lire `!!fields[...]`.
- E-mail : ne jette jamais, n'annule jamais une commande.

## Logging

**Framework:** `console` + `lib/log.js` (JSON structuré avec `fn`) ; journal d'audit métier `lib/journal.js`.

**Patterns:**
- Préfixe de route entre crochets (`[updateorder]`, `[onboarding]`, `[mail]`) ; aucun secret, aucun code, aucune donnée sensible dans les logs.
- Toute action métier réussie sur une commande : ligne de journal (qui, quand, avant → après) ; corrections : champ `Correcties` (date Bruxelles · action · rôle — raison).

## Comments

**When to Comment:**
- En français, en tête de module : pourquoi, références réglementaires et identifiants d'audit/spec (`audit C-13`, `specs/016`, `A-10`, `H-05`).
- Les décisions et limites connues sont écrites dans le code là où elles s'appliquent (ex. `lib/trace.js`, `lib/datastore.js`, `lib/guard.js`).

**JSDoc/TSDoc:**
- Ponctuel (`/** … */` sur quelques fonctions) ; pas de typage.

## Function Design

**Size:** fonctions courtes dans `lib/`, handlers minces qui aiguillent ; quelques gros fichiers navigateur (`assets/ui.js`, `assets/pages/beheer.js`, `assets/pages/klant.js`).

**Parameters:** objets de contexte (`ctx`, `{ req, res, body, me, action }`), options en dernier.

**Return Values:** `{ fields }` ou `{ error }` pour la validation ; réponses HTTP `res.status(code).json(payload)`.

## Module Design

**Exports:** `module.exports = { … }` explicite en fin de fichier côté serveur ; modules navigateur en IIFE exposant un global (`K`, `FamoVat`, `FamoRapport`), certains UMD pour être testés sous Node (`assets/rapport.js`, `assets/vat.js`).

**Barrel Files:** non. Communs par domaine : `lib/commande/common.js`, `lib/beheer/common.js`.

## Interface (règles non négociables)

- Personnel et Beheer : texte visible en néerlandais ; client : NL et FR via `K.t()` + `K.FR` (clé = texte NL ; `check.js` échoue si une clé n'a pas de traduction) ; e-mails en néerlandais ; documents dans la langue du client.
- WCAG 2.2 AA, cibles ≥ 44 px (gants, tablette), une action principale par écran, dialogues maison `K.confirm` / `K.prompt` (jamais `alert()`).
- Une seule feuille `assets/ui.css`, un seul module partagé `assets/ui.js` ; aucun nouveau `style="…"` statique (plafond 7 contrôlé).
- Après toute modification front : `node scripts/assets-version.js`.
- Préférences d'appareil en `localStorage` sous `try/catch`, comportement correct si vide ou bloqué.

## Workflow (spec-kit, règle de qualité du dépôt)

- Chaque changement commence par `specs/NNN-nom/` : `spec.md` → `plan.md` (Constitution Check) → `tasks.md` → code (`/speckit-*`).
- Commits en français ; branche de travail, PR en brouillon, CI verte (« Tests et lint » + « Navigateur ») avant fusion ; push sur `main` = production.
- Chaque état est dit honnêtement (rédigé, envoyé, confirmé, en attente).

---

*Convention analysis: 2026-10-02*
