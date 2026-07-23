# PROMPT CLAUDE CODE — Deploy checklist + cohérence release

> **Branche :** `cursor/fix-coherence-phase1-a47d`  
> **PR :** https://github.com/billoukad-debug/famo-portail/pull/7  
> **Agent contexte :** https://cursor.com/agents/bc-019f8647-b338-7308-9345-7ba37ed7a47d  
> **Skills repo :** `.claude/skills/famo-deploy-checklist` et `.claude/skills/famo-coherence-verify`

---

## Mission
Tu prépares la **mise en prod / merge** de la PR de cohérence FAMO. Tu n’implémentes pas de nouvelles features. Tu utilises les skills du repo pour une checklist deploy + un passage cohérence, puis tu produis un rapport merge/deploy.

## Setup
```bash
git fetch origin
git checkout cursor/fix-coherence-phase1-a47d
git pull origin cursor/fix-coherence-phase1-a47d
```

## Skills — invoke explicitement dans cet ordre
1. `/famo-deploy-checklist`  
2. `/famo-coherence-verify`  

Si les skills ne se chargent pas :
```bash
ls .claude/skills/famo-deploy-checklist/SKILL.md
ls .claude/skills/famo-coherence-verify/SKILL.md
```
Puis suis leur contenu manuellement.

## Focus deploy (Vercel + Airtable)
- Env vars critiques présentes **en doc/constat code** (ne pas exposer de secrets) : `AIRTABLE_TOKEN`, `STAFF_CODE`, etc.
- Endpoints touchés par la PR : `api/stock.js`, `api/config.js` (`?public=1`), `api/catalogue.js` (company), `api/onboarding.js` (`deletePrice`)
- Risques runtime : filtre Airtable history stock, PATCH Seuil bas, public config qui ne doit **pas** renvoyer IBAN
- Client portal : `sessionStorage` credentials — noter le risque, pas “fixer” sauf si P0
- `node scripts/check.js` + `scripts/workflow-check.js` (lancé via check.js)

## Scénarios smoke (statique si pas d’env Airtable)
Documente pour chaque scénario : *testable en code* / *nécessite prod* / *bloquant*

1. Staff login cookie → Bestellingen  
2. Order « Validatie » → Magazijn `?id=` focus  
3. Ontvangst in-place (pas redirect order)  
4. Factuur absent sans `factuurnummer`  
5. Voorraad : edit Grens + Geschiedenis  
6. Documenten : company/IBAN + creditnota voorbeeld banner  
7. Client : refresh reste connecté ; date dimanche refusée ; Wissen mobile  
8. Aan de slag : edit client / delete prijs / Uit produit  
9. Banner setup si catalogue ou identité manquante  

## Livrable
Écris **`handoff/OUT-claude-deploy.md`** :

1. **Deploy readiness** : READY / READY WITH WARNINGS / BLOCKED  
2. Checklist deploy cochée (depuis le skill)  
3. Risques runtime / env / data  
4. Smoke matrix (9 scénarios)  
5. Actions pré-merge obligatoires (max 8, ordonnées)  
6. Actions post-merge (monitoring, rollback)  
7. Ce que Cursor doit encore patcher avant merge (si BLOCKED / warnings P0)

Réponds en français. N’ouvre pas de PR. N’élargis pas au backlog #54–101.
