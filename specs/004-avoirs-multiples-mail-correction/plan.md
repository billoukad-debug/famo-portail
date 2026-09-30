# Implementation Plan: Plusieurs notes de crédit par facture et e-mail de correction

**Branch**: `worktree-agent-ae0d81fc542803598` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

Nouveau module `lib/creditnota.js` : lecture de toutes les notes d'une commande (`list`), écriture
d'une note (`patchFor`), plafond cumulé par article et par taux de TVA (`check`). `api/updateorder.js`
(makeCreditnota) l'utilise, numérote avec le compteur atomique existant (`lib/billing.js reserve`)
et écrit par écriture conditionnelle (`lib/atomic.js mutate`, nouveau). Nouveau module
`lib/correctie.js` (ce qui a changé depuis le dernier e-mail) + `buildCorrectionMail` /
`buildCorrectionTeamMail` / `notifyCorrection` dans `lib/ordermail.js` ; action
`{ correctieMail: true }` sur `/api/updateorder`. Lecteurs mis à jour : allorders, orders,
klantdoc, export (UBL `&cn=`), margin, reminders ; pages order, documenten, bestellingen, beheer,
klant ; `staff-common.js` (liste, panneau, bouton « Correctie mailen »).

## Technical Context

**Language/Version**: Node 22 (CI) / 24 (Vercel), CommonJS ; JavaScript navigateur sans build
**Primary Dependencies**: aucune (Node intégré + `fetch`) ; `assets/vat.js` pour les montants
**Storage**: table `Commandes` ; deux champs texte JSON ajoutés : `Creditnotas`, `Correctiemail`
**Testing**: `node --test` sur SQLite en mémoire (`test/creditnotas.test.js`,
`test/correctiemail.test.js` avec Resend simulé par `fetch`), bloc AQ de `scripts/workflow-check.js`
(Airtable simulé), ux-audit + kbd-audit contre `node scripts/dev.js`
**Target Platform**: Vercel (fra1) + Neon ; tablettes du dépôt, téléphones clients
**Constraints**: aucune dépendance, aucun style en ligne ajouté, NL pour le personnel, modifications
de `lib/billing.js` et `documents.js` évitées (autre chantier en cours sur la TVA par client)

## Choix de stockage (C-08)

Options étudiées :

1. **Table liée `Creditnota's`** (une ligne par note) : propre en SQL, mais chaque lecteur
   (allorders, orders, klantdoc, export, reminders, margin, Beheer) devrait lire une deuxième table
   et la joindre, le faux Airtable et la copie Airtable → Neon (`api/dbadmin.js`) aussi ; la
   création d'une note deviendrait deux écritures non atomiques (note + commande).
2. **Champ JSON `Creditnotas` sur la commande** (retenu) : une seule écriture, sur le moteur SQL
   conditionnelle à la version de l'enregistrement (`lib/atomic.js mutate`) : deux notes simultanées
   ne s'écrasent pas et le plafond est revérifié sur l'état relu. Tous les lecteurs ont déjà la
   commande en main. Même motif que `BTW per lijn` et `Lots` (JSON dans un champ texte).

Compatibilité : les champs historiques `Creditnota nummer / lignes / montant / le / motif` gardent
la **première** note (écrits une fois) ; `Creditnotas` contient **toutes** les notes. `list()` lit
le JSON, et retombe sur la note historique seule quand il n'existe pas (données d'avant). Les gardes
existantes qui testent `Creditnota nummer` (réception défaite interdite, filtres) restent justes ;
l'API garde `creditnota` (première note) et ajoute `creditnotas` (toutes).

