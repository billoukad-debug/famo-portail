const test = require("node:test");
const assert = require("node:assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
// Charge assets/ui.js dans un faux window pour tester les helpers purs.
const src = fs.readFileSync(path.join(__dirname, "..", "assets", "ui.js"), "utf8");
const win = { document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { add() {}, remove() {} } } }, location: { hash: "", pathname: "/", search: "" }, sessionStorage: null, localStorage: null, addEventListener() {} };
vm.runInNewContext(src, Object.assign(win, { window: win, CustomEvent: class {}, fetch: async () => ({}) }));
const K = win.K;
test("parseLines lit le format des commandes", () => {
  const l = K.parseLines("Zalmfilet × 2 kg [€16.00] (dikke moot)\nScampi × 3 caisse [€15.00]");
  assert.equal(l.length, 2); assert.equal(l[0].qty, 2); assert.equal(l[0].price, 16); assert.equal(l[0].comment, "dikke moot"); assert.equal(l[1].unit, "caisse");
});
test("formatLine ↔ parseLines aller-retour", () => { const s = "Scampi × 3 caisse [€15.00] (opm)"; assert.equal(K.formatLine(K.parseLines(s)[0]), s); });
test("unités traduites en néerlandais", () => { assert.equal(K.unit("caisse"), "kassa"); assert.equal(K.unit("pièce"), "stuk"); assert.equal(K.unit("kg"), "kg"); });
test("statuts et paiements en néerlandais", () => { assert.equal(K.status("Reçue"), "Ontvangen"); assert.equal(K.status("Facturée"), "Geleverd"); assert.equal(K.pay("Payé"), "Betaald"); });
test("eur au format belge", () => { assert.equal(K.eur(1284.5), "€\u00a01.284,50"); assert.equal(K.eur(9.5), "€\u00a09,50"); });
test("isLate : livraison passée et pas livrée", () => { assert.equal(K.isLate({ statut: "Reçue", dateLiv: "2000-01-01" }), true); assert.equal(K.isLate({ statut: "Facturée", dateLiv: "2000-01-01" }), false); assert.equal(K.isLate({ statut: "Reçue", dateLiv: "" }), ""); });
test("K.on remplace un gestionnaire délégué identique au lieu de le cumuler", () => {
  const listeners = new Map();
  const root = {
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev, fn) { if (listeners.get(ev) === fn) listeners.delete(ev); },
    contains: () => true
  };
  let first = 0, second = 0;
  K.on(root, "click", "[data-fav]", () => { first++; });
  K.on(root, "click", "[data-fav]", () => { second++; });
  listeners.get("click")({ target: { closest: () => ({}) } });
  assert.equal(first, 0);
  assert.equal(second, 1);
});
test("parseNum : saisies belges et internationales (FOR-06)", () => {
  const cases = [["1 404,48", 1404.48], ["1.404,48", 1404.48], ["1404.48", 1404.48], ["1,404.48", 1404.48], ["12,5", 12.5], ["12.5", 12.5], ["€ 12,50", 12.5], ["1 404,48", 1404.48], ["1.500", 1500], ["0.375", 0.375], ["0.8", 0.8], ["0,375", 0.375], ["0,5", 0.5], ["-3,2", -3.2], [" 7 ", 7], [5, 5]];
  for (const [inp, out] of cases) assert.equal(K.parseNum(inp), out, JSON.stringify(inp));
  for (const bad of ["", "abc", "1,2,3x", null]) assert.ok(Number.isNaN(K.parseNum(bad)), JSON.stringify(bad));
  assert.equal(K.numIn("1 404,48"), "1404.48"); assert.equal(K.numIn(""), "");
});
test("stepper : champ texte à virgule (un type=number rendait « 0.375 », relu 375 kg)", () => {
  const h = K.c.stepper("x", 0.375, { step: 0.5, name: "Zalm" });
  assert.match(h, /type="text"/); assert.match(h, /value="0,375"/); assert.doesNotMatch(h, /type="number"/);
  assert.equal(K.parseNum("0,375"), 0.375); assert.equal(K.parseNum(K.num(1.125)), 1.125);
});
test("badgeView : pastilles lues (spec 001)", () => {
  const v = K.badgeView;
  // Mode « Nieuw » : seuls les identifiants pas encore vus comptent ; ouvrir la page les marque vus.
  let r = v(["a", "b", "c"], "nieuw", null, false); assert.equal(r.n, 3);
  r = v(["a", "b", "c"], "nieuw", r.seen, true); assert.equal(r.n, 0); assert.deepEqual(r.seen.ids.sort(), ["a", "b", "c"]);
  r = v(["a", "b", "c", "d"], "nieuw", r.seen, false); assert.equal(r.n, 1, "une nouvelle commande");
  r = v(["c", "d"], "nieuw", r.seen, false); assert.equal(r.n, 1); assert.deepEqual(r.seen.ids.sort(), ["c"], "mémoire limitée aux éléments encore présents");
  // Mode « Alles » : tout ce qui reste à traiter, page ouverte ou non.
  assert.equal(v(["a", "b"], "alles", { ids: ["a", "b"] }, true).n, 2);
  // Mode « Uit » : rien.
  assert.equal(v(["a", "b"], "uit", null, false).n, 0); assert.equal(v(5, "uit", null, false).n, 0);
  // Compteur sans liste : hausse depuis la dernière visite ; une baisse abaisse la référence.
  r = v(4, "nieuw", null, false); assert.equal(r.n, 4);
  r = v(4, "nieuw", r.seen, true); assert.equal(r.n, 0);
  r = v(2, "nieuw", r.seen, false); assert.equal(r.n, 0); assert.equal(r.seen.n, 2);
  r = v(3, "nieuw", r.seen, false); assert.equal(r.n, 1);
  assert.equal(v(7, "alles", { n: 7 }, true).n, 7);
  // Mémoire corrompue ou absente : pas d'erreur, tout est « nouveau ».
  assert.equal(v(["a"], "nieuw", "garbage", false).n, 1); assert.equal(v(3, "nieuw", { ids: 5 }, false).n, 3);
  // Mode inconnu = défaut « Nieuw » ; sans stockage (fenêtre privée), K.badgeMode() vaut « nieuw ».
  assert.equal(v(["a"], "???", { ids: ["a"] }, false).n, 0);
  assert.equal(K.badgeMode(), "nieuw");
});
test("orderWindow : heure limite et premier jour livrable (accueil + catalogue, spec 002)", () => {
  const R = { deadline: "22:00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [] };
  // Mercredi 30/09/2026 20:30 : 90 min avant la limite, livraison jeudi 1/10.
  let w = K.orderWindow(R, new Date(2026, 8, 30, 20, 30));
  assert.equal(w.left, 90); assert.equal(w.first, "2026-10-01"); assert.equal(w.open, true);
  // Après 22:00 : fermé, premier jour = vendredi 2/10.
  w = K.orderWindow(R, new Date(2026, 8, 30, 22, 0));
  assert.equal(w.open, false); assert.equal(w.left, 0); assert.equal(w.first, "2026-10-02");
  // Samedi soir avant la limite : pas de livraison le dimanche → lundi.
  assert.equal(K.orderWindow(R, new Date(2026, 9, 3, 18, 0)).first, "2026-10-05");
  // Jour fermé (congé) sauté.
  assert.equal(K.orderWindow(Object.assign({}, R, { geslotenDagen: ["2026-10-01"] }), new Date(2026, 8, 30, 9, 0)).first, "2026-10-02");
  // Règles absentes : valeurs par défaut (22:00, lun–sam).
  assert.equal(K.orderWindow(null, new Date(2026, 8, 30, 21, 0)).left, 60);
});
test("K.klant : l'onglet ne garde que des données d'affichage, jamais un jeton (spec 013, B3)", () => {
  // Fenêtre séparée avec un vrai sessionStorage en mémoire.
  const mem = new Map();
  const ss = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const w = Object.assign({}, win, { sessionStorage: ss, localStorage: null });
  vm.runInNewContext(src, Object.assign(w, { window: w, CustomEvent: class {}, fetch: async () => ({}) }));
  const KK = w.K;
  KK.klant.set({ user: "aloha", token: "k.recX.1.fp.1.0.sig", pw: "geheim", client: { id: "recX", nom: "Aloha", taal: "FR", email: "a@b.c", favorieten: { favorieten: ["p"] } }, company: { iban: "BE00" } });
  assert.deepStrictEqual(JSON.parse(mem.get("famoKlant")), { user: "aloha", client: { id: "recX", nom: "Aloha", taal: "FR" } });
  assert.ok(!/token|geheim|k\.recX|BE00|a@b\.c/.test(mem.get("famoKlant")), "ni jeton, ni mot de passe, ni données inutiles");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(KK.klant.creds())), { user: "aloha" }, "les API reçoivent l'identifiant affiché, le cookie fait le reste");
  // Transition : un jeton laissé par l'ancienne version part encore, puis forgetToken l'efface.
  mem.set("famoKlant", JSON.stringify({ user: "aloha", token: "k.old", client: { nom: "Aloha" } }));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(KK.klant.creds())), { user: "aloha", token: "k.old" });
  KK.klant.forgetToken();
  assert.ok(!mem.get("famoKlant").includes("k.old"), "jeton hérité oublié après un appel réussi");
  assert.equal(JSON.parse(mem.get("famoKlant")).user, "aloha", "toujours affiché comme connecté");
  // Sans identifiant : rien n'est gardé ; pas de session = pas de creds.
  KK.klant.set({ token: "k.x" });
  assert.equal(mem.has("famoKlant"), false);
  assert.equal(KK.klant.creds(), null);
});
