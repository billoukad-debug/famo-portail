#!/usr/bin/env node
"use strict";
/* global document, getComputedStyle, innerHeight, innerWidth, localStorage, window, K, S */
// Parcours AU CLAVIER SEUL (Tab, Maj+Tab, Entrée, Espace, Échap, saisie) dans les trois portails,
// comme le ferait une personne sans souris. Chaque arrêt du focus est contrôlé :
//   2.4.11  focus entièrement caché par un élément fixe ou collant (barre panier, onglets, en-tête) ;
//   2.4.7   pas d'anneau de focus visible (outline, halo ou anneau du conteneur) ;
//   4.1.2   élément actif sans nom accessible (nom calculé par Chrome, arbre d'accessibilité) ;
//   2.1.2   piège ou fuite : Tab / Maj+Tab doit rester dans la fenêtre ouverte (panneau, dialogue, aperçu) ;
//   2.4.3   focus perdu (sur <body>) après une action ou un changement de vue ;
//   4.1.2   état non exposé (aria-pressed / aria-current) sur les choix, filtres et onglets.
// Parcours : client (390 et 1440 px) · équipe (1440 et 390 px) · beheer (1440 px).
// Le parcours client passe une commande : l'équipe la prépare, la fait partir, confirme la livraison.
//
//   node scripts/dev.js              (autre terminal : portail de dev + données de test)
//   node scripts/kbd-audit.js        (BASE=http://localhost:4200 par défaut ; sortie 1 s'il y a un écart)
// Playwright n'est pas une dépendance du dépôt : il est pris dans l'installation globale (comme ux-audit.js).
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const B = process.env.BASE || "http://localhost:4200";
const EXE = process.env.CHROMIUM || (require("fs").existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
const VERBOSE = !!process.env.VERBOSE;
const issues = {};
const add = (k, v) => { (issues[k] = issues[k] || new Set()).add(v); };
const log = s => { if (VERBOSE) console.log(s); };

// ---------- dans la page : ce qui a le focus ----------
function focusInfo() {
  let e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return { body: true, name: "(body)" };
  const r = e.getBoundingClientRect(), s = getComputedStyle(e);
  // Anneau : outline, halo (box-shadow), ou anneau porté par le conteneur (:focus-within : .search, .stepper).
  let ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
  for (let p = e.parentElement, i = 0; !ring && p && i < 2; p = p.parentElement, i++) { const ps = getComputedStyle(p); if (p.matches(":focus-within") && ((ps.boxShadow && ps.boxShadow !== "none") || (ps.outlineStyle !== "none" && parseFloat(ps.outlineWidth) > 0))) ring = true; }
  if (e.matches("[tabindex='-1']") && /^H[1-6]$/.test(e.tagName)) ring = true; // titre focalisé par le script (G-03) : pas une commande
  if (e.tagName === "IFRAME") ring = ring || true; // le document reçoit le focus ; l'iframe n'est pas une commande
  // 9 points de l'élément : combien sont sous un élément fixe ou collant qui n'est pas son ancêtre ?
  let covered = 0, tot = 0, coverer = "";
  const inView = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  if (inView) for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.15, 0.5, 0.85]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy; if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) continue; tot++;
    const top = document.elementFromPoint(x, y);
    if (!top || top === e || e.contains(top) || top.contains(e) || (e.labels && [...e.labels].some(l => l.contains(top)))) continue;
    let q = top; while (q && q !== document.body) { const pp = getComputedStyle(q).position; if ((pp === "fixed" || pp === "sticky") && !q.contains(e)) { covered++; coverer = coverer || String(q.className || q.tagName).slice(0, 30); break; } q = q.parentElement; }
  }
  const dlg = e.closest("[role=dialog],[role=alertdialog]");
  const row = e.closest("tr,.stop,.ocard,.line,.prod,.li,.orow");
  return {
    body: false, tag: e.tagName, id: e.id || "", ring: !!ring, obscured: tot ? covered / tot : 0, coverer,
    text: (e.getAttribute("aria-label") || e.textContent || e.value || e.id || e.className || "").toString().trim().replace(/\s+/g, " ").slice(0, 40),
    dialog: dlg ? (dlg.getAttribute("aria-labelledby") || dlg.id || dlg.className) : "",
    row: row ? row.textContent.trim().replace(/\s+/g, " ").slice(0, 60) : "",
    pressed: e.getAttribute("aria-pressed"), current: e.getAttribute("aria-current"),
    cls: String(e.className || "")
  };
}
// Nom accessible calculé par Chrome (arbre d'accessibilité), pas une approximation.
async function axName(p, cdp) {
  try {
    const { result } = await cdp.send("Runtime.evaluate", { expression: "document.activeElement" });
    if (!result.objectId) return { name: "" };
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { objectId: result.objectId, fetchRelatives: false });
    const n = nodes && nodes[0]; if (!n) return { name: "" };
    const name = n.name && n.name.value ? String(n.name.value).trim() : "";
    const src = n.name && n.name.sources ? n.name.sources.find(x => x.value && x.value.value) : null;
    return { name, role: n.role && n.role.value, fromPlaceholder: !!(src && src.attribute === "placeholder") };
  } catch (e) { return { name: "?" }; }
}

