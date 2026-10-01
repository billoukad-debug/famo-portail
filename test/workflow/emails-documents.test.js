"use strict";
// E-mails et documents : envois de commande, langue du client.
// Scénarios métier découpés de l'ancien scripts/workflow-check.js (audit F-10,
// specs/011-workflow-check-decoupe) : code et messages d'assertion repris tels quels, un test par
// ancien bloc « ✓ ». Fichier autonome : son propre processus, son environnement, ses réponses simulées.
const h = require("./_helpers"); // en premier : environnement de test, réseau réel interdit
h.isolate(__filename);
const { describe, test, before } = require("node:test");
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const { ROOT, UI_NL, HP, json, mkRes, clearModule, call, NO_ORDER_REFS } = h;

describe("E-mails et documents : envois de commande, langue du client", () => {
  // Cookies staff et beheerder ouverts avec les codes d'environnement de test.
  let adminCookieHdr;
  before(async () => { ({ adminCookieHdr } = await h.staffCookies()); });

  test("M. E-mails commande (inerte sans clé, destinataires séparés, échec sans impact)", async () => {
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
  });

  test("BA. Documenten in de taal van de klant (NL/FR), geen standaardzin « goederen in goede staat »", async () => {
    // --- BA. Documents dans la langue du client ; plus de mention par défaut « goederen in goede staat » ---
    {
      const sb = { console, document: { documentElement: {}, addEventListener() {}, querySelector() { return null; } }, localStorage: { getItem() { return null; }, setItem() {} }, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, navigator: { language: "nl" }, location: { search: "", pathname: "/", hash: "" } };
      sb.window = sb; vm.createContext(sb);
      for (const f of ["assets/ui.js", "assets/vat.js", "staff-company.js", "documents.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb);
      const D = sb.FamoDocuments;
      D.setCompany({ nom: "FAMO Seafood", adresse: "Kaai 1", cp: "2000 Antwerpen", btw: "BE 0123.456.789", iban: "BE71096123456769", facturatie: "portaal" });
      const base = { ref: "CMD-2026-0007", client: "Chez Paul", lignes: "Mosselen × 2 caisse [€28.00]\nZalm × 1.5 kg [€20.00]", total: 86, dateLiv: "2026-09-28", factuurnummer: "FA-2026-0007", factureeLe: "2026-09-28T08:00:00Z" };
      const nl = D.build(Object.assign({}, base, { klant: { taal: "NL", btw: "BE 1" } }), "delivery");
      const fr = D.build(Object.assign({}, base, { klant: { taal: "FR", btw: "BE 1" } }), "delivery");
      assert.ok(!/goede staat/i.test(nl) && !/goede staat/i.test(fr), "BA geen « goederen in goede staat » meer");
      assert.match(nl, /LEVERINGSBON/); assert.match(nl, /html lang="nl"/); assert.match(nl, /kassa/);
      assert.match(fr, /BON DE LIVRAISON/); assert.match(fr, /html lang="fr"/); assert.match(fr, /Quantité/); assert.match(fr, /caisse/); assert.ok(!/Aantal|Beschrijving|kassa/.test(fr), "BA leveringsbon FR : geen Nederlands");
      const inv = D.build(Object.assign({}, base, { klant: { taal: "FR" } }), "invoice");
      assert.match(inv, /FACTURE/); assert.match(inv, /Total HTVA/); assert.match(inv, /Total TVAC/); assert.match(inv, /Échéance/); assert.match(inv, /Communication/); assert.ok(!/Totaal|Vervaldatum|Mededeling/.test(inv), "BA factuur FR volledig vertaald");
      const cn = D.build(Object.assign({}, base, { taal: "FR", creditnota: { nummer: "CN-2026-0001", lignes: "Zalm × 1 kg [€20.00]", montant: 20, le: "2026-09-29", motif: "abîmé" } }), "credit");
      assert.match(cn, /NOTE DE CRÉDIT/); assert.match(cn, /Note de crédit sur la facture FA-2026-0007/);
      assert.equal(D.langOf({}), "nl", "BA zonder taal → NL");
      D.setCompany({ nom: "FAMO Seafood", iban: "BE71096123456769", leveringsvoorwaarden: "Klachten binnen 24 u." });
      assert.match(D.build(base, "delivery"), /Klachten binnen 24 u\./, "BA eigen leveringsvoorwaarden uit Beheer blijven staan");
    }
    {
      const su = require(path.join(ROOT, "api", "signup.js"));
      const reqBody = taal => ({ bedrijfsnaam: "Chez Paul", contactpersoon: "Paul", email: "paul@chez.test", telefoon: "+32 470 00 00 00", taal });
      // 1re lecture : Configuratie (version des conditions générales, C-12), puis l'écriture.
      let r = await call(su, reqBody("FR"), [{ records: [] }, { records: [{ id: "aan1" }] }, { records: [] }, { records: [] }], { headers: { "x-forwarded-for": "10.0.0.91" } });
      assert.equal(r.res.statusCode, 200, "BA aanvraag ontvangen");
      assert.equal(JSON.parse(r.calls[1].options.body).records[0].fields.Taal, "FR", "BA aanvraag onthoudt de taal");
      r = await call(su, reqBody(undefined), [{ records: [] }, { records: [{ id: "aan2" }] }, { records: [] }, { records: [] }], { headers: { "x-forwarded-for": "10.0.0.92" } });
      assert.equal(JSON.parse(r.calls[1].options.body).records[0].fields.Taal, "NL", "BA aanvraag zonder taal → NL");
    }
  });
});
