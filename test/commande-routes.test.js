"use strict";
// A6 (specs/010-updateorder-numerotation) : api/updateorder.js ne fait qu'aiguiller ; chaque requête
// est traitée par UN module de lib/commande/ (même découpage que api/onboarding.js → lib/beheer/, I-10).
process.env.DB_BACKEND = "sqlite";
process.env.DB_SQLITE_FILE = ":memory:";
process.env.STAFF_CODE = process.env.STAFF_CODE || "test-staff-code";
process.env.ADMIN_CODE = process.env.ADMIN_CODE || "test-admin-code";
delete process.env.RESEND_API_KEY;

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "lib", "commande");
const ENTRY = path.join(ROOT, "api", "updateorder.js");
const MODULES = ["common", "lignes", "stock", "nummering", "corrigeren", "creditnota", "correctiemail", "bijwerken"];
const read = (p) => fs.readFileSync(p, "utf8");

test("api/updateorder.js reste un aiguillage court, avec la garde en première ligne", () => {
  const src = read(ENTRY);
  assert.ok(src.split("\n").length < 150, "aiguillage court (" + src.split("\n").length + " lignes)");
  assert.match(src, /module\.exports = async \(req, res\) => \{\n\s*if \(require\("\.\.\/lib\/guard"\)\.blocked\(req, res\)\) return;/);
  assert.ok(!/require\([^"]/.test(src), "require statiques (Vercel nft)");
  assert.match(src, /const inflight = new Set\(\);/, "le verrou d'instance reste dans le point d'entrée");
  assert.match(src, /__auth\.staffSession\(req\)/, "session contrôlée avant tout module");
  for (const f of fs.readdirSync(path.join(ROOT, "api")).filter((x) => x.endsWith(".js"))) {
    const n = read(path.join(ROOT, "api", f)).split("\n").length;
    assert.ok(n <= 600, "api/" + f + " : " + n + " lignes (SC-003)");
  }
});

test("lib/commande : modules attendus, require statiques, aucun état d'instance", () => {
  assert.deepStrictEqual(fs.readdirSync(DIR).filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, "")).sort(), MODULES.slice().sort());
  for (const m of MODULES) {
    const src = read(path.join(DIR, m + ".js"));
    assert.ok(!/require\([^"]/.test(src), m + " : require statiques (Vercel nft)");
    assert.ok(!/inflight/.test(src), m + " : pas de verrou ici");
    assert.ok(src.split("\n").length < 300, m + " : " + src.split("\n").length + " lignes");
  }
});

test("exports historiques conservés (orders, export, klantdoc importent parseLines de ./updateorder)", () => {
  const uo = require(ENTRY);
  assert.strictEqual(uo.parseLines, require(path.join(ROOT, "lib", "lines.js")).parseLines);
  assert.equal(typeof uo.formatLine, "function");
  assert.equal(uo.formatLine({ nom: "Tong", qty: 1.5, unit: "kg", price: 18.49, comment: "in (filets)" }), "Tong × 1.5 kg [€18.49] (in filets)");
  for (const f of ["orders.js", "export.js", "klantdoc.js"]) assert.match(read(path.join(ROOT, "api", f)), /require\("\.\/updateorder"\)/, f);
});

test("chaque requête est traitée par exactement un module", async () => {
  // Entrée rechargée avec des espions à la place des actions (le point d'entrée les lit au chargement).
  delete require.cache[require.resolve(ENTRY)];
  Object.keys(require.cache).filter((k) => k.startsWith(DIR + path.sep)).forEach((k) => { delete require.cache[k]; });
  const calls = [];
  const spy = (mod, fn) => { const m = require(path.join(DIR, mod + ".js")); m[fn] = async (req, res) => { calls.push(mod); return res.status(200).json({ ok: true }); }; };
  spy("corrigeren", "applyCorrection"); spy("creditnota", "makeCreditnota"); spy("correctiemail", "sendCorrectieMail"); spy("bijwerken", "update");
  const uo = require(ENTRY);
  const ds = require(path.join(ROOT, "lib", "datastore.js"));
  const auth = require(path.join(ROOT, "lib", "staffauth.js"));
  await ds.state.store.replaceAll("Commandes", [{ id: "recORD0001", createdTime: new Date().toISOString(), fields: { Statut: "Reçue" } }]);
  const headers = { cookie: "famo_sess=" + encodeURIComponent(auth.sign(Date.now() + 3600e3, "admin")) };
  const cases = [
    [{ correction: "terug", reden: "fout" }, "corrigeren"],
    [{ creditnota: { lignes: "Tong × 1", motif: "abc" } }, "creditnota"],
    [{ correctieMail: true }, "correctiemail"],
    [{ statut: "Prête", preparationValidee: true }, "bijwerken"],
    [{ volgorde: 3 }, "bijwerken"],
    [{ lignes: "Tong × 1" }, "bijwerken"],
    [{ paiement: "En attente" }, "bijwerken"]
  ];
  try {
    for (const [body, want] of cases) {
      calls.length = 0;
      const res = { statusCode: 200, payload: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
      await uo({ method: "POST", body: Object.assign({ id: "recORD0001" }, body), headers, query: {} }, res);
      assert.equal(res.statusCode, 200, JSON.stringify([body, res.payload]));
      assert.deepStrictEqual(calls, [want], JSON.stringify(body));
    }
  } finally {
    delete require.cache[require.resolve(ENTRY)];
    Object.keys(require.cache).filter((k) => k.startsWith(DIR + path.sep)).forEach((k) => { delete require.cache[k]; });
  }
});
