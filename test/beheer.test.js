// Actions Beheer (api/onboarding.js), correction de stock (api/stock.js) et
// configuration publique (api/config.js), sur la vraie chaîne : fonctions api/*.js ->
// lib/airtable.js -> lib/datastore.js -> moteur SQL (SQLite en mémoire), données de démo
// de scripts/seed.js. On vérifie pour chaque action : le rôle exigé (le personnel est
// refusé), la validation (400 sans rien écrire) et l'effet réel en base.
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = "team-test-code-1";
process.env.ADMIN_CODE = "beheer-test-code-1";
process.env.AIRTABLE_TOKEN = "patTESTTOKEN.secret-value-not-to-leak";
process.env.SESSION_SECRET = "session-secret-not-to-leak";
delete process.env.RESEND_API_KEY; // aucun e-mail réel
process.removeAllListeners("warning"); // node:sqlite est « expérimental »

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const ds = require(path.join(ROOT, "lib", "datastore.js"));
const { at, atAll } = require(path.join(ROOT, "lib", "airtable.js"));
const auth = require(path.join(ROOT, "lib", "staffauth.js"));
const ca = require(path.join(ROOT, "lib", "clientauth.js"));
const { FakeAirtable } = require(path.join(ROOT, "scripts", "fake-airtable.js"));
const { seed } = require(path.join(ROOT, "scripts", "seed.js"));

const ADMIN = { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "admin")) };
const STAFF = { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600000, "staff")) };
let ip = 0;

function mkRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = () => res;
  return res;
}
async function api(name, req) {
  const handler = require(path.join(ROOT, "api", name + ".js"));
  const res = mkRes();
  const headers = Object.assign({ "x-forwarded-for": "10.9.0." + (++ip % 250) }, req.headers || {});
  await handler(Object.assign({ method: "GET", query: {}, body: null }, req, { headers }), res);
  return res;
}
const beheer = (body, headers) => api("onboarding", { method: "POST", headers: headers || ADMIN, body });
const rows = async (table) => (await atAll(encodeURIComponent(table))).records;
const one = async (table, pred) => (await rows(table)).find(pred);
const byName = (nom) => (r) => r.fields["Nom"] === nom;
const snapshot = async () => JSON.stringify(await Promise.all(["Clients", "Configuratie", "Prix négociés", "Stock", "Mouvements de stock"].map(rows)));

// Le personnel (session staff valable) n'a pas accès à Beheer : refus, et rien n'est écrit.
async function refusedForStaff(body) {
  const before = await snapshot();
  const r = await beheer(body, STAFF);
  assert.ok(r.statusCode === 401 || r.statusCode === 403, body.action + " : personnel refusé (" + r.statusCode + ")");
  const anon = await beheer(body, {});
  assert.ok(anon.statusCode === 401 || anon.statusCode === 403, body.action + " : sans session refusé");
  assert.equal(await snapshot(), before, body.action + " : rien n'est écrit");
}
async function rejected(body, re) {
  const before = await snapshot();
  const r = await beheer(body);
  assert.equal(r.statusCode, 400, JSON.stringify(body) + " → 400 (" + JSON.stringify(r.body && r.body.error) + ")");
  if (re) assert.match(r.body.error, re);
  assert.equal(await snapshot(), before, JSON.stringify(body) + " : rien n'est écrit");
}

test.beforeEach(async () => {
  const demo = new FakeAirtable();
  seed(demo);
  for (const [tbl, recs] of Object.entries(demo.data)) await ds.state.store.replaceAll(tbl, recs);
});

