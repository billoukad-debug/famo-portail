---
name: famo-coherence-verify
description: Use when verifying FAMO coherence phases 1–4 claims, auditing liar UX bugs, or checking PR #7 against the bancale #1–#101 inventory. Static code verification skill.
disable-model-invocation: true
---

# Famo — Coherence verify (phases 1–4)

Verify claimed fixes. Do not implement new backlog items.

## Reference
- PR: https://github.com/billoukad-debug/famo-portail/pull/7
- Branch: `cursor/fix-coherence-phase1-a47d`
- Inventory: 101 gaps in agent audit (bancale). Only ~⅓ claimed done.
- Orchestration: `handoff/00-ORCHESTRATION.md`
- Full Codex-style checklist: `handoff/01-CODEX-VERIFY.md`

## Method
1. `git diff origin/main...HEAD --stat`
2. For each claimed item in phases 1–4, open the file and confirm behavior exists.
3. Status per claim: `DONE` | `PARTIAL` | `MISSING` | `REGRESSION`
4. Flag weak `scripts/check.js` regexes that could pass while UX is still broken.

## Claim groups (short)
- **P1:** documenten mobile, Open chip, URL sync, Magazijn error, lowThreshold preserve, takeReturn, POD honesty
- **P2:** entrepot `?id=`, Dag links, Ontvangst sheet, Factuur gate
- **P3:** stock threshold+history, documents setCompany/IBAN, creditnota voorbeeld
- **P4:** client sessionStorage, public config contact, date rules, mobile Wissen, edit client, deletePrice, deactivate product, NL categories, richer setup banner

## Explicit still-OPEN (do not fail the PR for these alone)
Invoeren #54–61, Leveringen #62–69, order line edit/cancel #34–39, real creditnota API #79–80, CRM/roles/offline/E2E #96–101.

## Output
If used alone, write findings into the chat and optionally `handoff/OUT-claude-coherence.md`.
When used after `/famo-deploy-checklist`, merge coherence findings into `handoff/OUT-claude-deploy.md` section “Cohérence”.
