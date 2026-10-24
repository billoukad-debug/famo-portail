# Tasks: Vague 3 « facturation et paiement »

- [x] T001 Tests d'abord : `test/vague3.test.js` ; `test/ubl.test.js` (403 personnel), `test/commande-routes.test.js` (module `verzending`)
- [x] T002 `vendor/qrcode-generator.js` 2.0.4 (MIT, intégrité npm vérifiée) + `vendor/qrcode-generator.LICENSE`
- [x] T003 `assets/epc.js` : contenu EPC069-12, règles (Portaal, IBAN réel), SVG ; chargé par `K.docs` (`assets/ui.js`, `scripts/assets-version.js`)
- [x] T004 `lib/verzending.js` + `lib/commande/verzending.js` + aiguillage `api/updateorder.js` ; garde dans `lib/commande/corrigeren.js`
- [x] T005 `lib/boekhouder.js` + `api/export.js` (`format=lijst|csv`, 401/403) ; `api/allorders.js` (`verzending`), `api/orders.js` (`vervaldatum`, `openstaand`)
- [x] T006 Écrans : `beheer/boekhouder.html` + `assets/pages/beheer/boekhouder.js`, onglet Beheer, lien Documenten ; fiche et Bestellingen (`staff-common.js`) ; document factuur (`assets/docs/documents.js`) ; portail client (`assets/pages/klant.js`, `ui.css`, `K.FR`)
- [x] T007 `docs/SCHEMA.md`, `scripts/fake-airtable.js`, `AGENTS.md`, `README.md`, `scripts/ux-audit.js`, note « Nieuw »
- [ ] T008 Scan réel du QR avec 2 ou 3 apps bancaires belges (INCERTAIN OGM) — sur la version d'essai, sans payer
- [ ] T009 Réponse du comptable (Billtobox ou point d'accès Peppol), puis lot 3.2 (envoi), sur une nouvelle spec
- [ ] T010 Validation du gérant sur la version d'essai, puis « go » et fusion
