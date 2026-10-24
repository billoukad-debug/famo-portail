"use strict";
// Spec 037 (x30 lot C) : nouvel accueil public. Bandeau calculé à l'heure de Bruxelles depuis la configuration publique,
// aucun créneau ni chiffre inventé, fiche « Voorbeeld », connexion / liens / SEO de la vague 2 préservés, police serif
// auto-hébergée (CSP font-src 'self').
process.removeAllListeners("warning");
global.fetch = async (u) => { throw new Error("Réseau interdit : " + u); };
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const T = require("../assets/tij.js");

// Instant donné à l'heure de Bruxelles (octobre 2026 : heure d'été jusqu'au dimanche 25/10 03:00, puis UTC+1).
const at = (iso) => new Date(iso);
const DEF = { deadline: "22:00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [] };

test("bandeau : vendredi 18:48 à Bruxelles → ce soir encore 3 u 12, livré samedi", () => {
  const p = T.plan(DEF, at("2026-10-23T16:48:00Z"));
  assert.equal(p.deliver, "2026-10-24");
  assert.equal(p.orderBy, "2026-10-23");
  assert.equal(p.tonight, true);
  assert.equal(p.left, 192);
  assert.equal(p.mode, "countdown");
  assert.equal(p.soon, false);
  assert.equal(T.duration(p.left, "nl"), "3 u 12");
  assert.equal(T.duration(p.left, "fr"), "3 h 12");
});

test("bandeau : l'heure de Bruxelles, pas celle de l'appareil (changement d'heure du 25/10)", () => {
  assert.deepEqual(T.brussels(at("2026-10-25T20:00:00Z")), { day: "2026-10-25", min: 21 * 60 });
  assert.deepEqual(T.brussels(at("2026-10-24T20:00:00Z")), { day: "2026-10-24", min: 22 * 60 });
  assert.deepEqual(T.brussels(at("2026-10-22T23:30:00Z")), { day: "2026-10-23", min: 90 }, "après minuit à Bruxelles, encore la veille en UTC");
  // Dimanche 21:00 (UTC+1) : lundi est livré, il reste une heure.
  const p = T.plan(DEF, at("2026-10-25T20:00:00Z"));
  assert.equal(p.deliver, "2026-10-26"); assert.equal(p.tonight, true); assert.equal(p.left, 60);
});

test("bandeau : après la deadline, le prochain jour livré et sa vraie date limite (veille, 22:00)", () => {
  const p = T.plan(DEF, at("2026-10-23T20:30:00Z")); // vendredi 22:30
  assert.equal(p.deliver, "2026-10-26", "dimanche non livré → lundi");
  assert.equal(p.orderBy, "2026-10-25");
  assert.equal(p.tonight, false);
  assert.equal(p.mode, "later");
  const s = T.plan(DEF, at("2026-10-24T19:00:00Z")); // samedi 21:00 : lundi, à commander jusqu'à dimanche 22:00
  assert.equal(s.deliver, "2026-10-26"); assert.equal(s.orderBy, "2026-10-25"); assert.equal(s.mode, "later");
  const e = T.plan(DEF, at("2026-10-22T23:00:00Z")); // vendredi 01:00 : aujourd'hui, mais loin
  assert.equal(e.deliver, "2026-10-24"); assert.equal(e.tonight, true); assert.equal(e.left, 21 * 60); assert.equal(e.mode, "today");
});

test("bandeau : jour fermé sauté, autre deadline et autres jours de livraison", () => {
  const c = T.plan(Object.assign({}, DEF, { geslotenDagen: ["2026-10-27"] }), at("2026-10-26T19:00:00Z")); // lundi 20:00
  assert.equal(c.deliver, "2026-10-28"); assert.equal(c.orderBy, "2026-10-27"); assert.equal(c.tonight, false);
  const r = { deadline: "21:30", leverdagen: ["di", "do"], geslotenDagen: [] };
  const a = T.plan(r, at("2026-10-26T20:00:00Z")); // lundi 21:00
  assert.equal(a.deliver, "2026-10-27"); assert.equal(a.left, 30); assert.equal(a.soon, true, "≤ 30 min : alerte");
  const b = T.plan(r, at("2026-10-26T20:45:00Z")); // lundi 21:45
  assert.equal(b.deliver, "2026-10-29"); assert.equal(b.orderBy, "2026-10-28"); assert.equal(b.tonight, false);
  assert.equal(T.plan({}, at("2026-10-23T16:48:00Z")).deliver, "2026-10-24", "configuration absente : règles par défaut");
  assert.equal(T.plan({ deadline: "n'importe quoi" }, at("2026-10-23T16:48:00Z")).deadline, "22:00");
});

test("bandeau : aucun créneau horaire tant que la configuration n'en donne pas", () => {
  assert.equal(T.plan(DEF, at("2026-10-23T16:48:00Z")).slot, null);
  assert.deepEqual(T.plan(Object.assign({ levervenster: "06:00-08:00" }, DEF), at("2026-10-23T16:48:00Z")).slot, { van: "06:00", tot: "08:00" });
  for (const bad of ["", null, undefined, "tussen 6 en 8", "6-8", "08:00-06:00", "25:00-26:00", 7]) assert.equal(T.slot(bad), null, String(bad));
  assert.equal(T.duration(42, "nl"), "42 min");
  assert.equal(T.duration(120, "nl"), "2 u");
  assert.equal(T.duration(65, "fr"), "1 h 05");
});

// ---------- la page dans un faux navigateur ----------
function stub(id) {
  const listeners = {};
  return { id, innerHTML: "", textContent: "", value: "", hidden: false, type: "text", attrs: {}, dataset: {},
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle(c, on) { if (on === undefined ? !this.set.has(c) : on) this.set.add(c); else this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute(a, v) { this.attrs[a] = String(v); }, getAttribute(a) { return this.attrs[a] == null ? null : this.attrs[a]; }, removeAttribute(a) { delete this.attrs[a]; },
    addEventListener(t, f) { listeners[t] = f; }, focus() {}, scrollIntoView() {}, insertAdjacentHTML() {}, listeners };
}
async function page(o) {
  o = o || {};
  const url = o.url || "/";
  const els = {};
  const store = Object.assign({}, o.storage || {});
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const loc = { href: "https://www.famoseafood.be" + url, hostname: "www.famoseafood.be", pathname: url.split("?")[0], search: url.includes("?") ? "?" + url.split("?")[1] : "", hash: "", reload() {}, assign() {}, replace(u) { loc.replaced = u; } };
  const doc = { title: "", documentElement: {}, addEventListener() {}, getElementById: (id) => (els[id] = els[id] || stub(id)), body: { classList: { add() {}, remove() {} }, dataset: {} },
    querySelector: () => null, querySelectorAll: () => [] };
  const timers = [];
  const now = o.now || at("2026-10-23T16:48:00Z");
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(now.getTime()); } static now() { return now.getTime(); } }
  const win = { document: doc, location: loc, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, localStorage: ls, addEventListener() {},
    setInterval: (f, ms) => { timers.push(ms); return 1; }, clearInterval() {}, setTimeout: (f) => { f(); return 1; }, Date: FakeDate, Intl, URL, URLSearchParams, CustomEvent: class {}, fetch: async () => { throw new Error("réseau"); }, console, Promise };
  win.window = win; win.self = win;
  const ctx = vm.createContext(win);
  vm.runInContext(read("assets/ui.js"), ctx);
  win.K.api = async (u) => { win.apiCalls = (win.apiCalls || []).concat(u); return { config: o.config || {} }; };
  vm.runInContext(read("assets/tij.js"), ctx);
  vm.runInContext(read("assets/pages/start.js"), ctx);
  const html0 = els.app.innerHTML;
  await new Promise((r) => setImmediate(r));
  return { K: win.K, els, html0, timers, win, loc };
}
const txt = (el) => el.innerHTML.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'");
const CONFIG = { bedrijfsnaam: "FAMO Seafood", telefoon: "+32483585854", email: "info@famoseafood.be", levering: DEF };

