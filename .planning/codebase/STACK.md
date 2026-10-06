---
last_mapped_commit: 87c2948d2b10ce5ae0c5e27550fcc1197acbf17e
last_mapped_at: 2026-10-02
---
# Technology Stack

**Analysis Date:** 2026-10-02

> Langue : titres de section GSD en anglais (outillage), contenu en français (langue de la documentation du dépôt).
> Source de vérité du dépôt : `AGENTS.md`, `.specify/memory/constitution.md`, `docs/adr/0001-sans-build-sans-dependances.md`.

## Languages

**Primary:**
- JavaScript (ES2023, CommonJS côté serveur) - fonctions serverless `api/*.js`, règles métier `lib/**/*.js`, scripts `scripts/*.js`, tests `test/**/*.test.js`
- JavaScript (ES2023, scripts navigateur classiques, pas de modules ES) - `assets/ui.js`, `assets/vat.js`, `assets/rapport.js`, `assets/pages/**/*.js`, `assets/docs/*.js`
- HTML5 statique - pages racine (`index.html`, `klant.html`, `beheer.html`, `aanvraag.html`, `wachtwoord.html`, `privacy.html`, `voorwaarden.html`, `offline.html`), `team/*.html`, `beheer/*.html`
- CSS - une seule feuille `assets/ui.css` (jetons « Vismijn », composants, responsive, print, hoog contrast)

**Secondary:**
- Bash - outillage spec-kit `.specify/scripts/bash/*.sh` (hors produit)
- SQL (dialecte Postgres / SQLite) - schéma interne du moteur `lib/at-engine.js` (`SCHEMA_SQL`)

## Runtime

**Environment:**
- Node.js 22 en CI (`.github/workflows/check.yml`, `node-version: 22`) ; v22.22.2 sur le poste d'analyse
- Node.js 24.x sur Vercel (réglage du projet, au 2026-09-27)
- `node:sqlite` (intégré, Node 22 récent) réservé aux tests et au banc local
- Navigateurs : evergreen ; `fetch`, `localStorage`/`sessionStorage` (toujours sous `try/catch`), Service Worker `sw.js`

**Package Manager:**
- Aucun. Pas de `package.json`, pas de lockfile, pas de `node_modules` (règle non négociable, constitution § I).
- Outils lancés à la demande, version figée : `npx -y eslint@9.39.5 .` ; Playwright 1.56.1 installé hors du dépôt (`NODE_PATH`).

## Frameworks

**Core:**
- Aucun framework. HTML + CSS + JavaScript vanilla ; couche partagée maison `assets/ui.js` (objet global `K`) et `assets/pages/staff-common.js` (objet global `S`).
- Contrat de fonction Vercel : `module.exports = async (req, res) => {}` (Node CommonJS).

**Testing:**
- `node:test` + `node:assert` (intégrés) - tests unitaires `test/*.test.js` et scénarios métier `test/workflow/*.test.js`
- Playwright 1.56.1 (hors dépôt) - audits navigateur `scripts/ux-audit.js`, `scripts/kbd-audit.js`, `scripts/parcours-check.js`

**Build/Dev:**
- Pas de build, pas de bundler, pas de minification.
- `scripts/assets-version.js` - réécrit les suffixes de cache `?v=<hash>` des CSS/JS après toute modification front
- `scripts/dev.js` - portail local (port 4200) avec faux Airtable (`scripts/fake-airtable.js`), faux Resend (`scripts/fake-resend.js`), faux Anthropic (`scripts/fake-anthropic.js`)
- `scripts/dev-server.js` - serveur statique + routage `/api/*` reproduisant `cleanUrls` et les redirections de `vercel.json`
- ESLint 9.39.5 (configuration plate `eslint.config.js`, règles `eslint:recommended` recopiées sauf `no-useless-escape` et `no-regex-spaces`)

## Key Dependencies

**Critical:**
- Aucune dépendance npm à l'exécution. Seuls les modules intégrés de Node (`crypto` pour HMAC/scrypt, `zlib`, `node:sqlite` en local) et le `fetch` global.
- `vendor/html2pdf.bundle.min.js` - seule exception vendorisée (PDF côté navigateur), copie locale, aucune origine tierce (ADR 0001).

**Infrastructure:**
- `lib/sql.js` - client Neon par HTTPS avec le `fetch` natif (pas de driver `pg`)
- `lib/at-engine.js` + `lib/at-formula.js` - moteur qui rejoue le protocole REST Airtable sur SQL (table unique `famo_records`, fichiers `famo_files`)
- `assets/fonts/atkinson-hyperlegible-next-latin.woff2` - police auto-hébergée (CSP `font-src 'self'`)

## Configuration

**Environment:**
- Variables Vercel lues par `api/` et `lib/` (liste vérifiée par `grep -rhoE "process\.env\.[A-Z_]+" api lib`) :
  `DB_BACKEND`, `DATABASE_URL` / `POSTGRES_URL`, `NEON_HTTP_URL`, `STAFF_CODE`, `ADMIN_CODE`, `SESSION_SECRET`,
  `AIRTABLE_TOKEN`, `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_TIMEOUT_MS`, `PORTAL_URL`, `CRON_SECRET`, `BACKUP_EMAIL`,
  `BACKUP_MAX_BYTES`, `BACKUP_MAIL_TIMEOUT_MS`, `RESEND_INBOUND_SECRET`, `RESEND_FETCH_TIMEOUT_MS`,
  `ANTHROPIC_API_KEY`, `ANTHROPIC_TIMEOUT_MS`, `ANTHROPIC_FALLBACKS`, `INBOUND_AI_DAILY_MAX`, `FAMO_LOG_STACK`,
  `VERCEL`, `VERCEL_REGION`, `VERCEL_GIT_COMMIT_SHA`.
- Local seulement : `FAMO_DEV_HTTP`, `DB_SQLITE_FILE`, `PORT`, `FAMO_RESEED`, `FAMO_REAL`.
- Détail des valeurs attendues : `VERCEL_CHECKLIST.md` et `README.md` § Variables d'environnement. `.env*` est ignoré par git (jamais lu ici).
- Réglages métier en base (table `Configuratie`, Beheer → Bedrijfsgegevens) : deadline, jours de livraison, minimum, TVA, lots obligatoires, relances, commande par e-mail…

**Build:**
- `vercel.json` - région `fra1`, deux crons, `maxDuration` de trois fonctions, en-têtes de sécurité (CSP stricte `script-src 'self'`), `cleanUrls`, redirections permanentes des anciennes URL `.html`
- `.vercelignore` - exclut du déploiement `/scripts`, `/test`, `/docs`, `/.github`, `*.md`, `/.claude`, `/.specify`, `/specs`, `.env*`, `/.dev-data`
- `eslint.config.js` - lint serveur (CommonJS) et navigateur (script) ; `vendor/**` exclu

## Platform Requirements

**Development:**
- Node 22 récent (pour `node:sqlite`), git. Aucune installation de dépendance.
- Optionnel : Playwright 1.56.1 + Chromium installés hors dépôt pour les audits navigateur (`CONTRIBUER.md`).

**Production:**
- Vercel (site statique + fonctions, région `fra1`, plan Pro requis pour un usage commercial, `docs/COUTS.md`)
- Neon Postgres (`DB_BACKEND=postgres`)
- Resend (envoi d'e-mails ; réception pour la spec 020, non activée)
- Domaine et DNS chez one.com

---

*Stack analysis: 2026-10-02*