function journey(label, p, cdp) {
  const J = {
    label,
    async info() { const f = await p.evaluate(focusInfo); if (!f.body) Object.assign(f, await axName(p, cdp)); return f; },
    // Contrôle d'un arrêt du focus.
    check(f, where) {
      if (f.body) return;
      const at = label + " · " + where + " · " + (f.name || f.text || f.tag);
      if (f.obscured >= 0.99) add("2.4.11 focus entièrement masqué", at + " (sous ." + f.coverer + ")");
      if (!f.ring) add("2.4.7 anneau de focus invisible", at);
      if (!f.name && f.tag !== "IFRAME") add("4.1.2 élément actif sans nom", label + " · " + where + " · <" + f.tag.toLowerCase() + (f.id ? "#" + f.id : "") + "> " + f.cls.slice(0, 40));
      else if (f.fromPlaceholder) add("1.3.1 nom donné par le seul placeholder", at);
    },
    async press(key, where) { await p.keyboard.press(key); await p.waitForTimeout(60); const f = await J.info(); J.check(f, where || key); return f; },
    // Tab (ou Maj+Tab) jusqu'à ce que le focus soit sur `sel` ; chaque arrêt est contrôlé.
    async tabTo(sel, where, opts) {
      const o = Object.assign({ max: 90, back: false }, opts || {});
      for (let i = 1; i <= o.max; i++) {
        await p.keyboard.press(o.back ? "Shift+Tab" : "Tab"); await p.waitForTimeout(35);
        const f = await J.info(); J.check(f, where);
        if (await p.evaluate(s => !!(document.activeElement && document.activeElement.matches(s)), sel)) return f;
      }
      add("parcours incomplet", label + " · " + where + " : « " + sel + " » jamais atteint au clavier");
      return null;
    },
    // Après une action : le focus ne doit pas être perdu sur <body> (on laisse le temps au re-rendu).
    async notLost(where, ms) {
      await p.waitForTimeout(ms || 900);
      const f = await J.info();
      if (f.body) add("2.4.3 focus perdu sur <body> après action", label + " · " + where);
      else J.check(f, where + " (après)");
      log("  " + label + " · " + where + " → " + (f.name || f.text));
      return f;
    },
    // Piège : n Tab puis n Maj+Tab doivent rester dans la fenêtre ouverte.
    async trapped(where, n) {
      for (const back of [false, true]) for (let i = 0; i < (n || 15); i++) {
        await p.keyboard.press(back ? "Shift+Tab" : "Tab"); await p.waitForTimeout(35);
        const f = await J.info(); J.check(f, where);
        if (!f.dialog) { add("2.1.2 le focus quitte la fenêtre ouverte", label + " · " + where + " · " + (back ? "Maj+Tab" : "Tab") + " ×" + (i + 1) + " → " + (f.name || f.text || "(body)")); return false; }
      }
      return true;
    },
    async expect(cond, what) { if (!(await cond())) add("parcours incomplet", label + " · " + what); }
  };
  return J;
}
const pressedOf = (p, sel) => p.evaluate(s => { const x = document.querySelector(s); return x ? x.getAttribute("aria-pressed") : "absent"; }, sel);
const is = (p, sel) => p.evaluate(s => !!(document.activeElement && document.activeElement.matches(s)), sel);

