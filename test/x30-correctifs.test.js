"use strict";
// Spec 038 (correctifs x30 après le jugement du 25/10/2026) : session client qui survit à la fermeture de l'onglet sans
// affaiblir la sécurité, redirections vers le formulaire, libellés et statuts de Facturen (ADR 0005 respecté), panier
// mobile, aperçu de document lisible sur téléphone, noms en casse normale, contact « Een vraag? ».
process.removeAllListeners("warning");
process.env.SESSION_SECRET = "sessie-geheim-voor-spec-038-0123456789";
global.fetch = async (u) => { throw new Error("Réseau interdit : " + u); };
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const UI = read("assets/ui.js");

const memStore = () => { const m = new Map(); return { m, api: { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) } }; };
function loadK(local, session) {
  const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: session || null, localStorage: local || null, addEventListener() {} };
  vm.runInNewContext(UI, Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => ({}) }));
  return win.K;
}

test("session : les données d'affichage vont en localStorage et survivent à la fermeture de l'onglet", () => {
  const L = memStore(), S1 = memStore();
  const K1 = loadK(L.api, S1.api);
  K1.klant.set({ user: "aloha", token: "k.recX.1.fp.1.0.sig", pw: "geheim", client: { id: "recX", nom: "Aloha", taal: "NL", email: "a@b.c" } });
  assert.ok(L.m.has("famoKlant"), "écrit sur l'appareil");
  assert.equal(S1.m.has("famoKlant"), false, "plus dans l'onglet");
  assert.ok(!/token|geheim|k\.recX|a@b\.c/.test(L.m.get("famoKlant")), "jamais de jeton, de mot de passe ni de donnée inutile");
  // Nouvel onglet (sessionStorage vide), même appareil : toujours affiché comme connecté ; le cookie reste la seule preuve.
  const K2 = loadK(L.api, memStore().api);
  assert.equal(K2.klant.get().user, "aloha");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(K2.klant.creds())), { user: "aloha" });
  // Déconnexion / expiration : tout est effacé, sur l'appareil et dans l'onglet.
  K2.klant.clear();
  assert.equal(L.m.has("famoKlant"), false);
  assert.equal(K2.klant.get(), null);
});

test("session : un onglet d'avant la spec 038 est repris ; sans localStorage, l'onglet sert de repli", () => {
  const L = memStore(), S = memStore();
  S.m.set("famoKlant", JSON.stringify({ user: "aloha", client: { id: "recX", nom: "Aloha", taal: "FR" } }));
  const K = loadK(L.api, S.api);
  assert.equal(K.klant.get().user, "aloha");
  assert.ok(L.m.has("famoKlant") && !S.m.has("famoKlant"), "migré vers l'appareil");
  // Un ancien jeton (transition spec 013) n'est jamais recopié sur l'appareil.
  const L2 = memStore(), S2 = memStore();
  S2.m.set("famoKlant", JSON.stringify({ user: "aloha", token: "k.old" }));
  const K2 = loadK(L2.api, S2.api);
  assert.equal(K2.klant.get().token, "k.old");
  assert.equal(L2.m.has("famoKlant"), false, "le jeton hérité ne quitte pas l'onglet");
  K2.klant.forgetToken();
  assert.ok(L2.m.has("famoKlant") && !L2.m.get("famoKlant").includes("k.old"));
  // Navigation privée : localStorage indisponible → l'onglet garde la session, comme avant.
  const S3 = memStore(), K3 = loadK(null, S3.api);
  K3.klant.set({ user: "kaai" });
  assert.equal(JSON.parse(S3.m.get("famoKlant")).user, "kaai");
  K3.klant.clear(); assert.equal(S3.m.has("famoKlant"), false);
});

test("session : le cookie famo_klant reste la seule preuve, HttpOnly, persistant mais borné au jeton (12 h)", () => {
  const ca = require("../lib/clientauth");
  const rec = { id: "recCLA", fields: { Wachtwoord: ca.hashPassword("welkom123") } };
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; }, getHeader: k => headers[k] };
  ca.setSessionCookie(res, ca.issueToken(rec));
  const c = String(headers["Set-Cookie"]);
  assert.match(c, /^famo_klant=/); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\/api/);
  const maxAge = Number((/Max-Age=(\d+)/.exec(c) || [])[1]);
  assert.ok(maxAge > 43000 && maxAge <= 12 * 3600, "persistant (survit à la fermeture) mais jamais plus long que le jeton : " + maxAge);
  assert.equal(ca.TOKEN_TTL_MS, 12 * 3600 * 1000, "durée du jeton inchangée");
  assert.equal(ca.MAX_AGE_MS, 7 * 24 * 3600 * 1000, "plafond de 7 jours après la connexion inchangé");
  // Un jeton renouvelé 7 jours après la connexion n'est plus émis au-delà du plafond.
  const old = ca.issueToken(rec, Date.now() - ca.MAX_AGE_MS + 60000);
  assert.ok(Number(old.split(".")[2]) <= Date.now() + 61000);
});

