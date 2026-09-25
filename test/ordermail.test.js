// Tests des e-mails transactionnels (lib/ordermail.js).
// Sans RESEND_API_KEY, aucun fetch ne doit partir : global.fetch jette pour le prouver.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

delete process.env.RESEND_API_KEY;
const om = require(path.join(__dirname, "..", "lib", "ordermail.js"));

const XSS = "<script>alert(1)</script>";
const company = { bedrijfsnaam: "Famo Trading BV", telefoon: "03 111 11 11", email: "info@famotrading.be", iban: "BE68539007547034", bic: "GKCCBEBB" };
const klant = { nom: "Resto " + XSS, adresse: "Kaai 1, 2000 Antwerpen", tel: "0470 00 00 00", klantnr: "K-42", email: "chef@resto.test" };
const base = {
  ref: "CMD-2026-0007", klant, company, opsEmail: "ops@famo.test", portalUrl: "https://portaal.famo.test/",
  lignes: "Mosselen × 1 caisse [€28.00] (zonder ijs)\nZalm × 2 kg [€12.50]", total: 53, date: "2026-09-24", dateLivraison: "2026-09-25"
};

function checkCommon(m, to, replyTo) {
  assert.equal(m.to, to);
  assert.equal(m.replyTo, replyTo);
  assert.ok(m.text && m.text.length > 40, "version texte présente");
  assert.ok(!m.html.includes(XSS), "script échappé");
  assert.ok(m.html.includes("&lt;script&gt;"), "échappement visible");
  assert.ok(!/<style/i.test(m.html) && !/display\s*:\s*flex/.test(m.html), "compatible clients mail");
  assert.match(m.html, /^<!doctype html>/);
}

