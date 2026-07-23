# PROMPT CODEX — Vérifier ce que Cursor Agent a livré (Phases 1–4)

> **Mode :** lecture seule. Aucun commit, aucun push, aucun refactor.
> **Branche :** `cursor/fix-coherence-phase1-a47d` (checkout avant tout)
> **PR :** https://github.com/billoukad-debug/famo-portail/pull/7
> **Agent contexte :** https://cursor.com/agents/bc-019f8647-b338-7308-9345-7ba37ed7a47d
> **HEAD attendu :** `cdc06ba`

---

## Mission
Tu es un reviewer sceptique. L’agent Cursor prétend avoir fermé les phases 1–4 du plan de cohérence FAMO. **Vérifie chaque claim dans le code.** Ne fais pas confiance à `scripts/check.js` seul (il peut être un faux vert).

## Setup
```bash
git fetch origin
git checkout cursor/fix-coherence-phase1-a47d
git pull origin cursor/fix-coherence-phase1-a47d
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
node scripts/check.js
```

## Claims à prouver ou invalider

Pour chaque ligne : `DONE` | `PARTIAL` | `MISSING` | `REGRESSION`  
Preuve = `fichier` + extrait / symbole (pas de paraphrase vague).

### Phase 1 — bugs menteurs
| # | Claim |
|---|---|
| 1 | Documenten mobile : `.d-list .d-doc { display:block }` en ≤780px |
| 2/25 | Bestellingen chip Open = `status=open` (pas Facturée) |
| 3/24 | Filtres Bestellingen sync URL |
| 26 | « Toon alles » Aandacht |
| 10/88 | Aan de slag n’écrase plus `lowThreshold` à 0 |
| 11/41 | Magazijn `showBoardError` + retry |
| 12 | `takeReturn` après login staff |
| 7 | POD libellé honnête (pas faux upload) |

### Phase 2 — deep-links
| # | Claim |
|---|---|
| 4/32/44 | `order.html` → `/entrepot.html?id=` + Magazijn focus/scroll/edit |
| 5/49 | Dag « Valideren » → Magazijn `?id=` (plus order.html) |
| 42 | Ontvangst via `openDeliveryConfirm` in-place |
| 43 | Bouton Factuur gated sur `factuurnummer` |
| 40 | Couleur statut réelle sur fiche order |

### Phase 3 — stock + docs
| # | Claim |
|---|---|
| 70 | Grens / `lowThreshold` éditable + POST `api/stock` |
| 71/95 | Historique `GET /api/stock?history=1` (+ product) |
| — | Journal stock seulement si qty change |
| — | Qty clarifiée comme absolue (pas delta) |
| 77 | Documenten mobile OK |
| 78 | `FamoDocuments.setCompany` depuis `/api/config` |
| 8 | Creditnota clairement **voorbeeld / niet geboekt** (honesty, pas API) |
| — | Bloc IBAN sur facture depuis config |

### Phase 4 — client + setup
| # | Claim |
|---|---|
| 13 | Session client `sessionStorage` + restore refresh |
| 14 | Contact Hulp tel/mail depuis config |
| 18 | Date livraison : min demain + pas dimanche |
| 19 | Wissen panier aussi en mobile sheet |
| 85 | Éditer client existant (Aan de slag) |
| 86 | Supprimer prijs (`deletePrice`) |
| 87 | Désactiver produit `actif:false` |
| 90 | Banner setup regarde aussi catalogus/klanten |
| 93 | Catégories NL (Vis/Schaaldieren…) |
| — | `/api/config?public=1` sans IBAN |

## Checks structurels obligatoires
1. Pas de `confirm(`/`alert(`/`prompt(` natifs dans HTML staff (sauf client si déjà toléré — note-le).
2. Pas de `STAFF_CODE` / `famoStaffCode` en localStorage/sessionStorage/query.
3. Magazijn `doc()` vs `documents.js` : divergence company/IBAN encore ?
4. APIs mortes encore présentes : `saveStock`, `previewCredentials` branchées ou orphelines ?
5. `check.js` Phase 1–4 : les guards matchent-ils vraiment le comportement, ou regex trop faibles ?

## Hors scope (ne pas auditer comme “raté de cette PR”)
Invoeren #54–61, Leveringen #62–69, order edit #34–39, creditnota Airtable #79–80, rôles/offline/E2E #96–101 — liste-les seulement en “encore OPEN (attendu)”.

## Livrable
Écris **`handoff/OUT-codex-verify.md`** avec :

1. **Verdict** (5 lignes) : claims tenus / partiels / faux  
2. **Tableau** : Claim | Statut | Preuve | Sévérité P0–P3  
3. **Top régressions / menteurs restants** (max 10)  
4. **Faux verts `check.js`** éventuels  
5. **Go/No-go merge** de la PR #7 **telle quelle** (sans élargir le scope)  
6. **Liste P0 à fixer par Cursor** (fichier + fix attendu, 1 ligne chacun)

Réponds en français. Sois dur mais juste.
