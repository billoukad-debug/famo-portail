/* Teamportaal: bord van de dag, klaarzetten, vertrek, levering, telefonische bestellingen. */
(function () {
  "use strict";
  const $ = K.$, esc = K.esc, c = K.c;
  const main = $("#main"), nav = $("#nav"), tabbar = $("#tabbar"), who = $("#who");
  const VIEWS = ["board", "nieuw", "historiek"];
  const COLS = [["ontvangen", "Klaarzetten"], ["klaar", "Klaargezet"], ["onderweg", "Onderweg"]];
  const S = { role: null, view: "board", data: null, filter: K.store.get("filter", "vandaag"), col: K.store.get("col", "ontvangen"), hist: null, histQ: "", histRange: 30, histSeq: 0, histLoading: false, histError: "", lastLoaded: 0, lastFailed: false, known: null, fresh: {}, photos: {}, catalog: {}, openId: "" };
  const isNarrow = () => window.innerWidth < 900;

  // ---- Chrome ------------------------------------------------------------------------------
  const TABS = { board: ["Vandaag", "box"], nieuw: ["Nieuw", "phone"], historiek: ["Historiek", "list"], meer: ["Meer", "settings"] };
  function renderChrome() {
    const on = !!S.role;
    nav.hidden = !on; tabbar.hidden = !on;
    who.innerHTML = on ? '<span class="pill ' + (S.role === "admin" ? "pill-accent" : "pill-info") + '">' + (S.role === "admin" ? "Beheerder" : "Team") + '</span><a href="/" class="topbar-link">Klantportaal</a>' + (S.role === "admin" ? '<a href="/beheer" class="topbar-link">Beheer</a>' : "") + '<button class="btn btn-sm btn-ghost topbar-btn desktop-only" id="logout">Afmelden</button>' : "";
    if (on) $("#logout").onclick = confirmLogout;
    K.$$("[data-go]", nav).forEach((b) => b.classList.toggle("on", b.dataset.go === S.view));
    K.$$("[data-go]", tabbar).forEach((b) => {
      const [label, icon] = TABS[b.dataset.go];
      const n = b.dataset.go === "board" && S.data ? visibleOrders().length : 0;
      b.innerHTML = K.icon(icon) + "<span>" + label + "</span>" + (n ? '<span class="count">' + n + "</span>" : "");
      b.classList.toggle("on", b.dataset.go === S.view);
    });
  }
  function go(view, params, replace) { S.view = view; K.route.set(view, params, replace); render(); window.scrollTo(0, 0); }
  K.on(document, "click", "[data-go]", (e, t) => { e.preventDefault(); if (t.dataset.go === "meer") return renderMeer(); go(t.dataset.go); });
  K.route.onChange((r) => { if (!S.role) return; const v = VIEWS.includes(r.view) ? r.view : "board"; if (r.params.q !== undefined && r.params.q !== S.histQ) S.histQ = r.params.q; if (v !== S.view) { S.view = v; render(); } });
  document.addEventListener("kade:unauthorized", (e) => {
    if (!S.role) return;
    K.pending.set({ view: S.view, params: S.openId ? { bestelling: S.openId } : {} });
    K.closeSheets(); S.role = null; S.data = null; renderChrome();
    renderLogin(e.detail && e.detail.message ? e.detail.message : "Uw sessie is verlopen. Meld u opnieuw aan.");
  });
  async function confirmLogout() { if (!(await K.confirm({ title: "Afmelden?", text: "U hebt de code nodig om opnieuw aan te melden.", yes: "Afmelden" }))) return; logout(); }
  async function logout() { await K.api("team/logout", { body: {} }).catch(() => {}); K.closeSheets(); S.role = null; S.data = null; renderChrome(); K.route.set("", {}, true); renderLogin(); K.toast("Afgemeld", "ok"); }
  function renderMeer() {
    const t = today(), tm = tomorrow();
    const s = K.sheet({ title: "Meer", body: '<div class="big-actions">' + c.btn({ label: "Picklijst vandaag", kind: "outline", icon: "print", href: "/doc/picklijst?dag=" + t, blank: true }) + c.btn({ label: "Picklijst morgen", kind: "outline", icon: "print", href: "/doc/picklijst?dag=" + tm, blank: true }) + c.btn({ label: "Alle leveringsbonnen vandaag", kind: "outline", icon: "print", href: "/doc/leveringsbonnen?dag=" + t, blank: true }) + c.btn({ label: "Klantportaal", kind: "outline", href: "/" }) + (S.role === "admin" ? c.btn({ label: "Beheer", kind: "outline", icon: "settings", href: "/beheer" }) : "") + c.btn({ label: "Afmelden", kind: "ghost", id: "lo" }) + "</div>", footer: false });
    $("#lo", s.el).onclick = () => { s.close(); confirmLogout(); };
  }

  // ---- Aanmelden -----------------------------------------------------------------------------
  function renderLogin(err) {
    main.innerHTML = '<div class="login-wrap"><div class="card"><h1>Teamportaal</h1><p class="muted">Meld u aan met de teamcode of de beheerderscode.</p><form id="f" class="stack">' + c.field({ id: "code", label: "Code", type: "password", attrs: ' autocomplete="current-password" required style="font-size:1.2rem;letter-spacing:1px"' }) + (err ? c.notice("bad", esc(err)) : "") + c.btn({ label: "Aanmelden", kind: "primary", size: "lg", block: true, type: "submit" }) + '</form><p class="small muted" style="margin-top:14px">Code kwijt? Vraag ze aan de beheerder.</p></div><p class="small muted center" style="margin-top:18px"><a href="/">Klantportaal</a> · <a href="/beheer">Beheer</a></p></div>';
    K.pwToggle($("#code")); $("#code").focus();
    $("#f").onsubmit = async (e) => { e.preventDefault(); await K.busy($("button", e.target), async () => { try { const r = await K.api("team/login", { body: { code: $("#code").value } }); S.role = r.role; await afterLogin(); } catch (err) { renderLogin(err.message); } }); };
  }
  async function afterLogin() {
    const q = K.qs(); K.stripQuery();
    const pending = K.pending.take();
    const r = K.route.get();
    S.view = VIEWS.includes(r.view) ? r.view : "board";
    if (r.params.q) S.histQ = r.params.q;
    if (pending && VIEWS.includes(pending.view)) S.view = pending.view;
    try { await load(); } catch (err) { if (err.status === 401) return; return K.renderFatal(main, err.message, afterLogin); }
    render();
    const open = q.bestelling || (pending && pending.params && pending.params.bestelling);
    if (open) openOrder(open);
  }

  // ---- Gegevens ------------------------------------------------------------------------------
  async function load({ silent } = {}) {
    try {
      const d = await K.api("team/overzicht");
      if (S.known) { const now = Date.now(); d.orders.forEach((o) => { if (!S.known.has(o.id) && o.status === "ontvangen") { S.fresh[o.id] = now; if (silent) K.toast("Nieuwe bestelling: " + ((o.client || {}).name || "?") + " · " + o.deliveryLabel, "ok", 8000); } }); }
      S.known = new Set(d.orders.map((o) => o.id));
      S.data = d; S.lastLoaded = Date.now(); S.lastFailed = false;
      const ids = new Set(d.orders.map((o) => o.id));
      try { Object.keys(localStorage).filter((k) => k.startsWith("kade:check:")).forEach((k) => { if (!ids.has(k.slice(11))) localStorage.removeItem(k); }); } catch (_) { /* niets */ }
      renderChrome();
    } catch (err) { S.lastFailed = true; throw err; }
  }
  function order(id) { return (S.data ? S.data.orders : []).concat(S.hist || []).find((o) => o.id === id); }
  function replaceOrder(o) {
    if (S.data) { const i = S.data.orders.findIndex((x) => x.id === o.id); if (i >= 0) S.data.orders[i] = o; else S.data.orders.unshift(o); }
    if (S.hist) { const i = S.hist.findIndex((x) => x.id === o.id); if (i >= 0) S.hist[i] = o; }
  }
  function removeOrder(id) { if (S.data) S.data.orders = S.data.orders.filter((x) => x.id !== id); if (S.hist) S.hist = S.hist.filter((x) => x.id !== id); }
  function today() { return S.data ? S.data.today : K.todayISO(); }
  function tomorrow() { return K.addDays(today(), 1); }
  function visibleOrders() {
    if (!S.data) return [];
    const t = today(), tm = tomorrow();
    let list = S.data.orders.filter((o) => o.status !== "geleverd");
    if (S.filter === "vandaag") list = list.filter((o) => o.deliveryDate <= t);
    if (S.filter === "morgen") list = list.filter((o) => o.deliveryDate === tm);
    if (S.filter === "later") list = list.filter((o) => o.deliveryDate > tm);
    return list.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || postcode(a).localeCompare(postcode(b)) || ((a.client || {}).name || "").localeCompare((b.client || {}).name || ""));
  }
  function postcode(o) { const m = String((o.client || {}).address || "").match(/\b\d{4}\b/); return m ? m[0] : "9999"; }
  function dayOf(iso) { const t = today(); if (iso < t) return "Te laat · " + K.dateNl(iso); if (iso === t) return "Vandaag"; if (iso === tomorrow()) return "Morgen"; return K.dateNl(iso, true); }
  function dateBrussels(ts) { if (!ts) return ""; try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts)); } catch (_) { return String(ts).slice(0, 10); } }
  function mailOn() { return !!(S.data && S.data.mailEnabled); }
  function incl(o) { return o.vat ? o.vat.inclCents : o.totalCents; }

  // ---- Bord --------------------------------------------------------------------------------------
  function renderBoard() {
    if (!S.data) { main.innerHTML = '<div class="skeleton" style="height:120px"></div>'; return; }
    const t = today(), tm = tomorrow();
    const orders = visibleOrders();
    const dag = S.filter === "morgen" ? tm : t;
    const readyCount = S.data.orders.filter((o) => o.status === "klaar" && o.deliveryDate <= t).length;
    const stale = S.lastFailed || Date.now() - S.lastLoaded > 5 * 60 * 1000;
    const delivered = S.data.orders.filter((o) => o.status === "geleverd" && (o.deliveredAt ? dateBrussels(o.deliveredAt) === t : o.deliveryDate === t));
    const cashCents = delivered.filter((o) => o.paid).reduce((s, o) => s + incl(o), 0);
    const col = (key, title) => {
      const list = orders.filter((o) => o.status === key);
      let inner = "";
      if (!list.length) inner = '<div class="empty small">' + (key === "ontvangen" ? "Niets meer klaar te zetten." : key === "klaar" ? "Niets klaargezet." : "Niemand onderweg.") + "</div>";
      else { let lastDay = null; list.forEach((o) => { const d = dayOf(o.deliveryDate); if (S.filter !== "vandaag" && d !== lastDay) { inner += '<div class="col-day">' + esc(d) + "</div>"; lastDay = d; } inner += card(o); }); }
      return '<div class="col' + (isNarrow() && S.col !== key ? " hide-narrow" : "") + '" data-col="' + key + '"><div class="col-head"><span>' + title + '</span><span class="n">' + list.length + "</span></div>" + inner + "</div>";
    };
    main.innerHTML = '<div class="section-head"><div><h1>' + esc(K.dateNl(t, true)) + '</h1><div class="small ' + (stale ? "warn-text" : "muted") + '">' + K.plural(orders.length, "open bestelling", "open bestellingen") + (S.lastLoaded ? " · bijgewerkt om " + K.time(new Date(S.lastLoaded).toISOString()) : "") + (S.lastFailed ? " · vernieuwen mislukt" : "") + "</div></div>" +
      '<div class="row wrap">' + c.btn({ label: "Picklijst " + (S.filter === "morgen" ? "morgen" : "vandaag"), kind: "outline", icon: "print", href: "/doc/picklijst?dag=" + dag, blank: true }) + c.btn({ label: "Leveringsbonnen", kind: "outline", icon: "print", href: "/doc/leveringsbonnen?dag=" + dag, blank: true }) + (readyCount ? c.btn({ label: "Ronde vertrekt (" + readyCount + ")", kind: "primary", icon: "truck", id: "shipAll" }) : "") + '<button class="iconbtn" id="refresh" aria-label="Vernieuwen" title="Vernieuwen">' + K.icon("refresh") + "</button></div></div>" +
      '<div class="row wrap" style="margin-bottom:12px;gap:8px"><div class="segmented">' + [["vandaag", "Vandaag + te laat"], ["morgen", "Morgen"], ["later", "Later"], ["alle", "Alle"]].map(([k, l]) => '<button data-f="' + k + '" class="' + (S.filter === k ? "on" : "") + '">' + l + "</button>").join("") + "</div>" +
      (isNarrow() ? '<div class="segmented" id="colTabs">' + COLS.map(([k, l]) => '<button data-c="' + k + '" class="' + (S.col === k ? "on" : "") + '">' + l + ' <span class="n-inline">' + orders.filter((o) => o.status === k).length + "</span></button>").join("") + "</div>" : "") + "</div>" +
      '<div class="board">' + COLS.map(([k, l]) => col(k, l)).join("") + "</div>" +
      '<div class="section" style="margin-top:20px"><div class="section-head"><h2>Vandaag geleverd</h2>' + (cashCents ? '<span class="pill pill-ok">Betaald ontvangen: ' + K.eur(cashCents) + "</span>" : "") + '</div><div class="card pad-0 flat"><div class="list">' + (delivered.length ? delivered.map((o) => c.item({ attrs: ' data-open="' + o.id + '"', title: esc((o.client || {}).name || "—") + ' <span class="muted small">· ' + esc(o.invoiceNumber || o.ref) + "</span>", sub: esc(o.receivedBy ? "ontvangen door " + o.receivedBy + (o.deliveredAt ? " om " + K.time(o.deliveredAt) : "") : ""), end: K.chip(o.paid ? "betaald" : "open", o.paymentLabel) + '<div class="num small">' + K.eur(incl(o)) + " incl.</div>", chevron: true })).join("") : c.empty({ text: "Nog geen leveringen vandaag." })) + "</div></div></div>";
    $("#refresh").onclick = async () => { try { await K.busy($("#refresh"), () => load()); K.toast("Bijgewerkt", "ok", 1200); } catch (err) { K.toast("Vernieuwen mislukt: " + err.message, "bad"); } renderBoard(); };
    K.$$("[data-f]").forEach((b) => { b.onclick = () => { S.filter = b.dataset.f; K.store.set("filter", S.filter); renderBoard(); renderChrome(); }; });
    K.$$("[data-c]").forEach((b) => { b.onclick = () => { S.col = b.dataset.c; K.store.set("col", S.col); renderBoard(); }; });
    if ($("#shipAll")) $("#shipAll").onclick = shipAll;
  }
  async function shipAll() {
    const t = today();
    const list = S.data.orders.filter((o) => o.status === "klaar" && o.deliveryDate <= t);
    if (!(await K.confirm({ title: "Ronde vertrekt?", text: K.plural(list.length, "klaargezette bestelling", "klaargezette bestellingen") + " voor vandaag gaan op Onderweg." + (mailOn() ? " Elke klant met e-mailadres krijgt nu een bericht." : ""), yes: "Ja, vertrekken" }))) return;
    await K.busy($("#shipAll"), async () => {
      try {
        const r = await K.api("team/onderweg-alles", { body: { dag: t } });
        await load();
        renderBoard();
        if (r.failed.length) {
          K.sheet({ title: K.plural(r.shipped, "bestelling", "bestellingen") + " onderweg · " + r.failed.length + " mislukt", body: '<div class="list">' + r.failed.map((f) => { const o = S.data.orders.find((x) => x.ref === f.ref) || {}; return c.item({ attrs: o.id ? ' data-open="' + o.id + '"' : "", title: esc((o.client || {}).name || f.ref), sub: esc(f.error), chevron: !!o.id }); }).join("") + "</div>", footer: false });
        } else K.toast(K.plural(r.shipped, "bestelling", "bestellingen") + " onderweg" + (r.mails ? " · " + K.plural(r.mails, "klant", "klanten") + " verwittigd" : ""), "ok", 5000);
      } catch (err) { if (err.status !== 401) K.toast(err.message, "bad"); }
    });
  }
  function card(o) {
    const cl = o.client || {}, t = today();
    const late = o.deliveryDate < t, far = o.deliveryDate > tomorrow();
    const fresh = S.fresh[o.id] && Date.now() - S.fresh[o.id] < 10 * 60 * 1000;
    const off = o.lines.filter((l) => l.unavailable).length;
    const driver = o.status !== "ontvangen";
    return '<div class="ocard' + (late ? " late" : "") + (far ? " far" : "") + '" data-open="' + o.id + '" role="button" tabindex="0"><div class="t"><b>' + esc(cl.name || "Onbekende klant") + (fresh ? ' <span class="pill pill-accent">Nieuw</span>' : "") + '</b><span class="' + (late ? "pill pill-warn" : "muted small") + '">' + esc(late ? "Te laat · " + K.relDay(o.deliveryDate) : o.deliveryLabel) + "</span></div>" +
      (driver ? '<div class="addr">' + esc(String(cl.address || "").replace(/\n/g, ", ")) + "</div>" : "") +
      '<div class="lines">' + o.lines.map((l) => (l.unavailable ? "<s>" + esc(l.name) + "</s>" : K.qty(l.qty) + " " + esc(K.unit(l.unit, l.qty)) + " " + esc(l.name))).join(" · ") + "</div>" +
      (o.notes ? '<div class="note-line">' + K.icon("warn") + " " + esc(o.notes.slice(0, 80)) + (o.notes.length > 80 ? "…" : "") + "</div>" : "") +
      (driver && cl.notes ? '<div class="note-line info">' + K.icon("clock") + " " + esc(cl.notes.slice(0, 80)) + "</div>" : "") +
      '<div class="f"><span>' + (driver ? "Te betalen " + K.eur(incl(o)) : K.plural(o.lines.length, "artikel", "artikelen")) + (off ? ' · <span class="pill pill-warn">' + off + " niet geleverd</span>" : "") + (o.source !== "Klantportaal" ? ' · <span class="pill">' + esc(o.source) + "</span>" : "") + "</span>" +
      (driver ? '<span class="row" style="gap:6px">' + (cl.phone ? '<a class="iconbtn sm" href="tel:' + esc(String(cl.phone).replace(/\s/g, "")) + '" data-stop aria-label="Bellen">' + K.icon("phone") + "</a>" : "") + (cl.address ? '<a class="iconbtn sm" target="_blank" rel="noopener" href="' + esc(K.mapsUrl(cl.address)) + '" data-stop aria-label="Route">' + K.icon("truck") + "</a>" : "") + "</span>" : "") + "</div></div>";
  }
  K.on(document, "click", "[data-stop]", (e) => { e.stopPropagation(); });
  K.on(document, "click", "[data-open]", (e, t) => { if (e.target.closest("[data-stop]")) return; openOrder(t.dataset.open); });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches && e.target.matches(".ocard[data-open]")) openOrder(e.target.dataset.open); });

  // ---- Bestelling (blad) ---------------------------------------------------------------------------
  const checks = { key(l) { return l.name.toLowerCase() + "|" + l.unit; }, get(id) { return K.store.get("check:" + id, {}); }, set(id, v) { K.store.set("check:" + id, v); } };
  let current = null;
  async function openOrder(id) {
    if (current && current.id === id) return;
    let o = order(id);
    const body = document.createElement("div"), foot = document.createElement("div");
    let receivers = [];
    const sheet = K.sheet({ title: o ? ((o.client || {}).name || "Bestelling") : "Bestelling", body, footer: foot, wide: true, focus: false, onClose: () => { current = null; S.openId = ""; if (S.view === "board") renderBoard(); if (S.view === "historiek") drawHist(); } });
    current = { id, sheet, body, foot }; S.openId = id;
    if (o) drawOrder(); else body.innerHTML = '<div class="skeleton" style="height:120px"></div>';
    try { const r = await K.api("team/bestellingen/" + encodeURIComponent(id)); replaceOrder(r.order); receivers = r.receivers || []; o = r.order; const h = $("h2", sheet.el); if (h) h.textContent = (o.client || {}).name || "Bestelling"; drawOrder(); }
    catch (err) { if (err.status === 401) return; if (!o) { body.innerHTML = c.notice("bad", esc(err.message)); foot.innerHTML = ""; } else K.toast("Kon de laatste versie niet ophalen: " + err.message, "bad"); }

    async function act(path, payload, btn, okMsg) {
      return K.busy(btn, async () => {
        try {
          const r = await K.api("team/bestellingen/" + encodeURIComponent(id) + "/" + path, { body: payload || {} });
          if (r.order) replaceOrder(r.order);
          if (r.warnings && r.warnings.length) r.warnings.forEach((w) => K.toast(w, "bad", 6000));
          if (okMsg) K.toast(okMsg, "ok");
          drawOrder();
          return r;
        } catch (err) {
          if (err.status === 401) return null;
          if (err.status === 409) { try { const r2 = await K.api("team/bestellingen/" + encodeURIComponent(id)); replaceOrder(r2.order); } catch (_) { /* toon oude */ } drawOrder(); }
          K.toast(err.message, "bad", 7000);
          return null;
        }
      });
    }
    const plain = (x) => (x.productId ? { productId: x.productId, qty: x.qty, comment: x.comment || "" } : { name: x.name, qty: x.qty, unit: x.unit, comment: x.comment || "", unavailable: !!x.unavailable });
    function linesPayload(lines) { return { lijnen: lines.map(plain), basis: o.linesText }; }
    function drawOrder() {
      o = order(id); if (!o) return;
      const cl = o.client || {};
      const done = o.status === "geleverd";
      const head = '<div class="row spread wrap" style="margin-bottom:6px"><div class="muted small">' + esc(o.ref) + " · besteld " + esc(K.dateShort(o.date)) + (o.source !== "Klantportaal" ? " · " + esc(o.source) : "") + "</div>" + K.chip(o.status, o.statusLabel) + "</div>" +
        '<div class="row spread wrap" style="margin-bottom:4px"><b>Levering ' + esc(K.dateNl(o.deliveryDate, true)) + "</b>" + (done ? "" : c.btn({ label: "Wijzig datum", kind: "ghost", size: "sm", id: "chDate" })) + "</div>" + K.timeline(o.statusIndex) +
        '<div class="card flat client-card"><div class="row spread wrap"><div><b>' + esc(cl.name || "—") + '</b> <span class="muted small">' + esc(cl.number || "") + '</span><div class="small">' + esc(String(cl.address || "").replace(/\n/g, ", ")) + '</div></div><div class="row wrap">' + (cl.address ? c.btn({ label: "Route", kind: "outline", size: "sm", icon: "truck", href: K.mapsUrl(cl.address), blank: true }) : "") + (cl.phone ? c.btn({ label: "Bellen", kind: "outline", size: "sm", icon: "phone", href: "tel:" + String(cl.phone).replace(/\s/g, "") }) : "") + "</div></div></div>" +
        (cl.notes ? c.notice("info", "<b>Leverinstructie:</b> " + esc(cl.notes)) : "") +
        (o.notes ? c.notice("warn", "<b>Opmerking van de klant:</b> " + esc(o.notes)) : "") +
        ((o.internalNotes || []).length ? '<div class="internal"><div class="label">Intern</div>' + o.internalNotes.map((n) => "<div>" + esc(n) + "</div>").join("") + "</div>" : "");
      let lines = "";
      const ck = checks.get(id);
      if (o.status === "ontvangen") {
        lines = '<div class="card pad-0 flat">' + o.lines.map((l, i) => {
          if (l.unparsed) return '<div class="checkline"><div class="box"></div><div class="n"><span class="warn-text">Onleesbare lijn:</span> ' + esc(l.name) + "</div>" + c.btn({ label: "Wijzig", kind: "outline", size: "sm", attrs: ' data-edit="' + i + '"' }) + "</div>";
          const k = checks.key(l), on = !!ck[k];
          if (l.unavailable) return '<div class="checkline off"><div class="box"></div><div class="n"><s>' + esc(l.name) + '</s> <span class="pill pill-warn">niet geleverd</span>' + (l.comment ? '<div class="c">' + esc(l.comment) + "</div>" : "") + "</div>" + c.btn({ label: "Wijzig", kind: "outline", size: "sm", attrs: ' data-edit="' + i + '"' }) + "</div>";
          return '<div class="checkline' + (on ? " done" : "") + '"><button type="button" class="tick" data-ck="' + esc(k) + '" aria-pressed="' + on + '"><div class="box">' + (on ? K.icon("check") : "") + '</div><div class="n">' + esc(l.name) + (l.comment ? '<div class="c">' + esc(l.comment) + "</div>" : "") + "</div></button>" +
            '<div class="qstep"><button type="button" data-qdec="' + i + '" aria-label="Minder">−</button><button type="button" class="qval" data-qedit="' + i + '">' + K.qty(l.qty) + " " + esc(K.unit(l.unit, l.qty)) + '</button><button type="button" data-qinc="' + i + '" aria-label="Meer">+</button></div>' +
            c.btn({ label: "Wijzig", kind: "outline", size: "sm", attrs: ' data-edit="' + i + '"' }) + "</div>";
        }).join("") + "</div>" +
          '<div class="row wrap" style="margin-top:10px">' + c.btn({ label: "Artikel toevoegen", kind: "outline", size: "sm", icon: "plus", id: "addLine" }) + c.btn({ label: "Opmerking klant", kind: "ghost", size: "sm", id: "editNote" }) + c.btn({ label: "Interne notitie", kind: "ghost", size: "sm", id: "intNote" }) + photoControl() + "</div>";
      } else {
        lines = '<div class="card pad-0 flat"><table class="table"><tbody>' + o.lines.map((l, i) => '<tr class="' + (l.unavailable ? "off" : "") + '"><td class="num strong" style="width:110px">' + (l.unavailable ? "—" : K.qty(l.qty) + " " + esc(K.unit(l.unit, l.qty))) + "</td><td>" + (l.unavailable ? "<s>" + esc(l.name) + '</s> <span class="pill pill-warn">niet geleverd</span>' : esc(l.name)) + (l.comment ? '<div class="small accent-text">' + esc(l.comment) + "</div>" : "") + '</td><td class="num muted">' + (l.priceCents != null && !l.unavailable ? K.eur(Math.round(l.priceCents * l.qty)) : "") + "</td>" + (done ? "" : '<td style="width:1%">' + c.btn({ label: "Wijzig", kind: "ghost", size: "sm", attrs: ' data-edit="' + i + '"' }) + "</td>") + "</tr>").join("") + "</tbody></table>" +
          '<div class="totals-box"><div class="row spread"><span class="muted">Totaal excl. btw</span><span class="num">' + K.eur(o.totalCents) + '</span></div><div class="row spread grand"><span>Te betalen incl. btw</span><b class="num">' + K.eur(incl(o)) + "</b></div></div></div>" +
          (done ? "" : '<div class="row wrap" style="margin-top:10px">' + c.btn({ label: "Artikel toevoegen", kind: "outline", size: "sm", icon: "plus", id: "addLine" }) + c.btn({ label: "Interne notitie", kind: "ghost", size: "sm", id: "intNote" }) + (o.status === "klaar" ? photoControl() : "") + '</div><p class="small muted" style="margin-top:6px">Artikel geweigerd of beschadigd aan de deur? Wijzig de lijn vóór u de levering bevestigt; de factuur volgt wat echt geleverd werd.</p>');
      }
      let after = "";
      if (done) after = c.notice("ok", "Ontvangen door <b>" + esc(o.receivedBy || "—") + "</b> op " + esc(K.dateTime(o.deliveredAt)) + "<br>Factuur <b>" + esc(o.invoiceNumber || "—") + "</b> · " + K.chip(o.paid ? "betaald" : "open", o.paymentLabel) + '<div class="row wrap" style="margin-top:8px">' + c.btn({ label: "Naam ontvanger corrigeren", kind: "ghost", size: "sm", id: "fixRecv" }) + c.btn({ label: "Foto bij levering", kind: "ghost", size: "sm", id: "delPhoto" }) + "</div>") + ((o.proof || []).length ? '<div class="row wrap">' + o.proof.map((p) => '<a href="' + esc(p.url) + '" target="_blank" rel="noopener"><img src="' + esc(p.thumb || p.url) + '" alt="Bewijs van levering" class="proof-thumb"></a>').join("") + "</div>" : "");
      if ((o.prepPhoto || []).length) after += '<div class="row wrap" style="margin-top:8px"><span class="label">Foto klaargezet</span>' + o.prepPhoto.map((p) => '<a href="' + esc(p.url) + '" target="_blank" rel="noopener"><img src="' + esc(p.thumb || p.url) + '" alt="Foto klaargezet" class="proof-thumb"></a>').join("") + "</div>";
      body.innerHTML = head + lines + after;
      let f = '<div class="big-actions">';
      if (o.status === "ontvangen") f += c.btn({ label: "Alles klaargezet", kind: "ok", icon: "check", id: "ready" });
      if (o.status === "klaar") f += c.btn({ label: "Onderweg zetten", kind: "primary", icon: "truck", id: "ship" }) + c.btn({ label: "Levering bevestigen (zonder onderweg-bericht)", kind: "outline", id: "deliver" });
      if (o.status === "onderweg") f += c.btn({ label: "Levering bevestigen", kind: "ok", icon: "check", id: "deliver" }) + c.btn({ label: "Niet kunnen leveren", kind: "outline", id: "notDelivered" });
      if (done) f += c.btn({ label: o.paid ? "Markeer als openstaand" : "Markeer als betaald", kind: o.paid ? "outline" : "primary", id: "paid" }) + nextStopButton();
      f += "</div>" + '<div class="row wrap">' + c.btn({ label: "Leveringsbon", kind: "outline", size: "sm", icon: "print", href: o.docs.deliveryNote, blank: true }) + (done || S.role === "admin" ? c.btn({ label: "Factuur" + (o.invoiceNumber ? "" : " (ontwerp)"), kind: "outline", size: "sm", icon: "doc", href: o.docs.invoice, blank: true }) : "") + (o.docs.deliveryNoteShare ? c.btn({ label: "Bon doorsturen", kind: "ghost", size: "sm", id: "share" }) : "") + c.btn({ label: "E-mail opnieuw", kind: "ghost", size: "sm", id: "remail" }) +
        (o.status === "klaar" ? c.btn({ label: "Terug naar Ontvangen", kind: "ghost", size: "sm", icon: "back", id: "back" }) : "") + (o.status === "onderweg" ? c.btn({ label: "Terug naar Klaargezet", kind: "ghost", size: "sm", icon: "back", id: "back" }) : "") + (o.status === "ontvangen" ? c.btn({ label: "Verwijderen", kind: "ghost", size: "sm", id: "del", cls: "danger-text", attrs: ' style="margin-left:auto"' }) : "") + "</div>";
      foot.innerHTML = f;
      bind();
    }
    function photoControl() {
      const p = S.photos[id];
      return '<label class="btn btn-sm btn-ghost" style="cursor:pointer">' + K.icon("box") + ' Foto <input type="file" accept="image/*" capture="environment" id="photo" hidden></label>' + (p ? '<span class="photo-pending"><img src="' + p + '" alt=""><button type="button" class="iconbtn sm" id="photoRm" aria-label="Foto verwijderen">' + K.icon("x") + "</button></span>" : "");
    }
    function nextStopButton() {
      const next = (S.data ? visibleOrders() : []).find((x) => x.status === "onderweg" && x.id !== id);
      return next ? c.btn({ label: "Volgende stop: " + ((next.client || {}).name || next.ref), kind: "outline", icon: "truck", id: "next", attrs: ' data-next="' + next.id + '"' }) : c.btn({ label: "Naar het bord", kind: "outline", id: "toBoard" });
    }
    function bind() {
      K.$$("[data-ck]", body).forEach((el) => { el.onclick = () => { const v = checks.get(id); const k = el.dataset.ck; v[k] = !v[k]; checks.set(id, v); drawOrder(); }; });
      K.$$("[data-edit]", body).forEach((b) => { b.onclick = () => editLine(Number(b.dataset.edit)); });
      K.$$("[data-qinc],[data-qdec]", body).forEach((b) => { b.onclick = () => { const i = Number(b.dataset.qinc != null ? b.dataset.qinc : b.dataset.qdec); const l = o.lines[i]; const step = l.decimals ? 0.5 : 1; const q = Math.max(0, Math.round((l.qty + (b.dataset.qinc != null ? step : -step)) * 1000) / 1000); if (q <= 0) return editLine(i); act("lijnen", linesPayload(o.lines.map((x, j) => (j === i ? Object.assign({}, x, { qty: q }) : x))), b); }; });
      K.$$("[data-qedit]", body).forEach((b) => { b.onclick = async () => { const i = Number(b.dataset.qedit); const l = o.lines[i]; const v = await K.prompt({ title: l.name, label: "Aantal (" + K.unit(l.unit, 2) + ")", value: K.qty(l.qty), inputmode: l.decimals ? "decimal" : "numeric", yes: "Opslaan" }); if (v === null) return; const q = K.parseNum(v); if (!Number.isFinite(q) || q < 0) return K.toast("Ongeldig aantal", "bad"); if (q === 0) return editLine(i); act("lijnen", linesPayload(o.lines.map((x, j) => (j === i ? Object.assign({}, x, { qty: q }) : x))), null, "Aantal aangepast"); }; });
      if ($("#addLine", body)) $("#addLine", body).onclick = () => addLine($("#addLine", body));
      if ($("#editNote", body)) $("#editNote", body).onclick = async () => { const v = await K.prompt({ title: "Opmerking van de klant", label: "Zichtbaar voor de klant en op de bon", value: o.notes, multiline: true, yes: "Opslaan" }); if (v !== null) act("notitie", { notities: v }, null, "Opmerking bewaard"); };
      if ($("#intNote", body)) $("#intNote", body).onclick = async () => { const v = await K.prompt({ title: "Interne notitie", label: "Enkel voor het team (chauffeur, magazijn)", placeholder: "Bv. sleutel onder de mat, altijd bellen", yes: "Toevoegen" }); if (v) act("interne-notitie", { tekst: v }, null, "Notitie toegevoegd"); };
      if ($("#chDate", body)) $("#chDate", body).onclick = async () => { const v = await K.prompt({ title: "Leverdatum wijzigen", label: "Nieuwe datum", type: "date", value: o.deliveryDate, yes: "Opslaan" }); if (v) act("leverdatum", { datum: v }, null, "Leverdatum aangepast"); };
      if ($("#photo", body)) $("#photo", body).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const url = await shrinkImage(f, 1280, 0.8); if (!url) return K.toast("Foto kon niet worden gelezen, probeer opnieuw.", "bad"); S.photos[id] = url; drawOrder(); };
      if ($("#photoRm", body)) $("#photoRm", body).onclick = () => { delete S.photos[id]; drawOrder(); };
      if ($("#fixRecv", body)) $("#fixRecv", body).onclick = async () => { const v = await K.prompt({ title: "Naam van de ontvanger", label: "Ontvangen door", value: o.receivedBy, yes: "Opslaan" }); if (v) act("ontvanger", { ontvanger: v }, null, "Naam aangepast"); };
      if ($("#delPhoto", body)) $("#delPhoto", body).onclick = () => { const inp = K.el('<input type="file" accept="image/*" capture="environment" hidden>'); document.body.appendChild(inp); inp.onchange = async () => { const f = inp.files[0]; inp.remove(); if (!f) return; const url = await shrinkImage(f, 1280, 0.8); if (!url) return K.toast("Foto kon niet worden gelezen.", "bad"); act("foto-levering", { foto: url }, null, "Foto toegevoegd"); }; inp.click(); };
      if ($("#ready", foot)) $("#ready", foot).onclick = async () => {
        const v = checks.get(id); const all = o.lines.filter((l) => !l.unavailable && !l.unparsed).every((l) => v[checks.key(l)]);
        if (o.lines.some((l) => l.unparsed)) return K.toast("Er staat nog een onleesbare lijn op de bestelling. Wijzig ze eerst.", "bad", 6000);
        if (o.deliveryDate > tomorrow() && !(await K.confirm({ title: "Nog niet voor morgen", text: "Deze bestelling is pas voor " + K.relDay(o.deliveryDate).toLowerCase() + ". Toch nu klaarzetten?", yes: "Ja, klaarzetten" }))) return;
        if (!all && !(await K.confirm({ title: "Niet alles afgevinkt", text: "Niet elke lijn is afgevinkt. Toch als klaargezet markeren?", yes: "Ja, klaargezet" }))) return;
        const r = await act("klaar", { foto: S.photos[id] || null, force: o.deliveryDate > tomorrow() }, $("#ready", foot), null);
        if (r) { checks.set(id, {}); delete S.photos[id]; K.toast("Klaargezet", "ok"); }
      };
      if ($("#ship", foot)) $("#ship", foot).onclick = async () => {
        if (!(await K.confirm({ title: "Onderweg zetten?", text: mailOn() && (o.client || {}).email ? "De klant krijgt nu een e-mail dat de chauffeur vertrokken is." : "De bestelling gaat op Onderweg." + (!mailOn() ? " (E-mail staat uit.)" : " Deze klant heeft geen e-mailadres."), yes: "Ja, onderweg" }))) return;
        const r = await act("onderweg", {}, $("#ship", foot), null); if (!r) return;
        const m = r.mail && r.mail.client;
        if (m && m.ok) K.toast("Onderweg — de klant is per e-mail verwittigd", "ok"); else if (!mailOn()) K.toast("Onderweg. E-mail staat uit: geef de leveringsbon mee.", "", 5000); else if (!m || m.skipped) K.toast("Onderweg. De klant heeft geen e-mailadres: bel of stuur de bon door.", "", 6000); else K.toast("Onderweg, maar de e-mail mislukte: " + (m.error || "").slice(0, 80), "bad", 7000);
      };
      if ($("#deliver", foot)) $("#deliver", foot).onclick = () => deliverSheet();
      if ($("#notDelivered", foot)) $("#notDelivered", foot).onclick = () => notDeliveredSheet();
      if ($("#paid", foot)) $("#paid", foot).onclick = () => act("betaald", { betaald: !o.paid }, $("#paid", foot), o.paid ? "Gemarkeerd als openstaand" : "Gemarkeerd als betaald");
      if ($("#next", foot)) $("#next", foot).onclick = () => { const n = $("#next", foot).dataset.next; sheet.close(); setTimeout(() => openOrder(n), 50); };
      if ($("#toBoard", foot)) $("#toBoard", foot).onclick = () => sheet.close();
      if ($("#back", foot)) $("#back", foot).onclick = async () => { if (!(await K.confirm({ title: "Een stap terug?", text: "De bestelling gaat terug naar " + (o.status === "klaar" ? "Ontvangen" : "Klaargezet") + ".", yes: "Ja" }))) return; const r = await act("terug", {}, $("#back", foot), null); if (r) K.toast("Teruggezet naar " + r.order.statusLabel, "ok"); };
      if ($("#share", foot)) $("#share", foot).onclick = () => K.share({ title: "Leveringsbon " + o.ref, text: "Leveringsbon " + o.ref + " van Famo Trading", url: o.docs.deliveryNoteShare });
      if ($("#remail", foot)) $("#remail", foot).onclick = () => {
        const email = (o.client || {}).email;
        const s = K.sheet({ title: "E-mail opnieuw sturen", center: true, body: (email ? '<p class="muted small">Naar ' + esc(email) + "</p>" : c.notice("warn", "Deze klant heeft geen e-mailadres. Stuur de bon door of print ze.")) + (!mailOn() ? c.notice("warn", "E-mail staat uit (geen RESEND_API_KEY).") : "") + '<div class="big-actions">' + c.btn({ label: "Bevestiging van de bestelling", kind: "outline", attrs: ' data-mail="bevestiging"', disabled: !email }) + c.btn({ label: "Leveringsbon (onderweg-bericht)", kind: "outline", attrs: ' data-mail="leveringsbon"', disabled: !email }) + (o.invoiceNumber ? c.btn({ label: "Factuur " + esc(o.invoiceNumber), kind: "outline", attrs: ' data-mail="factuur"', disabled: !email }) : "") + "</div>", footer: false });
        K.$$("[data-mail]", s.el).forEach((b) => { b.onclick = () => K.busy(b, async () => { try { await K.api("team/bestellingen/" + encodeURIComponent(id) + "/mail", { body: { type: b.dataset.mail } }); K.toast("Verzonden naar " + email, "ok"); s.close(); } catch (err) { if (err.status !== 401) K.toast(err.message, "bad", 7000); } }); });
      };
      if ($("#del", foot)) $("#del", foot).onclick = async () => { if (!(await K.confirm({ title: "Bestelling verwijderen?", text: "Dit kan niet ongedaan worden gemaakt. Verwijder enkel een dubbele of foute bestelling.", yes: "Verwijderen", danger: true }))) return; try { await K.api("team/bestellingen/" + encodeURIComponent(id) + "/verwijderen", { body: {} }); removeOrder(id); K.toast("Bestelling verwijderd"); sheet.close(); } catch (err) { if (err.status !== 401) K.toast(err.message, "bad"); } };
    }
    async function editLine(i) {
      const l = o.lines[i];
      const b = document.createElement("div");
      b.innerHTML = "<p><b>" + esc(l.name) + "</b>" + (l.unparsed ? ' <span class="pill pill-warn">onleesbaar</span>' : "") + '</p><div class="form-row">' + c.field({ id: "eq", label: "Aantal (" + K.unit(l.unit, 2) + ")", value: l.unavailable ? "" : K.qty(l.qty), attrs: ' inputmode="' + (l.decimals ? "decimal" : "numeric") + '" style="font-size:1.3rem;font-weight:800"' }) + c.field({ id: "ec", label: "Opmerking", value: l.unavailable ? "" : l.comment }) + "</div>";
      const s = K.sheet({ title: "Artikel wijzigen", body: b, center: true, footer: '<div class="row wrap">' + (l.unparsed ? "" : c.btn({ label: l.unavailable ? "Toch leveren" : "Niet beschikbaar", kind: "outline", id: "na" })) + c.btn({ label: "Vervangen door…", kind: "outline", id: "sub" }) + c.btn({ label: "Artikel schrappen", kind: "ghost", id: "rm", cls: "danger-text" }) + '<span style="flex:1"></span>' + c.btn({ label: "Opslaan", kind: "primary", id: "ok", disabled: !!l.unparsed }) + "</div>" });
      setTimeout(() => { const e = $("#eq", s.el); if (e) { e.focus(); e.select(); } }, 60);
      const save = async (lines, msg) => { const r = await act("lijnen", linesPayload(lines), $("#ok", s.el), msg || "Artikelen bijgewerkt"); if (r) s.close(); };
      $("#ok", s.el).onclick = () => { const q = K.parseNum($("#eq", s.el).value); if (!Number.isFinite(q) || q <= 0) return K.toast("Vul een aantal in.", "bad"); save(o.lines.map((x, j) => (j === i ? { name: x.name, qty: q, unit: x.unit, comment: $("#ec", s.el).value, unavailable: false } : x))); };
      if ($("#na", s.el)) $("#na", s.el).onclick = async () => { if (l.unavailable) { const q = K.parseNum($("#eq", s.el).value) || 1; return save(o.lines.map((x, j) => (j === i ? { name: x.name, qty: q, unit: x.unit, comment: "", unavailable: false } : x)), "Artikel opnieuw op de bestelling"); } const reason = await K.prompt({ title: "Niet beschikbaar", label: "Reden (optioneel, komt op de bon)", placeholder: "Bv. niet geleverd door de vismijn", yes: "Bevestigen" }); if (reason === null) return; save(o.lines.map((x, j) => (j === i ? { name: x.name, qty: x.qty || 1, unit: x.unit, comment: reason, unavailable: true, reason } : x)), l.name + " staat op niet geleverd"); };
      $("#sub", s.el).onclick = async () => { const p = await pickProduct(); if (!p) return; save(o.lines.map((x, j) => (j === i ? { productId: p.id, qty: l.qty || 1, comment: "i.p.v. " + l.name } : x)), "Vervangen door " + p.name); };
      $("#rm", s.el).onclick = async () => { if (o.lines.length === 1) return K.toast("Een bestelling moet minstens één artikel hebben. Zet het op niet beschikbaar of verwijder de bestelling.", "bad", 6000); if (!(await K.confirm({ title: "Artikel schrappen?", text: l.name + " wordt van de bestelling gehaald.", yes: "Schrappen", danger: true }))) return; save(o.lines.filter((x, j) => j !== i), "Artikel geschrapt"); };
    }
    async function catalogueFor(clientId) {
      if (!S.catalog[clientId]) S.catalog[clientId] = await K.api("team/klanten/" + encodeURIComponent(clientId) + "/catalogus");
      return S.catalog[clientId];
    }
    function pickProduct() {
      return new Promise((resolve) => {
        const b = document.createElement("div");
        b.innerHTML = '<div class="skeleton" style="height:60px"></div>';
        let picked = null;
        const s = K.sheet({ title: "Kies een artikel", body: b, footer: false, onClose: () => resolve(picked) });
        catalogueFor(o.clientId).then((cat) => {
          b.innerHTML = '<div class="searchbox">' + K.icon("search") + '<input class="input" id="pq" placeholder="Zoek artikel…"></div><div class="list" id="pl" style="margin-top:8px"></div>';
          const sugg = new Set(cat.suggestions.map((x) => x.productId));
          const draw = () => { const q = $("#pq", b).value; const list = cat.catalogue.filter((p) => K.matches(p.name + " " + p.categoryLabel, q)).sort((a, x) => (sugg.has(x.id) ? 1 : 0) - (sugg.has(a.id) ? 1 : 0)); $("#pl", b).innerHTML = list.map((p) => c.item({ attrs: ' data-pick="' + p.id + '"', title: esc(p.name) + (sugg.has(p.id) ? ' <span class="pill pill-info">vaste klant</span>' : ""), sub: K.eur(p.priceCents) + "/" + esc(K.unit(p.unit, 1)) })).join("") || c.empty({ text: "Niets gevonden." }); };
          draw(); $("#pq", b).oninput = draw; $("#pq", b).focus();
          b.addEventListener("click", (e) => { const t = e.target.closest("[data-pick]"); if (!t) return; picked = cat.catalogue.find((x) => x.id === t.dataset.pick); s.close(); });
        }).catch((err) => { b.innerHTML = c.notice("bad", esc(err.message)); });
      });
    }
    async function addLine(btn) {
      const p = await K.busy(btn, () => pickProduct());
      if (!p) return;
      const cat = S.catalog[o.clientId];
      const last = cat && cat.suggestions.find((x) => x.productId === p.id);
      const v = await K.prompt({ title: p.name, label: "Aantal (" + K.unit(p.unit, 2) + ")", value: K.qty(last ? last.qty : 1), inputmode: p.decimals ? "decimal" : "numeric", yes: "Toevoegen" });
      if (v === null) return;
      const q = K.parseNum(v); if (!Number.isFinite(q) || q <= 0) return K.toast("Vul een aantal in.", "bad");
      act("lijnen", { lijnen: o.lines.map(plain).concat([{ productId: p.id, qty: q }]), basis: o.linesText }, null, "Artikel toegevoegd");
    }
    function deliverSheet() {
      const cl = o.client || {};
      const b = document.createElement("div");
      b.innerHTML = (receivers.length ? '<div class="label">Eerder ontvangen door</div><div class="row wrap" style="margin-bottom:8px">' + receivers.map((r) => c.btn({ label: r, kind: "outline", size: "sm", attrs: ' data-recv="' + esc(r) + '"' })).join("") + "</div>" : "") +
        c.field({ id: "recv", label: "Ontvangen door (naam)", placeholder: "Bv. Kenji (keuken)", attrs: ' autocomplete="off" style="font-size:1.2rem"' }) +
        '<div class="field" style="margin-top:12px"><label>Handtekening van de klant</label><canvas class="sigpad" id="sig"></canvas><div class="row spread"><span class="help">Laat de klant hier tekenen.</span>' + c.btn({ label: "Wissen", kind: "ghost", size: "sm", id: "clear" }) + "</div></div>" +
        '<div class="card flat" style="margin-top:12px"><div class="row spread"><b>Te betalen incl. btw</b><b class="num" style="font-size:1.3rem">' + K.eur(incl(o)) + '</b></div><label class="check" style="margin-top:6px"><input type="checkbox" id="cash"> Contant betaald bij levering</label></div>' +
        '<p class="small muted" style="margin-top:10px">Bij bevestiging krijgt deze levering een factuurnummer' + (mailOn() && cl.email ? " en ontvangt de klant de factuur per e-mail." : (!mailOn() ? ". E-mail staat uit: geef de factuur mee." : ". Deze klant heeft geen e-mailadres: geef de factuur mee.")) + "</p>";
      const s = K.sheet({ title: "Levering bevestigen", body: b, footer: c.btn({ label: "Bevestigen en factureren", kind: "ok", size: "lg", block: true, icon: "check", id: "ok" }) });
      const pad = sigPad($("#sig", b));
      K.$$("[data-recv]", b).forEach((x) => { x.onclick = () => { $("#recv", b).value = x.dataset.recv; }; });
      $("#clear", b).onclick = pad.clear;
      $("#ok", s.el).onclick = async () => {
        const name = $("#recv", b).value.trim();
        if (!name) { K.toast("Vul in wie de levering ontvangen heeft.", "bad"); $("#recv", b).focus(); return; }
        if (pad.isEmpty() && !(await K.confirm({ title: "Geen handtekening", text: "Er is geen handtekening gezet. Toch bevestigen?", yes: "Ja, bevestigen" }))) return;
        const r = await act("geleverd", { ontvanger: name, handtekening: pad.isEmpty() ? null : pad.dataUrl(), betaald: $("#cash", b).checked }, $("#ok", s.el), null);
        if (!r) return;
        s.close();
        K.toast("Geleverd · factuur " + (r.invoiceNumber || (r.order && r.order.invoiceNumber) || ""), "ok", 4000);
        const m = r.mail && r.mail.client; if (m && !m.ok && !m.skipped) K.toast("E-mail met factuur aan klant mislukte: " + (m.error || "").slice(0, 80), "bad", 7000);
        load({ silent: true }).catch(() => {}).then(drawOrder);
      };
    }
    function notDeliveredSheet() {
      const b = document.createElement("div");
      const reasons = ["Niemand aanwezig", "Zaak gesloten", "Klant weigert", "Andere reden"];
      b.innerHTML = '<div class="label">Reden</div><div class="row wrap" style="margin-bottom:10px">' + reasons.map((r) => c.btn({ label: r, kind: "outline", size: "sm", attrs: ' data-reason="' + esc(r) + '"' })).join("") + "</div>" + c.field({ id: "nr", label: "Toelichting", placeholder: "Bv. terug proberen om 11u" }) + c.field({ id: "nd", label: "Nieuwe leverdatum (optioneel)", type: "date" }) + '<p class="small muted">De bestelling gaat terug naar Klaargezet met deze reden als interne notitie.</p>';
      const s = K.sheet({ title: "Niet kunnen leveren", body: b, center: true, footer: '<div class="row" style="justify-content:flex-end">' + c.btn({ label: "Terug", kind: "outline", attrs: " data-close" }) + c.btn({ label: "Bevestigen", kind: "primary", id: "ok" }) + "</div>" });
      let reason = "";
      K.$$("[data-reason]", b).forEach((x) => { x.onclick = () => { reason = x.dataset.reason; K.$$("[data-reason]", b).forEach((y) => { y.classList.toggle("btn-primary", y === x); y.classList.toggle("btn-outline", y !== x); }); }; });
      $("#ok", s.el).onclick = async () => {
        const text = [reason, $("#nr", b).value.trim()].filter(Boolean).join(": ");
        if (!text) return K.toast("Kies of typ een reden.", "bad");
        const r = await act("niet-geleverd", { reden: text }, $("#ok", s.el), null); if (!r) return;
        const nd = $("#nd", b).value; if (nd) await act("leverdatum", { datum: nd }, null, null);
        s.close(); K.toast("Terug naar Klaargezet", "ok");
      };
    }
  }

  // ---- Handtekening en foto ------------------------------------------------------------------------
  function sigPad(canvas) {
    const ctx = canvas.getContext("2d");
    let strokes = [], cur = null, drawing = false;
    function size() { const dpr = window.devicePixelRatio || 1; const w = canvas.clientWidth || 500, h = Math.max(180, Math.min(320, Math.round(window.innerHeight * 0.3))); canvas.style.height = h + "px"; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1a1a1a"; redraw(); }
    function redraw() { const w = canvas.clientWidth, h = canvas.clientHeight; ctx.clearRect(0, 0, w, h); strokes.forEach((st) => { ctx.beginPath(); st.forEach((p, i) => { const x = p.x * w, y = p.y * h; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke(); }); }
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
    canvas.addEventListener("pointerdown", (e) => { drawing = true; cur = [pos(e)]; strokes.push(cur); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
    canvas.addEventListener("pointermove", (e) => { if (!drawing) return; cur.push(pos(e)); redraw(); e.preventDefault(); });
    const up = () => { drawing = false; cur = null; };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    window.addEventListener("resize", size);
    setTimeout(size, 0);
    return {
      clear() { strokes = []; redraw(); },
      isEmpty() { return !strokes.some((s) => s.length > 1); },
      dataUrl() { const out = document.createElement("canvas"); out.width = canvas.width; out.height = canvas.height; const c2 = out.getContext("2d"); c2.fillStyle = "#fff"; c2.fillRect(0, 0, out.width, out.height); c2.drawImage(canvas, 0, 0); return out.toDataURL("image/png"); }
    };
  }
  function shrinkImage(file, max, q) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const cv = document.createElement("canvas"); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s); cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(img.src); resolve(cv.toDataURL("image/jpeg", q)); };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
  }

  // ---- Nieuwe bestelling (telefoon) ------------------------------------------------------------------
  const N = { clients: null, client: null, cat: null, cart: {}, comments: {}, date: "", note: "", q: "", source: "Telefoon" };
  async function renderNieuw() {
    if (!N.clients) { main.innerHTML = '<div class="skeleton" style="height:100px"></div>'; try { N.clients = (await K.api("team/klanten")).clients; } catch (err) { if (err.status === 401) return; return K.renderFatal(main, err.message, renderNieuw); } }
    if (!N.client) {
      main.innerHTML = '<h1 style="margin-bottom:10px">Nieuwe bestelling</h1><p class="muted">Voor een klant die belt of een bericht stuurt. Kies de klant' + (S.role === "admin" ? ' of <a href="/beheer#/klanten">maak een nieuwe klant aan</a>' : "") + ':</p><div class="searchbox" style="margin-bottom:10px">' + K.icon("search") + '<input class="input" id="cq" placeholder="Zoek klant…" autofocus></div><div class="card pad-0 flat"><div class="list" id="cl"></div></div>';
      const draw = () => { const q = $("#cq").value.toLowerCase(); $("#cl").innerHTML = N.clients.filter((x) => !q || x.name.toLowerCase().includes(q) || (x.number || "").toLowerCase().includes(q)).map((x) => c.item({ attrs: ' data-client="' + x.id + '"', title: esc(x.name), sub: esc(x.number || "") + (x.address ? " · " + esc(x.address.split("\n")[0]) : ""), chevron: true })).join("") || c.empty({ text: "Geen klant gevonden." }); };
      draw(); $("#cq").oninput = draw; $("#cq").focus();
      main.onclick = async (e) => { const t = e.target.closest("[data-client]"); if (!t) return; main.onclick = null; N.client = N.clients.find((x) => x.id === t.dataset.client); N.cart = {}; N.comments = {}; N.note = ""; N.q = ""; main.innerHTML = '<div class="skeleton" style="height:100px"></div>'; try { N.cat = await K.api("team/klanten/" + encodeURIComponent(N.client.id) + "/catalogus"); S.catalog[N.client.id] = N.cat; const d = N.cat.deliveryDates; N.date = (d[1] || d[0] || {}).iso || ""; } catch (err) { if (err.status !== 401) K.toast(err.message, "bad"); N.client = null; } renderNieuw(); };
      return;
    }
    const cat = N.cat.catalogue, cl = N.client;
    const lines = () => Object.entries(N.cart).map(([id, q]) => ({ p: cat.find((x) => x.id === id), qty: q })).filter((l) => l.p && l.qty > 0);
    const total = () => lines().reduce((s, l) => s + Math.round(l.p.priceCents * l.qty), 0);
    const q = N.q;
    const sugg = N.cat.suggestions.map((s) => ({ p: cat.find((x) => x.id === s.productId), qty: s.qty })).filter((s) => s.p);
    main.innerHTML = '<div class="section-head"><div><h1>' + esc(cl.name) + '</h1><div class="muted small">' + esc(String(cl.address || "").replace(/\n/g, ", ")) + (cl.phone ? " · " + esc(cl.phone) : "") + "</div></div>" + c.btn({ label: "Andere klant", kind: "outline", size: "sm", id: "other" }) + "</div>" +
      (cl.usual ? c.notice("info", "<b>Vaste artikelen:</b> " + esc(cl.usual)) : "") +
      '<div class="grid" style="grid-template-columns:1fr">' + c.card('<div class="label" style="margin-bottom:8px">Leverdatum</div><div class="datechips">' + N.cat.deliveryDates.map((d) => '<button class="datechip' + (d.iso === N.date ? " on" : "") + '" data-date="' + d.iso + '"><b>' + esc(d.relative) + "</b><small>" + esc(K.dateShort(d.iso)) + "</small></button>").join("") + '</div><div class="row wrap" style="margin-top:10px"><span class="label">Via</span><div class="segmented">' + ["Telefoon", "WhatsApp", "E-mail", "Toonbank"].map((s) => '<button data-src="' + s + '" class="' + (N.source === s ? "on" : "") + '">' + s + "</button>").join("") + "</div></div>") +
      (sugg.length && !q ? c.card('<div class="row spread"><b>Laatste bestellingen</b>' + c.btn({ label: "Alles toevoegen", kind: "outline", size: "sm", id: "all" }) + '</div><div class="row wrap" style="margin-top:8px">' + sugg.map((s) => c.btn({ label: K.qty(s.qty) + " " + K.unit(s.p.unit, s.qty) + " " + s.p.name, kind: "outline", size: "sm", attrs: ' data-sugg="' + s.p.id + '" data-qty="' + s.qty + '"' })).join("") + "</div>") : "") +
      '<div class="searchbox">' + K.icon("search") + '<input class="input" id="pq" placeholder="Zoek artikel…" value="' + esc(N.q) + '"></div>' +
      '<div id="plist">' + (cat.filter((p) => K.matches(p.name + " " + p.categoryLabel, q)).map((p) => '<div class="product' + (N.cart[p.id] ? " in" : "") + '"><div><div class="name">' + esc(p.name) + '</div><div class="price"><b>' + K.eur(p.priceCents) + "</b> / " + esc(K.unit(p.unit, 1)) + (p.negotiated ? '<span class="neg">klantprijs</span>' : "") + '</div></div><div class="stepper"><button data-nd="' + p.id + '" aria-label="Minder">−</button><input data-nq="' + p.id + '" inputmode="' + (p.decimals ? "decimal" : "numeric") + '" value="' + (N.cart[p.id] ? K.qty(N.cart[p.id]) : "") + '" placeholder="0" aria-label="Aantal"><button data-ni="' + p.id + '" aria-label="Meer">+</button></div>' + (N.cart[p.id] ? '<div class="comment"><input class="input" data-nc="' + p.id + '" placeholder="Opmerking (bv. in filets)" value="' + esc(N.comments[p.id] || "") + '"></div>' : "") + "</div>").join("") || c.empty({ text: "Geen artikel gevonden voor “" + esc(q) + "”." })) + "</div>" +
      c.card(c.field({ id: "nn", label: "Opmerking", multiline: true, rows: 2, value: N.note }) + '<div class="row spread" style="margin-top:10px"><span class="muted">' + K.plural(lines().length, "artikel", "artikelen") + ' · totaal excl. btw</span><b class="num" style="font-size:1.3rem" id="ntot">' + K.eur(total()) + "</b></div>" + c.btn({ label: "Bestelling plaatsen", kind: "primary", size: "lg", block: true, id: "save", disabled: !lines().length || !N.date, attrs: ' style="margin-top:10px"' }) + '<p class="small muted" style="margin-top:8px">' + (mailOn() && cl.email ? "De klant krijgt een bevestiging op " + esc(cl.email) + "." : (!mailOn() ? "E-mail staat uit: er vertrekt geen bevestiging." : "Deze klant heeft geen e-mailadres: er vertrekt geen bevestiging.")) + "</p>") + "</div>";
    const setQ = (id, v) => { const p = cat.find((x) => x.id === id); let n = K.parseNum(v); if (!Number.isFinite(n)) n = 0; if (!p.decimals) n = Math.round(n); n = Math.max(0, n); if (n) N.cart[id] = n; else delete N.cart[id]; };
    const refresh = () => { const pos = $("#pq") === document.activeElement ? $("#pq").selectionStart : null; renderNieuw(); if (pos !== null) { $("#pq").focus(); $("#pq").setSelectionRange(pos, pos); } };
    $("#other").onclick = () => { N.client = null; renderNieuw(); };
    K.$$("[data-date]").forEach((b) => { b.onclick = () => { N.date = b.dataset.date; refresh(); }; });
    K.$$("[data-src]").forEach((b) => { b.onclick = () => { N.source = b.dataset.src; refresh(); }; });
    if ($("#all")) $("#all").onclick = () => { sugg.forEach((s) => { if (!N.cart[s.p.id]) N.cart[s.p.id] = s.qty; }); refresh(); };
    K.$$("[data-sugg]").forEach((b) => { b.onclick = () => { N.cart[b.dataset.sugg] = Number(b.dataset.qty) || 1; refresh(); }; });
    $("#pq").oninput = K.debounce(() => { N.q = $("#pq").value; refresh(); }, 150);
    K.$$("[data-ni]").forEach((b) => { b.onclick = () => { const p = cat.find((x) => x.id === b.dataset.ni); setQ(p.id, (N.cart[p.id] || 0) + (p.decimals ? 0.5 : 1)); refresh(); }; });
    K.$$("[data-nd]").forEach((b) => { b.onclick = () => { const p = cat.find((x) => x.id === b.dataset.nd); setQ(p.id, (N.cart[p.id] || 0) - (p.decimals ? 0.5 : 1)); refresh(); }; });
    K.$$("[data-nq]").forEach((i) => { i.onchange = () => { setQ(i.dataset.nq, i.value); refresh(); }; });
    K.$$("[data-nc]").forEach((i) => { i.oninput = () => { N.comments[i.dataset.nc] = i.value.slice(0, 120); }; });
    $("#nn").oninput = (e) => { N.note = e.target.value; };
    $("#save").onclick = () => K.busy($("#save"), async () => {
      try {
        const r = await K.api("team/bestellingen", { body: { klantId: cl.id, items: lines().map((l) => ({ productId: l.p.id, qty: l.qty, comment: N.comments[l.p.id] || "" })), leverdatum: N.date, opmerking: N.note, bron: N.source } });
        const m = r.mail && r.mail.client;
        K.toast("Bestelling " + r.order.ref + " geplaatst" + (m && m.ok ? " · bevestiging gemaild" : ""), "ok", 4000);
        N.client = null; N.cart = {}; N.comments = {}; N.note = "";
        await load().catch(() => {}); go("board"); openOrder(r.order.id);
      } catch (err) { if (err.status !== 401) K.toast(err.message, "bad", 7000); }
    });
  }

  // ---- Historiek ---------------------------------------------------------------------------------------
  async function renderHistoriek() {
    main.innerHTML = '<div class="section-head"><h1>Historiek</h1></div><div class="row wrap" style="margin-bottom:10px"><div class="searchbox" style="flex:1;min-width:220px">' + K.icon("search") + '<input class="input" id="hq" placeholder="Klant, referentie, factuurnummer of artikel…" value="' + esc(S.histQ) + '"></div><div class="segmented">' + [[7, "7 dagen"], [30, "30 dagen"], [90, "90 dagen"], [365, "1 jaar"]].map(([d, l]) => '<button data-range="' + d + '" class="' + (S.histRange === d ? "on" : "") + '">' + l + "</button>").join("") + '</div></div><div class="card pad-0 flat"><div class="list" id="hl"></div></div>';
    $("#hq").oninput = K.debounce(async () => { S.histQ = $("#hq").value; K.route.set("historiek", S.histQ ? { q: S.histQ } : {}, true); await fetchHist(); }, 250);
    K.$$("[data-range]").forEach((b) => { b.onclick = async () => { S.histRange = Number(b.dataset.range); K.$$("[data-range]").forEach((x) => x.classList.toggle("on", x === b)); await fetchHist(); }; });
    if (S.hist === null) await fetchHist(); else drawHist();
  }
  async function fetchHist() {
    const seq = ++S.histSeq; S.histLoading = true; drawHist();
    try { const r = await K.api("team/bestellingen?q=" + encodeURIComponent(S.histQ) + "&van=" + K.addDays(K.todayISO(), -S.histRange)); if (seq !== S.histSeq) return; S.hist = r.orders; S.histError = ""; }
    catch (err) { if (seq !== S.histSeq) return; if (err.status === 401) return; S.hist = null; S.histError = err.message; }
    finally { if (seq === S.histSeq) { S.histLoading = false; drawHist(); } }
  }
  function drawHist() {
    const el = $("#hl"); if (!el) return;
    if (S.histLoading && !S.hist) { el.innerHTML = '<div class="skeleton" style="height:60px;margin:12px"></div>'; return; }
    if (S.hist === null) { el.innerHTML = c.notice("bad", esc(S.histError || "Kon de historiek niet laden.")) + '<div style="padding:12px">' + c.btn({ label: "Opnieuw proberen", kind: "outline", id: "hretry" }) + "</div>"; $("#hretry").onclick = fetchHist; return; }
    el.innerHTML = (S.histLoading ? '<div class="muted small" style="padding:8px 16px">Zoeken…</div>' : "") + (S.hist.length ? S.hist.map((o) => c.item({ attrs: ' data-open="' + o.id + '"', title: esc((o.client || {}).name || "—") + ' <span class="muted small">· ' + esc(o.ref) + "</span>", sub: "besteld " + esc(K.dateShort(o.date)) + " · levering " + esc(K.dateShort(o.deliveryDate)) + " · " + K.plural(o.lines.length, "artikel", "artikelen") + " · " + K.eur(o.totalCents) + (o.invoiceNumber ? " · " + esc(o.invoiceNumber) : ""), end: K.chip(o.status, o.statusLabel), chevron: true })).join("") : c.empty({ text: S.histQ ? "Niets gevonden voor “" + esc(S.histQ) + "” in de laatste " + S.histRange + " dagen." : "Geen bestellingen in de laatste " + S.histRange + " dagen." }));
  }

  // ---- Render ----------------------------------------------------------------------------------------------
  function render() {
    renderChrome();
    if (!S.role) return renderLogin();
    if (S.view === "nieuw") return renderNieuw();
    if (S.view === "historiek") return renderHistoriek();
    renderBoard();
  }
  async function boot() {
    try { const s = await K.api("team/sessie"); S.role = s.role; await afterLogin(); }
    catch (err) {
      if (err.status === 401) { const q = K.qs(); if (q.bestelling) K.pending.set({ view: "board", params: { bestelling: q.bestelling } }); K.stripQuery(); renderLogin(); }
      else if (!(err.status === 503 && err.data && err.data.notConfigured)) K.renderFatal(main, err.message, boot);
    }
    // Elke 2 minuten het bord verversen (de tablet blijft de hele ochtend open).
    setInterval(async () => { if (S.role && S.view === "board" && !current && document.visibilityState === "visible") { try { await load({ silent: true }); renderBoard(); } catch (_) { S.lastFailed = true; renderBoard(); } } }, 120000);
    document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible" && S.role && Date.now() - S.lastLoaded > 60000 && !current) { try { await load({ silent: true }); if (S.view === "board") renderBoard(); } catch (_) { /* toon oude */ } } });
    window.addEventListener("resize", K.debounce(() => { if (S.role && S.view === "board" && !current) renderBoard(); }, 200));
  }
  boot();
})();
