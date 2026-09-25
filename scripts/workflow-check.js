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

  // --- I. Navigation v2 : destinations quotidiennes et séparation des rôles ---
  {
    const ui = fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8");
    assert.match(ui, /const NAV_DAILY\s*=\s*\[\["bestellingen\.html",\s*"Bestellingen"[\s\S]*?\["entrepot\.html",\s*"Magazijn"[\s\S]*?\["leveringen\.html",\s*"Leveringen"/, "I destinations quotidiennes v2");
    assert.match(ui, /const NAV_ADMIN\s*=\s*\[\["invoer\.html",\s*"Invoeren"[\s\S]*?\["documenten\.html",\s*"Documenten"[\s\S]*?\["beheer\.html",\s*"Beheer"/, "I destinations beheer v2");
    assert.match(ui, /const NAV_STAFF_MORE\s*=\s*\[\["documenten\.html",\s*"Documenten"/, "I personnel sans écrans administrateur");
    assert.match(ui, /admin\s*\?\s*NAV_ADMIN\s*:\s*NAV_STAFF_MORE/, "I menu sélectionné selon le rôle");
    assert.match(ui, /admin\s*\?\s*'<a class="nav'[\s\S]*?href="\/stock\.html"/, "I stock réservé au menu beheer");
  }
  console.log("✓ I. Navigation v2 (Dagelijks, Beheer, séparation des rôles)");

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

    // P7 — Beheer v2 : les valeurs sont envoyées sans coercition numérique ;
    // l'API applique ensuite negotiatedValue (vide → null, 0 conservé).
    const beheerSrc = fs.readFileSync(path.join(ROOT, "assets", "pages", "beheer.js"), "utf8");
    const onboardingSrc = fs.readFileSync(path.join(ROOT, "api", "onboarding.js"), "utf8");
    assert.match(beheerSrc, /action:\s*"saveClientPrices"[\s\S]*?String\(prix\)\.replace\(",",\s*"\."\)/, "P7 valeurs de prix envoyées par Beheer v2");
    assert.match(onboardingSrc, /action\s*===\s*"saveClientPrices"[\s\S]*?negotiatedValue\(raw\)/, "P7 conversion vide → null et 0 conservé côté API");
  }
  console.log("✓ P. Prix négocié (vide → prix de base, 0 saisi → 0, catalogue = commande = staff = recalcul)");

  // --- AL. Portail client : le client change lui-même son mot de passe -----------------
  // Pas de session client côté serveur : l'API ne modifie QUE le client qu'elle vient de
  // vérifier (gebruikersnaam + mot de passe actuel), jamais un identifiant du navigateur.
  {
    const klantPw = require(path.join(ROOT, "api", "klantwachtwoord.js"));
    const clientRec = (id, user, pw) => ({ records: [{ id, fields: { "Nom": "Resto " + user, "Gebruikersnaam": user, "Wachtwoord": pw } }] });
    const patchesAL = calls => calls.filter(c => (c.options.method || "GET").toUpperCase() === "PATCH");
    const lookupAL = calls => decodeURIComponent((calls.find(c => /\/Clients\?filterByFormula=/.test(c.url)) || { url: "" }).url);

    // AL1 — ancien mot de passe correct : un seul PATCH, sur ce client, dans le champ Wachtwoord.
    let r = await call(klantPw, { user: "anna", pw: "oud-wachtwoord", nieuw: "nieuw-wachtwoord" }, [
      clientRec("recAnna", "anna", "oud-wachtwoord"),
      { id: "recAnna", fields: { "Wachtwoord": "nieuw-wachtwoord" } }
    ]);
    assert.equal(r.res.statusCode, 200, "AL1 ancien mot de passe correct → changement accepté");
    assert.deepEqual(r.res.payload, { ok: true }, "AL1 le mot de passe n'est jamais renvoyé");
    assert.match(lookupAL(r.calls), /LOWER\(\{Gebruikersnaam\}\)='anna'/, "AL1 le client est retrouvé par son gebruikersnaam");
    assert.equal(patchesAL(r.calls).length, 1, "AL1 exactement un PATCH");
    assert.match(patchesAL(r.calls)[0].url, /\/Clients\/recAnna$/, "AL1 PATCH sur le client vérifié");
    assert.deepEqual(JSON.parse(patchesAL(r.calls)[0].options.body), { fields: { "Wachtwoord": "nieuw-wachtwoord" } }, "AL1 même champ Wachtwoord qu'aujourd'hui, rien d'autre");

    // AL2 — ancien mot de passe faux (ou client inconnu) : 401, aucune écriture.
    r = await call(klantPw, { user: "anna", pw: "fout-wachtwoord", nieuw: "nieuw-wachtwoord" }, [clientRec("recAnna", "anna", "oud-wachtwoord")]);
    assert.equal(r.res.statusCode, 401, "AL2 ancien mot de passe faux → refusé");
    assert.match(r.res.payload.error, /huidige wachtwoord klopt niet/, "AL2 message clair");
    assert.equal(patchesAL(r.calls).length, 0, "AL2 aucune écriture");
    r = await call(klantPw, { user: "bestaatniet", pw: "wat-dan-ook", nieuw: "nieuw-wachtwoord" }, [{ records: [] }]);
    assert.equal(r.res.statusCode, 401, "AL2 client inconnu → même refus (pas d'indice sur l'existence du compte)");
    assert.equal(patchesAL(r.calls).length, 0, "AL2 aucune écriture pour un client inconnu");

    // AL3 — longueur : 7 caractères refusés sans même lire Airtable, 8 acceptés, 81 refusés.
    r = await call(klantPw, { user: "anna", pw: "oud-wachtwoord", nieuw: "kort123" }, []);
    assert.equal(r.res.statusCode, 400, "AL3 nouveau trop court → refusé");
    assert.match(r.res.payload.error, /minstens 8 tekens/, "AL3 message clair");
    assert.equal(r.calls.length, 0, "AL3 aucun appel Airtable");
    r = await call(klantPw, { user: "anna", pw: "oud-wachtwoord", nieuw: "x".repeat(81) }, []);
    assert.equal(r.res.statusCode, 400, "AL3 plus de 80 caractères → refusé");
    r = await call(klantPw, { user: "anna", pw: "oud-wachtwoord", nieuw: 123456789 }, []);
    assert.equal(r.res.statusCode, 400, "AL3 nouveau mot de passe non textuel → refusé");
    r = await call(klantPw, { user: "anna", pw: "oud-wachtwoord", nieuw: "precies8" }, [
      clientRec("recAnna", "anna", "oud-wachtwoord"), { id: "recAnna", fields: {} }
    ]);
    assert.equal(r.res.statusCode, 200, "AL3 8 caractères acceptés");

    // AL4 — un client ne peut pas changer le mot de passe d'un autre.
    // AL4a : Anna vise le compte de Bert avec SON propre mot de passe → refusé, rien n'est écrit.
    r = await call(klantPw, { user: "bert", pw: "oud-wachtwoord", nieuw: "overgenomen-1" }, [clientRec("recBert", "bert", "bert-geheim")]);
    assert.equal(r.res.statusCode, 401, "AL4a user d'un autre client + mauvais mot de passe → refusé");
    assert.equal(patchesAL(r.calls).length, 0, "AL4a aucune écriture sur le compte de Bert");
    // AL4b : Anna glisse l'identifiant de Bert dans la requête → ignoré, seul son propre compte change.
    r = await call(klantPw, { user: "anna", pw: "oud-wachtwoord", nieuw: "nieuw-wachtwoord", id: "recBert", clientId: "recBert", client: "recBert", recordId: "recBert" }, [
      clientRec("recAnna", "anna", "oud-wachtwoord"), { id: "recAnna", fields: {} }
    ]);
    assert.equal(r.res.statusCode, 200, "AL4b requête d'Anna acceptée pour son propre compte");
    assert.equal(patchesAL(r.calls).length, 1, "AL4b un seul PATCH");
    assert.match(patchesAL(r.calls)[0].url, /\/Clients\/recAnna$/, "AL4b le PATCH vise Anna");
    assert.ok(!r.calls.some(c => /recBert/.test(c.url)), "AL4b l'identifiant de Bert n'est jamais utilisé");
    // AL4c : apostrophes dans le gebruikersnaam → pas d'injection dans la formule Airtable.
    r = await call(klantPw, { user: "bert' OR '1'='1", pw: "oud-wachtwoord", nieuw: "overgenomen-1" }, [{ records: [] }]);
    assert.equal(r.res.statusCode, 401, "AL4c injection de formule → refusée");
    assert.equal((lookupAL(r.calls).match(/'/g) || []).length, 2, "AL4c apostrophes retirées de la formule");
    // AL4d : garde statique — la route ne lit aucun identifiant de client dans le body.
    const srcAL = fs.readFileSync(path.join(ROOT, "api", "klantwachtwoord.js"), "utf8");
    assert.ok(!/q\.(id|clientId|client|recordId)\b/.test(srcAL), "AL4d aucun identifiant client lu dans la requête");
    assert.match(srcAL, /Clients\/\$\{encodeURIComponent\(client\.id\)\}/, "AL4d PATCH construit depuis le client vérifié");

    // AL5 — GET refusé, nouveau = ancien refusé, 6e tentative ratée bloquée.
    {
      const res = mkRes();
      await klantPw({ method: "GET", query: { user: "anna", pw: "oud-wachtwoord", nieuw: "nieuw-wachtwoord" }, headers: {} }, res);
      assert.equal(res.statusCode, 405, "AL5 GET → 405 (pas de mot de passe dans une URL)");
    }
    r = await call(klantPw, { user: "anna", pw: "zelfde-wachtwoord", nieuw: "zelfde-wachtwoord" }, []);
    assert.equal(r.res.statusCode, 400, "AL5 nouveau identique à l'ancien → refusé");
    assert.equal(r.calls.length, 0, "AL5 aucun appel Airtable");
    for (let i = 1; i <= 5; i++) {
      r = await call(klantPw, { user: "carla", pw: "gok-" + i, nieuw: "nieuw-wachtwoord" }, [clientRec("recCarla", "carla", "juist-wachtwoord")]);
      assert.equal(r.res.statusCode, 401, "AL5 tentative ratée " + i);
    }
    r = await call(klantPw, { user: "carla", pw: "juist-wachtwoord", nieuw: "nieuw-wachtwoord" }, []);
    assert.equal(r.res.statusCode, 429, "AL5 6e tentative en 30 s → bloquée");
    assert.equal(r.calls.length, 0, "AL5 bloquée avant Airtable");

    // AL6 — portail : formulaire relié à l'API, ancien mot de passe jamais comparé dans le navigateur.
    const klantAL = fs.readFileSync(path.join(ROOT, "assets", "pages", "klant.js"), "utf8");
    assert.match(klantAL, /\/api\/klantwachtwoord/, "AL6 Account appelle /api/klantwachtwoord");
    assert.ok(!/\/wachtwoord\.html/.test(klantAL), "AL6 Account ne renvoie plus vers la demande à Famo");
    assert.match(klantAL, /autocomplete="current-password"[\s\S]*autocomplete="new-password"/, "AL6 champs reconnus par les gestionnaires de mots de passe");
    assert.match(klantAL, /json: \{ user: sess\.user, pw: huidig, nieuw \}/, "AL6 le mot de passe actuel envoyé est celui retapé");
    assert.ok(!/(creds\(\)\.pw|sess\.pw)\s*[!=]==/.test(klantAL), "AL6 l'ancien mot de passe n'est jamais vérifié dans le navigateur");
  }
  console.log("✓ AL. Portail client : changer son mot de passe (ancien vérifié serveur, 8 car. min, jamais le compte d'un autre)");

  // Les contrôles Q–AK ci-dessous décrivent le DOM monolithique de la v1.
  // La v2 a remplacé ce DOM par assets/ui.js + assets/pages/*.js : on protège
  // les mêmes capacités via des contrats ciblés, sans exécuter les assertions
  // devenues structurellement impossibles.
  {
    const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
    const common = read("assets/pages/staff-common.js");
    const klant = read("assets/pages/klant.js");
    const orders = read("assets/pages/bestellingen.js");
    const warehouse = read("assets/pages/entrepot.js");
    const deliveries = read("assets/pages/leveringen.js");
    const docs = read("assets/pages/documenten.js");
    const beheer = read("assets/pages/beheer.js");
    const stock = read("assets/pages/stock.js");

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
  console.log("✓ V2. Contrats frontend (workflow, documents, beheer, stock, numérotation)");

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
  console.log("✓ AM. Leverdag vrij (serveur + panier) et wachtwoord au choix dans Beheer");

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
    r = await call(uo, { id: "o6", correction: "bewerken", reden: "klant wil donderdag", dateLivraison: okDay, notes: "achteraan bellen" }, [{ fields: { Statut: "Reçue", "Date livraison souhaitée": "2026-01-05", Notes: "" } }, { fields: {} }], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 200, "AN7 bewerken OK");
    b = patchOf(r); assert.equal(b.fields["Date livraison souhaitée"], okDay); assert.equal(b.fields.Notes, "achteraan bellen"); assert.match(b.fields.Correcties, /leverdag 2026-01-05 → /);
    r = await call(uo, { id: "o6", correction: "bewerken", reden: "klant wil zondag", dateLivraison: sun }, [{ fields: { Statut: "Reçue" } }], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 400, "AN7 zondag geweigerd");
    r = await call(uo, { id: "o6", correction: "bewerken", reden: "te laat", notes: "x" }, [{ fields: { Statut: "Sortie en livraison" } }], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 409, "AN7 na vertrek vergrendeld");
    // 8. Klant annuleert zelf : enkel Reçue, enkel eigen bestelling
    clearModule("api/catalogue.js"); clearModule("api/klantorder.js");
    const ko = require(path.join(ROOT, "api", "klantorder.js"));
    const CLI = { records: [{ id: "cli1", fields: { Gebruikersnaam: "aloha", Wachtwoord: "welkom123", Nom: "Aloha" } }] };
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
    for (const f of ["assets/pages/order.js", "assets/pages/entrepot.js", "assets/pages/leveringen.js"]) assert.match(readF(f), /S\.correctBtn\(o/, "AN10 Corrigeren op " + f);
    assert.match(readF("assets/pages/bestellingen.js"), /value="Annulée"/, "AN10 filter Geannuleerd");
    for (const f of ["assets/pages/entrepot.js", "assets/pages/bestellingen.js", "assets/pages/beheer.js"]) assert.match(readF(f), /K\.isClosed\(o\)/, "AN10 geannuleerd uit het dagwerk : " + f);
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
    assert.match(readF("assets/pages/stock.js"), /inCatalogue === false/, "AN10 orphelins in Voorraad");
    assert.match(readF("assets/pages/stock.js"), /action: "deleteProduct", id: i\.productId/, "AN10 Voorraad verwijdert het product zelf");
    assert.match(readF("api/stock.js"), /actif: prod \? !!prod\.fields\["Actif"\]/, "AN10 Voorraad kent de actief-status");
    assert.ok(!/Catalogue\?filterByFormula=\$\{encodeURIComponent\("\{Actif\}=1"\)\}`\),\n    atAll\("Clients"\)/.test(readF("api/onboarding.js")), "AN10 Beheer laadt ook inactieve producten");
  }
  console.log("✓ AN. Corrections (terug, annuleren, herstellen, bewerken), klant annuleert, product verwijderen, FR/NL klantportaal");

  console.log("✓ Regles release candidate (validation explicite, 405 GET, 410 cadrage)");
  console.log("✓ Règles métier commande, préparation et livraison");
  return;

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
        getRole: () => "staff",
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
    const cardCss = fs.readFileSync(path.join(ROOT, "staff.css"), "utf8"); // styles de carte communs (staff-card.js)
    const px = re => Number((re.exec(cardCss) || [])[1]);
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
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-card.js"), "utf8"), ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-doc-actions.js"), "utf8"), ctx);
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
    // (Impayées : une commande facturée ET payée quitte le bord, voir AA.)
    ORDERS_R.push(
      { id: "f1", ref: "CMD-F1", client: "Resto E", statut: "Facturée", date: shift(-9), dateLiv: shift(-8), total: 10, paiement: "En attente", lignes: "" },
      { id: "f2", ref: "CMD-F2", client: "Resto F", statut: "Facturée", date: shift(-3), dateLiv: shift(-2), total: 10, paiement: "En attente", lignes: "" },
      { id: "f3", ref: "CMD-F3", client: "Resto G", statut: "Facturée", date: shift(-6), dateLiv: shift(-5), total: 10, paiement: "En attente", lignes: "" }
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

  // --- W. Bascule entre portails : Beheer réservé au rôle admin, partout ------------
  {
    // W1 — codes distincts : le rôle suit le code, quelle que soit la page de connexion.
    const authW = require(path.join(ROOT, "lib", "staffauth.js"));
    assert.equal(authW.roleForCode(process.env.ADMIN_CODE, {}, "staff"), "admin", "W1 code beheerder = admin, même depuis une page personnel");
    assert.equal(authW.roleForCode(process.env.STAFF_CODE, {}, "admin"), "staff", "W1 code personnel = staff, même depuis Beheer");
    assert.equal(authW.roleForCode("fout", {}, "admin"), null, "W1 code inconnu refusé");

    // W2 — codes identiques : le rôle suit la page de connexion, « staff » par défaut.
    const savedStaff = process.env.STAFF_CODE, savedAdmin = process.env.ADMIN_CODE;
    process.env.STAFF_CODE = "GedeeldeCode2026";
    process.env.ADMIN_CODE = "GedeeldeCode2026";
    clearModule("lib/staffauth.js");
    clearModule("api/session.js");
    try {
      const authSame = require(path.join(ROOT, "lib", "staffauth.js"));
      assert.equal(authSame.roleForCode("GedeeldeCode2026", {}, "staff"), "staff", "W2 codes identiques : connexion depuis une page personnel = staff");
      assert.equal(authSame.roleForCode("GedeeldeCode2026", {}), "staff", "W2 sans indication : staff, jamais admin par défaut");
      assert.equal(authSame.roleForCode("GedeeldeCode2026", {}, "admin"), "admin", "W2 connexion depuis Beheer = admin");
      const same = { adminHash: authSame.hashCode("ZelfdeCode2026"), staffHash: authSame.hashCode("ZelfdeCode2026") };
      assert.equal(authSame.roleForCode("ZelfdeCode2026", same, "staff"), "staff", "W2 codes enregistrés identiques : même règle");
      assert.equal(authSame.roleForCode("ZelfdeCode2026", same, "admin"), "admin", "W2 codes enregistrés identiques depuis Beheer = admin");

      const sessionSame = require(path.join(ROOT, "api", "session.js"));
      const originalFetch = global.fetch;
      global.fetch = async () => json({ records: [] });
      try {
        const loginAs = async (want, ip) => {
          const r = mkRes();
          await sessionSame({ method: "POST", body: { code: "GedeeldeCode2026", want }, headers: { "x-forwarded-for": ip } }, r);
          return r.payload.role;
        };
        assert.equal(await loginAs("staff", "10.7.0.1"), "staff", "W2 API : page personnel → staff");
        assert.equal(await loginAs("admin", "10.7.0.2"), "admin", "W2 API : page Beheer → admin");
        assert.equal(await loginAs("super", "10.7.0.3"), "staff", "W2 API : valeur inconnue → staff");
      } finally {
        global.fetch = originalFetch;
      }
    } finally {
      process.env.STAFF_CODE = savedStaff;
      process.env.ADMIN_CODE = savedAdmin;
      clearModule("lib/staffauth.js");
      clearModule("api/session.js");
      require(path.join(ROOT, "lib", "staffauth.js"));
      require(path.join(ROOT, "api", "session.js"));
    }

    // W3 — menu : aucun lien Beheer/Invoeren/Documenten pour le personnel, sur bureau comme sur mobile.
    const navSrcW = fs.readFileSync(path.join(ROOT, "staff-nav.js"), "utf8");
    const navBox = { window: {}, document: { readyState: "complete", querySelectorAll: () => [], addEventListener: () => {} }, location: { pathname: "/bestellingen.html" }, console };
    navBox.global = navBox;
    vm.runInNewContext(navSrcW, navBox);
    const navW = navBox.window.famoNav || navBox.global.famoNav;
    const adminLinks = html => (html.match(/href="\/(beheer|invoer|documenten)\.html"/g) || []).length;
    assert.equal(adminLinks(navW.sidebarHtml("bestellingen", false)), 0, "W3 barre latérale personnel : aucun lien d'administration");
    assert.equal(adminLinks(navW.sheetHtml("bestellingen", false, 3)), 0, "W3 feuille « Meer » personnel : aucun lien d'administration, même avec un badge");
    assert.equal(adminLinks(navW.mobileHtml("bestellingen", false, 3)), 0, "W3 onglets mobiles : aucun lien d'administration");
    assert.ok(/href="\/beheer\.html"/.test(navW.sidebarHtml("bestellingen", true)) && /href="\/beheer\.html"/.test(navW.sheetHtml("bestellingen", true, 0)), "W3 beheerder : Beheer présent");
    assert.ok(/href="\/"/.test(navW.sidebarHtml("bestellingen", false)) && /href="\/"/.test(navW.sheetHtml("bestellingen", false, 0)), "W3 lien vers le klantportaal pour tous");

    // W4 — écrans de connexion : un lien simple vers Beheer, qui n'ouvre rien en soi (Beheer exige le rôle admin) ;
    //      la page indique le rôle demandé ;
    //      une session personnel sur Beheer reçoit une invite, pas une impasse.
    const sessSrcW = fs.readFileSync(path.join(ROOT, "staff-session.js"), "utf8");
    const loadSession = (pathname, serverRole) => {
      const out = { exits: "", bodies: [] };
      const box = { querySelector: () => null, appendChild: n => { out.exits = n.innerHTML; } };
      out.loginView = { style: {}, querySelector: () => box, classList: { hidden: true, add() { this.hidden = true; }, remove() { this.hidden = false; } } };
      out.appView = { classList: { hidden: false, add() { this.hidden = true; }, remove() { this.hidden = false; } } };
      out.errEl = { textContent: "" };
      out.codeEl = { value: "EenCode", focus() {}, addEventListener() {} };
      const byId = { login: out.loginView, app: out.appView, err: out.errEl, code: out.codeEl };
      const sb = {
        console,
        location: { pathname, search: "", hash: "", origin: "https://famo.test" },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { getElementById: id => byId[id] || null, createElement: () => ({ innerHTML: "" }) },
        addEventListener() {},
        fetch: async (url, opts) => { out.bodies.push(JSON.parse((opts && opts.body) || "{}")); return { ok: true, json: async () => ({ ok: true, role: serverRole }) }; }
      };
      sb.window = sb;
      vm.runInNewContext(sessSrcW, sb);
      out.famoStaff = sb.famoStaff;
      return out;
    };
    ["bestellingen.html", "entrepot.html", "leveringen.html", "documenten.html", "invoer.html", "order.html"].forEach(p => {
      const s = loadSession("/" + p, "staff");
      s.famoStaff.bindLogin({ code: "code", error: "err", loginView: "login", appView: "app" });
      assert.match(s.exits, /<a href="\/beheer\.html">Beheerder\? Ga naar Beheer<\/a>/, "W4 écran de connexion " + p + " : lien simple vers Beheer (adresse seule, sans code ni rôle)");
      assert.match(s.exits, /href="\/"/, "W4 écran de connexion " + p + " : retour au klantportaal");
    });
    const sB = loadSession("/beheer.html", "staff");
    const ctlB = sB.famoStaff.bindLogin({ code: "code", error: "err", loginView: "login", appView: "app", requireAdmin: true });
    assert.match(sB.exits, /href="\/bestellingen\.html"/, "W4 connexion Beheer : retour vers le personnel");
    assert.ok(!/href="\/beheer\.html"/.test(sB.exits), "W4 connexion Beheer : pas de lien vers elle-même");
    await ctlB.enter();
    assert.equal(sB.bodies[0].want, "admin", "W4 Beheer demande le rôle admin");
    assert.equal(sB.loginView.classList.hidden, false, "W4 session personnel sur Beheer : le formulaire reste proposé");
    assert.equal(sB.appView.classList.hidden, true, "W4 session personnel sur Beheer : Beheer reste fermé");
    assert.match(sB.errEl.textContent, /enkel voor beheerders/i, "W4 message clair : code beheerder requis");
    const sP = loadSession("/bestellingen.html", "staff");
    await sP.famoStaff.bindLogin({ code: "code", error: "err", loginView: "login", appView: "app" }).enter();
    assert.equal(sP.bodies[0].want, "staff", "W4 pages personnel : rôle staff demandé");

    // W5 — Documenten : les liens vers Beheer n'existent que pour le beheerder.
    const docSrcW = fs.readFileSync(path.join(ROOT, "documenten.html"), "utf8");
    const actSrc = /function act\(d\)\{[\s\S]*?\n\}/.exec(docSrcW)[0];
    const actFor = (role, d, example) => {
      const c = { esc: s => String(s), famoStaff: { getRole: () => role }, FamoDocuments: { usingExampleBank: () => !!example } };
      vm.runInNewContext(actSrc, c);
      return c.act(d);
    };
    const faBlockedW = { available: false, type: "invoice", order: { id: "o1", factuurnummer: "FA-2026-0001" } };
    assert.ok(!/beheer\.html/.test(actFor("staff", faBlockedW)), "W5 Documenten personnel : pas de lien vers Beheer");
    assert.match(actFor("admin", faBlockedW), /href="\/beheer\.html"/, "W5 Documenten beheerder : lien vers Beheer quand les données manquent");
    assert.ok(/getRole\(\)==="admin"\?"<p><a href='\/beheer\.html'>Open Beheer<\/a><\/p>":/.test(docSrcW), "W5 facture bloquée : « Open Beheer » réservé au beheerder");

    // W6 — portail client : bascule seulement avec une session du personnel ; Beheer seulement pour l'admin.
    const idxSrcW = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const portalsBlock = /\/\* ====== Portaalwissel[\s\S]*?\/\* ====== einde portaalwissel ====== \*\//.exec(idxSrcW);
    assert.ok(portalsBlock, "W6 bloc portaalwissel introuvable dans index.html");
    assert.match(idxSrcW, /\ntryRestoreSession\(\);\nloadStaffPortals\(\);/, "W6 bascule chargée à l'ouverture du portail");
    const portalEls = {};
    const portalEl = id => portalEls[id] || (portalEls[id] = { innerHTML: "", classList: { hidden: true, toggle(c, on) { this.hidden = on; } } });
    const runPortals = async fetchImpl => {
      Object.keys(portalEls).forEach(k => delete portalEls[k]);
      const c = { console, document: { getElementById: portalEl }, fetch: fetchImpl };
      vm.createContext(c);
      vm.runInContext(portalsBlock[0], c);
      await c.loadStaffPortals();
      return portalEls;
    };
    let p6 = await runPortals(async () => ({ ok: false, json: async () => ({ error: "Sessie verlopen" }) }));
    assert.ok(p6.staffPortalsLanding.classList.hidden && p6.staffPortalsApp.classList.hidden && !p6.staffPortalsApp.innerHTML, "W6 client sans session du personnel : aucune bascule");
    p6 = await runPortals(async () => ({ ok: true, json: async () => ({ ok: true, role: "staff" }) }));
    assert.ok(!p6.staffPortalsApp.classList.hidden && /href="\/bestellingen\.html"/.test(p6.staffPortalsApp.innerHTML), "W6 personnel : retour vers le personnel");
    assert.ok(!/beheer\.html/.test(p6.staffPortalsLanding.innerHTML + p6.staffPortalsApp.innerHTML), "W6 personnel : aucun lien vers Beheer");
    p6 = await runPortals(async () => ({ ok: true, json: async () => ({ ok: true, role: "admin" }) }));
    assert.ok(/href="\/beheer\.html"/.test(p6.staffPortalsLanding.innerHTML) && /href="\/bestellingen\.html"/.test(p6.staffPortalsLanding.innerHTML), "W6 beheerder : personnel et Beheer");
    p6 = await runPortals(async () => { throw new Error("netwerk"); });
    assert.ok(p6.staffPortalsLanding.classList.hidden, "W6 réseau en panne : rien n'est affiché");
  }
  console.log("✓ W. Bascule entre portails (rôles, codes identiques, menu, connexion, Documenten, portail client)");

  // --- X. PDF des documents : styles emportés, cadrage dans la fenêtre réelle ---------
  {
    const previewSrc = fs.readFileSync(path.join(ROOT, "staff-doc-preview.js"), "utf8");
    const sbX = { console, location: { pathname: "/documenten.html" }, document: { createElement: () => ({}), body: {}, head: {}, addEventListener() {}, removeEventListener() {} } };
    sbX.window = sbX;
    sbX.global = sbX;
    vm.runInNewContext(previewSrc, sbX);
    const { scopeSelector, scopedCss } = sbX.famoDocPreview;

    // X1 — les règles du document ne visent que la copie destinée au PDF.
    assert.equal(scopeSelector("body", ".r"), ".r", "X1 body → racine de la copie");
    assert.equal(scopeSelector("*", ".r"), ".r *", "X1 *");
    assert.equal(scopeSelector("td small", ".r"), ".r td small", "X1 descendants");
    assert.equal(scopeSelector("h1, h2", ".r"), ".r h1,.r h2", "X1 listes de sélecteurs");
    assert.equal(scopeSelector("body.print", ".r"), ".r.print", "X1 body.classe");
    assert.equal(scopeSelector("body > .mast", ".r"), ".r > .mast", "X1 body > enfant");
    assert.equal(scopeSelector(".trow span:last-child", ".r"), ".r .trow span:last-child", "X1 pseudo-classes");
    const fakeDoc = { styleSheets: [{ cssRules: [
      { type: 1, selectorText: "body", style: { cssText: "padding: 38px 42px;" } },
      { type: 4, media: { mediaText: "print" }, cssRules: [{ type: 1, selectorText: "thead", style: { cssText: "display: table-header-group;" } }] },
      { type: 1, selectorText: "h1", style: { cssText: "font-size: 26px;" } }
    ] }] };
    assert.equal(scopedCss(fakeDoc, ".r"), ".r{padding: 38px 42px;}\n.r h1{font-size: 26px;}", "X1 styles emportés, @media print ignoré");

    // X2 — plus de fenêtre forcée à 794 px (cause de la coupure à gauche) ; marges portées par le document.
    assert.ok(!/windowWidth\s*:/.test(previewSrc.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")), "X2 aucune largeur de fenêtre forcée pour la capture");
    assert.match(previewSrc, /margin:\s*\[10,\s*0,\s*10,\s*0\]/, "X2 A4 pleine largeur, marges latérales du document");
    assert.match(previewSrc, /const source = pdfSource\(frame\.contentDocument\);/, "X2 le PDF part d'une copie qui emporte les styles");
    assert.match(previewSrc, /scrollX:\s*0,\s*scrollY:\s*0/, "X2 capture indépendante du défilement de la page (sinon PDF blanc)");
    assert.match(previewSrc, /avoid:\s*\["tr",[^\]]*"\.totals"[^\]]*"\.bank"/, "X2 aucune ligne ni bloc coupé entre deux pages");
  }
  console.log("✓ X. PDF des documents (styles emportés, cadrage dans la fenêtre réelle, A4 pleine largeur)");

  // --- Y. Magazijn : écran de validation lisible sur carte étroite --------------------
  {
    const entSrc = fs.readFileSync(path.join(ROOT, "entrepot.html"), "utf8");
    const rule = sel => {
      const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}").exec(entSrc);
      return m ? m[1] : "";
    };
    assert.match(entSrc, /<span class="pick-text" title="Besteld: [^>]*><span class="pm">[\s\S]{0,80}<\/span> <span class="pn">/, "Y0 structure : case, quantité commandée puis nom (comme sur la carte), « Besteld » en info-bulle");
    assert.match(rule(".pick-row .pick-text"), /flex:1 1 90px;min-width:0/, "Y1 le nom prend la place restante sur la ligne");
    assert.match(rule(".pick-row .pm"), /white-space:nowrap/, "Y1 la quantité commandée ne se coupe jamais");
    assert.match(rule(".pick-row"), /flex-wrap:wrap/, "Y2 carte trop étroite : les quantités passent dessous au lieu de recouvrir le nom");
    assert.match(rule(".pick-row .actual"), /margin-left:auto/, "Y2 quantités alignées à droite");
    assert.ok(!/grid-template-columns:40px minmax\(0,1fr\) 158px/.test(entSrc), "Y2 plus de colonne fixe de 158 px qui écrasait le nom");
    assert.match(rule(".pick-row .pn"), /overflow-wrap:break-word/, "Y2 un nom très long se coupe au lieu de déborder sous les boutons");
    assert.ok(!/border-radius|background/.test(rule(".pick-editor")), "Y3 plus d'encadré autour des articles");
    assert.match(rule(".pick-row"), /min-height:44px/, "Y4 ligne entière touchable (44 px)");
    assert.match(rule(".oc .actual button"), /min-width:44px;min-height:44px/, "Y4 −/+ gardent 44 px");
    assert.match(rule(".actual input"), /min-height:44px/, "Y4 champ quantité 44 px");
    assert.match(rule(".edit-total"), /flex-wrap:wrap/, "Y5 total réel et Klaarzetten passent à la ligne au lieu de se chevaucher");
    assert.match(rule(".edit-total .save"), /min-width:0/, "Y5 Klaarzetten ne dépasse plus à droite");
  }
  console.log("✓ Y. Magazijn : validation compacte (une ligne par article, 44 px, total et Klaarzetten sans chevauchement)");

  // --- Z. Portail client : menu latéral utilisable au doigt sur téléphone ----------------
  {
    const idxZ = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const scrimZ = /\.scrim\{display:block;position:fixed;inset:0;background:rgba\(0,0,0,\.28\);z-index:(\d+)\}/.exec(idxZ);
    const sidebarZ = /@media\(max-width:720px\)\{\.sidebar\{z-index:(\d+)\}\}/.exec(idxZ);
    assert.ok(scrimZ, "Z0 fond du menu (.scrim) introuvable");
    assert.ok(sidebarZ, "Z1 niveau du menu latéral sur téléphone non défini");
    assert.ok(Number(sidebarZ[1]) > Number(scrimZ[1]), "Z1 le menu est au-dessus de son fond (sinon toute touche tombe sur le fond)");
    const sheetZ = /\.sheet\{display:flex;position:fixed;z-index:(\d+)/.exec(idxZ);
    assert.ok(sheetZ && Number(sidebarZ[1]) < Number(sheetZ[1]), "Z1 la feuille panier reste au-dessus du menu");
    assert.match(idxZ, /@media\(max-width:980px\)\{\.main\{isolation:isolate\}\.scrim\{cursor:pointer\}\}/, "Z2 contenu isolé sous les couches fixes + fond cliquable sur Safari iOS");
    assert.match(idxZ, /id="drawerScrim" class="scrim hidden" onclick="closeDrawer\(\)"/, "Z3 toucher à côté du menu le referme");
  }
  console.log("✓ Z. Portail client : menu latéral au-dessus de son fond, fond cliquable, contenu isolé");

  // --- AA. Fin de vie des commandes : afgehandeld (facturée ET payée) hors du bord -----
  {
    const todayAA = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date());
    const makeOrdersAA = () => [
      { id: "r1", ref: "CMD-2026-0101", client: "Resto Open", statut: "Reçue", date: todayAA, dateLiv: todayAA, total: 10, paiement: "En attente", lignes: "", notes: "", factuurnummer: "" },
      { id: "u1", ref: "CMD-2026-0102", client: "Resto Schuld", statut: "Facturée", date: todayAA, dateLiv: todayAA, total: 20, paiement: "En attente", lignes: "", notes: "", factuurnummer: "FA-2026-0101" },
      { id: "p1", ref: "CMD-2026-0103", client: "Resto Betaald", statut: "Facturée", date: todayAA, dateLiv: todayAA, total: 30, paiement: "Payé", lignes: "", notes: "", factuurnummer: "FA-2026-0102" },
      { id: "p2", ref: "CMD-2026-0104", client: "Resto Oud", statut: "Facturée", date: todayAA, dateLiv: todayAA, total: 40, paiement: "Payé", lignes: "", notes: "", factuurnummer: "FA-2026-0103" }
    ];
    const inlineOf = src => [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");

    // Bestellingen : le vrai script, DOM minimal.
    const ORDERS_B = makeOrdersAA();
    const elsB = {};
    const elB = id => elsB[id] || (elsB[id] = { id, value: "", innerHTML: "", textContent: "", options: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {} });
    ["status", "payment", "source", "dateFilter", "attention"].forEach(id => { elB(id).value = "all"; });
    elB("sort").value = "delivery";
    elB("afgehandeld").value = "verbergen";
    elB("afgehandeld").options = [{ value: "verbergen" }, { value: "tonen" }];
    let cfgB = null;
    const ctxB = {
      console, URL, URLSearchParams, Intl,
      location: { pathname: "/bestellingen.html", search: "", hash: "", origin: "https://famo.test" },
      history: { replaceState: (s, t, url) => { ctxB.location.search = new URL(url, "https://famo.test").search; } },
      document: { getElementById: elB },
      famoStaff: {
        bindLogin: cfg => { cfgB = cfg; return { enter() {}, logout() {} }; },
        getRole: () => "staff",
        translateError: m => m,
        api: async () => ({ ok: true, json: async () => ({ orders: ORDERS_B }) })
      }
    };
    ctxB.window = ctxB;
    vm.createContext(ctxB);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-i18n.js"), "utf8"), ctxB);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-card.js"), "utf8"), ctxB);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-doc-actions.js"), "utf8"), ctxB);
    vm.runInContext(inlineOf(fs.readFileSync(path.join(ROOT, "bestellingen.html"), "utf8")), ctxB);
    const colB = key => (new RegExp('data-col="' + key + '">([\\s\\S]*?)</section>').exec(elB("board").innerHTML) || [])[1] || "";
    const refsB = key => [...colB(key).matchAll(/class="m-card-ref">([^<]+)</g)].map(m => m[1]).sort();

    // AA1 — par défaut : la facturée impayée reste, les facturées payées quittent le bord.
    await ctxB.load();
    assert.deepEqual(refsB("Facturée"), ["CMD-2026-0102"], "AA1 Bestellingen : facturée impayée visible, facturées payées hors du bord");
    assert.deepEqual(refsB("Reçue"), ["CMD-2026-0101"], "AA1 les autres colonnes ne changent pas");
    assert.match(colB("Facturée"), /<b>1<\/b><\/header>/, "AA1 compteur de colonne = cartes visibles");
    assert.match(colB("Facturée"), /<div class="m-hidden"><span>2 afgehandelde bestellingen verborgen<\/span><button type="button" class="staff-action-secondary" onclick="showAfgehandeld\(\)">Tonen<\/button><\/div>/, "AA1 ligne discrète : combien sont cachées, et Tonen");
    assert.equal(elB("count").textContent, "2 van 4 bestellingen · 2 afgehandeld verborgen", "AA1 compteur du haut");

    // AA2 — Te betalen : facturées ET impayées seulement ; son lien montre exactement ce qu'il compte.
    const chipB = /<a class="staff-chip[^"]*" href="([^"]+)"><b>(\d+)<\/b> Te betalen<\/a>/.exec(elB("chips").innerHTML);
    assert.ok(chipB, "AA2 chip Te betalen introuvable");
    assert.equal(chipB[2], "1", "AA2 Te betalen ne compte plus les commandes pas encore facturées");
    assert.equal(chipB[1], "/bestellingen.html?status=Factur%C3%A9e&payment=En%20attente", "AA2 lien Te betalen = facturées impayées");
    elB("status").value = "Facturée"; elB("payment").value = "En attente"; ctxB.onFilterChange();
    assert.equal(elB("count").textContent, "1 van 4 bestellingen", "AA2 le filtre du chip donne le même nombre");
    assert.match(elB("chips").innerHTML, /class="staff-chip active" href="[^"]+"><b>1<\/b> Te betalen/, "AA2 chip actif sur son propre filtre");
    elB("status").value = "all"; elB("payment").value = "all"; ctxB.onFilterChange();

    // AA3 — filtre explicite « Afgehandeld: Tonen », gardé dans l'URL et compté comme filtre.
    ctxB.showAfgehandeld();
    assert.deepEqual(refsB("Facturée"), ["CMD-2026-0102", "CMD-2026-0103", "CMD-2026-0104"], "AA3 Tonen remontre les commandes afgehandeld");
    assert.equal(ctxB.location.search, "?afgehandeld=tonen", "AA3 filtre gardé dans l'URL");
    assert.equal(elB("filtersCount").textContent, "1", "AA3 compté dans le badge Filters");
    assert.ok(!/m-hidden/.test(elB("board").innerHTML), "AA3 plus de ligne « verborgen » quand tout est montré");
    assert.equal(elB("count").textContent, "4 van 4 bestellingen", "AA3 compteur du haut");

    // AA4 — retour au défaut : absent de l'URL, pas compté.
    elB("afgehandeld").value = "verbergen"; ctxB.onFilterChange();
    assert.equal(ctxB.location.search, "", "AA4 défaut (Verbergen) absent de l'URL");
    assert.equal(elB("filtersCount").textContent, "", "AA4 défaut non compté comme filtre");

    // AA5 — un lien ?afgehandeld=tonen rouvre la page avec le filtre.
    ctxB.location.search = "?afgehandeld=tonen";
    cfgB.onDom();
    ctxB.render();
    assert.equal(elB("afgehandeld").value, "tonen", "AA5 filtre relu depuis l'URL");
    assert.deepEqual(refsB("Facturée"), ["CMD-2026-0102", "CMD-2026-0103", "CMD-2026-0104"], "AA5 commandes afgehandeld visibles");
    elB("afgehandeld").value = "verbergen"; ctxB.onFilterChange();

    // AA6 — recherche d'une facture payée : rien de perdu, la ligne dit qu'elle est cachée.
    elB("search").value = "FA-2026-0103";
    ctxB.render();
    assert.equal(elB("count").textContent, "0 van 4 bestellingen · 1 afgehandeld verborgen", "AA6 recherche : commande trouvée mais cachée, dit clairement");
    assert.match(colB("Facturée"), /<b>Alles betaald<\/b>[\s\S]*1 afgehandelde bestelling verborgen/, "AA6 colonne : Alles betaald + 1 verborgen");
    elB("search").value = "";

    // Magazijn : le vrai script, DOM minimal.
    const pageM = fs.readFileSync(path.join(ROOT, "entrepot.html"), "utf8");
    const ORDERS_M = makeOrdersAA();
    const updCalls = [];
    const elsM = {};
    const stubM = id => {
      const node = {
        id, value: "", innerHTML: "", textContent: "", className: "", dataset: {}, style: {}, disabled: false, onclick: null, attrs: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute(k, v) { node.attrs[k] = String(v); },
        appendChild(child) { node.innerHTML += '<div class="' + child.className + '" data-order-id="' + (child.dataset.orderId || "") + '">' + child.innerHTML + "</div>"; return child; },
        insertAdjacentHTML(pos, html) { node.innerHTML += html; },
        scrollIntoView() {}
      };
      return node;
    };
    const elM = id => elsM[id] || (elsM[id] = stubM(id));
    const ctxM = {
      console, URL, URLSearchParams, Intl,
      setTimeout: () => 0, clearTimeout: () => {}, addEventListener() {},
      location: { pathname: "/entrepot.html", search: "", hash: "", href: "https://famo.test/entrepot.html" },
      history: { replaceState() {} },
      document: { getElementById: elM, createElement: () => stubM(""), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
      famoCompany: { EXAMPLE: { iban: "", bic: "" }, withExampleBank: b => b },
      famoDocPreview: { open() {}, filenameFor: () => "" },
      famoStaff: {
        bindLogin: () => ({ enter() {}, logout() {} }),
        getRole: () => "staff",
        translateError: m => m,
        api: async (url, opts) => {
          if (url === "/api/updateorder") {
            const patch = JSON.parse(opts.body);
            updCalls.push(patch);
            ORDERS_M.find(o => o.id === patch.id).paiement = patch.paiement;
            return { ok: true, json: async () => ({}) };
          }
          return { ok: true, json: async () => ({ orders: ORDERS_M.map(o => Object.assign({}, o)) }) };
        }
      }
    };
    ctxM.window = ctxM;
    vm.createContext(ctxM);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-i18n.js"), "utf8"), ctxM);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-card.js"), "utf8"), ctxM);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-doc-actions.js"), "utf8"), ctxM);
    vm.runInContext(inlineOf(pageM), ctxM);
    const refsM = () => [...elM("c3").innerHTML.matchAll(/class="m-card-ref">([^<]+)</g)].map(m => m[1]).sort();

    // AA7 — par défaut : même règle que Bestellingen ; compteurs du haut inchangés.
    await ctxM.load();
    assert.deepEqual(refsM(), ["CMD-2026-0102"], "AA7 Magazijn : facturée impayée visible, facturées payées hors du bord");
    assert.match(elM("c3").innerHTML, />Markeer betaald<\/button>/, "AA7 la facturée impayée garde Markeer betaald");
    assert.equal(String(elM("n3").textContent), "1", "AA7 compteur de colonne = cartes visibles");
    assert.match(elM("c3").innerHTML, /<div class="wh-hidden"><span>2 afgehandelde bestellingen verborgen<\/span><button type="button" class="staff-action-secondary" onclick="toggleAfgehandeld\(true\)">Tonen<\/button><\/div>/, "AA7 ligne discrète dans Gefactureerd");
    assert.equal(elM("boardSummary").textContent, "2 van 4 bestellingen · 2 afgehandeld verborgen", "AA7 résumé du bord");
    assert.equal(String(elM("statOpen").textContent), "1", "AA7 Niet gefactureerd inchangé");
    assert.equal(elM("afgehandeldCount").textContent, "2", "AA7 bouton Toon afgehandelde : nombre");
    assert.equal(elM("afgehandeldBtn").attrs["aria-pressed"], "false", "AA7 bouton non enfoncé par défaut");

    // AA8 — Toon afgehandelde.
    ctxM.toggleAfgehandeld();
    assert.deepEqual(refsM(), ["CMD-2026-0102", "CMD-2026-0103", "CMD-2026-0104"], "AA8 Toon afgehandelde remontre les commandes payées");
    assert.equal(elM("afgehandeldBtn").attrs["aria-pressed"], "true", "AA8 bouton enfoncé");
    assert.ok(!/wh-hidden/.test(elM("c3").innerHTML), "AA8 plus de ligne « verborgen »");
    assert.match(elM("c3").innerHTML, /<button class="edit" onclick="togglePay\('p1','En attente'\)">Markeer openstaand<\/button>/, "AA8 une commande afgehandeld reste réversible (Markeer openstaand, secondaire)");
    // AD1 — un seul bouton plein par carte, et c'est celui qui fait avancer la commande.
    for (const col of ["c0", "c1", "c2", "c3"]) {
      elM(col).innerHTML.split('<div class="oc').slice(1).forEach(card => {
        const filled = [...card.matchAll(/class="adv"[^>]*>([^<]+)</g)].map(m => m[1]);
        assert.ok(filled.length <= 1, "AD1 au plus un bouton plein par carte : " + filled.join(", "));
      });
    }
    assert.match(elM("c0").innerHTML, /<button class="adv" onclick="editLines\(\d+\)">Artikelen valideren<\/button>/, "AD1 Ontvangen : Artikelen valideren en plein");
    assert.match(elM("c3").innerHTML, /<button class="adv" onclick="togglePay\('u1','Payé'\)">Markeer betaald<\/button>/, "AD1 Gefactureerd impayée : Markeer betaald en plein");
    assert.match(elM("c3").innerHTML, /<a class="doc-ico" href="\/documenten\.html\?order=u1&type=facture" title="Factuur openen"/, "AD2 documents : icône qui ouvre, pas un bouton plein");

    // AA9 — Wissen recache ; rien n'est gardé entre deux chargements.
    ctxM.clearOrderFilters();
    assert.deepEqual(refsM(), ["CMD-2026-0102"], "AA9 Wissen recache les commandes afgehandeld");
    const blockM = /\/\* ====== Afgehandeld[\s\S]*?einde afgehandeld ====== \*\//.exec(pageM);
    assert.ok(blockM, "AA9 bloc afgehandeld introuvable dans entrepot.html");
    assert.match(blockM[0], /let SHOW_AFGEHANDELD=false/, "AA9 caché à chaque chargement");
    assert.ok(!/localStorage|sessionStorage|afgehandeld=/.test(pageM), "AA9 Magazijn ne mémorise pas l'affichage (ni stockage, ni URL)");

    // AA10 — Markeer betaald : la carte quitte le bord, un message dit où la retrouver.
    await ctxM.togglePay("u1", "Payé");
    assert.deepEqual(updCalls, [{ id: "u1", paiement: "Payé" }], "AA10 même appel API qu'avant : aucun champ d'archivage");
    assert.deepEqual(refsM(), [], "AA10 la commande payée quitte le bord");
    assert.match(elM("c3").innerHTML, /<b>Alles betaald<\/b>[\s\S]*3 afgehandelde bestellingen verborgen/, "AA10 colonne vide : Alles betaald + 3 verborgen");
    assert.equal(elM("notice").textContent, "CMD-2026-0102 is betaald en afgehandeld — van het bord gehaald. Terug te vinden via ‘Toon afgehandelde’ of in Documenten.", "AA10 message clair");

    // AA11 — remise en openstaand : revient sur le bord, sans ce message.
    elM("notice").textContent = "";
    ctxM.toggleAfgehandeld(true);
    await ctxM.togglePay("u1", "En attente");
    assert.equal(elM("notice").textContent, "", "AA11 pas de message « afgehandeld » en remettant openstaand");
    ctxM.toggleAfgehandeld(false);
    assert.deepEqual(refsM(), ["CMD-2026-0102"], "AA11 de nouveau impayée : visible par défaut");

    // AA12 — lien direct ?id= vers une commande afgehandeld : montrée, pas « niet gevonden ».
    ctxM.location.search = "?id=p1";
    await ctxM.load();
    assert.ok(refsM().includes("CMD-2026-0103"), "AA12 la commande visée est montrée");
    assert.notEqual(elM("notice").textContent, "Bestelling niet gevonden op het bord.", "AA12 pas d'erreur trompeuse");
    ctxM.location.search = "";

    // AA13 — filtre d'affichage seulement : API et Documenten intacts.
    assert.ok(!/filterByFormula/.test(fs.readFileSync(path.join(ROOT, "api", "allorders.js"), "utf8")), "AA13 /api/allorders renvoie toujours toutes les commandes");
    assert.ok(!/isAfgehandeld|Payé/.test(fs.readFileSync(path.join(ROOT, "documenten.html"), "utf8")), "AA13 Documenten ne filtre pas sur le paiement : une commande afgehandeld y reste consultable");
  }
  console.log("✓ AA. Fin de vie des commandes : facturée ET payée hors du bord (filtre explicite, Te betalen, Documenten intact)");

  // --- AB. Carte commande commune (Bestellingen + Magazijn) : date d'abord, articles compacts ---
  {
    const bestAB = fs.readFileSync(path.join(ROOT, "bestellingen.html"), "utf8");
    const entAB = fs.readFileSync(path.join(ROOT, "entrepot.html"), "utf8");
    for (const [name, src] of [["bestellingen.html", bestAB], ["entrepot.html", entAB]]) {
      assert.ok(src.includes('<script src="/staff-card.js"></script>'), "AB0 " + name + " charge la carte commune");
      assert.match(src, /famoCard\.html\(o,/, "AB0 " + name + " dessine ses cartes avec famoCard.html");
    }
    assert.ok(!/[^-]order-lines?\b|<div class="ref">/.test(entAB), "AB1 Magazijn : plus de pavé gris par article, plus de référence en tête");
    const cssAB = fs.readFileSync(path.join(ROOT, "staff.css"), "utf8");
    assert.ok(!/\.m-card-lines[^{]*\{[^}]*background/.test(cssAB), "AB1 liste d'articles sans fond");
    const ctxAB = { console, Intl };
    ctxAB.window = ctxAB;
    vm.createContext(ctxAB);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-i18n.js"), "utf8"), ctxAB);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-card.js"), "utf8"), ctxAB);
    const todayAB = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date());
    const cardAB = ctxAB.famoCard.html({ ref: "CMD-2026-0200", client: "Resto <A>", dateLiv: todayAB, statut: "Prête", total: 96,
      lignes: "Kabeljauw × 3 kg [€20.00]\nMosselen × 2 caisse [€28.00] (grote)\nOesters × 1 caisse\nTong × 2 kg\nZalm × 1 kg" }, { maxLines: 4, foot: "<i>x</i>" });
    assert.match(cardAB, /^<div class="m-card-top"><span class="m-card-date">Vandaag<\/span><span class="m-card-ref">CMD-2026-0200<\/span><\/div><div class="m-card-client">Resto &lt;A><\/div>/, "AB2 date d'abord, référence secondaire, client échappé");
    assert.match(cardAB, /<li><span class="m-card-q">3 kg<\/span><span class="m-card-n">Kabeljauw<\/span><\/li><li><span class="m-card-q">2 kassa<\/span><span class="m-card-n">Mosselen \(grote\)<\/span><\/li>/, "AB3 articles compacts : quantité + unité, nom, sans prix");
    assert.match(cardAB, /<li class="m-card-more">\+ 1 meer<\/li><\/ul>/, "AB3 liste plafonnée quand la page le demande");
    assert.match(cardAB, /<div class="m-card-foot"><i>x<\/i><span class="m-card-total">€ 96,00<\/span><\/div>$/, "AB4 total en pied de carte");
    const allAB = ctxAB.famoCard.html({ ref: "R", client: "C", dateLiv: "", statut: "Reçue", total: 1, lignes: "Kabeljauw × 3 kg\nTong × 2 kg\nZalm × 1 kg\nOesters × 1 caisse\nMosselen × 2 caisse" });
    assert.equal((allAB.match(/<li>/g) || []).length, 5, "AB3 sans plafond : tous les articles (Magazijn)");
    assert.match(allAB, /m-card-date m-nodate">Geen leverdatum</, "AB2 sans date : libellé explicite");
  }
  console.log("✓ AB. Carte commune Bestellingen/Magazijn (date d'abord, articles compacts, total)");

  // --- AC. Haut de page compact (deux lignes) : Bestellingen et Magazijn ------------------
  {
    const bestAC = fs.readFileSync(path.join(ROOT, "bestellingen.html"), "utf8");
    const entAC = fs.readFileSync(path.join(ROOT, "entrepot.html"), "utf8");
    assert.match(bestAC, /<header class="staff-page-head b-head"><h1>Bestellingen<\/h1>\s*<section id="chips"/, "AC1 Bestellingen ligne 1 : titre et compteurs dans l'en-tête");
    assert.match(bestAC, /<section class="orders-tools"[\s\S]*?<span id="count"[\s\S]*?<\/section>/, "AC1 Bestellingen ligne 2 : recherche, filtres, tri et nombre");
    assert.match(bestAC, /\{href:"\/bestellingen\.html\?status=open",count:open,label:"Open",extra:true\}/, "AC2 Open replié quand la place manque");
    assert.match(bestAC, /#filtersPanel:not\(\.open\)~#attentionBox\{display:none!important\}/, "AC2 Aandacht vereist se déplie avec Filters");
    assert.match(entAC, /<header class="staff-page-head wh-head">\s*<div class="wh-title">\s*<h1>Magazijn<\/h1>\s*<div class="wh-stats"/, "AC3 Magazijn ligne 1 : titre et compteurs dans l'en-tête");
    assert.match(entAC, /<span class="wh-extra">Niet gefactureerd/, "AC3 Niet gefactureerd replié quand la place manque");
    assert.match(entAC, /bar\.classList\.toggle\("hidden",!n\)/, "AC4 groepsactie repliée tant que rien n'est sélectionné");
    assert.match(entAC, /id="bulkAll"[^>]*>Alles selecteren<\/button>\s*<span class="wh-meta wh-extra">/, "AC4 Alles selecteren dans la barre d'outils");
  }
  console.log("✓ AC. Haut de page compact (deux lignes, essentiel visible, reste replié)");

  // --- AD. Hiérarchie des actions sur les cartes Magazijn (voir aussi AD1/AD2 dans AA) ------
  {
    const entAD = fs.readFileSync(path.join(ROOT, "entrepot.html"), "utf8");
    assert.match(entAD, /'<a class="oc-link" href="\/leveringen\.html">Open Leveringen<\/a>'/, "AD2 Open Leveringen est une navigation : lien, pas bouton plein");
    assert.ok(!/<a class="adv"|class="doc"|class="pay"|class="paid"/.test(entAD), "AD2 plus de lien habillé en bouton plein ni de styles de bouton concurrents");
    const linkCss = /\n\s*\.oc a\.oc-link\{([^}]*)\}/.exec(entAD); // la règle propre au lien, pas la règle commune « .oc button,.oc a.oc-link »
    assert.ok(linkCss && /background:none/.test(linkCss[1]) && /text-decoration:underline/.test(linkCss[1]), "AD2 lien discret : sans fond, souligné");
    assert.match(entAD, /\.oc button,\.oc a\.oc-link\{[^}]*min-height:44px/, "AD3 liens et boutons gardent 44 px de cible");
  }
  console.log("✓ AD. Cartes Magazijn : un seul bouton plein (avancer), secondaires, navigations en liens");

  // --- AE. Documents depuis les cartes : ouvrir (icône) et imprimer sans aperçu -------------
  {
    const bestAE = fs.readFileSync(path.join(ROOT, "bestellingen.html"), "utf8");
    const entAE = fs.readFileSync(path.join(ROOT, "entrepot.html"), "utf8");
    for (const [name, src] of [["bestellingen.html", bestAE], ["entrepot.html", entAE]]) {
      for (const s of ["/staff-company.js", "/documents.js", "/staff-doc-actions.js"]) assert.ok(src.includes('<script src="' + s + '"></script>'), "AE0 " + name + " charge " + s);
      assert.match(src, /famoDocActions\.iconsHtml\(o\)/, "AE0 " + name + " affiche les icônes documents sur la carte");
      assert.match(src, /famoDocActions\.setSource\(\(\)=>ORDERS\)/, "AE0 " + name + " donne ses commandes à l'impression");
    }
    assert.ok(!/<a class="m-card[ "]/.test(bestAE), "AE1 Bestellingen : la carte n'est plus un lien qui contiendrait des boutons");
    assert.match(bestAE, /<a class="m-card-link" href="\/order\.html\?id='/, "AE1 Bestellingen : la fiche reste ouvrable en touchant la carte");
    const notices = [], frames = [], apiCalls = [];
    let setCompanyCalls = 0, printed = 0;
    const bodyAE = { appendChild(node) {
      frames.push(node);
      node.contentWindow = { document: { body: { innerHTML: node.srcdoc } }, focus() {}, print() { printed++; } };
      if (node.onload) node.onload();
    } };
    const ctxAE = {
      console, encodeURIComponent, setTimeout: () => 0, clearTimeout: () => {},
      document: { body: bodyAE, getElementById: () => null, createElement: () => { const n = { attrs: {}, setAttribute(k, v) { n.attrs[k] = v; }, remove() { n.removed = true; } }; return n; } },
      showNotice: (m, kind) => notices.push([m, kind]),
      famoStaff: { api: async url => { apiCalls.push(url); return { ok: true, json: async () => ({ config: { bedrijfsnaam: "Famo" } }) }; } },
      FamoDocuments: {
        setCompany() { setCompanyCalls++; },
        build(order, type) {
          if (type === "invoice" && !order.ok) throw new Error("Factuur geblokkeerd: IBAN/BIC ontbreken. Vul ze in via Beheer.");
          return "<html><body>" + type + " " + order.ref + "</body></html>";
        }
      }
    };
    ctxAE.window = ctxAE;
    vm.createContext(ctxAE);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-doc-actions.js"), "utf8"), ctxAE);
    const A = ctxAE.famoDocActions;
    const ORD = [
      { id: "r", ref: "CMD-2026-0301", statut: "Reçue" },
      { id: "k", ref: "CMD-2026-0302", statut: "Prête" },
      { id: "f", ref: "CMD-2026-0303", statut: "Facturée", factuurnummer: "FA-2026-0301", ok: true },
      { id: "b", ref: "CMD-2026-0304", statut: "Facturée", factuurnummer: "FA-2026-0302", ok: false }
    ];
    A.setSource(() => ORD);

    // AE2 — mêmes règles que Documenten.
    assert.equal(A.iconsHtml(ORD[0]), "", "AE2 Ontvangen : pas encore de document");
    const kAE = A.iconsHtml(ORD[1]);
    assert.match(kAE, /<a class="doc-ico" href="\/documenten\.html\?order=k&type=lb" title="Leveringsbon openen" aria-label="Leveringsbon openen">/, "AE2 Klaar : leveringsbon ouvrable");
    assert.match(kAE, /<button type="button" class="doc-ico" data-id="k" onclick="famoDocActions\.print\(this\.dataset\.id,'delivery'\)" title="Leveringsbon afdrukken" aria-label="Leveringsbon afdrukken">/, "AE2 Klaar : leveringsbon imprimable");
    assert.ok(!/Factuur/.test(kAE), "AE2 pas de facture sans numéro");
    assert.match(A.iconsHtml(ORD[2]), /type=facture" title="Factuur openen"[\s\S]*print\(this\.dataset\.id,'invoice'\)" title="Factuur afdrukken"/, "AE2 facturée : facture ouvrable et imprimable");

    // AE3 — imprimer : identité chargée une fois, document de documents.js dans un cadre invisible, impression lancée.
    assert.equal(await A.print("k", "delivery"), true, "AE3 impression lancée");
    assert.equal(printed, 1, "AE3 print() appelé sur le document");
    assert.equal(frames[0].srcdoc, "<html><body>delivery CMD-2026-0302</body></html>", "AE3 même document que l'aperçu (documents.js)");
    assert.equal(frames[0].className, "doc-print-frame", "AE3 cadre d'impression invisible");
    assert.equal(await A.print("f", "invoice"), true, "AE3 facture imprimée");
    assert.equal(printed, 2, "AE3 deux impressions");
    assert.ok(frames[0].removed, "AE3 l'ancien cadre est retiré");
    assert.deepEqual(apiCalls, ["/api/config"], "AE3 identité de l'entreprise chargée une seule fois");
    assert.equal(setCompanyCalls, 1, "AE3 identité transmise à documents.js");

    // AE4 — document bloqué ou pas encore disponible : message clair, rien n'est imprimé.
    assert.equal(await A.print("b", "invoice"), false, "AE4 facture bloquée : pas d'impression");
    assert.equal(printed, 2, "AE4 rien d'imprimé");
    assert.deepEqual(notices.pop(), ["Factuur geblokkeerd: IBAN/BIC ontbreken. Vul ze in via Beheer.", "error"], "AE4 raison affichée");
    assert.equal(await A.print("r", "delivery"), false, "AE4 document pas encore disponible");
    assert.match(notices.pop()[0], /niet beschikbaar/, "AE4 message clair");

    assert.match(fs.readFileSync(path.join(ROOT, "staff.css"), "utf8"), /\.doc-actions \.doc-ico\{[^}]*min-width:44px;min-height:44px/, "AE5 icônes : cible de 44 px");
  }
  console.log("✓ AE. Documents depuis les cartes (icône pour ouvrir, impression sans aperçu, mêmes règles que Documenten)");

  // --- AF. Portail client : l'étoile favoris se remplit quand elle est active ------------
  {
    const idxAF = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    assert.match(idxAF, /\.icon\{[^}]*fill:none/, "AF0 icônes au contour par défaut");
    assert.match(idxAF, /\.fav\.on\{color:#A87D1B\}\.fav\.on \.icon\{fill:currentColor\}/, "AF1 étoile active remplie (règle plus précise que .icon)");
    assert.match(idxAF, /localStorage\.setItem\(favKey\(\),JSON\.stringify\(favs\)\)/, "AF2 enregistrement des favoris inchangé (par appareil)");
  }
  console.log("✓ AF. Portail client : étoile favoris remplie quand elle est active");

  // --- AG. Vue Dag : pas d'alerte stock sans données de stock ; vue alignée sur le bord -----
  {
    const entAG = fs.readFileSync(path.join(ROOT, "entrepot.html"), "utf8");
    const fnAG = /function stockAlerts\(items\)\{[\s\S]*?\n\}/.exec(entAG);
    assert.ok(fnAG, "AG0 stockAlerts introuvable dans entrepot.html");
    const ctxAG = { STOCK: [] };
    vm.createContext(ctxAG);
    vm.runInContext(fnAG[0], ctxAG);
    const itemsAG = [{ name: "Kabeljauw", quantity: 3 }, { name: "Zalm", quantity: 5 }];
    assert.deepEqual(Array.from(ctxAG.stockAlerts(itemsAG)), [], "AG1 table Stock vide (ou non chargée pour le personnel) : aucun bandeau");
    ctxAG.STOCK = [{ product: "Zalm", quantity: 2 }];
    assert.deepEqual(Array.from(ctxAG.stockAlerts(itemsAG)), ["Onbekend artikel: Kabeljauw", "Zalm: 2 beschikbaar, 5 nodig"], "AG2 stock renseigné : les vrais écarts restent signalés");
    assert.match(entAG, /const alerts=stockAlerts\(items\);/, "AG1 la vue Dag passe par stockAlerts");
    assert.match(entAG, /<span id="dagSummary" class="prep-summary" role="status"><\/span>/, "AG3 résumé et lien Leveringen dans la barre de la vue Dag");
    assert.ok(!/prep-meta|prep-order-head/.test(entAG), "AG3 plus de ligne de résumé séparée ni d'ancienne carte");
    assert.match(entAG, /'<a class="prep-order f-lift" href="\/entrepot\.html\?id='\+encodeURIComponent\(o\.id\)\+'">'\+famoCard\.html\(o,/, "AG4 commandes du jour : même carte que le bord");
  }
  console.log("✓ AG. Vue Dag : pas d'alerte stock sans données de stock, haut compact, même carte");

  // --- AH. Factures du personnel : vrai IBAN, taux et conditions ; l'exemple ne remplace qu'un IBAN absent ---
  {
    delete require.cache[require.resolve(path.join(ROOT, "api", "config.js"))];
    delete require.cache[require.resolve(path.join(ROOT, "lib", "staffauth.js"))];
    const authAH = require(path.join(ROOT, "lib", "staffauth.js"));
    const configAH = require(path.join(ROOT, "api", "config.js"));
    assert.ok(authAH.hasCode(), "AH0 codes d'environnement présents");
    const staffHdrAH = { cookie: "famo_sess=" + encodeURIComponent(authAH.sign(Date.now() + 60000, "staff")) };
    const CONF_AH = { records: [{ id: "recConf", fields: {
      "Bedrijfsnaam": "Famo Trading BV", "Adres": "Jezusstraat 34", "Postcode en plaats": "2000 Antwerpen", "BTW-nummer": "BE0788705713",
      "IBAN": "BE71096123456769", "BTW-tarief": 21, "Betalingsvoorwaarden": "Betaalbaar binnen 14 dagen.",
      "Leveringsvoorwaarden": "Klachten binnen 12u.", "Bestellingen e-mail": "ops@famo.test"
    } }] };

    // AH1 — session personnel : tout ce qui s'imprime sur une facture, jamais la boîte interne.
    let rAH = await call(configAH, null, [CONF_AH], { method: "GET", headers: staffHdrAH, query: {} });
    assert.equal(rAH.res.statusCode, 200, "AH1 config lisible par le personnel");
    const staffCfg = rAH.res.payload.config;
    assert.equal(staffCfg.iban, "BE71096123456769", "AH1 personnel : IBAN réel reçu");
    assert.equal(staffCfg.btwTarief, 21, "AH1 personnel : taux de TVA réglé reçu");
    assert.equal(staffCfg.betalingsvoorwaarden, "Betaalbaar binnen 14 dagen.", "AH1 personnel : conditions de paiement reçues");
    assert.ok(!("bestellingenEmail" in staffCfg), "AH1 personnel : boîte interne jamais exposée");

    // AH2 — public (portail client sans session) : coordonnées seules, aucun IBAN.
    rAH = await call(configAH, null, [CONF_AH], { method: "GET", headers: {}, query: { public: "1" } });
    assert.ok(!("iban" in rAH.res.payload.config) && !("bestellingenEmail" in rAH.res.payload.config), "AH2 public : ni IBAN ni boîte interne");

    // AH3 — facture rendue avec la config reçue par le personnel : vrai IBAN, pas d'exemple, taux réglé.
    const ctxAH = { console, Intl, Date };
    ctxAH.window = ctxAH;
    vm.createContext(ctxAH);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-company.js"), "utf8"), ctxAH);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "documents.js"), "utf8"), ctxAH);
    ctxAH.FamoDocuments.setCompany(staffCfg);
    const factuurAH = ctxAH.FamoDocuments.build({ ref: "CMD-2026-0400", client: "Resto Test", factuurnummer: "FA-2026-0400", lignes: "Zalm × 2 kg [€12.50]", total: 25 }, "invoice");
    assert.match(factuurAH, /BE71 0961 2345 6769/, "AH3 facture du personnel : IBAN réel");
    assert.ok(!/Voorbeeld bankgegevens|BE68 5390 0754 7034/.test(factuurAH), "AH3 facture du personnel : jamais l'IBAN d'exemple");
    assert.match(factuurAH, /btw 21%/, "AH3 facture du personnel : taux réglé, pas 6 % par défaut");

    // AH4 — l'exemple ne remplace qu'un IBAN absent : un BIC vide ne fait plus disparaître l'IBAN réel.
    const bankAH = ctxAH.famoCompany.withExampleBank({ iban: "BE71096123456769", bic: "" });
    assert.equal(bankAH.iban, "BE71096123456769", "AH4 BIC vide : IBAN réel conservé");
    assert.equal(bankAH.exampleBank, false, "AH4 BIC vide : pas de mention d'exemple");
    ctxAH.FamoDocuments.setCompany({ bedrijfsnaam: "Famo Trading BV", iban: "BE71096123456769", bic: "" });
    assert.ok(ctxAH.FamoDocuments.canInvoice(), "AH4 facture possible sans BIC");
    assert.equal(ctxAH.famoCompany.withExampleBank({ iban: "", bic: "" }).exampleBank, true, "AH4 IBAN absent : exemple signalé comme tel");
  }
  console.log("✓ AH. Factures du personnel : vrai IBAN, taux et conditions ; l'exemple ne remplace qu'un IBAN absent");

  // --- AI. Facture : prix hors TVA, la TVA s'ajoute (elle n'est plus retranchée du total) -------
  {
    const ctxAI = { console, Intl, Date };
    ctxAI.window = ctxAI;
    vm.createContext(ctxAI);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "staff-company.js"), "utf8"), ctxAI);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "documents.js"), "utf8"), ctxAI);
    const D = ctxAI.FamoDocuments;
    const row = (html, label) => (new RegExp('<div class="trow[^"]*"><span>' + label + '</span><span>([^<]+)</span></div>').exec(html) || [])[1];
    const orderAI = { ref: "CMD-2026-0500", client: "Resto Test", factuurnummer: "FA-2026-0500", lignes: "Kabeljauw × 5 kg [€20.00]", total: 100 };

    // AI1 — 6 % : 100,00 HT → 6,00 TVA → 106,00 à payer.
    D.setCompany({ bedrijfsnaam: "Famo Trading BV", iban: "BE71096123456769", bic: "GKCCBEBB", btwTarief: 6 });
    const f6 = D.build(orderAI, "invoice");
    assert.equal(row(f6, "Totaal excl\\. btw"), "€ 100,00", "AI1 total de la commande = total hors TVA");
    assert.equal(row(f6, "btw 6%"), "€ 6,00", "AI1 TVA ajoutée, pas retranchée");
    assert.equal(row(f6, "Totaal incl\\. btw"), "€ 106,00", "AI1 total à payer TVA comprise");

    // AI2 — 21 % et arrondi au centime : 25,00 HT → 5,25 → 30,25.
    D.setCompany({ bedrijfsnaam: "Famo Trading BV", iban: "BE71096123456769", bic: "GKCCBEBB", btwTarief: 21 });
    const f21 = D.build({ ...orderAI, total: 25 }, "invoice");
    assert.equal(row(f21, "btw 21%"), "€ 5,25", "AI2 TVA 21 %");
    assert.equal(row(f21, "Totaal incl\\. btw"), "€ 30,25", "AI2 total TVA comprise");
    D.setCompany({ bedrijfsnaam: "Famo Trading BV", iban: "BE71096123456769", bic: "GKCCBEBB", btwTarief: 6 });
    const fRound = D.build({ ...orderAI, total: 12.35 }, "invoice");
    assert.equal(row(fRound, "btw 6%"), "€ 0,74", "AI2 TVA arrondie au centime (12,35 × 6 % = 0,741)");
    assert.equal(row(fRound, "Totaal incl\\. btw"), "€ 13,09", "AI2 total = HT + TVA arrondie");

    // AI3 — avoir (voorbeeld) : mêmes montants en négatif ; bon de livraison sans aucun total.
    const cn = D.build(orderAI, "credit");
    assert.equal(row(cn, "Totaal incl\\. btw"), "€ -106,00", "AI3 avoir : total TVA comprise en négatif");
    assert.ok(!/Totaal (excl|incl)/.test(D.build(orderAI, "delivery")), "AI3 bon de livraison : pas de montants");
    assert.ok(!/total\/\(1\+pct\/100\)/.test(fs.readFileSync(path.join(ROOT, "documents.js"), "utf8")), "AI4 plus de TVA retranchée d'un total supposé TTC");
  }
  console.log("✓ AI. Facture : prix hors TVA, TVA ajoutée et arrondie au centime (6 %, 21 %, avoir)");

  // --- AJ. Documenten : « Vul IBAN in » seulement si l'IBAN manque ; blocage livraison → Leveringen ---
  {
    const docAJ = fs.readFileSync(path.join(ROOT, "documenten.html"), "utf8");
    const actAJ = /function act\(d\)\{[\s\S]*?\n\}/.exec(docAJ)[0];
    const runAJ = (role, d, example) => {
      const c = { esc: s => String(s), famoStaff: { getRole: () => role }, FamoDocuments: { usingExampleBank: () => !!example } };
      vm.runInNewContext(actAJ, c);
      return c.act(d);
    };
    const onderwegAJ = { available: false, type: "invoice", reason: "Geblokkeerd — levering nog niet bevestigd", order: { id: "o1", statut: "Sortie en livraison" } };
    const klaarAJ = { available: false, type: "invoice", reason: "Geblokkeerd — levering nog niet bevestigd", order: { id: "o2", statut: "Prête" } };
    const beschikbaarAJ = { available: true, type: "invoice", order: { id: "o3", statut: "Facturée", factuurnummer: "FA-2026-0003" } };
    for (const role of ["admin", "staff"]) {
      assert.ok(!/IBAN|beheer\.html/.test(runAJ(role, onderwegAJ, false)), "AJ1 " + role + " : blocage livraison, jamais « Vul IBAN in »");
      assert.match(runAJ(role, onderwegAJ, false), /<a class="staff-action-secondary" href="\/leveringen\.html">Levering bevestigen<\/a>/, "AJ1 " + role + " : commande en route → vers Leveringen");
      assert.equal(runAJ(role, klaarAJ, false), "", "AJ1 " + role + " : commande pas encore partie → aucun bouton");
    }
    assert.ok(!/Vul IBAN in/.test(runAJ("admin", beschikbaarAJ, false)), "AJ2 IBAN réel : seulement Bekijken");
    assert.match(runAJ("admin", beschikbaarAJ, true), /Bekijken<\/button><a class="staff-action-secondary" href="\/beheer\.html">Vul IBAN in<\/a>/, "AJ2 IBAN d'exemple : « Vul IBAN in » pour le beheerder");
    assert.ok(!/beheer\.html/.test(runAJ("staff", beschikbaarAJ, true)), "AJ2 personnel : jamais de lien vers Beheer");
  }
  console.log("✓ AJ. Documenten : « Vul IBAN in » seulement si l'IBAN manque ; blocage livraison → Leveringen");

  // --- AK. Montants hors TVA signalés partout où le client ou l'équipe voit un total ---------
  {
    const srcAK = f => fs.readFileSync(path.join(ROOT, f), "utf8");
    const idxAK = srcAK("index.html");
    assert.match(idxAK, /<div class="total"><span>Totaal excl\. btw<\/span>/, "AK1 panier : total excl. btw");
    assert.match(idxAK, /<div class="conf-row"><span>Totaal excl\. btw<\/span>/, "AK1 confirmation : total excl. btw");
    assert.match(idxAK, /<div class="grand"><span>Totaal excl\. btw<\/span>/, "AK1 bevestiging afdrukken : total excl. btw");
    assert.match(idxAK, /order-total tnum">'\+eur\(o\.total\)\+' <small>excl\. btw<\/small>/, "AK1 historique : excl. btw");
    assert.match(idxAK, /mobileCount\.textContent=[^;]*' · excl\. btw'/, "AK1 barre mobile : excl. btw");
    assert.match(srcAK("invoer.html"), /TOTAAL excl\. btw[\s\S]*TOTAAL excl\. btw[\s\S]*Totaal excl\. btw: <b>/, "AK2 Invoeren : totaux excl. btw");
    assert.match(srcAK("order.html"), /<div class="o-total"><span>Totaal excl\. btw<\/span>/, "AK2 fiche commande : excl. btw");
    assert.match(srcAK("entrepot.html"), /Werkelijk totaal \(excl\. btw\): <input/, "AK2 Magazijn : total réel excl. btw");
    assert.match(srcAK("bestellingen.html"), /<p class="orders-note">Bedragen excl\. btw\./, "AK2 Bestellingen : bedragen excl. btw");
    assert.match(srcAK("documenten.html"), /<th class="r">Bedrag excl\. btw<\/th>/, "AK2 Documenten : bedrag excl. btw");
    delete require.cache[require.resolve(path.join(ROOT, "lib", "ordermail.js"))];
    const mailAK = require(path.join(ROOT, "lib", "ordermail.js"));
    const ctxMailAK = { ref: "CMD-2026-0600", date: "2026-09-14", dateLivraison: "2026-09-15", lignes: "Zalm × 2 kg [€12.50]", total: 25,
      klant: { nom: "Resto Test", email: "chef@resto.test" }, company: { bedrijfsnaam: "Famo Trading BV" }, opsEmail: "ops@famo.test" };
    for (const m of [mailAK.buildCustomerMail(ctxMailAK), mailAK.buildTeamMail(ctxMailAK)]) {
      assert.match(m.html, />Totaal excl\. btw<\/td>/, "AK3 e-mail HTML : total excl. btw");
      assert.match(m.text, /Totaal excl\. btw: € 25,00/, "AK3 e-mail texte : total excl. btw");
    }
  }
  console.log("✓ AK. Totaux signalés hors TVA (portail, e-mails, Invoeren, fiche, Magazijn, Bestellingen, Documenten)");



  // silence unused after restore
  assert.ok(authlib2.hasCode());

  console.log("✓ Regles release candidate (validation explicite, 405 GET, 410 cadrage)");
  console.log("✓ Règles métier commande, préparation et livraison");
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
