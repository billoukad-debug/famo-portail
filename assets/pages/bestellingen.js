(async function () {
  if (!(await K.requireStaff())) return;
  const page = K.shell({});
  const P = K.hashParams(); const qs = new URLSearchParams(location.search);
  // ?klant=<clientId> : Beheer → Klanten linkt hierheen ; ?all=1 : volledige historiek.
  // Filters en sortering blijven bewaard op dit toestel (famoOrdersFilter) ; een link met ?status of ?klant gaat voor.
  const FKEY = "famoOrdersFilter", saved = K.store.get(FKEY, {}) || {};
  let view = P.path || K.store.get("famoOrdersView", "tabel"), filter = { status: P.params.status || saved.status || "open", client: saved.client || "", clientId: qs.get("klant") || "", q: saved.q || "", van: saved.van || "", tot: saved.tot || "" }, week0 = K.today();
  let sort = saved.sort && saved.sort.key ? saved.sort : { key: "", dir: 1 };
  const saveFilter = () => K.store.set(FKEY, { status: filter.status, client: filter.client, q: filter.q, van: filter.van, tot: filter.tot, sort });
  const SORTS = { day: o => o.day || "", client: o => String(o.client || "").toLowerCase(), statut: o => K.STATUSES.indexOf(o.statut), total: o => Number(o.total) || 0 };
  const bySort = (a, b) => { if (!sort.key) return 0; const f = SORTS[sort.key], x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; };
  const th = (key, label, cls) => '<th' + (cls ? ' class="' + cls + '"' : "") + ' aria-sort="' + (sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none") + '"><button type="button" class="th-sort" data-sort="' + key + '">' + label + (sort.key === key ? (sort.dir > 0 ? " ▲" : " ▼") : "") + '</button></th>';
  const sel = new Set();
  const clientName = id => { const o = S.orders.find(x => x.clientId === id); return o ? o.client : id; };
  function header() {
    const c = S.counts();
    return '<div class="page-h"><div><h1 class="h1">Bestellingen</h1><p class="sub">' + K.esc(K.dateLong(K.today())) + '</p></div><span class="spacer"></span>' + K.c.kpi(c.today, "vandaag") + K.c.kpi(c.prep, "te bereiden") + (c.late ? K.c.kpi(c.late, "te laat", true) : "") + (K.staff.isAdmin() ? '<a class="btn btn-p btn-sm" href="/invoer.html">' + K.icon("plus") + 'Nieuwe bestelling</a>' : "") + '</div>' +
      '<div class="views">' + [["tabel", "Tabel", "table"], ["bord", "Bord", "board"], ["kalender", "Kalender", "cal"]].map(([k, l, i]) => '<a href="#/' + k + '"' + (view === k ? ' class="on"' : "") + '>' + K.icon(i) + l + '</a>').join("") + '</div>' +
      '<div class="tools"><label class="search" style="max-width:280px">' + K.icon("search") + '<input id="q" aria-label="Zoeken" placeholder="Zoek klant, referentie, artikel…" value="' + K.esc(filter.q) + '"></label>' +
      '<select class="input tool" id="fStatus" aria-label="Status" style="width:auto;padding:0 8px"><option value="open"' + (filter.status === "open" ? " selected" : "") + '>Open bestellingen</option><option value="all"' + (filter.status === "all" ? " selected" : "") + '>Alle</option><option value="Reçue"' + (filter.status === "Reçue" ? " selected" : "") + '>Ontvangen</option><option value="Prête"' + (filter.status === "Prête" ? " selected" : "") + '>Klaar</option><option value="Sortie en livraison"' + (filter.status === "Sortie en livraison" ? " selected" : "") + '>Onderweg</option><option value="Facturée"' + (filter.status === "Facturée" ? " selected" : "") + '>Geleverd</option><option value="unpaid"' + (filter.status === "unpaid" ? " selected" : "") + '>Openstaande betaling</option><option value="late"' + (filter.status === "late" ? " selected" : "") + '>Te laat</option><option value="Annulée"' + (filter.status === "Annulée" ? " selected" : "") + '>Geannuleerd</option></select>' +
      (filter.clientId ? '<span class="tag" style="display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 4px 0 10px">Klant: <b>' + K.esc(clientName(filter.clientId)) + '</b><button type="button" class="ibtn" id="clearKlant" aria-label="Klantfilter wissen" style="width:32px;height:32px">' + K.icon("x") + '</button></span>' :
        '<select class="input tool" id="fClient" aria-label="Klant" style="width:auto;padding:0 8px"><option value="">Alle klanten</option>' + Array.from(new Set(S.orders.map(o => o.client))).sort((a, b) => a.localeCompare(b, "nl")).map(c2 => '<option' + (filter.client === c2 ? " selected" : "") + '>' + K.esc(c2) + '</option>').join("") + '</select>') +
      '<label class="quiet" style="font-size:12px;display:inline-flex;align-items:center;gap:4px">van <input type="date" class="input tool" id="fVan" aria-label="Leverdag vanaf" value="' + K.esc(filter.van) + '" style="width:auto;min-width:150px"></label>' +
      '<label class="quiet" style="font-size:12px;display:inline-flex;align-items:center;gap:4px">tot <input type="date" class="input tool" id="fTot" aria-label="Leverdag tot en met" value="' + K.esc(filter.tot) + '" style="width:auto;min-width:150px"></label>' +
      (filter.q || filter.client || filter.van || filter.tot || filter.status !== "open" || sort.key ? '<button type="button" class="tool" id="fReset">' + K.icon("x") + 'Filters wissen</button>' : "") +
      '<span class="spacer"></span>' + (S.window ? '<span class="quiet" style="font-size:12px">open + laatste ' + S.window + ' dagen · <a href="#" id="loadAll">Alles laden</a></span>' : '<span class="quiet" style="font-size:12px">volledige historiek</span>') + '<button type="button" class="tool" id="reload">' + K.icon("refresh") + 'Vernieuwen</button></div>';
  }
  function filtered() {
    const q = filter.q.toLowerCase();
    return S.orders.filter(o => {
      if (filter.status === "open" && K.isClosed(o)) return false;
      if (filter.status === "unpaid" && !(o.statut === "Facturée" && o.paiement !== "Payé")) return false;
      if (filter.status === "late" && !o.late) return false;
      if ((K.STATUSES.includes(filter.status) || filter.status === K.CANCELLED) && o.statut !== filter.status) return false;
      // Geannuleerde bestellingen enkel via hun eigen filter (of « Alle »), nooit tussen het werk van de dag.
      if (o.statut === K.CANCELLED && filter.status !== K.CANCELLED && filter.status !== "all") return false;
      if (filter.clientId && o.clientId !== filter.clientId) return false;
      if (filter.client && o.client !== filter.client) return false;
      if (filter.van && (o.day || "") < filter.van) return false;
      if (filter.tot && (o.day || "") > filter.tot) return false;
      if (q && !(o.ref + " " + o.client + " " + o.lignes + " " + (o.factuurnummer || "") + " " + (o.creditnota && o.creditnota.nummer || "")).toLowerCase().includes(q)) return false;
      return true;
    });
  }
  function rowHtml(o) {
    return '<tr class="row" data-open="' + o.id + '"><td style="width:40px">' + K.c.check(sel.has(o.id), 'data-sel="' + o.id + '"', { label: "Selecteer " + o.client }) + '</td><td><b>' + K.esc(K.relDay(o.day)) + '</b><div class="quiet mono" style="font-size:11px">' + K.esc(o.ref) + '</div></td><td><b>' + K.esc(o.client) + '</b></td><td class="muted fill" title="' + K.esc(S.lineTxt(o)) + '">' + K.esc(S.lineTxt(o)) + '</td><td style="width:140px">' + (o.late ? '<span class="cell-st c-late">Te laat</span>' : K.stCell(o.statut)) + ' ' + S.uitzTag(o) + '</td><td class="hide-md" style="width:120px">' + K.payCell(o.paiement) + (o.creditnota ? '<div class="quiet mono" style="font-size:11px">' + K.esc(o.creditnota.nummer) + '</div>' : "") + '</td><td class="num mono">' + K.eur(o.total) + '</td><td class="actions" style="width:170px">' + S.nextAction(o) + '</td></tr>';
  }
  function tabel(list) {
    const groups = [["Te laat", o => o.late, "var(--danger)"], ["Vandaag", o => o.day === K.today(), "var(--st-new)"], ["Morgen", o => o.day === K.addDays(K.today(), 1), "var(--st-ready)"], ["Later", o => o.day > K.addDays(K.today(), 1), "var(--st-road)"], ["Eerder", o => o.day < K.today(), "var(--st-inv)"]];
    const used = new Set(); let html = "";
    groups.forEach(([label, fn, color]) => { const rows = list.filter(o => !used.has(o.id) && fn(o)).sort(bySort); rows.forEach(o => used.add(o.id)); if (!rows.length) return; const sum = rows.reduce((s, o) => s + Number(o.total || 0), 0); html += '<div class="grp"><div class="grp-h" style="border-left-color:' + color + '">' + label + ' <small>' + rows.length + ' · ' + K.eur(sum) + '</small></div><div class="tblwrap"><table class="tbl"><thead><tr><th>' + K.c.check(rows.every(o => sel.has(o.id)), 'data-selall="' + label + '"', { label: "Alles selecteren: " + label }) + '</th>' + th("day", "Levering") + th("client", "Klant") + '<th>Artikelen</th>' + th("statut", "Status") + '<th class="hide-md">Betaling</th>' + th("total", "Bedrag", "num") + '<th></th></tr></thead><tbody>' + rows.map(rowHtml).join("") + '</tbody></table></div></div>'; });
    return html || K.c.empty("Geen bestellingen in deze selectie", "Pas de filters aan of vernieuw de lijst.");
  }
  function bord(list) {
    const cols = [["Reçue", "Ontvangen", "var(--st-new)"], ["Prête", "Klaar", "var(--st-ready)"], ["Sortie en livraison", "Onderweg", "var(--st-road)"], ["Facturée", "Geleverd", "var(--st-done)"]];
    return '<div class="board">' + cols.map(([st, label, color]) => { const rows = list.filter(o => o.statut === st).sort((a, b) => (a.day || "").localeCompare(b.day || "")); return '<div class="col" data-st="' + st + '"><div class="colh"><i style="background:' + color + '"></i>' + label + '<b>' + rows.length + '</b></div>' + (rows.length ? rows.map(S.orderCard).join("") : '<div class="empty">' + ({ "Reçue": "Niets ontvangen.", "Prête": "Niets klaargezet. Valideer artikelen in het Magazijn.", "Sortie en livraison": "Geen ronde onderweg.", "Facturée": "Nog niets geleverd." })[st] + '</div>') + '</div>'; }).join("") + '</div>';
  }
  function kalender(list) {
    const d0 = K.parseDate(week0); const mon = new Date(d0); mon.setDate(d0.getDate() - ((d0.getDay() + 6) % 7)); const days = Array.from({ length: 7 }, (_, i) => K.isoDay(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
    return '<div class="tools" style="padding:0 0 10px"><button type="button" class="btn btn-o btn-sm" id="wPrev">‹ Vorige week</button><button type="button" class="btn btn-o btn-sm" id="wToday">Vandaag</button><button type="button" class="btn btn-o btn-sm" id="wNext">Volgende week ›</button><span class="muted" style="margin-left:6px">Week van ' + K.esc(K.dateLong(days[0])) + '</span></div><div class="cal">' + days.map(d => { const rows = list.filter(o => o.day === d); const dt = K.parseDate(d); return '<div class="day' + (d === K.today() ? " today" : "") + (dt.getDay() === 0 || dt.getDay() === 6 ? " wk" : "") + '"><div class="dn">' + K.esc(K.date(d)) + (rows.length ? ' · ' + rows.length : "") + '</div>' + rows.map(o => '<a class="ev" href="/order.html?id=' + encodeURIComponent(o.id) + '" style="border-left-color:var(--st-' + K.stKey(o.statut) + ')"><b>' + K.esc(o.client) + '</b><span>' + K.esc(S.lineTxt(o)) + '</span></a>').join("") + '</div>'; }).join("") + '</div>';
  }
  const selected = () => S.orders.filter(o => sel.has(o.id));
  function bulkBar() {
    if (!sel.size) return "";
    const list = selected(), unpaid = list.filter(o => o.statut === "Facturée" && o.paiement !== "Payé").length;
    const st = 'style="background:rgba(255,255,255,.12);color:#fff"';
    return '<div class="bulk"><b>' + sel.size + '</b> geselecteerd<button type="button" class="btn btn-sm" style="background:#fff;color:var(--ink)" data-bulk="picking">Verzamellijst</button><button type="button" class="btn btn-sm" ' + st + ' data-bulk="delivery">Leveringsbonnen</button>' + (unpaid ? '<button type="button" class="btn btn-sm" ' + st + ' data-bulk="paid">Markeer betaald (' + unpaid + ')</button>' : "") + '<button type="button" class="btn btn-sm" ' + st + ' data-bulk="csv">Exporteren (CSV)</button><button type="button" class="ibtn" style="color:#fff" data-bulk="clear" aria-label="Selectie wissen">' + K.icon("x") + '</button></div>';
  }
  function render() {
    saveFilter();
    const list = filtered();
    page.innerHTML = header() + '<div class="content" style="padding-top:4px">' + (view === "bord" ? bord(list) : view === "kalender" ? kalender(list) : tabel(list)) + '</div>' + bulkBar();
    const q = page.querySelector("#q"); q.addEventListener("input", K.debounce(() => { filter.q = q.value; const pos = q.selectionStart; render(); const n = page.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); }, 150));
    page.querySelector("#fStatus").onchange = e => { filter.status = e.target.value; render(); };
    page.querySelector("#fVan").onchange = e => { filter.van = e.target.value; render(); };
    page.querySelector("#fTot").onchange = e => { filter.tot = e.target.value; render(); };
    const fr = page.querySelector("#fReset"); if (fr) fr.onclick = () => { filter = Object.assign(filter, { status: "open", client: "", q: "", van: "", tot: "" }); sort = { key: "", dir: 1 }; render(); };
    const fc = page.querySelector("#fClient"); if (fc) fc.onchange = e => { filter.client = e.target.value; render(); };
    const ck = page.querySelector("#clearKlant"); if (ck) ck.onclick = () => { filter.clientId = ""; history.replaceState(null, "", location.pathname + location.hash); render(); };
    page.querySelector("#reload").onclick = async () => { await load(true); };
    const la = page.querySelector("#loadAll"); if (la) la.onclick = async e => { e.preventDefault(); la.textContent = "Laden…"; await load(true, true); };
    const wp = page.querySelector("#wPrev"); if (wp) { wp.onclick = () => { week0 = K.addDays(week0, -7); render(); }; page.querySelector("#wNext").onclick = () => { week0 = K.addDays(week0, 7); render(); }; page.querySelector("#wToday").onclick = () => { week0 = K.today(); render(); }; }
  }
  K.on(page, "click", "[data-sel]", (e, t) => { e.stopPropagation(); const id = t.dataset.sel; if (sel.has(id)) sel.delete(id); else sel.add(id); render(); });
  K.on(page, "click", "[data-selall]", (e, t) => { e.stopPropagation(); const ids = K.$$("tbody [data-sel]", t.closest("table")).map(x => x.dataset.sel); const all = ids.every(id => sel.has(id)); ids.forEach(id => all ? sel.delete(id) : sel.add(id)); render(); });
  K.on(page, "click", "tr[data-open]", (e, t) => { if (e.target.closest("button,a")) return; location.href = "/order.html?id=" + encodeURIComponent(t.dataset.open); });
  K.on(page, "click", "[data-bulk]", async (e, t) => {
    const list = selected();
    if (t.dataset.bulk === "clear") { sel.clear(); render(); return; }
    if (t.dataset.bulk === "picking") S.openPicking(list, list.length + " bestellingen");
    if (t.dataset.bulk === "delivery") S.openDocs(list, "delivery");
    if (t.dataset.bulk === "csv") S.csvDownload([["Referentie", "Levering", "Klant", "Status", "Betaling", "Totaal excl. btw", "Factuur", "Creditnota", "Artikelen"]].concat(list.map(o => [o.ref, o.day, o.client, K.status(o.statut), K.pay(o.paiement), K.num(o.total), o.factuurnummer || "", o.creditnota ? o.creditnota.nummer : "", S.lineTxt(o)])), "famo-bestellingen-" + K.today() + ".csv");
    if (t.dataset.bulk === "paid") {
      // Eén betaalwijze voor de hele selectie ; één aanroep per bestelling, na elkaar, de server beslist telkens.
      const todo = list.filter(o => o.statut === "Facturée" && o.paiement !== "Payé"); if (!todo.length) return;
      const mode = await S.askMode("Markeer betaald (" + todo.length + ")", todo.length + " facturen · " + K.eur(todo.reduce((s, o) => s + S.totals(o).incl, 0)) + " incl. btw"); if (!mode) return;
      // 3 tegelijk : snel, en binnen de limiet van de database (geen voorraad in het spel).
      const res = await K.pool(todo, 3, o => K.api("/api/updateorder", { json: { id: o.id, paiement: "Payé", modePaiement: mode } }));
      let ok = 0; const fail = [];
      res.forEach(r => { if (r.ok) { ok++; sel.delete(r.item.id); } else fail.push(r.item.client + ": " + r.error.message); });
      try { await S.load(true); } catch (err) { K.toast(err.message, { kind: "err" }); }
      render(); K.toast(ok + " van " + todo.length + " gemarkeerd als betaald (" + mode + ")" + (fail.length ? " · mislukt: " + fail.join(" · ") : ""), { kind: fail.length ? "err" : "", ms: fail.length ? 9000 : 4500 });
    }
  });
  S.bindActions(page, () => render());
  // Kolomkop : eerste klik oplopend, tweede aflopend, derde terug naar standaard.
  K.on(page, "click", "[data-sort]", (e, t) => { e.stopPropagation(); const k = t.dataset.sort; sort = sort.key !== k ? { key: k, dir: 1 } : sort.dir > 0 ? { key: k, dir: -1 } : { key: "", dir: 1 }; render(); });
  // Bord : een kaart naar de volgende kolom slepen = dezelfde stap als de knop (valideren, vertrekken,
  // ontvangst bevestigen) ; één kolom terug = Corrigeren (met reden). Andere sprongen worden geweigerd.
  const FLOW = ["Reçue", "Prête", "Sortie en livraison", "Facturée"];
  K.sortable(page, { items: ".col .ocard", zones: ".col[data-st]", onDrop: ({ item, from, to }) => {
    const o = S.byId(item.dataset.oid);
    const a = FLOW.indexOf(from.dataset.st), b = FLOW.indexOf(to.dataset.st);
    if (!o || a === b) return false;
    const refresh = () => render();
    if (b === a + 1) { if (b === 1) S.validatePanel(o, refresh); else if (b === 2) S.depart(o, refresh); else S.confirmDelivery(o, refresh); }
    else if (b === a - 1) S.correctPanel(o, refresh);
    else K.toast("Eén stap per keer: sleep naar de volgende kolom.", { kind: "err" });
    return false; // de kaart verhuist pas na bevestiging (render na de stap)
  } });
  window.addEventListener("hashchange", () => { const h = K.hashParams(); if (h.path && h.path !== view) { view = h.path; K.store.set("famoOrdersView", view); render(); } });
  async function load(force, all) {
    try { await S.load(force, all); render(); }
    catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message, true) + '</div>'; K.on(page, "click", "[data-retry]", e => { e.preventDefault(); load(true); }); }
  }
  page.innerHTML = '<div class="page-h"><h1 class="h1">Bestellingen</h1></div><div class="content">' + K.c.skeleton(4) + '</div>';
  load(false, qs.get("all") === "1").then(() => { if (S.orders.length || S.loadedAt) S.autoRefresh(render); });
})();
