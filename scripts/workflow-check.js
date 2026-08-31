// Règles métier critiques, sans accès Airtable réel.
// Les appels réseau sont simulés pour vérifier les gardes du backend.
process.env.STAFF_CODE = process.env.STAFF_CODE || "testcode-ci";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "admincode-ci";
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
  const session = require(path.join(ROOT, "api", "session.js"));
  const authlib = require(path.join(ROOT, "lib", "staffauth.js"));

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
  console.log("✓ Session staff commune (cookie HttpOnly, expiration, logout, cookie-only APIs)");

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
  console.log("✓ A. Fail-closed sans code configuré + rôles STAFF_CODE/ADMIN_CODE distincts");

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

  const aresAdmin = mkRes();
  await session2({ method: "POST", body: { code: process.env.ADMIN_CODE }, headers: {} }, aresAdmin);
  const tokAdmin = decodeURIComponent(/famo_sess=([^;]+)/.exec(aresAdmin.headers["Set-Cookie"])[1]);
  const adminCookieHdr = { cookie: "famo_sess=" + encodeURIComponent(tokAdmin) };

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
      { fields: { Statut: "Sortie en livraison" } }
    ], { headers: cookieHdr });
    assert.equal(result.res.statusCode, 200, "Sortie avec skipStock doit réussir");
    assert.equal(result.calls.filter(c => /Stock/.test(c.url)).length, 0, "skipStock ne touche jamais au stock");

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
  console.log("✓ C. Stock déduit une seule fois / 409 si afgeboekt / verrou aussi sans skipStock");

  // --- C2. Modifier les lignes recalcule le total côté serveur, jamais celui envoyé ---
  {
    result = await call(updateOrder2, {
      id: "rec3", lignes: "Mosselen × 2 caisse", total: 9999
    }, [
      { fields: { Statut: "Prête", "Préparation validée": true } },
      { records: [{ id: "cat1", fields: { Produit: "Mosselen", "Unité": "caisse", "Prix de base": 28 } }] },
      { records: [{ id: "cat1", fields: { Produit: "Mosselen", "Unité": "caisse", "Prix de base": 28 } }] },
      { fields: { ok: true } }
    ], { headers: cookieHdr });
    assert.equal(result.res.statusCode, 200, "modifier les lignes doit réussir");
    const patchCall = result.calls.find(c => /Commandes\//.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH");
    const patchedTotal = JSON.parse(patchCall.options.body).fields["Total"];
    assert.equal(patchedTotal, 56, "le total est recalculé depuis le catalogue (2 × 28), jamais celui envoyé (9999)");
  }
  console.log("✓ C2. Total recalculé serveur, jamais celui du navigateur");

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
  console.log("✓ D. Factuurnummer unique (pas de réallocation)");

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
  console.log("✓ E. Recipient requis pour deliveryConfirmed");

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
      { records: [{ id: "stk2", fields: { Produit: "Zalm", "Quantité disponible": 5 } }] },
      { records: [{ id: "stk2", fields: { "Quantité disponible": 4 } }] },
      { records: [] },
      { fields: { Statut: "Sortie en livraison", "Stock afgeboekt": true } }
    ], { headers: cookieHdr });
    assert.equal(result.res.statusCode, 200, "Sortie sans preparationValidee body OK si flag déjà true");
  }
  console.log("✓ F. Double-prep / Sortie sans prep field si flag posé");

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
    assert.equal(items.length, 6, "6 entrées de menu (4 primary + 1 meer + setup) — Voorraad retiré du menu tant que le stock n'est pas fiable");
    assert.equal(primary.length, 3, "3 destinations quotidiennes (Dagelijks)");
    assert.ok(!primary.includes("Overzicht"), "Overzicht ne doit pas être primary");
    assert.ok(!primary.includes("Dagvoorbereiding"), "Dagvoorbereiding ne doit pas être primary");
    const labels = items.map(i => i.label);
    for (const need of [
      "Bestellingen", "Magazijn", "Invoeren", "Leveringen",
      "Documenten", "Beheer"
    ]) {
      assert.ok(labels.includes(need), "label manquant: " + need);
    }
    assert.ok(!labels.includes("Voorraad"), "Voorraad ne doit plus être dans le menu (stock non fiable)");
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
  console.log("✓ K. allorders cookie-only (sans ?code=)");

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
  console.log("✓ L. Onboarding admin-only + credentials + validation config");

  // --- M. E-mails transactionnels -------------------------------------------
  // Piege : lib/mail.js avale toutes les erreurs. Un fetch inattendu ferait
  // echouer l'assert du mock A L'INTERIEUR de send(), qui l'avalerait aussi et
  // le test passerait a tort. Toutes les assertions portent donc sur
  // result.calls, jamais sur le fait que le mock jette.
  {
    const savedKey = process.env.RESEND_API_KEY;
    const mailModules = ["lib/mail.js", "lib/ordermail.js", "api/order.js", "api/staff.js"];
    const reloadMail = () => { mailModules.forEach(clearModule); };
    const resendCalls = calls => calls.filter(c => /api\.resend\.com\/emails/.test(c.url));
    const bodyOf = call => JSON.parse(call.options.body);
    const CFG = { records: [{ fields: {
      "Bedrijfsnaam": "Famo Trading BV", "Telefoon": "03 111 11 11",
      "E-mail": "info@famotrading.be", "Bestellingen e-mail": "ops@famo.test"
    } }] };
    const CLIENT_OK = { records: [{ id: "client1", fields: { "Wachtwoord": "pass", "Nom": "Resto Test", "Email": "chef@resto.test" } }] };
    const CAT = { records: [{ id: "prod1", fields: { "Produit": "Mosselen", "Prix de base": 28, "Unité": "caisse" } }] };
    const ORDER_BODY = { user: "test", pw: "pass", items: [{ productId: "prod1", quantity: 2 }], notes: "INTERNE-NOTITIE" };

    // M1 — sans cle : aucune tentative, sequence d'appels inchangee.
    delete process.env.RESEND_API_KEY;
    reloadMail();
    let createOrderM = require(path.join(ROOT, "api", "order.js"));
    let r1 = await call(createOrderM, ORDER_BODY, [CLIENT_OK, CAT, { records: [] }, { records: [{ id: "order1" }] }]);
    assert.equal(r1.res.statusCode, 200, "M1 commande OK sans cle");
    assert.equal(r1.calls.length, 4, "M1 aucun appel supplementaire sans cle");
    assert.equal(resendCalls(r1.calls).length, 0, "M1 aucun appel Resend sans cle");

    // M2 — avec cle : deux mails, destinataires disjoints, secret non fuite.
    process.env.RESEND_API_KEY = "re_test_key";
    reloadMail();
    createOrderM = require(path.join(ROOT, "api", "order.js"));
    const r2 = await call(createOrderM, ORDER_BODY, [
      CLIENT_OK, CAT, { records: [] }, { records: [{ id: "order1" }] }, CFG, { id: "m1" }, { id: "m2" }
    ]);
    assert.equal(r2.res.statusCode, 200, "M2 commande OK avec cle");
    const mails = resendCalls(r2.calls);
    assert.equal(mails.length, 2, "M2 exactement deux envois");
    const team = mails.map(bodyOf).find(b => b.to.includes("ops@famo.test"));
    const cust = mails.map(bodyOf).find(b => b.to.includes("chef@resto.test"));
    assert.ok(team && cust, "M2 un mail equipe et un mail client");
    assert.ok(!team.to.includes("chef@resto.test") && !cust.to.includes("ops@famo.test"), "M2 destinataires disjoints");
    mails.forEach(c => {
      assert.match(String(c.options.headers.Authorization || ""), /^Bearer re_test_key$/, "M2 cle en en-tete");
      assert.ok(!c.options.body.includes("re_test_key"), "M2 cle jamais dans le corps");
    });
    assert.ok(team.subject.includes("CMD-") && cust.subject.includes("CMD-"), "M2 reference dans les deux sujets");
    assert.equal(team.reply_to, "chef@resto.test", "M2 equipe repond au client");
    assert.equal(cust.reply_to, "info@famotrading.be", "M2 client repond a l'adresse publique");

    // M2b — la note interne ne part jamais au client.
    assert.match(team.html, /INTERNE-NOTITIE/, "M2b note interne dans le mail equipe");
    assert.ok(!/INTERNE-NOTITIE/.test(cust.html + cust.text), "M2b note interne absente du mail client");
    assert.ok(!/ops@famo\.test/.test(cust.html + cust.text), "M2b boite ops jamais exposee au client");

    // M2c — compatibilite clients mail.
    [team, cust].forEach(m => {
      assert.ok(m.text && m.text.length > 40, "M2c version texte presente");
      assert.ok(!/<style/i.test(m.html), "M2c pas de bloc <style>");
      assert.ok(!/display\s*:\s*flex/.test(m.html), "M2c pas de flexbox");
    });

    // M2d — echappement (nom client hostile) + traduction des unites.
    const XSS = { records: [{ id: "client1", fields: { "Wachtwoord": "pass", "Nom": "<img src=x onerror=alert(1)>", "Email": "chef@resto.test" } }] };
    const rX = await call(createOrderM, ORDER_BODY, [
      XSS, CAT, { records: [] }, { records: [{ id: "order1" }] }, CFG, { id: "m1" }, { id: "m2" }
    ]);
    resendCalls(rX.calls).map(bodyOf).forEach(m => {
      assert.ok(!/<img/i.test(m.html), "M2d nom client echappe");
      assert.match(m.html, /kassa/, "M2d unite traduite en kassa");
      assert.ok(!/>caisse</.test(m.html), "M2d jamais le mot francais caisse a l'ecran");
    });

    // M3 — Resend en echec : la commande reste un succes.
    for (const failMode of ["throw", "422"]) {
      const originalFetch = global.fetch;
      const replies = [CLIENT_OK, CAT, { records: [] }, { records: [{ id: "order1" }] }, CFG];
      global.fetch = async url => {
        if (/api\.resend\.com/.test(String(url))) {
          if (failMode === "throw") throw new Error("reseau indisponible");
          return { status: 422, json: async () => ({}), text: async () => "domain not verified" };
        }
        return json(replies.shift());
      };
      try {
        const res = mkRes();
        await createOrderM({ method: "POST", body: ORDER_BODY, headers: {}, query: {} }, res);
        assert.equal(res.statusCode, 200, "M3 commande OK meme si l'envoi echoue (" + failMode + ")");
        assert.ok(res.payload.ref, "M3 reference renvoyee");
        assert.equal(res.payload.mail.team.ok, false, "M3 echec signale dans la reponse");
      } finally {
        global.fetch = originalFetch;
      }
    }

    // M4 — client sans e-mail : seule l'equipe est prevenue.
    const NO_MAIL = { records: [{ id: "client1", fields: { "Wachtwoord": "pass", "Nom": "Resto Test" } }] };
    const r4 = await call(createOrderM, ORDER_BODY, [
      NO_MAIL, CAT, { records: [] }, { records: [{ id: "order1" }] }, CFG, { id: "m1" }
    ]);
    assert.equal(resendCalls(r4.calls).length, 1, "M4 un seul envoi sans e-mail client");
    assert.ok(bodyOf(resendCalls(r4.calls)[0]).to.includes("ops@famo.test"), "M4 c'est l'equipe qui recoit");
    assert.equal(r4.res.payload.mail.customer.skipped, "no-recipient", "M4 absence de destinataire signalee");

    // M5 — pas de boite ops : seul le client est prevenu.
    const NO_OPS = { records: [{ fields: { "Bedrijfsnaam": "Famo Trading BV", "E-mail": "info@famotrading.be" } }] };
    const r5 = await call(createOrderM, ORDER_BODY, [
      CLIENT_OK, CAT, { records: [] }, { records: [{ id: "order1" }] }, NO_OPS, { id: "m1" }
    ]);
    assert.equal(resendCalls(r5.calls).length, 1, "M5 un seul envoi sans boite ops");
    assert.ok(bodyOf(resendCalls(r5.calls)[0]).to.includes("chef@resto.test"), "M5 c'est le client qui recoit");

    // M6 — parite du parseur avec documents.js (garde anti-derive).
    const om = require(path.join(ROOT, "lib", "ordermail.js"));
    {
      const docsSrc = fs.readFileSync(path.join(ROOT, "documents.js"), "utf8");
      const sandbox = { window: {}, console };
      vm.runInNewContext(docsSrc, sandbox);
      const FamoDocs = sandbox.window.FamoDocuments;
      const i18nSrc = fs.readFileSync(path.join(ROOT, "staff-i18n.js"), "utf8");
      const sandbox2 = { window: {}, console };
      vm.runInNewContext(i18nSrc, sandbox2);
      const famoNL = sandbox2.window.famoNL;
      const fixtures = [
        "Zalm × 2 kg [€12.50]",
        "Mosselen × 1 caisse [€28.00] (zonder ijs)",
        "Kabeljauw x 0.5 kg",
        "Garnalen × 3"
      ];
      fixtures.forEach(f => {
        assert.deepEqual(om.parseLines(f), FamoDocs.parse(f), "M6 parseur identique a documents.js : " + f);
        assert.equal(om.nlLines(f), famoNL.lines(f), "M6b traduction identique a staff-i18n.js : " + f);
      });
    }

    // M7 — saisie manuelle : lecture du client + source, et rien sans cle.
    let staffM = require(path.join(ROOT, "api", "staff.js"));
    const STAFF_BODY = { clientId: "recABC", items: [{ productId: "prod1", quantity: 2 }], bron: "WhatsApp" };
    const r7 = await call(staffM, STAFF_BODY, [
      CAT, { records: [] }, { records: [{ id: "order1" }] },
      { id: "recABC", fields: { "Nom": "Resto Test", "Email": "chef@resto.test" } },
      CFG, { id: "m1" }, { id: "m2" }
    ], { headers: adminCookieHdr });
    assert.equal(r7.res.statusCode, 200, "M7 saisie manuelle OK");
    assert.ok(r7.calls.some(c => /Clients\/recABC/.test(c.url)), "M7 le client est bien relu");
    const team7 = resendCalls(r7.calls).map(bodyOf).find(b => b.to.includes("ops@famo.test"));
    assert.match(team7.html, /WhatsApp/, "M7 la source apparait pour l'equipe");

    delete process.env.RESEND_API_KEY;
    reloadMail();
    staffM = require(path.join(ROOT, "api", "staff.js"));
    const r7b = await call(staffM, STAFF_BODY, [
      CAT, { records: [] }, { records: [{ id: "order1" }] }
    ], { headers: adminCookieHdr });
    assert.equal(r7b.res.statusCode, 200, "M7 saisie manuelle OK sans cle");
    assert.ok(!r7b.calls.some(c => /Clients\/recABC/.test(c.url)), "M7 aucune lecture client inutile sans cle");

    // M8 — restauration.
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
    reloadMail();
  }
  console.log("✓ M. E-mails commande (inerte sans clé, destinataires séparés, échec sans impact)");

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
    assert.match(adminHash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/, "N3 format d'empreinte attendu");
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
  console.log("✓ N. Codes d'accès (remplacent l'environnement, hachés, jamais exposés)");

  // silence unused after restore
  assert.ok(authlib2.hasCode());

  console.log("✓ Regles release candidate (validation explicite, 405 GET, 410 cadrage)");
  console.log("✓ Règles métier commande, préparation et livraison");
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
