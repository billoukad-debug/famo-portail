"use strict";
// Sessions et rôles : cookie, fail-closed, codes, PIN personnels.
// Scénarios métier découpés de l'ancien scripts/workflow-check.js (audit F-10,
// specs/011-workflow-check-decoupe) : code et messages d'assertion repris tels quels, un test par
// ancien bloc « ✓ ». Fichier autonome : son propre processus, son environnement, ses réponses simulées.
const h = require("./_helpers"); // en premier : environnement de test, réseau réel interdit
h.isolate(__filename);
const { describe, test, before } = require("node:test");
const assert = require("assert");
const path = require("path");
const { ROOT, json, mkRes, clearModule, call, patchOfX, methodCallsX } = h;
const updateOrder = require(path.join(ROOT, "api", "updateorder.js"));
const session = require(path.join(ROOT, "api", "session.js"));
const authlib = require(path.join(ROOT, "lib", "staffauth.js"));

describe("Sessions et rôles : cookie, fail-closed, codes, PIN personnels", () => {
  // Cookies staff et beheerder ouverts avec les codes d'environnement de test.
  let cookieHdr, adminCookieHdr;
  before(async () => { ({ cookieHdr, adminCookieHdr } = await h.staffCookies()); });

  test("Session staff commune (cookie HttpOnly, expiration, logout, cookie-only APIs)", async () => {
    let sres;
    // --- Session staff commune ---
    // login correct -> cookie HttpOnly Secure SameSite
    sres = mkRes();
    await session({ method: "POST", body: { code: process.env.STAFF_CODE }, headers: {} }, sres);
    assert.equal(sres.statusCode, 200, "login session doit reussir");
    const setC = sres.headers["Set-Cookie"] || "";
    assert(/famo_sess=/.test(setC) && /HttpOnly/.test(setC) && /Secure/.test(setC) && /SameSite=Lax/.test(setC), "cookie session incomplet");
    const tok = decodeURIComponent(/famo_sess=([^;]+)/.exec(setC)[1]);

    // J. mauvais code / ancien code public -> 401
    sres = mkRes(); await session({ method: "POST", body: { code: "famo2026" }, headers: {} }, sres);
    assert.equal(sres.statusCode, 401, "ancien code public doit etre refuse");

    // GET avec cookie -> 200 ; sans -> 401
    sres = mkRes(); await session({ method: "GET", headers: { cookie: "famo_sess=" + encodeURIComponent(tok) } }, sres);
    assert.equal(sres.statusCode, 200, "session valide doit etre reconnue (nouvel onglet)");
    sres = mkRes(); await session({ method: "GET", headers: {} }, sres);
    assert.equal(sres.statusCode, 401, "sans session -> 401");

    // token expire -> 401. Le jeton est bien signé et porte un rôle valable : seule
    // l'échéance le rend invalide (un jeton sans rôle serait refusé pour une autre raison
    // et le test passerait même si le contrôle d'expiration disparaissait).
    const notExpired = authlib.sign(Date.now() + 100000, "staff");
    sres = mkRes(); await session({ method: "GET", headers: { cookie: "famo_sess=" + encodeURIComponent(notExpired) } }, sres);
    assert.equal(sres.statusCode, 200, "jeton signe non expire (temoin) doit etre accepte");
    const expired = authlib.sign(Date.now() - 1000, "staff");
    sres = mkRes(); await session({ method: "GET", headers: { cookie: "famo_sess=" + encodeURIComponent(expired) } }, sres);
    assert.equal(sres.statusCode, 401, "session expiree doit etre refusee");
    assert.equal(authlib.verify(authlib.sign(Date.now() - 1000, "admin")), null, "jeton admin expire refuse");

    // token falsifie -> 401
    sres = mkRes(); await session({ method: "GET", headers: { cookie: "famo_sess=" + encodeURIComponent(tok.split(".")[0] + ".AAAA") } }, sres);
    assert.equal(sres.statusCode, 401, "signature falsifiee refusee");

    // une API staff accepte le cookie SANS code dans l'URL
    {
      const res2 = mkRes();
      await updateOrder({ method: "POST", body: { id: "rec1" }, headers: { cookie: "famo_sess=" + encodeURIComponent(tok) } }, res2);
      assert.notEqual(res2.statusCode, 401, "cookie doit suffire pour les API staff");
    }
  });

  test("A. Fail-closed sans code configuré + rôles STAFF_CODE/ADMIN_CODE distincts", async () => {
    // --- A. Fail-closed : sans aucun code configuré, auth staff impossible ---
    {
      const savedStaff = process.env.STAFF_CODE;
      const savedAdmin = process.env.ADMIN_CODE;
      delete process.env.STAFF_CODE;
      delete process.env.ADMIN_CODE;
      clearModule("lib/staffauth.js");
      clearModule("api/session.js");
      clearModule("api/allorders.js");
      const sessionFb = require(path.join(ROOT, "api", "session.js"));
      const authFb = require(path.join(ROOT, "lib", "staffauth.js"));
      const allordersFb = require(path.join(ROOT, "api", "allorders.js"));
      assert.equal(authFb.hasCode(), false, "sans STAFF_CODE ni ADMIN_CODE → hasCode false");
      const r500 = mkRes();
      await sessionFb({ method: "POST", body: { code: "famo2026" }, headers: {} }, r500);
      assert.equal(r500.statusCode, 500, "login sans aucun code doit échouer fermé (500)");
      const rAll = mkRes();
      await allordersFb({ method: "GET", query: { code: "famo2026" }, headers: {} }, rAll);
      assert.equal(rAll.statusCode, 500, "API staff sans aucun code → 500 config");

      // STAFF_CODE seul configuré : hasCode true, mais adminOk reste fermé (pas d'ADMIN_CODE).
      process.env.STAFF_CODE = savedStaff;
      clearModule("lib/staffauth.js");
      const authStaffOnly = require(path.join(ROOT, "lib", "staffauth.js"));
      assert.equal(authStaffOnly.hasCode(), true, "STAFF_CODE seul → hasCode true");
      assert.equal(authStaffOnly.hasAdminCode(), false, "sans ADMIN_CODE → hasAdminCode false");

      process.env.ADMIN_CODE = savedAdmin;
      clearModule("lib/staffauth.js");
      clearModule("api/session.js");
      clearModule("api/allorders.js");
      clearModule("api/updateorder.js");
      require(path.join(ROOT, "lib", "staffauth.js"));
      require(path.join(ROOT, "api", "session.js"));
      require(path.join(ROOT, "api", "allorders.js"));
      require(path.join(ROOT, "api", "updateorder.js"));
    }
  });

  test("B. DELETE /api/session → Max-Age=0", async () => {
    // Rebind handlers after cache clear
    const session2 = require(path.join(ROOT, "api", "session.js"));

    // --- B. DELETE /api/session efface le cookie ---
    {
      const r = mkRes();
      await session2({ method: "DELETE", headers: {} }, r);
      assert.equal(r.statusCode, 200);
      const c = r.headers["Set-Cookie"] || "";
      assert(/Max-Age=0/.test(c), "DELETE session doit Max-Age=0");
      assert(/famo_sess=/.test(c), "DELETE session doit renvoyer famo_sess");
    }
  });

  test("K. allorders cookie-only (sans ?code=)", async () => {
    // Génération de session déjà relue (cache 60 s de lib/staffauth.js, rechargé par le bloc A), comme
    // dans l'ancien enchaînement où les blocs C à I l'avaient lue via call() : le mock ci-dessous ne
    // répond qu'aux lectures d'allorders.
    await call(req => require(path.join(ROOT, "lib", "staffauth.js")).staffSession(req), null, [], { method: "GET", headers: cookieHdr });
    // --- K. Cookie-only allorders (sans code query) ---
    {
      const allorders = require(path.join(ROOT, "api", "allorders.js"));
      const originalFetch = global.fetch;
      const replies = [
        { records: [] },
        { records: [] },
        { records: [] }
      ];
      global.fetch = async () => {
        assert(replies.length, "fetch inattendu allorders");
        return json(replies.shift());
      };
      try {
        const r = mkRes();
        await allorders({ method: "GET", query: {}, headers: cookieHdr }, r);
        assert.equal(r.statusCode, 200, "allorders avec cookie seul doit réussir");
        const r401 = mkRes();
        await allorders({ method: "GET", query: {}, headers: {} }, r401);
        assert.equal(r401.statusCode, 401, "allorders sans cookie → 401");
        const rCode = mkRes();
        await allorders({ method: "GET", query: { code: "famo2026" }, headers: {} }, rCode);
        assert.equal(rCode.statusCode, 401, "allorders avec ?code= seul (sans cookie) → 401");
        const rCodeEnv = mkRes();
        await allorders({ method: "GET", query: { code: process.env.STAFF_CODE }, headers: {} }, rCodeEnv);
        assert.equal(rCodeEnv.statusCode, 401, "allorders avec ?code=STAFF_CODE sans cookie → 401");
      } finally {
        global.fetch = originalFetch;
      }
    }
  });

  test("N. Codes d'accès (remplacent l'environnement, hachés, jamais exposés)", async () => {
    // --- N. Codes d'accès modifiables depuis Beheer -----------------------------
    {
      const authN = require(path.join(ROOT, "lib", "staffauth.js"));
      const sessionN = require(path.join(ROOT, "api", "session.js"));
      const adminHash = authN.hashCode("EenSterkeCode2026");

      const withConfig = fields => {
        const originalFetch = global.fetch;
        global.fetch = async () => json({ records: [{ id: "conf1", fields }] });
        return () => { global.fetch = originalFetch; };
      };

      // N1 — le code enregistré ouvre, celui de l'environnement ne marche plus.
      {
        const restore = withConfig({ "Beheerderscode hash": adminHash });
        try {
          let r = mkRes();
          await sessionN({ method: "POST", body: { code: "EenSterkeCode2026" }, headers: {} }, r);
          assert.equal(r.statusCode, 200, "N1 le code enregistré ouvre");
          assert.equal(r.payload.role, "admin", "N1 rôle admin");

          r = mkRes();
          await sessionN({ method: "POST", body: { code: process.env.ADMIN_CODE }, headers: {} }, r);
          assert.equal(r.statusCode, 401, "N1 le code d'environnement ne marche plus une fois un code enregistré");

          r = mkRes();
          await sessionN({ method: "POST", body: { code: process.env.STAFF_CODE }, headers: {} }, r);
          assert.equal(r.statusCode, 200, "N1 le code personnel d'environnement reste valable (pas de hash staff)");
        } finally { restore(); }
      }

      // N2 — Airtable en panne : on retombe sur les codes d'environnement.
      {
        const originalFetch = global.fetch;
        global.fetch = async () => { throw new Error("airtable indisponible"); };
        try {
          const r = mkRes();
          await sessionN({ method: "POST", body: { code: process.env.ADMIN_CODE }, headers: {} }, r);
          assert.equal(r.statusCode, 200, "N2 porte de secours si la base est injoignable");
        } finally { global.fetch = originalFetch; }
      }

      // N3 — le hachage ne laisse jamais fuir le code.
      assert.ok(!adminHash.includes("EenSterkeCode2026"), "N3 le code n'apparaît pas dans l'empreinte");
      assert.match(adminHash, /^scrypt\$131072\$[0-9a-f]{32}\$[0-9a-f]{64}$/, "N3 format d'empreinte attendu (coût N dans l'empreinte)");
      assert.equal(authN.verifyHash(adminHash, "EenSterkeCode2026"), true, "N3 bonne vérification");
      assert.equal(authN.verifyHash(adminHash, "eensterkecode2026"), false, "N3 casse respectée");
      assert.equal(authN.verifyHash("", "x"), false, "N3 empreinte vide refusée");
      assert.notEqual(authN.hashCode("x"), authN.hashCode("x"), "N3 sel aléatoire à chaque hachage");

      // N4 — l'empreinte n'est jamais renvoyée par l'API, seulement son existence.
      {
        const onboardingN = require(path.join(ROOT, "api", "onboarding.js"));
        const restore = withConfig({ "Bedrijfsnaam": "Famo", "Beheerderscode hash": adminHash });
        try {
          const r = mkRes();
          await onboardingN({ method: "GET", headers: adminCookieHdr, query: {} }, r);
          const body = JSON.stringify(r.payload || {});
          assert.ok(!body.includes(adminHash), "N4 l'empreinte ne sort jamais de l'API");
          assert.equal(r.payload.config.adminCodeCustom, true, "N4 seule l'existence est signalée");
        } finally { restore(); }
      }
    }
  });

  test("AS. Sessie via PIN (Medewerkers) : naam in de cookie, GET geeft naam, rol volgens Rol + want, journaal op voornaam", async () => {
    // --- AS. api/session.js : PIN persoonlijk (Medewerkers) → sessie op naam ; rol volgens Rol + want ---
    {
      clearModule("api/session.js");
      const ses = require(path.join(ROOT, "api", "session.js"));
      const NOCFG = { records: [{ fields: {} }] };
      const MED = { records: [{ id: "m1", fields: { Naam: " Ilse ", Rol: "personeel", "PIN hash": authlib.hashCode("1234"), Actief: true } }, { id: "m2", fields: { Naam: "Tom", Rol: "beheerder", "PIN hash": authlib.hashCode("9876"), Actief: true } }] };
      let r = await call(ses, { code: "1234" }, [NOCFG, MED, { fields: {} }]);
      assert.equal(r.res.statusCode, 200, "AS1 PIN opent"); assert.equal(r.res.payload.role, "staff"); assert.equal(r.res.payload.name, "Ilse", "AS1 naam getrimd");
      assert.ok(decodeURIComponent(r.calls[1].url).includes("Medewerkers?filterByFormula={Actief}=1"), "AS1 enkel actieve accounts gelezen");
      assert.match(r.calls[2].url, /Medewerkers\/m1$/); assert.equal((r.calls[2].options.method || "").toUpperCase(), "PATCH"); assert.ok(Date.parse(JSON.parse(r.calls[2].options.body).fields["Laatste aanmelding"]) > 0, "AS1 laatste aanmelding bijgehouden");
      const tokIlse = decodeURIComponent(/famo_sess=([^;]+)/.exec(r.res.headers["Set-Cookie"])[1]);
      assert.equal(tokIlse.split(".").length, 5, "AS1 jeton à 5 segments (exp.role.naam.gen.sig)");
      assert.deepEqual(authlib.verify(tokIlse).gen, { g: 0, med: "m1", pfp: authlib.pinFingerprint(MED.records[0].fields["PIN hash"]) }, "AS1 le jeton porte l'id Medewerker et l'empreinte du PIN (révocation)");
      assert.deepEqual([authlib.verify(tokIlse).role, authlib.verify(tokIlse).name], ["staff", "Ilse"], "AS1 de cookie draagt de naam");
      const ilseHdr = { cookie: "famo_sess=" + encodeURIComponent(tokIlse) };
      r = await call(ses, null, [], { method: "GET", headers: ilseHdr });
      assert.deepEqual(r.res.payload, { ok: true, role: "staff", name: "Ilse" }, "AS2 GET geeft de naam terug");
      r = await call(ses, null, [], { method: "GET", headers: cookieHdr }); assert.equal(r.res.payload.name, "personeel", "AS2 gedeelde code → rolnaam");
      r = await call(ses, null, [], { method: "GET", headers: adminCookieHdr }); assert.equal(r.res.payload.name, "beheerder");
      r = await call(ses, { code: "9876" }, [NOCFG, MED, { fields: {} }]);
      assert.deepEqual([r.res.payload.role, r.res.payload.name], ["staff", "Tom"], "AS3 beheerder-PIN zonder want=admin → staff");
      r = await call(ses, { code: "9876", want: "admin" }, [NOCFG, MED, { fields: {} }]);
      assert.equal(r.res.payload.role, "admin", "AS3 beheerder-PIN met want=admin → admin");
      assert.equal(authlib.verify(decodeURIComponent(/famo_sess=([^;]+)/.exec(r.res.headers["Set-Cookie"])[1])).role, "admin");
      r = await call(ses, { code: "1234", want: "admin" }, [NOCFG, MED, { fields: {} }]); assert.equal(r.res.payload.role, "staff", "AS3 personeel-PIN nooit admin, ook niet vanuit Beheer");
      r = await call(ses, { code: "0000" }, [NOCFG, MED]); assert.equal(r.res.statusCode, 401, "AS4 verkeerde PIN"); assert.equal(methodCallsX(r, "PATCH").length, 0); assert.equal(r.res.headers["Set-Cookie"], undefined);
      r = await call(ses, { code: "123" }, [NOCFG]); assert.equal(r.res.statusCode, 401, "AS4 te kort"); assert.equal(r.calls.length, 1, "AS4 Medewerkers nooit gelezen voor < 4 tekens");
      r = await call(ses, { code: process.env.STAFF_CODE }, [NOCFG]); assert.equal(r.res.statusCode, 200, "AS4 gedeelde code gaat vóór Medewerkers"); assert.equal(r.calls.length, 1); assert.equal(r.res.payload.name, "");
      const tampered = tokIlse.split("."); tampered[2] = require("buffer").Buffer.from("Tom").toString("base64url");
      r = await call(ses, null, [], { method: "GET", headers: { cookie: "famo_sess=" + encodeURIComponent(tampered.join(".")) } });
      assert.equal(r.res.statusCode, 401, "AS5 naam in de cookie is ondertekend");
      clearModule("api/updateorder.js");
      const uoS = require(path.join(ROOT, "api", "updateorder.js"));
      r = await call(uoS, { id: "oS", correction: "terug", reden: "verkeerd gevalideerd" }, [{ fields: { Statut: "Prête", "Préparation validée": true } }, { fields: {} }], { headers: ilseHdr });
      assert.equal(r.res.statusCode, 200, "AS6 Ilse corrigeert"); assert.match(patchOfX(r, /Commandes\//).fields.Correcties, /· Ilse — verkeerd gevalideerd$/, "AS6 het journaal draagt de voornaam");
      r = await call(uoS, { id: "oS", creditnota: { motif: "abc", lignes: "X × 1" } }, [{ fields: { Statut: "Facturée", Factuurnummer: "FA-1" } }], { headers: ilseHdr });
      assert.equal(r.res.statusCode, 403, "AS6 personeel op naam blijft personeel");
    }
  });
});
