/* Klantportaal: aanmelden, bestellen met eigen prijzen, bestellingen volgen. */
(function () {
  "use strict";
  const $ = K.$, esc = K.esc;
  const main = $("#main"), nav = $("#nav"), tabbar = $("#tabbar"), who = $("#who");
  const S = { me: null, view: "bestellen", cart: {}, date: "", note: "", q: "", orders: null, lastOrder: null };

  // ---- Winkelmand (per klant bewaard op het toestel) ----------------------------------
  function cartKey() { return "mand:" + (S.me ? S.me.client.id : "x"); }
  function loadCart() { const c = K.store.get(cartKey(), null); if (c && c.items) { S.cart = c.items; S.note = c.note || ""; S.date = c.date || ""; } }
  function saveCart() { K.store.set(cartKey(), { items: S.cart, note: S.note, date: S.date }); }
  function product(id) { return S.me.catalogue.find((p) => p.id === id); }
  function cartLines() { return Object.entries(S.cart).map(([id, it]) => ({ p: product(id), qty: it.qty, comment: it.comment || "" })).filter((l) => l.p && l.qty > 0); }
  function cartTotal() { return cartLines().reduce((s, l) => s + Math.round(l.p.priceCents * l.qty), 0); }
  function cartCount() { return cartLines().length; }
  function setQty(id, qty, comment) {
    const p = product(id); if (!p) return;
    let q = Number(qty) || 0;
    if (!p.decimals) q = Math.round(q);
    q = Math.max(0, Math.min(10000, Math.round(q * 1000) / 1000));
    if (q <= 0) delete S.cart[id]; else S.cart[id] = { qty: q, comment: comment !== undefined ? comment : ((S.cart[id] || {}).comment || "") };
    saveCart();
  }
  function stepOf(p) { return p.decimals ? 0.5 : 1; }

  // ---- Navigatie -----------------------------------------------------------------------
  const TABS = { bestellen: ["Bestellen", "cart"], bestellingen: ["Bestellingen", "list"], account: ["Account", "user"] };
  function renderChrome() {
    const on = !!S.me;
    nav.hidden = !on; tabbar.hidden = !on;
    who.innerHTML = on ? "<b>" + esc(S.me.client.name) + "</b><br>" + esc(S.me.client.number || "") : "";
    K.$$("[data-go]", nav).forEach((b) => b.classList.toggle("on", b.dataset.go === S.view));
    K.$$("[data-go]", tabbar).forEach((b) => {
      const [label, icon] = TABS[b.dataset.go];
      const n = b.dataset.go === "bestellen" ? cartCount() : 0;
      b.innerHTML = K.icon(icon) + "<span>" + label + "</span>" + (n ? '<span class="count">' + n + "</span>" : "");
      b.classList.toggle("on", b.dataset.go === S.view);
    });
  }
  function go(view) { S.view = view; render(); window.scrollTo(0, 0); }
  K.on(document, "click", "[data-go]", (e, t) => go(t.dataset.go));

  // ---- Aanmelden -----------------------------------------------------------------------
  function renderLogin(err) {
    main.innerHTML = '<div class="login-wrap"><div class="card"><h1>Aanmelden</h1><p class="muted">Bestel op elk moment, met uw eigen prijzen.</p>' +
      '<form id="loginForm" class="stack" autocomplete="on">' +
      '<div class="field"><label for="login">Gebruikersnaam of e-mailadres</label><input class="input" id="login" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required></div>' +
      '<div class="field"><label for="pw">Wachtwoord</label><input class="input" id="pw" name="password" type="password" autocomplete="current-password" required></div>' +
      (err ? '<div class="notice notice-bad">' + esc(err) + "</div>" : "") +
      '<button class="btn btn-accent btn-lg btn-block" type="submit">Aanmelden</button></form>' +
      '<p class="small muted" style="margin-top:16px">Nog geen klant? <a href="/aanvraag">Vraag toegang aan</a>.<br><a href="#" id="forgot">Wachtwoord vergeten?</a></p></div>' +
      '<p class="small muted center" id="contact"></p>' +
      '<p class="small muted center" style="margin-top:18px">Werkt u bij Famo Trading? <a href="/team">Magazijn en levering</a> · <a href="/beheer">Beheer</a></p></div>';
    $("#forgot").onclick = (e) => { e.preventDefault(); forgotPassword($("#login").value); };
    K.api("publiek/config").then((c) => { $("#contact").textContent = [c.company.companyName, c.company.phone, c.company.email].filter(Boolean).join(" · "); }).catch(() => {});
    $("#loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", e.target);
      await K.busy(btn, async () => {
        try { S.me = await K.api("klant/login", { body: { login: $("#login").value, wachtwoord: $("#pw").value } }); afterLogin(); }
        catch (err) { renderLogin(err.message); }
      });
    };
  }
  async function forgotPassword(prefill) {
    const login = await K.prompt({ title: "Wachtwoord vergeten", label: "Uw gebruikersnaam of e-mailadres", value: prefill || "", yes: "Link sturen", help: "U ontvangt een e-mail met een link om een nieuw wachtwoord te kiezen (30 minuten geldig). Geen e-mailadres bij ons bekend? Bel ons even." });
    if (login === null) return;
    try {
      const r = await K.api("klant/wachtwoord-vergeten", { body: { login } });
      K.toast(r.mailEnabled ? r.hint : "E-mail is nog niet ingeschakeld. Bel ons voor een nieuw wachtwoord.", r.mailEnabled ? "ok" : "bad", 6000);
    } catch (err) { K.toast(err.message, "bad", 6000); }
  }
  function renderReset(token) {
    main.innerHTML = '<div class="login-wrap"><div class="card"><h1>Nieuw wachtwoord kiezen</h1><p class="muted">Kies een wachtwoord van minstens 8 tekens.</p><form id="resetForm" class="stack"><div class="field"><label for="new1">Nieuw wachtwoord</label><input class="input" id="new1" type="password" autocomplete="new-password" minlength="8" required></div><div class="field"><label for="new2">Nogmaals</label><input class="input" id="new2" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn btn-accent btn-lg btn-block" type="submit">Wachtwoord opslaan en aanmelden</button></form></div></div>';
    $("#resetForm").onsubmit = async (e) => {
      e.preventDefault();
      if ($("#new1").value !== $("#new2").value) return K.toast("De twee wachtwoorden zijn niet gelijk.", "bad");
      await K.busy($("button", e.target), async () => {
        try { S.me = await K.api("klant/wachtwoord-reset", { body: { token, nieuw: $("#new1").value } }); history.replaceState(null, "", "/"); K.toast("Wachtwoord opgeslagen. Welkom terug.", "ok"); afterLogin(); }
        catch (err) { K.toast(err.message, "bad", 7000); }
      });
    };
  }
  function afterLogin() {
    loadCart();
    if (!S.date || !S.me.deliveryDates.some((d) => d.iso === S.date)) S.date = S.me.deliveryDates[0] ? S.me.deliveryDates[0].iso : "";
    const q = K.qs();
    S.view = q.ga === "bestellingen" || q.bestelling ? "bestellingen" : "bestellen";
    S.openOrderId = q.bestelling || "";
    render();
  }

  // ---- Bestellen -------------------------------------------------------------------------
  function greeting() { const h = new Date().getHours(); return h < 12 ? "Goedemorgen" : h < 18 ? "Goedemiddag" : "Goedenavond"; }
  function renderBestellen() {
    const me = S.me;
    const first = me.deliveryDates[0];
    const sugg = me.suggestions.map((s) => ({ p: product(s.productId), qty: s.qty })).filter((s) => s.p);
    const q = S.q.trim().toLowerCase();
    const cats = {};
    me.catalogue.filter((p) => !q || p.name.toLowerCase().includes(q) || p.categoryLabel.toLowerCase().includes(q)).forEach((p) => { (cats[p.categoryLabel] = cats[p.categoryLabel] || []).push(p); });
    let html = '<div class="hero"><h1>' + greeting() + ", " + esc(me.client.name) + "</h1><p>" +
      (first ? "Bestel vóór " + esc(me.cutoff) + " en wij leveren " + esc(first.relative === "Morgen" ? "morgen" : "op " + K.dateNl(first.iso, true).replace(/ \d{4}$/, "")) + "." : "Momenteel geen leverdag beschikbaar.") +
      '</p><span class="cut">' + K.icon("clock") + " Besteldeadline " + esc(me.cutoff) + "</span></div>";
    if (sugg.length && !q) {
      html += '<div class="section"><div class="section-head"><h2>Uw vaste bestelling</h2><button class="btn btn-sm btn-outline" id="addAll">Alles toevoegen</button></div><div class="card pad-0 flat"><div class="list">' +
        sugg.map((s) => '<button class="item" data-add="' + s.p.id + '" data-qty="' + s.qty + '"><div class="body"><div class="title">' + esc(s.p.name) + '</div><div class="sub">' + K.qty(s.qty) + " " + esc(K.unit(s.p.unit, s.qty)) + " · " + K.eur(s.p.priceCents) + "/" + esc(K.unit(s.p.unit, 1)) + '</div></div><span class="pill pill-accent">' + (S.cart[s.p.id] ? "In mand" : "+ Toevoegen") + "</span></button>").join("") + "</div></div></div>";
    }
    html += '<div class="section"><div class="searchbox">' + K.icon("search") + '<input class="input" id="q" placeholder="Zoek een artikel…" value="' + esc(S.q) + '" autocomplete="off"></div></div>';
    const names = Object.keys(cats);
    if (!names.length) html += '<div class="empty"><div class="big">🐟</div>Geen artikelen gevonden.</div>';
    names.forEach((c) => {
      html += '<div class="cat-group"><div class="cat-title">' + esc(c) + "</div>" + cats[c].map(productRow).join("") + "</div>";
    });
    html += '<div style="height:70px"></div>';
    main.innerHTML = html;
    const qi = $("#q");
    qi.oninput = K.debounce(() => { S.q = qi.value; const pos = qi.selectionStart; renderBestellen(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); }, 150);
    if ($("#addAll")) $("#addAll").onclick = () => { sugg.forEach((s) => { if (!S.cart[s.p.id]) setQty(s.p.id, s.qty); }); K.toast("Vaste bestelling toegevoegd"); renderBestellen(); };
    renderCartbar();
  }
  function productRow(p) {
    const it = S.cart[p.id];
    const qty = it ? it.qty : 0;
    return '<div class="product' + (qty ? " in" : "") + '" data-p="' + p.id + '"><div><div class="name">' + esc(p.name) + '</div><div class="price"><b>' + K.eur(p.priceCents) + "</b> / " + esc(K.unit(p.unit, 1)) + (p.negotiated ? '<span class="neg">uw prijs</span>' : "") + "</div></div>" +
      stepper(p, qty) + (qty ? '<div class="comment"><input class="input" data-comment="' + p.id + '" placeholder="Opmerking (bv. in filets, zonder kop)" value="' + esc(it.comment || "") + '" maxlength="120"></div>' : "") + "</div>";
  }
  function stepper(p, qty) {
    return '<div class="stepper"><button type="button" data-dec="' + p.id + '" aria-label="Minder">−</button><input inputmode="' + (p.decimals ? "decimal" : "numeric") + '" data-qty="' + p.id + '" value="' + (qty ? K.qty(qty) : "") + '" placeholder="0" aria-label="Aantal ' + esc(p.name) + '"><button type="button" data-inc="' + p.id + '" aria-label="Meer">+</button></div>';
  }
  function rerenderProduct(id) {
    const p = product(id), old = $('.product[data-p="' + id + '"]');
    if (old) old.outerHTML = productRow(p);
    renderCartbar(); renderChrome();
  }
  K.on(document, "click", "[data-inc]", (e, t) => { const p = product(t.dataset.inc); setQty(p.id, ((S.cart[p.id] || {}).qty || 0) + stepOf(p)); rerenderProduct(p.id); });
  K.on(document, "click", "[data-dec]", (e, t) => { const p = product(t.dataset.dec); setQty(p.id, ((S.cart[p.id] || {}).qty || 0) - stepOf(p)); rerenderProduct(p.id); });
  K.on(document, "change", "[data-qty]", (e, t) => { setQty(t.dataset.qty, String(t.value).replace(",", ".")); rerenderProduct(t.dataset.qty); });
  K.on(document, "input", "[data-comment]", (e, t) => { const id = t.dataset.comment; if (S.cart[id]) { S.cart[id].comment = t.value.slice(0, 120); saveCart(); } });
  K.on(document, "click", "[data-add]", (e, t) => { const id = t.dataset.add; if (!S.cart[id]) { setQty(id, Number(t.dataset.qty) || 1); K.toast("Toegevoegd aan uw bestelling"); } renderBestellen(); renderChrome(); });

  function renderCartbar() {
    let bar = $(".cartbar");
    const n = cartCount();
    if (!n || S.view !== "bestellen") { if (bar) bar.remove(); return; }
    if (!bar) { bar = K.el('<div class="cartbar"><button class="btn btn-accent btn-lg" id="openCart"></button></div>'); document.body.appendChild(bar); $("#openCart").onclick = openCart; }
    $("#openCart").innerHTML = "<span>Bestelling bekijken <span class=\"pill\" style=\"background:rgba(255,255,255,.22);color:#fff;margin-left:4px\">" + n + "</span></span><span>" + K.eur(cartTotal()) + "</span>";
  }

  // ---- Mandje en bevestigen ----------------------------------------------------------------
  function openCart() {
    const me = S.me;
    const body = document.createElement("div");
    const foot = document.createElement("div");
    function draw() {
      const lines = cartLines();
      body.innerHTML = '<div class="section"><div class="label" style="margin-bottom:8px">Leverdatum</div><div class="datechips">' +
        me.deliveryDates.map((d) => '<button type="button" class="datechip' + (d.iso === S.date ? " on" : "") + '" data-date="' + d.iso + '"><b>' + esc(d.relative) + "</b><small>" + esc(K.dateShort(d.iso)) + "</small></button>").join("") + "</div></div>" +
        '<div class="card pad-0 flat"><div class="list">' + (lines.length ? lines.map((l) => '<div class="item" style="cursor:default"><div class="body"><div class="title">' + esc(l.p.name) + '</div><div class="sub">' + K.eur(l.p.priceCents) + "/" + esc(K.unit(l.p.unit, 1)) + (l.comment ? " · " + esc(l.comment) : "") + "</div></div>" + stepper(l.p, l.qty) + '<div class="end num strong" style="min-width:80px">' + K.eur(Math.round(l.p.priceCents * l.qty)) + "</div></div>").join("") : '<div class="empty">Uw bestelling is leeg.</div>') + "</div></div>" +
        '<div class="field" style="margin-top:14px"><label for="note">Opmerking voor het magazijn</label><textarea class="textarea" id="note" placeholder="Bv. graag vóór 9u, bellen bij aankomst…" maxlength="600">' + esc(S.note) + "</textarea></div>";
      foot.innerHTML = '<div class="row spread"><span class="muted">Totaal excl. btw</span><b class="num" style="font-size:1.25rem">' + K.eur(cartTotal()) + "</b></div>" +
        '<button class="btn btn-accent btn-lg btn-block" id="place"' + (lines.length && S.date ? "" : " disabled") + ">Bestelling plaatsen</button>";
      K.$$("[data-date]", body).forEach((b) => { b.onclick = () => { S.date = b.dataset.date; saveCart(); draw(); }; });
      $("#note", body).oninput = (e) => { S.note = e.target.value; saveCart(); };
      $("#place", foot).onclick = place;
    }
    const sheet = K.sheet({ title: "Uw bestelling", body, footer: foot, focus: false });
    sheet.body.addEventListener("click", (e) => { if (e.target.closest("[data-inc],[data-dec]")) setTimeout(draw, 0); });
    sheet.body.addEventListener("change", (e) => { if (e.target.closest("[data-qty]")) setTimeout(draw, 0); });
    draw();
    async function place() {
      const btn = $("#place", foot);
      const items = cartLines().map((l) => ({ productId: l.p.id, qty: l.qty, comment: l.comment }));
      await K.busy(btn, async () => {
        try {
          const r = await K.api("klant/bestellen", { body: { items, leverdatum: S.date, opmerking: S.note } });
          S.cart = {}; S.note = ""; saveCart();
          S.lastOrder = r; S.orders = null;
          sheet.close();
          renderConfirm(r);
          renderChrome();
        } catch (err) {
          K.toast(err.message, "bad", 6000);
          if (err.status === 401) { S.me = null; sheet.close(); renderLogin("Uw sessie is verlopen. Meld u opnieuw aan."); return; }
          if (err.status === 409) { // leverdatum verlopen: verse data ophalen en de eerste geldige dag kiezen
            try { S.me = await K.api("klant/mij"); S.date = S.me.deliveryDates[0] ? S.me.deliveryDates[0].iso : ""; saveCart(); draw(); } catch (_) { /* melding staat er al */ }
          }
        }
      });
    }
  }
  function renderConfirm(r) {
    const o = r.order;
    const m = r.mail || {};
    const mailNote = m.client && m.client.ok ? "Een bevestiging is onderweg naar " + esc(S.me.client.email) + "." : (S.me.client.email ? "" : "Voeg een e-mailadres toe onder Mijn account om bevestigingen te ontvangen.");
    main.innerHTML = '<div class="login-wrap"><div class="card center"><div style="font-size:3rem">✅</div><h1>Bestelling geplaatst</h1><p class="muted">Referentie <b>' + esc(o.ref) + "</b></p>" +
      '<p>Wij leveren op <b>' + esc(K.dateNl(o.deliveryDate, true)) + "</b>.</p>" +
      '<div class="card flat" style="text-align:left;margin:14px 0"><div class="list">' + o.lines.map((l) => '<div class="item" style="cursor:default;padding:8px 12px"><div class="body"><div class="title">' + esc(l.name) + '</div><div class="sub">' + K.qty(l.qty) + " " + esc(l.unitLabel) + (l.comment ? " · " + esc(l.comment) : "") + '</div></div><div class="end num">' + K.eur(Math.round((l.priceCents || 0) * l.qty)) + "</div></div>").join("") + '</div><div class="row spread" style="padding:12px 12px 4px"><span class="muted">Totaal excl. btw</span><b class="num">' + K.eur(o.totalCents) + "</b></div></div>" +
      (mailNote ? '<p class="small muted">' + mailNote + "</p>" : "") + '<p class="small muted">Iets vergeten? Zolang de bestelling op Ontvangen staat, kunt u ze onder Mijn bestellingen annuleren en opnieuw plaatsen.</p>' +
      '<div class="stack"><button class="btn btn-accent btn-lg" data-go="bestellingen">Mijn bestellingen</button><button class="btn btn-outline" data-go="bestellen">Nieuwe bestelling</button></div></div></div>';
    S.view = "bestellingen"; renderChrome(); renderCartbar(); window.scrollTo(0, 0);
  }

  // ---- Mijn bestellingen ------------------------------------------------------------------
  async function renderBestellingen() {
    main.innerHTML = '<div class="section-head"><h1>Mijn bestellingen</h1><button class="iconbtn" id="refresh" aria-label="Vernieuwen">' + K.icon("refresh") + '</button></div><div class="skeleton" style="height:80px"></div>';
    $("#refresh").onclick = () => { S.orders = null; renderBestellingen(); };
    try { if (!S.orders) S.orders = (await K.api("klant/bestellingen")).orders; }
    catch (err) { main.innerHTML += '<div class="notice notice-bad">' + esc(err.message) + "</div>"; return; }
    const list = S.orders;
    const open = list.filter((o) => o.status !== "geleverd"), done = list.filter((o) => o.status === "geleverd");
    const row = (o) => '<button class="item" data-order="' + o.id + '"><div class="body"><div class="title">' + esc(o.deliveryLabel) + ' <span class="muted small">· ' + esc(o.ref) + '</span></div><div class="sub">' + o.lines.length + (o.lines.length === 1 ? " artikel" : " artikelen") + " · " + K.eur(o.totalCents) + '</div></div><div class="end">' + K.chip(o.status, o.statusLabel) + (o.status === "geleverd" ? "<br>" + K.chip(o.paid ? "betaald" : "open", o.paymentLabel) : "") + "</div></button>";
    main.innerHTML = '<div class="section-head"><h1>Mijn bestellingen</h1><button class="iconbtn" id="refresh" aria-label="Vernieuwen">' + K.icon("refresh") + "</button></div>" +
      (list.length ? '<div class="section"><h2 style="margin-bottom:8px">Onderweg en gepland</h2><div class="card pad-0 flat"><div class="list">' + (open.length ? open.map(row).join("") : '<div class="empty">Geen open bestellingen. <a href="#" data-go="bestellen">Bestel nu</a>.</div>') + "</div></div></div>" +
        '<div class="section"><h2 style="margin-bottom:8px">Geleverd</h2><div class="card pad-0 flat"><div class="list">' + (done.length ? done.map(row).join("") : '<div class="empty">Nog geen leveringen.</div>') + "</div></div></div>"
        : '<div class="empty"><div class="big">🧾</div>U hebt nog geen bestellingen geplaatst.<br><br><button class="btn btn-accent" data-go="bestellen">Eerste bestelling plaatsen</button></div>');
    $("#refresh").onclick = () => { S.orders = null; renderBestellingen(); };
    if (S.openOrderId) { const id = S.openOrderId; S.openOrderId = ""; if (list.some((o) => o.id === id)) openOrder(id); }
  }
  K.on(document, "click", "[data-order]", (e, t) => openOrder(t.dataset.order));
  function openOrder(id) {
    const o = (S.orders || []).find((x) => x.id === id);
    if (!o) return;
    const idx = ["ontvangen", "klaar", "onderweg", "geleverd"].indexOf(o.status);
    const body = '<div class="row spread" style="margin-bottom:6px"><span class="muted">' + esc(o.ref) + " · besteld op " + esc(K.dateShort(o.date)) + "</span>" + K.chip(o.status, o.statusLabel) + "</div>" + K.timeline(idx) +
      '<p class="strong" style="margin-top:10px">Levering ' + esc(K.dateNl(o.deliveryDate, true)) + (o.deliveredAt ? " · ontvangen door " + esc(o.receivedBy) + " om " + esc(K.time(o.deliveredAt)) : "") + "</p>" +
      '<div class="card pad-0 flat"><div class="list">' + o.lines.map((l) => '<div class="item" style="cursor:default"><div class="body"><div class="title">' + esc(l.name) + '</div><div class="sub">' + K.qty(l.qty) + " " + esc(l.unitLabel) + (l.priceCents != null ? " × " + K.eur(l.priceCents) : "") + (l.comment ? " · " + esc(l.comment) : "") + '</div></div><div class="end num">' + (l.priceCents != null ? K.eur(Math.round(l.priceCents * l.qty)) : "") + "</div></div>").join("") + '</div><div class="row spread" style="padding:12px 16px"><span class="muted">Totaal excl. btw</span><b class="num">' + K.eur(o.totalCents) + "</b></div></div>" +
      (o.notes ? '<p class="small muted" style="margin-top:10px"><b>Opmerking:</b> ' + esc(o.notes) + "</p>" : "") +
      (o.invoiceNumber ? '<p style="margin-top:10px">Factuur <b>' + esc(o.invoiceNumber) + "</b> · " + K.chip(o.paid ? "betaald" : "open", o.paymentLabel) + "</p>" : "");
    const phone = S.me.company.phone || "";
    const bodyExtra = o.cancelable ? '<p class="small muted" style="margin-top:10px">Wilt u iets wijzigen? Annuleer deze bestelling en plaats ze opnieuw' + (phone ? ", of bel ons op " + esc(phone) : "") + '.</p>' : (o.status !== "geleverd" ? '<p class="small muted" style="margin-top:10px">Deze bestelling wordt al klaargezet. Wijzigen? ' + (phone ? 'Bel ons op <a href="tel:' + esc(phone.replace(/\s/g, "")) + '">' + esc(phone) + "</a>." : "Neem contact met ons op.") + "</p>" : "");
    const foot = '<div class="row wrap">' + (o.docs.invoice ? '<a class="btn btn-outline" target="_blank" rel="noopener" href="' + esc(o.docs.invoice) + '">' + K.icon("doc") + " Factuur</a>" : "") + (o.docs.deliveryNote ? '<a class="btn btn-outline" target="_blank" rel="noopener" href="' + esc(o.docs.deliveryNote) + '">' + K.icon("doc") + " Leveringsbon</a>" : "") + (o.cancelable ? '<button class="btn btn-ghost" id="cancel" style="color:var(--bad)">Annuleren</button>' : "") + '<button class="btn btn-accent" id="reorder" style="margin-left:auto">Opnieuw bestellen</button></div>';
    const s = K.sheet({ title: "Bestelling " + o.deliveryLabel, body: body + bodyExtra, footer: foot });
    if ($("#cancel", s.el)) $("#cancel", s.el).onclick = async () => {
      const reason = await K.prompt({ title: "Bestelling annuleren?", label: "Reden (optioneel)", placeholder: "Bv. dubbel besteld", yes: "Ja, annuleren" });
      if (reason === null) return;
      try { await K.api("klant/bestellingen/" + encodeURIComponent(o.id) + "/annuleren", { body: { reden: reason } }); S.orders = (S.orders || []).filter((x) => x.id !== o.id); s.close(); K.toast("Bestelling geannuleerd. Het team is verwittigd.", "ok", 4000); renderBestellingen(); }
      catch (err) { K.toast(err.message, "bad", 7000); }
    };
    $("#reorder", s.el).onclick = () => {
      let n = 0, miss = [];
      o.lines.forEach((l) => { const p = S.me.catalogue.find((x) => x.name.toLowerCase() === l.name.toLowerCase()); if (p) { setQty(p.id, l.qty, l.comment); n++; } else miss.push(l.name); });
      s.close();
      K.toast(n ? K.plural(n, "artikel", "artikelen") + " in uw bestelling gezet" + (miss.length ? " (" + K.plural(miss.length, "artikel", "artikelen") + " niet meer beschikbaar)" : "") : "Deze artikelen zijn niet meer beschikbaar.", n ? "ok" : "bad");
      go("bestellen");
    };
  }

  // ---- Account ------------------------------------------------------------------------------
  function renderAccount() {
    const c = S.me.client, co = S.me.company;
    main.innerHTML = '<h1 style="margin-bottom:12px">Mijn account</h1><div class="grid grid-2">' +
      '<div class="card"><h2>' + esc(c.name) + '</h2><p class="muted small">Klantnummer ' + esc(c.number || "—") + (c.vat ? " · Btw " + esc(c.vat) : "") + '</p><div class="label">Leveradres</div><p>' + esc(c.address || "—").replace(/\n/g, "<br>") + '</p><p class="small muted">Adres wijzigen? Bel ons, dan passen wij het aan.</p></div>' +
      '<div class="card"><h2>Contact en meldingen</h2><form id="profileForm" class="stack" style="margin-top:8px"><div class="field"><label for="email">E-mailadres (bevestigingen en facturen)</label><input class="input" id="email" type="email" value="' + esc(c.email) + '" autocomplete="email"></div><div class="field"><label for="phone">Telefoon</label><input class="input" id="phone" type="tel" value="' + esc(c.phone) + '" autocomplete="tel"></div><button class="btn btn-outline" type="submit">Opslaan</button></form></div>' +
      '<div class="card"><h2>Wachtwoord wijzigen</h2><form id="pwForm" class="stack" style="margin-top:8px"><div class="field"><label for="cur">Huidig wachtwoord</label><input class="input" id="cur" type="password" autocomplete="current-password" required></div><div class="field"><label for="new">Nieuw wachtwoord (min. 8 tekens)</label><input class="input" id="new" type="password" autocomplete="new-password" minlength="8" required></div><button class="btn btn-outline" type="submit">Wachtwoord wijzigen</button></form><p class="small muted" style="margin-top:8px">Gebruikersnaam: <b>' + esc(c.username) + "</b></p></div>" +
      '<div class="card"><h2>' + esc(co.companyName) + '</h2><p class="small">' + esc([co.street, co.city].filter(Boolean).join(", ")) + "<br>" + (co.phone ? '<a href="tel:' + esc(co.phone.replace(/\s/g, "")) + '">' + esc(co.phone) + "</a><br>" : "") + (co.email ? '<a href="mailto:' + esc(co.email) + '">' + esc(co.email) + "</a>" : "") + '</p><p class="small muted">Besteldeadline ' + esc(S.me.cutoff) + ". Leverdagen: " + esc(co.deliveryDays) + '.</p><button class="btn btn-ghost" id="logout">Afmelden</button></div></div>';
    $("#profileForm").onsubmit = async (e) => { e.preventDefault(); await K.busy($("button", e.target), async () => { try { await K.api("klant/profiel", { body: { email: $("#email").value, phone: $("#phone").value } }); S.me.client.email = $("#email").value.trim().toLowerCase(); S.me.client.phone = $("#phone").value; K.toast("Opgeslagen", "ok"); } catch (err) { K.toast(err.message, "bad"); } }); };
    $("#pwForm").onsubmit = async (e) => { e.preventDefault(); await K.busy($("button", e.target), async () => { try { await K.api("klant/wachtwoord", { body: { huidig: $("#cur").value, nieuw: $("#new").value } }); e.target.reset(); K.toast("Wachtwoord gewijzigd", "ok"); } catch (err) { K.toast(err.message, "bad"); } }); };
    $("#logout").onclick = async () => { await K.api("klant/logout", { body: {} }).catch(() => {}); S.me = null; S.orders = null; renderChrome(); renderLogin(); };
  }

  // ---- Render ----------------------------------------------------------------------------------
  function render() {
    renderChrome();
    renderCartbar();
    if (!S.me) return renderLogin();
    if (S.view === "bestellingen") return renderBestellingen();
    if (S.view === "account") return renderAccount();
    renderBestellen();
  }
  async function boot() {
    const q = K.qs();
    if (q.reset) return renderReset(q.reset);
    try { S.me = await K.api("klant/mij"); afterLogin(); }
    catch (err) { if (err.status === 401) renderLogin(); else if (err.status !== 503) { renderLogin(err.message); } }
  }
  boot();
})();
