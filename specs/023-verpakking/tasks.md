# Tasks: Verpakking / verkoopeenheid

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1 — Tests d'abord

- [x] T001 `test/verpakking.test.js` : aides `FamoVat.pak*` ; Beheer `saveProduct` (valide, effacé, refus) ;
  commande client 12 = 2 doos (texte, total, JSON figé, stock 12) ; 7 refusé (NL, FR via `K.errText`),
  rien d'écrit ; produit « niet enkel » 7 accepté ; Invoeren même refus ; injection navigateur
  (`per` dans le corps) sans effet ; produit sans conditionnement identique au centime (texte + JSON) ;
  documents (facture, bon, ancien ordre identique) ; e-mails (NL/FR, ancien identique) ; UBL (`cbc:Note`,
  ancien XML identique) ; e-mail entrant « 2 dozen » (conversion, désaccord, non multiple) ;
  `allorders` / `orders` / `klantdoc` exposent `verpakking`. Constaté rouge sur le code d'avant.

## Phase 2 — Serveur

- [x] T002 `assets/vat.js` : `pakOf`, `pakFits`, `pakSplit`, `pakUnit`, `pakLabel`, `pakOne`, `pakQty`, `pakCalc`
- [x] T003 `lib/beheer/producten.js` (+ `common.js`) : champs, validation, envoi à Beheer
- [x] T004 `lib/lignesjson.js` (`entry`, `pakMap`), `lib/bestelling.js` (refus), `lib/commande/lignes.js` (figé)
- [x] T005 `api/catalogue.js`, `api/staff.js`, `api/allorders.js`, `api/orders.js`, `api/klantdoc.js`
- [x] T006 `lib/ordermail.js` + appelants ; `lib/ubl.js` ; `lib/inbound/claude.js` + `mailorder.js`

## Phase 3 — Écrans

- [x] T007 `assets/ui.js` (stepper `suffix`/`label`, `K.pak*`, `K.linesSummary`, FR) + `assets/ui.css`
- [x] T008 `assets/pages/klant.js` (catalogue, détail, panier, favoris, commande type, confirmation, commande, recommande)
- [x] T009 `assets/docs/documents.js`
- [x] T010 `assets/pages/beheer.js` (Producten), Invoeren, staff-common, Bestellingen, bestelling, Magazijn, Leveringen, Te controleren

## Phase 4 — Données, documentation, portes

- [x] T011 `scripts/seed.js` (Eieren, per 6, enkel ; Oesters per 12 kist, pas enkel), `scripts/fake-airtable.js`, `docs/SCHEMA.md`, AGENTS.md
- [x] T012 Parcours navigateur aloha / welkom123 (2 doos, panier, bestelling, facture, bon, refus 7), captures 1280 / 390
- [x] T013 Portes : assets-version, check.js, ESLint, contrast-check, ux-audit → kbd-audit (serveur reseedé)

## Phase 5 — Correctif « 12 x 0,8 kg » (FR-009)

- [x] T014 Test d'abord (`test/verpakking.test.js`, « 12 x 0,8 » kg) : rouge (`pakParse` absent)
- [x] T015 `FamoVat.pakParse`, `pakOf`/`pakOne` avec `stuks`, `lib/beheer/producten.js`, `lib/verpakking.js`, `lib/lignesjson.js`, Beheer (saisie, aide, valeur relue), `K.pakParse`, SCHEMA, fake-airtable
