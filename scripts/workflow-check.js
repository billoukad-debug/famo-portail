// Règles métier critiques, sans accès Airtable réel.
// Les appels réseau sont simulés pour vérifier les gardes du backend.
process.env.STAFF_CODE = process.env.STAFF_CODE || "testcode-ci";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

function json(payload) {
  return { json: async () => payload };
}

function mkRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
    setHeader(k, v) { this.headers[k] = v; }
  };
}

function clearModule(rel) {
  const abs = require.resolve(path.join(ROOT, rel));
  delete require.cache[abs];
}

async function call(handler, body, replies, opts) {
  opts = opts || {};
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options: options || {} });
    assert(replies.length, `Appel Airtable inattendu: ${url}`);
    return json(replies.shift());
  };
  const res = mkRes();
  const req = {
    method: opts.method || "POST",
    body,
    headers: opts.headers || {},
    query: opts.query || {}
  };
  try {
    await handler(req, res);
    return { res, calls };
  } finally {
    global.fetch = originalFetch;
  }
}

async function main() {
  const updateOrder = require(path.join(ROOT, "api", "updateorder.js"));
  const createOrder = require(path.join(ROOT, "api", "order.js"));

  let result = await call(updateOrder, { code: process.env.STAFF_CODE, id: "rec1", statut: "Sortie en livraison" }, [
    { fields: { Statut: "Prête", "Préparation validée": false } }
  ]);
  assert.equal(result.res.statusCode, 409);
  assert.match(result.res.payload.error, /Valideer eerst/);

  result = await call(updateOrder, { code: process.env.STAFF_CODE, id: "rec1", statut: "Facturée" }, [
    { fields: { Statut: "Sortie en livraison" } }
  ]);
  assert.equal(result.res.statusCode, 409);
  assert.match(result.res.payload.error, /Bevestig eerst/);

  result = await call(updateOrder, { code: process.env.STAFF_CODE, id: "rec1", preparationValidee: true }, [
    { fields: { Statut: "Reçue" } },
    { fields: { "Préparation validée": true } }
  ]);
  assert.equal(result.res.statusCode, 200);
  const preparationPatch = JSON.parse(result.calls[1].options.body);
  assert.equal(preparationPatch.fields["Préparation validée"], true);

  result = await call(updateOrder, {
    code: process.env.STAFF_CODE, id: "rec1", lignes: "Mosselen × 0.5 caisse", total: 6
  }, [
    { fields: { Statut: "Reçue" } },
    { records: [{ fields: { "Produit": "Mosselen", "Unité": "caisse" } }] }
  ]);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.payload.error, /decimale hoeveelheid/);

  result = await call(createOrder, {
    user: "test", pw: "pass", total: 0,
    items: [{ productId: "prod1", quantity: 2, price: 0 }]
  }, [
    { records: [{ id: "client1", fields: { "Wachtwoord": "pass" } }] },
    { records: [{ id: "prod1", fields: { "Produit": "Zalm", "Prix de base": 12.5, "Unité": "kg" } }] },
    { records: [] },
    { records: [{ id: "order1" }] }
  ]);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.payload.total, 25);
  const created = JSON.parse(result.calls[3].options.body).records[0].fields;
  assert.equal(created.Total, 25);
  assert.match(created["Lignes (produits / quantités)"], /\[€12\.50\]/);

  result = await call(createOrder, {
    user: "test", pw: "pass",
    items: [{ productId: "prod1", quantity: 0.5 }]
  }, [
    { records: [{ id: "client1", fields: { "Wachtwoord": "pass" } }] },
    { records: [{ id: "prod1", fields: { "Produit": "Mosselen", "Prix de base": 12.5, "Unité": "caisse" } }] },
    { records: [] }
  ]);
  assert.equal(result.res.statusCode, 400);
  assert.match(result.res.payload.error, /decimale hoeveelheid/);


  // --- Nouvelles regles de la release candidate ---
  // 1. Passage a Klaar SANS validation explicite -> 409
  result = await call(updateOrder, { code: process.env.STAFF_CODE, id: "rec1", statut: "Prête" }, [
    { id: "rec1", fields: { "Statut": "Reçue" } }
  ]);
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


  // --- Session staff commune ---
  const session = require(path.join(ROOT, "api", "session.js"));
  const authlib = require(path.join(ROOT, "lib", "staffauth.js"));

  // login correct -> cookie HttpOnly Secure SameSite
  let sres = mkRes();
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

  // token expire -> 401
  const expired = authlib.sign(Date.now() - 1000);
  sres = mkRes(); await session({ method: "GET", headers: { cookie: "famo_sess=" + encodeURIComponent(expired) } }, sres);
  assert.equal(sres.statusCode, 401, "session expiree doit etre refusee");

  // token falsifie -> 401
  sres = mkRes(); await session({ method: "GET", headers: { cookie: "famo_sess=" + encodeURIComponent(tok.split(".")[0] + ".AAAA") } }, sres);
  assert.equal(sres.statusCode, 401, "signature falsifiee refusee");

  // une API staff accepte le cookie SANS code dans l'URL
  {
    const res2 = mkRes();
    await updateOrder({ method: "POST", body: { id: "rec1" }, headers: { cookie: "famo_sess=" + encodeURIComponent(tok) } }, res2);
    assert.notEqual(res2.statusCode, 401, "cookie doit suffire pour les API staff");
  }
  console.log("✓ Session staff commune (cookie HttpOnly, expiration, logout, compat code)");

  // --- A. Fallback temporaire famo2026 si STAFF_CODE env absente ---
  {
    const saved = process.env.STAFF_CODE;
    delete process.env.STAFF_CODE;
    clearModule("lib/staffauth.js");
    clearModule("api/session.js");
    const sessionFb = require(path.join(ROOT, "api", "session.js"));
    const authFb = require(path.join(ROOT, "lib", "staffauth.js"));
    assert.ok(authFb.hasCode(), "fallback temporaire doit fournir un code");
    const rOk = mkRes();
    await sessionFb({ method: "POST", body: { code: "famo2026" }, headers: {} }, rOk);
    assert.equal(rOk.statusCode, 200, "login famo2026 doit marcher sans env (temporaire)");
    const rBad = mkRes();
    await sessionFb({ method: "POST", body: { code: "wrong" }, headers: {} }, rBad);
    assert.equal(rBad.statusCode, 401, "mauvais code refuse meme avec fallback");
    process.env.STAFF_CODE = saved;
    clearModule("lib/staffauth.js");
    clearModule("api/session.js");
    clearModule("api/updateorder.js");
    require(path.join(ROOT, "lib", "staffauth.js"));
    require(path.join(ROOT, "api", "session.js"));
    require(path.join(ROOT, "api", "updateorder.js"));
  }
  console.log("✓ A. Fallback temporaire famo2026 (env absente)");

  // Rebind handlers after cache clear
  const updateOrder2 = require(path.join(ROOT, "api", "updateorder.js"));
  const session2 = require(path.join(ROOT, "api", "session.js"));
  const authlib2 = require(path.join(ROOT, "lib", "staffauth.js"));

  // --- B. DELETE /api/session efface le cookie ---
  {
    const r = mkRes();
    await session2({ method: "DELETE", headers: {} }, r);
    assert.equal(r.statusCode, 200);
    const c = r.headers["Set-Cookie"] || "";
    assert(/Max-Age=0/.test(c), "DELETE session doit Max-Age=0");
    assert(/famo_sess=/.test(c), "DELETE session doit renvoyer famo_sess");
  }
  console.log("✓ B. DELETE /api/session → Max-Age=0");

  // Relogin pour cookie frais apres restore modules
  sres = mkRes();
  await session2({ method: "POST", body: { code: process.env.STAFF_CODE }, headers: {} }, sres);
  const tok2 = decodeURIComponent(/famo_sess=([^;]+)/.exec(sres.headers["Set-Cookie"])[1]);
  const cookieHdr = { cookie: "famo_sess=" + encodeURIComponent(tok2) };

  // --- C. Stock déduit une seule fois / lignes bloquées si déjà afgeboekt ---
  {
    // Première Sortie avec préparation → déduction stock OK
    // Séquence : GET commande → GET Stock → PATCH Stock → POST mouvements → PATCH commande
    result = await call(updateOrder2, {
      code: process.env.STAFF_CODE, id: "rec1", statut: "Sortie en livraison"
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
      { records: [{ id: "stk1", fields: { Produit: "Mosselen", "Quantité disponible": 10 } }] },
      { records: [{ id: "stk1", fields: { "Quantité disponible": 8 } }] },
      { records: [] },
      { fields: { Statut: "Sortie en livraison", "Stock afgeboekt": true } }
    ]);
    assert.equal(result.res.statusCode, 200, "première Sortie doit réussir");
    const stockPatches = result.calls.filter(c => /\/Stock$/.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH");
    assert.equal(stockPatches.length, 1, "un seul PATCH stock à la première Sortie");

    // Déjà afgeboekt + tentative de changement de lignes → 409, aucun PATCH stock
    result = await call(updateOrder2, {
      code: process.env.STAFF_CODE, id: "rec1", lignes: "Mosselen × 3 caisse", total: 30
    }, [
      {
        fields: {
          Statut: "Sortie en livraison",
          "Stock afgeboekt": true,
          "Préparation validée": true,
          "Lignes (produits / quantités)": "Mosselen × 2 caisse"
        }
      }
    ]);
    assert.equal(result.res.statusCode, 409, "lignes après afgeboekt → 409");
    assert.match(result.res.payload.error, /uit voorraad geboekt/);
    assert.equal(result.calls.filter(c => /Stock/.test(c.url)).length, 0, "pas de nouvel appel stock");
  }
  console.log("✓ C. Stock déduit une seule fois / 409 si afgeboekt");

  // --- D. Facture unique : Factuurnummer déjà posé → pas de nouvel alloc ---
  {
    result = await call(updateOrder2, {
      code: process.env.STAFF_CODE, id: "rec1", statut: "Facturée", deliveryConfirmed: true, recipient: "Jan"
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
    ]);
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
  console.log("✓ D. Factuurnummer unique (pas de réallocation)");

  // --- E. Destinataire requis pour deliveryConfirmed ---
  {
    result = await call(updateOrder2, {
      code: process.env.STAFF_CODE, id: "rec1", statut: "Facturée", deliveryConfirmed: true, recipient: "  "
    }, [
      { fields: { Statut: "Sortie en livraison", "Livraison confirmée": false } }
    ]);
    assert.equal(result.res.statusCode, 400);
    assert.match(result.res.payload.error, /ontvangen/);
  }
  console.log("✓ E. Recipient requis pour deliveryConfirmed");

  // --- F. Préparation déjà validée + Sortie sans champ prep → OK ---
  {
    result = await call(updateOrder2, {
      code: process.env.STAFF_CODE, id: "rec1", statut: "Sortie en livraison"
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
      { records: [{ id: "stk2", fields: { Produit: "Zalm", "Quantité disponible": 5 } }] },
      { records: [{ id: "stk2", fields: { "Quantité disponible": 4 } }] },
      { records: [] },
      { fields: { Statut: "Sortie en livraison", "Stock afgeboekt": true } }
    ]);
    assert.equal(result.res.statusCode, 200, "Sortie sans preparationValidee body OK si flag déjà true");
  }
  console.log("✓ F. Double-prep / Sortie sans prep field si flag posé");

  // --- G. Lignes malveillantes / qty invalide rejetées ---
  {
    result = await call(updateOrder2, {
      code: process.env.STAFF_CODE, id: "rec1",
      lignes: '<img src=x onerror=alert(1)> × -3 caisse'
    }, [
      { fields: { Statut: "Reçue", "Stock afgeboekt": false } },
      { records: [{ fields: { Produit: "<img src=x onerror=alert(1)>", Unité: "caisse" } }] }
    ]);
    assert.equal(result.res.statusCode, 400, "qty négative / ligne XSS doit être refusée");
    assert.match(result.res.payload.error, /hoeveelheid|Catalogus|gevonden|decimale/i);

    // documents esc path
    const docsSrc = fs.readFileSync(path.join(ROOT, "documents.js"), "utf8");
    const sandbox = { window: {}, console };
    vm.runInNewContext(docsSrc, sandbox);
    assert.equal(typeof sandbox.window.FamoDocuments.esc, "function");
    assert.equal(sandbox.window.FamoDocuments.esc('<img src=x onerror="x">'), "&lt;img src=x onerror=&quot;x&quot;>");
    assert.ok(!/<[a-z]/i.test(sandbox.window.FamoDocuments.esc("<b>x</b>")));
  }
  console.log("✓ G. XSS / qty malveillante rejetée + documents.esc");

  // --- H. famoNL / staff-i18n ---
  {
    const i18n = fs.readFileSync(path.join(ROOT, "staff-i18n.js"), "utf8");
    const sandbox = { window: {}, console };
    vm.runInNewContext(i18n, sandbox);
    assert.equal(sandbox.window.famoNL.unit("caisse"), "kassa");
    assert.notEqual(sandbox.window.famoNL.unit("caisse"), "doos");
    assert.equal(sandbox.window.famoNL.status("Reçue"), "Ontvangen");
    assert.match(sandbox.window.famoNL.lines("Mosselen × 2 caisse"), /kassa/);
    assert.ok(!/doos/.test(sandbox.window.famoNL.lines("Mosselen × 2 caisse")));
  }
  console.log("✓ H. famoNL caisse→kassa, Reçue→Ontvangen");

  // --- I. Navigation : 4 primary + Meer + Aan de slag ---
  {
    const navSrc = fs.readFileSync(path.join(ROOT, "staff-nav.js"), "utf8");
    const sandbox = {
      window: {},
      global: {},
      document: {
        readyState: "complete",
        querySelectorAll: () => [],
        addEventListener: () => {}
      },
      location: { pathname: "/bestellingen.html" },
      console
    };
    sandbox.global = sandbox;
    vm.runInNewContext(navSrc, sandbox);
    const famoNav = sandbox.window.famoNav || sandbox.global.famoNav;
    const items = famoNav.ITEMS;
    const primary = famoNav.PRIMARY.map(i => i.label);
    assert.equal(items.length, 7, "7 entrées de menu (4 primary + 2 meer + setup)");
    assert.equal(primary.length, 4, "4 destinations primary");
    assert.ok(!primary.includes("Overzicht"), "Overzicht ne doit pas être primary");
    assert.ok(!primary.includes("Dagvoorbereiding"), "Dagvoorbereiding ne doit pas être primary");
    const labels = items.map(i => i.label);
    for (const need of [
      "Bestellingen", "Magazijn", "Invoeren", "Leveringen",
      "Voorraad", "Documenten", "Aan de slag"
    ]) {
      assert.ok(labels.includes(need), "label manquant: " + need);
    }
  }
  console.log("✓ I. staff-nav 4 primary + Meer + Aan de slag");

  // --- K. Cookie-only allorders (sans code query) ---
  {
    const allorders = require(path.join(ROOT, "api", "allorders.js"));
    const originalFetch = global.fetch;
    const replies = [
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
      assert.equal(r401.statusCode, 401, "allorders sans cookie ni code → 401");
    } finally {
      global.fetch = originalFetch;
    }
  }
  console.log("✓ K. allorders cookie-only (sans ?code=)");

  // --- L. Onboarding API : preview credentials + validation saveConfig ---
  {
    const onboarding = require(path.join(ROOT, "api", "onboarding.js"));
    const originalFetch = global.fetch;
    global.fetch = async () => ({ json: async () => ({ records: [] }) });
    try {
      const r = mkRes();
      await onboarding({
        method: "POST",
        body: { action: "previewCredentials", nom: "Test Klant" },
        headers: cookieHdr
      }, r);
      assert.equal(r.statusCode, 200, "previewCredentials");
      assert.ok(r.payload.user && r.payload.password, "user+password generes");
      assert.ok(r.payload.password.length >= 6);

      const rBad = mkRes();
      await onboarding({
        method: "POST",
        body: { action: "saveConfig", bedrijfsnaam: "", btw: "" },
        headers: cookieHdr
      }, rBad);
      assert.equal(rBad.statusCode, 400, "saveConfig incomplet refuse");
    } finally {
      global.fetch = originalFetch;
    }
  }
  console.log("✓ L. Onboarding credentials + validation config");

  // silence unused after restore
  assert.ok(authlib2.hasCode());

  console.log("✓ Regles release candidate (validation explicite, 405 GET, 410 cadrage)");
  console.log("✓ Règles métier commande, préparation et livraison");
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
