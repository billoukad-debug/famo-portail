# Implementation Plan: Documents A4 et e-mails redessinés (audit A10)

**Branch**: `worktree-agent-ae288de1ce2b50cf0` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

## Summary

Rendu seulement, aucun calcul ni donnée modifiés. `documents.js` : nouvelle mise en page de
`render()` (en-tête fournisseur / client / document, tableau avec taux par ligne, récapitulatif TVA,
totaux, paiement, mentions, pied légal) et nouvelle feuille de style en ligne (Helvetica / Arial,
jetons Vismijn, `@page` A4, en-tête de tableau répété). Les fragments que les tests lisent
(`metalabel`/`metavalue`, `trow`, `bankrow`, `regime`, `ordered`, `lot`, `<h1>`) gardent leur
forme exacte. E-mails : nouveau module `lib/maillayout.js` (coquille, marque, titre, faits,
tableau, note, bouton, pied, texte d'aperçu) utilisé par `lib/ordermail.js` et `lib/authmail.js`.

## Technical Context

**Language/Version**: Node 22 (CI) / 24 (Vercel), CommonJS ; JavaScript navigateur sans build
**Primary Dependencies**: aucune ; `vendor/html2pdf` (inchangé) pour le PDF
**Storage**: aucun changement
**Testing**: `node --test` (`test/documents.test.js`, `test/ordermail.test.js`,
`test/correctiemail.test.js`), `scripts/workflow-check.js` (blocs G, M, O, AZ, BA, AR inchangés),
rendu Playwright local hors dépôt (captures relues)
**Target Platform**: aperçu A4 (iframe 794 px), impression navigateur, PDF html2pdf ; Gmail
(web, Android, iOS), Outlook (Windows / moteur Word, web), Apple Mail
**Constraints**: pas de `<style>` ni de flexbox dans les e-mails (tests M2c), pas d'`<img>` (M2d) ;
`page-break-after:always` une seule fois par séparation (test buildMany) ; `const eur=(value=>{…});`
gardé tel quel (bloc AZ) ; ne pas toucher `assets/ui.css`, `api/updateorder.js`, les pages HTML,
`assets/pages/*`

## Choix de rendu

### Documents

- Grille en deux colonnes (flex, largeurs fixes) : à gauche fournisseur puis client, à droite
  titre puis faits du document (numéro en premier, en gras). Les classes `.mast`, `.party`,
  `.metaband`, `.totals`, `.bank`, `.foot`, `.banner` sont gardées : `staff-doc-preview.js` les liste
  dans `pagebreak.avoid` du PDF ; les nouveaux blocs sont des `<section>` (aussi dans la liste).
- Tableau : en-tête en casse normale, filet encre 1 px ; lignes filet `#E3EAEB` ; colonnes
  chiffrées alignées à droite, `tabular-nums`, `white-space:nowrap` ; colonne « Btw / TVA » (taux)
  sur les documents chiffrés seulement. Le taux par ligne vient de la même fonction que les totaux
  (`rateFor` + régime 0 %).
- Récapitulatif TVA (tableau `.vatsum` : taux, base, TVA) à gauche des totaux. Les lignes de
  totaux gardent leur forme (`btw 21% <small>(op € 50,00)</small>`, tests).
- Paiement (`.bank`, mode portaal) : bénéficiaire, IBAN, BIC, communication, plus montant TVAC et
  échéance. `.mono` n'est plus une police à chasse fixe : Helvetica, chiffres tabulaires.
- Mentions : bloc conditions (`.foot` : motif / conditions de paiement / de livraison, CGV) puis
  pied légal (`.legal` : raison sociale, BCE, RPR, nom commercial ; adresse, TVA, IBAN/BIC).
- Impression : `@page{size:A4;margin:14mm 16mm 16mm}` et `body{padding:0}` en `@media print` ;
  `thead{display:table-header-group}`, `tr{break-inside:avoid}`, blocs de fin non coupés.
  Le PDF html2pdf ignore `@media print` et `@page` (styles recopiés, `scopedCss`) : les marges
  latérales viennent du `padding` du corps, comme avant.

### E-mails

- `lib/maillayout.js` : `shell({ title, lang, preheader, brand, rows })`, `brandRow`, `headerRow`,
  `paragraphRow`, `factsRow`, `noteRow`, `credentialsRow`, `buttonRow`, `footerRow`, `cell styles`
  (`TH`, `TD`) pour les tableaux métier qui restent dans `lib/ordermail.js` (lignes, correction).
- Mode sombre : `<meta name="color-scheme" content="light only">` + `supported-color-schemes`,
  `bgcolor` + `background-color` + `color` explicites sur chaque cellule ; texte blanc seulement
  sur cellule `bgcolor="#0B5A6C"` (marque F, bouton).
- Outlook : tableau fantôme `<!--[if mso]>` de 600 px, bouton « bulletproof » (cellule colorée +
  lien à padding), `mso-line-height-rule`.
- Texte d'aperçu : `div` caché (`display:none`, `mso-hide:all`) avec une phrase du message déjà
  traduite (aucune nouvelle chaîne) + espaceurs pour ne pas aspirer le corps.
- Marque : cellule Noordzee 32 px avec « F » Arial gras blanc (pas d'image : test M2d, pas de
  lien externe) + nom en casse normale.

## Constitution Check

- I. Sans build, sans dépendance : ✅ un module `lib/` ajouté (`require` statique, inclus par
  Vercel nft) ; aucun fichier CSS ; `documents.js` garde son CSS en ligne (règle DESIGN.md § 8) ;
  aucun style en ligne ajouté dans les pages ; `node scripts/assets-version.js` lancé
  (`documents.js` change de version).
- II. Le serveur décide : ✅ aucun calcul déplacé ; TVA, numéros et montants viennent des mêmes
  fonctions ; aucun secret ; aucun handler touché.
- III. Tests d'abord : ✅ nouveaux tests dans `test/documents.test.js` et `test/ordermail.test.js`
  écrits avant le code (échouent sur l'ancien rendu) ; aucune assertion existante affaiblie ;
  `scripts/workflow-check.js` non modifié ; rendu Playwright en local uniquement.
- IV. Terrain : ✅ documents NL/FR (nouvelles chaînes traduites dans `T.nl` / `T.fr`), e-mails
  internes NL, e-mails client dans la langue du client ; contraste AA (encre `#0E2229`, gris
  `#475A61` ≥ 7:1 sur blanc) ; bouton ≥ 44 px.
- V. Données : ✅ aucun champ, aucune table ; facture émise inchangée (rendu seulement) ; mentions
  légales et TVA par ligne (EN 16931) renforcées.

## Project Structure

```text
specs/012-documents-emails/  spec.md · plan.md · tasks.md · checklists/requirements.md
documents.js                 render() + CSS (mise en page A4, taux par ligne, récap TVA, impression)
lib/maillayout.js            gabarit e-mail commun (nouveau)
lib/ordermail.js             briques remplacées par lib/maillayout.js, texte d'aperçu par e-mail
lib/authmail.js              même gabarit, texte d'aperçu, lien de secours sous le bouton
test/documents.test.js       + taux par ligne, récap, paiement, impression, jetons, ordre des blocs
test/ordermail.test.js       + gabarit commun, color-scheme, aperçu, bouton, blanc sur Noordzee
DESIGN.md                    « Reste à faire » 2 et 3 mis à jour
```

## Complexity Tracking

- Titres de document en capitales (FACTUUR, NOTE DE CRÉDIT…) : contraire à « aucun libellé en
  capitales » mais imposés par `scripts/workflow-check.js` (BA) qu'on ne modifie pas, et usage
  légal courant ; les libellés passent tous en casse normale.
- Pas de thème sombre dédié dans les e-mails : il faudrait un `<style>` + `prefers-color-scheme`,
  interdit par les tests M2c (Gmail supprime `<style>` dans la vue repliée).