Numérotation : même série `CN-AAAA` et même compteur atomique `Compteurs` ; le plancher (premier
usage de la série) lit aussi les numéros du JSON. Sur Airtable (plus en production), max + 1 puis
contrôle de doublon aux deux endroits (`ensureUniqueCN`). Limite connue : si deux notes simultanées
dépassent ensemble le livré, la seconde est refusée après avoir réservé son numéro → un trou dans
la série CN (rare ; même comportement qu'une écriture de facture qui échoue).

Idempotence : le navigateur envoie une clé `sleutel` par ouverture du panneau ; une note déjà
enregistrée sous cette clé est renvoyée telle quelle (pas de nouveau numéro, pas de deuxième
retour en stock).

## « Correctie mailen » (L-08)

- « Avant » : dernier e-mail de correction (`Correctiemail`), sinon `Lignes besteld` (contenu de
  la confirmation), sinon lignes actuelles. « Après » : lignes actuelles + notes pas encore mailées.
- Réservation de l'état envoyé AVANT l'envoi (écriture conditionnelle ; Airtable : relecture),
  libérée si Resend échoue (502) ; clé d'idempotence Resend `correctie:<id>:<clé d'état>`.
- Client : langue du client (comportement C-15 de `lib/ordermail.js`), lien portail client
  `klant.html#/bestellingen` (le client n'a pas accès à `/order.html`). Copie interne NL (boîte
  « Bestellingen e-mail ») avec `/order.html?id=` : c'est elle qui porte le lien de fiche.
- Journal : ligne `Correcties` « Correctiemail verstuurd aan klant (articles, CN…) » (sans
  l'adresse : le journal survit à l'anonymisation RGPD) + `Journaal` (action « Correctiemail »).

## Constitution Check

- I. Sans build, sans dépendance : ✅ deux modules `lib/`, pas de dépendance ; styles ajoutés en
  classes à la fin de `assets/ui.css` (aucun jeton modifié) ; les styles en ligne des blocs
  réécrits (liste des notes, panneau, lignes « Documenten ») migrent vers ces classes ;
  `node scripts/assets-version.js` lancé.
- II. Le serveur décide : ✅ plafond, prix, numéros, retour en stock et état « déjà mailé » calculés
  sur le serveur ; nouvelle action dans le handler POST existant (`guard.blocked` en tête,
  `staffSession` puis `adminOk` pour les notes) ; aucun secret ; sans `RESEND_API_KEY`, rien ne part.
- III. Tests d'abord : ✅ `test/creditnotas.test.js` (11 tests) et `test/correctiemail.test.js`
  (7 tests) écrits avant le code ; bloc AQ adapté (l'ancienne règle « une seule note » remplacée) ;
  check.js, ESLint, ux-audit, kbd-audit verts.
- IV. Terrain : ✅ textes du personnel en NL ; portail client NL/FR (`K.t`, nouvelle clé FR) ;
  documents dans la langue du client (documents.js inchangé : la note choisie est passée comme
  `order.creditnota`) ; e-mail client dans la langue du client, copie interne NL ; `K.confirm`,
  boutons ≥ 44 px existants.
- V. Données : ✅ `docs/SCHEMA.md` et `scripts/fake-airtable.js` à jour (`Creditnotas`,
  `Correctiemail`) ; une facture émise n'est jamais modifiée ; aucune donnée personnelle nouvelle
  (l'adresse du client n'est pas stockée dans `Correctiemail` ni dans le journal).

## Project Structure

```text
specs/004-avoirs-multiples-mail-correction/  spec.md · plan.md · tasks.md · checklists/requirements.md
lib/creditnota.js         list / patchFor / renumberPatch / byKey / check (plafond cumulé)
lib/correctie.js          baseline / diffLines / changes / snapshot
lib/atomic.js             + mutate (lecture → décision → écriture conditionnelle)
lib/ordermail.js          + buildCorrectionMail, buildCorrectionTeamMail, notifyCorrection (NL/FR)
lib/margin.js, lib/reminders.js   toutes les notes
api/updateorder.js        makeCreditnota (N notes), maxNumber/ensureUniqueCN, sendCorrectieMail
api/allorders.js, api/orders.js, api/klantdoc.js   + creditnotas (+ correctiemail)
api/export.js             UBL &cn=<numéro>
assets/pages/staff-common.js   S.cns, S.withCn, S.cnRest, liste, panneau, S.correctieMail
assets/pages/order.js, documenten.js, bestellingen.js, beheer.js, klant.js
assets/ui.css (fin), assets/ui.js (1 clé FR)
docs/SCHEMA.md, scripts/fake-airtable.js, scripts/workflow-check.js (AQ5)
test/creditnotas.test.js, test/correctiemail.test.js
```

## Complexity Tracking

Aucun écart à la constitution. Écart assumé à la consigne « lien /order.html?id= » : il est dans
la copie interne (personnel), pas dans l'e-mail client, qui lie le portail client comme les autres
e-mails client (`/order.html` est une page du personnel).
