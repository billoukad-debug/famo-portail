# Feature Specification: Volgend factuurnummer instellen

**Demande** : Mohsen (2026-10-15) : « Volgende factuur 2026025 ». Il facture à la main en attendant ; la prochaine
facture du portail doit continuer sa série (FA-2026-0025), puis 0026, 0027… dans l'ordre.

## Exigences
- **FR-001** `testNummering` (Beheer → Systeemstatus → « Testperiode afsluiten », `lib/beheer/testperiode.js`) accepte
  `volgende` (entier 1–99999) : le compteur de la série est mis à `volgende - 1`, la prochaine pièce reçoit `volgende`.
- **FR-002** Refus 409 si un numéro ≥ `volgende` existe déjà dans la série (test compris) : jamais de doublon.
  L'aperçu expose `hoogste` (plus haut numéro existant) par série.
- **FR-003** Mêmes garde-fous que la remise à zéro : session beheerder, `HERSTART NUMMERING` tapé, back-up < 30 min,
  écriture conditionnelle du compteur, ligne de journal « Nummering: volgend nummer ingesteld ». Moteur SQL seulement.
- **FR-004** Écran : champ « Volgend factuurnummer instellen » + bouton « Instellen » dans la même carte.
- **FR-005** Note « Nieuw » pour Mohsen (`assets/nieuws.js`), en néerlandais simple.

## Ordre pour Mohsen
Les factures de test FA-2026-0028 bloquent 25 (FR-002) : d'abord archiver puis supprimer les commandes de test,
ensuite régler 25. Le comptable confirme qu'aucune facture de test n'a été envoyée.

## Tests
`test/testperiode.test.js` : « volgend nummer (retour Mohsen) » — valeurs invalides 400, confirmation 400,
numéro existant au-dessus 409, back-up vieille 409, puis 0025 et 0026 dans l'ordre, journal.

## Ajout 2026-10-16 : vrijgeven
Mohsen n'arrive pas à mettre 25 : le portail a déjà des factures jusqu'à FA-2026-0032. Le propriétaire confirme qu'AUCUNE
facture du portail n'a été envoyée (Mohsen facturait à la main 2026001–2026024).
- **FR-006** `vrijgeven: true` (FA seulement, avec `volgende`) : les commandes dont le numéro FA ≥ volgende perdent ce
  numéro (les commandes restent), journal « Nummering: factuurnummers vrijgegeven » (référence + ancien numéro), puis
  la série reprend à volgende. Leurs notes de crédit (jamais envoyées) sont libérées aussi et listées au journal. Back-up et confirmation tapée comme FR-003.
- **FR-007** Écran : un nombre ≤ au plus haut existant déclenche un avertissement (« LET OP … nooit verstuurd ») et
  l'appel avec `vrijgeven`.
- Sans numéro : pas de rappel de paiement (`lib/reminders.js`), pas d'export UBL (`api/export.js`), document « — ».
- Test : « nummers vrijgeven (retour Mohsen) » dans `test/testperiode.test.js`.
