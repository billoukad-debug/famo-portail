# OUT — Claude Deploy checklist + cohérence (PR #7)

> **Branche :** `cursor/fix-coherence-phase1-a47d`
> **PR :** https://github.com/billoukad-debug/famo-portail/pull/7
> **HEAD audité :** `0dea738` (base `origin/main` = `2dc7cc1`)
> **Skills suivis :** `.claude/skills/famo-deploy-checklist`, `.claude/skills/famo-coherence-verify`
> **Méthode :** lecture statique du code + reproduction manuelle des assertions de `scripts/check.js`.
> **Garde-fous respectés :** pas de nouvelle feature, pas de merge, pas de push. Audit sur `famo-portail-audit/` uniquement (pas sur `famo-site/`).

---

## 1. Deploy readiness

### `READY WITH WARNINGS`

Le code de la PR est cohérent et propre : les 4 phases sont réellement présentes dans le code, aucun secret n'est introduit par le diff, et le point le plus sensible (config publique fuitant l'IBAN) est **correctement fermé**. Les warnings sont des **préconditions d'environnement / ops** à confirmer avant merge, pas des défauts de code de cette PR.

**Limite d'honnêteté :** Node n'est pas installé sur cette machine → `node scripts/check.js` et `workflow-check.js` **n'ont pas pu être exécutés ici**. J'ai reproduit à la main toutes les assertions **statiques** de `check.js` (tous les marqueurs présents, voir §7), mais les tests **runtime** (règles métier de `workflow-check.js`) et la validation de syntaxe JS reposent sur la **CI GitHub Actions** — à vérifier verte sur la PR avant merge.

---

## 2. Checklist deploy

### Git / CI
- [x] Sur la bonne branche `cursor/fix-coherence-phase1-a47d` ; `git log origin/main..HEAD` = Phase 1→4 + pack handoff (8 commits, `59116c1`…`0dea738`)
- [~] `node scripts/check.js` exit 0 — **UNVERIFIED (Node absent local)** ; assertions statiques reproduites = vertes ; CI (`.github/workflows`) lance `check.js` + `eslint@9 api/` sur PR→main → **confirmer verte**
- [x] Aucun secret ajouté par le diff (`AIRTABLE_TOKEN`/mots de passe/staff code) — seul match `famo2026` = prose dans un doc handoff
- [ ] Description PR ↔ commits — **à relire** (draft)

