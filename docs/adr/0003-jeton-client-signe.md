# ADR 0003 — Jeton client signé ; cookie HttpOnly pour le personnel

Statut : acceptée.

## Contexte
Au départ, le navigateur du client gardait son identifiant et son mot de passe et les renvoyait à chaque appel ; les mots de passe étaient en clair. Le personnel, lui, a une session par cookie.

## Décision
- **Personnel** : cookie `famo_sess` HttpOnly, Secure, SameSite=Lax, 8 h, signé HMAC (`lib/staffauth.js`) ; format `exp.rôle[.nom].signature`. Les API ne lisent jamais un code dans l'URL ou le corps, sauf `POST /api/session`.
- **Client** : après la connexion, le serveur renvoie un **jeton signé** `k.<recId>.<exp>.<empreinte>.<signature>` valable 12 h (`lib/clientauth.js`), gardé en `sessionStorage` (l'onglet) à la place du mot de passe. L'empreinte dérive du mot de passe stocké : changer ou réinitialiser le mot de passe invalide tous les jetons.
- Mots de passe clients, codes et PIN : empreinte scrypt ; migration douce du clair à la connexion.
- Même secret HMAC pour les deux : `SESSION_SECRET` (sinon dérivé des codes et des identifiants de base).

## Conséquences
- Le mot de passe ne circule qu'une fois ; un jeton volé expire en 12 h au plus ; révocation globale en changeant `SESSION_SECRET`.
- Un jeton en `sessionStorage` reste lisible par un script injecté (XSS) : la CSP de `vercel.json` et `K.esc()` sont la défense. Un cookie HttpOnly pour le client reste une amélioration possible (`IDEAS.md`, B3).
- Les expirations sont testées avec des jetons correctement signés (`scripts/workflow-check.js`, session staff et AX5).

## Mise à jour (01/10/2026, `specs/013-cookie-client-httponly`, IDEAS B3)
- Le jeton client (même format, `k.<recId>.<exp>.<empreinte>.<iat>.<génération>.<signature>`) ne passe plus par JavaScript : le serveur le pose dans le cookie **`famo_klant`** (HttpOnly, Secure, **SameSite=Strict**, **Path=/api**, Max-Age = durée restante du jeton) à la connexion, au choix du mot de passe par lien, au changement de mot de passe et à chaque ouverture du catalogue ; la déconnexion l'efface (et augmente la génération). Aucune réponse ne contient plus le jeton.
- L'onglet ne garde que des données d'affichage (`sessionStorage` `famoKlant` : identifiant, id / nom / langue de la zaak). Chaque appel annonce l'identifiant affiché ; s'il ne correspond pas à la session du cookie (autre compte connecté dans un autre onglet), refus 401.
- Strict plutôt que Lax : seuls les `fetch` des pages du portail utilisent le cookie ; un lien d'e-mail ouvre une page, pas une API. CSRF : `lib/guard.js` (Origin + JSON) reste en première ligne des routes client.
- Transition : le jeton dans le corps reste accepté **jusqu'au 31/10/2026 inclus** (Bruxelles), puis il est ignoré automatiquement (`BODY_TOKEN_UNTIL`, `lib/clientauth.js`) ; retrait du code ensuite.
- La conséquence XSS ci-dessus est réduite : un script injecté peut encore agir dans la page pendant la session, mais ne peut plus emporter le jeton pour l'utiliser ailleurs.
