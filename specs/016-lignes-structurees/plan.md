# Implementation Plan: Lignes de commande structurées (B4)

**Branch**: `worktree-agent-ac22256cd3f125bc4` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

## Summary

Un champ **additif** `Lignes JSON` sur `Commandes`, écrit par le serveur à côté du texte, porte la
référence produit de chaque ligne. Le texte reste la vérité (quantité, prix, document légal) ; le
JSON ne sert qu'à **rattacher** une ligne à son produit quand le nom ne suffit plus (renommage).

| Module | Changement |
|---|---|
| `lib/lignesjson.js` (nouveau) | `FIELD`, `entry(product, line)`, `serialize`, `parse` (valide, tolère un JSON abîmé), `linked(texte, json)` = lignes du texte + `productId` de l'entrée JSON du même nom, `renamed(json, productId, nom)` |
| `api/order.js`, `api/staff.js` | `buildOrderLines` renvoie aussi `json` (produit, prix, unité du catalogue) ; `Lignes JSON` écrit à la création |
| `lib/commande/lignes.js` | `normalizeLines` : produit par nom, sinon par la référence enregistrée ; renvoie `json` |
| `lib/commande/bijwerken.js` | écrit `Lignes JSON` avec les lignes ; départ : `moveStock(texte, -1, json)` |
| `lib/commande/stock.js` | `moveStock(lignes, sign, json)` : référence → nom actuel du catalogue → ligne de stock ; catalogue lu **seulement** si une ligne a une référence (ordre des lectures inchangé sinon) |
| `lib/commande/corrigeren.js`, `creditnota.js` | passent `f["Lignes JSON"]` à `moveStock` (les lignes d'une note portent les noms de la facture = `naam` du JSON) |
| `lib/beheer/producten.js` | renommage : `naam` suit dans le JSON des commandes ouvertes (même PATCH que le texte) |
| `api/orders.js` + `assets/pages/klant.js` | `items[]` par ligne ; `linesToCart` : référence d'abord, nom sans référence |
| `lib/journal.js` | `Lignes JSON` dans `NOISE` (le texte montre déjà la différence) |

## Technical Context

Node 22 / 24 (Vercel), CommonJS, sans dépendance. Tests : `node:test` sur SQLite en mémoire
(`test/lignes-structurees.test.js`), vraie chaîne API ; `scripts/workflow-check.js` (Airtable
simulé, réponses par position) **non modifié** : aucune lecture ajoutée sur une commande sans JSON.

## Constitution Check

- I. Sans build, sans dépendance : ✅ un module CommonJS `lib/lignesjson.js`, `require` statiques.
- II. Le serveur décide : ✅ référence validée contre le catalogue, nom/unité/prix lus du catalogue
  (ou prix figé) ; aucun champ du navigateur n'atteint `Lignes JSON` (test d'injection client et
  personnel) ; garde A-10 et sessions inchangées.
- III. Tests d'abord, en local : ✅ `test/lignes-structurees.test.js` écrit avant le code, constaté
  rouge (renommage → départ 409, retour sur le mauvais produit, pas d'`items`, pas de JSON) ;
  SQLite en mémoire, aucune écriture hors local, aucune assertion affaiblie.
- IV. Terrain : ✅ aucun écran nouveau ; `klant.js` change seulement l'appariement de « Opnieuw
  bestellen » / « Wijzigen » (ux-audit + kbd-audit).
- V. Données et conformité : ✅ champ ajouté dans `docs/SCHEMA.md` et `scripts/fake-airtable.js` dans
  le même commit ; facture émise jamais réécrite (texte et JSON figés dès `Facturée`) ; aucune
  donnée personnelle (l'export RGPD recopie déjà tous les champs de commande).

## Migration et rollback

- **Déploiement** : additif. Les commandes existantes ne sont pas touchées ; le champ apparaît sur
  les commandes créées ou dont les lignes changent après le déploiement. Moteur SQL sans colonnes
  par champ : aucune migration Neon.
- **Pas de rattrapage** (décision) : apparier par nom les anciennes commandes au moment du
  rattrapage attacherait une mauvaise référence si un produit a déjà été renommé et son ancien
  nom repris. Les anciennes commandes gardent l'appariement par nom (comportement d'avant).
- **Rollback** : redéployer la version précédente (RUNBOOK § 2). L'ancien code ignore `Lignes JSON`
  (champ inconnu = non lu) ; rien à nettoyer. Seul effet : un renommage fait pendant le rollback
  ne met plus à jour `naam` du JSON — sans conséquence, la ligne retombe sur le nom (texte fait foi).
- **Airtable** (historique, plus en production) : le champ n'y existe pas ; un retour à
  `DB_BACKEND=airtable` exige de créer d'abord `Lignes JSON` (texte long) dans `Commandes`
  (RUNBOOK § 6), sinon les nouvelles commandes sont refusées (champ inconnu).

## Complexity Tracking

- Aucun écart. Risque résiduel : lots, marge et taux de TVA (commandes non facturées) restent
  appariés par nom (voir spec, Edge Cases).
