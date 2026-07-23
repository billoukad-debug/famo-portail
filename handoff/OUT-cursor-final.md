# OUT — Cursor final (P0 after Codex)

## Décision
**MERGEABLE AFTER P0 FIXES** — P0 Codex traités dans ce commit. Attendre encore Claude deploy si disponible ; sinon merge possible **si** `STAFF_CODE` est bien défini sur Vercel (Production + Preview).

## Fixes appliqués
- `lib/staffauth.js` — plus de fallback `famo2026` ; fail-closed sans `STAFF_CODE`
- `staffOk(req)` cookie-only ; login via `codeEquals` uniquement dans `POST /api/session`
- APIs : `allorders`, `stock`, `updateorder`, `staff`, `onboarding`, `config` — plus de `query.code` / `body.code`
- `documents.js` / `documenten.html` — facture gated `canInvoice()` (IBAN+BIC+nom) ; plus d’identité hardcodée
- `check.js` + `workflow-check.js` — tests négatifs fail-closed + `?code=` → 401
- Hint Aan de slag : configure `STAFF_CODE` (plus de famo2026)

## P0 restants
- Unification totale Magazijn `doc()` ↔ `FamoDocuments` (P1/architecture) — Magazijn gate déjà OK ; Documenten aligné sur IBAN/BIC
- Rate-limit `api/orders.js` (P2 Codex) — hors P0 immédiat

## Pré-merge obligatoire (humain)
1. Vérifier `STAFF_CODE` non vide sur Vercel Prod + Preview (**sinon staff 500**)
2. Se reconnecter staff (anciennes sessions signées avec l’ancien secret deviennent invalides si le code change)
3. Smoke : login staff, Documenten facture sans IBAN = bloqué, avec IBAN = OK

## Backlog conscient post-merge
Lots A/B/C inchangés (Invoeren, Leveringen, creditnota Airtable, CRM…).