test("page NL : connexion, liens, pied de page commun, bandeau calculé, rien d'inventé", async () => {
  const p = await page({ config: CONFIG });
  const h = p.html0;
  for (const s of ['class="skip" href="#main"', 'href="#aanmelden"', 'href="/aanvraag"', 'href="/wachtwoord"', 'id="loginForm"', 'id="user"', 'id="pw"', 'id="loginBtn"', 'id="togglePw"', 'id="pubFt"', 'href="/team/aanmelden"', 'id="main"', "Voorbeeld", "Ter illustratie"]) assert.ok(h.includes(s), s);
  assert.match(h, /<header[^>]*>[\s\S]*href="#aanmelden"[^>]*>Aanmelden<\/a>[\s\S]*<\/header>/, "bouton Aanmelden dans l'en-tête");
  assert.ok(p.win.apiCalls.includes("/api/config?public=1"));
  assert.equal(txt(p.els.tijT), "Vanavond nog 3 u 12 om te bestellen · geleverd za 24/10");
  assert.match(p.els.heroT.innerHTML, /Vóór 22:00 besteld,/);
  assert.match(p.els.tijT.innerHTML, /<b>3 u 12<\/b>/, "les faits du bandeau en gras");
  assert.ok(p.timers.length >= 1, "le bandeau se met à jour");
  assert.ok(!/wa\.me/.test(p.els.acContact.innerHTML), "pas de WhatsApp sans numéro configuré");
  assert.match(p.els.acContact.innerHTML, /href="tel:\+32483585854"/);
  assert.match(p.els.acContact.innerHTML, /href="mailto:info@famoseafood\.be"/);
  assert.doesNotMatch(h + txt(p.els.tijT), /tussen|Rauw OK|€/);
});

