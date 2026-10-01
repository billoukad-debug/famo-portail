"use strict";
// Commandes : prix et quantités décidés par le serveur, minimum, leverdag.
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
const { ROOT, HP, json, mkRes, clearModule, call, NO_ORDER_REFS, methodCallsX } = h;
const { todayX, dowX, okDayX, sundayX, saturdayX } = h.datesX();
const updateOrder = require(path.join(ROOT, "api", "updateorder.js"));
const updateOrder2 = require(path.join(ROOT, "api", "updateorder.js"));
const createOrder = require(path.join(ROOT, "api", "order.js"));
const session = require(path.join(ROOT, "api", "session.js"));

describe("Commandes : prix et quantités décidés par le serveur, minimum, leverdag", () => {
  // Cookies staff et beheerder ouverts avec les codes d'environnement de test.
  let cookieHdr, adminCookieHdr;
  before(async () => { ({ cookieHdr, adminCookieHdr } = await h.staffCookies()); });

  test("Règles métier commande, préparation et livraison", async () => {
    // Cookie staff pour tous les appels API protégés (plus de body.code / query.code).
    let sres = mkRes();
    await session({ method: "POST", body: { code: process.env.STAFF_CODE }, headers: {} }, sres);
    assert.equal(sres.statusCode, 200, "login session initial doit reussir");
    const tok0 = decodeURIComponent(/famo_sess=([^;]+)/.exec(sres.headers["Set-Cookie"])[1]);
    const staffHdr = { cookie: "famo_sess=" + encodeURIComponent(tok0) };

    let result = await call(updateOrder, { id: "rec1", statut: "Sortie en livraison" }, [
      { fields: { Statut: "Prête", "Préparation validée": false } }
    ], { headers: staffHdr });
    assert.equal(result.res.statusCode, 409);
    assert.match(result.res.payload.error, /Valideer eerst/);

    result = await call(updateOrder, { id: "rec1", statut: "Facturée" }, [
      { fields: { Statut: "Sortie en livraison" } }
    ], { headers: staffHdr });
    assert.equal(result.res.statusCode, 409);
    assert.match(result.res.payload.error, /Bevestig eerst/);

    result = await call(updateOrder, { id: "rec1", preparationValidee: true }, [
      { fields: { Statut: "Reçue" } },
      { fields: { "Préparation validée": true } }
    ], { headers: staffHdr });
    assert.equal(result.res.statusCode, 200);
    const preparationPatch = JSON.parse(result.calls[1].options.body);
    assert.equal(preparationPatch.fields["Préparation validée"], true);

    result = await call(updateOrder, {
      id: "rec1", lignes: "Mosselen × 0.5 caisse", total: 6
    }, [
      { fields: { Statut: "Reçue" } },
      { records: [{ fields: { "Produit": "Mosselen", "Unité": "caisse" } }] }
    ], { headers: staffHdr });
    assert.equal(result.res.statusCode, 400);
    assert.match(result.res.payload.error, /decimale hoeveelheid/);

    result = await call(createOrder, {
      user: "test", pw: "pass", total: 0,
      items: [{ productId: "prod1", quantity: 2, price: 0 }]
    }, [
      { records: [{ id: "client1", fields: { "Wachtwoord": HP("pass") } }] },
      { records: [] },
      { records: [{ id: "prod1", fields: { "Produit": "Zalm", "Prix de base": 12.5, "Unité": "kg" } }] },
      { records: [] },
      NO_ORDER_REFS,
      { records: [{ id: "order1" }] }
    ]);
    assert.equal(result.res.statusCode, 200);
    assert.equal(result.res.payload.total, 25);
    const created = JSON.parse(result.calls[5].options.body).records[0].fields;
    assert.equal(created.Total, 25);
    assert.match(created["Lignes (produits / quantités)"], /\[€12\.50\]/);

    result = await call(createOrder, {
      user: "test", pw: "pass",
      items: [{ productId: "prod1", quantity: 0.5 }]
    }, [
      { records: [{ id: "client1", fields: { "Wachtwoord": HP("pass") } }] },
      { records: [] },
      { records: [{ id: "prod1", fields: { "Produit": "Mosselen", "Prix de base": 12.5, "Unité": "caisse" } }] },
      { records: [] }
    ]);
    assert.equal(result.res.statusCode, 400);
    assert.match(result.res.payload.error, /decimale hoeveelheid/);
  });

  test("Regles release candidate (validation explicite, 405 GET, 410 cadrage)", async () => {
    let result;
    // Même cookie staff que le bloc initial (staffHdr) : session ouverte avec STAFF_CODE.
    const staffHdr = cookieHdr;
    // --- Nouvelles regles de la release candidate ---
    // 1. Passage a Klaar SANS validation explicite -> 409
    result = await call(updateOrder, { id: "rec1", statut: "Prête" }, [
      { id: "rec1", fields: { "Statut": "Reçue" } }
    ], { headers: staffHdr });
    assert.equal(result.res.statusCode, 409, "Klaar sans validation doit etre refuse");

    // 2. Mot de passe en GET -> 405
    const catalogue = require(path.join(ROOT, "api", "catalogue.js"));
    {
      const res = mkRes();
      await catalogue({ method: "GET", query: { user: "x", pw: "y" } }, res);
      assert.equal(res.statusCode, 405, "GET avec mot de passe doit etre refuse");
    }

    // 3. cadrage definitivement ferme -> 410
    const cadrage = require(path.join(ROOT, "api", "cadrage.js"));
    {
      const res = mkRes();
      await cadrage({ method: "POST", body: {} }, res);
      assert.equal(res.statusCode, 410, "cadrage doit renvoyer 410");
    }
  });

  test("C2. Total recalculé serveur, jamais celui du navigateur", async () => {
    let result;
    // --- C2. Modifier les lignes recalcule le total côté serveur, jamais celui envoyé ---
    {
      result = await call(updateOrder2, {
        id: "rec3", lignes: "Mosselen × 2 caisse", total: 9999
      }, [
        { fields: { Statut: "Prête", "Préparation validée": true } },
        { records: [{ id: "cat1", fields: { Produit: "Mosselen", "Unité": "caisse", "Prix de base": 28 } }] },
        { records: [] },
        { fields: { ok: true } }
      ], { headers: cookieHdr });
      assert.equal(result.res.statusCode, 200, "modifier les lignes doit réussir");
      const patchCall = result.calls.find(c => /Commandes\//.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH");
      const patchedTotal = JSON.parse(patchCall.options.body).fields["Total"];
      assert.equal(patchedTotal, 56, "le total est recalculé depuis le catalogue (2 × 28), jamais celui envoyé (9999)");
    }
  });

  test("G. XSS / qty malveillante rejetée + documents.esc", async () => {
    let result;
    // --- G. Lignes malveillantes / qty invalide rejetées ---
    {
      result = await call(updateOrder2, {
        id: "rec1",
        lignes: '<img src=x onerror=alert(1)> × -3 caisse'
      }, [
        { fields: { Statut: "Reçue", "Stock afgeboekt": false } },
        { records: [{ fields: { Produit: "<img src=x onerror=alert(1)>", Unité: "caisse" } }] }
      ], { headers: cookieHdr });
      assert.equal(result.res.statusCode, 400, "qty négative / ligne XSS doit être refusée");
      assert.match(result.res.payload.error, /hoeveelheid|Catalogus|gevonden|decimale/i);

      // documents esc path
      const docsSrc = fs.readFileSync(path.join(ROOT, "assets/docs/documents.js"), "utf8");
      const sandbox = { window: {}, console };
      vm.runInNewContext(docsSrc, sandbox);
      assert.equal(typeof sandbox.window.FamoDocuments.esc, "function");
      assert.equal(sandbox.window.FamoDocuments.esc('<img src=x onerror="x">'), "&lt;img src=x onerror=&quot;x&quot;>");
      assert.ok(!/<[a-z]/i.test(sandbox.window.FamoDocuments.esc("<b>x</b>")));
    }
  });

  test("P. Prix négocié (vide → prix de base, 0 saisi → 0, catalogue = commande = staff = recalcul)", async () => {
    // --- P. Prix négocié : vide → prix de base, 0 saisi → 0, identique partout ----
    {
      const pricesLib = require(path.join(ROOT, "lib", "prices.js"));

      // P1 — la règle elle-même.
      [undefined, null, "", "  ", "abc", -1].forEach(v => {
        assert.strictEqual(pricesLib.negotiatedValue(v), null, "P1 aucun prix négocié pour : " + JSON.stringify(v));
      });
      assert.strictEqual(pricesLib.negotiatedValue(0), 0, "P1 0 saisi reste 0");
      assert.strictEqual(pricesLib.negotiatedValue("0"), 0, "P1 \"0\" saisi reste 0");
      assert.strictEqual(pricesLib.negotiatedValue(9.5), 9.5, "P1 prix saisi");

      const CLIENT_P = { records: [{ id: "clientPrix", fields: { "Nom": "Resto Prijs", "Wachtwoord": HP("pass") } }] };
      const CAT_P = { records: [
        { id: "pZero", fields: { "Produit": "Zalm", "Unité": "kg", "Prix de base": 12.5 } },
        { id: "pVide", fields: { "Produit": "Mosselen", "Unité": "caisse", "Prix de base": 28 } },
        { id: "pSans", fields: { "Produit": "Kabeljauw", "Unité": "kg", "Prix de base": 20 } }
      ] };
      // Zalm : 0 saisi · Mosselen : ligne au prix vide (champ absent de l'API) · Kabeljauw : accord d'un autre client seulement
      const NEG_P = { records: [
        { id: "neg0", fields: { "Client": ["clientPrix"], "Produit": ["pZero"], "Prix négocié": 0 } },
        { id: "negVide", fields: { "Client": ["clientPrix"], "Produit": ["pVide"] } },
        { id: "negAutre", fields: { "Client": ["autreKlant"], "Produit": ["pSans"], "Prix négocié": 1 } }
      ] };
      const EXPECTED = { Zalm: 0, Mosselen: 28, Kabeljauw: 20 };
      const EXPECTED_TOTAL = 48; // 2 × 0 + 1 × 28 + 1 × 20
      const ITEMS = [{ productId: "pZero", quantity: 2 }, { productId: "pVide", quantity: 1 }, { productId: "pSans", quantity: 1 }];
      const linePrices = lignes => Object.fromEntries(String(lignes).split("\n").map(l => [l.split(" × ")[0], Number(/\[€([\d.]+)\]/.exec(l)[1])]));
      const shownPrices = products => Object.fromEntries(products.map(p => [p.nom, p.prix]));

      // P2 — ce que le client voit au catalogue.
      const catalogueP = require(path.join(ROOT, "api", "catalogue.js"));
      let r = await call(catalogueP, { user: "prijs", pw: "pass" }, [CLIENT_P, CAT_P, NEG_P, { records: [] }, { records: [] }]);
      assert.equal(r.res.statusCode, 200, "P2 login catalogue");
      assert.deepEqual(shownPrices(r.res.payload.products), EXPECTED, "P2 catalogue : vide → base, 0 → 0");

      // P3 — ce qu'il paie en commandant : identique au catalogue, ligne par ligne.
      r = await call(createOrder, { user: "prijs", pw: "pass", items: ITEMS }, [CLIENT_P, { records: [] }, CAT_P, NEG_P, NO_ORDER_REFS, { records: [{ id: "orderPrix" }] }]);
      assert.equal(r.res.statusCode, 200, "P3 commande client");
      const orderFields = JSON.parse(r.calls[5].options.body).records[0].fields;
      assert.deepEqual(linePrices(orderFields["Lignes (produits / quantités)"]), EXPECTED, "P3 commande = catalogue");
      assert.equal(orderFields.Total, EXPECTED_TOTAL, "P3 total commande");

      // P4 — saisie staff (Invoeren) : même prix, à l'écran comme à l'enregistrement.
      const staffP = require(path.join(ROOT, "api", "staff.js"));
      r = await call(staffP, null, [CAT_P, NEG_P], { method: "GET", query: { client: "clientPrix" }, headers: adminCookieHdr });
      assert.deepEqual(shownPrices(r.res.payload.products), EXPECTED, "P4 catalogue de la saisie staff");
      r = await call(staffP, { clientId: "clientPrix", items: ITEMS }, [CAT_P, NEG_P, NO_ORDER_REFS, { records: [{ id: "orderStaff" }] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "P4 saisie staff");
      const staffFields = JSON.parse(r.calls[3].options.body).records[0].fields;
      assert.deepEqual(linePrices(staffFields["Lignes (produits / quantités)"]), EXPECTED, "P4 saisie staff = catalogue");
      assert.equal(staffFields.Total, EXPECTED_TOTAL, "P4 total saisie staff");

      // P5 — recalcul quand le personnel modifie les lignes.
      r = await call(updateOrder2, { id: "recPrix", lignes: "Zalm × 2 kg\nMosselen × 1 caisse\nKabeljauw × 1 kg", total: 9999 }, [
        { fields: { Statut: "Reçue", Client: ["clientPrix"] } },
        CAT_P, NEG_P,
        { fields: {} }
      ], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 200, "P5 modification des lignes");
      const patchP = r.calls.find(c => (c.options.method || "").toUpperCase() === "PATCH");
      assert.equal(JSON.parse(patchP.options.body).fields["Total"], EXPECTED_TOTAL, "P5 recalcul = catalogue");

      // P6 — Beheer (API) : un prix vide est enregistré vide, un 0 saisi est enregistré 0.
      const onboardingP = require(path.join(ROOT, "api", "onboarding.js"));
      const originalFetch = global.fetch;
      const written = [];
      global.fetch = async (url, options) => {
        const u = decodeURIComponent(String(url));
        const method = (options && options.method) || "GET";
        if (/Prix négociés/.test(u) && (method === "POST" || method === "PATCH")) {
          const b = JSON.parse(options.body);
          written.push(method === "POST" ? b.records[0].fields : b.fields);
        }
        return json(/Prix négociés/.test(u) ? NEG_P : { records: [] });
      };
      try {
        const save = async (prix, confirm) => {
          const res = mkRes();
          await onboardingP({ method: "POST", body: { action: "savePrice", clientId: "clientPrix", productId: "pNieuw", prix, confirm }, headers: adminCookieHdr }, res);
          return res;
        };
        assert.equal((await save("")).statusCode, 200, "P6 champ vide accepté");
        assert.strictEqual(written.pop()["Prix négocié"], null, "P6 champ vide enregistré vide, pas 0");
        assert.equal((await save(null)).statusCode, 200, "P6 prix null accepté");
        assert.strictEqual(written.pop()["Prix négocié"], null, "P6 prix null enregistré vide");
        // Prix 0 : garde-fou (L-04) → confirmation explicite demandée, rien d'écrit ; accepté une fois confirmé.
        const z = await save(0); assert.equal(z.statusCode, 409, "P6 0 à confirmer"); assert.equal(z.payload.needConfirm, true); assert.equal(written.length, 0, "P6 rien écrit avant confirmation");
        assert.equal((await save(0, true)).statusCode, 200, "P6 0 accepté après confirmation");
        assert.strictEqual(written.pop()["Prix négocié"], 0, "P6 0 saisi enregistré 0");
        assert.equal((await save("abc")).statusCode, 400, "P6 prix illisible refusé");
        assert.equal((await save(-2)).statusCode, 400, "P6 prix négatif refusé");
        assert.equal(written.length, 0, "P6 rien enregistré sur refus");

        // La liste de Beheer distingue « vide » (null) de 0.
        const g = mkRes();
        await onboardingP({ method: "GET", headers: adminCookieHdr, query: {} }, g);
        const listed = Object.fromEntries(g.payload.prices.map(p => [p.productId, p.prix]));
        assert.strictEqual(listed.pVide, null, "P6 ligne vide listée vide");
        assert.strictEqual(listed.pZero, 0, "P6 ligne à 0 listée 0");
      } finally {
        global.fetch = originalFetch;
      }

      // P7 — Beheer v2 : les valeurs sont envoyées sans coercition numérique ;
      // l'API applique ensuite negotiatedValue (vide → null, 0 conservé).
      const beheerSrc = fs.readFileSync(path.join(ROOT, "assets", "pages", "beheer.js"), "utf8");
      const onboardingSrc = fs.readFileSync(path.join(ROOT, "lib", "beheer", "prijzen.js"), "utf8"); // actions Beheer découpées (I-10)
      assert.match(beheerSrc, /action:\s*"saveClientPrices"[\s\S]*?prix:\s*K\.numIn\(prix\)/, "P7 valeurs de prix envoyées par Beheer v2 (K.numIn : vide reste vide, texte illisible transmis tel quel)");
      assert.match(onboardingSrc, /action\s*===\s*"saveClientPrices"[\s\S]*?negotiatedValue\(raw\)/, "P7 conversion vide → null et 0 conservé côté API");
    }
  });

  test("AM. Leverdag vrij (serveur + panier) et wachtwoord au choix dans Beheer", async () => {
    // --- AM. Leverdag vrij gekozen : formaat, verleden, zondag, 60 dagen ; front = zelfde regels ---
    {
      delete require.cache[require.resolve(path.join(ROOT, "api", "order.js"))];
      const chk = require(path.join(ROOT, "api", "order.js")).checkDeliveryDate;
      assert.equal(typeof chk, "function", "AM0 api/order.js exporte checkDeliveryDate");
      const todayAM = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const plusAM = n => { const d = new Date(todayAM + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
      let okDay = plusAM(1); while (new Date(okDay + "T12:00:00Z").getUTCDay() === 0) okDay = plusAM(2);
      assert.equal(chk(okDay), "", "AM1 morgen (ou lundi) accepté");
      if (new Date(todayAM + "T12:00:00Z").getUTCDay() !== 0) assert.equal(chk(todayAM), "", "AM1 aujourd'hui accepté côté serveur (la coupure 22:00 est côté client)");
      else assert.match(chk(todayAM), /zondag/, "AM1 aujourd'hui = dimanche → refusé");
      assert.match(chk(plusAM(-1)), /verleden/, "AM2 hier refusé");
      assert.match(chk("2026-13-45"), /Ongeldig/, "AM2 date impossible refusée");
      assert.match(chk("2026-02-30"), /Ongeldig/, "AM2 30 février refusé");
      assert.match(chk("demain"), /Ongeldig/, "AM2 texte refusé");
      let sun = plusAM(1); while (new Date(sun + "T12:00:00Z").getUTCDay() !== 0) sun = new Date(sun + "T12:00:00Z").toISOString().slice(0, 10) && (() => { const d = new Date(sun + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
      assert.match(chk(sun), /zondag/, "AM3 dimanche refusé");
      assert.match(chk(plusAM(61)), /60 dagen/, "AM4 au-delà de 60 jours refusé");
      const orderSrc = fs.readFileSync(path.join(ROOT, "api", "order.js"), "utf8");
      assert.ok(orderSrc.indexOf("checkDeliveryDate(dateLivraison)") < orderSrc.indexOf('rateLimited("order:"'), "AM4 la date est contrôlée avant le compteur anti-abus et Airtable");
      const klantSrc = fs.readFileSync(path.join(ROOT, "assets", "pages", "klant.js"), "utf8");
      assert.match(klantSrc, /type="date" class="input" id="otherDay"/, "AM5 le panier propose un champ date libre");
      assert.match(klantSrc, /CUTOFF_HOUR = 22/, "AM5 coupure 22:00 côté client");
      assert.match(klantSrc, /Op zondag leveren we niet/, "AM5 message zondag côté client");
      const beheerSrc = fs.readFileSync(path.join(ROOT, "assets", "pages", "beheer.js"), "utf8");
      assert.match(beheerSrc, /action: "resetPassword", id: cl\.id, password/, "AM6 Beheer peut choisir le mot de passe client");
    }
  });

  test("AP. Commande client : minimum (Configuratie), jour fermé / non livré / dimanche refusés avant écriture", async () => {
    // --- AP. api/order.js : minimum de commande et jours refusés, avant toute écriture ---
    {
      clearModule("api/order.js");
      const co = require(path.join(ROOT, "api", "order.js"));
      const CLI = { records: [{ id: "cliAP", fields: { Wachtwoord: HP("pass"), Nom: "Resto AP" } }] };
      const CAT = { records: [{ id: "pAP", fields: { Produit: "Zalm", "Prix de base": 12.5, "Unité": "kg" } }] };
      const CFG = f => ({ records: [{ id: "cfg", fields: f }] });
      const order = (qty, extra) => Object.assign({ user: "ap", pw: "pass", items: [{ productId: "pAP", quantity: qty }] }, extra || {});
      let r = await call(co, order(2), [CLI, CFG({ "Minimum bestelling": 50 }), CAT, { records: [] }]);
      assert.equal(r.res.statusCode, 400, "AP1 sous le minimum → 400");
      assert.equal(r.res.payload.error, "Minimum bestelling: € 50,00 excl. btw (nu € 25,00)", "AP1 message NL avec les deux montants");
      assert.equal(methodCallsX(r, "POST").length, 0, "AP1 rien n'est enregistré");
      r = await call(co, order(4), [CLI, CFG({ "Minimum bestelling": 50 }), CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "oAP" }] }]);
      assert.equal(r.res.statusCode, 200, "AP2 exactement le minimum passe"); assert.equal(r.res.payload.total, 50);
      r = await call(co, order(1), [CLI, CFG({}), CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "oAP" }] }]);
      assert.equal(r.res.statusCode, 200, "AP2 sans minimum configuré, tout passe");
      r = await call(co, order(4, { dateLivraison: okDayX }), [CLI, CFG({ "Gesloten dagen": okDayX })]);
      assert.equal(r.res.statusCode, 400, "AP3 jour fermé"); assert.match(r.res.payload.error, /gesloten/); assert.equal(r.calls.length, 2, "AP3 refusé dès la configuration, catalogue jamais lu");
      r = await call(co, order(4, { dateLivraison: saturdayX }), [CLI, CFG({ Leverdagen: "ma,di,wo,do,vr" })]);
      assert.equal(r.res.statusCode, 400, "AP3 samedi non livré"); assert.match(r.res.payload.error, /leveren we niet/);
      r = await call(co, order(4, { dateLivraison: sundayX }), [CLI]);
      assert.equal(r.res.statusCode, 400, "AP4 dimanche"); assert.match(r.res.payload.error, /zondag/); assert.equal(r.calls.length, 1, "AP4 contrôle de forme avant la configuration");
      if (dowX(todayX) !== 0) {
        r = await call(co, order(4, { dateLivraison: todayX }), [CLI, CFG({})]);
        assert.equal(r.res.statusCode, 400, "AP5 commande client pour aujourd'hui refusée par le serveur");
        assert.match(r.res.payload.error, /vandaag/); assert.equal(r.calls.length, 2, "AP5 refusé avant toute écriture");
      }
      // AP6 — heure limite (Bruxelles) avec 15 min de tolérance, testée à heure fixe.
      {
        const lev = require(path.join(ROOT, "lib", "levering"));
        const rules = lev.rulesFrom({ Besteldeadline: "22:00" });
        const today = lev.brusselsToday();
        const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); const tomorrow = d.toISOString().slice(0, 10);
        d.setUTCDate(d.getUTCDate() + 1); const after = d.toISOString().slice(0, 10);
        // Heures « Bruxelles » : 21:59 et 22:10 passent, 22:16 refuse (UTC+1/+2 selon la saison).
        const at = hhmm => { const [h, m] = hhmm.split(":").map(Number); for (let off = 0; off < 3; off++) { const t = new Date(today + "T00:00:00Z"); t.setUTCMinutes(h * 60 + m - off * 60); const s2 = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t); if (s2 === hhmm) return t; } return null; };
        assert.equal(lev.checkCutoff(tomorrow, rules, at("21:59")), "", "AP6 21:59 → morgen OK");
        assert.equal(lev.checkCutoff(tomorrow, rules, at("22:10")), "", "AP6 22:10 → tolérance");
        assert.match(lev.checkCutoff(tomorrow, rules, at("22:16")), /Na 22:00/, "AP6 22:16 → morgen refusé");
        assert.equal(lev.checkCutoff(after, rules, at("23:30")), "", "AP6 overmorgen toujours OK");
        assert.match(lev.checkCutoff(today, rules, at("08:00")), /vandaag/, "AP6 aujourd'hui toujours refusé");
      }
    }
  });
});
