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

// Réponse Airtable à la requête de numérotation (lib/ordernumber.js), juste avant
// l'enregistrement d'une commande : aucune référence CMD-<année>-NNNN encore.
const NO_ORDER_REFS = { records: [] };

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
    NO_ORDER_REFS,
    { records: [{ id: "order1" }] }
  ]);
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.payload.total, 25);
  const created = JSON.parse(result.calls[4].options.body).records[0].fields;
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
    let r1 = await call(createOrderM, ORDER_BODY, [CLIENT_OK, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }]);
    assert.equal(r1.res.statusCode, 200, "M1 commande OK sans cle");
    assert.equal(r1.calls.length, 5, "M1 aucun appel supplementaire sans cle (client, catalogue, prix, numérotation, commande)");
    assert.equal(resendCalls(r1.calls).length, 0, "M1 aucun appel Resend sans cle");

    // M2 — avec cle : deux mails, destinataires disjoints, secret non fuite.
    process.env.RESEND_API_KEY = "re_test_key";
    reloadMail();
    createOrderM = require(path.join(ROOT, "api", "order.js"));
    const r2 = await call(createOrderM, ORDER_BODY, [
      CLIENT_OK, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, CFG, { id: "m1" }, { id: "m2" }
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
      XSS, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, CFG, { id: "m1" }, { id: "m2" }
    ]);
    resendCalls(rX.calls).map(bodyOf).forEach(m => {
      assert.ok(!/<img/i.test(m.html), "M2d nom client echappe");
      assert.match(m.html, /kassa/, "M2d unite traduite en kassa");
      assert.ok(!/>caisse</.test(m.html), "M2d jamais le mot francais caisse a l'ecran");
    });

    // M3 — Resend en echec : la commande reste un succes.
    for (const failMode of ["throw", "422"]) {
      const originalFetch = global.fetch;
      const replies = [CLIENT_OK, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, CFG];
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
      NO_MAIL, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, CFG, { id: "m1" }
    ]);
    assert.equal(resendCalls(r4.calls).length, 1, "M4 un seul envoi sans e-mail client");
    assert.ok(bodyOf(resendCalls(r4.calls)[0]).to.includes("ops@famo.test"), "M4 c'est l'equipe qui recoit");
    assert.equal(r4.res.payload.mail.customer.skipped, "no-recipient", "M4 absence de destinataire signalee");

    // M5 — pas de boite ops : seul le client est prevenu.
    const NO_OPS = { records: [{ fields: { "Bedrijfsnaam": "Famo Trading BV", "E-mail": "info@famotrading.be" } }] };
    const r5 = await call(createOrderM, ORDER_BODY, [
      CLIENT_OK, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, NO_OPS, { id: "m1" }
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
      CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] },
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
      CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }
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
    FamoDocs.setCompany({ bedrijfsnaam: "Famo", iban: "BE68539007547034", bic: "GKCCBEBB" });
    const order = { ref: "CMD-1", client: "Resto Test", factuurnummer: "FA-2026-0001", lignes: "Zalm × 2 kg [€12.50]", total: 25 };
    const invoiceHtml = FamoDocs.build(order, "invoice");
    assert.match(invoiceHtml, /<span>Mededeling<\/span><b class="mono">\+\+\+202\/6000\/00192\+\+\+<\/b>/, "O4 Mededeling sur la facture");
    assert.ok(!/Mededeling/.test(FamoDocs.build(order, "delivery")), "O4 pas de Mededeling sur le bon de livraison");
    assert.ok(!/Mededeling/.test(FamoDocs.build({ ...order, factuurnummer: "OUD-7" }, "invoice")), "O4 pas de ligne si numéro hors format");
  }
  console.log("✓ O. Gestructureerde mededeling (FA-nummer → +++…+++, mod 97)");

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

    const CLIENT_P = { records: [{ id: "clientPrix", fields: { "Nom": "Resto Prijs", "Wachtwoord": "pass" } }] };
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
    let r = await call(catalogueP, { user: "prijs", pw: "pass" }, [CLIENT_P, CAT_P, NEG_P, { records: [] }]);
    assert.equal(r.res.statusCode, 200, "P2 login catalogue");
    assert.deepEqual(shownPrices(r.res.payload.products), EXPECTED, "P2 catalogue : vide → base, 0 → 0");

    // P3 — ce qu'il paie en commandant : identique au catalogue, ligne par ligne.
    r = await call(createOrder, { user: "prijs", pw: "pass", items: ITEMS }, [CLIENT_P, CAT_P, NEG_P, NO_ORDER_REFS, { records: [{ id: "orderPrix" }] }]);
    assert.equal(r.res.statusCode, 200, "P3 commande client");
    const orderFields = JSON.parse(r.calls[4].options.body).records[0].fields;
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
      CAT_P, CAT_P, NEG_P,
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
      const save = async prix => {
        const res = mkRes();
        await onboardingP({ method: "POST", body: { action: "savePrice", clientId: "clientPrix", productId: "pNieuw", prix }, headers: adminCookieHdr }, res);
        return res;
      };
      assert.equal((await save("")).statusCode, 200, "P6 champ vide accepté");
      assert.strictEqual(written.pop()["Prix négocié"], null, "P6 champ vide enregistré vide, pas 0");
      assert.equal((await save(null)).statusCode, 200, "P6 prix null accepté");
      assert.strictEqual(written.pop()["Prix négocié"], null, "P6 prix null enregistré vide");
      assert.equal((await save(0)).statusCode, 200, "P6 0 accepté");
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

    // P7 — Beheer (page) : le champ vide part vide (null), un 0 tapé part 0.
    const beheerSrc = fs.readFileSync(path.join(ROOT, "beheer.html"), "utf8");
    const savePriceSrc = /async function savePrice\(\)\{[\s\S]*?\n\}/.exec(beheerSrc);
    assert.ok(savePriceSrc, "P7 savePrice introuvable dans beheer.html");
    const typeAndSave = async typed => {
      const sent = [];
      const ctx = { val: id => (id === "prv" ? typed : "x"), toast: () => {}, render: () => {}, post: async body => { sent.push(body); return false; } };
      vm.runInNewContext(savePriceSrc[0], ctx);
      await ctx.savePrice();
      return sent;
    };
    assert.strictEqual((await typeAndSave(""))[0].prix, null, "P7 champ vide → envoyé vide");
    assert.strictEqual((await typeAndSave("0"))[0].prix, 0, "P7 0 tapé → envoyé 0");
    assert.strictEqual((await typeAndSave("12.5"))[0].prix, 12.5, "P7 prix tapé");
    assert.equal((await typeAndSave("-1")).length, 0, "P7 prix négatif bloqué");
  }
  console.log("✓ P. Prix négocié (vide → prix de base, 0 saisi → 0, catalogue = commande = staff = recalcul)");

  // --- Q. Documenten : filtre par client -----------------------------------------
  {
    // Le vrai script de la page, avec un DOM minimal et une API simulée.
    const pageSrc = fs.readFileSync(path.join(ROOT, "documenten.html"), "utf8");
    const inline = [...pageSrc.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
    const ORDERS_Q = [
      { id: "o1", ref: "CMD-1", client: "Resto Noord", statut: "Facturée", factuurnummer: "FA-2026-0001", total: 50 },
      { id: "o2", ref: "CMD-2", client: "Brasserie Zuid", statut: "Prête", total: 30 },
      { id: "o3", ref: "CMD-3", client: "Resto Noord", statut: "Reçue", total: 20 }
    ];
    const els = {};
    const el = id => els[id] || (els[id] = { id, value: "", innerHTML: "", textContent: "", className: "", classList: { add() {}, remove() {}, toggle() {} } });
    const ctx = {
      console, setTimeout, URLSearchParams,
      location: { search: "" },
      document: { getElementById: el },
      famoStaff: {
        bindLogin: () => ({ enter() {}, logout() {} }),
        translateError: m => m,
        api: async url => ({ ok: true, json: async () => (/\/api\/config/.test(url) ? { config: { bedrijfsnaam: "Famo", iban: "BE68539007547034", bic: "GKCCBEBB" } } : { orders: ORDERS_Q }) })
      }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "documents.js"), "utf8"), ctx);
    vm.runInContext(inline, ctx);

    await ctx.load();
    const options = el("klant").innerHTML;
    assert.match(options, /^<option value="">Alle klanten<\/option>/, "Q1 option « Alle klanten » en premier");
    assert.ok(options.indexOf("Brasserie Zuid") < options.indexOf("Resto Noord"), "Q1 clients triés A–Z");
    assert.equal((options.match(/Resto Noord/g) || []).length, 2, "Q1 chaque client une seule fois (valeur + libellé)");
    assert.equal(el("count").textContent, "9 documenten", "Q2 sans filtre : 3 commandes × 3 documents");

    el("klant").value = "Resto Noord";
    ctx.render();
    assert.equal(el("count").textContent, "6 documenten", "Q3 filtre client : seulement ses documents");
    assert.ok(el("table").innerHTML.includes("CMD-1") && el("table").innerHTML.includes("CMD-3"), "Q3 ses commandes sont listées");
    assert.ok(!el("table").innerHTML.includes("CMD-2"), "Q3 les autres clients sont exclus");

    ctx.setType("invoice");
    assert.equal(el("count").textContent, "2 documenten", "Q4 client + type se combinent");
    ctx.setType("all");

    await ctx.load();
    assert.equal(el("klant").value, "Resto Noord", "Q5 la sélection survit à Vernieuwen");
    assert.equal(el("count").textContent, "6 documenten", "Q5 filtre toujours appliqué après rechargement");

    el("klant").value = "";
    ctx.render();
    assert.equal(el("count").textContent, "9 documenten", "Q6 « Alle klanten » retire le filtre");
  }
  console.log("✓ Q. Documenten : filtre par client (liste, filtre, combinaison, rechargement)");

  // --- R. Bestellingen (kanban) : leverdatum en avant, tri par leverdatum par défaut ---
  {
    const pageSrc = fs.readFileSync(path.join(ROOT, "bestellingen.html"), "utf8");

    // R1 — le tri par défaut est la date de livraison (première option, rien de forcé).
    const sortSelect = /<select id="sort"[^>]*>([\s\S]*?)<\/select>/.exec(pageSrc);
    assert.ok(sortSelect, "R1 select de tri introuvable");
    assert.equal(/<option value="([^"]+)"/.exec(sortSelect[1])[1], "delivery", "R1 première option (défaut) = Leverdatum");
    assert.ok(!/<option[^>]*\bselected\b/.test(sortSelect[1]), "R1 aucune option forcée par selected");

    // R2 — la date est plus grande que la référence.
    const px = re => Number((re.exec(pageSrc) || [])[1]);
    assert.ok(px(/\.m-card-date\{[^}]*font-size:([\d.]+)px/) > px(/\.m-card-ref\{[^}]*font:\s*\d+\s+([\d.]+)px/), "R2 leverdatum plus grande que la référence");

    // Le vrai script de la page, avec un DOM minimal et une API simulée.
    const inline = [...pageSrc.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
    const brussels = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(d);
    const shift = n => { const d = new Date(brussels(new Date()) + "T12:00:00"); d.setDate(d.getDate() + n); return brussels(d); };
    const ORDERS_R = [
      { id: "a", ref: "CMD-A", client: "Resto A", statut: "Reçue", date: shift(0), dateLiv: shift(2), total: 10, paiement: "En attente", lignes: "" },
      { id: "b", ref: "CMD-B", client: "Resto B", statut: "Reçue", date: shift(-1), dateLiv: "", total: 10, paiement: "En attente", lignes: "" },
      { id: "c", ref: "CMD-C", client: "Resto C", statut: "Reçue", date: shift(-3), dateLiv: shift(0), total: 10, paiement: "En attente", lignes: "" },
      { id: "d", ref: "CMD-D", client: "Resto D", statut: "Reçue", date: shift(-5), dateLiv: shift(-1), total: 10, paiement: "En attente", lignes: "" }
    ];
    const els = {};
    const el = id => els[id] || (els[id] = {
      id, value: "", innerHTML: "", textContent: "",
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {}
    });
    ["status", "payment", "source", "dateFilter", "attention"].forEach(id => { el(id).value = "all"; });
    el("sort").value = "delivery";
    const ctx = {
      console, URL, URLSearchParams, Intl,
      location: { pathname: "/bestellingen.html", search: "", hash: "", origin: "https://famo.test" },
      history: { replaceState: (s, t, url) => { ctx.location.search = new URL(url, "https://famo.test").search; } },
      document: { getElementById: el },
      famoStaff: {
        bindLogin: () => ({ enter() {}, logout() {} }),
        getRole: () => "staff",
        translateError: m => m,
        api: async () => ({ ok: true, json: async () => ({ orders: ORDERS_R }) })
      }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-i18n.js"), "utf8"), ctx);
    vm.runInContext(inline, ctx);
    const refs = () => [...el("board").innerHTML.matchAll(/class="m-card-ref">([^<]+)</g)].map(m => m[1]);

    // R3 — tri par défaut : en retard, aujourd'hui, plus tard, sans date en dernier.
    await ctx.load();
    assert.deepEqual(refs(), ["CMD-D", "CMD-C", "CMD-A", "CMD-B"], "R3 tri par leverdatum par défaut");

    // R4 — sur chaque carte, la date vient avant la référence.
    const tops = [...el("board").innerHTML.matchAll(/<div class="m-card-top"><span class="m-card-date([^"]*)">([^<]+)<\/span><span class="m-card-ref">([^<]+)<\/span><\/div>/g)];
    assert.equal(tops.length, 4, "R4 date puis référence sur les 4 cartes");
    const byRef = Object.fromEntries(tops.map(m => [m[3], { cls: m[1], label: m[2] }]));
    assert.match(byRef["CMD-D"].cls, /m-late/, "R4 livraison en retard signalée");
    assert.equal(byRef["CMD-C"].label, "Vandaag", "R4 livraison du jour");
    assert.equal(byRef["CMD-B"].label, "Geen leverdatum", "R4 sans date : libellé explicite");
    assert.match(byRef["CMD-B"].cls, /m-nodate/, "R4 sans date : style discret");

    // R5 — les autres tris restent disponibles ; seul le défaut est absent de l'URL.
    el("sort").value = "recent";
    ctx.onFilterChange();
    assert.deepEqual(refs(), ["CMD-A", "CMD-B", "CMD-C", "CMD-D"], "R5 Nieuwste eerst toujours disponible");
    assert.equal(ctx.location.search, "?sort=recent", "R5 tri non défaut conservé dans l'URL");
    el("sort").value = "delivery";
    ctx.onFilterChange();
    assert.equal(ctx.location.search, "", "R5 tri par défaut absent de l'URL");

    // R6 — colonne Gefactureerd : les plus récentes en haut ; les autres colonnes restent croissantes.
    ORDERS_R.push(
      { id: "f1", ref: "CMD-F1", client: "Resto E", statut: "Facturée", date: shift(-9), dateLiv: shift(-8), total: 10, paiement: "Payé", lignes: "" },
      { id: "f2", ref: "CMD-F2", client: "Resto F", statut: "Facturée", date: shift(-3), dateLiv: shift(-2), total: 10, paiement: "Payé", lignes: "" },
      { id: "f3", ref: "CMD-F3", client: "Resto G", statut: "Facturée", date: shift(-6), dateLiv: shift(-5), total: 10, paiement: "Payé", lignes: "" }
    );
    await ctx.load();
    const colRefs = key => {
      const section = new RegExp('data-col="' + key + '">([\\s\\S]*?)</section>').exec(el("board").innerHTML);
      return [...section[1].matchAll(/class="m-card-ref">([^<]+)</g)].map(m => m[1]);
    };
    assert.deepEqual(colRefs("Facturée"), ["CMD-F2", "CMD-F3", "CMD-F1"], "R6 Gefactureerd : plus récentes en haut");
    assert.deepEqual(colRefs("Reçue"), ["CMD-D", "CMD-C", "CMD-A", "CMD-B"], "R6 Ontvangen reste par leverdatum croissante");
  }
  console.log("✓ R. Bestellingen : leverdatum en avant, référence secondaire, tri par leverdatum par défaut");

  // --- S. Catalogue : photos (Foto) et calibres (Kaliber) ------------------------
  {
    // S1 — API catalogue client : Kaliber et Foto exposés proprement.
    const catalogueS = require(path.join(ROOT, "api", "catalogue.js"));
    const AT = "https://v5.airtableusercontent.com/";
    const CLIENT_S = { records: [{ id: "clientFoto", fields: { "Nom": "Resto Foto", "Wachtwoord": "pass" } }] };
    const CAT_S = { records: [
      { id: "s1", fields: { "Produit": "Zalm", "Unité": "kg", "Prix de base": 12.5, "Kaliber": "  3–4 kg  ",
        "Foto": [{ url: AT + "zalm.jpg", type: "image/jpeg", thumbnails: { small: { url: AT + "zalm-s.jpg" }, large: { url: AT + "zalm-l.jpg" } } }] } },
      { id: "s2", fields: { "Produit": "Mosselen", "Unité": "caisse", "Prix de base": 28,
        "Foto": [{ url: AT + "fiche.pdf", type: "application/pdf", thumbnails: { large: { url: AT + "fiche-l.png" } } }, { url: AT + "mossel.png", type: "image/png" }] } },
      { id: "s3", fields: { "Produit": "Kabeljauw", "Unité": "kg", "Prix de base": 20, "Foto": [{ url: "http://insecure.test/k.jpg", type: "image/jpeg" }] } },
      { id: "s4", fields: { "Produit": "Tong", "Unité": "kg", "Prix de base": 30 } }
    ] };
    const rS = await call(catalogueS, { user: "foto", pw: "pass" }, [CLIENT_S, CAT_S, { records: [] }, { records: [] }]);
    assert.equal(rS.res.statusCode, 200, "S1 login catalogue");
    const byName = Object.fromEntries(rS.res.payload.products.map(p => [p.nom, p]));
    assert.equal(byName.Zalm.foto, AT + "zalm-l.jpg", "S1 vignette large préférée");
    assert.equal(byName.Zalm.kaliber, "3–4 kg", "S1 kaliber nettoyé");
    assert.equal(byName.Mosselen.foto, AT + "mossel.png", "S1 pièce jointe non image (PDF) ignorée");
    assert.equal(byName.Kabeljauw.foto, "", "S1 lien non https refusé");
    assert.equal(byName.Tong.foto, "", "S1 sans photo : vide");
    assert.equal(byName.Tong.kaliber, "", "S1 sans kaliber : vide");

    // S2 — Beheer (API) : kaliber enregistré, vidé si demandé, jamais effacé par « Uit catalogus ».
    const onboardingS = require(path.join(ROOT, "api", "onboarding.js"));
    const originalFetch = global.fetch;
    const writes = [];
    global.fetch = async (url, options) => {
      const u = decodeURIComponent(String(url));
      const method = (options && options.method) || "GET";
      if (/\/Catalogue/.test(u) && (method === "POST" || method === "PATCH")) {
        const b = JSON.parse(options.body);
        writes.push(method === "POST" ? b.records[0].fields : b.fields);
      }
      if (/\/Catalogue\?/.test(u) && method === "GET") {
        return json({ records: [{ id: "s1", fields: { "Produit": "Zalm", "Unité": "kg", "Prix de base": 12.5, "Kaliber": "3–4 kg", "Actif": true } }] });
      }
      return json({ records: [] });
    };
    try {
      const save = async body => {
        const res = mkRes();
        await onboardingS({ method: "POST", body: Object.assign({ action: "saveProduct", id: "s1", nom: "Zalm", base: 12.5, unite: "kg", cat: "Vis" }, body), headers: adminCookieHdr }, res);
        return res;
      };
      let s = await save({ kaliber: " 3–4 kg ", actif: true });
      assert.equal(s.statusCode, 200, "S2 produit enregistré");
      assert.equal(writes.pop()["Kaliber"], "3–4 kg", "S2 kaliber enregistré");
      assert.equal(s.payload.products[0].kaliber, "3–4 kg", "S2 Beheer relit le kaliber (pré-remplissage)");
      s = await save({ kaliber: "" });
      assert.strictEqual(writes.pop()["Kaliber"], "", "S2 kaliber vidé volontairement");
      s = await save({ actif: false });
      assert.ok(!("Kaliber" in writes.pop()), "S2 « Uit catalogus » n'efface pas le kaliber");
    } finally {
      global.fetch = originalFetch;
    }

    // S3 — Beheer (page) : le champ Kaliber part avec le produit.
    const beheerS = fs.readFileSync(path.join(ROOT, "beheer.html"), "utf8");
    assert.match(beheerS, /id="pkal"/, "S3 champ Kaliber présent dans le formulaire produit");
    const saveProductSrc = /async function saveProduct\(\)\{[\s\S]*?\n\}/.exec(beheerS);
    const sentS = [];
    const ctxB = { val: id => ({ pnom: "Zalm", pprix: "12.5", punit: "kg", pcat: "Vis", pkal: "3–4 kg" })[id] || "", toast: () => {}, render: () => {}, EDIT_PRODUCT: null, post: async body => { sentS.push(body); return false; } };
    vm.runInNewContext(saveProductSrc[0], ctxB);
    await ctxB.saveProduct();
    assert.equal(sentS[0].kaliber, "3–4 kg", "S3 kaliber envoyé à l'API");

    // S4 — portail client : photo et kaliber sur la carte produit, échappés.
    const indexSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const escSrc = /const esc=s=>[^\n]*/.exec(indexSrc)[0];
    const cardSrc = /function productCard\(\{p,i\}\)\{[^\n]*/.exec(indexSrc)[0];
    const ctxC = { panier: {}, comments: {}, favs: {}, stepFor: () => 1, eur: n => "€ " + n, unitLabel: u => u, icon: () => "" };
    vm.createContext(ctxC);
    vm.runInContext(escSrc + "\n" + cardSrc, ctxC);
    const withPhoto = ctxC.productCard({ p: { id: "s1", nom: "Zalm", prix: 12.5, base: 12.5, unite: "kg", kaliber: "3–4 kg", foto: AT + "zalm-l.jpg?a=1&b=2" }, i: 0 });
    assert.match(withPhoto, /<img class="product-photo" src="https:\/\/v5\.airtableusercontent\.com\/zalm-l\.jpg\?a=1&amp;b=2"/, "S4 photo affichée, URL échappée");
    assert.match(withPhoto, /loading="lazy"/, "S4 photo chargée à la demande");
    assert.match(indexSrc, /\n\s*\.product-row\{flex-wrap:wrap;row-gap:8px\}/, "S4 toutes les cartes passent sur deux lignes si la place manque");
    assert.match(withPhoto, /class="product-kaliber">Kaliber 3–4 kg</, "S4 kaliber affiché");
    const bare = ctxC.productCard({ p: { id: "s4", nom: "Tong", prix: 30, base: 30, unite: "kg", kaliber: "", foto: "" }, i: 1 });
    assert.ok(!/<img/.test(bare) && !/Kaliber/.test(bare), "S4 sans photo ni kaliber : rien d'ajouté");
    const evil = ctxC.productCard({ p: { id: "x", nom: "X", prix: 1, base: 1, unite: "kg", kaliber: "<img src=x onerror=alert(1)>", foto: 'https://x.test/a.jpg" onerror="alert(1)' }, i: 2 });
    assert.ok(!/<img src=x/.test(evil) && !/" onerror="alert/.test(evil), "S4 kaliber et adresse photo échappés");
  }
  console.log("✓ S. Catalogue : photos et kalibers (API, Beheer, carte client)");

  // --- T. Numérotation lisible des commandes : CMD-<année>-NNNN ------------------
  {
    const orderNumber = require(path.join(ROOT, "lib", "ordernumber.js"));
    const year = orderNumber.brusselsYear();
    const fakeAt = pages => {
      const seen = [];
      return { seen, at: async p => { seen.push(decodeURIComponent(p)); return pages.shift(); } };
    };
    const refRecord = ref => ({ records: [{ fields: { "Référence": ref } }] });

    // T1 — première commande de l'année, puis numéro suivant ; une seule requête ciblée.
    let f = fakeAt([{ records: [] }]);
    assert.equal(await orderNumber.nextOrderRef(f.at), `CMD-${year}-0001`, "T1 première commande de l'année");
    assert.equal(f.seen.length, 1, "T1 une seule requête Airtable");
    assert.ok(f.seen[0].includes(`REGEX_MATCH({Référence}, "^CMD-${year}-[0-9]{4}$")`), "T1 filtre : année en cours, 4 chiffres");
    assert.ok(f.seen[0].includes("sort[0][field]=Référence&sort[0][direction]=desc&maxRecords=1"), "T1 tri décroissant, un seul enregistrement");
    f = fakeAt([refRecord(`CMD-${year}-0041`)]);
    assert.equal(await orderNumber.nextOrderRef(f.at), `CMD-${year}-0042`, "T1 numéro suivant");

    // T2 — les anciennes références horodatées ne comptent jamais.
    f = fakeAt([refRecord("CMD-1789309163572")]);
    assert.equal(await orderNumber.nextOrderRef(f.at), `CMD-${year}-0001`, "T2 référence horodatée ignorée");

    // T3 — au-delà de 9999 : lecture des numéros à 5 chiffres et plus.
    f = fakeAt([refRecord(`CMD-${year}-9999`), refRecord(`CMD-${year}-10007`)]);
    assert.equal(await orderNumber.nextOrderRef(f.at), `CMD-${year}-10008`, "T3 séquence au-delà de 9999");
    assert.ok(f.seen[1].includes("[0-9]{5,}"), "T3 seconde requête sur 5 chiffres et plus");
    f = fakeAt([refRecord(`CMD-${year}-9999`), { records: [] }]);
    assert.equal(await orderNumber.nextOrderRef(f.at), `CMD-${year}-10000`, "T3 passage de 9999 à 10000");

    // T4 — année civile à l'heure de Bruxelles : nouvelle année, nouvelle séquence.
    assert.equal(orderNumber.brusselsYear(new Date("2026-12-31T23:30:00Z")), 2027, "T4 31/12 23:30 UTC = déjà 2027 à Bruxelles");
    f = fakeAt([{ records: [] }]);
    assert.equal(await orderNumber.nextOrderRef(f.at, new Date("2026-12-31T23:30:00Z")), "CMD-2027-0001", "T4 première commande de 2027");

    // T5 — Airtable en erreur ou réseau coupé : la commande n'est jamais bloquée.
    const originalError = console.error;
    console.error = () => {};
    try {
      f = fakeAt([{ error: { message: "rate limit" } }]);
      assert.match(await orderNumber.nextOrderRef(f.at), /^CMD-\d{13}$/, "T5 repli horodaté si Airtable répond en erreur");
      assert.match(await orderNumber.nextOrderRef(async () => { throw new Error("réseau"); }), /^CMD-\d{13}$/, "T5 repli horodaté si le réseau tombe");
    } finally {
      console.error = originalError;
    }

    // T6 — portail client et saisie staff partagent la même séquence.
    const CLIENT_T = { records: [{ id: "clientT", fields: { "Nom": "Resto T", "Wachtwoord": "pass" } }] };
    const CAT_T = { records: [{ id: "pT", fields: { "Produit": "Zalm", "Unité": "kg", "Prix de base": 10 } }] };
    const ITEMS_T = [{ productId: "pT", quantity: 1 }];
    let rT = await call(createOrder, { user: "tnum", pw: "pass", items: ITEMS_T }, [CLIENT_T, CAT_T, { records: [] }, refRecord(`CMD-${year}-0007`), { records: [{ id: "orderT" }] }]);
    assert.equal(rT.res.statusCode, 200, "T6 commande client");
    assert.equal(rT.res.payload.ref, `CMD-${year}-0008`, "T6 référence renvoyée au client");
    assert.equal(JSON.parse(rT.calls[4].options.body).records[0].fields["Référence"], `CMD-${year}-0008`, "T6 référence enregistrée dans Airtable");
    const staffT = require(path.join(ROOT, "api", "staff.js"));
    rT = await call(staffT, { clientId: "clientT", items: ITEMS_T }, [CAT_T, { records: [] }, refRecord(`CMD-${year}-0008`), { records: [{ id: "orderT2" }] }], { headers: adminCookieHdr });
    assert.equal(rT.res.statusCode, 200, "T6 saisie staff");
    assert.equal(rT.res.payload.ref, `CMD-${year}-0009`, "T6 saisie staff dans la même séquence");
  }
  console.log("✓ T. Numérotation des commandes (CMD-<année>-NNNN, séquence, repli sûr)");

  // --- U. Magazijn : groepsactie (sélection multiple, un appel par commande) -------
  {
    const pageSrc = fs.readFileSync(path.join(ROOT, "entrepot.html"), "utf8");
    const block = /\/\* ====== Groepsactie[\s\S]*?\/\* ====== einde groepsactie ====== \*\//.exec(pageSrc);
    assert.ok(block, "U0 bloc groepsactie introuvable dans entrepot.html");
    assert.match(pageSrc, /id="bulkBar"/, "U0 barre de groepsactie présente");
    assert.match(pageSrc, /onchange="toggleSelect\(this\.dataset\.id,this\.checked\)"/, "U0 case à cocher sur les cartes");

    const ORDERS_U = [
      { id: "a", ref: "CMD-2026-0001", client: "Resto A", statut: "Prête", preparationValidee: true },
      { id: "b", ref: "CMD-2026-0002", client: "Resto B", statut: "Prête", preparationValidee: true },
      { id: "c", ref: "CMD-2026-0003", client: "Resto C", statut: "Prête", preparationValidee: false },
      { id: "d", ref: "CMD-2026-0004", client: "Resto D", statut: "Reçue", preparationValidee: true },
      { id: "e", ref: "CMD-2026-0005", client: "Resto E", statut: "Sortie en livraison", preparationValidee: true },
      { id: "f", ref: "CMD-2026-0006", client: "Resto F", statut: "Facturée", preparationValidee: true }
    ];
    const els = {};
    const el = id => els[id] || (els[id] = { id, textContent: "", innerHTML: "", disabled: false, onclick: null, classList: { add() {}, remove() {}, toggle() {} } });
    const apiCalls = [];
    let inflight = 0, maxInflight = 0, loads = 0;
    let respond = () => ({ ok: true, body: {} });
    const ctx = {
      console,
      STATUS: ["Reçue", "Prête", "Sortie en livraison", "Facturée"],
      NEXTLBL: { "Prête": "→ Klaar", "Sortie en livraison": "→ Onderweg", "Facturée": "→ Gefactureerd" },
      ORDERS: ORDERS_U,
      UPDATING: false,
      esc: s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
      orderView: () => ORDERS_U.map((o, idx) => ({ o, idx })),
      load: async () => { loads++; },
      closeAdvanceModal: () => {},
      document: { getElementById: el, querySelectorAll: () => [] },
      famoStaff: {
        translateError: m => m,
        api: async (url, opts) => {
          inflight++;
          maxInflight = Math.max(maxInflight, inflight);
          const patch = JSON.parse(opts.body);
          apiCalls.push({ url, patch });
          await new Promise(resolve => setTimeout(resolve, 5));
          inflight--;
          const out = respond(patch);
          if (out.throw) throw out.throw;
          return { ok: out.ok, json: async () => out.body };
        }
      }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-i18n.js"), "utf8"), ctx);
    vm.runInContext(block[0], ctx);

    // U1 — même règle que le bouton de la carte : seule une commande Klaar validée avance.
    assert.deepEqual(ORDERS_U.map(o => ctx.advanceTarget(o)), ["Sortie en livraison", "Sortie en livraison", null, null, null, null], "U1 seules les commandes Klaar validées sont éligibles");

    // U2 — « Alles selecteren » ne prend que les éligibles ; la confirmation maison liste les commandes.
    ctx.selectAllEligible();
    assert.equal(el("bulkCount").textContent, "2 geselecteerd", "U2 deux commandes sélectionnées");
    assert.equal(el("bulkGo").textContent, "→ Onderweg (2)", "U2 libellé de l'action groupée");
    ctx.confirmBulkAdvance();
    assert.match(el("advanceText").textContent, /^2 bestellingen naar ‘Onderweg’ verplaatsen: CMD-2026-0001, CMD-2026-0002\./, "U2 la confirmation liste les commandes");
    assert.match(el("advanceText").textContent, /afzonderlijk bijgewerkt/, "U2 la confirmation annonce le traitement commande par commande");

    // U3 — une passe, une échoue : un appel par commande, l'un après l'autre, résultat nommé.
    respond = patch => patch.id === "b" ? { ok: false, body: { error: "Valideer eerst alle artikelen van deze bestelling" } } : { ok: true, body: {} };
    await el("advanceConfirm").onclick();
    assert.equal(apiCalls.length, 2, "U3 un appel par commande");
    assert.equal(maxInflight, 1, "U3 appels l'un après l'autre, jamais en parallèle");
    apiCalls.forEach(c => {
      assert.equal(c.url, "/api/updateorder", "U3 API existante, sans lot");
      assert.equal(c.patch.statut, "Sortie en livraison", "U3 statut cible");
      assert.strictEqual(c.patch.skipStock, true, "U3 même règle de stock que la carte");
    });
    const res3 = el("bulkResult").innerHTML;
    assert.match(res3, /Groepsactie: 1 van 2 gelukt/, "U3 résumé lisible");
    assert.match(res3, /br-ok"><span class="br-state">Gelukt<\/span><span class="br-ref">CMD-2026-0001<\/span>/, "U3 la commande réussie est nommée");
    assert.match(res3, /br-fail"><span class="br-state">Mislukt<\/span><span class="br-ref">CMD-2026-0002<\/span><span class="br-client">Resto B<\/span><span class="br-msg">Valideer eerst alle artikelen van deze bestelling<\/span>/, "U3 la commande en échec est nommée, avec la raison du serveur");
    assert.equal(loads, 1, "U3 le bord est rechargé une fois, à la fin");
    assert.equal(el("bulkCount").textContent, "1 geselecteerd", "U3 la commande en échec reste sélectionnée");
    assert.strictEqual(ctx.UPDATING, false, "U3 écran débloqué après le lot");

    // U4 — commande plus éligible entre-temps : non exécutée, sans appel, raison affichée.
    apiCalls.length = 0;
    respond = () => ({ ok: true, body: {} });
    await ctx.runBulkAdvance(["c", "a"]);
    assert.deepEqual(apiCalls.map(c => c.patch.id), ["a"], "U4 seule la commande éligible est envoyée");
    assert.match(el("bulkResult").innerHTML, /br-skipped"><span class="br-state">Niet uitgevoerd<\/span><span class="br-ref">CMD-2026-0003<\/span>/, "U4 commande non éligible signalée");

    // U5 — session expirée : arrêt immédiat, les suivantes sont marquées non exécutées.
    apiCalls.length = 0;
    respond = () => ({ throw: Object.assign(new Error("Sessie verlopen. Meld u opnieuw aan."), { sessionExpired: true }) });
    await ctx.runBulkAdvance(["a", "b"]);
    assert.equal(apiCalls.length, 1, "U5 arrêt après une session expirée");
    const res5 = el("bulkResult").innerHTML;
    assert.match(res5, /Groepsactie: 0 van 2 gelukt/, "U5 résumé");
    assert.match(res5, /br-skipped"><span class="br-state">Niet uitgevoerd<\/span><span class="br-ref">CMD-2026-0002<\/span>[\s\S]*sessie verlopen/, "U5 la suivante n'est pas exécutée, raison claire");
  }
  console.log("✓ U. Magazijn : groepsactie (éligibilité, un appel par commande, résultat par commande)");

  // --- V. Beheer : prix négociés depuis la fiche client --------------------------
  {
    const onboardingV = require(path.join(ROOT, "api", "onboarding.js"));
    const NEG_V = { records: [
      { id: "nv1", fields: { "Client": ["clientV"], "Produit": ["pBestaand"], "Prix négocié": 11 } },
      { id: "nv2", fields: { "Client": ["clientV"], "Produit": ["pLeeg"], "Prix négocié": 9 } },
      { id: "nv3", fields: { "Client": ["andereKlant"], "Produit": ["pNieuw"], "Prix négocié": 5 } }
    ] };
    const originalFetch = global.fetch;
    const writes = [];
    let failProduct = "";
    global.fetch = async (url, options) => {
      const u = decodeURIComponent(String(url));
      const method = (options && options.method) || "GET";
      if (/Prix négociés/.test(u) && (method === "POST" || method === "PATCH")) {
        const b = JSON.parse(options.body);
        const fields = method === "POST" ? b.records[0].fields : b.fields;
        if (fields["Produit"][0] === failProduct) throw new Error("netwerk weg");
        writes.push({ method, url: u, fields });
        return json(method === "POST" ? { records: [{ id: "nieuw" }] } : { id: "x" });
      }
      return json(/Prix négociés/.test(u) ? NEG_V : { records: [] });
    };
    try {
      const send = async (prices, headers) => {
        const res = mkRes();
        await onboardingV({ method: "POST", body: { action: "saveClientPrices", clientId: "clientV", prices }, headers: headers || adminCookieHdr }, res);
        return res;
      };

      // V1 — réservé à l'admin.
      assert.equal((await send([{ productId: "pNieuw", prix: 7 }], cookieHdr)).statusCode, 401, "V1 personnel refusé");
      assert.equal(writes.length, 0, "V1 rien écrit");

      // V2 — plusieurs produits en un envoi : création, mise à jour, vidage, 0.
      let r = await send([
        { productId: "pNieuw", prix: 7.456 },
        { productId: "pBestaand", prix: 12 },
        { productId: "pLeeg", prix: null },
        { productId: "pNul", prix: 0 }
      ]);
      assert.equal(r.statusCode, 200, "V2 envoi accepté");
      assert.deepEqual(r.payload.results.map(x => [x.productId, x.ok]), [["pNieuw", true], ["pBestaand", true], ["pLeeg", true], ["pNul", true]], "V2 un résultat par produit");
      const byProd = Object.fromEntries(writes.map(w => [w.fields["Produit"][0], w]));
      assert.equal(byProd.pNieuw.method, "POST", "V2 nouveau prix créé (l'accord d'un autre client n'est pas touché)");
      assert.equal(byProd.pNieuw.fields["Prix négocié"], 7.46, "V2 arrondi au cent");
      assert.ok(byProd.pBestaand.method === "PATCH" && /nv1$/.test(byProd.pBestaand.url), "V2 accord existant mis à jour");
      assert.strictEqual(byProd.pLeeg.fields["Prix négocié"], null, "V2 champ vidé → enregistré vide (prix de base)");
      assert.strictEqual(byProd.pNul.fields["Prix négocié"], 0, "V2 0 saisi → 0");
      assert.ok(Array.isArray(r.payload.prices), "V2 Beheer reçoit les données à jour");

      // V3 — un prix refusé ou une écriture en échec n'empêche pas les autres.
      writes.length = 0;
      failProduct = "pBestaand";
      r = await send([
        { productId: "pNieuw", prix: "abc" },
        { productId: "pBestaand", prix: 13 },
        { productId: "pNul", prix: 4 }
      ]);
      assert.equal(r.statusCode, 200, "V3 réponse lisible même en échec partiel");
      assert.strictEqual(r.payload.ok, false, "V3 échec partiel signalé");
      const res3 = Object.fromEntries(r.payload.results.map(x => [x.productId, x]));
      assert.ok(!res3.pNieuw.ok && /Ongeldige prijs/.test(res3.pNieuw.error), "V3 prix illisible refusé, avec raison");
      assert.ok(!res3.pBestaand.ok && res3.pBestaand.error, "V3 écriture en échec nommée");
      assert.ok(res3.pNul.ok, "V3 les autres produits sont enregistrés");
      assert.deepEqual(writes.map(w => w.fields["Produit"][0]), ["pNul"], "V3 seule l'écriture valide est passée");

      // V4 — envoi vide refusé proprement.
      assert.equal((await send([])).statusCode, 400, "V4 liste vide refusée");
    } finally {
      global.fetch = originalFetch;
    }

    // V5 — page : section dans la fiche, champs pré-remplis, vide = basisprijs, échappement.
    const beheerV = fs.readFileSync(path.join(ROOT, "beheer.html"), "utf8");
    const blockV = /\/\* ====== Prijzen in de klantfiche[\s\S]*?\/\* ====== einde prijzen klantfiche ====== \*\//.exec(beheerV);
    assert.ok(blockV, "V5 bloc prijzen klantfiche introuvable");
    assert.match(beheerV, /\(e\?clientPricesHtml\(e\):''\)/, "V5 la fiche client affiche les prix");
    const saveClientSrc = /async function saveClient\(\)\{[\s\S]*?\n\}/.exec(beheerV)[0];
    assert.ok(/changedClientPrices\(\)/.test(saveClientSrc) && /saveFichePrices\(/.test(saveClientSrc), "V5 « Wijzigingen opslaan » enregistre aussi les prix modifiés");
    const inputs = [];
    const ctxV = {
      console,
      DATA: {
        products: [
          { id: "pZalm", nom: "Zalm", base: 12.5, unite: "kg" },
          { id: "pMossel", nom: "Mosselen <script>", base: 28, unite: "caisse" },
          { id: "pTong", nom: "Tong", base: 30, unite: "kg" }
        ],
        prices: [
          { clientId: "clientV", productId: "pZalm", prix: 11 },
          { clientId: "clientV", productId: "pTong", prix: null },
          { clientId: "andere", productId: "pMossel", prix: 20 }
        ],
        clients: [{ id: "clientV", nom: "Resto V" }]
      },
      famoNL: { unit: u => (u === "caisse" ? "kassa" : u) },
      famoStaff: { translateError: m => m },
      document: { querySelectorAll: () => inputs },
      post: async () => false
    };
    vm.createContext(ctxV);
    vm.runInContext(/const esc=s=>[^\n]*/.exec(beheerV)[0] + "\n" + /const eur=n=>[^\n]*/.exec(beheerV)[0] + "\n" + blockV[0], ctxV);
    const html5 = ctxV.clientPricesHtml({ id: "clientV" });
    const inputOf = (html, id) => new RegExp('data-product="' + id + '" data-initial="([^"]*)" value="([^"]*)"').exec(html).slice(1);
    assert.deepEqual(inputOf(html5, "pZalm"), ["11", "11"], "V5 accord existant pré-rempli");
    assert.deepEqual(inputOf(html5, "pTong"), ["", ""], "V5 prix vide : champ vide (basisprijs)");
    assert.deepEqual(inputOf(html5, "pMossel"), ["", ""], "V5 accord d'un autre client ignoré");
    assert.match(html5, /basisprijs <span class="b-amt">€ 12,50<\/span> \/ kg/, "V5 prix de base affiché");
    assert.match(html5, /\/ kassa/, "V5 unité traduite");
    assert.ok(!/<script>/.test(html5), "V5 nom de produit échappé");

    // V6 — seuls les champs modifiés partent ; une saisie illisible bloque avant tout envoi.
    const fakeInput = (id, initial, value, badInput) => ({ value, dataset: { product: id, initial }, validity: { badInput: !!badInput } });
    inputs.push(fakeInput("pZalm", "11", "11.00"), fakeInput("pTong", "", "0"), fakeInput("pMossel", "", ""), fakeInput("pX", "9", ""));
    let edit = JSON.parse(JSON.stringify(ctxV.changedClientPrices()));
    assert.deepEqual(edit, { changes: [{ productId: "pTong", prix: 0 }, { productId: "pX", prix: null }], bad: [] }, "V6 11,00 = 11 inchangé ; 0 tapé ; champ vidé");
    inputs.push(fakeInput("pBad", "", "", true));
    edit = JSON.parse(JSON.stringify(ctxV.changedClientPrices()));
    assert.deepEqual(edit.bad, ["pBad"], "V6 saisie illisible bloquée");

    // V7 — échec partiel : la raison s'affiche sur la ligne, la saisie est conservée.
    ctxV.post = async () => ({ ok: false, results: [{ productId: "pZalm", ok: true }, { productId: "pTong", ok: false, error: "Ongeldige prijs" }] });
    const out7 = JSON.parse(JSON.stringify(await ctxV.saveFichePrices("clientV", [{ productId: "pZalm", prix: 10 }, { productId: "pTong", prix: 44 }])));
    assert.deepEqual(out7, { saved: 1, failed: 1 }, "V7 décompte par produit");
    const html7 = ctxV.clientPricesHtml({ id: "clientV" });
    assert.deepEqual(inputOf(html7, "pTong"), ["", "44"], "V7 saisie en échec conservée");
    assert.match(html7, /b-price-err" role="alert">Ongeldige prijs</, "V7 raison affichée sur la ligne");
    assert.deepEqual(inputOf(html7, "pZalm"), ["11", "11"], "V7 ligne réussie reprise depuis les données du serveur");

    // V8 — envoi entièrement en échec : rien n'est compté comme enregistré, les saisies restent.
    ctxV.post = async () => false;
    const out8 = JSON.parse(JSON.stringify(await ctxV.saveFichePrices("clientV", [{ productId: "pZalm", prix: 10 }])));
    assert.deepEqual(out8, { saved: 0, failed: 1 }, "V8 échec total signalé");
    assert.deepEqual(inputOf(ctxV.clientPricesHtml({ id: "clientV" }), "pZalm"), ["11", "10"], "V8 saisie conservée pour réessayer");
  }
  console.log("✓ V. Beheer : prix négociés depuis la fiche client (API par produit, page, échec partiel)");

  // silence unused after restore
  assert.ok(authlib2.hasCode());

  console.log("✓ Regles release candidate (validation explicite, 405 GET, 410 cadrage)");
  console.log("✓ Règles métier commande, préparation et livraison");
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
