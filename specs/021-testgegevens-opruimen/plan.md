# Implementation Plan: Testperiode afsluiten

**Branch**: `worktree-agent-a57d3f170c0ad20cc` (sur `main` e3eedb7) | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

| Partie | Où | Quoi |
|---|---|---|
| Règle « commande test » | `lib/testorders.js` (nouveau) | `FIELD = "Test"`, `AT = "Test gemarkeerd op"`, `isTest(fields)`, `real(records)`, `FORMULA = "NOT({Test})"`, `REFUS` (message 409) |
| Actions Beheer | `lib/beheer/testperiode.js` (nouveau), `api/onboarding.js` | `testVoorbeeld`, `testArchiveren`, `testTerugzetten`, `testVerwijderen`, `testNummering` ; `require` statique ; ces actions écrivent leur propre ligne de journal (comptes) au lieu de la ligne générique du point d'entrée (`testVoorbeeld` n'en écrit aucune) |
| Moteur SQL | `lib/at-engine.js` | `filesOfRecords(ids)` → `[{id, recordId}]` (fichiers `famo_files` d'une commande, orphelins compris) |
| Lecteurs filtrés | `api/allorders.js`, `api/orders.js`, `api/klantdoc.js`, `api/klantorder.js`, `api/order.js`, `api/lots.js`, `api/marge.js`, `api/config.js`, `lib/reminders.js`, `lib/beheer/common.js`, `lib/beheer/producten.js` (deleteProduct) | `__test.real(...)` / `!__test.isTest(...)` après lecture (même règle sur Airtable et SQL, sans dépendre d'une formule) ; `/api/config?status=1` compte avec `NOT({Test})` |
| Écritures refusées | `api/updateorder.js`, `api/bewijs.js`, `api/export.js` | 409 « Testbestelling (gearchiveerd)… » |
| Interface | `assets/pages/beheer.js` (Systeemstatus), `assets/ui.css` si besoin | carte « Testperiode afsluiten » : périmètre, Voorbeeld, Back-up maken, Archiveren / Terugzetten, Definitief verwijderen, Nummering herstarten |
| Données | `docs/SCHEMA.md`, `scripts/fake-airtable.js` | deux champs `Commandes` |
| Procédure | `docs/RUNBOOK.md` § 7 | pas à pas pour le propriétaire |
| Audits | `scripts/ux-audit.js` | état « aperçu ouvert » de la carte |

### Déroulé serveur

- **Périmètre** (`scopeOf`) : `atAll("Commandes")` puis filtre JS : `!Test`, `createdTime < voor`, référence ∉ `behalve`.
  `voor` : ISO valide, pas dans le futur (+1 min de tolérance d'horloge), défaut maintenant. `behalve` : liste de
  références (texte, 40 caractères, 200 au plus).
- **Comptes** (`countsOf(records)`) : par statut, références (première → dernière, tri naturel), FA (`Factuurnummer`),
  CN (`lib/creditnota.list`), leveringsbons (statut Prête / Sortie en livraison / Facturée), fichiers (pièces jointes des
  champs + `famo_files` par `record_id`, sans double), mouvements (`Mouvements de stock.Référence commande` ∈ références),
  clients (nom → nombre), journal (lignes `Journaal` dont `Record` ∈ ids ; moteur SQL seulement).
- **Back-up fraîche** : moteur SQL → `store.snapshots("export")` (« Back-up maken » de Systeemstatus enregistre
  `kind: "export"`), la plus récente a moins de 30 min. Airtable → pas de contrôle serveur possible
  (`serverCheck: false`) : le navigateur exige une back-up faite dans la session + la saisie.
- **Archiver / remettre** : `atBatch("Commandes", "PATCH")` par 10 ; `lib/revision.bump()` (les écrans du personnel se
  rafraîchissent).
- **Supprimer** : mouvements d'abord, puis commandes par lots de 10 (`DELETE Commandes?records[]=…`, le moteur efface les
  fichiers référencés), puis fichiers restants par `record_id`. Ordre choisi pour qu'une reprise après échec partiel
  retrouve tout ce qui reste (une commande test encore présente → ses mouvements restants). Échec partiel → 500 avec
  ce qui a été fait, et la ligne de journal le dit.
- **Nummering** : `nummering` (préversion) compte, pour `FA-AAAA` / `CN-AAAA` / `CMD-AAAA`, les documents encore
  numérotés (test et réels) ; autorisé si les deux sont à 0. Remise à zéro : `store.update("Compteurs", id, {Waarde: 0},
  version)` (conditionnelle : un numéro réservé entre-temps fait échouer, on relit et on refuse). Airtable : `reserve`
  renvoie `null` et `maxNumber` / `lastNumber` recalculent sur les données restantes → 0 + 1 sans rien écrire.

## Technical Context

Node 22 / 24, CommonJS, sans dépendance. Tests : `node:test` sur SQLite en mémoire (`test/testperiode.test.js`) avec
les données de `scripts/seed.js` ; aucun appel réseau.

## Constitution Check

- I. Sans build : ✅ deux modules CommonJS, `require` statiques (vérifié par `test/beheer-routes.test.js`), JS de page
  dans `assets/pages/beheer.js`, utilitaires de `ui.css`, aucun style en ligne ; `assets-version.js` relancé.
- II. Le serveur décide : ✅ périmètre recalculé par le serveur (jamais une liste d'ids du navigateur), comptes attendus
  vérifiés, confirmations tapées vérifiées par le serveur, back-up fraîche contrôlée par le serveur sur le moteur SQL,
  garde A-10 puis `adminSession` (point d'entrée inchangé), refus fail-closed (409 / 400) ; journal d'audit.
- III. Tests d'abord : ✅ `test/testperiode.test.js` écrit avant le code (échoue sans lui) ; aucune écriture vers la
  production ; l'outil lui-même n'est lancé que par le propriétaire.
- IV. Terrain : ✅ néerlandais, `K.confirm`, cibles ≥ 44 px, `aria-describedby` sur les boutons désactivés, focus sur
  le résultat, ux-audit + kbd-audit.
- V. Données : ✅ `docs/SCHEMA.md` + faux Airtable dans le même commit ; case absente = faux ; facture émise jamais
  modifiée (voir ci-dessous) ; RGPD : l'export et l'anonymisation couvrent aussi les commandes test.

## Volet légal et comptable

- **Statut des numéros FA/CN** (ADR 0005) : en mode « Boekhouder » (défaut), les documents du portail sont des pro
  forma internes, la facture légale vient du comptable (Billtobox) ; les numéros FA/CN ne sont pas une série légale.
  En mode « Portaal », le portail émet la facture : FA/CN deviennent la série légale.
- **Numérotation continue** (TVA belge, AR n° 1, art. 5 §1 : numéro « suivant une ou plusieurs séries continues ») :
  une facture **émise** (envoyée au client ou transmise au comptable) ne s'efface pas et ne se renumérote pas ; on
  l'annule par une note de crédit. L'outil ne peut pas savoir si un document d'essai a quitté l'entreprise (un e-mail
  « geleverd » a pu partir vers une adresse de test ou réelle) : il **ne décide pas**, il avertit (« Alleen als geen
  enkele van deze testfacturen ooit naar een klant of de boekhouder is gegaan — vraag het na bij je boekhouder »),
  exige une saisie distincte et journalise. En mode Portaal, l'avertissement est renforcé.
- **Conservation** : les factures réelles se conservent 10 ans ; l'outil ne touche que des commandes marquées test par
  le beheerder, après back-up (le fichier de back-up garde la trace complète si le comptable la demande).
- **Ce que l'outil garantit** : jamais deux documents sous le même numéro (remise à zéro refusée tant qu'un document
  de la série existe, test compris) ; trace : la ligne de journal dit quand, qui, combien et quelles plages.
- **RGPD** : supprimer des essais est une minimisation (art. 5.1.c). Tant qu'elles existent (archivées), les commandes
  test d'un client restent dans son export d'accès et sont anonymisées avec lui.

## Complexity Tracking

- Le filtre des commandes test est appliqué **après** lecture (JS), pas dans les formules : la même règle vaut sur
  Airtable, le faux Airtable et le moteur SQL, et les formules existantes (fenêtre, client) restent intactes. Coût :
  quelques dizaines d'enregistrements d'essai lus puis écartés jusqu'à leur suppression.
- Le journal d'audit n'est **pas** purgé (B-12, ajout seul) : les lignes des essais restent consultables, une ligne de
  synthèse s'y ajoute. Les comptes l'annoncent (« blijven bewaard »).
- `testVoorbeeld` est exclu de la ligne générique du point d'entrée (lecture seule) ; les quatre autres actions
  écrivent leur propre ligne (comptes et plages) au lieu de recopier le corps de la requête.
