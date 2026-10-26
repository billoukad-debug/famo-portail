(function () {
  const sess = K.klant.get();
  if (!sess || !sess.user) { location.replace("/#aanmelden"); return; } // spec 038 : droit naar het formulier
  const app = document.getElementById("app");
  const FAV_KEY = "famoFav:" + sess.user, CART_KEY = "famoCart:" + sess.user, STD_KEY = "famoStd:" + sess.user, CAT_KEY = "famoKlantCatalogus";
  let cat = null; // {products, client, company}
  let cart = K.store.get(CART_KEY, { items: {}, comments: {}, note: "", day: "" });
  let favs = K.store.get(FAV_KEY, {});
  let std = K.store.get(STD_KEY, null); // {productId: qty}
  let orders = null, ordersMeta = { gewoonte: null, vaste: [] }, lastOrder = K.session.get("famoLastOrder", null), panel = null;
  // x30 (specs/036) : règles pures de l'écran Bestellen (assets/bestellen.js) — bandeau, groupes, noms, plaques, Rauw OK.
  const FB = window.FamoBestellen;
  const toon = p => FB.naam(p.nom); // nom affiché en casse normale ; la donnée (p.nom) reste intacte
  // Ligne de commande lisible (spec 038) : « Saumon frais 4,5 kg », « 3× Zeewiersalade 1 kg » ; noms en casse normale.
  const kgUnit = u => /^kg$/i.test(String(u || "").trim());
  const lineTxt = (qty, name, unit) => kgUnit(unit) ? FB.naam(name) + " " + K.qty(qty) + " kg" : K.qty(qty) + "× " + FB.naam(name);
  const sumTxt = o => K.parseLines(o.lignes).map(l => { const n = K.pakCount(l.qty, l.unit, K.pakIn(o.verpakking, l.name)); return lineTxt(l.qty, l.name, l.unit) + (n ? " (" + n + ")" : ""); }).join(" · ");
  // « Een vraag? » (spec 038) : WhatsApp enkel als er een nummer ingesteld is (publieke configuratie), telefoon, e-mail.
  let pub = null;
  const loadPub = () => (pub ? Promise.resolve(pub) : K.api("/api/config?public=1").then(d => { pub = (d && d.config) || {}; return pub; }).catch(() => ({})));
  function contactBtns() {
    const co = Object.assign({}, (cat && cat.company) || {}, pub || {}), wa = K.waLink(co.whatsapp);
    return [wa ? '<a class="btn btn-o kq-btn" href="' + K.esc(wa) + '" target="_blank" rel="noopener">' + K.icon("wa") + K.t("WhatsApp") + '</a>' : "",
      co.telefoon ? '<a class="btn btn-o kq-btn" href="tel:' + K.esc(K.telHref(co.telefoon)) + '">' + K.icon("phone") + '<span>' + K.esc(co.telefoon) + '</span></a>' : "",
      co.email ? '<a class="btn btn-o kq-btn" href="mailto:' + K.esc(co.email) + '">' + K.icon("mail") + '<span>' + K.esc(co.email) + '</span></a>' : ""].join("");
  }
  const contactTxt = () => K.t(K.waLink(Object.assign({}, (cat && cat.company) || {}, pub || {}).whatsapp) ? "Bel, stuur een WhatsApp of mail Famo." : "Bel of mail Famo.");
  const contactCard = () => '<section class="mcard kq" data-kq aria-labelledby="kqT"><h2 class="kq-h" id="kqT">' + K.t("Een vraag?") + '</h2><p class="quiet fs-13 m-0 kq-t">' + contactTxt() + '</p><div class="kq-b">' + contactBtns() + '</div></section>';
  // Na het laden van de publieke configuratie : de knoppen opnieuw (WhatsApp verschijnt als er een nummer is).
  const fillContact = () => loadPub().then(() => K.$$("[data-kq]", app).forEach(b => { b.querySelector(".kq-b").innerHTML = contactBtns(); b.querySelector(".kq-t").textContent = contactTxt(); }));
  const saveCart = () => K.store.set(CART_KEY, cart);
  const byId = id => (cat.products || []).find(p => p.id === id);
  const cartCount = () => Object.values(cart.items).reduce((a, b) => a + (Number(b) > 0 ? 1 : 0), 0);
  const cartTotal = () => Object.entries(cart.items).reduce((s, [id, q]) => { const p = byId(id); return s + (p ? p.prix * Number(q) : 0); }, 0);
  const isKg = p => /kg/i.test(p.unite || "");
  const unitLabel = p => K.unit(p.unite);
  // Verpakking (spec 023) : prix par unité, winkelmand en unités (comme la commande) ; un article « enkel per
  // verpakking » se règle par conditionnement (stepper « − 2 doos + »), le serveur refuse le reste.
  const pakP = p => K.pakOf(p);
  const stepUnits = p => K.pakStep(p); // unités par pas du stepper (1 sans « enkel per verpakking »)
  const qtyTxt = (p, q) => (pakP(p) ? K.pakQty(q, p.unite, pakP(p)) : K.qty(q));
  const fitQty = (p, q) => { const n = stepUnits(p); return n > 1 && q > 0 ? Math.max(1, Math.round(q / n)) * n : q; };
  const stepperOf = (p, q) => { const n = stepUnits(p), k = pakP(p), v = Number(q || 0); return n > 1 ? K.c.stepper(p.id, v / n, { step: 1, name: toon(p), suffix: K.pakLabel(k.label, v / n), label: K.t("Aantal") + " (" + K.pakOne(k, p.unite) + ")" }) : K.c.stepper(p.id, v, { step: isKg(p) ? 0.5 : 1, name: toon(p) }); };
  const pakCaption = (p, q) => (pakP(p) && Number(q) > 0 ? '<div class="pak-q" data-pakq="' + p.id + '">' + K.esc(K.pakQty(q, p.unite, pakP(p))) + '</div>' : "");
  const creds = () => K.klant.creds();
  // 401 op eender welke klant-API : opgeslagen gegevens wissen en terug naar de aanmelding (met melding).
  function expire() { K.klant.clear(); K.session.del(CAT_KEY); location.replace("/?sessie=verlopen#aanmelden"); }
  // Na een geslaagd verzoek staat de sessie in de HttpOnly-cookie : een oud token in dit tabblad (overgang) wordt gewist.
  const api = async (url, opts) => { try { const d = await K.api(url, opts); K.klant.forgetToken(); return d; } catch (err) { if (err.status === 401) expire(); throw err; } };

  /* ---------- leveringsregels (company.levering, zelfde bron als lib/levering.js) ---------- */
  // Standaardregels = lib/levering DEFAULTS ; enkel gebruikt zolang company.levering ontbreekt (oude cache).
  const CUTOFF_HOUR = 22, MAX_DAYS_AHEAD = 60;
  const DEF_RULES = { deadline: CUTOFF_HOUR + ":00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [], minimum: 0, maxDagen: MAX_DAYS_AHEAD };
  const DAY_KEYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const rules = () => Object.assign({}, DEF_RULES, (cat && cat.company && cat.company.levering) || {});
  const deadline = () => rules().deadline;
  const dow = iso => { const d = K.parseDate(iso); return d ? d.getDay() : -1; };
  const deliverable = iso => { const r = rules(); return r.leverdagen.includes(DAY_KEYS[dow(iso)]) && !r.geslotenDagen.includes(iso); };
  // Eerste leverbare dag : morgen (na de deadline overmorgen), daarna de eerste leverdag die niet gesloten is.
  const firstDay = () => K.orderWindow(rules()).first;
  const lastDay = () => K.addDays(K.today(), rules().maxDagen);
  // Zelfde volgorde en meldingen als checkDate in lib/levering.js ; de deadline komt er client-side bij.
  const dayErr = iso => {
    const r = rules();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "") || K.isoDay(iso) !== iso) return K.t("Ongeldige leverdag");
    if (iso < K.today()) return K.t("De leverdag ligt in het verleden");
    if (iso > lastDay()) return K.tt("Kies een leverdag binnen de komende {n} dagen", { n: r.maxDagen });
    const d = dow(iso);
    if (!r.leverdagen.includes(DAY_KEYS[d])) return d === 0 ? K.t("Op zondag leveren we niet") : K.t("Op die dag leveren we niet");
    if (r.geslotenDagen.includes(iso)) return K.t("Op die dag zijn we gesloten");
    if (iso < firstDay()) return K.tt("Die dag is te vroeg: de eerste mogelijke leverdag is {d}.", { d: K.dateLong(firstDay()) });
    return "";
  };
  const dayOk = iso => !dayErr(iso);
  const nextDays = () => { const out = []; let d = firstDay(), n = 0; while (out.length < 6 && n++ < 400 && d <= lastDay()) { if (deliverable(d)) out.push(d); d = K.addDays(d, 1); } return out; };
  const daysLabel = () => rules().leverdagen.map(k => K.t(k)).join(", ");
  const minimum = () => Number(rules().minimum) || 0;

  /* ---------- beschikbaarheid (enkel als de server een voorraad meestuurt) ---------- */
  const stock = p => (typeof p.voorraad === "number" ? p.voorraad : null);
  const capQty = (p, v) => { const s = stock(p); if (s == null) return v; const n = stepUnits(p); return Math.min(v, Math.max(0, n > 1 ? Math.floor(s / n + 1e-9) * n : s)); };
  // Visfiche (spec 035) : « ontdooid » is een verplichte vermelding, dus zichtbaar op de regel zelf ; de rest in de details.
  const thawTag = p => p.vis && p.vis.staat === "Ontdooid" ? '<span class="tag">' + K.t("ontdooid") + '</span>' : "";
  const stockTag = p => { const s = stock(p); if (s == null) return ""; return s > 0 ? '<span class="tag">' + K.esc(K.tt("Nog {n}", { n: K.qty(s) })) + '</span>' : '<span class="tag t-danger">' + K.t("Uitverkocht") + '</span>'; };

  /* ---------- favorieten : server (Clients.Favorieten) eerst, localStorage als cache ---------- */
  let syncTimer = null, favWarned = false, favsAdopted = false;
  function syncFavs() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try { await api("/api/klantorder", { json: Object.assign({}, creds(), { action: "favorites", favorieten: Object.keys(favs), standaard: std || {} }) }); }
      catch (err) { if (err.status !== 401 && !favWarned) { favWarned = true; K.toast(K.t("Favorieten bewaren mislukt. Ze blijven op dit toestel."), { kind: "err" }); } }
    }, 1200);
  }
  // Le catalogue en cache (sessionStorage, 10 min) garde la copie serveur à jour : un rechargement ne ramène pas l'ancienne liste.
  function cacheFavs() { if (!cat || !cat.client) return; cat.client = Object.assign({}, cat.client, { favorieten: { favorieten: Object.keys(favs), standaard: std || {} } }); K.session.set(CAT_KEY, cat); }
  const setFav = (id, on) => { if (on) favs[id] = true; else delete favs[id]; K.store.set(FAV_KEY, favs); cacheFavs(); syncFavs(); };
  const setStd = v => { std = v; K.store.set(STD_KEY, std); cacheFavs(); syncFavs(); };
  // Bij een verse catalogus : wat op de server staat wint ; staat daar niets en hier wel (oud toestel), dan gaat dit toestel naar boven.
  function adoptFavs(client) {
    const f = client && client.favorieten; if (!f) return;
    const list = Array.isArray(f.favorieten) ? f.favorieten : [], sd = f.standaard && typeof f.standaard === "object" ? f.standaard : {};
    if (list.length || Object.keys(sd).length) { favs = Object.fromEntries(list.map(id => [id, true])); std = Object.keys(sd).length ? sd : null; K.store.set(FAV_KEY, favs); K.store.set(STD_KEY, std); }
    else if (Object.keys(favs).length || (std && Object.keys(std).length)) syncFavs();
  }

  // Kop : op de telefoon enkel de tabbalk onderaan ; op de computer één kopbalk met merk, tabs en winkelmand.
  function shell(active, inner, top) {
    const co = (cat && cat.company) || {}, a = document.activeElement, onTitle = !!(a && a.tagName === "H1" && app.contains(a));
    app.innerHTML = '<a class="skip" href="#kmain">' + K.t("Naar de inhoud") + '</a><div class="kwrap x30 kv-' + (K.hashParams().path || active) + '"><header class="khead"><a class="kbrand" href="#/catalogus"><span class="logo" aria-hidden="true"></span><b>' + K.esc(co.bedrijfsnaam || "FAMO Seafood") + '</b></a>' + K.klantTabs(active) + '<a class="kcartlink" id="kcartlink" href="#/winkelmand">' + cartLinkHtml() + '</a></header>' + tideHtml() + '<main class="kmain" id="kmain" tabindex="-1">' + (top || "") + inner + '</main></div>';
    updateTide();
    if (onTitle) K.focusTitle(app); // vue redessinée (données arrivées) : le focus reste sur son titre
  }
  /* ---------- x30 X2 : bandeau de l'heure, sur tout le portail (heure de Bruxelles, règles de Configuratie) ---------- */
  // « Nog 1 u 12 · geleverd ma 26/10 » ; ambre la dernière demi-heure ; après l'heure limite, le jour suivant.
  // Aucune heure de livraison n'est annoncée : le réglage « Levervenster » n'existe pas encore (FB.venster).
  const klok = () => FB.klok(rules());
  function tideHtml() {
    return '<div class="x-tide" id="xTide"><p class="x-tide-t"><span class="x-dot" aria-hidden="true"></span><span id="xTideT"></span></p><span class="x-bar" aria-hidden="true"><i id="xTideBar"></i></span></div>';
  }
  let tideDay = "";
  function updateTide() {
    const box = document.getElementById("xTide"); if (!box || !cat) return;
    const k = klok(), t = FB.klokTekst(k, K.lang);
    document.getElementById("xTideT").innerHTML = '<b>' + K.esc(t.rest) + '</b> · ' + K.esc(t.levering);
    box.classList.toggle("x-amber", k.amber);
    const bar = document.getElementById("xTideBar"); if (bar) bar.style.transform = "scaleX(" + k.vulling.toFixed(3) + ")";
    // Heure limite passée pendant que l'écran est ouvert : la carte « Zoals elke … » suit le nouveau jour.
    if (tideDay && tideDay !== k.levering && K.hashParams().path === "catalogus") { orders = null; ensureOrders().then(renderUsual).catch(() => {}); }
    tideDay = k.levering;
  }
  setInterval(updateTide, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") updateTide(); });
  // « tot 22:00 » le jour même, sinon « tot zo 22:00 » : l'heure limite de la veille d'une livraison.
  // Court, pour tenir dans une pastille à 390 px : le jour de la semaine suffit (l'heure limite tombe au plus tard la veille).
  const totTxt = dag => { const k = klok(), dl = FB.addDays(dag, -1), wd = FB.kort(dl, K.lang).split(" ")[0]; return K.lang === "fr" ? "jusqu'à " + (dl === k.vandaag ? "" : wd + " ") + k.deadline : "tot " + (dl === k.vandaag ? "" : wd + " ") + k.deadline; };

  function cartLinkHtml() {
    const n = cartCount();
    return K.icon("cart") + '<span class="kcl-t">' + K.t("Winkelmand") + '</span>' + (n ? '<b class="kbadge">' + n + '</b><span class="mono">' + K.eur(cartTotal()) + '</span>' : "");
  }
  function topbar(title, sub, right) {
    return '<div class="mtop"><div class="mrow"><span class="logo" aria-hidden="true"></span><div class="grow"><h1 class="ktitle">' + K.esc(title) + '</h1><span class="quiet ksub">' + K.esc(sub || "") + '</span></div>' + (right || "") + '</div></div>';
  }

  async function loadCatalogue(force) {
    const cached = K.session.get(CAT_KEY, null);
    // Le cache peut venir de la page de connexion (start.js) : ses favoris serveur sont repris une fois par chargement.
    if (!force && cached && Date.now() - cached.at < 10 * 60 * 1000) { cat = cached; if (!favsAdopted) { favsAdopted = true; adoptFavs(cat.client); } return cat; }
    const d = await api("/api/catalogue", { json: creds(), retry: true }); // de server vernieuwt de sessiecookie
    cat = { at: Date.now(), products: d.products || [], client: d.client, company: d.company, voorwaarden: d.voorwaarden || null };
    K.session.set(CAT_KEY, cat);
    K.klant.set({ user: sess.user, client: d.client });
    favsAdopted = true; adoptFavs(d.client);
    return cat;
  }
  async function loadOrders(force) {
    if (orders && !force) return orders;
    const d = await api("/api/orders", { json: creds(), retry: true });
    orders = d.orders || [];
    ordersMeta = { gewoonte: d.gewoonte || null, vaste: Array.isArray(d.vaste) ? d.vaste : [] };
    K.setBadges({ facturen: orders.filter(o => o.statut === "Facturée" && o.paiement !== "Payé").map(o => o.id || o.ref) });
    K.session.set("famoKlantOrdersAt", Date.now());
    return orders;
  }
  const ensureOrders = () => (orders ? Promise.resolve(orders) : loadOrders(true));
  // Pastille « Facturen » (factures à payer) : les commandes sont relues au plus toutes les 15 min en arrière-plan.
  function refreshOrderBadge() {
    const at = K.session.get("famoKlantOrdersAt", 0);
    if (orders || Date.now() - at < 15 * 60 * 1000) return;
    loadOrders(true).catch(() => {});
  }

  /* ---------- catalogus = « Bestellen » (x30, specs/036) ---------- */
  // Eén weergave, doordacht (de drie weergaven en de sortering van spec 019 zijn weg : het audit x30 telde 268 px
  // gereedschap vóór het eerste product). Bovenaan « Zoals elke maandag » (X1) ; daarna zoeken, filters (Alles, Uw vaste,
  // Rauw OK, vakgroepen) en de lijst per vakgroep. Per product één « + » van 44 px : een tik zet één stap in de winkelmand,
  // daarna toont de knop het aantal ; het stappenvenster staat in de details (telefoon) of naast de prijs (brede lijst).
  const REST = "__overige"; // familie « Overige » : de producten zonder familie
  const ALL = "Alles", VAST = "Uw vaste producten", RAW = "Rauw OK";
  let q = "", catFilter = ALL, famFilter = "", CS = null;
  const opened = new Set();
  // Zichten van een product : fotos (spec 018), of enkel foto (oude cache in sessionStorage).
  const photosOf = p => (Array.isArray(p.fotos) && p.fotos.length ? p.fotos : p.foto ? [p.foto] : []);
  // Prijs : onderhandelde prijs groot, publieke prijs klein en doorstreept, « uw prijs » (DESIGN : het prijzenpaar).
  const priceHtml = p => '<div class="pp"><span class="pp-m"><b class="mono">' + K.eur(p.prix) + '</b> <span class="quiet">/ ' + K.esc(unitLabel(p)) + '</span></span>' + (p.prix < p.base ? '<span class="pp-u"><s class="mono">' + K.eur(p.base) + '</s> <small>' + K.t("uw prijs") + '</small></span>' : "") + pakPrice(p) + '</div>';
  // « doos van 6 = € 6,00 » : prix du conditionnement, calculé du prix unitaire (le serveur facture en unités).
  const pakPrice = p => { const k = pakP(p); return k ? '<span class="pp-k">' + K.esc(K.pakOne(k, p.unite)) + ' = <b class="mono">' + K.eur(window.FamoVat.r2(p.prix * k.per)) + '</b></span>' : ""; };
  // Plaque d'espèce (sans photo) : aplat de couleur + forme simple (symboles #x-s-* ajoutés une fois au document).
  const plate = (p, cls) => '<span class="x-pl x-pl-' + FB.soort(p) + (cls ? " " + cls : "") + '" aria-hidden="true"><svg viewBox="0 0 200 120"><use href="#x-s-' + FB.soort(p) + '"/></svg></span>';
  const thumbOf = (p, cls) => { const f = photosOf(p)[0]; return f ? K.thumb(f, "", "pr-th " + cls) : plate(p, cls); };
  const rawOk = p => FB.rauwOk(p.vis);
  // Herkomstregel : Latijnse naam · herkomst (visfiche, spec 035), anders kaliber en eenheid.
  function originHtml(p) {
    const VI = window.FamoVis, v = p.vis || {}, kal = p.kaliber && K.searchKey(p.nom).indexOf(K.searchKey(p.kaliber)) < 0 ? p.kaliber : "";
    const parts = [v.wetenschappelijkeNaam ? "<i>" + K.esc(v.wetenschappelijkeNaam) + "</i>" : ""].concat((VI && Object.keys(v).length ? VI.originParts(v, K.lang).slice(0, 2) : []).map(K.esc));
    if (kal) parts.push(K.esc(kal)); if (pakP(p)) parts.push(K.esc(K.pakOne(pakP(p), p.unite)));
    return parts.filter(Boolean).join(" · ");
  }
  // Badges : Rauw OK (spec 035 : rauw + gekozen behandeling), staat (ontdooid is verplicht), voorraad.
  function tagsHtml(p) {
    const v = p.vis || {};
    return (rawOk(p) ? '<span class="tag x-tag-raw">' + K.t("Rauw OK") + '</span>' : "") + (v.staat === "Diepgevroren" ? '<span class="tag x-tag-frz">' + K.t("Diepvries") + '</span>' : v.staat === "Vers" ? '<span class="tag">' + K.t("Vers") + '</span>' : "") + thawTag(p) + stockTag(p);
  }
  // De knop « + » : 0 → één stap erbij ; daarna toont hij het aantal en opent hij de details (met het stappenvenster).
  function addBtn(p, qty) {
    return '<button type="button" class="x-add' + (qty > 0 ? " x-on" : "") + '" data-add="' + p.id + '" aria-label="' + K.esc((qty > 0 ? toon(p) + ": " + qtyTxt(p, qty) + (pakP(p) ? "" : " " + unitLabel(p)) + " " + K.t("in de winkelmand gezet") : K.t("Toevoegen") + ": " + toon(p))) + '"' + (qty > 0 ? ' aria-expanded="' + opened.has(p.id) + '" aria-controls="pd-' + p.id + '"' : "") + '>' + (qty > 0 ? '<span class="mono">' + K.esc(K.num(qty / stepUnits(p))) + '</span>' + (pakP(p) && stepUnits(p) > 1 ? "" : '<small>' + K.esc(unitLabel(p)) + '</small>') : "+") + '</button>';
  }
  function productRow(p) {
    const qty = Number(cart.items[p.id] || 0), open = opened.has(p.id), o = originHtml(p), tags = tagsHtml(p);
    const btn = '<button type="button" class="pr-x" data-x="' + p.id + '" aria-expanded="' + open + '" aria-controls="pd-' + p.id + '">' + thumbOf(p, "x-th") +
      '<span class="pr-t"><span class="pn">' + K.esc(toon(p)).replace(/\S*\d\S*/g, m => '<span class="nw">' + m + '</span>') + '</span>' + (o ? '<span class="x-o">' + o + '</span>' : "") + (tags ? '<span class="pm">' + tags + '</span>' : "") + '</span></button>';
    return '<div class="prod' + (qty > 0 ? " on" : "") + (open ? " open" : "") + '" data-id="' + p.id + '">' + btn + priceHtml(p) + addBtn(p, qty) + stepperOf(p, qty) +
      '<div class="pr-d" id="pd-' + p.id + '"' + (open ? "" : " hidden") + '>' + (open ? detailHtml(p) : "") + '</div></div>';
  }
  // Galerij (spec 018) : grote foto ; bij meerdere zichten een strook om te vegen (scroll-snap) en vignetknoppen
  // « Foto 2 van 3 » (aria-current op het getoonde zicht) ; ← → wisselen. Zonder foto : de plaat van de soort, groot.
  function galleryHtml(p) {
    const ph = photosOf(p), n = ph.length; if (!n) return '<div class="x-plate-l x-pl-' + FB.soort(p) + '" aria-hidden="true"><svg viewBox="0 0 200 120"><use href="#x-s-' + FB.soort(p) + '"/></svg>' + (p.vis && p.vis.wetenschappelijkeNaam ? '<i>' + K.esc(p.vis.wetenschappelijkeNaam) + '</i>' : "") + '</div>';
    const lbl = i => K.tt("Foto {i} van {n}", { i: i + 1, n });
    const slides = ph.map((u, i) => '<div class="gal-s"><img src="' + K.esc(u) + '" alt="' + K.esc(n > 1 ? toon(p) + " · " + lbl(i) : toon(p)) + '"' + (i ? ' loading="lazy"' : "") + ' decoding="async" data-gimg></div>').join("");
    if (n === 1) return '<div class="gal"><div class="gal-track">' + slides + '</div></div>';
    return '<div class="gal" data-gal><div class="gal-track" tabindex="0" role="group" aria-label="' + K.esc(K.tt("Foto's van {p}", { p: toon(p) })) + '" aria-keyshortcuts="ArrowLeft ArrowRight">' + slides + '</div>' +
      '<div class="gal-th">' + ph.map((u, i) => '<button type="button" class="gal-b" aria-label="' + K.esc(lbl(i)) + '"' + (i ? "" : ' aria-current="true"') + '><img src="' + K.esc(u) + '" alt="" width="44" height="44" loading="lazy" decoding="async"></button>').join("") + '</div></div>';
  }
  const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
  // Een kapotte of verlopen foto verdwijnt met haar vignetknop ; de nummering volgt ; geen enkele meer : geen galerij.
  function dropSlide(img) {
    const g = img.closest(".gal"), s = img.closest(".gal-s"); if (!g || !s) return;
    const i = Array.prototype.indexOf.call(s.parentNode.children, s), btns = K.$$(".gal-b", g);
    s.remove(); if (btns[i]) btns[i].remove();
    const left = K.$$(".gal-b", g), n = left.length;
    if (!g.querySelector(".gal-s")) { g.remove(); return; }
    if (n <= 1) { const th = g.querySelector(".gal-th"), tr = g.querySelector(".gal-track"); if (th) th.remove(); ["tabindex", "role", "aria-label", "aria-keyshortcuts"].forEach(a => tr.removeAttribute(a)); return; }
    left.forEach((b, k) => b.setAttribute("aria-label", K.tt("Foto {i} van {n}", { i: k + 1, n })));
    if (!g.querySelector('.gal-b[aria-current="true"]')) left[0].setAttribute("aria-current", "true");
  }
  function bindGallery(root) {
    K.$$("img[data-gimg]", root).forEach(img => { img.removeAttribute("data-gimg"); img.onerror = () => dropSlide(img); if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) dropSlide(img); });
    K.$$("[data-gal]", root).forEach(g => {
      g.removeAttribute("data-gal");
      const track = g.querySelector(".gal-track");
      const cur = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      const mark = i => K.$$(".gal-b", g).forEach((b, k) => { if (k === i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
      const go = i => { i = Math.max(0, Math.min(track.children.length - 1, i)); track.scrollTo({ left: i * track.clientWidth, behavior: reduceMotion() ? "auto" : "smooth" }); mark(i); return i; };
      track.addEventListener("scroll", K.debounce(() => mark(cur()), 90), { passive: true });
      g.addEventListener("click", e => { const b = e.target.closest(".gal-b"); if (b) go(K.$$(".gal-b", g).indexOf(b)); });
      g.addEventListener("keydown", e => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const onThumb = e.target.closest && e.target.closest(".gal-b"), from = onThumb ? K.$$(".gal-b", g).indexOf(onThumb) : cur();
        const i = go(from + (e.key === "ArrowRight" ? 1 : -1));
        if (onThumb) { const b = K.$$(".gal-b", g)[i]; if (b) b.focus(); }
      });
    });
  }
  // Visfiche (spec 035) : enkel wat ingevuld is ; labels via K.t, waarden in de taal van de klant (assets/visfiche.js).
  function visRows(p, row) {
    const VI = window.FamoVis, v = p.vis || {};
    if (!VI || !Object.keys(v).length) return "";
    const fz = VI.freezeText(v, K.lang);
    return row(K.t("Wetenschappelijke naam"), v.wetenschappelijkeNaam ? "<i>" + K.esc(v.wetenschappelijkeNaam) + "</i>" + (v.faoCode ? " (" + K.esc(v.faoCode) + ")" : "") : "") +
      row(K.t("Herkomst"), K.esc(VI.originParts(v, K.lang).join(" · "))) + row(K.t("Staat"), K.esc(VI.stateLabel(v.staat, K.lang))) +
      row(K.t("Allergenen"), K.esc(VI.allergenList(v.allergenen, K.lang))) + row(K.t("Bewaren"), K.esc(v.bewaring || "")) +
      row(K.t("Rauw te eten"), fz ? K.esc(fz.replace(/^[^:]+:\s*/, "")) : "");
  }
  // Details : foto's of de plaat, de identiteitskaart van de vis, dan het aantal, « vaste producten » en een opmerking.
  function detailHtml(p) {
    const s = stock(p), neg = p.prix < p.base;
    const row = (k, v) => v ? '<div><dt>' + K.esc(k) + '</dt><dd>' + v + '</dd></div>' : "";
    return galleryHtml(p) +
      '<div class="pr-info">' + (p.omschrijving ? '<p class="pr-desc">' + K.esc(p.omschrijving) + '</p>' : "") + '<dl>' + visRows(p, row) +
      row(K.t("Kaliber"), K.esc(p.kaliber)) + row(K.t("Prijs excl. btw"), '<span class="mono">' + K.eur(p.prix) + '</span> / ' + K.esc(unitLabel(p)) + (neg ? ' <s class="mono quiet">' + K.eur(p.base) + '</s> · ' + K.t("uw prijs") : "")) +
      row(K.t("Beschikbaar"), s == null ? "" : s > 0 ? K.esc(K.qty(s)) + " " + K.esc(unitLabel(p)) : '<span class="t-danger">' + K.t("Uitverkocht") + '</span>') +
      (pakP(p) ? row(K.t("Verpakking"), K.esc(K.pakOne(pakP(p), p.unite)) + ' = <span class="mono">' + K.eur(window.FamoVat.r2(p.prix * pakP(p).per)) + '</span>') : "") +
      (pakP(p) && pakP(p).only ? row(K.t("Bestellen per"), K.esc(K.pakOne(pakP(p), p.unite))) : pakP(p) ? row(K.t("Bestellen per"), K.esc(K.t("per stuk of per verpakking"))) : isKg(p) ? row(K.t("Bestellen per"), K.t("0,5 kg")) : "") + '</dl>' +
      '<div class="x-dact">' + stepperOf(p, cart.items[p.id]) + '<button type="button" class="btn btn-ghost btn-sm fav' + (favs[p.id] ? " on" : "") + '" data-fav="' + p.id + '" aria-pressed="' + (favs[p.id] ? "true" : "false") + '">' + K.icon("star") + '<span>' + K.t(favs[p.id] ? "Uit uw vaste producten" : "Bij uw vaste producten") + '</span></button></div>' +
      noteHtml(p.id, K.t("Opmerking bij dit artikel"), "pr-c") + '</div>';
  }
  // Opmerking per artikel (spec 038) : een stippellijn « + opmerking » die pas bij een tik een veld opent ; een bestaande
  // opmerking staat meteen open.
  function noteHtml(id, label, cls) {
    const v = cart.comments[id] || "";
    return '<div class="' + cls + ' kn" data-note="' + id + '">' + (v ? "" : '<button type="button" class="kn-add" data-note-open="' + id + '" aria-expanded="false">+ ' + K.t("opmerking") + '</button>') +
      '<label class="kn-f"' + (v ? "" : " hidden") + '><span>' + K.esc(label) + '</span><input class="input" data-comment="' + id + '" value="' + K.esc(v) + '" maxlength="120" placeholder="' + K.t("bv. dikke moot…") + '"></label></div>';
  }
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-note-open]"); if (!b || !app.contains(b)) return;
    const box = b.closest("[data-note]"), f = box && box.querySelector(".kn-f"); if (!f) return;
    f.hidden = false; b.remove(); const i = f.querySelector("input"); if (i) i.focus();
  });
  // Winkelmand naast de catalogus (computer) en balk onderaan (telefoon) : bijgewerkt zonder de lijst opnieuw te tekenen.
  function cartPanelHtml() {
    const ids = Object.keys(cart.items).filter(id => byId(id) && Number(cart.items[id]) > 0), total = cartTotal(), min = minimum();
    if (!ids.length) return '<div class="kc-h"><b>' + K.t("Winkelmand") + '</b></div><p class="quiet kc-empty">' + K.t("Nog niets gekozen. Gebruik + bij een product.") + '</p>';
    return '<div class="kc-h"><b>' + K.t("Winkelmand") + '</b><span class="quiet">' + ids.length + ' ' + K.t(ids.length === 1 ? "artikel" : "artikelen") + '</span></div>' +
      '<ul class="kc-l">' + ids.map(id => { const p = byId(id), qv = Number(cart.items[id]); return '<li><span class="kc-n">' + K.esc(toon(p)) + '<small class="quiet mono">' + K.esc(qtyTxt(p, qv)) + ' × ' + K.eur(p.prix) + '</small></span><b class="mono">' + K.eur(p.prix * qv) + '</b><button type="button" class="ibtn" data-rm="' + id + '" aria-label="' + K.t("Verwijderen") + ': ' + K.esc(toon(p)) + '">' + K.icon("x") + '</button></li>'; }).join("") + '</ul>' +
      '<div class="kc-t"><span>' + K.t("Totaal excl. btw") + '</span><b class="mono">' + K.eur(total) + '</b></div>' +
      (min > 0 && total < min && !openFor(klok().levering) ? '<p class="kc-min">' + K.esc(K.tt("Minimumbestelling {m} excl. btw · nog {r} toe te voegen.", { m: K.eur(min), r: K.eur(min - total) })) + '</p>' : "") +
      '<a class="btn btn-p btn-block" href="#/winkelmand">' + K.t("Bestellen") + '</a>';
  }
  function cartbarHtml() {
    const n = cartCount();
    return n ? '<div class="cartbar"><div><div class="fs-12">' + n + ' ' + K.t(n === 1 ? "artikel" : "artikelen") + ' · ' + K.t("excl. btw") + '</div><div class="mono fs-17 fw-600">' + K.eur(cartTotal()) + '</div></div><a class="btn btn-light" href="#/winkelmand">' + K.t("Bestellen") + '</a></div>' : "";
  }
  function refreshCart() {
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set("kcartlink", cartLinkHtml()); set("cartPanel", cartPanelHtml()); set("cartbarBox", cartbarHtml());
  }
  // Wat de catalogus toont : filter (Alles, Uw vaste, Rauw OK, een vakgroep), groepen (uw vaste eerst bij « Alles »),
  // families binnen een vakgroep, zoekteksten. Uw vaste = wat u minstens 2 keer in uw laatste 10 leveringen nam
  // (server, lib/gewoonte.js) + uw sterren.
  function catalogState() {
    const all = (cat.products || []).slice().sort(K.catalogSort("standaard"));
    const vast = new Set((ordersMeta.vaste || []).concat(Object.keys(favs)));
    const groupOf = p => FB.GROEP_LABEL[FB.groep(p)];
    const order = FB.GROEPEN.map(([, l]) => l);
    const match = c => p => c === ALL || (c === VAST ? vast.has(p.id) : c === RAW ? rawOk(p) : groupOf(p) === c);
    const products = all.filter(match(catFilter));
    const groups = {};
    products.forEach(p => { const g = catFilter === ALL && vast.has(p.id) ? VAST : catFilter === VAST ? VAST : groupOf(p); (groups[g] = groups[g] || []).push(p); });
    const gorder = [VAST].concat(order).filter(g => groups[g]);
    const present = order.filter(g => all.some(p => groupOf(p) === g));
    // Families (spec 019) binnen één vakgroep : enkel als de lijst er baat bij heeft (K.families).
    const fams = present.includes(catFilter) ? K.families(products) : null, famOf = new Map();
    if (fams) { fams.families.forEach(f => f.ids.forEach(id => famOf.set(id, f.key))); fams.rest.forEach(id => famOf.set(id, REST)); }
    if (famFilter && !famOf.size) famFilter = "";
    const hay = new Map(products.map(p => [p.id, K.searchKey([p.nom, p.kaliber, groupOf(p), K.t(groupOf(p)), p.omschrijving, p.vis && p.vis.wetenschappelijkeNaam].filter(Boolean).join(" "))]));
    const count = c => all.filter(match(c)).length;
    const cats = [ALL].concat(all.some(p => vast.has(p.id)) ? [VAST] : [], all.some(rawOk) ? [RAW] : [], present);
    // Spec 038 : bij « Alles » staan uw vaste producten bovenaan ; de vakgroep zegt hoeveel er daar al staan (zelfde telling als de filter).
    const vastIn = g => (catFilter === ALL && g !== VAST ? all.filter(p => groupOf(p) === g && vast.has(p.id)).length : 0);
    return { all, cats, count, products, groups, order: gorder, fams, famOf, hay, vastIn };
  }
  const catBtn = c => '<button type="button" data-cat="' + K.esc(c) + '"' + (c === catFilter ? ' class="on' + (c === RAW ? " x-raw" : "") + '" aria-pressed="true"' : (c === RAW ? ' class="x-raw"' : "") + ' aria-pressed="false"') + '>' + K.esc(K.t(c)) + '<span class="kcount">' + CS.count(c) + '</span></button>';
  // Werkbalk (blijft bovenaan) : zoeken (× wist), naar boven, filters ; het aantal enkel voor schermlezers.
  function toolsHtml() {
    return '<div class="ktools" id="ktools">' +
      '<div class="kt-s"><div class="search ksearch"><label class="ks-l">' + K.icon("search") + '<input id="q" type="search" placeholder="' + K.t("Zoek: zalm, 16/20, inktvis…") + '" aria-label="' + K.t("Zoek een product…") + '" aria-keyshortcuts="/" value="' + K.esc(q) + '" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>' +
      '<button type="button" class="ks-x" id="qClear" aria-label="' + K.t("Zoekterm wissen") + '"' + (q ? "" : " hidden") + '>' + K.icon("x") + '</button></div>' +
      '<button type="button" class="btn btn-o totop" id="toTop" aria-label="' + K.t("Naar boven") + '" title="' + K.t("Naar boven") + '" hidden>' + K.icon("up") + '</button></div>' +
      '<div class="cats kt-c x-chips" role="group" aria-label="' + K.t("Categorieën") + '">' + CS.cats.map(catBtn).join("") + '</div>' +
      '<span class="kt-n sr-only" id="kCount" role="status" aria-live="polite"></span></div>';
  }
  // Families (spec 019) : enkel als de lijst er baat bij heeft (K.families : > 12 producten, 3–12 families).
  function famsHtml() {
    const f = CS.fams; if (!f) return "";
    const b = (key, label, n) => '<button type="button" data-fam="' + K.esc(key) + '"' + (key === famFilter ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + K.esc(label) + '<span class="kcount">' + n + '</span></button>';
    return '<div class="fams" id="kFams" role="group" aria-label="' + K.t("Soort") + '">' + b("", K.t("Alle"), CS.products.length) + f.families.map(x => b(x.key, FB.naam(x.label), x.ids.length)).join("") + (f.rest.length ? b(REST, K.t("Overige"), f.rest.length) : "") + '</div>';
  }
  function listHtml() {
    if (!CS.products.length) return K.c.empty(K.t("Nog geen favorieten"), K.t("Tik op de ster bij een product om het hier te zien."));
    return CS.order.map(g => '<h2 class="sec">' + K.esc(K.t(g)) + ' <span class="quiet" data-gn>' + CS.groups[g].length + '</span>' + (CS.vastIn(g) ? ' <small class="quiet fs-12 fw-400">' + K.esc(K.tt("+ {n} bij uw vaste", { n: CS.vastIn(g) })) + '</small>' : "") + '</h2>' + CS.groups[g].map(productRow).join("")).join("") + '<div id="noHit" role="status"></div>';
  }
  // Zoeken × familie : regels verbergen of tonen, groepen zonder treffer verbergen, aantal en melding bijwerken.
  function applyFilter() {
    const box = document.getElementById("list"); if (!box || !CS) return;
    const qk = K.searchKey(q);
    let sec = null, n = 0, total = 0;
    const endGroup = () => { if (!sec) return; sec.classList.toggle("hidden", !n); const c = sec.querySelector("[data-gn]"); if (c) c.textContent = n; };
    for (const el of box.children) {
      if (el.tagName === "H2") { endGroup(); sec = el; n = 0; }
      else if (el.classList.contains("prod")) {
        const id = el.dataset.id, ok = (!qk || K.searchHit(CS.hay.get(id) || "", qk)) && (!famFilter || CS.famOf.get(id) === famFilter);
        el.classList.toggle("hidden", !ok); if (ok) { n++; total++; }
      }
    }
    endGroup();
    const cnt = document.getElementById("kCount"); if (cnt) cnt.textContent = total === 1 ? K.t("1 product") : K.tt("{n} producten", { n: total });
    const nh = document.getElementById("noHit"); if (nh) nh.innerHTML = total || !CS.products.length ? "" : qk ? K.c.empty(K.t("Niets gevonden voor") + " „" + q.trim() + "”", K.t("Probeer een ander woord of kies een categorie.")) : "";
    const x = document.getElementById("qClear"); if (x) x.hidden = !q;
  }
  // Lijst opnieuw (filter, uw vaste aangekomen) ; het product bovenaan het scherm blijft op zijn plaats.
  function redrawList() {
    const box = document.getElementById("list"); if (!box) return;
    const tools = document.getElementById("ktools"), edge = tools && tools.offsetHeight ? tools.getBoundingClientRect().bottom : 0;
    const anchor = window.scrollY > 0 ? K.$$(".prod:not(.hidden)", box).find(r => r.getBoundingClientRect().bottom > edge + 8) : null;
    const id = anchor && anchor.dataset.id, top = anchor ? anchor.getBoundingClientRect().top : 0;
    box.innerHTML = listHtml();
    fallback(box); bindSteppers(box, rid => { syncRow(rid); refreshCart(); }); applyFilter();
    if (id) { const r = box.querySelector('.prod[data-id="' + CSS.escape(id) + '"]'); if (r) window.scrollBy(0, r.getBoundingClientRect().top - top); }
  }
  function toTop() {
    const h = app.querySelector("h1");
    window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
    if (h) { h.setAttribute("tabindex", "-1"); try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
  }
  // « Naar boven » verschijnt na een scherm ; verdwijnt niet onder de focus.
  function syncToTop() { const b = document.getElementById("toTop"); if (!b) return; const far = window.scrollY > window.innerHeight; if (b.hidden === !far || (!far && document.activeElement === b)) return; b.hidden = !far; }
  let scrollTick = false;
  window.addEventListener("scroll", () => { if (scrollTick) return; scrollTick = true; requestAnimationFrame(() => { scrollTick = false; syncToTop(); }); }, { passive: true });
  // Hoogte van de werkbalk (≥ 720 px) → --kt-h : groepstitels kleven eronder en scroll-padding houdt de focus vrij (2.4.11).
  let ktRO = null;
  function watchTools() {
    if (ktRO) { ktRO.disconnect(); ktRO = null; }
    const el = document.getElementById("ktools"); if (!el || typeof window.ResizeObserver !== "function") return;
    ktRO = new window.ResizeObserver(() => { const h = el.offsetHeight; if (h) document.documentElement.style.setProperty("--kt-h", h + "px"); });
    ktRO.observe(el);
  }
  // Winkelmand van vroeger (of een product dat intussen « enkel per verpakking » werd) : afgerond op hele
  // verpakkingen, en dat gezegd. De server blijft de scheidsrechter (hij weigert een ander aantal).
  function fitCart() {
    const msgs = [];
    Object.keys(cart.items).forEach(id => { const p = byId(id), q = Number(cart.items[id]); if (!p || !(q > 0) || stepUnits(p) === 1 || window.FamoVat.pakFits(q, pakP(p))) return; const v = fitQty(p, q); cart.items[id] = v; msgs.push(K.tt("{p}: aangepast naar {q}, want enkel per {v}.", { p: toon(p), q: K.pakQty(v, p.unite, pakP(p)), v: K.pakOne(pakP(p), p.unite) })); });
    if (msgs.length) saveCart();
    return msgs;
  }
  // Symbolen van de platen (één keer in het document) : vormen uit de maquette x30, kleur per soort in ui.css.
  function ensureSprite() {
    if (document.getElementById("xSprite")) return;
    const S = {
      zalm: '<path d="M8 70 C40 30 120 18 192 40 L184 96 C120 112 50 108 8 70Z" fill="#E9836B"/><path d="M40 52 C70 70 70 88 52 100 M78 42 C108 62 108 86 92 104 M118 36 C146 58 146 84 132 106 M156 36 C178 56 178 80 170 100" stroke="#F6C4B2" stroke-width="5" fill="none" stroke-linecap="round"/>',
      tonijn: '<rect x="18" y="26" width="168" height="82" rx="8" fill="#9E2B33"/><path d="M18 52 H186 M18 78 H186" stroke="#B9474E" stroke-width="4"/><rect x="18" y="26" width="168" height="10" rx="5" fill="#7D1F27"/>',
      garnaal: '<path d="M30 92 C20 40 80 10 140 26 C176 36 190 66 176 92 C164 70 140 58 112 62 C84 66 62 84 58 106Z" fill="#E7957F"/><path d="M76 34 L84 64 M104 26 L106 60 M130 26 L124 60 M152 36 L140 66" stroke="#F5C9BB" stroke-width="5" stroke-linecap="round"/>',
      tiger: '<path d="M26 96 C18 46 80 14 142 28 C178 38 192 66 178 94 C166 72 142 60 112 64 C84 68 62 86 58 108Z" fill="#5E6670"/><path d="M76 36 L86 66 M104 28 L108 62 M130 28 L124 62 M152 38 L140 68" stroke="#E9ECEF" stroke-width="6" stroke-linecap="round"/>',
      zeewier: '<g fill="none" stroke="#4E7A3E" stroke-width="9" stroke-linecap="round"><path d="M30 116 C40 80 20 60 40 24"/><path d="M70 116 C84 84 58 58 80 16"/><path d="M110 116 C120 84 100 64 118 30"/><path d="M150 116 C162 86 140 60 162 20"/></g>',
      inktvis: '<g fill="none" stroke="#B9A88D" stroke-width="14"><circle cx="58" cy="70" r="26"/><circle cx="120" cy="56" r="24"/><circle cx="160" cy="88" r="20"/></g>',
      tube: '<path d="M20 60 C20 40 40 34 60 34 H170 L190 60 L170 86 H60 C40 86 20 80 20 60Z" fill="#D2C3AA"/><path d="M60 34 V86" stroke="#BCA98B" stroke-width="4"/>',
      ei: '<g fill="#DCCBAE"><ellipse cx="60" cy="70" rx="26" ry="34"/><ellipse cx="120" cy="64" rx="26" ry="34"/><ellipse cx="172" cy="78" rx="24" ry="30"/></g>',
      schelp: '<path d="M20 96 C30 40 90 22 150 36 C186 46 196 76 180 100 C140 112 70 114 20 96Z" fill="#3E4A6B"/><path d="M40 92 C70 60 120 46 170 60" stroke="#8F9BBE" stroke-width="5" fill="none" stroke-linecap="round"/>',
      kreeft: '<path d="M20 70 C40 40 90 34 120 40 L150 30 L190 50 L160 66 L190 84 L150 92 L120 82 C90 90 40 96 20 70Z" fill="#C8492F"/><path d="M60 46 V92 M90 42 V90 M118 42 V84" stroke="#E7826A" stroke-width="5"/>',
      vis: '<path d="M14 62 C50 24 120 22 160 50 L194 28 L186 62 L194 96 L160 74 C120 102 50 100 14 62Z" fill="#6E8C99"/><circle cx="48" cy="56" r="6" fill="#E6EEF1"/><path d="M84 40 C96 54 96 70 84 84" stroke="#A9C0C9" stroke-width="5" fill="none" stroke-linecap="round"/>'
    };
    const box = document.createElement("div"); box.hidden = true;
    box.innerHTML = '<svg id="xSprite" width="0" height="0" aria-hidden="true" focusable="false">' + Object.entries(S).map(([k, v]) => '<symbol id="x-s-' + k + '" viewBox="0 0 200 120">' + v + '</symbol>').join("") + '</svg>';
    document.body.appendChild(box.firstChild);
  }
  function renderCatalogus() {
    fitCart().forEach(m => K.toast(m));
    ensureSprite();
    CS = catalogState();
    const top = '<div class="mtop"><div class="mrow"><span class="logo" aria-hidden="true"></span><div class="grow"><h1 class="ktitle">' + K.t("Bestellen") + '</h1><span class="quiet ksub">' + K.esc((cat.client.nom ? cat.client.nom + " · " : "") + K.t("Prijzen excl. btw")) + '</span></div>' + K.c.avatar(cat.client.nom) + '</div></div>';
    shell("catalogus", '<div class="kgrid"><nav class="kside" aria-label="' + K.t("Categorieën") + '">' + CS.cats.map(catBtn).join("") + '</nav><div class="x-right"><section class="x-usual" id="xUsual" aria-labelledby="xUsualT" hidden></section><aside class="kcart" id="cartPanel" aria-label="' + K.t("Winkelmand") + '">' + cartPanelHtml() + '</aside></div><div class="kcat">' + toolsHtml() + famsHtml() + '<div class="kl" id="list" data-view="x30">' + listHtml() + '</div></div></div><div id="cartbarBox">' + cartbarHtml() + '</div>', top);
    applyFilter();
    renderUsual();
    // Commandes (carte « Zoals elke … », uw vaste) : chargées une fois ; la liste suit si « uw vaste » change.
    if (!orders) ensureOrders().then(() => { if (K.hashParams().path !== "catalogus" && K.hashParams().path !== "") return; renderUsual(); const before = CS.cats.join("|"); CS = catalogState(); if (CS.cats.join("|") !== before) { const kc = app.querySelector(".kt-c"), ks = app.querySelector(".kside"); if (kc) kc.innerHTML = CS.cats.map(catBtn).join(""); if (ks) ks.innerHTML = CS.cats.map(catBtn).join(""); redrawList(); } }).catch(() => {});
    const qi = document.getElementById("q");
    qi.addEventListener("input", K.debounce(() => { q = qi.value; applyFilter(); }, 120));
    qi.addEventListener("input", () => { const x = document.getElementById("qClear"); if (x) x.hidden = !qi.value; });
    document.getElementById("qClear").onclick = () => { qi.value = ""; q = ""; qi.focus(); applyFilter(); };
    document.getElementById("toTop").onclick = toTop;
    K.on(app, "click", "[data-cat]", (e, t) => { catFilter = t.dataset.cat; famFilter = ""; renderCatalogus(); const b = K.$$('[data-cat="' + CSS.escape(catFilter) + '"]', app).find(x => x.offsetParent); if (b) b.focus(); });
    K.on(app, "click", "[data-fam]", (e, t) => { famFilter = t.dataset.fam; K.$$("[data-fam]", app).forEach(b => K.setOn(b, b === t)); applyFilter(); });
    K.on(app, "click", "[data-fav]", (e, t) => { const id = t.dataset.fav; setFav(id, !favs[id]); K.setOn(t, !!favs[id]); const l = t.querySelector("span"); if (l) l.textContent = K.t(favs[id] ? "Uit uw vaste producten" : "Bij uw vaste producten"); });
    const toggle = (id, focusStepper) => {
      const p = byId(id), row = app.querySelector('.prod[data-id="' + CSS.escape(id) + '"]'); if (!p || !row) return;
      const box = row.querySelector(".pr-d"), open = !opened.has(id);
      if (open) { opened.add(id); box.innerHTML = detailHtml(p); fallback(box); bindSteppers(box, rid => { syncRow(rid); refreshCart(); }); } else opened.delete(id);
      box.hidden = !open; row.classList.toggle("open", open);
      K.$$("[aria-controls='pd-" + id + "']", row).forEach(b => b.setAttribute("aria-expanded", String(open)));
      if (open && focusStepper) { const inc = box.querySelector(".stepper [data-inc]"); if (inc) inc.focus(); }
    };
    K.on(app, "click", "[data-x]", (e, t) => toggle(t.dataset.x));
    // « + » : één stap erbij (voorraad begrenst) ; met een aantal : de details open, focus op « + » van het stappenvenster.
    K.on(app, "click", "[data-add]", (e, t) => {
      const id = t.dataset.add, p = byId(id); if (!p) return;
      if (Number(cart.items[id] || 0) > 0) { toggle(id, true); return; }
      const v = capQty(p, stepUnits(p) > 1 ? stepUnits(p) : isKg(p) ? 0.5 : 1);
      if (!(v > 0)) { K.toast(K.t("Uitverkocht"), { kind: "err" }); return; }
      cart.items[id] = v; saveCart(); syncRow(id); refreshCart();
      // Le « + » montre la quantité (téléphone) ou cède la place au stepper (liste large) : le focus suit ce qui est visible.
      const row = app.querySelector('.prod[data-id="' + CSS.escape(id) + '"]'), nb = row && row.querySelector("[data-add]");
      const tgt = nb && nb.offsetParent ? nb : row && row.querySelector(":scope > .stepper [data-inc]"); if (tgt) tgt.focus();
    });
    K.on(app, "input", "[data-comment]", (e, t) => { cart.comments[t.dataset.comment] = t.value.slice(0, 120); saveCart(); });
    K.on(app, "click", "[data-rm]", (e, t) => {
      const id = t.dataset.rm, p = byId(id), prev = cart.items[id], prevC = cart.comments[id];
      delete cart.items[id]; delete cart.comments[id]; saveCart(); syncRow(id); refreshCart();
      K.toast(K.tt("{p} verwijderd", { p: p ? toon(p) : "" }), { action: K.t("Ongedaan maken"), onAction: () => { cart.items[id] = prev; if (prevC) cart.comments[id] = prevC; saveCart(); syncRow(id); refreshCart(); } });
      const next = document.querySelector("#cartPanel [data-rm], #cartPanel a.btn"); if (next) next.focus();
    });
    fallback(app);
    bindSteppers(app, id => { syncRow(id); refreshCart(); });
    watchTools(); syncToTop();
  }
  // Foto's van Airtable verlopen na een tijd : een kapotte afbeelding verdwijnt (de details blijven).
  function fallback(root) { K.$$("img[data-fallback]", root).forEach(img => { img.onerror = () => { img.parentNode.remove(); }; }); bindGallery(root); }
  // Eén product veranderd : zijn regel (klasse, « + »-knop, beide stappenvensters) zonder de lijst opnieuw te tekenen.
  function syncRow(id) {
    const row = app.querySelector('.prod[data-id="' + CSS.escape(id) + '"]'); if (!row) return;
    const p = byId(id) || {}, v = Number(cart.items[id] || 0);
    row.classList.toggle("on", v > 0);
    K.$$(".stepper", row).forEach(st => { st.classList.toggle("on", v > 0); st.querySelector("input").value = K.num(v / stepUnits(p)); pakSuffix(st, p, v); });
    const add = row.querySelector("[data-add]"); if (add) { const had = document.activeElement === add; add.outerHTML = addBtn(p, v); if (had) { const nb = row.querySelector("[data-add]"), tgt = nb && nb.offsetParent ? nb : row.querySelector(":scope > .stepper [data-inc]"); if (tgt) tgt.focus(); } }
  }
  // Libellé dans le stepper (« doos » / FR « carton(s) ») et légende « 2 doos · 12 stuks » à côté, s'il y en a une.
  function pakSuffix(st, p, v) {
    if (!p || !pakP(p)) return;
    const u = st.querySelector(".st-u"); if (u) u.textContent = K.pakLabel(pakP(p).label, v / stepUnits(p));
    K.$$('[data-pakq="' + CSS.escape(p.id) + '"]', app).forEach(c => { c.textContent = v > 0 ? K.pakQty(v, p.unite, pakP(p)) : ""; });
  }
  function bindSteppers(root, after) {
    K.$$(".stepper", root).forEach(st => {
      if (st.dataset.bound) return; // une liaison par stepper (la ligne et ses détails peuvent être re-liés)
      const id = st.dataset.stepper, inp = st.querySelector("input"), p = byId(id); if (!p) return;
      st.dataset.bound = "1";
      // Pas du stepper : un conditionnement (« enkel per verpakking », le champ compte alors des doos), sinon 0,5 kg ou 1.
      const n = stepUnits(p), step = n > 1 ? 1 : isKg(p) ? 0.5 : 1;
      const set = s => {
        let v = n > 1 ? Math.max(0, Math.round(s)) * n : Math.max(0, Math.round(s * 1000) / 1000); if (n === 1 && !isKg(p)) v = Math.round(v);
        // Voorraad begrenst het aantal (de server kan alsnog weigeren : de klant ziet dan de servermelding).
        const capped = capQty(p, v); if (capped < v) { v = capped; K.toast(v > 0 ? K.tt("Slechts {n} beschikbaar.", { n: qtyTxt(p, v) }) : K.t("Uitverkocht"), { kind: "err" }); }
        if (v > 0) cart.items[id] = v; else { delete cart.items[id]; delete cart.comments[id]; } saveCart(); inp.value = K.num(v / n); pakSuffix(st, p, v); st.classList.toggle("on", v > 0); if (after) after(id, v);
      };
      st.querySelector("[data-dec]").onclick = () => set((K.parseNum(inp.value) || 0) - step);
      st.querySelector("[data-inc]").onclick = () => set((K.parseNum(inp.value) || 0) + step);
      inp.addEventListener("change", () => set(K.parseNum(inp.value) || 0));
    });
  }

  /* ---------- x30 X1 + X3 : « Zoals elke maandag » (commande en un geste) et la commande du jour, modifiable ---------- */
  // Trois états pour le prochain jour de livraison (celui du bandeau) :
  //   « voorstel »  : pas encore de commande → la commande probable du serveur (api/orders gewoonte), quantités − / +,
  //                   un bouton plein « Bestellen voor ma 26/10 · € … », toast « Besteld · Ongedaan maken » 8 s ;
  //   « bestaand »  : une commande Reçue encore modifiable → ses lignes, − / +, « Wijziging opslaan » (sans annuler) ;
  //   « vast »      : la commande est déjà klaargezet → lecture seule.
  // Les prix affichés sont ceux du catalogue du client ; le serveur recalcule tout (constitution II).
  let usual = null; // { mode, levering, ref, lines: [{ p, qty, orig }], key }
  const openFor = dag => (orders || []).filter(o => o.dateLiv === dag && o.statut !== K.CANCELLED && o.statut !== "Facturée").sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
  const linesOfOrder = o => (o.items || []).map(l => ({ p: l.productId ? byId(l.productId) : (cat.products || []).find(x => x.nom.toLowerCase() === String(l.naam || "").toLowerCase()), qty: Number(l.qty) || 0 })).filter(l => l.p && l.qty > 0).map(l => Object.assign(l, { orig: l.qty }));
  const usualTotal = () => usual.lines.reduce((s, l) => s + window.FamoVat.r2(l.p.prix * l.qty), 0);
  const usualChanged = () => usual.lines.some(l => Math.abs(l.qty - l.orig) > 1e-9);
  function buildUsual() {
    const k = klok(), o = orders ? openFor(k.levering) : null, g = ordersMeta.gewoonte;
    if (o) {
      const lines = linesOfOrder(o), complete = lines.length === (o.items || []).length;
      return { mode: o.aanpasbaar && complete ? "bestaand" : "vast", levering: k.levering, ref: o.ref, order: o, lines };
    }
    if (!g || g.levering !== k.levering) return null;
    const lines = g.items.map(i => ({ p: byId(i.productId), qty: Number(i.qty) || 0 })).filter(l => l.p && l.qty > 0).map(l => Object.assign(l, { orig: l.qty }));
    if (!lines.length) return null;
    const prev = usual && usual.mode === "voorstel" && usual.levering === k.levering ? usual : null;
    if (prev) lines.forEach(l => { const was = prev.lines.find(x => x.p.id === l.p.id); if (was) l.qty = was.qty; });
    return { mode: "voorstel", levering: k.levering, lines, basis: g.basis, n: g.n, key: prev ? prev.key : null };
  }
  function usualLineHtml(l, ro) {
    const p = l.p, n = stepUnits(p);
    const st = ro ? '<span class="mono x-uq">' + K.esc(qtyTxt(p, l.qty)) + '</span>' : n > 1 ? K.c.stepper("u:" + p.id, l.qty / n, { step: 1, name: toon(p), suffix: K.pakLabel(pakP(p).label, l.qty / n), label: K.t("Aantal") + " (" + K.pakOne(pakP(p), p.unite) + ")" }) : K.c.stepper("u:" + p.id, l.qty, { step: isKg(p) ? 0.5 : 1, name: toon(p), suffix: isKg(p) ? "kg" : "" });
    return '<li class="' + (l.qty > 0 ? "" : "x-off") + '" data-u="' + p.id + '">' + thumbOf(p, "x-uth") + '<span class="x-un"><b>' + K.esc(toon(p)) + '</b><small class="mono">' + K.eur(p.prix) + ' / ' + K.esc(unitLabel(p)) + '</small></span>' + st + '</li>';
  }
  function renderUsual() {
    const box = document.getElementById("xUsual"); if (!box) return;
    usual = buildUsual();
    if (!usual) { box.hidden = true; box.innerHTML = ""; return; }
    const d = FB.kort(usual.levering, K.lang), tot = totTxt(usual.levering), ro = usual.mode === "vast";
    const dag = FB.weekdag(usual.levering, K.lang);
    const kicker = usual.mode === "voorstel" ? K.tt("Uw bestelling voor {d}", { d }) : K.tt("Besteld voor {d}", { d }) + " · " + usual.ref;
    const title = usual.mode === "voorstel" ? (usual.basis === "weekdag" ? K.tt("Zoals elke {dag}", { dag }) : K.t("Zoals de vorige keer")) : K.t("Uw bestelling");
    let foot = "";
    if (usual.mode === "voorstel") {
      const basis = usual.basis === "weekdag" ? (usual.n === 1 ? K.tt("Gebaseerd op uw laatste {dag}", { dag }) : K.tt("Gebaseerd op uw laatste {n} {dag}en", { n: usual.n, dag })) : K.t("Gebaseerd op uw laatste bestelling");
      foot = '<button type="button" class="x-go" id="xGo"><span>' + K.esc(K.tt("Bestellen voor {d}", { d })) + '</span><span class="mono" id="xGoT"></span></button><p class="x-help" id="xHelp">' + K.esc(basis) + '<br>' + K.esc(K.tt("Aan te passen {tot}", { tot })) + '</p>';
    } else if (usual.mode === "bestaand") {
      foot = '<p class="x-state"><span class="cell-st c-new">' + K.esc(K.tt("Bevestigd · aanpasbaar {tot}", { tot })) + '</span></p><button type="button" class="x-go" id="xGo" hidden><span id="xGoL">' + K.t("Wijziging opslaan") + '</span><span class="mono" id="xGoT"></span></button><p class="x-help" id="xHelp">' + K.t("Iets vergeten? Tik + in de lijst hieronder en bestel uw winkelmand: het komt bij deze bestelling.") + '</p>';
    } else {
      foot = '<p class="x-state">' + K.stCell(usual.order.statut) + '</p><p class="x-help">' + K.t("Wordt klaargezet. Bel Famo om nog iets te wijzigen.") + '</p>';
    }
    box.className = "x-usual x-" + usual.mode;
    box.innerHTML = '<div class="x-uh"><small>' + K.esc(kicker) + '</small><h2 id="xUsualT">' + K.esc(title) + '</h2></div><ul class="x-ul">' + usual.lines.map(l => usualLineHtml(l, ro)).join("") + '</ul><div class="x-uf">' + foot + '<div id="xErr"></div></div>';
    box.hidden = false;
    bindUsual(box); syncUsual();
  }
  // Steppers de la carte : préfixe « u: » (jamais le panier) ; 0 garde la ligne, grisée, pour la remettre.
  function bindUsual(box) {
    K.$$(".stepper", box).forEach(st => {
      const id = String(st.dataset.stepper || "").replace(/^u:/, ""), l = usual.lines.find(x => x.p.id === id), inp = st.querySelector("input"); if (!l) return;
      const n = stepUnits(l.p), step = n > 1 ? 1 : isKg(l.p) ? 0.5 : 1;
      const set = s => { let v = n > 1 ? Math.max(0, Math.round(s)) * n : Math.max(0, Math.round(s * 1000) / 1000); if (n === 1 && !isKg(l.p)) v = Math.round(v); l.qty = capQty(l.p, v); inp.value = K.num(l.qty / n); pakSuffix(st, l.p, l.qty); st.classList.toggle("on", l.qty > 0); st.closest("li").classList.toggle("x-off", !(l.qty > 0)); syncUsual(); };
      st.querySelector("[data-dec]").onclick = () => set((K.parseNum(inp.value) || 0) - step);
      st.querySelector("[data-inc]").onclick = () => set((K.parseNum(inp.value) || 0) + step);
      inp.addEventListener("change", () => set(K.parseNum(inp.value) || 0));
    });
    const go = box.querySelector("#xGo"); if (go) go.onclick = () => (usual.mode === "voorstel" ? placeUsual(go) : saveUsual(go));
  }
  function syncUsual() {
    const go = document.getElementById("xGo"), t = document.getElementById("xGoT"); if (!go || !usual) return;
    const total = usualTotal(), any = usual.lines.some(l => l.qty > 0), min = minimum();
    if (t) t.textContent = K.eur(total);
    if (usual.mode === "voorstel") {
      const below = min > 0 && total < min;
      go.disabled = !any || below;
      const err = document.getElementById("xErr"); if (err) err.innerHTML = below && any ? '<p class="kc-min">' + K.esc(K.tt("Minimumbestelling {m} excl. btw", { m: K.eur(min) })) + '</p>' : "";
    } else if (usual.mode === "bestaand") {
      const changed = usualChanged();
      go.hidden = !changed; document.getElementById("xHelp").hidden = changed;
      const l = document.getElementById("xGoL"); if (l) l.textContent = any ? K.t("Wijziging opslaan") : K.t("Bestelling annuleren");
      go.classList.toggle("x-danger", !any);
    }
  }
  const usualItems = () => usual.lines.filter(l => l.qty > 0).map(l => ({ productId: l.p.id, quantity: l.qty }));
  const showErr = msg => { const e = document.getElementById("xErr"); if (e) e.innerHTML = K.c.error(msg); };
  // Un geste : la commande probable part telle quelle (le serveur recalcule et décide).
  async function placeUsual(btn, again) {
    const tv = cat && cat.voorwaarden;
    if (tv && tv.versie && !tv.aanvaard) { try { if (!(await ensureTerms(tv.versie))) return; } catch (err) { showErr(err.message); return; } }
    const items = usualItems(); if (!items.length) return;
    if (!usual.key) usual.key = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const day = usual.levering, total = usualTotal();
    K.busy(btn, true, K.t("Bestellen…")); document.getElementById("xErr").innerHTML = "";
    try {
      const d = await api("/api/order", { json: Object.assign({}, creds(), { items, notes: "", dateLivraison: day, idempotencyKey: usual.key }) });
      orders = null; usual = null;
      await ensureOrders().catch(() => null);
      renderUsual();
      const h = document.getElementById("xUsualT"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
      K.toast(K.t("Besteld") + " · " + FB.kort(day, K.lang) + " · " + K.eur(d.total != null ? d.total : total), { action: K.t("Ongedaan maken"), ms: 8000, onAction: () => undoOrder(d) });
    } catch (err) {
      if (err.status === 409 && err.payload && err.payload.needTerms && again !== true) { K.busy(btn, false); try { if (await ensureTerms(err.payload.versie)) return placeUsual(btn, true); } catch (e2) { showErr(e2.message); } return; }
      K.busy(btn, false); showErr(err.message);
    }
  }
  // « Ongedaan maken » : une nouvelle commande est annulée ; un ajout à la commande du jour remet les lignes d'avant.
  async function undoOrder(d) {
    try {
      if (d.samengevoegd && Array.isArray(d.vorige) && d.vorige.length) await api("/api/klantorder", { json: Object.assign({}, creds(), { action: "wijzig", ref: d.ref, items: d.vorige }) });
      else await cancelCall(d.ref);
      K.toast(K.t("Ongedaan gemaakt"));
    } catch (err) { K.toast(err.message, { kind: "err" }); }
    orders = null; await ensureOrders().catch(() => null); renderUsual();
  }
  async function saveUsual(btn) {
    const items = usualItems();
    if (!items.length) {
      if (!(await K.confirm({ title: K.t("Bestelling") + " " + usual.ref + " " + K.t("annuleren?"), text: K.t("Ze wordt niet klaargezet en niet geleverd. U kunt ze daarna opnieuw bestellen."), yes: K.t("Annuleren"), no: K.t("Behouden"), danger: true }))) return;
      K.busy(btn, true, K.t("Annuleren…"));
      try { await cancelCall(usual.ref); K.toast(K.t("Bestelling") + " " + usual.ref + " " + K.t("geannuleerd")); } catch (err) { K.busy(btn, false); showErr(err.message); return; }
      orders = null; await ensureOrders().catch(() => null); renderUsual(); return;
    }
    await saveOrder(usual.ref, items, btn, () => { renderUsual(); });
  }
  // Modifier sans annuler (X3) : toutes les lignes voulues, le serveur revérifie et journalise.
  async function saveOrder(ref, items, btn, done) {
    K.busy(btn, true, K.t("Opslaan…"));
    try {
      const d = await api("/api/klantorder", { json: Object.assign({}, creds(), { action: "wijzig", ref, items }) });
      orders = null; await ensureOrders().catch(() => null);
      if (done) done(d);
      K.toast(K.t("Bestelling aangepast") + " · " + K.eur(d.total), { action: K.t("Ongedaan maken"), ms: 8000, onAction: async () => { try { await api("/api/klantorder", { json: Object.assign({}, creds(), { action: "wijzig", ref, items: d.vorige }) }); K.toast(K.t("Ongedaan gemaakt")); } catch (err) { K.toast(err.message, { kind: "err" }); } orders = null; await ensureOrders().catch(() => null); if (K.hashParams().path === "catalogus") renderUsual(); else if (done) done(); } });
    } catch (err) {
      K.busy(btn, false);
      const e = btn.closest(".panel") ? btn.closest(".panel").querySelector("#eErr") : document.getElementById("xErr");
      if (e) e.innerHTML = K.c.error(err.message); else K.toast(err.message, { kind: "err" });
      if (err.status === 409) { orders = null; ensureOrders().then(() => { if (K.hashParams().path === "catalogus") renderUsual(); }).catch(() => {}); }
    }
  }

  /* ---------- winkelmand ---------- */
  function renderWinkelmand() {
    const fitted = fitCart();
    const ids = Object.keys(cart.items).filter(id => byId(id) && Number(cart.items[id]) > 0);
    const days = nextDays(); if (!dayOk(cart.day)) { cart.day = days[0] || ""; saveCart(); }
    const otherDay = !days.includes(cart.day);
    // X3 : un jour qui a déjà une commande modifiable → ce panier s'y ajoute ; le minimum vaut pour la commande complétée.
    const bij = openFor(cart.day), erbij = !!(bij && bij.aanpasbaar);
    const total = cartTotal(), min = minimum(), below = ids.length > 0 && min > 0 && total < min && !erbij;
    if (!orders) ensureOrders().then(() => { if (K.hashParams().path === "winkelmand" && openFor(cart.day)) K.keep(app, renderWinkelmand); }).catch(() => {});
    const body = ids.length ? '<div class="kcols"><div class="kc-main"><div class="mcard">' + ids.map(id => { const p = byId(id); return '<div class="li"><div class="n"><b>' + K.esc(toon(p)) + '</b><div class="quiet fs-12 d-flex gap-6 ai-c f-wrap"><span>' + K.esc((p.kaliber ? p.kaliber + " · " : "") + unitLabel(p)) + ' · ' + K.eur(p.prix) + (pakP(p) ? " · " + K.esc(K.pakOne(pakP(p), p.unite)) : "") + '</span>' + stockTag(p) + '</div>' + pakCaption(p, cart.items[id]) + '</div>' + stepperOf(p, cart.items[id]) + '<b class="mono t">' + K.eur(p.prix * cart.items[id]) + '</b>' + noteHtml(p.id, K.t("Opmerking bij") + " " + toon(p), "c") + '</div>'; }).join("") + '</div></div><div class="kc-side">' +
      '<div class="mcard stack-10"><div class="field"><label id="lDay">' + K.t("Leverdag") + '</label><div class="opt" role="group" aria-labelledby="lDay">' + days.concat(otherDay && cart.day ? [cart.day] : []).map(d => '<button type="button" data-day="' + d + '"' + (d === cart.day ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + K.esc(K.date(d)) + '</button>').join("") + '</div>' +
      // Spec 038 : de datumkiezer van het toestel (« jj/mm/aaaa ») zit achter « Andere dag… » ; de gekozen dag verschijnt als knop, in het Belgische formaat.
      '<details class="kday mt-8"><summary class="tlink tap-44">' + K.t("Andere dag…") + '</summary><div class="d-flex ai-c gap-10 mt-8 f-wrap"><label for="otherDay" class="fs-13 m-0">' + K.t("Andere dag") + '</label><input type="date" class="input flex-1 minw-160" id="otherDay" min="' + firstDay() + '" max="' + lastDay() + '" value=""></div></details><div id="dayErr" role="alert"></div><span class="quiet fs-12">' + K.esc(K.tt("Levering op {d}. Vóór {t} besteld = geleverd op de eerstvolgende leverdag.", { d: daysLabel(), t: deadline() })) + '</span></div>' +
      '<div class="field" role="group" aria-labelledby="lAdr"><span class="flabel" id="lAdr">' + K.t("Leveradres") + '</span><div class="input d-flex ai-c ws-pre mh-44 p-8-12 fs-13">' + K.esc(cat.client.adresse || K.t("Adres bij Famo bekend")) + '</div><span class="quiet fs-12">' + K.t("Ander adres? Zet het in de opmerking.") + '</span></div>' +
      '<div class="field"><label for="note">' + K.t("Opmerking voor Famo") + '</label><textarea class="input" id="note" rows="2" placeholder="' + K.t("bv. graag achteraan bellen…") + '">' + K.esc(cart.note || "") + '</textarea></div></div>' +
      (erbij ? K.c.ok(K.esc(K.tt("U hebt al een bestelling voor {d} ({r}). Deze artikelen komen erbij.", { d: K.date(cart.day), r: bij.ref }))) : "") +
      '<div class="mcard stack-6 fs-13"><div class="spread"><span>' + K.t("Totaal excl. btw") + '</span><b class="mono">' + K.eur(total) + '</b></div><div class="quiet fs-12">' + K.esc(K.tt("De btw wordt op de factuur toegevoegd. Levering gratis · bestel vóór {t} voor levering op {d}.", { t: deadline(), d: K.dateLong(firstDay()) })) + (min > 0 ? ' · ' + K.esc(K.tt("Minimumbestelling {m} excl. btw", { m: K.eur(min) })) : "") + '</div></div>' +
      (below ? K.c.warn(K.esc(K.tt("Minimumbestelling {m} excl. btw · nog {r} toe te voegen.", { m: K.eur(min), r: K.eur(min - total) }))) : "") +
      (fitted.length ? K.c.warn(fitted.map(K.esc).join("<br>")) : "") +
      '<div id="orderErr"></div>' +
      '<div class="kplace"><button type="button" class="btn btn-p btn-block btn-tall" id="placeOrder"' + (below ? " disabled" : "") + '>' + K.t("Bestelling plaatsen") + ' · ' + K.eur(total) + '</button></div></div></div>'
      : K.c.empty(K.t("Uw winkelmand is leeg"), K.t("Kies producten in de catalogus."), '<a class="btn btn-p btn-sm mt-6" href="#/catalogus">' + K.t("Naar de catalogus") + '</a>');
    shell("catalogus", '<div class="mlist">' + body + '</div>', '<div class="mtop"><div class="mrow"><a href="#/catalogus" class="fs-13">' + K.icon("back") + ' ' + K.t("Catalogus") + '</a><span class="spacer"></span><h1 class="ktitle">' + K.t("Winkelmand") + '</h1><span class="spacer"></span>' + (ids.length ? '<button type="button" class="btn btn-ghost btn-sm" id="clearCart">' + K.t("Leegmaken") + '</button>' : "") + '</div></div>');
    bindSteppers(app, () => K.keep(app, renderWinkelmand)); // le focus reste sur le − / + du même article
    K.on(app, "click", "[data-day]", (e, t) => { cart.day = t.dataset.day; saveCart(); K.keep(app, renderWinkelmand); });
    const od = document.getElementById("otherDay"); if (od) od.addEventListener("change", () => {
      const v = od.value; const errBox = document.getElementById("dayErr");
      if (!v) { errBox.innerHTML = ""; return; }
      const msg = dayErr(v);
      if (msg) { errBox.innerHTML = '<span class="d-block fs-125 t-danger mt-4">' + K.esc(msg) + '</span>'; od.value = ""; return; }
      errBox.innerHTML = ""; cart.day = v; saveCart(); K.keep(app, renderWinkelmand);
    });
    K.on(app, "input", "[data-comment]", (e, t) => { cart.comments[t.dataset.comment] = t.value; saveCart(); });
    const note = document.getElementById("note"); if (note) note.addEventListener("input", () => { cart.note = note.value; saveCart(); });
    const clear = document.getElementById("clearCart"); if (clear) clear.onclick = async () => { if (await K.confirm({ title: K.t("Winkelmand leegmaken?"), text: K.t("Alle artikelen worden verwijderd."), yes: K.t("Leegmaken"), danger: true })) { cart.items = {}; cart.comments = {}; saveCart(); renderWinkelmand(); } };
    const place = document.getElementById("placeOrder"); if (place) place.onclick = placeOrder;
  }
  // Conditions générales (C-12) : nouvelle version publiée → lire et accepter avant de commander.
  async function ensureTerms(versie) {
    const ok = await K.confirm({ title: K.t("Algemene voorwaarden"), text: K.t("Onze algemene verkoopsvoorwaarden zijn nieuw of gewijzigd. Lees en aanvaard ze om te bestellen."), html: '<a class="tlink tap-44" href="/voorwaarden" target="_blank" rel="noopener">' + K.esc(K.t("Voorwaarden lezen")) + '</a>', yes: K.t("Ik aanvaard"), no: K.t("Later") });
    if (!ok) return false;
    await api("/api/klantorder", { json: Object.assign({}, creds(), { action: "acceptTerms", versie }) });
    if (cat) { cat.voorwaarden = { versie, aanvaard: true }; K.session.set(CAT_KEY, cat); }
    return true;
  }
  async function placeOrder(again) {
    const tv = cat && cat.voorwaarden;
    if (tv && tv.versie && !tv.aanvaard) { try { if (!(await ensureTerms(tv.versie))) return; } catch (err) { document.getElementById("orderErr").innerHTML = K.c.error(err.message); return; } }
    const btn = document.getElementById("placeOrder");
    const items = Object.entries(cart.items).filter(([id, qv]) => byId(id) && Number(qv) > 0).map(([id, qv]) => ({ productId: id, quantity: Number(qv), comment: cart.comments[id] || "" }));
    if (!items.length) return;
    // Zelfde controle als de server, voor een snelle melding ; de servermelding blijft altijd zichtbaar.
    const pre = dayErr(cart.day); if (pre) { document.getElementById("orderErr").innerHTML = K.c.error(pre); return; }
    K.busy(btn, true, K.t("Bestelling versturen…")); document.getElementById("orderErr").innerHTML = "";
    try {
      // Clé d'idempotence gardée avec le panier jusqu'au succès : un envoi répété après une réponse
      // perdue (réseau mobile) retrouve la même commande au lieu d'en créer une deuxième (B-19).
      if (!cart.key) { cart.key = (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); saveCart(); }
      const d = await api("/api/order", { json: Object.assign({}, creds(), { items, notes: cart.note || "", dateLivraison: cart.day, idempotencyKey: cart.key }) });
      lastOrder = { ref: d.ref, total: d.total, day: cart.day, samengevoegd: !!d.samengevoegd, toegevoegd: d.toegevoegd || 0, vorige: d.vorige || null, items: items.map(i => ({ nom: toon(byId(i.productId)), qty: i.quantity, prix: byId(i.productId).prix, unite: byId(i.productId).unite, pak: pakP(byId(i.productId)) })), at: Date.now(), mail: d.mail, email: (cat.client && cat.client.email) || "" };
      K.session.set("famoLastOrder", lastOrder);
      cart = { items: {}, comments: {}, note: "", day: "" }; saveCart(); orders = null;
      K.go("bevestigd");
    } catch (err) {
      // Version publiée entre-temps (catalogue en cache) : accepter puis renvoyer une fois.
      if (err.status === 409 && err.payload && err.payload.needTerms && again !== true) {
        K.busy(btn, false);
        try { if (await ensureTerms(err.payload.versie)) return placeOrder(true); } catch (e2) { document.getElementById("orderErr").innerHTML = K.c.error(e2.message); }
        return;
      }
      document.getElementById("orderErr").innerHTML = K.c.error(err.status === 401 ? K.t("Uw sessie is verlopen. Meld u opnieuw aan.") : err.message);
      K.busy(btn, false);
    }
  }
  // api/order.js : mail = {team, customer} (lib/ordermail notifyNewOrder), customer = {ok, skipped?, error?} ; null als mail uit staat.
  function mailNote(o) {
    const m = o.mail && o.mail.customer;
    if (!m) return '<p class="quiet fs-12 ta-c">' + K.t("Een bevestiging is gemaild als uw e-mailadres bij Famo bekend is.") + '</p>';
    if (m.ok) return '<p class="quiet fs-12 ta-c">' + K.t("Een bevestiging is gemaild naar") + ' ' + K.esc(o.email || "") + '</p>';
    if (m.skipped === "no-recipient") return K.c.warn(K.t("Geen bevestigingsmail: er is geen e-mailadres bij uw account. Voeg het toe via Account.") + ' <a href="#/account">' + K.t("Account") + '</a>');
    return K.c.warn(K.t("Geen bevestigingsmail ontvangen? De bestelling is wel goed geregistreerd. Bel Famo bij twijfel."));
  }
  function renderBevestigd() {
    const o = lastOrder;
    if (!o) { K.go("bestellingen"); return; }
    // X3 : un panier pour un jour qui avait déjà une commande s'y est ajouté (api/order.js « samengevoegd »).
    const added = o.samengevoegd ? K.tt(o.toegevoegd === 1 ? "1 artikel toegevoegd aan uw bestelling van {d}" : "{n} artikelen toegevoegd aan uw bestelling van {d}", { n: o.toegevoegd || o.items.length, d: K.date(o.day) }) : "";
    const tot = o.day && o.day > K.today() ? '<p class="x-state"><span class="cell-st c-new">' + K.esc(K.tt("Bevestigd · aanpasbaar {tot}", { tot: totTxt(o.day) })) + '</span></p>' : "";
    shell("catalogus", '<div class="ok-head"><div class="ok-ring">' + K.icon("check", "ok-ico") + '</div><h1 class="h1">' + (o.samengevoegd ? K.t("Toegevoegd aan uw bestelling") : K.t("Bestelling ontvangen")) + '</h1><p class="sub ws-normal fs-14">' + (added ? K.esc(added) + "." : K.t("Dank u wel. We zetten alles klaar voor") + ' <b>' + K.esc(K.dateLong(o.day)) + '</b>.') + '</p><span class="tag mono">' + K.esc(o.ref) + '</span>' + tot + '</div>' +
      '<div class="mlist pt-0"><div class="mcard"><ol class="tl" aria-label="' + K.t("Verloop") + '"><li aria-current="step"><i class="on" aria-hidden="true"></i><div><b>' + K.t("Ontvangen") + '</b><small>' + K.esc(K.date(K.isoDay(new Date(o.at).toISOString())) + " " + K.time(new Date(o.at).toISOString())) + '</small></div></li><li><i aria-hidden="true"></i><div>' + K.t("Wordt klaargezet") + '<small>' + K.t("de dag vóór levering") + '</small></div></li><li><i aria-hidden="true"></i><div>' + K.t("Onderweg") + '<small>' + K.esc(K.date(o.day)) + ' ' + K.t("ochtend") + '</small></div></li><li><i aria-hidden="true"></i><div>' + K.t("Geleverd → leveringsbon en factuur bij uw bestellingen") + '</div></li></ol></div>' +
      '<div class="mcard stack-6 fs-13">' + o.items.map(i => '<div class="d-flex jc-sb gap-10"><span>' + K.esc(lineTxt(i.qty, i.nom, i.unite) + (K.pakCount(i.qty, i.unite, i.pak || null) ? " (" + K.pakCount(i.qty, i.unite, i.pak) + ")" : "")) + '</span><span class="mono">' + K.eur(i.prix * i.qty) + '</span></div>').join("") + '<div class="d-flex jc-sb fw-600 bt-line pt-6"><span>' + K.t(o.samengevoegd ? "Totaal van de bestelling excl. btw" : "Totaal excl. btw") + '</span><span class="mono">' + K.eur(o.total) + '</span></div></div>' +
      (o.samengevoegd ? "" : mailNote(o)) +
      '<a class="btn btn-p btn-block" href="#/bestellingen">' + K.t("Naar mijn bestellingen") + '</a><a class="btn btn-o btn-block" href="#/catalogus">' + K.t("Verder bestellen") + '</a>' + contactCard() + '</div>');
    fillContact();
  }

  /* ---------- bestellingen ---------- */
  let ordFilter = "lopend";
  const unpaid = o => o.statut === "Facturée" && o.paiement !== "Payé";
  // Regels van een bestelling terug in de winkelmand : op productreferentie (o.items van /api/orders, B4 —
  // een hernoemd product blijft herkend), op naam enkel zonder referentie (oude bestellingen).
  function linesToCart(o) {
    let n = 0;
    const src = Array.isArray(o.items) ? o.items : K.parseLines(o.lignes).map(l => ({ productId: null, naam: l.name, qty: l.qty, comment: l.comment }));
    src.forEach(l => { const p = l.productId ? byId(l.productId) : (cat.products || []).find(x => x.nom.toLowerCase() === String(l.naam || "").toLowerCase()); if (!p || !(l.qty > 0)) return; const qv = capQty(p, fitQty(p, l.qty)); if (qv > 0) { cart.items[p.id] = qv; if (l.comment) cart.comments[p.id] = l.comment; n++; } });
    saveCart(); return n;
  }
  function reorder(o) { const n = linesToCart(o); K.toast(n ? n + " " + K.t(n === 1 ? "artikel" : "artikelen") + " " + K.t("in de winkelmand gezet") : K.t("Deze artikelen staan niet meer in de catalogus"), { kind: n ? "" : "err" }); if (n) { closePanel(); K.go("winkelmand"); } }
  const cancelCall = ref => api("/api/klantorder", { json: Object.assign({}, creds(), { action: "cancel", ref }) });
  function closePanel() { if (panel) { panel.close(); panel = null; } }
  const btn = (attr, label, extra) => '<button type="button" class="btn ' + (extra || "btn-o") + ' btn-sm flex-1' + (/cancel-order/.test(attr) ? " t-danger" : "") + '" ' + attr + '>' + label + '</button>';
  // Knoppen per status : documenten (klantdoc), opnieuw bestellen (altijd), wijzigen en annuleren (Reçue of Prête, tot vertrek).
  function actions(o) {
    const r = ' data-ref="' + K.esc(o.ref) + '"';
    return (o.statut === "Facturée" ? btn('data-doc="invoice"' + r, invLabel()) + btn('data-doc="delivery"' + r, K.t("Leveringsbon")) : o.statut === "Sortie en livraison" ? btn('data-doc="delivery"' + r, K.t("Leveringsbon")) : "") +
      // Spec 038 : een bestelling die nog aanpasbaar is, bestelt u niet « opnieuw » ; annuleren zit dan in « Wijzigen ».
      (o.aanpasbaar ? btn('data-edit-order="' + K.esc(o.ref) + '"', K.t("Wijzigen"), "btn-p") : btn('data-reorder="' + K.esc(o.ref) + '"', K.t("Opnieuw bestellen"))) +
      (!o.aanpasbaar && (o.statut === "Reçue" || o.statut === "Prête") ? btn('data-cancel-order="' + K.esc(o.ref) + '"', K.t("Annuleren"), "btn-ghost") : "");
  }
  // X3 : « bevestigd, aanpasbaar tot 22:00 » tant que la commande se modifie (statut Reçue, avant l'heure limite).
  // Spec 038 : in de lijst kort (« Aanpasbaar tot 22:00 »), in het detail volledig. Geleverd en niet betaald : met vervaldatum
  // (« Te betalen vóór 06/11 », ambre ; « Vervallen sinds … », rood) ; zonder vervaldatum « Geleverd · niet betaald ».
  const badge = (o, kort) => o.aanpasbaar && o.dateLiv ? '<span class="cell-st c-new">' + K.esc(kort ? K.tt("Aanpasbaar {tot}", { tot: totTxt(o.dateLiv) }) : K.tt("Bevestigd · aanpasbaar {tot}", { tot: totTxt(o.dateLiv) })) + '</span>' : o.statut === "Facturée" ? (o.paiement === "Payé" ? K.stCell("Facturée", K.t("Geleverd · betaald")) : payBadge(o)) : K.isLate(o) ? '<span class="cell-st c-late">' + K.t("Te laat") + '</span>' : K.stCell(o.statut);
  const payBadge = o => !o.vervaldatum ? '<span class="cell-st c-new">' + K.t("Geleverd · niet betaald") + '</span>' : o.vervaldatum < K.today() ? '<span class="cell-st c-late">' + K.esc(K.tt("Vervallen sinds {d}", { d: K.date(o.vervaldatum) })) + '</span>' : '<span class="cell-st c-new">' + K.esc(K.tt("Te betalen vóór {d}", { d: K.date(o.vervaldatum) })) + '</span>';
  const stamp = iso => iso ? K.dateLong(iso) + (String(iso).includes("T") ? " " + K.time(iso) : "") : "";
  // Leveruur gezet door Famo (D4) : enkel tot de levering, in de taal van de klant.
  const slotTxt = o => { const sl = o.statut !== "Facturée" && o.statut !== K.CANCELLED ? K.slot(o.leverslot) : null; return sl ? K.tt("tussen {van} en {tot}", sl) : ""; };
  function openOrder(ref) {
    const o = (orders || []).find(x => x.ref === ref); if (!o) return;
    closePanel();
    const cancelled = o.statut === K.CANCELLED, idx = K.STATUSES.indexOf(o.statut), lines = K.parseLines(o.lignes);
    const when = { "Reçue": o.date ? K.dateLong(o.date) : "", "Sortie en livraison": o.livreeLe ? stamp(o.livreeLe) + (o.receptionnePar ? " · " + o.receptionnePar : "") : (idx < 3 && o.dateLiv ? K.date(o.dateLiv) + " " + (slotTxt(o) || K.t("ochtend")) : ""), "Facturée": o.factureeLe ? stamp(o.factureeLe) + (docNr(o) ? " · " + docNr(o) : "") : "" };
    const tl = cancelled
      ? '<ol class="tl" aria-label="' + K.t("Verloop") + '"><li><i class="on" aria-hidden="true"></i><div><b>' + K.t("Ontvangen") + '</b><small>' + K.esc(when["Reçue"]) + '</small></div></li><li aria-current="step"><i class="on bg-danger" aria-hidden="true"></i><div><b>' + K.t("Geannuleerd") + '</b><small>' + K.esc([stamp(o.annuleeLe), o.motifAnnulation ? K.t("Reden") + ": " + K.t(o.motifAnnulation) : ""].filter(Boolean).join(" · ")) + '</small></div></li></ol>'
      // G-24 : le suivi est une liste ordonnée, l'étape atteinte porte aria-current="step".
      : '<ol class="tl" aria-label="' + K.t("Verloop") + '">' + K.STATUSES.map((st, i) => '<li' + (i === idx ? ' aria-current="step"' : "") + '><i' + (i <= idx ? ' class="on"' : "") + ' aria-hidden="true"></i><div>' + (i <= idx ? '<b>' + K.esc(K.status(st)) + '</b>' : K.esc(K.status(st))) + (when[st] ? '<small>' + K.esc(when[st]) + '</small>' : "") + '</div></li>').join("") + '</ol>';
    const row = (label, value) => value ? '<div class="row"><div>' + K.esc(label) + '<small class="ws-pre">' + K.esc(value) + '</small></div></div>' : "";
    const body = '<div class="mcard mb-10">' + tl + '</div>' + "" +
      (o.uitzondering ? K.c.warn('<b>' + K.t("Uitzondering levering") + '</b> ' + K.esc(o.uitzondering)) + '<div class="h-10"></div>' : "") +
      '<div class="mcard mb-10"><div class="sec m-0 mb-6">' + K.t("Artikelen") + '</div><div class="stack-6 fs-13">' + lines.map(l => { const pr = prodOf(o, l.name), og = pr ? originHtml(pr) : ""; return '<div class="d-flex jc-sb gap-10"><span class="minw-0" data-lname="' + K.esc(String(l.name || "").trim().toLowerCase()) + '">' + K.esc(lineTxt(l.qty, l.name, l.unit) + (l.unit && !kgUnit(l.unit) && !/^(pi[eè]ce|stuk)$/i.test(l.unit) ? " · " + K.unit(l.unit) : "") + (K.pakCount(l.qty, l.unit, K.pakIn(o.verpakking, l.name)) ? " · " + K.pakCount(l.qty, l.unit, K.pakIn(o.verpakking, l.name)) : "") + (l.comment ? " (" + l.comment + ")" : "")) + (og ? '<small class="x-o d-block">' + og + '</small>' : "") + '</span>' + (l.price != null ? '<span class="mono">' + K.eur(l.price * l.qty) + '</span>' : "") + '</div>'; }).join("") + '<div class="d-flex jc-sb fw-600 bt-line pt-6"><span>' + K.t("Totaal excl. btw") + '</span><span class="mono">' + K.eur(o.total) + '</span></div>' +
      // Spec 038 : de herkomst hierboven komt uit de productfiche ; het lot per artikel staat op de leveringsbon (spec 035).
      (o.statut === "Facturée" || o.statut === "Sortie en livraison" ? '<p class="quiet fs-12 m-0" id="oLotNote">' + K.t("Lotnummer en herkomst per lot: zie de leveringsbon.") + '</p>' : "") + '</div></div>' +
      '<div class="mcard">' + row(K.t("Besteld op"), o.date ? K.dateLong(o.date) : "") + row(K.t("Gewenste leverdag"), o.dateLiv ? K.dateLong(o.dateLiv) : "") + row(K.t("Verwacht leveruur"), slotTxt(o)) +
      row(portaal() ? K.t("Factuurnummer") : K.t("Overzicht · pro forma"), docNr(o)) + row(K.t("Gefactureerd op"), portaal() ? stamp(o.factureeLe) : "") + row(K.t("Geleverd op"), stamp(o.livreeLe)) + row(K.t("Ontvangen door"), o.receptionnePar) +
      (o.paiement === "Payé" ? row(K.t("Betaald op"), stamp(o.payeLe) || K.t("Betaald")) : "") +
      // Facture du portail (mode Portaal) : échéance et reste à payer (specs/034). Mode boekhouder : rien de plus, l'échéance
      // est celle de la facture du comptable.
      // Spec 038 : de vervaldatum (Facturée le + betaaltermijn, berekend door de server) in beide modi ; het bedrag « nog te
      // betalen » enkel in modus Portaal (in modus boekhouder komt het bedrag van de factuur van de boekhouding, ADR 0005).
      (o.statut === "Facturée" && o.paiement !== "Payé" ? row(K.t("Te betalen vóór"), o.vervaldatum ? K.dateLong(o.vervaldatum) : "") + (portaal() && o.openstaand != null ? row(K.t("Nog te betalen"), K.eur(o.openstaand) + " " + K.t("incl. btw")) : "") : "") +
      // Alle creditnota's (C-08), elk als document in de taal van de klant (FR/NL).
      (o.creditnotas && o.creditnotas.length ? o.creditnotas : o.creditnota ? [o.creditnota] : []).map(n => '<div class="row"><div>' + K.esc(K.t("Creditnota") + " " + n.nummer) + '<small>' + K.esc([K.eur(n.montant) + " " + K.t("excl. btw"), stamp(n.le)].filter(Boolean).join(" · ")) + '</small></div><button type="button" class="btn btn-o btn-sm" data-doc="credit" data-ref="' + K.esc(o.ref) + '" data-cn="' + K.esc(n.nummer) + '">' + K.t("Openen") + '</button></div>').join("") +
      row(K.t("Uw opmerking"), o.notes) + '</div>';
    panel = K.panel({ title: K.t("Bestelling") + " " + o.ref, sub: (o.dateLiv ? K.t("Levering") + " " + K.date(o.dateLiv) + " · " : "") + K.eur(o.total) + " " + K.t("excl. btw"), body, footer: '<div class="d-flex gap-8 f-wrap w-100p">' + actions(o) + '</div>', onClose: () => { panel = null; } });
    const st = panel.el.querySelector(".panel-h .h2"); if (st) st.insertAdjacentHTML("afterend", '<div class="mt-6">' + badge(o) + '</div>');
    bindOrderActions(panel.el);
    if (o.statut === "Facturée" || o.statut === "Sortie en livraison") showLots(o.ref, panel);
  }
  // Spec 035/038 : op een geleverde bestelling het lot per artikel (zelfde gegevens als de leveringsbon, /api/klantdoc).
  async function showLots(ref, pnl) {
    let d; try { d = await api("/api/klantdoc", { json: Object.assign({}, creds(), { ref }) }); } catch (e) { return; }
    const lots = d && d.order && d.order.lots && typeof d.order.lots === "object" ? d.order.lots : null; if (!lots || panel !== pnl) return;
    const byName = new Map(Object.keys(lots).map(k => [String(k).trim().toLowerCase(), lots[k]]));
    let any = false;
    K.$$("[data-lname]", pnl.el).forEach(sp => {
      const list = byName.get(sp.dataset.lname) || []; if (!Array.isArray(list) || !list.length) return;
      any = true;
      sp.insertAdjacentHTML("beforeend", list.map(l => '<small class="quiet d-block mono">' + K.esc([K.t("Lot") + " " + (l.lotnummer || "—"), l.tht ? K.t("houdbaar tot") + " " + K.date(l.tht) : ""].filter(Boolean).join(" · ")) + '</small>').join(""));
    });
    const note = pnl.el.querySelector("#oLotNote"); if (note && any) note.textContent = K.t("Lot per artikel, zoals op de leveringsbon.");
  }
  // Product van een regel : op referentie (o.items), anders op naam.
  const prodOf = (o, name) => { const it = (o.items || []).find(i => String(i.naam || "").toLowerCase() === String(name || "").toLowerCase()); return (it && it.productId && byId(it.productId)) || (cat.products || []).find(x => x.nom.toLowerCase() === String(name || "").toLowerCase()) || null; };
  function editOrder(o) {
    closePanel();
    const lines = linesOfOrder(o);
    if (lines.length !== (o.items || []).length) { K.toast(K.t("Wordt klaargezet. Bel Famo om nog iets te wijzigen."), { kind: "err" }); return; }
    const st = { lines };
    // Spec 038 : een product toevoegen gebeurt hier zelf (zoeken → « + »), niet meer via Bestellen en de winkelmand.
    const body = '<p class="quiet fs-13 m-0">' + K.t("Pas aantallen aan of zet op 0 om te schrappen.") + '</p><ul class="x-ul x-ul-p" id="eLines">' + lines.map(l => usualLineHtml(l, false).replace('data-stepper="u:', 'data-stepper="e:')).join("") + '</ul>' +
      '<div class="ke-add"><label class="flabel" for="eQ">' + K.t("Product toevoegen") + '</label><div class="search"><label class="ks-l">' + K.icon("search") + '<input id="eQ" type="search" placeholder="' + K.t("Zoek: zalm, 16/20, inktvis…") + '" autocomplete="off" spellcheck="false" enterkeyhint="search"></label></div><ul class="ke-hits" id="eHits" aria-live="polite"></ul></div><div id="eErr"></div>' +
      // Spec 038 : annuleren is een uitzondering, dus een discrete link onderaan het paneel (niet naast « Wijzigen »).
      '<p class="mt-14 m-0"><button type="button" class="linkbtn t-danger tap-44" data-cancel-order="' + K.esc(o.ref) + '">' + K.t("Hele bestelling annuleren") + '</button></p>';
    panel = K.panel({ title: K.t("Bestelling wijzigen"), sub: o.ref + (o.dateLiv ? " · " + K.t("Levering") + " " + K.date(o.dateLiv) + " · " + K.tt("Wijzigen {tot}", { tot: totTxt(o.dateLiv) }) : ""), body, footer: '<button type="button" class="btn btn-p btn-block" id="eSave"><span>' + K.t("Wijziging opslaan") + '</span> <span class="mono" id="eTot"></span></button>', onClose: () => { panel = null; } });
    const bindLine = stp => {
      const id = String(stp.dataset.stepper || "").replace(/^e:/, ""), l = st.lines.find(x => x.p.id === id), inp = stp.querySelector("input"); if (!l) return;
      const n = stepUnits(l.p), step = n > 1 ? 1 : isKg(l.p) ? 0.5 : 1;
      const set = v0 => { let v = n > 1 ? Math.max(0, Math.round(v0)) * n : Math.max(0, Math.round(v0 * 1000) / 1000); if (n === 1 && !isKg(l.p)) v = Math.round(v); l.qty = capQty(l.p, v); inp.value = K.num(l.qty / n); pakSuffix(stp, l.p, l.qty); stp.closest("li").classList.toggle("x-off", !(l.qty > 0)); tot(); };
      stp.querySelector("[data-dec]").onclick = () => set((K.parseNum(inp.value) || 0) - step);
      stp.querySelector("[data-inc]").onclick = () => set((K.parseNum(inp.value) || 0) + step);
      inp.addEventListener("change", () => set(K.parseNum(inp.value) || 0));
    };
    // Zoeken in de catalogus (actieve producten, uitverkocht niet) ; een treffer « + » zet één stap op de bestelling.
    const hits = () => {
      const qk = K.searchKey(panel.el.querySelector("#eQ").value), box = panel.el.querySelector("#eHits");
      if (!qk) { box.innerHTML = ""; return; }
      const have = new Set(st.lines.map(l => l.p.id));
      const list = (cat.products || []).filter(p => !have.has(p.id) && stock(p) !== 0 && K.searchHit(K.searchKey([p.nom, p.kaliber, p.vis && p.vis.wetenschappelijkeNaam].filter(Boolean).join(" ")), qk)).slice(0, 6);
      box.innerHTML = list.length ? list.map(p => '<li><span class="minw-0"><b>' + K.esc(toon(p)) + '</b><small class="quiet mono d-block">' + K.eur(p.prix) + ' / ' + K.esc(unitLabel(p)) + '</small></span><button type="button" class="btn btn-o btn-sm" data-eadd="' + p.id + '" aria-label="' + K.esc(K.t("Toevoegen") + ": " + toon(p)) + '">+ ' + K.t("Toevoegen") + '</button></li>').join("") : '<li class="quiet fs-13">' + K.esc(K.t("Niets gevonden voor") + " „" + panel.el.querySelector("#eQ").value.trim() + "”") + '</li>';
    };
    const tot = () => { const t = st.lines.reduce((s2, l) => s2 + window.FamoVat.r2(l.p.prix * l.qty), 0); panel.el.querySelector("#eTot").textContent = K.eur(t); panel.el.querySelector("#eSave").disabled = !st.lines.some(l => Math.abs(l.qty - l.orig) > 1e-9) || !st.lines.some(l => l.qty > 0); };
    K.$$(".stepper", panel.el).forEach(bindLine);
    tot();
    panel.el.querySelector("#eQ").addEventListener("input", K.debounce(hits, 120));
    K.on(panel.el, "click", "[data-eadd]", (e, t) => {
      const p = byId(t.dataset.eadd); if (!p) return;
      const v = capQty(p, stepUnits(p) > 1 ? stepUnits(p) : isKg(p) ? 0.5 : 1); if (!(v > 0)) { K.toast(K.t("Uitverkocht"), { kind: "err" }); return; }
      const l = { p, qty: v, orig: 0 }; st.lines.push(l);
      panel.el.querySelector("#eLines").insertAdjacentHTML("beforeend", usualLineHtml(l, false).replace('data-stepper="u:', 'data-stepper="e:'));
      const stp = panel.el.querySelector('#eLines [data-stepper="e:' + CSS.escape(p.id) + '"]'); if (stp) { bindLine(stp); const inc = stp.querySelector("[data-inc]"); if (inc) inc.focus(); }
      const q = panel.el.querySelector("#eQ"); q.value = ""; hits(); tot();
    });
    bindOrderActions(panel.el);
    panel.el.querySelector("#eSave").onclick = e => saveOrder(o.ref, st.lines.filter(l => l.qty > 0).map(l => ({ productId: l.p.id, quantity: l.qty })), e.currentTarget, () => { closePanel(); if (K.hashParams().path === "bestellingen" || K.hashParams().path === "facturen") renderOrderList(); });
  }
  // Zelfde knoppen op de kaart en in het paneel : één binding per host.
  function bindOrderActions(root) {
    K.on(root, "click", "[data-open]", (e, t) => { const b = e.target.closest("button,a"); if (b && b !== t) return; openOrder(t.dataset.open); });
    K.on(root, "click", "[data-cancel-order]", async (e, t) => {
      const ref = t.dataset.cancelOrder;
      if (!(await K.confirm({ title: K.t("Bestelling") + " " + ref + " " + K.t("annuleren?"), text: K.t("Ze wordt niet klaargezet en niet geleverd. U kunt ze daarna opnieuw bestellen."), yes: K.t("Annuleren"), no: K.t("Behouden"), danger: true }))) return;
      K.busy(t, true, K.t("Annuleren…"));
      try { await cancelCall(ref); K.toast(K.t("Bestelling") + " " + ref + " " + K.t("geannuleerd")); orders = null; closePanel(); renderBestellingen(); }
      catch (err) { K.toast(err.message, { kind: "err" }); K.busy(t, false); if (err.status === 404 || err.status === 409) { orders = null; closePanel(); renderBestellingen(); } }
    });
    // Wijzigen (X3, specs/036) : la commande reste ; on change les quantités ou on retire (0). Ajouter : par Bestellen,
    // le panier du même jour s'ajoute à cette commande (api/order.js).
    K.on(root, "click", "[data-edit-order]", (e, t) => { const o = (orders || []).find(x => x.ref === t.dataset.editOrder); if (o) editOrder(o); });
    K.on(root, "click", "[data-doc]", async (e, t) => { K.busy(t, true, K.t("Laden…")); try { await K.docs(); const d = await api("/api/klantdoc", { json: Object.assign({}, creds(), { ref: t.dataset.ref }) }); FamoDocuments.setCompany(d.config); const type = t.dataset.doc; const cn = type === "credit" ? (d.order.creditnotas || []).find(n => n.nummer === t.dataset.cn) : null; if (type === "credit" && !cn) throw new Error(K.t("Creditnota niet gevonden")); const doc = cn ? Object.assign({}, d.order, { creditnota: cn }) : d.order; const html = FamoDocuments.build(doc, type); famoDocPreview.open({ html, filename: FamoDocuments.filename(doc, type), title: type === "invoice" ? invLabel() + " " + FamoDocuments.number(doc, "invoice") : cn ? K.t("Creditnota") + " " + FamoDocuments.number(doc, "credit") : K.t("Leveringsbon") + " " + d.order.ref, meta: K.eur(cn ? cn.montant : d.order.total) + " " + K.t("excl. btw") }); } catch (err) { K.toast(err.message, { kind: "err" }); } finally { K.busy(t, false); } });
    K.on(root, "click", "[data-reorder]", (e, t) => { const o = (orders || []).find(x => x.ref === t.dataset.reorder); if (o) reorder(o); });
    K.on(root, "click", "[data-copy]", async (e, t) => { try { await navigator.clipboard.writeText(t.dataset.copy); K.toast(K.t("Gekopieerd")); } catch (err) { K.toast(K.t("Kopiëren lukt niet op dit toestel."), { kind: "err" }); } });
  }
  // Document « factuur » van het portaal : pro forma zolang de boekhouding factureert (lib/billing.js).
  const portaal = () => (cat && cat.company && cat.company.facturatie) === "portaal";
  // Spec 038 : modus boekhouder → « Overzicht · pro forma » (zelfde titel als het document, nooit « factuur » : de wettelijke
  // factuur komt van de boekhouding, ADR 0005) ; de vervaldatum staat in de statusbadge (badge/payBadge), niet nog eens hier.
  const invLabel = () => (portaal() ? K.t("Factuur") : K.t("Overzicht · pro forma"));
  // Zelfde nummer als op het document (FamoDocuments.number) : FA- in modus Portaal, PF- in modus boekhouder.
  const docNr = o => (o.factuurnummer ? (portaal() ? o.factuurnummer : "PF-" + String(o.factuurnummer).replace(/^FA-/i, "")) : "");
  const dueTxt = o => portaal() && unpaid(o) && o.vervaldatum ? (o.vervaldatum < K.today() ? K.t("Vervallen") + " " + K.date(o.vervaldatum) : K.t("vervalt op") + " " + K.date(o.vervaldatum)) : "";
  // Openstaande facturen. Modus « boekhouder » (standaard) : de factuur én de betaalgegevens komen van
  // de boekhouding (Peppol) ; het portaal toont dan geen kaart en geen bedrag « te betalen » (anders twee facturen).
  // Modus « portaal » : totaal INCL. btw (zelfde regel als de factuur) en gestructureerde mededeling.
  const ogm = nr => { const m = String(nr || "").match(/^FA-(\d{4})-(\d{1,6})$/i); if (!m) return ""; const base = m[1] + m[2].padStart(6, "0"); const d = base + String(Number(base) % 97 || 97).padStart(2, "0"); return "+++" + d.slice(0, 3) + "/" + d.slice(3, 7) + "/" + d.slice(7) + "+++"; };
  function statement(list) {
    const co = cat.company || {};
    // Modus « boekhouder » : geen kaart meer (de vermelding « via de boekhouding (Peppol) » is weg sinds 2026-10-08).
    if (co.facturatie !== "portaal") return "";
    // Reste à payer calculé par le serveur (facture TVAC moins notes de crédit, /api/orders) ; sinon la facture TVAC.
    const due = o => Number(o.openstaand != null ? o.openstaand : o.totalIncl != null ? o.totalIncl : o.total || 0);
    const sum = list.reduce((s, o) => s + due(o), 0);
    const bank = [co.iban ? "IBAN " + co.iban : "", co.bic ? "BIC " + co.bic : ""].filter(Boolean).join(" · ");
    const ref = o => ogm(o.factuurnummer) || o.factuurnummer || o.ref;
    const payText = o => [co.bedrijfsnaam || "FAMO Seafood", co.iban ? "IBAN " + co.iban : "", co.bic ? "BIC " + co.bic : "", K.eur(due(o)) + " " + K.t("incl. btw"), K.t("Mededeling") + ": " + ref(o)].filter(Boolean).join(" · ");
    return '<div class="mcard card-tint d-flex f-col gap-8"><div class="spread-c"><b>' + K.t("Openstaande facturen") + '</b><span class="fs-125">' + K.t("Totaal openstaand") + ' <b class="mono">' + K.eur(sum) + '</b> ' + K.t("incl. btw") + '</span></div>' +
      list.map(o => '<div class="d-flex jc-sb ai-c gap-8 fs-125"><div class="minw-0"><b class="mono">' + K.esc(o.factuurnummer || o.ref) + '</b><div class="quiet fs-12">' + K.esc(K.date(o.factureeLe || o.date)) + (dueTxt(o) ? ' · <span class="' + (o.vervaldatum < K.today() ? "t-danger" : "") + '">' + K.esc(dueTxt(o)) + '</span>' : "") + ' · ' + K.t("Mededeling") + ': <span class="mono">' + K.esc(ref(o)) + '</span></div></div><span class="mono">' + K.eur(due(o)) + '</span><button type="button" class="btn btn-o btn-sm" data-copy="' + K.esc(payText(o)) + '">' + K.t("Kopiëren") + '</button></div>' +
        // QR de virement (specs/034) : place réservée, remplie après chargement du module (fillQr) si l'IBAN est réel.
        '<div class="kqr-slot" data-qr-ref="' + K.esc(o.ref) + '" data-qr-amount="' + K.esc(String(due(o))) + '" hidden></div>').join("") +
      (bank ? '<div class="quiet fs-12 d-flex jc-sb ai-c gap-8 f-wrap"><span>' + K.t("Betaalgegevens") + ': <span class="mono">' + K.esc(bank) + '</span></span><button type="button" class="btn btn-ghost btn-sm" data-copy="' + K.esc(co.iban) + '">' + K.t("Kopiëren") + '</button></div>' : "") + '</div>';
  }
  // x30 : deux vues des mêmes commandes — « Leveringen » (#/bestellingen : lopend, geleverd, alles) et « Facturen »
  // (#/facturen : les commandes livrées, à payer d'abord, relevé et QR en mode Portaal). Les liens des e-mails restent.
  let facFilter = "";
  const isFac = () => K.hashParams().path === "facturen";
  async function renderBestellingen() {
    const fac = isFac();
    shell(fac ? "facturen" : "bestellingen", '<div class="mlist" id="ordersBox">' + K.c.skeleton(3) + '</div>', topbar(K.t(fac ? "Facturen" : "Leveringen"), cat.client.nom));
    await K.retryBox("ordersBox", async () => { await loadOrders(); renderOrderList(); });
  }
  function renderOrderList() {
    const open = o => !K.isClosed(o), fac = isFac();
    const nUnpaid = orders.filter(unpaid).length;
    if (fac && !facFilter) facFilter = nUnpaid ? "tebetalen" : "alle";
    const flt = fac ? facFilter : ordFilter;
    const list = orders.filter(o => fac ? o.statut === "Facturée" && (flt === "alle" || unpaid(o)) : flt === "lopend" ? open(o) : flt === "geleverd" ? !open(o) : flt === "tebetalen" ? unpaid(o) : true);
    const chips = '<div class="cats">' + (fac ? [["tebetalen", K.t("Te betalen") + (nUnpaid ? " · " + nUnpaid : "")], ["alle", K.t("Alle facturen")]] : [["lopend", K.t("Lopend")], ["geleverd", K.t("Geleverd · documenten")], ["alles", K.t("Alles")]]).map(([k, l]) => '<button type="button" data-of="' + k + '"' + (k === flt ? ' class="on"' : "") + '>' + l + '</button>').join("") + '</div>';
    // Une ligne par commande (et plus une carte) : date, articles, statut, montant ; sur ordinateur les documents
    // et « Opnieuw bestellen » restent sur la ligne. Tout le reste (wijzigen, annuleren, détail) : clic sur la ligne.
    // Facturen : één actie, het document. Leveringen : bon (geleverd) en « Opnieuw bestellen » (niet bij een aanpasbare bestelling).
    const quick = o => { const r = ' data-ref="' + K.esc(o.ref) + '"'; if (fac) return '<button type="button" class="btn btn-o btn-sm" data-doc="invoice"' + r + '>' + K.t("Bekijken") + '</button>'; return (o.statut === "Facturée" || o.statut === "Sortie en livraison" ? '<button type="button" class="btn btn-o btn-sm" data-doc="delivery"' + r + '>' + K.t("Leveringsbon") + '</button>' : "") + (o.aanpasbaar ? "" : '<button type="button" class="btn btn-ghost btn-sm" data-reorder="' + K.esc(o.ref) + '">' + K.t("Opnieuw bestellen") + '</button>'); };
    const card = o => '<div class="orow' + (o.statut === K.CANCELLED ? " is-cancel" : "") + '"><button type="button" class="orow-main" data-open="' + K.esc(o.ref) + '" aria-label="' + K.esc(K.t("Bestelling") + " " + o.ref + ", " + K.t("details")) + '"><span class="orow-d"><b>' + K.esc(o.dateLiv ? K.t("Levering") + " " + K.date(o.dateLiv) + (slotTxt(o) ? " · " + slotTxt(o) : "") : K.date(o.date)) + '</b><small class="mono">' + K.esc(fac && docNr(o) ? docNr(o) : o.ref) + '</small></span><span class="orow-s">' + K.esc(sumTxt(o)) + '</span><span class="orow-st">' + badge(o, true) + '</span><b class="mono orow-t">' + K.eur(o.total) + '</b>' + K.icon("chev", "orow-chev") + '</button><span class="orow-a">' + quick(o) + '</span></div>';
    const empty = fac ? (flt === "tebetalen" ? K.c.empty(K.t("Geen openstaande facturen"), K.t("Alles is betaald. Dank u wel.")) : K.c.empty(K.t("Geen facturen"), K.t("Na levering vindt u hier elke factuur."))) : flt === "lopend" ? K.c.empty(K.t("Geen lopende bestellingen"), K.tt("Bestel vóór {t} voor levering op {d}.", { t: deadline(), d: K.dateLong(firstDay()) }), '<a class="btn btn-p btn-sm mt-6" href="#/catalogus">' + K.t("Naar de catalogus") + '</a>') : ordFilter === "tebetalen" ? K.c.empty(K.t("Geen openstaande facturen"), K.t("Alles is betaald. Dank u wel.")) : K.c.empty(K.t("Niets in deze lijst"));
    // G-13 : la pastille de l'onglet compte les factures à payer ; la vue qui s'ouvre le dit et y mène en un geste.
    const payHint = !fac && nUnpaid ? '<div class="full">' + K.c.warn('<span>' + K.esc(nUnpaid + " " + K.t(nUnpaid === 1 ? "factuur te betalen" : "facturen te betalen")) + '</span> <a class="linkbtn" href="#/facturen">' + K.t("Bekijken") + '</a>') + '</div>' : "";
    const st = fac && flt === "tebetalen" && list.length ? statement(list) : ""; // modus boekhouder : leeg, geen kaart
    shell(fac ? "facturen" : "bestellingen", '<div class="mlist grid">' + payHint + (st ? '<div class="full">' + st + '</div>' : "") + (list.length ? '<div class="olist full">' + list.map(card).join("") + '</div>' : '<div class="full">' + empty + '</div>') + '</div>', topbar(K.t(fac ? "Facturen" : "Leveringen"), (cat.client.nom ? cat.client.nom + " · " : "") + K.t("Bedragen excl. btw")).slice(0, -6) + chips + "</div>");
    const ofGroup = app.querySelector("[data-of]") && app.querySelector("[data-of]").parentElement; if (ofGroup) ofGroup.setAttribute("aria-label", K.t("Filter")); // G-06 : groupe de filtres nommé (aria-pressed : K.syncStates)
    K.on(app, "click", "[data-of]", (e, t) => { if (isFac()) facFilter = t.dataset.of; else ordFilter = t.dataset.of; K.keep(app, renderOrderList); });
    bindOrderActions(app);
    if (st) fillQr();
  }
  // QR de virement européen dans le relevé (specs/034, assets/epc.js) : uniquement en mode Portaal (le relevé n'existe
  // pas en mode boekhouder) et avec un IBAN réel ; FamoEpc.forInvoice refuse l'IBAN d'exemple et un montant nul.
  async function fillQr() {
    const slots = K.$$("[data-qr-ref]", app); if (!slots.length) return;
    try { await K.docs(); } catch (e) { return; } // sans module : le relevé garde IBAN et communication, sans QR
    const co = cat.company || {}, company = { facturatie: co.facturatie, iban: co.iban, bic: co.bic, legal: co.legal, nom: co.bedrijfsnaam };
    slots.forEach(el => {
      const o = (orders || []).find(x => x.ref === el.dataset.qrRef); if (!o || !window.FamoEpc) return;
      const qr = window.FamoEpc.forInvoice({ company, bedrag: Number(el.dataset.qrAmount), mededeling: ogm(o.factuurnummer), factuurnummer: o.factuurnummer, label: K.t("QR-code voor overschrijving") + " " + (o.factuurnummer || o.ref) });
      if (!qr) return;
      el.innerHTML = '<details class="kqr"><summary class="btn btn-ghost btn-sm">' + K.t("Betalen met QR-code") + '</summary><figure class="kqr-fig">' + qr.svg + '<figcaption class="quiet fs-12">' + K.t("Scan met uw bank-app om te betalen") + '</figcaption></figure></details>';
      el.hidden = false;
    });
  }

  /* ---------- favorieten / standaard ---------- */
  function renderFavorieten() {
    // Spec 038 : dezelfde « vaste producten » als in Bestellen (wat u vaak neemt, server) + uw sterren.
    const vast = new Set((ordersMeta.vaste || []).concat(Object.keys(favs)));
    const favList = (cat.products || []).filter(p => vast.has(p.id)).sort(K.catalogSort("standaard"));
    if (!orders) ensureOrders().then(() => { if (K.hashParams().path === "favorieten") K.keep(app, renderFavorieten); }).catch(() => {});
    const stdList = std ? Object.entries(std).map(([id, qv]) => ({ p: byId(id), qty: qv })).filter(x => x.p) : [];
    const stdTotal = stdList.reduce((s, x) => s + x.p.prix * x.qty, 0);
    const stdCard = '<div class="mcard card-tint"><div class="spread-c"><div><b>' + K.t("Mijn standaardbestelling") + '</b><div class="quiet fs-12">' + (stdList.length ? stdList.length + " " + K.t("artikelen") + " · " + K.eur(stdTotal) : K.t("Nog niet ingesteld")) + '</div></div></div>' +
      (stdList.length ? '<div class="mt-8 fs-125 t-ink2">' + stdList.map(x => K.qty(x.qty) + "× " + K.esc(toon(x.p)) + (K.pakCount(x.qty, x.p.unite, pakP(x.p)) ? " (" + K.esc(K.pakCount(x.qty, x.p.unite, pakP(x.p))) + ")" : "")).join(" · ") + '</div><div class="d-flex gap-8 mt-10"><button type="button" class="btn btn-p btn-sm flex-1" id="stdToCart">' + K.t("In winkelmand zetten") + '</button><button type="button" class="btn btn-o btn-sm" id="stdSave">' + K.t("Vervang door winkelmand") + '</button></div>' : '<div class="d-flex gap-8 mt-10"><button type="button" class="btn btn-p btn-sm flex-1" id="stdSave">' + K.t("Huidige winkelmand opslaan als standaard") + '</button></div>') + '</div>';
    const body = '<div class="kcols"><div class="kc-main"><h2 class="sec mt-0">' + K.t("Uw vaste producten") + '</h2>' + (favList.length ? '<div class="mcard">' + favList.map(p => '<div class="li"><div class="n"><b>' + K.esc(toon(p)) + '</b><div class="quiet fs-12 d-flex gap-6 ai-c f-wrap"><span>' + K.esc((p.kaliber ? p.kaliber + " · " : "") + unitLabel(p)) + ' · ' + K.eur(p.prix) + '</span>' + stockTag(p) + '</div>' + pakCaption(p, cart.items[p.id]) + '</div>' + stepperOf(p, cart.items[p.id]) + '<button type="button" class="ibtn fav' + (favs[p.id] ? " on" : "") + '" data-fav="' + p.id + '" aria-pressed="' + !!favs[p.id] + '" aria-label="' + K.esc(K.t("Ster") + ": " + toon(p)) + '">' + K.icon("star") + '</button></div>').join("") + '</div>' : K.c.empty(K.t("Nog geen vaste producten"), K.t("Wat u vaak bestelt, komt hier vanzelf. U kunt ook een ster zetten bij een product in Bestellen."))) + '</div><div class="kc-side">' + stdCard + '</div></div>';
    shell("account", '<div class="mlist">' + body + '</div>', topbar(K.t("Uw vaste producten"), K.t("Snel opnieuw bestellen")));
    bindSteppers(app);
    K.on(app, "click", "[data-fav]", (e, t) => { setFav(t.dataset.fav, !favs[t.dataset.fav]); K.keep(app, renderFavorieten); });
    const s = document.getElementById("stdSave"); if (s) s.onclick = () => { const items = Object.fromEntries(Object.entries(cart.items).filter(([id, qv]) => byId(id) && Number(qv) > 0)); if (!Object.keys(items).length) { K.toast(K.t("Zet eerst artikelen in de winkelmand."), { kind: "err" }); return; } setStd(items); K.toast(K.t("Standaardbestelling opgeslagen")); renderFavorieten(); };
    const c2 = document.getElementById("stdToCart"); if (c2) c2.onclick = () => { Object.entries(std).forEach(([id, qv]) => { const p = byId(id); if (p) { const v = capQty(p, fitQty(p, Number(qv))); if (v > 0) cart.items[id] = v; } }); saveCart(); K.go("winkelmand"); };
  }

  /* ---------- account ---------- */
  // Le mot de passe actuel est vérifié par le serveur, jamais ici : le navigateur ne fait
  // que les contrôles de confort (champs remplis, longueur, confirmation identique).
  function openPasswordPanel() {
    const p = K.panel({ title: K.t("Wachtwoord wijzigen"), sub: K.t("Ter bevestiging vragen we uw huidige wachtwoord."), body:
      '<form id="pwForm" novalidate class="stack-14">' +
      '<input type="text" name="username" autocomplete="username" value="' + K.esc(sess.user) + '" hidden>' +
      K.c.field(K.t("Huidig wachtwoord"), K.c.input("pwCur", { type: "password", attrs: ' autocomplete="current-password" required' }), { id: "fPwCur", for: "pwCur" }) +
      K.c.field(K.t("Nieuw wachtwoord"), K.c.input("pwNew", { type: "password", attrs: ' autocomplete="new-password" required' }), { id: "fPwNew", for: "pwNew", hint: K.t("Minstens 8 tekens.") }) +
      K.c.field(K.t("Herhaal nieuw wachtwoord"), K.c.input("pwRep", { type: "password", attrs: ' autocomplete="new-password" required' }), { id: "fPwRep", for: "pwRep" }) +
      '<div id="pwErr"></div></form>',
      footer: '<button type="button" class="btn btn-o" data-cancel>' + K.t("Annuleren") + '</button><button type="button" class="btn btn-p" id="pwOk">' + K.t("Wachtwoord wijzigen") + '</button>' });
    const val = id => p.el.querySelector("#" + id).value;
    let sending = false;
    async function submit() {
      if (sending) return;
      const huidig = val("pwCur"), nieuw = val("pwNew"), herhaal = val("pwRep");
      const errCur = huidig ? "" : K.t("Vul uw huidige wachtwoord in.");
      const errNew = !nieuw ? K.t("Kies een nieuw wachtwoord.") : nieuw.length < 8 ? K.t("Het nieuwe wachtwoord moet minstens 8 tekens hebben.") : nieuw.length > 80 ? K.t("Het nieuwe wachtwoord mag hoogstens 80 tekens hebben.") : nieuw === huidig ? K.t("Kies een nieuw wachtwoord dat verschilt van het huidige.") : "";
      const errRep = !errNew && herhaal !== nieuw ? K.t("De twee nieuwe wachtwoorden zijn niet gelijk.") : "";
      K.setErr("fPwCur", errCur); K.setErr("fPwNew", errNew); K.setErr("fPwRep", errRep);
      p.el.querySelector("#pwErr").innerHTML = "";
      if (errCur || errNew || errRep) return;
      const btn = p.el.querySelector("#pwOk"); sending = true; K.busy(btn, true, K.t("Wijzigen…"));
      try {
        // Rechtstreeks K.api : een 401 betekent hier « huidig wachtwoord fout », niet « sessie verlopen ».
        // L'ancien cookie de session ne vaut plus (il dépend du mot de passe) : le serveur en pose un nouveau.
        await K.api("/api/klantwachtwoord", { json: { user: sess.user, pw: huidig, nieuw } });
        p.close();
        K.toast(K.t("Wachtwoord gewijzigd. Gebruik voortaan uw nieuwe wachtwoord."));
      } catch (err) {
        if (err.status === 401) { K.setErr("fPwCur", K.t("Uw huidige wachtwoord klopt niet.")); p.el.querySelector("#pwCur").focus(); }
        else p.el.querySelector("#pwErr").innerHTML = K.c.error(err.message);
        sending = false; K.busy(btn, false);
      }
    }
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#pwOk").onclick = submit;
    const form = p.el.querySelector("#pwForm");
    form.addEventListener("submit", e => { e.preventDefault(); submit(); });
    form.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); submit(); } });
  }
  // E-mail en telefoon wijzigt de klant zelf (klantorder « profile ») ; adres, klantnummer en btw blijven bij Famo.
  function openProfilePanel() {
    const cl = cat.client || {};
    const p = K.panel({ title: K.t("Contactgegevens"), sub: K.t("Bevestigingen en facturen gaan naar dit adres."), body:
      '<form id="prForm" novalidate class="stack-14">' +
      K.c.field(K.t("E-mail"), K.c.input("prEmail", { type: "email", value: cl.email || "", attrs: ' autocomplete="email" inputmode="email" maxlength="120"' }), { id: "fPrEmail", for: "prEmail", hint: K.t("E-mail voor bevestigingen en facturen") }) +
      K.c.field(K.t("Telefoon"), K.c.input("prTel", { type: "tel", value: cl.tel || "", attrs: ' autocomplete="tel" maxlength="40"' }), { id: "fPrTel", for: "prTel" }) +
      '<div id="prErr"></div></form>',
      footer: '<button type="button" class="btn btn-o" data-cancel>' + K.t("Annuleren") + '</button><button type="button" class="btn btn-p" id="prOk">' + K.t("Opslaan") + '</button>' });
    let sending = false;
    async function submit() {
      if (sending) return;
      const email = p.el.querySelector("#prEmail").value.trim().toLowerCase(), tel = p.el.querySelector("#prTel").value.trim();
      const errMail = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? K.t("Geef een geldig e-mailadres.") : "";
      K.setErr("fPrEmail", errMail); p.el.querySelector("#prErr").innerHTML = "";
      if (errMail) return;
      const btn = p.el.querySelector("#prOk"); sending = true; K.busy(btn, true, K.t("Opslaan…"));
      try {
        const d = await api("/api/klantorder", { json: Object.assign({}, creds(), { action: "profile", email, tel }) });
        cat.client = Object.assign({}, cat.client, { email: d.email != null ? d.email : email, tel: d.tel != null ? d.tel : tel }); K.session.set(CAT_KEY, cat); K.klant.set(Object.assign({}, K.klant.get() || sess, { client: cat.client }));
        p.close(); K.toast(K.t("Gegevens opgeslagen")); renderAccount();
      } catch (err) { p.el.querySelector("#prErr").innerHTML = K.c.error(err.message); sending = false; K.busy(btn, false); }
    }
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#prOk").onclick = submit;
    p.el.querySelector("#prForm").addEventListener("submit", e => { e.preventDefault(); submit(); });
  }
  function renderAccount() {
    const cl = cat.client || {}, co = cat.company || {};
    // Spec 038 : « Een vraag? » bovenaan (WhatsApp als er een nummer is, telefoon, e-mail) ; geen tellerinstelling meer (ontwikkelaarsinstelling).
    const body = '<div class="full">' + contactCard() + '</div><div class="mcard"><div class="row"><div>' + K.t("Zaak") + '<small>' + K.esc(cl.nom || "") + '</small></div></div><div class="row"><div>' + K.t("Leveradres") + '<small class="ws-pre">' + K.esc(cl.adresse || "—") + '</small></div></div>' + (cl.klantnr ? '<div class="row"><div>' + K.t("Klantnummer") + '<small class="mono">' + K.esc(cl.klantnr) + '</small></div></div>' : "") + (cl.btw ? '<div class="row"><div>' + K.t("Btw-nummer") + '<small class="mono">' + K.esc(cl.btw) + '</small></div></div>' : "") + '<div class="row"><div>' + K.t("Gebruikersnaam") + '<small>' + K.esc(sess.user) + '</small></div></div><div class="row"><div>' + K.t("Taal") + '<small>' + K.t("Nederlands of Frans, voor dit toestel") + '</small></div>' + K.langSwitch() + '</div></div>' +
      '<div class="mcard"><div class="row"><div>' + K.t("E-mail") + '<small>' + K.esc(cl.email || "—") + '</small></div><button type="button" class="btn btn-o btn-sm" data-profile>' + K.t("Wijzigen") + '</button></div><div class="row"><div>' + K.t("Telefoon") + '<small>' + K.esc(cl.tel || "—") + '</small></div><button type="button" class="btn btn-o btn-sm" data-profile>' + K.t("Wijzigen") + '</button></div></div>' +
      '<div class="mcard"><div class="row"><div>' + K.t("Documenten") + '<small>' + K.t("Leveringsbonnen en facturen per bestelling") + '</small></div><a href="#/facturen" class="btn btn-o btn-sm">' + K.t("Openen") + '</a></div><div class="row"><div>' + K.t("Uw vaste producten en standaardbestelling") + '<small>' + K.t("Snel opnieuw bestellen") + '</small></div><a href="#/favorieten" class="btn btn-o btn-sm">' + K.t("Openen") + '</a></div></div><div class="mcard"><div class="row"><div>' + K.t("Gegevens wijzigen") + '<small>' + K.t("Leveradres wijzigen: bel of mail Famo") + '</small></div></div><div class="row"><div>' + K.t("Wachtwoord") + '<small>' + K.t("Wijzig uw wachtwoord zelf, met uw huidige wachtwoord") + '</small></div><button type="button" class="btn btn-o btn-sm" id="pwChange">' + K.t("Wijzigen") + '</button></div></div>' +
      '<button type="button" class="btn btn-o btn-block full t-danger" id="logout">' + K.t("Uitloggen") + '</button>' +
      '<p class="quiet fs-12 full m-0">' + K.esc([co.bedrijfsnaam || "FAMO Seafood", co.adres, co.plaats].filter(Boolean).join(" · ")) + '</p>';
    shell("account", '<div class="mlist grid">' + body + '</div>', topbar(K.t("Account"), cl.nom || ""));
    K.on(app, "click", "[data-profile]", openProfilePanel);
    fillContact();
    document.getElementById("pwChange").onclick = openPasswordPanel;
    document.getElementById("logout").onclick = async () => { if (await K.confirm({ title: K.t("Uitloggen?"), text: K.t("Uw winkelmand blijft bewaard op dit toestel."), yes: K.t("Uitloggen") })) { try { await K.api("/api/klantwachtwoord", { json: { action: "logout", token: (K.klant.creds() || {}).token } }); } catch (e) { /* hors ligne : les données locales sont quand même effacées */ } K.klant.clear(); K.session.del(CAT_KEY); location.href = "/?uit=1#aanmelden"; } };
  }

  /* ---------- router ---------- */
  function route() {
    if (cat) return render();
    // Eerste lading : skelet, en bij een fout « Opnieuw proberen » (K.retryBox) dat de lading én de weergave herhaalt.
    app.innerHTML = '<div class="kwrap p-20" id="boot"></div>';
    // Le catalogue et les commandes (carte « Zoals elke … », uw vaste) en parallèle : la carte est là dès le premier dessin.
    return K.retryBox("boot", async () => { document.getElementById("boot").innerHTML = K.c.skeleton(3); await Promise.all([loadCatalogue(), loadOrders().catch(() => null)]); render(); });
  }
  // INT-07 / G-14 : chaque vue retrouve sa position de défilement. Le catalogue retient le produit en haut de l'écran
  // (les lignes n'ont pas toutes la même hauteur) ; le navigateur ne restaure plus lui-même (Précédent → 0).
  try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) { /* ignore */ }
  const scrollPos = {}; let curPath = null;
  const saveScroll = path => {
    const pos = { y: window.scrollY, id: "", top: 0 };
    if (path === "catalogus" && pos.y > 0) { const row = K.$$(".prod:not(.hidden)", app).find(r => r.getBoundingClientRect().bottom > 160); if (row) { pos.id = row.dataset.id; pos.top = row.getBoundingClientRect().top; } }
    scrollPos[path] = pos;
  };
  const restoreScroll = path => {
    const pos = scrollPos[path]; let moved = false;
    const stop = () => { moved = true; };
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(ev => window.addEventListener(ev, stop, { once: true, passive: true }));
    const go = () => { if (moved) return; if (!pos || !pos.y) { window.scrollTo(0, 0); return; } const row = pos.id && app.querySelector('.prod[data-id="' + CSS.escape(pos.id) + '"]'); if (row) { const d = row.getBoundingClientRect().top - pos.top; if (Math.abs(d) > 1) window.scrollBy(0, d); } else window.scrollTo(0, pos.y); };
    // Plusieurs passes : les lignes hors écran ont une hauteur estimée (content-visibility) qui devient réelle en approchant.
    requestAnimationFrame(() => { go(); [120, 320, 700].forEach(ms => setTimeout(go, ms)); });
    setTimeout(() => ["wheel", "touchstart", "keydown", "mousedown"].forEach(ev => window.removeEventListener(ev, stop)), 800);
  };
  function render() {
    setTimeout(() => { K.setBadges({}); refreshOrderBadge(); }, 0);
    const { path } = K.hashParams();
    closePanel();
    if (curPath !== null) saveScroll(curPath);
    curPath = path || "catalogus";
    if (!["catalogus", "winkelmand", "bevestigd", "bestellingen", "facturen", "favorieten", "account"].includes(path)) { location.hash = "#/catalogus"; return; }
    ({ winkelmand: renderWinkelmand, bevestigd: renderBevestigd, bestellingen: renderBestellingen, facturen: renderBestellingen, favorieten: renderFavorieten, account: renderAccount, catalogus: renderCatalogus })[path]();
    restoreScroll(curPath);
    // G-03 : nouvelle vue → focus sur son titre (annoncé par le lecteur d'écran, Tab repart de là).
    K.focusTitle(app);
  }
  window.addEventListener("hashchange", route);
  K.shortcuts.splice(0, 1, ["/", "Zoek een product…"]);
  document.addEventListener("keydown", e => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    const qi = document.getElementById("q"); if (qi) { e.preventDefault(); qi.focus(); qi.select(); }
  });
  route();
})();
