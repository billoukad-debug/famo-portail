# Implementation Plan: Session client par cookie HttpOnly

**Branch**: `worktree-agent-a830d896f5c8da4f0` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

## Summary

Le jeton signé existant (`lib/clientauth.js`, format `k.id.exp.fp.iat.gen.sig` inchangé) quitte
le navigateur : il voyage dans un cookie `famo_klant` (HttpOnly, Secure, SameSite=Strict,
Path=/api, Max-Age = durée restante du jeton). `lib/clientauth.js` gagne la lecture et l'écriture
du cookie et la date de fin de transition. `api/catalogue.js` gagne `authRequest(req, q, res)` :
mot de passe → cookie → (transition) jeton du corps, contrôle de l'identifiant annoncé, pose du
cookie. Les six routes client l'utilisent ; plus aucune ne renvoie `token`. Côté navigateur,
`K.klant` ne garde que `{user, client: {id, nom, taal}}` et efface tout jeton hérité après le
premier appel réussi.

## Technical Context

**Language/Version**: Node 22 (CI) / 24 (Vercel), CommonJS ; navigateur ES2020, sans build
**Primary Dependencies**: aucune (Node intégré : `crypto`)
**Storage**: aucun changement de schéma (champ existant `Sessiegeneratie` de `Clients` et
`Klantgebruikers`)
**Testing**: nouveau `test/klantcookie.test.js` (node:test, SQLite en mémoire, vraies fonctions
`api/*.js`) ; mises à jour de chemin d'assertion dans `test/security.test.js`,
`test/klantgebruikers.test.js`, `test/invoicing.test.js`, `test/btw-regime.test.js`,
`test/creditnotas.test.js` et `scripts/workflow-check.js` (le jeton se lit dans `Set-Cookie`,
plus dans le corps) ; `test/ui.test.js` pour `K.klant`.
**Target Platform**: Vercel (fra1) + Neon ; local `node scripts/dev.js` (http://localhost =
contexte sûr, le cookie Secure passe)
**Constraints**: `lib/staffauth.js` inchangé (fail-closed) ; `assets/ui.css`, `documents.js`,
`lib/ordermail.js`, `api/updateorder.js` non touchés ; structure de `scripts/workflow-check.js`
inchangée (deux blocs : chemin du jeton seulement).

## Décisions

1. **Nom et portée** : `famo_klant`, `Path=/api`. Le cookie n'accompagne que les appels d'API,
   pas les pages ni les fichiers statiques. Pas de préfixe `__Host-` (il impose `Path=/` et
   interdirait le mode http local `FAMO_DEV_HTTP=1`).
2. **SameSite=Strict** (pas Lax) : seuls les `fetch` des pages du portail utilisent le cookie,
   toujours « même site ». Un lien d'e-mail ouvre une page HTML (sans cookie, chemin `/api`),
   puis la page appelle l'API depuis le même site : le cookie part. Rien ne requiert Lax.
3. **Durée** : `Max-Age` = échéance du jeton − maintenant (≤ 12 h). La vérité reste le jeton
   signé (échéance, iat 7 jours, empreinte, génération) : un cookie trafiqué ne prolonge rien.
4. **Ordre d'authentification** (`authRequest`) : mot de passe présent → connexion (limites
   anti-force brute inchangées) ; sinon cookie ; sinon, jusqu'à la fin de transition, `token` du
   corps. Le cookie prime : un jeton de corps n'est essayé que si le cookie manque ou ne vaut
   rien. Session obtenue autrement que par cookie → cookie posé (migration). Le catalogue pose
   toujours un cookie neuf (renouvellement, iat conservé).
5. **Transition** : jeton de corps accepté **jusqu'au 31/10/2026 inclus** (refusé dès le
   01/11/2026 00:00 Europe/Brussels = 2026-10-31T23:00Z), constante `BODY_TOKEN_UNTIL` dans
   `lib/clientauth.js`, testée des deux côtés de la date (horloge simulée). Après cette date, le
   code reste inoffensif (le corps est ignoré) ; le retrait du chemin est une tâche de suivi.
   Justification : 30 jours ≫ 7 jours de vie maximale d'un jeton.
