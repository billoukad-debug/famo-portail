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

const htmlPages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html"));
const jsFiles = [...list("api", /\.js$/), ...list("lib", /\.js$/), ...list("assets", /\.js$/), ...list("assets/pages", /\.js$/), "documents.js", "staff-doc-preview.js", "staff-company.js", ...list("scripts", /\.js$/)];

// 1. Syntaxe de tout le JS et des <script> inline.
let synErr = 0;
for (const f of jsFiles) { try { new vm.Script(read(f), { filename: f }); } catch (e) { synErr++; fail("Syntaxe " + f + " : " + e.message); } }
for (const f of htmlPages) { const html = read(f); const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi; let m; while ((m = re.exec(html))) { try { new vm.Script(m[1], { filename: f }); } catch (e) { synErr++; fail("Syntaxe inline " + f + " : " + e.message); } } }
if (!synErr) ok("Syntaxe : " + jsFiles.length + " fichiers JS + scripts inline de " + htmlPages.length + " pages");

// 2. API : jamais de secret ni de code de secours en dur.
const apiFiles = list("api", /\.js$/);
let secret = 0;
for (const f of apiFiles) { const s = read(f); if (/famo2026|re_[A-Za-z0-9]{20,}|pat[A-Za-z0-9]{14}\.[a-f0-9]{16,}/.test(s)) { secret++; fail("Secret ou code de secours en dur dans " + f); } if (/STAFF_CODE\s*\|\|\s*["']/.test(s)) { secret++; fail("Fallback STAFF_CODE dans " + f); } }
if (!secret) ok("API : aucun secret, aucun code de secours");
const auth = read("lib/staffauth.js");
if (!/function staffOk\(req\)/.test(auth) || /legacyCode/.test(auth)) fail("lib/staffauth.js : staffOk(req) doit exister, sans legacyCode"); else ok("lib/staffauth.js : fail-closed");

// 3. Contrats d'URL figés (e-mails et liens profonds).
if (!read("api/order.js").includes("/order.html?id=") || !read("api/staff.js").includes("/order.html?id=")) fail("Les e-mails doivent lier /order.html?id="); else ok("Lien e-mail /order.html?id= conservé");
for (const f of htmlPages) { const html = read(f); const re = /href="\/([a-z0-9\-]+\.html)/g; let m; while ((m = re.exec(html))) { if (!fs.existsSync(path.join(ROOT, m[1]))) fail(f + " lie vers /" + m[1] + " qui n'existe pas"); } }
for (const f of list("assets/pages", /\.js$/)) { const s = read(f); const re = /["'`]\/([a-z0-9\-]+\.html)/g; let m; while ((m = re.exec(s))) { if (!fs.existsSync(path.join(ROOT, m[1]))) fail(f + " lie vers /" + m[1] + " qui n'existe pas"); } }
ok("Liens internes : toutes les pages ciblées existent");

// 4. Interface : pas d'alert/confirm/prompt natifs, pas de code staff en storage ni en URL.
let ui = 0;
for (const f of [...list("assets/pages", /\.js$/), "assets/ui.js", ...htmlPages]) { const s = read(f); if (/(^|[^.\w])(alert|confirm|prompt)\(/.test(s.replace(/K\.(confirm|prompt)\(/g, ""))) { ui++; fail("Dialogue natif dans " + f); } if (/localStorage\.setItem\(["'][^"']*[Cc]ode/.test(s) || /[?&]code=/.test(s)) { ui++; fail("Code personnel en storage ou en URL dans " + f); } }
if (!ui) ok("Interface : dialogues maison, aucun code en storage/URL");

// 5. Néerlandais : aucune unité française affichée sans passer par K.unit.
let fr = 0;
for (const f of [...list("assets/pages", /\.js$/), "assets/ui.js", ...htmlPages]) { const s = read(f); if (/>\s*caisse\s*</i.test(s) || /"caisse"\s*\+/.test(s)) { fr++; fail("« caisse » affiché tel quel dans " + f); } }
if (!fr) ok("Néerlandais : unités traduites (caisse → kassa)");

// 6. Chaque page charge la couche partagée et une police avec repli.
for (const f of htmlPages) { const html = read(f); if (/<meta http-equiv="refresh"/i.test(html)) continue; if (!html.includes("/assets/ui.css") || !html.includes("/assets/ui.js")) fail(f + " ne charge pas assets/ui.css + assets/ui.js"); if (!/viewport/.test(html)) fail(f + " sans meta viewport"); }
ok("Pages : couche partagée + viewport");

// 7. Tests unitaires (Node --test) s'il y en a.
{ const r = require("child_process").spawnSync(process.execPath, [path.join(ROOT, "scripts", "assets-version.js"), "--check"], { cwd: ROOT, encoding: "utf8" }); if (r.status !== 0) fail("Versions des fichiers statiques périmées : lancer node scripts/assets-version.js\n" + (r.stderr || "")); else ok("Versions des fichiers statiques (cache) à jour"); }
if (fs.existsSync(path.join(ROOT, "test"))) { const r = require("child_process").spawnSync(process.execPath, ["--test", ...fs.readdirSync(path.join(ROOT, "test")).filter(f => f.endsWith(".test.js")).map(f => "test/" + f)], { cwd: ROOT, stdio: "inherit" }); if (r.status !== 0) fail("node --test a échoué"); else ok("Tests unitaires"); }

// 8. Scénarios métier hérités de la v1, adaptés aux contrats frontend v2.
const workflow = childProcess.spawnSync(process.execPath, [path.join(__dirname, "workflow-check.js")], { cwd: ROOT, stdio: "inherit" });
if (workflow.status !== 0) fail("Scénarios métier critiques"); else ok("Scénarios métier critiques");

if (errors.length) { console.log("\n\x1b[31m" + errors.length + " problème(s).\x1b[0m"); process.exit(1); }
console.log("\n\x1b[32mTout est bon.\x1b[0m");
