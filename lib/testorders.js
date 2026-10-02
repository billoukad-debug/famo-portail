"use strict";
// Commandes d'essai (specs/021-testgegevens-opruimen) : Beheer → Systeemstatus → « Testperiode afsluiten »
// marque les commandes de la période de test (`Test`, `Test gemarkeerd op`). Une commande test n'apparaît
// plus nulle part (listes, rapports, pastilles, documents, portail client, relances, doublons, traçabilité)
// et ne se modifie plus ; « Terugzetten » la rend visible telle quelle.
//
// Le filtre s'applique APRÈS lecture, en JS : même règle sur Airtable, le faux Airtable et le moteur SQL,
// sans toucher aux formules existantes. Restent volontairement inchangés : la numérotation (une commande
// test garde son numéro tant qu'elle existe : pas de doublon), les sauvegardes, l'export RGPD et
// l'anonymisation d'un client (données encore détenues).
const FIELD = "Test";
const AT = "Test gemarkeerd op";
const FORMULA = "NOT({Test})";
const REFUS = "Dit is een testbestelling (gearchiveerd in Beheer → Systeemstatus → Testperiode afsluiten). Zet ze eerst terug om ze te wijzigen.";

const isTest = (fields) => !!(fields && fields[FIELD]);
const real = (records) => (records || []).filter((r) => !isTest(r && r.fields));

module.exports = { FIELD, AT, FORMULA, REFUS, isTest, real };
