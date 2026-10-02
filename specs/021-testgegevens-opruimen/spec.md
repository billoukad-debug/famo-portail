# Feature Specification: Testperiode afsluiten (testgegevens archiveren, verwijderen, nummering herstarten)

**Created**: 2026-10-02 · **Status**: Implemented
**Input**: le portail tourne en production (Postgres/Neon). Le propriétaire signale que **toutes** les commandes
et tous les documents enregistrés jusqu'ici étaient des essais : le personnel a testé le parcours (par exemple
CMD-2026-0021/0022/0026 « livrées » pour essayer), des numéros FA-… ont peut-être été attribués. L'usage réel
commence maintenant (le vrai stock a été encodé aujourd'hui). Il demande de supprimer ou d'archiver ces essais, ou
de le rendre facile. Personne ne touche la production à sa place : il faut un outil sûr qu'il lance lui-même
depuis Beheer.

## User Scenarios

- **Beheerder (Beheer → Systeemstatus → « Testperiode afsluiten »)** — une carte en quatre étapes, dans l'ordre :
  1. **Voorbeeld** : il choisit « bestellingen aangemaakt vóór » (date + heure, par défaut maintenant) et, s'il le
     faut, des références à garder (« behalve »). Le portail montre, **sans rien écrire**, ce qui serait touché :
     nombre de commandes par statut, numéros FA et CN attribués, leveringsbons possibles, photos / signatures
     jointes, mouvements de stock liés, commandes par client, lignes du journal d'audit, et ce qui reste en dehors.
  2. **Archiveren als test** (réversible) : ces commandes sont marquées « test ». Elles disparaissent de toutes les
     listes, rapports, pastilles, documents, du portail client, des exports, des statistiques, de la détection de
     doublons et des relances. « Terugzetten » les rend visibles comme avant.
  3. **Definitief verwijderen** (irréversible, seulement les commandes déjà archivées comme test) : après une
     **back-up fraîche** (moins de 30 minutes, contrôlée par le serveur) et la saisie de « VERWIJDER TESTS ». Les
     commandes, leurs fichiers joints et leurs mouvements de stock sont supprimés ; **les quantités en stock ne
     bougent pas** (le stock a été recompté physiquement). Une ligne de journal résume ce qui a été supprimé.
  4. **Nummering herstarten** : seulement si plus aucun document numéroté (test ou réel) n'existe dans la série de
     l'année ; après la saisie de « HERSTART NUMMERING » et l'avertissement « vraag het na bij je boekhouder ».
     La première vraie facture reçoit alors FA-2026-0001.
- **Personnel** — les commandes archivées comme test n'apparaissent plus nulle part (Bestellingen, Magazijn,
  Leveringen, Documenten). Une fiche ouverte par un ancien lien refuse toute modification (« testbestelling »).
- **Client** — ses commandes d'essai disparaissent de « Mijn bestellingen » ; leurs documents ne s'ouvrent plus.

## Requirements

