// Règles métier critiques, sans accès Airtable réel.
// Les appels réseau sont simulés pour vérifier les gardes du backend.
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

  let result = await call(updateOrder, { code: "famo2026", id: "rec1", statut: "Sortie en livraison" }, [
    { fields: { Statut: "Prête", "Préparation validée": false } }
  ]);
  assert.equal(result.res.statusCode, 409);
  assert.match(result.res.payload.error, /Valideer eerst/);

  result = await call(updateOrder, { code: "famo2026", id: "rec1", statut: "Facturée" }, [
    { fields: { Statut: "Sortie en livraison" } }
  ]);
  assert.equal(result.res.statusCode, 409);
  assert.match(result.res.payload.error, /Bevestig eerst/);

  result = await call(updateOrder, { code: "famo2026", id: "rec1", preparationValidee: true }, [
    { fields: { Statut: "Reçue" } },
    { fields: { "Préparation validée": true } }
  ]);
  assert.equal(result.res.statusCode, 200);
  const preparationPatch = JSON.parse(result.calls[1].options.body);
  assert.equal(preparationPatch.fields["Préparation validée"], true);

  result = await call(updateOrder, {
    code: "famo2026", id: "rec1", lignes: "Mosselen × 0.5 caisse", total: 6
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

  console.log("✓ Règles métier commande, préparation et livraison");
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
