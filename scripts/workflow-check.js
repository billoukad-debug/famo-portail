#!/usr/bin/env node
// Scénarios métier critiques, sans accès réseau réel (appels Airtable/Resend simulés).
//   node scripts/workflow-check.js            tous les domaines, en parallèle
//   node scripts/workflow-check.js facturation  un seul fichier (nom partiel)
//
// Point d'entrée de compatibilité (docs, habitudes, scripts/check.js) : depuis l'audit F-10
// (specs/011-workflow-check-decoupe), les scénarios vivent dans test/workflow/*.test.js, un
// fichier par domaine métier, aides communes dans test/workflow/_helpers.js. node --test lance
// chaque fichier dans son propre processus (fetch, process.env et cache de require isolés),
// plusieurs à la fois. Un ✔ par ancien bloc « ✓ », regroupés par domaine.
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIR = path.join("test", "workflow");
const wanted = process.argv.slice(2);
const files = fs.readdirSync(path.join(ROOT, DIR))
  .filter(f => f.endsWith(".test.js"))
  .filter(f => !wanted.length || wanted.some(w => f.includes(w)))
  .sort()
  .map(f => path.join(DIR, f));
if (!files.length) { console.error("Aucun fichier de scénarios dans " + DIR + (wanted.length ? " pour " + wanted.join(", ") : "")); process.exit(1); }

const r = childProcess.spawnSync(process.execPath, ["--test", "--test-reporter=spec", ...files], { cwd: ROOT, stdio: "inherit" });
if (r.error) { console.error(r.error.message); process.exit(1); }
process.exit(r.status === null ? 1 : r.status);
