# Implementation Plan: Bijwerken découpé (A6), numérotation sans trou inexpliqué (A4)

**Branch**: `worktree-agent-a07319f4a008fdab4` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

## Summary

**A6** — même découpage que `api/onboarding.js` (spec 006) : `api/updateorder.js` garde la garde A-10,
la configuration, la session, le verrou `inflight` (état d'instance : il reste dans le point d'entrée,
les harnais « deux instances » qui vident son cache en ont chacun un), la lecture de la commande,
l'aiguillage et le journal d'audit. Le code des actions est déplacé tel quel dans `lib/commande/` :

| Module | Contenu (déplacé de `api/updateorder.js`) |
|---|---|
| `common.js` | requires partagés, `numberOf`, `norm`, `money`, `formatLine`, `correctionLine`, `journal`, constantes de statut, `billingContext`, `notifyStatus` |
| `lignes.js` | `normalizeLines` (prix figés, catalogue, garde-fous) |
| `stock.js` | `createStockMovements`, `moveStock`, `undoStock` |
| `nummering.js` | `nextNumber`, `maxNumber`, `ensureUnique`, `ensureUniqueCN` + **`vervallen`** (A4) |
| `corrigeren.js` | `applyCorrection` (terug, annuleren, herstellen, bewerken) |
| `creditnota.js` | `makeCreditnota` |
| `correctiemail.js` | `reserveCorrectie`, `sendCorrectieMail` |
| `bijwerken.js` | `update` : volgorde, paiement, lignes, statut, lots, départ (stock), réception, facture |

**A4** — inventaire des chemins qui consommaient un numéro sans l'écrire (moteur SQL, compteur
`Compteurs` de `lib/billing.js`) :

| Chemin | Avant | Après |
|---|---|---|
| CN : stock illisible (retour en stock) | numéro réservé avant le stock → perdu | stock d'abord, numéro ensuite |
| CN : plafond dépassé sur l'état relu (409, deux appareils) | réservé avant `mutate` → perdu | réservé DANS `mutate`, seulement si l'état relu est accepté ; refus sur une relecture ultérieure → numéro rendu (`billing.release`) ou journalisé |
| CN : rejeu idempotent concurrent (même `sleutel`) | perdu | idem |
| CN : `mutate` lève (conflits répétés, base) | perdu | journalisé « Nummer vervallen », erreur relancée |
| FA : PATCH en échec / exception | perdu | journalisé « Nummer vervallen » (jamais rendu : écriture peut-être faite) |
| FA : régime client illisible | déjà avant la réservation (C-10) | inchangé |

`billing.release(series, n)` : écriture conditionnelle sur la version du compteur, `Waarde n → n-1`
seulement si `Waarde` vaut encore `n` (personne n'a réservé depuis) ; sinon `false`. Utilisé
uniquement quand le refus est certain (aucune écriture de la commande).

`nummering.vervallen(req, {...})` : rien sur Airtable (max + 1, rien de consommé) ; sinon rend le numéro
si `zeker`, puis à défaut écrit une ligne `Journaal` (`Actie: "Nummer vervallen"`) via `lib/journal.js`
et un `console.error` pour les logs Vercel.

Airtable : la note de crédit garde l'ordre historique des lectures (numéro « max + 1 » puis stock) —
les scénarios `workflow-check.js` répondent par position, et un numéro « max + 1 » non écrit n'est pas
consommé.

## Technical Context

Node 22 / 24 (Vercel), CommonJS, sans dépendance. Tests : `node:test` sur SQLite en mémoire
(`test/nummering.test.js`, `test/commande-routes.test.js`) + `scripts/workflow-check.js` (Airtable simulé).

## Constitution Check

- I. Sans build, sans dépendance : ✅ modules CommonJS, `require` statiques (Vercel nft) — vérifié par
  `test/commande-routes.test.js`.
- II. Le serveur décide : ✅ garde A-10 en première ligne du handler exporté, `staffSession`, verrou et
  contrôles inchangés ; le numéro reste attribué par le serveur, l'ordre des contrôles est renforcé.
- III. Tests d'abord, en local : ✅ `test/nummering.test.js` écrit avant le code (échoue sur l'ancien
  ordre : 6 tests sur 7 en échec, le 7e garde une règle déjà vraie), SQLite en mémoire, aucun appel réseau ; aucune assertion affaiblie.
- IV. Terrain : ✅ aucun écran modifié ; textes ajoutés en néerlandais (« Nummer vervallen »,
  « niet gebruikt », raisons).
- V. Données et conformité : ✅ numérotation continue mieux tenue (trou évité ou expliqué) ; aucun champ
  ajouté (la table interne `Journaal` existe déjà) ; aucune donnée personnelle nouvelle.

## Complexity Tracking

- `scripts/workflow-check.js` : `clearModule("api/updateorder.js")` vide aussi `lib/commande/*` (sinon
  ces modules garderaient l'ancienne instance de `lib/staffauth.js` et son cache de révocation) ;
  changement limité à l'aide `clearModule`, aucune assertion touchée.
- Les harnais `inst()` de `test/invoicing`, `creditnotas` et `correctiemail` vident aussi
  `lib/commande/*` : une « instance » neuve recharge tout le code de la fonction.
- Risque résiduel non traité (spec, Edge Cases) : double confirmation simultanée de la même réception
  sur deux instances.