// ---------------------------------------------------------------- api/config.js (public)
test("config publique : identité et règles de livraison, aucune donnée sensible", async () => {
  // Un code personnalisé enregistré (empreinte en base) ne doit fuiter nulle part.
  const cfg = (await rows("Configuratie"))[0];
  await at("Configuratie/" + cfg.id, { method: "PATCH", body: JSON.stringify({ fields: { "Beheerderscode hash": auth.hashCode("nieuwe-beheercode"), "Personeelscode hash": auth.hashCode("nieuwe-teamcode") } }) });
  const r = await api("config", { query: { public: "1" } });
  assert.equal(r.statusCode, 200);
  const c = r.body.config;
  assert.equal(c.bedrijfsnaam, "FAMO Seafood");
  assert.ok(c.levering && typeof c.levering === "object", "règles de livraison publiques");
  // « legal » : mentions WVV art. 2:20 que le site doit afficher (publiques par nature).
  assert.deepEqual(Object.keys(c).sort(), ["adres", "bedrijfsnaam", "btw", "email", "legal", "levering", "plaats", "telefoon"], "seulement le bloc contact et les mentions légales");
  assert.deepEqual(Object.keys(c.legal).sort(), ["btw", "handelsnaam", "naam", "ondernemingsnummer", "rechtsvorm", "rpr"]);
  const txt = JSON.stringify(r.body);
  for (const [label, secret] of [
    ["IBAN", cfg.fields["IBAN"]], ["BIC", cfg.fields["BIC"]], ["boîte interne des commandes", cfg.fields["Bestellingen e-mail"]],
    ["empreinte de code", "scrypt$"], ["jeton de base", process.env.AIRTABLE_TOKEN], ["secret de session", process.env.SESSION_SECRET],
    ["STAFF_CODE", process.env.STAFF_CODE], ["ADMIN_CODE", process.env.ADMIN_CODE], ["mot de passe client", "welkom123"]
  ]) assert.ok(!txt.includes(secret), "config publique : pas de " + label);
  assert.ok(!/iban|bic|hash|wachtwoord|token|code/i.test(Object.keys(c).join(",")), "aucune clé sensible");
});

test("config : sans session et sans ?public=1 → 401 ; personnel sans boîte interne ; beheerder sans empreinte", async () => {
  assert.equal((await api("config", {})).statusCode, 401);
  const staff = await api("config", { headers: STAFF });
  assert.equal(staff.statusCode, 200);
  assert.ok(staff.body.config.iban, "le personnel imprime des factures : IBAN présent");
  assert.equal(staff.body.config.bestellingenEmail, undefined, "boîte interne réservée au beheerder");
  // Un membre du personnel qui demande ?public=1 reçoit sa vue normale, pas plus.
  const admin = await api("config", { headers: ADMIN, query: { status: "1" } });
  assert.equal(admin.statusCode, 200);
  assert.equal(typeof admin.body.status.catalogue, "number");
  const txt = JSON.stringify(admin.body);
  assert.ok(!txt.includes("scrypt$") && !txt.includes(process.env.ADMIN_CODE) && !txt.includes(process.env.AIRTABLE_TOKEN), "ni empreinte, ni code, ni jeton");
});

