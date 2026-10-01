# ADR 0001 — Pas de build, pas de dépendances npm

Statut : acceptée. Date : 2026 (formalisée le 27/09/2026).

## Contexte
Petite équipe, un seul développeur à la fois, portail de taille modeste (une quinzaine de pages, une vingtaine de fonctions). Chaque dépendance ajoute des mises à jour de sécurité, un `package.json`, un lockfile et une étape de build à maintenir sur Vercel.

## Décision
- Front : HTML + CSS + JavaScript sans framework ni bundler ; une feuille `assets/ui.css`, un module partagé `assets/ui.js`, un script par page. Cache long via `?v=` (`scripts/assets-version.js`).
- Serveur : fonctions Vercel en CommonJS n'utilisant que les modules intégrés de Node et `fetch`.
- Pas de `package.json`. Outils lancés à la demande avec une version figée : `npx -y eslint@9.39.5`, Playwright 1.56.1 installé hors du dépôt pour `scripts/ux-audit.js`.
- Exception vendorisée : `vendor/html2pdf.bundle.min.js` (PDF côté navigateur), copie locale, aucune origine tierce à l'exécution.

## Conséquences
- Déploiement = copie des fichiers ; aucune chaîne de build à casser ; audit de sécurité des dépendances quasi nul.
- Tout est écrit à la main : duplications (`esc`, `eur`, `parseLines`, `rateLimited`) compensées par des tests de parité (`test/workflow/` : bloc M6 dans `emails-documents.test.js`, AZ dans `facturation.test.js`).
- Pas de typage ni de minification ; styles en ligne à surveiller.
