# PROMPT CURSOR — Orchestrer & finaliser PR #7

> Tu es l’orchestrateur. Codex a vérifié les claims. Claude Code a passé deploy checklist.
> Ton job : **trancher, fixer uniquement les P0/régressions, mettre à jour la PR, décider**.

## Liens
- PR : https://github.com/billoukad-debug/famo-portail/pull/7  
- Branche : `cursor/fix-coherence-phase1-a47d`  
- Base : `main`  
- Agent historique : https://cursor.com/agents/bc-019f8647-b338-7308-9345-7ba37ed7a47d  
- Pack handoff : `handoff/00-ORCHESTRATION.md`

## Inputs (coller ci-dessous dans le chat Cursor)
1. Contenu de `handoff/OUT-codex-verify.md` (rapport Codex)  
2. Contenu de `handoff/OUT-claude-deploy.md` (rapport Claude)

Si les fichiers n’existent pas encore : attends / demande à l’humain de les coller. Ne ré-audite pas les 101 items from scratch.

---

## Mission
1. Lire les 2 rapports.  
2. Fusionner en une **liste unique P0/P1** (dédoublonnée).  
3. Corriger **seulement** :
   - régressions vs claims phases 1–4  
   - menteurs UI encore actifs dans le scope livré  
   - blockers deploy (env/API unsafe, check.js cassé, IBAN exposé en public, etc.)  
4. **Ne pas** implémenter Invoeren/Leveringen/creditnota Airtable/CRM/rôles dans ce tour.  
5. Relancer `node scripts/check.js` jusqu’à vert.  
6. Commit + push sur `cursor/fix-coherence-phase1-a47d`.  
7. Mettre à jour le body PR #7 : section « Audit tripartite » + go/no-go.  
8. Écrire `handoff/OUT-cursor-final.md` avec décision finale.

## Contraintes repo (toujours)
- Staff UI NL ; statuts Airtable FR + `famoNL`
- Pas de hardening auth / toucher `famo2026` sauf structure déjà en place
- Pas de redesign client hors gaps phase 4
- Prix serveur, stock déduit 1× à Sortie, recipient avant facture, factuurnummer unique
- Draft PR OK ; ne merge que si l’humain le demande explicitement

## Format `OUT-cursor-final.md`
1. Décision : **MERGEABLE** / **MERGEABLE AFTER N FIXES** / **HOLD**  
2. Fixes appliqués (commits)  
3. P0 restants (si HOLD)  
4. Backlog conscient post-merge (lots A/B/C, sans les faire)  
5. Message court pour l’humain (5 lignes)

## Prompt de démarrage (à coller tel quel dans Cursor Agent)
```
Finalise la PR #7 FAMO cohérence.

Branche: cursor/fix-coherence-phase1-a47d
PR: https://github.com/billoukad-debug/famo-portail/pull/7
Suis handoff/03-CURSOR-FINALIZE.md

Rapport Codex:
<<<COLLER OUT-codex-verify.md>>>

Rapport Claude Code:
<<<COLLER OUT-claude-deploy.md>>>

Corrige uniquement P0/régressions du scope phases 1–4.
Puis check.js, commit, push, update PR body, OUT-cursor-final.md.
Ne merge pas sans mon OK.
```
