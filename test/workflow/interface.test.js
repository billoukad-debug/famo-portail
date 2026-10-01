"use strict";
// Interface : traductions, navigation par rôle, contrats frontend.
// Scénarios métier découpés de l'ancien scripts/workflow-check.js (audit F-10,
// specs/011-workflow-check-decoupe) : code et messages d'assertion repris tels quels, un test par
// ancien bloc « ✓ ». Fichier autonome : son propre processus, son environnement, ses réponses simulées.
const h = require("./_helpers"); // en premier : environnement de test, réseau réel interdit
h.isolate(__filename);
const { describe, test } = require("node:test");
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { ROOT } = h;

describe("Interface : traductions, navigation par rôle, contrats frontend", () => {
  test("H. famoNL caisse→kassa, Reçue→Ontvangen", async () => {
    // --- H. famoNL / staff-i18n ---
    {
      // famoNL vit dans assets/ui.js (plus de staff-i18n.js séparé).
      const sandbox = { console, document: { documentElement: {}, addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem() { return null; }, setItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, navigator: { language: "nl" }, location: { search: "", pathname: "/", hash: "" } };
      sandbox.window = sandbox; vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8"), sandbox);
      assert.equal(sandbox.window.famoNL.unit("caisse"), "kassa");
      assert.notEqual(sandbox.window.famoNL.unit("caisse"), "doos");
      assert.equal(sandbox.window.famoNL.status("Reçue"), "Ontvangen");
      assert.match(sandbox.window.famoNL.lines("Mosselen × 2 caisse"), /kassa/);
      assert.ok(!/doos/.test(sandbox.window.famoNL.lines("Mosselen × 2 caisse")));
    }
  });

  test("I. Navigation v2 (Dagelijks, Beheer, séparation des rôles)", async () => {
    // --- I. Navigation v2 : destinations quotidiennes et séparation des rôles ---
    {
      const ui = fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8");
      assert.match(ui, /const NAV_DAILY\s*=\s*\[\["bestellingen\.html",\s*"\/team\/bestellingen",\s*"Bestellingen"[\s\S]*?\["entrepot\.html",\s*"\/team\/magazijn",\s*"Magazijn"[\s\S]*?\["leveringen\.html",\s*"\/team\/leveringen",\s*"Leveringen"/, "I destinations quotidiennes v2");
      assert.match(ui, /const NAV_ADMIN\s*=\s*\[\["invoer\.html",\s*"\/team\/invoeren",\s*"Invoeren"[\s\S]*?\["documenten\.html",\s*"\/team\/documenten",\s*"Documenten"[\s\S]*?\["beheer\.html",\s*"\/beheer",\s*"Beheer"/, "I destinations beheer v2");
      assert.match(ui, /const NAV_STAFF_MORE\s*=\s*\[\["invoer\.html",\s*"\/team\/invoeren",\s*"Invoeren"[\s\S]*?\["documenten\.html",\s*"\/team\/documenten",\s*"Documenten"\]?[^\]]*\]\s*\]/, "I personnel : Invoeren + Documenten, sans Beheer");
      assert.ok(!/NAV_STAFF_MORE\s*=[^;]*beheer\.html/.test(ui), "I personnel sans écran Beheer");
      assert.match(ui, /admin\s*\?\s*NAV_ADMIN\s*:\s*NAV_STAFF_MORE/, "I menu sélectionné selon le rôle");
      assert.match(ui, /link\(\["stock\.html",\s*"\/team\/voorraad",\s*"Voorraad"/, "I Voorraad voor personeel én beheerder");
      assert.match(fs.readFileSync(path.join(ROOT, "assets", "pages", "team", "voorraad.js"), "utf8"), /K\.requireStaff\(\)/, "I stock.js open voor personeel");
      assert.match(fs.readFileSync(path.join(ROOT, "assets", "pages", "team", "invoeren.js"), "utf8"), /K\.requireStaff\(\)/, "I invoer.js open voor personeel");
    }
  });

  test("V2. Contrats frontend (workflow, documents, beheer, stock, numérotation)", async () => {
    // Les contrôles Q–AK ci-dessous décrivent le DOM monolithique de la v1.
    // La v2 a remplacé ce DOM par assets/ui.js + assets/pages/*.js : on protège
    // les mêmes capacités via des contrats ciblés, sans exécuter les assertions
    // devenues structurellement impossibles.
    {
      const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
      const common = read("assets/pages/staff-common.js");
      const klant = read("assets/pages/klant.js");
      const orders = read("assets/pages/team/bestellingen.js");
      const warehouse = read("assets/pages/team/magazijn.js");
      const deliveries = read("assets/pages/team/leveringen.js");
      const docs = read("assets/pages/team/documenten.js");
      const beheer = read("assets/pages/beheer.js");
      const stock = read("assets/pages/team/voorraad.js");

      assert.match(common, /data-act="validate"[\s\S]*?Klaarzetten/, "V2 action de préparation");
      assert.match(common, /data-act="depart"[\s\S]*?Vertrekt/, "V2 action de départ");
      assert.match(common, /data-act="deliver"[\s\S]*?Ontvangst bevestigen/, "V2 confirmation de réception");
      assert.match(common, /recipient[\s\S]*?deliveryConfirmed:\s*true/, "V2 réceptionnaire envoyé au backend");
      assert.match(common, /FamoDocuments\.build[\s\S]*?famoDocPreview\.open/, "V2 documents via l'aperçu partagé");
      assert.match(klant, /\/api\/catalogue/, "V2 catalogue client relié à l'API");
      assert.match(klant, /\/api\/order/, "V2 commande client reliée à l'API");
      assert.match(klant, /\/api\/klantdoc/, "V2 documents client protégés par l'API");
      assert.match(klant, /excl\. btw/, "V2 totaux client signalés hors TVA");
      assert.match(orders, /Totaal excl\. btw/, "V2 totaux personnel signalés hors TVA");
      assert.match(orders, /data-bulk="picking"[\s\S]*?data-bulk="delivery"[\s\S]*?data-bulk="csv"/, "V2 actions groupées conservées");
      assert.match(warehouse, /allDepart[\s\S]*?Alles wat klaar is: vertrekt/, "V2 départ groupé magasin");
      assert.match(deliveries, /data-act="delivery"[\s\S]*?data-act="invoice"/, "V2 documents dans les livraisons");
      assert.match(docs, /\["alle",\s*"Alle"\][\s\S]*?\["open",\s*"Openstaand"\]/, "V2 filtres documents");
      assert.match(beheer, /action:\s*"saveClient"/, "V2 gestion des clients");
      assert.match(beheer, /action:\s*"saveProduct"/, "V2 gestion des produits");
      assert.match(stock, /\/api\/stock\?history=1/, "V2 historique de stock");
      assert.match(stock, /lowThreshold/, "V2 seuil de stock");

      const orderNumber = require(path.join(ROOT, "lib", "ordernumber.js"));
      const year = orderNumber.brusselsYear();
      const seen = [];
      const next = await orderNumber.nextOrderRef(async path => {
        seen.push(decodeURIComponent(path));
        return { records: [{ fields: { "Référence": `CMD-${year}-0041` } }] };
      });
      assert.equal(next, `CMD-${year}-0042`, "V2 numérotation séquentielle");
      assert.match(seen[0], /REGEX_MATCH/, "V2 numérotation filtrée côté Airtable");
    }
  });
});
