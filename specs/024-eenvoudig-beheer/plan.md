# Implementation Plan: Eenvoudig beheer — « Vandaag »

**Branch**: `claude/brave-lovelace-s4xk7h` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

## Summary

Une page personnel `/team/vandaag` (HTML `team/vandaag.html`, script `assets/pages/team/vandaag.js`) qui
réutilise **sans les modifier** les API existantes (`/api/allorders` via `S.load`, `/api/updateorder` via
`S.update`, `/api/staff` pour la saisie, `/api/bewijs`, documents) et les panneaux de `staff-common.js`
(`validatePanel` si « Lots verplicht », `confirmDelivery` pour la livraison avec signature, `correctPanel`,
`askMode`). La logique « quelle est l'étape suivante, quel appel, quel retour arrière » vit dans un module
pur `assets/vandaag.js` (`window.FamoVandaag`, `module.exports`), testé en Node comme `assets/rapport.js`.
Préférence d'appareil `famoModus` (Eenvoudig / Uitgebreid) dans `assets/ui.js` (`K.modus`, `K.home`) :
arrivée après connexion, ouverture de l'app installée, menu réduit en Eenvoudig.

## Technical Context

**Language/Version**: JavaScript vanilla (navigateur), Node 22 (tests) · **Storage**: aucun champ nouveau ;
préférence d'appareil en `localStorage` (`K.store`, try/catch) · **Testing**: `test/vandaag.test.js`
(module pur + vraie chaîne `api/updateorder` sur SQLite), `scripts/parcours-check.js` (Playwright),
`ux-audit` / `kbd-audit` (nouvelles entrées) · **Target**: iPhone Safari / app installée (390 px, 320 px),
ordinateur (1280 px) · **Constraints**: aucune règle serveur touchée (SC-004), NL, WCAG 2.2 AA, 44 px.

## Constitution Check

| Principe | Conformité |
|---|---|
| I. Sans build | Page HTML + JS vanilla, un module pur `assets/vandaag.js` (même schéma que `assets/rapport.js`) ; styles dans `ui.css` ; `assets-version.js` après modification. |
| II. Le serveur décide | Aucune route ni règle serveur modifiée ; chaque tap = un appel existant, le serveur valide (étapes, stock, lots, FA, droits). Le navigateur ne calcule rien de métier. |
| III. Tests d'abord, local | `test/vandaag.test.js` écrit avant le module (rouge) ; parcours navigateur ajouté ; écritures uniquement en local (`scripts/dev.js`, SQLite). |
| IV. Terrain | Textes NL, bouton principal 56 px, focus visible, `aria-live` sur changement d'étape, `K.confirm`/`K.panel`, pas d'`alert`. Hors ligne : livraison hors ligne garde la file existante (`S.queue`) via `confirmDelivery`. |
| V. Données | Aucun champ ni table ajouté ; SCHEMA inchangé (préférence locale documentée dans AGENTS.md). |

## Project Structure (fichiers touchés)

```
team/vandaag.html                 nouvelle page (copie de l'en-tête de team/magazijn.html + vandaag.js)
assets/vandaag.js                 module pur : étapes, appels, retour arrière, tri, filtres (Node + navigateur)
assets/pages/team/vandaag.js      écran (cartes, filtres, + Bestelling, menu ⋯, signal nouvelle commande)
assets/ui.js                      K.modus / K.setModus / K.home ; menu Eenvoudig ; réglage « Weergave » dans
                                  le panneau d'appareil existant
assets/pages/aanmelden.js         après connexion → K.home(admin)
assets/pages/team/bestellingen.js app installée en Eenvoudig, premier lancement de l'onglet → /team/vandaag
assets/ui.css                     styles .vd-* (cartes, bouton principal, filtres)
manifest.webmanifest              inchangé (start_url /team/bestellingen ; redirection côté page)
team/*.html, beheer*.html         balises Apple plein écran (apple-mobile-web-app-capable / status-bar)
scripts/ux-audit.js, kbd-audit.js /team/vandaag (+ panneau ⋯, + Bestelling) aux deux largeurs
scripts/parcours-check.js         parcours « 4 taps » + annulation + saisie
test/vandaag.test.js              module pur + chaîne serveur réelle
AGENTS.md, docs/RUNBOOK.md        spec 024, mode d'emploi gérant
```

## Décisions

- **Geleverd en 1 tap** : réceptionnaire = nom du client ; « ⋯ → Geleverd met naam / handtekening » ouvre le
  panneau existant (nom modifiable, signature, photo, file hors ligne). Écart assumé vs spec US1-3 (« modifiable
  avant confirmation ») : le nom reste modifiable via ce chemin ; spec mise à jour.
- **Klaar** : `{ statut: "Prête", preparationValidee: true }` ; si `config.lotsVerplicht` → panneau de validation
  existant (lots).
- **Aantallen wijzigen** (Reçue / Prête) : `{ lignes }` (+ `preparationValidee: true` si Prête, sinon le serveur
  remet la préparation à valider et « Onderweg » serait refusé).
- **Ongedaan maken** : toast existant (`K.toast` action, 6 s) → `{ correction: "terug", reden }` ou
  `{ paiement: "En attente", reden }`.
- **Mode par défaut** : Uitgebreid ; menu Uitgebreid strictement inchangé (`NAV_DAILY` testé).

## Complexity Tracking

Aucun écart à la constitution.
