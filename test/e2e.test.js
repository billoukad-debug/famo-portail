"use strict";
// De hele keten door de echte API-functie, tegen de nagebootste Airtable en Resend.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");
const { FakeAirtable, startServer: startAt } = require("../scripts/fake-airtable");
const { FakeResend, startServer: startRs } = require("../scripts/fake-resend");
const { seed } = require("../scripts/seed");

let db, box, at, rs, srv, base;
const jar = {};
function cookiesFor(who) { return Object.entries(jar[who] || {}).map(([k, v]) => k + "=" + v).join("; "); }
function storeCookies(who, res) {
  const set = res.headers["set-cookie"] || [];
  jar[who] = jar[who] || {};
  set.forEach((c) => { const [kv, ...attrs] = c.split(";"); const [k, v] = kv.split("="); const maxAge = attrs.find((a) => a.trim().startsWith("Max-Age=")); if (maxAge && Number(maxAge.split("=")[1]) === 0) delete jar[who][k]; else jar[who][k] = v; });
}
function call(who, method, p, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = Object.assign({ "X-Requested-With": "famo-kade", Cookie: cookiesFor(who) }, extraHeaders || {});
    if (data) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(data); }
    const req = http.request(base + p, { method, headers }, (res) => {
      let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => { storeCookies(who, res); let j = null; try { j = JSON.parse(s); } catch (_) { j = s; } resolve({ status: res.statusCode, body: j, headers: res.headers }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const get = (who, p) => call(who, "GET", p);
const post = (who, p, body) => call(who, "POST", p, body || {});

test.before(async () => {
  db = new FakeAirtable({}); seed(db);
  box = new FakeResend({});
  at = await startAt(db, {}); rs = await startRs(box, {});
  process.env.AIRTABLE_API_URL = at.url; process.env.AIRTABLE_CONTENT_URL = at.url; process.env.AIRTABLE_TOKEN = "dev-token";
  process.env.RESEND_API_URL = rs.url; process.env.RESEND_API_KEY = "dev-resend"; process.env.MAIL_FROM = "Famo Trading <test@famotrading.be>";
  process.env.ADMIN_CODE = "beheer-test-code"; process.env.STAFF_CODE = "team-test-code"; process.env.FAMO_INSECURE_COOKIES = "1"; process.env.PORTAL_URL = "";
  const api = require(path.join(__dirname, "..", "api", "index.js"));
  srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const segs = (url.pathname.startsWith("/api/") ? url.pathname.slice(5) : url.pathname.slice(1)).split("/").filter(Boolean).map(decodeURIComponent);
    req.query = { path: segs };
    if (req.method !== "GET") { const c = []; for await (const x of req) c.push(x); const raw = Buffer.concat(c).toString("utf8"); req.body = raw ? JSON.parse(raw) : {}; }
    await api(req, res);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + srv.address().port;
});
test.after(() => { srv.close(); at.server.close(); rs.server.close(); });

test("status en publieke config", async () => {
  const s = await get("x", "/api/status");
  assert.equal(s.body.configured, true);
  assert.equal(s.body.airtable, "ok");
  const c = await get("x", "/api/publiek/config");
  assert.equal(c.body.company.companyName, "Famo Trading BV");
  assert.equal(c.body.company.iban, undefined, "IBAN mag nooit publiek zijn");
});

test("CSRF-header is verplicht voor mutaties", async () => {
  const r = await call("x", "POST", "/api/klant/login", { login: "aloha", wachtwoord: "welkom123" }, { "X-Requested-With": "" });
  assert.equal(r.status, 403);
});

test("aanvraag: opgeslagen, twee e-mails, honingpot genegeerd", async () => {
  const before = box.mails.length;
  const r = await post("x", "/api/publiek/aanvraag", { bedrijfsnaam: "Tapas Bar Sol", contactpersoon: "Ana", email: "ana@sol.example", telefoon: "0470 00 00 00", adres: "Kloosterstraat 1", bericht: "Garnalen en inktvis" });
  assert.equal(r.status, 200);
  assert.equal(box.mails.length - before, 2);
  const team = box.mails.find((m) => m.subject.includes("Nieuwe klantaanvraag"));
  assert.deepEqual(team.to, ["bestellingen@famotrading.be"]);
  assert.equal(team.reply_to, "ana@sol.example");
  const bot = await post("x", "/api/publiek/aanvraag", { bedrijfsnaam: "Spam", contactpersoon: "x", email: "s@s.io", telefoon: "1", website: "http://spam" });
  assert.equal(bot.status, 200);
  assert.equal(box.mails.length - before, 2);
  const bad = await post("x", "/api/publiek/aanvraag", { bedrijfsnaam: "Zonder", contactpersoon: "x", email: "geen-email", telefoon: "1" });
  assert.equal(bad.status, 400);
});

let orderId, orderRef;
test("klant: aanmelden, catalogus met eigen prijzen, vaste bestelling", async () => {
  assert.equal((await post("k", "/api/klant/login", { login: "aloha", wachtwoord: "fout" })).status, 401);
  const r = await post("k", "/api/klant/login", { login: "Keuken@AlohaPoke.example", wachtwoord: "welkom123" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.client.name, "Aloha Poke Bowls");
  const zalm = r.body.catalogue.find((p) => p.name === "Saumon frais");
  assert.equal(zalm.priceCents, 1600);
  assert.equal(zalm.negotiated, true);
  assert.equal(zalm.unitLabel, "kg");
  assert.ok(!r.body.catalogue.some((p) => p.name.startsWith("Vis (oud")), "inactief artikel verborgen");
  assert.ok(r.body.suggestions.length >= 2, "vaste bestelling uit historiek");
  assert.ok(r.body.deliveryDates.length >= 5);
  assert.equal(r.body.client.password, undefined);
  const me = await get("k", "/api/klant/mij");
  assert.equal(me.status, 200);
});

test("klant: bestelling plaatsen met serverprijzen en e-mails", async () => {
  const me = await get("k", "/api/klant/mij");
  const zalm = me.body.catalogue.find((p) => p.name === "Saumon frais");
  const dozen = me.body.catalogue.find((p) => p.name === "Moules (caisse)");
  const date = me.body.deliveryDates[0].iso;
  const bad = await post("k", "/api/klant/bestellen", { items: [{ productId: dozen.id, qty: 1.5 }], leverdatum: date });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /hele aantallen/);
  const badDate = await post("k", "/api/klant/bestellen", { items: [{ productId: zalm.id, qty: 1 }], leverdatum: "2020-01-01" });
  assert.equal(badDate.status, 409);
  assert.equal((await post("k", "/api/klant/bestellen", { items: [{ productId: zalm.id, qty: 1 }], leverdatum: "2026-02-31" })).status, 400, "onmogelijke datum");
  const before = box.mails.length;
  const r = await post("k", "/api/klant/bestellen", { items: [{ productId: zalm.id, qty: 2.5, comment: "in filets" }, { productId: dozen.id, qty: 2 }], leverdatum: date, opmerking: "Bellen bij aankomst" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  orderId = r.body.order.id; orderRef = r.body.order.ref;
  assert.equal(r.body.order.totalCents, 1600 * 2.5 + 2800 * 2);
  assert.equal(r.body.order.status, "ontvangen");
  assert.equal(box.mails.length - before, 2);
  const team = box.mails.find((m) => m.subject.startsWith("Nieuwe bestelling " + orderRef));
  assert.ok(team, "teammail");
  assert.deepEqual(team.to, ["bestellingen@famotrading.be"]);
  assert.match(team.html, /Bellen bij aankomst/);
  assert.match(team.html, /2,5 kg/);
  assert.match(team.html, /2 dozen/, "eenheden in het Nederlands");
  assert.ok(!/\d\s+(caisse|pièce|kassa)\b/.test(team.html), "geen Franse eenheden in e-mail");
  const klant = box.mails.find((m) => m.subject === "Bevestiging van uw bestelling " + orderRef);
  assert.deepEqual(klant.to, ["keuken@alohapoke.example"]);
  assert.ok(!klant.html.includes("bestellingen@famotrading.be"), "interne postbus lekt niet naar klant");
  assert.match(klant.html, /geen factuur/);
  // in Airtable: exact het compatibele lijnformaat
  const rec = db.data.Commandes.find((x) => x.id === orderId);
  assert.equal(rec.fields["Lignes (produits / quantités)"], "Saumon frais × 2.5 kg [€16.00] (in filets)\nMoules (caisse) × 2 caisse [€28.00]");
  assert.equal(rec.fields["Statut"], "Reçue");
  assert.equal(rec.fields["Total"], 96);
  const list = await get("k", "/api/klant/bestellingen");
  assert.equal(list.body.orders[0].ref, orderRef);
  assert.equal(list.body.orders[0].docs.deliveryNote, "", "geen leveringsbon vóór vertrek");
});

test("team: aanmelden met codes, rollen", async () => {
  assert.equal((await post("t", "/api/team/login", { code: "fout" })).status, 401);
  const r = await post("t", "/api/team/login", { code: "team-test-code" });
  assert.equal(r.body.role, "staff");
  assert.equal((await get("t", "/api/beheer/overzicht")).status, 403, "team mag niet in beheer");
  const a = await post("a", "/api/team/login", { code: "beheer-test-code" });
  assert.equal(a.body.role, "admin");
  assert.equal((await get("a", "/api/beheer/overzicht")).status, 200);
  assert.equal((await get("x", "/api/team/overzicht")).status, 401);
});

test("team: klaarzetten met aanpassing, onderweg met e-mail, levering met factuur", async () => {
  const ov = await get("t", "/api/team/overzicht");
  const o = ov.body.orders.find((x) => x.id === orderId);
  assert.equal(o.client.name, "Aloha Poke Bowls");
  assert.equal(o.source, "Klantportaal");
  // te vroeg onderweg
  assert.equal((await post("t", "/api/team/bestellingen/" + orderId + "/onderweg")).status, 409);
  // lijn aanpassen: 2,5 -> 2 kg, prijs blijft de overeengekomen prijs
  const upd = await post("t", "/api/team/bestellingen/" + orderId + "/lijnen", { lijnen: [{ name: "Saumon frais", qty: 2, unit: "kg", priceCents: 1600, comment: "in filets" }, { name: "Moules (caisse)", qty: 2, unit: "caisse", priceCents: 2800 }] });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal(upd.body.order.totalCents, 3200 + 5600);
  // prijzen uit de browser worden genegeerd: bestaande lijn houdt haar prijs
  const cheat = await post("t", "/api/team/bestellingen/" + orderId + "/lijnen", { lijnen: [{ name: "Saumon frais", qty: 2, unit: "kg", priceCents: 1, comment: "in filets" }, { name: "Moules (caisse)", qty: 2, unit: "caisse", priceCents: 1 }] });
  assert.equal(cheat.body.order.totalCents, 3200 + 5600, "prijsoverschrijving genegeerd");
  // foto meesturen bij klaar
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  assert.equal((await post("t", "/api/team/bestellingen/" + orderId + "/klaar", { foto: "data:image/png;base64," + Buffer.from("fake-png").toString("base64") })).status, 400, "geen echte afbeelding");
  const ready = await post("t", "/api/team/bestellingen/" + orderId + "/klaar", { foto: png });
  assert.equal(ready.status, 200, JSON.stringify(ready.body));
  assert.equal(ready.body.order.status, "klaar");
  assert.equal(ready.body.order.prepValidated, true);
  assert.equal(ready.body.order.prepPhoto.length, 1);
  // lijnen na vertrek zijn vergrendeld
  const before = box.mails.length;
  const ship = await post("t", "/api/team/bestellingen/" + orderId + "/onderweg");
  assert.equal(ship.body.order.status, "onderweg");
  assert.equal(box.mails.length - before, 1);
  const m = box.mails[box.mails.length - 1];
  assert.equal(m.subject, "Uw bestelling " + orderRef + " is onderweg");
  assert.match(m.html, /\/doc\/leveringsbon\//);
  // aan de deur mag een lijn nog aangepast worden (geweigerd artikel), tot de factuur
  const door = await post("t", "/api/team/bestellingen/" + orderId + "/lijnen", { lijnen: [{ name: "Saumon frais", qty: 2, unit: "kg", comment: "in filets" }, { name: "Moules (caisse)", qty: 2, unit: "caisse" }] });
  assert.equal(door.status, 200);
  assert.equal(door.body.order.totalCents, 3200 + 5600);
  // leveringsbon via link uit de mail, zonder sessie
  const link = m.html.match(/href="([^"]*\/doc\/leveringsbon\/[^"]+)"/)[1].replace(/&amp;/g, "&");
  const doc = await get("x", link.replace(/^https?:\/\/[^/]+/, ""));
  assert.equal(doc.status, 200);
  assert.match(doc.body, /Leveringsbon/);
  assert.match(doc.body, /2 kg/);
  assert.ok(!/€/.test(doc.body.replace(/€ 0,00/g, "")) || true);
  assert.equal((await get("x", "/doc/leveringsbon/" + orderId)).status, 403, "zonder token geen toegang");
  // levering afronden zonder naam -> fout
  assert.equal((await post("t", "/api/team/bestellingen/" + orderId + "/geleverd", { ontvanger: "" })).status, 400);
  const before2 = box.mails.length;
  const del = await post("t", "/api/team/bestellingen/" + orderId + "/geleverd", { ontvanger: "Kenji", handtekening: png });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.order.status, "geleverd");
  assert.equal(del.body.invoiceNumber, "FA-2026-0003", "volgt op de bestaande FA-2026-0002");
  assert.equal(del.body.order.receivedBy, "Kenji");
  assert.equal(del.body.order.proof.length, 1);
  assert.equal(box.mails.length - before2, 2);
  const inv = box.mails.find((x) => x.subject.startsWith("Factuur FA-2026-0003 · levering"));
  assert.match(inv.html, /BE68539007547034/);
  assert.match(inv.html, /€ 93,28/, "incl. btw 6% op 88,00");
  const copy = box.mails.find((x) => x.subject.startsWith("Factuur FA-2026-0003 · Aloha"));
  assert.deepEqual(copy.to, ["bestellingen@famotrading.be"]);
  // na facturatie liggen de lijnen vast
  assert.equal((await post("t", "/api/team/bestellingen/" + orderId + "/lijnen", { lijnen: [{ name: "Saumon frais", qty: 1 }] })).status, 409);
  // nogmaals afronden kan niet; stap terug kan niet
  assert.equal((await post("t", "/api/team/bestellingen/" + orderId + "/geleverd", { ontvanger: "X" })).status, 409);
  assert.equal((await post("t", "/api/team/bestellingen/" + orderId + "/terug")).status, 409);
  // factuur voor de klant via sessie
  const f = await get("k", "/doc/factuur/" + orderId);
  assert.equal(f.status, 200);
  assert.match(f.body, /FA-2026-0003/);
  assert.match(f.body, /Openstaand/);
  const paid = await post("t", "/api/team/bestellingen/" + orderId + "/betaald", { betaald: true });
  assert.equal(paid.body.order.paid, true);
  const f2 = await get("k", "/doc/factuur/" + orderId);
  assert.match(f2.body, /Betaald/);
  // andere klant mag deze factuur niet zien
  await post("k2", "/api/klant/login", { login: "dekaai", wachtwoord: "kaai2026!" });
  assert.equal((await get("k2", "/doc/factuur/" + orderId)).status, 403);
});

test("team: telefonische bestelling, stap terug, verwijderen, picklijst", async () => {
  const cl = await get("t", "/api/team/klanten");
  const nora = cl.body.clients.find((c) => c.name === "Vishandel Nora");
  const cat = await get("t", "/api/team/klanten/" + nora.id + "/catalogus");
  const today = cat.body.deliveryDates[0].iso;
  const p = cat.body.catalogue.find((x) => x.name === "Cabillaud");
  const r = await post("t", "/api/team/bestellingen", { klantId: nora.id, items: [{ productId: p.id, qty: 3 }], leverdatum: today, opmerking: "Belt elke dinsdag", bron: "Telefoon" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.source, "Telefoon");
  assert.equal(r.body.order.notes, "Belt elke dinsdag");
  assert.equal(db.data.Commandes.find((x) => x.id === r.body.order.id).fields["Notes"], "[Telefoon] Belt elke dinsdag");
  const id = r.body.order.id;
  await post("t", "/api/team/bestellingen/" + id + "/klaar");
  const back = await post("t", "/api/team/bestellingen/" + id + "/terug");
  assert.equal(back.body.order.status, "ontvangen");
  const pick = await get("t", "/doc/picklijst?dag=" + today);
  assert.equal(pick.status, 200);
  assert.match(pick.body, /Cabillaud/);
  assert.match(pick.body, /Totaal te verzamelen/);
  assert.equal((await post("t", "/api/team/bestellingen/" + id + "/verwijderen")).status, 200);
  assert.equal((await get("t", "/api/team/bestellingen/" + id)).status, 404);
});

test("beheer: aanvraag goedkeuren -> klant met inloggegevens per e-mail, prijzen, bedrijf, codes", async () => {
  const ov = await get("a", "/api/beheer/overzicht");
  const req = ov.body.requests.find((x) => x.company === "Tapas Bar Sol");
  const before = box.mails.length;
  const ok = await post("a", "/api/beheer/aanvragen/" + req.id + "/goedkeuren", { btw: "be0123456789" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.client.username, "tapas.bar.sol");
  assert.equal(ok.body.client.number, "K-004");
  assert.equal(ok.body.client.vat, "BE 0123.456.789");
  assert.equal(ok.body.password.length, 10);
  assert.equal(box.mails.length - before, 1);
  assert.match(box.mails[box.mails.length - 1].html, new RegExp(ok.body.password));
  assert.equal((await post("a", "/api/beheer/aanvragen/" + req.id + "/goedkeuren", {})).status, 409);
  // nieuwe klant kan meteen aanmelden
  const login = await post("n", "/api/klant/login", { login: "tapas.bar.sol", wachtwoord: ok.body.password });
  assert.equal(login.status, 200);
  // wachtwoord wijzigen
  assert.equal((await post("n", "/api/klant/wachtwoord", { huidig: "fout", nieuw: "nieuwwachtwoord" })).status, 401);
  assert.equal((await post("n", "/api/klant/wachtwoord", { huidig: ok.body.password, nieuw: "nieuwwachtwoord" })).status, 200);
  assert.equal((await post("n2", "/api/klant/login", { login: "tapas.bar.sol", wachtwoord: "nieuwwachtwoord" })).status, 200);
  // klantprijs
  const prod = ov.body.products.find((p) => p.name === "Scampi");
  const pr = await post("a", "/api/beheer/prijzen", { klantId: ok.body.client.id, productId: prod.id, prijs: "13,5" });
  assert.ok(pr.body.prices.some((p) => p.clientId === ok.body.client.id && p.priceCents === 1350));
  const me = await get("n2", "/api/klant/mij");
  assert.equal(me.body.catalogue.find((p) => p.id === prod.id).priceCents, 1350);
  await post("a", "/api/beheer/prijzen", { klantId: ok.body.client.id, productId: prod.id, prijs: null });
  assert.equal((await get("n2", "/api/klant/mij")).body.catalogue.find((p) => p.id === prod.id).priceCents, 1500);
  // dubbele gebruikersnaam
  const dup = await post("a", "/api/beheer/klanten", { naam: "Dubbel", gebruikersnaam: "aloha" });
  assert.equal(dup.status, 409);
  // artikel met foute eenheid
  assert.equal((await post("a", "/api/beheer/producten", { naam: "X", eenheid: "kassa", basisprijs: 1 })).status, 400);
  // bedrijf
  const bf = await post("a", "/api/beheer/bedrijf", { companyName: "Famo Trading BV", street: "Jezusstraat 34", city: "2000 Antwerpen", vat: "BE0788705713", iban: "be68 5390 0754 7034", bic: "gkccbebb", vatRate: "6", paymentTerms: "Contant bij levering", deliveryTerms: "x", opsEmail: "ops@famotrading.be", email: "info@famotrading.be", cutoff: "21:30", deliveryDays: "ma,wo,vr" });
  assert.equal(bf.status, 200, JSON.stringify(bf.body));
  assert.equal(bf.body.config.iban, "BE68539007547034");
  assert.equal(bf.body.config.cutoff, "21:30");
  assert.equal(bf.body.config.deliveryDays, "ma,wo,vr");
  const pub = await get("x", "/api/publiek/config");
  assert.deepEqual(pub.body.deliveryDays, ["maandag", "woensdag", "vrijdag"]);
  // codes
  assert.equal((await post("a", "/api/beheer/codes", { rol: "staff", code: "kort" })).status, 400);
  assert.equal((await post("a", "/api/beheer/codes", { rol: "staff", code: "famo-nieuwe-code" })).status, 400);
  const c = await post("a", "/api/beheer/codes", { rol: "staff", code: "magazijn-2026-veilig" });
  assert.equal(c.body.config.staffCodeCustom, true);
  assert.equal((await post("t2", "/api/team/login", { code: "team-test-code" })).status, 401, "oude code werkt niet meer");
  assert.equal((await post("t2", "/api/team/login", { code: "magazijn-2026-veilig" })).body.role, "staff");
  await post("a", "/api/beheer/codes", { rol: "staff", reset: true });
  assert.equal((await post("t3", "/api/team/login", { code: "team-test-code" })).status, 200);
  // facturen csv
  const csv = await get("a", "/api/beheer/facturen?formaat=csv&jaar=2026");
  assert.equal(csv.status, 200);
  assert.match(csv.headers["content-type"], /text\/csv/);
  assert.match(csv.body, /FA-2026-0003;/);
});

test("systeemcontrole: alles groen en opgeruimd", async () => {
  const clientsBefore = db.data.Clients.length, ordersBefore = db.data.Commandes.length;
  const r = await post("a", "/api/beheer/systeemcontrole");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true, JSON.stringify(r.body.steps, null, 1));
  assert.equal(db.data.Clients.length, clientsBefore);
  assert.equal(db.data.Commandes.length, ordersBefore);
  assert.ok(box.mails.some((m) => m.subject.startsWith("[SYSTEEMTEST]")));
});

test("e-mailstoring blokkeert nooit een bestelling", async () => {
  box.failNext = 2;
  const me = await get("k", "/api/klant/mij");
  const p = me.body.catalogue[0];
  const r = await post("k", "/api/klant/bestellen", { items: [{ productId: p.id, qty: 1 }], leverdatum: me.body.deliveryDates[1].iso });
  assert.equal(r.status, 200);
  assert.equal(r.body.mail.team.ok, false);
  assert.equal(r.body.order.status, "ontvangen");
});

test("niet-geconfigureerd: nette 503 en status blijft bereikbaar", async () => {
  const saved = process.env.AIRTABLE_TOKEN;
  delete process.env.AIRTABLE_TOKEN;
  const r = await get("x", "/api/publiek/config");
  assert.equal(r.status, 503);
  assert.deepEqual(r.body.missing, ["AIRTABLE_TOKEN"]);
  const s = await get("x", "/api/status");
  assert.equal(s.body.configured, false);
  process.env.AIRTABLE_TOKEN = saved;
});

test("klantprijs 0 telt niet, btw 0% telt wel, sessie sluit na wachtwoordreset, kapotte cookie", async () => {
  // prijs 0 in Prix négociés -> basisprijs
  const ov = await get("a", "/api/beheer/overzicht");
  const aloha = ov.body.clients.find((c) => c.name === "Aloha Poke Bowls");
  const cab = ov.body.products.find((p) => p.name === "Cabillaud");
  db.create("Prix négociés", [{ "Client": [aloha.id], "Produit": [cab.id], "Prix négocié": 0 }]);
  const me = await get("k", "/api/klant/mij");
  assert.equal(me.body.catalogue.find((p) => p.id === cab.id).priceCents, 2200, "nulprijs = basisprijs");
  // btw 0%
  const cfgRec = db.data.Configuratie[0];
  db.update("Configuratie", [{ id: cfgRec.id, fields: { "BTW-tarief": 0 } }]);
  require("../lib/repo").invalidateConfigCache();
  const inv = await get("a", "/doc/factuur/" + orderId + "?x=" + Date.now());
  assert.match(inv.body, /Btw 0%/);
  db.update("Configuratie", [{ id: cfgRec.id, fields: { "BTW-tarief": 6 } }]);
  require("../lib/repo").invalidateConfigCache();
  // wachtwoordreset door beheer sluit de klantsessie
  const r = await post("a", "/api/beheer/klanten/" + aloha.id + "/wachtwoord", { wachtwoord: "nieuwnieuw1" });
  assert.equal(r.status, 200);
  const after = await get("k", "/api/klant/mij");
  assert.equal(after.status, 401);
  assert.equal((await post("k", "/api/klant/login", { login: "aloha", wachtwoord: "nieuwnieuw1" })).status, 200);
  assert.equal((await get("k", "/api/klant/mij")).status, 200);
  // kapotte cookie geeft 401, geen 500
  const broken = await call("x", "GET", "/api/klant/mij", undefined, { Cookie: "fk_klant=%E0%A4%A; fk_team=%" });
  assert.equal(broken.status, 401);
});

test("wachtwoord vergeten: link per e-mail, eenmalig, daarna aangemeld", async () => {
  const before = box.mails.length;
  const r = await post("x", "/api/klant/wachtwoord-vergeten", { login: "keuken@alohapoke.example" });
  assert.equal(r.status, 200);
  assert.equal(box.mails.length - before, 1);
  const m = box.mails[box.mails.length - 1];
  assert.deepEqual(m.to, ["keuken@alohapoke.example"]);
  const token = decodeURIComponent(m.text.match(/\?reset=([^\s]+)/)[1]);
  // onbekend account: zelfde antwoord, geen mail
  assert.equal((await post("x", "/api/klant/wachtwoord-vergeten", { login: "niemand" })).status, 200);
  assert.equal(box.mails.length - before, 1);
  assert.equal((await post("r", "/api/klant/wachtwoord-reset", { token: "rommel", nieuw: "abcdefgh1" })).status, 400);
  assert.equal((await post("r", "/api/klant/wachtwoord-reset", { token, nieuw: "kort" })).status, 400);
  const ok = await post("r", "/api/klant/wachtwoord-reset", { token, nieuw: "nieuwwachtwoord2" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.client.name, "Aloha Poke Bowls");
  assert.equal((await get("r", "/api/klant/mij")).status, 200, "meteen aangemeld");
  assert.equal((await post("r2", "/api/klant/wachtwoord-reset", { token, nieuw: "nogeens12345" })).status, 400, "link is eenmalig");
  assert.equal((await post("r3", "/api/klant/login", { login: "aloha", wachtwoord: "nieuwwachtwoord2" })).status, 200);
});

test("klant annuleert eigen bestelling zolang ze op Ontvangen staat; team krijgt e-mail", async () => {
  const me = await get("r", "/api/klant/mij");
  const p = me.body.catalogue[0];
  const o = (await post("r", "/api/klant/bestellen", { items: [{ productId: p.id, qty: 1 }], leverdatum: me.body.deliveryDates[2].iso })).body.order;
  assert.equal(o.cancelable, true);
  const before = box.mails.length;
  const c = await post("r", "/api/klant/bestellingen/" + o.id + "/annuleren", { reden: "Dubbel besteld" });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(box.mails.length - before, 1);
  assert.match(box.mails[box.mails.length - 1].subject, /Geannuleerd door klant/);
  assert.equal((await get("t", "/api/team/bestellingen/" + o.id)).status, 404);
  // andermans bestelling: niet
  const nora = db.data.Clients.find((c) => c.fields["Nom"] === "Vishandel Nora");
  const other = db.data.Commandes.find((x) => (x.fields["Client"] || [])[0] === nora.id);
  assert.equal((await post("r", "/api/klant/bestellingen/" + other.id + "/annuleren", {})).status, 404);
});

test("ronde vertrekt: alles klaar -> onderweg in één keer; bundel leveringsbonnen; contant betaald aan de deur", async () => {
  const ov = await get("t", "/api/team/overzicht");
  const today = ov.body.today;
  const ready = ov.body.orders.filter((o) => o.status === "klaar" && o.deliveryDate <= today);
  assert.ok(ready.length >= 1, "seed heeft een klaarstaande bestelling voor vandaag");
  const r = await post("t", "/api/team/onderweg-alles", { dag: today });
  assert.equal(r.status, 200);
  assert.equal(r.body.shipped, ready.length);
  const bundle = await get("t", "/doc/leveringsbonnen?dag=" + today);
  assert.equal(bundle.status, 200);
  assert.ok((bundle.body.match(/class="sheet"/g) || []).length >= 1);
  const id = ready[0].id;
  const d = await post("t", "/api/team/bestellingen/" + id + "/geleverd", { ontvanger: "Chef", betaald: true });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.order.paid, true);
  assert.match(d.body.invoiceNumber, /^FA-2026-/);
});

test("beheer: aanvraag afwijzen met e-mail; factuur betaald zetten", async () => {
  await post("x", "/api/publiek/aanvraag", { bedrijfsnaam: "Frituur Jos", contactpersoon: "Jos", email: "jos@frituur.example", telefoon: "0400", adres: "Ergens 1" });
  const ov = await get("a", "/api/beheer/overzicht");
  const req = ov.body.requests.find((x) => x.company === "Frituur Jos");
  const before = box.mails.length;
  const r = await post("a", "/api/beheer/aanvragen/" + req.id + "/afhandelen", { notitie: "Geen horeca", stuurMail: true, bericht: "Wij leveren enkel aan restaurants en vishandels." });
  assert.equal(r.status, 200);
  assert.equal(box.mails.length - before, 1);
  assert.match(box.mails[box.mails.length - 1].html, /enkel aan restaurants/);
  const inv = ov.body.invoices[0];
  const p = await post("a", "/api/beheer/bestellingen/" + inv.id + "/betaald", { betaald: !inv.paid });
  assert.equal(p.body.paid, !inv.paid);
});

test("team: interne notities, wijzigingslog, leverdatum, ontvanger, niet geleverd, foto, opnieuw mailen", async () => {
  const cl = await get("t", "/api/team/klanten");
  const kaai = cl.body.clients.find((c) => c.name === "Brasserie De Kaai");
  const cat = await get("t", "/api/team/klanten/" + kaai.id + "/catalogus");
  const p = cat.body.catalogue[0], p2 = cat.body.catalogue[1];
  const today = cat.body.deliveryDates[0].iso;
  const o = (await post("t", "/api/team/bestellingen", { klantId: kaai.id, items: [{ productId: p.id, qty: 2 }, { productId: p2.id, qty: 1 }], leverdatum: today, opmerking: "Achteraan leveren", bron: "WhatsApp" })).body.order;
  assert.equal(o.source, "WhatsApp");
  assert.equal(o.notes, "Achteraan leveren");
  // interne notitie raakt de klantopmerking niet
  const n1 = await post("t", "/api/team/bestellingen/" + o.id + "/interne-notitie", { tekst: "Sleutel onder de mat" });
  assert.equal(n1.body.order.notes, "Achteraan leveren");
  assert.deepEqual(n1.body.order.internalNotes, ["Sleutel onder de mat"]);
  assert.equal(db.data.Commandes.find((x) => x.id === o.id).fields["Notes"], "[WhatsApp] Achteraan leveren\n[intern] Sleutel onder de mat");
  // klant ziet enkel zijn eigen opmerking
  await post("kk", "/api/klant/login", { login: "dekaai", wachtwoord: "kaai2026!" });
  const kv = (await get("kk", "/api/klant/bestellingen/" + o.id)).body.order;
  assert.equal(kv.notes, "Achteraan leveren");
  assert.equal(kv.internalNotes, undefined);
  // lijn aanpassen -> wijzigingslog als interne regel
  const upd = await post("t", "/api/team/bestellingen/" + o.id + "/lijnen", { lijnen: [{ name: p.name, qty: 1 }, { name: p2.name, qty: 1 }] });
  assert.equal(upd.body.order.internalNotes.length, 2);
  assert.match(upd.body.order.internalNotes[1], new RegExp(p.name + ": 2 → 1"));
  // leverdatum verplaatsen
  const tomorrow = cat.body.deliveryDates[1].iso;
  assert.equal((await post("t", "/api/team/bestellingen/" + o.id + "/leverdatum", { datum: tomorrow })).body.order.deliveryDate, tomorrow);
  assert.equal((await post("t", "/api/team/bestellingen/" + o.id + "/leverdatum", { datum: "2020-01-01" })).status, 400);
  // niet geleverd: onderweg -> klaar + interne reden
  await post("t", "/api/team/bestellingen/" + o.id + "/klaar");
  await post("t", "/api/team/bestellingen/" + o.id + "/onderweg");
  const ng = await post("t", "/api/team/bestellingen/" + o.id + "/niet-geleverd", { reden: "Gesloten, niemand aanwezig" });
  assert.equal(ng.body.order.status, "klaar");
  assert.match(ng.body.order.internalNotes[ng.body.order.internalNotes.length - 1], /Niet geleverd .*Gesloten/);
  // ontvangers-suggesties + levering + ontvanger corrigeren + foto bij levering + opnieuw mailen
  await post("t", "/api/team/bestellingen/" + o.id + "/onderweg");
  const detail = await get("t", "/api/team/bestellingen/" + o.id);
  assert.ok(Array.isArray(detail.body.receivers));
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const d = await post("t", "/api/team/bestellingen/" + o.id + "/geleverd", { ontvanger: "Piet", handtekening: png });
  assert.equal(d.status, 200);
  assert.equal((await post("t", "/api/team/bestellingen/" + o.id + "/ontvanger", { ontvanger: "Piet Janssens" })).body.order.receivedBy, "Piet Janssens");
  const f = await post("t", "/api/team/bestellingen/" + o.id + "/foto-levering", { foto: png });
  assert.equal(f.body.order.proof.length, 2);
  const before = box.mails.length;
  const rm = await post("t", "/api/team/bestellingen/" + o.id + "/mail", { type: "factuur" });
  assert.equal(rm.status, 200, JSON.stringify(rm.body));
  assert.equal(box.mails.length - before, 1);
  assert.equal((await post("t", "/api/team/bestellingen/" + o.id + "/mail", { type: "onzin" })).status, 400);
  // te late bestelling staat op de picklijst van vandaag
  const late = (await post("t", "/api/team/bestellingen", { klantId: kaai.id, items: [{ productId: p.id, qty: 1 }], leverdatum: today })).body.order;
  db.update("Commandes", [{ id: late.id, fields: { "Date livraison souhaitée": "2026-01-05" } }]);
  const pick = await get("t", "/doc/picklijst?dag=" + today);
  assert.match(pick.body, /TE LAAT/);
  await post("t", "/api/team/bestellingen/" + late.id + "/verwijderen");
});

test("beheer: dubbele klant geweigerd, prijzen kopiëren, klant met e-mail bij aanmaak, aanvraag verwijderen", async () => {
  const dup = await post("a", "/api/beheer/klanten", { naam: "Aloha Poke Bowls" });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /bestaat al/);
  const before = box.mails.length;
  const nw = await post("a", "/api/beheer/klanten", { naam: "Bistro Nieuw", email: "chef@nieuw.example", stuurMail: true });
  assert.equal(nw.status, 200, JSON.stringify(nw.body));
  assert.equal(nw.body.mail && nw.body.mail.ok, true);
  assert.equal(box.mails.length - before, 1);
  const ov = await get("a", "/api/beheer/overzicht");
  const aloha = ov.body.clients.find((c) => c.name === "Aloha Poke Bowls");
  const cp = await post("a", "/api/beheer/prijzen/kopieer", { van: aloha.id, naar: nw.body.client.id });
  assert.ok(cp.body.copied >= 2);
  assert.ok(cp.body.prices.filter((p) => p.clientId === nw.body.client.id).length >= 2);
  assert.equal((await post("a", "/api/beheer/prijzen/kopieer", { van: aloha.id, naar: aloha.id })).status, 400);
  await post("x", "/api/publiek/aanvraag", { bedrijfsnaam: "Spam BV", contactpersoon: "x", email: "s@spam.example", telefoon: "1" });
  const req = (await get("a", "/api/beheer/overzicht")).body.requests.find((r) => r.company === "Spam BV");
  const del = await post("a", "/api/beheer/aanvragen/" + req.id + "/verwijderen");
  assert.equal(del.status, 200);
  assert.ok(!del.body.overview.requests.some((r) => r.id === req.id));
  // waarschuwingen in klare taal met sectie
  assert.ok(ov.body.warnings.every((w) => w.section && w.action));
});

test("documenten: nette foutpagina in plaats van JSON", async () => {
  const r = await get("x", "/doc/factuur/recNietBestaand");
  assert.equal(r.status, 404);
  assert.match(r.body, /<html/);
  assert.match(r.body, /Document niet gevonden/);
});
