"use strict";
// Corrections : terug, annuleren, herstellen, bewerken.
// Scénarios métier découpés de l'ancien scripts/workflow-check.js (audit F-10,
// specs/011-workflow-check-decoupe) : code et messages d'assertion repris tels quels, un test par
// ancien bloc « ✓ ». Fichier autonome : son propre processus, son environnement, ses réponses simulées.
const h = require("./_helpers"); // en premier : environnement de test, réseau réel interdit
h.isolate(__filename);
const { describe, test, before } = require("node:test");
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { ROOT, HP, clearModule, call } = h;

describe("Corrections : terug, annuleren, herstellen, bewerken", () => {
  // Cookies staff et beheerder ouverts avec les codes d'environnement de test.
  let cookieHdr, adminCookieHdr;
  before(async () => { ({ cookieHdr, adminCookieHdr } = await h.staffCookies()); });

  test("AN. Corrections (terug, annuleren, herstellen, bewerken), klant annuleert, product verwijderen, FR/NL klantportaal", async () => {
    // --- AN. Corrections : marche arrière, annulation, herstel, leverdag/nota, klant annuleert ---
    {
      clearModule("api/updateorder.js");
      const uo = require(path.join(ROOT, "api", "updateorder.js"));
      const todayAN = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const plusAN = n => { const d = new Date(todayAN + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
      let okDay = plusAN(1); while (new Date(okDay + "T12:00:00Z").getUTCDay() === 0) okDay = plusAN(2);
      let sun = plusAN(1); while (new Date(sun + "T12:00:00Z").getUTCDay() !== 0) { const d = new Date(sun + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); sun = d.toISOString().slice(0, 10); }
      const patchOf = r => JSON.parse(r.calls.find(c => /Commandes\//.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH").options.body);
      let r;
      // 1. Prête → Reçue (personeel) : validatie gewist, journaal, typecast
      r = await call(uo, { id: "o1", correction: "terug", reden: "verkeerd gevalideerd" }, [
        { fields: { Statut: "Prête", "Préparation validée": true, "Référence": "CMD-9" } }, { fields: {} }
      ], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AN1 terug Prête→Reçue");
      let b = patchOf(r);
      assert.equal(b.fields.Statut, "Reçue"); assert.equal(b.fields["Préparation validée"], false); assert.equal(b.typecast, true);
      assert.match(b.fields.Correcties, /Terug naar te bereiden · personeel — verkeerd gevalideerd/, "AN1 journal");
      // 2. Zonder reden → 400, niets geschreven
      r = await call(uo, { id: "o1", correction: "terug", reden: "" }, [{ fields: { Statut: "Prête" } }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 400, "AN2 reden verplicht");
      assert.equal(r.calls.filter(c => (c.options.method || "").toUpperCase() === "PATCH").length, 0);
      // 3. Sortie → Prête met afgeboekte voorraad : stock teruggezet + journaal « Annulation sortie »
      r = await call(uo, { id: "o2", correction: "terug", reden: "toch niet vertrokken" }, [
        { fields: { Statut: "Sortie en livraison", "Stock afgeboekt": true, "Lignes (produits / quantités)": "Mosselen × 2 caisse", "Référence": "CMD-2" } },
        { records: [{ id: "stk1", fields: { Produit: "Mosselen", "Quantité disponible": 8 } }] },
        { records: [{ id: "stk1", fields: { "Quantité disponible": 10 } }] },
        { records: [] },
        { fields: {} }
      ], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AN3 terug Sortie→Prête");
      const stockPatch = JSON.parse(r.calls.find(c => /\/Stock$/.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH").options.body);
      assert.equal(stockPatch.records[0].fields["Quantité disponible"], 10, "AN3 voorraad +2");
      const mov = JSON.parse(r.calls.find(c => /Mouvements/.test(c.url)).options.body);
      assert.equal(mov.typecast, true); assert.equal(mov.records[0].fields.Type, "Annulation sortie"); assert.equal(mov.records[0].fields["Quantité"], 2);
      b = patchOf(r); assert.equal(b.fields.Statut, "Prête"); assert.equal(b.fields["Stock afgeboekt"], false);
      // 4. Facturée → Sortie : personeel 403 ; beheerder + betaald 409 ; beheerder + openstaand OK, factuurnummer blijft
      r = await call(uo, { id: "o3", correction: "terug", reden: "verkeerde klant getekend" }, [{ fields: { Statut: "Facturée", Factuurnummer: "FA-2026-0007" } }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 403, "AN4 personeel mag ontvangst niet ongedaan maken");
      r = await call(uo, { id: "o3", correction: "terug", reden: "verkeerde klant getekend" }, [{ fields: { Statut: "Facturée", "Statut paiement": "Payé", Factuurnummer: "FA-2026-0007" } }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AN4 betaald → eerst terug op openstaand");
      r = await call(uo, { id: "o3", correction: "terug", reden: "verkeerde klant getekend" }, [{ fields: { Statut: "Facturée", "Statut paiement": "En attente", Factuurnummer: "FA-2026-0007", "Livraison confirmée": true } }, { fields: {} }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AN4 beheerder maakt ontvangst ongedaan");
      b = patchOf(r); assert.equal(b.fields.Statut, "Sortie en livraison"); assert.equal(b.fields["Livraison confirmée"], false); assert.equal(b.fields.Factuurnummer, undefined, "AN4 factuurnummer nooit gewist");
      // 5. Annuleren : Reçue OK (personeel) ; Sortie personeel 403 ; Facturée 409
      r = await call(uo, { id: "o4", correction: "annuleren", reden: "klant belde af" }, [{ fields: { Statut: "Reçue", "Référence": "CMD-4" } }, { fields: {} }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AN5 annuleren vanuit Reçue");
      b = patchOf(r); assert.equal(b.fields.Statut, "Annulée"); assert.equal(b.fields["Motif annulation"], "klant belde af"); assert.ok(b.fields["Annulée le"]); assert.equal(b.typecast, true);
      r = await call(uo, { id: "o4", correction: "annuleren", reden: "x" }, [{ fields: { Statut: "Sortie en livraison" } }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 400, "AN5 reden te kort → 400");
      r = await call(uo, { id: "o4", correction: "annuleren", reden: "onderweg gestopt" }, [{ fields: { Statut: "Sortie en livraison" } }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 403, "AN5 annuleren onderweg enkel beheerder");
      r = await call(uo, { id: "o4", correction: "annuleren", reden: "fout" }, [{ fields: { Statut: "Facturée" } }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AN5 gefactureerd nooit annuleren");
      // 6. Herstellen : enkel vanuit Annulée ; geannuleerde bestelling blokkeert de gewone stappen
      r = await call(uo, { id: "o5", correction: "herstellen", reden: "toch leveren" }, [{ fields: { Statut: "Annulée", "Motif annulation": "x", "Annulée le": "2026-09-25T10:00:00.000Z" } }, { fields: {} }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AN6 herstellen");
      b = patchOf(r); assert.equal(b.fields.Statut, "Reçue"); assert.equal(b.fields["Annulée le"], null); assert.equal(b.fields["Motif annulation"], "");
      r = await call(uo, { id: "o5", correction: "herstellen", reden: "toch leveren" }, [{ fields: { Statut: "Reçue" } }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 409, "AN6 herstellen enkel vanuit Annulée");
      r = await call(uo, { id: "o5", statut: "Prête", preparationValidee: true }, [{ fields: { Statut: "Annulée" } }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 409, "AN6 geannuleerd → geen gewone stap zonder herstel");
      // 7. Bewerken : leverdag/nota vóór vertrek ; zondag 400 ; na vertrek 409
      r = await call(uo, { id: "o6", correction: "bewerken", reden: "klant wil donderdag", dateLivraison: okDay, notes: "achteraan bellen" }, [{ fields: { Statut: "Reçue", "Date livraison souhaitée": "2026-01-05", Notes: "" } }, { records: [] }, { fields: {} }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AN7 bewerken OK");
      b = patchOf(r); assert.equal(b.fields["Date livraison souhaitée"], okDay); assert.equal(b.fields.Notes, "achteraan bellen"); assert.match(b.fields.Correcties, /leverdag 2026-01-05 → /);
      r = await call(uo, { id: "o6", correction: "bewerken", reden: "klant wil zondag", dateLivraison: sun }, [{ fields: { Statut: "Reçue" } }, { records: [] }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 400, "AN7 zondag geweigerd");
      r = await call(uo, { id: "o6", correction: "bewerken", reden: "te laat", notes: "x" }, [{ fields: { Statut: "Sortie en livraison" } }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 409, "AN7 na vertrek vergrendeld");
      // 8. Klant annuleert zelf : enkel Reçue, enkel eigen bestelling
      clearModule("api/catalogue.js"); clearModule("api/klantorder.js");
      const ko = require(path.join(ROOT, "api", "klantorder.js"));
      const CLI = { records: [{ id: "cli1", fields: { Gebruikersnaam: "aloha", Wachtwoord: HP("welkom123"), Nom: "Aloha" } }] };
      r = await call(ko, { user: "aloha", pw: "welkom123", action: "cancel", ref: "CMD-1" }, [CLI, { records: [{ id: "o7", fields: { Client: ["cli1"], Statut: "Reçue", "Référence": "CMD-1" } }] }, { fields: {} }]);
      assert.equal(r.res.statusCode, 200, "AN8 klant annuleert Reçue");
      b = patchOf(r); assert.equal(b.fields.Statut, "Annulée"); assert.equal(b.fields["Motif annulation"], "Geannuleerd door klant"); assert.match(b.fields.Correcties, /Geannuleerd · klant/);
      r = await call(ko, { user: "aloha", pw: "welkom123", action: "cancel", ref: "CMD-1" }, [CLI, { records: [{ id: "o7", fields: { Client: ["cli1"], Statut: "Prête", "Référence": "CMD-1" } }] }]);
      assert.equal(r.res.statusCode, 409, "AN8 al klaargezet → bel Famo");
      r = await call(ko, { user: "aloha", pw: "welkom123", action: "cancel", ref: "CMD-1" }, [CLI, { records: [{ id: "o7", fields: { Client: ["andere"], Statut: "Reçue" } }] }]);
      assert.equal(r.res.statusCode, 404, "AN8 nooit de bestelling van een ander");
      r = await call(ko, { user: "aloha", pw: "fout", action: "cancel", ref: "CMD-1" }, [{ records: [] }]);
      assert.equal(r.res.statusCode, 401, "AN8 verkeerd wachtwoord");
      // 9. Product verwijderen : geweigerd zolang het in een open bestelling staat
      clearModule("api/onboarding.js");
      const ob = require(path.join(ROOT, "api", "onboarding.js"));
      r = await call(ob, { action: "deleteProduct", id: "p1" }, [{ id: "p1", fields: { Produit: "Mosselen" } }, { records: [{ id: "oX", fields: { Statut: "Reçue", "Référence": "CMD-77", "Lignes (produits / quantités)": "Mosselen × 2 caisse [€28.00]" } }] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AN9 product in open bestelling → 409");
      assert.match(r.res.payload.error, /CMD-77/);
      // 10. Front : één correctiepaneel, klant kan annuleren, taalkeuze, geen geannuleerde in het dagwerk
      const readF = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
      const common = readF("assets/pages/staff-common.js"), klantSrc2 = readF("assets/pages/klant.js"), ui = readF("assets/ui.js");
      assert.match(common, /S\.correctPanel = function/, "AN10 correctPanel");
      assert.match(common, /correction: c\.correction, reden/, "AN10 correction + reden naar de server");
      assert.match(common, /act === "correct"\) S\.correctPanel/, "AN10 data-act correct");
      for (const f of ["assets/pages/team/bestelling.js", "assets/pages/team/magazijn.js", "assets/pages/team/leveringen.js"]) assert.match(readF(f), /S\.correctBtn\(o/, "AN10 Corrigeren op " + f);
      assert.match(readF("assets/pages/team/bestellingen.js"), /value="Annulée"/, "AN10 filter Geannuleerd");
      for (const f of ["assets/pages/team/magazijn.js", "assets/pages/team/bestellingen.js", "assets/pages/beheer.js"]) assert.match(readF(f), /K\.isClosed\(o\)/, "AN10 geannuleerd uit het dagwerk : " + f);
      assert.match(klantSrc2, /\/api\/klantorder/, "AN10 klant annuleert via API");
      assert.match(klantSrc2, /data-cancel-order/, "AN10 knop Annuleren klant");
      assert.match(ui, /K\.langSwitch = /, "AN10 taalkeuze");
      assert.ok(Object.keys(ui.match(/K\.FR = \{[\s\S]*?\n  \};/)[0].split("\n")).length > 5, "AN10 woordenboek FR");
      const keys = new Set(); for (const f of ["assets/pages/klant.js", "assets/pages/start.js", "assets/pages/aanvraag.js", "wachtwoord.html", "assets/ui.js"]) for (const m of readF(f).matchAll(/K\.t\("([^"]+)"\)/g)) keys.add(m[1]);
      const sandboxFR = { document: { addEventListener() {}, documentElement: {} }, location: {}, localStorage: { getItem: () => "fr" }, sessionStorage: null, CustomEvent: class {}, fetch: async () => ({}) };
      vm.runInNewContext(ui, Object.assign(sandboxFR, { window: sandboxFR }));
      const missing = Array.from(keys).filter(k => !sandboxFR.K.FR[k]);
      assert.deepEqual(missing, [], "AN10 elke K.t-sleutel heeft een Franse vertaling");
      assert.equal(sandboxFR.K.status("Facturée"), "Livrée"); assert.equal(sandboxFR.K.cat("Poisson"), "Poissons"); assert.equal(sandboxFR.K.date("2026-09-30"), "mer 30/09");
      assert.match(readF("assets/pages/beheer.js"), /action: "deleteProduct"/, "AN10 product verwijderen in Beheer");
      assert.match(readF("assets/pages/team/voorraad.js"), /inCatalogue === false/, "AN10 orphelins in Voorraad");
      assert.match(readF("assets/pages/team/voorraad.js"), /action: "deleteProduct", id: i\.productId/, "AN10 Voorraad verwijdert het product zelf");
      assert.match(readF("api/stock.js"), /actif: prod \? !!prod\.fields\["Actif"\]/, "AN10 Voorraad kent de actief-status");
      assert.ok(!/Catalogue\?filterByFormula=\$\{encodeURIComponent\("\{Actif\}=1"\)\}`\),\n    atAll\("Clients"\)/.test(readF("lib/beheer/common.js")), "AN10 Beheer laadt ook inactieve producten");
    }
  });
});
