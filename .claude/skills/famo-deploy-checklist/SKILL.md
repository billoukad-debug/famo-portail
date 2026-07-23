---
name: famo-deploy-checklist
description: Use when preparing to merge or deploy FAMO Portail (Vercel + Airtable), reviewing PR #7 coherence pack, or verifying release readiness. Deploy/merge checklist for staff+client portal.
disable-model-invocation: true
---

# Famo Portail — Deploy checklist

Run this before merging `cursor/fix-coherence-phase1-a47d` into `main` or promoting a Vercel production deploy.

## 0. Identity
- Repo: `billoukad-debug/famo-portail`
- PR under review: https://github.com/billoukad-debug/famo-portail/pull/7
- Branch: `cursor/fix-coherence-phase1-a47d`
- Stack: static HTML/JS + Vercel serverless `api/*.js` + Airtable

## 1. Git / CI gate
- [ ] On correct branch; `git log origin/main..HEAD` shows Phase 1–4 commits
- [ ] `node scripts/check.js` exits 0 (includes `workflow-check.js`)
- [ ] No unintended secrets in diff (`AIRTABLE_TOKEN`, passwords, staff codes)
- [ ] Draft PR description matches actual commits

## 2. Environment (Vercel) — document presence, never print values
- [ ] `AIRTABLE_TOKEN` set in Production + Preview
- [ ] `STAFF_CODE` set (via `lib/staffauth.js` only; no hardcoded fallbacks in `api/*`)
- [ ] No new required env vars introduced without noting them in the report
- [ ] Preview deploy can hit Airtable (same base `appcdduLth9iGX8I0` unless overridden)

## 3. API surface changed in this PR — regression scan
Read and sanity-check:
- [ ] `api/stock.js` — `GET ?history=1`, `POST lowThreshold`, journal only if qty changes
- [ ] `api/config.js` — `?public=1` returns contact fields **without** `iban`/`bic`
- [ ] `api/catalogue.js` — login response includes `company` (no secrets)
- [ ] `api/onboarding.js` — `deletePrice`, `saveClient` with `id`, `actif:false` still safe

Fail the checklist if public config leaks IBAN/BIC.

## 4. Business invariants (must still hold)
- [ ] Server-side prices on order create
- [ ] Stock deducted once on Sortie (`afgeboekt` / equivalent guard)
- [ ] Recipient required before delivery confirmed / invoice path
- [ ] `factuurnummer` allocated once
- [ ] Staff auth via cookie session — no `?code=` in staff page URLs

Evidence: `scripts/workflow-check.js` scenarios + spot-read `api/updateorder.js` / `api/order.js`.

## 5. UX honesty gates (phases 1–4)
- [ ] No native `alert`/`confirm`/`prompt` on staff HTML
- [ ] Documenten mobile cards visible
- [ ] Magazijn load error visible
- [ ] Order/Dag CTAs deep-link Magazijn `?id=`
- [ ] Ontvangst uses shared sheet (`staff-delivery.js`)
- [ ] Factuur button gated on `factuurnummer`
- [ ] Creditnota labeled voorbeeld / not booked
- [ ] Client session restore + date guards + mobile Wissen

## 6. Smoke matrix
Mark each: PASS / FAIL / NEEDS_PROD / N/A

| # | Scenario |
|---|---|
| S1 | Staff login → Bestellingen |
| S2 | Order validation CTA → Magazijn focused card |
| S3 | Ontvangst in-place |
| S4 | Factuur hidden without number |
| S5 | Stock edit Grens + history |
| S6 | Documenten company/IBAN + creditnota banner |
| S7 | Client refresh session + Sunday blocked + mobile Wissen |
| S8 | Aan de slag edit client / delete price / deactivate product |
| S9 | Setup banner when identity or catalogue missing |

## 7. Rollback
- [ ] Note previous production deployment / commit on `main`
- [ ] Rollback plan: redeploy previous Vercel deployment (no Airtable schema migration in this PR — confirm)
- [ ] If stock history filter fails in prod: stock page still loads list; history is additive UX

## 8. Decision
Output exactly one of:
- `READY`
- `READY WITH WARNINGS` (+ list)
- `BLOCKED` (+ P0 list for Cursor)

Write the full report to `handoff/OUT-claude-deploy.md`.
