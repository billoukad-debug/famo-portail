# ADR 0002 — Airtable d'abord, puis Neon via `lib/at-engine.js`

Statut : acceptée ; bascule effectuée (production sur Neon, `DB_BACKEND=postgres`, au 27/09/2026).

## Contexte
Le portail a démarré sur Airtable (saisie facile, pas de serveur de base à gérer). Limites rencontrées : 5 requêtes par seconde et par base (429), pas de transaction, quota du plan, données hors d'une base SQL classique. Réécrire les ~140 appels REST Airtable du code métier était risqué.

## Décision
- Le code métier continue à parler le protocole REST d'Airtable (`lib/airtable.js`).
- `lib/datastore.js`, chargé en première ligne de chaque `api/*.js`, intercepte `fetch` vers `api.airtable.com` quand `DB_BACKEND` vaut `postgres` ou `sqlite`, et le confie à `lib/at-engine.js`, qui rejoue le contrat Airtable (formules, tri, pages, lots de 10, effacement des champs vides, erreurs 404/422) sur une table SQL unique `famo_records` (JSON + numéro de version pour la concurrence optimiste). Neon est joint en HTTPS avec le `fetch` natif (`lib/sql.js`) : toujours aucune dépendance.
- Sans `DATABASE_URL` valable en mode postgres : erreur 500 `DATABASE_NOT_CONFIGURED`, jamais de repli silencieux sur Airtable (`test/engine-switch.test.js`).
- Migration par copie (Beheer → Systeemstatus : copier puis comparer), refusée une fois la bascule faite.

## Conséquences
- Bascule et retour arrière par une variable d'environnement, sans toucher au code métier ; tests et banc local sur SQLite.
- Depuis la bascule, les nouvelles données ne sont que dans Neon : revenir à Airtable n'est plus une option d'exploitation. Sauvegarde = historique Neon (plan) + exports (`docs/RUNBOOK.md`).
- Le vocabulaire Airtable (noms de champs FR/NL, `rec…`) reste dans le code et la base (`docs/SCHEMA.md`).
- Une valeur de `DB_BACKEND` mal orthographiée est lue comme `airtable`.