async function klant(b, W) {
  const H = W < 600 ? 844 : 900;
  const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: W < 600, isMobile: W < 600 });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); p.on("pageerror", e => add("erreur JS", "klant " + W + " · " + e.message));
  const J = journey("klant " + W, p, cdp);
  await p.goto(B + "/"); await p.waitForTimeout(700);
  await p.evaluate(() => { localStorage.removeItem("famoCart:aloha"); localStorage.setItem("famoLang", "nl"); });
  await J.tabTo("#user", "connexion");
  await p.keyboard.type("aloha"); await J.press("Tab", "connexion"); await p.keyboard.type("welkom123"); await p.keyboard.press("Enter");
  await p.waitForURL(/klant/); await J.notLost("connexion → catalogue", 1500);
  // Deux produits au panier, puis toute la liste jusqu'au bouton « Bestellen » (masquage, anneau, noms).
  if (await J.tabTo("[data-inc]", "catalogue")) { await p.keyboard.press("Enter"); await J.notLost("+ (1er produit)", 300); }
  if (await J.tabTo(".prod:nth-of-type(3) [data-inc], [data-inc]:not(:focus)", "catalogue")) { await p.keyboard.press("Enter"); await J.notLost("+ (2e produit)", 300); }
  const bestel = W < 1024 ? ".cartbar a" : "#cartPanel a.btn";
  await J.tabTo(bestel, "catalogue → Bestellen", { max: 160 });
  for (let i = 0; i < 25; i++) await J.press("Shift+Tab", "catalogue (Maj+Tab)");
  await J.tabTo(bestel, "catalogue → Bestellen", { max: 160 });
  await p.keyboard.press("Enter"); await p.waitForURL(/winkelmand/); await J.notLost("Bestellen → panier");
  // Jour de livraison : état exposé.
  if (await J.tabTo("[data-day]:nth-child(2)", "panier")) {
    await p.keyboard.press("Space"); await J.notLost("choix du jour", 200);
    if (await pressedOf(p, "[data-day]:nth-child(2)") !== "true") add("4.1.2 état non exposé", "klant " + W + " · jour de livraison choisi sans aria-pressed=true");
    const grp = await p.evaluate(() => { const g = document.querySelector("[data-day]").closest("[role=group]"); return g ? (g.getAttribute("aria-labelledby") || g.getAttribute("aria-label") || "") : ""; });
    if (!grp) add("4.1.2 état non exposé", "klant " + W + " · choix du jour hors d'un groupe nommé");
  }
  // Quantité au clavier : − / + gardent le focus (le panier se redessine).
  if (await J.tabTo(".li [data-inc]", "panier")) { await p.keyboard.press("Enter"); await J.notLost("+ dans le panier", 400); if (!(await is(p, ".li [data-inc]"))) add("2.4.3 focus déplacé après action", "klant " + W + " · + dans le panier : le focus quitte le bouton"); }
  if (await J.tabTo("#placeOrder", "panier")) { await p.keyboard.press("Enter"); await p.waitForURL(/bevestigd/, { timeout: 8000 }).catch(() => add("parcours incomplet", "klant " + W + " · commande non passée")); await J.notLost("commande passée → confirmation", 1200); }
  if (await J.tabTo('a.btn[href="#/bestellingen"]', "confirmation")) { await p.keyboard.press("Enter"); await J.notLost("confirmation → mes commandes", 1500); }
  if (await J.tabTo('[data-of="geleverd"]', "mes commandes")) {
    await p.keyboard.press("Enter"); await J.notLost("filtre Geleverd", 500);
    if (!(await is(p, '[data-of="geleverd"]'))) add("2.4.3 focus déplacé après action", "klant " + W + " · filtre : le focus quitte le bouton pressé");
    if (await pressedOf(p, '[data-of="geleverd"]') !== "true") add("4.1.2 état non exposé", "klant " + W + " · filtre de commandes sans aria-pressed=true");
  }
  // Fiche d'une commande livrée : piège, aperçu de facture par-dessus, Échap couche par couche.
  if (await J.tabTo('.orow:has([data-doc="invoice"]) .orow-main, .orow-main', "mes commandes")) {
    const opener = await p.evaluate(() => document.activeElement.getAttribute("data-open"));
    await p.keyboard.press("Enter"); await p.waitForTimeout(600);
    const f = await J.info(); if (!f.dialog) add("2.4.3 fenêtre ouverte sans y porter le focus", "klant " + W + " · fiche commande");
    await J.trapped("fiche commande", 15);
    if (await J.tabTo('.scrim [data-doc="invoice"]', "fiche commande", { max: 20 })) {
      await p.keyboard.press("Enter"); await p.waitForTimeout(2500);
      const g = await J.info(); if (g.dialog !== "famoDocTitle") add("2.4.3 fenêtre ouverte sans y porter le focus", "klant " + W + " · aperçu facture (focus : " + (g.name || g.text) + ")");
      await J.trapped("aperçu facture", 8);
      await p.focus("#famoDocFrame"); // focus DANS le document
      await p.keyboard.press("Escape"); await p.waitForTimeout(500);
      if (await p.isVisible("#famoDocPreview:not(.hidden)")) add("2.1.2 Échap ne ferme pas la fenêtre", "klant " + W + " · aperçu (focus dans le document)");
      if (!(await p.isVisible(".scrim"))) add("2.1.2 Échap ferme plus d'une couche", "klant " + W + " · aperçu → la fiche s'est fermée aussi");
      await J.notLost("Échap aperçu → fiche", 300);
      const h = await J.info(); if (!h.dialog) add("2.4.3 focus hors de la fenêtre restante", "klant " + W + " · après l'aperçu : " + (h.name || h.text));
    }
    await p.keyboard.press("Escape"); await J.notLost("Échap fiche", 500);
    if (!(await p.evaluate(o => document.activeElement && document.activeElement.getAttribute("data-open") === o, opener))) add("2.4.3 focus non rendu au déclencheur", "klant " + W + " · fiche commande");
  }
  // Navigation principale : chaque vue place le focus sur son titre.
  for (const v of ["favorieten", "account", "catalogus"]) {
    if (await J.tabTo('.mtabs a[href="#/' + v + '"]', "navigation", { max: 120 })) { await p.keyboard.press("Enter"); await J.notLost("onglet " + v, 700); }
  }
  await ctx.close();
}