test("redirections : sans session, expirée ou après déconnexion, on arrive sur le formulaire", () => {
  const k = read("assets/pages/klant.js");
  assert.match(k, /if \(!sess \|\| !sess\.user\) \{ location\.replace\("\/#aanmelden"\); return; \}/);
  assert.match(k, /location\.replace\("\/\?sessie=verlopen#aanmelden"\)/);
  assert.match(k, /location\.href = "\/\?uit=1#aanmelden"/);
  assert.ok(!/location\.replace\("\/"\)/.test(k), "plus de retour en haut de la vitrine");
  const s = read("assets/pages/start.js");
  assert.match(s, /if \(expired \|\| loggedOut \|\| location\.hash === "#aanmelden"\) setTimeout\(\(\) => toLogin\(false\), 0\);/);
  assert.match(s, /const sec = document\.getElementById\("loginForm"\)/, "le défilement vise le formulaire lui-même");
  // Le formulaire suit le héros (avant la fiche exemple et « Zo werkt het »), dans le script et dans le HTML statique.
  for (const src of [s, read("index.html")]) {
    const login = src.indexOf('id="aanmelden"'), id = src.indexOf('aria-labelledby="idT"'), how = src.indexOf('aria-labelledby="howT"'), hero = src.indexOf('aria-labelledby="heroT"');
    assert.ok(hero > 0 && hero < login && login < id && id < how, "ordre : héros, connexion, fiche, étapes");
  }
  // Erreur de connexion : un seul message, sans « Er ging iets mis. » devant.
  assert.match(s, /err\.status === 401 \? '<div class="notice err" role="alert"><i>!<\/i><div><b>' \+ K\.t\("Gebruikersnaam of wachtwoord klopt niet\."\)/);
  // « Tonen » n'est plus exempté du contrôle des 44 px.
  assert.ok(!/id="togglePw" data-ux-exempt/.test(s));
});

