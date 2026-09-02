/* Teamportaal: bord van de dag, klaarzetten, vertrek, levering, telefonische bestellingen. */
(function () {
  "use strict";
  const $ = K.$, esc = K.esc;
  const main = $("#main"), nav = $("#nav"), tabbar = $("#tabbar"), who = $("#who");
  const S = { role: null, view: "board", data: null, filter: "alle", hist: null, histQ: "", timer: null, histSeq: 0 };
  const STATUS_IDX = { ontvangen: 0, klaar: 1, onderweg: 2, geleverd: 3 };

  // ---- Chrome ------------------------------------------------------------------------------
  const TABS = { board: ["Vandaag", "box"], nieuw: ["Nieuw", "phone"], historiek: ["Historiek", "list"], meer: ["Meer", "settings"] };
  function renderChrome() {
    const on = !!S.role;
    nav.hidden = !on; tabbar.hidden = !on;
    who.innerHTML = on ? '<span class="pill ' + (S.role === "admin" ? "pill-accent" : "pill-info") + '">' + (S.role === "admin" ? "Beheerder" : "Team") + "</span> " + (S.role === "admin" ? '<a href="/beheer" style="color:#fff;margin-left:8px">Beheer</a>' : "") + ' <button class="btn btn-sm btn-ghost" id="logout" style="color:#fff">Afmelden</button>' : "";
    if (on) $("#logout").onclick = logout;
    K.$$("[data-go]", nav).forEach((b) => b.classList.toggle("on", b.dataset.go === S.view));
    K.$$("[data-go]", tabbar).forEach((b) => {
      const [label, icon] = TABS[b.dataset.go];
      const n = b.dataset.go === "board" && S.data ? S.data.orders.filter((o) => o.status !== "geleverd").length : 0;
      b.innerHTML = K.icon(icon) + "<span>" + label + "</span>" + (n ? '<span class="count">' + n + "</span>" : "");
      b.classList.toggle("on", b.dataset.go === S.view);
    });
  }
  K.on(document, "click", "[data-go]", (e, t) => { if (t.dataset.go === "meer") return renderMeer(); S.view = t.dataset.go; render(); window.scrollTo(0, 0); });
  async function logout() { await K.api("team/logout", { body: {} }).catch(() => {}); S.role = null; S.data = null; renderChrome(); renderLogin(); }
  function renderMeer() {
    const s = K.sheet({ title: "Meer", body: '<div class="big-actions">' + (S.role === "admin" ? '<a class="btn btn-outline" href="/beheer">' + K.icon("settings") + " Beheer</a>" : "") + '<a class="btn btn-outline" target="_blank" href="/doc/picklijst?dag=' + K.todayISO() + '">' + K.icon("print") + ' Picklijst vandaag</a><a class="btn btn-outline" target="_blank" href="/doc/picklijst?dag=' + K.addDays(K.todayISO(), 1) + '">' + K.icon("print") + ' Picklijst morgen</a><a class="btn btn-outline" href="/" target="_blank">Klantportaal bekijken</a><button class="btn btn-ghost" id="lo">Afmelden</button></div>', footer: false });
    $("#lo", s.el).onclick = () => { s.close(); logout(); };
  }

  // ---- Aanmelden -----------------------------------------------------------------------------
  function renderLogin(err) {
    main.innerHTML = '<div class="login-wrap"><div class="card"><h1>Teamportaal</h1><p class="muted">Meld u aan met de teamcode of de beheerderscode.</p><form id="f" class="stack"><div class="field"><label for="code">Code</label><input class="input" id="code" type="password" autocomplete="current-password" required style="font-size:1.3rem;letter-spacing:2px"></div>' + (err ? '<div class="notice notice-bad">' + esc(err) + "</div>" : "") + '<button class="btn btn-accent btn-lg btn-block" type="submit">Aanmelden</button></form></div></div>';
    $("#f").onsubmit = async (e) => { e.preventDefault(); await K.busy($("button", e.target), async () => { try { const r = await K.api("team/login", { body: { code: $("#code").value } }); S.role = r.role; S.view = "board"; await load(); render(); } catch (err) { renderLogin(err.message); } }); };
  }

  // ---- Gegevens ------------------------------------------------------------------------------
  async function load() { S.data = await K.api("team/overzicht"); renderChrome(); }
  function order(id) { return (S.data ? S.data.orders : []).concat(S.hist || []).find((o) => o.id === id); }
  function replaceOrder(o) {
    if (S.data) { const i = S.data.orders.findIndex((x) => x.id === o.id); if (i >= 0) S.data.orders[i] = o; else S.data.orders.unshift(o); }
    if (S.hist) { const i = S.hist.findIndex((x) => x.id === o.id); if (i >= 0) S.hist[i] = o; }
  }
  function removeOrder(id) { if (S.data) S.data.orders = S.data.orders.filter((x) => x.id !== id); if (S.hist) S.hist = S.hist.filter((x) => x.id !== id); }

  // ---- Bord --------------------------------------------------------------------------------------
  function renderBoard() {
    if (!S.data) { main.innerHTML = '<div class="skeleton" style="height:120px"></div>'; return; }
    const today = S.data.today, tomorrow = K.addDays(today, 1);
    let orders = S.data.orders.slice();
    if (S.filter === "vandaag") orders = orders.filter((o) => o.deliveryDate <= today);
    if (S.filter === "morgen") orders = orders.filter((o) => o.deliveryDate === tomorrow);
    orders.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || ((a.client || {}).name || "").localeCompare((b.client || {}).name || ""));
    const col = (key, title) => {
      const list = orders.filter((o) => o.status === key);
      return '<div class="col"><div class="col-head"><span>' + title + '</span><span class="n">' + list.length + "</span></div>" + (list.length ? list.map(card).join("") : '<div class="empty small">Niets</div>') + "</div>";
    };
    const delivered = S.data.orders.filter((o) => o.status === "geleverd" && (o.deliveredAt || "").slice(0, 10) === new Date().toISOString().slice(0, 10) || (o.status === "geleverd" && o.deliveryDate === today));
    main.innerHTML = '<div class="section-head"><div><h1>' + esc(K.dateNl(today, true)) + '</h1><div class="muted small">' + K.plural(S.data.orders.filter((o) => o.status !== "geleverd").length, "open bestelling", "open bestellingen") + '</div></div><div class="row"><a class="btn btn-outline" target="_blank" href="/doc/picklijst?dag=' + today + '">' + K.icon("print") + ' <span class="hide-sm">Picklijst</span></a><button class="iconbtn" id="refresh" aria-label="Vernieuwen">' + K.icon("refresh") + "</button></div></div>" +
      '<div class="segmented" style="margin-bottom:12px"><button data-f="alle" class="' + (S.filter === "alle" ? "on" : "") + '">Alle leverdagen</button><button data-f="vandaag" class="' + (S.filter === "vandaag" ? "on" : "") + '">Vandaag</button><button data-f="morgen" class="' + (S.filter === "morgen" ? "on" : "") + '">Morgen</button></div>' +
      '<div class="board">' + col("ontvangen", "Klaar te zetten") + col("klaar", "Klaar voor vertrek") + col("onderweg", "Onderweg") + "</div>" +
      '<div class="section" style="margin-top:20px"><h2 style="margin-bottom:8px">Vandaag geleverd</h2><div class="card pad-0 flat"><div class="list">' + (delivered.length ? delivered.map((o) => '<button class="item" data-open="' + o.id + '"><div class="body"><div class="title">' + esc((o.client || {}).name || "—") + ' <span class="muted small">· ' + esc(o.invoiceNumber || o.ref) + '</div><div class="sub">' + esc(o.receivedBy ? "ontvangen door " + o.receivedBy + " om " + K.time(o.deliveredAt) : "") + '</div></div><div class="end">' + K.chip(o.paid ? "betaald" : "open", o.paymentLabel) + '<div class="num small">' + K.eur(o.totalCents) + "</div></div></button>").join("") : '<div class="empty small">Nog geen leveringen vandaag.</div>') + "</div></div></div>";
    $("#refresh").onclick = async () => { await K.busy($("#refresh"), load); renderBoard(); };
    K.$$("[data-f]").forEach((b) => { b.onclick = () => { S.filter = b.dataset.f; renderBoard(); }; });
  }
  function card(o) {
    const late = o.status !== "geleverd" && o.deliveryDate < S.data.today;
    return '<div class="ocard' + (late ? " late" : "") + '" data-open="' + o.id + '"><div class="t"><b>' + esc((o.client || {}).name || "Onbekende klant") + '</b><span class="' + (late ? "pill pill-warn" : "muted small") + '">' + esc(late ? "Te laat · " + K.relDay(o.deliveryDate) : o.deliveryLabel) + '</span></div><div class="lines">' + o.lines.map((l) => K.qty(l.qty) + " " + esc(K.unit(l.unit, l.qty)) + " " + esc(l.name)).join(" · ") + '</div><div class="f"><span>' + K.plural(o.lines.length, "artikel", "artikelen") + " · " + K.eur(o.totalCents) + (o.source !== "Klantportaal" ? ' · <span class="pill">' + esc(o.source) + "</span>" : "") + "</span>" + (o.notes ? '<span class="pill pill-warn">Opmerking</span>' : "") + "</div></div>";
  }
  K.on(document, "click", "[data-open]", (e, t) => openOrder(t.dataset.open));

  // ---- Bestelling (blad) ---------------------------------------------------------------------------
  const checks = { get(id) { return K.store.get("check:" + id, {}); }, set(id, v) { K.store.set("check:" + id, v); } };
  let current = null;
  async function openOrder(id) {
    let o = order(id);
    if (!o) { try { o = (await K.api("team/bestellingen/" + encodeURIComponent(id))).order; replaceOrder(o); } catch (err) { return K.toast(err.message, "bad"); } }
    const body = document.createElement("div"), foot = document.createElement("div");
    let photo = null; // foto blijft bewaard terwijl er lijnen worden afgevinkt
    const sheet = K.sheet({ title: (o.client || {}).name || "Bestelling", body, footer: foot, wide: true, focus: false, onClose: () => { current = null; if (S.view === "board") renderBoard(); if (S.view === "historiek") renderHistoriek(); } });
    current = { id, sheet, body, foot };
    drawOrder();
    async function act(path, payload, btn, okMsg) {
      return K.busy(btn, async () => {
        try {
          const r = await K.api("team/bestellingen/" + encodeURIComponent(id) + "/" + path, { body: payload || {} });
          replaceOrder(r.order);
          if (r.warnings && r.warnings.length) r.warnings.forEach((w) => K.toast(w, "bad", 6000));
          if (okMsg) K.toast(okMsg, "ok");
          drawOrder();
          return r;
        } catch (err) { K.toast(err.message, "bad"); if (err.status === 401) { S.role = null; sheet.close(); renderChrome(); renderLogin("Uw sessie is verlopen."); } }
      });
    }
    function drawOrder() {
      o = order(id);
      const c = o.client || {};
      const idx = STATUS_IDX[o.status];
      const head = '<div class="row spread wrap" style="margin-bottom:6px"><div><div class="muted small">' + esc(o.ref) + " · besteld " + esc(K.dateShort(o.date)) + (o.source !== "Klantportaal" ? " · " + esc(o.source) : "") + '</div><div><b>Levering ' + esc(K.dateNl(o.deliveryDate, true)) + "</b></div></div>" + K.chip(o.status, o.statusLabel) + "</div>" + K.timeline(idx) +
        '<div class="card flat" style="padding:10px 12px;margin:10px 0"><div class="row spread wrap"><div><b>' + esc(c.name || "—") + '</b> <span class="muted small">' + esc(c.number || "") + '</span><div class="small">' + esc(c.address || "").replace(/\n/g, ", ") + "</div></div>" + (c.phone ? '<a class="btn btn-sm btn-outline" href="tel:' + esc(String(c.phone).replace(/\s/g, "")) + '">' + K.icon("phone") + " Bellen</a>" : "") + "</div>" + (c.notes ? '<div class="small muted" style="margin-top:6px">ℹ️ ' + esc(c.notes) + "</div>" : "") + "</div>" +
        (o.notes ? '<div class="notice notice-warn" style="margin-bottom:10px">' + K.icon("warn") + "<div><b>Opmerking:</b> " + esc(o.notes) + "</div></div>" : "");
      let lines = "";
      if (o.status === "ontvangen") {
        const ck = checks.get(id);
        lines = '<div class="card pad-0 flat">' + o.lines.map((l, i) => '<div class="checkline' + (ck[i] ? " done" : "") + '" data-ck="' + i + '"><div class="box">' + (ck[i] ? K.icon("check") : "") + '</div><div class="q">' + K.qty(l.qty) + " " + esc(K.unit(l.unit, l.qty)) + '</div><div class="n">' + esc(l.name) + (l.comment ? '<div class="c">' + esc(l.comment) + "</div>" : "") + '</div><button class="btn btn-sm btn-outline" data-edit="' + i + '">Wijzig</button></div>').join("") + "</div>" +
          '<div class="row wrap" style="margin-top:10px"><button class="btn btn-sm btn-outline" id="addLine">' + K.icon("plus") + ' Artikel toevoegen</button><button class="btn btn-sm btn-ghost" id="editNote">Opmerking</button><label class="btn btn-sm btn-ghost" style="cursor:pointer">' + K.icon("box") + ' Foto <input type="file" accept="image/*" capture="environment" id="photo" hidden></label><span class="muted small" id="photoName">' + (photo ? "Foto klaar om mee te sturen" : "") + '</span></div>';
      } else {
        lines = '<div class="card pad-0 flat"><table class="table"><tbody>' + o.lines.map((l) => '<tr><td class="num strong" style="width:110px">' + K.qty(l.qty) + " " + esc(K.unit(l.unit, l.qty)) + "</td><td>" + esc(l.name) + (l.comment ? '<div class="small" style="color:var(--accent-2)">' + esc(l.comment) + "</div>" : "") + '</td><td class="num muted">' + (l.priceCents != null ? K.eur(Math.round(l.priceCents * l.qty)) : "") + "</td></tr>").join("") + '</tbody></table><div class="row spread" style="padding:10px 12px;border-top:1px solid var(--line-2)"><span class="muted">Totaal excl. btw</span><b class="num">' + K.eur(o.totalCents) + "</b></div></div>";
      }
      let after = "";
      if (o.status === "geleverd") after = '<div class="notice notice-ok" style="margin-top:10px">' + K.icon("check") + "<div>Ontvangen door <b>" + esc(o.receivedBy || "—") + "</b> op " + esc(K.dateTime(o.deliveredAt)) + "<br>Factuur <b>" + esc(o.invoiceNumber || "—") + "</b> · " + K.chip(o.paid ? "betaald" : "open", o.paymentLabel) + "</div></div>" + (o.proof && o.proof[0] ? '<img src="' + esc(o.proof[0].url) + '" alt="Handtekening" style="max-height:90px;margin-top:8px;border:1px solid var(--line);border-radius:8px;background:#fff">' : "");
      if (o.prepPhoto && o.prepPhoto[0]) after += '<div style="margin-top:8px"><a href="' + esc(o.prepPhoto[0].url) + '" target="_blank"><img src="' + esc(o.prepPhoto[0].thumb || o.prepPhoto[0].url) + '" alt="Foto klaargezet" style="max-height:90px;border-radius:8px"></a></div>';
      body.innerHTML = head + lines + after;
      // Voet: de grote actie voor deze status.
      let f = '<div class="big-actions">';
      if (o.status === "ontvangen") f += '<button class="btn btn-ok" id="ready">' + K.icon("check") + " Alles klaargezet</button>";
      if (o.status === "klaar") f += '<button class="btn btn-accent" id="ship">' + K.icon("truck") + " Vertrekken · onderweg</button>";
      if (o.status === "onderweg") f += '<button class="btn btn-ok" id="deliver">' + K.icon("check") + " Levering afronden</button>";
      if (o.status === "geleverd") f += '<button class="btn ' + (o.paid ? "btn-outline" : "btn-accent") + '" id="paid">' + (o.paid ? "Markeer als openstaand" : "Markeer als betaald") + "</button>";
      f += "</div>" + '<div class="row wrap"><a class="btn btn-sm btn-outline" target="_blank" href="' + esc(o.docs.deliveryNote) + '">' + K.icon("print") + " Leveringsbon</a>" + (o.status === "geleverd" || S.role === "admin" ? '<a class="btn btn-sm btn-outline" target="_blank" href="' + esc(o.docs.invoice) + '">' + K.icon("doc") + " Factuur" + (o.invoiceNumber ? "" : " (ontwerp)") + "</a>" : "") +
        (o.status === "klaar" || o.status === "onderweg" ? '<button class="btn btn-sm btn-ghost" id="back">' + K.icon("back") + " Stap terug</button>" : "") + (o.status === "ontvangen" ? '<button class="btn btn-sm btn-ghost" id="del" style="color:var(--bad);margin-left:auto">Verwijderen</button>' : "") + "</div>";
      foot.innerHTML = f;
      // Gebeurtenissen
      K.$$("[data-ck]", body).forEach((el) => { el.onclick = (e) => { if (e.target.closest("[data-edit]")) return; const ck = checks.get(id); ck[el.dataset.ck] = !ck[el.dataset.ck]; checks.set(id, ck); drawOrder(); }; });
      K.$$("[data-edit]", body).forEach((b) => { b.onclick = () => editLine(Number(b.dataset.edit)); });
      if ($("#addLine", body)) $("#addLine", body).onclick = addLine;
      if ($("#editNote", body)) $("#editNote", body).onclick = async () => { const v = await K.prompt({ title: "Opmerking", label: "Opmerking bij de bestelling (zichtbaar voor de klant)", value: o.notes, multiline: true }); if (v !== null) act("notitie", { notities: v }, null, "Opmerking bewaard"); };
      if ($("#photo", body)) $("#photo", body).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; photo = await shrinkImage(f, 1280, 0.8); $("#photoName", body).textContent = "Foto klaar om mee te sturen"; };
      if ($("#ready", foot)) $("#ready", foot).onclick = async () => {
        const ck = checks.get(id); const all = o.lines.every((l, i) => ck[i]);
        if (!all && !(await K.confirm({ title: "Niet alles afgevinkt", text: "Niet elke lijn is afgevinkt. Toch als klaargezet markeren?", yes: "Ja, klaar" }))) return;
        const r = await act("klaar", { foto: photo }, $("#ready", foot), "Bestelling staat klaar");
        if (r) checks.set(id, {});
      };
      if ($("#ship", foot)) $("#ship", foot).onclick = async () => { const r = await act("onderweg", {}, $("#ship", foot), null); if (!r) return; const m = r.mail && r.mail.client; if (m && m.ok) K.toast("Onderweg — de klant is per e-mail verwittigd", "ok"); else if (!m || m.skipped) K.toast("Onderweg. De klant heeft geen e-mailadres: verwittig hem zelf.", "", 5000); else K.toast("Onderweg, maar de e-mail aan de klant mislukte: " + (m.error || "").slice(0, 80), "bad", 7000); };
      if ($("#deliver", foot)) $("#deliver", foot).onclick = () => deliverSheet();
      if ($("#paid", foot)) $("#paid", foot).onclick = () => act("betaald", { betaald: !o.paid }, $("#paid", foot), o.paid ? "Gemarkeerd als openstaand" : "Gemarkeerd als betaald");
      if ($("#back", foot)) $("#back", foot).onclick = () => act("terug", {}, $("#back", foot), "Een stap terug");
      if ($("#del", foot)) $("#del", foot).onclick = async () => { if (!(await K.confirm({ title: "Bestelling verwijderen?", text: "Dit kan niet ongedaan worden gemaakt. Verwijder enkel een dubbele of foute bestelling.", yes: "Verwijderen", danger: true }))) return; try { await K.api("team/bestellingen/" + encodeURIComponent(id) + "/verwijderen", { body: {} }); removeOrder(id); K.toast("Bestelling verwijderd"); sheet.close(); } catch (err) { K.toast(err.message, "bad"); } };
    }
    async function editLine(i) {
      const l = o.lines[i];
      const b = document.createElement("div");
      b.innerHTML = '<p><b>' + esc(l.name) + '</b></p><div class="form-row"><div class="field"><label>Aantal (' + esc(K.unit(l.unit, 2)) + ')</label><input class="input" id="eq" inputmode="' + (l.decimals ? "decimal" : "numeric") + '" value="' + K.qty(l.qty) + '" style="font-size:1.3rem;font-weight:800"></div><div class="field"><label>Opmerking</label><input class="input" id="ec" value="' + esc(l.comment) + '"></div></div>';
      const s = K.sheet({ title: "Lijn wijzigen", body: b, center: true, footer: '<div class="row wrap"><button class="btn btn-ghost" id="rm" style="color:var(--bad)">Lijn schrappen</button><span class="spacer" style="flex:1"></span><button class="btn btn-outline" data-close>Annuleren</button><button class="btn btn-accent" id="ok">Opslaan</button></div>' });
      const save = (lines) => { const btn = $("#ok", s.el); return act("lijnen", { lijnen: lines }, btn, "Lijnen bijgewerkt").then((r) => { if (r) s.close(); }); };
      $("#ok", s.el).onclick = () => { const q = Number(String($("#eq", s.el).value).replace(",", ".")); const lines = o.lines.map((x, j) => ({ name: x.name, qty: j === i ? q : x.qty, unit: x.unit, priceCents: x.priceCents, comment: j === i ? $("#ec", s.el).value : x.comment })); save(lines); };
      $("#rm", s.el).onclick = async () => { if (o.lines.length === 1) return K.toast("Een bestelling moet minstens één lijn hebben. Verwijder liever de bestelling.", "bad"); if (!(await K.confirm({ title: "Lijn schrappen?", text: l.name + " wordt van de bestelling gehaald.", yes: "Schrappen", danger: true }))) return; save(o.lines.filter((x, j) => j !== i).map((x) => ({ name: x.name, qty: x.qty, unit: x.unit, priceCents: x.priceCents, comment: x.comment }))); };
    }
    async function addLine() {
      let cat;
      try { cat = (await K.api("team/klanten/" + encodeURIComponent(o.clientId) + "/catalogus")).catalogue; } catch (err) { return K.toast(err.message, "bad"); }
      const b = document.createElement("div");
      b.innerHTML = '<div class="searchbox">' + K.icon("search") + '<input class="input" id="pq" placeholder="Zoek artikel…"></div><div class="list" id="pl" style="margin-top:8px"></div>';
      const s = K.sheet({ title: "Artikel toevoegen", body: b, footer: false });
      const draw = () => { const q = $("#pq", b).value.toLowerCase(); $("#pl", b).innerHTML = cat.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => '<button class="item" data-pick="' + p.id + '"><div class="body"><div class="title">' + esc(p.name) + '</div><div class="sub">' + K.eur(p.priceCents) + "/" + esc(K.unit(p.unit, 1)) + "</div></div></button>").join(""); };
      draw(); $("#pq", b).oninput = draw;
      b.addEventListener("click", async (e) => { const t = e.target.closest("[data-pick]"); if (!t) return; const p = cat.find((x) => x.id === t.dataset.pick); const q = await K.prompt({ title: p.name, label: "Aantal (" + K.unit(p.unit, 2) + ")", value: "1", type: "text" }); if (q === null) return; const lines = o.lines.map((x) => ({ name: x.name, qty: x.qty, unit: x.unit, priceCents: x.priceCents, comment: x.comment })).concat([{ productId: p.id, qty: Number(String(q).replace(",", ".")) }]); const r = await act("lijnen", { lijnen: lines }, null, "Artikel toegevoegd"); if (r) s.close(); });
    }
    function deliverSheet() {
      const b = document.createElement("div");
      b.innerHTML = '<div class="field"><label for="recv">Ontvangen door (naam)</label><input class="input" id="recv" autocomplete="off" placeholder="Bv. Kenji (keuken)" style="font-size:1.2rem"></div><div class="field" style="margin-top:12px"><label>Handtekening van de klant</label><canvas class="sigpad" id="sig"></canvas><div class="row spread"><span class="help">Teken met de vinger op de tablet.</span><button class="btn btn-sm btn-ghost" id="clear">Wissen</button></div></div><p class="small muted" style="margin-top:10px">Bij bevestiging krijgt deze levering een factuurnummer' + ((o.client || {}).email ? ' en ontvangt de klant de factuur per e-mail.' : '. Deze klant heeft geen e-mailadres: geef de factuur zelf mee.') + '</p>';
      const s = K.sheet({ title: "Levering afronden", body: b, footer: '<button class="btn btn-ok btn-lg btn-block" id="ok">' + K.icon("check") + " Bevestigen en factureren</button>" });
      const pad = sigPad($("#sig", b));
      $("#clear", b).onclick = pad.clear;
      $("#ok", s.el).onclick = async () => {
        const name = $("#recv", b).value.trim();
        if (!name) { K.toast("Vul in wie de levering ontvangen heeft.", "bad"); $("#recv", b).focus(); return; }
        if (pad.isEmpty() && !(await K.confirm({ title: "Geen handtekening", text: "Er is geen handtekening gezet. Toch afronden?", yes: "Ja, afronden" }))) return;
        const r = await act("geleverd", { ontvanger: name, handtekening: pad.isEmpty() ? null : pad.dataUrl() }, $("#ok", s.el), "Levering afgerond");
        if (r) { s.close(); if (r.invoiceNumber) K.toast("Factuur " + r.invoiceNumber + " aangemaakt", "ok", 4000); const m = r.mail && r.mail.client; if (m && !m.ok && !m.skipped) K.toast("E-mail met factuur aan klant mislukte: " + (m.error || "").slice(0, 80), "bad", 7000); }
      };
    }
  }

  // ---- Handtekening en foto ------------------------------------------------------------------------
  function sigPad(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 500, h = 180;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr); ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#14202E";
    let drawing = false, empty = true, last = null;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
    canvas.addEventListener("pointermove", (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; empty = false; e.preventDefault(); });
    const up = () => { drawing = false; };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    return {
      clear() { ctx.clearRect(0, 0, w, h); empty = true; },
      isEmpty() { return empty; },
      dataUrl() { const out = document.createElement("canvas"); out.width = canvas.width; out.height = canvas.height; const c = out.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, out.width, out.height); c.drawImage(canvas, 0, 0); return out.toDataURL("image/png"); }
    };
  }
  function shrinkImage(file, max, q) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); resolve(c.toDataURL("image/jpeg", q)); };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
  }

  // ---- Nieuwe bestelling (telefoon) ------------------------------------------------------------------
  const N = { clients: null, client: null, cat: null, cart: {}, date: "", note: "", q: "" };
  async function renderNieuw() {
    if (!N.clients) { main.innerHTML = '<div class="skeleton" style="height:100px"></div>'; try { N.clients = (await K.api("team/klanten")).clients; } catch (err) { main.innerHTML = '<div class="notice notice-bad">' + esc(err.message) + "</div>"; return; } }
    if (!N.client) {
      main.innerHTML = '<h1 style="margin-bottom:10px">Nieuwe bestelling</h1><p class="muted">Voor een klant die belt of een bericht stuurt. Kies de klant:</p><div class="searchbox" style="margin-bottom:10px">' + K.icon("search") + '<input class="input" id="cq" placeholder="Zoek klant…" autofocus></div><div class="card pad-0 flat"><div class="list" id="cl"></div></div>';
      const draw = () => { const q = $("#cq").value.toLowerCase(); $("#cl").innerHTML = N.clients.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.number || "").toLowerCase().includes(q)).map((c) => '<button class="item" data-client="' + c.id + '"><div class="body"><div class="title">' + esc(c.name) + '</div><div class="sub">' + esc(c.number || "") + (c.address ? " · " + esc(c.address.split("\n")[0]) : "") + "</div></div>" + K.icon("back").replace("M15 5l-7 7 7 7", "M9 5l7 7-7 7") + "</button>").join("") || '<div class="empty">Geen klant gevonden.</div>'; };
      draw(); $("#cq").oninput = draw;
      K.$$("[data-client]").forEach(() => {});
      main.onclick = async (e) => { const t = e.target.closest("[data-client]"); if (!t) return; main.onclick = null; N.client = N.clients.find((c) => c.id === t.dataset.client); N.cart = {}; N.note = ""; N.q = ""; main.innerHTML = '<div class="skeleton" style="height:100px"></div>'; try { N.cat = await K.api("team/klanten/" + encodeURIComponent(N.client.id) + "/catalogus"); N.date = N.cat.deliveryDates[1] ? N.cat.deliveryDates[1].iso : N.cat.deliveryDates[0].iso; } catch (err) { K.toast(err.message, "bad"); N.client = null; } renderNieuw(); };
      return;
    }
    const cat = N.cat.catalogue, c = N.client;
    const lines = () => Object.entries(N.cart).map(([id, q]) => ({ p: cat.find((x) => x.id === id), qty: q })).filter((l) => l.p && l.qty > 0);
    const total = () => lines().reduce((s, l) => s + Math.round(l.p.priceCents * l.qty), 0);
    const q = N.q.toLowerCase();
    const sugg = N.cat.suggestions.map((s) => ({ p: cat.find((x) => x.id === s.productId), qty: s.qty })).filter((s) => s.p);
    main.innerHTML = '<div class="section-head"><div><h1>' + esc(c.name) + '</h1><div class="muted small">' + esc(c.address || "").replace(/\n/g, ", ") + (c.phone ? " · " + esc(c.phone) : "") + '</div></div><button class="btn btn-sm btn-outline" id="other">Andere klant</button></div>' +
      (c.usual ? '<div class="notice notice-info" style="margin-bottom:10px">' + K.icon("list") + "<div><b>Vaste artikelen:</b> " + esc(c.usual) + "</div></div>" : "") +
      '<div class="grid" style="grid-template-columns:1fr;max-width:none"><div class="card"><div class="label" style="margin-bottom:8px">Leverdatum</div><div class="datechips">' + N.cat.deliveryDates.map((d) => '<button class="datechip' + (d.iso === N.date ? " on" : "") + '" data-date="' + d.iso + '"><b>' + esc(d.relative) + "</b><small>" + esc(K.dateShort(d.iso)) + "</small></button>").join("") + "</div></div>" +
      (sugg.length && !q ? '<div class="card"><div class="row spread"><b>Laatste bestellingen</b><button class="btn btn-sm btn-outline" id="all">Alles toevoegen</button></div><div class="row wrap" style="margin-top:8px">' + sugg.map((s) => '<button class="btn btn-sm btn-outline" data-sugg="' + s.p.id + '" data-qty="' + s.qty + '">' + K.qty(s.qty) + " " + esc(K.unit(s.p.unit, s.qty)) + " " + esc(s.p.name) + "</button>").join("") + "</div></div>" : "") +
      '<div class="searchbox">' + K.icon("search") + '<input class="input" id="pq" placeholder="Zoek artikel…" value="' + esc(N.q) + '"></div>' +
      '<div id="plist">' + cat.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => '<div class="product' + (N.cart[p.id] ? " in" : "") + '"><div><div class="name">' + esc(p.name) + '</div><div class="price"><b>' + K.eur(p.priceCents) + "</b> / " + esc(K.unit(p.unit, 1)) + (p.negotiated ? '<span class="neg">klantprijs</span>' : "") + '</div></div><div class="stepper"><button data-nd="' + p.id + '">−</button><input data-nq="' + p.id + '" inputmode="' + (p.decimals ? "decimal" : "numeric") + '" value="' + (N.cart[p.id] ? K.qty(N.cart[p.id]) : "") + '" placeholder="0"><button data-ni="' + p.id + '">+</button></div></div>').join("") + "</div>" +
      '<div class="card"><div class="field"><label for="nn">Opmerking</label><textarea class="textarea" id="nn" style="min-height:64px">' + esc(N.note) + '</textarea></div><div class="row spread" style="margin-top:10px"><span class="muted">' + K.plural(lines().length, "artikel", "artikelen") + ' · totaal excl. btw</span><b class="num" style="font-size:1.3rem" id="ntot">' + K.eur(total()) + '</b></div><button class="btn btn-accent btn-lg btn-block" id="save" style="margin-top:10px"' + (lines().length ? "" : " disabled") + ">Bestelling opslaan</button></div></div>";
    const setQ = (id, v) => { const p = cat.find((x) => x.id === id); let n = Number(String(v).replace(",", ".")) || 0; if (!p.decimals) n = Math.round(n); n = Math.max(0, n); if (n) N.cart[id] = n; else delete N.cart[id]; };
    const refresh = () => { const pos = $("#pq") === document.activeElement ? $("#pq").selectionStart : null; renderNieuw(); if (pos !== null) { $("#pq").focus(); $("#pq").setSelectionRange(pos, pos); } };
    $("#other").onclick = () => { N.client = null; renderNieuw(); };
    K.$$("[data-date]").forEach((b) => { b.onclick = () => { N.date = b.dataset.date; refresh(); }; });
    if ($("#all")) $("#all").onclick = () => { sugg.forEach((s) => { if (!N.cart[s.p.id]) N.cart[s.p.id] = s.qty; }); refresh(); };
    K.$$("[data-sugg]").forEach((b) => { b.onclick = () => { N.cart[b.dataset.sugg] = Number(b.dataset.qty) || 1; refresh(); }; });
    $("#pq").oninput = K.debounce(() => { N.q = $("#pq").value; refresh(); }, 150);
    K.$$("[data-ni]").forEach((b) => { b.onclick = () => { const p = cat.find((x) => x.id === b.dataset.ni); setQ(p.id, (N.cart[p.id] || 0) + (p.decimals ? 0.5 : 1)); refresh(); }; });
    K.$$("[data-nd]").forEach((b) => { b.onclick = () => { const p = cat.find((x) => x.id === b.dataset.nd); setQ(p.id, (N.cart[p.id] || 0) - (p.decimals ? 0.5 : 1)); refresh(); }; });
    K.$$("[data-nq]").forEach((i) => { i.onchange = () => { setQ(i.dataset.nq, i.value); refresh(); }; });
    $("#nn").oninput = (e) => { N.note = e.target.value; };
    $("#save").onclick = () => K.busy($("#save"), async () => {
      try {
        const r = await K.api("team/bestellingen", { body: { klantId: c.id, items: lines().map((l) => ({ productId: l.p.id, qty: l.qty })), leverdatum: N.date, opmerking: N.note, bron: "Telefoon" } });
        K.toast("Bestelling " + r.order.ref + " opgeslagen", "ok");
        N.client = null; N.cart = {}; N.note = "";
        await load(); S.view = "board"; render(); openOrder(r.order.id);
      } catch (err) { K.toast(err.message, "bad"); }
    });
  }

  // ---- Historiek ---------------------------------------------------------------------------------------
  async function renderHistoriek() {
    main.innerHTML = '<div class="section-head"><h1>Historiek</h1></div><div class="searchbox" style="margin-bottom:10px">' + K.icon("search") + '<input class="input" id="hq" placeholder="Zoek op klant, referentie, factuurnummer of artikel…" value="' + esc(S.histQ) + '"></div><div class="card pad-0 flat"><div class="list" id="hl"><div class="skeleton" style="height:60px;margin:12px"></div></div></div>';
    $("#hq").oninput = K.debounce(async () => { S.histQ = $("#hq").value; await fetchHist(); drawHist(); }, 250);
    if (!S.hist) await fetchHist();
    drawHist();
  }
  async function fetchHist() { const seq = ++S.histSeq; try { const r = await K.api("team/bestellingen?q=" + encodeURIComponent(S.histQ)); if (seq !== S.histSeq) return; S.hist = r.orders; } catch (err) { if (seq !== S.histSeq) return; K.toast(err.message, "bad"); S.hist = []; } }
  function drawHist() {
    const el = $("#hl"); if (!el) return;
    el.innerHTML = (S.hist || []).length ? S.hist.map((o) => '<button class="item" data-open="' + o.id + '"><div class="body"><div class="title">' + esc((o.client || {}).name || "—") + ' <span class="muted small">· ' + esc(o.ref) + '</span></div><div class="sub">Levering ' + esc(K.dateShort(o.deliveryDate)) + " · " + K.plural(o.lines.length, "artikel", "artikelen") + " · " + K.eur(o.totalCents) + (o.invoiceNumber ? " · " + esc(o.invoiceNumber) : "") + '</div></div><div class="end">' + K.chip(o.status, o.statusLabel) + "</div></button>").join("") : '<div class="empty">Niets gevonden.</div>';
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
    try { const s = await K.api("team/sessie"); S.role = s.role; await load(); render(); const q = K.qs(); if (q.bestelling) openOrder(q.bestelling); }
    catch (err) { if (err.status === 401) renderLogin(); else if (err.status !== 503) renderLogin(err.message); }
    // Elke 2 minuten het bord verversen (de tablet blijft de hele ochtend open).
    setInterval(async () => { if (S.role && S.view === "board" && !current && document.visibilityState === "visible") { try { await load(); renderBoard(); } catch (_) { /* stil */ } } }, 120000);
  }
  boot();
})();