async function staff(b, W) {
  const ctx = await b.newContext({ viewport: { width: W, height: W < 600 ? 844 : 900 }, hasTouch: W < 600 });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); p.on("pageerror", e => add("erreur JS", "équipe " + W + " · " + e.message));
  const J = journey("équipe " + W, p, cdp);
  await p.goto(B + "/personeel.html"); await p.waitForTimeout(700);
  if (await J.tabTo("#code", "connexion")) { await p.keyboard.type("team-dev-code"); await p.keyboard.press("Enter"); }
  await p.waitForURL(/bestellingen/); await p.waitForTimeout(1500);
  // Vues Tabel / Bord : état exposé, focus gardé.
  if (await J.tabTo('.views a[href="#/bord"]', "Bestellingen")) {
    await p.keyboard.press("Enter"); await J.notLost("vue Bord", 700);
    if ((await p.evaluate(() => (document.querySelector('.views a[href="#/bord"]') || {}).getAttribute && document.querySelector('.views a[href="#/bord"]').getAttribute("aria-current"))) !== "page") add("4.1.2 état non exposé", "équipe " + W + " · vue active sans aria-current");
    if (await J.tabTo('.views a[href="#/tabel"]', "Bestellingen", { back: true })) { await p.keyboard.press("Enter"); await J.notLost("vue Tabel", 700); }
  }
  // Klaarzetten : panneau, focus visible dedans, cases à l'Espace, puis focus sur la même commande.
  const f0 = await J.tabTo('[data-act="validate"]', "Bestellingen", { max: 120 });
  if (f0) {
    const oid = await p.evaluate(() => document.activeElement.dataset.id);
    await p.keyboard.press("Enter"); await p.waitForTimeout(700);
    const f = await J.info(); if (!f.dialog) add("2.4.3 fenêtre ouverte sans y porter le focus", "équipe " + W + " · Artikelen valideren (focus : " + (f.name || f.text) + ")");
    await J.trapped("Artikelen valideren", 12);
    const n = await p.locator(".scrim [data-v]").count();
    for (let i = 0; i < n; i++) if (await J.tabTo(".scrim [data-v]:not(.on)", "Artikelen valideren", { max: 20 })) await p.keyboard.press("Space");
    const live = await p.evaluate(() => { const c = document.querySelector("#vCount"); return !!(c && c.closest("[aria-live],[role=status]")); });
    if (!live) add("4.1.3 message d'état non annoncé", "équipe " + W + " · compteur « n van m gecontroleerd »");
    if (await J.tabTo("#vOk", "Artikelen valideren", { max: 25 })) {
      await p.keyboard.press("Enter"); await J.notLost("Klaarzetten", 1800);
      const same = await p.evaluate(id => { const a = document.activeElement; const host = a && a.closest("tr,.stop,.ocard"); return !!(a && (a.dataset.id === id || (host && host.querySelector('[data-id="' + id + '"]')))); }, oid);
      const onTitle = await p.evaluate(() => /^H[12]$/.test(document.activeElement.tagName));
      if (!same && !onTitle) add("2.4.3 focus sur une autre commande", "équipe " + W + " · après Klaarzetten : " + (await J.info()).row);
    }
    // Leveringen de la même commande : Vertrekt → Ontvangst bevestigen (Entrée dans le champ = bevestigen).
    const day = await p.evaluate(id => (window.S && S.byId(id) || {}).day || "", oid);
    await p.goto(B + "/leveringen.html?dag=" + encodeURIComponent(day)); await p.waitForTimeout(1500);
    if (await J.tabTo('[data-act="depart"][data-id="' + oid + '"]', "Leveringen", { max: 120 })) {
      await p.keyboard.press("Enter"); await p.waitForTimeout(400);
      const d = await J.info(); if (!d.dialog) add("2.4.3 fenêtre ouverte sans y porter le focus", "équipe " + W + " · Ronde vertrekt?");
      await p.keyboard.press("Enter"); await J.notLost("Vertrekt", 1800);
    }
    if (await J.tabTo('[data-act="deliver"][data-id="' + oid + '"]', "Leveringen", { max: 120 })) {
      await p.keyboard.press("Enter"); await p.waitForTimeout(700);
      const d = await J.info(); if (!d.dialog) add("2.4.3 fenêtre ouverte sans y porter le focus", "équipe " + W + " · Ontvangst bevestigen");
      if (await J.tabTo("#recipient", "Ontvangst bevestigen", { max: 10 })) {
        if (await J.tabTo('[data-pay="Payé"]', "Ontvangst bevestigen", { max: 10 })) {
          await p.keyboard.press("Space"); await p.waitForTimeout(100);
          if (await pressedOf(p, '[data-pay="Payé"]') !== "true") add("4.1.2 état non exposé", "équipe " + W + " · Betaling « Contant » sans aria-pressed=true");
        }
        await J.tabTo("#recipient", "Ontvangst bevestigen", { max: 10, back: true });
        await p.keyboard.type("Sofie (keuken)"); await p.keyboard.press("Enter"); await p.waitForTimeout(1800);
        if (await p.isVisible(".scrim")) add("FOR-02 Entrée ne soumet pas le panneau", "équipe " + W + " · Ontvangst bevestigen");
        await J.notLost("Ontvangst bevestigd", 300);
      }
    }
    // Fiche de la commande livrée → aperçu de la facture (équipe) : modale, Échap, retour du focus.
    await p.goto(B + "/order.html?id=" + encodeURIComponent(oid)); await p.waitForTimeout(1500);
    if (await J.tabTo('[data-act="invoice"][data-id="' + oid + '"]', "Fiche commande", { max: 60 })) {
      await p.keyboard.press("Enter"); await p.waitForTimeout(2500);
      const g = await J.info(); if (g.dialog !== "famoDocTitle") add("2.4.3 fenêtre ouverte sans y porter le focus", "équipe " + W + " · aperçu facture");
      await J.trapped("aperçu facture", 8);
      await p.focus("#famoDocFrame"); await p.keyboard.press("Escape"); await p.waitForTimeout(400);
      if (await p.isVisible("#famoDocPreview:not(.hidden)")) add("2.1.2 Échap ne ferme pas la fenêtre", "équipe " + W + " · aperçu (focus dans le document)");
      await J.notLost("Échap aperçu", 300);
      if (!(await is(p, '[data-act="invoice"][data-id="' + oid + '"]'))) add("2.4.3 focus non rendu au déclencheur", "équipe " + W + " · aperçu facture");
    }
  }
  // Magazijn : Vandaag / Morgen exposés, Bord sans bouton imbriqué dans un lien.
  await p.goto(B + "/entrepot.html#/dag"); await p.waitForTimeout(1400);
  if (await J.tabTo(".page-h .opt [data-day]:not(.on)", "Magazijn")) {
    await p.keyboard.press("Enter"); await J.notLost("Magazijn : autre jour", 500);
    const st = await p.evaluate(() => { const a = document.activeElement; return a && a.matches("[data-day]") ? a.getAttribute("aria-pressed") : "?"; });
    if (st !== "true") add("4.1.2 état non exposé", "équipe " + W + " · Magazijn : jour choisi sans aria-pressed=true");
  }
  await p.goto(B + "/entrepot.html#/bord"); await p.waitForTimeout(1400);
  const nested = await p.evaluate(() => document.querySelectorAll("a button, a a, button button, button a").length);
  if (nested) add("4.1.2 élément interactif imbriqué", "équipe " + W + " · Magazijn Bord : " + nested);
  await J.tabTo('[data-act]', "Magazijn Bord", { max: 60 });
  await ctx.close();
}

