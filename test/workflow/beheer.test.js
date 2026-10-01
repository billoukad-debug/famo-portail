"use strict";
// Beheer : admin seul, configuration, produits, clients, medewerkers, ordre du catalogue.
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
const { ROOT, mkRes, clearModule, call, patchOfX, methodCallsX } = h;
const authlib = require(path.join(ROOT, "lib", "staffauth.js"));

describe("Beheer : admin seul, configuration, produits, clients, medewerkers, ordre du catalogue", () => {
  // Cookies staff et beheerder ouverts avec les codes d'environnement de test.
  let cookieHdr, adminCookieHdr;
  before(async () => { ({ cookieHdr, adminCookieHdr } = await h.staffCookies()); });

  test("L. Onboarding admin-only + credentials + validation config", async () => {
    // --- L. Onboarding API : admin-only, preview credentials + validation saveConfig ---
    {
      const onboarding = require(path.join(ROOT, "api", "onboarding.js"));
      const originalFetch = global.fetch;
      global.fetch = async () => ({ json: async () => ({ records: [] }) });
      try {
        const rStaff = mkRes();
        await onboarding({
          method: "POST",
          body: { action: "previewCredentials", nom: "Test Klant" },
          headers: cookieHdr
        }, rStaff);
        assert.equal(rStaff.statusCode, 401, "onboarding refuse un simple staff (non-admin)");

        const r = mkRes();
        await onboarding({
          method: "POST",
          body: { action: "previewCredentials", nom: "Test Klant" },
          headers: adminCookieHdr
        }, r);
        assert.equal(r.statusCode, 200, "previewCredentials (admin)");
        assert.ok(r.payload.user && r.payload.password, "user+password generes");
        assert.ok(r.payload.password.length >= 6);

        const rBad = mkRes();
        await onboarding({
          method: "POST",
          body: { action: "saveConfig", bedrijfsnaam: "", btw: "" },
          headers: adminCookieHdr
        }, rBad);
        assert.equal(rBad.statusCode, 400, "saveConfig incomplet refuse");
      } finally {
        global.fetch = originalFetch;
      }
    }
  });

  test("AT. Beheer : saveConfig-validatie (IBAN/BIC/BTW/deadline/gesloten/minimum/termijn), product uniek + btw, archiveren, medewerkers, klant", async () => {
    // --- AT. api/onboarding.js : saveConfig-validatie, duplicaat product, archiveren, medewerkers, klant ---
    {
      clearModule("api/onboarding.js");
      const ob = require(path.join(ROOT, "api", "onboarding.js"));
      const CFGREC = { records: [{ id: "cfg1", fields: { Bedrijfsnaam: "Famo" } }] };
      // statusPayload : Configuratie puis Catalogue, Clients, Prix négociés, Stock, Commandes, Aanvragen, Medewerkers.
      const STATUS = () => [CFGREC, { records: [] }, { records: [] }, { records: [] }, { records: [] }, { records: [] }, { records: [] }, { records: [] }];
      const BASE_CFG = { action: "saveConfig", bedrijfsnaam: "FAMO Seafood", btw: "BE 0788.705.713", iban: "BE68539007547034", bic: "GKCCBEBB" };
      const bad = async (extra, re, label) => {
        const r = await call(ob, Object.assign({}, BASE_CFG, extra), [], { headers: adminCookieHdr });
        assert.equal(r.res.statusCode, 400, label); assert.match(r.res.payload.error, re, label); assert.equal(r.calls.length, 0, label + " : niets gelezen, niets geschreven");
      };
      await bad({ iban: "BE68 5390 0754 7035" }, /IBAN/, "AT1 IBAN controlecijfers");
      await bad({ bic: "GKCC" }, /BIC/, "AT1 BIC te kort");
      await bad({ bic: "GKC1BEBB" }, /BIC/, "AT1 BIC bankcode enkel letters");
      await bad({ bic: "GKCCBEBBX" }, /BIC/, "AT1 BIC 8 of 11 tekens");
      await bad({ btw: "BE 0788.705.714" }, /BTW-nummer/, "AT1 BTW controlecijfers");
      await bad({ besteldeadline: "25:00" }, /Besteldeadline/, "AT1 deadline uur");
      await bad({ besteldeadline: "22h" }, /Besteldeadline/, "AT1 deadline vorm");
      await bad({ geslotenDagen: "25/12/2026" }, /Gesloten dagen/, "AT1 gesloten dag vorm");
      await bad({ minimumBestelling: "-5" }, /minimumbedrag/, "AT1 minimum negatief");
      await bad({ minimumBestelling: "abc" }, /minimumbedrag/, "AT1 minimum onleesbaar");
      await bad({ betaaltermijnDagen: 200 }, /Betaaltermijn/, "AT1 termijn > 120");
      await bad({ betaaltermijnDagen: 7.5 }, /Betaaltermijn/, "AT1 termijn geheel getal");
      await bad({ bestellingenEmail: "ops@" }, /e-mailadres/, "AT1 ops-mail");
      await bad({ bedrijfsnaam: "" }, /verplicht/, "AT1 naam verplicht");
      let r = await call(ob, Object.assign({}, BASE_CFG, { besteldeadline: "21:30", leverdagen: "MA, xx, wo;zo", geslotenDagen: "2027-01-01\n2026-12-25, 2026-12-25", minimumBestelling: "50,5", betaaltermijnDagen: "30", voorraadAfboeken: true, btwTarief: "21", iban: "be68 5390 0754 7034" }), [CFGREC, { fields: {} }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT2 saveConfig");
      let f = patchOfX(r, /Configuratie\/cfg1$/).fields;
      assert.equal(f.Besteldeadline, "21:30"); assert.equal(f.Leverdagen, "ma,wo,zo", "AT2 onbekende dagen stil genegeerd (checkboxes in de pagina), rest genormaliseerd");
      assert.equal(f["Gesloten dagen"], "2026-12-25\n2027-01-01", "AT2 gesorteerd, ontdubbeld, één per regel");
      assert.equal(f["Minimum bestelling"], 50.5, "AT2 komma-decimaal"); assert.equal(f["Betaaltermijn dagen"], 30); assert.equal(f["Voorraad afboeken"], true); assert.equal(f["BTW-tarief"], 21); assert.equal(f.IBAN, "BE68539007547034", "AT2 IBAN zonder spaties, hoofdletters");
      r = await call(ob, BASE_CFG, [CFGREC, { fields: {} }, ...STATUS()], { headers: adminCookieHdr });
      f = patchOfX(r, /Configuratie\/cfg1$/).fields;
      assert.equal(f["Voorraad afboeken"], false, "AT2 afwezig → uit"); assert.equal(f["Betaaltermijn dagen"], undefined, "AT2 termijn leeg → onaangeroerd"); assert.equal(f["Minimum bestelling"], 0); assert.equal(f.Leverdagen, ""); assert.equal(f["Gesloten dagen"], "");
      r = await call(ob, BASE_CFG, [{ records: [] }, { records: [{ id: "cfgNew" }] }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT2 zonder Configuratie-rij : aangemaakt"); assert.equal((r.calls[1].options.method || "").toUpperCase(), "POST");
      r = await call(ob, BASE_CFG, [], { headers: cookieHdr }); assert.equal(r.res.statusCode, 401, "AT2 personeel mag niet"); assert.equal(r.calls.length, 0);
      // Product : naam uniek (nieuw én bij hernoemen), btw per product, geen wijziging bij fout.
      const P1 = { id: "p1", fields: { Produit: "Mosselen", "Unité": "caisse", "Prix de base": 28 } }, P2 = { id: "p2", fields: { Produit: "Oesters", "Unité": "pièce", "Prix de base": 0.9 } };
      r = await call(ob, { action: "saveProduct", nom: " mosselen ", unite: "doos", base: 28 }, [{ records: [P1, P2] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AT3 nieuw product met bestaande naam"); assert.match(r.res.payload.error, /bestaat al/); assert.equal(r.calls.length, 1, "AT3 niets geschreven");
      r = await call(ob, { action: "saveProduct", id: "p2", nom: "MOSSELEN", unite: "stuk", base: 1 }, [P2, { records: [P1, P2] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AT3 hernoemen naar een bestaande naam"); assert.equal(methodCallsX(r, "PATCH").length, 0);
      r = await call(ob, { action: "saveProduct", id: "p1", nom: "Mosselen", unite: "doos", base: 29, btwTarief: 21 }, [P1, { records: [P1, P2] }, { id: "p1", fields: {} }, { records: [{ id: "s1", fields: { Produit: "Mosselen", "Quantité disponible": 4 } }] }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT3 eigen naam behouden mag");
      const pp = patchOfX(r, /Catalogue\/p1$/); assert.equal(pp.typecast, true); assert.equal(pp.fields["BTW-tarief"], 21); assert.equal(pp.fields["Unité"], "carton", "AT3 doos → carton"); assert.equal(pp.fields["Prix de base"], 29);
      assert.equal(r.calls.filter(c => /Stock\/|Mouvements/.test(c.url)).length, 0, "AT3 zonder hoeveelheid geen voorraadwijziging, geen beweging");
      r = await call(ob, { action: "saveProduct", nom: "Kreeft", unite: "kg", base: 40, btwTarief: "abc" }, [], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 400, "AT3 btw-tarief onleesbaar"); assert.match(r.res.payload.error, /btw-tarief/);
      r = await call(ob, { action: "saveProduct", id: "p1", nom: "Mosselen", unite: "doos", base: 28, btwTarief: "" }, [P1, { records: [P1] }, { id: "p1", fields: {} }, { records: [] }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(patchOfX(r, /Catalogue\/p1$/).fields["BTW-tarief"], null, "AT3 leeg → gewist (tarief van Configuratie)");
      // Archiveren / heractiveren : één vlag, fiche en historiek blijven.
      r = await call(ob, { action: "archiveClient", id: "c1" }, [{ id: "c1", fields: { Nom: "Nora" } }, { fields: {} }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT4 archiveren"); assert.deepEqual(patchOfX(r, /Clients\/c1$/).fields, { Gearchiveerd: true });
      assert.equal(methodCallsX(r, "DELETE").length, 0, "AT4 nooit verwijderd");
      r = await call(ob, { action: "unarchiveClient", id: "c1" }, [{ id: "c1", fields: { Nom: "Nora", Gearchiveerd: true } }, { fields: {} }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT4 heractiveren"); assert.deepEqual(patchOfX(r, /Clients\/c1$/).fields, { Gearchiveerd: false });
      r = await call(ob, { action: "archiveClient", id: "../x" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT4 id-vorm"); assert.equal(r.calls.length, 0);
      r = await call(ob, { action: "archiveClient", id: "cX" }, [{ error: { type: "NOT_FOUND", message: "x" } }], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 404, "AT4 onbekende klant");
      r = await call(ob, null, [CFGREC, { records: [] }, { records: [{ id: "c1", fields: { Nom: "Nora", Gearchiveerd: true, Gebruikersnaam: "nora", Wachtwoord: "x" } }, { id: "c2", fields: { Nom: "Aloha", Gebruikersnaam: "aloha", Wachtwoord: "y" } }] }, { records: [] }, { records: [] }, { records: [] }, { records: [] }, { records: [{ id: "m1", fields: { Naam: "Ilse", Rol: "personeel", Actief: true, "PIN hash": "scrypt$x$y" } }] }], { method: "GET", headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT4 Beheer-overzicht");
      assert.deepEqual(r.res.payload.clients.map(c => [c.nom, c.gearchiveerd]), [["Aloha", false], ["Nora", true]], "AT4 gearchiveerde klant blijft zichtbaar, gemarkeerd");
      assert.equal(r.res.payload.status.clients, 1, "AT4 telling zonder gearchiveerden"); assert.equal(r.res.payload.status.credentials, 1);
      assert.deepEqual(r.res.payload.medewerkers, [{ id: "m1", naam: "Ilse", rol: "personeel", actief: true, laatste: "" }], "AT4 medewerkers zonder hash");
      assert.ok(!JSON.stringify(r.res.payload).includes("scrypt$"), "AT4 de PIN-hash verlaat de server nooit");
      // Medewerkers : nieuwe PIN 6-12 cijfers, uniek, enkel gehasht opgeslagen ; verwijderen.
      r = await call(ob, { action: "saveMedewerker", naam: "Tom", pin: "12" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 PIN te kort"); assert.match(r.res.payload.error, /PIN/); assert.equal(r.calls.length, 0);
      r = await call(ob, { action: "saveMedewerker", naam: "Tom" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 nieuw zonder PIN");
      r = await call(ob, { action: "saveMedewerker", naam: "", pin: "1234" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 naam verplicht");
      r = await call(ob, { action: "saveMedewerker", naam: "Tom", pin: "4321" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 nieuwe PIN van 4 cijfers geweigerd (min. 6)");
      r = await call(ob, { action: "saveMedewerker", naam: "Tom", pin: "abcdef" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 enkel cijfers");
      r = await call(ob, { action: "saveMedewerker", naam: "Tom", pin: "432109" }, [{ records: [{ id: "m9", fields: { Naam: "Ilse", "PIN hash": authlib.hashCode("432109") } }] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AT5 PIN al in gebruik → 409"); assert.equal(methodCallsX(r, "POST").length, 0, "AT5 niets aangemaakt");
      r = await call(ob, { action: "saveMedewerker", naam: " Tom ", rol: "beheerder", pin: "432109" }, [{ records: [] }, { records: [{ id: "m1" }] }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT5 medewerker aangemaakt");
      const post = r.calls[1]; assert.match(post.url, /Medewerkers$/); assert.equal((post.options.method || "").toUpperCase(), "POST");
      const pb = JSON.parse(post.options.body); const mf = pb.records[0].fields;
      assert.equal(pb.typecast, true, "AT5 typecast (Rol-optie)"); assert.equal(mf.Naam, "Tom"); assert.equal(mf.Rol, "beheerder"); assert.equal(mf.Actief, true);
      assert.match(mf["PIN hash"], /^scrypt\$131072\$[0-9a-f]+\$[0-9a-f]+$/, "AT5 scrypt"); assert.ok(authlib.verifyHash(mf["PIN hash"], "432109"), "AT5 de hash opent met de PIN");
      assert.ok(!post.options.body.includes("432109"), "AT5 de PIN gaat nooit in klare tekst naar Airtable");
      // Désactiver / rétrograder / supprimer : Configuratie lue d'abord (option « Enkel persoonlijke PIN »,
      // garde « dernière beheerder », test/pinonly.test.js) ; ici l'option est absente.
      r = await call(ob, { action: "saveMedewerker", id: "m1", naam: "Tom", rol: "superuser", actief: false }, [{ records: [] }, { fields: {} }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT5 bijwerken zonder PIN"); assert.deepEqual(patchOfX(r, /Medewerkers\/m1$/).fields, { Naam: "Tom", Rol: "personeel", Actief: false }, "AT5 hash onaangeroerd, onbekende rol → personeel");
      r = await call(ob, { action: "saveMedewerker", id: "m1", naam: "Tom", pin: "12" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 nieuwe PIN te kort");
      r = await call(ob, { action: "deleteMedewerker", id: "m1" }, [{ records: [] }, { deleted: true, id: "m1" }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT5 verwijderd"); assert.match(r.calls[0].url, /Configuratie/); assert.match(r.calls[1].url, /Medewerkers\/m1$/); assert.equal((r.calls[1].options.method || "").toUpperCase(), "DELETE");
      r = await call(ob, { action: "deleteMedewerker", id: "m 1" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 id-vorm"); assert.equal(r.calls.length, 0);
      r = await call(ob, { action: "saveMedewerker", naam: "X", pin: "1234" }, [], { headers: cookieHdr }); assert.equal(r.res.statusCode, 401, "AT5 personeel beheert geen accounts");
      // Klant : gebruikersnaam zonder aanhalingstekens/spaties (formule-injectie), wachtwoord ≥ 8.
      r = await call(ob, { action: "saveClient", nom: "O'Reilly", user: " O'Rei\"lly ", password: "kort", generate: false }, [{ records: [] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 400, "AT6 wachtwoord < 8"); assert.match(r.res.payload.error, /8 tekens/);
      assert.ok(decodeURIComponent(r.calls[0].url).includes("LOWER({Gebruikersnaam})='oreilly'"), "AT6 gebruikersnaam gestript vóór de formule"); assert.equal(methodCallsX(r, "POST").length, 0);
      r = await call(ob, { action: "saveClient", nom: "O'Reilly", user: "O'Reilly", password: "geheim123", generate: false }, [{ records: [] }, { records: [{ id: "c9" }] }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AT6 klant aangemaakt");
      const cf = JSON.parse(r.calls[1].options.body).records[0].fields;
      assert.equal(cf.Gebruikersnaam, "oreilly"); assert.ok(require(path.join(ROOT, "lib/clientauth")).checkPassword(cf.Wachtwoord, "geheim123"), "wachtwoord gehasht opgeslagen"); assert.match(cf.Wachtwoord, /^scrypt\$/); assert.equal(cf.Nom, "O'Reilly"); assert.equal(cf.Gearchiveerd, undefined);
      assert.deepEqual(r.res.payload.credentials, { id: "c9", nom: "O'Reilly", user: "oreilly", password: "geheim123" });
      assert.equal(cf.Taal, "NL", "BA taal standaard NL");
      r = await call(ob, { action: "saveClient", nom: "Chez Paul", user: "chezpaul", password: "geheim123", generate: false, taal: "fr" }, [{ records: [] }, { records: [{ id: "c10" }] }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(JSON.parse(r.calls[1].options.body).records[0].fields.Taal, "FR", "BA klant in het Frans opgeslagen");
      r = await call(ob, { action: "saveClient", nom: "Rare", user: "rare1", password: "geheim123", generate: false, taal: "de" }, [{ records: [] }, { records: [{ id: "c11" }] }, ...STATUS()], { headers: adminCookieHdr });
      assert.equal(JSON.parse(r.calls[1].options.body).records[0].fields.Taal, "NL", "BA onbekende taal → NL");
      r = await call(ob, { action: "saveClient", nom: "Ander", user: "oreilly", password: "geheim123", generate: false }, [{ records: [{ id: "c9" }] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AT6 gebruikersnaam al in gebruik door een ander");
      r = await call(ob, { action: "saveClient", nom: "X", email: "nope", user: "xx", password: "geheim123", generate: false }, [{ records: [] }], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 400, "AT6 e-mail klant"); assert.match(r.res.payload.error, /e-mailadres/);
    }
  });

  test("AY. Volgorde catalogus : enkel beheerder, validatie, enkel wijzigingen, gedeelde sortering", async () => {
    // --- AY. Ordre du catalogue (glisser-déposer Beheer) : validation, seuls les changements écrits ---
    {
      const ob = require(path.join(ROOT, "api", "onboarding.js"));
      const EMPTY = Array.from({ length: 12 }, () => ({ records: [] }));
      let r = await call(ob, { action: "reorderProducts", order: ["recA", "recB"] }, [], { headers: cookieHdr });
      assert.equal(r.res.statusCode, 401, "AY1 personeel → geweigerd (enkel beheerder)");
      for (const bad of [[], ["recA", "recA"], ["../Clients/x"], "recA"]) {
        r = await call(ob, { action: "reorderProducts", order: bad }, [], { headers: adminCookieHdr });
        assert.equal(r.res.statusCode, 400, "AY2 ongeldige volgorde : " + JSON.stringify(bad)); assert.equal(r.calls.length, 0);
      }
      const CATY = { records: [{ id: "recA", fields: { Volgorde: 2 } }, { id: "recB", fields: { Volgorde: 1 } }, { id: "recC", fields: {} }] };
      r = await call(ob, { action: "reorderProducts", order: ["recA", "recD"] }, [CATY], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 409, "AY3 onbekend product (lijst intussen gewijzigd) → 409"); assert.equal(r.calls.length, 1, "AY3 niets geschreven");
      r = await call(ob, { action: "reorderProducts", order: ["recB", "recC", "recA"] }, [CATY, { records: [] }, ...EMPTY], { headers: adminCookieHdr });
      assert.equal(r.res.statusCode, 200, "AY4 volgorde bewaard"); assert.equal(r.res.payload.changed, 2, "AY4 enkel wat verandert");
      const pa = r.calls.filter(c => /\/Catalogue$/.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH");
      assert.equal(pa.length, 1, "AY4 één lot van ≤ 10");
      assert.deepEqual(JSON.parse(pa[0].options.body).records, [{ id: "recC", fields: { Volgorde: 2 } }, { id: "recA", fields: { Volgorde: 3 } }], "AY4 recB blijft 1, recC → 2, recA → 3");
      // tri partagé (front) : Volgorde puis nom, catégorie selon son plus petit numéro
      const ctx = { window: {}, document: { documentElement: { lang: "nl" }, addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem() { return null; }, setItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, navigator: { language: "nl" }, location: { search: "", pathname: "/", hash: "" } };
      ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8"), ctx);
      const KK = ctx.K;
      const ps = [{ nom: "Zalm", volgorde: null, cat: "Vis" }, { nom: "Kreeft", volgorde: 2, cat: "Schaal" }, { nom: "Mossel", volgorde: 1, cat: "Schelp" }, { nom: "Aal", volgorde: null, cat: "Vis" }];
      assert.deepEqual(ps.slice().sort(KK.byVolgorde).map(p => p.nom), ["Mossel", "Kreeft", "Aal", "Zalm"], "AY5 volgorde, daarna alfabetisch");
      assert.deepEqual(["Vis", "Schaal", "Schelp"].sort(KK.catOrder(ps, p => p.cat)), ["Schelp", "Schaal", "Vis"], "AY5 categorie volgens kleinste volgorde");
    }
  });
});
