# Tasks: Lignes de commande structurées (B4)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1 — Tests d'abord

- [x] T001 `test/lignes-structurees.test.js` : renommage puis départ ; renommage (+ nom repris par un
  nouveau produit) puis note de crédit avec retour ; renommage puis recommande client
  (`/api/orders` `items`) ; ancienne commande texte seul inchangée ; injection client (prix, nom,
  référence inconnue, `Lignes JSON`) et personnel (`Lignes JSON` dans le corps) sans effet ;
  `lib/lignesjson` (unité). Constaté rouge sur le code d'avant.

## Phase 2 — Écriture du champ (serveur seul)

- [x] T002 `lib/lignesjson.js` : `entry`, `serialize`, `parse`, `linked`, `renamed`
- [x] T003 `api/order.js`, `api/staff.js` : `Lignes JSON` à la création
- [x] T004 `lib/commande/lignes.js` + `bijwerken.js` : `Lignes JSON` avec les lignes modifiées ; article
  renommé retrouvé par sa référence
- [x] T005 `lib/beheer/producten.js` : renommage → `naam` du JSON des commandes ouvertes

## Phase 3 — Lecture par référence

- [x] T006 `lib/commande/stock.js` : `moveStock(lignes, sign, json)` (catalogue lu seulement si besoin)
- [x] T007 `bijwerken` (départ), `corrigeren` (terug, annuleren), `creditnota` (retour) passent le JSON
- [x] T008 `api/orders.js` `items[]` ; `assets/pages/klant.js` `linesToCart` par référence
- [x] T009 `lib/journal.js` : `Lignes JSON` hors du journal d'audit (bruit technique)

## Phase 4 — Documentation et portes

- [x] T010 `docs/SCHEMA.md`, `scripts/fake-airtable.js`, `docs/RUNBOOK.md` (note de migration), IDEAS B4
- [x] T011 `node scripts/assets-version.js`, `node scripts/check.js`, `npx -y eslint@9.39.5 .`,
  ux-audit + kbd-audit (port 4330) : codes de sortie vérifiés un par un
