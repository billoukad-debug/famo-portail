"use strict";
// Snelle controle vóór een deploy: syntaxis van alle JS (server én browser),
// geen Franse eenheden in gebruikersteksten, en de tests.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
let bad = 0;
function walk(dir, out) { fs.readdirSync(dir).forEach((f) => { const p = path.join(dir, f); if (/node_modules|\.git|\.dev-data/.test(p)) return; if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p); }); return out; }
const files = walk(ROOT, []);
for (const f of files.filter((x) => x.endsWith(".js"))) {
  const src = fs.readFileSync(f, "utf8");
  try { new vm.Script(src, { filename: f }); } catch (e) { bad++; console.error("SYNTAX", path.relative(ROOT, f), e.message); }
}
for (const f of files.filter((x) => x.endsWith(".html"))) {
  const src = fs.readFileSync(f, "utf8");
  const scripts = src.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g) || [];
  scripts.forEach((s, i) => { const code = s.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""); try { new vm.Script(code, { filename: f + "#" + i }); } catch (e) { bad++; console.error("SYNTAX", path.relative(ROOT, f), "script", i, e.message); } });
}
// Gebruikerstaal: geen 'kassa' als eenheid, geen Frans in browser-JS/HTML-strings.
for (const f of files.filter((x) => /assets\/.*\.js$|\.html$/.test(x))) {
  const src = fs.readFileSync(f, "utf8");
  if (/\bkassa\b/i.test(src)) { bad++; console.error("TAAL", path.relative(ROOT, f), "bevat 'kassa'"); }
}
if (bad) { console.error(bad + " probleem(en)."); process.exit(1); }
console.log("Syntaxis in orde (" + files.filter((x) => /\.(js|html)$/.test(x)).length + " bestanden). Tests draaien…");
execSync("node --test test/*.test.js", { cwd: ROOT, stdio: "inherit" });
