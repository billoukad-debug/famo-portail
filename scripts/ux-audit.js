#!/usr/bin/env node
"use strict";
/* global document, getComputedStyle, matchMedia, innerWidth, location, localStorage, sessionStorage */
// Contrôles automatiques de docs/CHECKLIST-UX.md sur toutes les pages, à 1280 px et 390 px (tactile) :
// FOR-01 libellés · ACC-02 noms accessibles · ACC-03 alt · ACC-04 h1 / lien d'évitement / titre / lang ·
// INT-01 pas de <a href="#"> ni de onclick hors bouton · INT-03 cibles 24 px, 44 px au tactile (hauteur ET
// largeur, champs texte et nombre compris) · MEP-04 pas de défilement horizontal · CLA-01 cliquable hors clavier ·
// CLA-02 anneau de focus visible sur chaque élément atteignable au Tab · ACC-05 contraste RENDU (texte 4,5:1,
// grand texte 3:1, contour des champs 3:1 — les couleurs réelles à l'écran, opacités comprises) ·
// ACC-06 état « choisi » (.on) exposé (aria-pressed / aria-current / aria-selected / aria-expanded).
// États visités en plus des pages : fiche commande (team/bestelling.html), Journaal, Magazijn Bord, confirmation de
// commande, panier rempli, panneaux ouverts (Valideren, Leveruur, fiche client, produit), Leveringen en mode
// Chauffeur, l'aperçu d'un document, la galerie photo d'un produit (client) et la gestion des photos (Beheer, spec 018).
//
//   node scripts/dev.js            (autre terminal : portail de dev + données de test)
//   node scripts/ux-audit.js       (BASE=http://localhost:4200 par défaut ; sortie 1 s'il y a un écart)
// Playwright n'est pas une dépendance du dépôt : il est pris dans l'installation globale.
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const B = process.env.BASE || "http://localhost:4200";
const EXE = process.env.CHROMIUM || (require("fs").existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
// Un écran = une URL, ou { url, name, before(page), after(page) } : before avant l'ouverture, after pour ouvrir un panneau.
const firstOrder = async p => p.evaluate(() => fetch("/api/allorders", { credentials: "include" }).then(r => r.json()).then(d => { const o = (d.orders || []).find(x => x.statut === "Facturée") || (d.orders || [])[0]; return o ? o.id : ""; }));
const clickAndWait = (sel, ms) => async p => { const el = p.locator(sel).first(); if (await el.count()) { await el.click(); await p.waitForTimeout(ms || 800); } };
const pages = {
  staff: ["/team/bestellingen#/tabel", "/team/bestellingen#/bord", "/team/bestellingen#/kalender", "/team/magazijn#/dag", "/team/magazijn#/bord", "/team/leveringen",
    { name: "/team/leveringen (mode Chauffeur)", url: "/team/leveringen", before: async p => { await p.evaluate(() => localStorage.setItem("famoLevMode", JSON.stringify("chauffeur"))); }, after: async p => { await p.evaluate(() => localStorage.removeItem("famoLevMode")); } },
    "/team/documenten",
    { name: "/team/bestelling (fiche commande)", url: async p => "/team/bestelling?id=" + encodeURIComponent(await firstOrder(p)) },
    { name: "/team/bestelling · panneau Leveruur", url: async p => "/team/bestelling?id=" + encodeURIComponent(await p.evaluate(() => fetch("/api/allorders", { credentials: "include" }).then(r => r.json()).then(d => ((d.orders || []).find(x => x.statut === "Prête") || {}).id || ""))), after: clickAndWait('[data-act="slot"]', 700) },
    { name: "/team/bestellingen · panneau Artikelen valideren", url: "/team/bestellingen#/tabel", after: clickAndWait('[data-act="validate"]', 700) },
    { name: "/team/documenten · aperçu d'un document", url: "/team/documenten", after: clickAndWait('[data-act="invoice"], [data-act="delivery"]', 2500) }],
  admin: ["/beheer#/overzicht", "/beheer#/aanvragen", "/beheer#/klanten", "/beheer#/producten", "/beheer#/prijzen", "/beheer#/rapportage", "/beheer#/journaal", "/beheer#/bedrijf", "/beheer#/toegang", "/beheer#/status", "/team/invoeren", "/team/voorraad",
    { name: "/beheer#/klanten · panneau klant", url: "/beheer#/klanten", after: clickAndWait("[data-edit]", 700) },
    { name: "/beheer#/producten · panneau product", url: "/beheer#/producten", after: clickAndWait("[data-new-product]", 700) },
    { name: "/beheer#/producten · foto's van een product", url: "/beheer#/producten", after: clickAndWait("tr[data-p]:has(img.pthumb)", 900) }],
  klant: ["/klant#/catalogus",
    { name: "/klant#/catalogus · galerij van een product", url: "/klant#/catalogus", after: clickAndWait(".prod:has(img.pthumb) .pr-x", 900) }, "/klant#/winkelmand", "/klant#/bestellingen", "/klant#/favorieten", "/klant#/account",
    { name: "/klant#/winkelmand (rempli)", url: "/klant#/winkelmand", before: async p => { await p.evaluate(() => { const c = JSON.parse(sessionStorage.getItem("famoKlantCatalogus") || "{}"); const items = {}; (c.products || []).slice(0, 3).forEach(x => { items[x.id] = 2; }); localStorage.setItem("famoCart:aloha", JSON.stringify({ items, comments: {}, note: "", day: "" })); }); } },
    { name: "/klant#/bevestigd (commande reçue)", url: "/klant#/bevestigd", before: async p => { await p.evaluate(() => sessionStorage.setItem("famoLastOrder", JSON.stringify({ ref: "CMD-TEST", total: 42, day: new Date(Date.now() + 864e5).toISOString().slice(0, 10), items: [{ nom: "Test", qty: 2, prix: 21 }], at: Date.now(), mail: { customer: { ok: true } }, email: "test@example.com" }))); } },
    { name: "/klant#/bestellingen · fiche commande", url: "/klant#/bestellingen", after: async p => { await clickAndWait('[data-of="alles"]', 300)(p); await clickAndWait(".orow-main", 600)(p); } }],
  public: ["/", "/aanvraag", "/wachtwoord", "/team/aanmelden", "/beheer/aanmelden"] };

// ---------- contrôles dans la page ----------
function audit() {
  const vis = e => { const s = getComputedStyle(e); const rc = e.getBoundingClientRect(); return rc.width > 0 && rc.height > 0 && s.visibility !== "hidden"; };
  const name = e => (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") && document.getElementById(e.getAttribute("aria-labelledby"))?.textContent || e.textContent || (e.labels && [...e.labels].map(l => l.textContent).join(" ")) || e.getAttribute("title") || "").trim();
  const out = [];
  // Dans une fenêtre ouverte (panneau, dialogue, aperçu) : seul son contenu compte (le reste est inerte).
  const top = [...document.querySelectorAll("[aria-modal=true]")].filter(vis).pop() || document;
  const inScope = e => top === document || top.contains(e);
  document.querySelectorAll("input:not([type=hidden]):not([hidden]),select,textarea").forEach(e => { if (!vis(e) || !inScope(e)) return; if (!(e.labels && e.labels.length) && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby")) out.push(["FOR-01 champ sans libellé", (e.id || e.name || e.placeholder || e.outerHTML.slice(0, 60))]); });
  document.querySelectorAll("button,a[href],iframe").forEach(e => { if (!vis(e) || !inScope(e)) return; if (!name(e)) out.push(["ACC-02 sans nom accessible", e.outerHTML.slice(0, 80)]); });
  document.querySelectorAll("img").forEach(e => { if (!e.hasAttribute("alt")) out.push(["ACC-03 img sans alt", e.src.slice(-40)]); });
  const h1 = [...document.querySelectorAll("h1")].filter(vis).length; if (h1 !== 1) out.push(["ACC-04 nombre de h1", String(h1)]);
  if (!document.querySelector(".skip") && document.querySelector("nav,.side,.mtabs")) out.push(["ACC-04 pas de lien d'évitement", location.pathname]);
  if (!document.querySelector("main,[role=main]")) out.push(["ACC-04 pas de <main>", location.pathname]);
  if (!document.title.trim()) out.push(["ACC-04 titre vide", location.pathname]);
  if (!document.documentElement.lang) out.push(["ACC-04 lang absent", location.pathname]);
  // INT-03 : 24 px partout ; au tactile 44 px en hauteur ET en largeur, champs texte et nombre compris.
  const touch = matchMedia("(pointer: coarse)").matches, min = touch ? 44 : 24;
  document.querySelectorAll("button,a[href],input:not([type=hidden]),select,textarea,[role=button]").forEach(e => {
    if (!vis(e) || !inScope(e) || e.closest("[data-ux-exempt]") || e.closest("[aria-hidden=\"true\"]")) return; // data-ux-exempt : exception documentée dans la checklist ; aria-hidden : hors de l'arbre (champ piège anti-robot hors écran)
    // Un champ enveloppé dans son <label> (.search) : toute la boîte du label le focalise, c'est elle la cible.
    const wrap = /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) && e.closest("label"), rc = wrap ? wrap.getBoundingClientRect() : e.getBoundingClientRect();
    const inline = e.tagName === "A" && getComputedStyle(e).display === "inline" && e.parentElement && /\S/.test(e.parentElement.textContent.replace(e.textContent, ""));
    if (inline) return; // WCAG 2.5.8 : lien dans une phrase exempté
    if (e.closest(".stepper") && e.tagName === "INPUT" && rc.height >= min - 2.5) return; // le champ du stepper est entouré de la bordure (44 px) du stepper
    if (rc.height < min - 0.5 || rc.width < min - 0.5) out.push(["INT-03 cible < " + min + "px", (name(e) || e.id || e.className).slice(0, 40) + " " + Math.round(rc.width) + "×" + Math.round(rc.height)]);
  });
  // CLA-01 : tout ce qui a l'air cliquable (curseur main) doit être atteignable au clavier.
  document.querySelectorAll("body *").forEach(e => {
    if (!vis(e) || getComputedStyle(e).cursor !== "pointer") return;
    if (e.matches("a[href],button,input,select,textarea,label,summary,[tabindex]") || e.closest("a[href],button,label,summary,[tabindex]:not([tabindex='-1'])")) return;
    if (e.querySelector("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])")) return; // une commande clavier existe dans la zone
    if (e.parentElement && getComputedStyle(e.parentElement).cursor === "pointer") return; // déjà signalé au niveau du parent
    out.push(["CLA-01 cliquable hors clavier", (e.className || e.tagName) + " " + (e.textContent || "").trim().slice(0, 30)]);
  });
  // INT-01 / 4.1.2 : pas de commande dans une commande.
  document.querySelectorAll("a[href] button, a[href] a[href], button button, button a[href]").forEach(e => out.push(["INT-01 élément interactif imbriqué", (name(e) || e.className).slice(0, 40)]));
  document.querySelectorAll('a[href="#"]').forEach(e => out.push(["INT-01 lien href=#", e.outerHTML.slice(0, 80)]));
  document.querySelectorAll("[onclick]").forEach(e => { if (!/^(BUTTON|A|INPUT)$/.test(e.tagName)) out.push(["INT-01 onclick sur " + e.tagName, e.outerHTML.slice(0, 60)]); });
  // ACC-06 : un choix, un filtre, un onglet « .on » dit qu'il est choisi.
  document.querySelectorAll("button.on, a.on, [role=tab].on").forEach(e => { if (!vis(e) || e.matches(".check,.toggle,.fav,.gs-item")) return; if (!["aria-pressed", "aria-current", "aria-selected", "aria-expanded", "aria-checked"].some(a => e.getAttribute(a) && e.getAttribute(a) !== "false")) out.push(["ACC-06 .on sans état ARIA", (name(e) || e.className).slice(0, 40)]); });
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(["MEP-04 défilement horizontal", String(document.documentElement.scrollWidth)]);
  return out;
}
// ACC-05 : contraste RENDU — couleur du texte (opacité cumulée des ancêtres) sur le premier fond opaque dessous.
function contrast() {
  const parse = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(",").map(x => parseFloat(x)); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const mix = (fg, bg, a) => ({ r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) });
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = el => { const stack = []; let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } e = e.parentElement; } let bg = { r: 255, g: 255, b: 255 }; for (let i = stack.length - 1; i >= 0; i--) bg = mix(stack[i], bg, stack[i].a); return bg; };
  const opacityOf = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const hasImage = el => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage && s.backgroundImage !== "none" && !/gradient/.test(s.backgroundImage)) return true; if (parse(s.backgroundColor) && parse(s.backgroundColor).a >= 1) return false; } return false; };
  const out = [], seen = new Set();
  document.querySelectorAll("body *").forEach(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(" ");
    if (!own) return;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (!r.width || !r.height || s.visibility === "hidden") return;
    if (el.closest("button:disabled,[aria-disabled=true],input:disabled,.sr-only,.skip,[hidden],.hidden,.sk,svg") || hasImage(el)) return;
    const fg0 = parse(s.color); if (!fg0) return;
    const bg = bgOf(el), fg = mix(fg0, bg, opacityOf(el) * fg0.a);
    const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight, 10) >= 700, need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    const cr = ratio(fg, bg);
    if (cr < need - 0.005) { const k = String(el.className || el.tagName) + "|" + cr.toFixed(2); if (!seen.has(k)) { seen.add(k); out.push(["ACC-05 contraste du texte < " + need, cr.toFixed(2) + " « " + own.slice(0, 30) + " » ." + String(el.className || el.tagName).slice(0, 30)]); } }
  });
  // WCAG 1.4.11 : contour des champs et des boîtes de recherche contre leur fond.
  document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=file]),select,textarea,.search").forEach(el => {
    const r = el.getBoundingClientRect(); if (!r.width) return; const s = getComputedStyle(el);
    if ((el.closest(".search") && el.tagName === "INPUT") || el.closest(".stepper") || el.disabled) return; // la boîte .search / .stepper porte la bordure
    const bc = parse(s.borderTopColor), bw = parseFloat(s.borderTopWidth), bg = bgOf(el.parentElement || el);
    const cr = bw && bc && bc.a > 0 ? ratio(mix(bc, bg, bc.a), bg) : 1;
    if (cr < 3 - 0.005) out.push(["ACC-05 contour de champ < 3 (1.4.11)", cr.toFixed(2) + " " + (el.id ? "#" + el.id : String(el.className).slice(0, 30))]);
  });
  return out;
}
// CLA-02 : chaque élément atteignable au Tab montre un anneau quand il a le focus (outline, halo, ou anneau du conteneur).
function focusRings() {
  const vis = e => { const s = getComputedStyle(e); const rc = e.getBoundingClientRect(); return rc.width > 0 && rc.height > 0 && s.visibility !== "hidden"; };
  const top = [...document.querySelectorAll("[aria-modal=true]")].filter(vis).pop() || document;
  const ring = s => (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
  const out = [], prev = document.activeElement;
  const list = [...top.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(e => vis(e) && e.tagName !== "IFRAME").slice(0, 250);
  for (const e of list) {
    e.focus({ preventScroll: true }); if (document.activeElement !== e) continue;
    let ok = ring(getComputedStyle(e));
    for (let p = e.parentElement, i = 0; !ok && p && i < 2; p = p.parentElement, i++) if (p.matches(":focus-within")) ok = ring(getComputedStyle(p));
    if (!ok) out.push(["CLA-02 anneau de focus invisible", ((e.getAttribute("aria-label") || e.textContent || e.id || e.className) + "").trim().replace(/\s+/g, " ").slice(0, 40)]);
  }
  if (prev && prev.focus) prev.focus({ preventScroll: true });
  return out;
}

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const issues = {}; const add = (k, v) => { (issues[k] = issues[k] || new Set()).add(v); };
  for (const [w, h] of [[1280, 900], [390, 844]]) for (const role in pages) {
    const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h }, hasTouch: w < 600 });
    if (role === "staff") await ctx.request.post(B + "/api/session", { data: { code: "team-dev-code" } });
    if (role === "admin") await ctx.request.post(B + "/api/session", { data: { code: "beheer-dev-code" } });
    const p = await ctx.newPage();
    p.on("pageerror", e => add("Erreur JS", w + " " + p.url() + " :: " + e.message));
    if (role === "klant") { await p.goto(B + "/"); await p.fill("#user", "aloha"); await p.fill("#pw", "welkom123"); await p.click("#loginBtn"); await p.waitForURL(/klant/); await p.waitForTimeout(800); }
    else await p.goto(B + "/favicon.ico").catch(() => {}); // même origine, pour les écrans dont l'URL se calcule dans la page
    for (const item of pages[role]) {
      const it = typeof item === "string" ? { url: item } : item;
      if (it.before) await it.before(p);
      const url = typeof it.url === "function" ? await it.url(p) : it.url, label = it.name || url;
      await p.goto(B + url); if (/#/.test(url)) await p.reload(); // même page, autre #vue : rechargement propre
      await p.waitForTimeout(1300);
      if (it.after) await it.after(p);
      const r = (await p.evaluate(audit)).concat(await p.evaluate(contrast));
      await p.keyboard.press("Tab"); // modalité clavier : :focus-visible s'applique aux focus suivants
      r.push(...await p.evaluate(focusRings));
      r.forEach(([k, v]) => add(k, w + " " + label + " :: " + v));
    }
    await ctx.close();
  }
  await b.close();
  for (const k of Object.keys(issues).sort()) { console.log("## " + k + " (" + issues[k].size + ")"); [...issues[k]].forEach(v => console.log("  " + v)); }
  if (!Object.keys(issues).length) console.log("Aucun écart.");
  process.exit(Object.keys(issues).length ? 1 : 0);
})();
