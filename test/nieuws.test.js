"use strict";
// « Nieuw » dans Beheer (retour du gérant, 2026-10-10) : chaque changement livré a une note pour Mohsen,
// en néerlandais simple : ce qui a changé et ce qu'il doit faire. Une spec sans note fait échouer ce test.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const N = require(path.join(ROOT, "assets", "nieuws.js"));

test("chaque note est complète et simple", () => {
  assert.ok(Array.isArray(N.items) && N.items.length >= 4);
  const ids = new Set();
  for (const n of N.items) {
    assert.match(n.id, /^[a-z0-9-]+$/, n.id);
    assert.ok(!ids.has(n.id), "id unique : " + n.id); ids.add(n.id);
    assert.match(n.datum, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(n.spec, /^\d{3}$/);
    assert.ok(n.titel && n.titel.length <= 60, "titre court : " + n.titel);
    assert.ok(n.wat && n.wat.length <= 320, "explication courte : " + n.id);
    assert.ok(Array.isArray(n.doen), "liste des actions (peut être vide) : " + n.id);
    for (const d of n.doen) {
      assert.ok(d.tekst && d.tekst.length <= 200, n.id);
      if (d.link) assert.match(d.link, /^(#\/[a-z]+|\/[a-z/]+)$/, "lien interne : " + d.link);
    }
    // Langage simple : pas de jargon technique dans ce que Mohsen lit
    const txt = [n.titel, n.wat].concat(n.doen.map(d => d.tekst)).join(" ").toLowerCase();
    for (const w of ["api", "server", "database", "deploy", "commit", "spec ", "json", "endpoint", "cache", "airtable", "postgres"]) assert.ok(!txt.includes(w), n.id + " contient du jargon : " + w);
    assert.ok(!/[—–]/.test(txt), n.id + " : pas de tiret long");
  }
});

test("chaque changement depuis la spec 027 a sa note pour Mohsen", () => {
  const specs = fs.readdirSync(path.join(ROOT, "specs")).map(d => (/^(\d{3})-/.exec(d) || [])[1]).filter(Boolean).filter(n => Number(n) >= 27);
  const covered = new Set(N.items.map(n => n.spec));
  for (const s of specs) assert.ok(covered.has(s), "spec " + s + " sans note « Nieuw » pour Mohsen (assets/nieuws.js)");
});

test("ongelezen : ce qui n'a pas encore été vu, le plus récent d'abord", () => {
  const all = N.items.map(n => n.id);
  assert.deepEqual(N.ongelezen([]).map(n => n.id).sort(), all.slice().sort());
  assert.equal(N.ongelezen(all).length, 0);
  const u = N.ongelezen([all[0]]);
  assert.equal(u.length, all.length - 1);
  for (let i = 1; i < u.length; i++) assert.ok(u[i - 1].datum >= u[i].datum);
});

test("Beheer charge les notes et les affiche", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "beheer.html"), "utf8"), /assets\/nieuws\.js/);
  const js = fs.readFileSync(path.join(ROOT, "assets", "pages", "beheer.js"), "utf8");
  assert.match(js, /\["nieuw", "Nieuw"\]/);
  assert.match(js, /FamoNieuws/);
});