test("page : WhatsApp seulement si configuré, créneau seulement si configuré, après la deadline", async () => {
  const wa = await page({ config: Object.assign({}, CONFIG, { whatsapp: "0483 58 58 54" }) });
  assert.match(wa.els.acContact.innerHTML, /href="https:\/\/wa\.me\/32483585854"/);
  const slot = await page({ config: Object.assign({}, CONFIG, { levering: Object.assign({ levervenster: "06:00-08:00" }, DEF) }) });
  assert.equal(txt(slot.els.tijT), "Vanavond nog 3 u 12 om te bestellen · geleverd za 24/10 tussen 06:00 en 08:00");
  const late = await page({ config: CONFIG, now: at("2026-10-23T20:30:00Z") });
  assert.equal(txt(late.els.tijT), "Bestel vóór zo 25/10, 22:00 · geleverd ma 26/10");
  const soon = await page({ config: CONFIG, now: at("2026-10-23T19:40:00Z") });
  assert.equal(txt(soon.els.tijT), "Vanavond nog 20 min om te bestellen · geleverd za 24/10");
  assert.ok(soon.els.tij.classList.contains("is-soon"));
  const far = await page({ config: CONFIG, now: at("2026-10-23T06:00:00Z") });
  assert.equal(txt(far.els.tijT), "Bestel vandaag vóór 22:00 · geleverd za 24/10");
  const off = await page({ config: {} }); // configuration injoignable : règles par défaut
  assert.equal(txt(off.els.tijT), "Vanavond nog 3 u 12 om te bestellen · geleverd za 24/10");
});

