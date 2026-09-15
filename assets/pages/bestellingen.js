(async function () {
  if (!(await K.requireStaff())) return;
  const page = K.shell({});
  const P = K.hashParams();
  let view = P.path || K.store.get("famoOrdersView", "tabel"), filter = { status: P.params.status || "open", client: "", q: "" }, week0 = K.today();
  const sel = new Set();
  function header() {
    const c = S.counts();
    return '<div class="page-h"><div><h1 class="h1">Bestellingen</h1><p class="sub">' + K.esc(K.dateLong(K.today())) + '</p></div><span class="spacer"></span>' + K.c.kpi(c.today, "vandaag") + K.c.kpi(c.prep, "te bereiden") + (c.late ? K.c.kpi(c.late, "te laat", true) : "") + (K.staff.isAdmin() ? '<a class="btn btn-p btn-sm" href="/invoer.html">' + K.icon("plus") + 'Nieuwe bestelling</a>' : "") + '</div>' +
      '<div class="views">' + [["tabel", "Tabel", "table"], ["bord", "Bord", "board"], ["kalender", "Kalender", "cal"]].map(([k, l, i]) => '<a href="#/' + k + '"' + (view === k ? ' class="on"' : "") + '>' + K.icon(i) + l + '</a>').join("") + '</div>' +
      '<div class="tools"><label class="search" style="max-width:280px">' + K.icon("search") + '<input id="q" placeholder="Zoek klant, referentie, artikel…" value="' + K.esc(filter.q) + '"></label>' +
      '<select class="input tool" id="fStatus" style="width:auto;min-height:36px;padding:0 8px"><option value="open"' + (filter.status === "open" ? " selected" : "") + '>Open bestellingen</option><option value="all"' + (filter.status === "all" ? " selected" : "") + '>Alle</option><option value="Reçue"' + (filter.status === "Reçue" ? " selected" : "") + '>Te bereiden</option><option value="Prête"' + (filter.status === "Prête" ? " selected" : "") + '>Klaar</option><option value="Sortie en livraison"' + (filter.status === "Sortie en livraison" ? " selected" : "") + '>Onderweg</option><option value="Facturée"' + (filter.status === "Facturée" ? " selected" : "") + '>Geleverd</option><option value="unpaid"' + (filter.status === "unpaid" ? " selected" : "") + '>Openstaande betaling</option><option value="late"' + (filter.status === "late" ? " selected" : "") + '>Te laat</option></select>' +
      '<select class="input tool" id="fClient" style="width:auto;min-height:36px;padding:0 8px"><option value="">Alle klanten</option>' + Array.from(new Set(S.orders.map(o => o.client))).sort((a, b) => a.localeCompare(b, "nl")).map(c2 => '<option' + (filter.client === c2 ? " selected" : "") + '>' + K.esc(c2) + '</option>').join("") + '</select>' +
      '<span class="spacer"></span><button type="button" class="tool" id="reload">' + K.icon("refresh") + 'Vernieuwen</button></div>';
  }
  function filtered() {
    const q = filter.q.toLowerCase();
    return S.orders.filter(o => {
      if (filter.status === "open" && o.statut === "Facturée") return false;
      if (filter.status === "unpaid" && !(o.statut === "Facturée" && o.paiement !== "Payé")) return false;
      if (filter.status === "late" && !o.late) return false;
      if (K.STATUSES.includes(filter.status) && o.statut !== filter.status) return false;
      if (filter.client && o.client !== filter.client) return false;
      if (q && !(o.ref + " " + o.client + " " + o.lignes + " " + (o.factuurnummer || "")).toLowerCase().includes(q)) return false;
      return true;
    });
  }
  function rowHtml(o) {
    return '<tr class="row" data-open="' + o.id + '"><td style="width:40px">' + K.c.check(sel.has(o.id), 'data-sel="' + o.id + '"') + '</td><td><b>' + K.esc(K.relDay(o.day)) + '</b><div class="quiet mono" style="font-size:11px">' + K.esc(o.ref) + '</div></td><td><b>' + K.esc(o.client) + '</b></td><td class="muted" title="' + K.esc(S.lineTxt(o)) + '">' + K.esc(S.lineTxt(o)) + '</td><td style="width:140px">' + (o.late ? '<span class="cell-st c-late">Te laat</span>' : K.stCell(o.statut)) + '</td><td style="width:120px">' + K.payCell(o.paiement) + '</td><td class="num mono">' + K.eur(o.total) + '</td><td style="width:170px;text-align:right">' + S.nextAction(o) + '</td></tr>';
  }
  function tabel(list) {
    const groups = [["Te laat", o => o.late, "var(--danger)"], ["Vandaag", o => o.day === K.today(), "var(--st-new)"], ["Morgen", o => o.day === K.addDays(K.today(), 1), "var(--st-ready)"], ["Later", o => o.day > K.addDays(K.today(), 1), "var(--st-road)"], ["Eerder", o => o.day < K.today(), "var(--st-inv)"]];
    const used = new Set(); let html = "";
    groups.forEach(([label, fn, color]) => { const rows = list.filter(o => !used.has(o.id) && fn(o)); rows.forEach(o => used.add(o.id)); if (!rows.length) return; const sum = rows.reduce((s, o) => s + Number(o.total || 0), 0); html += '<div class="grp"><div class="grp-h" style="border-left-color:' + color + '">' + label + ' <small>' + rows.length + ' · ' + K.eur(sum) + '</small></div><div class="tblwrap"><table class="tbl"><thead><tr><th></th><th>Levering</th><th>Klant</th><th>Artikelen</th><th>Status</th><th>Betaling</th><th class="num">Bedrag</th><th></th></tr></thead><tbody>' + rows.map(rowHtml).join("") + '</tbody></table></div></div>'; });
    return html || K.c.empty("Geen bestellingen in deze selectie", "Pas de filters aan of vernieuw de lijst.");
  }
  function bord(list) {
    const cols = [["Reçue", "Te bereiden", "var(--st-new)"], ["Prête", "Klaar", "var(--st-ready)"], ["Sortie en livraison", "Onderweg", "var(--st-road)"], ["Facturée", "Geleverd", "var(--st-done)"]];
    return '<div class="board">' + cols.map(([st, label, color]) => { const rows = list.filter(o => o.statut === st).sort((a, b) => (a.day || "").localeCompare(b.day || "")); return '<div class="col"><div class="colh"><i style="background:' + color + '"></i>' + label + '<b>' + rows.length + '</b></div>' + (rows.length ? rows.map(S.orderCard).join("") : '<div class="empty">' + ({ "Reçue": "Niets te bereiden.", "Prête": "Niets klaargezet. Valideer artikelen in het Magazijn.", "Sortie en livraison": "Geen ronde onderweg.", "Facturée": "Nog niets geleverd." })[st] + '</div>') + '</div>'; }).join("") + '</div>';
  }
  function kalender(list) {
    const d0 = K.parseDate(week0); const mon = new Date(d0); mon.setDate(d0.getDate() - ((d0.getDay() + 6) % 7)); const days = Array.from({ length: 7 }, (_, i) => K.isoDay(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
    return '<div class="tools" style="padding:0 0 10px"><button type="button" class="btn btn-o btn-sm" id="wPrev">‹ Vorige week</button><button type="button" class="btn btn-o btn-sm" id="wToday">Vandaag</button><button type="button" class="btn btn-o btn-sm" id="wNext">Volgende week ›</button><span class="muted" style="margin-left:6px">Week van ' + K.esc(K.dateLong(days[0])) + '</span></div><div class="cal">' + days.map(d => { const rows = list.filter(o => o.day === d); const dt = K.parseDate(d); return '<div class="day' + (d === K.today() ? " today" : "") + (dt.getDay() === 0 || dt.getDay() === 6 ? " wk" : "") + '"><div class="dn">' + K.esc(K.date(d)) + (rows.length ? ' · ' + rows.length : "") + '</div>' + rows.map(o => '<a class="ev" href="/order.html?id=' + encodeURIComponent(o.id) + '" style="border-left-color:var(--st-' + K.stKey(o.statut) + ')"><b>' + K.esc(o.client) + '</b><span>' + K.esc(S.lineTxt(o)) + '</span></a>').join("") + '</div>'; }).join("") + '</div>';
  }
  function bulkBar() {
    if (!sel.size) return "";
    return '<div class="bulk"><b>' + sel.size + '</b> geselecteerd<button type="button" class="btn btn-sm" style="background:#fff;color:var(--ink)" data-bulk="picking">Verzamellijst</button><button type="button" class="btn btn-sm" style="background:rgba(255,255,255,.12);color:#fff" data-bulk="delivery">Leveringsbonnen</button><button type="button" class="btn btn-sm" style="background:rgba(255,255,255,.12);color:#fff" data-bulk="csv">Exporteren (CSV)</button><button type="button" class="ibtn" style="color:#fff" data-bulk="clear" aria-label="Selectie wissen">' + K.icon("x") + '</button></div>';
  }
  function render() {
    const list = filtered();
    page.innerHTML = header() + '<div class="content" style="padding-top:4px">' + (view === "bord" ? bord(list) : view === "kalender" ? kalender(list) : tabel(list)) + '</div>' + bulkBar();
    const q = page.querySelector("#q"); q.addEventListener("input", () => { filter.q = q.value; const pos = q.selectionStart; render(); const n = page.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); });
    page.querySelector("#fStatus").onchange = e => { filter.status = e.target.value; render(); };
    page.querySelector("#fClient").onchange = e => { filter.client = e.target.value; render(); };
    page.querySelector("#reload").onclick = async () => { await load(true); };
    const wp = page.querySelector("#wPrev"); if (wp) { wp.onclick = () => { week0 = K.addDays(week0, -7); render(); }; page.querySelector("#wNext").onclick = () => { week0 = K.addDays(week0, 7); render(); }; page.querySelector("#wToday").onclick = () => { week0 = K.today(); render(); }; }
  }
  K.on(page, "click", "[data-sel]", (e, t) => { e.stopPropagation(); const id = t.dataset.sel; if (sel.has(id)) sel.delete(id); else sel.add(id); render(); });
  K.on(page, "click", "tr[data-open]", (e, t) => { if (e.target.closest("button,a")) return; location.href = "/order.html?id=" + encodeURIComponent(t.dataset.open); });
  K.on(page, "click", "[data-bulk]", (e, t) => {
    const list = S.orders.filter(o => sel.has(o.id));
    if (t.dataset.bulk === "clear") { sel.clear(); render(); return; }
    if (t.dataset.bulk === "picking") S.openPicking(list, list.length + " bestellingen");
    if (t.dataset.bulk === "delivery") { list.forEach(o => S.openDoc(o, "delivery")); }
    if (t.dataset.bulk === "csv") { const csv = ["Referentie;Levering;Klant;Status;Betaling;Totaal excl. btw;Factuur;Artikelen"].concat(list.map(o => [o.ref, o.day, o.client, K.status(o.statut), K.pay(o.paiement), String(o.total).replace(".", ","), o.factuurnummer || "", S.lineTxt(o)].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(";"))).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = "famo-bestellingen-" + K.today() + ".csv"; a.click(); }
  });
  S.bindActions(page, () => render());
  window.addEventListener("hashchange", () => { const h = K.hashParams(); if (h.path && h.path !== view) { view = h.path; K.store.set("famoOrdersView", view); render(); } });
  async function load(force) {
    try { await S.load(force); render(); }
    catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message, true) + '</div>'; K.on(page, "click", "[data-retry]", e => { e.preventDefault(); load(true); }); }
  }
  page.innerHTML = '<div class="page-h"><h1 class="h1">Bestellingen</h1></div><div class="content">' + K.c.skeleton(4) + '</div>';
  load();
})();
