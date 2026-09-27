"use strict";
// Déploiement : ce qui ne doit jamais être servi par le site public, et la région des fonctions.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const ignore = fs.readFileSync(path.join(ROOT, ".vercelignore"), "utf8").split("\n").map((l) => l.trim());

test("fonctions à Francfort, à côté de la base Neon", () => {
  assert.deepStrictEqual(vercel.regions, ["fra1"]);
});

test("fichiers de développement exclus du déploiement", () => {
  for (const p of [".dev-data", "scripts", "test", "docs", "*.md", ".env"]) assert.ok(ignore.includes(p), p + " doit être dans .vercelignore");
});

test("lib/ (nécessaire aux fonctions) et chemins internes bloqués en HTTP", () => {
  const src = (vercel.redirects || []).map((r) => r.source);
  for (const p of ["/lib/:path*", "/.dev-data/:path*", "/scripts/:path*", "/test/:path*"]) assert.ok(src.includes(p), p + " doit être redirigé");
});

test("données de dev jamais suivies par git", () => {
  const gi = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(gi, /^\.dev-data\/$/m);
  assert.match(gi, /^\.env$/m);
});
