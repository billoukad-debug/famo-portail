# Cheatsheet — coller tel quel

## 1) Codex (chat neuf)
```
Lis et exécute handoff/01-CODEX-VERIFY.md sur la branche cursor/fix-coherence-phase1-a47d.
PR: https://github.com/billoukad-debug/famo-portail/pull/7
Contexte agent: https://cursor.com/agents/bc-019f8647-b338-7308-9345-7ba37ed7a47d
Écris le rapport dans handoff/OUT-codex-verify.md
Lecture seule — aucun commit.
```

## 2) Claude Code (chat neuf, repo cloné sur la branche)
```
Checkout cursor/fix-coherence-phase1-a47d
PR: https://github.com/billoukad-debug/famo-portail/pull/7
Suis handoff/02-CLAUDE-DEPLOY.md
Invoke /famo-deploy-checklist puis /famo-coherence-verify
Écris handoff/OUT-claude-deploy.md
Pas de nouvelles features, pas de merge.
```

## 3) Cursor (après les 2 rapports)
```
Finalise PR #7 FAMO. Suis handoff/03-CURSOR-FINALIZE.md
Branche cursor/fix-coherence-phase1-a47d
PR https://github.com/billoukad-debug/famo-portail/pull/7

Rapport Codex:
<<< coller OUT-codex-verify.md >>>

Rapport Claude:
<<< coller OUT-claude-deploy.md >>>

Fixe uniquement P0/régressions phases 1–4.
check.js → commit → push → update PR → OUT-cursor-final.md
Ne merge pas sans mon OK.
```

## Liens
| | |
|---|---|
| PR | https://github.com/billoukad-debug/famo-portail/pull/7 |
| Agent | https://cursor.com/agents/bc-019f8647-b338-7308-9345-7ba37ed7a47d |
| Orchestration | `handoff/00-ORCHESTRATION.md` |
| Skills | `.claude/skills/famo-deploy-checklist` · `.claude/skills/famo-coherence-verify` |