- **FR-001** Deux champs sur `Commandes` : `Test` (case) et `Test gemarkeerd op` (date-heure). Absent = commande
  normale (une case décochée n'est pas stockée). Aucun autre champ, aucune table.
- **FR-002** Actions Beheer (`api/onboarding.js` → `lib/beheer/testperiode.js`, require statique) : `testVoorbeeld`,
  `testArchiveren`, `testTerugzetten`, `testVerwijderen`, `testNummering`. Session beheerder obligatoire (401 sinon),
  garde A-10 en première ligne du point d'entrée (inchangé). Le personnel est refusé.
- **FR-003** Périmètre calculé **par le serveur** : commandes non archivées dont la date de création (horodatage de
  l'enregistrement) est strictement antérieure à `voor` (ISO, défaut maintenant, futur refusé), moins les références
  de `behalve`. Le navigateur n'envoie jamais de liste d'ids à archiver.
- **FR-004** `testVoorbeeld` n'écrit rien (ni commande, ni journal, ni compteur). Réponse : `scope` (comptes par statut,
  références, FA, CN, leveringsbons, fichiers, mouvements de stock, clients, lignes de journal), `buiten` (commandes
  hors périmètre), `gearchiveerd` (mêmes comptes pour les commandes déjà marquées test : base de l'étape 3),
  `nummering` (par série FA/CN/CMD de l'année : compteur, documents restants test / réels, autorisé ou raison),
  `backup` (dernière back-up manuelle, fraîche ou non, contrôle serveur possible), `facturatie` (mode).
- **FR-005** `testArchiveren {voor, behalve, verwacht}` : refus 409 si le nombre recalculé diffère de `verwacht`
  (« maak opnieuw een voorbeeld ») ; 400 si le périmètre est vide. Pose `Test` + `Test gemarkeerd op` ; une ligne de
  journal « Testperiode: gearchiveerd » avec comptes et plages de références ; révision des commandes augmentée.
- **FR-006** `testTerugzetten {refs?}` : retire `Test` / `Test gemarkeerd op` de toutes les commandes archivées (ou des
  références données) ; journalisé.
- **FR-007** Toute lecture de commandes ignore les commandes test : `/api/allorders` (listes, pastilles, documents,
  rapportage, export CSV construit dans le navigateur), `/api/orders` (client), `/api/klantdoc` et `/api/klantorder`
  (404), détection de doublon et idempotence d'`/api/order`, `/api/lots?trace`, `/api/marge`, relances
  (`lib/reminders.js`), comptes de Beheer (`statusPayload`, `/api/config?status=1`), garde « produit encore dans une
  commande ouverte » de `deleteProduct`. Écritures refusées (409) sur une commande test : `/api/updateorder`,
  `/api/bewijs`, `/api/export` (UBL).
- **FR-008** Restent inchangés volontairement : la numérotation (une commande test garde son numéro FA/CN/CMD et le
  « max + 1 » le compte : pas de doublon tant qu'elle existe), les sauvegardes (tout est sauvegardé), l'export RGPD et
  l'anonymisation d'un client (ils couvrent aussi ses commandes test : ce sont encore des données détenues).
- **FR-009** `testVerwijderen {confirm, verwacht}` : seulement les commandes `Test`. Refus 400 sans « VERWIJDER TESTS »
  exact ; 409 `needBackup` sur le moteur SQL sans back-up manuelle (« Back-up maken ») de moins de 30 minutes ;
  409 si `verwacht` diffère. Supprime : les mouvements de stock dont la `Référence commande` est celle d'une commande
  supprimée (jamais si une commande restante porte la même référence), puis les commandes, puis tous les fichiers
  `famo_files` de ces commandes (pièces jointes et orphelins). `Stock` n'est jamais écrit. Journal : une ligne
  « Testperiode: definitief verwijderd » (comptes, plages de références et de numéros, aucune donnée personnelle).
  Les lignes existantes du journal d'audit sont **conservées** (journal en ajout seul, B-12).
- **FR-010** `testNummering {series, confirm}` : séries `FA-AAAA`, `CN-AAAA`, `CMD-AAAA` de l'année en cours
  (Bruxelles). Refus 400 sans « HERSTART NUMMERING » ; 409 `needBackup` (comme FR-009) ; 409 si un document
  numéroté de cette série existe encore (test ou réel), avec la raison. Moteur SQL : le compteur `Compteurs`
  (`lib/billing.js reserve`) est remis au plus grand numéro restant (0) par écriture conditionnelle ; Airtable :
  rien à remettre (max + 1 sur les données restantes). Journalisé « Testperiode: nummering herstart ».
- **FR-012** (ajout 2026-10-02, retour du propriétaire : « les 3 vrais clients ont aussi commandé ») : `behoudKlanten`
  (ids de fiches `Clients` existantes, format `rec…`, 200 max ; inconnus et mal formés ignorés) sur `testVoorbeeld`
  et `testArchiveren` : toutes les commandes de ces clients sortent du périmètre. L'aperçu renvoie `kandidaten`
  (chaque client du périmètre avant ce choix : id, nom, nombre de commandes, `behouden`) et `behoudKlanten` retenus ;
  l'interface affiche une case par client (« Echte klanten: hun bestellingen behouden », 44 px) et refait l'aperçu à
  chaque changement. `verwacht` tient compte du choix (409 sinon). La ligne de journal dit « behalve N klant(en) ».
- **FR-011** Interface (Beheer → Systeemstatus) en néerlandais, WCAG 2.2 AA, cibles ≥ 44 px, dialogues `K.confirm`,
  aucun style en ligne. Le bouton « Definitief verwijderen » et « Nummering herstarten » restent désactivés tant
  qu'il n'y a pas de back-up fraîche (contrôle serveur ; sur Airtable : back-up faite dans cette session) ; le
  texte dit pourquoi. Le texte dit que les voorraadaantallen ne changent pas.

## Out of scope / suivis

- Clients de démo / de test (« aloha »…) : non touchés. Suivi possible : les archiver depuis Klanten (existant).
- Produits, prix, stock, configuration, utilisateurs, lots, demandes d'accès : non touchés.
- Années antérieures à l'année en cours pour la renumérotation : non proposées.

## Success Criteria

- Après « Archiveren », `/api/allorders`, `/api/orders`, `/api/klantdoc`, relances, marge et traçabilité ne
  renvoient plus aucune commande test ; « Terugzetten » rend exactement l'état d'avant.
- Après « Definitief verwijderen », plus aucune commande test, aucun fichier joint, aucun mouvement de stock lié ;
  les quantités `Stock` sont identiques au bit près ; une ligne de journal résume.
- Après « Nummering herstarten », la facture suivante est `FA-<année>-0001` sur le moteur SQL comme sur Airtable.
