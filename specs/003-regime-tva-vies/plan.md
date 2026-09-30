# Implementation Plan: Régime TVA par client et contrôle VIES

**Branch**: `worktree-agent-a1926cfc4d1bceaa8` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

Le régime (`Normal` / `Intracommunautaire` / `Export` / `Cocontractant`) est une table unique dans
`assets/vat.js` (chargé par le navigateur ET le serveur : taux nul, catégorie UBL, code et texte du
motif, mentions NL/FR, libellé Beheer). Le serveur le lit sur le client (`Clients.Régime TVA`) ;
`lib/billing.linesRates` met toutes les lignes à 0 % pour un régime à 0 % ; au passage en
« Facturée », `api/updateorder.js` lit le client AVANT de réserver le numéro, fige les taux (0) et
copie le régime sur la commande (`Commandes.Régime TVA`). `billing.regimeOf(commande, client)` :
régime figé si la commande est facturée, sinon celui du client. Documents (`documents.js`) :
taux 0 forcé + bloc de mention ; UBL (`lib/ubl.js`) : catégories K/G/AE, motifs, acheteur étranger
(TVA complète, schéma EAS, pays), livraison pour K. Validation régime ↔ numéro dans `saveClient`.
VIES : `lib/vies.js` (fetch injectable, délai 8 s, erreurs → 503) + action Beheer `checkVies` dans
`api/onboarding.js` (garde + `adminSession` déjà en tête), résultat stocké sur le client.

## Technical Context

**Language/Version**: Node 22 (CommonJS) côté serveur, JavaScript navigateur sans build
**Primary Dependencies**: aucune (Node intégré + `fetch` global)
**Storage**: champs ajoutés — `Clients` : `Régime TVA` (liste), `VIES gecontroleerd op`
(date-heure), `VIES resultaat` (texte JSON) ; `Commandes` : `Régime TVA` (liste, figé)
**Testing**: `test/btw-regime.test.js` (SQLite en mémoire, faux VIES par `fetch` filtré sur l'URL
VIES), `test/documents.test.js` (vm), `scripts/workflow-check.js` (réponses simulées mises à jour :
la facturation lit aussi le client)
**Target Platform**: Vercel (fra1) + Postgres Neon ; local SQLite / faux Airtable
**Constraints**: aucune écriture vers la production, aucun appel réseau dans les tests ; UI Beheer
en néerlandais, aucun style en ligne ajouté, `assets/ui.css` non modifié

## Constitution Check

- I. Sans build, sans dépendance : ✅ `lib/vies.js` en Node pur (`fetch`, `AbortController`) ; table
  des régimes dans `assets/vat.js` existant ; UI avec les classes existantes (`input`, `btn btn-o
  btn-sm`, `notice`, `kv`) ; `node scripts/assets-version.js` après modification front.
- II. Le serveur décide : ✅ taux 0, régime figé et validation régime ↔ numéro côté serveur ; le
  navigateur n'envoie que le choix. `checkVies` passe par `module.exports` d'`api/onboarding.js`
  (garde `lib/guard` en première ligne) puis `adminOk` + `adminSession`. VIES en échec → 503, jamais
  de résultat inventé. Lecture du client impossible à la facturation → 503 avant la numérotation.
- III. Tests d'abord : ✅ tests écrits avant le code (régimes, figé, documents, UBL, VIES mocké,
  validation, RGPD) ; `check.js` et ESLint vérifiés un par un.
- IV. Terrain : ✅ libellés et messages Beheer en néerlandais, mentions du document dans la langue
  du client, `select` natif (clavier), bouton ≥ 44 px au tactile (`.btn`), résultat VIES dans une
  zone `aria-live`.
- V. Données et conformité : ✅ `docs/SCHEMA.md` + `scripts/fake-airtable.js` dans le même commit ;
  `Normal` = champ absent ; facture émise jamais modifiée (régime figé) ; RGPD : export complet de la
  fiche, conservation à l'anonymisation justifiée (spec, « Assumptions »).

## Project Structure

```text
specs/003-regime-tva-vies/   spec.md · plan.md · tasks.md · checklists/requirements.md
assets/vat.js                REGIMES, regime() : taux 0, catégorie UBL, motif, mentions NL/FR, libellé
lib/billing.js               parseVat, beCompanyNo, regimeOf, regimeProblem, linesRates(…, regime)
lib/vies.js                  check(btw, {fetch, timeoutMs}) → {valid, name, address, vatNumber, checkedAt}
lib/ubl.js                   catégories K/G/AE + motifs, acheteur étranger (EAS), livraison K, note
api/updateorder.js           client lu avant la numérotation ; régime figé sur la commande
api/onboarding.js            saveClient (régime + validation + effacement VIES), checkVies, statusPayload
api/allorders.js, api/klantdoc.js, api/orders.js   btwRegime / taux selon le régime
documents.js                 taux 0 forcé + mention dans la langue du client
assets/pages/staff-common.js S.btwPerLine : 0 % pour un régime à 0 % non encore facturé
assets/pages/beheer.js       select « Btw-regime », bouton « Controleren via VIES », fiche
assets/pages/documenten.js   colonne « Btw-regime » du CSV comptable
scripts/fake-airtable.js, docs/SCHEMA.md   nouveaux champs
scripts/workflow-check.js    BILL() : lecture du client, avant la réservation du numéro
test/btw-regime.test.js, test/documents.test.js
```

## Complexity Tracking

Aucun écart à la constitution. Point d'attention : la facturation lit désormais aussi le client
(une lecture par facture) ; les scénarios simulés de `scripts/workflow-check.js` sont mis à jour en
conséquence, sans en retirer aucun contrôle.