### Env (Vercel) — constat code, valeurs jamais affichées
- [x] Le code **exige** `AIRTABLE_TOKEN` (`process.env.AIRTABLE_TOKEN`, tous les `api/*`)
- [x] `STAFF_CODE` centralisé dans `lib/staffauth.js` ; **aucun** fallback en dur dans `api/*` (vérifié)
- [!] `lib/staffauth.js:4` : `const CODE = process.env.STAFF_CODE || "famo2026"` — fallback en clair (**hors diff PR**, préexistant sur `main`). Inerte **si** `STAFF_CODE` est défini (test J : `famo2026` en login → 401 quand env présent). → **NEEDS_PROD**
- [~] Présence réelle de `AIRTABLE_TOKEN` + `STAFF_CODE` en Prod/Preview — **NEEDS_PROD** (dashboard Vercel non lisible d'ici)
- [x] Pas de `vercel.json`/`package.json` → déploiement Vercel zéro-config : HTML racine statique + `api/*` serverless Node ; `fetch`/`crypto` natifs (Node 18+/22), aucune dépendance npm à installer

### API surface de la PR
- [x] `api/stock.js` — `GET ?history=1` (tri desc, `maxRecords=40`, filtre produit **échappé** anti-injection), `POST` patch `Seuil bas` seulement si fourni, journal **uniquement si `rounded !== before`**
- [x] `api/config.js` — `?public=1` (non-staff) renvoie **contact seul, SANS `iban`/`bic`** ✅ (risque BLOCKED écarté)
- [x] `api/catalogue.js` — réponse login inclut `company` via `loadCompany()` (contact seul, pas de secret) ; login **POST only**, rate-limit 5/30 s
- [x] `api/onboarding.js` — `deletePrice` (DELETE), `saveClient`+`id` (update, mot de passe préservé si non fourni), `saveProduct` `actif:false` OK

### Invariants métier (lecture code + `workflow-check.js`)
- [x] Prix calculés serveur (`negMap`, `order.js`)
- [x] Stock déduit **1×** à la Sortie (garde `Stock afgeboekt` → 409 si retenté ; test C)
- [x] Destinataire requis avant `deliveryConfirmed` (test E)
- [x] `Factuurnummer` alloué une seule fois, pas de réécriture (test D)
- [x] Auth staff par cookie de session — `stripCodeParam` retire `?code=` des URLs ; aucun `?code=` dans le HTML staff

### Honnêteté UX (phases 1–4)
- [x] Aucun `alert`/`confirm`/`prompt` natif (les matches = `nlConfirm`/`openDeliveryConfirm`, modales maison)
- [x] Documenten cartes mobile visibles ; Magazijn erreur visible (`showBoardError`) ; Order/Dag → Magazijn `?id=` ; Ontvangst via sheet partagé ; Factuur gated ; Creditnota **voorbeeld / niet geboekt** ; POD honnête (« lokale foto — wordt niet opgeslagen ») ; session client + dates + Wissen mobile

### Rollback
- [x] Commit `main` courant noté : `2dc7cc1`
- [x] Plan : redeploy du déploiement Vercel précédent (instantané)
- [x] Champs Airtable ajoutés par le code = **additifs** (pas de migration destructive) — mais leur **existence en base** est une précondition (voir §3 W5)

---

## 3. Risques runtime / env / data

| # | Risque | Sévérité | Statut |
|---|---|---|---|
| W1 | `STAFF_CODE` absent en Prod → fallback `famo2026` actif. Si le repo GitHub est **public**, le code staff est lisible dans `lib/staffauth.js`. | P1 | **NEEDS_PROD** — confirmer `STAFF_CODE` défini (Prod+Preview) + visibilité repo |
| W2 | `index.html` `saveSession()` stocke `{user, pw}` **en clair** dans `sessionStorage` (`famo_client_sess`) pour survivre au refresh. | P2 | **Accepté** (design portail client, per-onglet, effacé à la fermeture). Noté, **non corrigé** (hors P0). |
| W3 | `AIRTABLE_TOKEN` requis par tous les `api/*` ; absent → 500 « niet geconfigureerd » / échecs Airtable. | P1 | **NEEDS_PROD** |
| W4 | Filtre `filterByFormula` history stock : si le champ `Produit`/table `Mouvements de stock` diffère, `?history=1` peut 500. La page stock charge quand même la liste (historique = UX additive). | P2 | Dégradation gracieuse OK |
| W5 | Le code lit des champs/tables Airtable : `Seuil bas`, table `Mouvements de stock`, table `Configuratie`, `Stock afgeboekt`, `Réceptionné par`, `Livraison confirmée`, `Factuurnummer`. Si absents en base → 422/erreurs runtime. | P1 | **NEEDS_PROD** — vérifier le schéma base `appcdduLth9iGX8I0` |
| W6 | `check.js`/`workflow-check.js` non exécutés localement (Node absent). | P2 | **Process** — s'appuyer sur la CI verte |

---

## 4. Smoke matrix (S1–S9)

Statut = vérifiable en code (`PASS statique`) puis confirmation réelle requise en Preview (`NEEDS_PROD`), car pas d'accès Airtable ici.

| # | Scénario | Statut | Preuve code |
|---|---|---|---|
| S1 | Staff login cookie → Bestellingen | PASS statique / NEEDS_PROD | `staff-session.js bindLogin` + `/api/session` cookie HttpOnly |
| S2 | Order « Validatie » → Magazijn `?id=` focus | PASS statique / NEEDS_PROD | `order.html` `entrepot.html?id=`+`magazijnHref` ; `entrepot.html` `highlightFocusedOrder` |
| S3 | Ontvangst in-place (pas de redirect) | PASS statique / NEEDS_PROD | `entrepot.html` `confirmDelivery` + `/staff-delivery.js openDeliveryConfirm` |
| S4 | Factuur absent sans `factuurnummer` | PASS statique / NEEDS_PROD | `entrepot.html` bouton doc gated `o.factuurnummer` |
| S5 | Voorraad : edit Grens + Geschiedenis | PASS statique / NEEDS_PROD | `stock.html` `lowThreshold`+`toggleHistory`+`history=1` ; `api/stock.js` |
| S6 | Documenten : company/IBAN + creditnota voorbeeld | PASS statique / NEEDS_PROD | `documents.js` `IBAN:`+`CREDITNOTA (VOORBEELD)`+`niet geboekt` ; `documenten.html` `/api/config`+`setCompany` |
| S7 | Client : refresh reste connecté ; dimanche refusé ; Wissen mobile | PASS statique / NEEDS_PROD | `index.html` `tryRestoreSession`/`famo_client_sess` ; `getDay()===0 → "Zondag is geen leverdag."` ; Wissen dans sheet mobile |
| S8 | Aan de slag : edit client / delete prijs / Uit produit | PASS statique / NEEDS_PROD | `aan-de-slag.html` `editClient`/`deletePrice`/`actif:false` ; `api/onboarding.js` |
| S9 | Banner setup si catalogue/identité manquante | PASS statique / NEEDS_PROD | `staff-nav.js` banner `catalogus`/`klanten` ; `api/config ?status=1` |

Aucun `FAIL`. Aucun scénario `N/A`.

---

## 5. Actions pré-merge obligatoires (ordonnées, max 8)

1. **Confirmer la CI verte** sur PR #7 (GitHub Actions `Controle du code` : `check.js` + `eslint@9 api/`).
2. **Vérifier `STAFF_CODE`** défini en Vercel **Production + Preview** (sinon fallback `famo2026` actif — W1).
3. **Vérifier `AIRTABLE_TOKEN`** défini en Production + Preview (W3).
4. **Vérifier le schéma Airtable** base `appcdduLth9iGX8I0` : présence de `Seuil bas`, table `Mouvements de stock`, table `Configuratie`, `Stock afgeboekt`, `Réceptionné par`, `Livraison confirmée`, `Factuurnummer` (W5).
5. **Confirmer la visibilité du repo** (privé attendu). Si public → planifier retrait du fallback `famo2026` juste après merge (W1).
6. **Smoke staff sur le déploiement Preview** : S1→S6 (login, deep-link Magazijn, Ontvangst in-place, gate Factuur, stock Grens+historique, Documenten IBAN/creditnota).
7. **Smoke client sur Preview** : S7 (login client, refresh, date dimanche refusée, Wissen mobile) + `curl /api/config?public=1` → confirmer **absence d'IBAN/BIC**.
8. **Relire la description de la PR** vs commits réels.

---

## 6. Actions post-merge (monitoring, rollback)

- **Monitoring Vercel** : surveiller les logs des functions `api/stock` (filtre history), `api/config`, `api/onboarding`, `api/updateorder` pour 401/422/500 dans les premières heures.
- **Vérif prod** : `curl https://famo-portail.vercel.app/api/config?public=1` → doit renvoyer contact **sans** `iban`/`bic`.
- **Rollback** : redeploy du déploiement Vercel précédent (instantané). Base de comparaison : `main` = `2dc7cc1`. Pas de migration schéma destructive dans cette PR (champs additifs).
- **Suivi** : après confirmation de `STAFF_CODE` en prod, ouvrir un ticket de suivi pour retirer le fallback `famo2026` de `lib/staffauth.js` (hors périmètre de cette PR).

---

## 7. Cohérence — claims phases 1–4

Toutes les assertions statiques de `scripts/check.js` reproduites à la main : **présentes**. Statut par groupe (`DONE` = code présent + comportement lisible ; preuve = fichier/symbole).

| Phase | Claim | Statut | Preuve |
|---|---|---|---|
| P1 | Documenten mobile `.d-list .d-doc {display:block}` | DONE | `documenten.html` |
| P1 | Bestellingen chip Open = `status=open` + sync URL | DONE | `bestellingen.html` `status=open` / `syncUrlFromFilters` |
| P1 | Magazijn `showBoardError` + retry | DONE | `entrepot.html` |
| P1 | Aan de slag n'écrase plus `lowThreshold:0` | DONE | `aan-de-slag.html` (guard `check.js` négatif) |
| P1 | `takeReturn` après login staff | DONE | `staff-session.js` |
| P1 | POD honnête (pas de faux upload) | DONE | `staff-session.js` « alleen voorbeeld — wordt niet opgeslagen » |
| P2 | `order.html` → `/entrepot.html?id=` + focus | DONE | `order.html` `magazijnHref` ; `entrepot.html` `highlightFocusedOrder` |
| P2 | Ontvangst in-place `openDeliveryConfirm` | DONE | `entrepot.html` + `/staff-delivery.js` |
| P2 | Bouton Factuur gated `factuurnummer` | DONE | `entrepot.html` |
| P3 | `GET /api/stock?history=1` (+ produit) | DONE | `api/stock.js` (filtre échappé) |
| P3 | Journal stock seulement si qty change | DONE | `api/stock.js` `rounded !== before` |
| P3 | Grens/`lowThreshold` éditable + qty absolue | DONE | `stock.html` `toggleHistory` + `absolute` |
| P3 | `setCompany/getCompany` depuis `/api/config` | DONE | `documents.js` + `documenten.html` |
| P3 | Creditnota **voorbeeld / niet geboekt** + IBAN facture | DONE | `documents.js` `CREDITNOTA (VOORBEELD)` / `IBAN:` |
| P4 | Session client `sessionStorage` + restore | DONE (voir W2) | `index.html` `tryRestoreSession`/`famo_client_sess` |
| P4 | Contact Hulp depuis config publique | DONE | `index.html` `config?public=1`+`applyCompany`+`helpContact` |
| P4 | Date livraison : min demain + pas dimanche | DONE | `index.html` `nextOpenDate`/`dateInvalid` |
| P4 | Wissen panier en mobile sheet | DONE | `index.html` composer mobile |
| P4 | Éditer client / `deletePrice` / `actif:false` | DONE | `aan-de-slag.html` + `api/onboarding.js` |
| P4 | Catégories NL (Vis/Schaaldieren) + banner setup enrichi | DONE | `aan-de-slag.html` / `staff-nav.js` |
| P4 | `/api/config?public=1` **sans IBAN** | DONE ✅ | `api/config.js` bloc `wantPublic` (contact seul) |

**Faux verts `check.js` ?** Les guards sont des regex de **présence de symbole** : ils prouvent que le code path existe, pas son bon câblage runtime. C'est la limite inhérente du contrôle statique. Le complément runtime est couvert par `workflow-check.js` (règles métier) + les smoke S1–S9 en Preview. Aucun faux vert manifeste détecté.

**Encore OPEN (attendu, ne pas pénaliser la PR) :** Invoeren #54–61, Leveringen #62–69, order edit/cancel #34–39, creditnota API réelle #79–80, CRM/rôles/offline/E2E #96–101.

---

## 8. Ce que Cursor doit patcher avant merge (P0)

**Aucun P0 bloquant dans le périmètre de la PR.** Le seul risque à traiter (W1, fallback `famo2026`) est :
- **hors diff** de cette PR (préexistant sur `main`), et
- une **précondition ops** (définir `STAFF_CODE` en Vercel), pas un patch code requis pour ce merge.

→ **Go/No-go : GO** sous réserve des points 1→5 de §5 (CI verte + env `STAFF_CODE`/`AIRTABLE_TOKEN` + schéma Airtable + visibilité repo). Si l'un de ces points échoue en prod, le déploiement devient **BLOCKED** jusqu'à correction — mais rien n'est à recoder côté PR.

*(Suggestion follow-up, hors scope : retirer le fallback `famo2026` de `lib/staffauth.js` une fois `STAFF_CODE` confirmé en prod.)*
