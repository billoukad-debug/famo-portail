# FAMO — Orchestration à 3 (Codex × Claude Code × Cursor)

## But
Vérifier ce qui a été livré en phases 1–4, passer une checklist deploy, puis finaliser (fixes mineurs + décision merge) **sans** relancer les ~65 items encore ouverts sauf P0 découverts.

## Liens (source de vérité)

| Quoi | Lien |
|---|---|
| Repo | https://github.com/billoukad-debug/famo-portail |
| PR draft #7 | https://github.com/billoukad-debug/famo-portail/pull/7 |
| Branche à auditer | `cursor/fix-coherence-phase1-a47d` |
| Base | `main` |
| HEAD attendu | `cdc06ba` (*Phase 4…*) |
| Agent Cursor (contexte bancale + phases) | https://cursor.com/agents/bc-019f8647-b338-7308-9345-7ba37ed7a47d |
| Checks locaux | `node scripts/check.js` (doit passer) |

### Commits sur la PR
1. `59116c1` Phase 1 — bugs menteurs  
2. `341a107` Phase 2 — deep-links Magazijn↔Order  
3. `af16746` Phase 3 — stock + documents company  
4. `cdc06ba` Phase 4 — client session + setup CRUD  

### Fichiers touchés (vs `main`)
`aan-de-slag.html` `api/catalogue.js` `api/config.js` `api/onboarding.js` `api/stock.js` `bestellingen.html` `documenten.html` `documents.js` `entrepot.html` `index.html` `order.html` `scripts/check.js` `staff-nav.js` `staff-session.js` `staff.css` `stock.html`

## Rôles

| Agent | Job | Prompt à coller | Sortie attendue |
|---|---|---|---|
| **1. Codex** | Vérifier les claims phases 1–4 vs code (sceptique) | [`01-CODEX-VERIFY.md`](./01-CODEX-VERIFY.md) | `handoff/OUT-codex-verify.md` |
| **2. Claude Code** | Deploy checklist + skills repo | [`02-CLAUDE-DEPLOY.md`](./02-CLAUDE-DEPLOY.md) + skills `.claude/skills/*` | `handoff/OUT-claude-deploy.md` |
| **3. Cursor** | Orchestrer, trancher, fixer P0, update PR | [`03-CURSOR-FINALIZE.md`](./03-CURSOR-FINALIZE.md) | fixes + PR body + go/no-go |

## Ordre d’exécution
```
Codex (verify)  ──┐
                  ├──► Cursor (finalize)
Claude (deploy) ──┘
```
1. Lancer **Codex** et **Claude Code** en parallèle (même branche).  
2. Coller leurs rapports dans le chat **Cursor**.  
3. Cursor lit les 2 sorties, corrige uniquement P0/régressions, met à jour la PR, décide merge.

## Vérité produit (rappel)
- Inventaire bancale : **101** manques (#1–#101)  
- Livré phases 1–4 : **~⅓** (~30–35 items)  
- Reste ouvert : surtout Invoeren #54–61, Leveringen #62–69, order edit #34–39, creditnota réelle #79–80, transversal #94–101  
- Ne pas élargir le scope pendant la finalisation sauf P0.

## Skills Claude Code (dans ce repo)
```
.claude/skills/famo-deploy-checklist/SKILL.md   → /famo-deploy-checklist
.claude/skills/famo-coherence-verify/SKILL.md   → /famo-coherence-verify
```
Invoke explicite recommandé : `/famo-deploy-checklist` puis `/famo-coherence-verify`.
