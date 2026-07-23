# AGENTS.md

## Cursor Cloud specific instructions

FAMO Portail is a static HTML site (repo-root `*.html`, vanilla JS) plus Vercel
serverless functions in `api/*.js` (Node CommonJS, `module.exports = async (req, res) => {}`).
Airtable is the only data backend; there is no local database. There is **no
`package.json` and no lockfile** — the code uses only Node built-ins plus global
`fetch`, and ESLint is fetched on demand via `npx`. Target runtime is Node 22.

### Test / lint / build
- Test (business rules + syntax): `node scripts/check.js`. This is the primary gate
  (mocks `fetch`, needs no external services). CI runs the same on push/PR to `main`.
- Lint: `npx eslint@9 api/` (flat config in `eslint.config.js`; only `api/`).
- Build: none — nothing is compiled or bundled.
- Pre-push (from `CONTRIBUER.md`): `node scripts/check.js && npx eslint api/`.

### Run locally
- `node scripts/dev-server.js` serves the static pages and routes `/api/*` to the
  serverless handlers on `http://localhost:3000` (set `PORT` to change). This harness
  reproduces the Vercel function contract (`req.query`, JSON `req.body`,
  `res.status().json()`); it exists because `vercel dev` requires Vercel login/linking
  that isn't available headless.
- Staff auth: `POST /api/session` with `{"code": "..."}`. `STAFF_CODE` env var, or
  fallback `famo2026` if unset (temporary product decision, see `lib/staffauth.js`).
  The session is an HttpOnly+Secure cookie; browsers treat `http://localhost` as a
  secure context, so the cookie works over plain http locally.
- `AIRTABLE_TOKEN` is required for real Clients/Catalogue/Commandes/Stock data. Without
  it, endpoints degrade gracefully rather than crashing (e.g. `/api/allorders` returns
  `{"orders":[]}`), so the staff cockpit renders but shows empty/zero data. Customer
  login and order/stock write flows need a valid token pointing at the expected base.
