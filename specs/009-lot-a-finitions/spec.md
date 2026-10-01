# Feature Specification: Lot A — docs exactes, panier juste, nettoyage, focus clavier

**Created**: 2026-10-01 · **Status**: Implemented
**Input**: inventaire du 01/10/2026, « fais A » (A1, A2, A3, A8).

## Requirements
- **A1 — Docs alignées sur le code** : `CRON_SECRET` obligatoire (sauvegarde nocturne + relances, 500 sinon ; la sauvegarde part par e-mail et exige aussi `RESEND_API_KEY` + destinataire) ; `/api/health` et export/restauration Beheer existent ; IDEAS A1 (preuve photo) et B1 (compteur atomique) faits ; DESIGN.md (logo F, chiffres des styles en ligne).
- **A2 — Panier juste** : « Bestel vóór {t} voor levering op {d} » avec le vrai premier jour livrable (`firstDay()` = `K.orderWindow`), plus de « morgen » promis à tort (samedi soir, jour fermé) ; même correction pour l'erreur « dag te vroeg », l'aide du choix de jour et le récapitulatif ; NL/FR.
- **A3 — Nettoyage** : `FAMO_DEV` et `FAMO_INSECURE_COOKIES` (jamais lues) retirées de `scripts/dev.js` ; bannière de `scripts/dev-server.js` sans le faux « famo2026 (fallback) ».
- **A8 — Clavier** : CLA-10 mesuré (le focus suit la carte d'une colonne à l'autre) et verrouillé par un scénario `kbd-audit` ; MEP-05 couvert par le contrôle 2.4.11 de `kbd-audit`.

## Success Criteria
- check.js, ESLint, ux-audit puis kbd-audit (ordre CI, données neuves) : 0 écart.
