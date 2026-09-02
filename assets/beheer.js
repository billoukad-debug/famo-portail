/* Beheer: overzicht, aanvragen, klanten, artikelen, prijzen, facturen, bedrijf, toegang, systeemcontrole. */
(function () {
  "use strict";
  const $ = K.$, esc = K.esc, c = K.c;
  const main = $("#main"), who = $("#who");
  const SECTIONS = [["overzicht", "Overzicht", "home"], ["aanvragen", "Aanvragen", "mail"], ["klanten", "Klanten", "user"], ["artikelen", "Artikelen", "box"], ["prijzen", "Klantprijzen", "doc"], ["facturen", "Facturen", "doc"], ["bedrijf", "Bedrijf", "settings"], ["toegang", "Toegang en codes", "settings"], ["controle", "Systeemcontrole", "check"]];
  const S = { role: null, view: "overzicht", params: {}, d: null, loadedAt: 0, priceClient: "", clientQ: "", clientFilter: "alle", productQ: "", invYear: "", invMonth: "", invOpen: false, check: null };

  // ---- Chrome en routering ----------------------------------------------------------------------------
  function renderChrome() {
    who.innerHTML = S.role ? '<span class="pill pill-accent">Beheerder</span><a href="/" class="topbar-link">Klantportaal</a><a href="/team" class="topbar-link">Team</a><button class="btn btn-sm btn-ghost topbar-btn" id="logout">Afmelden</button>' : "";
    if (S.role) $("#logout").onclick = async () => { if (!(await K.confirm({ title: "Afmelden?", yes: "Afmelden" }))) return; await K.api("team/logout", { body: {} }).catch(() => {}); K.closeSheets(); S.role = null; S.d = null; K.route.set("", {}, true); renderChrome(); renderLogin(); };
  }
  function go(view, params, replace) { S.view = view; S.params = params || {}; K.route.set(view, S.params, replace); render(); window.scrollTo(0, 0); }
  K.route.onChange((r) => { if (!S.role) return; const v = SECTIONS.some(([k]) => k === r.view) ? r.view : "overzicht"; S.view = v; S.params = r.params; render(); });
  document.addEventListener("kade:unauthorized", (e) => { if (!S.role) return; K.pending.set({ view: S.view, params: S.params }); K.closeSheets(); S.role = null; S.d = null; renderChrome(); renderLogin(e.detail && e.detail.message ? e.detail.message : "Uw sessie is verlopen. Meld u opnieuw aan."); });

  function renderLogin(err) {
    main.innerHTML = '<div class="login-wrap"><div class="card"><h1>Beheer</h1><p class="muted">Meld u aan met de beheerderscode.</p><form id="f" class="stack">' + c.field({ id: "code", label: "Beheerderscode", type: "password", attrs: ' autocomplete="current-password" required' }) + (err ? c.notice("bad", esc(err)) : "") + c.btn({ label: "Aanmelden", kind: "primary", size: "lg", block: true, type: "submit" }) + '</form></div><p class="small muted center" style="margin-top:18px"><a href="/">Klantportaal</a> · <a href="/team">Teamportaal (magazijn en levering)</a></p></div>';
    K.pwToggle($("#code")); $("#code").focus();
    $("#f").onsubmit = async (e) => { e.preventDefault(); await K.busy($("button", e.target), async () => { try { await K.api("team/login", { body: { code: $("#code").value, rol: "admin" } }); S.role = "admin"; await afterLogin(); } catch (err) { renderLogin(err.status === 403 ? "Dit is de teamcode. Voor beheer hebt u de beheerderscode nodig." : err.message); } }); };
  }
  async function afterLogin() {
    const pending = K.pending.take();
    const r = K.route.get();
    S.view = SECTIONS.some(([k]) => k === r.view) ? r.view : "overzicht"; S.params = r.params;
    if (pending && SECTIONS.some(([k]) => k === pending.view)) { S.view = pending.view; S.params = pending.params || {}; }
    renderChrome();
    main.innerHTML = '<div class="skeleton" style="height:120px"></div>';
    try { await load(); } catch (err) { if (err.status === 401) return; return K.renderFatal(main, err.message, afterLogin); }
    render();
  }
  async function load() { S.d = await K.api("beheer/overzicht"); S.loadedAt = Date.now(); if (!S.invYear) S.invYear = String(S.d.stats.year); }
  async function post(path, body, btn) {
    return K.busy(btn, async () => { try { return await K.api(path, { body: body || {} }); } catch (err) { if (err.status !== 401) K.toast(err.message, "bad", 7000); throw err; } }).catch(() => null);
  }
  function apply(r) { if (r && r.overview) S.d = r.overview; if (r && r.prices && S.d) S.d.prices = r.prices; if (r && r.config && S.d) S.d.config = r.config; }

  function render() {
    renderChrome();
    if (!S.role) return renderLogin();
    if (!S.d) { main.innerHTML = '<div class="skeleton" style="height:120px"></div>'; return; }
    const d = S.d;
    const badge = (k) => (k === "aanvragen" && d.stats.requestsNew ? '<span class="count-side">' + d.stats.requestsNew + "</span>" : (k === "overzicht" && d.warnings.length ? '<span class="count-side warn">' + d.warnings.length + "</span>" : ""));
    main.innerHTML = '<div class="side-layout"><nav class="side" aria-label="Beheer">' + SECTIONS.map(([k, l, i]) => '<button data-sec="' + k + '" class="' + (S.view === k ? "on" : "") + '"><span class="row">' + K.icon(i) + " " + l + "</span>" + badge(k) + "</button>").join("") + '</nav><div class="content" id="content"></div></div>';
    K.$$("[data-sec]").forEach((b) => { b.onclick = () => go(b.dataset.sec); });
    const el = $("#content");
    ({ overzicht: vOverzicht, aanvragen: vAanvragen, klanten: vKlanten, artikelen: vArtikelen, prijzen: vPrijzen, facturen: vFacturen, bedrijf: vBedrijf, toegang: vToegang, controle: vControle }[S.view] || vOverzicht)(el);
  }
  function head(title, actions, sub) { return '<div class="section-head"><div><h1>' + esc(title) + "</h1>" + (sub ? '<div class="muted small">' + sub + "</div>" : "") + "</div>" + (actions ? '<div class="row wrap">' + actions + "</div>" : "") + "</div>"; }
  function clientById(id) { return (S.d.clients || []).find((x) => x.id === id); }
  function daysAgo(ts) { if (!ts) return null; const d = Math.floor((Date.now() - Date.parse(ts)) / 86400000); return isNaN(d) ? null : d; }
  function agoLabel(iso) { const d = daysAgo(iso + (iso.length === 10 ? "T12:00:00Z" : "")); if (d === null) return "nooit"; if (d <= 0) return "vandaag"; if (d === 1) return "gisteren"; if (d < 30) return d + " dagen geleden"; if (d < 365) return Math.round(d / 30) + " maanden geleden"; return "meer dan een jaar geleden"; }
  function mailOn() { return !!(S.d && S.d.env.mailEnabled); }

  // ---- Overzicht ------------------------------------------------------------------------------------------
  function vOverzicht(el) {
    const d = S.d, st = d.stats;
    const newReq = d.requests.filter((r) => r.isNew);
    const recent = d.invoices.slice(0, 6);
    el.innerHTML = head("Overzicht", c.btn({ label: "Vernieuwen", kind: "outline", size: "sm", icon: "refresh", id: "refresh" }), "Bijgewerkt om " + K.time(new Date(S.loadedAt).toISOString())) +
      '<div class="grid grid-3" style="margin-bottom:16px">' + c.kpi(st.ordersOpen, "Open bestellingen", ' data-kpi="/team" role="button" tabindex="0"') + c.kpi(st.requestsNew, "Nieuwe aanvragen", ' data-kpi="aanvragen" role="button" tabindex="0"') + c.kpi(K.eur(st.openCents), "Openstaande facturen", ' data-kpi="facturen?open=1" role="button" tabindex="0"') + c.kpi(st.invoicesThisYear, "Facturen in " + st.year, ' data-kpi="facturen" role="button" tabindex="0"') + c.kpi(K.eur(st.revenueYearCents), "Omzet " + st.year + " excl. btw", ' data-kpi="facturen" role="button" tabindex="0"') + c.kpi(d.clients.length, "Klanten", ' data-kpi="klanten" role="button" tabindex="0"') + "</div>" +
      (d.warnings.length ? '<div class="section"><h2 style="margin-bottom:8px">Aandachtspunten</h2><div class="stack">' + d.warnings.map((w) => '<div class="notice notice-warn">' + K.icon("warn") + '<div class="row spread wrap" style="flex:1"><span>' + esc(w.text) + "</span>" + c.btn({ label: w.action, kind: "outline", size: "sm", attrs: ' data-warn="' + esc(w.key) + '" data-section="' + esc(w.section) + '"' }) + "</div></div>").join("") + "</div></div>" : c.notice("ok", "Alles in orde: bedrijfsgegevens, e-mail, catalogus en klanten zijn klaar voor gebruik.")) +
      '<div class="grid grid-2" style="margin-top:16px">' +
      c.card((newReq.length ? '<div class="list">' + newReq.slice(0, 5).map((r) => c.item({ attrs: ' data-req="' + r.id + '"', title: esc(r.company), sub: esc(r.contact) + " · " + esc(agoLabel(r.createdTime)), chevron: true })).join("") + "</div>" : c.empty({ text: "Geen nieuwe aanvragen." })), { title: "Nieuwe aanvragen", actions: c.btn({ label: "Alle", kind: "ghost", size: "sm", attrs: ' data-goto="aanvragen"' }), pad0: true }) +
      c.card((recent.length ? '<div class="list">' + recent.map((i) => c.item({ attrs: ' data-goto="facturen"', title: esc(i.invoiceNumber) + ' <span class="muted small">· ' + esc(i.clientName) + "</span>", sub: esc(K.dateShort(i.date)) + " · " + K.eur(i.vat.inclCents) + " incl.", end: K.chip(i.paid ? "betaald" : "open", i.paid ? "Betaald" : "Openstaand"), chevron: true })).join("") + "</div>" : c.empty({ text: "Nog geen facturen. Elke bevestigde levering in het teamportaal maakt er een." })), { title: "Laatste facturen", actions: c.btn({ label: "Alle", kind: "ghost", size: "sm", attrs: ' data-goto="facturen"' }), pad0: true }) +
      "</div>" +
      '<div class="card flat" style="margin-top:16px"><h2>Snel naar</h2><div class="row wrap" style="margin-top:8px">' + c.btn({ label: "Nieuwe klant", kind: "outline", size: "sm", icon: "plus", id: "qClient" }) + c.btn({ label: "Nieuw artikel", kind: "outline", size: "sm", icon: "plus", id: "qProduct" }) + c.btn({ label: "Telefonische bestelling ingeven", kind: "outline", size: "sm", icon: "phone", href: "/team#/nieuw" }) + c.btn({ label: "Bord van vandaag", kind: "outline", size: "sm", icon: "truck", href: "/team" }) + c.btn({ label: "Aanvraagpagina voor nieuwe klanten", kind: "ghost", size: "sm", href: "/aanvraag", blank: true }) + "</div></div>";
    $("#refresh").onclick = async () => { try { await K.busy($("#refresh"), load); K.toast("Bijgewerkt", "ok", 1200); render(); } catch (err) { if (err.status !== 401) K.toast(err.message, "bad"); } };
    K.$$("[data-kpi]").forEach((k) => { k.onclick = () => { const t = k.dataset.kpi; if (t.startsWith("/")) { location.href = t; return; } const [v, q] = t.split("?"); const p = {}; new URLSearchParams(q || "").forEach((val, key) => { p[key] = val; }); go(v, p); }; k.onkeydown = (e) => { if (e.key === "Enter") k.click(); }; });
    K.$$("[data-warn]").forEach((b) => { b.onclick = () => { const key = b.dataset.warn, sec = b.dataset.section; if (key === "catalogue") return go("artikelen", { nieuw: "1" }); if (key === "clientpw") return go("klanten", { filter: "geenwachtwoord" }); if (key === "clientmail") return go("klanten", { filter: "geenmail" }); if (key === "iban" || key === "ops" || key === "config") return go("bedrijf", { focus: key === "iban" ? "iban" : key === "ops" ? "opsEmail" : "companyName" }); go(sec); }; });
    K.$$("[data-goto]").forEach((b) => { b.onclick = () => go(b.dataset.goto); });
    K.$$("[data-req]").forEach((b) => { b.onclick = () => openRequest(b.dataset.req); });
    $("#qClient").onclick = () => clientForm();
    $("#qProduct").onclick = () => productForm();
  }

  // ---- Aanvragen --------------------------------------------------------------------------------------------
  function vAanvragen(el) {
    const d = S.d;
    const open = d.requests.filter((r) => r.isNew), done = d.requests.filter((r) => !r.isNew);
    const row = (r) => c.item({ attrs: ' data-req="' + r.id + '"', title: esc(r.company) + (r.isNew && daysAgo(r.createdTime) > 1 ? ' <span class="pill pill-warn">wacht ' + daysAgo(r.createdTime) + " dagen</span>" : ""), sub: esc(r.contact) + (r.email ? " · " + esc(r.email) : "") + (r.phone ? " · " + esc(r.phone) : "") + " · " + esc(agoLabel(r.createdTime)), end: r.isNew ? K.chip("ontvangen", "Nieuw") : (r.outcome === "klant" ? K.chip("geleverd", "Klant aangemaakt") : r.outcome === "afgewezen" ? K.chip("open", "Afgewezen") : K.chip("neutral", "Afgehandeld")), chevron: true });
    el.innerHTML = head("Aanvragen", "", "Prospects die via de website toegang vroegen. U beslist wie klant wordt.") +
      '<div class="card pad-0 flat" style="margin-bottom:16px"><div class="list">' + (open.length ? open.map(row).join("") : c.empty({ text: "Geen nieuwe aanvragen. Nieuwe klanten vragen toegang via " + location.origin + "/aanvraag." })) + "</div></div>" +
      (done.length ? '<h2 style="margin:0 0 8px">Afgehandeld</h2><div class="card pad-0 flat"><div class="list">' + done.slice(0, 50).map(row).join("") + "</div></div>" : "");
    K.$$("[data-req]").forEach((b) => { b.onclick = () => openRequest(b.dataset.req); });
    if (S.params.id) { const id = S.params.id; S.params = {}; K.route.set("aanvragen", {}, true); openRequest(id); }
  }
  function openRequest(id) {
    const r = (S.d.requests || []).find((x) => x.id === id);
    if (!r) return K.toast("Aanvraag niet gevonden.", "bad");
    const body = document.createElement("div");
    const draw = () => {
      body.innerHTML = '<div class="row spread wrap"><div class="muted small">Ontvangen ' + esc(K.dateTime(r.createdTime)) + "</div>" + (r.isNew ? K.chip("ontvangen", "Nieuw") : r.outcome === "klant" ? K.chip("geleverd", "Klant aangemaakt") : K.chip("open", "Afgewezen")) + "</div>" +
        '<div class="card flat" style="margin-top:8px"><div class="list">' + c.item({ button: false, title: esc(r.company), sub: "Contactpersoon: " + esc(r.contact) + (r.vat ? " · " + esc(r.vat) : "") }) + c.item({ button: false, title: "Contact", sub: [c.mail(r.email), c.tel(r.phone)].filter(Boolean).join(" · ") || "—" }) + c.item({ button: false, title: "Leveradres", sub: esc(r.address || "—").replace(/\n/g, ", ") }) + (r.notes ? c.item({ button: false, title: "Bericht en notities", sub: esc(r.notes).replace(/\n/g, "<br>") }) : "") + "</div></div>" +
        (r.isNew ? '<p class="small muted" style="margin-top:10px">Goedkeuren maakt een klant aan met een gebruikersnaam en wachtwoord' + (mailOn() ? " en kan die meteen mailen." : ". E-mail staat uit: u geeft de gegevens zelf door.") + "</p>" : "");
    };
    draw();
    const foot = '<div class="row wrap">' + (r.isNew ? c.btn({ label: "Goedkeuren en klant aanmaken", kind: "ok", icon: "check", id: "ok" }) + c.btn({ label: "Afwijzen", kind: "outline", id: "no" }) : "") + c.btn({ label: "Verwijderen", kind: "ghost", id: "del", cls: "danger-text", attrs: ' style="margin-left:auto"' }) + "</div>";
    const s = K.sheet({ title: r.company, body, footer: foot, wide: true });
    if ($("#ok", s.el)) $("#ok", s.el).onclick = () => approveForm(r, s);
    if ($("#no", s.el)) $("#no", s.el).onclick = () => declineForm(r, s);
    $("#del", s.el).onclick = async () => { if (!(await K.confirm({ title: "Aanvraag verwijderen?", text: "De aanvraag van " + r.company + " verdwijnt definitief. De aanvrager krijgt geen bericht.", yes: "Verwijderen", danger: true }))) return; const res = await post("beheer/aanvragen/" + r.id + "/verwijderen", {}, $("#del", s.el)); if (!res) return; apply(res); s.close(); K.toast("Aanvraag verwijderd"); render(); };
  }
  function approveForm(r, parent) {
    const body = document.createElement("div");
    body.innerHTML = '<div class="form-row">' + c.field({ id: "a_naam", label: "Klantnaam (bedrijf)", value: r.company, attrs: " required" }) + c.field({ id: "a_btw", label: "Btw-nummer", value: r.vat }) + "</div>" +
      '<div class="form-row">' + c.field({ id: "a_email", label: "E-mailadres", type: "email", value: r.email, help: "Hierop komen bevestigingen en facturen toe." }) + c.field({ id: "a_tel", label: "Telefoon", type: "tel", value: r.phone }) + "</div>" +
      c.field({ id: "a_adres", label: "Leveradres", value: r.address, multiline: true, rows: 2 }) +
      c.field({ id: "a_user", label: "Gebruikersnaam", placeholder: "leeg = automatisch", help: "Waarmee de klant aanmeldt. Leeg laten is prima." }) +
      (mailOn() ? '<label class="check"><input type="checkbox" id="a_mail" ' + (r.email ? "checked" : "disabled") + "> Inloggegevens meteen per e-mail sturen" + (r.email ? "" : " (geen e-mailadres)") + "</label>" : c.notice("warn", "E-mail staat uit: noteer straks het wachtwoord en geef het zelf door."));
    const s = K.sheet({ title: "Klant aanmaken", body, center: true, footer: '<div class="row" style="justify-content:flex-end">' + c.btn({ label: "Terug", kind: "outline", attrs: " data-close" }) + c.btn({ label: "Klant aanmaken", kind: "ok", id: "ok" }) + "</div>" });
    const payload = (force) => ({ naam: $("#a_naam", body).value, btw: $("#a_btw", body).value, email: $("#a_email", body).value, telefoon: $("#a_tel", body).value, adres: $("#a_adres", body).value, gebruikersnaam: $("#a_user", body).value, stuurMail: !!($("#a_mail", body) && $("#a_mail", body).checked), force: !!force });
    $("#ok", s.el).onclick = async () => {
      if (!$("#a_naam", body).value.trim()) return K.toast("Vul de klantnaam in.", "bad");
      let res;
      try { res = await K.busy($("#ok", s.el), () => K.api("beheer/aanvragen/" + r.id + "/goedkeuren", { body: payload(false) })); }
      catch (err) {
        if (err.status === 401) return;
        if (err.status === 409) {
          const dupId = err.data && err.data.duplicateId; const dup = dupId ? clientById(dupId) : null;
          const choice = await K.confirm({ title: "Deze klant bestaat al", text: err.message + (dup ? " Bestaande klant: " + dup.name + (dup.username ? " (gebruikersnaam " + dup.username + ")" : "") + "." : "") + " Wilt u toch een tweede klant aanmaken?", yes: "Toch aanmaken", no: dup ? "Bestaande klant openen" : "Terug" });
          if (choice) { try { res = await K.busy($("#ok", s.el), () => K.api("beheer/aanvragen/" + r.id + "/goedkeuren", { body: payload(true) })); } catch (e2) { if (e2.status !== 401) K.toast(e2.message, "bad", 7000); return; } }
          else { if (dup) { s.close(); parent.close(); go("klanten", { id: dup.id }); } return; }
        } else { K.toast(err.message, "bad", 7000); return; }
      }
      apply(res); s.close(); parent.close(); render();
      credentialsSheet(res.client, res.password, res.mail, { fromRequest: true });
    };
  }
  function declineForm(r, parent) {
    const body = document.createElement("div");
    body.innerHTML = c.field({ id: "d_note", label: "Reden (intern)", placeholder: "Bv. buiten onze leverzone", multiline: true, rows: 2 }) + (mailOn() && r.email ? '<label class="check"><input type="checkbox" id="d_mail" checked> Aanvrager verwittigen per e-mail</label>' + c.field({ id: "d_msg", label: "Bericht aan de aanvrager (optioneel)", multiline: true, rows: 3, placeholder: "Bv. Wij leveren momenteel niet in uw regio." }) : c.notice("info", mailOn() ? "Geen e-mailadres: de aanvrager krijgt geen bericht." : "E-mail staat uit: de aanvrager krijgt geen bericht."));
    const s = K.sheet({ title: "Aanvraag afwijzen", body, center: true, footer: '<div class="row" style="justify-content:flex-end">' + c.btn({ label: "Terug", kind: "outline", attrs: " data-close" }) + c.btn({ label: "Afwijzen", kind: "danger", id: "ok" }) + "</div>" });
    $("#ok", s.el).onclick = async () => { const res = await post("beheer/aanvragen/" + r.id + "/afhandelen", { notitie: $("#d_note", body).value, stuurMail: !!($("#d_mail", body) && $("#d_mail", body).checked), bericht: $("#d_msg", body) ? $("#d_msg", body).value : "" }, $("#ok", s.el)); if (!res) return; apply(res); s.close(); parent.close(); const m = res.mail; K.toast("Aanvraag afgewezen" + (m && m.ok ? " · aanvrager verwittigd" : m && m.error ? " · e-mail mislukt" : ""), m && m.error ? "bad" : "ok"); render(); };
  }
  function credentialsSheet(client, password, mailResult, o) {
    const opts = o || {};
    const sent = mailResult && mailResult.ok;
    const text = "Aanmelden op " + location.origin + "\nGebruikersnaam: " + client.username + "\nWachtwoord: " + password;
    const body = document.createElement("div");
    body.innerHTML = (sent ? c.notice("ok", "Inloggegevens gemaild naar <b>" + esc(client.email) + "</b>.") : c.notice("warn", (mailResult && mailResult.error ? "E-mail mislukt: " + esc(String(mailResult.error).slice(0, 120)) + ". " : "") + "Geef deze gegevens door via telefoon of WhatsApp. <b>Het wachtwoord wordt maar één keer getoond.</b>")) +
      '<div class="code-box" style="margin-top:10px"><div><div class="label">Gebruikersnaam</div><b class="mono">' + esc(client.username) + '</b></div></div><div class="code-box" style="margin-top:8px"><div><div class="label">Wachtwoord</div><b class="mono">' + esc(password) + "</b></div>" + c.btn({ label: "Kopiëren", kind: "outline", size: "sm", id: "copy" }) + "</div>" +
      '<div class="row wrap" style="margin-top:12px">' + c.btn({ label: "Doorsturen (WhatsApp, sms…)", kind: "outline", size: "sm", id: "share" }) + (!sent && mailOn() && client.email ? c.btn({ label: "Toch mailen naar " + esc(client.email), kind: "outline", size: "sm", id: "mailIt" }) : "") + "</div>" +
      '<h3 style="margin-top:16px">Volgende stappen</h3><div class="big-actions" style="margin-top:8px">' + c.btn({ label: "Klantprijzen instellen voor " + esc(client.name), kind: "primary", id: "toPrices" }) + c.btn({ label: "Klantfiche openen", kind: "outline", id: "toClient" }) + "</div>";
    const s = K.sheet({ title: opts.fromRequest ? "Klant aangemaakt" : "Nieuw wachtwoord", body, footer: false });
    $("#copy", s.el).onclick = async () => { try { await navigator.clipboard.writeText(text); K.toast("Gekopieerd", "ok"); } catch (_) { window.prompt("Kopieer:", text); } };
    $("#share", s.el).onclick = () => K.share({ title: "Uw toegang tot het bestelportaal", text, url: location.origin });
    if ($("#mailIt", s.el)) $("#mailIt", s.el).onclick = async () => { const res = await post("beheer/klanten/" + client.id + "/wachtwoord", { wachtwoord: password, stuurMail: true }, $("#mailIt", s.el)); if (res && res.mail && res.mail.ok) K.toast("Gemaild naar " + client.email, "ok"); else if (res) K.toast("E-mail mislukt", "bad"); };
    $("#toPrices", s.el).onclick = () => { s.close(); go("prijzen", { klant: client.id }); };
    $("#toClient", s.el).onclick = () => { s.close(); go("klanten", { id: client.id }); };
  }

  // ---- Klanten ------------------------------------------------------------------------------------------------
  function vKlanten(el) {
    const d = S.d;
    if (S.params.filter) { S.clientFilter = S.params.filter; }
    const q = S.clientQ.toLowerCase();
    const inactive = (cl) => !cl.lastOrder || daysAgo(cl.lastOrder + "T12:00:00Z") > 60;
    const filters = [["alle", "Alle"], ["geenwachtwoord", "Zonder wachtwoord"], ["geenmail", "Zonder e-mail"], ["inactief", "Geen bestelling in 60 dagen"]];
    const list = d.clients.filter((cl) => !q || (cl.name + " " + cl.number + " " + cl.email + " " + cl.username + " " + cl.phone).toLowerCase().includes(q)).filter((cl) => S.clientFilter === "geenwachtwoord" ? !cl.hasPassword : S.clientFilter === "geenmail" ? !cl.email : S.clientFilter === "inactief" ? inactive(cl) : true);
    el.innerHTML = head("Klanten", c.btn({ label: "Nieuwe klant", kind: "primary", icon: "plus", id: "new" }), K.plural(d.clients.length, "klant", "klanten")) +
      '<div class="row wrap" style="margin-bottom:10px"><div class="searchbox" style="flex:1;min-width:220px">' + K.icon("search") + '<input class="input" id="cq" placeholder="Zoek op naam, nummer, e-mail of gebruikersnaam…" value="' + esc(S.clientQ) + '"></div><div class="segmented">' + filters.map(([k, l]) => '<button data-cf="' + k + '" class="' + (S.clientFilter === k ? "on" : "") + '">' + l + "</button>").join("") + "</div></div>" +
      '<div class="card pad-0 flat"><div class="list">' + (list.length ? list.map((cl) => c.item({ attrs: ' data-client="' + cl.id + '"', title: esc(cl.name) + (cl.number ? ' <span class="muted small">· ' + esc(cl.number) + "</span>" : "") + (!cl.hasPassword ? ' <span class="pill pill-warn">kan niet aanmelden</span>' : "") + (!cl.email ? ' <span class="pill pill-warn">geen e-mail</span>' : ""), sub: [cl.email, cl.phone].filter(Boolean).map(esc).join(" · ") + (cl.address ? " · " + esc(cl.address.split("\n").pop()) : ""), end: '<div class="small muted">' + (cl.orderCount ? K.plural(cl.orderCount, "bestelling", "bestellingen") + "<br>laatste " + esc(agoLabel(cl.lastOrder)) : "nog geen bestelling") + "</div>", chevron: true })).join("") : c.empty({ text: d.clients.length ? "Geen klant gevonden." : "Nog geen klanten. Maak de eerste aan of keur een aanvraag goed.", action: d.clients.length ? "" : c.btn({ label: "Nieuwe klant", kind: "primary", id: "new2" }) })) + "</div></div>";
    $("#cq").oninput = K.debounce(() => { S.clientQ = $("#cq").value; const pos = $("#cq").selectionStart; vKlanten(el); $("#cq").focus(); $("#cq").setSelectionRange(pos, pos); }, 200);
    K.$$("[data-cf]").forEach((b) => { b.onclick = () => { S.clientFilter = b.dataset.cf; S.params = {}; K.route.set("klanten", {}, true); vKlanten(el); }; });
    $("#new").onclick = () => clientForm();
    if ($("#new2")) $("#new2").onclick = () => clientForm();
    K.$$("[data-client]").forEach((b) => { b.onclick = () => openClient(b.dataset.client); });
    if (S.params.id) { const id = S.params.id; S.params = {}; K.route.set("klanten", {}, true); openClient(id); }
  }
  function openClient(id) {
    const cl = clientById(id);
    if (!cl) return K.toast("Klant niet gevonden.", "bad");
    const body = document.createElement("div");
    body.innerHTML = '<div class="card flat"><div class="list">' + c.item({ button: false, title: esc(cl.name) + (cl.number ? ' <span class="muted small">· ' + esc(cl.number) + "</span>" : ""), sub: (cl.vat ? esc(cl.vat) + " · " : "") + "gebruikersnaam <b>" + esc(cl.username || "—") + "</b>" + (cl.hasPassword ? "" : ' · <span class="pill pill-warn">nog geen wachtwoord</span>') }) + c.item({ button: false, title: "Contact", sub: [c.mail(cl.email), c.tel(cl.phone)].filter(Boolean).join(" · ") || '<span class="warn-text">Geen e-mail of telefoon</span>' }) + c.item({ button: false, title: "Leveradres", sub: esc(cl.address || "—").replace(/\n/g, ", ") + (cl.address ? ' · <a href="' + esc(K.mapsUrl(cl.address)) + '" target="_blank" rel="noopener">Route</a>' : "") }) + (cl.notes ? c.item({ button: false, title: "Leverinstructie (intern)", sub: esc(cl.notes) }) : "") + (cl.usual ? c.item({ button: false, title: "Vaste artikelen", sub: esc(cl.usual) }) : "") + c.item({ button: false, title: "Bestellingen", sub: (cl.orderCount ? K.plural(cl.orderCount, "bestelling", "bestellingen") + " in het laatste jaar · laatste " + esc(agoLabel(cl.lastOrder)) : "Nog geen bestelling") + " · klantprijzen: " + (S.d.prices.filter((p) => p.clientId === cl.id).length || "geen") }) + "</div></div>" +
      '<div class="grid grid-2" style="margin-top:12px">' + c.btn({ label: "Klantprijzen", kind: "outline", icon: "doc", id: "prices" }) + c.btn({ label: "Bestellingen bekijken", kind: "outline", icon: "list", href: "/team#/historiek?q=" + encodeURIComponent(cl.name) }) + c.btn({ label: "Bestelling ingeven (telefoon)", kind: "outline", icon: "phone", href: "/team#/nieuw" }) + c.btn({ label: "Gegevens bewerken", kind: "outline", icon: "settings", id: "edit" }) + "</div>" +
      '<h3 style="margin-top:16px">Toegang tot het portaal</h3><p class="small muted">De klant meldt aan op ' + esc(location.origin) + " met gebruikersnaam of e-mailadres. Een nieuw wachtwoord vervangt het oude meteen.</p>" +
      '<div class="row wrap">' + c.btn({ label: cl.hasPassword ? "Nieuw wachtwoord maken" : "Wachtwoord maken", kind: cl.hasPassword ? "outline" : "primary", id: "pw" }) + (cl.hasPassword ? c.btn({ label: "Toegang blokkeren", kind: "ghost", id: "block" }) : "") + "</div>";
    const s = K.sheet({ title: cl.name, body, wide: true, footer: '<div class="row wrap">' + c.btn({ label: "Klant verwijderen", kind: "ghost", id: "del", cls: "danger-text" }) + '<span style="flex:1"></span>' + c.btn({ label: "Sluiten", kind: "outline", attrs: " data-close" }) + "</div>" });
    $("#prices", s.el).onclick = () => { s.close(); go("prijzen", { klant: cl.id }); };
    $("#edit", s.el).onclick = () => clientForm(cl, s);
    $("#pw", s.el).onclick = async () => {
      const send = mailOn() && cl.email ? await K.confirm({ title: "Nieuw wachtwoord", text: "Er wordt een nieuw wachtwoord gemaakt. Wilt u het meteen mailen naar " + cl.email + "? U ziet het ook op het scherm.", yes: "Maken en mailen", no: "Enkel tonen" }) : (await K.confirm({ title: "Nieuw wachtwoord maken?", text: "Het oude wachtwoord werkt daarna niet meer. U geeft het nieuwe zelf door" + (mailOn() ? " (deze klant heeft geen e-mailadres)." : " (e-mail staat uit)."), yes: "Maken" }) ? false : null);
      if (send === null) return;
      const res = await post("beheer/klanten/" + cl.id + "/wachtwoord", { stuurMail: !!send }, $("#pw", s.el)); if (!res) return;
      cl.hasPassword = true;
      credentialsSheet(cl, res.password, res.mail, {});
    };
    if ($("#block", s.el)) $("#block", s.el).onclick = async () => { if (!(await K.confirm({ title: "Toegang blokkeren?", text: cl.name + " kan dan niet meer aanmelden. Bestellingen en facturen blijven bewaard. Later kunt u een nieuw wachtwoord maken.", yes: "Blokkeren", danger: true }))) return; const res = await post("beheer/klanten/" + cl.id + "/wachtwoord", { blokkeren: true }, $("#block", s.el)); if (!res) return; cl.hasPassword = false; K.toast("Toegang geblokkeerd", "ok"); s.close(); render(); };
    $("#del", s.el).onclick = async () => { if (!(await K.confirm({ title: "Klant verwijderen?", text: "Dit kan enkel voor klanten zonder bestellingen en kan niet ongedaan worden gemaakt. Klantprijzen worden mee verwijderd.", yes: "Verwijderen", danger: true }))) return; const res = await post("beheer/klanten/" + cl.id + "/verwijderen", {}, $("#del", s.el)); if (!res) return; apply(res); s.close(); K.toast("Klant verwijderd"); render(); };
  }
  function clientForm(cl, parent) {
    const isNew = !cl; const v = cl || {};
    const body = document.createElement("div");
    body.innerHTML = '<div class="form-row">' + c.field({ id: "c_naam", label: "Klantnaam (bedrijf)", value: v.name, attrs: " required" }) + c.field({ id: "c_nr", label: "Klantnummer", value: v.number, placeholder: isNew ? "leeg = automatisch" : "", help: "Staat op de leveringsbon en factuur." }) + "</div>" +
      '<div class="form-row">' + c.field({ id: "c_email", label: "E-mailadres", type: "email", value: v.email, help: "Voor bevestigingen, leveringsbonnen en facturen." }) + c.field({ id: "c_tel", label: "Telefoon", type: "tel", value: v.phone }) + "</div>" +
      '<div class="form-row">' + c.field({ id: "c_btw", label: "Btw-nummer", value: v.vat, placeholder: "BE 0123.456.789" }) + c.field({ id: "c_user", label: "Gebruikersnaam", value: v.username, placeholder: isNew ? "leeg = automatisch" : "", help: "Waarmee de klant aanmeldt (of het e-mailadres)." }) + "</div>" +
      c.field({ id: "c_adres", label: "Leveradres", value: v.address, multiline: true, rows: 2, placeholder: "Straat en nummer\nPostcode gemeente" }) +
      c.field({ id: "c_notes", label: "Leverinstructie (intern, voor de chauffeur)", value: v.notes, placeholder: "Bv. achteraan leveren, bellen bij aankomst" }) +
      c.field({ id: "c_usual", label: "Vaste artikelen (geheugensteun bij telefonische bestellingen)", value: v.usual, placeholder: "Bv. elke week 5 kg zalm, 2 dozen garnalen" }) +
      (isNew ? (mailOn() ? '<label class="check"><input type="checkbox" id="c_mail" checked> Inloggegevens per e-mail sturen (als er een e-mailadres is)</label>' : c.notice("warn", "E-mail staat uit: u krijgt het wachtwoord op het scherm en geeft het zelf door.")) : "");
    const s = K.sheet({ title: isNew ? "Nieuwe klant" : "Klant bewerken", body, wide: true, footer: '<div class="row" style="justify-content:flex-end">' + c.btn({ label: "Terug", kind: "outline", attrs: " data-close" }) + c.btn({ label: isNew ? "Klant aanmaken" : "Opslaan", kind: "primary", id: "ok" }) + "</div>" });
    const payload = (force) => ({ id: v.id || "", naam: $("#c_naam", body).value, klantnummer: $("#c_nr", body).value, email: $("#c_email", body).value, telefoon: $("#c_tel", body).value, btw: $("#c_btw", body).value, gebruikersnaam: $("#c_user", body).value, adres: $("#c_adres", body).value, notities: $("#c_notes", body).value, vasteArtikelen: $("#c_usual", body).value, stuurMail: !!($("#c_mail", body) && $("#c_mail", body).checked), force: !!force });
    $("#ok", s.el).onclick = async () => {
      if (!$("#c_naam", body).value.trim()) { K.toast("Vul de klantnaam in.", "bad"); $("#c_naam", body).focus(); return; }
      let res;
      try { res = await K.busy($("#ok", s.el), () => K.api("beheer/klanten", { body: payload(false) })); }
      catch (err) {
        if (err.status === 401) return;
        if (err.status === 409 && isNew) { if (!(await K.confirm({ title: "Deze klant bestaat al", text: err.message + " Toch een tweede klant aanmaken?", yes: "Toch aanmaken" }))) return; try { res = await K.busy($("#ok", s.el), () => K.api("beheer/klanten", { body: payload(true) })); } catch (e2) { if (e2.status !== 401) K.toast(e2.message, "bad", 7000); return; } }
        else { K.toast(err.message, "bad", 7000); return; }
      }
      apply(res); s.close(); if (parent) parent.close(); render();
      if (res.password) credentialsSheet(res.client, res.password, res.mail, { fromRequest: true });
      else { K.toast("Klant opgeslagen", "ok"); openClient(res.client.id); }
    };
  }

  // ---- Artikelen ---------------------------------------------------------------------------------------------
  function vArtikelen(el) {
    const d = S.d;
    const q = S.productQ.toLowerCase();
    const list = d.products.filter((p) => !q || (p.name + " " + p.categoryLabel).toLowerCase().includes(q));
    const cats = []; list.forEach((p) => { if (!cats.includes(p.categoryLabel)) cats.push(p.categoryLabel); });
    el.innerHTML = head("Artikelen", c.btn({ label: "Nieuw artikel", kind: "primary", icon: "plus", id: "new" }), K.plural(d.products.filter((p) => p.active).length, "actief artikel", "actieve artikelen") + " · basisprijs excl. btw; klantprijzen stelt u in onder Klantprijzen") +
      '<div class="searchbox" style="margin-bottom:10px">' + K.icon("search") + '<input class="input" id="pq" placeholder="Zoek artikel…" value="' + esc(S.productQ) + '"></div>' +
      (list.length ? cats.map((cat) => '<h2 class="cat-title">' + esc(cat) + '</h2><div class="card pad-0 flat table-wrap" style="margin-bottom:14px"><table class="table"><thead><tr><th>Artikel</th><th>Eenheid</th><th class="num">Basisprijs</th><th>Actief</th><th></th></tr></thead><tbody>' + list.filter((p) => p.categoryLabel === cat).map((p) => '<tr class="' + (p.active ? "" : "off") + '"><td><b>' + esc(p.name) + "</b></td><td>" + esc(p.unitLabel) + '</td><td class="num"><input class="inline" data-price="' + p.id + '" value="' + K.inputNum(p.basePriceCents) + '" inputmode="decimal" aria-label="Basisprijs"></td><td><label class="check" style="min-height:40px"><input type="checkbox" data-active="' + p.id + '"' + (p.active ? " checked" : "") + '> <span class="small">' + (p.active ? "ja" : "nee") + "</span></label></td><td>" + c.btn({ label: "Bewerken", kind: "ghost", size: "sm", attrs: ' data-edit="' + p.id + '"' }) + "</td></tr>").join("") + "</tbody></table></div>").join("") : c.empty({ text: d.products.length ? "Geen artikel gevonden." : "Nog geen artikelen. Voeg het eerste artikel toe zodat klanten kunnen bestellen.", action: d.products.length ? "" : c.btn({ label: "Nieuw artikel", kind: "primary", id: "new2" }) }));
    $("#pq").oninput = K.debounce(() => { S.productQ = $("#pq").value; const pos = $("#pq").selectionStart; vArtikelen(el); $("#pq").focus(); $("#pq").setSelectionRange(pos, pos); }, 200);
    $("#new").onclick = () => productForm();
    if ($("#new2")) $("#new2").onclick = () => productForm();
    K.$$("[data-edit]").forEach((b) => { b.onclick = () => productForm(d.products.find((p) => p.id === b.dataset.edit)); });
    K.$$("[data-price]").forEach((i) => { i.onchange = async () => { const p = d.products.find((x) => x.id === i.dataset.price); const n = K.parseNum(i.value); if (!Number.isFinite(n) || n < 0) { i.value = K.inputNum(p.basePriceCents); return K.toast("Ongeldige prijs", "bad"); } const res = await post("beheer/producten", { id: p.id, naam: p.name, categorie: p.category, eenheid: p.unit, basisprijs: n, actief: p.active }); if (!res) { i.value = K.inputNum(p.basePriceCents); return; } apply(res); i.value = K.inputNum(res.product.basePriceCents); K.toast(p.name + ": basisprijs " + K.eur(res.product.basePriceCents), "ok"); }; });
    K.$$("[data-active]").forEach((i) => { i.onchange = async () => { const p = d.products.find((x) => x.id === i.dataset.active); const res = await post("beheer/producten", { id: p.id, naam: p.name, categorie: p.category, eenheid: p.unit, basisprijs: p.basePriceCents / 100, actief: i.checked }); if (!res) { i.checked = !i.checked; return; } apply(res); K.toast(p.name + (i.checked ? " staat weer in de catalogus" : " is verborgen voor klanten"), "ok"); vArtikelen(el); }; });
    if (S.params.nieuw) { S.params = {}; K.route.set("artikelen", {}, true); productForm(); }
  }
  function productForm(p) {
    const isNew = !p; const v = p || {};
    const cats = []; S.d.products.forEach((x) => { if (!cats.includes(x.category)) cats.push(x.category); });
    const body = document.createElement("div");
    body.innerHTML = c.field({ id: "p_naam", label: "Artikelnaam", value: v.name, attrs: " required", placeholder: "Bv. Zalmfilet met vel" }) +
      '<div class="form-row">' + c.field({ id: "p_cat", label: "Categorie", value: v.category || "", attrs: ' list="catlist"', placeholder: "Bv. Verse vis" }) + '<datalist id="catlist">' + cats.map((x) => '<option value="' + esc(x) + '">').join("") + "</datalist>" + c.field({ id: "p_unit", label: "Eenheid", select: true, options: S.d.units, value: v.unit || (S.d.units[0] || {}).value }) + "</div>" +
      '<div class="form-row">' + c.field({ id: "p_price", label: "Basisprijs excl. btw (€ per eenheid)", value: isNew ? "" : K.inputNum(v.basePriceCents), attrs: ' inputmode="decimal"', placeholder: "0,00" }) + '<div class="field"><label>Zichtbaar voor klanten</label><label class="check"><input type="checkbox" id="p_active"' + (isNew || v.active ? " checked" : "") + "> Actief in de catalogus</label></div></div>" +
      '<p class="small muted">Klanten met een eigen prijs voor dit artikel zien hun klantprijs; alle anderen de basisprijs.</p>';
    const s = K.sheet({ title: isNew ? "Nieuw artikel" : "Artikel bewerken", body, center: true, footer: '<div class="row" style="justify-content:flex-end">' + c.btn({ label: "Terug", kind: "outline", attrs: " data-close" }) + c.btn({ label: isNew ? "Toevoegen" : "Opslaan", kind: "primary", id: "ok" }) + "</div>" });
    $("#ok", s.el).onclick = async () => {
      const price = K.parseNum($("#p_price", body).value);
      if (!$("#p_naam", body).value.trim()) return K.toast("Vul de artikelnaam in.", "bad");
      if (!Number.isFinite(price) || price < 0) return K.toast("Vul een geldige basisprijs in.", "bad");
      const res = await post("beheer/producten", { id: v.id || "", naam: $("#p_naam", body).value, categorie: $("#p_cat", body).value, eenheid: $("#p_unit", body).value, basisprijs: price, actief: $("#p_active", body).checked }, $("#ok", s.el));
      if (!res) return; apply(res); s.close(); K.toast(isNew ? "Artikel toegevoegd" : "Artikel opgeslagen", "ok"); render();
    };
  }

  // ---- Klantprijzen ----------------------------------------------------------------------------------------------
  function vPrijzen(el) {
    const d = S.d;
    if (S.params.klant) { S.priceClient = S.params.klant; }
    const cl = clientById(S.priceClient);
    const mine = cl ? d.prices.filter((p) => p.clientId === cl.id) : [];
    const q = (S.priceQ || "").toLowerCase();
    const onlyNeg = !!S.priceOnlyNeg;
    const products = d.products.filter((p) => p.active || mine.some((x) => x.productId === p.id)).filter((p) => !q || (p.name + " " + p.categoryLabel).toLowerCase().includes(q)).filter((p) => !onlyNeg || mine.some((x) => x.productId === p.id));
    el.innerHTML = head("Klantprijzen", cl ? c.btn({ label: "Prijzen kopiëren van een andere klant", kind: "outline", size: "sm", id: "copy" }) : "", "Een klantprijs vervangt de basisprijs voor die ene klant. Leeg laten = basisprijs.") +
      c.card('<div class="field"><label for="pc">Klant</label><select class="select" id="pc"><option value="">— Kies een klant —</option>' + d.clients.map((x) => '<option value="' + x.id + '"' + (x.id === S.priceClient ? " selected" : "") + ">" + esc(x.name) + (x.number ? " · " + esc(x.number) : "") + " (" + d.prices.filter((p) => p.clientId === x.id).length + ")</option>").join("") + "</select></div>") +
      (cl ? '<div class="row wrap" style="margin:12px 0 10px"><div class="searchbox" style="flex:1;min-width:200px">' + K.icon("search") + '<input class="input" id="pq" placeholder="Zoek artikel…" value="' + esc(S.priceQ || "") + '"></div><div class="segmented"><button data-neg="0" class="' + (onlyNeg ? "" : "on") + '">Alle artikelen</button><button data-neg="1" class="' + (onlyNeg ? "on" : "") + '">Enkel met klantprijs (' + mine.length + ")</button></div></div>" +
        '<div class="card pad-0 flat table-wrap"><table class="table"><thead><tr><th>Artikel</th><th class="num">Basisprijs</th><th class="num">Klantprijs voor ' + esc(cl.name) + '</th><th></th></tr></thead><tbody>' + (products.length ? products.map((p) => { const np = mine.find((x) => x.productId === p.id); return '<tr class="' + (p.active ? "" : "off") + '"><td><b>' + esc(p.name) + '</b> <span class="muted small">' + esc(p.categoryLabel) + " · per " + esc(p.unitLabel) + (p.active ? "" : " · niet actief") + '</span></td><td class="num muted">' + K.eur(p.basePriceCents) + '</td><td class="num"><input class="inline' + (np ? " neg" : "") + '" data-np="' + p.id + '" value="' + (np ? K.inputNum(np.priceCents) : "") + '" placeholder="' + K.inputNum(p.basePriceCents) + '" inputmode="decimal" aria-label="Klantprijs"></td><td class="small">' + (np ? '<span class="pill pill-ok">' + (np.priceCents < p.basePriceCents ? "−" : "+") + K.eur(Math.abs(np.priceCents - p.basePriceCents)) + "</span> " + c.btn({ label: "Wis", kind: "ghost", size: "sm", attrs: ' data-clear="' + p.id + '"' }) : "") + "</td></tr>"; }).join("") : '<tr><td colspan="4">' + c.empty({ text: "Geen artikel gevonden." }) + "</td></tr>") + '</tbody></table></div><p class="small muted" style="margin-top:8px">Typ een prijs en verlaat het veld: de prijs wordt meteen bewaard en geldt voor de volgende bestelling.</p>' : c.empty({ text: "Kies een klant om zijn prijzen te zien of te wijzigen." }));
    $("#pc").onchange = () => { S.priceClient = $("#pc").value; S.params = {}; K.route.set("prijzen", S.priceClient ? { klant: S.priceClient } : {}, true); vPrijzen(el); };
    if (!cl) return;
    $("#pq").oninput = K.debounce(() => { S.priceQ = $("#pq").value; const pos = $("#pq").selectionStart; vPrijzen(el); $("#pq").focus(); $("#pq").setSelectionRange(pos, pos); }, 200);
    K.$$("[data-neg]").forEach((b) => { b.onclick = () => { S.priceOnlyNeg = b.dataset.neg === "1"; vPrijzen(el); }; });
    const save = async (productId, value, input) => {
      const p = d.products.find((x) => x.id === productId);
      const empty = !String(value).trim();
      const n = empty ? null : K.parseNum(value);
      if (!empty && (!Number.isFinite(n) || n < 0)) { K.toast("Ongeldige prijs", "bad"); return; }
      if (!empty && p.basePriceCents && (n * 100 < p.basePriceCents * 0.3 || n * 100 > p.basePriceCents * 3) && !(await K.confirm({ title: "Ongewone prijs", text: "De klantprijs " + K.eur(Math.round(n * 100)) + " wijkt sterk af van de basisprijs " + K.eur(p.basePriceCents) + ". Toch opslaan?", yes: "Opslaan" }))) { vPrijzen(el); return; }
      const res = await post("beheer/prijzen", { klantId: cl.id, productId, prijs: empty ? null : n }, input && input.closest ? null : null);
      if (!res) { vPrijzen(el); return; }
      apply(res); K.toast(p.name + ": " + (empty ? "klantprijs gewist (basisprijs geldt)" : "klantprijs " + K.eur(Math.round(n * 100))), "ok"); vPrijzen(el);
    };
    K.$$("[data-np]").forEach((i) => { i.onchange = () => save(i.dataset.np, i.value, i); i.onkeydown = (e) => { if (e.key === "Enter") i.blur(); }; });
    K.$$("[data-clear]").forEach((b) => { b.onclick = () => save(b.dataset.clear, "", b); });
    $("#copy").onclick = () => {
      const others = d.clients.filter((x) => x.id !== cl.id && d.prices.some((p) => p.clientId === x.id));
      if (!others.length) return K.toast("Geen andere klant heeft klantprijzen.", "bad");
      const body = document.createElement("div");
      body.innerHTML = '<p class="muted small">Kopieert alle klantprijzen van de gekozen klant naar <b>' + esc(cl.name) + "</b>. Bestaande klantprijzen van " + esc(cl.name) + ' worden overschreven.</p><div class="list">' + others.map((x) => c.item({ attrs: ' data-from="' + x.id + '"', title: esc(x.name), sub: K.plural(d.prices.filter((p) => p.clientId === x.id).length, "klantprijs", "klantprijzen"), chevron: true })).join("") + "</div>";
      const s = K.sheet({ title: "Prijzen kopiëren", body, footer: false });
      K.$$("[data-from]", body).forEach((b) => { b.onclick = async () => { const from = clientById(b.dataset.from); if (!(await K.confirm({ title: "Kopiëren?", text: "Alle klantprijzen van " + from.name + " naar " + cl.name + ".", yes: "Kopiëren" }))) return; const res = await post("beheer/prijzen/kopieer", { van: from.id, naar: cl.id }, b); if (!res) return; apply(res); s.close(); K.toast(K.plural(res.copied, "prijs", "prijzen") + " gekopieerd", "ok"); vPrijzen(el); }; });
    };
  }

  // ---- Facturen -------------------------------------------------------------------------------------------------
  function vFacturen(el) {
    const d = S.d;
    if (S.params.open) { S.invOpen = true; S.params = {}; K.route.set("facturen", {}, true); }
    const years = []; d.invoices.forEach((i) => { const y = i.date.slice(0, 4); if (!years.includes(y)) years.push(y); }); if (!years.includes(String(d.stats.year))) years.unshift(String(d.stats.year)); years.sort().reverse();
    if (!years.includes(S.invYear)) S.invYear = years[0];
    const months = ["", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
    const list = d.invoices.filter((i) => i.date.startsWith(S.invYear)).filter((i) => !S.invMonth || i.date.slice(5, 7) === S.invMonth).filter((i) => !S.invOpen || !i.paid);
    const sum = (k) => list.reduce((s, i) => s + i.vat[k], 0);
    const openSum = list.filter((i) => !i.paid).reduce((s, i) => s + i.vat.inclCents, 0);
    const csv = "/api/beheer/facturen?formaat=csv&jaar=" + S.invYear + (S.invMonth ? "&maand=" + S.invMonth : "");
    el.innerHTML = head("Facturen", c.btn({ label: "Exporteren (CSV voor de boekhouder)", kind: "outline", size: "sm", icon: "doc", href: csv }), "Elke bevestigde levering krijgt automatisch een factuurnummer. Betaald zetten kan hier of in het teamportaal.") +
      '<div class="row wrap" style="margin-bottom:10px"><div class="segmented">' + years.map((y) => '<button data-year="' + y + '" class="' + (S.invYear === y ? "on" : "") + '">' + y + "</button>").join("") + '</div><select class="select" id="month" style="width:auto;min-width:160px"><option value="">Heel het jaar</option>' + months.map((m, i) => (i ? '<option value="' + String(i).padStart(2, "0") + '"' + (S.invMonth === String(i).padStart(2, "0") ? " selected" : "") + ">" + m + "</option>" : "")).join("") + '</select><label class="check"><input type="checkbox" id="onlyOpen"' + (S.invOpen ? " checked" : "") + "> Enkel openstaand</label></div>" +
      '<div class="grid grid-3" style="margin-bottom:12px">' + c.kpi(list.length, "Facturen") + c.kpi(K.eur(sum("exclCents")), "Excl. btw") + c.kpi(K.eur(sum("vatCents")), "Btw") + c.kpi(K.eur(sum("inclCents")), "Incl. btw") + c.kpi(K.eur(openSum), "Nog te ontvangen") + "</div>" +
      '<div class="card pad-0 flat table-wrap"><table class="table"><thead><tr><th>Nummer</th><th>Datum</th><th>Klant</th><th class="num">Excl.</th><th class="num">Incl.</th><th>Betaald</th><th></th></tr></thead><tbody>' + (list.length ? list.map((i) => '<tr><td><b>' + esc(i.invoiceNumber) + '</b><div class="small muted">' + esc(i.ref) + "</div></td><td>" + esc(K.dateShort(i.date)) + '</td><td><a href="#/klanten?id=' + esc(i.clientId) + '">' + esc(i.clientName || "—") + '</a></td><td class="num">' + K.eur(i.vat.exclCents) + '</td><td class="num"><b>' + K.eur(i.vat.inclCents) + '</b></td><td><label class="check" style="min-height:40px"><input type="checkbox" data-paid="' + i.id + '"' + (i.paid ? " checked" : "") + "> " + K.chip(i.paid ? "betaald" : "open", i.paid ? "Betaald" : "Openstaand") + '</label></td><td><div class="row" style="gap:4px">' + c.btn({ label: "Factuur", kind: "ghost", size: "sm", href: "/doc/factuur/" + i.id, blank: true }) + c.btn({ label: "Bestelling", kind: "ghost", size: "sm", href: "/team?bestelling=" + i.id }) + c.btn({ label: "Mailen", kind: "ghost", size: "sm", attrs: ' data-mail="' + i.id + '"', disabled: !mailOn() }) + "</div></td></tr>").join("") : '<tr><td colspan="7">' + c.empty({ text: S.invOpen ? "Geen openstaande facturen in deze periode." : "Geen facturen in deze periode." }) + "</td></tr>") + "</tbody></table></div>";
    K.$$("[data-year]").forEach((b) => { b.onclick = () => { S.invYear = b.dataset.year; vFacturen(el); }; });
    $("#month").onchange = () => { S.invMonth = $("#month").value; vFacturen(el); };
    $("#onlyOpen").onchange = () => { S.invOpen = $("#onlyOpen").checked; vFacturen(el); };
    K.$$("[data-paid]").forEach((i) => { i.onchange = async () => { const inv = d.invoices.find((x) => x.id === i.dataset.paid); const res = await post("beheer/bestellingen/" + inv.id + "/betaald", { betaald: i.checked }); if (!res) { i.checked = !i.checked; return; } inv.paid = res.paid; d.stats.openCents = d.invoices.filter((x) => !x.paid).reduce((s, x) => s + x.vat.inclCents, 0); K.toast(inv.invoiceNumber + (res.paid ? " betaald" : " openstaand"), "ok"); vFacturen(el); }; });
    K.$$("[data-mail]").forEach((b) => { b.onclick = async () => { const inv = d.invoices.find((x) => x.id === b.dataset.mail); const cl = clientById(inv.clientId); if (!cl || !cl.email) return K.toast("Deze klant heeft geen e-mailadres.", "bad"); if (!(await K.confirm({ title: "Factuur mailen?", text: inv.invoiceNumber + " naar " + cl.email, yes: "Mailen" }))) return; const res = await post("team/bestellingen/" + inv.id + "/mail", { type: "factuur" }, b); if (res) K.toast("Factuur gemaild naar " + cl.email, "ok"); }; });
  }

  // ---- Bedrijf -------------------------------------------------------------------------------------------------
  function vBedrijf(el) {
    const cfg = S.d.config;
    const days = String(cfg.deliveryDays || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const DAYS = [["ma", "maandag"], ["di", "dinsdag"], ["wo", "woensdag"], ["do", "donderdag"], ["vr", "vrijdag"], ["za", "zaterdag"], ["zo", "zondag"]];
    el.innerHTML = head("Bedrijf", "", "Deze gegevens staan op elke leveringsbon, factuur en e-mail.") +
      '<form id="bf" class="stack">' + c.card('<h2 style="margin-bottom:10px">Identiteit</h2><div class="form-row">' + c.field({ id: "companyName", label: "Bedrijfsnaam", value: cfg.companyName, attrs: " required" }) + c.field({ id: "vat", label: "Btw-nummer", value: cfg.vat, placeholder: "BE 0123.456.789" }) + '</div><div class="form-row">' + c.field({ id: "street", label: "Straat en nummer", value: cfg.street }) + c.field({ id: "city", label: "Postcode en gemeente", value: cfg.city }) + '</div><div class="form-row">' + c.field({ id: "phone", label: "Telefoon", type: "tel", value: cfg.phone, help: "Klanten zien dit nummer bij vragen en na de besteldeadline." }) + c.field({ id: "email", label: "E-mailadres (zichtbaar voor klanten)", type: "email", value: cfg.email, help: "Antwoorden van klanten op e-mails komen hier toe." }) + "</div>") +
        c.card('<h2 style="margin-bottom:10px">Betaling</h2><div class="form-row">' + c.field({ id: "iban", label: "IBAN", value: cfg.iban, placeholder: "BE00 0000 0000 0000", help: "Staat op de factuur. Zonder IBAN kan de klant niet betalen." }) + c.field({ id: "bic", label: "BIC", value: cfg.bic }) + '</div><div class="form-row">' + c.field({ id: "vatRate", label: "Btw-tarief (%)", value: cfg.vatRate, attrs: ' inputmode="decimal"', help: "Voeding: 6." }) + c.field({ id: "paymentTerms", label: "Betaaltermijn", value: cfg.paymentTerms, placeholder: "Betaling binnen 30 dagen", help: "De vervaldatum op de factuur volgt uit het aantal dagen hierin." }) + "</div>") +
        c.card('<h2 style="margin-bottom:10px">Bestellen en leveren</h2><div class="form-row">' + c.field({ id: "cutoff", label: "Besteldeadline (uur)", type: "time", value: cfg.cutoff, help: "Bestellingen na dit uur zijn voor de eerstvolgende leverdag daarna." }) + '<div class="field"><label>Leverdagen</label><div class="row wrap">' + DAYS.map(([k, l]) => '<label class="check" style="min-height:40px"><input type="checkbox" data-day="' + k + '"' + (days.includes(k) ? " checked" : "") + "> " + l + "</label>").join("") + "</div></div></div>" + c.field({ id: "deliveryTerms", label: "Leveringsvoorwaarden (onderaan de leveringsbon)", value: cfg.deliveryTerms, multiline: true, rows: 3 })) +
        c.card('<h2 style="margin-bottom:10px">Interne postbus</h2>' + c.field({ id: "opsEmail", label: "E-mailadres van het team", type: "email", value: cfg.opsEmail, placeholder: "bestellingen@…", help: "Hier komen nieuwe bestellingen, aanvragen en factuurkopieën toe. Leeg = het zichtbare e-mailadres hierboven." })) +
        c.btn({ label: "Opslaan", kind: "primary", size: "lg", type: "submit", id: "save" }) + "</form>";
    $("#bf").onsubmit = async (e) => {
      e.preventDefault();
      const body = {}; ["companyName", "vat", "street", "city", "phone", "email", "iban", "bic", "vatRate", "paymentTerms", "cutoff", "deliveryTerms", "opsEmail"].forEach((k) => { body[k] = $("#" + k).value; });
      body.deliveryDays = K.$$("[data-day]").filter((x) => x.checked).map((x) => x.dataset.day).join(",");
      if (!body.deliveryDays) return K.toast("Kies minstens één leverdag.", "bad");
      const res = await post("beheer/bedrijf", body, $("#save")); if (!res) return; apply(res); K.toast("Bedrijfsgegevens opgeslagen", "ok"); try { await load(); } catch (_) { /* oude */ } render();
    };
    if (S.params.focus && $("#" + S.params.focus)) { const f = $("#" + S.params.focus); f.focus(); f.scrollIntoView({ block: "center" }); S.params = {}; K.route.set("bedrijf", {}, true); }
  }

  // ---- Toegang en codes -------------------------------------------------------------------------------------------
  function vToegang(el) {
    const cfg = S.d.config;
    const block = (which, title, who, custom) => c.card('<h2>' + title + '</h2><p class="muted small">' + who + "</p>" + (custom ? c.notice("ok", "Eigen code ingesteld via dit scherm.") : c.notice("info", "Nu geldt de code die op Vercel staat (" + (which === "admin" ? "ADMIN_CODE" : "STAFF_CODE") + "). Stel hier een eigen code in om ze zonder Vercel te kunnen wijzigen.")) +
      '<form data-code="' + which + '" class="stack" style="margin-top:10px"><div class="form-row">' + c.field({ id: which + "_1", label: "Nieuwe code", type: "password", attrs: ' autocomplete="new-password" minlength="10"', help: "Minstens 10 tekens, niet de bedrijfsnaam." }) + c.field({ id: which + "_2", label: "Herhaal de nieuwe code", type: "password", attrs: ' autocomplete="new-password"' }) + '</div><div class="row wrap">' + c.btn({ label: "Code instellen", kind: "primary", type: "submit" }) + (custom ? c.btn({ label: "Terug naar de code van Vercel", kind: "ghost", attrs: ' data-reset="' + which + '"' }) : "") + "</div></form>");
    el.innerHTML = head("Toegang en codes", "", "Wie mag wat: klanten met hun eigen wachtwoord, het team met de teamcode, u met de beheerderscode.") +
      '<div class="grid grid-2">' + block("staff", "Teamcode", "Voor magazijn en chauffeurs: geeft toegang tot het teamportaal (" + esc(location.origin) + "/team). Niet tot beheer.", cfg.staffCodeCustom) + block("admin", "Beheerderscode", "Voor u: geeft toegang tot beheer én het teamportaal.", cfg.adminCodeCustom) + "</div>" +
      c.card('<h2>Klanten</h2><p class="muted small">Elke klant meldt aan met een eigen gebruikersnaam (of e-mailadres) en wachtwoord. Wachtwoord vergeten? De klant kan zelf een nieuw wachtwoord aanvragen via e-mail, of u maakt er een op de klantfiche.</p>' + c.btn({ label: "Naar de klanten", kind: "outline", size: "sm", attrs: ' data-goto="klanten"' }), { attrs: ' style="margin-top:14px"' }) +
      c.notice("warn", "Na het wijzigen van een code blijven toestellen die al aangemeld zijn nog maximaal 12 uur aangemeld.");
    K.$$("[data-code]").forEach((f) => { K.pwToggle($("#" + f.dataset.code + "_1", f)); f.onsubmit = async (e) => { e.preventDefault(); const w = f.dataset.code; const a = $("#" + w + "_1").value, b = $("#" + w + "_2").value; if (a !== b) return K.toast("De twee codes zijn niet gelijk.", "bad"); if (a.length < 10) return K.toast("De code moet minstens 10 tekens lang zijn.", "bad"); if (!(await K.confirm({ title: (w === "admin" ? "Beheerderscode" : "Teamcode") + " wijzigen?", text: "Geef de nieuwe code door aan wie ze nodig heeft. De oude werkt na het opslaan niet meer.", yes: "Wijzigen" }))) return; const res = await post("beheer/codes", { rol: w, code: a }, $("button[type=submit]", f)); if (!res) return; apply(res); K.toast("Code gewijzigd", "ok"); vToegang(el); }; });
    K.$$("[data-reset]").forEach((b) => { b.onclick = async () => { const w = b.dataset.reset; if (!(await K.confirm({ title: "Terug naar de code van Vercel?", text: "De eigen code wordt gewist. Daarna geldt weer " + (w === "admin" ? "ADMIN_CODE" : "STAFF_CODE") + " zoals ingesteld op Vercel.", yes: "Ja", danger: true }))) return; const res = await post("beheer/codes", { rol: w, reset: true }, b); if (!res) return; apply(res); K.toast("Eigen code gewist", "ok"); vToegang(el); }; });
    K.$$("[data-goto]").forEach((b) => { b.onclick = () => go(b.dataset.goto); });
  }

  // ---- Systeemcontrole ------------------------------------------------------------------------------------------
  function vControle(el) {
    const env = S.d.env;
    el.innerHTML = head("Systeemcontrole", c.btn({ label: "Controle uitvoeren", kind: "primary", icon: "check", id: "run" }), "Doorloopt in één minuut de hele keten met een tijdelijke testklant en testbestelling. Alles wordt achteraf opgeruimd.") +
      '<div class="grid grid-2" style="margin-bottom:14px">' + c.card('<h2>E-mail</h2>' + (env.mailEnabled ? c.notice("ok", "E-mail staat aan. Afzender: <b>" + esc(env.mailFrom || "standaard") + "</b>.") : c.notice("warn", "E-mail staat <b>uit</b>: er vertrekken geen bevestigingen, leveringsbonnen of facturen. Op Vercel moet <code>RESEND_API_KEY</code> ingesteld zijn.")) + '<p class="small muted" style="margin-top:8px">Klanten antwoorden op ' + esc(S.d.config.email || "—") + "; het team krijgt kopieën op " + esc(S.d.config.opsEmail || S.d.config.email || "—") + ".</p>") +
        c.card('<h2>Portaal</h2><div class="list">' + c.item({ button: false, title: "Klanten bestellen op", sub: '<a href="' + esc(env.portalUrl) + '" target="_blank" rel="noopener">' + esc(env.portalUrl) + "</a>" }) + c.item({ button: false, title: "Team (magazijn, chauffeur)", sub: '<a href="/team">' + esc(env.portalUrl.replace(/\/$/, "")) + "/team</a>" }) + c.item({ button: false, title: "Toegang aanvragen (voor prospects)", sub: '<a href="/aanvraag" target="_blank" rel="noopener">' + esc(env.portalUrl.replace(/\/$/, "")) + "/aanvraag</a>" }) + "</div>" + (env.missing && env.missing.length ? c.notice("bad", "Ontbrekende instellingen op Vercel: " + env.missing.map(esc).join(", ")) : "")) + "</div>" +
      '<div id="result">' + (S.check ? checkResult(S.check) : "") + "</div>";
    $("#run").onclick = async () => { $("#result").innerHTML = '<div class="card flat"><div class="row">' + '<span class="spinner"></span> Bezig… dit duurt tot een minuut.</div></div>'; const res = await post("beheer/systeemcontrole", {}, $("#run")); if (!res) { $("#result").innerHTML = ""; return; } S.check = res; $("#result").innerHTML = checkResult(res); };
  }
  function checkResult(r) {
    return c.card((r.ok ? c.notice("ok", "<b>Alles werkt.</b> Klantlogin, bestellen, e-mails, klaarzetten, onderweg, levering en documenten zijn getest en de testgegevens zijn opgeruimd.") : c.notice("bad", "<b>Er ging iets mis.</b> Bekijk de rode stap hieronder.")) + '<div class="check-list" style="margin-top:10px">' + r.steps.map((s) => '<div class="it ' + (s.ok ? "ok" : "bad") + '">' + K.icon(s.ok ? "check" : "x") + "<div><b>" + esc(s.label) + '</b><div class="small muted">' + esc(s.detail || "") + (s.ms ? " · " + s.ms + " ms" : "") + "</div></div></div>").join("") + "</div>", { attrs: ' style="margin-top:14px"' });
  }

  // ---- Start ---------------------------------------------------------------------------------------------------
  async function boot() {
    try { const s = await K.api("team/sessie"); if (s.role !== "admin") { renderLogin("U bent aangemeld met de teamcode. Voor beheer hebt u de beheerderscode nodig."); return; } S.role = "admin"; await afterLogin(); }
    catch (err) { if (err.status === 401) renderLogin(); else if (!(err.status === 503 && err.data && err.data.notConfigured)) K.renderFatal(main, err.message, boot); }
  }
  boot();
})();
