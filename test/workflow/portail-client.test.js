"use strict";
// Portail client : profil, favoris, mot de passe oublié, compte archivé.
// Scénarios métier découpés de l'ancien scripts/workflow-check.js (audit F-10,
// specs/011-workflow-check-decoupe) : code et messages d'assertion repris tels quels, un test par
// ancien bloc « ✓ ». Fichier autonome : son propre processus, son environnement, ses réponses simulées.
const h = require("./_helpers"); // en premier : environnement de test, réseau réel interdit
h.isolate(__filename);
const { describe, test } = require("node:test");
const assert = require("assert");
const path = require("path");
const { ROOT, HP, clearModule, call, patchOfX, methodCallsX } = h;

describe("Portail client : profil, favoris, mot de passe oublié, compte archivé", () => {
  test("AR. Klantportaal : profiel, favorieten (gefilterd), wachtwoord vergeten (neutraal, 3/u, enkel bij e-mailmatch)", async () => {
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
      r = await call(ko, me({ action: "favorites", pw: "fout" }), [CLI, { fields: {} }]); assert.equal(r.res.statusCode, 401, "AR2 verkeerd wachtwoord"); assert.deepEqual(methodCallsX(r, "PATCH").map(c => JSON.parse(c.options.body).fields), [{ Echecs: 1 }], "AR2 enkel de foutteller");
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
      const mailMods = ["lib/mail.js", "lib/ordermail.js", "lib/authmail.js", "api/klantorder.js"];
      process.env.RESEND_API_KEY = "re_test_key_AR"; mailMods.forEach(clearModule); ko = require(path.join(ROOT, "api", "klantorder.js"));
      r = await call(ko, { action: "reset", user: "aloha2", email: "iemand@anders.test" }, [{ records: [{ id: "cliAR2", fields: { Gebruikersnaam: "aloha2", Email: "keuken@aloha.test" } }] }]);
      assert.equal(r.res.statusCode, 200, "AR4 mismatch → neutraal"); assert.match(r.res.payload.message, /Als de gegevens kloppen/); assert.equal(r.calls.length, 1, "AR4 geen PATCH, geen mail"); assert.equal(r.res.payload.mail, undefined);
      r = await call(ko, { action: "reset", user: "aloha2", email: "geen@account.test" }, [{ records: [] }]);
      assert.equal(r.res.statusCode, 200, "AR4 onbekend account → zelfde antwoord"); assert.equal(r.calls.length, 1);
      r = await call(ko, { action: "reset", user: "aloha3", email: "keuken@aloha.test" }, [{ records: [{ id: "c3", fields: { Gebruikersnaam: "aloha3", Email: "keuken@aloha.test", Gearchiveerd: true } }] }]);
      assert.equal(r.res.statusCode, 200, "AR4 gearchiveerd → neutraal"); assert.equal(r.calls.length, 1, "AR4 gearchiveerd : geen PATCH");
      const HASH_AR = HP("huidig-pw");
      r = await call(ko, { action: "reset", user: "ALOHA2", email: "Keuken@Aloha.test" }, [{ records: [{ id: "cliAR2", fields: { Gebruikersnaam: "aloha2", Email: " keuken@aloha.test ", Nom: "Aloha", Wachtwoord: HASH_AR } }] }, { records: [{ fields: { Bedrijfsnaam: "Famo" } }] }, { id: "m1" }]);
      assert.equal(r.res.statusCode, 200, "AR4 match → link"); assert.match(r.res.payload.message, /Als de gegevens kloppen/);
      assert.equal(methodCallsX(r, "PATCH").length, 0, "AR4 het huidige wachtwoord blijft geldig tot de klant een nieuw kiest");
      const sent = r.calls.filter(c => /api\.resend\.com/.test(c.url));
      assert.equal(sent.length, 1, "AR4 één mail, naar het gekende adres"); assert.ok(sent[0].options.body.includes("keuken@aloha.test"));
      const mailAR = JSON.parse(sent[0].options.body);
      const linkAR = (mailAR.text.match(/\/wachtwoord\.html\?t=([^\s]+)/) || [])[1];
      assert.ok(linkAR, "AR4 de mail bevat een link naar wachtwoord.html?t=…");
      assert.deepEqual(require(path.join(ROOT, "lib/clientauth")).readResetToken(decodeURIComponent(linkAR)), { id: "cliAR2", fp: require(path.join(ROOT, "lib/clientauth")).fingerprint(HASH_AR) }, "AR4 link ondertekend, gebonden aan het huidige wachtwoord");
      assert.ok(!/wachtwoord:\s*\S{8,}/i.test(mailAR.text) && !mailAR.text.includes("huidig-pw"), "AR4 geen wachtwoord in klare tekst in de mail");
      assert.ok(!JSON.stringify(r.res.payload).includes(linkAR), "AR4 de link komt nooit in het antwoord");
      // Toegang geblokkeerd door Beheer (wachtwoord gewist) : geen heropening via zelfbediening.
      r = await call(ko, { action: "reset", user: "aloha4", email: "keuken@aloha.test" }, [{ records: [{ id: "c4", fields: { Gebruikersnaam: "aloha4", Email: "keuken@aloha.test" } }] }]);
      assert.equal(r.res.statusCode, 200, "AR4 geblokkeerd → neutraal"); assert.equal(r.calls.length, 1, "AR4 geblokkeerd : geen mail");
      if (savedKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = savedKey;
      mailMods.forEach(clearModule);
    }
  });

  test("AW. Klantportaal : gearchiveerde klant 401 (catalogue, orders, klantorder) ; favorieten ; voorraad enkel met afboeken", async () => {
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
      let r = await call(cat, { user: "aloha", pw: "w" }, [ACT(JSON.stringify({ favorieten: ["recAAAAAAAAAAAAAA"], standaard: { recAAAAAAAAAAAAAA: 2 } })), CATZ, { records: [] }, { records: [{ fields: { "Voorraad afboeken": true, IBAN: "BE68539007547034", Leverdagen: "di", Bedrijfsnaam: "Famo", Facturatie: "Portaal" } }] }, { records: [{ fields: { Produit: " zalm", "Quantité disponible": 3 } }] }, { records: [{ fields: { Bedrijfsnaam: "Famo" } }] }]);
      assert.equal(r.res.statusCode, 200, "AW2 actieve klant");
      assert.deepEqual(r.res.payload.client.favorieten, { favorieten: ["recAAAAAAAAAAAAAA"], standaard: { recAAAAAAAAAAAAAA: 2 } }, "AW2 favorieten meegegeven");
      assert.equal(r.res.payload.products[0].voorraad, 3, "AW2 voorraad zichtbaar (op naam) wanneer afboeken aan staat");
      assert.equal(r.res.payload.company.iban, "BE68539007547034"); assert.equal(r.res.payload.company.facturatie, "portaal"); // IBAN seulement en mode Portaal assert.deepEqual(r.res.payload.company.levering.leverdagen, ["di"]); assert.equal(r.res.payload.company.bedrijfsnaam, "Famo");
      r = await call(cat, { user: "aloha", pw: "w" }, [ACT("{{niet json"), CATZ, { records: [] }, { records: [{ fields: {} }] }, { records: [{ fields: {} }] }]);
      assert.equal(r.res.statusCode, 200, "AW3 zonder afboeken"); assert.equal(r.res.payload.products[0].voorraad, undefined, "AW3 geen voorraad getoond"); assert.equal(r.calls.filter(c => /\/Stock/.test(c.url)).length, 0, "AW3 Stock niet gelezen");
      assert.deepEqual(r.res.payload.client.favorieten, { favorieten: [], standaard: {} }, "AW3 onleesbare favorieten → leeg");
    }
  });
});
