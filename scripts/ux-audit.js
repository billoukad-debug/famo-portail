#!/usr/bin/env node
"use strict";
/* global document, getComputedStyle, matchMedia, innerWidth, location */
// Contrôles automatiques de docs/CHECKLIST-UX.md sur toutes les pages, à 1280 px et 390 px (tactile) :
// FOR-01 libellés · ACC-02 noms accessibles · ACC-03 alt · ACC-04 h1 / lien d'évitement / titre / lang ·
// INT-01 pas de <a href="#"> ni de onclick hors bouton · INT-03 cibles 24 px (44 px au tactile) · MEP-04 pas de défilement horizontal.
//
//   node scripts/dev.js            (autre terminal : portail de dev + données de test)
//   node scripts/ux-audit.js       (BASE=http://localhost:4200 par défaut)
// Playwright n'est pas une dépendance du dépôt : il est pris dans l'installation globale.
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const B = process.env.BASE || "http://localhost:4200";
const EXE = process.env.CHROMIUM || (require("fs").existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
const pages = { staff: ["/bestellingen.html#/tabel", "/bestellingen.html#/bord", "/bestellingen.html#/kalender", "/entrepot.html", "/leveringen.html", "/documenten.html"],
  admin: ["/beheer.html#/overzicht", "/beheer.html#/aanvragen", "/beheer.html#/klanten", "/beheer.html#/producten", "/beheer.html#/prijzen", "/beheer.html#/rapportage", "/beheer.html#/bedrijf", "/beheer.html#/toegang", "/beheer.html#/status", "/invoer.html", "/stock.html"],
  klant: ["/klant.html#/catalogus", "/klant.html#/winkelmand", "/klant.html#/bestellingen", "/klant.html#/favorieten", "/klant.html#/account"],
  public: ["/", "/aanvraag.html", "/wachtwoord.html", "/personeel.html", "/beheer-login.html"] };
(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const issues = {}; const add = (k, v) => { (issues[k] = issues[k] || new Set()).add(v); };
  for (const [w, h] of [[1280, 900], [390, 844]]) for (const role in pages) {
    const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h }, hasTouch: w < 600 });
    if (role === "staff") await ctx.request.post(B + "/api/session", { data: { code: "team-dev-code" } });
    if (role === "admin") await ctx.request.post(B + "/api/session", { data: { code: "beheer-dev-code" } });
    const p = await ctx.newPage();
    if (role === "klant") { await p.goto(B + "/"); await p.fill("#user", "aloha"); await p.fill("#pw", "welkom123"); await p.click("#loginBtn"); await p.waitForURL(/klant/); await p.waitForTimeout(800); }
    for (const url of pages[role]) {
      await p.goto(B + url); await p.waitForTimeout(1300);
      const r = await p.evaluate(() => {
        const vis = e => { const s = getComputedStyle(e); const rc = e.getBoundingClientRect(); return rc.width > 0 && rc.height > 0 && s.visibility !== "hidden"; };
        const name = e => (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") && document.getElementById(e.getAttribute("aria-labelledby"))?.textContent || e.textContent || e.getAttribute("title") || "").trim();
        const out = [];
        document.querySelectorAll("input:not([type=hidden]):not([hidden]),select,textarea").forEach(e => { if (!vis(e)) return; if (!(e.labels && e.labels.length) && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby")) out.push(["FOR-01 champ sans libellé", (e.id || e.name || e.placeholder || e.outerHTML.slice(0, 60))]); });
        document.querySelectorAll("button,a[href]").forEach(e => { if (!vis(e)) return; if (!name(e)) out.push(["ACC-02 sans nom accessible", e.outerHTML.slice(0, 80)]); });
        document.querySelectorAll("img").forEach(e => { if (!e.hasAttribute("alt")) out.push(["ACC-03 img sans alt", e.src.slice(-40)]); });
        const h1 = [...document.querySelectorAll("h1")].filter(vis).length; if (h1 !== 1) out.push(["ACC-04 nombre de h1", String(h1)]);
        if (!document.querySelector(".skip") && document.querySelector("nav,.side,.mtabs")) out.push(["ACC-04 pas de lien d'évitement", location.pathname]);
        if (!document.title.trim()) out.push(["ACC-04 titre vide", location.pathname]);
        if (!document.documentElement.lang) out.push(["ACC-04 lang absent", location.pathname]);
        const touch = matchMedia("(pointer: coarse)").matches, min = touch ? 44 : 24;
        document.querySelectorAll("button,a[href],input[type=checkbox],input[type=radio],select,[role=button]").forEach(e => {
          if (!vis(e) || e.closest("[data-ux-exempt]")) return; const rc = e.getBoundingClientRect(); // data-ux-exempt : exception documentée dans la checklist
          const inline = e.tagName === "A" && getComputedStyle(e).display === "inline" && e.parentElement && /\S/.test(e.parentElement.textContent.replace(e.textContent, ""));
          if (inline) return; // WCAG 2.5.8 : lien dans une phrase exempté
          if (rc.height < min - 0.5 || rc.width < Math.min(min, 24) - 0.5) out.push(["INT-03 cible < " + min + "px", (name(e) || e.className).slice(0, 40) + " " + Math.round(rc.width) + "×" + Math.round(rc.height)]);
        });
        document.querySelectorAll('a[href="#"]').forEach(e => out.push(["INT-01 lien href=#", e.outerHTML.slice(0, 80)]));
        document.querySelectorAll("[onclick]").forEach(e => { if (!/^(BUTTON|A|INPUT)$/.test(e.tagName)) out.push(["INT-01 onclick sur " + e.tagName, e.outerHTML.slice(0, 60)]); });
        if (document.documentElement.scrollWidth > innerWidth + 1) out.push(["MEP-04 défilement horizontal", String(document.documentElement.scrollWidth)]);
        return out;
      });
      r.forEach(([k, v]) => add(k, w + " " + url + " :: " + v));
    }
    await ctx.close();
  }
  await b.close();
  for (const k of Object.keys(issues).sort()) { console.log("## " + k + " (" + issues[k].size + ")"); [...issues[k]].forEach(v => console.log("  " + v)); }
  if (!Object.keys(issues).length) console.log("Aucun écart.");
  process.exit(Object.keys(issues).length ? 1 : 0);
})();
