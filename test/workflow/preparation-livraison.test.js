"use strict";
// Préparation et livraison : stock, réception, règles de livraison, Invoeren.
// Scénarios métier découpés de l'ancien scripts/workflow-check.js (audit F-10,
// specs/011-workflow-check-decoupe) : code et messages d'assertion repris tels quels, un test par
// ancien bloc « ✓ ». Fichier autonome : son propre processus, son environnement, ses réponses simulées.
const h = require("./_helpers"); // en premier : environnement de test, réseau réel interdit
h.isolate(__filename);
const { describe, test, before } = require("node:test");
const assert = require("assert");
const path = require("path");
const { ROOT, clearModule, call, NO_ORDER_REFS } = h;
const { lev, plusX, okDayX, sundayX, saturdayX } = h.datesX();
const updateOrder2 = require(path.join(ROOT, "api", "updateorder.js"));

describe("Préparation et livraison : stock, réception, règles de livraison, Invoeren", () => {
  // Cookies staff et beheerder ouverts avec les codes d'environnement de test.
  let cookieHdr, adminCookieHdr;
  before(async () => { ({ cookieHdr, adminCookieHdr } = await h.staffCookies()); });

  test("C. Stock déduit une seule fois / 409 si afgeboekt / verrou aussi sans skipStock", async () => {
    let result;
    // --- C. Stock déduit une seule fois / lignes bloquées si déjà afgeboekt ---
    {
      // Première Sortie avec préparation → déduction stock OK
      // Séquence : GET commande → GET Stock → PATCH Stock → POST mouvements → PATCH commande
      result = await call(updateOrder2, {
        id: "rec1", statut: "Sortie en livraison"
      }, [
        {
          fields: {
            Statut: "Prête",
            "Préparation validée": true,
            "Lignes (produits / quantités)": "Mosselen × 2 caisse",
            "Référence": "CMD-1",
            "Stock afgeboekt": false
          }
        },
        { records: [{ fields: { "Voorraad afboeken": true } }] },
        { records: [{ id: "stk1", fields: { Produit: "Mosselen", "Quantité disponible": 10 } }] },
        { records: [{ id: "stk1", fields: { "Quantité disponible": 8 } }] },
        { records: [] },
        { fields: { Statut: "Sortie en livraison", "Stock afgeboekt": true } }
      ], { headers: cookieHdr });
      assert.equal(result.res.statusCode, 200, "première Sortie doit réussir");
      const stockPatches = result.calls.filter(c => /\/Stock$/.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH");
      assert.equal(stockPatches.length, 1, "un seul PATCH stock à la première Sortie");

      // Déjà afgeboekt + tentative de changement de lignes → 409, aucun PATCH stock
      result = await call(updateOrder2, {
        id: "rec1", lignes: "Mosselen × 3 caisse", total: 30
      }, [
        {
          fields: {
            Statut: "Sortie en livraison",
            "Stock afgeboekt": true,
            "Préparation validée": true,
            "Lignes (produits / quantités)": "Mosselen × 2 caisse"
          }
        }
      ], { headers: cookieHdr });
      assert.equal(result.res.statusCode, 409, "lignes après afgeboekt → 409");
      assert.match(result.res.payload.error, /onderweg/);
      assert.equal(result.calls.filter(c => /Stock/.test(c.url)).length, 0, "pas de nouvel appel stock");

      // skipStock: départ sans toucher au stock, mais le verrou anti-modification
      // doit quand même se poser (basé sur le statut, pas sur "Stock afgeboekt").
      result = await call(updateOrder2, {
        id: "rec2", statut: "Sortie en livraison", skipStock: true
      }, [
        {
          fields: {
            Statut: "Prête",
            "Préparation validée": true,
            "Lignes (produits / quantités)": "Mosselen × 2 caisse",
            "Référence": "CMD-2",
            "Stock afgeboekt": false
          }
        },
        { records: [{ fields: {} }] },
        { fields: { Statut: "Sortie en livraison" } }
      ], { headers: cookieHdr });
      assert.equal(result.res.statusCode, 200, "Sortie zonder « Voorraad afboeken » doit réussir");
      assert.equal(result.calls.filter(c => /Stock/.test(c.url)).length, 0, "config uit → jamais de stock touché, même sans skipStock");

      result = await call(updateOrder2, {
        id: "rec2", lignes: "Mosselen × 5 caisse", total: 50
      }, [
        {
          fields: {
            Statut: "Sortie en livraison",
            "Stock afgeboekt": false,
            "Préparation validée": true,
            "Lignes (produits / quantités)": "Mosselen × 2 caisse"
          }
        }
      ], { headers: cookieHdr });
      assert.equal(result.res.statusCode, 409, "lignes après départ (skipStock) → 409 même sans Stock afgeboekt");
    }
  });

  test("E. Recipient requis pour deliveryConfirmed", async () => {
    let result;
    // --- E. Destinataire requis pour deliveryConfirmed ---
    {
      result = await call(updateOrder2, {
        id: "rec1", statut: "Facturée", deliveryConfirmed: true, recipient: "  "
      }, [
        { fields: { Statut: "Sortie en livraison", "Livraison confirmée": false } }
      ], { headers: cookieHdr });
      assert.equal(result.res.statusCode, 400);
      assert.match(result.res.payload.error, /ontvangen/);
    }
  });

  test("F. Double-prep / Sortie sans prep field si flag posé", async () => {
    let result;
    // --- F. Préparation déjà validée + Sortie sans champ prep → OK ---
    {
      result = await call(updateOrder2, {
        id: "rec1", statut: "Sortie en livraison"
      }, [
        {
          fields: {
            Statut: "Prête",
            "Préparation validée": true,
            "Lignes (produits / quantités)": "Zalm × 1 kg",
            "Référence": "CMD-2",
            "Stock afgeboekt": false
          }
        },
        { records: [{ fields: { "Voorraad afboeken": true } }] },
        { records: [{ id: "stk2", fields: { Produit: "Zalm", "Quantité disponible": 5 } }] },
        { records: [{ id: "stk2", fields: { "Quantité disponible": 4 } }] },
        { records: [] },
        { fields: { Statut: "Sortie en livraison", "Stock afgeboekt": true } }
      ], { headers: cookieHdr });
      assert.equal(result.res.statusCode, 200, "Sortie sans preparationValidee body OK si flag déjà true");
    }
  });

  test("AO. lib/levering (passé, > 60 j, dimanche, jour fermé, jour non livré, parsing, bloc public)", async () => {
    // --- AO. lib/levering.js : règles de livraison, une seule source (panier, saisie, corrections) ---
    {
      const R = lev.rulesFrom({});
      assert.deepEqual(R, { deadline: "22:00", dagen: [1, 2, 3, 4, 5, 6], gesloten: [], minimum: 0, betaaltermijn: 14, voorraadAfboeken: false, voorwaardenVersie: "", maxDagen: 60 }, "AO0 règles par défaut");
      assert.equal(lev.checkDate(okDayX, R), "", "AO1 prochain jour ouvrable accepté");
      assert.match(lev.checkDate(plusX(-1), R), /verleden/, "AO2 hier refusé");
      assert.match(lev.checkDate(plusX(61), R), /60 dagen/, "AO3 au-delà de 60 jours refusé");
      assert.ok(!/60 dagen/.test(lev.checkDate(plusX(60), R)), "AO3 le 60e jour est encore dans la fenêtre");
      assert.match(lev.checkDate(sundayX, R), /zondag/, "AO4 dimanche refusé par défaut");
      const closed = lev.rulesFrom({ "Gesloten dagen": "2026-12-25\n" + okDayX + ", 2027-01-01 ; 25/12" });
      assert.deepEqual(closed.gesloten, ["2026-12-25", okDayX, "2027-01-01"], "AO5 dates fermées lues ligne par ligne, forme libre ignorée");
      assert.match(lev.checkDate(okDayX, closed), /gesloten/, "AO5 jour fermé refusé");
      const weekOnly = lev.rulesFrom({ "Leverdagen": "ma, di, wo, do, vr" });
      assert.deepEqual(weekOnly.dagen, [1, 2, 3, 4, 5], "AO6 Leverdagen");
      assert.match(lev.checkDate(saturdayX, weekOnly), /Op die dag leveren we niet/, "AO6 samedi non livré");
      assert.match(lev.checkDate(sundayX, weekOnly), /zondag/, "AO6 le dimanche garde son message");
      for (const bad of ["2026-02-30", "2026-13-01", "demain", "", null]) assert.match(lev.checkDate(bad, R), /Ongeldige leverdag/, "AO7 forme invalide : " + bad);
      const parsed = lev.rulesFrom({ "Besteldeadline": " 9:30 ", "Leverdagen": "Maandag;woensdag zaterdag", "Minimum bestelling": "50", "Betaaltermijn dagen": 30.4, "Voorraad afboeken": true });
      assert.equal(parsed.deadline, "09:30", "AO8 deadline normalisée");
      assert.deepEqual(parsed.dagen, [1, 3, 6], "AO8 jours en toutes lettres");
      assert.equal(parsed.minimum, 50); assert.equal(parsed.betaaltermijn, 30); assert.equal(parsed.voorraadAfboeken, true);
      const junk = lev.rulesFrom({ "Besteldeadline": "25h", "Leverdagen": "xx", "Minimum bestelling": -3, "Betaaltermijn dagen": "abc", "Voorraad afboeken": "" });
      assert.deepEqual(junk, R, "AO8 valeurs illisibles → défauts, jamais d'exception");
      const pub = lev.publicRules(parsed);
      assert.deepEqual(pub, { deadline: "09:30", leverdagen: ["ma", "wo", "za"], geslotenDagen: [], minimum: 50, maxDagen: 60 }, "AO9 bloc public : forme figée, rien d'interne (betaaltermijn, voorraad)");
      assert.deepEqual(lev.publicRules(null), lev.publicRules(R), "AO9 publicRules sans argument = défauts");
      assert.deepEqual(await lev.loadRules(async () => { throw new Error("down"); }), R, "AO10 Airtable en panne → défauts");
      assert.deepEqual(await lev.loadRules(async () => ({ error: { message: "x" } })), R, "AO10 réponse en erreur → défauts");
      assert.equal((await lev.loadRules(async () => ({ records: [{ fields: { "Minimum bestelling": 25 } }] }))).minimum, 25, "AO10 règles lues");
    }
  });

  test("AU. Voorraad : regel verwijderen enkel beheerder ; historiek gefilterd (product, dagen ≤ 365, limiet 10..500)", async () => {
    // --- AU. api/stock.js : verwijderen enkel beheerder ; historiek gefilterd op product/dagen/limiet ---
    {
      clearModule("api/stock.js");
      const st = require(path.join(ROOT, "api", "stock.js"));
      let r = await call(st, { delete: true, id: "s1" }, [], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 403, "AU1 personeel verwijdert niet"); assert.match(r.res.payload.error, /beheerder/); assert.equal(r.calls.length, 0);
      r = await call(st, { delete: true, id: "s1" }, [{ id: "s1", fields: { Produit: "Oud" } }, { deleted: true, id: "s1" }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AU1 beheerder verwijdert"); assert.deepEqual(r.res.payload, { ok: true, deleted: "s1" });
      assert.match(r.calls[1].url, /Stock\/s1$/); assert.equal((r.calls[1].options.method || "").toUpperCase(), "DELETE");
      assert.equal(r.calls.filter(c => /Mouvements/.test(c.url)).length, 0, "AU1 geen beweging : niets verkocht, niets ontvangen");
      r = await call(st, { delete: true, id: "sX" }, [{ error: { type: "NOT_FOUND", message: "x" } }], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 404, "AU1 onbekend");
      r = await call(st, { delete: true }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AU1 id ontbreekt");
      const MOV = { records: [{ id: "mv1", fields: { Type: "Retour client", Produit: "Zalm", "Quantité": 1, "Stock avant": 8, "Stock après": 9, "Date et heure": "2026-09-25T10:00:00.000Z" } }] };
      r = await call(st, null, [MOV], { method: "GET", headers: cookieHdr, query: { history: "1", product: " Zalm ", days: "7", limit: "20" } });
      assert.equal(r.res.statusCode, 200, "AU2 historiek");
      assert.deepEqual(r.res.payload.movements, [{ id: "mv1", type: "Retour client", product: "Zalm", quantity: 1, before: 8, after: 9, note: "", at: "2026-09-25T10:00:00.000Z" }]);
      let u = decodeURIComponent(r.calls[0].url);
      assert.ok(u.includes("AND(IS_AFTER({Date et heure},DATEADD(NOW(),-7,'days')),{Produit}='Zalm')"), "AU2 filter op dagen én product");
      assert.ok(u.includes("maxRecords=20") && u.includes("sort[0][field]=Date et heure") && u.includes("sort[0][direction]=desc"), "AU2 limiet + nieuwste eerst");
      r = await call(st, null, [{ records: [] }], { method: "GET", headers: cookieHdr, query: { history: "1", days: "9999", limit: "5" } });
      u = decodeURIComponent(r.calls[0].url);
      assert.ok(u.includes("DATEADD(NOW(),-365,'days'))") && !u.includes("{Produit}"), "AU2 dagen begrensd op 365, zonder product geen productclausule"); assert.ok(u.includes("maxRecords=10"), "AU2 limiet minstens 10");
      r = await call(st, null, [{ records: [] }], { method: "GET", headers: cookieHdr, query: { history: "1", days: "0", limit: "99999", product: "L'x" } });
      u = decodeURIComponent(r.calls[0].url);
      assert.ok(u.includes("-30,'days'") && u.includes("maxRecords=500") && u.includes("{Produit}='L\\'x'"), "AU2 defaults 30 d / max 500 / aanhalingsteken ontsnapt");
      r = await call(st, null, [], { method: "GET", headers: {}, query: { history: "1" } }); assert.equal(r.res.statusCode, 401, "AU2 zonder sessie"); assert.equal(r.calls.length, 0);
    }
  });

  test("AV. Invoeren : gearchiveerde klanten weg ; leverdag gecontroleerd met dezelfde regels ; regels meegegeven", async () => {
    // --- AV. api/staff.js : gearchiveerde klanten weg uit Invoeren ; leverdag volgens de regels ---
    {
      clearModule("api/staff.js");
      const sf = require(path.join(ROOT, "api", "staff.js"));
      let r = await call(sf, null, [{ records: [{ id: "b", fields: { Nom: "Oud BV", Gearchiveerd: true } }, { id: "a", fields: { Nom: "Actief BV", Email: " x@y.be " } }] }], { method: "GET", headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AV1 klantenlijst"); assert.deepEqual(r.res.payload.clients, [{ id: "a", nom: "Actief BV", adresse: "", tel: "", email: "x@y.be" }], "AV1 gearchiveerde klant uitgesloten");
      const post = (date, extra) => Object.assign({ clientId: "a", dateLivraison: date, bron: "Telefoon", notes: "vóór 9u", items: [{ productId: "p", quantity: 2 }] }, extra || {});
      r = await call(sf, post(sundayX), [{ records: [{ fields: {} }] }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 400, "AV2 zondag"); assert.match(r.res.payload.error, /zondag/); assert.equal(r.calls.length, 1, "AV2 enkel Configuratie gelezen");
      r = await call(sf, post(okDayX), [{ records: [{ fields: { "Gesloten dagen": okDayX } }] }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 400, "AV2 gesloten dag"); assert.match(r.res.payload.error, /gesloten/);
      r = await call(sf, post(saturdayX), [{ records: [{ fields: { Leverdagen: "ma,di,wo,do,vr" } }] }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 400, "AV2 niet-leverdag"); assert.match(r.res.payload.error, /leveren we niet/);
      r = await call(sf, post(plusX(-1)), [{ records: [{ fields: {} }] }], { headers: cookieHdr }); assert.equal(r.res.statusCode, 400, "AV2 verleden");
      const CATV = { records: [{ id: "p", fields: { Produit: "Zalm", "Prix de base": 10, "Unité": "kg" } }] };
      r = await call(sf, post(okDayX), [{ records: [{ fields: {} }] }, CATV, { records: [] }, NO_ORDER_REFS, { records: [{ id: "oV" }] }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AV3 geldige leverdag");
      const cf = JSON.parse(r.calls[4].options.body).records[0].fields;
      assert.equal(cf["Date livraison souhaitée"], okDayX); assert.equal(cf.Notes, "[Telefoon] vóór 9u"); assert.equal(cf.Total, 20); assert.deepEqual(cf.Client, ["a"]);
      r = await call(sf, post(""), [CATV, { records: [] }, NO_ORDER_REFS, { records: [{ id: "oV" }] }], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "AV3 zonder leverdag : regels niet gelezen"); assert.equal(r.calls.filter(c => /Configuratie/.test(c.url)).length, 0);
      r = await call(sf, null, [CATV, { records: [] }, { records: [{ fields: { Leverdagen: "ma,wo", "Minimum bestelling": 25, "Betaaltermijn dagen": 30 } }] }], { method: "GET", headers: cookieHdr, query: { client: "a" } });
      assert.equal(r.res.statusCode, 200, "AV4 catalogus per klant");
      assert.deepEqual(r.res.payload.levering, { deadline: "22:00", leverdagen: ["ma", "wo"], geslotenDagen: [], minimum: 25, maxDagen: 60 }, "AV4 zelfde regels als het klantportaal, zonder betaaltermijn");
      assert.equal(r.res.payload.products[0].prix, 10);
    }
  });
});
