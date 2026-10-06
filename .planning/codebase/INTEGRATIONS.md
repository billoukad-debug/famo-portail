---
last_mapped_commit: 87c2948d2b10ce5ae0c5e27550fcc1197acbf17e
last_mapped_at: 2026-10-02
---
# External Integrations

**Analysis Date:** 2026-10-02

> Aucun secret n'est reproduit ici : seuls les NOMS de variables sont cités. Les valeurs vivent dans Vercel.

## APIs & External Services

**Base de données (production) — Neon Postgres :**
- Toutes les données métier (commandes, clients, catalogue, stock, lots, journal, configuration).
  - SDK/Client : aucun ; HTTPS avec `fetch` natif (`lib/sql.js`), derrière le moteur `lib/at-engine.js`
  - Auth : `DATABASE_URL` (ou `POSTGRES_URL`), `NEON_HTTP_URL` facultatif
  - Interrupteur : `DB_BACKEND=postgres` ; sans URL valable → 500 `DATABASE_NOT_CONFIGURED`, jamais de repli (`lib/datastore.js`, `test/engine-switch.test.js`)

**Airtable (historique) :**
- Base `appcdduLth9iGX8I0`, plus utilisée en production depuis la bascule (ADR 0002). Lue seulement par la copie/comparaison de Beheer → Systeemstatus (`api/dbadmin.js`).
  - SDK/Client : `lib/airtable.js` (REST, reprises sur 5xx, attente 30 s sur 429)
  - Auth : `AIRTABLE_TOKEN`
  - Le protocole REST Airtable reste le langage interne du code métier (`at(path, opts)`), intercepté par `lib/datastore.js`.

**E-mails sortants — Resend :**
- Confirmation de commande (équipe + client), annulation, onderweg, geleverd, bienvenue, demande d'accès, mot de passe, correction, relances de paiement, sauvegarde nocturne.
  - SDK/Client : `fetch` vers `api.resend.com` (`lib/mail.js`, `lib/ordermail.js`, `lib/authmail.js`, `lib/backupmail.js`, gabarit `lib/maillayout.js`)
  - Auth : `RESEND_API_KEY`, expéditeur `MAIL_FROM`, délai `MAIL_TIMEOUT_MS`
  - Sans clé : aucun e-mail, tout le reste fonctionne ; un échec d'e-mail n'annule jamais une commande.

**E-mails entrants — Resend Receiving (spec 020, livrée mais NON activée en production) :**
- Commande par e-mail à `bestel@orders.famoseafood.be` (sous-domaine `orders`, MX propres).
  - Webhook : `POST /api/inbound-mail` (`api/inbound-mail.js`), signature Svix vérifiée sur le corps brut (`lib/inbound/svix.js`)
  - Lecture du contenu : `lib/inbound/resend.js` (clé `RESEND_API_KEY` en « Full access »)
  - Auth : `RESEND_INBOUND_SECRET` ; absent → 500 fail-closed
  - Mise en place : `docs/RUNBOOK.md` § 7 (réglages chez le propriétaire, en attente)

**IA — Anthropic Claude (spec 020) :**
- Lecture des e-mails de commande : Claude propose, le serveur décide (`lib/inbound/claude.js`, `lib/inbound/mailorder.js`, `lib/bestelling.js`).
  - SDK/Client : `fetch` vers l'API Messages
  - Auth : `ANTHROPIC_API_KEY` ; réglages `ANTHROPIC_TIMEOUT_MS`, `ANTHROPIC_FALLBACKS`, `INBOUND_AI_DAILY_MAX` (défaut 200 lectures/jour)
  - Sans clé : tout passe en file « Te controleren » (`api/mailcontrole.js`)

**VIES (Commission européenne) :**
- Vérification des numéros de TVA intracommunautaires (spec 003, régime TVA) : `lib/vies.js`.

## Data Storage

**Databases:**
- Neon Postgres (production) / SQLite `node:sqlite` (local, tests : `DB_BACKEND=sqlite`, `DB_SQLITE_FILE`, défaut en mémoire) / faux Airtable JSON (`.dev-data/airtable.json`, banc `scripts/dev.js`)
  - Connection : `DATABASE_URL`
  - Client : `lib/at-engine.js` (tables SQL `famo_records` et `famo_files`, concurrence optimiste par `version`), compteur atomique `lib/billing.js` `reserve` (table métier `Compteurs`)

