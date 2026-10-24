# Tasks: x30 lot A « la commande »

- [x] T001 Tests d'abord : `test/x30-commande.test.js` (médiane par jour de semaine, exclusions, prix du jour, repli,
      modifier, refus après l'heure limite / hors Reçue / autre client, minimum, journal, ajout au même jour, bandeau,
      jour fermé, après l'heure limite, groupes, casse, Rauw OK)
- [x] T002 `assets/bestellen.js` (pur, navigateur + serveur) : `klok`, `klokTekst`, `venster`, `groep`, `naam`, `soort`, `rauwOk`, `stap`, `rond`
- [x] T003 Serveur : `lib/gewoonte.js`, `lib/klantwijziging.js`, `api/orders.js` (`gewoonte`, `vaste`, `aanpasbaar`),
      `api/klantorder.js` (`wijzig`), `api/order.js` (ajout à la commande du même jour, clés cumulées)
- [x] T004 Client : `assets/pages/klant.js` (bandeau, carte, catalogue une vue, plaques, « + », Rauw OK, Facturen,
      modifier sans annuler, confirmation « toegevoegd »), `assets/ui.js` (onglets, icônes, `K.FR`), `klant.html`
- [x] T005 Style : bloc « x30 lot A » de `assets/ui.css`, jetons `:root`, `scripts/contrast-check.js`, police
      `assets/fonts/instrument-serif-*` + licence
- [x] T006 Audits navigateur adaptés : `scripts/ux-audit.js`, `scripts/kbd-audit.js`, `scripts/parcours-check.js` ;
      contrat d'échappement `test/catalogus.test.js` (nom affiché via `toon(p)`)
- [x] T007 Docs : `DESIGN.md` (amendement deux voix, une vue), `docs/SCHEMA.md`, `AGENTS.md`, `README.md`, note « Nieuw »
- [ ] T008 Lecture (seule) de l'historique de production pour vérifier que la carte sera remplie (plan x30, méthode 5)
- [ ] T009 Juge indépendant (barème de l'audit, ≥ 85/100 par écran) sur la version d'essai
- [ ] T010 Validation du gérant (police, Rauw OK, texte des écrans), puis « go » et fusion
