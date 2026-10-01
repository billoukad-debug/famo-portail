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
  // Dossiers ancrés à la racine (« /docs ») : un motif nu exclurait aussi assets/docs/ (module documents, spec 014).
  for (const p of ["/.dev-data", "/scripts", "/test", "/docs", "*.md", ".env"]) assert.ok(ignore.includes(p), p + " doit être dans .vercelignore");
  for (const p of ["docs", "scripts", "test"]) assert.ok(!ignore.includes(p), "« " + p + " » sans / exclurait aussi assets/" + p + "/");
});

test("assets/docs/ et les pages team/ sont déployés, docs/ et specs/ ne le sont pas (syntaxe gitignore)", () => {
  const ignored = (f) => require("child_process").spawnSync("git", ["-c", "core.excludesFile=.vercelignore", "check-ignore", "--no-index", "-q", f], { cwd: ROOT }).status === 0;
  for (const f of ["assets/docs/documents.js", "assets/pages/team/magazijn.js", "team/magazijn.html", "beheer/aanmelden.html", "lib/billing.js"]) assert.equal(ignored(f), false, f + " doit être déployé");
  for (const f of ["docs/RUNBOOK.md", "specs/014-url-arborescence/spec.md", "scripts/check.js", "test/deploy.test.js"]) assert.equal(ignored(f), true, f + " ne doit pas être déployé");
});

test("lib/ (nécessaire aux fonctions) et chemins internes bloqués en HTTP", () => {
  const src = (vercel.redirects || []).map((r) => r.source);
  for (const p of ["/lib/:path*", "/.dev-data/:path*", "/scripts/:path*", "/test/:path*"]) assert.ok(src.includes(p), p + " doit être redirigé");
});

test("anciennes adresses : redirigées par leur forme propre (cleanUrls passe avant les redirections)", () => {
  // En production, /dagprep.html devient d'abord /dagprep (cleanUrls) : une source « /x.html » n'est jamais
  // atteinte (incident du 01/10/2026 : /dagprep.html, /aan-de-slag.html, /overzicht.html finissaient en 404).
  assert.equal(vercel.cleanUrls, true);
  const src = new Map((vercel.redirects || []).map((r) => [r.source, r.destination]));
  for (const s of src.keys()) assert.ok(!s.endsWith(".html"), s + " : source jamais atteinte avec cleanUrls, utiliser la forme sans .html");
  const old = ["personeel", "bestellingen", "entrepot", "leveringen", "invoer", "documenten", "stock", "lots", "order", "beheer-login", "aan-de-slag", "dagprep", "overzicht"];
  for (const n of old) {
    assert.ok(src.has("/" + n), "/" + n + " doit être redirigée");
    const to = src.get("/" + n).split("?")[0], file = to === "/" ? "index.html" : to.slice(1) + ".html";
    assert.ok(fs.existsSync(path.join(ROOT, file)), "/" + n + " → " + to + " : page absente");
  }
});

test("données de dev jamais suivies par git", () => {
  const gi = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(gi, /^\.dev-data\/$/m);
  assert.match(gi, /^\.env$/m);
});
