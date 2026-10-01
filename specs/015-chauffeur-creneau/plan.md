# Implementation Plan: Chauffeur (A4) et Leverslot (D4)

**Branch**: `worktree-agent-a9aa4fcd89f856c90` (sur la spec 010) | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

## Summary

| Partie | Où | Quoi |
|---|---|---|
| Règle du créneau | `lib/levering.js` `parseSlot` | `"6u-8u"`, `"06:00 – 08:00"` → `"06:00-08:00"` ; erreurs en néerlandais |
| Écriture | `lib/commande/bijwerken.js` | bloc autonome comme `volgorde` ; 409 si livrée ; journal « Leverslot » (`api/updateorder.js`) |
| Lecture | `api/allorders.js`, `api/orders.js` | `leverslot` (client : ses commandes, filtre existant) |
| Aides navigateur | `assets/ui.js` `K.slot`, `K.ronde` | analyse du créneau ; ordre de tournée et « prochain stop » (purs, testés sous Node) |
| Personnel | `assets/pages/staff-common.js` | `S.slotTxt`, `S.slotPanel` (deux `<input type="time">`), action `data-act="slot"` |
| Fiche commande | `assets/pages/order.js` | ligne « Leveruur » + Aanpassen |
| Leveringen | `assets/pages/leveringen.js` | bascule Lijst / Chauffeur (`K.store`), vue un stop, tag leveruur et bouton « Uur » en liste |
| Client | `assets/pages/klant.js` + `K.FR` | créneau dans la liste et la fiche (NL/FR) |
| Style | `assets/ui.css` | `.drv-*` sur les jetons Vismijn, sans style en ligne |
| Données | `docs/SCHEMA.md`, `scripts/fake-airtable.js`, `scripts/seed.js` | champ `Leverslot` (texte) ; le moteur SQL stocke les champs en JSON (aucun schéma à changer) |

Modèle du créneau : deux heures plutôt qu'un texte libre — affiché exactement en NL et en FR (un texte
libre du personnel serait en néerlandais chez un client francophone), et rien d'autre qu'une heure ne
peut y entrer. Une seule colonne texte (`HH:MM-HH:MM`), pas de nouvelle table.

## Constitution Check

- I. Sans build : ✅ JS vanilla, une feuille `ui.css` (classes `.drv-*`), aucun style en ligne ajouté
  (progression = `<progress>`), `assets-version.js` relancé.
- II. Le serveur décide : ✅ créneau validé et normalisé par le serveur ; écriture derrière la garde A-10 et
  `staffSession` (point d'entrée inchangé) ; le client ne reçoit que ses commandes ; la livraison passe par
  les chemins existants (`S.confirmDelivery`, `/api/updateorder`, `/api/bewijs`, file hors ligne).
- III. Tests d'abord : ✅ `test/leverslot.test.js` (SQLite en mémoire) et `test/chauffeur.test.js` (aides
  pures de `ui.js`) écrits avant le code ; scénario `kbd-audit` « Chauffeur » ; aucun bloc ajouté à
  `scripts/workflow-check.js`.
- IV. Terrain : ✅ personnel en néerlandais, client NL/FR (`K.t`), cibles ≥ 44 px (action principale 52 px),
  focus déplacé sur le titre du stop, bascules exposées (`aria-pressed`), préférence d'appareil en
  `localStorage` sous `try/catch` (`K.store`).
- V. Données : ✅ `Leverslot` dans `docs/SCHEMA.md` et le faux Airtable dans le même commit ; pas une donnée
  personnelle ; l'export RGPD reprend toutes les colonnes de la commande (test).

## Complexity Tracking

- `K.ronde` vit dans `assets/ui.js` (module partagé unique, constitution I) pour être testable sous Node.
- Aucun nouveau module `lib/commande/` (liste figée par `test/commande-routes.test.js`) : le bloc tient dans
  `bijwerken.js`.
