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
  const creds = () => K.klant.creds();
  // 401 op eender welke klant-API : opgeslagen gegevens wissen en terug naar de aanmelding (met melding).
  function expire() { K.klant.clear(); K.session.del(CAT_KEY); location.replace("/?sessie=verlopen"); }
  const api = async (url, opts) => { try { return await K.api(url, opts); } catch (err) { if (err.status === 401) expire(); throw err; } };

  /* ---------- leveringsregels (company.levering, zelfde bron als lib/levering.js) ---------- */
  // Standaardregels = lib/levering DEFAULTS ; enkel gebruikt zolang company.levering ontbreekt (oude cache).
  const CUTOFF_HOUR = 22, MAX_DAYS_AHEAD = 60;
  const DEF_RULES = { deadline: CUTOFF_HOUR + ":00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [], minimum: 0, maxDagen: MAX_DAYS_AHEAD };
  const DAY_KEYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const rules = () => Object.assign({}, DEF_RULES, (cat && cat.company && cat.company.levering) || {});
  const deadline = () => rules().deadline;
  const afterDeadline = () => { const [h, m] = deadline().split(":").map(Number); const n = new Date(); return n.getHours() * 60 + n.getMinutes() >= (h || 0) * 60 + (m || 0); };
  const dow = iso => { const d = K.parseDate(iso); return d ? d.getDay() : -1; };
  const deliverable = iso => { const r = rules(); return r.leverdagen.includes(DAY_KEYS[dow(iso)]) && !r.geslotenDagen.includes(iso); };
  // Eerste leverbare dag : morgen (na de deadline overmorgen), daarna de eerste leverdag die niet gesloten is.
  const firstDay = () => { let d = K.addDays(K.today(), afterDeadline() ? 2 : 1), n = 0; while (!deliverable(d) && n++ < 400) d = K.addDays(d, 1); return d; };
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
    if (iso < firstDay()) return K.tt("Die dag is te vroeg: bestel vóór {t} voor levering morgen.", { t: deadline() });
    return "";
  };
  const dayOk = iso => !dayErr(iso);
  const nextDays = () => { const out = []; let d = firstDay(), n = 0; while (out.length < 6 && n++ < 400 && d <= lastDay()) { if (deliverable(d)) out.push(d); d = K.addDays(d, 1); } return out; };
  const daysLabel = () => rules().leverdagen.map(k => K.t(k)).join(", ");
  const minimum = () => Number(rules().minimum) || 0;

  /* ---------- beschikbaarheid (enkel als de server een voorraad meestuurt) ---------- */
  const stock = p => (typeof p.voorraad === "number" ? p.voorraad : null);
  const capQty = (p, v) => { const s = stock(p); return s == null ? v : Math.min(v, Math.max(0, s)); };
  const stockTag = p => { const s = stock(p); if (s == null) return ""; return s > 0 ? '<span class="tag">' + K.esc(K.tt("Nog {n}", { n: K.qty(s) })) + '</span>' : '<span class="tag" style="color:var(--danger)">' + K.t("Uitverkocht") + '</span>'; };

  /* ---------- favorieten : server (Clients.Favorieten) eerst, localStorage als cache ---------- */
  let syncTimer = null, favWarned = false;
  function syncFavs() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try { await api("/api/klantorder", { json: Object.assign({}, creds(), { action: "favorites", favorieten: Object.keys(favs), standaard: std || {} }) }); }
      catch (err) { if (err.status !== 401 && !favWarned) { favWarned = true; K.toast(K.t("Favorieten bewaren mislukt. Ze blijven op dit toestel."), { kind: "err" }); } }
    }, 1200);
  }
  const setFav = (id, on) => { if (on) favs[id] = true; else delete favs[id]; K.store.set(FAV_KEY, favs); syncFavs(); };
  const setStd = v => { std = v; K.store.set(STD_KEY, std); syncFavs(); };
  // Bij een verse catalogus : wat op de server staat wint ; staat daar niets en hier wel (oud toestel), dan gaat dit toestel naar boven.
  function adoptFavs(client) {
    const f = client && client.favorieten; if (!f) return;
    const list = Array.isArray(f.favorieten) ? f.favorieten : [], sd = f.standaard && typeof f.standaard === "object" ? f.standaard : {};
    if (list.length || Object.keys(sd).length) { favs = Object.fromEntries(list.map(id => [id, true])); std = Object.keys(sd).length ? sd : null; K.store.set(FAV_KEY, favs); K.store.set(STD_KEY, std); }
    else if (Object.keys(favs).length || (std && Object.keys(std).length)) syncFavs();
  }

  function shell(active, inner, top) {
    app.innerHTML = '<div class="kwrap">' + (top || "") + inner + K.klantTabs(active) + '</div>';
  }
  function topbar(title, sub, right) {
    return '<div class="mtop"><div class="mrow"><span class="logo">F</span><div style="min-width:0;flex:1"><b style="display:block;font-size:15px">' + K.esc(title) + '</b><span class="quiet" style="font-size:12px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(sub || "") + '</span></div>' + (right || "") + '</div></div>';
  }

  async function loadCatalogue(force) {
    const cached = K.session.get(CAT_KEY, null);
    if (!force && cached && Date.now() - cached.at < 10 * 60 * 1000) { cat = cached; return cat; }
    const d = await api("/api/catalogue", { json: creds(), retry: true });
    cat = { at: Date.now(), products: d.products || [], client: d.client, company: d.company };
    K.session.set(CAT_KEY, cat);
    K.klant.set(Object.assign({}, sess, { client: d.client, company: d.company }));
    adoptFavs(d.client);
    return cat;
  }
  async function loadOrders(force) {
    if (orders && !force) return orders;
    const d = await api("/api/orders", { json: creds(), retry: true });
    orders = d.orders || [];
    return orders;
  }

  /* ---------- catalogus ---------- */
  let q = "", catFilter = "Alles";
  function productCard(p) {
    const qty = Number(cart.items[p.id] || 0), neg = p.prix < p.base;
    return '<div class="prod' + (qty > 0 ? " on" : "") + '" data-id="' + p.id + '"><div class="ph">' + (p.foto ? '<img src="' + K.esc(p.foto) + '" alt="" loading="lazy" data-fallback>' : K.icon("fish")) + '</div>' +
      '<div class="pi"><div class="pn">' + K.esc(p.nom) + '</div><div style="display:flex;gap:6px;align-items:center;margin-top:2px;flex-wrap:wrap">' + (p.kaliber ? '<span class="tag">' + K.esc(p.kaliber) + '</span>' : "") + '<span class="tag">' + K.esc(unitLabel(p)) + '</span>' + stockTag(p) + '<button type="button" class="ibtn fav' + (favs[p.id] ? " on" : "") + '" data-fav="' + p.id + '" aria-label="' + K.t("Favoriet") + '" aria-pressed="' + (favs[p.id] ? "true" : "false") + '" style="width:40px;height:40px;margin:-4px 0">' + K.icon("star") + '</button></div>' +
      '<div class="pp" style="margin-top:4px"><b class="mono">' + K.eur(p.prix) + '</b>' + (neg ? '<s class="mono">' + K.eur(p.base) + '</s><small>' + K.t("uw prijs") + '</small>' : '<small>/ ' + K.esc(unitLabel(p)) + '</small>') + '</div></div>' +
      K.c.stepper(p.id, qty, { step: isKg(p) ? 0.5 : 1 }) + '</div>';
  }
  function renderCatalogus() {
    // Catégorie affichée = traduction (K.cat) ; la valeur Airtable reste la clé de filtre.
    const products = (cat.products || []).filter(p => (!q || (p.nom + " " + (p.kaliber || "") + " " + K.cat(p.cat)).toLowerCase().includes(q)) && (catFilter === "Alles" || (catFilter === "Favorieten" ? favs[p.id] : K.cat(p.cat) === catFilter)));
    const cats = ["Alles", "Favorieten", ...Array.from(new Set((cat.products || []).map(p => K.cat(p.cat)))).sort((a, b) => a.localeCompare(b, "nl"))];
    const groups = {}; products.forEach(p => { const g = catFilter === "Favorieten" ? "Favorieten" : (favs[p.id] && catFilter === "Alles" && !q ? "Favorieten" : K.cat(p.cat)); (groups[g] = groups[g] || []).push(p); });
    const order = Object.keys(groups).sort((a, b) => (a === "Favorieten" ? -1 : b === "Favorieten" ? 1 : a.localeCompare(b, "nl")));
    const top = '<div class="mtop"><div class="mrow"><span class="logo">F</span><div style="min-width:0;flex:1"><b style="display:block;font-size:15px">' + K.t("Catalogus") + '</b><span class="quiet" style="font-size:12px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(cat.client.nom) + ' · ' + K.esc(K.tt("bestel vóór {t} voor morgen", { t: deadline() })) + '</span></div>' + K.c.avatar(cat.client.nom) + '</div>' +
      '<label class="search" style="max-width:none">' + K.icon("search") + '<input id="q" placeholder="' + K.t("Zoek een product…") + '" value="' + K.esc(q) + '" autocomplete="off"></label>' +
      '<div class="cats">' + cats.map(c => '<button type="button" data-cat="' + K.esc(c) + '"' + (c === catFilter ? ' class="on"' : "") + '>' + K.esc(K.t(c)) + '</button>').join("") + '</div></div>';
    const list = products.length ? order.map(g => '<div class="sec">' + K.esc(K.t(g)) + '</div>' + groups[g].map(productCard).join("")).join("") : K.c.empty(q ? K.t("Niets gevonden voor") + " „" + q + "”" : K.t("Nog geen favorieten"), q ? K.t("Probeer een ander woord of kies een categorie.") : K.t("Tik op de ster bij een product om het hier te zien."));
    const n = cartCount();
    shell("catalogus", '<div class="mlist" id="list">' + list + '</div>' + (n ? '<div class="cartbar"><div><div style="font-size:11px;opacity:.75">' + n + ' ' + K.t(n === 1 ? "artikel" : "artikelen") + ' · ' + K.t("excl. btw") + '</div><div class="mono" style="font-size:17px;font-weight:600">' + K.eur(cartTotal()) + '</div></div><a class="btn" href="#/winkelmand" style="background:#fff;color:var(--ink)">' + K.t("Bestellen") + '</a></div>' : ""), top);
    const qi = document.getElementById("q"); qi.addEventListener("input", () => { q = qi.value.trim().toLowerCase(); const pos = qi.selectionStart; renderCatalogus(); const n2 = document.getElementById("q"); n2.focus(); n2.setSelectionRange(pos, pos); });
    K.on(app, "click", "[data-cat]", (e, t) => { catFilter = t.dataset.cat; renderCatalogus(); });
    K.on(app, "click", "[data-fav]", (e, t) => { const id = t.dataset.fav; setFav(id, !favs[id]); K.setOn(t, !!favs[id]); });
    // Foto's van Airtable verlopen na een tijd : bij een kapotte afbeelding valt de kaart terug op het icoon.
    K.$$("img[data-fallback]", app).forEach(img => { img.onerror = () => { img.parentNode.innerHTML = K.icon("fish"); }; });
    bindSteppers(app, () => { renderCatalogus(); });
  }
  function bindSteppers(root, after) {
    K.$$(".stepper", root).forEach(st => {
      const id = st.dataset.stepper, inp = st.querySelector("input"), p = byId(id); if (!p) return;
      const step = isKg(p) ? 0.5 : 1;
      const set = v => {
        v = Math.max(0, Math.round(v * 1000) / 1000); if (!isKg(p)) v = Math.round(v);
        // Voorraad begrenst het aantal (de server kan alsnog weigeren : de klant ziet dan de servermelding).
        const capped = capQty(p, v); if (capped < v) { v = capped; K.toast(v > 0 ? K.tt("Slechts {n} beschikbaar.", { n: K.qty(v) }) : K.t("Uitverkocht"), { kind: "err" }); }
        if (v > 0) cart.items[id] = v; else { delete cart.items[id]; delete cart.comments[id]; } saveCart(); inp.value = v; st.classList.toggle("on", v > 0); if (after) after(id, v);
      };
      st.querySelector("[data-dec]").onclick = () => set(Number(inp.value) - step);
      st.querySelector("[data-inc]").onclick = () => set(Number(inp.value) + step);
      inp.addEventListener("change", () => set(Number(String(inp.value).replace(",", ".")) || 0));
    });
  }

  /* ---------- winkelmand ---------- */
  function renderWinkelmand() {
    const ids = Object.keys(cart.items).filter(id => byId(id) && Number(cart.items[id]) > 0);
    const days = nextDays(); if (!dayOk(cart.day)) { cart.day = days[0] || ""; saveCart(); }
    const otherDay = !days.includes(cart.day);
    const total = cartTotal(), min = minimum(), below = ids.length > 0 && min > 0 && total < min;
    const body = ids.length ? '<div class="mcard">' + ids.map(id => { const p = byId(id); return '<div class="li"><div class="n"><b>' + K.esc(p.nom) + '</b><div class="quiet" style="font-size:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span>' + K.esc((p.kaliber ? p.kaliber + " · " : "") + unitLabel(p)) + ' · ' + K.eur(p.prix) + '</span>' + stockTag(p) + '</div></div>' + K.c.stepper(p.id, cart.items[id], { step: isKg(p) ? 0.5 : 1 }) + '<b class="mono t">' + K.eur(p.prix * cart.items[id]) + '</b><input class="input c" style="min-height:38px;font-size:12px" placeholder="' + K.t("Opmerking (bv. dikke moot)") + '" data-comment="' + p.id + '" value="' + K.esc(cart.comments[id] || "") + '" maxlength="120"></div>'; }).join("") + '</div>' +
      '<div class="mcard" style="display:flex;flex-direction:column;gap:10px"><div class="field"><label>' + K.t("Leverdag") + '</label><div class="opt">' + days.map(d => '<button type="button" data-day="' + d + '"' + (d === cart.day ? ' class="on"' : "") + '>' + K.esc(K.date(d)) + '</button>').join("") + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap"><label for="otherDay" style="font-size:13px;margin:0">' + K.t("Andere dag") + '</label><input type="date" class="input" id="otherDay" style="flex:1;min-width:160px' + (otherDay ? ";border-color:var(--p);color:var(--p)" : "") + '" min="' + firstDay() + '" max="' + lastDay() + '" value="' + (otherDay ? cart.day : "") + '"></div><div id="dayErr"></div><span class="quiet" style="font-size:12px">' + K.esc(K.tt("Levering op {d}. Vóór {t} besteld = morgen geleverd.", { d: daysLabel(), t: deadline() })) + '</span></div>' +
      '<div class="field"><label>' + K.t("Leveradres") + '</label><div class="input" style="display:flex;align-items:center;white-space:pre-line;min-height:44px;padding:8px 12px;font-size:13px">' + K.esc(cat.client.adresse || K.t("Adres bij Famo bekend")) + '</div><span class="quiet" style="font-size:12px">' + K.t("Ander adres? Zet het in de opmerking.") + '</span></div>' +
      '<div class="field"><label>' + K.t("Opmerking voor Famo") + '</label><textarea class="input" id="note" rows="2" placeholder="' + K.t("bv. graag achteraan bellen") + '">' + K.esc(cart.note || "") + '</textarea></div></div>' +
      '<div class="mcard" style="display:flex;flex-direction:column;gap:6px;font-size:13px"><div style="display:flex;justify-content:space-between"><span>' + K.t("Totaal excl. btw") + '</span><b class="mono">' + K.eur(total) + '</b></div><div class="quiet" style="font-size:12px">' + K.esc(K.tt("De btw wordt op de factuur toegevoegd. Levering gratis · bestel vóór {t} voor levering morgen.", { t: deadline() })) + (min > 0 ? ' · ' + K.esc(K.tt("Minimumbestelling {m} excl. btw", { m: K.eur(min) })) : "") + '</div></div>' +
      (below ? K.c.warn(K.esc(K.tt("Minimumbestelling {m} excl. btw · nog {r} toe te voegen.", { m: K.eur(min), r: K.eur(min - total) }))) : "") +
      '<div id="orderErr"></div>' +
      '<button type="button" class="btn btn-p btn-block" id="placeOrder" style="min-height:50px;font-size:15px"' + (below ? " disabled" : "") + '>' + K.t("Bestelling plaatsen") + ' · ' + K.eur(total) + '</button>'
      : K.c.empty(K.t("Uw winkelmand is leeg"), K.t("Kies producten in de catalogus."), '<a class="btn btn-p btn-sm" href="#/catalogus" style="margin-top:6px">' + K.t("Naar de catalogus") + '</a>');
    shell("catalogus", '<div class="mlist">' + body + '</div>', '<div class="mtop"><div class="mrow"><a href="#/catalogus" style="font-size:13px">' + K.icon("back") + ' ' + K.t("Catalogus") + '</a><span class="spacer"></span><b style="font-size:16px">' + K.t("Winkelmand") + '</b><span class="spacer"></span>' + (ids.length ? '<button type="button" class="btn btn-ghost btn-sm" id="clearCart">' + K.t("Leegmaken") + '</button>' : "") + '</div></div>');
    bindSteppers(app, () => renderWinkelmand());
    K.on(app, "click", "[data-day]", (e, t) => { cart.day = t.dataset.day; saveCart(); K.$$("[data-day]", app).forEach(b => b.classList.toggle("on", b === t)); const od = document.getElementById("otherDay"); if (od) { od.value = ""; od.style.borderColor = ""; od.style.color = ""; } document.getElementById("dayErr").innerHTML = ""; });
    const od = document.getElementById("otherDay"); if (od) od.addEventListener("change", () => {
      const v = od.value; const errBox = document.getElementById("dayErr");
      if (!v) { errBox.innerHTML = ""; return; }
      const msg = dayErr(v);
      if (msg) { errBox.innerHTML = '<span style="display:block;font-size:12.5px;color:var(--danger);margin-top:4px">' + K.esc(msg) + '</span>'; od.value = ""; return; }
      errBox.innerHTML = ""; cart.day = v; saveCart(); K.$$("[data-day]", app).forEach(b => b.classList.toggle("on", b.dataset.day === v)); od.style.borderColor = "var(--p)"; od.style.color = "var(--p)";
    });
    K.on(app, "input", "[data-comment]", (e, t) => { cart.comments[t.dataset.comment] = t.value; saveCart(); });
    const note = document.getElementById("note"); if (note) note.addEventListener("input", () => { cart.note = note.value; saveCart(); });
    const clear = document.getElementById("clearCart"); if (clear) clear.onclick = async () => { if (await K.confirm({ title: K.t("Winkelmand leegmaken?"), text: K.t("Alle artikelen worden verwijderd."), yes: K.t("Leegmaken"), danger: true })) { cart.items = {}; cart.comments = {}; saveCart(); renderWinkelmand(); } };
    const place = document.getElementById("placeOrder"); if (place) place.onclick = placeOrder;
  }
  async function placeOrder() {
    const btn = document.getElementById("placeOrder");
    const items = Object.entries(cart.items).filter(([id, qv]) => byId(id) && Number(qv) > 0).map(([id, qv]) => ({ productId: id, quantity: Number(qv), comment: cart.comments[id] || "" }));
    if (!items.length) return;
    // Zelfde controle als de server, voor een snelle melding ; de servermelding blijft altijd zichtbaar.
    const pre = dayErr(cart.day); if (pre) { document.getElementById("orderErr").innerHTML = K.c.error(pre); return; }
    K.busy(btn, true, K.t("Bestelling versturen…")); document.getElementById("orderErr").innerHTML = "";
    try {
      const d = await api("/api/order", { json: Object.assign({}, creds(), { items, notes: cart.note || "", dateLivraison: cart.day }) });
      lastOrder = { ref: d.ref, total: d.total, day: cart.day, items: items.map(i => ({ nom: byId(i.productId).nom, qty: i.quantity, prix: byId(i.productId).prix })), at: Date.now(), mail: d.mail, email: (cat.client && cat.client.email) || "" };
      K.session.set("famoLastOrder", lastOrder);
      cart = { items: {}, comments: {}, note: "", day: "" }; saveCart(); orders = null;
      K.go("bevestigd");
    } catch (err) {
      document.getElementById("orderErr").innerHTML = K.c.error(err.status === 401 ? K.t("Uw sessie is verlopen. Meld u opnieuw aan.") : err.message);
      K.busy(btn, false);
    }
  }
  // api/order.js : mail = {team, customer} (lib/ordermail notifyNewOrder), customer = {ok, skipped?, error?} ; null als mail uit staat.
  function mailNote(o) {
    const m = o.mail && o.mail.customer;
    if (!m) return '<p class="quiet" style="font-size:12px;text-align:center">' + K.t("Een bevestiging is gemaild als uw e-mailadres bij Famo bekend is.") + '</p>';
    if (m.ok) return '<p class="quiet" style="font-size:12px;text-align:center">' + K.t("Een bevestiging is gemaild naar") + ' ' + K.esc(o.email || "") + '</p>';
    if (m.skipped === "no-recipient") return K.c.warn(K.t("Geen bevestigingsmail: er is geen e-mailadres bij uw account. Voeg het toe via Account.") + ' <a href="#/account">' + K.t("Account") + '</a>');
    return K.c.warn(K.t("Geen bevestigingsmail ontvangen? De bestelling is wel goed geregistreerd. Bel Famo bij twijfel."));
  }
  function renderBevestigd() {
    const o = lastOrder;
    if (!o) { K.go("bestellingen"); return; }
    shell("bestellingen", '<div style="padding:50px 24px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px"><div style="width:72px;height:72px;border-radius:50%;background:var(--st-done-bg);display:grid;place-items:center">' + K.icon("check", "") + '</div><h1 class="h1">' + K.t("Bestelling ontvangen") + '</h1><p class="sub" style="white-space:normal;font-size:14px">' + K.t("Dank u wel. We zetten alles klaar voor") + ' <b>' + K.esc(K.dateLong(o.day)) + '</b>.</p><span class="tag mono">' + K.esc(o.ref) + '</span></div>' +
      '<div class="mlist" style="padding-top:0"><div class="mcard"><div class="tl"><div><i class="on"></i><div><b>' + K.t("Ontvangen") + '</b><small>' + K.esc(K.date(K.isoDay(new Date(o.at))) + " " + K.time(new Date(o.at).toISOString())) + '</small></div></div><div><i></i><div>' + K.t("Wordt klaargezet") + '<small>' + K.t("de dag vóór levering") + '</small></div></div><div><i></i><div>' + K.t("Onderweg") + '<small>' + K.esc(K.date(o.day)) + ' ' + K.t("ochtend") + '</small></div></div><div><i></i><div>' + K.t("Geleverd → leveringsbon en factuur bij uw bestellingen") + '</div></div></div></div>' +
      '<div class="mcard" style="display:flex;flex-direction:column;gap:6px;font-size:13px">' + o.items.map(i => '<div style="display:flex;justify-content:space-between;gap:10px"><span>' + K.esc(K.qty(i.qty) + "× " + i.nom) + '</span><span class="mono">' + K.eur(i.prix * i.qty) + '</span></div>').join("") + '<div style="display:flex;justify-content:space-between;font-weight:600;border-top:1px solid var(--line);padding-top:6px"><span>' + K.t("Totaal excl. btw") + '</span><span class="mono">' + K.eur(o.total) + '</span></div></div>' +
      mailNote(o) +
      '<a class="btn btn-p btn-block" href="#/bestellingen">' + K.t("Naar mijn bestellingen") + '</a><a class="btn btn-o btn-block" href="#/catalogus">' + K.t("Verder bestellen") + '</a></div>');
    const ic = app.querySelector(".ico"); if (ic) { ic.style.width = "34px"; ic.style.height = "34px"; ic.style.stroke = "var(--st-done)"; ic.style.strokeWidth = "2.2"; }
  }

  /* ---------- bestellingen ---------- */
  let ordFilter = "lopend";
  const unpaid = o => o.statut === "Facturée" && o.paiement !== "Payé";
  // Regels van een bestelling terug in de winkelmand (op naam : de referentie van het product staat niet in de regel).
  function linesToCart(o) {
    let n = 0;
    K.parseLines(o.lignes).forEach(l => { const p = (cat.products || []).find(x => x.nom.toLowerCase() === l.name.toLowerCase()); if (!p || !(l.qty > 0)) return; const qv = capQty(p, l.qty); if (qv > 0) { cart.items[p.id] = qv; if (l.comment) cart.comments[p.id] = l.comment; n++; } });
    saveCart(); return n;
  }
  function reorder(o) { const n = linesToCart(o); K.toast(n ? n + " " + K.t(n === 1 ? "artikel" : "artikelen") + " " + K.t("in de winkelmand gezet") : K.t("Deze artikelen staan niet meer in de catalogus"), { kind: n ? "" : "err" }); if (n) { closePanel(); K.go("winkelmand"); } }
  const cancelCall = ref => api("/api/klantorder", { json: Object.assign({}, creds(), { action: "cancel", ref }) });
  function closePanel() { if (panel) { panel.close(); panel = null; } }
  const btn = (attr, label, extra) => '<button type="button" class="btn ' + (extra || "btn-o") + ' btn-sm" style="flex:1' + (/cancel-order/.test(attr) ? ";color:var(--danger)" : "") + '" ' + attr + '>' + label + '</button>';
  // Knoppen per status : documenten (klantdoc), opnieuw bestellen (altijd), wijzigen en annuleren (enkel Reçue).
  function actions(o) {
    const r = ' data-ref="' + K.esc(o.ref) + '"';
    return (o.statut === "Facturée" ? btn('data-doc="invoice"' + r, K.t("Factuur")) + btn('data-doc="delivery"' + r, K.t("Leveringsbon")) : o.statut === "Sortie en livraison" ? btn('data-doc="delivery"' + r, K.t("Leveringsbon")) : "") +
      btn('data-reorder="' + K.esc(o.ref) + '"', K.t("Opnieuw bestellen")) +
      (o.statut === "Reçue" ? btn('data-edit-order="' + K.esc(o.ref) + '"', K.t("Wijzigen")) + btn('data-cancel-order="' + K.esc(o.ref) + '"', K.t("Annuleren"), "btn-ghost") : "");
  }
  const badge = o => o.statut === "Facturée" ? (o.paiement === "Payé" ? K.stCell("Facturée", K.t("Geleverd · betaald")) : '<span class="cell-st c-inv">' + K.t("Geleverd · openstaand") + '</span>') : K.isLate(o) ? '<span class="cell-st c-late">' + K.t("Te laat") + '</span>' : K.stCell(o.statut);
  const stamp = iso => iso ? K.dateLong(iso) + (String(iso).includes("T") ? " " + K.time(iso) : "") : "";
  function openOrder(ref) {
    const o = (orders || []).find(x => x.ref === ref); if (!o) return;
    closePanel();
    const cancelled = o.statut === K.CANCELLED, idx = K.STATUSES.indexOf(o.statut), lines = K.parseLines(o.lignes);
    const when = { "Reçue": o.date ? K.dateLong(o.date) : "", "Sortie en livraison": o.livreeLe ? stamp(o.livreeLe) + (o.receptionnePar ? " · " + o.receptionnePar : "") : (idx < 2 && o.dateLiv ? K.date(o.dateLiv) + " " + K.t("ochtend") : ""), "Facturée": o.factureeLe ? stamp(o.factureeLe) + (o.factuurnummer ? " · " + o.factuurnummer : "") : "" };
    const tl = cancelled
      ? '<div class="tl"><div><i class="on"></i><div><b>' + K.t("Ontvangen") + '</b><small>' + K.esc(when["Reçue"]) + '</small></div></div><div><i class="on" style="background:var(--danger)"></i><div><b>' + K.t("Geannuleerd") + '</b><small>' + K.esc([stamp(o.annuleeLe), o.motifAnnulation ? K.t("Reden") + ": " + K.t(o.motifAnnulation) : ""].filter(Boolean).join(" · ")) + '</small></div></div></div>'
      : '<div class="tl">' + K.STATUSES.map((st, i) => '<div><i' + (i <= idx ? ' class="on"' : "") + '></i><div>' + (i <= idx ? '<b>' + K.esc(K.status(st)) + '</b>' : K.esc(K.status(st))) + (when[st] ? '<small>' + K.esc(when[st]) + '</small>' : "") + '</div></div>').join("") + '</div>';
    const row = (label, value) => value ? '<div class="row"><div>' + K.esc(label) + '<small style="white-space:pre-line">' + K.esc(value) + '</small></div></div>' : "";
    const body = '<div class="mcard" style="margin-bottom:10px">' + tl + '</div>' +
      (o.uitzondering ? K.c.warn('<b>' + K.t("Uitzondering levering") + '</b> ' + K.esc(o.uitzondering)) + '<div style="height:10px"></div>' : "") +
      '<div class="mcard" style="margin-bottom:10px"><div class="sec" style="margin:0 0 6px">' + K.t("Artikelen") + '</div><div style="display:flex;flex-direction:column;gap:6px;font-size:13px">' + lines.map(l => '<div style="display:flex;justify-content:space-between;gap:10px"><span>' + K.esc(K.qty(l.qty) + "× " + l.name + (l.unit ? " · " + K.unit(l.unit) : "") + (l.comment ? " (" + l.comment + ")" : "")) + '</span>' + (l.price != null ? '<span class="mono">' + K.eur(l.price * l.qty) + '</span>' : "") + '</div>').join("") + '<div style="display:flex;justify-content:space-between;font-weight:600;border-top:1px solid var(--line);padding-top:6px"><span>' + K.t("Totaal excl. btw") + '</span><span class="mono">' + K.eur(o.total) + '</span></div></div></div>' +
      '<div class="mcard">' + row(K.t("Besteld op"), o.date ? K.dateLong(o.date) : "") + row(K.t("Gewenste leverdag"), o.dateLiv ? K.dateLong(o.dateLiv) : "") +
      row(K.t("Factuurnummer"), o.factuurnummer) + row(K.t("Gefactureerd op"), stamp(o.factureeLe)) + row(K.t("Geleverd op"), stamp(o.livreeLe)) + row(K.t("Ontvangen door"), o.receptionnePar) +
      (o.paiement === "Payé" ? row(K.t("Betaald op"), stamp(o.payeLe) || K.t("Betaald")) : "") +
      (o.creditnota ? row(K.t("Creditnota"), [o.creditnota.nummer, K.eur(o.creditnota.montant), stamp(o.creditnota.le)].filter(Boolean).join(" · ")) : "") +
      row(K.t("Uw opmerking"), o.notes) + '</div>';
    panel = K.panel({ title: K.t("Bestelling") + " " + o.ref, sub: (o.dateLiv ? K.t("Levering") + " " + K.date(o.dateLiv) + " · " : "") + K.eur(o.total) + " " + K.t("excl. btw"), body, footer: '<div style="display:flex;gap:8px;flex-wrap:wrap;width:100%">' + actions(o) + '</div>', onClose: () => { panel = null; } });
    const st = panel.el.querySelector(".panel-h .h2"); if (st) st.insertAdjacentHTML("afterend", '<div style="margin-top:6px">' + badge(o) + '</div>');
    bindOrderActions(panel.el);
  }
  // Zelfde knoppen op de kaart en in het paneel : één binding per host.
  function bindOrderActions(root) {
    K.on(root, "click", "[data-open]", (e, t) => { if (e.target.closest("button,a")) return; openOrder(t.dataset.open); });
    K.on(root, "keydown", "[data-open]", (e, t) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openOrder(t.dataset.open); } });
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
    K.on(root, "click", "[data-doc]", async (e, t) => { K.busy(t, true, K.t("Laden…")); try { const d = await api("/api/klantdoc", { json: Object.assign({}, creds(), { ref: t.dataset.ref }) }); FamoDocuments.setCompany(d.config); const type = t.dataset.doc; const html = FamoDocuments.build(d.order, type); famoDocPreview.open({ html, filename: FamoDocuments.filename(d.order, type), title: type === "invoice" ? K.t("Factuur") + " " + (d.order.factuurnummer || "") : K.t("Leveringsbon") + " " + d.order.ref, meta: K.eur(d.order.total) + " " + K.t("excl. btw") }); } catch (err) { K.toast(err.message, { kind: "err" }); } finally { K.busy(t, false); } });
    K.on(root, "click", "[data-reorder]", (e, t) => { const o = (orders || []).find(x => x.ref === t.dataset.reorder); if (o) reorder(o); });
    K.on(root, "click", "[data-copy]", async (e, t) => { try { await navigator.clipboard.writeText(t.dataset.copy); K.toast(K.t("Gekopieerd")); } catch (err) { K.toast(K.t("Kopiëren lukt niet op dit toestel."), { kind: "err" }); } });
  }
  // Openstaande facturen : gefactureerd en niet betaald, met IBAN/BIC van het bedrijf en het factuurnummer als mededeling.
  function statement(list) {
    const co = cat.company || {}, sum = list.reduce((s, o) => s + Number(o.total || 0), 0);
    const bank = [co.iban ? "IBAN " + co.iban : "", co.bic ? "BIC " + co.bic : ""].filter(Boolean).join(" · ");
    const payText = o => [co.bedrijfsnaam || "FAMO Seafood", co.iban ? "IBAN " + co.iban : "", co.bic ? "BIC " + co.bic : "", K.eur(o.total) + " " + K.t("excl. btw"), K.t("Mededeling") + ": " + (o.factuurnummer || o.ref)].filter(Boolean).join(" · ");
    return '<div class="mcard" style="display:flex;flex-direction:column;gap:8px;background:var(--p-soft);border-color:var(--p-soft)"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b>' + K.t("Openstaande facturen") + '</b><span style="font-size:12.5px">' + K.t("Totaal openstaand") + ' <b class="mono">' + K.eur(sum) + '</b> ' + K.t("excl. btw") + '</span></div>' +
      list.map(o => '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px"><div style="min-width:0"><b class="mono">' + K.esc(o.factuurnummer || o.ref) + '</b><div class="quiet" style="font-size:12px">' + K.esc(K.date(o.factureeLe || o.date)) + ' · ' + K.t("Mededeling") + ': ' + K.esc(o.factuurnummer || o.ref) + '</div></div><span class="mono">' + K.eur(o.total) + '</span><button type="button" class="btn btn-o btn-sm" data-copy="' + K.esc(payText(o)) + '">' + K.t("Kopiëren") + '</button></div>').join("") +
      (bank ? '<div class="quiet" style="font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>' + K.t("Betaalgegevens") + ': <span class="mono">' + K.esc(bank) + '</span></span><button type="button" class="btn btn-ghost btn-sm" data-copy="' + K.esc(co.iban) + '">' + K.t("Kopiëren") + '</button></div>' : "") + '</div>';
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
    const card = o => { const cancelled = o.statut === K.CANCELLED; return '<div class="mcard" style="display:flex;flex-direction:column;gap:6px' + (cancelled ? ";opacity:.75" : "") + '"><div data-open="' + K.esc(o.ref) + '" role="button" tabindex="0" style="display:flex;flex-direction:column;gap:6px;cursor:pointer"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>' + K.esc(o.dateLiv ? K.t("Levering") + " " + K.date(o.dateLiv) : K.date(o.date)) + '</b>' + badge(o) + '</div><div class="muted" style="font-size:12.5px;white-space:normal">' + K.esc(K.linesSummary(o.lignes)) + '</div><div style="display:flex;justify-content:space-between;align-items:center"><span class="mono quiet" style="font-size:11px">' + K.esc(o.ref) + (o.factuurnummer ? " · " + K.esc(o.factuurnummer) : "") + '</span><span style="display:flex;align-items:center;gap:8px"><b class="mono">' + K.eur(o.total) + '</b><span class="quiet" style="font-size:12px;display:inline-flex;align-items:center">' + K.t("Details") + K.icon("chev") + '</span></span></div></div><div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">' + actions(o) + '</div>' + (o.statut === "Prête" ? '<div class="quiet" style="font-size:12px">' + K.t("Wordt klaargezet · wijzigen of annuleren: bel Famo.") + '</div>' : "") + '</div>'; };
    const empty = ordFilter === "lopend" ? K.c.empty(K.t("Geen lopende bestellingen"), K.tt("Bestel vóór {t} voor levering morgen.", { t: deadline() }), '<a class="btn btn-p btn-sm" href="#/catalogus" style="margin-top:6px">' + K.t("Naar de catalogus") + '</a>') : ordFilter === "tebetalen" ? K.c.empty(K.t("Geen openstaande facturen"), K.t("Alles is betaald. Dank u wel.")) : K.c.empty(K.t("Niets in deze lijst"));
    shell("bestellingen", '<div class="mlist">' + (ordFilter === "tebetalen" && list.length ? statement(list) : "") + (list.length ? list.map(card).join("") : empty) + '</div>', topbar(K.t("Mijn bestellingen"), cat.client.nom).slice(0, -6) + chips + "</div>");
    K.on(app, "click", "[data-of]", (e, t) => { ordFilter = t.dataset.of; renderOrderList(); });
    bindOrderActions(app);
  }

  /* ---------- favorieten / standaard ---------- */
  function renderFavorieten() {
    const favList = (cat.products || []).filter(p => favs[p.id]);
    const stdList = std ? Object.entries(std).map(([id, qv]) => ({ p: byId(id), qty: qv })).filter(x => x.p) : [];
    const stdTotal = stdList.reduce((s, x) => s + x.p.prix * x.qty, 0);
    const body = '<div class="mcard" style="background:var(--p-soft);border-color:var(--p-soft)"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b>' + K.t("Mijn standaardbestelling") + '</b><div class="quiet" style="font-size:12px">' + (stdList.length ? stdList.length + " " + K.t("artikelen") + " · " + K.eur(stdTotal) : K.t("Nog niet ingesteld")) + '</div></div></div>' +
      (stdList.length ? '<div style="margin-top:8px;font-size:12.5px;color:var(--ink-2)">' + stdList.map(x => K.qty(x.qty) + "× " + K.esc(x.p.nom)).join(" · ") + '</div><div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn btn-p btn-sm" style="flex:1" id="stdToCart">' + K.t("In winkelmand zetten") + '</button><button type="button" class="btn btn-o btn-sm" id="stdSave">' + K.t("Vervang door winkelmand") + '</button></div>' : '<div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn btn-p btn-sm" style="flex:1" id="stdSave">' + K.t("Huidige winkelmand opslaan als standaard") + '</button></div>') + '</div>' +
      '<div class="sec">' + K.t("Favorieten") + '</div>' + (favList.length ? '<div class="mcard">' + favList.map(p => '<div class="li"><div class="n"><b>' + K.esc(p.nom) + '</b><div class="quiet" style="font-size:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span>' + K.esc((p.kaliber ? p.kaliber + " · " : "") + unitLabel(p)) + ' · ' + K.eur(p.prix) + '</span>' + stockTag(p) + '</div></div>' + K.c.stepper(p.id, cart.items[p.id] || 0, { step: isKg(p) ? 0.5 : 1 }) + '<button type="button" class="ibtn fav on" data-fav="' + p.id + '" aria-label="' + K.t("Uit favorieten") + '">' + K.icon("star") + '</button></div>').join("") + '</div>' : K.c.empty(K.t("Nog geen favorieten"), K.t("Tik op de ster bij een product in de catalogus.")));
    shell("favorieten", '<div class="mlist">' + body + '</div>', topbar(K.t("Favorieten"), K.t("Snel opnieuw bestellen")));
    bindSteppers(app);
    K.on(app, "click", "[data-fav]", (e, t) => { setFav(t.dataset.fav, false); renderFavorieten(); });
    const s = document.getElementById("stdSave"); if (s) s.onclick = () => { const items = Object.fromEntries(Object.entries(cart.items).filter(([id, qv]) => byId(id) && Number(qv) > 0)); if (!Object.keys(items).length) { K.toast(K.t("Zet eerst artikelen in de winkelmand."), { kind: "err" }); return; } setStd(items); K.toast(K.t("Standaardbestelling opgeslagen")); renderFavorieten(); };
    const c2 = document.getElementById("stdToCart"); if (c2) c2.onclick = () => { Object.entries(std).forEach(([id, qv]) => { const p = byId(id); if (p) { const v = capQty(p, Number(qv)); if (v > 0) cart.items[id] = v; } }); saveCart(); K.go("winkelmand"); };
  }

  /* ---------- account ---------- */
  // Le mot de passe actuel est vérifié par le serveur, jamais ici : le navigateur ne fait
  // que les contrôles de confort (champs remplis, longueur, confirmation identique).
  function openPasswordPanel() {
    const p = K.panel({ title: K.t("Wachtwoord wijzigen"), sub: K.t("Ter bevestiging vragen we uw huidige wachtwoord."), body:
      '<form id="pwForm" novalidate style="display:flex;flex-direction:column;gap:14px">' +
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
        await K.api("/api/klantwachtwoord", { json: { user: sess.user, pw: huidig, nieuw } });
        // Les appels suivants renvoient le mot de passe : sans cette mise à jour ils échoueraient en 401.
        sess.pw = nieuw; K.klant.set(Object.assign({}, K.klant.get() || sess, { pw: nieuw }));
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
      '<form id="prForm" novalidate style="display:flex;flex-direction:column;gap:14px">' +
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
    const body = '<div class="mcard"><div class="row"><div>' + K.t("Zaak") + '<small>' + K.esc(cl.nom || "") + '</small></div></div><div class="row"><div>' + K.t("Leveradres") + '<small style="white-space:pre-line">' + K.esc(cl.adresse || "—") + '</small></div></div>' + (cl.klantnr ? '<div class="row"><div>' + K.t("Klantnummer") + '<small class="mono">' + K.esc(cl.klantnr) + '</small></div></div>' : "") + (cl.btw ? '<div class="row"><div>' + K.t("Btw-nummer") + '<small class="mono">' + K.esc(cl.btw) + '</small></div></div>' : "") + '<div class="row"><div>' + K.t("Gebruikersnaam") + '<small>' + K.esc(sess.user) + '</small></div></div><div class="row"><div>' + K.t("Taal") + '<small>' + K.t("Nederlands of Frans, voor dit toestel") + '</small></div>' + K.langSwitch() + '</div></div>' +
      '<div class="mcard"><div class="row"><div>' + K.t("E-mail") + '<small>' + K.esc(cl.email || "—") + '</small></div><button type="button" class="btn btn-o btn-sm" data-profile>' + K.t("Wijzigen") + '</button></div><div class="row"><div>' + K.t("Telefoon") + '<small>' + K.esc(cl.tel || "—") + '</small></div><button type="button" class="btn btn-o btn-sm" data-profile>' + K.t("Wijzigen") + '</button></div></div>' +
      '<div class="mcard"><div class="row"><div>' + K.t("Documenten") + '<small>' + K.t("Leveringsbonnen en facturen per bestelling") + '</small></div><a href="#/bestellingen" class="btn btn-o btn-sm" data-goto="geleverd">' + K.t("Openen") + '</a></div></div><div class="mcard"><div class="row"><div>' + K.t("Gegevens wijzigen") + '<small>' + K.t("Leveradres wijzigen: bel of mail Famo") + '</small></div></div><div class="row"><div>' + K.t("Wachtwoord") + '<small>' + K.t("Wijzig uw wachtwoord zelf, met uw huidige wachtwoord") + '</small></div><button type="button" class="btn btn-o btn-sm" id="pwChange">' + K.t("Wijzigen") + '</button></div></div>' +
      '<div class="mcard"><b>' + K.esc(co.bedrijfsnaam || "FAMO Seafood") + '</b><div class="quiet" style="font-size:12.5px;margin-top:4px">' + K.esc([co.adres, co.plaats].filter(Boolean).join(", ")) + '</div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' + (co.telefoon ? '<a class="btn btn-o btn-sm" href="tel:' + K.esc(co.telefoon.replace(/\s+/g, "")) + '">' + K.icon("phone") + K.esc(co.telefoon) + '</a>' : "") + (co.email ? '<a class="btn btn-o btn-sm" href="mailto:' + K.esc(co.email) + '">' + K.esc(co.email) + '</a>' : "") + '</div></div>' +
      '<button type="button" class="btn btn-o btn-block" id="logout" style="color:var(--danger)">' + K.t("Uitloggen") + '</button>';
    shell("account", '<div class="mlist">' + body + '</div>', topbar(K.t("Account"), cl.nom || ""));
    K.on(app, "click", "[data-goto]", () => { ordFilter = "geleverd"; });
    K.on(app, "click", "[data-profile]", openProfilePanel);
    document.getElementById("pwChange").onclick = openPasswordPanel;
    document.getElementById("logout").onclick = async () => { if (await K.confirm({ title: K.t("Uitloggen?"), text: K.t("Uw winkelmand blijft bewaard op dit toestel."), yes: K.t("Uitloggen") })) { K.klant.clear(); K.session.del(CAT_KEY); location.href = "/?uit=1"; } };
  }

  /* ---------- router ---------- */
  function route() {
    if (cat) return render();
    // Eerste lading : skelet, en bij een fout « Opnieuw proberen » (K.retryBox) dat de lading én de weergave herhaalt.
    app.innerHTML = '<div class="kwrap" style="padding:20px" id="boot"></div>';
    return K.retryBox("boot", async () => { document.getElementById("boot").innerHTML = K.c.skeleton(3); await loadCatalogue(); render(); });
  }
  function render() {
    const { path } = K.hashParams();
    closePanel();
    window.scrollTo(0, 0);
    switch (path) {
      case "winkelmand": return renderWinkelmand();
      case "bevestigd": return renderBevestigd();
      case "bestellingen": return renderBestellingen();
      case "favorieten": return renderFavorieten();
      case "account": return renderAccount();
      default: if (path !== "catalogus") { location.hash = "#/catalogus"; return; } return renderCatalogus();
    }
  }
  window.addEventListener("hashchange", route);
  route();
})();
