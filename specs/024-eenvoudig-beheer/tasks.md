# Tasks: Eenvoudig beheer — « Vandaag »

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1 — Tests d'abord

- [x] T001 `test/vandaag.test.js` : module pur (étape suivante par statut et rôle, payloads, retour arrière,
  tri / filtres / compteurs, Lots verplicht → panneau) — rouge (module absent)
- [x] T002 Même fichier : les payloads du module font passer une vraie commande Reçue → Prête → Onderweg →
  Facturée → Payé par `api/updateorder` (SQLite), puis chaque « Ongedaan maken » revient d'une étape

## Phase 2 — Cœur (US1, US2)

- [x] T003 `assets/vandaag.js` (module pur) jusqu'au vert
- [x] T004 `team/vandaag.html` + `assets/pages/team/vandaag.js` : filtres comptés, cartes, bouton d'étape,
  toast « Ongedaan maken », erreur serveur sur la carte, actualisation 60 s + signal nouvelle commande (son
  désactivable)
- [x] T005 Styles `.vd-*` dans `assets/ui.css` (56 px, 2 colonnes ≥ 1100 px, 320 px sans défilement)

## Phase 3 — Saisie et menu (US3, US4)

- [x] T006 « + Bestelling » : feuille client → articles (règles de carton) → envoyer (`/api/staff`)
- [x] T007 Menu « ⋯ » : aantallen wijzigen, annuleren, document, geleverd met naam / handtekening, bellen,
  WhatsApp, leverdag / nota

## Phase 4 — Mode d'appareil (US5)

- [x] T008 `K.modus` / `K.setModus` / `K.home` ; menu Eenvoudig ; réglage « Weergave » dans le panneau
  d'appareil ; invite « Altijd zo openen? » sur Vandaag
- [x] T009 Connexion → `K.home` ; app installée (Bestellingen sans hash, 1er lancement de l'onglet) → Vandaag ;
  balises Apple plein écran

## Phase 5 — Portes et documentation

- [x] T010 `ux-audit` / `kbd-audit` : `/team/vandaag` (+ ⋯, + Bestelling) ; `parcours-check` : 4 taps + annulation
  + saisie
- [x] T011 AGENTS.md (024), RUNBOOK (mode d'emploi gérant), spec (écart Geleverd)
- [x] T012 Portes : assets-version, check.js, ESLint, contrast-check, ux-audit → parcours-check → kbd-audit ;
  captures 390 / 1280 ; préversion
