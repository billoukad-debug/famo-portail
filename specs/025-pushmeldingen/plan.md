# Implementation Plan: Pushmeldingen

**Branch**: `claude/brave-lovelace-s4xk7h` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

## Summary

Web Push standard, sans dépendance. `lib/webpush.js` (pur `node:crypto`) chiffre le message (RFC 8291,
`aes128gcm`, RFC 8188), signe l'en-tête VAPID (RFC 8292, JWT ES256) et envoie vers le service de l'appareil,
borné dans le temps. `lib/push.js` porte la règle métier : clés (variables d'environnement, sinon générées une
fois dans Configuratie), table `Pushabonnementen`, liste blanche des services, envoi à tous les appareils,
nettoyage 404 / 410. `api/push.js` (personnel) : clé publique, abonnement, désabonnement, test ; liste et retrait
pour le beheerder. Crochets : `api/order.js` (commande client, en parallèle de l'e-mail) et
`lib/inbound/mailorder.js` (commande créée depuis un e-mail ; e-mail mis en « Te controleren »). `sw.js` affiche
la notification et ouvre la page au toucher. Vandaag : panneau « Meldingen » (état, aanzetten, uitzetten, test,
son dans l'app). Beheer → Toegang : carte « Meldingen op toestellen ».

## Technical Context

**Language/Version**: Node 22 (CI, tests) / Vercel 24.x ; navigateur vanilla · **Storage**: table SQL générique
(`famo_records`, `TABLES` de `lib/at-engine.js`) `Pushabonnementen` + 2 champs Configuratie · **Testing**:
`test/push.test.js` (SQLite en mémoire, `fetch` simulé avant le chargement du moteur, vecteur RFC 8291 annexe A,
déchiffrement côté test avec la clé de l'appareil) · **Target**: Safari iOS ≥ 16.4 (app sur l'écran d'accueil),
Chrome / Edge / Firefox · **Constraints**: aucune dépendance npm, la commande n'échoue jamais à cause d'un envoi.

## Constitution Check

| Principe | Conformité |
|---|---|
| I. Sans build, sans dépendance | `node:crypto` seulement (ECDH P-256, HKDF, AES-128-GCM, ECDSA `ieee-p1363`) ; aucun module npm ; `assets-version.js` après le front. |
| II. Le serveur décide | Session personnel + garde Origin/JSON sur chaque POST ; liste et retrait : beheerder ; liste blanche des services (pas de requête serveur vers une adresse arbitraire) ; au plus 20 appareils ; clé privée jamais exposée. Fail-closed : clés impossibles à créer → 503 explicite, aucune notification envoyée en clair. |
| III. Tests d'abord, local | `test/push.test.js` écrit avant le code (rouge) ; aucun envoi réseau réel dans les tests (fetch simulé) ; écritures en local seulement. |
| IV. Terrain | Panneau NL, cibles ≥ 44 px, focus et `aria-live`, `K.panel` / `K.confirm`, aucune `alert()` ; explications iOS (app non installée, autorisation refusée). |
| V. Données et conformité | `docs/SCHEMA.md` + `scripts/fake-airtable.js` dans le même commit ; RGPD : appareils du personnel, retrait par le beheerder, nettoyage automatique ; page vie privée : service de notification du fabricant. |

## Décisions

- **Clés** : `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (base64url, P-256) si définies ; sinon paire générée à la
  première demande et écrite dans Configuratie (`Push publieke sleutel`, `Push privésleutel`), puis relue (deux
  instances simultanées : la valeur relue gagne). Sujet VAPID : `VAPID_SUBJECT`, sinon `mailto:` + e-mail de
  l'entreprise, sinon `https://www.famoseafood.be`.
- **Services acceptés** : `*.push.apple.com`, `fcm.googleapis.com`, `*.push.services.mozilla.com`,
  `*.notify.windows.com` (HTTPS).
- **Envoi** : TTL 1 jour, `Urgency: high`, sans `Topic` (il remplacerait chez le service une commande non encore
  livrée) ; 4 s par appareil (AbortController), tous en parallèle, sans suivre de redirection ; 2xx → « Laatst
  verstuurd » ; 404/410 → appareil retiré ; autre → « Laatste fout ». La liste des appareils est lue d'abord : sans
  appareil, une commande coûte une lecture (ni clés, ni envoi). Empreinte de la clé publique à l'inscription
  (`Sleutel`) : autre clé → retiré sans envoi.
- **Moteur SQL seulement** : sur Airtable (historique, sans table `Pushabonnementen`), tout est inerte et n'émet aucune
  requête — les scénarios `test/workflow` qui comptent les appels restent exacts.
- **E-mails « Te controleren »** : au plus une notification par 10 minutes (un autre message de la file reçu depuis
  moins de 10 minutes → pas de nouvelle sonnerie) ; contenu illisible chez Resend : seulement si Resend ne réessaiera pas.
- **Commande saisie par le personnel** : pas de notification (crochet seulement dans `api/order.js` et le
  module e-mail).
- **Contenu** : `{ title, body, url, tag }` ; corps « client · montant · levering <jour> » ; jamais l'adresse ni
  les lignes.
- **Service worker** : `push` → `showNotification` (icône FAMO, `tag` = commande) ; `notificationclick` → fenêtre
  existante ramenée et dirigée vers l'URL (même origine seulement), sinon nouvelle fenêtre.
- **iPhone** : l'abonnement est demandé directement dans le clic (geste de l'utilisateur requis par Safari) ;
  clé publique et `serviceWorker.ready` préchargés à l'ouverture du panneau.

## Project Structure (fichiers touchés)

```
lib/webpush.js                    nouveau : base64url, clés VAPID, JWT ES256, chiffrement aes128gcm, envoi borné
lib/push.js                       nouveau : clés (env / Configuratie), abonnements, liste blanche, newOrder, mailToReview
api/push.js                       nouveau : GET clé / liste (beheerder) ; POST subscribe / unsubscribe / test / remove
api/order.js                      push en parallèle de l'e-mail (commande client)
lib/inbound/mailorder.js          push : commande créée depuis un e-mail ; e-mail mis en « Te controleren »
lib/at-engine.js                  TABLES + « Pushabonnementen »
sw.js                             push + notificationclick
assets/pages/team/vandaag.js      panneau « Meldingen » (remplace le bouton son seul)
assets/pages/beheer.js            Toegang : carte « Meldingen op toestellen »
assets/pages/privacy.js           service de notification (NL / FR)
scripts/fake-airtable.js          table Pushabonnementen + champs Configuratie
scripts/ux-audit.js               panneau Meldingen (Vandaag), Toegang
test/push.test.js                 nouveau (+ test/_push-device.js : appareil simulé, déchiffrement indépendant)
docs/SCHEMA.md, docs/RUNBOOK.md, AGENTS.md
```

## Complexity Tracking

Aucun écart. Seule nouveauté de principe : une clé privée générée par le serveur et gardée en base (Configuratie),
au lieu d'une variable d'environnement — choisi pour que le gérant n'ait rien à configurer ; les variables
d'environnement, si elles existent, ont priorité (RUNBOOK : comment basculer).
