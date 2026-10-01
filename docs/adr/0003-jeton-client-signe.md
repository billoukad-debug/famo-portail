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
- Les expirations sont testées avec des jetons correctement signés (`test/workflow/` : session staff dans `sessions-roles.test.js`, AX5 dans `facturation.test.js`).
