# FAMO Portail

## What This Is

Portail B2B de FAMO Seafood (nom commercial de Famo Trading BV, BCE 0788.705.713), grossiste en produits de la mer de la région d'Anvers, gérant Mohsen. Les clients horeca (poke bars, sushi, frituren, restaurants) commandent en ligne à leurs prix négociés ; le personnel prépare, livre et confirme la réception ; le beheerder administre le catalogue, les clients, les accès et suit la Rapportage. Site HTML statique + JavaScript vanilla, fonctions Vercel `api/*.js` (Node CommonJS), données dans Postgres Neon, sans build ni `package.json`.

## Core Value

Une commande passée par un client arrive juste — bons produits, prix négociés, jour de livraison, stock et documents — parce que le serveur décide de tout, du panier au document remis.

## Business Context

- **Customer**: clients horeca de FAMO Seafood (commandent) ; personnel et gérant de Famo Trading BV (opèrent).
- **Revenue model**: vente en gros de produits de la mer ; le portail est l'outil de commande et d'exploitation, pas un produit vendu.
- **Success metric**: part des commandes réelles passées et livrées par le portail sans ressaisie ni correction manuelle (à mesurer dès la fin de la période de test).
- **Strategy notes**: `IDEAS.md` (plan produit), `DESIGN.md` (brief design), `docs/adr/` (décisions).

## Requirements

### Validated

<!-- Livré en production (version 333125a), validé par les specs spec-kit et leurs tests. -->

