# OUT — Cursor final (Codex + Claude)

## Décision
**MERGEABLE** sous conditions ops Vercel/Airtable — **pas de P0 code restant** sur `38618aa`.

Claude a audité `0dea738` (avant P0). Codex a demandé les P0 auth → déjà patchés ensuite (`7619c3e` / `38618aa`).

## Synthèse des 2 rapports

| Source | Verdict | Action |
|---|---|---|
| Codex (`eecc6c4`) | **NO-GO** — famo2026 + `?code=` + facture Documenten | ✅ Corrigé |
| Claude (`0dea738`) | **READY WITH WARNINGS** — env/ops | Warnings encore valides côté Vercel |

## Déjà fait (post-Codex)
- Fail-closed `STAFF_CODE` (plus de fallback `famo2026`)
- Cookie-only staff APIs
- Facture Documenten gated IBAN+BIC
- Checks négatifs verts (`node scripts/check.js`)

## Checklist humaine avant merge (Claude §5, à jour)
1. CI verte sur PR #7
2. **`STAFF_CODE`** défini Prod + Preview (**critique** — sans ça staff = 500 maintenant)
3. **`AIRTABLE_TOKEN`** Prod + Preview
4. Schéma Airtable : `Seuil bas`, `Mouvements de stock`, `Configuratie`, `Stock afgeboekt`, `Réceptionné par`, `Livraison confirmée`, `Factuurnummer`
5. Smoke Preview S1–S9
6. `curl …/api/config?public=1` → **pas** d’iban/bic
7. Relire description PR

## Non bloquant / accepté
- Client `sessionStorage` credentials (W2 Claude) — design phase 4
- Unification totale Magazijn `doc()` ↔ `FamoDocuments` — follow-up
- Backlog #54–101 hors PR

## Go/No-go
**GO code.** Merge OK quand les points ops 1–4 sont confirmés par toi.
