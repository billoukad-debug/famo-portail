# Feature Specification: Derniers styles en ligne vers ui.css (A5)

**Created**: 2026-10-01 · **Status**: Implemented
**Input**: inventaire du 01/10/2026, item A5 — constitution I : « Aucun style en ligne ajouté ; ceux qu'on
touche migrent vers `ui.css` ». Il restait 307 `style="` dans les pages HTML, `assets/ui.js` et
`assets/pages/**/*.js` (+ 1 `style=\"` échappé dans `wachtwoord.js`).

## Requirements
- **FR-001** Chaque style en ligne **statique** devient une ou plusieurs classes de `assets/ui.css` ; rendu
  identique au pixel (1280 et 390 px, mêmes écrans que `scripts/ux-audit.js` + quelques états en plus).
- **FR-002** Un seul système : les utilitaires I-12 existants sont réutilisés ; les nouveaux suivent la même
  nomenclature courte (`fs-14`, `mt-10`, `gap-8`, `d-flex`, `jc-sb`, `ta-r`, `w-130`, `maxw-320`, `minw-0`,
  `mh-44`…) ; un bloc qui forme un tout devient un composant (`wrap-760`, `sig-pad`, `ok-ring`, `thumb-28`,
  `btn-tall`, `tap-44`, `ellipsis`, `card-tint`, `btn-light`, `btn-glass`, `offscreen`, `code-input`…).
  Aucun nom haché.
- **FR-003** Force identique à un style en ligne : `:where(.x){…!important}` (spécificité nulle) — gagne
  contre toute règle normale, cède comme avant aux règles `!important` de la feuille (`.hidden`,
  `.input` au tactile, `.tag .ibtn`…).
- **FR-004** Comportement, textes, URL et arborescence inchangés.
- **FR-005** `scripts/check.js` refuse un nouveau style en ligne statique (plafond).

## Exceptions justifiées (restent en ligne)
- **Valeurs calculées** (6) : largeur du panneau `width:min(' + o.width + ',100%)` (`ui.js`) ; couleur de
  statut `border-top-color:var(--st-…)` (carte du bord, `staff-common.js`) et `border-left-color:var(--st-…)`
  (kalender) ; couleur de groupe `border-left-color:' + color` et pastilles `background:' + color`
  (`bestellingen.js`, `magazijn.js`).
- **État piloté par `el.style` dans le JS** (3) : `#fUitzNota` et `#vAdd` (`display:none` que le JS remet à
  `""`) ; `#otherDay` (bordure/couleur que le JS pose et efface). Une classe `!important` bloquerait le JS.
- **Document autonome** (4) : la verzamellijst (`S.pickingHtml`) a sa propre feuille `<style>`, sans `ui.css`
  (comme les documents et e-mails, DESIGN.md § 8).
- Hors périmètre : `assets/docs/documents.js` (documents, CSS en ligne voulue) et le bloc `<style>` de
  `klant.html` (feuille de page, pas un attribut).

## Success Criteria
- 307 → 13 `style="` (dont 7 statiques = plafond de `check.js`, 6 calculés).
- Captures avant/après : pixels et styles calculés de chaque élément identiques, écarts expliqués.
- `assets-version`, `check.js`, ESLint, `contrast-check`, puis ux-audit → kbd-audit (données neuves) : verts.
