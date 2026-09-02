/* Beheer: klanten, artikelen, prijzen, aanvragen, facturen, bedrijf, toegang, systeemcontrole. */
(function () {
  "use strict";
  const $ = K.$, esc = K.esc;
  const main = $("#main"), who = $("#who");
  const S = { role: null, view: "overzicht", d: null, priceClient: "" };
  const SECTIONS = [["overzicht", "Overzicht"], ["aanvragen", "Aanvragen"], ["klanten", "Klanten"], ["artikelen", "Artikelen"], ["prijzen", "Prijzen"], ["facturen", "Facturen"], ["bedrijf", "Bedrijf"], ["toegang", "Toegang"], ["controle", "Systeemcontrole"]];

  function renderLogin(err) {
    who.innerHTML = "";
    main.innerHTML = '<div class="login-wrap"><div class="card"><h1>Beheer</h1><p class="muted">Meld u aan met de beheerderscode.</p><form id="f" class="stack"><div class="field"><label for="code">Beheerderscode</label><input class="input" id="code" type="password" autocomplete="current-password" required></div>' + (err ? '<div class="notice notice-bad">' + esc(err) + "</div>" : "") + '<button class="btn btn-accent btn-lg btn-block" type="submit">Aanmelden</button></form></div><p class="small muted center" style="margin-top:18px"><a href="/">Klantportaal</a> · <a href="/team">Magazijn en levering</a></p></div>';
    $("#f").onsubmit = async (e) => { e.preventDefault(); await K.busy($("button", e.target), async () => { try { const r = await K.api("team/login", { body: { code: $("#code").value } }); if (r.role !== "admin") { await K.api("team/logout", { body: {} }); return renderLogin("Dit is de teamcode. Beheer vraagt de beheerderscode."); } S.role = "admin"; await load(); render(); } catch (err) { renderLogin(err.message); } }); };
  }
  async function load() { S.d = await K.api("beheer/overzicht"); }
  function go(v) { S.view = v; render(); window.scrollTo(0, 0); }
  function render() {
    if (!S.role) return renderLogin();
    who.innerHTML = '<a href="/" target="_blank" style="color:#fff;margin-right:10px">Klantportaal</a><a href="/team" style="color:#fff;margin-right:10px">Teamportaal</a><button class="btn btn-sm btn-ghost" id="logout" style="color:#fff">Afmelden</button>';
    $("#logout").onclick = async () => { await K.api("team/logout", { body: {} }).catch(() => {}); S.role = null; renderLogin(); };
    const d = S.d;
    main.innerHTML = '<div class="side-layout"><nav class="side">' + SECTIONS.map(([k, l]) => '<button data-v="' + k + '" class="' + (S.view === k ? "on" : "") + '">' + l + (k === "aanvragen" && d.stats.requestsNew ? '<span class="pill pill-accent">' + d.stats.requestsNew + "</span>" : "") + "</button>").join("") + '</nav><div id="panel"></div></div>';
    K.$$("[data-v]").forEach((b) => { b.onclick = () => go(b.dataset.v); });
    const p = $("#panel");
    ({ overzicht, aanvragen, klanten, artikelen, prijzen, facturen, bedrijf, toegang, controle })[S.view](p);
  }
  async function refresh() { await load(); render(); }
  const field = (id, label, value, opts) => { const o = opts || {}; return '<div class="field"><label for="' + id + '">' + esc(label) + "</label>" + (o.multi ? '<textarea class="textarea" id="' + id + '"' + (o.rows ? ' style="min-height:' + o.rows * 24 + 'px"' : "") + ">" + esc(value || "") + "</textarea>" : '<input class="input" id="' + id + '" type="' + (o.type || "text") + '" value="' + esc(value == null ? "" : value) + '"' + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : "") + (o.attrs || "") + ">") + (o.help ? '<div class="help">' + esc(o.help) + "</div>" : "") + "</div>"; };

  // ---- Overzicht ---------------------------------------------------------------------------------
  function overzicht(p) {
    const d = S.d;
    p.innerHTML = '<h1 style="margin-bottom:12px">Overzicht</h1>' +
      (d.warnings.length ? '<div class="stack" style="margin-bottom:14px">' + d.warnings.map((w) => '<div class="notice notice-warn">' + K.icon("warn") + "<div>" + esc(w.text) + "</div></div>").join("") + "</div>" : '<div class="notice notice-ok" style="margin-bottom:14px">' + K.icon("check") + "<div>Alles is ingesteld. Het portaal is klaar voor gebruik.</div></div>") +
      '<div class="grid grid-3">' +
      '<div class="card kpi"><div class="v">' + d.stats.ordersOpen + '</div><div class="l">Open bestellingen</div></div>' +
      '<div class="card kpi"><div class="v">' + d.stats.requestsNew + '</div><div class="l">Nieuwe aanvragen</div></div>' +
      '<div class="card kpi"><div class="v">' + d.stats.invoicesThisYear + '</div><div class="l">Facturen in ' + d.stats.year + '</div></div>' +
      '<div class="card kpi"><div class="v">' + K.eur(d.stats.openCents) + '</div><div class="l">Openstaand (incl. btw)</div></div>' +
      '<div class="card kpi"><div class="v">' + K.eur(d.stats.revenueYearCents) + '</div><div class="l">Omzet ' + d.stats.year + ' (excl. btw)</div></div>' +
      '<div class="card kpi"><div class="v">' + d.clients.length + '</div><div class="l">Klanten · ' + d.products.filter((x) => x.active).length + " actieve artikelen</div></div></div>" +
      '<div class="card" style="margin-top:14px"><h2>Portaal</h2><p class="small muted">Klanten bestellen op <b>' + esc(d.env.portalUrl || location.origin) + '</b>. Het team werkt op <b>' + esc((d.env.portalUrl || location.origin) + "/team") + '</b>.</p><div class="row wrap"><a class="btn btn-outline" href="/" target="_blank">Klantportaal</a><a class="btn btn-outline" href="/team" target="_blank">Teamportaal</a><a class="btn btn-outline" href="/aanvraag" target="_blank">Aanvraagformulier</a></div>' +
      '<p class="small muted" style="margin-top:12px">E-mail: ' + (d.env.mailEnabled ? "ingeschakeld, verzonden als <b>" + esc(d.env.mailFrom) + "</b>" : "<b>uitgeschakeld</b>") + " · Bestelmeldingen naar <b>" + esc(d.config.opsEmail || d.config.email || "—") + "</b></p></div>";
  }

  // ---- Aanvragen ------------------------------------------------------------------------------------
  function aanvragen(p) {
    const d = S.d;
    const row = (r) => '<button class="item" data-req="' + r.id + '"><div class="body"><div class="title">' + esc(r.company) + ' <span class="muted small">· ' + esc(r.contact) + '</span></div><div class="sub">' + esc(r.email) + " · " + esc(r.phone) + (r.address ? " · " + esc(r.address) : "") + "</div>" + (r.notes ? '<div class="small">' + esc(r.notes) + "</div>" : "") + '</div><div class="end"><span class="pill ' + (r.isNew ? "pill-accent" : "pill-ok") + '">' + esc(r.status) + '</span><div class="small muted">' + esc(K.dateShort(r.createdTime.slice(0, 10))) + "</div></div></button>";
    const nw = d.requests.filter((r) => r.isNew), done = d.requests.filter((r) => !r.isNew);
    p.innerHTML = '<h1 style="margin-bottom:12px">Aanvragen</h1><div class="card pad-0 flat"><div class="list">' + (nw.length ? nw.map(row).join("") : '<div class="empty">Geen nieuwe aanvragen.</div>') + "</div></div>" + (done.length ? '<h2 style="margin:18px 0 8px">Verwerkt</h2><div class="card pad-0 flat"><div class="list">' + done.map(row).join("") + "</div></div>" : "");
    p.onclick = (e) => { const t = e.target.closest("[data-req]"); if (t) openRequest(d.requests.find((r) => r.id === t.dataset.req)); };
    if (S.openRequestId) { const r = d.requests.find((x) => x.id === S.openRequestId); S.openRequestId = ""; if (r) openRequest(r); }
  }
  function openRequest(r) {
    if (!r.isNew) return K.sheet({ title: r.company, body: "<p>Deze aanvraag is al verwerkt.</p><p class=\"small\">" + esc(r.notes || "") + "</p>", footer: false });
    const b = document.createElement("div");
    b.innerHTML = '<p class="muted small">Maak een klantaccount aan op basis van de aanvraag. De inloggegevens verschijnen één keer en gaan (optioneel) meteen per e-mail naar de klant.</p><div class="stack">' + field("rn", "Klantnaam", r.company) + '<div class="form-row">' + field("re", "E-mail", r.email, { type: "email" }) + field("rt", "Telefoon", r.phone) + "</div>" + field("ra", "Leveradres", r.address, { multi: true, rows: 3 }) + '<div class="form-row">' + field("rv", "Btw-nummer", "", { ph: "BE 0123.456.789" }) + field("ru", "Gebruikersnaam", "", { ph: "leeg = automatisch" }) + '</div><label class="check"><input type="checkbox" id="rm" checked> Inloggegevens per e-mail sturen</label></div>';
    const s = K.sheet({ title: "Aanvraag van " + r.company, body: b, footer: '<div class="row wrap"><button class="btn btn-ghost" id="close">Afhandelen zonder account</button><span style="flex:1"></span><button class="btn btn-accent" id="ok">Klant aanmaken</button></div>' });
    $("#ok", s.el).onclick = () => K.busy($("#ok", s.el), async () => {
      try {
        const res = await K.api("beheer/aanvragen/" + encodeURIComponent(r.id) + "/goedkeuren", { body: { naam: $("#rn", b).value, email: $("#re", b).value, telefoon: $("#rt", b).value, adres: $("#ra", b).value, btw: $("#rv", b).value, gebruikersnaam: $("#ru", b).value, stuurMail: $("#rm", b).checked } });
        S.d = res.overview; s.close(); showCredentials(res.client, res.password, res.mail); render();
      } catch (err) { K.toast(err.message, "bad"); }
    });
    $("#close", s.el).onclick = () => {
      const b2 = document.createElement("div");
      b2.innerHTML = '<div class="stack">' + field("dn", "Reden (intern, niet zichtbaar voor de aanvrager)", "", { ph: "Bv. geen horeca, buiten leverzone" }) + '<label class="check"><input type="checkbox" id="dm" checked> De aanvrager per e-mail verwittigen</label>' + field("dt", "Bericht aan de aanvrager", "Bedankt voor uw interesse. Op dit moment kunnen wij helaas geen account voor u openen.", { multi: true, rows: 3 }) + "</div>";
      const s2 = K.sheet({ title: "Aanvraag afhandelen zonder account", body: b2, center: true, footer: '<div class="row" style="justify-content:flex-end"><button class="btn btn-outline" data-close>Annuleren</button><button class="btn btn-danger" id="ok2">Afhandelen</button></div>' });
      $("#ok2", s2.el).onclick = () => K.busy($("#ok2", s2.el), async () => { try { const res = await K.api("beheer/aanvragen/" + encodeURIComponent(r.id) + "/afhandelen", { body: { notitie: $("#dn", b2).value, stuurMail: $("#dm", b2).checked, bericht: $("#dt", b2).value } }); S.d = res.overview; s2.close(); s.close(); render(); K.toast(res.mail && res.mail.ok ? "Aanvraag afgehandeld, aanvrager verwittigd" : "Aanvraag afgehandeld", "ok"); } catch (err) { K.toast(err.message, "bad"); } });
    };
  }
  function showCredentials(client, password, mail) {
    K.sheet({ title: "Toegang voor " + client.name, center: true, body: '<p>Bewaar deze gegevens: het wachtwoord verschijnt maar één keer.</p><div class="stack"><div class="code-box"><span>Gebruikersnaam</span><b class="mono">' + esc(client.username) + '</b></div><div class="code-box"><span>Wachtwoord</span><b class="mono">' + esc(password) + "</b></div></div>" + (mail ? '<p class="small ' + (mail.ok ? "muted" : "") + '" style="margin-top:10px">' + (mail.ok ? "✅ Per e-mail verzonden naar " + esc(client.email) + "." : "⚠️ E-mail niet verzonden (" + esc(mail.error || mail.skipped || "onbekend") + "). Geef de gegevens zelf door.") + "</p>" : '<p class="small muted" style="margin-top:10px">Niet per e-mail verzonden. Geef de gegevens zelf door.</p>') + '<p class="small muted">Portaal: <b>' + esc(S.d.env.portalUrl || location.origin) + "</b></p>", footer: '<button class="btn btn-accent btn-block" data-close>Gedaan</button>' });
  }

  // ---- Klanten -----------------------------------------------------------------------------------------
  function klanten(p) {
    const d = S.d;
    const q = (p.dataset.q || "").toLowerCase();
    const rows = d.clients.filter((c) => !q || [c.name, c.number, c.username, c.email, c.phone, c.address].join(" ").toLowerCase().includes(q));
    p.innerHTML = '<div class="section-head"><h1>Klanten</h1><button class="btn btn-accent" id="new">' + K.icon("plus") + ' Nieuwe klant</button></div><div class="searchbox" style="margin-bottom:10px;max-width:420px">' + K.icon("search") + '<input class="input" id="cq" placeholder="Zoek klant…" value="' + esc(p.dataset.q || "") + '"></div><div class="card pad-0 table-wrap"><table class="table"><thead><tr><th>Klant</th><th>Nr.</th><th>Gebruikersnaam</th><th>E-mail</th><th>Telefoon</th><th class="num">Bestellingen</th><th>Laatste</th></tr></thead><tbody>' +
      rows.map((c) => '<tr data-cl="' + c.id + '" style="cursor:pointer"><td><b>' + esc(c.name) + "</b>" + (!c.hasPassword ? ' <span class="pill pill-warn">geen wachtwoord</span>' : "") + "</td><td>" + esc(c.number) + '</td><td class="mono">' + esc(c.username) + "</td><td>" + (c.email ? esc(c.email) : '<span class="pill pill-warn">geen e-mail</span>') + "</td><td>" + esc(c.phone) + '</td><td class="num">' + c.orderCount + "</td><td>" + esc(c.lastOrder ? K.dateShort(c.lastOrder) : "—") + "</td></tr>").join("") + "</tbody></table>" + (!rows.length ? '<div class="empty">' + (q ? "Geen klant gevonden." : "Nog geen klanten.") + "</div>" : "") + "</div>";
    $("#cq").oninput = K.debounce(() => { p.dataset.q = $("#cq").value; const pos = $("#cq").selectionStart; klanten(p); $("#cq").focus(); $("#cq").setSelectionRange(pos, pos); }, 150);
    $("#new").onclick = () => editClient(null);
    p.onclick = (e) => { const t = e.target.closest("[data-cl]"); if (t) editClient(d.clients.find((c) => c.id === t.dataset.cl)); };
  }
  function editClient(c) {
    const b = document.createElement("div");
    const prices = c ? S.d.prices.filter((x) => x.clientId === c.id) : [];
    b.innerHTML = '<div class="stack">' + field("cn", "Klantnaam *", c ? c.name : "") + '<div class="form-row">' + field("ce", "E-mail (bevestigingen, facturen)", c ? c.email : "", { type: "email" }) + field("ct", "Telefoon", c ? c.phone : "") + "</div>" + field("ca", "Leveradres", c ? c.address : "", { multi: true, rows: 3 }) + '<div class="form-row">' + field("cv", "Btw-nummer", c ? c.vat : "", { ph: "BE 0123.456.789" }) + field("ck", "Klantnummer", c ? c.number : "", { ph: "leeg = automatisch" }) + field("cu", "Gebruikersnaam", c ? c.username : "", { ph: "leeg = automatisch", attrs: ' autocapitalize="none"' }) + "</div>" + field("cusual", "Vaste artikelen (geheugensteun voor het team)", c ? c.usual : "", { multi: true, rows: 2 }) + field("cnotes", "Interne notities (nooit zichtbaar voor de klant)", c ? c.notes : "", { multi: true, rows: 3 }) + "</div>" +
      (c ? '<div class="card flat" style="margin-top:14px"><div class="row spread wrap"><div><b>Toegang</b><div class="small muted">' + (c.hasPassword ? "Wachtwoord ingesteld." : "Nog geen wachtwoord: de klant kan niet aanmelden.") + '</div></div><div class="row wrap"><button class="btn btn-sm btn-outline" id="pw">Nieuw wachtwoord</button>' + (c.email ? '<button class="btn btn-sm btn-outline" id="pwmail">Nieuw wachtwoord + e-mail</button>' : "") + "</div></div></div>" +
        '<div class="card flat" style="margin-top:10px"><b>Klantprijzen</b> <span class="small muted">(' + K.plural(prices.length, "afwijkende prijs", "afwijkende prijzen") + ')</span> — <a href="#" id="toPrices">beheren onder Prijzen</a></div>' : "");
    const s = K.sheet({ title: c ? c.name : "Nieuwe klant", body: b, wide: true, footer: '<div class="row wrap">' + (c ? '<button class="btn btn-ghost" id="del" style="color:var(--bad)">Verwijderen</button>' : "") + '<span style="flex:1"></span><button class="btn btn-outline" data-close>Annuleren</button><button class="btn btn-accent" id="ok">Opslaan</button></div>' });
    $("#ok", s.el).onclick = () => K.busy($("#ok", s.el), async () => {
      try {
        const res = await K.api("beheer/klanten", { body: { id: c ? c.id : "", naam: $("#cn", b).value, email: $("#ce", b).value, telefoon: $("#ct", b).value, adres: $("#ca", b).value, btw: $("#cv", b).value, klantnummer: $("#ck", b).value, gebruikersnaam: $("#cu", b).value, vasteArtikelen: $("#cusual", b).value, notities: $("#cnotes", b).value } });
        S.d = res.overview; s.close(); render(); K.toast("Klant opgeslagen", "ok");
        if (res.password) showCredentials(res.client, res.password, null);
      } catch (err) { K.toast(err.message, "bad"); }
    });
    const newPw = async (send) => { if (!(await K.confirm({ title: "Nieuw wachtwoord?", text: "Het oude wachtwoord werkt daarna niet meer." + (send ? " De klant krijgt het nieuwe per e-mail." : ""), yes: "Ja, nieuw wachtwoord" }))) return; try { const r = await K.api("beheer/klanten/" + encodeURIComponent(c.id) + "/wachtwoord", { body: { stuurMail: !!send } }); showCredentials(Object.assign({}, c, { username: r.username }), r.password, r.mail); await load(); } catch (err) { K.toast(err.message, "bad"); } };
    if (c) { $("#pw", b).onclick = () => newPw(false); if ($("#pwmail", b)) $("#pwmail", b).onclick = () => newPw(true); $("#toPrices", b).onclick = (e) => { e.preventDefault(); S.priceClient = c.id; s.close(); go("prijzen"); }; }
    if (c) $("#del", s.el).onclick = async () => { if (!(await K.confirm({ title: "Klant verwijderen?", text: "Enkel mogelijk zonder bestellingen. Dit kan niet ongedaan worden gemaakt.", yes: "Verwijderen", danger: true }))) return; try { const res = await K.api("beheer/klanten/" + encodeURIComponent(c.id) + "/verwijderen", { body: {} }); S.d = res.overview; s.close(); render(); K.toast("Klant verwijderd"); } catch (err) { K.toast(err.message, "bad", 7000); } };
  }

  // ---- Artikelen -------------------------------------------------------------------------------------------
  function artikelen(p) {
    const d = S.d;
    const q = (p.dataset.q || "").toLowerCase();
    const rows = d.products.filter((x) => !q || (x.name + " " + x.categoryLabel).toLowerCase().includes(q));
    p.innerHTML = '<div class="section-head"><h1>Artikelen</h1><button class="btn btn-accent" id="new">' + K.icon("plus") + ' Nieuw artikel</button></div><div class="searchbox" style="margin-bottom:10px;max-width:420px">' + K.icon("search") + '<input class="input" id="pq" placeholder="Zoek artikel…" value="' + esc(p.dataset.q || "") + '"></div><div class="card pad-0 table-wrap"><table class="table"><thead><tr><th>Artikel</th><th>Categorie</th><th>Eenheid</th><th class="num">Basisprijs</th><th>Status</th></tr></thead><tbody>' +
      rows.map((x) => '<tr data-pr="' + x.id + '" style="cursor:pointer;' + (x.active ? "" : "opacity:.55") + '"><td><b>' + esc(x.name) + "</b></td><td>" + esc(x.categoryLabel) + "</td><td>" + esc(x.unitLabel) + '</td><td class="num">' + K.eur(x.basePriceCents) + "</td><td>" + (x.active ? '<span class="pill pill-ok">Actief</span>' : '<span class="pill">Niet actief</span>') + "</td></tr>").join("") + "</tbody></table></div><p class=\"small muted\" style=\"margin-top:8px\">Prijzen zijn excl. btw. Een niet-actief artikel verdwijnt uit de catalogus maar blijft in oude bestellingen staan.</p>";
    $("#pq").oninput = K.debounce(() => { p.dataset.q = $("#pq").value; const pos = $("#pq").selectionStart; artikelen(p); $("#pq").focus(); $("#pq").setSelectionRange(pos, pos); }, 150);
    $("#new").onclick = () => editProduct(null);
    p.onclick = (e) => { const t = e.target.closest("[data-pr]"); if (t) editProduct(d.products.find((x) => x.id === t.dataset.pr)); };
  }
  function editProduct(x) {
    const b = document.createElement("div");
    const cats = Array.from(new Set(S.d.products.map((p) => p.category))).filter(Boolean);
    b.innerHTML = '<div class="stack">' + field("pn", "Artikelnaam *", x ? x.name : "", { ph: "Bv. Zalmfilet met vel, 1-1,5 kg" }) + '<div class="form-row"><div class="field"><label for="pc">Categorie</label><input class="input" id="pc" list="cats" value="' + esc(x ? x.category : "") + '"><datalist id="cats">' + cats.map((c) => '<option value="' + esc(c) + '">').join("") + '</datalist></div><div class="field"><label for="pu">Eenheid *</label><select class="select" id="pu">' + S.d.units.map((u) => '<option value="' + esc(u.value) + '"' + (x && x.unit === u.value ? " selected" : "") + ">" + esc(u.label) + "</option>").join("") + "</select></div>" + field("pp", "Basisprijs (excl. btw) *", x ? K.inputNum(x.basePriceCents) : "", { attrs: ' inputmode="decimal"' }) + '</div><label class="check"><input type="checkbox" id="pa"' + (!x || x.active ? " checked" : "") + "> Actief (zichtbaar in de catalogus)</label></div>";
    const s = K.sheet({ title: x ? x.name : "Nieuw artikel", body: b, footer: '<div class="row" style="justify-content:flex-end"><button class="btn btn-outline" data-close>Annuleren</button><button class="btn btn-accent" id="ok">Opslaan</button></div>' });
    $("#ok", s.el).onclick = () => K.busy($("#ok", s.el), async () => { try { const res = await K.api("beheer/producten", { body: { id: x ? x.id : "", naam: $("#pn", b).value, categorie: $("#pc", b).value, eenheid: $("#pu", b).value, basisprijs: K.parseNum($("#pp", b).value), actief: $("#pa", b).checked } }); S.d = res.overview; s.close(); render(); K.toast("Artikel opgeslagen", "ok"); } catch (err) { K.toast(err.message, "bad"); } });
  }

  // ---- Prijzen -----------------------------------------------------------------------------------------------
  function prijzen(p) {
    const d = S.d;
    if (!S.priceClient && d.clients[0]) S.priceClient = d.clients[0].id;
    const c = d.clients.find((x) => x.id === S.priceClient);
    const priceOf = (pid) => { const r = d.prices.find((x) => x.clientId === S.priceClient && x.productId === pid); return r ? r.priceCents : null; };
    p.innerHTML = '<div class="section-head"><h1>Klantprijzen</h1></div><p class="muted small">Leeg = de basisprijs geldt. Vul een prijs in om een afwijkende klantprijs vast te leggen. Wordt meteen opgeslagen.</p><div class="field" style="max-width:420px;margin-bottom:12px"><label for="pcl">Klant</label><select class="select" id="pcl">' + d.clients.map((x) => '<option value="' + x.id + '"' + (x.id === S.priceClient ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div>" +
      (c ? '<div class="card pad-0 table-wrap"><table class="table"><thead><tr><th>Artikel</th><th>Eenheid</th><th class="num">Basisprijs</th><th class="num">Prijs voor ' + esc(c.name) + '</th><th></th></tr></thead><tbody>' + d.products.filter((x) => x.active).map((x) => { const v = priceOf(x.id); return '<tr><td><b>' + esc(x.name) + '</b></td><td>' + esc(x.unitLabel) + '</td><td class="num muted">' + K.eur(x.basePriceCents) + '</td><td class="num"><input class="inline" data-price="' + x.id + '" inputmode="decimal" value="' + (v != null ? K.inputNum(v) : "") + '" placeholder="' + K.inputNum(x.basePriceCents) + '"></td><td data-pill="' + x.id + '">' + (v != null ? '<span class="pill pill-ok">klantprijs</span>' : "") + "</td></tr>"; }).join("") + "</tbody></table></div>" : '<div class="empty">Maak eerst een klant aan.</div>');
    $("#pcl").onchange = (e) => { S.priceClient = e.target.value; render(); };
    K.$$("[data-price]").forEach((i) => { i.onchange = async () => { const v = i.value.trim(); const n = v === "" ? null : K.parseNum(v); if (v !== "" && !Number.isFinite(n)) return K.toast("Ongeldige prijs", "bad"); try { const r = await K.api("beheer/prijzen", { body: { klantId: S.priceClient, productId: i.dataset.price, prijs: n === null ? null : String(n) } }); S.d.prices = r.prices; const pill = $('[data-pill="' + i.dataset.price + '"]'); if (pill) pill.innerHTML = n === null ? "" : '<span class="pill pill-ok">klantprijs</span>'; if (n !== null) i.value = K.inputNum(Math.round(n * 100)); K.toast(v === "" ? "Klantprijs verwijderd" : "Klantprijs opgeslagen", "ok", 1500); } catch (err) { K.toast(err.message, "bad"); } }; });
  }

  // ---- Facturen ---------------------------------------------------------------------------------------------
  function facturen(p) {
    const d = S.d;
    const years = Array.from(new Set(d.invoices.map((i) => i.date.slice(0, 4)).concat([String(d.stats.year)]))).sort().reverse();
    const y = p.dataset.y || String(d.stats.year), m = p.dataset.m || "";
    const list = d.invoices.filter((i) => i.date.startsWith(y) && (!m || i.date.slice(5, 7) === m));
    const months = ["", "januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
    p.innerHTML = '<div class="section-head"><h1>Facturen</h1><a class="btn btn-outline" href="/api/beheer/facturen?formaat=csv&jaar=' + y + (m ? "&maand=" + m : "") + '">' + K.icon("doc") + ' CSV voor de boekhouder</a></div><div class="row wrap" style="margin-bottom:12px"><select class="select" id="fy" style="width:auto">' + years.map((yy) => '<option' + (yy === y ? " selected" : "") + ">" + yy + "</option>").join("") + '</select><select class="select" id="fm" style="width:auto"><option value="">Hele jaar</option>' + months.slice(1).map((mm, i) => '<option value="' + String(i + 1).padStart(2, "0") + '"' + (m === String(i + 1).padStart(2, "0") ? " selected" : "") + ">" + mm + "</option>").join("") + "</select></div>" +
      '<div class="card pad-0 table-wrap"><table class="table"><thead><tr><th>Factuur</th><th>Datum</th><th>Klant</th><th class="num">Excl. btw</th><th class="num">Btw</th><th class="num">Incl. btw</th><th>Betaling</th></tr></thead><tbody>' + list.map((i) => '<tr><td><a href="/doc/factuur/' + esc(i.id) + '" target="_blank"><b>' + esc(i.invoiceNumber) + "</b></a></td><td>" + esc(K.dateShort(i.date)) + "</td><td>" + esc(i.clientName) + '</td><td class="num">' + K.eur(i.vat.exclCents) + '</td><td class="num">' + K.eur(i.vat.vatCents) + '</td><td class="num"><b>' + K.eur(i.vat.inclCents) + "</b></td><td>" + K.chip(i.paid ? "betaald" : "open", i.paid ? "Betaald" : "Openstaand") + ' <button class="btn btn-sm btn-ghost" data-paid="' + esc(i.id) + '" data-now="' + (i.paid ? 1 : 0) + '">' + (i.paid ? "Openstaand zetten" : "Betaald zetten") + "</button></td></tr>").join("") + "</tbody></table>" + (!list.length ? '<div class="empty">Geen facturen in deze periode.</div>' : "") + "</div>" +
      '<p class="small muted" style="margin-top:8px">Betaald/openstaand wijzigt het team in het teamportaal bij de bestelling. De wettelijke e-facturatie (Peppol) verloopt via de boekhouder: gebruik daarvoor het CSV-bestand.</p>';
    K.$$("[data-paid]", p).forEach((btn) => { btn.onclick = () => K.busy(btn, async () => { try { const r = await K.api("beheer/bestellingen/" + encodeURIComponent(btn.dataset.paid) + "/betaald", { body: { betaald: btn.dataset.now !== "1" } }); const inv = S.d.invoices.find((x) => x.id === btn.dataset.paid); if (inv) inv.paid = r.paid; S.d.stats.openCents = S.d.invoices.filter((x) => !x.paid).reduce((s, x) => s + x.vat.inclCents, 0); facturen(p); K.toast(r.paid ? "Gemarkeerd als betaald" : "Gemarkeerd als openstaand", "ok", 1500); } catch (err) { K.toast(err.message, "bad"); } }); });
    $("#fy").onchange = (e) => { p.dataset.y = e.target.value; facturen(p); };
    $("#fm").onchange = (e) => { p.dataset.m = e.target.value; facturen(p); };
  }

  // ---- Bedrijf --------------------------------------------------------------------------------------------------
  function bedrijf(p) {
    const c = S.d.config;
    p.innerHTML = '<h1 style="margin-bottom:12px">Bedrijfsgegevens</h1><form id="bf" class="stack"><div class="card"><h2>Identiteit (op elke leveringsbon en factuur)</h2><div class="stack" style="margin-top:10px">' + field("bn", "Bedrijfsnaam *", c.companyName) + '<div class="form-row">' + field("bs", "Straat en nummer", c.street) + field("bc", "Postcode en plaats", c.city) + "</div>" + '<div class="form-row">' + field("bv", "Btw-nummer", c.vat) + field("bp", "Telefoon", c.phone) + field("be", "E-mail (zichtbaar voor klanten)", c.email, { type: "email" }) + "</div></div></div>" +
      '<div class="card"><h2>Facturatie</h2><div class="stack" style="margin-top:10px"><div class="form-row">' + field("bi", "IBAN *", c.iban, { ph: "BE68 5390 0754 7034" }) + field("bb", "BIC", c.bic) + field("br", "Btw-tarief (%)", c.vatRate, { attrs: ' inputmode="decimal"' }) + "</div>" + field("bt", "Betalingsvoorwaarden (onderaan de factuur)", c.paymentTerms) + field("bl", "Leveringsvoorwaarden (onderaan de leveringsbon)", c.deliveryTerms, { multi: true, rows: 3 }) + "</div></div>" +
      '<div class="card"><h2>Bestellen en leveren</h2><div class="stack" style="margin-top:10px"><div class="form-row">' + field("bo", "Interne postbus voor bestelmeldingen", c.opsEmail, { type: "email", help: "Privé. Krijgt elke nieuwe bestelling, aanvraag en factuurkopie." }) + field("bd", "Besteldeadline (HH:MM)", c.cutoff, { help: "Vóór dit uur: levering de volgende leverdag. Erna: de dag daarna." }) + '</div><div class="field"><label>Leverdagen</label><div class="row wrap" id="days">' + ["ma", "di", "wo", "do", "vr", "za", "zo"].map((dd) => '<label class="check" style="min-height:40px"><input type="checkbox" value="' + dd + '"' + (c.deliveryDays.split(",").map((x) => x.trim()).includes(dd) ? " checked" : "") + "> " + dd + "</label>").join("") + '</div></div></div></div><button class="btn btn-accent btn-lg" type="submit">Opslaan</button></form>';
    $("#bf").onsubmit = (e) => { e.preventDefault(); K.busy($("button[type=submit]", e.target), async () => { try { const days = K.$$("#days input:checked").map((i) => i.value).join(","); const r = await K.api("beheer/bedrijf", { body: { companyName: $("#bn").value, street: $("#bs").value, city: $("#bc").value, vat: $("#bv").value, phone: $("#bp").value, email: $("#be").value, iban: $("#bi").value, bic: $("#bb").value, vatRate: $("#br").value, paymentTerms: $("#bt").value, deliveryTerms: $("#bl").value, opsEmail: $("#bo").value, cutoff: $("#bd").value, deliveryDays: days } }); S.d.config = r.config; K.toast("Bedrijfsgegevens opgeslagen", "ok"); await load(); render(); } catch (err) { K.toast(err.message, "bad"); } }); };
  }

  // ---- Toegang ----------------------------------------------------------------------------------------------------
  function toegang(p) {
    const c = S.d.config;
    const card = (rol, title, custom, uitleg) => '<div class="card"><h2>' + title + '</h2><p class="small muted">' + uitleg + '</p><p class="small">' + (custom ? "✅ Eigen code ingesteld (vervangt de code uit Vercel)." : "De code uit de Vercel-instellingen geldt.") + '</p><form data-rol="' + rol + '" class="row wrap"><input class="input" type="password" placeholder="Nieuwe code (min. 10 tekens)" style="max-width:280px" autocomplete="new-password" required minlength="10"><button class="btn btn-outline" type="submit">Code wijzigen</button>' + (custom ? '<button class="btn btn-ghost" type="button" data-reset="' + rol + '">Terug naar Vercel-code</button>' : "") + "</form></div>";
    p.innerHTML = '<h1 style="margin-bottom:12px">Toegang</h1><div class="grid grid-2">' + card("staff", "Teamcode", c.staffCodeCustom, "Voor het magazijn en de chauffeur: bestellingen klaarzetten, leveren, telefonische bestellingen ingeven.") + card("admin", "Beheerderscode", c.adminCodeCustom, "Alles, ook klanten, prijzen, bedrijfsgegevens en deze codes.") + '</div><div class="notice notice-info" style="margin-top:14px">' + K.icon("warn") + "<div>Codes worden versleuteld bewaard; niemand kan ze nalezen. Code kwijt? Maak in Airtable (Configuratie) het veld <b>Beheerderscode hash</b> of <b>Personeelscode hash</b> leeg: dan geldt de code uit Vercel opnieuw.</div></div>";
    K.$$("form[data-rol]").forEach((f) => { f.onsubmit = (e) => { e.preventDefault(); K.busy($("button[type=submit]", f), async () => { try { const r = await K.api("beheer/codes", { body: { rol: f.dataset.rol, code: $("input", f).value } }); S.d.config = r.config; K.toast("Code gewijzigd. Geef de nieuwe code door aan het team.", "ok", 4000); render(); } catch (err) { K.toast(err.message, "bad"); } }); }; });
    K.$$("[data-reset]").forEach((b) => { b.onclick = async () => { if (!(await K.confirm({ title: "Terug naar de Vercel-code?", text: "De eigen code vervalt; de code uit de Vercel-instellingen geldt opnieuw.", yes: "Ja" }))) return; try { const r = await K.api("beheer/codes", { body: { rol: b.dataset.reset, reset: true } }); S.d.config = r.config; render(); K.toast("Vercel-code geldt opnieuw"); } catch (err) { K.toast(err.message, "bad"); } }; });
  }

  // ---- Systeemcontrole --------------------------------------------------------------------------------------------
  function controle(p) {
    const e = S.d.env;
    p.innerHTML = '<h1 style="margin-bottom:12px">Systeemcontrole</h1><div class="card"><p>Deze controle doorloopt de hele keten met een <b>tijdelijke testklant en testbestelling</b>: aanmaken, aanmelden, bestellen (met e-mails naar de interne postbus), klaarzetten, onderweg zetten, factuurnummer berekenen (zonder te boeken) en documenten opbouwen. Daarna wordt alles weer verwijderd.</p><p class="small muted">Omgeving: e-mail ' + (e.mailEnabled ? "ingeschakeld (" + esc(e.mailFrom) + ")" : "uitgeschakeld") + " · portaal " + esc(e.portalUrl || location.origin) + (e.missing.length ? " · <b>ontbrekend: " + esc(e.missing.join(", ")) + "</b>" : "") + '</p><button class="btn btn-accent" id="run">Controle starten</button><div id="out" style="margin-top:14px"></div></div>';
    $("#run").onclick = () => K.busy($("#run"), async () => {
      $("#out").innerHTML = '<div class="skeleton" style="height:40px"></div>';
      try {
        const r = await K.api("beheer/systeemcontrole", { body: {} });
        $("#out").innerHTML = '<div class="notice ' + (r.ok ? "notice-ok" : "notice-bad") + '" style="margin-bottom:10px">' + K.icon(r.ok ? "check" : "warn") + "<div><b>" + (r.ok ? "Alles werkt." : "Er ging iets mis — zie hieronder.") + "</b></div></div><div class=\"check-list\">" + r.steps.map((s) => '<div class="it ' + (s.ok ? "ok" : "bad") + '"><span>' + (s.ok ? "✅" : "❌") + "</span><div><b>" + esc(s.label) + '</b><div class="small">' + esc(s.detail) + (s.ms ? " · " + s.ms + " ms" : "") + "</div></div></div>").join("") + "</div>";
      } catch (err) { $("#out").innerHTML = '<div class="notice notice-bad">' + esc(err.message) + "</div>"; }
    });
  }

  async function boot() {
    try { const s = await K.api("team/sessie"); if (s.role !== "admin") return renderLogin("U bent aangemeld met de teamcode. Beheer vraagt de beheerderscode."); S.role = "admin"; await load(); const q = K.qs(); if (q.aanvraag) { S.view = "aanvragen"; S.openRequestId = q.aanvraag; } render(); }
    catch (err) { if (err.status === 401) renderLogin(); else if (err.status !== 503) renderLogin(err.message); }
  }
  boot();
})();
