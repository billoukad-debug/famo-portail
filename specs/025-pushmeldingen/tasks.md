# Tasks: Pushmeldingen

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1 — Tests d'abord

- [x] T001 `test/push.test.js` : vecteur RFC 8291 (annexe A) ; JWT VAPID vérifiable (ES256, aud, exp ≤ 24 h, sub) ;
  aller-retour chiffrement / déchiffrement avec des clés aléatoires — rouge (module absent)
- [x] T002 Même fichier : clés (env prioritaire, sinon générées une fois et relues ; jamais dans `/api/config` ni
  dans les données Beheer) ; `api/push.js` (401 sans session, garde, liste blanche, doublon, max 20, désabonnement,
  test vers cet appareil, liste / retrait beheerder seul)
- [x] T003 Même fichier : commande client → envoi déchiffrable (client, ref, url) ; saisie personnel → rien ;
  service en panne / lent / 500 → commande 200 et « Laatste fout » ; 410 → appareil retiré ; e-mail
  « Te controleren » → notification

## Phase 2 — Serveur

- [x] T004 `lib/webpush.js` jusqu'au vert (T001)
- [x] T005 `lib/push.js`, `api/push.js`, `TABLES`, crochets `api/order.js` et `lib/inbound/mailorder.js` (T002, T003)

## Phase 3 — Client

- [x] T006 `sw.js` : push + notificationclick
- [x] T007 Vandaag : panneau « Meldingen » (iPhone sans app installée, sans support, autorisation refusée,
  aanzetten / uitzetten / test, son dans l'app)
- [x] T008 Beheer → Toegang : carte « Meldingen op toestellen » (liste, retrait)

## Phase 4 — Données, documentation, portes

- [x] T009 `docs/SCHEMA.md`, `scripts/fake-airtable.js`, page vie privée (NL / FR), RUNBOOK, AGENTS.md
- [x] T010 `ux-audit` (panneau Meldingen, Toegang) ; portes : assets-version, check.js, ESLint, contrast-check,
  ux-audit → parcours-check → kbd-audit
- [ ] T011 Validation sur l'iPhone de Mohsen (« Test sturen », puis une commande de test) — manuelle, hors CI (EN ATTENTE)
