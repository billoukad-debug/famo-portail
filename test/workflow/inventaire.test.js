"use strict";
// Inventaire du découpage F-10 (specs/011-workflow-check-decoupe) : aucun scénario ni aucune
// assertion de l'ancien scripts/workflow-check.js (commit f48b5cd, 1 926 lignes) ne disparaît en silence.
//   - les 36 blocs « ✓ » d'origine existent chacun comme exactement un test, même libellé ;
//   - le nombre d'appels assert dans test/workflow/ ne descend pas sous celui d'origine (752) ;
//   - chaque fichier charge ./_helpers en premier et se déclare seul dans son processus.
// Retirer volontairement une assertion ou un bloc : le dire dans la spec et baisser la référence ici.
const h = require("./_helpers"); // en premier : environnement de test, réseau réel interdit
h.isolate(__filename);
const { describe, test } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const SELF = path.basename(__filename);
const ASSERTS_ORIGINE = 752; // `assert(` et `assert.xxx(` dans scripts/workflow-check.js avant découpage
const BLOCS_ORIGINE = [
  "Session staff commune (cookie HttpOnly, expiration, logout, cookie-only APIs)",
  "A. Fail-closed sans code configuré + rôles STAFF_CODE/ADMIN_CODE distincts",
  "B. DELETE /api/session → Max-Age=0",
  "C. Stock déduit une seule fois / 409 si afgeboekt / verrou aussi sans skipStock",
  "C2. Total recalculé serveur, jamais celui du navigateur",
  "D. Factuurnummer unique (pas de réallocation)",
  "E. Recipient requis pour deliveryConfirmed",
  "F. Double-prep / Sortie sans prep field si flag posé",
  "G. XSS / qty malveillante rejetée + documents.esc",
  "H. famoNL caisse→kassa, Reçue→Ontvangen",
  "I. Navigation v2 (Dagelijks, Beheer, séparation des rôles)",
  "K. allorders cookie-only (sans ?code=)",
  "L. Onboarding admin-only + credentials + validation config",
  "M. E-mails commande (inerte sans clé, destinataires séparés, échec sans impact)",
  "N. Codes d'accès (remplacent l'environnement, hachés, jamais exposés)",
  "O. Gestructureerde mededeling (FA-nummer → +++…+++, mod 97)",
  "P. Prix négocié (vide → prix de base, 0 saisi → 0, catalogue = commande = staff = recalcul)",
  "AL. Portail client : changer son mot de passe (ancien vérifié serveur, 8 car. min, jamais le compte d'un autre)",
  "V2. Contrats frontend (workflow, documents, beheer, stock, numérotation)",
  "AM. Leverdag vrij (serveur + panier) et wachtwoord au choix dans Beheer",
  "AN. Corrections (terug, annuleren, herstellen, bewerken), klant annuleert, product verwijderen, FR/NL klantportaal",
  "AO. lib/levering (passé, > 60 j, dimanche, jour fermé, jour non livré, parsing, bloc public)",
  "AP. Commande client : minimum (Configuratie), jour fermé / non livré / dimanche refusés avant écriture",
  "AQ. Bijwerken : betaald (datum, wijze), dubbele ontvangst 409, uitzondering, volgorde, creditnota, gardes, lijnen aan figés prijzen",
  "AR. Klantportaal : profiel, favorieten (gefilterd), wachtwoord vergeten (neutraal, 3/u, enkel bij e-mailmatch)",
  "AS. Sessie via PIN (Medewerkers) : naam in de cookie, GET geeft naam, rol volgens Rol + want, journaal op voornaam",
  "AT. Beheer : saveConfig-validatie (IBAN/BIC/BTW/deadline/gesloten/minimum/termijn), product uniek + btw, archiveren, medewerkers, klant",
  "AU. Voorraad : regel verwijderen enkel beheerder ; historiek gefilterd (product, dagen ≤ 365, limiet 10..500)",
  "AV. Invoeren : gearchiveerde klanten weg ; leverdag gecontroleerd met dezelfde regels ; regels meegegeven",
  "AW. Klantportaal : gearchiveerde klant 401 (catalogue, orders, klantorder) ; favorieten ; voorraad enkel met afboeken",
  "BA. Documenten in de taal van de klant (NL/FR), geen standaardzin « goederen in goede staat »",
  "AZ. Bedragen : scherm = documenten = e-mails (€ 1.234,50)",
  "AY. Volgorde catalogus : enkel beheerder, validatie, enkel wijzigingen, gedeelde sortering",
  "AX. Numéro de facture unique, stock compensé, lignes + départ refusés, mots de passe hachés (migration), jeton client",
  "Regles release candidate (validation explicite, 405 GET, 410 cadrage)",
  "Règles métier commande, préparation et livraison"
];

const scenarioFiles = fs.readdirSync(DIR).filter(f => f.endsWith(".test.js") && f !== SELF).sort();
const src = f => fs.readFileSync(path.join(DIR, f), "utf8");

describe("Inventaire du découpage (F-10)", () => {
  test("chaque bloc d'origine est exactement un test, même libellé", () => {
    const names = [];
    for (const f of scenarioFiles) for (const m of src(f).matchAll(/^ {2}test\(("(?:[^"\\]|\\.)*"),/gm)) names.push(JSON.parse(m[1]));
    for (const b of BLOCS_ORIGINE) assert.equal(names.filter(n => n === b).length, 1, "bloc d'origine présent une fois : " + b);
    assert.equal(BLOCS_ORIGINE.length, 36, "36 blocs « ✓ » dans l'ancien script");
  });

  test("aucune assertion perdue (comptage des appels assert)", () => {
    const count = [...scenarioFiles, "_helpers.js"].reduce((n, f) => n + (src(f).match(/\bassert(\.[a-zA-Z]+)?\(/g) || []).length, 0);
    assert.ok(count >= ASSERTS_ORIGINE, "appels assert dans test/workflow : " + count + " (référence avant découpage : " + ASSERTS_ORIGINE + ")");
  });

  test("chaque fichier est autonome : ./_helpers d'abord, isolé dans son processus", () => {
    assert.ok(scenarioFiles.length >= 9, "un fichier par domaine");
    for (const f of scenarioFiles) {
      const code = src(f).split("\n").filter(l => l.trim() && !/^\s*(\/\/|"use strict")/.test(l));
      assert.equal(code[0], 'const h = require("./_helpers"); // en premier : environnement de test, réseau réel interdit', f + " : ./_helpers chargé en premier");
      assert.equal(code[1], "h.isolate(__filename);", f + " : isolate(__filename) juste après");
    }
  });
});
