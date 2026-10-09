"use strict";
// Contrôle de sécurité de la configuration de déploiement (specs/026, US3), sans réseau :
// en-têtes sur toutes les pages (CSP sans script inline ni eval, HSTS ≥ 1 an, nosniff, DENY, Referrer-Policy)
// et fichiers internes jamais servis (.vercelignore + redirections). Lancé par scripts/check.js et la CI.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

function run() {
  const problems = [];
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const all = (v.headers || []).find((h) => h.source === "/(.*)");
  const h = Object.fromEntries(((all && all.headers) || []).map((x) => [x.key.toLowerCase(), x.value]));
  const csp = h["content-security-policy"] || "";
  if (!csp) problems.push("Content-Security-Policy ontbreekt");
  if (/script-src[^;]*('unsafe-inline'|'unsafe-eval')/.test(csp)) problems.push("CSP laat inline-scripts of eval toe");
  if (!/frame-ancestors 'none'/.test(csp)) problems.push("CSP: frame-ancestors 'none' ontbreekt");
  if (!/object-src 'none'/.test(csp)) problems.push("CSP: object-src 'none' ontbreekt");
  const hsts = /max-age=(\d+)/.exec(h["strict-transport-security"] || "");
  if (!hsts || Number(hsts[1]) < 31536000) problems.push("HSTS ontbreekt of < 1 jaar");
  if (h["x-content-type-options"] !== "nosniff") problems.push("X-Content-Type-Options: nosniff ontbreekt");
  if (h["x-frame-options"] !== "DENY") problems.push("X-Frame-Options: DENY ontbreekt");
  if (!h["referrer-policy"]) problems.push("Referrer-Policy ontbreekt");
  const ignore = fs.readFileSync(path.join(ROOT, ".vercelignore"), "utf8").split("\n").map((l) => l.trim());
  for (const p of ["/.dev-data", ".env", "/scripts", "/test", "/docs", "/specs", "/.planning", "/.claude"]) if (!ignore.includes(p)) problems.push(".vercelignore: " + p + " ontbreekt");
  const redirected = new Set((v.redirects || []).map((r) => r.source));
  for (const p of ["/lib/:path*", "/.dev-data/:path*", "/scripts/:path*", "/test/:path*"]) if (!redirected.has(p)) problems.push("Niet afgeschermd: " + p);
  return { problems };
}
module.exports = { run };
if (require.main === module) {
  const { problems } = run();
  if (problems.length) { console.error(problems.map((p) => "✗ " + p).join("\n")); process.exit(1); }
  console.log("✓ Beveiligingsheaders en afgeschermde paden in orde");
}
