// Règles métier critiques, sans accès Airtable réel.
// Les appels réseau sont simulés pour vérifier les gardes du backend.
process.env.STAFF_CODE = process.env.STAFF_CODE || "testcode-ci";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "admincode-ci";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
// Mots de passe clients tels qu'ils sont stockés : empreinte scrypt (lib/clientauth.js).
// famoNL (dictionnaire d'affichage) vit dans assets/ui.js : on l'exécute une fois dans un bac
// à sable minimal et on l'injecte là où un test chargeait l'ancien staff-i18n.js.
const UI_NL = (() => {
  const sb = { console, document: { documentElement: {}, addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem() { return null; }, setItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, navigator: { language: "nl" }, location: { search: "", pathname: "/", hash: "" } };
  sb.window = sb; vm.createContext(sb); vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8"), sb);
  return { famoNL: sb.famoNL, FAMO_NL: sb.FAMO_NL };
})();
const HP = (() => { const cache = {}; return pw => cache[pw] || (cache[pw] = require(path.join(ROOT, "lib/clientauth")).hashPassword(pw)); })();

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
  console.log("✓ C. Stock déduit une seule fois / 409 si afgeboekt / verrou aussi sans skipStock");

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
      { records: [{ fields: { "Voorraad afboeken": true } }] },
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
    // famoNL vit dans assets/ui.js (plus de staff-i18n.js séparé).
    const sandbox = { console, document: { documentElement: {}, addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem() { return null; }, setItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, navigator: { language: "nl" }, location: { search: "", pathname: "/", hash: "" } };
    sandbox.window = sandbox; vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "ui.js"), "utf8"), sandbox);
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
    assert.match(ui, /const NAV_STAFF_MORE\s*=\s*\[\["invoer\.html",\s*"Invoeren"[\s\S]*?\["documenten\.html",\s*"Documenten"\]?[^\]]*\]\s*\]/, "I personnel : Invoeren + Documenten, sans Beheer");
    assert.ok(!/NAV_STAFF_MORE\s*=[^;]*beheer\.html/.test(ui), "I personnel sans écran Beheer");
    assert.match(ui, /admin\s*\?\s*NAV_ADMIN\s*:\s*NAV_STAFF_MORE/, "I menu sélectionné selon le rôle");
    assert.match(ui, /link\(\["stock\.html",\s*"Voorraad"/, "I Voorraad voor personeel én beheerder");
    assert.match(fs.readFileSync(path.join(ROOT, "assets", "pages", "stock.js"), "utf8"), /K\.requireStaff\(\)/, "I stock.js open voor personeel");
    assert.match(fs.readFileSync(path.join(ROOT, "assets", "pages", "invoer.js"), "utf8"), /K\.requireStaff\(\)/, "I invoer.js open voor personeel");
  }
  console.log("✓ I. Navigation v2 (Dagelijks, Beheer, séparation des rôles)");

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
    const CLIENT_OK = { records: [{ id: "client1", fields: { "Wachtwoord": HP("pass"), "Nom": "Resto Test", "Email": "chef@resto.test" } }] };
    const CAT = { records: [{ id: "prod1", fields: { "Produit": "Mosselen", "Prix de base": 28, "Unité": "caisse" } }] };
    const ORDER_BODY = { user: "test", pw: "pass", items: [{ productId: "prod1", quantity: 2 }], notes: "INTERNE-NOTITIE" };

    // M1 — sans cle : aucune tentative, sequence d'appels inchangee.
    delete process.env.RESEND_API_KEY;
    reloadMail();
    let createOrderM = require(path.join(ROOT, "api", "order.js"));
    let r1 = await call(createOrderM, ORDER_BODY, [CLIENT_OK, { records: [] }, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }]);
    assert.equal(r1.res.statusCode, 200, "M1 commande OK sans cle");
    assert.equal(r1.calls.length, 6, "M1 aucun appel supplementaire sans cle (client, configuratie, catalogue, prix, numérotation, commande)");
    assert.equal(resendCalls(r1.calls).length, 0, "M1 aucun appel Resend sans cle");

    // M2 — avec cle : deux mails, destinataires disjoints, secret non fuite.
    process.env.RESEND_API_KEY = "re_test_key";
    reloadMail();
    createOrderM = require(path.join(ROOT, "api", "order.js"));
    const r2 = await call(createOrderM, ORDER_BODY, [
      CLIENT_OK, { records: [] }, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, CFG, { id: "m1" }, { id: "m2" }
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
    const XSS = { records: [{ id: "client1", fields: { "Wachtwoord": HP("pass"), "Nom": "<img src=x onerror=alert(1)>", "Email": "chef@resto.test" } }] };
    const rX = await call(createOrderM, ORDER_BODY, [
      XSS, { records: [] }, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, CFG, { id: "m1" }, { id: "m2" }
    ]);
    resendCalls(rX.calls).map(bodyOf).forEach(m => {
      assert.ok(!/<img/i.test(m.html), "M2d nom client echappe");
      assert.match(m.html, /kassa/, "M2d unite traduite en kassa");
      assert.ok(!/>caisse</.test(m.html), "M2d jamais le mot francais caisse a l'ecran");
    });

    // M3 — Resend en echec : la commande reste un succes.
    for (const failMode of ["throw", "422"]) {
      const originalFetch = global.fetch;
      const replies = [CLIENT_OK, { records: [] }, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, CFG];
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
    const NO_MAIL = { records: [{ id: "client1", fields: { "Wachtwoord": HP("pass"), "Nom": "Resto Test" } }] };
    const r4 = await call(createOrderM, ORDER_BODY, [
      NO_MAIL, { records: [] }, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, CFG, { id: "m1" }
    ]);
    assert.equal(resendCalls(r4.calls).length, 1, "M4 un seul envoi sans e-mail client");
    assert.ok(bodyOf(resendCalls(r4.calls)[0]).to.includes("ops@famo.test"), "M4 c'est l'equipe qui recoit");
    assert.equal(r4.res.payload.mail.customer.skipped, "no-recipient", "M4 absence de destinataire signalee");

    // M5 — pas de boite ops : seul le client est prevenu.
    const NO_OPS = { records: [{ fields: { "Bedrijfsnaam": "Famo Trading BV", "E-mail": "info@famotrading.be" } }] };
    const r5 = await call(createOrderM, ORDER_BODY, [
      CLIENT_OK, { records: [] }, CAT, { records: [] }, NO_ORDER_REFS, { records: [{ id: "order1" }] }, NO_OPS, { id: "m1" }
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
      const famoNL = UI_NL.famoNL;
      const fixtures = [
        "Zalm × 2 kg [€12.50]",
        "Mosselen × 1 caisse [€28.00] (zonder ijs)",
        "Kabeljauw x 0.5 kg",
        "Garnalen × 3"
      ];
      fixtures.forEach(f => {
        assert.deepEqual(om.parseLines(f), FamoDocs.parse(f), "M6 parseur identique a documents.js : " + f);
        assert.equal(om.nlLines(f), famoNL.lines(f), "M6b traduction identique a ui.js (famoNL) : " + f);
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
    const clientRec = (id, user, pw) => ({ records: [{ id, fields: { "Nom": "Resto " + user, "Gebruikersnaam": user, "Wachtwoord": pw ? HP(pw) : pw } }] });
    const patchesAL = calls => calls.filter(c => (c.options.method || "GET").toUpperCase() === "PATCH");
    const lookupAL = calls => decodeURIComponent((calls.find(c => /\/Clients\?filterByFormula=/.test(c.url)) || { url: "" }).url);

    // AL1 — ancien mot de passe correct : un seul PATCH, sur ce client, dans le champ Wachtwoord.
    let r = await call(klantPw, { user: "anna", pw: "oud-wachtwoord", nieuw: "nieuw-wachtwoord" }, [
      clientRec("recAnna", "anna", "oud-wachtwoord"),
      { id: "recAnna", fields: { "Wachtwoord": "nieuw-wachtwoord" } }
    ]);
    assert.equal(r.res.statusCode, 200, "AL1 ancien mot de passe correct → changement accepté");
    assert.equal(r.res.payload.ok, true, "AL1 ok");
    assert.ok(!JSON.stringify(r.res.payload).includes("wachtwoord"), "AL1 le mot de passe n'est jamais renvoyé");
    assert.match(String(r.res.payload.token), /^k\.recAnna\./, "AL1 nouveau jeton client (l'ancien ne vaut plus)");
    assert.match(lookupAL(r.calls), /LOWER\(\{Gebruikersnaam\}\)='anna'/, "AL1 le client est retrouvé par son gebruikersnaam");
    assert.equal(patchesAL(r.calls).length, 1, "AL1 exactement un PATCH");
    assert.match(patchesAL(r.calls)[0].url, /\/Clients\/recAnna$/, "AL1 PATCH sur le client vérifié");
    const al1 = JSON.parse(patchesAL(r.calls)[0].options.body);
    assert.deepEqual(Object.keys(al1.fields), ["Wachtwoord"], "AL1 seul le champ Wachtwoord change");
    assert.match(al1.fields.Wachtwoord, /^scrypt\$/, "AL1 stocké haché, jamais en clair");
    assert.ok(require(path.join(ROOT, "lib/clientauth")).checkPassword(al1.fields.Wachtwoord, "nieuw-wachtwoord"), "AL1 l'empreinte correspond au nouveau mot de passe");

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
    assert.equal((lookupAL(r.calls).replace(/\\'/g, "").match(/'/g) || []).length, 2, "AL4c apostrophes échappées dans la formule");
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

  // Aides communes aux sections AO–AW : dates civiles (Bruxelles), lecture des PATCH simulés.
  const lev = require(path.join(ROOT, "lib", "levering.js"));
  const todayX = lev.brusselsToday();
  const plusX = n => { const d = new Date(todayX + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dowX = iso => new Date(iso + "T12:00:00Z").getUTCDay();
  const nextDowX = dow => { let n = 1; while (dowX(plusX(n)) !== dow) n++; return plusX(n); };
  const okDayX = dowX(plusX(1)) === 0 ? plusX(2) : plusX(1);
  const sundayX = nextDowX(0), saturdayX = nextDowX(6);
  const yearX = authlib.brusselsYear();
  const patchOfX = (r, re) => JSON.parse(r.calls.find(c => re.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH").options.body);
  const methodCallsX = (r, m) => r.calls.filter(c => (c.options.method || "GET").toUpperCase() === m);

  // --- AO. lib/levering.js : règles de livraison, une seule source (panier, saisie, corrections) ---
  {
    const R = lev.rulesFrom({});
    assert.deepEqual(R, { deadline: "22:00", dagen: [1, 2, 3, 4, 5, 6], gesloten: [], minimum: 0, betaaltermijn: 14, voorraadAfboeken: false, maxDagen: 60 }, "AO0 règles par défaut");
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
  console.log("✓ AO. lib/levering (passé, > 60 j, dimanche, jour fermé, jour non livré, parsing, bloc public)");

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
  console.log("✓ AP. Commande client : minimum (Configuratie), jour fermé / non livré / dimanche refusés avant écriture");

  // --- AQ. api/updateorder.js : paiement, réception, uitzondering, volgorde, creditnota, gardes, lignes ---
  {
    clearModule("api/updateorder.js");
    const uo = require(path.join(ROOT, "api", "updateorder.js"));
    const cmdPatch = r => patchOfX(r, /Commandes\//);
    const FACT = extra => ({ fields: Object.assign({ Statut: "Facturée", Factuurnummer: "FA-2026-0001", "Référence": "CMD-40", "Livraison confirmée": true, "Statut paiement": "En attente", "Lignes (produits / quantités)": "Mosselen × 2 caisse [€28.00]\nZalm × 1.5 kg [€20.00]", Client: ["cliAQ"] }, extra || {}) });
    let r, b;
    // 1. Betaald : enkel op een factuur ; datum + wijze ; terug op openstaand wist beide.
    r = await call(uo, { id: "o1", paiement: "Payé", modePaiement: "Contant" }, [{ fields: { Statut: "Prête" } }], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 409, "AQ1 betaald enkel na factuur"); assert.equal(methodCallsX(r, "PATCH").length, 0);
    r = await call(uo, { id: "o1", paiement: "Payé", modePaiement: "Bancontact" }, [FACT(), { fields: {} }], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 200, "AQ1 betaald op factuur");
    b = cmdPatch(r);
    assert.equal(b.fields["Statut paiement"], "Payé"); assert.ok(Date.parse(b.fields["Payé le"]) > 0, "AQ1 Payé le"); assert.equal(b.fields["Mode de paiement"], "Bancontact");
    assert.match(b.fields.Correcties, /Betaald \(Bancontact\) · personeel$/, "AQ1 journal");
    r = await call(uo, { id: "o1", paiement: "Payé", modePaiement: "Cheque" }, [FACT()], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 400, "AQ1 betaalwijze inconnue"); assert.match(r.res.payload.error, /betaalwijze/);
    r = await call(uo, { id: "o1", paiement: "Payé" }, [FACT(), { fields: {} }], { headers: cookieHdr });
    b = cmdPatch(r); assert.equal(b.fields["Mode de paiement"], undefined, "AQ1 wijze facultatief"); assert.match(b.fields.Correcties, /Betaald · personeel$/);
    r = await call(uo, { id: "o1", paiement: "Payé" }, [FACT({ "Statut paiement": "Payé" }), { fields: {} }], { headers: cookieHdr });
    assert.equal(cmdPatch(r).fields.Correcties, undefined, "AQ1 déjà payé : pas de doublon dans le journal");
    r = await call(uo, { id: "o1", paiement: "En attente", reden: "verkeerde klant" }, [FACT({ "Statut paiement": "Payé", "Payé le": "2026-09-01T10:00:00.000Z", "Mode de paiement": "Contant" }), { fields: {} }], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 200, "AQ1 terug op openstaand"); b = cmdPatch(r);
    assert.equal(b.fields["Payé le"], null); assert.equal(b.fields["Mode de paiement"], null); assert.match(b.fields.Correcties, /Terug op openstaand · personeel — verkeerde klant$/);
    r = await call(uo, { id: "o1", paiement: "Gratis" }, [FACT()], { headers: cookieHdr }); assert.equal(r.res.statusCode, 400, "AQ1 betaalstatus inconnu");
    // 2. Dubbele ontvangstbevestiging (dubbeltik, tweede toestel) → 409, niets herschreven.
    r = await call(uo, { id: "o2", statut: "Facturée", deliveryConfirmed: true, recipient: "Kenji" }, [FACT()], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 409, "AQ2 al bevestigd"); assert.match(r.res.payload.error, /al bevestigd/); assert.equal(methodCallsX(r, "PATCH").length, 0);
    // 3. Uitzondering bij levering : op de bestelling én in het journaal ; onbekende → 400.
    const SORTIE = { fields: { Statut: "Sortie en livraison", "Référence": "CMD-41", "Préparation validée": true, "Lignes (produits / quantités)": "Mosselen × 2 caisse [€28.00]", Client: ["cliAQ"] } };
    r = await call(uo, { id: "o3", statut: "Facturée", deliveryConfirmed: true, recipient: "Kenji", uitzondering: "Gedeeltelijk", uitzonderingNota: "1 doos\nte weinig" }, [SORTIE, { records: [{ fields: { Factuurnummer: "FA-" + yearX + "-0007" } }] }, { fields: {} }, { records: [{ fields: {} }] }], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 200, "AQ3 uitzondering"); assert.equal(r.res.payload.factuurnummer, "FA-" + yearX + "-0008", "AQ3 factuurnummer volgt");
    b = cmdPatch(r);
    assert.equal(b.fields["Uitzondering levering"], "Gedeeltelijk"); assert.equal(b.fields["Uitzondering nota"], "1 doos te weinig", "AQ3 nota op één regel");
    assert.equal(b.fields["Livraison confirmée"], true); assert.equal(b.fields["Réceptionné par"], "Kenji"); assert.equal(b.fields.Factuurnummer, "FA-" + yearX + "-0008");
    assert.match(b.fields.Correcties, /Uitzondering bij levering: Gedeeltelijk · personeel — 1 doos te weinig$/, "AQ3 journal");
    r = await call(uo, { id: "o3", statut: "Facturée", deliveryConfirmed: true, recipient: "Kenji", uitzondering: "Verdwenen" }, [SORTIE], { headers: cookieHdr });
    assert.equal(r.res.statusCode, 400, "AQ3 onbekende uitzondering"); assert.match(r.res.payload.error, /Ongeldige uitzondering/);
    r = await call(uo, { id: "o3", statut: "Facturée", deliveryConfirmed: true, recipient: "Kenji" }, [SORTIE, { records: [] }, { fields: {} }, { records: [{ fields: {} }] }], { headers: cookieHdr });
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
    r = await call(uo, cn("Mosselen × 1"), [FACT({ "Creditnota nummer": "CN-2026-0001" })], { headers: adminCookieHdr });
    assert.equal(r.res.statusCode, 409, "AQ5 één creditnota per factuur"); assert.match(r.res.payload.error, /CN-2026-0001/);
    r = await call(uo, cn("Mosselen × 1", { retourStock: true }), [FACT(), { records: [] }, { records: [{ id: "stk", fields: { Produit: "Mosselen", "Quantité disponible": 4 } }] }, { records: [] }, { records: [] }, { fields: {} }, { records: [{ id: "o5" }] }], { headers: adminCookieHdr });
    assert.equal(r.res.statusCode, 200, "AQ5 retour in voorraad");
    assert.equal(JSON.parse(r.calls.find(c => /\/Stock$/.test(c.url) && (c.options.method || "").toUpperCase() === "PATCH").options.body).records[0].fields["Quantité disponible"], 5, "AQ5 voorraad +1");
    const mv = JSON.parse(r.calls.find(c => /Mouvements/.test(c.url)).options.body).records[0].fields;
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
  console.log("✓ AQ. Bijwerken : betaald (datum, wijze), dubbele ontvangst 409, uitzondering, volgorde, creditnota, gardes, lijnen aan figés prijzen");

  // --- AR. api/klantorder.js : profile, favorites, reset (neutre, 3/u, nooit zonder e-mailmatch) ---
  {
    clearModule("api/catalogue.js"); clearModule("api/klantorder.js");
    let ko = require(path.join(ROOT, "api", "klantorder.js"));
    const CLI = { records: [{ id: "cliAR", fields: { Gebruikersnaam: "aloha", Wachtwoord: HP("welkom123"), Nom: "Aloha", Email: "keuken@aloha.test" } }] };
    const me = extra => Object.assign({ user: "aloha", pw: "welkom123" }, extra);
    let r = await call(ko, me({ action: "profile", email: "geen-adres" }), [CLI]);
    assert.equal(r.res.statusCode, 400, "AR1 e-mail ongeldig"); assert.match(r.res.payload.error, /Ongeldig e-mailadres/); assert.equal(methodCallsX(r, "PATCH").length, 0);
    r = await call(ko, me({ action: "profile", email: " Chef@Aloha.TEST ", tel: " +32 3 000 00 00 " }), [CLI, { fields: {} }]);
    assert.equal(r.res.statusCode, 200, "AR1 profiel"); assert.deepEqual(patchOfX(r, /Clients\/cliAR$/).fields, { Email: "chef@aloha.test", "Téléphone": "+32 3 000 00 00" }); assert.equal(r.res.payload.email, "chef@aloha.test");
    r = await call(ko, me({ action: "profile", tel: "03 1" }), [CLI, { fields: {} }]);
    assert.deepEqual(patchOfX(r, /Clients\/cliAR$/).fields, { "Téléphone": "03 1" }, "AR1 enkel wat meegestuurd is");
    r = await call(ko, me({ action: "profile" }), [CLI]); assert.equal(r.res.statusCode, 400, "AR1 niets gewijzigd");
    r = await call(ko, me({ action: "favorites", favorieten: ["recAAAAAAAAAAAAAA", "bad", 12, "recBBBBBBBBBBBBBB", "recAAAAAAAAAAAAAA;DROP"], standaard: { recAAAAAAAAAAAAAA: "2.5", bad: 3, recBBBBBBBBBBBBBB: 0, recCCCCCCCCCCCCCC: 100001, recDDDDDDDDDDDDDD: "x" } }), [CLI, { fields: {} }]);
    assert.equal(r.res.statusCode, 200, "AR2 favorieten");
    assert.deepEqual(r.res.payload.favorieten, ["recAAAAAAAAAAAAAA", "recBBBBBBBBBBBBBB"], "AR2 enkel geldige record-ids");
    assert.deepEqual(r.res.payload.standaard, { recAAAAAAAAAAAAAA: 2.5 }, "AR2 standaard : geldige id, hoeveelheid > 0 en ≤ 100000");
    assert.deepEqual(JSON.parse(patchOfX(r, /Clients\/cliAR$/).fields.Favorieten), { favorieten: ["recAAAAAAAAAAAAAA", "recBBBBBBBBBBBBBB"], standaard: { recAAAAAAAAAAAAAA: 2.5 } }, "AR2 JSON opgeslagen");
    r = await call(ko, me({ action: "favorites", favorieten: "x", standaard: [] }), [CLI, { fields: {} }]);
    assert.deepEqual(r.res.payload, { ok: true, favorieten: [], standaard: {} }, "AR2 onleesbaar → leeg");
    r = await call(ko, me({ action: "favorites", pw: "fout" }), [CLI]); assert.equal(r.res.statusCode, 401, "AR2 verkeerd wachtwoord"); assert.equal(methodCallsX(r, "PATCH").length, 0);
    r = await call(ko, me({ action: "onbekend" }), [CLI]); assert.equal(r.res.statusCode, 400, "AR2 onbekende actie");
    // reset — zonder mailsleutel : neutraal antwoord, geen enkele Airtable-lezing, 4e aanvraag/uur 429.
    r = await call(ko, { action: "reset", user: "aloha", email: "geen-adres" }, []); assert.equal(r.res.statusCode, 400, "AR3 vorm");
    for (let i = 1; i <= 3; i++) {
      r = await call(ko, { action: "reset", user: "Aloha", email: "keuken@aloha.test" }, []);
      assert.equal(r.res.statusCode, 200, "AR3 aanvraag " + i); assert.equal(r.res.payload.mail, false); assert.match(r.res.payload.message, /Als de gegevens kloppen/); assert.equal(r.calls.length, 0, "AR3 zonder mail wordt niets gelezen");
    }
    r = await call(ko, { action: "reset", user: "aloha", email: "keuken@aloha.test" }, []); assert.equal(r.res.statusCode, 429, "AR3 4e aanvraag binnen het uur");
    // reset — met mailsleutel : zelfde antwoord bij mismatch of onbekend account, PATCH enkel bij match.
    const savedKey = process.env.RESEND_API_KEY;
    const mailMods = ["lib/mail.js", "lib/ordermail.js", "api/klantorder.js"];
    process.env.RESEND_API_KEY = "re_test_key_AR"; mailMods.forEach(clearModule); ko = require(path.join(ROOT, "api", "klantorder.js"));
    r = await call(ko, { action: "reset", user: "aloha2", email: "iemand@anders.test" }, [{ records: [{ id: "cliAR2", fields: { Gebruikersnaam: "aloha2", Email: "keuken@aloha.test" } }] }]);
    assert.equal(r.res.statusCode, 200, "AR4 mismatch → neutraal"); assert.match(r.res.payload.message, /Als de gegevens kloppen/); assert.equal(r.calls.length, 1, "AR4 geen PATCH, geen mail"); assert.equal(r.res.payload.mail, undefined);
    r = await call(ko, { action: "reset", user: "aloha2", email: "geen@account.test" }, [{ records: [] }]);
    assert.equal(r.res.statusCode, 200, "AR4 onbekend account → zelfde antwoord"); assert.equal(r.calls.length, 1);
    r = await call(ko, { action: "reset", user: "aloha3", email: "keuken@aloha.test" }, [{ records: [{ id: "c3", fields: { Gebruikersnaam: "aloha3", Email: "keuken@aloha.test", Gearchiveerd: true } }] }]);
    assert.equal(r.res.statusCode, 200, "AR4 gearchiveerd → neutraal"); assert.equal(r.calls.length, 1, "AR4 gearchiveerd : geen PATCH");
    r = await call(ko, { action: "reset", user: "ALOHA2", email: "Keuken@Aloha.test" }, [{ records: [{ id: "cliAR2", fields: { Gebruikersnaam: "aloha2", Email: " keuken@aloha.test ", Nom: "Aloha" } }] }, { fields: {} }, { records: [{ fields: { Bedrijfsnaam: "Famo" } }] }, { id: "m1" }]);
    assert.equal(r.res.statusCode, 200, "AR4 match → nieuw wachtwoord"); assert.match(r.res.payload.message, /Als de gegevens kloppen/);
    const storedAR = patchOfX(r, /Clients\/cliAR2$/).fields.Wachtwoord;
    assert.match(storedAR, /^scrypt\$/, "AR4 opgeslagen als empreinte, nooit in klare tekst");
    const sent = r.calls.filter(c => /api\.resend\.com/.test(c.url));
    assert.equal(sent.length, 1, "AR4 één mail, naar het gekende adres"); assert.ok(sent[0].options.body.includes("keuken@aloha.test"));
    const pw = (String(JSON.parse(sent[0].options.body).text || sent[0].options.body).match(/[A-HJ-NP-Za-km-z2-9]{10}/g) || []).find(c => require(path.join(ROOT, "lib/clientauth")).checkPassword(storedAR, c));
    assert.equal(typeof pw, "string", "AR4 het wachtwoord (10 tekens) staat in de mail en past bij de empreinte");
    assert.ok(!JSON.stringify(r.res.payload).includes(pw), "AR4 het wachtwoord komt nooit in het antwoord");
    if (savedKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = savedKey;
    mailMods.forEach(clearModule);
  }
  console.log("✓ AR. Klantportaal : profiel, favorieten (gefilterd), wachtwoord vergeten (neutraal, 3/u, enkel bij e-mailmatch)");

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
    assert.equal(tokIlse.split(".").length, 4, "AS1 jeton à 4 segments (exp.role.naam.sig)");
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
  console.log("✓ AS. Sessie via PIN (Medewerkers) : naam in de cookie, GET geeft naam, rol volgens Rol + want, journaal op voornaam");

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
    // Medewerkers : PIN ≥ 4, enkel gehasht opgeslagen ; verwijderen.
    r = await call(ob, { action: "saveMedewerker", naam: "Tom", pin: "12" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 PIN te kort"); assert.match(r.res.payload.error, /PIN/); assert.equal(r.calls.length, 0);
    r = await call(ob, { action: "saveMedewerker", naam: "Tom" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 nieuw zonder PIN");
    r = await call(ob, { action: "saveMedewerker", naam: "", pin: "1234" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 naam verplicht");
    r = await call(ob, { action: "saveMedewerker", naam: " Tom ", rol: "beheerder", pin: "4321" }, [{ records: [{ id: "m1" }] }, ...STATUS()], { headers: adminCookieHdr });
    assert.equal(r.res.statusCode, 200, "AT5 medewerker aangemaakt");
    const post = r.calls[0]; assert.match(post.url, /Medewerkers$/); assert.equal((post.options.method || "").toUpperCase(), "POST");
    const pb = JSON.parse(post.options.body); const mf = pb.records[0].fields;
    assert.equal(pb.typecast, true, "AT5 typecast (Rol-optie)"); assert.equal(mf.Naam, "Tom"); assert.equal(mf.Rol, "beheerder"); assert.equal(mf.Actief, true);
    assert.match(mf["PIN hash"], /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/, "AT5 scrypt"); assert.ok(authlib.verifyHash(mf["PIN hash"], "4321"), "AT5 de hash opent met de PIN");
    assert.ok(!post.options.body.includes("4321"), "AT5 de PIN gaat nooit in klare tekst naar Airtable");
    r = await call(ob, { action: "saveMedewerker", id: "m1", naam: "Tom", rol: "superuser", actief: false }, [{ fields: {} }, ...STATUS()], { headers: adminCookieHdr });
    assert.equal(r.res.statusCode, 200, "AT5 bijwerken zonder PIN"); assert.deepEqual(patchOfX(r, /Medewerkers\/m1$/).fields, { Naam: "Tom", Rol: "personeel", Actief: false }, "AT5 hash onaangeroerd, onbekende rol → personeel");
    r = await call(ob, { action: "saveMedewerker", id: "m1", naam: "Tom", pin: "12" }, [], { headers: adminCookieHdr }); assert.equal(r.res.statusCode, 400, "AT5 nieuwe PIN te kort");
    r = await call(ob, { action: "deleteMedewerker", id: "m1" }, [{ deleted: true, id: "m1" }, ...STATUS()], { headers: adminCookieHdr });
    assert.equal(r.res.statusCode, 200, "AT5 verwijderd"); assert.match(r.calls[0].url, /Medewerkers\/m1$/); assert.equal((r.calls[0].options.method || "").toUpperCase(), "DELETE");
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
    r = await call(ob, { action: "saveClient", nom: "Ander", user: "oreilly", password: "geheim123", generate: false }, [{ records: [{ id: "c9" }] }], { headers: adminCookieHdr });
    assert.equal(r.res.statusCode, 409, "AT6 gebruikersnaam al in gebruik door een ander");
    r = await call(ob, { action: "saveClient", nom: "X", email: "nope", user: "xx", password: "geheim123", generate: false }, [{ records: [] }], { headers: adminCookieHdr });
    assert.equal(r.res.statusCode, 400, "AT6 e-mail klant"); assert.match(r.res.payload.error, /e-mailadres/);
  }
  console.log("✓ AT. Beheer : saveConfig-validatie (IBAN/BIC/BTW/deadline/gesloten/minimum/termijn), product uniek + btw, archiveren, medewerkers, klant");

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
  console.log("✓ AU. Voorraad : regel verwijderen enkel beheerder ; historiek gefilterd (product, dagen ≤ 365, limiet 10..500)");

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
  console.log("✓ AV. Invoeren : gearchiveerde klanten weg ; leverdag gecontroleerd met dezelfde regels ; regels meegegeven");

  // --- AW. api/catalogue.js : gearchiveerde klant meldt niet meer aan (ook orders/klantorder) ; favorieten + voorraad ---
  {
    clearModule("api/catalogue.js"); clearModule("api/orders.js"); clearModule("api/klantorder.js");
    const cat = require(path.join(ROOT, "api", "catalogue.js")), ords = require(path.join(ROOT, "api", "orders.js")), ko2 = require(path.join(ROOT, "api", "klantorder.js"));
    const ARCH = { records: [{ id: "n", fields: { Gebruikersnaam: "nora", Wachtwoord: "nora-vis-1", Gearchiveerd: true } }] };
    for (const [name, h, body] of [["catalogue", cat, { user: "nora", pw: "nora-vis-1" }], ["orders", ords, { user: "nora", pw: "nora-vis-1" }], ["klantorder", ko2, { user: "nora", pw: "nora-vis-1", action: "favorites" }]]) {
      const r = await call(h, body, [ARCH]);
      assert.equal(r.res.statusCode, 401, "AW1 gearchiveerd → 401 op " + name); assert.equal(r.calls.length, 1, "AW1 niets anders gelezen op " + name);
    }
    const ACT = fav => ({ records: [{ id: "a", fields: { Gebruikersnaam: "aloha", Wachtwoord: HP("w"), Nom: "Aloha", Favorieten: fav } }] });
    const CATZ = { records: [{ id: "pz", fields: { Produit: "Zalm", "Prix de base": 10, "Unité": "kg" } }] };
    let r = await call(cat, { user: "aloha", pw: "w" }, [ACT(JSON.stringify({ favorieten: ["recAAAAAAAAAAAAAA"], standaard: { recAAAAAAAAAAAAAA: 2 } })), CATZ, { records: [] }, { records: [{ fields: { "Voorraad afboeken": true, IBAN: "BE68539007547034", Leverdagen: "di", Bedrijfsnaam: "Famo" } }] }, { records: [{ fields: { Produit: " zalm", "Quantité disponible": 3 } }] }, { records: [{ fields: { Bedrijfsnaam: "Famo" } }] }]);
    assert.equal(r.res.statusCode, 200, "AW2 actieve klant");
    assert.deepEqual(r.res.payload.client.favorieten, { favorieten: ["recAAAAAAAAAAAAAA"], standaard: { recAAAAAAAAAAAAAA: 2 } }, "AW2 favorieten meegegeven");
    assert.equal(r.res.payload.products[0].voorraad, 3, "AW2 voorraad zichtbaar (op naam) wanneer afboeken aan staat");
    assert.equal(r.res.payload.company.iban, "BE68539007547034"); assert.deepEqual(r.res.payload.company.levering.leverdagen, ["di"]); assert.equal(r.res.payload.company.bedrijfsnaam, "Famo");
    r = await call(cat, { user: "aloha", pw: "w" }, [ACT("{{niet json"), CATZ, { records: [] }, { records: [{ fields: {} }] }, { records: [{ fields: {} }] }]);
    assert.equal(r.res.statusCode, 200, "AW3 zonder afboeken"); assert.equal(r.res.payload.products[0].voorraad, undefined, "AW3 geen voorraad getoond"); assert.equal(r.calls.filter(c => /\/Stock/.test(c.url)).length, 0, "AW3 Stock niet gelezen");
    assert.deepEqual(r.res.payload.client.favorieten, { favorieten: [], standaard: {} }, "AW3 onleesbare favorieten → leeg");
  }
  console.log("✓ AW. Klantportaal : gearchiveerde klant 401 (catalogue, orders, klantorder) ; favorieten ; voorraad enkel met afboeken");

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
      PRETE_OUT, { records: [] }, { fields: {} }, { records: [{ id: "recAA" }, { id: "recZZ" }] }
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
    assert.equal(ca.readToken("k.recL.1.abc.def"), null, "AX5 jeton périmé refusé");
  }
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
  console.log("✓ AZ. Bedragen : scherm = documenten = e-mails (€ 1.234,50)");
  console.log("✓ AY. Volgorde catalogus : enkel beheerder, validatie, enkel wijzigingen, gedeelde sortering");
  console.log("✓ AX. Numéro de facture unique, stock compensé, lignes + départ refusés, mots de passe hachés (migration), jeton client");

  console.log("✓ Regles release candidate (validation explicite, 405 GET, 410 cadrage)");
  console.log("✓ Règles métier commande, préparation et livraison");
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
