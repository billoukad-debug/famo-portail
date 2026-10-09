(function () {
  const sess = K.klant.get();
  if (!sess || !sess.user) { location.replace("/"); return; }
  const app = document.getElementById("app");
  const FAV_KEY = "famoFav:" + sess.user, CART_KEY = "famoCart:" + sess.user, STD_KEY = "famoStd:" + sess.user, CAT_KEY = "famoKlantCatalogus";
  let cat = null; // {products, client, company}
  let cart = K.store.get(CART_KEY, { items: {}, comments: {}, note: "", day: "" });
  let favs = K.store.get(FAV_KEY, {});
  let std = K.store.get(STD_KEY, null); // {productId: qty}
  let orders = null, lastOrder = K.session.get("famoLastOrder", null), panel = null;
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
  const stepperOf = (p, q) => { const n = stepUnits(p), k = pakP(p), v = Number(q || 0); return n > 1 ? K.c.stepper(p.id, v / n, { step: 1, name: p.nom, suffix: K.pakLabel(k.label, v / n), label: K.t("Aantal") + " (" + K.pakOne(k, p.unite) + ")" }) : K.c.stepper(p.id, v, { step: isKg(p) ? 0.5 : 1, name: p.nom }); };
  const pakCaption = (p, q) => (pakP(p) && Number(q) > 0 ? '<div class="pak-q" data-pakq="' + p.id + '">' + K.esc(K.pakQty(q, p.unite, pakP(p))) + '</div>' : "");
  const creds = () => K.klant.creds();
  // 401 op eender welke klant-API : opgeslagen gegevens wissen en terug naar de aanmelding (met melding).
  function expire() { K.klant.clear(); K.session.del(CAT_KEY); location.replace("/?sessie=verlopen"); }
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
    app.innerHTML = '<a class="skip" href="#kmain">' + K.t("Naar de inhoud") + '</a><div class="kwrap kv-' + (K.hashParams().path || active) + '"><header class="khead"><a class="kbrand" href="#/catalogus"><span class="logo" aria-hidden="true"></span><b>' + K.esc(co.bedrijfsnaam || "FAMO Seafood") + '</b></a>' + K.klantTabs(active) + '<a class="kcartlink" id="kcartlink" href="#/winkelmand">' + cartLinkHtml() + '</a></header><main class="kmain" id="kmain" tabindex="-1">' + (top || "") + inner + '</main></div>';
    if (onTitle) K.focusTitle(app); // vue redessinée (données arrivées) : le focus reste sur son titre
  }
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
    K.setBadges({ bestellingen: orders.filter(o => o.statut === "Facturée" && o.paiement !== "Payé").map(o => o.id || o.ref) });
    K.session.set("famoKlantOrdersAt", Date.now());
    return orders;
  }
  // Pastille « Bestellingen » (factures à payer) : les commandes sont relues au plus toutes les 15 min en arrière-plan.
  function refreshOrderBadge() {
    const at = K.session.get("famoKlantOrdersAt", 0);
    if (orders || Date.now() - at < 15 * 60 * 1000) return;
    loadOrders(true).catch(() => {});
  }

  /* ---------- catalogus ---------- */
  // Spec 019 : drie weergaven van dezelfde regel (Lijst, Tegels, Compact) en een sortering, onthouden per toestel
  // (K.pref : opslag geblokkeerd → Lijst / Standaard). Zoeken, categorie en familie filteren door te verbergen :
  // geen nieuwe tekening per toets, per + / − enkel de eigen regel en de winkelmand.
  const VIEW = K.pref("famoKlantWeergave", K.CATALOG_VIEWS, "lijst"), SORT = K.pref("famoKlantSortering", K.CATALOG_SORTS, "standaard");
  const VIEWS = [["lijst", "Lijst", "vlist"], ["tegels", "Tegels", "tiles"], ["compact", "Compact", "rows"]];
  const SORT_LABELS = { standaard: "Standaard", naam: "Naam A–Z", "prijs-op": "Prijs ↑", "prijs-af": "Prijs ↓" };
  const REST = "__overige"; // familie « Overige » : de producten zonder familie
  let q = "", catFilter = "Alles", famFilter = "", view = VIEW.get(), sortMode = SORT.get(), CS = null;
  // Lijst en Compact : details openklappen op hun plaats (spec 018 : alle zichten, info, opmerking) ; Tegels : paneel.
  const opened = new Set();
  // Zichten van een product : fotos (spec 018), of enkel foto (oude cache in sessionStorage).
  const photosOf = p => (Array.isArray(p.fotos) && p.fotos.length ? p.fotos : p.foto ? [p.foto] : []);
  // Prijs : onderhandelde prijs groot, publieke prijs klein en doorstreept, « uw prijs » (DESIGN : het prijzenpaar).
  const priceHtml = p => '<div class="pp"><span class="pp-m"><b class="mono">' + K.eur(p.prix) + '</b> <span class="quiet">/ ' + K.esc(unitLabel(p)) + '</span></span>' + (p.prix < p.base ? '<span class="pp-u"><s class="mono">' + K.eur(p.base) + '</s> <small>' + K.t("uw prijs") + '</small></span>' : "") + pakPrice(p) + '</div>';
  // « doos van 6 = € 6,00 » : prix du conditionnement, calculé du prix unitaire (le serveur facture en unités).
  const pakPrice = p => { const k = pakP(p); return k ? '<span class="pp-k">' + K.esc(K.pakOne(k, p.unite)) + ' = <b class="mono">' + K.eur(window.FamoVat.r2(p.prix * k.per)) + '</b></span>' : ""; };
  function productRow(p) {
    const qty = Number(cart.items[p.id] || 0), tiles = view === "tegels", compact = view === "compact", open = !tiles && opened.has(p.id);
    // Metaregel : kaliber (niet herhaald als het al in de naam staat : « … 16-20 » en kaliber « 16/20 ») en voorraad ;
    // de eenheid staat bij de prijs (« / kassa »), behalve in Compact (eenheid in de metakolom). Compact op een
    // smalle lijst : ook de prijs in de metaregel (de prijskolom verschijnt pas op een brede lijst).
    const kal = p.kaliber && K.searchKey(p.nom).indexOf(K.searchKey(p.kaliber)) < 0 ? p.kaliber : "";
    const meta = [kal, compact ? unitLabel(p) : "", compact && pakP(p) ? K.pakOne(pakP(p), p.unite) : ""].filter(Boolean).map(K.esc).join(" · ") + stockTag(p) +
      (compact ? '<span class="pm-p"><b class="mono">' + K.eur(p.prix) + '</b>' + (p.prix < p.base ? ' <small>' + K.t("uw prijs") + '</small>' : "") + '</span>' : "");
    // Vignet in de knop : een tik erop opent de details. alt leeg : de naam staat ernaast in dezelfde knop.
    const btn = '<button type="button" class="pr-x" data-x="' + p.id + '"' + (tiles ? ' aria-haspopup="dialog"' : ' aria-expanded="' + open + '" aria-controls="pd-' + p.id + '"') + '>' +
      (tiles ? "" : K.icon("chev", "pr-chev")) + (compact ? "" : K.thumb(photosOf(p)[0], "", "pr-th")) +
      // Kaliber en gewicht in de naam (« 13-15 », « 1KG ») niet afbreken.
      '<span class="pr-t"><span class="pn">' + K.esc(p.nom).replace(/\S*\d\S*/g, m => '<span class="nw">' + m + '</span>') + '</span><span class="pm">' + meta + '</span></span></button>';
    return '<div class="prod' + (qty > 0 ? " on" : "") + (open ? " open" : "") + '" data-id="' + p.id + '">' + btn + priceHtml(p) +
      '<button type="button" class="ibtn fav' + (favs[p.id] ? " on" : "") + '" data-fav="' + p.id + '" aria-label="' + K.t("Favoriet") + ': ' + K.esc(p.nom) + '" aria-pressed="' + (favs[p.id] ? "true" : "false") + '">' + K.icon("star") + '</button>' +
      stepperOf(p, qty) +
      (tiles ? "" : '<div class="pr-d" id="pd-' + p.id + '"' + (open ? "" : " hidden") + '>' + (open ? detailHtml(p) : "") + '</div>') + '</div>';
  }
  // Galerij (spec 018) : grote foto ; bij meerdere zichten een strook om te vegen (scroll-snap) en vignetknoppen
  // « Foto 2 van 3 » (aria-current op het getoonde zicht) ; ← → wisselen. Zonder foto : niets (de regel toont het icoon).
  function galleryHtml(p) {
    const ph = photosOf(p), n = ph.length; if (!n) return "";
    const lbl = i => K.tt("Foto {i} van {n}", { i: i + 1, n });
    const slides = ph.map((u, i) => '<div class="gal-s"><img src="' + K.esc(u) + '" alt="' + K.esc(n > 1 ? p.nom + " · " + lbl(i) : p.nom) + '"' + (i ? ' loading="lazy"' : "") + ' decoding="async" data-gimg></div>').join("");
    if (n === 1) return '<div class="gal"><div class="gal-track">' + slides + '</div></div>';
    return '<div class="gal" data-gal><div class="gal-track" tabindex="0" role="group" aria-label="' + K.esc(K.tt("Foto's van {p}", { p: p.nom })) + '" aria-keyshortcuts="ArrowLeft ArrowRight">' + slides + '</div>' +
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
  function detailHtml(p) {
    const s = stock(p), neg = p.prix < p.base;
    const row = (k, v) => v ? '<div><dt>' + K.esc(k) + '</dt><dd>' + v + '</dd></div>' : "";
    return galleryHtml(p) +
      '<div class="pr-info">' + (p.omschrijving ? '<p class="pr-desc">' + K.esc(p.omschrijving) + '</p>' : "") + '<dl>' +
      row(K.t("Categorie"), K.esc(K.t(K.cat(p.cat)))) + row(K.t("Gewicht"), K.esc(p.kaliber)) + row(K.t("Eenheid"), K.esc(unitLabel(p))) +
      row(K.t("Prijs excl. btw"), '<span class="mono">' + K.eur(p.prix) + '</span> / ' + K.esc(unitLabel(p)) + (neg ? ' <s class="mono quiet">' + K.eur(p.base) + '</s> · ' + K.t("uw prijs") : "")) +
      row(K.t("Beschikbaar"), s == null ? "" : s > 0 ? K.esc(K.qty(s)) + " " + K.esc(unitLabel(p)) : '<span class="t-danger">' + K.t("Uitverkocht") + '</span>') +
      (pakP(p) ? row(K.t("Verpakking"), K.esc(K.pakOne(pakP(p), p.unite)) + ' = <span class="mono">' + K.eur(window.FamoVat.r2(p.prix * pakP(p).per)) + '</span>') : "") +
      (pakP(p) && pakP(p).only ? row(K.t("Bestellen per"), K.esc(K.pakOne(pakP(p), p.unite))) : pakP(p) ? row(K.t("Bestellen per"), K.esc(K.t("per stuk of per verpakking"))) : isKg(p) ? row(K.t("Bestellen per"), K.t("0,5 kg")) : "") + '</dl>' +
      '<label class="pr-c"><span>' + K.t("Opmerking bij dit artikel") + '</span><input class="input" data-comment="' + p.id + '" value="' + K.esc(cart.comments[p.id] || "") + '" maxlength="120" placeholder="' + K.t("bv. dikke moot…") + '"></label></div>';
  }
  // Winkelmand naast de catalogus (computer) en balk onderaan (telefoon) : bijgewerkt zonder de lijst opnieuw te tekenen.
  function cartPanelHtml() {
    const ids = Object.keys(cart.items).filter(id => byId(id) && Number(cart.items[id]) > 0), total = cartTotal(), min = minimum();
    if (!ids.length) return '<div class="kc-h"><b>' + K.t("Winkelmand") + '</b></div><p class="quiet kc-empty">' + K.t("Nog niets gekozen. Gebruik + bij een product.") + '</p><p class="quiet kc-foot">' + K.esc(K.tt("Bestel vóór {t} voor levering op {d}.", { t: deadline(), d: K.dateLong(firstDay()) })) + '</p>';
    return '<div class="kc-h"><b>' + K.t("Winkelmand") + '</b><span class="quiet">' + ids.length + ' ' + K.t(ids.length === 1 ? "artikel" : "artikelen") + '</span></div>' +
      '<ul class="kc-l">' + ids.map(id => { const p = byId(id), qv = Number(cart.items[id]); return '<li><span class="kc-n">' + K.esc(p.nom) + '<small class="quiet mono">' + K.esc(qtyTxt(p, qv)) + ' × ' + K.eur(p.prix) + '</small></span><b class="mono">' + K.eur(p.prix * qv) + '</b><button type="button" class="ibtn" data-rm="' + id + '" aria-label="' + K.t("Verwijderen") + ': ' + K.esc(p.nom) + '">' + K.icon("x") + '</button></li>'; }).join("") + '</ul>' +
      '<div class="kc-t"><span>' + K.t("Totaal excl. btw") + '</span><b class="mono">' + K.eur(total) + '</b></div>' +
      (min > 0 && total < min ? '<p class="kc-min">' + K.esc(K.tt("Minimumbestelling {m} excl. btw · nog {r} toe te voegen.", { m: K.eur(min), r: K.eur(min - total) })) + '</p>' : "") +
      '<a class="btn btn-p btn-block" href="#/winkelmand">' + K.t("Bestellen") + '</a><p class="quiet kc-foot">' + K.esc(K.tt("Bestel vóór {t} voor levering op {d}.", { t: deadline(), d: K.dateLong(firstDay()) })) + '</p>';
  }
  function cartbarHtml() {
    const n = cartCount();
    return n ? '<div class="cartbar"><div><div class="fs-12">' + n + ' ' + K.t(n === 1 ? "artikel" : "artikelen") + ' · ' + K.t("excl. btw") + '</div><div class="mono fs-17 fw-600">' + K.eur(cartTotal()) + '</div></div><a class="btn btn-light" href="#/winkelmand">' + K.t("Bestellen") + '</a></div>' : "";
  }
  function refreshCart() {
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set("kcartlink", cartLinkHtml()); set("cartPanel", cartPanelHtml()); set("cartbarBox", cartbarHtml());
  }
  // Wat de catalogus toont : categorie, groepen (favorieten eerst bij « Alles »), sortering, families, zoekteksten.
  function catalogState() {
    // Catégorie affichée = traduction (K.cat) ; la valeur Airtable reste la clé de filtre.
    const all = (cat.products || []).slice().sort(K.byVolgorde);
    const byCat = K.catOrder(cat.products, p => K.cat(p.cat));
    const catNames = Array.from(new Set(all.map(p => K.cat(p.cat)))).sort(byCat);
    const products = all.filter(p => catFilter === "Alles" || (catFilter === "Favorieten" ? favs[p.id] : K.cat(p.cat) === catFilter));
    const groups = {}; products.forEach(p => { const g = catFilter === "Favorieten" ? "Favorieten" : (favs[p.id] && catFilter === "Alles" ? "Favorieten" : K.cat(p.cat)); (groups[g] = groups[g] || []).push(p); });
    const sorter = K.catalogSort(sortMode); Object.keys(groups).forEach(g => groups[g].sort(sorter));
    const order = Object.keys(groups).sort((a, b) => (a === "Favorieten" ? -1 : b === "Favorieten" ? 1 : byCat(a, b)));
    // Families binnen één categorie (niet « Alles » of « Favorieten »), op de volgorde van Beheer
    // (de knoppen verspringen niet bij een andere sortering).
    const fams = catFilter === "Alles" || catFilter === "Favorieten" ? null : K.families(products), famOf = new Map();
    if (fams) { fams.families.forEach(f => f.ids.forEach(id => famOf.set(id, f.key))); fams.rest.forEach(id => famOf.set(id, REST)); }
    if (famFilter && !famOf.size) famFilter = "";
    const hay = new Map(products.map(p => [p.id, K.searchKey([p.nom, p.kaliber, K.cat(p.cat), p.omschrijving].filter(Boolean).join(" "))]));
    const count = c => c === "Alles" ? all.length : c === "Favorieten" ? all.filter(p => favs[p.id]).length : all.filter(p => K.cat(p.cat) === c).length;
    return { all, cats: ["Alles", "Favorieten", ...catNames], count, products, groups, order, fams, famOf, hay };
  }
  const catBtn = c => '<button type="button" data-cat="' + K.esc(c) + '"' + (c === catFilter ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + K.esc(K.t(c)) + '<span class="kcount">' + CS.count(c) + '</span></button>';
  // Werkbalk (blijft bovenaan) : zoeken (× wist), naar boven, categorieën, aantal, sorteren, weergave.
  function toolsHtml() {
    return '<div class="ktools" id="ktools">' +
      '<div class="kt-s"><div class="search ksearch"><label class="ks-l">' + K.icon("search") + '<input id="q" type="search" placeholder="' + K.t("Zoek een product…") + '" aria-label="' + K.t("Zoek een product…") + '" aria-keyshortcuts="/" value="' + K.esc(q) + '" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>' +
      '<button type="button" class="ks-x" id="qClear" aria-label="' + K.t("Zoekterm wissen") + '"' + (q ? "" : " hidden") + '>' + K.icon("x") + '</button></div>' +
      '<button type="button" class="btn btn-o totop" id="toTop" aria-label="' + K.t("Naar boven") + '" title="' + K.t("Naar boven") + '" hidden>' + K.icon("up") + '</button></div>' +
      '<div class="cats kt-c" role="group" aria-label="' + K.t("Categorieën") + '">' + CS.cats.map(catBtn).join("") + '</div>' +
      '<div class="kt-o"><span class="kt-n" id="kCount" role="status" aria-live="polite"></span>' +
      '<label class="ksort"><span class="ksort-l">' + K.t("Sorteren") + '</span><select class="input" id="kSort">' + K.CATALOG_SORTS.map(s => '<option value="' + s + '"' + (s === sortMode ? " selected" : "") + '>' + K.esc(K.t(SORT_LABELS[s])) + '</option>').join("") + '</select></label>' +
      '<div class="seg" role="group" aria-label="' + K.t("Weergave") + '">' + VIEWS.map(([k, l, i]) => '<button type="button" data-weergave="' + k + '"' + (k === view ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ' title="' + K.esc(K.t(l)) + '">' + K.icon(i) + '<span class="seg-t">' + K.esc(K.t(l)) + '</span></button>').join("") + '</div></div></div>';
  }
  // Families (spec 019) : enkel als de lijst er baat bij heeft (K.families : > 12 producten, 3–12 families).
  function famsHtml() {
    const f = CS.fams; if (!f) return "";
    const b = (key, label, n) => '<button type="button" data-fam="' + K.esc(key) + '"' + (key === famFilter ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + K.esc(label) + '<span class="kcount">' + n + '</span></button>';
    return '<div class="fams" id="kFams" role="group" aria-label="' + K.t("Soort") + '">' + b("", K.t("Alle"), CS.products.length) + f.families.map(x => b(x.key, x.label, x.ids.length)).join("") + (f.rest.length ? b(REST, K.t("Overige"), f.rest.length) : "") + '</div>';
  }
  function listHtml() {
    if (!CS.products.length) return K.c.empty(K.t("Nog geen favorieten"), K.t("Tik op de ster bij een product om het hier te zien."));
    return CS.order.map(g => '<h2 class="sec">' + K.esc(K.t(g)) + ' <span class="quiet" data-gn>' + CS.groups[g].length + '</span></h2>' + CS.groups[g].map(productRow).join("")).join("") + '<div id="noHit" role="status"></div>';
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
  // Andere weergave of sortering : enkel de lijst opnieuw ; het product bovenaan het scherm blijft op zijn plaats.
  function redrawList() {
    const box = document.getElementById("list"); if (!box) return;
    const tools = document.getElementById("ktools"), edge = tools && tools.offsetHeight ? tools.getBoundingClientRect().bottom : 0;
    const anchor = window.scrollY > 0 ? K.$$(".prod:not(.hidden)", box).find(r => r.getBoundingClientRect().bottom > edge + 8) : null;
    const id = anchor && anchor.dataset.id, top = anchor ? anchor.getBoundingClientRect().top : 0;
    box.setAttribute("data-view", view); box.innerHTML = listHtml();
    fallback(box); bindSteppers(box, rid => { syncRow(rid); refreshCart(); }); applyFilter();
    if (id) { const r = box.querySelector('.prod[data-id="' + CSS.escape(id) + '"]'); if (r) window.scrollBy(0, r.getBoundingClientRect().top - top); }
  }
  // Tegels : de details in een paneel (galerij, info, opmerking, aantal) ; Esc of × geeft de focus terug aan de tegel.
  function openDetail(p) {
    closePanel();
    panel = K.panel({ title: p.nom, sub: [p.kaliber, unitLabel(p)].filter(Boolean).join(" · "), body: '<div class="pr-d pr-dp" data-no-dirty>' + detailHtml(p) + '</div>', footer: '<div class="pd-f">' + priceHtml(p) + stepperOf(p, cart.items[p.id]) + '</div>', onClose: () => { panel = null; } });
    fallback(panel.el); bindSteppers(panel.el, id => { syncRow(id); refreshCart(); });
    panel.el.addEventListener("input", e => { const t = e.target; if (t && t.matches && t.matches("[data-comment]")) { cart.comments[t.dataset.comment] = t.value.slice(0, 120); saveCart(); } });
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
    Object.keys(cart.items).forEach(id => { const p = byId(id), q = Number(cart.items[id]); if (!p || !(q > 0) || stepUnits(p) === 1 || window.FamoVat.pakFits(q, pakP(p))) return; const v = fitQty(p, q); cart.items[id] = v; msgs.push(K.tt("{p}: aangepast naar {q}, want enkel per {v}.", { p: p.nom, q: K.pakQty(v, p.unite, pakP(p)), v: K.pakOne(pakP(p), p.unite) })); });
    if (msgs.length) saveCart();
    return msgs;
  }
  function renderCatalogus() {
    fitCart().forEach(m => K.toast(m));
    CS = catalogState();
    const top = '<div class="mtop"><div class="mrow"><span class="logo" aria-hidden="true"></span><div class="grow"><h1 class="ktitle">' + K.t("Catalogus") + '</h1><span class="quiet ksub">' + K.esc(K.t("Prijzen excl. btw") + " · " + K.tt("Bestel vóór {t} voor levering op {d}.", { t: deadline(), d: K.dateLong(firstDay()) })) + '</span></div>' + K.c.avatar(cat.client.nom) + '</div></div>';
    shell("catalogus", '<div class="kgrid"><nav class="kside" aria-label="' + K.t("Categorieën") + '">' + CS.cats.map(catBtn).join("") + '</nav><div class="kcat">' + toolsHtml() + famsHtml() + '<div class="kl" id="list" data-view="' + view + '">' + listHtml() + '</div></div><aside class="kcart" id="cartPanel" aria-label="' + K.t("Winkelmand") + '">' + cartPanelHtml() + '</aside></div><div id="cartbarBox">' + cartbarHtml() + '</div>', top);
    applyFilter();
    const qi = document.getElementById("q");
    qi.addEventListener("input", K.debounce(() => { q = qi.value; applyFilter(); }, 120));
    qi.addEventListener("input", () => { const x = document.getElementById("qClear"); if (x) x.hidden = !qi.value; });
    document.getElementById("qClear").onclick = () => { qi.value = ""; q = ""; qi.focus(); applyFilter(); };
    document.getElementById("toTop").onclick = toTop;
    document.getElementById("kSort").onchange = e => { sortMode = e.target.value; SORT.set(sortMode); CS = catalogState(); redrawList(); };
    K.on(app, "click", "[data-cat]", (e, t) => { catFilter = t.dataset.cat; famFilter = ""; renderCatalogus(); const b = K.$$('[data-cat="' + CSS.escape(catFilter) + '"]', app).find(x => x.offsetParent); if (b) b.focus(); });
    K.on(app, "click", "[data-fam]", (e, t) => { famFilter = t.dataset.fam; K.$$("[data-fam]", app).forEach(b => K.setOn(b, b === t)); applyFilter(); });
    K.on(app, "click", "[data-weergave]", (e, t) => { if (t.dataset.weergave === view) return; view = t.dataset.weergave; VIEW.set(view); K.$$("[data-weergave]", app).forEach(b => K.setOn(b, b === t)); redrawList(); });
    K.on(app, "click", "[data-fav]", (e, t) => { const id = t.dataset.fav; setFav(id, !favs[id]); K.setOn(t, !!favs[id]); });
    K.on(app, "click", "[data-x]", (e, t) => {
      const id = t.dataset.x, p = byId(id);
      if (view === "tegels") { if (p) openDetail(p); return; }
      const row = t.closest(".prod"), box = row.querySelector(".pr-d"), open = !opened.has(id);
      if (open) { opened.add(id); box.innerHTML = detailHtml(p); fallback(box); } else opened.delete(id);
      box.hidden = !open; row.classList.toggle("open", open); t.setAttribute("aria-expanded", String(open));
    });
    K.on(app, "input", "[data-comment]", (e, t) => { cart.comments[t.dataset.comment] = t.value.slice(0, 120); saveCart(); });
    K.on(app, "click", "[data-rm]", (e, t) => {
      const id = t.dataset.rm, p = byId(id), prev = cart.items[id], prevC = cart.comments[id];
      delete cart.items[id]; delete cart.comments[id]; saveCart(); syncRow(id); refreshCart();
      K.toast(K.tt("{p} verwijderd", { p: p ? p.nom : "" }), { action: K.t("Ongedaan maken"), onAction: () => { cart.items[id] = prev; if (prevC) cart.comments[id] = prevC; saveCart(); syncRow(id); refreshCart(); } });
      const next = document.querySelector("#cartPanel [data-rm], #cartPanel a.btn"); if (next) next.focus();
    });
    fallback(app);
    bindSteppers(app, id => { syncRow(id); refreshCart(); });
    watchTools(); syncToTop();
  }
  // Foto's van Airtable verlopen na een tijd : een kapotte afbeelding verdwijnt (de details blijven).
  function fallback(root) { K.$$("img[data-fallback]", root).forEach(img => { img.onerror = () => { img.parentNode.remove(); }; }); bindGallery(root); }
  function syncRow(id) {
    const row = app.querySelector('.prod[data-id="' + CSS.escape(id) + '"]'); if (!row) return;
    const v = Number(cart.items[id] || 0), st = row.querySelector(".stepper");
    row.classList.toggle("on", v > 0); if (st) { st.classList.toggle("on", v > 0); st.querySelector("input").value = K.num(v / stepUnits(byId(id) || {})); pakSuffix(st, byId(id), v); }
  }
  // Libellé dans le stepper (« doos » / FR « carton(s) ») et légende « 2 doos · 12 stuks » à côté, s'il y en a une.
  function pakSuffix(st, p, v) {
    if (!p || !pakP(p)) return;
    const u = st.querySelector(".st-u"); if (u) u.textContent = K.pakLabel(pakP(p).label, v / stepUnits(p));
    K.$$('[data-pakq="' + CSS.escape(p.id) + '"]', app).forEach(c => { c.textContent = v > 0 ? K.pakQty(v, p.unite, pakP(p)) : ""; });
  }
  function bindSteppers(root, after) {
    K.$$(".stepper", root).forEach(st => {
      const id = st.dataset.stepper, inp = st.querySelector("input"), p = byId(id); if (!p) return;
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

  /* ---------- winkelmand ---------- */
  function renderWinkelmand() {
    const fitted = fitCart();
    const ids = Object.keys(cart.items).filter(id => byId(id) && Number(cart.items[id]) > 0);
    const days = nextDays(); if (!dayOk(cart.day)) { cart.day = days[0] || ""; saveCart(); }
    const otherDay = !days.includes(cart.day);
    const total = cartTotal(), min = minimum(), below = ids.length > 0 && min > 0 && total < min;
    const body = ids.length ? '<div class="kcols"><div class="kc-main"><div class="mcard">' + ids.map(id => { const p = byId(id); return '<div class="li"><div class="n"><b>' + K.esc(p.nom) + '</b><div class="quiet fs-12 d-flex gap-6 ai-c f-wrap"><span>' + K.esc((p.kaliber ? p.kaliber + " · " : "") + unitLabel(p)) + ' · ' + K.eur(p.prix) + (pakP(p) ? " · " + K.esc(K.pakOne(pakP(p), p.unite)) : "") + '</span>' + stockTag(p) + '</div>' + pakCaption(p, cart.items[id]) + '</div>' + stepperOf(p, cart.items[id]) + '<b class="mono t">' + K.eur(p.prix * cart.items[id]) + '</b><input class="input c mh-44 fs-12" placeholder="' + K.t("Opmerking (bv. dikke moot)") + '" aria-label="' + K.esc(K.t("Opmerking bij") + " " + p.nom) + '" data-comment="' + p.id + '" value="' + K.esc(cart.comments[id] || "") + '" maxlength="120"></div>'; }).join("") + '</div></div><div class="kc-side">' +
      '<div class="mcard stack-10"><div class="field"><label id="lDay">' + K.t("Leverdag") + '</label><div class="opt" role="group" aria-labelledby="lDay">' + days.map(d => '<button type="button" data-day="' + d + '"' + (d === cart.day ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + K.esc(K.date(d)) + '</button>').join("") + '</div>' +
      '<div class="d-flex ai-c gap-10 mt-8 f-wrap"><label for="otherDay" class="fs-13 m-0">' + K.t("Andere dag") + '</label><input type="date" class="input flex-1 minw-160" id="otherDay"' + (otherDay ? ' style="border-color:var(--p);color:var(--p)"' : "") + ' min="' + firstDay() + '" max="' + lastDay() + '" value="' + (otherDay ? cart.day : "") + '"></div><div id="dayErr" role="alert"></div><span class="quiet fs-12">' + K.esc(K.tt("Levering op {d}. Vóór {t} besteld = geleverd op de eerstvolgende leverdag.", { d: daysLabel(), t: deadline() })) + '</span></div>' +
      '<div class="field" role="group" aria-labelledby="lAdr"><span class="flabel" id="lAdr">' + K.t("Leveradres") + '</span><div class="input d-flex ai-c ws-pre mh-44 p-8-12 fs-13">' + K.esc(cat.client.adresse || K.t("Adres bij Famo bekend")) + '</div><span class="quiet fs-12">' + K.t("Ander adres? Zet het in de opmerking.") + '</span></div>' +
      '<div class="field"><label for="note">' + K.t("Opmerking voor Famo") + '</label><textarea class="input" id="note" rows="2" placeholder="' + K.t("bv. graag achteraan bellen…") + '">' + K.esc(cart.note || "") + '</textarea></div></div>' +
      '<div class="mcard stack-6 fs-13"><div class="spread"><span>' + K.t("Totaal excl. btw") + '</span><b class="mono">' + K.eur(total) + '</b></div><div class="quiet fs-12">' + K.esc(K.tt("De btw wordt op de factuur toegevoegd. Levering gratis · bestel vóór {t} voor levering op {d}.", { t: deadline(), d: K.dateLong(firstDay()) })) + (min > 0 ? ' · ' + K.esc(K.tt("Minimumbestelling {m} excl. btw", { m: K.eur(min) })) : "") + '</div></div>' +
      (below ? K.c.warn(K.esc(K.tt("Minimumbestelling {m} excl. btw · nog {r} toe te voegen.", { m: K.eur(min), r: K.eur(min - total) }))) : "") +
      (fitted.length ? K.c.warn(fitted.map(K.esc).join("<br>")) : "") +
      '<div id="orderErr"></div>' +
      '<button type="button" class="btn btn-p btn-block btn-tall" id="placeOrder"' + (below ? " disabled" : "") + '>' + K.t("Bestelling plaatsen") + ' · ' + K.eur(total) + '</button></div></div>'
      : K.c.empty(K.t("Uw winkelmand is leeg"), K.t("Kies producten in de catalogus."), '<a class="btn btn-p btn-sm mt-6" href="#/catalogus">' + K.t("Naar de catalogus") + '</a>');
    shell("catalogus", '<div class="mlist">' + body + '</div>', '<div class="mtop"><div class="mrow"><a href="#/catalogus" class="fs-13">' + K.icon("back") + ' ' + K.t("Catalogus") + '</a><span class="spacer"></span><h1 class="ktitle">' + K.t("Winkelmand") + '</h1><span class="spacer"></span>' + (ids.length ? '<button type="button" class="btn btn-ghost btn-sm" id="clearCart">' + K.t("Leegmaken") + '</button>' : "") + '</div></div>');
    bindSteppers(app, () => K.keep(app, renderWinkelmand)); // le focus reste sur le − / + du même article
    K.on(app, "click", "[data-day]", (e, t) => { cart.day = t.dataset.day; saveCart(); K.$$("[data-day]", app).forEach(b => b.classList.toggle("on", b === t)); const od = document.getElementById("otherDay"); if (od) { od.value = ""; od.style.borderColor = ""; od.style.color = ""; } document.getElementById("dayErr").innerHTML = ""; });
    const od = document.getElementById("otherDay"); if (od) od.addEventListener("change", () => {
      const v = od.value; const errBox = document.getElementById("dayErr");
      if (!v) { errBox.innerHTML = ""; return; }
      const msg = dayErr(v);
      if (msg) { errBox.innerHTML = '<span class="d-block fs-125 t-danger mt-4">' + K.esc(msg) + '</span>'; od.value = ""; return; }
      errBox.innerHTML = ""; cart.day = v; saveCart(); K.$$("[data-day]", app).forEach(b => b.classList.toggle("on", b.dataset.day === v)); od.style.borderColor = "var(--p)"; od.style.color = "var(--p)";
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
      lastOrder = { ref: d.ref, total: d.total, day: cart.day, items: items.map(i => ({ nom: byId(i.productId).nom, qty: i.quantity, prix: byId(i.productId).prix, unite: byId(i.productId).unite, pak: pakP(byId(i.productId)) })), at: Date.now(), mail: d.mail, email: (cat.client && cat.client.email) || "" };
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
    shell("bestellingen", '<div class="ok-head"><div class="ok-ring">' + K.icon("check", "") + '</div><h1 class="h1">' + K.t("Bestelling ontvangen") + '</h1><p class="sub ws-normal fs-14">' + K.t("Dank u wel. We zetten alles klaar voor") + ' <b>' + K.esc(K.dateLong(o.day)) + '</b>.</p><span class="tag mono">' + K.esc(o.ref) + '</span></div>' +
      '<div class="mlist pt-0"><div class="mcard"><ol class="tl" aria-label="' + K.t("Verloop") + '"><li aria-current="step"><i class="on" aria-hidden="true"></i><div><b>' + K.t("Ontvangen") + '</b><small>' + K.esc(K.date(K.isoDay(new Date(o.at).toISOString())) + " " + K.time(new Date(o.at).toISOString())) + '</small></div></li><li><i aria-hidden="true"></i><div>' + K.t("Wordt klaargezet") + '<small>' + K.t("de dag vóór levering") + '</small></div></li><li><i aria-hidden="true"></i><div>' + K.t("Onderweg") + '<small>' + K.esc(K.date(o.day)) + ' ' + K.t("ochtend") + '</small></div></li><li><i aria-hidden="true"></i><div>' + K.t("Geleverd → leveringsbon en factuur bij uw bestellingen") + '</div></li></ol></div>' +
      '<div class="mcard stack-6 fs-13">' + o.items.map(i => '<div class="d-flex jc-sb gap-10"><span>' + K.esc(K.qty(i.qty) + "× " + i.nom + (K.pakCount(i.qty, i.unite, i.pak || null) ? " (" + K.pakCount(i.qty, i.unite, i.pak) + ")" : "")) + '</span><span class="mono">' + K.eur(i.prix * i.qty) + '</span></div>').join("") + '<div class="d-flex jc-sb fw-600 bt-line pt-6"><span>' + K.t("Totaal excl. btw") + '</span><span class="mono">' + K.eur(o.total) + '</span></div></div>' +
      mailNote(o) +
      '<a class="btn btn-p btn-block" href="#/bestellingen">' + K.t("Naar mijn bestellingen") + '</a><a class="btn btn-o btn-block" href="#/catalogus">' + K.t("Verder bestellen") + '</a></div>');
    const ic = app.querySelector(".ico"); if (ic) { ic.style.width = "34px"; ic.style.height = "34px"; ic.style.stroke = "var(--st-done)"; ic.style.strokeWidth = "2.2"; }
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
      btn('data-reorder="' + K.esc(o.ref) + '"', K.t("Opnieuw bestellen")) +
      (o.statut === "Reçue" || o.statut === "Prête" ? btn('data-edit-order="' + K.esc(o.ref) + '"', K.t("Wijzigen")) + btn('data-cancel-order="' + K.esc(o.ref) + '"', K.t("Annuleren"), "btn-ghost") : "");
  }
  const badge = o => o.statut === "Facturée" ? (o.paiement === "Payé" ? K.stCell("Facturée", K.t("Geleverd · betaald")) : '<span class="cell-st c-inv">' + K.t("Geleverd · openstaand") + '</span>') : K.isLate(o) ? '<span class="cell-st c-late">' + K.t("Te laat") + '</span>' : K.stCell(o.statut);
  const stamp = iso => iso ? K.dateLong(iso) + (String(iso).includes("T") ? " " + K.time(iso) : "") : "";
  // Leveruur gezet door Famo (D4) : enkel tot de levering, in de taal van de klant.
  const slotTxt = o => { const sl = o.statut !== "Facturée" && o.statut !== K.CANCELLED ? K.slot(o.leverslot) : null; return sl ? K.tt("tussen {van} en {tot}", sl) : ""; };
  function openOrder(ref) {
    const o = (orders || []).find(x => x.ref === ref); if (!o) return;
    closePanel();
    const cancelled = o.statut === K.CANCELLED, idx = K.STATUSES.indexOf(o.statut), lines = K.parseLines(o.lignes);
    const when = { "Reçue": o.date ? K.dateLong(o.date) : "", "Sortie en livraison": o.livreeLe ? stamp(o.livreeLe) + (o.receptionnePar ? " · " + o.receptionnePar : "") : (idx < 3 && o.dateLiv ? K.date(o.dateLiv) + " " + (slotTxt(o) || K.t("ochtend")) : ""), "Facturée": o.factureeLe ? stamp(o.factureeLe) + (o.factuurnummer ? " · " + o.factuurnummer : "") : "" };
    const tl = cancelled
      ? '<ol class="tl" aria-label="' + K.t("Verloop") + '"><li><i class="on" aria-hidden="true"></i><div><b>' + K.t("Ontvangen") + '</b><small>' + K.esc(when["Reçue"]) + '</small></div></li><li aria-current="step"><i class="on bg-danger" aria-hidden="true"></i><div><b>' + K.t("Geannuleerd") + '</b><small>' + K.esc([stamp(o.annuleeLe), o.motifAnnulation ? K.t("Reden") + ": " + K.t(o.motifAnnulation) : ""].filter(Boolean).join(" · ")) + '</small></div></li></ol>'
      // G-24 : le suivi est une liste ordonnée, l'étape atteinte porte aria-current="step".
      : '<ol class="tl" aria-label="' + K.t("Verloop") + '">' + K.STATUSES.map((st, i) => '<li' + (i === idx ? ' aria-current="step"' : "") + '><i' + (i <= idx ? ' class="on"' : "") + ' aria-hidden="true"></i><div>' + (i <= idx ? '<b>' + K.esc(K.status(st)) + '</b>' : K.esc(K.status(st))) + (when[st] ? '<small>' + K.esc(when[st]) + '</small>' : "") + '</div></li>').join("") + '</ol>';
    const row = (label, value) => value ? '<div class="row"><div>' + K.esc(label) + '<small class="ws-pre">' + K.esc(value) + '</small></div></div>' : "";
    const body = '<div class="mcard mb-10">' + tl + '</div>' + "" +
      (o.uitzondering ? K.c.warn('<b>' + K.t("Uitzondering levering") + '</b> ' + K.esc(o.uitzondering)) + '<div class="h-10"></div>' : "") +
      '<div class="mcard mb-10"><div class="sec m-0 mb-6">' + K.t("Artikelen") + '</div><div class="stack-6 fs-13">' + lines.map(l => '<div class="d-flex jc-sb gap-10"><span>' + K.esc(K.qty(l.qty) + "× " + l.name + (l.unit ? " · " + K.unit(l.unit) : "") + (K.pakCount(l.qty, l.unit, K.pakIn(o.verpakking, l.name)) ? " · " + K.pakCount(l.qty, l.unit, K.pakIn(o.verpakking, l.name)) : "") + (l.comment ? " (" + l.comment + ")" : "")) + '</span>' + (l.price != null ? '<span class="mono">' + K.eur(l.price * l.qty) + '</span>' : "") + '</div>').join("") + '<div class="d-flex jc-sb fw-600 bt-line pt-6"><span>' + K.t("Totaal excl. btw") + '</span><span class="mono">' + K.eur(o.total) + '</span></div></div></div>' +
      '<div class="mcard">' + row(K.t("Besteld op"), o.date ? K.dateLong(o.date) : "") + row(K.t("Gewenste leverdag"), o.dateLiv ? K.dateLong(o.dateLiv) : "") + row(K.t("Verwacht leveruur"), slotTxt(o)) +
      row(K.t("Factuurnummer"), o.factuurnummer) + row(K.t("Gefactureerd op"), stamp(o.factureeLe)) + row(K.t("Geleverd op"), stamp(o.livreeLe)) + row(K.t("Ontvangen door"), o.receptionnePar) +
      (o.paiement === "Payé" ? row(K.t("Betaald op"), stamp(o.payeLe) || K.t("Betaald")) : "") +
      // Alle creditnota's (C-08), elk als document in de taal van de klant (FR/NL).
      (o.creditnotas && o.creditnotas.length ? o.creditnotas : o.creditnota ? [o.creditnota] : []).map(n => '<div class="row"><div>' + K.esc(K.t("Creditnota") + " " + n.nummer) + '<small>' + K.esc([K.eur(n.montant) + " " + K.t("excl. btw"), stamp(n.le)].filter(Boolean).join(" · ")) + '</small></div><button type="button" class="btn btn-o btn-sm" data-doc="credit" data-ref="' + K.esc(o.ref) + '" data-cn="' + K.esc(n.nummer) + '">' + K.t("Openen") + '</button></div>').join("") +
      row(K.t("Uw opmerking"), o.notes) + '</div>';
    panel = K.panel({ title: K.t("Bestelling") + " " + o.ref, sub: (o.dateLiv ? K.t("Levering") + " " + K.date(o.dateLiv) + " · " : "") + K.eur(o.total) + " " + K.t("excl. btw"), body, footer: '<div class="d-flex gap-8 f-wrap w-100p">' + actions(o) + '</div>', onClose: () => { panel = null; } });
    const st = panel.el.querySelector(".panel-h .h2"); if (st) st.insertAdjacentHTML("afterend", '<div class="mt-6">' + badge(o) + '</div>');
    bindOrderActions(panel.el);
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
    // Wijzigen = annuleren + regels terug in de winkelmand ; de klant plaatst daarna een nieuwe bestelling.
    K.on(root, "click", "[data-edit-order]", async (e, t) => {
      const o = (orders || []).find(x => x.ref === t.dataset.editOrder); if (!o) return;
      if (!(await K.confirm({ title: K.t("Bestelling wijzigen?"), text: K.t("Deze bestelling wordt geannuleerd en de artikelen komen in uw winkelmand. Plaats daarna een nieuwe bestelling."), yes: K.t("Wijzigen"), no: K.t("Behouden") }))) return;
      K.busy(t, true, K.t("Wijzigen…"));
      try {
        await cancelCall(o.ref);
        linesToCart(o); if (o.notes && !cart.note) cart.note = o.notes; if (dayOk(o.dateLiv)) cart.day = o.dateLiv; saveCart(); orders = null;
        K.toast(K.t("Bestelling geannuleerd · artikelen in de winkelmand")); closePanel(); K.go("winkelmand");
      } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(t, false); if (err.status === 404 || err.status === 409) { orders = null; closePanel(); renderBestellingen(); } }
    });
    K.on(root, "click", "[data-doc]", async (e, t) => { K.busy(t, true, K.t("Laden…")); try { await K.docs(); const d = await api("/api/klantdoc", { json: Object.assign({}, creds(), { ref: t.dataset.ref }) }); FamoDocuments.setCompany(d.config); const type = t.dataset.doc; const cn = type === "credit" ? (d.order.creditnotas || []).find(n => n.nummer === t.dataset.cn) : null; if (type === "credit" && !cn) throw new Error(K.t("Creditnota niet gevonden")); const doc = cn ? Object.assign({}, d.order, { creditnota: cn }) : d.order; const html = FamoDocuments.build(doc, type); famoDocPreview.open({ html, filename: FamoDocuments.filename(doc, type), title: type === "invoice" ? invLabel() + " " + FamoDocuments.number(doc, "invoice") : cn ? K.t("Creditnota") + " " + FamoDocuments.number(doc, "credit") : K.t("Leveringsbon") + " " + d.order.ref, meta: K.eur(cn ? cn.montant : d.order.total) + " " + K.t("excl. btw") }); } catch (err) { K.toast(err.message, { kind: "err" }); } finally { K.busy(t, false); } });
    K.on(root, "click", "[data-reorder]", (e, t) => { const o = (orders || []).find(x => x.ref === t.dataset.reorder); if (o) reorder(o); });
    K.on(root, "click", "[data-copy]", async (e, t) => { try { await navigator.clipboard.writeText(t.dataset.copy); K.toast(K.t("Gekopieerd")); } catch (err) { K.toast(K.t("Kopiëren lukt niet op dit toestel."), { kind: "err" }); } });
  }
  // Document « factuur » van het portaal : pro forma zolang de boekhouding factureert (lib/billing.js).
  const invLabel = () => ((cat && cat.company && cat.company.facturatie) === "portaal" ? K.t("Factuur") : K.t("Pro forma"));
  // Openstaande facturen. Modus « boekhouder » (standaard) : de factuur én de betaalgegevens komen van
  // de boekhouding (Peppol) ; het portaal toont dan geen kaart en geen bedrag « te betalen » (anders twee facturen).
  // Modus « portaal » : totaal INCL. btw (zelfde regel als de factuur) en gestructureerde mededeling.
  const ogm = nr => { const m = String(nr || "").match(/^FA-(\d{4})-(\d{1,6})$/i); if (!m) return ""; const base = m[1] + m[2].padStart(6, "0"); const d = base + String(Number(base) % 97 || 97).padStart(2, "0"); return "+++" + d.slice(0, 3) + "/" + d.slice(3, 7) + "/" + d.slice(7) + "+++"; };
  function statement(list) {
    const co = cat.company || {};
    // Modus « boekhouder » : geen kaart meer (de vermelding « via de boekhouding (Peppol) » is weg sinds 2026-10-08).
    if (co.facturatie !== "portaal") return "";
    const due = o => Number(o.totalIncl != null ? o.totalIncl : o.total || 0);
    const sum = list.reduce((s, o) => s + due(o), 0);
    const bank = [co.iban ? "IBAN " + co.iban : "", co.bic ? "BIC " + co.bic : ""].filter(Boolean).join(" · ");
    const ref = o => ogm(o.factuurnummer) || o.factuurnummer || o.ref;
    const payText = o => [co.bedrijfsnaam || "FAMO Seafood", co.iban ? "IBAN " + co.iban : "", co.bic ? "BIC " + co.bic : "", K.eur(due(o)) + " " + K.t("incl. btw"), K.t("Mededeling") + ": " + ref(o)].filter(Boolean).join(" · ");
    return '<div class="mcard card-tint d-flex f-col gap-8"><div class="spread-c"><b>' + K.t("Openstaande facturen") + '</b><span class="fs-125">' + K.t("Totaal openstaand") + ' <b class="mono">' + K.eur(sum) + '</b> ' + K.t("incl. btw") + '</span></div>' +
      list.map(o => '<div class="d-flex jc-sb ai-c gap-8 fs-125"><div class="minw-0"><b class="mono">' + K.esc(o.factuurnummer || o.ref) + '</b><div class="quiet fs-12">' + K.esc(K.date(o.factureeLe || o.date)) + ' · ' + K.t("Mededeling") + ': <span class="mono">' + K.esc(ref(o)) + '</span></div></div><span class="mono">' + K.eur(due(o)) + '</span><button type="button" class="btn btn-o btn-sm" data-copy="' + K.esc(payText(o)) + '">' + K.t("Kopiëren") + '</button></div>').join("") +
      (bank ? '<div class="quiet fs-12 d-flex jc-sb ai-c gap-8 f-wrap"><span>' + K.t("Betaalgegevens") + ': <span class="mono">' + K.esc(bank) + '</span></span><button type="button" class="btn btn-ghost btn-sm" data-copy="' + K.esc(co.iban) + '">' + K.t("Kopiëren") + '</button></div>' : "") + '</div>';
  }
  async function renderBestellingen() {
    shell("bestellingen", '<div class="mlist" id="ordersBox">' + K.c.skeleton(3) + '</div>', topbar(K.t("Mijn bestellingen"), cat.client.nom));
    await K.retryBox("ordersBox", async () => { await loadOrders(); renderOrderList(); });
  }
  function renderOrderList() {
    const open = o => !K.isClosed(o);
    const list = orders.filter(o => ordFilter === "lopend" ? open(o) : ordFilter === "geleverd" ? !open(o) : ordFilter === "tebetalen" ? unpaid(o) : true);
    const nUnpaid = orders.filter(unpaid).length;
    const chips = '<div class="cats">' + [["lopend", K.t("Lopend")], ["geleverd", K.t("Geleverd · documenten")], ["tebetalen", K.t("Te betalen") + (nUnpaid ? " · " + nUnpaid : "")], ["alles", K.t("Alles")]].map(([k, l]) => '<button type="button" data-of="' + k + '"' + (k === ordFilter ? ' class="on"' : "") + '>' + l + '</button>').join("") + '</div>';
    // Une ligne par commande (et plus une carte) : date, articles, statut, montant ; sur ordinateur les documents
    // et « Opnieuw bestellen » restent sur la ligne. Tout le reste (wijzigen, annuleren, détail) : clic sur la ligne.
    const quick = o => { const r = ' data-ref="' + K.esc(o.ref) + '"'; return (o.statut === "Facturée" ? '<button type="button" class="btn btn-o btn-sm" data-doc="invoice"' + r + '>' + invLabel() + '</button>' : "") + (o.statut === "Facturée" || o.statut === "Sortie en livraison" ? '<button type="button" class="btn btn-o btn-sm" data-doc="delivery"' + r + '>' + K.t("Leveringsbon") + '</button>' : "") + '<button type="button" class="btn btn-ghost btn-sm" data-reorder="' + K.esc(o.ref) + '">' + K.t("Opnieuw bestellen") + '</button>'; };
    const card = o => '<div class="orow' + (o.statut === K.CANCELLED ? " is-cancel" : "") + '"><button type="button" class="orow-main" data-open="' + K.esc(o.ref) + '" aria-label="' + K.esc(K.t("Bestelling") + " " + o.ref + ", " + K.t("details")) + '"><span class="orow-d"><b>' + K.esc(o.dateLiv ? K.t("Levering") + " " + K.date(o.dateLiv) + (slotTxt(o) ? " · " + slotTxt(o) : "") : K.date(o.date)) + '</b><small class="mono">' + K.esc(o.ref) + (o.factuurnummer ? " · " + K.esc(o.factuurnummer) : "") + '</small></span><span class="orow-s">' + K.esc(K.linesSummary(o.lignes, o.verpakking)) + '</span><span class="orow-st">' + badge(o) + '</span><b class="mono orow-t">' + K.eur(o.total) + '</b>' + K.icon("chev", "orow-chev") + '</button><span class="orow-a">' + quick(o) + '</span></div>';
    const empty = ordFilter === "lopend" ? K.c.empty(K.t("Geen lopende bestellingen"), K.tt("Bestel vóór {t} voor levering op {d}.", { t: deadline(), d: K.dateLong(firstDay()) }), '<a class="btn btn-p btn-sm mt-6" href="#/catalogus">' + K.t("Naar de catalogus") + '</a>') : ordFilter === "tebetalen" ? K.c.empty(K.t("Geen openstaande facturen"), K.t("Alles is betaald. Dank u wel.")) : K.c.empty(K.t("Niets in deze lijst"));
    // G-13 : la pastille de l'onglet compte les factures à payer ; la vue qui s'ouvre le dit et y mène en un geste.
    const payHint = ordFilter !== "tebetalen" && nUnpaid ? '<div class="full">' + K.c.warn('<span>' + K.esc(nUnpaid + " " + K.t(nUnpaid === 1 ? "factuur te betalen" : "facturen te betalen")) + '</span> <button type="button" class="linkbtn" data-of="tebetalen">' + K.t("Bekijken") + '</button>') + '</div>' : "";
    const st = ordFilter === "tebetalen" && list.length ? statement(list) : ""; // modus boekhouder : leeg, geen kaart
    shell("bestellingen", '<div class="mlist grid">' + payHint + (st ? '<div class="full">' + st + '</div>' : "") + (list.length ? '<div class="olist full">' + list.map(card).join("") + '</div>' : '<div class="full">' + empty + '</div>') + '</div>', topbar(K.t("Mijn bestellingen"), cat.client.nom).slice(0, -6) + chips + "</div>");
    const ofGroup = app.querySelector("[data-of]") && app.querySelector("[data-of]").parentElement; if (ofGroup) ofGroup.setAttribute("aria-label", K.t("Filter")); // G-06 : groupe de filtres nommé (aria-pressed : K.syncStates)
    K.on(app, "click", "[data-of]", (e, t) => { ordFilter = t.dataset.of; K.keep(app, renderOrderList); });
    bindOrderActions(app);
  }

  /* ---------- favorieten / standaard ---------- */
  function renderFavorieten() {
    const favList = (cat.products || []).filter(p => favs[p.id]);
    const stdList = std ? Object.entries(std).map(([id, qv]) => ({ p: byId(id), qty: qv })).filter(x => x.p) : [];
    const stdTotal = stdList.reduce((s, x) => s + x.p.prix * x.qty, 0);
    const stdCard = '<div class="mcard card-tint"><div class="spread-c"><div><b>' + K.t("Mijn standaardbestelling") + '</b><div class="quiet fs-12">' + (stdList.length ? stdList.length + " " + K.t("artikelen") + " · " + K.eur(stdTotal) : K.t("Nog niet ingesteld")) + '</div></div></div>' +
      (stdList.length ? '<div class="mt-8 fs-125 t-ink2">' + stdList.map(x => K.qty(x.qty) + "× " + K.esc(x.p.nom) + (K.pakCount(x.qty, x.p.unite, pakP(x.p)) ? " (" + K.esc(K.pakCount(x.qty, x.p.unite, pakP(x.p))) + ")" : "")).join(" · ") + '</div><div class="d-flex gap-8 mt-10"><button type="button" class="btn btn-p btn-sm flex-1" id="stdToCart">' + K.t("In winkelmand zetten") + '</button><button type="button" class="btn btn-o btn-sm" id="stdSave">' + K.t("Vervang door winkelmand") + '</button></div>' : '<div class="d-flex gap-8 mt-10"><button type="button" class="btn btn-p btn-sm flex-1" id="stdSave">' + K.t("Huidige winkelmand opslaan als standaard") + '</button></div>') + '</div>';
    const body = '<div class="kcols"><div class="kc-main"><h2 class="sec mt-0">' + K.t("Favorieten") + '</h2>' + (favList.length ? '<div class="mcard">' + favList.map(p => '<div class="li"><div class="n"><b>' + K.esc(p.nom) + '</b><div class="quiet fs-12 d-flex gap-6 ai-c f-wrap"><span>' + K.esc((p.kaliber ? p.kaliber + " · " : "") + unitLabel(p)) + ' · ' + K.eur(p.prix) + '</span>' + stockTag(p) + '</div>' + pakCaption(p, cart.items[p.id]) + '</div>' + stepperOf(p, cart.items[p.id]) + '<button type="button" class="ibtn fav on" data-fav="' + p.id + '" aria-label="' + K.esc(K.t("Uit favorieten") + ": " + p.nom) + '">' + K.icon("star") + '</button></div>').join("") + '</div>' : K.c.empty(K.t("Nog geen favorieten"), K.t("Tik op de ster bij een product in de catalogus."))) + '</div><div class="kc-side">' + stdCard + '</div></div>';
    shell("favorieten", '<div class="mlist">' + body + '</div>', topbar(K.t("Favorieten"), K.t("Snel opnieuw bestellen")));
    bindSteppers(app);
    K.on(app, "click", "[data-fav]", (e, t) => { setFav(t.dataset.fav, false); K.keep(app, renderFavorieten); });
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
    const body = '<div class="mcard"><div class="row"><div>' + K.t("Zaak") + '<small>' + K.esc(cl.nom || "") + '</small></div></div><div class="row"><div>' + K.t("Leveradres") + '<small class="ws-pre">' + K.esc(cl.adresse || "—") + '</small></div></div>' + (cl.klantnr ? '<div class="row"><div>' + K.t("Klantnummer") + '<small class="mono">' + K.esc(cl.klantnr) + '</small></div></div>' : "") + (cl.btw ? '<div class="row"><div>' + K.t("Btw-nummer") + '<small class="mono">' + K.esc(cl.btw) + '</small></div></div>' : "") + '<div class="row"><div>' + K.t("Gebruikersnaam") + '<small>' + K.esc(sess.user) + '</small></div></div><div class="row"><div>' + K.t("Taal") + '<small>' + K.t("Nederlands of Frans, voor dit toestel") + '</small></div>' + K.langSwitch() + '</div><div class="row wrap"><div>' + K.t("Tellers in het menu") + '<small>' + K.badgeHelp() + '</small></div>' + K.badgeSwitch() + '</div></div>' +
      '<div class="mcard"><div class="row"><div>' + K.t("E-mail") + '<small>' + K.esc(cl.email || "—") + '</small></div><button type="button" class="btn btn-o btn-sm" data-profile>' + K.t("Wijzigen") + '</button></div><div class="row"><div>' + K.t("Telefoon") + '<small>' + K.esc(cl.tel || "—") + '</small></div><button type="button" class="btn btn-o btn-sm" data-profile>' + K.t("Wijzigen") + '</button></div></div>' +
      '<div class="mcard"><div class="row"><div>' + K.t("Documenten") + '<small>' + K.t("Leveringsbonnen en facturen per bestelling") + '</small></div><a href="#/bestellingen" class="btn btn-o btn-sm" data-goto="geleverd">' + K.t("Openen") + '</a></div></div><div class="mcard"><div class="row"><div>' + K.t("Gegevens wijzigen") + '<small>' + K.t("Leveradres wijzigen: bel of mail Famo") + '</small></div></div><div class="row"><div>' + K.t("Wachtwoord") + '<small>' + K.t("Wijzig uw wachtwoord zelf, met uw huidige wachtwoord") + '</small></div><button type="button" class="btn btn-o btn-sm" id="pwChange">' + K.t("Wijzigen") + '</button></div></div>' +
      '<div class="mcard"><b>' + K.esc(co.bedrijfsnaam || "FAMO Seafood") + '</b><div class="quiet fs-125 mt-4">' + K.esc([co.adres, co.plaats].filter(Boolean).join(", ")) + '</div><div class="d-flex gap-8 mt-10 f-wrap">' + (co.telefoon ? '<a class="btn btn-o btn-sm" href="tel:' + K.esc(co.telefoon.replace(/\s+/g, "")) + '">' + K.icon("phone") + K.esc(co.telefoon) + '</a>' : "") + (co.email ? '<a class="btn btn-o btn-sm" href="mailto:' + K.esc(co.email) + '">' + K.esc(co.email) + '</a>' : "") + '</div></div>' +
      '<button type="button" class="btn btn-o btn-block full t-danger maxw-320" id="logout">' + K.t("Uitloggen") + '</button>';
    shell("account", '<div class="mlist grid">' + body + '</div>', topbar(K.t("Account"), cl.nom || ""));
    K.on(app, "click", "[data-goto]", () => { ordFilter = "geleverd"; });
    K.on(app, "click", "[data-profile]", openProfilePanel);
    document.getElementById("pwChange").onclick = openPasswordPanel;
    document.getElementById("logout").onclick = async () => { if (await K.confirm({ title: K.t("Uitloggen?"), text: K.t("Uw winkelmand blijft bewaard op dit toestel."), yes: K.t("Uitloggen") })) { try { await K.api("/api/klantwachtwoord", { json: { action: "logout", token: (K.klant.creds() || {}).token } }); } catch (e) { /* hors ligne : les données locales sont quand même effacées */ } K.klant.clear(); K.session.del(CAT_KEY); location.href = "/?uit=1"; } };
  }

  /* ---------- router ---------- */
  function route() {
    if (cat) return render();
    // Eerste lading : skelet, en bij een fout « Opnieuw proberen » (K.retryBox) dat de lading én de weergave herhaalt.
    app.innerHTML = '<div class="kwrap p-20" id="boot"></div>';
    return K.retryBox("boot", async () => { document.getElementById("boot").innerHTML = K.c.skeleton(3); await loadCatalogue(); render(); });
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
    if (!["catalogus", "winkelmand", "bevestigd", "bestellingen", "favorieten", "account"].includes(path)) { location.hash = "#/catalogus"; return; }
    ({ winkelmand: renderWinkelmand, bevestigd: renderBevestigd, bestellingen: renderBestellingen, favorieten: renderFavorieten, account: renderAccount, catalogus: renderCatalogus })[path]();
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