test("page FR (?taal=fr) : tout passe par K.t", async () => {
  const p = await page({ url: "/?taal=fr", config: CONFIG });
  assert.equal(txt(p.els.tijT), "Ce soir encore 3 h 12 pour commander · livré sam 24/10");
  assert.match(p.els.heroT.innerHTML, /Commandé avant 22:00,/);
  for (const s of ["Se connecter", "Devenir client", "Exemple", "Chaque lot a sa carte d'identité", "Comment ça marche", "Une question ce soir ?", "Saumon"]) assert.ok(p.html0.includes(s) || p.html0.includes(s.replace(/'/g, "&#39;")), s);
  const keys = new Set(); for (const m of read("assets/pages/start.js").matchAll(/(?:K\.tt?|fill)\("([^"]+)"/g)) keys.add(m[1]);
  const missing = [...keys].filter((k) => !p.K.FR[k]);
  assert.deepEqual(missing, [], "chaque texte de l'accueil a sa traduction");
});

test("page : un client déjà connecté va droit au catalogue ; ?uit=1 et ?sessie=verlopen gardent leur message", async () => {
  const p = await page({ storage: {}, config: CONFIG, url: "/?uit=1" });
  assert.match(p.html0, /U bent afgemeld\./);
  const e = await page({ config: CONFIG, url: "/?sessie=verlopen" });
  assert.match(e.html0, /Sessie verlopen, meld u opnieuw aan\./);
  assert.match(read("assets/pages/start.js"), /location\.replace\("\/klant#\/catalogus"\)/);
  assert.match(read("assets/pages/start.js"), /K\.api\("\/api\/catalogue", \{ json: \{ user, pw \} \}\)/, "même appel de connexion");
});

// ---------- textes vrais, liens et SEO (HTML statique) ----------
const html = read("index.html");
const body = html.replace(/<head>[\s\S]*<\/head>/, "");
const SRC = [body, read("assets/pages/start.js")].join("\n");

test("textes vrais : aucun créneau, aucune promesse de fonctions absentes, aucune preuve inventée", () => {
  const FORBIDDEN = [/tussen 6 en 8/i, /6\s*[–-]\s*8\s*u/i, /om 6 uur/i, /snijplank/i, /Rauw OK/i, /cru OK/i, /foto bij (af)?levering/i, /zonder (iets )?te annuleren/i,
    /toevoegen zonder/i, /vaste bestelling/i, /levervenster/i, /★/, /\breview/i, /beoordeling/i, /\bMSC\b/, /\bASC\b/, /gecertificeerd/i, /certifi/i, /tevreden klanten/i, /\d+\s*\+?\s*klanten/i, /we antwoorden/i, /€/];
  for (const re of FORBIDDEN) assert.doesNotMatch(SRC, re, String(re));
  assert.match(body, /Voorbeeld/, "la fiche dit qu'elle est un exemple");
  assert.match(body, /Ter illustratie/, "le comptoir dit qu'il illustre");
  assert.match(body, /Bestemd om rauw te eten|Rauw te eten/, "la mention du cru reprend le libellé du portail");
  assert.match(body, /enkel als/i, "le cru est une information du lot quand elle est remplie");
  // Les mentions de la fiche sont celles de la visfiche (spec 035) : libellés exacts du portail.
  const V = require("../assets/visfiche.js");
  assert.ok(JSON.stringify(V).includes("Westelijke Indische Oceaan") && JSON.stringify(V).includes("Lijnen en haken"));
  assert.match(body, /Westelijke Indische Oceaan/); assert.match(body, /Lijnen en haken/);
  assert.match(body, /diepgevroren op −20 °C of kouder, minstens 24 uur in alle delen/);
});

test("liens et SEO préservés : en-tête, évitement, Klant worden, langues, JSON-LD, script du bandeau", () => {
  assert.match(body, /<a class="skip" href="#main">/);
  assert.match(body, /<header[^>]*>[\s\S]*href="#aanmelden"[^>]*>Aanmelden<\/a>[\s\S]*<\/header>/);
  assert.match(body, /href="\/aanvraag"[^>]*>Klant worden</);
  assert.match(body, /href="\/team\/aanmelden"/, "lien Personeel du pied de page");
  assert.match(body, /href="\/"[^>]*>NL</); assert.match(body, /href="\/\?taal=fr"[^>]*>FR</);
  const i = html.indexOf("/assets/tij.js"), j = html.indexOf("/assets/pages/start.js");
  assert.ok(i > 0 && j > i, "tij.js chargé avant start.js");
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(ld["@type"], "LocalBusiness");
  assert.match(ld.description, /vis en zeevruchten/);
  assert.deepEqual(ld.knowsLanguage, ["nl", "fr"]);
  assert.doesNotMatch(JSON.stringify(ld), /tussen|uur|rating|review/i);
});

test("police serif auto-hébergée (CSP font-src 'self') et bloc CSS x30 lot C", () => {
  const css = read("assets/ui.css");
  for (const f of ["instrument-serif-latin-400-normal.woff2", "instrument-serif-latin-400-italic.woff2"]) {
    const buf = fs.readFileSync(path.join(ROOT, "assets/fonts", f));
    assert.equal(buf.slice(0, 4).toString("latin1"), "wOF2", f);
    assert.match(css, new RegExp("url\\(/assets/fonts/" + f.replace(/\./g, "\\.") + "\\?v=[0-9a-f]+\\)"), f);
  }
  assert.match(read("assets/fonts/OFL-instrument-serif.txt"), /SIL Open Font License/);
  assert.match(css, /font-family:"Instrument Serif"/);
  assert.match(css, /\/\* =+ x30 lot C/);
  assert.match(html, /<link rel="preload" href="\/assets\/fonts\/instrument-serif-latin-400-normal\.woff2\?v=[0-9a-f]+" as="font" type="font\/woff2" crossorigin>/);
  for (const f of ["index.html", "assets/ui.css", "assets/pages/start.js"]) assert.doesNotMatch(read(f), /fonts\.(googleapis|gstatic)\.com/, f);
  assert.match(read("vercel.json"), /font-src 'self' data:/);
});
