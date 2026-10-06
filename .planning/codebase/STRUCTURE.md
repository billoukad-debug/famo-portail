---
last_mapped_commit: 87c2948d2b10ce5ae0c5e27550fcc1197acbf17e
last_mapped_at: 2026-10-02
---
# Codebase Structure

**Analysis Date:** 2026-10-02

## Directory Layout

```
famo-portail/
├── index.html klant.html aanvraag.html wachtwoord.html privacy.html voorwaarden.html offline.html
│                     # portail client (/, /klant, /aanvraag, /wachtwoord…) et page hors ligne
├── beheer.html       # Beheer (/beheer)
├── beheer/           # aanmelden.html (connexion Beheer), rapportage.html (spec 022)
├── team/             # personnel : aanmelden, bestellingen, bestelling, magazijn, leveringen, invoeren, documenten, voorraad, lots
├── api/              # 28 fonctions serverless Vercel (une route = un fichier)
├── lib/              # règles métier serveur ; sous-dossiers par domaine
│   ├── commande/     # cycle de vie d'une commande (updateorder) : bijwerken, corrigeren, creditnota, correctiemail, lignes, stock, nummering
│   ├── beheer/       # actions Beheer (onboarding) : config, producten, klanten, klantgebruikers, prijzen, toegang, testperiode
│   └── inbound/      # commande par e-mail : svix, resend, claude, mailorder
├── assets/
│   ├── ui.css        # LA feuille de style
│   ├── ui.js         # LA couche partagée (objet K)
│   ├── vat.js rapport.js proof.js offline-queue.js drag.js   # modules navigateur partagés
│   ├── pages/        # un script par page (+ staff-common.js, beheer.js, aanmelden.js)
│   │   ├── team/     # un script par page du personnel
│   │   └── beheer/   # rapportage.js
│   ├── docs/         # documents.js, bedrijf.js, voorbeeld.js (A4, PDF)
│   ├── brand/ icons/ fonts/
├── vendor/           # html2pdf.bundle.min.js (seule exception vendorisée)
├── scripts/          # check.js (porte principale), dev.js, dev-server.js, fakes, audits navigateur, seed.js
├── test/             # tests unitaires node --test (*.test.js)
│   └── workflow/     # scénarios métier, un fichier par domaine + _helpers.js + inventaire.test.js
├── docs/             # SCHEMA.md, RUNBOOK.md, COMPTES.md, TRANSFERT.md, COUTS.md, CHECKLIST-UX.md, adr/
├── specs/            # spec-kit : NNN-nom/{spec.md, plan.md, tasks.md, checklists/} (001…023)
├── .specify/         # spec-kit : memory/constitution.md, templates, scripts bash
├── .claude/skills/   # skills speckit-* partagés (le reste de .claude/ est ignoré par git)
├── .github/workflows/check.yml   # CI
├── .planning/        # socle GSD/VibeFlow (pilotage), référence la méthode spec-kit sans la remplacer
├── vercel.json .vercelignore eslint.config.js manifest.webmanifest sw.js robots.txt
└── AGENTS.md README.md CONTRIBUER.md DESIGN.md IDEAS.md VERCEL_CHECKLIST.md LICENSE
```

## Directory Purposes

**`api/`:**
- Purpose : contrat HTTP de chaque route
- Contains : handlers CommonJS ; première ligne `require("../lib/datastore")`
- Key files : `api/order.js`, `api/updateorder.js`, `api/onboarding.js`, `api/allorders.js`, `api/catalogue.js`, `api/session.js`, `api/lots.js`, `api/export.js`, `api/inbound-mail.js`, `api/rapportage.js`, `api/health.js`, `api/dbadmin.js`

**`lib/`:**
- Purpose : logique métier partagée (serveur)
- Key files : `lib/datastore.js`, `lib/at-engine.js`, `lib/airtable.js`, `lib/staffauth.js`, `lib/clientauth.js`, `lib/guard.js`, `lib/bestelling.js`, `lib/levering.js`, `lib/billing.js`, `lib/trace.js`, `lib/ordermail.js`, `lib/ubl.js`, `lib/testorders.js`

**`assets/pages/`:**
- Purpose : comportement de chaque page ; l'arborescence suit l'URL (`/team/magazijn` = `team/magazijn.html` + `assets/pages/team/magazijn.js`)