// ---------------------------------------------------------------- saveCode
test("saveCode : beheerder seul, validation, empreinte en base, le nouveau code remplace l'ancien, reset", async () => {
  await refusedForStaff({ action: "saveCode", which: "admin", code: "nieuwe-beheercode" });
  await rejected({ action: "saveCode", which: "root", code: "nieuwe-beheercode" }, /codetype/);
  await rejected({ action: "saveCode", which: "admin", code: "kort" }, /10 tekens/);
  await rejected({ action: "saveCode", which: "admin", code: "FamoSeafood2026" }, /bedrijfsnaam/);

  const r = await beheer({ action: "saveCode", which: "admin", code: "nieuwe-beheercode" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.config.adminCodeCustom, true);
  assert.ok(!JSON.stringify(r.body).includes("scrypt$"), "l'empreinte n'est jamais renvoyée");
  const stored = (await rows("Configuratie"))[0].fields["Beheerderscode hash"];
  assert.match(stored, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/, "empreinte scrypt en base");
  assert.ok(!stored.includes("nieuwe-beheercode"), "jamais le code en clair");
  assert.equal((await rows("Configuratie"))[0].fields["Personeelscode hash"], undefined, "l'autre rôle n'est pas touché");

  const login = async (code, want) => api("session", { method: "POST", body: { code, want } });
  let s = await login("nieuwe-beheercode", "admin");
  assert.equal(s.statusCode, 200); assert.equal(s.body.role, "admin", "le nouveau code ouvre Beheer");
  s = await login(process.env.ADMIN_CODE, "admin");
  assert.equal(s.statusCode, 401, "l'ancien code (variable d'environnement) n'ouvre plus Beheer");
  assert.equal((await login(process.env.STAFF_CODE)).body.role, "staff", "le code du personnel reste valable");

  const reset = await beheer({ action: "saveCode", which: "admin", reset: true });
  assert.equal(reset.statusCode, 200);
  assert.equal((await rows("Configuratie"))[0].fields["Beheerderscode hash"], undefined, "reset : empreinte effacée");
  assert.equal((await login(process.env.ADMIN_CODE, "admin")).body.role, "admin", "reset : le code de l'environnement revient");

  const st = await beheer({ action: "saveCode", which: "staff", code: "nieuwe-teamcode" });
  assert.equal(st.statusCode, 200);
  assert.equal((await login("nieuwe-teamcode")).body.role, "staff");
  assert.equal((await login(process.env.STAFF_CODE)).statusCode, 401, "l'ancien code du personnel est remplacé");
});

// ---------------------------------------------------------------- revokeAccess / resetPassword
test("revokeAccess : beheerder seul, id valide, mot de passe effacé, connexion refusée, fiche intacte", async () => {
  const aloha = await one("Clients", byName("Aloha Poke Bowls"));
  assert.equal((await api("catalogue", { method: "POST", body: { user: "aloha", pw: "welkom123" } })).statusCode, 200, "témoin : connexion possible");
  await refusedForStaff({ action: "revokeAccess", id: aloha.id });
  await rejected({ action: "revokeAccess" }, /Klant-id/);
  await rejected({ action: "revokeAccess", id: "../Stock/x" }, /Klant-id/);
  assert.equal((await beheer({ action: "revokeAccess", id: "recONBEKEND0000000" })).statusCode, 404);
  const r = await beheer({ action: "revokeAccess", id: aloha.id });
  assert.equal(r.statusCode, 200);
  const after = await one("Clients", byName("Aloha Poke Bowls"));
  assert.equal(after.fields["Wachtwoord"], undefined, "mot de passe effacé");
  assert.equal(after.fields["Gebruikersnaam"], "aloha", "fiche intacte");
  assert.equal((await api("catalogue", { method: "POST", body: { user: "aloha", pw: "welkom123" } })).statusCode, 401, "connexion refusée");
});

test("resetPassword : beheerder seul, validation, empreinte en base, nouveau mot de passe utilisable", async () => {
  const kaai = await one("Clients", byName("Brasserie De Kaai"));
  await refusedForStaff({ action: "resetPassword", id: kaai.id, password: "nieuw-wachtwoord-1" });
  await rejected({ action: "resetPassword", password: "nieuw-wachtwoord-1" }, /Klant-id/);
  await rejected({ action: "resetPassword", id: kaai.id, password: "kort" }, /8 tekens/);
  assert.equal((await beheer({ action: "resetPassword", id: "recONBEKEND0000000", password: "nieuw-wachtwoord-1" })).statusCode, 404);

  let r = await beheer({ action: "resetPassword", id: kaai.id, password: "nieuw-wachtwoord-1" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.credentials.user, "dekaai"); assert.equal(r.body.credentials.password, "nieuw-wachtwoord-1");
  let stored = (await one("Clients", byName("Brasserie De Kaai"))).fields["Wachtwoord"];
  assert.ok(ca.isHashed(stored) && ca.checkPassword(stored, "nieuw-wachtwoord-1"), "empreinte scrypt en base");
  assert.equal((await api("catalogue", { method: "POST", body: { user: "dekaai", pw: "kaai2026!" } })).statusCode, 401, "ancien mot de passe refusé");
  assert.equal((await api("catalogue", { method: "POST", body: { user: "dekaai", pw: "nieuw-wachtwoord-1" } })).statusCode, 200, "nouveau mot de passe accepté");

  r = await beheer({ action: "resetPassword", id: kaai.id });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.credentials.password.length, 10, "mot de passe généré");
  stored = (await one("Clients", byName("Brasserie De Kaai"))).fields["Wachtwoord"];
  assert.ok(ca.checkPassword(stored, r.body.credentials.password));
});

// ---------------------------------------------------------------- deletePrice / saveClientPrices
test("deletePrice : beheerder seul, id obligatoire, accord supprimé en base", async () => {
  const before = await rows("Prix négociés");
  const target = before[0];
  await refusedForStaff({ action: "deletePrice", id: target.id });
  await rejected({ action: "deletePrice" }, /Prijs-id/);
  const r = await beheer({ action: "deletePrice", id: target.id });
  assert.equal(r.statusCode, 200);
  const after = await rows("Prix négociés");
  assert.equal(after.length, before.length - 1);
  assert.ok(!after.some(p => p.id === target.id), "accord supprimé");
});

test("deletePrice / closeAanvraag : un id avec « ../ » ne doit jamais atteindre une autre table", async () => {
  const aloha = await one("Clients", byName("Aloha Poke Bowls"));
  await beheer({ action: "deletePrice", id: "../Clients/" + aloha.id });
  assert.ok(await one("Clients", byName("Aloha Poke Bowls")), "deletePrice : le client existe toujours");
  const aan = (await rows("Aanvragen"))[0];
  await beheer({ action: "closeAanvraag", id: "../Aanvragen/" + aan.id });
  const r = await beheer({ action: "deletePrice", id: "../Clients/x" });
  assert.equal(r.statusCode, 400, "id refusé comme pour les autres actions (REC)");
});

test("saveClientPrices : beheerder seul, validation, création / mise à jour / effacement, résultat par produit", async () => {
  const aloha = await one("Clients", byName("Aloha Poke Bowls"));
  const cat = await rows("Catalogue");
  const P = (nom) => cat.find(p => p.fields["Produit"] === nom).id;
  await refusedForStaff({ action: "saveClientPrices", clientId: aloha.id, prices: [{ productId: P("Cabillaud"), prix: 20 }] });
  await rejected({ action: "saveClientPrices", prices: [{ productId: P("Cabillaud"), prix: 20 }] }, /Klant/);
  await rejected({ action: "saveClientPrices", clientId: aloha.id, prices: [] }, /Geen prijzen/);

  const r = await beheer({ action: "saveClientPrices", clientId: aloha.id, prices: [
    { productId: P("Cabillaud"), prix: "19.5" },   // nouveau (le front convertit la virgule)
    { productId: P("Saumon frais"), prix: 15 },    // existant (16) → 15
    { productId: P("Tonijn sashimi blok"), prix: "" }, // existant → vide (prix de base)
    { productId: P("Scampi"), prix: -3 },          // refusé
    { productId: "", prix: 5 }                     // refusé
  ] });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, false, "au moins un prix refusé");
  assert.deepEqual(r.body.results.map(x => x.ok), [true, true, true, false, false]);
  const mine = (await rows("Prix négociés")).filter(p => (p.fields["Client"] || []).includes(aloha.id));
  const priceOf = (id) => { const hit = mine.filter(p => (p.fields["Produit"] || []).includes(id)); assert.ok(hit.length <= 1, "jamais deux accords pour le même produit"); return hit[0] ? hit[0].fields["Prix négocié"] : "absent"; };
  assert.equal(priceOf(P("Cabillaud")), 19.5, "créé");
  assert.equal(priceOf(P("Saumon frais")), 15, "mis à jour");
  assert.equal(priceOf(P("Tonijn sashimi blok")), undefined, "vidé (prix de base), jamais 0");
  assert.equal(priceOf(P("Scampi")), "absent", "prix négatif non écrit");
});

