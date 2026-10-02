# Implementation Plan: Verpakking / verkoopeenheid

**Branch**: `worktree-agent-a83d259ff6d4efb98` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

Le conditionnement est une **propriété du produit** (trois champs du catalogue) et une **annotation
figée de la ligne** (`Lignes JSON`), jamais une autre unité de compte. Les lignes restent stockées en
unités, au prix unitaire :

```
Catalogue  Eieren · pièce · Prix de base 1.00 · Per verpakking 6 · Verpakking doos · Enkel ✓
                │ client : 2 doos (stepper par 6)  →  POST /api/order { quantity: 12 }  (unités, comme avant)
                ▼ lib/bestelling.js : 12 % 6 = 0 ✓ (sinon 400 NL, traduit FR à l'écran)
Commandes  texte  « Eieren × 12 pièce [€1.00] »            ← inchangé : total, TVA, stock, UBL, parseurs
           JSON   [{productId, naam, qty:12, unit, prijs:1, per:6, verpakking:"doos"}]   ← figé
                │ allorders / orders / klantdoc : verpakking { "eieren": {per:6, verpakking:"doos"} }
                ▼ FamoVat.pak* (assets/vat.js, navigateur ET serveur)
Documents / e-mails / écrans : « 2 doos × 6 st = 12 st × € 1,00 = € 12,00 » · UBL : 12 H87 + cbc:Note
```

### Représentation stockée : les unités (décision)

| Critère | Unités (choisi) | Conditionnements |
|---|---|---|
| Texte des lignes, parseurs (`lib/lines.js`, `K.parseLines`, `documents.js`, `ordermail.js`, UBL, marge, rappels, notes de crédit) | inchangés | tous à changer (qty × per partout) |
| Total = Σ qty × prix, TVA par ligne (EN 16931), `Total` stocké | identique au centime | prix par carton ou facteur caché : risque d'écart |
| Stock (`Mouvements de stock`) | unités, comme le stock | conversion à chaque mouvement |
| Commandes existantes, factures émises | rien à migrer, rien à relire autrement | ambiguïté « 2 » = 2 stuks ou 2 doos ? |
| Prix négociés | prix unitaire, aucun changement | à convertir |
| Correction magasin (11 œufs livrés) | possible | impossible en doos entiers |
| Navigateur en cache (ancienne page) | envoie des unités : accepté ou refusé clairement | interprété de travers |

Le conditionnement n'est donc qu'une **annotation** : perdue (ancien JSON, texte corrigé à la main),
la ligne reste juste (12 stuks à € 1,00).

### Modules

