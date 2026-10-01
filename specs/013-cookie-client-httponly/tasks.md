# Tasks: Session client par cookie HttpOnly

**Input**: `specs/013-cookie-client-httponly/` (spec.md, plan.md)

## Phase 1: Tests d'abord

- [x] T001 [US1] [US2] [US3] [US4] [US5] `test/klantcookie.test.js` (SQLite en mémoire, vraies
  routes) : attributs du cookie à la connexion (HttpOnly, Secure, SameSite=Strict, Path=/api,
  Max-Age ≤ 12 h), aucun jeton dans la réponse ; les six routes client par cookie seul ;
  renouvellement (iat conservé) ; jeton de corps accepté et converti en cookie pendant la
  transition, ignoré après le 31/10/2026 (horloge simulée), cookie prioritaire ; déconnexion
  (génération +1, cookie effacé, même sans session) ; révocation par mot de passe changé et par
  génération ; changement de mot de passe et lien e-mail → nouveau cookie ; identifiant annoncé
  différent → 401 ; garde : origine étrangère / `null` → 403, `text/plain` → 415, GET → 405 ;
  cookie falsifié → 401 sans lecture ; `FAMO_DEV_HTTP=1` retire Secure ; `sw.js` ignore `/api/`.
  Vérifier qu'il échoue sans le code.
- [x] T002 [US1] `test/ui.test.js` : `K.klant.set` ne garde que `{user, client:{id, nom, taal}}`,
  `creds()` → `{user}` (ou `{user, token}` pour un jeton hérité), `forgetToken()`.

## Phase 2: Serveur

- [x] T003 [US1] [US2] [US3] `lib/clientauth.js` : `COOKIE`, `BODY_TOKEN_UNTIL`,
  `bodyTokenAllowed`, `cookieToken`, `setSessionCookie`, `clearSessionCookie`, `sameUser`
- [x] T004 [US1] [US3] [US4] `api/catalogue.js` : `authRequest(req, q, res, opts)` ; cookie
  posé (renouvellement) ; plus de `token` dans la réponse ; limites anti-force brute réservées
  aux essais de mot de passe
- [x] T005 [P] [US1] `api/orders.js`, `api/order.js`, `api/klantdoc.js`, `api/klantorder.js` :
  `authRequest`
- [x] T006 [US2] `api/klantwachtwoord.js` : déconnexion par cookie (effacé dans tous les cas),
  `setPassword` et changement de mot de passe posent le cookie, plus de `token` en réponse

## Phase 3: Navigateur

- [x] T007 [US1] [US3] `assets/ui.js` : `K.klant` (données d'affichage seulement, `creds`,
  `forgetToken`)
- [x] T008 [US1] [US2] [US3] `assets/pages/start.js`, `wachtwoord.js`, `klant.js` : plus de jeton
  stocké ; jeton hérité oublié après un appel réussi ; déconnexion par cookie
- [x] T009 [P] [US1] `assets/pages/privacy.js` : cookie de session client (NL/FR)

## Phase 4: Tests existants et documentation

- [x] T010 Chemin du jeton (Set-Cookie / en-tête cookie) dans `test/security.test.js`,
  `test/klantgebruikers.test.js`, `test/invoicing.test.js`, `test/btw-regime.test.js`,
  `test/creditnotas.test.js`, `scripts/workflow-check.js` (AL1, AX5) — sans changer ce qu'ils
  vérifient
- [x] T011 [P] `docs/adr/0003-jeton-client-signe.md`, `README.md`, `IDEAS.md` (B3), `docs/RUNBOOK.md`
  (fin de transition et retrait du chemin « corps »)

## Phase 5: Polish

- [x] T012 `node scripts/assets-version.js`, `node scripts/check.js`, `npx -y eslint@9.39.5 .`
  (codes de sortie vérifiés un par un)
- [x] T013 `node scripts/ux-audit.js` + `node scripts/kbd-audit.js` contre
  `FAMO_RESEED=1 node scripts/dev.js` (port libre)

## Suivi (après le 31/10/2026)

- Retirer le chemin « jeton dans le corps » (`bodyTokenAllowed`, `q.token` dans `authRequest`,
  `creds().token` et `forgetToken` dans `assets/ui.js`) et les tests de transition.
