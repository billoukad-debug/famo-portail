# Implementation Plan: Rapportage

**Branch**: worktree (sur `main` 890baeb) | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

| Partie | Où | Quoi |
|---|---|---|
| Agrégation pure | `assets/rapport.js` (nouveau, UMD) | `periode`, `vergelijk`, `maanden`, `rapport(data, filters, deps)`, `sortRows`, `csv`, `csvNum` ; dépendances injectées : `parseLines`, `isoDay`, `vat`, `catLabel`, `familyOf` |
| API de lecture | `api/rapportage.js` (nouveau) | GET beheerder seul (401 / 403 / 405), commandes facturées + avec creditnota, sans test ; catalogue, clients, taux |
| Marge par client | `lib/margin.js`, `api/marge.js` | option `klant` (id `rec…`, sinon ignorée) |
| Page | `beheer/rapportage.html`, `assets/pages/beheer/rapportage.js` (nouveaux) | filtres (URL `?periode=…`), KPIs, 5 graphiques SVG, tableaux triables, listes de factures, Betaald, CSV |
| Navigation | `assets/ui.js` | `NAV_ADMIN` : Invoeren · Documenten · **Rapportage** · Beheer ; icône `chart` |
| Beheer | `assets/pages/beheer.js` | onglet « Rapportage » = lien `/beheer/rapportage` ; `#/rapportage` → `location.replace` ; ancien code (rapportage, margeCard) retiré |
| Style | `assets/ui.css` | `--chart-prev` (+ hoog contrast), `.rp-*` (filtres, puces, graphiques, info-bulle, tri), `@media (forced-colors)` |
| Contrôles | `scripts/check.js`, `scripts/contrast-check.js` | `assets/pages/beheer/` dans les listes (syntaxe, liens, styles en ligne) ; couples `chart-prev` / `p` sur `card` (3:1, 4,5:1 en hoog) |
| Démo | `scripts/seed.js` (`historie`), `scripts/dev.js` | 15 mois de factures (3 clients, creditnota, un produit à 21 %) |
| Audits | `scripts/ux-audit.js`, `scripts/kbd-audit.js` | états : base, filtre appliqué, téléphone ; parcours clavier |
| Docs | `AGENTS.md`, `README.md`, `DESIGN.md`, `docs/SCHEMA.md` | 022, menu, API lue |

### Données (`GET /api/rapportage`)

```
{ orders: [{ id, ref, factuurnummer, statut, date, dateLiv, factureeLe, clientId, client, lignes, total,
             paiement, payeLe, btwRegime, btwFrozen, creditnotas: [{ nummer, lignes, montant, le }] }],
  producten: [{ nom, cat, unit }], klanten: [{ id, nom, regime, gearchiveerd }],
  btwPerProduct: { "nom": taux }, config: { btwTarief, betaaltermijnDagen } }
```

Commandes : `atAll("Commandes")`, puis `testorders.real`, puis `Statut = Facturée` ou au moins une creditnota
(`lib/creditnota.list`). Régime : `lib/billing.regimeOf` (figé sur la facture, sinon celui du client). Taux figés :
`BTW per lijn`. Mêmes valeurs que `allorders` pour ces champs (même code de lecture).

### Calcul (`FamoRapport.rapport`)

1. `prepare` : jour de chaque facture (`factureeLe` → `isoDay`, sinon `dateLiv`, sinon `date`), lignes lues une fois,
   creditnota's avec leur jour, catégorie par nom de produit (catalogue, minuscules).
2. `faits(van, tot)` : factures (Facturée, jour dans la période, filtres de commande) et creditnota's (jour dans la
   période, filtres de la commande) ; montant = `Total` / `−montant`, ou, avec un filtre de ligne, somme des lignes
   concernées (`r2(qty × prix)`), la facture ou la note sans ligne concernée étant ignorée.
3. Agrégats : KPIs, mois (zéros compris), clients, produits (qté et omzet, notes en moins), catégories, familles,
   TVA par taux (`FamoVat.totals` par facture, signe −1 pour les notes ; repli : total au taux du régime ou standard),
   factures + notes de la période, factures ouvertes (toutes années, mêmes filtres de commande).
4. Comparaison : `faits` sur la période de comparaison (KPIs, écarts) et sur la même période un an plus tôt (mois).

### Page

