"use strict";
// Facturation : numéros FA/CN uniques, paiement, creditnota, OGM, montants.
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
const { ROOT, clearModule, BILL, call, patchOfX, methodCallsX } = h;
const { yearX } = h.datesX();
const updateOrder2 = require(path.join(ROOT, "api", "updateorder.js"));

describe("Facturation : numéros FA/CN uniques, paiement, creditnota, OGM, montants", () => {
  // Cookies staff et beheerder ouverts avec les codes d'environnement de test.
  let cookieHdr, adminCookieHdr;
  before(async () => { ({ cookieHdr, adminCookieHdr } = await h.staffCookies()); });

  test("D. Factuurnummer unique (pas de réallocation)", async () => {
    let result;
    // --- D. Facture unique : Factuurnummer déjà posé → pas de nouvel alloc ---
    {
      result = await call(updateOrder2, {
        id: "rec1", statut: "Facturée", deliveryConfirmed: true, recipient: "Jan"
      }, [
        {
          fields: {
            Statut: "Sortie en livraison",
            "Livraison confirmée": true,
            Factuurnummer: "FA-2026-0042",
            "Réceptionné par": "Jan"
          }
        },
        { fields: { Statut: "Facturée" } }
      ], { headers: cookieHdr });
      assert.equal(result.res.statusCode, 200, "Facturée avec numéro existant doit réussir");
      const patchBodies = result.calls
        .filter(c => (c.options.method || "").toUpperCase() === "PATCH")
        .map(c => JSON.parse(c.options.body));
      assert.ok(patchBodies.length >= 1, "au moins un PATCH commande");
      const last = patchBodies[patchBodies.length - 1];
      assert.equal(last.fields.Factuurnummer, undefined, "ne doit pas écraser Factuurnummer");
      assert.equal(result.res.payload.factuurnummer, null);
      // aucun GET pour lister les factures (nextInvoiceNumber)
      const invoiceList = result.calls.filter(c => /Factuurnummer/.test(c.url));
      assert.equal(invoiceList.length, 0, "ne doit pas allouer un nouveau numéro");
    }
  });

  test("O. Gestructureerde mededeling (FA-nummer → +++…+++, mod 97)", async () => {
    // --- O. Gestructureerde mededeling op de factuur ---------------------------
    {
      const docsSrc = fs.readFileSync(path.join(ROOT, "documents.js"), "utf8");
      const sandbox = { window: {}, console };
      vm.runInNewContext(docsSrc, sandbox);
      const FamoDocs = sandbox.window.FamoDocuments;
      const ref = FamoDocs.structuredRef;

      // O1 — valeurs connues, dont le cas reste 0 → 97.
      assert.equal(ref("FA-2026-0001"), "+++202/6000/00192+++", "O1 FA-2026-0001");
      assert.equal(ref("FA-2026-0006"), "+++202/6000/00697+++", "O1 reste 0 → contrôle 97");
      assert.equal(ref("FA-2027-12345"), "+++202/7012/34547+++", "O1 volgnummer au-delà de 9999");

      // O2 — toujours 12 chiffres et contrôle modulo 97 valide.
      ["FA-2026-0001", "FA-2026-0042", "FA-2026-9999", "FA-2030-123456"].forEach(n => {
        const digits = ref(n).replace(/\D/g, "");
        assert.equal(digits.length, 12, "O2 12 chiffres : " + n);
        assert.equal(Number(digits.slice(0, 10)) % 97 || 97, Number(digits.slice(10)), "O2 modulo 97 : " + n);
      });

      // O3 — format inconnu : rien plutôt qu'une communication fausse.
      ["", null, "CMD-1789309163572", "FA-26-1", "FA-2026-1234567"].forEach(n => {
        assert.equal(ref(n), "", "O3 aucun code pour : " + n);
      });

      // O4 — la ligne apparaît sur la facture, pas sur le bon de livraison.
      // Mode « portaal » : la facture du portail porte l'OGM (en mode boekhouder, jamais : test/documents.test.js).
      FamoDocs.setCompany({ bedrijfsnaam: "Famo", iban: "BE68539007547034", bic: "GKCCBEBB", facturatie: "portaal" });
      const order = { ref: "CMD-1", client: "Resto Test", factuurnummer: "FA-2026-0001", lignes: "Zalm × 2 kg [€12.50]", total: 25 };
      const invoiceHtml = FamoDocs.build(order, "invoice");
      assert.match(invoiceHtml, /<span>Mededeling<\/span><b class="mono">\+\+\+202\/6000\/00192\+\+\+<\/b>/, "O4 Mededeling sur la facture");
      assert.ok(!/Mededeling/.test(FamoDocs.build(order, "delivery")), "O4 pas de Mededeling sur le bon de livraison");
      assert.ok(!/Mededeling/.test(FamoDocs.build({ ...order, factuurnummer: "OUD-7" }, "invoice")), "O4 pas de ligne si numéro hors format");
    }
  });

  test("AQ. Bijwerken : betaald (datum, wijze), dubbele ontvangst 409, uitzondering, volgorde, creditnota, gardes, lijnen aan figés prijzen", async () => {
    // --- AQ. api/updateorder.js : paiement, réception, uitzondering, volgorde, creditnota, gardes, lignes ---
    {
      clearModule("api/updateorder.js");
      const uo = require(path.join(ROOT, "api", "updateorder.js"));
      const cmdPatch = r => patchOfX(r, /Commandes\//);
      const FACT = extra => ({ fields: Object.assign({ Statut: "Facturée", Factuurnummer: "FA-2026-0001", "Référence": "CMD-40", "Livraison confirmée": true, "Statut paiement": "En attente", "Lignes (produits / quantités)": "Mosselen × 2 caisse [€28.00]\nZalm × 1.5 kg [€20.00]", Client: ["cliAQ"] }, extra || {}) });
      let r, b;
      // 1. Betaald : enkel op een factuur ; datum + wijze ; terug op openstaand wist beide.
      r = await call(uo, { id: "o1", paiement: "Payé", modePaiement: "Contant" }, [{ fields: { Statut: "Prête" } }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AQ1 betaald enkel na factuur"); assert.equal(methodCallsX(r, "PATCH").length, 0);
      // Le personnel ne gère pas les encaissements (réponse du client, 27/09/2026) : 403 sans écriture.
      r = await call(uo, { id: "o1", paiement: "Payé" }, [FACT()], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 403, "AQ1 personeel mag de betaalstatus niet wijzigen"); assert.equal(methodCallsX(r, "PATCH").length, 0);
      r = await call(uo, { id: "o1", paiement: "Payé", modePaiement: "Bancontact" }, [FACT(), { fields: {} }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ1 betaald op factuur");
      b = cmdPatch(r);
      assert.equal(b.fields["Statut paiement"], "Payé"); assert.ok(Date.parse(b.fields["Payé le"]) > 0, "AQ1 Payé le"); assert.equal(b.fields["Mode de paiement"], "Bancontact");
      assert.match(b.fields.Correcties, /Betaald \(Bancontact\) · beheerder$/, "AQ1 journal");
      r = await call(uo, { id: "o1", paiement: "Payé", modePaiement: "Cheque" }, [FACT()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 400, "AQ1 betaalwijze inconnue"); assert.match(r.res.payload.error, /betaalwijze/);
      r = await call(uo, { id: "o1", paiement: "Payé" }, [FACT(), { fields: {} }], { headers: adminCookieHdr });
      b = cmdPatch(r); assert.equal(b.fields["Mode de paiement"], undefined, "AQ1 wijze facultatief"); assert.match(b.fields.Correcties, /Betaald · beheerder$/);
      r = await call(uo, { id: "o1", paiement: "Payé" }, [FACT({ "Statut paiement": "Payé" }), { fields: {} }], { headers: adminCookieHdr });
      assert.equal(cmdPatch(r).fields.Correcties, undefined, "AQ1 déjà payé : pas de doublon dans le journal");
      r = await call(uo, { id: "o1", paiement: "En attente", reden: "verkeerde klant" }, [FACT({ "Statut paiement": "Payé", "Payé le": "2026-09-01T10:00:00.000Z", "Mode de paiement": "Contant" }), { fields: {} }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ1 terug op openstaand"); b = cmdPatch(r);
      assert.equal(b.fields["Payé le"], null); assert.equal(b.fields["Mode de paiement"], null); assert.match(b.fields.Correcties, /Terug op openstaand · beheerder — verkeerde klant$/);
      r = await call(uo, { id: "o1", paiement: "Gratis" }, [FACT()], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AQ1 betaalstatus inconnu");
      // 2. Dubbele ontvangstbevestiging (dubbeltik, tweede toestel) → 409, niets herschreven.
      r = await call(uo, { id: "o2", statut: "Facturée", deliveryConfirmed: true, recipient: "Kenji" }, [FACT()], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 409, "AQ2 al bevestigd"); assert.match(r.res.payload.error, /al bevestigd/); assert.equal(methodCallsX(r, "PATCH").length, 0);
      // 3. Uitzondering bij levering : op de bestelling én in het journaal ; onbekende → 400.
      const SORTIE = { fields: { Statut: "Sortie en livraison", "Référence": "CMD-41", "Préparation validée": true, "Lignes (produits / quantités)": "Mosselen × 2 caisse [€28.00]", Client: ["cliAQ"] } };
      r = await call(uo, { id: "o3", statut: "Facturée", deliveryConfirmed: true, recipient: "Kenji", uitzondering: "Gedeeltelijk", uitzonderingNota: "1 doos\nte weinig" }, [SORTIE, ...BILL(), { records: [{ fields: { Factuurnummer: "FA-" + yearX + "-0007" } }] }, { fields: {} }, { records: [{ fields: {} }] }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ3 uitzondering"); assert.equal(r.res.payload.factuurnummer, "FA-" + yearX + "-0008", "AQ3 factuurnummer volgt");
      b = cmdPatch(r);
      assert.equal(b.fields["Uitzondering levering"], "Gedeeltelijk"); assert.equal(b.fields["Uitzondering nota"], "1 doos te weinig", "AQ3 nota op één regel");
      assert.equal(b.fields["Livraison confirmée"], true); assert.equal(b.fields["Réceptionné par"], "Kenji"); assert.equal(b.fields.Factuurnummer, "FA-" + yearX + "-0008");
      assert.match(b.fields.Correcties, /Uitzondering bij levering: Gedeeltelijk · personeel — 1 doos te weinig$/, "AQ3 journal");
      r = await call(uo, { id: "o3", statut: "Facturée", deliveryConfirmed: true, recipient: "Kenji", uitzondering: "Verdwenen" }, [SORTIE], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 400, "AQ3 onbekende uitzondering"); assert.match(r.res.payload.error, /Ongeldige uitzondering/);
      r = await call(uo, { id: "o3", statut: "Facturée", deliveryConfirmed: true, recipient: "Kenji" }, [SORTIE, ...BILL(), { records: [] }, { fields: {} }, { records: [{ fields: {} }] }], { headers: cookieHdr });
      b = cmdPatch(r); assert.equal(b.fields["Uitzondering levering"], undefined, "AQ3 zonder uitzondering niets geschreven"); assert.equal(b.fields.Correcties, undefined);
      // 4. Volgorde levering : enig veld, ook na vertrek ; 1..999 of leeg ; nooit op een geannuleerde.
      r = await call(uo, { id: "o4", volgorde: 3 }, [{ fields: { Statut: "Prête" } }, { fields: {} }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ4 volgorde"); assert.equal(r.res.payload.volgorde, 3); assert.deepEqual(cmdPatch(r), { fields: { "Volgorde levering": 3 } }, "AQ4 enkel dat veld, zonder typecast");
      r = await call(uo, { id: "o4", volgorde: "" }, [{ fields: { Statut: "Sortie en livraison" } }, { fields: {} }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ4 ook onderweg"); assert.deepEqual(cmdPatch(r).fields, { "Volgorde levering": null }, "AQ4 leeg = gewist");
      for (const v of [0, 1000, "abc"]) { r = await call(uo, { id: "o4", volgorde: v }, [{ fields: { Statut: "Prête" } }], { headers: cookieHdr }); assert.equal(r.res.statusCode, 400, "AQ4 ongeldig : " + v); }
      r = await call(uo, { id: "o4", volgorde: 2 }, [{ fields: { Statut: "Annulée" } }], { headers: cookieHdr }); assert.equal(r.res.statusCode, 409, "AQ4 geannuleerd");
      // 5. Creditnota : beheerder, enkel op factuur, deelverzameling van de lijnen, prijzen figés, nummer CN-JJJJ-NNNN.
      const cn = (lignes, extra) => ({ id: "o5", creditnota: Object.assign({ motif: "beschadigd", lignes }, extra || {}) });
      r = await call(uo, cn("Mosselen × 1"), [FACT()], { headers: cookieHdr }); assert.equal(r.res.statusCode, 403, "AQ5 personeel");
      r = await call(uo, cn("Mosselen × 1"), [{ fields: { Statut: "Sortie en livraison" } }], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 409, "AQ5 niet gefactureerd");
      r = await call(uo, cn("Mosselen × 1"), [FACT({ Factuurnummer: "" })], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 409, "AQ5 zonder factuurnummer");
      r = await call(uo, cn("Kreeft × 1"), [FACT()], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AQ5 artikel niet op factuur"); assert.match(r.res.payload.error, /niet op de factuur: Kreeft/);
      r = await call(uo, cn("Mosselen × 3"), [FACT()], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AQ5 te veel"); assert.match(r.res.payload.error, /tussen 0 en 2/);
      r = await call(uo, cn("Mosselen × 1", { motif: "x" }), [FACT()], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AQ5 reden verplicht");
      r = await call(uo, cn(""), [FACT()], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AQ5 minstens één artikel");
      r = await call(uo, cn("Mosselen × 1\nZalm × 0.5 kg"), [FACT(), { records: [{ fields: { "Creditnota nummer": "CN-" + yearX + "-0002" } }, { fields: { Factuurnummer: "FA-" + yearX + "-0044" } }] }, { fields: {} }, { records: [{ id: "o5" }] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ5 creditnota OK");
      assert.equal(r.res.payload.creditnota.nummer, "CN-" + yearX + "-0003", "AQ5 nummer volgt de CN-reeks, niet de FA-reeks"); assert.equal(r.res.payload.creditnota.montant, 38);
      assert.ok(decodeURIComponent(r.calls[1].url).includes("fields[]=Creditnota nummer"), "AQ5 numérotation lue sur la bonne colonne");
      b = cmdPatch(r);
      assert.equal(b.fields["Creditnota nummer"], "CN-" + yearX + "-0003"); assert.equal(b.fields["Creditnota montant"], 38); assert.equal(b.fields["Creditnota motif"], "beschadigd"); assert.ok(Date.parse(b.fields["Creditnota le"]) > 0);
      assert.equal(b.fields["Creditnota lignes"], "Mosselen × 1 caisse [€28.00]\nZalm × 0.5 kg [€20.00]", "AQ5 prijzen figés van de factuur");
      assert.match(b.fields.Correcties, /Creditnota CN-\d{4}-0003 \(€ 38,00\) · beheerder — beschadigd$/, "AQ5 journal");
      assert.equal(r.calls.filter(c => /Stock|Mouvements/.test(c.url)).length, 0, "AQ5 zonder retourStock blijft de voorraad onaangeroerd");
      // C-08 : plusieurs creditnota's par factuur ; la première reste dans les champs historiques, la liste
      // « Creditnotas » les contient toutes ; le plafond porte sur toutes les notes ensemble.
      const OUDE = { "Creditnota nummer": "CN-" + yearX + "-0001", "Creditnota lignes": "Mosselen × 1 caisse [€28.00]", "Creditnota montant": 28, "Creditnota le": "2026-09-01T10:00:00.000Z", "Creditnota motif": "oud" };
      r = await call(uo, cn("Mosselen × 1"), [FACT(OUDE), { records: [{ fields: OUDE }] }, { fields: {} }, { records: [{ id: "o5" }] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ5 tweede creditnota op dezelfde factuur"); assert.equal(r.res.payload.creditnota.nummer, "CN-" + yearX + "-0002", "AQ5 nummering volgt");
      b = cmdPatch(r);
      assert.equal(b.fields["Creditnota nummer"], undefined, "AQ5 eerste creditnota blijft onaangeroerd");
      assert.deepEqual(JSON.parse(b.fields.Creditnotas).map(n => n.nummer), ["CN-" + yearX + "-0001", "CN-" + yearX + "-0002"], "AQ5 lijst met beide");
      assert.ok(decodeURIComponent(r.calls[1].url).includes("fields[]=Creditnotas"), "AQ5 numérotation lit aussi la liste");
      r = await call(uo, cn("Mosselen × 2"), [FACT(OUDE)], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 400, "AQ5 samen nooit meer dan gefactureerd"); assert.match(r.res.payload.error, /tussen 0 en 1/); assert.equal(methodCallsX(r, "PATCH").length, 0);
      r = await call(uo, cn("Mosselen × 1", { retourStock: true }), [FACT(), { records: [] }, { records: [{ id: "stk", fields: { Produit: "Mosselen", "Quantité disponible": 4 } }] }, { records: [] }, { records: [] }, { fields: {} }, { records: [{ id: "o5" }] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ5 retour in voorraad");
      assert.equal(JSON.parse(r.calls.find(c => /\/Stock$/.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH").options.body).records[0].fields["Quantité disponible"], 5, "AQ5 voorraad +1");
      const mv = JSON.parse(r.calls.find(c => /Mouvements/.test(c.url)).options.body).records[0].fields;
      // 5b. Deux creditnota simultanées lisent le même maximum : ensureUnique (après
      // l'écriture) détecte le doublon, le plus grand identifiant reprend le numéro suivant.
      {
        const rr = await call(uo, { id: "recZZ", creditnota: { motif: "beschadigd", lignes: "Mosselen × 1" } }, [
          FACT(),
          { records: [{ fields: { "Creditnota nummer": "CN-" + yearX + "-0002" } }] }, // nextNumber → 0003
          { fields: {} },                                                            // PATCH commande
          { records: [{ id: "recAA" }, { id: "recZZ" }] },                           // 0003 existe deux fois
          { records: [{ fields: { "Creditnota nummer": "CN-" + yearX + "-0003" } }] }, // nextNumber → 0004
          { fields: {} },                                                            // PATCH nouveau numéro
          { records: [{ id: "recZZ" }] },                                            // 0004 unique
          { fields: {} }                                                             // journal avec le numéro final (B-18)
        ], { headers: adminCookieHdr });
        assert.equal(rr.res.statusCode, 200, "AQ5b creditnota malgré le doublon");
        assert.equal(rr.res.payload.creditnota.nummer, "CN-" + yearX + "-0004", "AQ5b doublon CN détecté → numéro suivant");
        const patches = rr.calls.filter(c => (c.options.method || "").toUpperCase() === "PATCH").map(c => JSON.parse(c.options.body).fields);
        assert.ok(patches.some(p => p["Creditnota nummer"] === "CN-" + yearX + "-0004"), "AQ5b le nouveau numéro est écrit");
        assert.match(patches[patches.length - 1].Correcties, new RegExp("Creditnota CN-" + yearX + "-0004"), "AQ5b le journal cite le numéro final");
        const rk = await call(uo, { id: "recAA", creditnota: { motif: "beschadigd", lignes: "Mosselen × 1" } }, [
          FACT(), { records: [] }, { fields: {} }, { records: [{ id: "recAA" }, { id: "recZZ" }] }
        ], { headers: adminCookieHdr });
        assert.equal(rk.res.payload.creditnota.nummer, "CN-" + yearX + "-0001", "AQ5b le plus petit identifiant garde son numéro");
        assert.equal(rk.calls.filter(c => (c.options.method || "").toUpperCase() === "PATCH").length, 1, "AQ5b aucune renumérotation pour celui qui garde");
      }
      assert.equal(mv.Type, "Retour client"); assert.equal(mv["Quantité"], 1); assert.equal(mv["Référence commande"], "CMD-40"); assert.equal(mv["Stock après"], 5);
      assert.deepEqual(r.res.payload.stock.done, [{ nom: "Mosselen", qty: 1, van: 4, naar: 5 }]);
      // 6. Gardes : geen annulering zodra een factuur bestaat ; geen terug zodra een creditnota bestaat ; terug wist de uitzondering.
      r = await call(uo, { id: "o6", correction: "annuleren", reden: "klant weg" }, [{ fields: { Statut: "Sortie en livraison", Factuurnummer: "FA-2026-0009" } }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AQ6 factuur bestaat → geen annulering"); assert.match(r.res.payload.error, /FA-2026-0009/);
      r = await call(uo, { id: "o6", correction: "terug", reden: "fout getekend" }, [FACT({ "Creditnota nummer": "CN-2026-0001" })], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AQ6 creditnota bestaat → ontvangst blijft"); assert.match(r.res.payload.error, /creditnota/i);
      r = await call(uo, { id: "o6", correction: "terug", reden: "fout getekend" }, [FACT({ "Uitzondering levering": "Afwezig" }), { fields: {} }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ6 terug vanuit Facturée"); b = cmdPatch(r);
      assert.equal(b.fields["Uitzondering levering"], null); assert.equal(b.fields["Uitzondering nota"], ""); assert.equal(b.fields.Statut, "Sortie en livraison");
      // 7. normalizeLines : prijs [€x] blijft, toegevoegde lijn krijgt onderhandelde prijs of basisprijs, totaal herberekend.
      const CATQ = { records: [{ id: "pM", fields: { Produit: "Mosselen", "Unité": "caisse", "Prix de base": 28 } }, { id: "pZ", fields: { Produit: "Zalm", "Unité": "kg", "Prix de base": 20, Actif: false } }, { id: "pK", fields: { Produit: "Kreeft", "Unité": "pièce", "Prix de base": 40 } }] };
      const NEGQ = { records: [{ fields: { Client: ["cliAQ"], Produit: ["pZ"], "Prix négocié": 18 } }, { fields: { Client: ["ander"], Produit: ["pK"], "Prix négocié": 1 } }] };
      const STORED7 = { Statut: "Reçue", Client: ["cliAQ"], "Lignes (produits / quantités)": "Mosselen × 3 caisse [€25.00]" };
      r = await call(uo, { id: "o7", lignes: "mosselen × 3 caisse [€25.00] (schoon)\nZalm × 2 kg\nKreeft × 1", total: 1 }, [{ fields: STORED7 }, CATQ, NEGQ, { fields: {} }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AQ7 lijnen bewerkt"); b = cmdPatch(r);
      assert.equal(b.fields["Lignes (produits / quantités)"], "Mosselen × 3 caisse [€25.00] (schoon)\nZalm × 2 kg [€18.00]\nKreeft × 1 pièce [€40.00]", "AQ7 figé / onderhandeld / basis, naam uit de catalogus");
      assert.equal(b.fields.Total, 151, "AQ7 totaal server-side, nooit dat van de browser");
      r = await call(uo, { id: "o7", lignes: "Mosselen × 3 caisse [€25.00]" }, [{ fields: STORED7 }, CATQ, { fields: {} }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200); assert.equal(r.calls.filter(c => /Prix/.test(c.url)).length, 0, "AQ7 alle prijzen figé → Prix négociés nooit gelezen");
      // Le personnel ne fixe pas le prix : [€1] envoyé est ignoré, le prix figé enregistré reste.
      r = await call(uo, { id: "o7", lignes: "Mosselen × 3 caisse [€1.00]" }, [{ fields: STORED7 }, CATQ, { fields: {} }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200); assert.equal(cmdPatch(r).fields["Lignes (produits / quantités)"], "Mosselen × 3 caisse [€25.00]", "AQ7 prijs van de browser genegeerd voor personeel");
      assert.equal(cmdPatch(r).fields.Total, 75, "AQ7 totaal op de figé prijs");
      // Nouvelle ligne avec [€x] du personnel : prix négocié/base, jamais celui du navigateur.
      r = await call(uo, { id: "o7", lignes: "Kreeft × 1 [€1.00]" }, [{ fields: { Statut: "Reçue", Client: ["cliAQ"] } }, CATQ, NEGQ, { fields: {} }], { headers: cookieHdr });
      assert.equal(cmdPatch(r).fields.Total, 40, "AQ7 nieuwe lijn : basisprijs, niet die van de browser");
      // Un beheerder peut accorder une remise volontaire sur la ligne.
      r = await call(uo, { id: "o7", lignes: "Mosselen × 3 caisse [€20.00]" }, [{ fields: STORED7 }, CATQ, { fields: {} }], { headers: adminCookieHdr });
      assert.equal(cmdPatch(r).fields.Total, 60, "AQ7 beheerder mag de prijs aanpassen");
      r = await call(uo, { id: "o7", lignes: "Kreeft × 1" }, [{ fields: { Statut: "Reçue" } }, { records: [] }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 400, "AQ7 onbekend artikel"); assert.match(r.res.payload.error, /niet gevonden in de catalogus: Kreeft/);
      r = await call(uo, { id: "o7", lignes: "Kreeft × 1.5" }, [{ fields: { Statut: "Reçue" } }, CATQ], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 400, "AQ7 decimaal enkel per kg");
      const pl = uo.parseLines("Zalmfilet × 3 doos [€12.50] (in filets)")[0];
      assert.deepEqual(pl, { nom: "Zalmfilet", qty: 3, unit: "doos", price: 12.5, comment: "in filets" }, "AQ7 parseLines");
      assert.equal(uo.formatLine(pl), "Zalmfilet × 3 doos [€12.50] (in filets)", "AQ7 formatLine = inverse");
    }
  });

  test("AX. Numéro de facture unique, stock compensé, lignes + départ refusés, mots de passe hachés (migration), jeton client", async () => {
    // --- AX. Lot sécurité / argent : numéro unique, stock compensé, verrou, mots de passe, jeton client ---
    {
      const uo = require(path.join(ROOT, "api", "updateorder.js"));
      const ca = require(path.join(ROOT, "lib", "clientauth"));
      const yearAX = require(path.join(ROOT, "lib", "staffauth")).brusselsYear();
      const isPatch = c => (c.options.method || "GET").toUpperCase() === "PATCH";
      // AX1 — deux confirmations simultanées lisent le même maximum : l'enregistrement au plus
      // grand identifiant cède et reprend le numéro suivant.
      const PRETE_OUT = { fields: { Statut: "Sortie en livraison", "Livraison confirmée": false, "Lignes (produits / quantités)": "Mosselen × 1 caisse [€28.00]", Client: ["c1"] } };
      let r = await call(uo, { id: "recZZ", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, [
        PRETE_OUT,
        ...BILL(),                                                               // taux et régime figés (avant le numéro)
        { records: [{ fields: { Factuurnummer: "FA-" + yearAX + "-0007" } }] }, // nextNumber → 0008
        { fields: {} },                                                         // PATCH commande
        { records: [{ id: "recAA" }, { id: "recZZ" }] },                        // 0008 existe deux fois
        { records: [{ fields: { Factuurnummer: "FA-" + yearAX + "-0008" } }] }, // nextNumber → 0009
        { fields: {} },                                                         // PATCH nouveau numéro
        { records: [{ id: "recZZ" }] }                                          // 0009 unique
      ], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AX1 réception confirmée");
      assert.equal(r.res.payload.factuurnummer, "FA-" + yearAX + "-0009", "AX1 doublon détecté → numéro suivant");
      assert.equal(JSON.parse(r.calls.filter(isPatch).pop().options.body).fields.Factuurnummer, "FA-" + yearAX + "-0009", "AX1 le nouveau numéro est écrit");
      r = await call(uo, { id: "recAA", statut: "Facturée", deliveryConfirmed: true, recipient: "Chef" }, [
        PRETE_OUT, ...BILL(), { records: [] }, { fields: {} }, { records: [{ id: "recAA" }, { id: "recZZ" }] }
      ], { headers: cookieHdr });
      assert.equal(r.res.payload.factuurnummer, "FA-" + yearAX + "-0001", "AX1 le plus petit identifiant garde son numéro");
      assert.equal(r.calls.filter(isPatch).length, 1, "AX1 aucune renumérotation pour celui qui garde");

      // AX2 — le stock est déduit puis l'écriture de la commande échoue : le stock est remis.
      r = await call(uo, { id: "recS1", statut: "Sortie en livraison" }, [
        { fields: { Statut: "Prête", "Préparation validée": true, "Lignes (produits / quantités)": "Mosselen × 2 caisse", "Référence": "CMD-9" } },
        { records: [{ fields: { "Voorraad afboeken": true } }] },
        { records: [{ id: "stk1", fields: { Produit: "Mosselen", "Quantité disponible": 10 } }] },
        { records: [] },                                           // PATCH Stock 10 → 8
        { error: { type: "SERVER_ERROR", message: "boom" } },      // PATCH commande échoue
        { records: [{ id: "stk1", fields: { Produit: "Mosselen", "Quantité disponible": 8 } }] },
        { records: [] }                                            // PATCH Stock 8 → 10
      ], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 500, "AX2 échec signalé");
      const stockWrites = r.calls.filter(c => /\/Stock$/.test(c.url) && isPatch(c)).map(c => JSON.parse(c.options.body).records[0].fields["Quantité disponible"]);
      assert.deepEqual(stockWrites, [8, 10], "AX2 déduction puis remise : un nouvel essai ne déduira qu'une fois");
      assert.equal(r.calls.filter(c => /Mouvements/.test(c.url)).length, 0, "AX2 aucun mouvement journalisé pour une sortie annulée");

      // AX3 — lignes modifiées + départ dans la même requête : refusé (à revalider d'abord).
      r = await call(uo, { id: "recS2", statut: "Sortie en livraison", lignes: "Mosselen × 9 caisse" }, [{ fields: { Statut: "Prête", "Préparation validée": true } }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 409, "AX3 lignes + départ → 409"); assert.match(r.res.payload.error, /Valideer eerst/);

      // AX4 — mots de passe : empreinte, ancien texte clair migré à la première connexion.
      const h = ca.hashPassword("geheim-123");
      assert.ok(ca.isHashed(h) && ca.checkPassword(h, "geheim-123") && !ca.checkPassword(h, "geheim-124"), "AX4 empreinte scrypt vérifiable");
      assert.ok(ca.checkPassword("oud-klaar", "oud-klaar") && !ca.checkPassword("oud-klaar", "oud-klaa"), "AX4 ancien texte clair encore accepté (migration)");
      const cat = require(path.join(ROOT, "api", "catalogue.js"));
      const LEGACY = { records: [{ id: "recL", fields: { Gebruikersnaam: "legacy", Wachtwoord: "oud-klaar", Nom: "Legacy" } }] };
      r = await call(cat, { user: "legacy", pw: "oud-klaar" }, [LEGACY, { fields: {} }, { records: [] }, { records: [] }, { records: [{ fields: {} }] }]);
      assert.equal(r.res.statusCode, 200, "AX4 connexion avec l'ancien mot de passe");
      const up = r.calls.find(c => /Clients\/recL$/.test(c.url) && isPatch(c));
      assert.ok(up, "AX4 migration écrite"); const upPw = JSON.parse(up.options.body).fields.Wachtwoord;
      assert.ok(ca.isHashed(upPw) && ca.checkPassword(upPw, "oud-klaar"), "AX4 le texte clair est remplacé par son empreinte");

      // AX5 — jeton client : valable, lié au mot de passe, refusé s'il est modifié ou périmé.
      const tok = r.res.payload.token;
      assert.match(String(tok), /^k\.recL\./, "AX5 jeton renvoyé à la connexion");
      assert.ok(!JSON.stringify(r.res.payload).includes("oud-klaar"), "AX5 jamais le mot de passe dans la réponse");
      const REC_H = { id: "recL", fields: { Gebruikersnaam: "legacy", Wachtwoord: upPw, Nom: "Legacy" } };
      r = await call(cat, { token: tok }, [REC_H, { records: [] }, { records: [] }, { records: [{ fields: {} }] }]);
      assert.equal(r.res.statusCode, 200, "AX5 jeton accepté sans mot de passe");
      assert.match(r.calls[0].url, /\/Clients\/recL$/, "AX5 le client vient du jeton signé");
      r = await call(cat, { token: tok }, [{ id: "recL", fields: { Gebruikersnaam: "legacy", Wachtwoord: ca.hashPassword("nieuw-pw-1") } }]);
      assert.equal(r.res.statusCode, 401, "AX5 mot de passe changé → ancien jeton refusé"); assert.equal(r.res.payload.expired, true);
      const forged = tok.replace(/^k\.recL\./, "k.recX.");
      r = await call(cat, { token: forged }, []);
      assert.equal(r.res.statusCode, 401, "AX5 jeton falsifié → refusé sans lecture"); assert.equal(r.calls.length, 0);
      assert.equal(ca.readToken("k.recL.1.abc.def"), null, "AX5 jeton non signé refusé");
      // Jeton correctement signé mais périmé : seule l'échéance doit le faire refuser.
      const hmacAX = require(path.join(ROOT, "lib", "staffauth")).hmac;
      const fpAX = ca.fingerprint(upPw);
      const iatAX = Date.now() - 1000; // format k.id.exp.fp.iat.gen.sig (A-08)
      const signedAX = exp => { const p = "k.recL." + exp + "." + fpAX + "." + iatAX + ".0"; return p + "." + hmacAX(p); };
      assert.deepEqual(ca.readToken(signedAX(Date.now() + 60000)), { id: "recL", fp: fpAX, iat: iatAX, gen: 0 }, "AX5 témoin : jeton signé non périmé accepté");
      assert.equal(ca.readToken(signedAX(Date.now() - 1000)), null, "AX5 jeton signé périmé refusé");
      r = await call(cat, { token: signedAX(Date.now() - 1000) }, []);
      assert.equal(r.res.statusCode, 401, "AX5 jeton périmé → 401"); assert.equal(r.calls.length, 0, "AX5 jeton périmé : aucune lecture");
      // AX6 (D-06) — base injoignable ≠ mauvais identifiants : 503, jeton gardé, pas de verrou.
      const DOWN = { error: { type: "SERVER_ERROR", message: "upstream down" } };
      for (let i = 0; i < 7; i++) {
        r = await call(cat, { user: "loginAX", pw: "fout-of-niet" }, [DOWN]);
        assert.equal(r.res.statusCode, 503, "AX6 panne pendant la connexion → 503 (essai " + (i + 1) + "), jamais 401 ni 429");
      }
      r = await call(cat, { token: signedAX(Date.now() + 60000) }, [DOWN]);
      assert.equal(r.res.statusCode, 503, "AX6 panne pendant la relecture du jeton → 503"); assert.ok(!r.res.payload.expired, "AX6 le client n'est pas déconnecté");
      r = await call(cat, { token: signedAX(Date.now() + 60000) }, [{ error: { type: "NOT_FOUND" } }, { error: { type: "NOT_FOUND" } }]); // Clients puis Klantgebruikers (H-08)
      assert.equal(r.res.statusCode, 401, "AX6 client supprimé → 401 (pas une panne)");
    }
  });

  test("AZ. Bedragen : scherm = documenten = e-mails (€ 1.234,50)", async () => {
    // --- AZ. Montants identiques partout (écran, documents, e-mails) ---
    {
      const om = require(path.join(ROOT, "lib", "ordermail.js"));
      const sb = { window: {}, document: { documentElement: {}, addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem() { return null; }, setItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, navigator: { language: "nl" }, location: { search: "", pathname: "/", hash: "" } };
      sb.window = sb; vm.createContext(sb);
      vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8"), sb);
      vm.runInContext(fs.readFileSync(path.join(ROOT, "documents.js"), "utf8"), sb);
      const docSrc = fs.readFileSync(path.join(ROOT, "documents.js"), "utf8");
      const docEur = vm.runInNewContext("(" + docSrc.match(/const eur=(value=>\{[\s\S]*?\});/)[1] + ")");
      for (const v of [0, 7.5, 1234.5, 1234567.891, -12]) {
        const screen = sb.K.eur(v).replace(/\u00a0/g, " ");
        assert.equal(om.eur(v), screen, "AZ e-mail = écran pour " + v);
        assert.equal(docEur(v), screen, "AZ document = écran pour " + v);
      }
      assert.equal(om.eur(1234.5), "€ 1.234,50", "AZ séparateur des milliers");
    }
  });
});
