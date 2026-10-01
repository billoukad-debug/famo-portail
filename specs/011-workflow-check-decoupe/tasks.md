# Tasks: Scénarios métier découpés par domaine (F-10)

- [x] T001 Mesures de référence : nombre de blocs « ✓ » (36), d'appels `assert` (752, par type), durée de
  `scripts/workflow-check.js` et de `scripts/check.js` ; détection des appels réseau non simulés de l'ancien script
- [x] T002 `test/workflow/_helpers.js` : environnement de test, `fetch` réel refusé, `isolate()`, `call()`,
  `mkRes`, `HP`, `UI_NL`, `BILL`, `NO_ORDER_REFS`, `staffCookies()`, `datesX()`, `patchOfX`, `methodCallsX`
- [x] T003 Script de découpage (hors dépôt) : blocs copiés par plages de lignes dans 10 fichiers de domaine,
  imports calculés sur l'usage réel, un `test()` par ancien bloc, libellé identique
- [x] T004 Bloc K : chauffe explicite du cache de génération de session (dépendance cachée à l'ordre d'origine)
- [x] T005 Portail client scindé en deux fichiers (`portail-client-wachtwoord` = AL seul) : équilibre du parallélisme
- [x] T006 `test/workflow/inventaire.test.js` : 36 blocs exactement une fois, ≥ 752 `assert`, `./_helpers` en
  premier et `isolate(__filename)` dans chaque fichier
- [x] T007 `scripts/workflow-check.js` → point d'entrée (`node --test --test-reporter=spec`, filtre par nom) ;
  `scripts/check.js` : libellé et commentaire
- [x] T008 Vérifications : chaque fichier seul (`node --test f` et `node f`) ; lignes `assert` de l'ancien script
  toutes présentes à l'identique (574/574) ; garde `isolate()` déclenchée avec `--experimental-test-isolation=none`
- [x] T009 Références : AGENTS.md, CONTRIBUER.md, DESIGN.md, docs/adr/0001 et 0003, eslint.config.js,
  test/airtable.test.js
- [x] T010 Portes : `node scripts/assets-version.js`, `node scripts/check.js`, `npx -y eslint@9.39.5 .`
  (codes de sortie vérifiés un par un) ; mesures avant/après
- [ ] T011 (suite possible) Constitution III cite encore « un bloc de `scripts/workflow-check.js` » : correctif de
  formulation (1.0.1) → « un test de `test/workflow/` » ; `lib/ordermail.js` (commentaire « section M de
  workflow-check ») — hors périmètre de ce lot (`lib/` non modifiable ici)
- [ ] T012 (suite possible) AW2 : deux assertions sont restées dans un commentaire depuis l'origine
  (`// IBAN seulement en mode Portaal assert.deepEqual(…levering.leverdagen…); assert.equal(…bedrijfsnaam…)`) ;
  elles ne s'exécutent pas. Copiées telles quelles ici ; les réactiver dans un lot séparé