**`test/` et `test/workflow/`:**
- Purpose : tests unitaires (SQLite en mémoire, mocks `fetch`) et scénarios métier par domaine (beheer, commandes, corrections, emails-documents, facturation, interface, portail-client, portail-client-wachtwoord, preparation-livraison, sessions-roles)

**`specs/`:**
- Purpose : une évolution = un dossier spec-kit `NNN-nom/` (spec → plan avec Constitution Check → tasks), puis code

## Key File Locations

**Entry Points:**
- `index.html` : accueil + connexion client
- `team/aanmelden.html` : connexion personnel
- `beheer/aanmelden.html` : connexion Beheer (break-glass `ADMIN_CODE` en mode PIN seul)
- `scripts/dev.js` : banc local complet (port 4200)

**Configuration:**
- `vercel.json` : région, crons, en-têtes, CSP, `cleanUrls`, redirections
- `.vercelignore` : fichiers non déployés
- `eslint.config.js` : lint
- `.github/workflows/check.yml` : CI

**Core Logic:**
- `lib/commande/` : statuts, stock, numérotation FA/CN, creditnota
- `lib/bestelling.js` : lignes de commande décidées par le serveur (tous canaux)
- `assets/vat.js` : TVA et conditionnement (règle unique écran/documents/serveur)

**Testing:**
- `scripts/check.js` : porte principale (syntaxe, CSP, secrets, liens, NL, styles en ligne, `?v=`, contrastes, tests, scénarios)
- `scripts/workflow-check.js` : scénarios métier en parallèle (un processus par fichier)

## Naming Conventions

**Files:**
- Pages et scripts de page en néerlandais, nom = segment d'URL : `team/leveringen.html`, `assets/pages/team/leveringen.js`
- Modules serveur courts, minuscules, sans tiret ou avec tiret : `lib/ordermail.js`, `lib/at-engine.js`, `lib/lignesjson.js`
- Tests : `test/<domaine>.test.js`, `test/workflow/<domaine>.test.js`
- Specs : `specs/NNN-nom-en-francais/`

**Directories:**
- Minuscules, par domaine métier (`commande`, `beheer`, `inbound`) ou par portail (`team`, `beheer`)

## Where to Add New Code

**Nouvelle fonctionnalité :**
- Commencer par `specs/NNN-nom/` (`/speckit-specify` → `/speckit-plan` → `/speckit-tasks`), constitution respectée
- Règle métier : `lib/<domaine>.js` ou `lib/<domaine>/<action>.js` ; route : `api/<route>.js` (garde + session en tête)
- Tests : `test/<domaine>.test.js` (SQLite en mémoire) ou un `test()` dans `test/workflow/<domaine>.test.js` — écrits avant ou avec le code

**Nouvelle action Beheer :**
- Implementation : un module `lib/beheer/*.js` (exporter `ACTIONS` et `run`), `require` statique dans `api/onboarding.js`, test dans `test/beheer-routes.test.js`

**Nouvelle page :**
- `team/<nom>.html` ou racine, script `assets/pages/[team/]<nom>.js`, `ui.css` + `ui.js` + viewport obligatoires, lien en URL propre, `node scripts/assets-version.js`

**Nouveau champ ou table :**
- `docs/SCHEMA.md` et `scripts/fake-airtable.js` dans le même commit ; export/anonymisation RGPD si donnée personnelle

**Utilities :**
- Navigateur : `assets/ui.js` (K) ; staff : `assets/pages/staff-common.js` (S) ; jamais de helper par page dupliqué

## Special Directories

**`.dev-data/`:**
- Purpose : données locales du banc (`airtable.json`)
- Generated : Yes (`scripts/seed.js`)
- Committed : No (gitignore)

**`.claude/worktrees/`:**
- Purpose : worktrees d'agents (5 présents au 2026-10-02, branches `worktree-agent-*`)
- Generated : Yes
- Committed : No

**`vendor/`:**
- Purpose : bundle tiers figé (html2pdf)
- Generated : No
- Committed : Yes (exclu du lint)

**`.planning/`:**
- Purpose : pilotage GSD/VibeFlow (PROJECT, ROADMAP, STATE, REQUIREMENTS, codebase/)
- Generated : par l'outillage de planification
- Committed : à décider par le propriétaire (non commité à la création, 2026-10-02) ; non exclu par `.vercelignore` hors `*.md` → `.planning/config.json` serait déployé s'il était commité (voir CONCERNS)

---

*Structure analysis: 2026-10-02*
