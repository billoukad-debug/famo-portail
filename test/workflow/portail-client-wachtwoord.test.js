"use strict";
// Portail client : le client change lui-même son mot de passe.
// Scénarios métier découpés de l'ancien scripts/workflow-check.js (audit F-10,
// specs/011-workflow-check-decoupe) : code et messages d'assertion repris tels quels, un test par
// ancien bloc « ✓ ». Fichier autonome : son propre processus, son environnement, ses réponses simulées.
const h = require("./_helpers"); // en premier : environnement de test, réseau réel interdit
h.isolate(__filename);
const { describe, test } = require("node:test");
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { ROOT, HP, mkRes, call } = h;

describe("Portail client : le client change lui-même son mot de passe", () => {
  test("AL. Portail client : changer son mot de passe (ancien vérifié serveur, 8 car. min, jamais le compte d'un autre)", async () => {
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
      r = await call(klantPw, { user: "anna", pw: "fout-wachtwoord", nieuw: "nieuw-wachtwoord" }, [clientRec("recAnna", "anna", "oud-wachtwoord"), { fields: {} }]);
      assert.equal(r.res.statusCode, 401, "AL2 ancien mot de passe faux → refusé");
      assert.match(r.res.payload.error, /huidige wachtwoord klopt niet/, "AL2 message clair");
      assert.deepEqual(patchesAL(r.calls).map(c => JSON.parse(c.options.body).fields), [{ Echecs: 1 }], "AL2 seul le compteur d'échecs persistant est écrit, jamais le mot de passe");
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
      r = await call(klantPw, { user: "bert", pw: "oud-wachtwoord", nieuw: "overgenomen-1" }, [clientRec("recBert", "bert", "bert-geheim"), { fields: {} }]);
      assert.equal(r.res.statusCode, 401, "AL4a user d'un autre client + mauvais mot de passe → refusé");
      assert.ok(patchesAL(r.calls).every(c => !("Wachtwoord" in JSON.parse(c.options.body).fields)), "AL4a le mot de passe de Bert n'est jamais écrit (seulement son compteur d'échecs)");
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
      // H-08 : la fiche de connexion vérifiée (client ou utilisateur supplémentaire) porte le mot de passe.
      assert.match(srcAL, /__kl\.patch\(client\.login, \{ "Wachtwoord": hashed \}\)/, "AL4d PATCH construit depuis la fiche de connexion vérifiée");

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
        r = await call(klantPw, { user: "carla", pw: "gok-" + i, nieuw: "nieuw-wachtwoord" }, [clientRec("recCarla", "carla", "juist-wachtwoord"), { fields: {} }]);
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
  });
});
