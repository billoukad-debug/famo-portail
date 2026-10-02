"use strict";
// Preuve de livraison sur place (audit H-09) sur le moteur SQL : signature et photo après la
// confirmation, octets vérifiés, ajoutées (jamais remplacées), servies au personnel seulement.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY;

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const ds = require(path.join(ROOT, "lib", "datastore.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const H = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
const staff = Object.assign({ cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, "staff")) }, H);
function mkRes() { const r = { statusCode: 200, payload: null, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; }, end(b) { this.body = b; return this; } }; return r; }
async function call(file, body, opts) { const res = mkRes(); await require(path.join(ROOT, "api", file))({ method: (opts && opts.method) || "POST", body, headers: (opts && opts.headers) || staff, query: (opts && opts.query) || {} }, res); return res; }
const rec = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });
const store = () => ds.state.store;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString("base64");

async function seed(confirmed) {
  await store().replaceAll("Commandes", [rec("recORD1", { "Référence": "CMD-2026-0042", Statut: confirmed ? "Facturée" : "Sortie en livraison", "Livraison confirmée": !!confirmed, "Réceptionné par": confirmed ? "Sofie" : "" })]);
  await store().replaceAll("Catalogue", [rec("recP1", { Produit: "Tong", "Prix de base": 30, Actif: true })]);
}

test("preuve : session, livraison confirmée, octets vérifiés", async () => {
  await seed(false);
  assert.equal((await call("bewijs.js", { id: "recORD1", soort: "handtekening", contentType: "image/png", base64: PNG }, { headers: H })).statusCode, 401);
  assert.equal((await call("bewijs.js", { id: "recORD1", soort: "handtekening", contentType: "image/png", base64: PNG })).statusCode, 409, "avant la confirmation");
  await seed(true);
  assert.equal((await call("bewijs.js", { id: "recORD1", soort: "handtekening", contentType: "image/png", base64: JPG })).statusCode, 400, "JPEG annoncé PNG");
  assert.equal((await call("bewijs.js", { id: "recORD1", soort: "handtekening", contentType: "image/png", base64: Buffer.from("<svg onload=alert(1)>").toString("base64") })).statusCode, 400);
  assert.equal((await call("bewijs.js", { id: "../Clients/x", soort: "foto", contentType: "image/jpeg", base64: JPG })).statusCode, 400);
});

test("signature puis photo : ajoutées, rejeu sans doublon, fichiers privés", async () => {
  await seed(true);
  const s = await call("bewijs.js", { id: "recORD1", soort: "handtekening", contentType: "image/png", base64: PNG });
  assert.equal(s.statusCode, 200, JSON.stringify(s.payload));
  const f = await call("bewijs.js", { id: "recORD1", soort: "foto", contentType: "image/jpeg", base64: JPG });
  assert.equal(f.statusCode, 200, JSON.stringify(f.payload));
  const again = await call("bewijs.js", { id: "recORD1", soort: "foto", contentType: "image/jpeg", base64: JPG });
  assert.equal(again.payload.al, true, "rejeu (file hors ligne) : rien ajouté");
  const files = (await store().get("Commandes", "recORD1")).fields["Preuve de livraison"];
  assert.deepEqual(files.map(a => a.filename), ["handtekening-CMD-2026-0042.png", "foto-CMD-2026-0042.jpg"]);
  const id = new URL("http://x" + files[0].url).searchParams.get("id");
  const anon = await call("foto.js", null, { method: "GET", query: { id }, headers: {} });
  assert.equal(anon.statusCode, 404, "sans session : invisible");
  const ok = await call("foto.js", null, { method: "GET", query: { id } });
  assert.equal(ok.statusCode, 200); assert.equal(ok.headers["cache-control"], "private, no-store");
  assert.ok((await store().list("Journaal")).some(r => r.fields.Actie === "Leveringsbewijs: handtekening"));
});

// Spec 018 : le moteur AJOUTE comme Airtable (plusieurs vues) ; le remplacement d'une photo est fait par
// l'API (uploadFoto sans « add » vide le champ d'abord : test/datastore.test.js, test/fotos.test.js).
test("photo produit : ajoutée au champ (comme Airtable) et publique", async () => {
  await seed(true);
  const up = async () => (await fetch("https://content.airtable.com/v0/appcdduLth9iGX8I0/recP1/Foto/uploadAttachment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: "image/png", filename: "tong.png", file: PNG }) })).json();
  await up(); await up();
  const foto = (await store().get("Catalogue", "recP1")).fields.Foto;
  assert.equal(foto.length, 2, "ajoutée, pas remplacée");
  assert.notEqual(foto[0].id, foto[1].id);
  const pub = await call("foto.js", null, { method: "GET", query: { id: foto[0].id }, headers: {} });
  assert.equal(pub.statusCode, 200); assert.match(pub.headers["cache-control"], /public/);
});
