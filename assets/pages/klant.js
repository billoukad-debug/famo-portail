(function () {
  const sess = K.klant.get();
  if (!sess || !sess.user) { location.replace("/"); return; }
  const app = document.getElementById("app");
  const FAV_KEY = "famoFav:" + sess.user, CART_KEY = "famoCart:" + sess.user, STD_KEY = "famoStd:" + sess.user, CAT_KEY = "famoKlantCatalogus";
  let cat = null; // {products, client, company}
  let cart = K.store.get(CART_KEY, { items: {}, comments: {}, note: "", day: "" });
  let favs = K.store.get(FAV_KEY, {});
  let std = K.store.get(STD_KEY, null); // {productId: qty}
  let orders = null, lastOrder = K.session.get("famoLastOrder", null);
  const saveCart = () => K.store.set(CART_KEY, cart);
  const byId = id => (cat.products || []).find(p => p.id === id);
  const cartCount = () => Object.values(cart.items).reduce((a, b) => a + (Number(b) > 0 ? 1 : 0), 0);
  const cartTotal = () => Object.entries(cart.items).reduce((s, [id, q]) => { const p = byId(id); return s + (p ? p.prix * Number(q) : 0); }, 0);
  const isKg = p => /kg/i.test(p.unite || "");
  const unitLabel = p => K.unit(p.unite);
  const nextDays = () => { const out = []; let d = K.addDays(K.today(), 1); while (out.length < 6) { const dt = K.parseDate(d); if (dt.getDay() !== 0) out.push(d); d = K.addDays(d, 1); } return out; };

  function shell(active, inner, top) {
    app.innerHTML = '<div class="kwrap">' + (top || "") + inner + K.klantTabs(active) + '</div>';
  }
  function topbar(title, sub, right) {
    return '<div class="mtop"><div class="mrow"><span class="logo">F</span><div style="min-width:0;flex:1"><b style="display:block;font-size:15px">' + K.esc(title) + '</b><span class="quiet" style="font-size:12px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(sub || "") + '</span></div>' + (right || "") + '</div></div>';
  }
  function fail(err, retry) { app.innerHTML = '<div class="kwrap" style="padding:20px">' + K.c.error(err.message || String(err), !!retry) + '</div>'; if (retry) K.on(app, "click", "[data-retry]", e => { e.preventDefault(); retry(); }); }

  async function loadCatalogue(force) {
    const cached = K.session.get(CAT_KEY, null);
    if (!force && cached && Date.now() - cached.at < 10 * 60 * 1000) { cat = cached; return cat; }
    const d = await K.api("/api/catalogue", { json: K.klant.creds() });
    cat = { at: Date.now(), products: d.products || [], client: d.client, company: d.company };
    K.session.set(CAT_KEY, cat);
    K.klant.set(Object.assign({}, sess, { client: d.client, company: d.company }));
    return cat;
  }
  async function loadOrders(force) {
    if (orders && !force) return orders;
    const d = await K.api("/api/orders", { json: K.klant.creds() });
    orders = d.orders || [];
    return orders;
  }

  /* ---------- catalogus ---------- */
  let q = "", catFilter = "Alles";
  function productCard(p) {
    const qty = Number(cart.items[p.id] || 0), neg = p.prix < p.base;
    return '<div class="prod' + (qty > 0 ? " on" : "") + '" data-id="' + p.id + '"><div class="ph">' + (p.foto ? '<img src="' + K.esc(p.foto) + '" alt="" loading="lazy">' : K.icon("fish")) + '</div>' +
      '<div class="pi"><div class="pn">' + K.esc(p.nom) + '</div><div style="display:flex;gap:6px;align-items:center;margin-top:2px;flex-wrap:wrap">' + (p.kaliber ? '<span class="tag">' + K.esc(p.kaliber) + '</span>' : "") + '<span class="tag">' + K.esc(unitLabel(p)) + '</span><button type="button" class="ibtn fav' + (favs[p.id] ? " on" : "") + '" data-fav="' + p.id + '" aria-label="Favoriet" style="width:32px;height:32px">' + K.icon("star") + '</button></div>' +
      '<div class="pp" style="margin-top:4px"><b class="mono">' + K.eur(p.prix) + '</b>' + (neg ? '<s class="mono">' + K.eur(p.base) + '</s><small>uw prijs</small>' : '<small>/ ' + K.esc(unitLabel(p)) + '</small>') + '</div></div>' +
      K.c.stepper(p.id, qty, { step: isKg(p) ? 0.5 : 1 }) + '</div>';
  }
  function renderCatalogus() {
    const products = (cat.products || []).filter(p => (!q || (p.nom + " " + (p.kaliber || "") + " " + (p.cat || "")).toLowerCase().includes(q)) && (catFilter === "Alles" || (catFilter === "Favorieten" ? favs[p.id] : (p.cat || "Algemeen") === catFilter)));
    const cats = ["Alles", "Favorieten", ...Array.from(new Set((cat.products || []).map(p => p.cat || "Algemeen")))];
    const groups = {}; products.forEach(p => { const g = catFilter === "Favorieten" ? "Favorieten" : (favs[p.id] && catFilter === "Alles" && !q ? "Favorieten" : (p.cat || "Algemeen")); (groups[g] = groups[g] || []).push(p); });
    const order = Object.keys(groups).sort((a, b) => (a === "Favorieten" ? -1 : b === "Favorieten" ? 1 : a.localeCompare(b, "nl")));
    const top = '<div class="mtop"><div class="mrow"><span class="logo">F</span><div style="min-width:0;flex:1"><b style="display:block;font-size:15px">Catalogus</b><span class="quiet" style="font-size:12px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(cat.client.nom) + ' · bestel vóór 22:00 voor morgen</span></div>' + K.c.avatar(cat.client.nom) + '</div>' +
      '<label class="search" style="max-width:none">' + K.icon("search") + '<input id="q" placeholder="Zoek een product…" value="' + K.esc(q) + '" autocomplete="off"></label>' +
      '<div class="cats">' + cats.map(c => '<button type="button" data-cat="' + K.esc(c) + '"' + (c === catFilter ? ' class="on"' : "") + '>' + K.esc(c) + '</button>').join("") + '</div></div>';
    const list = products.length ? order.map(g => '<div class="sec">' + K.esc(g) + '</div>' + groups[g].map(productCard).join("")).join("") : K.c.empty(q ? "Niets gevonden voor „" + q + "”" : "Nog geen favorieten", q ? "Probeer een ander woord of kies een categorie." : "Tik op de ster bij een product om het hier te zien.");
    const n = cartCount();
    shell("catalogus", '<div class="mlist" id="list">' + list + '</div>' + (n ? '<div class="cartbar"><div><div style="font-size:11px;opacity:.75">' + n + ' artikel' + (n === 1 ? "" : "en") + ' · excl. btw</div><div class="mono" style="font-size:17px;font-weight:600">' + K.eur(cartTotal()) + '</div></div><a class="btn" href="#/winkelmand" style="background:#fff;color:var(--ink)">Bestellen</a></div>' : ""), top);
    const qi = document.getElementById("q"); qi.addEventListener("input", () => { q = qi.value.trim().toLowerCase(); const pos = qi.selectionStart; renderCatalogus(); const n2 = document.getElementById("q"); n2.focus(); n2.setSelectionRange(pos, pos); });
    K.on(app, "click", "[data-cat]", (e, t) => { catFilter = t.dataset.cat; renderCatalogus(); });
    K.on(app, "click", "[data-fav]", (e, t) => { const id = t.dataset.fav; if (favs[id]) delete favs[id]; else favs[id] = true; K.store.set(FAV_KEY, favs); t.classList.toggle("on", !!favs[id]); });
    bindSteppers(app, () => { renderCatalogus(); });
  }
  function bindSteppers(root, after) {
    K.$$(".stepper", root).forEach(st => {
      const id = st.dataset.stepper, inp = st.querySelector("input"), p = byId(id); if (!p) return;
      const step = isKg(p) ? 0.5 : 1;
      const set = v => { v = Math.max(0, Math.round(v * 1000) / 1000); if (!isKg(p)) v = Math.round(v); if (v > 0) cart.items[id] = v; else { delete cart.items[id]; delete cart.comments[id]; } saveCart(); inp.value = v; st.classList.toggle("on", v > 0); if (after) after(id, v); };
      st.querySelector("[data-dec]").onclick = () => set(Number(inp.value) - step);
      st.querySelector("[data-inc]").onclick = () => set(Number(inp.value) + step);
      inp.addEventListener("change", () => set(Number(String(inp.value).replace(",", ".")) || 0));
    });
  }

  /* ---------- winkelmand ---------- */
  function renderWinkelmand() {
    const ids = Object.keys(cart.items).filter(id => byId(id) && Number(cart.items[id]) > 0);
    const days = nextDays(); if (!cart.day || !days.includes(cart.day)) { cart.day = days[0]; saveCart(); }
    const total = cartTotal();
    const body = ids.length ? '<div class="mcard">' + ids.map(id => { const p = byId(id); return '<div class="li"><div class="n"><b>' + K.esc(p.nom) + '</b><div class="quiet" style="font-size:12px">' + K.esc((p.kaliber ? p.kaliber + " · " : "") + unitLabel(p)) + ' · ' + K.eur(p.prix) + '</div></div>' + K.c.stepper(p.id, cart.items[id], { step: isKg(p) ? 0.5 : 1 }) + '<b class="mono t">' + K.eur(p.prix * cart.items[id]) + '</b><input class="input c" style="min-height:38px;font-size:12px" placeholder="Opmerking (bv. dikke moot)" data-comment="' + p.id + '" value="' + K.esc(cart.comments[id] || "") + '" maxlength="120"></div>'; }).join("") + '</div>' +
      '<div class="mcard" style="display:flex;flex-direction:column;gap:10px"><div class="field"><label>Leverdag</label><div class="opt">' + days.map(d => '<button type="button" data-day="' + d + '"' + (d === cart.day ? ' class="on"' : "") + '>' + K.esc(K.date(d)) + '</button>').join("") + '</div></div>' +
      '<div class="field"><label>Leveradres</label><div class="input" style="display:flex;align-items:center;white-space:pre-line;min-height:44px;padding:8px 12px;font-size:13px">' + K.esc(cat.client.adresse || "Adres bij Famo bekend") + '</div><span class="quiet" style="font-size:12px">Ander adres? Zet het in de opmerking.</span></div>' +
      '<div class="field"><label>Opmerking voor Famo</label><textarea class="input" id="note" rows="2" placeholder="bv. graag achteraan bellen">' + K.esc(cart.note || "") + '</textarea></div></div>' +
      '<div class="mcard" style="display:flex;flex-direction:column;gap:6px;font-size:13px"><div style="display:flex;justify-content:space-between"><span>Totaal excl. btw</span><b class="mono">' + K.eur(total) + '</b></div><div class="quiet" style="font-size:12px">De btw wordt op de factuur toegevoegd. Levering gratis · bestel vóór 22:00 voor levering morgen.</div></div>' +
      '<div id="orderErr"></div>' +
      '<button type="button" class="btn btn-p btn-block" id="placeOrder" style="min-height:50px;font-size:15px">Bestelling plaatsen · ' + K.eur(total) + '</button>'
      : K.c.empty("Uw winkelmand is leeg", "Kies producten in de catalogus.", '<a class="btn btn-p btn-sm" href="#/catalogus" style="margin-top:6px">Naar de catalogus</a>');
    shell("catalogus", '<div class="mlist">' + body + '</div>', '<div class="mtop"><div class="mrow"><a href="#/catalogus" style="font-size:13px">' + K.icon("back") + ' Catalogus</a><span class="spacer"></span><b style="font-size:16px">Winkelmand</b><span class="spacer"></span>' + (ids.length ? '<button type="button" class="btn btn-ghost btn-sm" id="clearCart">Leegmaken</button>' : "") + '</div></div>');
    bindSteppers(app, () => renderWinkelmand());
    K.on(app, "click", "[data-day]", (e, t) => { cart.day = t.dataset.day; saveCart(); K.$$("[data-day]", app).forEach(b => b.classList.toggle("on", b === t)); });
    K.on(app, "input", "[data-comment]", (e, t) => { cart.comments[t.dataset.comment] = t.value; saveCart(); });
    const note = document.getElementById("note"); if (note) note.addEventListener("input", () => { cart.note = note.value; saveCart(); });
    const clear = document.getElementById("clearCart"); if (clear) clear.onclick = async () => { if (await K.confirm({ title: "Winkelmand leegmaken?", text: "Alle artikelen worden verwijderd.", yes: "Leegmaken", danger: true })) { cart.items = {}; cart.comments = {}; saveCart(); renderWinkelmand(); } };
    const place = document.getElementById("placeOrder"); if (place) place.onclick = placeOrder;
  }
  async function placeOrder() {
    const btn = document.getElementById("placeOrder");
    const items = Object.entries(cart.items).filter(([id, qv]) => byId(id) && Number(qv) > 0).map(([id, qv]) => ({ productId: id, quantity: Number(qv), comment: cart.comments[id] || "" }));
    if (!items.length) return;
    K.busy(btn, true, "Bestelling versturen…"); document.getElementById("orderErr").innerHTML = "";
    try {
      const d = await K.api("/api/order", { json: Object.assign({}, K.klant.creds(), { items, notes: cart.note || "", dateLivraison: cart.day }) });
      lastOrder = { ref: d.ref, total: d.total, day: cart.day, items: items.map(i => ({ nom: byId(i.productId).nom, qty: i.quantity, prix: byId(i.productId).prix })), at: Date.now(), mail: d.mail };
      K.session.set("famoLastOrder", lastOrder);
      cart = { items: {}, comments: {}, note: "", day: "" }; saveCart(); orders = null;
      K.go("bevestigd");
    } catch (err) {
      document.getElementById("orderErr").innerHTML = K.c.error(err.status === 401 ? "Uw sessie is verlopen. Meld u opnieuw aan." : err.message);
      if (err.status === 401) { K.klant.clear(); setTimeout(() => location.replace("/"), 1500); }
      K.busy(btn, false);
    }
  }
  function renderBevestigd() {
    const o = lastOrder;
    if (!o) { K.go("bestellingen"); return; }
    shell("bestellingen", '<div style="padding:50px 24px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px"><div style="width:72px;height:72px;border-radius:50%;background:var(--st-done-bg);display:grid;place-items:center">' + K.icon("check", "") + '</div><h1 class="h1">Bestelling ontvangen</h1><p class="sub" style="white-space:normal;font-size:14px">Dank u wel. We zetten alles klaar voor <b>' + K.esc(K.dateLong(o.day)) + '</b>.</p><span class="tag mono">' + K.esc(o.ref) + '</span></div>' +
      '<div class="mlist" style="padding-top:0"><div class="mcard"><div class="tl"><div><i class="on"></i><div><b>Ontvangen</b><small>' + K.esc(K.date(K.isoDay(new Date(o.at))) + " " + K.time(new Date(o.at).toISOString())) + '</small></div></div><div><i></i><div>Wordt klaargezet<small>de dag vóór levering</small></div></div><div><i></i><div>Onderweg<small>' + K.esc(K.date(o.day)) + ' ochtend</small></div></div><div><i></i><div>Geleverd → leveringsbon en factuur bij uw bestellingen</div></div></div></div>' +
      '<div class="mcard" style="display:flex;flex-direction:column;gap:6px;font-size:13px">' + o.items.map(i => '<div style="display:flex;justify-content:space-between;gap:10px"><span>' + K.esc(K.qty(i.qty) + "× " + i.nom) + '</span><span class="mono">' + K.eur(i.prix * i.qty) + '</span></div>').join("") + '<div style="display:flex;justify-content:space-between;font-weight:600;border-top:1px solid var(--line);padding-top:6px"><span>Totaal excl. btw</span><span class="mono">' + K.eur(o.total) + '</span></div></div>' +
      (o.mail && o.mail.klant === false ? K.c.warn("Geen bevestigingsmail: er is geen e-mailadres bij uw account. Vraag Famo om het toe te voegen.") : '<p class="quiet" style="font-size:12px;text-align:center">Een bevestiging is gemaild als uw e-mailadres bij Famo bekend is.</p>') +
      '<a class="btn btn-p btn-block" href="#/bestellingen">Naar mijn bestellingen</a><a class="btn btn-o btn-block" href="#/catalogus">Verder bestellen</a></div>');
    const ic = app.querySelector(".ico"); if (ic) { ic.style.width = "34px"; ic.style.height = "34px"; ic.style.stroke = "var(--st-done)"; ic.style.strokeWidth = "2.2"; }
  }

  /* ---------- bestellingen ---------- */
  let ordFilter = "lopend";
  async function renderBestellingen() {
    shell("bestellingen", '<div class="mlist">' + K.c.skeleton(3) + '</div>', topbar("Mijn bestellingen", cat.client.nom));
    try { await loadOrders(); } catch (err) { shell("bestellingen", '<div class="mlist">' + K.c.error(err.message, true) + '</div>', topbar("Mijn bestellingen", cat.client.nom)); K.on(app, "click", "[data-retry]", e => { e.preventDefault(); orders = null; renderBestellingen(); }); return; }
    const open = o => o.statut !== "Facturée", unpaid = o => o.statut === "Facturée" && o.paiement !== "Payé";
    const list = orders.filter(o => ordFilter === "lopend" ? open(o) : ordFilter === "geleverd" ? !open(o) : ordFilter === "tebetalen" ? unpaid(o) : true);
    const nUnpaid = orders.filter(unpaid).length;
    const chips = '<div class="cats">' + [["lopend", "Lopend"], ["geleverd", "Geleverd · documenten"], ["tebetalen", "Te betalen" + (nUnpaid ? " · " + nUnpaid : "")], ["alles", "Alles"]].map(([k, l]) => '<button type="button" data-of="' + k + '"' + (k === ordFilter ? ' class="on"' : "") + '>' + l + '</button>').join("") + '</div>';
    const card = o => { const late = K.isLate(o); return '<div class="mcard" style="display:flex;flex-direction:column;gap:6px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>' + K.esc(o.dateLiv ? "Levering " + K.date(o.dateLiv) : K.date(o.date)) + '</b>' + (o.statut === "Facturée" ? (o.paiement === "Payé" ? K.stCell("Facturée", "Geleverd · betaald") : '<span class="cell-st c-inv">Geleverd · open</span>') : K.stCell(o.statut, late ? "Vertraagd" : undefined)) + '</div><div class="muted" style="font-size:12.5px;white-space:normal">' + K.esc(K.linesSummary(o.lignes)) + '</div><div style="display:flex;justify-content:space-between;align-items:center"><span class="mono quiet" style="font-size:11px">' + K.esc(o.ref) + '</span><b class="mono">' + K.eur(o.total) + '</b></div><div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">' + (o.statut === "Facturée" ? '<button type="button" class="btn btn-o btn-sm" style="flex:1" data-doc="invoice" data-ref="' + K.esc(o.ref) + '">Factuur</button><button type="button" class="btn btn-o btn-sm" style="flex:1" data-doc="delivery" data-ref="' + K.esc(o.ref) + '">Leveringsbon</button>' : (o.statut === "Sortie en livraison" ? '<button type="button" class="btn btn-o btn-sm" style="flex:1" data-doc="delivery" data-ref="' + K.esc(o.ref) + '">Leveringsbon</button>' : "")) + '<button type="button" class="btn btn-o btn-sm" style="flex:1" data-reorder="' + K.esc(o.ref) + '">Opnieuw bestellen</button></div></div>'; };
    shell("bestellingen", '<div class="mlist">' + (list.length ? list.map(card).join("") : K.c.empty(ordFilter === "lopend" ? "Geen lopende bestellingen" : "Niets in deze lijst", ordFilter === "lopend" ? "Bestel vóór 22:00 voor levering morgen." : "", ordFilter === "lopend" ? '<a class="btn btn-p btn-sm" href="#/catalogus" style="margin-top:6px">Naar de catalogus</a>' : "")) + '</div>', topbar("Mijn bestellingen", cat.client.nom).slice(0, -6) + chips + "</div>");
    K.on(app, "click", "[data-of]", (e, t) => { ordFilter = t.dataset.of; renderBestellingen(); });
    K.on(app, "click", "[data-doc]", async (e, t) => { const btn = t; K.busy(btn, true, "Laden…"); try { const d = await K.api("/api/klantdoc", { json: Object.assign({}, K.klant.creds(), { ref: t.dataset.ref }) }); FamoDocuments.setCompany(d.config); const type = t.dataset.doc; const html = FamoDocuments.build(d.order, type); famoDocPreview.open({ html, filename: FamoDocuments.filename(d.order, type), title: type === "invoice" ? "Factuur " + (d.order.factuurnummer || "") : "Leveringsbon " + d.order.ref, meta: K.eur(d.order.total) + " excl. btw" }); } catch (err) { K.toast(err.message, { kind: "err" }); } finally { K.busy(btn, false); } });
    K.on(app, "click", "[data-reorder]", (e, t) => { const o = orders.find(x => x.ref === t.dataset.reorder); if (!o) return; let n = 0; K.parseLines(o.lignes).forEach(l => { const p = (cat.products || []).find(x => x.nom.toLowerCase() === l.name.toLowerCase()); if (p && l.qty > 0) { cart.items[p.id] = l.qty; n++; } }); saveCart(); K.toast(n ? n + " artikel" + (n === 1 ? "" : "en") + " in de winkelmand gezet" : "Deze artikelen staan niet meer in de catalogus", { kind: n ? "" : "err" }); if (n) K.go("winkelmand"); });
  }

  /* ---------- favorieten / standaard ---------- */
  function renderFavorieten() {
    const favList = (cat.products || []).filter(p => favs[p.id]);
    const stdList = std ? Object.entries(std).map(([id, qv]) => ({ p: byId(id), qty: qv })).filter(x => x.p) : [];
    const stdTotal = stdList.reduce((s, x) => s + x.p.prix * x.qty, 0);
    const body = '<div class="mcard" style="background:var(--p-soft);border-color:#D6DAF7"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b>Mijn standaardbestelling</b><div class="quiet" style="font-size:12px">' + (stdList.length ? stdList.length + " artikelen · " + K.eur(stdTotal) : "Nog niet ingesteld") + '</div></div></div>' +
      (stdList.length ? '<div style="margin-top:8px;font-size:12.5px;color:var(--ink-2)">' + stdList.map(x => K.qty(x.qty) + "× " + K.esc(x.p.nom)).join(" · ") + '</div><div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn btn-p btn-sm" style="flex:1" id="stdToCart">In winkelmand zetten</button><button type="button" class="btn btn-o btn-sm" id="stdSave">Vervang door winkelmand</button></div>' : '<div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn btn-p btn-sm" style="flex:1" id="stdSave">Huidige winkelmand opslaan als standaard</button></div>') + '</div>' +
      '<div class="sec">Favorieten</div>' + (favList.length ? '<div class="mcard">' + favList.map(p => '<div class="li"><div class="n"><b>' + K.esc(p.nom) + '</b><div class="quiet" style="font-size:12px">' + K.esc((p.kaliber ? p.kaliber + " · " : "") + unitLabel(p)) + ' · ' + K.eur(p.prix) + '</div></div>' + K.c.stepper(p.id, cart.items[p.id] || 0, { step: isKg(p) ? 0.5 : 1 }) + '<button type="button" class="ibtn fav on" data-fav="' + p.id + '" aria-label="Uit favorieten">' + K.icon("star") + '</button></div>').join("") + '</div>' : K.c.empty("Nog geen favorieten", "Tik op de ster bij een product in de catalogus."));
    shell("favorieten", '<div class="mlist">' + body + '</div>', topbar("Favorieten", "Snel opnieuw bestellen"));
    bindSteppers(app);
    K.on(app, "click", "[data-fav]", (e, t) => { delete favs[t.dataset.fav]; K.store.set(FAV_KEY, favs); renderFavorieten(); });
    const s = document.getElementById("stdSave"); if (s) s.onclick = () => { const items = Object.fromEntries(Object.entries(cart.items).filter(([id, qv]) => byId(id) && Number(qv) > 0)); if (!Object.keys(items).length) { K.toast("Zet eerst artikelen in de winkelmand.", { kind: "err" }); return; } std = items; K.store.set(STD_KEY, std); K.toast("Standaardbestelling opgeslagen"); renderFavorieten(); };
    const c2 = document.getElementById("stdToCart"); if (c2) c2.onclick = () => { Object.assign(cart.items, std); saveCart(); K.go("winkelmand"); };
  }

  /* ---------- account ---------- */
  function renderAccount() {
    const cl = cat.client || {}, co = cat.company || {};
    const body = '<div class="mcard"><div class="row"><div>Zaak<small>' + K.esc(cl.nom || "") + '</small></div></div><div class="row"><div>Leveradres<small style="white-space:pre-line">' + K.esc(cl.adresse || "—") + '</small></div></div><div class="row"><div>Gebruikersnaam<small>' + K.esc(sess.user) + '</small></div></div></div>' +
      '<div class="mcard"><div class="row"><div>Documenten<small>Leveringsbonnen en facturen per bestelling</small></div><a href="#/bestellingen" class="btn btn-o btn-sm" data-goto="geleverd">Openen</a></div></div><div class="mcard"><div class="row"><div>Gegevens wijzigen<small>Adres, contact, e-mail: bel of mail Famo</small></div></div><div class="row"><div>Wachtwoord wijzigen<small>Famo zet een nieuw wachtwoord klaar</small></div><a href="/wachtwoord.html" class="btn btn-o btn-sm">Aanvragen</a></div></div>' +
      '<div class="mcard"><b>' + K.esc(co.bedrijfsnaam || "Famo Trading") + '</b><div class="quiet" style="font-size:12.5px;margin-top:4px">' + K.esc([co.adres, co.plaats].filter(Boolean).join(", ")) + '</div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' + (co.telefoon ? '<a class="btn btn-o btn-sm" href="tel:' + K.esc(co.telefoon.replace(/\s+/g, "")) + '">' + K.icon("phone") + K.esc(co.telefoon) + '</a>' : "") + (co.email ? '<a class="btn btn-o btn-sm" href="mailto:' + K.esc(co.email) + '">' + K.esc(co.email) + '</a>' : "") + '</div></div>' +
      '<button type="button" class="btn btn-o btn-block" id="logout" style="color:var(--danger)">Uitloggen</button>';
    shell("account", '<div class="mlist">' + body + '</div>', topbar("Account", cl.nom || ""));
    K.on(app, "click", "[data-goto]", () => { ordFilter = "geleverd"; });
    document.getElementById("logout").onclick = async () => { if (await K.confirm({ title: "Uitloggen?", text: "Uw winkelmand blijft bewaard op dit toestel.", yes: "Uitloggen" })) { K.klant.clear(); K.session.del(CAT_KEY); location.href = "/?uit=1"; } };
  }

  /* ---------- router ---------- */
  async function route() {
    const { path } = K.hashParams();
    try { if (!cat) await loadCatalogue(); }
    catch (err) { if (err.status === 401) { K.klant.clear(); location.replace("/"); return; } fail(err, route); return; }
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
