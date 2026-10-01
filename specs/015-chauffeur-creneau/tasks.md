# Tasks: Chauffeur (A4) et Leverslot (D4)
- [x] T001 Spec, plan (Constitution Check), tâches
- [x] T002 Tests d'abord : `test/leverslot.test.js` (règle, écriture personnel seul, lecture client, RGPD) et `test/chauffeur.test.js` (`K.slot`, `K.ronde`, stockage bloqué) — 10 tests sur 11 en échec avant le code
- [x] T003 Serveur : `parseSlot` (lib/levering.js), bloc `leverslot` (lib/commande/bijwerken.js), journal « Leverslot », `allorders` / `orders`
- [x] T004 Données : `docs/SCHEMA.md` (champ + glossaire), `scripts/fake-airtable.js`, démo `scripts/seed.js` (créneaux, deux stops de plus aujourd'hui)
- [x] T005 Personnel : `S.slotPanel` / `S.slotTag` / `S.slotBtn`, fiche commande (Leveruur), Leveringen (tag + bouton Uur)
- [x] T006 Leveringen mode Chauffeur : bascule mémorisée, un stop, progression, Volgende / Vorige stop, focus, fin de ronde ; CSS `.drv-*` ; scroll-padding bas au téléphone (toasts)
- [x] T007 Client : créneau dans la liste et la fiche, NL/FR (`K.FR`)
- [x] T008 Audits : Chauffeur et panneau Leveruur dans `ux-audit`, scénario Chauffeur dans `kbd-audit` ; CHECKLIST-UX (CLA-11), IDEAS (A4, D4)
- [x] T009 Portes : assets-version, check.js, ESLint, ux-audit → kbd-audit (données neuves)
