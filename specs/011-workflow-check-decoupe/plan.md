# Implementation Plan: Scénarios métier découpés par domaine (F-10)

## Summary
Découpage mécanique par script (hors dépôt) de l'ancien `scripts/workflow-check.js` : chaque bloc « ✓ »
devient un `test()` `node:test` portant le même libellé, copié par plages de lignes (aucune réécriture),
dans un fichier par domaine sous `test/workflow/`. Ce qui était partagé dans `main()` (aides, cookies,
dates) passe dans `test/workflow/_helpers.js`. `scripts/workflow-check.js` devient un point d'entrée qui
lance `node --test --test-reporter=spec test/workflow/*.test.js` (un processus par fichier, plusieurs à la
fois) ; `scripts/check.js` l'appelle comme avant.

## Technical Context
- Node 22 (CI) : `node:test`, isolation par processus par défaut (`--experimental-test-isolation=process`),
  concurrence par défaut = cœurs − 1. Aucune dépendance.
- Les fichiers modifient `global.fetch`, `process.env` et `require.cache` : l'isolation par processus est
  donc une exigence, gardée par `isolate(__filename)` (échec explicite si deux fichiers partagent un processus).
- `scrypt` (N = 2^17, ≈ 0,45 s) domine la durée : le parallélisme entre fichiers est le seul gain possible
  sans toucher au code du portail.

## Répartition
| Fichier | Blocs d'origine |
|---|---|
| `commandes.test.js` | Règles métier commande…, Regles release candidate, C2, G, P, AM, AP |
| `preparation-livraison.test.js` | C, E, F, AO, AU, AV |
| `facturation.test.js` | D, O, AQ, AX, AZ |
| `corrections.test.js` | AN |
| `sessions-roles.test.js` | Session staff commune, A, B, K, N, AS |
| `portail-client-wachtwoord.test.js` | AL |
| `portail-client.test.js` | AR, AW |
| `emails-documents.test.js` | M, BA |
| `beheer.test.js` | L, AT, AY |
| `interface.test.js` | H, I, V2 |
| `inventaire.test.js` | contrôle du découpage (36 blocs, ≥ 752 `assert`, autonomie) |

Ordre des blocs conservé à l'intérieur de chaque fichier.

## Constitution Check
- I. Sans build, sans dépendance : ✅ `node:test` intégré, CommonJS, aucun paquet ; rien de déployé
  (`test/` et `scripts/` sont dans `.vercelignore`).
- II. Le serveur décide : ✅ aucun changement de `api/`, `lib/`, `assets/`, pages, `documents.js`.
- III. Les tests d'abord, en local : ✅ aucune assertion retirée ni affaiblie (752 → 752, lignes `assert`
  identiques 574/574), aucun test sauté ; écritures toujours simulées ; le `fetch` réel est désormais
  refusé (l'ancien script laissait passer 7 lectures non simulées vers api.airtable.com, sans jeton) ;
  portes vérifiées une par une.
- IV. Terrain : ✅ sans objet (aucune interface touchée).
- V. Données : ✅ sans objet (aucun champ, aucune table).

## Complexity Tracking
- Lignes de liaison ajoutées (hors code des blocs) : `let result;` / `let sres;` locaux ; `const staffHdr = cookieHdr;`
  au bloc RC (le cookie staff du bloc initial) ; cookies ouverts dans un `before()` par fichier (même code que
  l'ancien « relogin ») ; au bloc K, une lecture simulée de la génération de session : dans l'ancien enchaînement,
  les blocs C à I avaient chauffé ce cache (60 s) de `lib/staffauth.js`, rechargé par le bloc A, et le mock de K
  ne répond qu'aux lectures d'allorders.
- Environnement de test fixé (plus de `process.env.STAFF_CODE || …`) et variables pouvant joindre un vrai service
  retirées (`AIRTABLE_*`, `DATABASE_URL`, `RESEND_API_KEY`, `DB_BACKEND`, …) : mêmes conditions que la CI, quel que
  soit le poste.
- Comportement d'échec : l'ancien script s'arrêtait au premier échec ; désormais tous les fichiers vont au bout et
  `node --test` liste les échecs (code de sortie ≠ 0 inchangé pour la porte).
- La constitution (III) cite toujours « un bloc de `scripts/workflow-check.js` » : le point d'entrée existe toujours ;
  correctif de formulation laissé à un lot de gouvernance (tasks.md T011).

## Vérification
- `node scripts/workflow-check.js` : 39 tests (36 blocs + 3 d'inventaire), 11 suites, 0 échec.
- Chaque fichier seul : `node --test test/workflow/<f>` et `node test/workflow/<f>` → 0 échec (11/11).
- Garde d'isolation : `node --test --experimental-test-isolation=none test/workflow/interface.test.js
  test/workflow/facturation.test.js` → échec explicite « partage son processus ».
- Durées : voir « Mesures ».

## Mesures
Même machine (4 cœurs, Node 22.22.2), avant/après alternés, deux tours ; machine partagée avec d'autres
travaux (charge 3 à 8), d'où la dispersion.

| Mesure | Avant (tour 1 / tour 2) | Après (tour 1 / tour 2) |
|---|---|---|
| `node scripts/workflow-check.js` | 51,3 s / 45,1 s (43,9 s au calme) | 35,3 s / 23,6 s (25,3 s au calme) |
| `node scripts/check.js` complet | 130,9 s / 105,4 s (105 s au calme) | 116,3 s / 105,6 s |

Les scénarios gagnent ≈ 40 à 50 % ; `check.js` gagne peu, car les tests unitaires (`test/*.test.js`, ≈ 60 s,
déjà parallèles) passent avant et dominent. Temps CPU des scénarios inchangé (≈ 35 s, surtout scrypt).
Piste (non faite) : lancer tests unitaires et scénarios dans un même `node --test` pour qu'ils se chevauchent.