// ---------------------------------------------------------------- saveStock (Beheer)
test("saveStock : beheerder seul, validation, mise à jour par nom (casse ignorée) ou création", async () => {
  await refusedForStaff({ action: "saveStock", product: "Cabillaud", quantity: 3 });
  await rejected({ action: "saveStock", product: "", quantity: 3 }, /Productnaam/);
  await rejected({ action: "saveStock", product: "Cabillaud", quantity: -1 }, /hoeveelheid/);
  await rejected({ action: "saveStock", product: "Cabillaud", quantity: "veel" }, /hoeveelheid/);
  const n = (await rows("Stock")).length;
  let r = await beheer({ action: "saveStock", product: "  cabillaud ", quantity: 2.3456, lowThreshold: 1 });
  assert.equal(r.statusCode, 200);
  const cab = (await rows("Stock")).filter(s => String(s.fields["Produit"]).toLowerCase().trim() === "cabillaud");
  assert.equal(cab.length, 1, "pas de doublon");
  assert.equal(cab[0].fields["Quantité disponible"], 2.346, "arrondi au gramme");
  assert.equal(cab[0].fields["Seuil bas"], 1);
  r = await beheer({ action: "saveStock", product: "Kreeft", quantity: 4 });
  assert.equal(r.statusCode, 200);
  assert.equal((await rows("Stock")).length, n + 1, "nouvelle ligne");
  assert.equal((await one("Stock", s => s.fields["Produit"] === "Kreeft")).fields["Quantité disponible"], 4);
});