test("Facturen : mode boekhouder lisible sans facture inventée (ADR 0005)", () => {
  const k = read("assets/pages/klant.js");
  assert.match(k, /const invLabel = \(\) => \(portaal\(\) \? K\.t\("Factuur"\) : K\.t\("Overzicht · pro forma"\)\);/);
  assert.ok(!/K\.t\("Pro forma"\)/.test(k), "plus de « Pro forma » nu");
  // Numéro identique au document (PF- en mode boekhouder).
  assert.match(k, /const docNr = o => \(o\.factuurnummer \? \(portaal\(\) \? o\.factuurnummer : "PF-" \+ String\(o\.factuurnummer\)\.replace\(\/\^FA-\/i, ""\)\) : ""\);/);
  // Statut : échéance calculée par le serveur (vervaldatum), ambre avant, rouge après ; sans échéance, « niet betaald ».
  assert.match(k, /const payBadge = o => !o\.vervaldatum \? .*"Geleverd · niet betaald".* : o\.vervaldatum < K\.today\(\) \? .*c-late.*"Vervallen sinds \{d\}".* : .*c-new.*"Te betalen vóór \{d\}"/);
  // Le relevé reste caché en mode boekhouder (inchangé) et le montant dû aussi.
  assert.match(k, /if \(co\.facturatie !== "portaal"\) return "";/);
  assert.match(k, /portaal\(\) && o\.openstaand != null \? row\(K\.t\("Nog te betalen"\)/);
  // Une seule action par ligne de Facturen.
  assert.match(k, /if \(fac\) return '<button type="button" class="btn btn-o btn-sm" data-doc="invoice"' \+ r \+ '>' \+ K\.t\("Bekijken"\) \+ '<\/button>';/);
});

test("Leveringen et détail : pas de « Opnieuw bestellen » sur une commande modifiable ; annuler dans Wijzigen", () => {
  const k = read("assets/pages/klant.js");
  assert.match(k, /\(o\.aanpasbaar \? btn\('data-edit-order="' \+ K\.esc\(o\.ref\) \+ '"', K\.t\("Wijzigen"\), "btn-p"\) : btn\('data-reorder=/);
  assert.match(k, /\(!o\.aanpasbaar && \(o\.statut === "Reçue" \|\| o\.statut === "Prête"\) \? btn\(/);
  assert.match(k, /data-cancel-order="' \+ K\.esc\(o\.ref\) \+ '">' \+ K\.t\("Hele bestelling annuleren"\)/);
  assert.match(k, /\(o\.aanpasbaar \? "" : '<button type="button" class="btn btn-ghost btn-sm" data-reorder=/);
});

test("noms en casse normale et quantités en kilos (affichage seulement, la donnée reste intacte)", () => {
  const FB = require("../assets/bestellen.js");
  assert.equal(FB.naam("ZEEWIERSALADE 1KG"), "Zeewiersalade 1 kg");
  assert.equal(FB.naam("VISSOEP 500G"), "Vissoep 500 g");
  assert.equal(FB.naam("INKTVIS TUBES U5"), "Inktvis tubes U5");
  assert.equal(FB.naam("Saumon frais"), "Saumon frais");
  const k = read("assets/pages/klant.js");
  assert.match(k, /const lineTxt = \(qty, name, unit\) => kgUnit\(unit\) \? FB\.naam\(name\) \+ " " \+ K\.qty\(qty\) \+ " kg" : K\.qty\(qty\) \+ "× " \+ FB\.naam\(name\);/);
  assert.match(k, /<span class="orow-s">' \+ K\.esc\(sumTxt\(o\)\)/, "résumé de ligne");
  assert.ok(!/K\.linesSummary\(o\.lignes/.test(k), "plus de résumé en capitales");
  // Fonction pure reproduite pour vérifier le format.
  const K = loadK();
  const kgUnit = u => /^kg$/i.test(String(u || "").trim());
  const lineTxt = (qty, name, unit) => kgUnit(unit) ? FB.naam(name) + " " + K.qty(qty) + " kg" : K.qty(qty) + "× " + FB.naam(name);
  assert.equal(lineTxt(4.5, "Saumon frais", "kg"), "Saumon frais 4,5 kg");
  assert.equal(lineTxt(3, "ZEEWIERSALADE 1KG", "pièce"), "3× Zeewiersalade 1 kg");
});

test("panier mobile : bouton fixe, opmerking repliée, autre jour replié au format belge", () => {
  const k = read("assets/pages/klant.js"), css = read("assets/ui.css");
  assert.match(k, /'<div class="kplace"><button type="button" class="btn btn-p btn-block btn-tall" id="placeOrder"/);
  assert.match(css, /@media \(max-width:719px\)\{\n\s*\.kplace\{position:fixed;left:0;right:0;bottom:calc\(68px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(k, /noteHtml\(p\.id, K\.t\("Opmerking bij"\) \+ " " \+ toon\(p\), "c"\)/, "panier");
  assert.match(k, /noteHtml\(p\.id, K\.t\("Opmerking bij dit artikel"\), "pr-c"\)/, "fiche");
  assert.match(k, /\(v \? "" : '<button type="button" class="kn-add" data-note-open="' \+ id \+ '" aria-expanded="false">\+ ' \+ K\.t\("opmerking"\)/);
  assert.match(k, /<details class="kday mt-8"><summary class="tlink tap-44">' \+ K\.t\("Andere dag…"\)/);
  assert.match(k, /days\.concat\(otherDay && cart\.day \? \[cart\.day\] : \[\]\)\.map\(d => .*K\.date\(d\)/, "le jour choisi s'affiche comme un bouton jj/mm");
  // Toast au-dessus des onglets et de la barre panier.
  assert.match(css, /body:has\(\.cartbar\) \.toasts,body:has\(\.kplace\) \.toasts\{bottom:calc\(150px/);
});

test("aperçu de document : vue lisible sous 600 px, sans toucher au PDF ni à l'impression ; plus de bouton « Annuleren »", () => {
  const src = read("assets/docs/voorbeeld.js");
  assert.ok(!/data-famo-doc="cancel"/.test(src));
  const win = {};
  vm.runInNewContext(src, { window: win, global: win, document: {}, Intl, Blob: class {}, URL });
  const P = win.famoDocPreview;
  const html = P.withNarrow("<!doctype html><html><head><style>body{padding:40px}</style></head><body><h1>X</h1></body></html>");
  assert.match(html, /<style id="famo-narrow">@media screen and \(max-width:600px\)\{/);
  assert.ok(html.indexOf('id="famo-narrow"') < html.indexOf("</head>"));
  // Le PDF reprend les styles du document mais jamais la vue téléphone.
  const rule = (sel, css) => ({ type: 1, selectorText: sel, style: { cssText: css } });
  const doc = { styleSheets: [{ ownerNode: { id: "" }, cssRules: [rule("body", "padding: 40px;")] }, { ownerNode: { id: "famo-narrow" }, cssRules: [rule(".lines td", "display: block;")] }] };
  const css = P.scopedCss(doc, ".famo-pdf-root");
  assert.match(css, /padding: 40px/);
  assert.ok(!/display: block/.test(css), "la vue téléphone n'entre pas dans le PDF");
});

test("fiche produit sur téléphone : carte d'identité d'abord, petite galerie ensuite", () => {
  const css = read("assets/ui.css");
  assert.match(css, /@media \(max-width:480px\)\{\n\s*\.kl\[data-view=x30\] \.pr-d>\.pr-info\{order:1\}\n\s*\.kl\[data-view=x30\] \.pr-d>\.gal,\.kl\[data-view=x30\] \.pr-d>\.x-plate-l\{order:2;width:min\(180px,56%\)\}/);
});

test("contact « Een vraag? » : WhatsApp seulement si un numéro est configuré ; compte sans réglage développeur", () => {
  const k = read("assets/pages/klant.js");
  assert.match(k, /const co = Object\.assign\(\{\}, \(cat && cat\.company\) \|\| \{\}, pub \|\| \{\}\), wa = K\.waLink\(co\.whatsapp\);/);
  assert.match(k, /return \[wa \? '<a class="btn btn-o kq-btn" href="' \+ K\.esc\(wa\)/);
  assert.match(k, /K\.api\("\/api\/config\?public=1"\)/, "numéros lus dans la configuration publique, rien d'inventé");
  assert.ok(!/K\.badgeSwitch\(\)/.test(k), "« Tellers in het menu » retiré du compte client");
  assert.match(k, /const body = '<div class="full">' \+ contactCard\(\)/, "contact en haut du compte");
  assert.match(k, /K\.t\("Verder bestellen"\) \+ '<\/a>' \+ contactCard\(\)/, "contact sur la confirmation");
  assert.ok(!/maxw-320" id="logout"/.test(k), "Uitloggen sur toute la largeur");
  const K = loadK();
  assert.equal(K.waLink(""), "", "sans numéro : pas de bouton");
  // Demande d'accès : WhatsApp aussi conditionnel.
  assert.match(read("assets/pages/aanvraag.js"), /wa \? item\(wa, K\.icon\("wa"\)/);
});

test("textes nouveaux traduits en français", () => {
  const K = loadK();
  for (const s of ["Een vraag?", "Bel, stuur een WhatsApp of mail Famo.", "Bel of mail Famo.", "opmerking", "Andere dag…", "Aanpasbaar {tot}", "Geleverd · niet betaald",
    "Vervallen sinds {d}", "Te betalen vóór {d}", "Te betalen vóór", "Overzicht · pro forma", "Lotnummer en herkomst per lot: zie de leveringsbon.",
    "Hele bestelling annuleren", "Uw vaste producten en standaardbestelling", "Ster", "Nog geen vaste producten", "+ {n} bij uw vaste", "Uw gegevens",
    "Liever even bellen?", "Uw afgesproken prijzen", "Herkomst, staat en allergenen per product; lotnummer op de leveringsbon.",
    "Wat u vaak bestelt, komt hier vanzelf. U kunt ook een ster zetten bij een product in Bestellen.",
    "Iets vergeten? Tik + in de lijst hieronder en bestel uw winkelmand: het komt bij deze bestelling."]) assert.ok(K.FR[s], "FR manquant : " + s);
});

test("spec 038 documentée (session, cookie) et note « Nieuw » pour Mohsen", () => {
  const spec = read("specs/038-x30-correctifs/spec.md");
  assert.match(spec, /Max-Age/); assert.match(spec, /localStorage/); assert.match(spec, /12 h/);
  assert.match(read("assets/nieuws.js"), /spec: "038"/);
});
