# Cheatsheet — coller tel quel

## 1) Codex (chat neuf)
```
Lis et exécute handoff/01-CODEX-VERIFY.md sur la branche cursor/fix-coherence-phase1-a47d.
PR: https://github.com/billoukad-debug/famo-portail/pull/7
Contexte agent: https://cursor.com/agents/bc-019f8647-b338-7308-9345-7ba37ed7a47d
Écris le rapport dans handoff/OUT-codex-verify.md
Lecture seule — aucun commit.
```

## 2) Claude Code — si tu es déjà sur le bon clone
```
Checkout cursor/fix-coherence-phase1-a47d
PR: https://github.com/billoukad-debug/famo-portail/pull/7
Suis handoff/02-CLAUDE-DEPLOY.md
Invoke /famo-deploy-checklist puis /famo-coherence-verify
Écris handoff/OUT-claude-deploy.md
Pas de nouvelles features, pas de merge.
```

## 2b) Claude Code — si tu es sur Desktop/FAMO ou famo-site (MAUVAISE copie)
```
Tu es sur la mauvaise copie locale. Ignore /Users/b/Desktop/FAMO et famo-site/.
Suis handoff/02b-CLAUDE-RECOVERY.md à la lettre :
1) git clone https://github.com/billoukad-debug/famo-portail.git famo-portail-audit
2) checkout cursor/fix-coherence-phase1-a47d
3) ouvre CE dossier comme projet Claude Code
4) lance checklist (skills ou inline du recovery)
5) écris handoff/OUT-claude-deploy.md
Pas de features, pas de merge. Ne fais PAS l’option C sur famo-site.
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
