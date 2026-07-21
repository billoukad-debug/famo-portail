// Controle avant deploiement : attrape les erreurs de syntaxe et les variables
// non definies AVANT que le code ne parte en production.
// Lance en local avec :  node scripts/check.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const childProcess = require("child_process");

const root = path.join(__dirname, "..");
let errors = 0;

function fail(file, msg) {
  console.error(`\x1b[31m✗ ${file}\x1b[0m\n  ${msg}\n`);
  errors++;
}
function pass(file, note) {
  console.log(`\x1b[32m✓\x1b[0m ${file}${note ? "  " + note : ""}`);
}

// --- 1. Les fichiers API (Node) ---
const apiDir = path.join(root, "api");
if (fs.existsSync(apiDir)) {
  for (const f of fs.readdirSync(apiDir).filter(f => f.endsWith(".js"))) {
    const file = `api/${f}`;
    const src = fs.readFileSync(path.join(apiDir, f), "utf8");
    try {
      new vm.Script(src, { filename: file });
      pass(file);
    } catch (e) {
      fail(file, e.message);
    }
  }
}

// --- 2. Le JavaScript dans les pages HTML ---
for (const f of fs.readdirSync(root).filter(f => f.endsWith(".html"))) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  if (!blocks.length) { pass(f, "(pas de script)"); continue; }
  let ok = true;
  blocks.forEach((m, i) => {
    try {
      new vm.Script(m[1], { filename: `${f} (bloc ${i + 1})` });
    } catch (e) {
      fail(`${f} (bloc ${i + 1})`, e.message);
      ok = false;
    }
  });
  if (ok) pass(f, `(${blocks.length} bloc${blocks.length > 1 ? "s" : ""})`);

  // --- 3. Les fonctions appelees depuis onclick existent-elles ? ---
  const code = blocks.map(m => m[1]).join("\n");
  const declared = new Set();
  for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)) declared.add(m[1]);

  const called = new Set();
  for (const m of src.matchAll(/on(?:click|change|input|submit)\s*=\s*"([^"]*)"/gi)) {
    for (const c of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) called.add(c[1]);
  }
  const builtins = new Set(["alert","confirm","print","fetch","parseInt","parseFloat","String","Number","JSON","console","window","document","setTimeout","esc"]);
  const missing = [...called].filter(n => !declared.has(n) && !builtins.has(n));
  if (missing.length) fail(f, `Fonctions appelees dans le HTML mais jamais definies : ${missing.join(", ")}`);
}


// --- Regle XSS : toute page qui manipule innerHTML doit definir une fonction esc() ---
for (const f of fs.readdirSync(root).filter(f => f.endsWith(".html"))) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  if (src.includes("innerHTML") && !/(?:const|function)\s+esc\s*[=(]/.test(src)) {
    fail(f, "utilise innerHTML sans définir esc() — les valeurs Airtable doivent être échappées");
  }
}


// --- Regle navigation : interdiction de neutraliser un lien vers une page existante ---
for (const f of fs.readdirSync(root).filter(f => f.endsWith(".html"))) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  if (src.includes("Binnenkort beschikbaar")) {
    fail(f, "contient un lien neutralise 'Binnenkort beschikbaar' — restaurer le vrai lien");
  }
  for (const m of src.matchAll(/href="\/([\w-]+\.html)"/g)) {
    if (!fs.existsSync(path.join(root, m[1]))) {
      fail(f, `lien vers /${m[1]} mais le fichier n'existe pas dans le depot`);
    }
  }
}

console.log("");
if (errors) {
  console.error(`\x1b[31m${errors} probleme(s) detecte(s). Le deploiement est bloque.\x1b[0m`);
  process.exit(1);
}
try {
  childProcess.execFileSync(process.execPath, [path.join(__dirname, "workflow-check.js")], { stdio: "inherit" });
} catch (error) {
  console.error("\x1b[31m✗ Règles métier\x1b[0m\n  Les scénarios critiques ont échoué.\n");
  process.exit(1);
}
console.log("\x1b[32mTout est bon.\x1b[0m");
