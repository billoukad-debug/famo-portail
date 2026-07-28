# PROMPT CLAUDE CODE — Recovery (clone + checklist inline)

> À coller tel quel dans Claude Code si tu es sur `/Users/b/Desktop/FAMO` (copie sans git)
> ou si `handoff/` / skills sont introuvables.

## Contexte (ne pas confondre)
- **Repo GitHub correct :** `https://github.com/billoukad-debug/famo-portail`
- **Branche :** `cursor/fix-coherence-phase1-a47d`
- **PR :** https://github.com/billoukad-debug/famo-portail/pull/7
- **HEAD attendu :** au moins `eecc6c4` (pack handoff) ou plus récent sur cette branche
- **`/Users/b/Desktop/FAMO` et `famo-site/` ne sont PAS ce dépôt.** Ignore-les pour cet audit.
- Garde-fous : **pas de nouvelles features, pas de merge, pas de push** (sauf si on te le demande explicitement plus tard).

---

## Étape 0 — Obtenir le vrai dépôt

```bash
# Choisis un dossier de travail propre (PAS Desktop/FAMO)
cd ~/Desktop
git clone https://github.com/billoukad-debug/famo-portail.git famo-portail-audit
cd famo-portail-audit
git fetch origin
git checkout cursor/fix-coherence-phase1-a47d
git pull origin cursor/fix-coherence-phase1-a47d
git log --oneline origin/main..HEAD | head -20
ls handoff/
ls .claude/skills/
```

Si `gh` n’est pas installé : ce n’est **pas** bloquant. Utilise les URLs + `git` seulement.

Vérifie que tu vois :
- `handoff/02-CLAUDE-DEPLOY.md`
- `.claude/skills/famo-deploy-checklist/SKILL.md`
- `.claude/skills/famo-coherence-verify/SKILL.md`

Ensuite :
```bash
node scripts/check.js
```

---

## Étape 1 — Skills / slash-commands

Après le clone, les skills sont **dans le repo** (`.claude/skills/...`).

Essaie :
```
/famo-deploy-checklist
/famo-coherence-verify
```

Si Claude Code ne les charge pas automatiquement :
1. Ouvre le dossier `famo-portail-audit` comme **projet racine** de la session Claude Code
2. Ou exécute le contenu des `SKILL.md` **manuellement** (ci-dessous, sections A et B)
3. Ne crée pas de faux résultats : si un item n’est pas vérifié, marque `NEEDS_PROD` / `UNVERIFIED`

---

## Étape 2 — Suivre la procédure

1. Lis `handoff/02-CLAUDE-DEPLOY.md`
2. Exécute la checklist **A** (deploy) puis **B** (cohérence)
3. Écris le rapport dans `handoff/OUT-claude-deploy.md` (dans le clone)
4. Affiche aussi le rapport complet dans le chat pour que l’humain puisse le coller dans Cursor

---

## A. Deploy checklist (inline si skill absent)

### Git / CI
- [ ] Branche `cursor/fix-coherence-phase1-a47d`
- [ ] `git log origin/main..HEAD` contient Phase 1–4 (+ handoff commits)
- [ ] `node scripts/check.js` exit 0
- [ ] Aucun secret dans le diff (`AIRTABLE_TOKEN`, passwords, staff codes en clair)

### Env Vercel (constat only — ne jamais afficher les valeurs)
- [ ] Documente si le code **exige** `AIRTABLE_TOKEN` + `STAFF_CODE`
- [ ] Confirme que `api/*` n’a pas de fallback hardcodé hors `lib/staffauth.js`
- [ ] Note : tu ne peux peut‑être pas lire le dashboard Vercel → marque `NEEDS_PROD` pour la présence réelle des env vars

### API surface PR
Vérifie dans le code :
- [ ] `api/stock.js` : `GET ?history=1`, `POST lowThreshold`, journal si qty change
- [ ] `api/config.js` : `?public=1` **sans** `iban`/`bic`
- [ ] `api/catalogue.js` : `company` dans la réponse login
- [ ] `api/onboarding.js` : `deletePrice`, `saveClient`+`id`, `actif:false`

**BLOCKED immédiat** si `public=1` fuit IBAN/BIC.

### Invariants métier (via `workflow-check.js` / lecture code)
- [ ] Prix serveur
- [ ] Stock déduit 1× à Sortie
- [ ] Recipient avant facture
- [ ] `factuurnummer` une fois
- [ ] Pas de `?code=` dans les pages staff

### UX honesty (phases 1–4)
- [ ] Pas de `alert`/`confirm`/`prompt` staff HTML
- [ ] Documenten mobile visible
- [ ] Magazijn erreur load visible
- [ ] Order/Dag → Magazijn `?id=`
- [ ] Ontvangst sheet partagé
- [ ] Factuur gated `factuurnummer`
- [ ] Creditnota voorbeeld
- [ ] Client session + dates + Wissen mobile

### Smoke matrix
Marque PASS / FAIL / NEEDS_PROD / N/A pour S1–S9 (login staff, deep-link Magazijn, Ontvangst, Factuur gate, stock Grens+history, Documenten company, client refresh/date/Wissen, Aan de slag CRUD, banner setup).

### Rollback
- [ ] Commit `main` actuel noté
- [ ] Plan : redeploy Vercel précédent
- [ ] Confirmer : pas de migration schéma Airtable dans cette PR

### Décision (une seule)
`READY` | `READY WITH WARNINGS` | `BLOCKED`

---

## B. Cohérence claims (inline)

Pour chaque claim phases 1–4 (voir `handoff/01-CODEX-VERIFY.md`) :  
`DONE` | `PARTIAL` | `MISSING` | `REGRESSION` + preuve fichier.

Ne pénalise pas la PR pour les items encore OPEN attendus : Invoeren #54–61, Leveringen #62–69, order edit #34–39, creditnota Airtable #79–80, CRM/rôles/offline/E2E.

---

## Livrable obligatoire

Écris `handoff/OUT-claude-deploy.md` avec :
1. Deploy readiness
2. Checklist cochée
3. Risques runtime/env
4. Smoke matrix S1–S9
5. Actions pré-merge (max 8)
6. Actions post-merge
7. Section **Cohérence** (claims)
8. Ce que Cursor doit encore patcher (P0)

Réponds en français.
