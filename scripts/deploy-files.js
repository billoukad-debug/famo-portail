"use strict";
// Bouwt de bestandslijst voor een handmatige Vercel-deploy (MCP deploy_to_vercel):
// enkel wat in productie nodig is. Schrijft .dev-data/deploy.json.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const INCLUDE = [/^api\//, /^lib\//, /^assets\//, /^[^/]+\.html$/, /^vercel\.json$/, /^package\.json$/, /^README\.md$/, /^robots\.txt$/];
function walk(dir, out) {
  fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    const rel = path.relative(ROOT, p).split(path.sep).join("/");
    if (/^(\.git|\.claude|\.dev-data|node_modules|scripts|test|docs)(\/|$)/.test(rel)) return;
    if (fs.statSync(p).isDirectory()) return walk(p, out);
    if (INCLUDE.some((re) => re.test(rel))) out.push({ file: rel, data: fs.readFileSync(p, "utf8") });
  });
  return out;
}
const files = walk(ROOT, []).sort((a, b) => a.file.localeCompare(b.file));
fs.mkdirSync(path.join(ROOT, ".dev-data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".dev-data", "deploy.json"), JSON.stringify(files));
console.log(files.length + " bestanden, " + Math.round(JSON.stringify(files).length / 1024) + " KB");
files.forEach((f) => console.log("  " + f.file + " (" + f.data.length + ")"));
