#!/usr/bin/env node
"use strict";
// Parcours fonctionnels du portail client dans un vrai navigateur (régressions vues en production) :
//   favorieten · une étoile posée sur un appareil se retrouve sur un autre appareil (nouvelle connexion),
//                et un rechargement dans les 10 minutes du cache catalogue ne la fait pas disparaître.
//   vandaag    · (spec 024) une commande Nieuw passe Klaar → (ongedaan) → Klaar → Onderweg → Geleverd → Betaald
//                en un tap par étape, le serveur attribue le numéro FA ; « + Bestelling » crée une commande.
//
//   node scripts/dev.js              (autre terminal : portail de dev + données de test)
//   node scripts/parcours-check.js   (BASE=http://localhost:4200 par défaut ; sortie 1 s'il y a un écart)
// Écrit des favoris pour le client de démo : jamais contre la production.
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const B = process.env.BASE || "http://localhost:4200";
const EXE = process.env.CHROMIUM || (require("fs").existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);
if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(B)) { console.error("parcours-check écrit des données : BASE doit être local."); process.exit(2); }

const issues = [];
const fail = (msg) => issues.push(msg);

async function login(b) {
  // Appareils simulés à l'heure de Bruxelles (comme ceux de FAMO) : K.today() suit l'heure de l'appareil et les
  // horodatages du serveur sont lus en Europe/Brussels ; en UTC, entre 22 h et minuit UTC les deux dates divergent.
  const ctx = await b.newContext({ timezoneId: "Europe/Brussels" }); const p = await ctx.newPage();
  p.on("pageerror", e => fail("erreur JS : " + e.message));
  await p.goto(B + "/");
  await p.fill("input[autocomplete=username]", "aloha"); await p.fill("input[type=password]", "welkom123");
  await p.keyboard.press("Enter");
  await p.waitForURL(/klant/); await p.waitForSelector("[data-fav]"); await p.waitForTimeout(800);
  return { ctx, p };
}
const starred = (p) => p.$$eval("[data-fav].on", els => els.map(e => e.dataset.fav).sort());

(async () => {
  const b = await chromium.launch(EXE ? { executablePath: EXE } : {});
  try {
    // Appareil A : on part de zéro, puis deux étoiles.
    const A = await login(b);
    for (const id of await starred(A.p)) { await A.p.click('[data-fav="' + id + '"]'); await A.p.waitForTimeout(150); }
    const ids = await A.p.$$eval("[data-fav]", els => els.slice(0, 2).map(e => e.dataset.fav));
    for (const id of ids) { await A.p.click('[data-fav="' + id + '"]'); await A.p.waitForTimeout(150); }
    await A.p.waitForTimeout(2200); // synchro serveur (anti-rebond 1,2 s)
    const want = ids.slice().sort();
    // Rechargement dans les 10 minutes du cache catalogue : les étoiles restent.
    await A.p.reload(); await A.p.waitForSelector("[data-fav]"); await A.p.waitForTimeout(800);
    if (JSON.stringify(await starred(A.p)) !== JSON.stringify(want)) fail("favorieten : perdues après rechargement (" + JSON.stringify(await starred(A.p)) + ")");
    // Appareil B : nouvelle connexion, stockage vide → les étoiles du serveur.
    const Bdev = await login(b);
    const got = await starred(Bdev.p);
    if (JSON.stringify(got) !== JSON.stringify(want)) fail("favorieten : autre appareil " + JSON.stringify(got) + " au lieu de " + JSON.stringify(want));
    // Appareil B retire une étoile ; A, reconnecté, ne la voit plus.
    await Bdev.p.click('[data-fav="' + want[0] + '"]'); await Bdev.p.waitForTimeout(2200);
    await A.ctx.close();
    const A2 = await login(b);
    const got2 = await starred(A2.p);
    if (JSON.stringify(got2) !== JSON.stringify(want.slice(1))) fail("favorieten : retrait non repris sur l'autre appareil " + JSON.stringify(got2));
    // Nettoyage : plus d'étoiles pour les audits suivants.
    for (const id of got2) { await A2.p.click('[data-fav="' + id + '"]'); await A2.p.waitForTimeout(150); }
    await A2.p.waitForTimeout(2200);
    // Vandaag (spec 024) : l'écran du gérant, de bout en bout, comme Mohsen sur son iPhone.
    const V = await b.newContext({ timezoneId: "Europe/Brussels", viewport: { width: 390, height: 844 } });
    await V.request.post(B + "/api/session", { data: { code: "beheer-dev-code" } });
    const vp = await V.newPage(); vp.on("pageerror", e => fail("Vandaag · erreur JS : " + e.message));
    const order = async id => ((await (await V.request.get(B + "/api/allorders?limit=1000")).json()).orders || []).find(o => o.id === id) || {};
    await vp.goto(B + "/team/vandaag"); await vp.waitForSelector(".vd-card [data-go]");
    const vid = await vp.$eval(".vd-nieuw [data-go]", e => e.dataset.go).catch(() => "");
    if (!vid) fail("Vandaag : aucune commande Nieuw avec un bouton d'étape");
    else {
      const tap = async () => { await vp.click('[data-go="' + vid + '"]'); await vp.waitForTimeout(1000); };
      await tap(); if ((await order(vid)).statut !== "Prête") fail("Vandaag : Klaar n'a pas mis la commande sur Prête");
      await vp.click(".toast button"); await vp.waitForTimeout(1000); if ((await order(vid)).statut !== "Reçue") fail("Vandaag : Ongedaan maken n'est pas revenu sur Reçue");
      await tap(); await tap(); if ((await order(vid)).statut !== "Sortie en livraison") fail("Vandaag : Onderweg non atteint");
      await tap(); const g = await order(vid); if (g.statut !== "Facturée" || !/^FA-/.test(g.factuurnummer || "")) fail("Vandaag : Geleverd sans numéro FA (" + g.statut + ")");
      await vp.click('[data-go="' + vid + '"]'); await vp.waitForSelector("#mOk"); await vp.click("#mOk"); await vp.waitForTimeout(1000);
      if ((await order(vid)).paiement !== "Payé") fail("Vandaag : Betaald non enregistré");
      if (await vp.$('[data-go="' + vid + '"]')) fail("Vandaag : la commande payée reste dans la liste");
    }
    await vp.click("#vdNew"); await vp.waitForSelector("#nbClient");
    await vp.selectOption("#nbClient", await vp.$eval("#nbClient option:nth-child(2)", o => o.value)); await vp.waitForSelector("#nb .stepper");
    await vp.click("#nb .stepper [data-inc]"); await vp.waitForTimeout(200); await vp.click("#nbOk"); await vp.waitForTimeout(1500);
    if (await vp.isVisible("#nbOk")) fail("Vandaag : + Bestelling n'a pas placé la commande (" + (await vp.textContent("#nbErr").catch(() => "")) + ")");
    await V.close();
  } finally { await b.close(); }
  if (issues.length) { console.log("Écarts :\n- " + issues.join("\n- ")); process.exit(1); }
  console.log("Aucun écart.");
})().catch(e => { console.error(e); process.exit(1); });
