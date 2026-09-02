/* Klantportaal: aanmelden, bestellen met eigen prijzen, bestellingen volgen. */
(function () {
  "use strict";
  const $ = K.$, esc = K.esc, c = K.c;
  const main = $("#main"), nav = $("#nav"), tabbar = $("#tabbar"), who = $("#who");
  const VIEWS = ["bestellen", "bestellingen", "account"];
  const S = { me: null, view: "bestellen", cart: {}, date: "", note: "", q: "", orders: null, openOrderId: "", loginName: "" };

  // ---- Winkelmand (per klant bewaard op het toestel) ----------------------------------
  function cartKey() { return "mand:" + (S.me ? S.me.client.id : "x"); }
  function loadCart() { const v = K.store.get(cartKey(), null); if (v && v.items) { S.cart = v.items; S.note = v.note || ""; S.date = v.date || ""; } }
  function saveCart() { K.store.set(cartKey(), { items: S.cart, note: S.note, date: S.date }); }
  function product(id) { return S.me.catalogue.find((p) => p.id === id); }
  function cartLines() { return Object.entries(S.cart).map(([id, it]) => ({ p: product(id), qty: it.qty, comment: it.comment || "" })).filter((l) => l.p && l.qty > 0); }
  function cartTotal() { return cartLines().reduce((s, l) => s + Math.round(l.p.priceCents * l.qty), 0); }
  function cartCount() { return cartLines().length; }
  function stepOf(p) { return p.decimals ? 0.5 : 1; }
  function setQty(id, qty, comment) {
    const p = product(id); if (!p) return;
    let q = Number(String(qty).replace(",", ".")) || 0;
    if (!p.decimals) q = Math.round(q);
    q = Math.max(0, Math.min(10000, Math.round(q * 1000) / 1000));
    if (q <= 0) delete S.cart[id]; else S.cart[id] = { qty: q, comment: comment !== undefined ? comment : ((S.cart[id] || {}).comment || "") };
    saveCart();
  }
  function ensureDate() {
    const list = S.me ? S.me.deliveryDates : [];
    if (!S.date || !list.some((d) => d.iso === S.date)) S.date = list[0] ? list[0].iso : "";
  }
  function dateInfo(iso) { return (S.me.deliveryDates || []).find((d) => d.iso === iso); }
  function dateSentence(iso) { const d = dateInfo(iso); if (!d) return ""; return d.relative === "Morgen" ? "morgen" : "op " + K.dateNl(iso, true).replace(/ \d{4}$/, ""); }

  // ---- Navigatie -----------------------------------------------------------------------
  const TABS = { bestellen: ["Bestellen", "cart"], bestellingen: ["Bestellingen", "list"], account: ["Account", "user"] };
  function renderChrome() {
    const on = !!S.me;
    nav.hidden = !on; tabbar.hidden = !on;
    who.innerHTML = on ? '<span class="who-name">' + esc(S.me.client.name) + '</span><button class="btn btn-sm btn-ghost topbar-btn" id="logout">Afmelden</button>' : "";
    if (on) $("#logout").onclick = logout;
    K.$$("[data-go]", nav).forEach((b) => b.classList.toggle("on", b.dataset.go === S.view));
    K.$$("[data-go]", tabbar).forEach((b) => {
      const [label, icon] = TABS[b.dataset.go];
      const n = b.dataset.go === "bestellen" ? cartCount() : 0;
      b.innerHTML = K.icon(icon) + "<span>" + label + "</span>" + (n ? '<span class="count">' + n + "</span>" : "");
      b.classList.toggle("on", b.dataset.go === S.view);
    });
  }
  function go(view, params, replace) { S.view = view; K.route.set(view, params, replace); render(); window.scrollTo(0, 0); }
  K.on(document, "click", "[data-go]", (e, t) => { e.preventDefault(); go(t.dataset.go); });
  K.route.onChange((r) => {
    if (!S.me) return;
    const v = VIEWS.includes(r.view) ? r.view : "bestellen";
    S.openOrderId = r.params.id || "";
    if (v !== S.view || S.openOrderId) { S.view = v; render(); }
  });
  document.addEventListener("kade:unauthorized", (e) => {
    if (!S.me) return;
    K.pending.set({ view: S.view, params: S.openOrderId ? { id: S.openOrderId } : {} });
    S.me = null; S.orders = null; renderChrome(); renderCartbar();
    renderLogin(e.detail && e.detail.message ? e.detail.message : "Uw sessie is verlopen. Meld u opnieuw aan.");
  });
  async function logout() {
    await K.api("klant/logout", { body: {} }).catch(() => {});
    S.me = null; S.orders = null; renderChrome(); renderCartbar(); K.route.set("", {}, true);
    renderLogin(); K.toast("U bent afgemeld", "ok");
  }

  // ---- Aanmelden -----------------------------------------------------------------------
  function contactLine(co) { return [co.companyName, c.tel(co.phone), c.mail(co.email)].filter(Boolean).join(" · "); }
  function renderLogin(err) {
    main.innerHTML = '<div class="login-wrap"><div class="card"><h1>Aanmelden</h1><p class="muted">Bestel op elk moment, met uw eigen prijzen.</p>' +
      '<form id="loginForm" class="stack" autocomplete="on">' +
      c.field({ id: "login", label: "Gebruikersnaam of e-mailadres", value: S.loginName, attrs: ' name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required' }) +
      c.field({ id: "pw", label: "Wachtwoord", type: "password", attrs: ' name="password" autocomplete="current-password" required' }) +
      '<label class="check"><input type="checkbox" id="blijf" checked> Aangemeld blijven op dit toestel</label>' +
      (err ? c.notice("bad", esc(err)) : "") +
      c.btn({ label: "Aanmelden", kind: "primary", size: "lg", block: true, type: "submit" }) + "</form>" +
      '<p class="small muted" style="margin-top:16px">Nog geen klant? <a href="/aanvraag">Vraag toegang aan</a>.<br><a href="#" id="forgot">Wachtwoord vergeten?</a></p></div>' +
      '<p class="small muted center" id="contact"></p>' +
      '<p class="small muted center" style="margin-top:18px">Werkt u bij Famo Trading? <a href="/team">Magazijn en levering</a> · <a href="/beheer">Beheer</a></p></div>';
    K.pwToggle($("#pw"));
    if (err && S.loginName) $("#pw").focus(); else $("#login").focus();
    K.api("publiek/config").then((r) => { $("#contact").innerHTML = contactLine(r.company); }).catch(() => {});
    $("#forgot").onclick = (e) => { e.preventDefault(); forgotPassword($("#login").value); };
    $("#loginForm").onsubmit = async (e) => {
      e.preventDefault();
      S.loginName = $("#login").value.trim();
      await K.busy($("button[type=submit]", e.target), async () => {
        try { S.me = await K.api("klant/login", { body: { login: S.loginName, wachtwoord: $("#pw").value, blijf: $("#blijf").checked } }); afterLogin(); }
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
    main.innerHTML = '<div class="login-wrap"><div class="card"><h1>Nieuw wachtwoord kiezen</h1><p class="muted">Kies een wachtwoord van minstens 8 tekens.</p><form id="resetForm" class="stack">' +
      c.field({ id: "new1", label: "Nieuw wachtwoord", type: "password", attrs: ' autocomplete="new-password" minlength="8" required' }) +
      c.field({ id: "new2", label: "Nogmaals", type: "password", attrs: ' autocomplete="new-password" minlength="8" required' }) +
      c.btn({ label: "Wachtwoord opslaan en aanmelden", kind: "primary", size: "lg", block: true, type: "submit" }) + "</form></div></div>";
    K.pwToggle($("#new1")); K.pwToggle($("#new2"));
    $("#resetForm").onsubmit = async (e) => {
      e.preventDefault();
      if ($("#new1").value !== $("#new2").value) return K.toast("De twee wachtwoorden zijn niet gelijk.", "bad");
      await K.busy($("button[type=submit]", e.target), async () => {
        try { S.me = await K.api("klant/wachtwoord-reset", { body: { token, nieuw: $("#new1").value } }); history.replaceState(null, "", "/"); K.toast("Wachtwoord opgeslagen. Welkom terug.", "ok"); afterLogin(); }
        catch (err) { K.toast(err.message, "bad", 7000); }
      });
    };
  }
  function afterLogin() {
    loadCart(); ensureDate();
    const q = K.qs(); K.stripQuery();
    const pending = K.pending.take();
    const r = K.route.get();
    let view = "bestellen", params = {};
    if (pending && VIEWS.includes(pending.view)) { view = pending.view; params = pending.params || {}; }
    else if (q.bestelling) { view = "bestellingen"; params = { id: q.bestelling }; }
    else if (q.ga === "bestellingen") view = "bestellingen";
    else if (VIEWS.includes(r.view)) { view = r.view; params = r.params; }
    S.openOrderId = params.id || "";
    S.view = view; K.route.set(view, params, true);
    render();
  }

  // ---- Bestellen -------------------------------------------------------------------------
  function greeting() { const h = new Date().getHours(); return h < 12 ? "Goedemorgen" : h < 18 ? "Goedemiddag" : "Goedenavond"; }
  function dayChips(sel) {
    return '<div class="datechips">' + S.me.deliveryDates.map((d) => '<button type="button" class="datechip' + (d.iso === sel ? " on" : "") + '" data-date="' + d.iso + '"><b>' + esc(d.relative) + "</b><small>" + esc(K.dateShort(d.iso)) + "</small></button>").join("") + "</div>";
  }
  function renderBestellen() {
    const me = S.me;
    ensureDate();
    const first = me.deliveryDates[0];
    const afterCutoff = first && first.relative !== "Morgen";
    const sugg = me.suggestions.map((s) => ({ p: product(s.productId), qty: s.qty })).filter((s) => s.p);
    const q = S.q.trim();
    const cats = {};
    me.catalogue.filter((p) => K.matches(p.name + " " + p.categoryLabel, q)).forEach((p) => { (cats[p.categoryLabel] = cats[p.categoryLabel] || []).push(p); });
    let html = '<div class="hero"><h1>' + greeting() + ", " + esc(me.client.name) + "</h1><p>" +
      (first ? (afterCutoff ? "De besteldeadline van vandaag (" + esc(me.cutoff) + ") is voorbij. Eerstvolgende levering: <b>" + esc(K.dateNl(first.iso, true)) + "</b>." : "Bestel vóór " + esc(me.cutoff) + " en wij leveren <b>morgen</b>.") : "Momenteel geen leverdag beschikbaar.") +
      "</p></div>" +
      '<div class="section"><div class="label" style="margin-bottom:8px">Leveren ' + esc(dateSentence(S.date) || "op") + "</div>" + dayChips(S.date) + "</div>";
    if (sugg.length && !q) {
      html += '<div class="section"><div class="section-head"><h2>Uw vaste bestelling</h2>' + c.btn({ label: "Alles toevoegen", kind: "outline", size: "sm", id: "addAll" }) + '</div><div class="card pad-0 flat"><div class="list">' +
        sugg.map((s) => c.item({ attrs: ' data-add="' + s.p.id + '" data-qty="' + s.qty + '"', title: esc(s.p.name), sub: K.qty(s.qty) + " " + esc(K.unit(s.p.unit, s.qty)) + " · " + K.eur(s.p.priceCents) + "/" + esc(K.unit(s.p.unit, 1)), end: '<span class="pill ' + (S.cart[s.p.id] ? "pill-ok" : "pill-accent") + '">' + (S.cart[s.p.id] ? "In bestelling" : "+ Toevoegen") + "</span>" })).join("") + "</div></div></div>";
    }
    html += '<div class="section"><div class="searchbox">' + K.icon("search") + '<input class="input" id="q" placeholder="Zoek een artikel (bv. zalm, garnalen)…" value="' + esc(S.q) + '" autocomplete="off"></div></div>';
    const names = Object.keys(cats);
    if (!names.length) html += c.empty({ icon: "🐟", text: q ? "Geen artikel gevonden voor “" + q + "”. Iets anders nodig? Zet het in de opmerking bij uw bestelling." : "De catalogus is leeg." });
    names.forEach((cat) => { html += '<div class="cat-group"><div class="cat-title">' + esc(cat) + "</div>" + cats[cat].map(productRow).join("") + "</div>"; });
    html += '<div style="height:80px"></div>';
    main.innerHTML = html;
    const qi = $("#q");
    qi.oninput = K.debounce(() => { S.q = qi.value; const pos = qi.selectionStart; renderBestellen(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); }, 150);
    if ($("#addAll")) $("#addAll").onclick = () => { sugg.forEach((s) => { if (!S.cart[s.p.id]) setQty(s.p.id, s.qty); }); K.toast("Vaste bestelling toegevoegd", "ok"); renderBestellen(); renderChrome(); };
    K.$$("[data-date]", main).forEach((b) => { b.onclick = () => { S.date = b.dataset.date; saveCart(); renderBestellen(); }; });
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
    K.$$("[data-add]", main).forEach((b) => { const pill = $(".pill", b); if (pill) { pill.className = "pill " + (S.cart[b.dataset.add] ? "pill-ok" : "pill-accent"); pill.textContent = S.cart[b.dataset.add] ? "In bestelling" : "+ Toevoegen"; } });
    renderCartbar(); renderChrome();
  }
  K.on(document, "click", "[data-inc]", (e, t) => { const p = product(t.dataset.inc); setQty(p.id, ((S.cart[p.id] || {}).qty || 0) + stepOf(p)); rerenderProduct(p.id); });
  K.on(document, "click", "[data-dec]", (e, t) => { const p = product(t.dataset.dec); setQty(p.id, ((S.cart[p.id] || {}).qty || 0) - stepOf(p)); rerenderProduct(p.id); });
  K.on(document, "change", "[data-qty]", (e, t) => { setQty(t.dataset.qty, t.value); rerenderProduct(t.dataset.qty); });
  K.on(document, "input", "[data-comment]", (e, t) => { const id = t.dataset.comment; if (S.cart[id]) { S.cart[id].comment = t.value.slice(0, 120); saveCart(); } });
  K.on(document, "click", "[data-add]", (e, t) => { const id = t.dataset.add; if (!S.cart[id]) { setQty(id, Number(t.dataset.qty) || 1); K.toast("Toegevoegd aan uw bestelling", "ok", 1500); } rerenderProduct(id); });

  function renderCartbar() {
    let bar = $(".cartbar");
    const n = cartCount();
    if (!n || S.view !== "bestellen" || !S.me) { if (bar) bar.remove(); return; }
    if (!bar) { bar = K.el('<div class="cartbar"><button class="btn btn-primary btn-lg" id="openCart"></button></div>'); document.body.appendChild(bar); $("#openCart").onclick = openCart; }
    $("#openCart").innerHTML = "<span>Bestelling bekijken <span class=\"pill pill-inverse\">" + n + "</span></span><span>" + K.eur(cartTotal()) + "</span>";
  }

  // ---- Mandje en bevestigen ----------------------------------------------------------------
  function openCart() {
    const body = document.createElement("div"), foot = document.createElement("div");
    let notice = "";
    function draw() {
      const lines = cartLines();
      body.innerHTML = (notice ? c.notice("warn", notice) : "") +
        '<div class="section"><div class="label" style="margin-bottom:8px">Leverdatum</div>' + dayChips(S.date) + "</div>" +
        '<div class="card pad-0 flat"><div class="list">' + (lines.length ? lines.map((l) => '<div class="item cart-line"><div class="body"><div class="title">' + esc(l.p.name) + '</div><div class="sub">' + K.eur(l.p.priceCents) + "/" + esc(K.unit(l.p.unit, 1)) + '</div><input class="input input-sm" data-ccomment="' + l.p.id + '" placeholder="Opmerking (bv. in filets)" value="' + esc(l.comment) + '" maxlength="120"></div><div class="cart-controls">' + stepper(l.p, l.qty) + '<div class="row spread"><b class="num">' + K.eur(Math.round(l.p.priceCents * l.qty)) + '</b><button type="button" class="btn btn-sm btn-ghost" data-remove="' + l.p.id + '">Verwijder</button></div></div></div>').join("") : c.empty({ text: "Uw bestelling is leeg." })) + "</div></div>" +
        c.field({ id: "note", label: "Opmerking voor het magazijn", multiline: true, rows: 3, value: S.note, attrs: ' maxlength="600" placeholder="Bv. graag vóór 9u, bellen bij aankomst, iets dat niet in de lijst staat…"' });
      foot.innerHTML = '<div class="row spread"><span class="muted">Totaal excl. btw</span><b class="num" style="font-size:1.25rem">' + K.eur(cartTotal()) + "</b></div>" +
        c.btn({ label: "Bestelling plaatsen", kind: "primary", size: "lg", block: true, id: "place", disabled: !(lines.length && S.date) });
      K.$$("[data-date]", body).forEach((b) => { b.onclick = () => { S.date = b.dataset.date; notice = ""; saveCart(); draw(); }; });
      K.$$("[data-remove]", body).forEach((b) => { b.onclick = () => { setQty(b.dataset.remove, 0); draw(); renderChrome(); rerenderProduct(b.dataset.remove); }; });
      K.$$("[data-ccomment]", body).forEach((i) => { i.oninput = () => { if (S.cart[i.dataset.ccomment]) { S.cart[i.dataset.ccomment].comment = i.value.slice(0, 120); saveCart(); } }; });
      $("#note", body).oninput = (e) => { S.note = e.target.value; saveCart(); };
      $("#place", foot).onclick = place;
    }
    const sheet = K.sheet({ title: "Uw bestelling", body, footer: foot, focus: false, onClose: () => { if (S.view === "bestellen" && S.me) renderBestellen(); } });
    sheet.body.addEventListener("click", (e) => { if (e.target.closest("[data-inc],[data-dec]")) setTimeout(draw, 0); });
    sheet.body.addEventListener("change", (e) => { if (e.target.closest("[data-qty]")) setTimeout(draw, 0); });
    draw();
    async function place() {
      const btn = $("#place", foot);
      const items = cartLines().map((l) => ({ productId: l.p.id, qty: l.qty, comment: l.comment }));
      await K.busy(btn, async () => {
        try {
          const r = await K.api("klant/bestellen", { body: { items, leverdatum: S.date, opmerking: S.note } });
          S.cart = {}; S.note = ""; saveCart(); S.orders = null;
          sheet.close();
          renderConfirm(r);
        } catch (err) {
          if (err.status === 401) return;
          if (err.status === 409) {
            try { S.me = await K.api("klant/mij"); } catch (_) { /* melding volgt */ }
            const old = S.date; ensureDate(); if (S.date === old) S.date = (S.me.deliveryDates[0] || {}).iso || "";
            saveCart();
            notice = "De leverdatum die u koos, is niet meer mogelijk. Wij hebben <b>" + esc(K.dateNl(S.date, true)) + "</b> gekozen. Kijk het na en bevestig opnieuw.";
            draw();
            return;
          }
          K.toast(err.message, "bad", 6000);
        }
      });
    }
  }
  function renderConfirm(r) {
    const o = r.order, m = r.mail || {}, co = S.me.company;
    const mailNote = m.client && m.client.ok ? "Een bevestiging is onderweg naar " + esc(S.me.client.email) + "." : (S.me.client.email ? "" : 'Voeg een e-mailadres toe onder <a href="#" data-go="account">Mijn account</a> om bevestigingen en facturen te ontvangen.');
    main.innerHTML = '<div class="login-wrap"><div class="card center"><div class="okmark">' + K.icon("check") + '</div><h1>Bestelling geplaatst</h1><p class="muted">Referentie <b>' + esc(o.ref) + "</b></p>" +
      "<p>Wij leveren <b>" + esc(K.dateNl(o.deliveryDate, true)) + "</b>.</p>" +
      '<div class="card flat" style="text-align:left;margin:14px 0"><div class="list">' + o.lines.map((l) => c.item({ button: false, attrs: ' style="padding:8px 12px"', title: esc(l.name), sub: K.qty(l.qty) + " " + esc(l.unitLabel) + (l.comment ? " · " + esc(l.comment) : ""), end: '<span class="num">' + K.eur(Math.round((l.priceCents || 0) * l.qty)) + "</span>" })).join("") + '</div><div class="row spread" style="padding:12px 12px 4px"><span class="muted">Totaal excl. btw</span><b class="num">' + K.eur(o.totalCents) + "</b></div></div>" +
      (mailNote ? '<p class="small muted">' + mailNote + "</p>" : "") +
      '<p class="small muted">Iets vergeten of verkeerd? Zolang de bestelling op Ontvangen staat, kunt u ze onder Mijn bestellingen annuleren en opnieuw plaatsen' + (co.phone ? ", of bel ons op " + c.tel(co.phone) : "") + ".</p>" +
      '<div class="stack">' + c.btn({ label: "Mijn bestellingen", kind: "primary", size: "lg", attrs: ' data-go="bestellingen"' }) + c.btn({ label: "Nieuwe bestelling", kind: "outline", attrs: ' data-go="bestellen"' }) + "</div></div></div>";
    S.view = "bestellingen"; K.route.set("bestellingen", {}, true); renderChrome(); renderCartbar(); window.scrollTo(0, 0);
  }

  // ---- Mijn bestellingen ------------------------------------------------------------------
  async function renderBestellingen() {
    main.innerHTML = '<div class="section-head"><h1>Mijn bestellingen</h1></div><div class="skeleton" style="height:80px"></div>';
    try { if (!S.orders) S.orders = (await K.api("klant/bestellingen")).orders; }
    catch (err) {
      if (err.status === 401) return;
      main.innerHTML = '<div class="section-head"><h1>Mijn bestellingen</h1></div>' + c.notice("bad", esc(err.message)) + '<div class="row" style="margin-top:12px">' + c.btn({ label: "Opnieuw proberen", kind: "outline", id: "retry" }) + "</div>";
      $("#retry").onclick = renderBestellingen;
      return;
    }
    const list = S.orders;
    const open = list.filter((o) => o.status !== "geleverd"), done = list.filter((o) => o.status === "geleverd");
    const row = (o) => c.item({ attrs: ' data-order="' + o.id + '"', title: esc(o.deliveryLabel) + ' <span class="muted small">· ' + esc(o.ref) + "</span>", sub: K.plural(o.lines.length, "artikel", "artikelen") + " · " + K.eur(o.status === "geleverd" && o.vat ? o.vat.inclCents : o.totalCents) + (o.status === "geleverd" && o.vat ? " incl. btw" : ""), end: K.chip(o.status, o.statusLabel) + (o.status === "geleverd" ? "<br>" + K.chip(o.paid ? "betaald" : "open", o.paymentLabel) : ""), chevron: true });
    main.innerHTML = '<div class="section-head"><h1>Mijn bestellingen</h1><button class="iconbtn" id="refresh" aria-label="Vernieuwen">' + K.icon("refresh") + "</button></div>" +
      (list.length ? '<div class="section"><h2 class="section-title">Gepland en onderweg</h2><div class="card pad-0 flat"><div class="list">' + (open.length ? open.map(row).join("") : c.empty({ text: "Geen open bestellingen.", action: c.btn({ label: "Bestel nu", kind: "primary", attrs: ' data-go="bestellen"' }) })) + "</div></div></div>" +
        '<div class="section"><h2 class="section-title">Geleverd</h2><div class="card pad-0 flat"><div class="list">' + (done.length ? done.map(row).join("") : c.empty({ text: "Nog geen leveringen." })) + "</div></div></div>"
        : c.empty({ icon: "🧾", text: "U hebt nog geen bestellingen geplaatst.", action: c.btn({ label: "Eerste bestelling plaatsen", kind: "primary", attrs: ' data-go="bestellen"' }) }));
    $("#refresh").onclick = async () => { S.orders = null; await renderBestellingen(); K.toast("Bijgewerkt", "ok", 1200); };
    if (S.openOrderId) { const id = S.openOrderId; S.openOrderId = ""; if (list.some((o) => o.id === id)) openOrder(id); else K.toast("Deze bestelling staat niet (meer) in uw lijst.", "bad"); }
  }
  K.on(document, "click", "[data-order]", (e, t) => openOrder(t.dataset.order));
  function openOrder(id) {
    const o = (S.orders || []).find((x) => x.id === id);
    if (!o) return;
    const co = S.me.company, phone = co.phone || "";
    K.route.set("bestellingen", { id }, true);
    const idx = ["ontvangen", "klaar", "onderweg", "geleverd"].indexOf(o.status);
    const totals = o.vat ? '<div class="totals-box"><div class="row spread"><span class="muted">Subtotaal excl. btw</span><span class="num">' + K.eur(o.vat.exclCents) + '</span></div><div class="row spread"><span class="muted">Btw ' + o.vat.ratePct + '%</span><span class="num">' + K.eur(o.vat.vatCents) + '</span></div><div class="row spread grand"><span>Totaal incl. btw</span><b class="num">' + K.eur(o.vat.inclCents) + "</b></div></div>"
      : '<div class="row spread" style="padding:12px 16px"><span class="muted">Totaal excl. btw</span><b class="num">' + K.eur(o.totalCents) + "</b></div>";
    const body = '<div class="row spread" style="margin-bottom:6px"><span class="muted">' + esc(o.ref) + " · besteld op " + esc(K.dateShort(o.date)) + "</span>" + K.chip(o.status, o.statusLabel) + "</div>" + K.timeline(idx) +
      '<p class="strong" style="margin-top:10px">Levering ' + esc(K.dateNl(o.deliveryDate, true)) + (o.deliveredAt ? " · ontvangen door " + esc(o.receivedBy) + " om " + esc(K.time(o.deliveredAt)) : "") + "</p>" +
      '<div class="card pad-0 flat"><div class="list">' + o.lines.map((l) => c.item({ button: false, cls: l.qty === 0 ? "line-off" : "", title: esc(l.name) + (l.qty === 0 ? ' <span class="pill pill-warn">niet geleverd</span>' : ""), sub: (l.qty === 0 ? "" : K.qty(l.qty) + " " + esc(l.unitLabel) + (l.priceCents != null ? " × " + K.eur(l.priceCents) : "")) + (l.comment ? (l.qty === 0 ? "" : " · ") + esc(l.comment) : ""), end: '<span class="num">' + (l.priceCents != null && l.qty > 0 ? K.eur(Math.round(l.priceCents * l.qty)) : "") + "</span>" })).join("") + "</div>" + totals + "</div>" +
      (o.notes ? '<p class="small muted" style="margin-top:10px"><b>Opmerking:</b> ' + esc(o.notes) + "</p>" : "") +
      (o.invoiceNumber ? '<p style="margin-top:10px">Factuur <b>' + esc(o.invoiceNumber) + "</b> · " + K.chip(o.paid ? "betaald" : "open", o.paymentLabel) + "</p>" : "") +
      (o.cancelable ? '<p class="small muted" style="margin-top:10px">Wilt u iets wijzigen? Annuleer deze bestelling en plaats ze opnieuw' + (phone ? ", of bel ons op " + c.tel(phone) : "") + ".</p>" : (o.status !== "geleverd" ? '<p class="small muted" style="margin-top:10px">Deze bestelling wordt al klaargezet. Wijzigen? ' + (phone ? "Bel ons op " + c.tel(phone) + "." : "Neem contact met ons op.") + "</p>" : ""));
    const foot = '<div class="row wrap">' + (o.docs.invoice ? c.btn({ label: "Factuur", kind: "outline", icon: "doc", href: o.docs.invoice, blank: true }) : "") + (o.docs.deliveryNote ? c.btn({ label: "Leveringsbon", kind: "outline", icon: "doc", href: o.docs.deliveryNote, blank: true }) : "") + (o.cancelable ? c.btn({ label: "Annuleren", kind: "ghost", id: "cancel", cls: "danger-text" }) : "") + c.btn({ label: "Opnieuw bestellen", kind: "primary", id: "reorder", attrs: ' style="margin-left:auto"' }) + "</div>";
    const s = K.sheet({ title: "Bestelling " + o.deliveryLabel, body, footer: foot, onClose: () => { if (S.view === "bestellingen") K.route.set("bestellingen", {}, true); } });
    $("#reorder", s.el).onclick = () => {
      let n = 0; const miss = [];
      o.lines.filter((l) => l.qty > 0).forEach((l) => { const p = S.me.catalogue.find((x) => x.name.toLowerCase() === l.name.toLowerCase()); if (p) { setQty(p.id, ((S.cart[p.id] || {}).qty || 0) + l.qty, l.comment); n++; } else miss.push(l.name); });
      s.close();
      if (!n) return K.toast("Deze artikelen zijn niet meer beschikbaar.", "bad");
      K.toast(K.plural(n, "artikel", "artikelen") + " toegevoegd" + (miss.length ? " (" + K.plural(miss.length, "artikel", "artikelen") + " niet meer beschikbaar)" : ""), "ok");
      go("bestellen"); setTimeout(openCart, 50);
    };
    if ($("#cancel", s.el)) $("#cancel", s.el).onclick = async () => {
      const reason = await K.prompt({ title: "Bestelling annuleren?", label: "Reden (optioneel)", placeholder: "Bv. dubbel besteld", yes: "Ja, annuleren" });
      if (reason === null) return;
      try { await K.api("klant/bestellingen/" + encodeURIComponent(o.id) + "/annuleren", { body: { reden: reason } }); S.orders = (S.orders || []).filter((x) => x.id !== o.id); s.close(); K.toast("Bestelling geannuleerd. Het team is verwittigd.", "ok", 4000); renderBestellingen(); }
      catch (err) { if (err.status !== 401) K.toast(err.message, "bad", 7000); }
    };
  }

  // ---- Account ------------------------------------------------------------------------------
  function renderAccount() {
    const cl = S.me.client, co = S.me.company;
    main.innerHTML = '<h1 style="margin-bottom:12px">Mijn account</h1><div class="grid grid-2">' +
      c.card('<p class="muted small">Klantnummer ' + esc(cl.number || "—") + (cl.vat ? " · Btw " + esc(cl.vat) : "") + '</p><div class="label">Leveradres</div><p>' + esc(cl.address || "—").replace(/\n/g, "<br>") + '</p><p class="small muted">Adres wijzigen? ' + (co.phone ? "Bel ons op " + c.tel(co.phone) : "Neem contact met ons op") + ", dan passen wij het aan.</p>", { title: cl.name }) +
      c.card('<form id="profileForm" class="stack">' + c.field({ id: "email", label: "E-mailadres (bevestigingen en facturen)", type: "email", value: cl.email, attrs: ' autocomplete="email"' }) + c.field({ id: "phone", label: "Telefoon", type: "tel", value: cl.phone, attrs: ' autocomplete="tel"' }) + c.btn({ label: "Opslaan", kind: "outline", type: "submit" }) + "</form>", { title: "Contact en meldingen" }) +
      c.card('<form id="pwForm" class="stack">' + c.field({ id: "cur", label: "Huidig wachtwoord", type: "password", attrs: ' autocomplete="current-password" required' }) + c.field({ id: "new", label: "Nieuw wachtwoord (min. 8 tekens)", type: "password", attrs: ' autocomplete="new-password" minlength="8" required' }) + c.field({ id: "new2", label: "Nieuw wachtwoord nogmaals", type: "password", attrs: ' autocomplete="new-password" minlength="8" required' }) + c.btn({ label: "Wachtwoord wijzigen", kind: "outline", type: "submit" }) + '</form><p class="small muted" style="margin-top:8px">Gebruikersnaam: <b>' + esc(cl.username) + "</b></p>", { title: "Wachtwoord" }) +
      c.card('<p class="small">' + esc([co.street, co.city].filter(Boolean).join(", ")) + "<br>" + [c.tel(co.phone), c.mail(co.email)].filter(Boolean).join("<br>") + '</p><p class="small muted">Besteldeadline ' + esc(S.me.cutoff) + ". Wij leveren op " + esc(K.humanDays(co.deliveryDays) || co.deliveryDays) + ".</p>" + c.btn({ label: "Afmelden", kind: "ghost", id: "logout2" }), { title: co.companyName }) + "</div>";
    K.pwToggle($("#cur")); K.pwToggle($("#new")); K.pwToggle($("#new2"));
    $("#profileForm").onsubmit = async (e) => { e.preventDefault(); await K.busy($("button", e.target), async () => { try { await K.api("klant/profiel", { body: { email: $("#email").value, phone: $("#phone").value } }); S.me.client.email = $("#email").value.trim().toLowerCase(); S.me.client.phone = $("#phone").value; K.toast("Opgeslagen", "ok"); } catch (err) { if (err.status !== 401) K.toast(err.message, "bad"); } }); };
    $("#pwForm").onsubmit = async (e) => { e.preventDefault(); if ($("#new").value !== $("#new2").value) return K.toast("De twee nieuwe wachtwoorden zijn niet gelijk.", "bad"); await K.busy($("button", e.target), async () => { try { await K.api("klant/wachtwoord", { body: { huidig: $("#cur").value, nieuw: $("#new").value } }); e.target.reset(); K.toast("Wachtwoord gewijzigd", "ok"); } catch (err) { if (err.status !== 401) K.toast(err.message, "bad"); } }); };
    $("#logout2").onclick = logout;
  }

  // ---- Render ----------------------------------------------------------------------------------
  function render() {
    renderChrome(); renderCartbar();
    if (!S.me) return renderLogin();
    if (S.view === "bestellingen") return renderBestellingen();
    if (S.view === "account") return renderAccount();
    renderBestellen();
  }
  async function boot() {
    const q = K.qs();
    if (q.reset) return renderReset(q.reset);
    try { S.me = await K.api("klant/mij"); afterLogin(); }
    catch (err) {
      if (err.status === 401) { if (q.bestelling) K.pending.set({ view: "bestellingen", params: { id: q.bestelling } }); K.stripQuery(); renderLogin(/wachtwoord/i.test(err.message) ? err.message : ""); }
      else if (!(err.status === 503 && err.data && err.data.notConfigured)) K.renderFatal(main, err.message, boot);
    }
  }
  boot();
})();
