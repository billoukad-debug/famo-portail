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

const STAFF_PAGES = [
  "overzicht.html",
  "bestellingen.html",
  "order.html",
  "entrepot.html",
  "dagprep.html",
  "invoer.html",
  "stock.html",
  "documenten.html",
  "leveringen.html",
  "aan-de-slag.html"
];

const REDIRECT_PAGES = {
  "overzicht.html": "/bestellingen.html",
  "dagprep.html": "/entrepot.html"
};

function stripHtmlComments(src) {
  return String(src || "").replace(/<!--[\s\S]*?-->/g, "");
}

function isRedirectPage(page, src) {
  const target = REDIRECT_PAGES[page];
  if (!target) return false;
  const hasReplace = src.includes("location.replace") && src.includes(target);
  const hasRefresh = /http-equiv=["']refresh["']/i.test(src) && src.includes(target);
  return hasReplace || hasRefresh;
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

    // Fallback famo2026 uniquement autorisé dans lib/staffauth.js (demande produit temporaire).
    if (file !== "api/onboarding.js" && /\|\|\s*["']famo2026["']/.test(src)) {
      fail(file, 'contient un fallback || "famo2026" — uniquement autorisé via lib/staffauth.js');
    }
    if (/STAFF_CODE\s*=\s*process\.env\.STAFF_CODE\s*\|\|/.test(src)) {
      fail(file, "STAFF_CODE = process.env.STAFF_CODE || … dans api/ — utiliser lib/staffauth.js");
    }
    if (/(?:const|let|var)\s+STAFF_CODE\s*=\s*["'][^"']+["']/.test(src)) {
      fail(file, "STAFF_CODE assigné en dur — interdit");
    }
    if (/["']famo2026["']/.test(src) && !/reject|refuse|401|compromis|interdit|ancien|temporaire|TEMPORAIRE/i.test(src)) {
      if (/(?:=\s*|\|\|\s*)["']famo2026["']/.test(src)) {
        fail(file, "famo2026 utilisé comme valeur par défaut dans api/ — interdit (passer par staffauth)");
      }
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


// --- Interdits : dialogues natifs et secret staff dans le stockage navigateur ---
for (const f of fs.readdirSync(root).filter(f => f.endsWith(".html"))) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  for (const bad of ["alert(", "confirm(", "prompt("]) {
    // autorise nlConfirm( / showConfirm( etc. : on ne matche que l'appel natif
    const re = new RegExp("(?<![\\w$])" + bad.replace("(", "\\("), "g");
    if (re.test(src)) fail(f, "utilise le dialogue natif " + bad + ") — utiliser modale/toast");
  }
  if (/localStorage\.setItem\((["'])famoStaffCode\1/.test(src)) {
    fail(f, "stocke le code staff dans localStorage — interdit");
  }
  if (/sessionStorage\.setItem\((["'])famoStaffCode\1/.test(src)) {
    fail(f, 'sessionStorage.setItem("famoStaffCode"…) — interdit');
  }
  if (/sessionStorage\.getItem\((["'])famoStaffCode\1/.test(src)) {
    fail(f, 'sessionStorage.getItem("famoStaffCode"…) — interdit');
  }
}

// --- Interdit : code staff dans les query strings (?code= / &code= / code="+…) ---
for (const f of fs.readdirSync(root).filter(f => f.endsWith(".html"))) {
  const src = stripHtmlComments(fs.readFileSync(path.join(root, f), "utf8"));
  if (/\?code=/.test(src) || /&code=/.test(src)) {
    fail(f, "URL API avec ?code= ou &code= — utiliser la session cookie, pas le code en query");
  }
  // motifs type /api/...?code= + encodeURIComponent(code) ou code="+…
  if (/code=["']\s*\+|code=\s*"\s*\+|code=\s*'\s*\+|code="\s*\+\s*encodeURIComponent|code='\s*\+\s*encodeURIComponent/.test(src)) {
    fail(f, 'pattern code="+ / code="+encodeURIComponent — interdit');
  }
  if (/\/api\/[^\s"'`]*\bcode=/.test(src)) {
    fail(f, "appel /api/… avec code= en query — interdit");
  }
}

// --- Pages staff listées doivent exister ---
for (const page of STAFF_PAGES) {
  if (!fs.existsSync(path.join(root, page))) {
    fail(page, "page staff manquante dans le dépôt");
  } else {
    pass(page, "(présent)");
  }
}

// --- Redirect pages (overzicht → bestellingen, dagprep → entrepot) ---
for (const [page, target] of Object.entries(REDIRECT_PAGES)) {
  const full = path.join(root, page);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, "utf8");
  if (!isRedirectPage(page, src)) {
    fail(page, `doit être une page de redirection vers ${target} (location.replace ou meta refresh)`);
  } else {
    pass(page, `(redirect → ${target})`);
  }
}

// --- Scripts staff communs + aria-current / data-famo-nav ---
for (const page of STAFF_PAGES) {
  const full = path.join(root, page);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, "utf8");
  if (REDIRECT_PAGES[page] && isRedirectPage(page, src)) {
    pass(page, "(redirect — scripts staff non requis)");
    continue;
  }
  for (const script of ["/staff-i18n.js", "/staff-session.js", "/staff-nav.js"]) {
    if (!src.includes(script)) {
      fail(page, `doit inclure <script src="${script}">`);
    }
  }
  if (!src.includes("aria-current") && !src.includes("data-famo-nav")) {
    fail(page, "doit contenir aria-current ou data-famo-nav (staff-nav.js)");
  }
}

// --- Staff nav PRIMARY : pas Overzicht / Dagvoorbereiding ---
{
  const navPath = path.join(root, "staff-nav.js");
  if (fs.existsSync(navPath)) {
    const navSrc = fs.readFileSync(navPath, "utf8");
    const sandbox = {
      window: {},
      global: {},
      document: { readyState: "complete", querySelectorAll: () => [], addEventListener: () => {} },
      location: { pathname: "/bestellingen.html" },
      console
    };
    sandbox.global = sandbox;
    try {
      new vm.Script(navSrc, { filename: "staff-nav.js" }).runInNewContext(sandbox);
      const famoNav = sandbox.window.famoNav || sandbox.global.famoNav;
      const labels = (famoNav.PRIMARY || []).map(i => i.label);
      const meerLabels = (famoNav.MEER || []).map(i => i.label);
      if (labels.includes("Overzicht")) fail("staff-nav.js", "PRIMARY ne doit pas lister Overzicht");
      if (labels.includes("Dagvoorbereiding")) fail("staff-nav.js", "PRIMARY ne doit pas lister Dagvoorbereiding");
      if (labels.includes("Aan de slag")) fail("staff-nav.js", "PRIMARY ne doit pas lister Aan de slag");
      if (labels.length !== 4) fail("staff-nav.js", "PRIMARY doit contenir exactement 4 items");
      const expected = ["Bestellingen", "Magazijn", "Invoeren", "Leveringen"];
      if (expected.some((l, i) => labels[i] !== l)) {
        fail("staff-nav.js", "PRIMARY attendu: " + expected.join(" | ") + " — reçu: " + labels.join(" | "));
      } else if (!meerLabels.includes("Voorraad") || !meerLabels.includes("Documenten")) {
        fail("staff-nav.js", "MEER doit contenir Voorraad et Documenten");
      } else if (!famoNav.SETUP || famoNav.SETUP.label !== "Aan de slag") {
        fail("staff-nav.js", "SETUP footer Aan de slag manquant");
      } else {
        pass("staff-nav.js", "PRIMARY 4+Meer + setup footer");
      }
    } catch (e) {
      fail("staff-nav.js", e.message);
    }
  }
}

// --- Interdit : warehouse-sidebar / warehouse-mobilebar / warehouse.css ---
for (const f of fs.readdirSync(root).filter(f => f.endsWith(".html"))) {
  const src = stripHtmlComments(fs.readFileSync(path.join(root, f), "utf8"));
  if (/\bwarehouse-sidebar\b/.test(src)) {
    fail(f, "contient warehouse-sidebar — utiliser staff-shell / data-famo-nav");
  }
  if (/\bwarehouse-mobilebar\b/.test(src)) {
    fail(f, "contient warehouse-mobilebar — utiliser staff-mobile-nav");
  }
  if (/warehouse\.css/.test(src)) {
    fail(f, "référence warehouse.css — utiliser staff.css uniquement");
  }
}
if (fs.existsSync(path.join(root, "warehouse.css"))) {
  fail("warehouse.css", "fichier legacy encore présent — absorber dans staff.css puis supprimer");
} else {
  pass("warehouse.css", "(absent)");
}

// --- Interdit : login CSS legacy par page ---
const LEGACY_LOGIN = /\b(l-login|d-login|o-login|s-login|prep-login|dash-login)\b/;
for (const page of STAFF_PAGES) {
  const full = path.join(root, page);
  if (!fs.existsSync(full)) continue;
  const src = stripHtmlComments(fs.readFileSync(full, "utf8"));
  if (REDIRECT_PAGES[page] && isRedirectPage(page, src)) continue;
  if (LEGACY_LOGIN.test(src)) {
    fail(page, "login legacy (l-/d-/o-/s-/prep-/dash-login) — utiliser .staff-login + bindLogin");
  }
}

// --- Pages opérationnelles : staff-login + staff-shell ---
const OPERATIONAL = [
  "bestellingen.html",
  "order.html",
  "entrepot.html",
  "invoer.html",
  "stock.html",
  "documenten.html",
  "leveringen.html"
];
for (const page of OPERATIONAL) {
  const full = path.join(root, page);
  if (!fs.existsSync(full)) continue;
  const src = stripHtmlComments(fs.readFileSync(full, "utf8"));
  if (!/\bstaff-login\b/.test(src)) fail(page, "doit utiliser .staff-login");
  if (!/\bstaff-shell\b/.test(src)) fail(page, "doit utiliser .staff-shell");
  if (!/bindLogin\s*\(/.test(src)) {
    fail(page, "doit appeler famoStaff.bindLogin(...)");
  }
}

// --- Sheet livraison partagé ---
{
  const delPath = path.join(root, "staff-delivery.js");
  if (!fs.existsSync(delPath)) {
    fail("staff-delivery.js", "module partagé manquant");
  } else {
    const src = fs.readFileSync(delPath, "utf8");
    try {
      new vm.Script(src, { filename: "staff-delivery.js" });
      if (!/openDeliveryConfirm/.test(src)) fail("staff-delivery.js", "doit exposer openDeliveryConfirm");
      else pass("staff-delivery.js", "openDeliveryConfirm");
    } catch (e) {
      fail("staff-delivery.js", e.message);
    }
  }
  for (const page of ["leveringen.html", "order.html"]) {
    const src = fs.readFileSync(path.join(root, page), "utf8");
    if (!src.includes("/staff-delivery.js")) fail(page, "doit inclure staff-delivery.js");
    if (!/openDeliveryConfirm/.test(src)) fail(page, "doit appeler openDeliveryConfirm");
  }
}

// --- Preview documentaire partagée (pas de window.open / print hors composant) ---
{
  const previewPath = path.join(root, "staff-doc-preview.js");
  const vendorPath = path.join(root, "vendor", "html2pdf.bundle.min.js");
  if (!fs.existsSync(previewPath)) {
    fail("staff-doc-preview.js", "composant preview manquant");
  } else {
    const src = fs.readFileSync(previewPath, "utf8");
    try {
      new vm.Script(src, { filename: "staff-doc-preview.js" });
      const sandbox = { window: {}, global: {}, document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, querySelector() { return null; }, addEventListener() {} }), body: { appendChild() {} }, head: { appendChild() {} }, addEventListener() {}, removeEventListener() {} }, location: { pathname: "/documenten.html" }, console };
      sandbox.global = sandbox;
      sandbox.window = sandbox;
      new vm.Script(src, { filename: "staff-doc-preview.js" }).runInNewContext(sandbox);
      const api = sandbox.window.famoDocPreview || sandbox.global.famoDocPreview;
      if (!api || typeof api.open !== "function" || typeof api.downloadPdf !== "function" || typeof api.print !== "function") {
        fail("staff-doc-preview.js", "doit exposer open / print / downloadPdf");
      } else {
        const lb = api.filenameFor("delivery", { ref: "CMD-123" });
        const fa = api.filenameFor("invoice", { number: "FA-9" });
        const pk = api.filenameFor("picking", { date: "2026-07-23" });
        if (lb !== "Famo-Leveringsbon-CMD-123.pdf") fail("staff-doc-preview.js", "filename leveringsbon incorrect: " + lb);
        else if (fa !== "Famo-Factuur-FA-9.pdf") fail("staff-doc-preview.js", "filename factuur incorrect: " + fa);
        else if (pk !== "Famo-Picking-2026-07-23.pdf") fail("staff-doc-preview.js", "filename picking incorrect: " + pk);
        else if (!/blobLooksLikePdf|%PDF|0x25/.test(src)) fail("staff-doc-preview.js", "doit vérifier la magie %PDF (pas de HTML renommé)");
        else pass("staff-doc-preview.js", "preview + PDF filenames");
      }
    } catch (e) {
      fail("staff-doc-preview.js", e.message);
    }
  }
  if (!fs.existsSync(vendorPath)) {
    fail("vendor/html2pdf.bundle.min.js", "bibliothèque PDF manquante");
  } else {
    pass("vendor/html2pdf.bundle.min.js", "(présent)");
  }
  for (const page of ["documenten.html", "entrepot.html"]) {
    const src = stripHtmlComments(fs.readFileSync(path.join(root, page), "utf8"));
    if (!src.includes("/staff-doc-preview.js")) fail(page, "doit inclure staff-doc-preview.js");
    if (!/famoDocPreview\.open\s*\(/.test(src)) fail(page, "doit ouvrir les documents via famoDocPreview.open");
  }
  for (const f of fs.readdirSync(root).filter(x => x.endsWith(".html"))) {
    if (f === "index.html") continue; // portail client hors scope
    const src = stripHtmlComments(fs.readFileSync(path.join(root, f), "utf8"));
    if (REDIRECT_PAGES[f] && isRedirectPage(f, src)) continue;
    if (/\bwindow\.open\s*\(/.test(src)) {
      fail(f, "window.open interdit hors portail client — utiliser famoDocPreview");
    }
    if (/\bwindow\.print\s*\(/.test(src)) {
      fail(f, "window.print interdit — utiliser famoDocPreview.print");
    }
    if (/\.contentWindow\.print\s*\(/.test(src)) {
      fail(f, "contentWindow.print interdit hors staff-doc-preview.js");
    }
  }
}

// --- Affichage FR "caisse" sans famoNL ---
for (const f of fs.readdirSync(root).filter(f => f.endsWith(".html"))) {
  const src = stripHtmlComments(fs.readFileSync(path.join(root, f), "utf8"));
  if (/>caisse</i.test(src)) {
    fail(f, "texte visible >caisse< — passer par famoNL.unit / famoNL.lines (afficher « kassa »)");
  }
}
{
  const guide = path.join(root, "aan-de-slag.html");
  if (fs.existsSync(guide)) {
    const src = stripHtmlComments(fs.readFileSync(guide, "utf8"));
    // chaîne UI littérale "caisse" (unité d'affichage) — autoriser uniquement via famoNL
    if (/["']caisse["']/.test(src) && !/famoNL\.unit\s*\(\s*["']caisse["']\s*\)/.test(src)) {
      fail("aan-de-slag.html", 'unité d\'affichage "caisse" — utiliser famoNL (kassa), pas le français brut');
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