| Module | Changement |
|---|---|
| `assets/vat.js` | `pakOf`, `pakFits`, `pakSplit`, `pakUnit`, `pakLabel`, `pakOne`, `pakQty`, `pakCalc` : une règle pour écran, documents, e-mails et serveur (le fichier est déjà chargé partout et `require` par le serveur) |
| `lib/verpakking.js` (nouveau, serveur) | `apiFields` (produit → `{ per, verpakking, enkel }`), `refusal` (message NL d'une quantité non multiple) |
| `lib/beheer/producten.js` | `saveProduct` : validation + écriture des trois champs (effacés si vide / 1) |
| `lib/beheer/common.js`, `api/catalogue.js`, `api/staff.js`, `lib/inbound/mailorder.js` | `per`, `verpakking`, `enkel` dans les produits envoyés |
| `lib/lignesjson.js` | `entry` porte `per` / `verpakking` (produit ou valeur figée donnée) ; `pakMap(raw)` |
| `lib/bestelling.js` | refus d'une quantité non multiple d'un article « enkel » (message NL) |
| `lib/commande/lignes.js` | conditionnement figé gardé pour un article déjà sur la commande |
| `api/allorders.js`, `api/orders.js`, `api/klantdoc.js` | `verpakking` par commande |
| `assets/docs/documents.js` | sous-ligne « 2 doos × 6 st = 12 st (× € 1,00 = € 12,00) » |
| `lib/ordermail.js` (+ appelants `api/order.js`, `api/staff.js`, `lib/inbound/mailorder.js`, `lib/commande/common.js`) | `ctx.verpakking` : même sous-ligne (HTML et texte, NL/FR) |
| `lib/ubl.js` | `cbc:Note` de ligne (BT-127) si conditionnement ; sinon XML identique |
| `lib/inbound/claude.js`, `lib/inbound/mailorder.js` | catalogue + schéma `verpakkingen` ; `check` convertit et refuse l'ambigu |
| `assets/ui.js` | `K.c.stepper` options `suffix` / `label` ; `K.pak*` (raccourcis FR/NL) ; `K.linesSummary(txt, map)` ; textes FR ; motif d'erreur FR |
| `assets/ui.css` | `.st-u` (unité dans le stepper), `.pp-k` (prix du conditionnement), `.pak` (sous-ligne) |
| `assets/pages/klant.js` | catalogue, détail, panier (panneau, barre, winkelmand), favoris, commande type, confirmation, commande ouverte, « Opnieuw bestellen » (hors `loadCatalogue` / `adoptFavs`) ; un ancien panier non multiple est arrondi au conditionnement le plus proche (au moins un) et l'écran le dit (`fitCart`) |
| `assets/pages/beheer.js` | formulaire produit (trois champs) et colonne Eenheid |
| `assets/pages/team/*.js`, `assets/pages/staff-common.js` | Invoeren (stepper), résumés, fiche, Magazijn, validation, liste imprimée, Leveringen, Te controleren |
| `scripts/seed.js`, `scripts/fake-airtable.js`, `docs/SCHEMA.md`, `AGENTS.md` | données de démo et schéma |

## Technical Context

Node 22 / 24, CommonJS, aucune dépendance. Tests : `test/verpakking.test.js` (SQLite en mémoire, vraie
chaîne API, `vm` pour `documents.js` / `ui.js`) ; `scripts/workflow-check.js` inchangé (aucune
lecture ajoutée sur une commande sans conditionnement).

## Constitution Check

- **I. Sans build, sans dépendance** : ✅ aucun fichier chargé en plus ; la règle vit dans
  `assets/vat.js` (déjà UMD, déjà sur chaque page, dans le module documents et `require` par le
  serveur) ; styles dans `ui.css`, aucun `style="…"` ajouté ; `assets-version.js` lancé.
- **II. Le serveur décide** : ✅ la quantité multiple est vérifiée dans `lib/bestelling.js` (client,
  personnel, e-mail) ; le conditionnement figé vient du catalogue lu par le serveur, jamais du
  navigateur (test d'injection) ; Beheer : session beheerder et validation serveur des trois champs.
- **III. Tests d'abord, en local** : ✅ `test/verpakking.test.js` écrit avant le code et constaté
  rouge ; non-régression au centime (texte, JSON, documents, e-mails, UBL) ; SQLite en mémoire, aucun
  réseau (fetch non mocké = erreur).
- **IV. Terrain** : ✅ NL partout, FR dans le portail client (`K.t`, `K.errText`) et les documents/e-mails
  du client ; stepper ≥ 44 px, libellés ARIA « Aantal doos: Eieren » ; ux-audit + kbd-audit.
- **V. Données** : ✅ `docs/SCHEMA.md` et `scripts/fake-airtable.js` dans le même commit ; case absente =
  faux ; facture émise jamais réécrite (le conditionnement est figé dans le JSON de la commande) ;
  aucune donnée personnelle nouvelle.

## Migration et rollback

- Additif : trois champs facultatifs au catalogue, deux clés facultatives dans `Lignes JSON`. Moteur
  SQL sans colonnes par champ : aucune migration Neon. Produits et commandes existants inchangés.
- Rollback : redéployer la version précédente. L'ancien code ignore les champs inconnus ; une
  commande « 2 doos » reste « 12 stuks » partout.
- Airtable (historique) : créer les trois champs avant un retour à `DB_BACKEND=airtable`.

## Complexity Tracking

- Les aides de conditionnement sont dans `assets/vat.js` (« montants ») plutôt que dans un nouveau
  fichier partagé : la constitution limite les modules partagés, et `vat.js` est déjà le seul fichier
  à la fois navigateur et serveur, chargé avant `ui.js` et le module documents.
- `lib/ordermail.js` garde ses parseurs recopiés (parité testée) ; le texte du conditionnement vient
  de `assets/vat.js` (`require` statique, comme `lib/billing.js`).
