#!/usr/bin/env node
"use strict";
// Versions des fichiers statiques (cache-busting), sans outil de build.
//
// Chaque <script src="/…"> et <link href="/assets/…"> des pages reçoit ?v=<empreinte du
// contenu>. vercel.json sert ces URL versionnées avec un cache d'un an (immutable) : un
// fichier modifié change d'empreinte, donc d'URL, et n'est jamais servi périmé.
// K.DOCS_VER (assets/ui.js) versionne de même le module documents chargé à la demande.
//
//   node scripts/assets-version.js          met à jour les fichiers
//   node scripts/assets-version.js --check  échoue si une version est périmée (check.js / CI)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const CHECK = process.argv.includes("--check");
const DOCS = ["staff-company.js", "documents.js", "staff-doc-preview.js"];
const hashOf = buf => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 10);
const read = rel => fs.readFileSync(path.join(ROOT, rel));

const stale = [];
function write(rel, next) {
  const cur = read(rel).toString("utf8");
  if (cur === next) return;
  stale.push(rel);
  if (!CHECK) fs.writeFileSync(path.join(ROOT, rel), next);
}

// 1. Version du module documents, écrite dans ui.js (avant l'empreinte de ui.js elle-même).
const docsVer = hashOf(Buffer.concat(DOCS.map(read)));
write("assets/ui.js", read("assets/ui.js").toString("utf8").replace(/K\.DOCS_VER = "[^"]*";/, `K.DOCS_VER = "${docsVer}";`));

// 2. Références dans les pages.
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html"));
const ref = /(<(?:script[^>]*\ssrc|link[^>]*\shref)=")(\/(?:assets\/[^"?]+|[a-z-]+\.js))(?:\?v=[0-9a-f]+)?(")/g;
for (const page of pages) {
  const html = read(page).toString("utf8");
  const next = html.replace(ref, (all, pre, url, post) => {
    const file = path.join(ROOT, url.slice(1));
    if (!fs.existsSync(file)) return all;
    const buf = CHECK && url === "/assets/ui.js" ? Buffer.from(read("assets/ui.js").toString("utf8").replace(/K\.DOCS_VER = "[^"]*";/, `K.DOCS_VER = "${docsVer}";`)) : fs.readFileSync(file);
    return pre + url + "?v=" + hashOf(buf) + post;
  });
  write(page, next);
}

if (CHECK && stale.length) {
  console.error("Versions périmées : " + stale.join(", ") + "\n→ lancer : node scripts/assets-version.js");
  process.exit(1);
}
if (!CHECK) console.log(stale.length ? "Mis à jour : " + stale.join(", ") : "Déjà à jour.");