test("buildCancelTeamMail : équipe, motif, auteur, idempotence", () => {
  const m = om.buildCancelTeamMail({ ...base, door: "klant", reden: "Restaurant gesloten", orderUrl: "https://portaal.famo.test/bestellingen.html#CMD-2026-0007" });
  checkCommon(m, "ops@famo.test", "chef@resto.test");
  assert.equal(m.subject, "Bestelling CMD-2026-0007 geannuleerd — Resto " + XSS + " — Restaurant gesloten");
  assert.equal(m.idempotencyKey, "cancel:CMD-2026-0007");
  assert.match(m.html, /Restaurant gesloten/);
  assert.match(m.html, /de klant/);
  assert.match(m.html, /kassa/);
  assert.ok(m.html.includes(om.dateNl("2026-09-25")), "date de livraison affichée");
  assert.match(m.html, /bestellingen\.html#CMD-2026-0007/);
  assert.match(m.text, /Reden: Restaurant gesloten/);
  const p = om.buildCancelTeamMail({ ...base, door: "personeel" });
  assert.match(p.html, /het personeel/);
  assert.match(p.subject, /geen reden opgegeven$/);
});

test("buildStatusMail onderweg", () => {
  const m = om.buildStatusMail({ ...base, status: "onderweg" });
  checkCommon(m, "chef@resto.test", "info@famotrading.be");
  assert.equal(m.subject, "Uw bestelling CMD-2026-0007 is onderweg");
  assert.equal(m.idempotencyKey, "status:CMD-2026-0007:onderweg");
  assert.match(m.html, /Verwachte levering/);
  assert.match(m.text, /onderweg/);
  assert.ok(!m.html.includes("ops@famo.test"), "boîte ops jamais exposée");
  const vandaag = om.buildStatusMail({ ...base, status: "onderweg", dateLivraison: "" });
  assert.match(vandaag.text, /vandaag/);
});

test("buildStatusMail geleverd : facture + paiement + bouton", () => {
  const m = om.buildStatusMail({ ...base, status: "geleverd", factuurnummer: "F-2026-0101", ontvangenDoor: "Jan " + XSS, vervaldatum: "2026-10-25", mededeling: "+++123/4567/89012+++" });
  checkCommon(m, "chef@resto.test", "info@famotrading.be");
  assert.equal(m.subject, "Uw bestelling CMD-2026-0007 is geleverd — factuur F-2026-0101");
  assert.equal(m.idempotencyKey, "status:CMD-2026-0007:geleverd");
  for (const s of ["Factuurnummer", "F-2026-0101", "Ontvangen door", "Jan ", "Totaal excl. btw", "€ 53,00", "Vervaldatum", "BE68539007547034", "GKCCBEBB", "+++123/4567/89012+++", "Factuur bekijken", "https://portaal.famo.test/klant.html#/bestellingen"]) {
    assert.ok(m.html.includes(s), "html contient " + s);
  }
  assert.match(m.text, /IBAN: BE68539007547034/);
  assert.match(m.text, /klant\.html#\/bestellingen/);
  assert.ok(m.html.includes(om.dateNl("2026-10-25")), "vervaldatum affichée");
});

test("buildStatusMail geannuleerd (par le personnel)", () => {
  const m = om.buildStatusMail({ ...base, status: "geannuleerd", reden: "Product niet beschikbaar" });
  checkCommon(m, "chef@resto.test", "info@famotrading.be");
  assert.equal(m.subject, "Uw bestelling CMD-2026-0007 is geannuleerd");
  assert.equal(m.idempotencyKey, "status:CMD-2026-0007:geannuleerd");
  assert.match(m.html, /Product niet beschikbaar/);
  assert.match(m.text, /Reden: Product niet beschikbaar/);
  assert.throws(() => om.buildStatusMail({ ...base, status: "verzonden" }), /onbekende status/);
});

test("buildWelcomeMail : identifiants, lien, conseil", () => {
  const m = om.buildWelcomeMail({ ...base, credentials: { user: "resto42", password: "Zee-" + XSS }, at: "2026-09-25T08:00:00Z" });
  checkCommon(m, "chef@resto.test", "info@famotrading.be");
  assert.equal(m.subject, "Uw toegang tot het bestelportaal van Famo Trading BV");
  assert.equal(m.idempotencyKey, "welcome:resto42:2026-09-25T08:00:00Z");
  assert.match(m.html, /resto42/);
  assert.match(m.html, /Zee-&lt;script&gt;/);
  assert.match(m.html, /href="https:\/\/portaal\.famo\.test\/"/);
  assert.match(m.html, /Account/);
  assert.match(m.text, /Gebruikersnaam: resto42/);
  assert.match(m.text, /Wachtwoord: Zee-<script>/);
});

test("buildSignupTeamMail : faits + bouton beheer", () => {
  const m = om.buildSignupTeamMail({
    company, opsEmail: "ops@famo.test", portalUrl: "https://portaal.famo.test", at: "2026-09-25T08:00:00Z",
    aanvraag: { bedrijfsnaam: "Brasserie " + XSS, contact: "Els", tel: "0499 11 22 33", email: "els@brasserie.test", adresse: "Markt 5, 9000 Gent", notities: "Levering enkel 's ochtends" }
  });
  checkCommon(m, "ops@famo.test", "els@brasserie.test");
  assert.equal(m.subject, "Nieuwe aanvraag toegang — Brasserie " + XSS);
  assert.equal(m.idempotencyKey, "signup:els@brasserie.test:2026-09-25T08:00:00Z");
  for (const s of ["Els", "0499 11 22 33", "els@brasserie.test", "Markt 5, 9000 Gent", "Levering enkel &#039;s ochtends", "https://portaal.famo.test/beheer.html#/aanvragen"]) {
    assert.ok(m.html.includes(s), "html contient " + s);
  }
  assert.match(m.text, /beheer\.html#\/aanvragen/);
});

test("buildResetMail : nouveau mot de passe", () => {
  const m = om.buildResetMail({ ...base, credentials: { user: "resto42" }, password: "Nieuw-" + XSS, at: "2026-09-25T09:00:00Z" });
  checkCommon(m, "chef@resto.test", "info@famotrading.be");
  assert.equal(m.subject, "Uw nieuw wachtwoord voor het bestelportaal");
  assert.equal(m.idempotencyKey, "reset:resto42:2026-09-25T09:00:00Z");
  assert.match(m.html, /resto42/);
  assert.match(m.html, /Nieuw-&lt;script&gt;/);
  assert.match(m.html, /href="https:\/\/portaal\.famo\.test\/"/);
  assert.match(m.html, /Account/);
  assert.match(m.text, /Nieuw wachtwoord: Nieuw-<script>/);
});

test("replyTo client = adresse publique, sinon boîte ops ; jamais ops en destinataire", () => {
  const noPublic = { ...base, company: { bedrijfsnaam: "Famo" } };
  assert.equal(om.buildWelcomeMail({ ...noPublic, credentials: {} }).replyTo, "ops@famo.test");
  assert.equal(om.buildStatusMail({ ...noPublic, status: "onderweg" }).to, "chef@resto.test");
});

test("dateNl et vervaldatum", () => {
  assert.equal(om.dateNl(""), "—");
  assert.match(om.dateNl("2026-09-25"), /25/);
  assert.equal(om.vervaldatum("2026-09-25", 30), "2026-10-25");
  assert.equal(om.vervaldatum("2026-12-31", 1), "2027-01-01");
  assert.equal(om.vervaldatum("2026-09-25T10:00:00Z", 0), "2026-09-25");
  assert.equal(om.vervaldatum("", 30), "");
  assert.equal(om.vervaldatum("nope", 30), "");
});

test("notify* sans clé : skipped disabled, aucun fetch, ne jette jamais", async () => {
  const saved = global.fetch;
  global.fetch = () => { throw new Error("fetch ne doit pas être appelé"); };
  try {
    assert.equal(om.enabled(), false);
    const results = await Promise.all([
      om.notifyCancel({ ...base, door: "klant" }),
      om.notifyStatus({ ...base, status: "geleverd" }),
      om.notifyWelcome({ ...base, credentials: { user: "u", password: "p" } }),
      om.notifySignup({ opsEmail: "ops@famo.test", aanvraag: { email: "a@b.test" } }),
      om.notifyReset({ ...base, password: "p" }),
      // Contexte cassé : jamais d'exception.
      om.notifyStatus(null),
      om.notifyStatus({ status: "onzin" })
    ]);
    results.forEach(r => assert.deepEqual(r, { ok: false, skipped: "disabled" }));
  } finally {
    global.fetch = saved;
  }
});