async function beheer(b) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); p.on("pageerror", e => add("erreur JS", "beheer · " + e.message));
  const J = journey("beheer", p, cdp);
  await p.goto(B + "/beheer-login.html"); await p.waitForTimeout(700);
  if (await J.tabTo("#code", "connexion")) { await p.keyboard.type("beheer-dev-code"); await p.keyboard.press("Enter"); }
  await p.waitForURL(/beheer\.html/); await p.waitForTimeout(1500);
  if (await J.tabTo('.tabs a[href="#/producten"]', "Overzicht")) {
    await p.keyboard.press("Enter"); await J.notLost("onglet Producten", 1200);
    const cur = await p.evaluate(() => document.querySelector('.tabs a[href="#/producten"]').getAttribute("aria-current"));
    if (cur !== "page") add("4.1.2 état non exposé", "beheer · onglet actif sans aria-current=page");
  }
  const name = "Kbd-audit " + Date.now().toString(36);
  if (await J.tabTo("[data-new-product]", "Producten")) {
    await p.keyboard.press("Enter"); await p.waitForTimeout(600);
    const f = await J.info(); if (!f.dialog) add("2.4.3 fenêtre ouverte sans y porter le focus", "beheer · Nieuw product");
    await J.trapped("Nieuw product", 20);
    if (await J.tabTo("#pNom", "Nieuw product", { max: 30 })) {
      await p.keyboard.press("Enter"); await p.waitForTimeout(400); // Entrée à vide : erreurs, focus sur le premier champ en erreur
      if (!(await p.evaluate(() => document.activeElement.getAttribute("aria-invalid") === "true"))) add("3.3.1 erreur sans focus", "beheer · Entrée à vide dans Nieuw product");
      await p.keyboard.type(name);
      await p.keyboard.press("Escape"); await p.waitForTimeout(300); // modifié → confirmation
      const c = await J.info(); if (!c.dialog || c.dialog === "kPanelTitle") add("2.4.3 fenêtre ouverte sans y porter le focus", "beheer · Wijzigingen niet bewaard");
      await p.keyboard.press("Escape"); await p.waitForTimeout(300);
      if (!(await p.isVisible(".scrim"))) add("2.1.2 Échap ferme plus d'une couche", "beheer · confirmation → le panneau s'est fermé");
      await J.notLost("Échap confirmation", 200);
      if (await J.tabTo("#pBase", "Nieuw product", { max: 20 })) { await p.keyboard.type("12,50"); await p.keyboard.press("Enter"); await p.waitForTimeout(1500); }
      if (await p.isVisible(".scrim")) add("FOR-02 Entrée ne soumet pas le panneau", "beheer · Nieuw product");
      await J.notLost("product opgeslagen", 300);
    }
  }
  // Klanten → fiche → prix négocié : Entrée enregistre, focus gardé.
  if (await J.tabTo('.tabs a[href="#/klanten"]', "Producten", { back: true, max: 120 })) { await p.keyboard.press("Enter"); await J.notLost("onglet Klanten", 1200); }
  if (await J.tabTo("a[data-c]:not([style*='p-soft'])", "Klanten", { max: 40 })) { await p.keyboard.press("Enter"); await J.notLost("autre klant", 1200); }
  if (await J.tabTo("[data-price]", "Klantfiche", { max: 60 })) {
    await p.keyboard.type("9,99"); await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
    const toast = await p.evaluate(() => document.querySelector(".toasts").textContent);
    if (!/opgeslagen/i.test(toast)) add("FOR-02 Entrée n'enregistre pas", "beheer · prix négocié (Klantfiche)");
    await J.notLost("prijs opgeslagen", 300);
  }
  // Prijzen : le bouton Enregistrer existe aussi sous le tableau.
  if (await J.tabTo('.tabs a[href="#/prijzen"]', "Klanten", { back: true, max: 140 })) {
    await p.keyboard.press("Enter"); await J.notLost("onglet Prijzen", 1200);
    const n = await p.locator("[data-save-prices]").count(); if (n < 2) add("FOR-02 bouton Enregistrer seulement en haut", "beheer · Prijzen");
  }
  // Journaal : atteignable, focus sur le titre.
  if (await J.tabTo('.tabs a[href="#/journaal"]', "Prijzen", { max: 140 })) { await p.keyboard.press("Enter"); await J.notLost("onglet Journaal", 1500); }
  // Nettoyage : le produit de test est supprimé (souris : hors parcours).
  await p.evaluate(async n => { const d = await K.api("/api/onboarding"); const pr = (d.products || []).find(x => x.nom === n); if (pr) await K.api("/api/onboarding", { json: { action: "deleteProduct", id: pr.id } }); }, name).catch(() => {});
  await ctx.close();
}

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const run = async (what, fn) => { try { await fn(); } catch (e) { add("parcours interrompu", what + " : " + String(e.message || e).split("\n")[0]); } };
  await run("klant 390", () => klant(b, 390));
  await run("klant 1440", () => klant(b, 1440));
  await run("équipe 1440", () => staff(b, 1440));
  await run("équipe 390", () => staff(b, 390));
  await run("beheer", () => beheer(b));
  await b.close();
  for (const k of Object.keys(issues).sort()) { console.log("## " + k + " (" + issues[k].size + ")"); [...issues[k]].forEach(v => console.log("  " + v)); }
  if (!Object.keys(issues).length) console.log("Aucun écart.");
  process.exit(Object.keys(issues).length ? 1 : 0);
})();
