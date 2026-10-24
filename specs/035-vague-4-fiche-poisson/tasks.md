# Tasks: Vague 4 « fiche poisson et traçabilité par lot »

- [x] T001 Tests d'abord : `test/vague4.test.js` ; `test/trace.test.js` adapté (zone et engin en liste fermée)
- [x] T002 `assets/visfiche.js` : listes fermées (méthodes, zones FAO, engins, états, 14 allergènes, barèmes), contrôle, libellés NL/FR
- [x] T003 Visfiche produit : `lib/beheer/producten.js` (saveProduct `vis`), `lib/beheer/common.js`, `api/catalogue.js`, `assets/pages/beheer.js`
- [x] T004 Lots : `lib/trace.js` (champs, instantané complété, `fiches`, rattachement par identifiant), `api/lots.js` (`Product-id`, `?geleverd=1`), `assets/pages/team/lots.js`
- [x] T005 Instantané figé à « Klaar » : `lib/commande/bijwerken.js` (`Productfiche`), `api/allorders.js`, `api/klantdoc.js`
- [x] T006 Documents : `assets/docs/documents.js` ; module chargé avec les documents (`assets/ui.js` `DOCS`, `scripts/assets-version.js`)
- [x] T007 Catalogue client et vitrine : `assets/pages/klant.js`, `assets/ui.js` (`K.FR`), `lib/vitrine.js`, `api/vitrine.js`
- [x] T008 Schéma : `scripts/fake-airtable.js`, `docs/SCHEMA.md` ; démo locale `scripts/seed.js` (`visfiche`)
- [x] T009 Note « Nieuw » (`assets/nieuws.js`), versions des fichiers (`scripts/assets-version.js`)
- [ ] T010 Réponses du juriste / de l'AFSCA aux questions ouvertes (spec, section « Questions juridiques ouvertes »)
- [ ] T011 Validation du gérant sur la version d'essai, puis « go » et fusion
