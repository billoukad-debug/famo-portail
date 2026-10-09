#!/usr/bin/env node
// Garde-fous v2 — génériques, indépendants des noms de pages v1.
//   node scripts/check.js
// Vert = déployable. Chaque règle dit ce qu'elle protège.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const childProcess = require("child_process");
const ROOT = path.join(__dirname, "..");
const errors = [];
const ok = (msg) => console.log("\x1b[32m✓\x1b[0m " + msg);
const fail = (msg) => { errors.push(msg); console.log("\x1b[31m✗\x1b[0m " + msg); };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const list = (dir, re) => fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).filter(f => re.test(f)).map(f => path.join(dir, f)) : [];

// Pages : racine (client, Beheer) + team/ (personnel) + beheer/ (connexion Beheer). URL propres (vercel.json cleanUrls).
const htmlPages = [...fs.readdirSync(ROOT).filter(f => f.endsWith(".html")), ...list("team", /\.html$/), ...list("beheer", /\.html$/)];
const jsFiles = [...list("api", /\.js$/), ...list("lib", /\.js$/), ...list("lib/beheer", /\.js$/), ...list("lib/commande", /\.js$/), ...list("lib/inbound", /\.js$/), ...list("assets", /\.js$/), ...list("assets/pages", /\.js$/), ...list("assets/pages/team", /\.js$/), ...list("assets/pages/beheer", /\.js$/), ...list("assets/docs", /\.js$/), ...list("scripts", /\.js$/)];