- État = paramètres d'URL (`periode`, `jaar`, `kwartaal`, `maand`, `van`, `tot`, `vergelijk`, `klant`, `categorie`,
  `familie`, `product`, `betaling`, `regime`, `q`, `groep`). Changement → `history.pushState` (recherche :
  `replaceState`, après 250 ms), `popstate` → relecture. Tri et « meer tonen » : état local.
- Rendu : données chargées une fois (`/api/rapportage`) ; marge (`/api/marge`, période et comparaison, `klant`)
  rechargée seulement quand la période ou le client change. Les graphiques se redessinent à la largeur de leur carte
  (resize, 150 ms). Focus gardé par `K.keep` (même mécanisme que Beheer).
- Graphiques (skill dataviz) : forme par tâche — colonnes (omzet par mois, une série + comparaison en ligne grise
  avec points : « emphasis », pas de palette catégorielle), barres horizontales (top klanten, top producten,
  categorie/familie, marge ±) ; une seule couleur par graphique (`--p`), barres ≤ 24 px, bout arrondi 4 px côté
  valeur, grille 1 px `--line`, étiquettes en encre (`--ink-2`, `--ink-3`), valeur au bout de la barre, nom sur sa
  propre ligne (jamais rogné). Validation (`validate_palette.js`) : `#0B5A6C / #788A8F` séparation CVD 17,3, vision
  normale 19,5, contraste ≥ 3:1 ; hoog contrast `#06475A / #66787E` 17,8 / 19,5, 4,6:1 ; le « chroma floor » échoue
  par construction (forme emphasis : accent + gris), compensé par la forme différente (colonnes / ligne + points) et
  la légende.
- Betaald : panneau `S.askMode` (staff-common, déjà utilisé par Documenten), puis `K.api("/api/updateorder", …)`,
  rechargement des données, toast avec « Ongedaan maken ».

## Technical Context

Node 22 / 24, CommonJS côté serveur, navigateur en JS vanilla, aucune dépendance. Tests : `node:test`, SQLite en
mémoire pour l'API (`test/rapportage.test.js`), `vm` pour charger `assets/ui.js` (vraies fonctions `K.parseLines`,
`K.isoDay`) ; `global.fetch` remplacé par une fonction qui jette : aucun appel réseau.

## Constitution Check

- **I. Sans build** : ✅ un module UMD de plus (`assets/rapport.js`, même forme que `vat.js`), une page HTML + son
  script dans `assets/pages/beheer/` (arborescence miroir), styles dans `ui.css` (aucun `style="…"` statique ; positions
  de l'info-bulle et largeurs de défilement par `el.style` / attributs SVG calculés), `assets-version.js` relancé,
  `.vercelignore` inchangé (les nouveaux fichiers sont publics par nature : page, script, API).
- **II. Le serveur décide** : ✅ chiffres de direction servis seulement à `adminSession` (401 / 403) ; les commandes
  test filtrées côté serveur ; aucune écriture nouvelle : « Betaald » passe par l'action existante, garde A-10,
  `adminOk`, 409 si non facturée, journal. Le navigateur n'agrège que des données qu'il a le droit de lire (aucune
  décision ni écriture n'en dépend).
- **III. Tests d'abord** : ✅ `test/rapportage.test.js` écrit avant le module, l'API et la page (échoue sans eux) :
  totaux sur un jeu connu, comparaison, filtres, tri, CSV, accès, champs, betaald (payload de la page). Écritures
  locales seulement (SQLite en mémoire, `scripts/dev.js`).
- **IV. Terrain** : ✅ néerlandais ; WCAG 2.2 AA (graphiques `role="img"` + titre + description + tableau ; info-bulle
  au clavier ; `aria-sort` ; contraste des marques 3:1, 4,5:1 en hoog) ; cibles ≥ 44 px ; `K.panel` / `K.toast`.
- **V. Données** : ✅ aucun champ ni table ; `docs/SCHEMA.md` cite le nouveau lecteur (`rapportage`) ; facture émise
  jamais modifiée (le statut de paiement n'est pas la facture).

## Complexity Tracking

- Une fonction serverless de plus (`api/rapportage.js`) : plan Vercel Pro (pas de plafond de 12 fonctions). L'autre
  voie (`allorders?all=1` réservé au beheerder) casserait la « volledige historiek » du personnel.