6. **Identifiant annoncé** : la page envoie `user` (l'identifiant affiché, non secret). Sans mot
   de passe, s'il diffère de la fiche de connexion de la session → 401. Protège l'onglet A
   quand un autre onglet a connecté le compte B (cookie partagé).
7. **Déconnexion** : `POST /api/klantwachtwoord {action:"logout"}` lit le cookie (ou le jeton du
   corps en transition), génération +1, et efface **toujours** le cookie (`Max-Age=0`, même
   chemin), même en cas d'échec d'écriture : sur une tablette partagée, l'appareil doit être
   déconnecté quoi qu'il arrive.
8. **Plusieurs `Set-Cookie`** : ajout (tableau) plutôt que remplacement, au cas où une réponse en
   porterait déjà un.
9. **CSRF** : inchangé et suffisant — `lib/guard.js` en première ligne des six routes (Origin
   ou Referer = hôte, `null` refusé, JSON exigé, GET → 405 sur ces routes) + SameSite=Strict.
   Vérifié par tests avec un cookie valable.
10. **Hors ligne** : `sw.js` ne touche jamais `/api/*` (inchangé, testé textuellement) ; le
    cookie est envoyé par le navigateur (`credentials: "include"` dans `K.api`). Une erreur
    réseau n'efface rien (seul un 401 renvoie à la connexion), comme avant.

## Constitution Check

- I. Sans build, sans dépendance : ✅ aucun paquet ; code dans `lib/`, `api/`, `assets/ui.js`,
  `assets/pages/` ; aucun style en ligne ajouté ; `ui.css` non modifié ;
  `node scripts/assets-version.js` après la modification front.
- II. Le serveur décide (NON NÉGOCIABLE) : ✅ le serveur pose, renouvelle, vérifie et efface le
  cookie ; chaque handler garde `guard.blocked` en première ligne puis authentifie ; aucun
  secret dans le stockage du navigateur (le jeton en sort), l'URL ou les logs ;
  `lib/staffauth.js` inchangé (fail-closed : sans secret HMAC il n'y a ni cookie staff ni
  client).
- III. Tests d'abord : ✅ `test/klantcookie.test.js` écrit avant le code (échoue sans lui :
  aucun `Set-Cookie famo_klant`) ; portes `check.js`, ESLint, `ux-audit.js`, `kbd-audit.js`
  (interface client touchée) ; aucune écriture en production.
- IV. Terrain : ✅ textes NL/FR existants (`K.t`) ; Privacy NL/FR mise à jour ; une perte de
  réseau ne déconnecte pas ; aucun écran nouveau.
- V. Données : ✅ aucun champ nouveau (schéma inchangé) ; RGPD : le cookie est strictement
  nécessaire, mentionné dans la page Privacy.

## Project Structure

```text
specs/013-cookie-client-httponly/  spec.md · plan.md · tasks.md · checklists/requirements.md
lib/clientauth.js          COOKIE, BODY_TOKEN_UNTIL, bodyTokenAllowed, cookieToken,
                           setSessionCookie, clearSessionCookie, sameUser
api/catalogue.js           authRequest(req, q, res, opts) ; cookie posé, plus de token en réponse
api/orders.js · api/order.js · api/klantdoc.js · api/klantorder.js
                           authRequest au lieu de authClient(q.user, q.pw, q.token)
api/klantwachtwoord.js     logout (cookie effacé), setPassword et changement : cookie posé
assets/ui.js               K.klant : données d'affichage seulement ; creds() → {user[, token hérité]}
assets/pages/start.js · wachtwoord.js · klant.js
                           plus de jeton stocké ; jeton hérité oublié après un appel réussi
assets/pages/privacy.js    texte cookies NL/FR
test/klantcookie.test.js   nouveaux scénarios ; autres tests : chemin du jeton (Set-Cookie)
docs/adr/0003-jeton-client-signe.md · README.md · IDEAS.md (B3) · docs/RUNBOOK.md
```

## Complexity Tracking

Aucun écart à la constitution. Le chemin « jeton dans le corps » est une dette volontaire,
datée (fin le 31/10/2026) et neutralisée automatiquement à cette date.