// 1. Syntaxe de tout le JS et des <script> inline.
let synErr = 0;
for (const f of jsFiles) { try { new vm.Script(read(f), { filename: f }); } catch (e) { synErr++; fail("Syntaxe " + f + " : " + e.message); } }
for (const f of htmlPages) { const html = read(f); const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi; let m; while ((m = re.exec(html))) { try { new vm.Script(m[1], { filename: f }); } catch (e) { synErr++; fail("Syntaxe inline " + f + " : " + e.message); } } }
if (!synErr) ok("Syntaxe : " + jsFiles.length + " fichiers JS + scripts inline de " + htmlPages.length + " pages");
// 1b. CSP stricte (vercel.json : script-src 'self', sans 'unsafe-inline') : un script inline ou
// un attribut on*= serait bloqué en production sans erreur visible en local.
let inl = 0;
for (const f of htmlPages) { const html = read(f); if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) { inl++; fail("Script inline ou attribut on*= dans " + f + " (bloqué par la CSP)"); } }
if (/script-src[^;"]*'unsafe-inline'/.test(read("vercel.json"))) { inl++; fail("vercel.json : 'unsafe-inline' de retour dans script-src"); }
if (!inl) ok("CSP : aucun script inline ni on*= dans les pages, script-src sans 'unsafe-inline'");

// 2. API : jamais de secret ni de code de secours en dur.
const apiFiles = list("api", /\.js$/);
let secret = 0;
for (const f of apiFiles) { const s = read(f); if (/famo2026|re_[A-Za-z0-9]{20,}|pat[A-Za-z0-9]{14}\.[a-f0-9]{16,}/.test(s)) { secret++; fail("Secret ou code de secours en dur dans " + f); } if (/STAFF_CODE\s*\|\|\s*["']/.test(s)) { secret++; fail("Fallback STAFF_CODE dans " + f); } }
if (!secret) ok("API : aucun secret, aucun code de secours");
const auth = read("lib/staffauth.js");
if (!/function staffOk\(req\)/.test(auth) || /legacyCode/.test(auth)) fail("lib/staffauth.js : staffOk(req) doit exister, sans legacyCode"); else ok("lib/staffauth.js : fail-closed");

// 3. Contrats d'URL figés (e-mails et liens profonds).
if (!read("api/order.js").includes("/team/bestelling?id=") || !read("api/staff.js").includes("/team/bestelling?id=")) fail("Les e-mails doivent lier /team/bestelling?id="); else ok("Lien e-mail /team/bestelling?id= conservé");
// Chaque rubrique compte ses propres échecs : le ✓ ne s'affiche que si elle n'en a produit aucun.
const failsSince = (n) => errors.length - n;
const linksStart = errors.length;
// Liens de page en URL propre (/team/magazijn) : la page existe (x.html ou x/index.html) et aucun lien interne
// ne garde l'extension .html (les anciennes adresses ne vivent plus que dans les redirections de vercel.json).
const pageOf = (u) => { const p = u.slice(1); return p === "" || fs.existsSync(path.join(ROOT, p + ".html")) || fs.existsSync(path.join(ROOT, p, "index.html")); };
const linkSources = [...htmlPages, "assets/ui.js", ...list("assets/pages", /\.js$/), ...list("assets/pages/team", /\.js$/), ...list("assets/pages/beheer", /\.js$/), ...list("api", /\.js$/), ...list("lib", /\.js$/).filter(f => f !== "lib/sql.js" /* « /sql » = API Neon, pas une page */), ...list("lib/beheer", /\.js$/), ...list("lib/commande", /\.js$/), ...list("lib/inbound", /\.js$/), "sw.js", "manifest.webmanifest"].filter(f => fs.existsSync(path.join(ROOT, f)));
let pageLinks = 0;
for (const f of linkSources) {
  const s = read(f), re = /(?:href="|["'`])(\/(?!api\/|assets\/|vendor\/)(?:[a-z0-9-]+\/)*[a-z0-9-]*(\.html)?)(?=[?#"'`])/g; let m;
  while ((m = re.exec(s))) { pageLinks++; if (m[2]) fail(f + " lie vers " + m[1] + " : utiliser l'URL propre, sans .html"); else if (!pageOf(m[1])) fail(f + " lie vers " + m[1] + " qui n'existe pas"); }
}
if (!failsSince(linksStart)) ok("Liens internes : " + pageLinks + " liens en URL propre, toutes les pages ciblées existent");

// 4. Interface : pas d'alert/confirm/prompt natifs, pas de code staff en storage ni en URL.
let ui = 0;
for (const f of [...list("assets/pages", /\.js$/), ...list("assets/pages/team", /\.js$/), ...list("assets/pages/beheer", /\.js$/), "assets/ui.js", ...htmlPages]) { const s = read(f); if (/(^|[^.\w])(alert|confirm|prompt)\(/.test(s.replace(/K\.(confirm|prompt)\(/g, ""))) { ui++; fail("Dialogue natif dans " + f); } if (/localStorage\.setItem\(["'][^"']*[Cc]ode/.test(s) || /[?&]code=/.test(s)) { ui++; fail("Code personnel en storage ou en URL dans " + f); } }
if (!ui) ok("Interface : dialogues maison, aucun code en storage/URL");

// 5. Néerlandais : aucune unité française affichée sans passer par K.unit.
let fr = 0;
for (const f of [...list("assets/pages", /\.js$/), ...list("assets/pages/team", /\.js$/), ...list("assets/pages/beheer", /\.js$/), "assets/ui.js", ...htmlPages]) { const s = read(f); if (/>\s*caisse\s*</i.test(s) || /"caisse"\s*\+/.test(s)) { fr++; fail("« caisse » affiché tel quel dans " + f); } }
if (!fr) ok("Néerlandais : unités traduites (caisse → kassa)");

// 6. Chaque page charge la couche partagée et une police avec repli.
const pagesStart = errors.length;
for (const f of htmlPages) { const html = read(f); if (/<meta http-equiv="refresh"/i.test(html)) continue; if (!html.includes("/assets/ui.css") || !html.includes("/assets/ui.js")) fail(f + " ne charge pas assets/ui.css + assets/ui.js"); if (!/viewport/.test(html)) fail(f + " sans meta viewport"); }
if (!failsSince(pagesStart)) ok("Pages : couche partagée + viewport");
// 6b. Styles en ligne (constitution I, spec 017) : un style="…" statique va dans assets/ui.css (utilitaires I-12).
// Restent permis : les valeurs calculées (concaténation ' + / " + : couleur, largeur…) et le plafond ci-dessous
// (verzamellijst = document autonome sans ui.css ; #fUitzNota / #vAdd et #otherDay pilotés par el.style dans le JS).
{
  const CEILING = 7, found = [];
  for (const f of [...htmlPages, "assets/ui.js", ...list("assets/pages", /\.js$/), ...list("assets/pages/team", /\.js$/), ...list("assets/pages/beheer", /\.js$/)]) {
    const re = /style=\\?"([^"\\]*)/g; let m; const s = read(f);
    while ((m = re.exec(s))) if (!/['"] \+/.test(m[1])) found.push(f + " : style=\"" + m[1] + "\"");
  }
  if (found.length > CEILING) fail("Styles en ligne statiques : " + found.length + " (plafond " + CEILING + ") — utiliser une classe de assets/ui.css :\n  " + found.join("\n  "));
  else ok("Styles en ligne statiques : " + found.length + " (plafond " + CEILING + ", valeurs calculées exclues)");
}

// 7. Tests unitaires (Node --test) s'il y en a.
{ const r = require("child_process").spawnSync(process.execPath, [path.join(ROOT, "scripts", "assets-version.js"), "--check"], { cwd: ROOT, encoding: "utf8" }); if (r.status !== 0) fail("Versions des fichiers statiques périmées : lancer node scripts/assets-version.js\n" + (r.stderr || "")); else ok("Versions des fichiers statiques (cache) à jour"); }
{ const r = require("child_process").spawnSync(process.execPath, [path.join(ROOT, "scripts", "contrast-check.js")], { cwd: ROOT, encoding: "utf8" }); if (r.status !== 0) fail("Contraste AA insuffisant (docs/CHECKLIST-UX.md ACC-05) :\n" + (r.stdout || "").split("\n").filter(l => l.startsWith("✗") || l.startsWith("?")).join("\n")); else ok("Contrastes AA des couleurs du thème (ACC-05)"); }
{ const r = require("child_process").spawnSync(process.execPath, [path.join(ROOT, "scripts", "security-check.js")], { cwd: ROOT, encoding: "utf8" }); if (r.status !== 0) fail("Beveiliging (specs/026) :\n" + (r.stderr || "")); else ok("En-têtes de sécurité et chemins internes (specs/026)"); }
if (fs.existsSync(path.join(ROOT, "test"))) { const r = require("child_process").spawnSync(process.execPath, ["--test", ...fs.readdirSync(path.join(ROOT, "test")).filter(f => f.endsWith(".test.js")).map(f => "test/" + f)], { cwd: ROOT, stdio: "inherit" }); if (r.status !== 0) fail("node --test a échoué"); else ok("Tests unitaires"); }

// 8. Scénarios métier (hérités de la v1, adaptés aux contrats frontend v2) : test/workflow/*.test.js,
// un fichier par domaine, lancés en parallèle par scripts/workflow-check.js (audit F-10).
const workflowFiles = list("test/workflow", /\.test\.js$/).length;
const workflow = childProcess.spawnSync(process.execPath, [path.join(__dirname, "workflow-check.js")], { cwd: ROOT, stdio: "inherit" });
if (workflow.status !== 0) fail("Scénarios métier critiques (test/workflow)"); else ok("Scénarios métier critiques (test/workflow : " + workflowFiles + " fichiers en parallèle)");

if (errors.length) { console.log("\n\x1b[31m" + errors.length + " problème(s).\x1b[0m"); process.exit(1); }
console.log("\n\x1b[32mTout est bon.\x1b[0m");