**File Storage:**
- Photos produit (jusqu'à 6 par produit, spec 018), signatures et photos de preuve de livraison : table `famo_files` (base64), servies par `GET /api/foto?id=att…` (cache 1 an). Pas de stockage objet externe.

**Caching:**
- Aucun service. Cache navigateur long par `?v=<hash>` (`scripts/assets-version.js`), cache de session `sessionStorage` côté pages staff (`S.load`), Service Worker `sw.js` pour la page hors ligne.

## Authentication & Identity

**Auth Provider:**
- Maison (aucun fournisseur externe).
  - Personnel/Beheer : cookie `famo_sess` HttpOnly, Secure, SameSite=Lax, 8 h, HMAC (`lib/staffauth.js`) ; codes partagés `STAFF_CODE` / `ADMIN_CODE` ou codes hachés en `Configuratie` ; PIN personnels (`Medewerkers`) ; option « Enkel persoonlijke PIN » avec accès de secours `ADMIN_CODE` journalisé (spec 005).
  - Client : jeton signé dans le cookie `famo_klant` HttpOnly, Secure, SameSite=Strict, Path=/api, 12 h (`lib/clientauth.js`, spec 013) ; mots de passe scrypt ; transition « jeton dans le corps » acceptée jusqu'au 31/10/2026 inclus (`BODY_TOKEN_UNTIL`).
  - Secret HMAC commun : `SESSION_SECRET` (sinon dérivé des codes et des identifiants de base — avertissement `[staffauth] SESSION_SECRET ontbreekt` en local).
  - CSRF : `lib/guard.js` (`blocked(req, res)` : Origin/Referer + JSON exigé) en tête de chaque handler qui écrit.

## Monitoring & Observability

**Error Tracking:**
- Aucun service externe. Sonde de santé `GET /api/health` (sans auth, sans donnée personnelle) prévue pour UptimeRobot / Better Stack.

**Logs:**
- `console.*` structuré via `lib/log.js` (JSON, champ `fn`), lu dans Vercel → Runtime Logs ; journal d'audit métier en base (`lib/journal.js`, Beheer → Journaal ; champ `Correcties` des commandes).

## CI/CD & Deployment

**Hosting:**
- Vercel, région `fra1`. Push sur `main` = déploiement production. Rollback : Instant Rollback (`docs/RUNBOOK.md` § 2).

**CI Pipeline:**
- GitHub Actions `.github/workflows/check.yml`, sur tout push (toutes branches) et toute pull request :
  - job « Tests et lint » : `node scripts/check.js` puis `npx --yes eslint@9.39.5 .`
  - job « Navigateur » : Playwright 1.56.1, `FAMO_RESEED=1 node scripts/dev.js`, `scripts/ux-audit.js`, `scripts/parcours-check.js`, `scripts/kbd-audit.js`
- Vercel déploie sans attendre la CI (Deployment Checks non vérifiés au 2026-09-27, `CONTRIBUER.md`).

## Environment Configuration

**Required env vars (production):**
- `DB_BACKEND=postgres`, `DATABASE_URL`, au moins un de `STAFF_CODE`/`ADMIN_CODE` (fail-closed), `SESSION_SECRET` (recommandée), `CRON_SECRET` (obligatoire pour les deux crons), `RESEND_API_KEY` + `MAIL_FROM` (e-mails), `PORTAL_URL`.
- Spec 020 (à poser par le propriétaire) : `RESEND_INBOUND_SECRET`, `ANTHROPIC_API_KEY`.

**Secrets location:**
- Vercel → Settings → Environment Variables. Inventaire des comptes : `docs/COMPTES.md` (sans secret). Rotation : `docs/RUNBOOK.md` § 5.

## Webhooks & Callbacks

**Incoming:**
- `POST /api/inbound-mail` - Resend `email.received` (Svix), spec 020
- `GET /api/backup-cron` - cron Vercel 02:17 UTC (sauvegarde nocturne par e-mail), protégé par `CRON_SECRET`
- `GET /api/reminders-cron` - cron Vercel 07:43 UTC (relances de paiement, purge des e-mails entrants > 90 j), protégé par `CRON_SECRET`

**Outgoing:**
- Resend (e-mails), Anthropic (lecture des e-mails entrants), VIES (TVA), Neon (HTTPS SQL).
- Aucun envoi Peppol : les factures légales sont émises par le comptable via Billtobox (ADR 0005, décision verrouillée). Le portail fournit seulement des exports CSV/UBL (`api/export.js`, beheerder).

---

*Integration audit: 2026-10-02*
