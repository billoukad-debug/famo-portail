// Règles métier critiques, sans accès Airtable réel.
// Les appels réseau sont simulés pour vérifier les gardes du backend.
process.env.STAFF_CODE = process.env.STAFF_CODE || "testcode-ci";
const assert = require("assert");
const path = require("path");

function json(payload) {
  return { json: async () => payload };
}

async function call(handler, body, replies) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options: options || {} });
    assert(replies.length, `Appel Airtable inattendu: ${url}`);
    return json(replies.shift());
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; }
  };
  try {
    await handler({ method: "POST", body }, res);
    return { res, calls };
  } finally {
    global.fetch = originalFetch;
  }
}

async function main() {
  const updateOrder = require(path.join(__dirname, "..", "api", "updateorder.js"));
  const createOrder = require(path.join(__dirname, "..", "api", "order.js"));

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
  const catalogue = require(path.join(__dirname, "..", "api", "catalogue.js"));
  {
    const res = { statusCode: 200, payload: null, status(c){this.statusCode=c;return this}, json(p){this.payload=p;return p} };
    await catalogue({ method: "GET", query: { user: "x", pw: "y" } }, res);
    assert.equal(res.statusCode, 405, "GET avec mot de passe doit etre refuse");
  }

  // 3. cadrage definitivement ferme -> 410
  const cadrage = require(path.join(__dirname, "..", "api", "cadrage.js"));
  {
    const res = { statusCode: 200, payload: null, status(c){this.statusCode=c;return this}, json(p){this.payload=p;return p} };
    await cadrage({ method: "POST", body: {} }, res);
    assert.equal(res.statusCode, 410, "cadrage doit renvoyer 410");
  }


  // --- Session staff commune ---
  const session = require(path.join(__dirname, "..", "api", "session.js"));
  const authlib = require(path.join(__dirname, "..", "lib", "staffauth.js"));
  function mkRes(){ const r={statusCode:200,payload:null,headers:{},status(c){this.statusCode=c;return this},json(p){this.payload=p;return p},setHeader(k,v){this.headers[k]=v}}; return r; }

  // login correct -> cookie HttpOnly Secure SameSite
  let sres = mkRes();
  await session({ method:"POST", body:{ code: process.env.STAFF_CODE }, headers:{} }, sres);
  assert.equal(sres.statusCode, 200, "login session doit reussir");
  const setC = sres.headers["Set-Cookie"] || "";
  assert(/famo_sess=/.test(setC) && /HttpOnly/.test(setC) && /Secure/.test(setC) && /SameSite=Lax/.test(setC), "cookie session incomplet");
  const tok = decodeURIComponent(/famo_sess=([^;]+)/.exec(setC)[1]);

  // mauvais code -> 401 ; ancien code public -> 401
  sres = mkRes(); await session({ method:"POST", body:{ code:"famo2026" }, headers:{} }, sres);
  assert.equal(sres.statusCode, 401, "ancien code public doit etre refuse");

  // GET avec cookie -> 200 ; sans -> 401
  sres = mkRes(); await session({ method:"GET", headers:{ cookie:"famo_sess="+encodeURIComponent(tok) } }, sres);
  assert.equal(sres.statusCode, 200, "session valide doit etre reconnue (nouvel onglet)");
  sres = mkRes(); await session({ method:"GET", headers:{} }, sres);
  assert.equal(sres.statusCode, 401, "sans session -> 401");

  // token expire -> 401
  const expired = authlib.sign(Date.now() - 1000);
  sres = mkRes(); await session({ method:"GET", headers:{ cookie:"famo_sess="+encodeURIComponent(expired) } }, sres);
  assert.equal(sres.statusCode, 401, "session expiree doit etre refusee");

  // token falsifie -> 401
  sres = mkRes(); await session({ method:"GET", headers:{ cookie:"famo_sess="+encodeURIComponent(tok.split(".")[0]+".AAAA") } }, sres);
  assert.equal(sres.statusCode, 401, "signature falsifiee refusee");

  // une API staff accepte le cookie SANS code dans l'URL
  {
    const res2 = mkRes();
    await updateOrder({ method:"POST", body:{ id:"rec1" }, headers:{ cookie:"famo_sess="+encodeURIComponent(tok) } }, res2, );
    assert.notEqual(res2.statusCode, 401, "cookie doit suffire pour les API staff");
  }
  console.log("✓ Session staff commune (cookie HttpOnly, expiration, logout, compat code)");

  console.log("✓ Regles release candidate (validation explicite, 405 GET, 410 cadrage)");

  console.log("✓ Règles métier commande, préparation et livraison");
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
