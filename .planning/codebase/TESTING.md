---
last_mapped_commit: 87c2948d2b10ce5ae0c5e27550fcc1197acbf17e
last_mapped_at: 2026-10-02
---
# Testing Patterns

**Analysis Date:** 2026-10-02

## Test Framework

**Runner:**
- `node:test` (intégré à Node 22), lancé par `node --test`
- Config : aucune ; câblage dans `scripts/check.js` (tous les `test/*.test.js`) et `scripts/workflow-check.js` (tous les `test/workflow/*.test.js`, un processus par fichier)

**Assertion Library:**
- `node:assert` / `assert` (intégré)

**Run Commands:**

```bash
node scripts/check.js                       # porte principale : syntaxe, CSP, secrets, liens, NL, styles en ligne, ?v=, contrastes, tests unitaires, scénarios métier
node scripts/workflow-check.js [nom]        # scénarios métier seuls (ou un domaine : facturation, commandes…)
node --test test/trace.test.js              # un fichier unitaire
npx -y eslint@9.39.5 .                      # lint (porte obligatoire)
node scripts/dev.js & node scripts/ux-audit.js && node scripts/kbd-audit.js && node scripts/parcours-check.js   # audits navigateur (Playwright 1.56.1 hors dépôt)
node scripts/assets-version.js && node scripts/check.js && npx -y eslint@9.39.5 .     # pré-push (CONTRIBUER.md)
```

**État mesuré le 2026-10-02 (commit 87c2948, Node v22.22.2) :** `node scripts/check.js` → exit 0 « Tout est bon » (≈ 83 s) ; scénarios métier 39/39 ; `npx -y eslint@9.39.5 .` → exit 0. Audits navigateur non relancés ici (Playwright absent du poste d'analyse).

## Test File Organization

**Location:**
- Séparée du code : `test/*.test.js` (41 fichiers unitaires, ≈ 350 appels `test()`), `test/workflow/*.test.js` (11 fichiers de scénarios + `_helpers.js`)

**Naming:**
- `<domaine>.test.js` : `trace.test.js`, `verpakking.test.js`, `rapportage.test.js`, `testperiode.test.js`, `bestellen-per-mail.test.js`, `security.test.js`, `deploy.test.js`…
- Scénarios par domaine : `beheer`, `commandes`, `corrections`, `emails-documents`, `facturation`, `interface`, `portail-client`, `portail-client-wachtwoord`, `preparation-livraison`, `sessions-roles` ; garde-fou `inventaire.test.js`

**Structure:**

```
test/
├── *.test.js            # unitaires : moteur SQL réel (SQLite en mémoire), handlers api/ appelés en direct
└── workflow/
    ├── _helpers.js      # env de test, fetch réel interdit, call(), cookies, mkRes()
    ├── inventaire.test.js  # 36 blocs d'origine + plancher de 752 assertions
    └── <domaine>.test.js
```

## Test Structure

**Suite Organization (unitaire sur SQLite) :**

```javascript
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const cookie = (role) => ({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, role)) });
async function call(file, body, opts) { const res = mkRes(); await require(path.join(ROOT, "api", file))({ method: "POST", body, headers: cookie("staff"), query: {} }, res); return res; }
test("lot : validation", async () => { await seed(); assert.equal((await call("lots.js", { lotnummer: "" })).statusCode, 400); });
```

(extrait de `test/trace.test.js`)

**Patterns:**
- Setup : `seed()` réécrit les tables par `ds.state.store.replaceAll(table, records)` avant chaque test
- Teardown : aucun (base en mémoire, processus isolé)
- Assertion : codes HTTP + payload + état relu en base (stock, numéros, journal)

## Mocking

**Framework:** remplacement manuel de `global.fetch` (aucune librairie).

**Patterns:**

```javascript
// test/workflow/_helpers.js — chargé EN PREMIER par chaque fichier de scénarios
process.env.STAFF_CODE = "testcode-ci"; process.env.ADMIN_CODE = "admincode-ci";
global.fetch = async url => { throw new Error("Réseau réel interdit dans les scénarios métier (test/workflow) : " + url); };
h.isolate(__filename); // échoue si deux fichiers partagent un processus
```

**What to Mock:**
- Airtable REST (réponses simulées par scénario via `call()`), Resend, Anthropic (`scripts/fake-anthropic.js`), VIES, horloge si besoin (jetons signés avec une échéance réelle)

**What NOT to Mock:**
- Le moteur SQL (`lib/at-engine.js` sur SQLite en mémoire) : les règles métier sont testées sur le vrai moteur
- La signature des sessions : on signe de vrais cookies (`auth.sign`) plutôt que de court-circuiter l'auth

## Fixtures and Factories

**Test Data:**

```javascript
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 30, "Unité": "kg", Actif: true })]);
```

**Location:**
- Dans chaque fichier de test ; données de démo du banc : `scripts/seed.js` (`seed(db, { historie: true })` pour 15 mois d'historique facturé, spec 022)

## Coverage

**Requirements:** pas d'outil de couverture. Règle constitutionnelle : toute règle métier a un test écrit avant ou avec le code, qui échoue sans le code ; on ne désactive, ne saute ni ne met en quarantaine un test.

**View Coverage:**

```bash

# Non disponible (pas d'outillage). Garde-fou de non-régression : test/workflow/inventaire.test.js (blocs + plancher d'assertions).

```

## Test Types

**Unit Tests:**
- Handlers `api/*.js` appelés directement avec un `req`/`res` simulé, sur SQLite en mémoire ; modules purs (`assets/rapport.js`, `assets/vat.js`, `assets/ui.js` exécuté dans un bac à sable `vm`)

**Integration Tests:**
- Scénarios métier `test/workflow/` : parcours complets (commande → préparation → départ → réception → facture → creditnota), rôles, sessions, e-mails, documents FR/NL

**E2E Tests:**
- Playwright 1.56.1 hors dépôt contre `node scripts/dev.js` : `scripts/ux-audit.js` (27 écrans à 1280 et 390 px), `scripts/kbd-audit.js` (clavier), `scripts/parcours-check.js` (favoris entre appareils) ; job CI « Navigateur »

**Contrôles statiques (dans `scripts/check.js`) :**
- Syntaxe JS + scripts inline, CSP sans inline, aucun secret/code de secours dans `api/`, `lib/staffauth.js` fail-closed, liens internes en URL propre, `caisse` jamais affiché, chaque page charge `ui.css` + `ui.js` + viewport, plafond de 7 styles en ligne statiques, versions `?v=` à jour, contrastes AA (`scripts/contrast-check.js`)

## Common Patterns

**Async Testing:**

```javascript
test("préparation avec lot → instantané figé", async () => { await seed(); const r = await call("updateorder.js", { id: "recORD1", … }); assert.equal(r.statusCode, 200); });
```

**Error Testing:**

```javascript
assert.equal((await call("lots.js", LOT, { headers: {} })).statusCode, 401); // sans session
```

## Règles d'écriture (constitution § III)

- Aucune écriture (POST/PATCH/DELETE) vers la production, aucun vrai identifiant, aucune soumission de `/aanvraag` en production.
- Nouveau scénario : un `test()` dans le fichier du domaine, qui installe ses propres réponses simulées.
- Pour toute modification d'interface : `scripts/ux-audit.js` et `scripts/kbd-audit.js` contre le banc local, en plus de `check.js` et ESLint.

---

*Testing analysis: 2026-10-02*