// ---------------------------------------------------------------- POST /api/stock (correction d'inventaire)
test("POST /api/stock : session exigée, validation, quantité écrite et mouvement journalisé", async () => {
  const cab = await one("Stock", s => s.fields["Produit"] === "Cabillaud");
  const before = cab.fields["Quantité disponible"];
  const post = (body, headers) => api("stock", { method: "POST", headers: headers === undefined ? STAFF : headers, body });
  const snap = await snapshot();
  assert.equal((await post({ id: cab.id, quantity: 3, note: "telling" }, {})).statusCode, 401, "sans session");
  for (const [body, label] of [
    [{ id: cab.id, quantity: -1, note: "telling" }, "négatif"],
    [{ id: cab.id, quantity: 2000000, note: "telling" }, "trop grand"],
    [{ id: cab.id, quantity: "x", note: "telling" }, "illisible"],
    [{ id: "../Clients/x", quantity: 3, note: "telling" }, "id invalide"],
    [{ id: cab.id, quantity: 3 }, "sans motif"],
    [{ id: cab.id, quantity: 3, note: "telling", movementType: "Diefstal" }, "type inconnu"],
    [{ id: cab.id, quantity: 3, note: "telling", lowThreshold: -2 }, "seuil négatif"]
  ]) assert.equal((await post(body)).statusCode, 400, label);
  assert.equal((await post({ id: "recONBEKEND0000000", quantity: 3, note: "telling" })).statusCode, 404);
  assert.equal((await post({ id: cab.id, delete: true })).statusCode, 403, "supprimer une ligne : beheerder seul");
  assert.equal(await snapshot(), snap, "aucune écriture pendant les refus");

  let r = await post({ id: cab.id, quantity: 5.5, note: "levering Vismijn", movementType: "Entrée stock", lowThreshold: 2 });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.quantity, 5.5); assert.equal(r.body.journalWarning, null);
  const now = await one("Stock", s => s.id === cab.id);
  assert.equal(now.fields["Quantité disponible"], 5.5); assert.equal(now.fields["Seuil bas"], 2);
  const moves = await rows("Mouvements de stock");
  assert.equal(moves.length, 1, "un mouvement");
  const m = moves[0].fields;
  assert.equal(m.Type, "Entrée stock"); assert.equal(m.Produit, "Cabillaud"); assert.equal(m["Stock avant"], before); assert.equal(m["Stock après"], 5.5);
  assert.equal(m["Quantité"], Math.round((5.5 - before) * 1000) / 1000); assert.equal(m.Note, "levering Vismijn");

  r = await post({ id: cab.id, quantity: 5.5, note: "hertelling" });
  assert.equal(r.statusCode, 200);
  assert.equal((await rows("Mouvements de stock")).length, 1, "quantité inchangée : aucun mouvement");
});
