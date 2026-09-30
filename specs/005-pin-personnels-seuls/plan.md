# Implementation Plan: PIN personnels seuls

**Branch**: `worktree-agent-a3d5367afd1aac533` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

Nouvelle case `Enkel persoonlijke PIN` dans `Configuratie`. `api/session.js` la lit avec les
codes enregistrés : active, elle écarte le résultat de `roleForCode` (codes partagés) et ne
laisse passer que les PIN (`Medewerkers`) et l'accès de secours `ADMIN_CODE` (fonction
`breakGlass` de `lib/staffauth.js`). Nouvelle action Beheer `saveEnkelPin` dans
`api/onboarding.js` : contrôle « au moins une beheerder PIN active » (409), écriture de la case,
génération +1 à l'activation, cookie renouvelé seulement pour une session PIN. Le journal passe
par l'enveloppe existante (avant → après sur `Configuratie`). Carte dédiée dans Beheer → Toegang.

## Technical Context

**Language/Version**: Node 22 (CI) / 24 (Vercel), CommonJS ; navigateur ES2020, sans build
**Primary Dependencies**: aucune (Node intégré, `lib/staffauth.js`, `lib/log.js`, `lib/journal.js`)
**Storage**: `Configuratie` (nouvelle case `Enkel persoonlijke PIN`), `Medewerkers` (lecture),
`Journaal` (moteur SQL)
**Testing**: nouveau `test/pinonly.test.js` (node:test, SQLite en mémoire, vraies fonctions
`api/session.js` et `api/onboarding.js`) ; `node scripts/check.js`, ESLint 9.39.5
**Target Platform**: Vercel (fra1) + Neon ; local `node scripts/dev.js`
**Constraints**: `lib/staffauth.js` reste fail-closed (contrôle textuel de `check.js`) ; aucune
modification de `assets/ui.css` (refonte en cours ailleurs) ; modifications de
`api/onboarding.js` et `assets/pages/beheer.js` limitées aux parties Toegang (autres agents).

## Décision : accès de secours `ADMIN_CODE`

Options étudiées :

1. **Aucun secours** : option active = seuls les PIN. Rejeté : un PIN beheerder oublié (ou le
   départ de la seule beheerder) oblige à éditer la base à la main (JSON dans Neon), sous
   pression, pour rouvrir Beheer.
2. **`ADMIN_CODE` toujours accepté** (même remplacé par un code enregistré). Rejeté : rouvrirait
   un ancien code d'environnement que le beheerder avait justement remplacé dans Toegang
   (règle « le code enregistré remplace celui de l'environnement »).
3. **Retenu : `ADMIN_CODE` de l'environnement, seulement s'il est le code beheerder effectif
   (pas d'empreinte `Beheerderscode hash`), seulement depuis la page de connexion Beheer
   (`want: "admin"`), seulement en rôle beheerder.** Raisons :
   - la variable vit dans Vercel : la connaître suppose l'accès au compte d'hébergement, qui
     donne de toute façon tout pouvoir (base, déploiement) — ce n'est pas un code d'équipe tapé
     au quotidien ;
   - `STAFF_CODE` n'a pas de secours : le personnel n'a jamais besoin d'un accès d'urgence ;
   - codes identiques (`ADMIN_CODE` = `STAFF_CODE`) : la page personnel refuse, rien ne fuit ;
   - bruyant : `log.error("noodtoegang …")` (visible dans le filtre d'erreurs Vercel) + ligne de
     journal `Wie = Noodtoegang`, session nommée « Noodtoegang » (visible dans l'en-tête et le
     journal de chaque action) ;
   - avec un code beheerder enregistré, le secours reste celui du RUNBOOK (vider l'empreinte ou
     décocher la case dans la base) : aucune règle existante n'est affaiblie.

## Autres choix

- **Refus générique** : même 401 « Ongeldige personeelscode » qu'un code faux. La tentative n'est
  pas « rendue » au limiteur par IP et passe par le chemin PIN, donc compte aussi dans le verrou
  global des PIN (`PIN echecs`). Log `warn` sans le code ni l'IP.
- **Révocation** : génération globale +1 à l'activation (même mécanisme que « Iedereen
  afmelden »). Les sessions PIN tombent aussi (reconnexion par PIN, sans conséquence) ; plus
  simple et plus sûr qu'une révocation sélective qui devrait lire la case à chaque requête.
- **Verrou global des PIN** : avec l'option active il n'y a plus de teamcode de repli ; le
  message 429 n'y renvoie plus. Risque accepté (15 min), documenté dans le RUNBOOK ; l'accès de
  secours reste possible.
- **Configuratie illisible** : `api/session.js` garde en mémoire d'instance le dernier état lu
  de la case ; sans état connu, comportement historique. Une session ainsi ouverte a la
  génération 0 et tombe dès que la génération (≥ 1 après activation) est relue.
- **Dernière beheerder** : `saveMedewerker` / `deleteMedewerker` refusent (409) de supprimer,
  désactiver ou rétrograder la dernière beheerder PIN active quand l'option est active.

## Constitution Check

- I. Sans build, sans dépendance : ✅ aucun paquet ; code dans `api/`, `lib/`, `assets/pages/` ;
  aucun style en ligne ajouté (classes existantes `card card-b col`, `acts`, `chip`), `ui.css`
  non modifié ; `node scripts/assets-version.js` après la modification front.
- II. Le serveur décide (NON NÉGOCIABLE) : ✅ refus et contrôle 409 côté serveur ;
  `saveEnkelPin` passe par la garde de `api/onboarding.js` (`guard.blocked` en première ligne
  de l'export) puis `adminSession` ; `lib/staffauth.js` reste fail-closed (`breakGlass` renvoie
  faux sans `ADMIN_CODE`, `staffOk`/`adminOk` inchangés) ; aucun code ou empreinte dans les
  logs ou les réponses.
- III. Tests d'abord : ✅ `test/pinonly.test.js` écrit avant le code (échoue sans lui) ; portes
  `check.js` + ESLint ; aucune écriture en production.
- IV. Terrain : ✅ textes Beheer en néerlandais, `K.confirm` (jamais `alert`), bouton ≥ 44 px via
  `btn` existant.
- V. Données : ✅ `docs/SCHEMA.md` et `scripts/fake-airtable.js` mis à jour dans le même commit ;
  case lue avec `!!` (absent = faux) ; aucune donnée personnelle nouvelle.

## Project Structure

```text
specs/005-pin-personnels-seuls/  spec.md · plan.md · tasks.md · checklists/requirements.md
lib/staffauth.js          breakGlass(code, stored) : ADMIN_CODE effectif, fail-closed
api/session.js            lecture de la case, refus des codes partagés, secours journalisé, 429 adapté
api/onboarding.js         statusPayload.config.enkelPin, action saveEnkelPin, garde « dernière
                          beheerder » (saveMedewerker / deleteMedewerker), journal (enveloppe)
lib/journal.js            « Enkel persoonlijke PIN » n'est pas masqué (le nom contient « PIN », la
                          valeur est une case : le journal doit montrer aan → uit)
assets/pages/beheer.js    carte « Enkel persoonlijke pincodes » dans Toegang
scripts/workflow-check.js séquences simulées saveMedewerker / deleteMedewerker (lecture Configuratie)
scripts/fake-airtable.js  champ Configuratie « Enkel persoonlijke PIN »
test/pinonly.test.js      scénarios (SQLite en mémoire)
docs/SCHEMA.md · docs/RUNBOOK.md · docs/COMPTES.md · AGENTS.md
```

## Complexity Tracking

Aucun écart à la constitution.
