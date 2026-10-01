# AGENTS.md

## Cursor Cloud specific instructions

FAMO Portail is a static HTML site (repo-root `*.html`, vanilla JS) plus Vercel
serverless functions in `api/*.js` (Node CommonJS, `module.exports = async (req, res) => {}`).
Production data lives in Postgres (Neon, `DB_BACKEND=postgres`); Airtable is the code's
historical default and is no longer used in production. SQLite is available for local
runs and tests (see below). There is **no `package.json` and no lockfile** — the code uses
only Node built-ins plus global `fetch`, and ESLint is fetched on demand via `npx`.
Runtimes: CI runs Node 22; Vercel runs the functions on the Node version set in the
project settings (24.x as of 2026-09-27). `node:sqlite` (tests / local SQL engine only)
needs a recent Node 22.

### Spec-driven workflow (github/spec-kit)
- Every change starts as `specs/NNN-name/` (spec.md → plan.md with Constitution Check → tasks.md), then code.
  Skills: `.claude/skills/speckit-*` (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`).
- Rules that every spec must respect: `.specify/memory/constitution.md` (no build, server decides, tests first
  and local-only writes, NL/FR + WCAG 2.2 AA + 44 px, schema/RGPD).
- Done so far: 001 badges, 002 visual identity « Vismijn » (see DESIGN.md), 003 VAT regime + VIES,
  004 multiple credit notes + correction mail, 005 personal-PIN-only, 006 tech debt (Beheer split, parseLines).
- Beheer API: `api/onboarding.js` is only the entry point (guard, admin session, audit journal); actions live
  in `lib/beheer/*.js` (one module per domain, static `require`s for Vercel nft; `test/beheer-routes.test.js`).

### Test / lint / build
- Test (business rules + syntax + unit tests): `node scripts/check.js`. This is the primary
  gate (mocks `fetch`, needs no external services). CI runs it on every push (all branches)
  and every pull request (`.github/workflows/check.yml`).
- Lint: `npx -y eslint@9.39.5 .` (pinned; flat config in `eslint.config.js` with the
  `eslint:recommended` rules except `no-useless-escape` and `no-regex-spaces`; server AND
  browser code, vendor excluded).
- Browser audit: `node scripts/ux-audit.js` against `node scripts/dev.js` (needs Playwright;
  CI job « Navigateur » installs `playwright@1.56.1` outside the repo and sets `NODE_PATH`).
- Build: none — nothing is compiled or bundled.
- Pre-push (from `CONTRIBUER.md`): `node scripts/assets-version.js && node scripts/check.js && npx -y eslint@9.39.5 .`.

### Run locally
- `node scripts/dev.js` (port 4200) is the usual entry point: fake Airtable + fake Resend,
  demo data created on first run in `.dev-data/` (never commit it; `FAMO_RESEED=1` resets
  it), codes `team-dev-code` / `beheer-dev-code`, client `aloha` / `welkom123`.
- `node scripts/dev-server.js` alone serves the static pages and routes `/api/*` to the
  serverless handlers on `http://localhost:3000` (set `PORT` to change), without fake
  services. This harness reproduces the Vercel function contract (`req.query`, JSON
  `req.body`, `res.status().json()`); it exists because `vercel dev` requires Vercel
  login/linking that isn't available headless. Its start banner says when
  `STAFF_CODE` is unset (there is no fallback code).
- Staff auth: `POST /api/session` with `{"code": "..."}`. At least one of `STAFF_CODE` /
  `ADMIN_CODE` must be set (fail-closed, no fallback: with neither, `/api/session` and staff
  APIs return 500; without `ADMIN_CODE`, `adminOk` is always false, so Beheer is closed even for a beheerder PIN; see
  `lib/staffauth.js`). Codes stored from Beheer → Toegang (hashed in Configuratie) replace
  the env code for that role; personal PINs (table `Medewerkers`) are also accepted.
  With Beheer → Toegang « Enkel persoonlijke pincodes » (Configuratie `Enkel persoonlijke PIN`,
  audit L-06) shared codes are refused (401) and only PINs log in, except the env `ADMIN_CODE`
  as logged break-glass (Beheer login page, admin role, name « Noodtoegang »; see
  `docs/RUNBOOK.md` § 6 and `test/pinonly.test.js`).
  The session is an HttpOnly+Secure cookie signed with `SESSION_SECRET` (or, if unset, a
  secret derived from the codes and the DB credentials); browsers treat `http://localhost`
  as a secure context, so the cookie works over plain http locally.
- Data backend switch: `DB_BACKEND` (`airtable` default, `postgres` via `DATABASE_URL`,
  `sqlite` for local/tests). `lib/datastore.js` routes the Airtable REST calls to
  `lib/at-engine.js` when not `airtable`; business code in `api/` is unchanged.
  `DB_BACKEND=sqlite node scripts/dev.js` runs the whole portal on the SQL engine.
  `DB_BACKEND=postgres` without a valid `DATABASE_URL` answers 500 `DATABASE_NOT_CONFIGURED`
  (never a silent fallback to Airtable).
- Without a reachable data backend (e.g. `DB_BACKEND` unset and no valid `AIRTABLE_TOKEN`),
  endpoints do NOT degrade to empty data: Airtable answers 401 and e.g. `/api/allorders`
  returns 500 `{"error":"Authentication required"}`. Use `node scripts/dev.js` (fake
  Airtable) or `DB_BACKEND=sqlite` for local work.
- Tables, fields and FR/NL glossary: `docs/SCHEMA.md`. Incidents: `docs/RUNBOOK.md`.
