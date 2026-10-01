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
  const m = om.buildCancelTeamMail({ ...base, door: "klant", reden: "Restaurant gesloten", orderUrl: "https://portaal.famo.test/team/bestellingen#CMD-2026-0007" });
  checkCommon(m, "ops@famo.test", "chef@resto.test");
  assert.equal(m.subject, "Bestelling CMD-2026-0007 geannuleerd — Resto " + XSS + " — Restaurant gesloten");
  assert.equal(m.idempotencyKey, "cancel:CMD-2026-0007");
  assert.match(m.html, /Restaurant gesloten/);
  assert.match(m.html, /de klant/);
  assert.match(m.html, /kassa/);
  assert.ok(m.html.includes(om.dateNl("2026-09-25")), "date de livraison affichée");
  assert.match(m.html, /team\/bestellingen#CMD-2026-0007/);
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

test("buildStatusMail geleverd (mode portaal) : facture + paiement TVAC + bouton", () => {
  const m = om.buildStatusMail({ ...base, status: "geleverd", facturatie: "portaal", totalExcl: 53, totalBtw: 3.18, totalIncl: 56.18, factuurnummer: "F-2026-0101", ontvangenDoor: "Jan " + XSS, vervaldatum: "2026-10-25", mededeling: "+++123/4567/89012+++" });
  assert.match(m.text, /Bedrag: € 56,18/, "le montant à payer est TVA comprise (audit B-04)");
  assert.doesNotMatch(m.text, /Bedrag: € 53,00/);
  checkCommon(m, "chef@resto.test", "info@famotrading.be");
  assert.equal(m.subject, "Uw bestelling CMD-2026-0007 is geleverd — factuur F-2026-0101");
  assert.equal(m.idempotencyKey, "status:CMD-2026-0007:geleverd");
  for (const s of ["Factuurnummer", "F-2026-0101", "Ontvangen door", "Jan ", "Totaal excl. btw", "€ 53,00", "Vervaldatum", "BE68539007547034", "GKCCBEBB", "+++123/4567/89012+++", "Factuur bekijken", "https://portaal.famo.test/klant#/bestellingen"]) {
    assert.ok(m.html.includes(s), "html contient " + s);
  }
  assert.match(m.text, /IBAN: BE68539007547034/);
  assert.match(m.text, /klant#\/bestellingen/);
  assert.ok(m.html.includes(om.dateNl("2026-10-25")), "vervaldatum affichée");
});

test("buildStatusMail geleverd (mode boekhouder, défaut) : ni facture ni paiement, renvoi vers la boekhouding", () => {
  const m = om.buildStatusMail({ ...base, status: "geleverd", totalExcl: 53, totalIncl: 56.18, factuurnummer: "FA-2026-0101", ontvangenDoor: "Jan", vervaldatum: "2026-10-25", mededeling: "+++202/6000/10167+++" });
  assert.equal(m.subject, "Uw bestelling CMD-2026-0007 is geleverd");
  for (const s of ["FA-2026-0101", "BE68539007547034", "+++", "Bedrag", "Vervaldatum", "Factuur bekijken"]) assert.ok(!m.html.includes(s) && !m.text.includes(s), "absent : " + s);
  assert.match(m.text, /boekhouding \(via Peppol\)/);
  assert.match(m.text, /Totaal incl\. btw: € 56,18/);
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
  for (const s of ["Els", "0499 11 22 33", "els@brasserie.test", "Markt 5, 9000 Gent", "Levering enkel &#039;s ochtends", "https://portaal.famo.test/beheer#/aanvragen"]) {
    assert.ok(m.html.includes(s), "html contient " + s);
  }
  assert.match(m.text, /beheer#\/aanvragen/);
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

test("C-15 : e-mails client en français quand Taal = FR (sujet, corps, montants fr-BE), équipe en NL", () => {
  const fr = { ...base, klant: { ...klant, taal: "FR" } };
  const c = om.buildCustomerMail(fr);
  assert.match(c.subject, /^Confirmation de votre commande CMD-2026-0007/);
  assert.match(c.text, /53,00\s€/); assert.ok(!/Bedankt|Totaal|Referentie/.test(c.text), "aucun texte NL");
  const g = om.buildStatusMail({ ...fr, status: "geleverd", facturatie: "portaal", totalExcl: 53, totalIncl: 56.18, factuurnummer: "FA-2026-0101", vervaldatum: "2026-10-25", mededeling: "+++202/6000/10167+++" });
  assert.match(g.subject, /livrée/); assert.match(g.text, /56,18\s€/); assert.match(g.html, /lang="fr"/);
  const b = om.buildStatusMail({ ...fr, status: "geleverd", totalExcl: 53, totalIncl: 56.18, factuurnummer: "FA-2026-0101" });
  assert.match(b.text, /Peppol/); assert.ok(!/FA-2026-0101/.test(b.text), "mode boekhouder : pas de numéro de facture");
  assert.match(om.buildTeamMail(fr).subject, /Nieuwe bestelling|bestelling/i, "e-mail interne en néerlandais");
  assert.equal(om.clientFrom({ fields: { Taal: "fr" } }).taal, "FR");
});

// ---- Gabarit commun des e-mails (spec 012, audit A10) ----
const am = require(path.join(__dirname, "..", "lib", "authmail.js"));
const layout = require(path.join(__dirname, "..", "lib", "maillayout.js"));
const preheaderOf = html => ((/<div class="preheader"[^>]*>([^<]*)/.exec(html) || [])[1] || "").replace(/(&zwnj;|&nbsp;|\s)+$/g, "");
function allMails() {
  const fr = { ...base, klant: { ...klant, taal: "FR" } };
  const corr = { ...base, recordId: "rec1", orderUrl: "https://portaal.famo.test/team/bestelling?id=rec1", wijzigingen: [{ name: "Zalm", unit: "kg", voor: { qty: 2, price: 12.5 }, na: { qty: 1.5, price: 12.5 } }], totalExcl: 46.75, totalIncl: 49.56, creditnotas: [], sleutel: "k" };
  return {
    team: om.buildTeamMail({ ...base, orderUrl: "https://portaal.famo.test/team/bestelling?id=rec1" }),
    customer: om.buildCustomerMail(base),
    customerFr: om.buildCustomerMail(fr),
    cancelTeam: om.buildCancelTeamMail({ ...base, door: "klant", reden: "Gesloten" }),
    onderweg: om.buildStatusMail({ ...base, status: "onderweg" }),
    geleverd: om.buildStatusMail({ ...base, status: "geleverd", facturatie: "portaal", totalExcl: 53, totalIncl: 56.18, factuurnummer: "FA-2026-0101", vervaldatum: "2026-10-25", mededeling: "+++202/6000/10167+++" }),
    geleverdBoekhouder: om.buildStatusMail({ ...base, status: "geleverd", totalExcl: 53, totalIncl: 56.18, factuurnummer: "FA-2026-0101" }),
    geannuleerd: om.buildStatusMail({ ...fr, status: "geannuleerd", reden: "Rupture" }),
    reminder: om.buildReminderMail({ ...base, level: 1, factuurnummer: "FA-2026-0101", factuurdatum: "2026-09-01", vervaldatum: "2026-09-15", totalIncl: 56.18, mededeling: "+++202/6000/10167+++" }),
    correctie: om.buildCorrectionMail(corr),
    correctieTeam: om.buildCorrectionTeamMail(corr),
    welcome: om.buildWelcomeMail({ ...base, credentials: { user: "resto42", password: "pw" } }),
    reset: om.buildResetMail({ ...base, credentials: { user: "resto42" }, password: "pw" }),
    signup: om.buildSignupTeamMail({ company, opsEmail: "ops@famo.test", portalUrl: "https://portaal.famo.test", aanvraag: { bedrijfsnaam: "Brasserie", email: "els@b.test" } }),
    activation: am.buildActivationMail({ klant, user: "resto42", link: "https://portaal.famo.test/wachtwoord?t=abc", hours: 72, company }),
    resetLink: am.buildResetLinkMail({ klant: { ...klant, taal: "FR" }, user: "resto42", link: "https://portaal.famo.test/wachtwoord?t=abc", hours: 1, company })
  };
}

test("A10 : un seul gabarit (marque F en texte, color-scheme, fonds explicites) pour tous les e-mails", () => {
  for (const [name, m] of Object.entries(allMails())) {
    assert.match(m.html, /^<!doctype html>/, name);
    assert.ok(m.html.includes(layout.brandRow("Famo Trading BV")), name + " : bandeau de marque commun");
    assert.match(m.html, /<meta name="color-scheme" content="light only">/, name);
    assert.match(m.html, /<meta name="supported-color-schemes" content="light only">/, name);
    assert.match(m.html, /<body[^>]*bgcolor="#EFF3F3"[^>]*style="[^"]*background-color:#EFF3F3/, name + " : fond explicite");
    assert.match(m.html, /bgcolor="#FFFFFF"/, name + " : carte blanche explicite");
    assert.ok(!/<style|display\s*:\s*flex|<img/i.test(m.html), name + " : compatible clients mail");
    assert.ok(!/text-transform:uppercase|Georgia/i.test(m.html), name + " : ni capitales ni serif");
    // Texte blanc seulement sur une cellule Noordzee (marque, bouton) : jamais blanc sur transparent.
    for (const hit of m.html.matchAll(/(?<![-\w])color:#FFFFFF/g)) {
      assert.ok(m.html.slice(Math.max(0, hit.index - 400), hit.index).includes('bgcolor="#0B5A6C"'), name + " : texte blanc hors fond Noordzee à " + hit.index);
    }
    assert.ok(!/color:#fff\b|color:#ffffff|color:white/.test(m.html), name + " : blanc écrit d'une seule façon");
    assert.ok(m.text && m.text.length > 40, name + " : version texte");
  }
});

test("A10 : texte d'aperçu (preheader) dans la langue du destinataire, sans rien de confidentiel", () => {
  const m = allMails();
  for (const [name, mail] of Object.entries(m)) {
    const p = preheaderOf(mail.html);
    assert.ok(p.length > 10 && p.length < 220, name + " : aperçu présent (" + p + ")");
    assert.match(mail.html, /<div class="preheader" style="display:none;[^"]*mso-hide:all/, name + " : aperçu caché");
  }
  assert.match(preheaderOf(m.customer.html), /CMD-2026-0007/);
  assert.match(preheaderOf(m.customerFr.html), /Référence/);
  assert.match(preheaderOf(m.onderweg.html), /^Uw bestelling CMD-2026-0007 is onderweg/);
  assert.match(preheaderOf(m.geannuleerd.html), /^Votre commande CMD-2026-0007 a été annulée/);
  assert.match(preheaderOf(m.resetLink.html), /mot de passe/);
  assert.ok(!preheaderOf(m.geleverdBoekhouder.html).includes("FA-2026-0101"), "boekhouder : pas de numéro de facture");
  assert.ok(!/resto42|pw/.test(preheaderOf(m.welcome.html) + preheaderOf(m.reset.html)), "jamais d'identifiant dans l'aperçu");
  const hostile = om.buildStatusMail({ ...base, ref: "CMD-<b>1</b>", status: "onderweg" });
  assert.match(preheaderOf(hostile.html), /CMD-&lt;b&gt;1&lt;\/b&gt;/, "aperçu échappé");
});

test("A10 : bouton plein (cellule Noordzee + lien), liens inchangés, lien de secours pour le mot de passe", () => {
  const m = allMails();
  const button = href => new RegExp('<td[^>]*bgcolor="#0B5A6C"[^>]*><a href="' + href.replace(/[.?/#]/g, "\\$&") + '"');
  assert.match(m.team.html, button("https://portaal.famo.test/team/bestelling?id=rec1"), "lien /team/bestelling?id= gardé");
  assert.match(m.correctieTeam.html, button("https://portaal.famo.test/team/bestelling?id=rec1"));
  assert.match(m.onderweg.html, button("https://portaal.famo.test/klant#/bestellingen"));
  assert.match(m.geleverd.html, button("https://portaal.famo.test/klant#/bestellingen"));
  assert.match(m.signup.html, button("https://portaal.famo.test/beheer#/aanvragen"));
  assert.match(m.activation.html, button("https://portaal.famo.test/wachtwoord?t=abc"));
  assert.match(m.activation.html, /Werkt de knop niet\?[\s\S]*?>https:\/\/portaal\.famo\.test\/wachtwoord\?t=abc</, "lien de secours NL");
  assert.match(m.resetLink.html, /Le bouton ne fonctionne pas \?/, "lien de secours FR");
  assert.match(m.resetLink.text, /valable 1 heure et/, "FR : « 1 heure », pas « 1 heures »");
  assert.match(m.activation.text, /\/wachtwoord\?t=abc\n/, "texte : lien suivi d'un retour à la ligne (AR4)");
});
