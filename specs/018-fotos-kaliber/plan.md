# Implementation Plan: Foto's (meerdere zichten) en volgorde per kaliber

**Branch**: `worktree-agent-a0ba4f9e9810ba403` (sur `claude/brave-lovelace-s4xk7h`, spec 017) | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

| Partie | Où | Quoi |
|---|---|---|
| URL sûres | `lib/photo.js` | `photoUrls(attachments)` (mêmes règles), `photoList` → `[{id, url}]` ; `photoUrl` = la première |
| Ajout / ordre | `lib/beheer/producten.js` | `uploadFoto` `add:true` (max 6, 400) ; `setFotos` (ids existants seulement, ordre du beheerder) |
| Journal | `api/onboarding.js`, `lib/journal.js` | `uploadFoto` / `setFotos` → Catalogue (avant → après) ; pièces jointes lues comme « n foto's: a.jpg, … » |
| Moteur | `lib/at-engine.js` | upload = ajout (comme Airtable) ; PATCH `[{id}]` → pièce jointe existante du champ, id inconnu 422 ; nettoyage `famo_files` par diff (inchangé) |
| Lecture | `lib/beheer/common.js`, `api/catalogue.js`, `api/stock.js`, `api/staff.js` | `fotos`, `foto`, `kaliber` |
| Aides navigateur | `assets/ui.js` | `K.kaliberKey`, `K.byNameKaliber`, `K.kaliberOrder` (purs, testés sous Node), `K.thumb` (vignette ou icône) |
| Client | `assets/pages/klant.js`, `klant.html`, `K.FR` | vignette en tête de ligne, galerie (scroll-snap, ← →, `aria-current`) |
| Personnel | `assets/pages/team/voorraad.js`, `assets/pages/team/invoeren.js` | vignette ; Voorraad : colonne Kaliber, tri nom puis kaliber |
| Beheer | `assets/pages/beheer.js` | gestion des photos (grille, Hoofdfoto, ◀ ▶, Verwijderen, « 3 van 6 ») ; « Sorteer op kaliber » |
| Style | `assets/ui.css` | `.pthumb`, `.gal-*`, `.fgrid` sur les jetons Vismijn, sans style en ligne |
| Données | `docs/SCHEMA.md`, `scripts/fake-airtable.js`, `scripts/seed.js`, `scripts/dev.js`, `scripts/dev-server.js` | Foto jusqu'à 6 ; faux Airtable : ajout, `[{id}]`, fichiers servis en `/api/foto` ; démo : 2–3 vues sur quelques produits (PNG générés) |

Modèle : le champ `Foto` est déjà une liste de pièces jointes (Airtable comme moteur SQL) ; « principale » =
la première. Rien à migrer : une fiche à une photo est une galerie d'une vue.

## Constitution Check

- I. Sans build : ✅ JS vanilla, une feuille `ui.css`, aucun style en ligne ajouté, `require` statiques,
  `assets-version.js` relancé. Les PNG de démo sont générés par `zlib` (Node intégré).
- II. Le serveur décide : ✅ nombre de photos plafonné par le serveur ; `setFotos` ne garde que les ids déjà
  présents dans la fiche relue (jamais une URL du navigateur) ; garde A-10 puis `adminSession` (point
  d'entrée inchangé) ; journal d'audit avant → après.
- III. Tests d'abord : ✅ `test/fotos.test.js` (SQLite en mémoire : ajout, plafond, type, ordre, suppression des
  fichiers, ids inconnus, personnel refusé, garde, réponses) et `test/kaliber.test.js` (aides pures) écrits
  avant le code ; aucun bloc ajouté à `scripts/workflow-check.js`.
- IV. Terrain : ✅ personnel et Beheer en néerlandais, client NL/FR (`K.t`), cibles ≥ 44 px, `aria-current`,
  ← → , suppression confirmée (`K.confirm`), pas d'animation au survol, `prefers-reduced-motion` respecté.
- V. Données : ✅ `docs/SCHEMA.md` et le faux Airtable dans le même commit ; aucun champ nouveau ; pas de
  donnée personnelle (photos produit publiques, comme avant).

## Complexity Tracking

- Le moteur SQL **ajoute** désormais à chaque upload (comme Airtable) : le test
  `test/bewijs.test.js` « photo produit : toujours remplacée » décrivait l'ancien raccourci du moteur ;
  il vérifie maintenant l'ajout au niveau moteur, et le remplacement reste garanti au niveau de l'API
  (`uploadFoto` sans `add` vide le champ d'abord, `test/datastore.test.js` inchangé).
- `thumbnails.small` d'Airtable fait 36 px de haut : trop flou pour une vignette de 44 px (88 px en écran
  dense). Les listes prennent l'URL `large` (comme `photoUrl`) en `loading="lazy"` ; en production
  (Postgres) les trois URL sont de toute façon le même fichier, déjà réduit à 1600 px par le navigateur.
- Faux Airtable : il servait des `data:` (refusées par `lib/photo.js`), donc aucune photo n'apparaissait
  en local. Il garde maintenant ses fichiers à part (`.dev-data/airtable-files.json`) et `dev-server.js`
  les sert sur `/api/foto` quand `api/foto.js` n'a pas de base SQL (dev seulement, rien en production).