- ✓ Parcours commande complet : commande client à prix recalculés serveur → préparation article par article → départ (stock déduit une fois) → réception confirmée → document interne FA → paiement → creditnota — v2 (avant specs)
- ✓ Pastilles du menu lues (Nieuw / Alles / Uit) — spec 001
- ✓ Identité visuelle « Vismijn » commune aux trois portails — spec 002
- ✓ Régime de TVA par client et contrôle VIES — spec 003
- ✓ Plusieurs notes de crédit par facture et e-mail de correction — spec 004
- ✓ PIN personnels seuls avec accès de secours journalisé — spec 005
- ✓ Beheer découpé en modules, lecture des lignes unique — spec 006
- ✓ Logo F sobre, accueil sans minuteur — spec 007
- ✓ Catalogue sans ligne de deadline — spec 008
- ✓ Lot A de finitions (docs, panier, nettoyage, focus) — spec 009
- ✓ updateorder découpé, numérotation FA/CN sans trou inexpliqué — spec 010
- ✓ Scénarios métier découpés par domaine — spec 011
- ✓ Documents A4 et gabarit e-mail unique — spec 012
- ✓ Session client par cookie HttpOnly `famo_klant` — spec 013
- ✓ URL propres et arborescence par portail — spec 014
- ✓ Mode chauffeur et créneau de livraison visible par le client — spec 015
- ✓ Lignes de commande structurées `Lignes JSON` — spec 016
- ✓ Styles en ligne migrés vers `ui.css` — spec 017
- ✓ Photos produit (jusqu'à 6) et ordre par kaliber — spec 018
- ✓ Catalogue client : vues, tri, familles — spec 019
- ✓ Commande par e-mail (livrée, **désactivée par défaut**, activation en attente) — spec 020
- ✓ Outil « Testperiode afsluiten » (archiver, supprimer, redémarrer la numérotation) — spec 021
- ✓ Rapportage page à part pour le beheerder — spec 022
- ✓ Vente par conditionnement « Verpakking » — spec 023
- ✓ Favoris synchronisés entre appareils (correctif) — version 333125a

### Active

<!-- Jalon v2.1 « Usage réel ». Détail et identifiants : REQUIREMENTS.md. -->

- [ ] Mise en service propre : plus aucune donnée de test visible, catalogue corrigé (Kaliber, catégories), comptes clients de test archivés, option « archiver aussi les clients non cochés »
- [ ] Traçabilité numérique par lot transmise au client (règlement (UE) 2023/2842)
- [ ] Commande par e-mail activée en production, puis canal WhatsApp
- [ ] Pilotage : Rapportage en usage réel, réassort en un clic, rappel avant la deadline de commande

### Out of Scope

- Envoi Peppol / émission de factures légales depuis le portail — décision VERROUILLÉE (ADR 0005, reconfirmée le 2026-10-02) : le comptable émet via Billtobox ; idée différée seulement si FAMO quitte Billtobox
- Optimisation automatique de tournée, carte intégrée, suivi live client — hors version (`README.md` « Pas dans cette version ») ; l'ordre se règle à la main dans Leveringen
- Import Excel — hors version (`README.md`)
- CRM, catalogues multi-entrepôts, app native, offline complet — `IDEAS.md` « Ce qu'on ne fera pas »
- Dashboard analytics générique — la Rapportage (spec 022) et les pastilles suffisent
- Toute chaîne de build, framework ou dépendance npm — ADR 0001, constitution § I

## Context

- **Production** : Vercel (région fra1) + Neon Postgres (`DB_BACKEND=postgres`) + Resend (e-mails) ; domaine et DNS chez one.com ; version 333125a. Airtable n'est plus utilisé (historique).
- **Méthode de qualité du dépôt** : spec-kit (`specs/NNN-nom/` spec → plan avec Constitution Check → tasks → implement), constitution `.specify/memory/constitution.md` v1.0.1, portes `node scripts/check.js` + `npx -y eslint@9.39.5 .` + audits navigateur (`scripts/ux-audit.js`, `scripts/kbd-audit.js`, `scripts/parcours-check.js`). Mesuré le 2026-10-02 au commit 87c2948 : check.js et ESLint verts.
- **Cartographie** : `.planning/codebase/` (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS). Intel ingérée : `.planning/intel/` (37 documents), rapport `.planning/INGEST-CONFLICTS.md`.
- **Références de premier rang** (hors corpus ingéré, repris par la cartographie) : `AGENTS.md`, `docs/SCHEMA.md` (schéma + glossaire FR/NL), `docs/RUNBOOK.md` (incidents ; § 7 commande par e-mail ; § 8 fin de période de test), `docs/TRANSFERT.md`, `IDEAS.md`.
- **Fin de période de test** : jusqu'au 2026-10-02 toutes les commandes étaient des essais ; le vrai stock a été encodé ; trois vrais clients ont déjà commandé (spec 021, FR-012).
- **Données catalogue réelles** : 69 produits ; `Kaliber` contient parfois des poids (« 0.800 ») ; 56 produits sur 69 en catégorie « Algemeen » (spec 019).
- **Lots** : le portail gère déjà les lots (`Lots`, instantané à la préparation, mentions du règl. 1379/2013 art. 35 sur le bon de livraison, rappel lot → clients ; `lib/trace.js`, `team/lots.html`) ; il manque la transmission numérique au client.
- **Actions en attente chez le propriétaire** : nettoyage des tests (Beheer → Systeemstatus) ; avis du comptable (exports déjà envoyés ? remise à zéro de la numérotation ? note de ligne UBL BT-127 pour le conditionnement) ; réglages Resend inbound (RUNBOOK § 7.1).
- **Risques connus** : tous les comptes de service au nom d'une seule personne (`docs/COMPTES.md`) ; plans gratuits Neon (restauration 6 h) et Resend (≈ 25 commandes/jour) ; détail `.planning/codebase/CONCERNS.md`.

## Constraints

- **Tech stack** : HTML statique + JS vanilla, fonctions Vercel CommonJS, modules intégrés de Node + `fetch` ; aucun `package.json`, bundler ni dépendance npm — ADR 0001, constitution § I (un seul développeur à la fois, zéro chaîne d'outils).
- **Sécurité** : le serveur décide (prix, TVA, stock, numéros, droits, états) ; `lib/guard.js` + session en tête de chaque écriture ; fail-closed ; aucun secret dans le code, les logs, l'URL, le storage — constitution § II.
- **Tests** : toute règle métier a un test écrit avant ou avec le code ; aucune écriture vers la production ; aucun test désactivé — constitution § III.
- **Langue et terrain** : personnel et Beheer en néerlandais, client NL/FR (`K.t()`), documents dans la langue du client, valeurs de base en français ; WCAG 2.2 AA ; cibles ≥ 44 px (gants, tablette) — constitution § IV.
- **Données et conformité** : `docs/SCHEMA.md` + `scripts/fake-airtable.js` à jour dans le même commit ; facture émise jamais modifiée ; RGPD export/anonymisation pour toute donnée personnelle — constitution § V.
- **Facturation** : documents FA/CN du portail internes ; factures légales chez le comptable (Billtobox) — ADR 0005.
- **Livraison** : branche de travail, commits en français, PR en brouillon, CI verte avant fusion ; push sur `main` = production.
- **Budget** : ≈ 20 à 50 $/mois d'exploitation (`docs/COUTS.md`) ; Anthropic plafonné (`INBOUND_AI_DAILY_MAX`).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Constitution v1.0.1 : cinq principes non négociables | Garder un portail simple, sûr et vérifiable par un développeur à la fois | ✓ Good |
| ADR 0001 — pas de build, pas de dépendances npm | Zéro chaîne d'outils à maintenir, audit de dépendances quasi nul | ✓ Good |
| ADR 0002 — Airtable puis Neon via `lib/at-engine.js` | Sortir des limites Airtable sans réécrire ~140 appels ; bascule faite | ✓ Good |
| ADR 0003 — sessions signées, cookie client HttpOnly (spec 013) | Le mot de passe ne circule qu'une fois ; XSS ne peut plus emporter le jeton | ✓ Good (transition jeton-corps jusqu'au 31/10/2026) |
| ADR 0004 — numérotation CMD/FA/CN, compteur atomique FA/CN | Séries lisibles par année ; FA/CN sans doublon ni trou inexpliqué | ⚠️ Revisit (CMD sans dédoublonnage si plusieurs canaux en parallèle) |
| ADR 0005 — facturation légale chez le comptable (Billtobox), pas de Peppol depuis le portail | Pas de responsabilité légale de numérotation ni de Peppol dans le portail | ✓ Good — VERROUILLÉE (reconfirmée 2026-10-02) |
| Coexistence : `.planning/` (pilotage GSD/VibeFlow) **référence** la méthode spec-kit, il ne la remplace pas. Chaque phase de la ROADMAP se réalise par une ou plusieurs specs `specs/NNN-nom/` (spec → plan avec Constitution Check → tasks → implement) ; constitution, tests d'abord, `node scripts/check.js`, ESLint 9.39.5 et audits navigateur restent la règle de qualité du dépôt | Une seule règle de qualité ; `.planning/` apporte la feuille de route, l'état et la traçabilité entre sessions | — Pending (décidée à l'intégration, 2026-10-02) |
| `.planning/config.json` : `commit_docs: false` jusqu'à décision du propriétaire | Pas de commit automatique ; `.vercelignore` n'exclut pas encore `/.planning` (un `config.json` commité serait publié) | — Pending |

## Evolution

Après chaque transition de phase : exigences invalidées → Out of Scope avec raison ; exigences livrées → Validated avec la phase et la spec ; nouvelles exigences → Active ; décisions → Key Decisions ; « What This Is » revu.
Après chaque jalon : revue complète, Core Value, Business Context, Out of Scope, Context.

---
*Last updated: 2026-10-02 after onboarding brownfield (cartographie + ingestion de 37 documents + création du socle)*
