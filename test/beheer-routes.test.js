"use strict";
// I-10 : api/onboarding.js ne fait qu'aiguiller ; chaque action vit dans UN module de lib/beheer/.
// Toute action envoyée par l'interface (Beheer, Voorraad, Invoeren…) doit trouver exactement un module.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const MODS = ["config", "producten", "klanten", "klantgebruikers", "toegang", "prijzen"].map((m) => [m, require(path.join(ROOT, "lib", "beheer", m + ".js"))]);

test("aucune action traitée par deux modules", () => {
  const seen = new Map();
  for (const [name, mod] of MODS) {
    assert.ok(Array.isArray(mod.ACTIONS) && typeof mod.run === "function", name);
    for (const a of mod.ACTIONS) { assert.ok(!seen.has(a), a + " : " + seen.get(a) + " et " + name); seen.set(a, name); }
  }
});

test("chaque action envoyée par les pages vers /api/onboarding a son module", () => {
  const routed = new Set(MODS.flatMap(([, m]) => m.ACTIONS));
  const dir = path.join(ROOT, "assets", "pages");
  const sent = new Set();
  for (const f of [...fs.readdirSync(dir), ...fs.readdirSync(path.join(dir, "team")).map((x) => "team/" + x)].filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    if (!src.includes("/api/onboarding")) continue;
    for (const m of src.matchAll(/action:\s*"(\w+)"/g)) sent.add(m[1]);
  }
  assert.ok(sent.size > 15, "les pages envoient bien des actions (" + sent.size + ")");
  const orphan = [...sent].filter((a) => !routed.has(a) && !/^(cancel|profile|logout|setPassword|nieuw|correct)/.test(a));
  // Les actions d'autres API (klantorder, klantwachtwoord, updateorder) partagent le mot « action » : on les
  // reconnaît à ce qu'aucun module Beheer ne les connaît ET qu'elles ne sont pas envoyées à /api/onboarding.
  const reallyOnboarding = orphan.filter((a) => fs.readdirSync(dir).filter((f) => f.endsWith(".js")).some((f) => new RegExp('/api/onboarding"[^;]*action:\\s*"' + a + '"').test(fs.readFileSync(path.join(dir, f), "utf8"))));
  assert.deepStrictEqual(reallyOnboarding, [], "actions sans module");
});

test("api/onboarding.js reste un aiguillage court, avec la garde en première ligne", () => {
  const src = fs.readFileSync(path.join(ROOT, "api", "onboarding.js"), "utf8");
  assert.ok(src.split("\n").length < 120, "aiguillage court (" + src.split("\n").length + " lignes)");
  assert.match(src, /module\.exports = async \(req, res\) => \{\n\s*if \(require\("\.\.\/lib\/guard"\)\.blocked\(req, res\)\) return;/);
  assert.ok(!/require\([^"]/.test(src), "require statiques (Vercel nft)");
});
