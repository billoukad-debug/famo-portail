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
  // Weergaven : tabel, bord, kalender en « Te controleren » (bestellingen per e-mail, specs/020) met teller.
  function viewsNav() {
    const n = (S.mailIds || []).length;
    return '<nav class="views" aria-label="Weergave">' + [["tabel", "Tabel", "table"], ["bord", "Bord", "board"], ["kalender", "Kalender", "cal"], ["controle", "Te controleren", "mail"]].map(([k, l, i]) => '<a href="#/' + k + '"' + (view === k ? ' class="on" aria-current="page"' : "") + '>' + K.icon(i) + l + (k === "controle" && n ? '<b class="nbadge mc-count" aria-label="' + K.esc(K.plural(n, "bericht", "berichten")) + ' te controleren">' + n + '</b>' : "") + '</a>').join("") + '</nav>';
  }
  function top() {
    const c = S.counts();
    return '<div class="page-h"><div><h1 class="h1">Bestellingen</h1><p class="sub">' + K.esc(K.dateLong(K.today())) + '</p></div><span class="spacer"></span>' + K.c.kpi(c.today, "vandaag") + K.c.kpi(c.prep, "te bereiden") + (c.late ? K.c.kpi(c.late, "te laat", true, "#/tabel?status=late") : "") + (K.staff.isAdmin() ? '<a class="btn btn-p btn-sm" href="/team/invoeren">' + K.icon("plus") + 'Nieuwe bestelling</a>' : "") + '</div>';
  }
  function header() {
    return top() + viewsNav() +
      '<div class="tools"><label class="search maxw-280">' + K.icon("search") + '<input id="q" aria-label="Zoeken" placeholder="Zoek klant, referentie, artikel…" value="' + K.esc(filter.q) + '"></label>' +
      '<select class="input tool w-auto px-8" id="fStatus" aria-label="Status"><option value="open"' + (filter.status === "open" ? " selected" : "") + '>Open bestellingen</option><option value="all"' + (filter.status === "all" ? " selected" : "") + '>Alle</option><option value="Reçue"' + (filter.status === "Reçue" ? " selected" : "") + '>Ontvangen</option><option value="Prête"' + (filter.status === "Prête" ? " selected" : "") + '>Klaar</option><option value="Sortie en livraison"' + (filter.status === "Sortie en livraison" ? " selected" : "") + '>Onderweg</option><option value="Facturée"' + (filter.status === "Facturée" ? " selected" : "") + '>Geleverd</option><option value="unpaid"' + (filter.status === "unpaid" ? " selected" : "") + '>Openstaande betaling</option><option value="late"' + (filter.status === "late" ? " selected" : "") + '>Te laat</option><option value="Annulée"' + (filter.status === "Annulée" ? " selected" : "") + '>Geannuleerd</option></select>' +
      (filter.clientId ? '<span class="tag d-iflex ai-c gap-6 mh-36 px-4 pl-10">Klant: <b>' + K.esc(clientName(filter.clientId)) + '</b><button type="button" class="ibtn w-32 h-32" id="clearKlant" aria-label="Klantfilter wissen">' + K.icon("x") + '</button></span>' :
        '<select class="input tool w-auto px-8" id="fClient" aria-label="Klant"><option value="">Alle klanten</option>' + Array.from(new Set(S.orders.map(o => o.client))).sort((a, b) => a.localeCompare(b, "nl")).map(c2 => '<option' + (filter.client === c2 ? " selected" : "") + '>' + K.esc(c2) + '</option>').join("") + '</select>') +
      '<label class="quiet fs-12 iflex-4">van <input type="date" class="input tool w-auto minw-150" id="fVan" aria-label="Leverdag vanaf" value="' + K.esc(filter.van) + '"></label>' +
      '<label class="quiet fs-12 iflex-4">tot <input type="date" class="input tool w-auto minw-150" id="fTot" aria-label="Leverdag tot en met" value="' + K.esc(filter.tot) + '"></label>' +
      (filter.q || filter.client || filter.van || filter.tot || filter.status !== "open" || sort.key ? '<button type="button" class="tool" id="fReset">' + K.icon("x") + 'Filters wissen</button>' : "") +
      '<span class="spacer"></span>' + (S.window ? '<span class="quiet fs-12">open + laatste ' + S.window + ' dagen · <button type="button" class="linkbtn" id="loadAll">Alles laden</button></span>' : '<span class="quiet fs-12">volledige historiek</span>') + '<button type="button" class="tool" id="reload">' + K.icon("refresh") + 'Vernieuwen</button></div>';
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
      if (q && !(o.ref + " " + o.client + " " + o.lignes + " " + (o.factuurnummer || "") + " " + S.cns(o).map(cn => cn.nummer).join(" ")).toLowerCase().includes(q)) return false;
      return true;
    });
  }
  function rowHtml(o) {
    return '<tr class="row" data-open="' + o.id + '"><td class="w-40">' + K.c.check(sel.has(o.id), 'data-sel="' + o.id + '"', { label: "Selecteer " + o.client }) + '</td><td><b>' + K.esc(K.relDay(o.day)) + '</b><div class="quiet mono fs-11">' + K.esc(o.ref) + '</div></td><td><b>' + K.esc(o.client) + '</b></td><td class="muted fill" title="' + K.esc(S.lineTxt(o)) + '">' + K.esc(S.lineTxt(o)) + '</td><td class="w-140">' + (o.late ? '<span class="cell-st c-late">Te laat</span>' : K.stCell(o.statut)) + ' ' + S.uitzTag(o) + '</td><td class="hide-md w-120">' + K.payCell(o.paiement) + (S.cns(o).length ? '<div class="quiet mono fs-11">' + K.esc(S.cns(o).map(cn => cn.nummer).join(", ")) + '</div>' : "") + '</td><td class="num mono">' + K.eur(o.total) + '</td><td class="actions w-170">' + S.nextAction(o) + '</td></tr>';
  }
  function tabel(list) {
    const groups = [["Te laat", o => o.late, "var(--danger)"], ["Vandaag", o => o.day === K.today(), "var(--st-new)"], ["Morgen", o => o.day === K.addDays(K.today(), 1), "var(--st-ready)"], ["Later", o => o.day > K.addDays(K.today(), 1), "var(--st-road)"], ["Eerder", o => o.day < K.today(), "var(--st-inv)"]];
    const used = new Set(); let html = "";
    groups.forEach(([label, fn, color]) => { const rows = list.filter(o => !used.has(o.id) && fn(o)).sort(bySort); rows.forEach(o => used.add(o.id)); if (!rows.length) return; const sum = rows.reduce((s, o) => s + Number(o.total || 0), 0); html += '<div class="grp"><div class="grp-h" style="border-left-color:' + color + '">' + label + ' <small>' + rows.length + ' · ' + K.eur(sum) + '</small></div><div class="tblwrap"><table class="tbl tbl-orders"><thead><tr><th>' + K.c.check(rows.every(o => sel.has(o.id)), 'data-selall="' + label + '"', { label: "Alles selecteren: " + label }) + '</th>' + th("day", "Levering") + th("client", "Klant") + '<th>Artikelen</th>' + th("statut", "Status") + '<th class="hide-md">Betaling</th>' + th("total", "Bedrag", "num") + '<th></th></tr></thead><tbody>' + rows.map(rowHtml).join("") + '</tbody></table></div></div>'; });
    return html || K.c.empty("Geen bestellingen in deze selectie", "Pas de filters aan of vernieuw de lijst.");
  }
  function bord(list) {
    const cols = [["Reçue", "Ontvangen", "var(--st-new)"], ["Prête", "Klaar", "var(--st-ready)"], ["Sortie en livraison", "Onderweg", "var(--st-road)"], ["Facturée", "Geleverd", "var(--st-done)"]];
    return '<div class="board">' + cols.map(([st, label, color]) => { const rows = list.filter(o => o.statut === st).sort((a, b) => (a.day || "").localeCompare(b.day || "")); return '<div class="col" data-st="' + st + '"><div class="colh"><i style="background:' + color + '"></i>' + label + '<b>' + rows.length + '</b></div>' + (rows.length ? rows.map(S.orderCard).join("") : '<div class="empty">' + ({ "Reçue": "Niets ontvangen.", "Prête": "Niets klaargezet. Valideer artikelen in het Magazijn.", "Sortie en livraison": "Geen ronde onderweg.", "Facturée": "Nog niets geleverd." })[st] + '</div>') + '</div>'; }).join("") + '</div>';
  }
  function kalender(list) {
    const d0 = K.parseDate(week0); const mon = new Date(d0); mon.setDate(d0.getDate() - ((d0.getDay() + 6) % 7)); const days = Array.from({ length: 7 }, (_, i) => K.isoDay(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)));
    return '<div class="tools p-0 pb-10"><button type="button" class="btn btn-o btn-sm" id="wPrev">‹ Vorige week</button><button type="button" class="btn btn-o btn-sm" id="wToday">Vandaag</button><button type="button" class="btn btn-o btn-sm" id="wNext">Volgende week ›</button><span class="muted ml-6">Week van ' + K.esc(K.dateLong(days[0])) + '</span></div><div class="cal">' + days.map(d => { const rows = list.filter(o => o.day === d); const dt = K.parseDate(d); return '<div class="day' + (d === K.today() ? " today" : "") + (dt.getDay() === 0 || dt.getDay() === 6 ? " wk" : "") + '"><div class="dn">' + K.esc(K.date(d)) + (rows.length ? ' · ' + rows.length : "") + '</div>' + rows.map(o => '<a class="ev" href="/team/bestelling?id=' + encodeURIComponent(o.id) + '" style="border-left-color:var(--st-' + K.stKey(o.statut) + ')"><b>' + K.esc(o.client) + '</b><span>' + K.esc(S.lineTxt(o)) + '</span></a>').join("") + '</div>'; }).join("") + '</div>';
  }
  // ---------- Te controleren : bestellingen per e-mail die het team eerst bekijkt (specs/020) ----------
  // Elke kaart : afzender, klant, originele tekst (ingeklapt), voorstel als bewerkbare regels. « Bestelling
  // aanmaken » stuurt enkel artikel-id's en hoeveelheden : de server controleert alles opnieuw en rekent de prijzen.
  const MC = { data: null, loading: false, err: "", edits: {}, open: new Set() };
  async function loadControle() {
    if (MC.loading) return;
    MC.loading = true;
    try { MC.data = await K.api("/api/mailcontrole"); MC.err = ""; S.setMailIds((MC.data.items || []).map(x => x.id)); }
    catch (e) { if (e.status !== 401) MC.err = e.message; }
    MC.loading = false;
    if (view === "controle") render();
  }
  const mcProducts = () => ((MC.data && MC.data.products) || []).slice().sort(K.byNameKaliber);
  const mcProduct = id => ((MC.data && MC.data.products) || []).find(p => p.id === id);
  const mcBlank = () => ({ productId: "", qty: "", comment: "" });
  function mcEdit(it) {
    if (!MC.edits[it.id]) {
      const v = it.voorstel || {};
      MC.edits[it.id] = {
        clientId: it.client && !it.client.gearchiveerd ? it.client.id : "", day: v.leverdagVoorstel || v.leverdag || "", notes: v.opmerkingen || "",
        lines: (v.lines || []).map(l => ({ productId: l.productId && mcProduct(l.productId) ? l.productId : "", qty: l.qty > 0 ? K.num(l.qty) : "", comment: l.opmerking || "", from: l.naam_in_mail || "", conf: l.confidence, note: l.note || "" }))
      };
      if (!MC.edits[it.id].lines.length) MC.edits[it.id].lines.push(mcBlank());
    }
    return MC.edits[it.id];
  }
  const pct = c => Math.round((Number(c) || 0) * 100) + " %";
  function mcLine(it, l, i) {
    const p = mcProduct(l.productId), key = it.id + "-" + i, n = i + 1;
    const opts = '<option value="">— Kies een artikel —</option>' + mcProducts().map(x => '<option value="' + x.id + '"' + (x.id === l.productId ? " selected" : "") + '>' + K.esc(x.nom + (x.kaliber ? " · " + x.kaliber : "") + " (" + K.unit(x.unite) + ")") + '</option>').join("");
    return '<div class="mc-line">' +
      (l.from ? '<div class="mc-from">In de mail: <b>' + K.esc(l.from) + '</b>' + (l.conf != null ? ' <span class="chip ' + (l.conf >= 0.8 ? "st-done" : "st-late") + '"><i></i>' + (l.conf >= 0.8 ? "zeker " : "onzeker ") + pct(l.conf) + '</span>' : "") + (l.note ? ' <span class="quiet">' + K.esc(l.note) + '</span>' : "") + '</div>' : "") +
      '<select class="input mc-p" id="mcP-' + key + '" data-mc="productId" data-id="' + it.id + '" data-i="' + i + '" aria-label="Artikel, regel ' + n + '">' + opts + '</select>' +
      '<input class="input mc-q" id="mcQ-' + key + '" data-mc="qty" data-id="' + it.id + '" data-i="' + i + '" inputmode="decimal" autocomplete="off" value="' + K.esc(l.qty) + '" aria-label="Hoeveelheid, regel ' + n + '">' +
      '<span class="mc-u">' + K.esc(p ? K.unit(p.unite) : "") + '</span>' +
      '<button type="button" class="ibtn" data-mc-del="' + it.id + '" data-i="' + i + '" aria-label="Regel ' + n + ' verwijderen">' + K.icon("x") + '</button>' +
      '<input class="input mc-c" id="mcC-' + key + '" data-mc="comment" data-id="' + it.id + '" data-i="' + i + '" autocomplete="off" value="' + K.esc(l.comment) + '" placeholder="bv. gepeld, gefileerd" aria-label="Opmerking bij regel ' + n + ' (optioneel)">' +
      '</div>';
  }
  function mcItem(it) {
    const e = mcEdit(it), clients = (MC.data && MC.data.clients) || [];
    return '<article class="card mc-item" data-mcitem="' + it.id + '"><div class="card-h"><div class="minw-0"><h2 class="h2">' + K.esc(it.client ? it.client.nom : "Onbekende afzender") + '</h2><p class="sub ws-normal">' + K.esc(it.van) + ' · ontvangen ' + K.esc(K.date(it.ontvangen) + " " + K.time(it.ontvangen)) + (it.onderwerp ? ' · „' + K.esc(it.onderwerp) + '”' : "") + '</p></div><span class="chip st-late"><i></i>Te controleren</span></div>' +
      '<div class="card-b stack-12">' + K.c.warn("<b>Niet automatisch aangemaakt:</b> " + K.esc(it.reden || "onbekende reden")) +
      (it.inhoudOntbreekt ? K.c.warn("De inhoud kon niet opgehaald worden. Bekijk het bericht in Resend (Emails → Receiving) of vraag de klant om het opnieuw te sturen.") : "") +
      (it.tekst ? '<details class="mc-mail" data-mcopen="' + it.id + '"' + (MC.open.has(it.id) ? " open" : "") + '><summary class="mc-sum">' + K.icon("chev") + 'Originele e-mail</summary><div class="mc-text">' + K.esc(it.tekst) + '</div></details>' : "") +
      K.c.field("Klant", '<select class="input" id="mcK-' + it.id + '" data-mc="clientId" data-id="' + it.id + '"><option value="">— Kies de klant —</option>' + clients.map(c => '<option value="' + c.id + '"' + (c.id === e.clientId ? " selected" : "") + '>' + K.esc(c.nom) + '</option>').join("") + '</select>', { for: "mcK-" + it.id, hint: it.client ? "Herkend aan het e-mailadres." : "Afzender niet herkend: kies de klant enkel als u zeker bent." }) +
      '<div class="stack-6"><b class="fs-13">Artikelen</b>' + e.lines.map((l, i) => mcLine(it, l, i)).join("") + '<div><button type="button" class="btn btn-o btn-sm" data-mc-add="' + it.id + '">' + K.icon("plus") + 'Artikel toevoegen</button></div></div>' +
      '<div class="grid-2 mc-grid">' + K.c.field("Leverdag", '<input type="date" class="input" id="mcD-' + it.id + '" data-mc="day" data-id="' + it.id + '" value="' + K.esc(e.day) + '" min="' + K.today() + '">', { for: "mcD-" + it.id, hint: "Leverdagen en gesloten dagen controleert de server." }) +
      K.c.field("Opmerking voor magazijn / chauffeur", '<input class="input" id="mcN-' + it.id + '" data-mc="notes" data-id="' + it.id + '" autocomplete="off" value="' + K.esc(e.notes) + '">', { for: "mcN-" + it.id }) + '</div>' +
      '<div id="mcErr-' + it.id + '"></div></div>' +
      '<div class="mc-acts"><button type="button" class="btn btn-p" data-mc-create="' + it.id + '">Bestelling aanmaken</button>' + (it.tekst ? '<button type="button" class="btn btn-o" data-mc-read="' + it.id + '">Opnieuw laten lezen</button>' : "") + '<span class="spacer"></span><button type="button" class="btn btn-ghost" data-mc-ignore="' + it.id + '">Negeren</button></div></article>';
  }
  function mcDone(done) {
    if (!done.length) return "";
    return '<details class="grp mt-14 mc-done"><summary class="grp-h c-pointer ls-none blc-line">' + K.icon("chev") + 'Afgehandeld (laatste 14 dagen) <small>' + done.length + '</small></summary><div class="tblwrap"><table class="tbl"><thead><tr><th>Ontvangen</th><th>Van</th><th>Status</th><th>Bestelling</th></tr></thead><tbody>' +
      done.map(x => '<tr><td class="muted">' + K.esc(K.date(x.ontvangen) + " " + K.time(x.ontvangen)) + '</td><td class="wrap"><b>' + K.esc(x.client ? x.client.nom : x.van) + '</b><div class="quiet fs-12">' + K.esc(x.van) + '</div></td><td class="wrap">' + K.esc(x.status) + (x.reden ? '<div class="quiet fs-12">' + K.esc(x.reden) + '</div>' : "") + (x.behandeldDoor ? '<div class="quiet fs-12">door ' + K.esc(x.behandeldDoor) + '</div>' : "") + '</td><td>' + (x.commande ? '<a href="/team/bestelling?id=' + encodeURIComponent(x.commande.id) + '">' + K.esc(x.commande.ref || "Openen") + '</a>' : "—") + '</td></tr>').join("") +
      '</tbody></table></div></details>';
  }
  function drawControle() {
    const d = MC.data, items = (d && d.items) || [];
    page.innerHTML = top() + viewsNav() + '<div class="tools"><span class="quiet fs-13 ws-normal">Bestellingen per e-mail die het systeem niet zelf mocht aanmaken. Prijzen en leverregels berekent de server.</span><span class="spacer"></span><button type="button" class="tool" id="mcReload">' + K.icon("refresh") + 'Vernieuwen</button></div>' +
      '<div class="content pt-4 stack-14">' + (MC.err ? K.c.error(MC.err) : !d ? K.c.skeleton(2) : items.length ? items.map(mcItem).join("") : K.c.empty("Niets te controleren", "Bestellingen per e-mail die het systeem niet zeker kon lezen, verschijnen hier.")) + mcDone((d && d.afgehandeld) || []) + '</div>';
    page.querySelector("#mcReload").onclick = () => { MC.edits = {}; MC.data = null; render(); loadControle(); };
  }
  const mcSet = t => { const ed = MC.edits[t.dataset.id]; if (!ed) return; const f = t.dataset.mc; if (t.dataset.i != null) { const l = ed.lines[Number(t.dataset.i)]; if (l) l[f] = t.value; } else ed[f] = t.value; };
  K.on(page, "input", "[data-mc]", (e, t) => mcSet(t));
  K.on(page, "change", "[data-mc]", (e, t) => { mcSet(t); if (t.dataset.mc === "productId") render(); });
  page.addEventListener("toggle", e => { const el = e.target; if (el && el.dataset && el.dataset.mcopen) { if (el.open) MC.open.add(el.dataset.mcopen); else MC.open.delete(el.dataset.mcopen); } }, true);
  K.on(page, "click", "[data-mc-add]", (e, t) => { const id = t.dataset.mcAdd, ed = MC.edits[id]; ed.lines.push(mcBlank()); render(); const n = page.querySelector("#mcP-" + id + "-" + (ed.lines.length - 1)); if (n) n.focus(); });
  K.on(page, "click", "[data-mc-del]", (e, t) => { const id = t.dataset.mcDel, ed = MC.edits[id]; ed.lines.splice(Number(t.dataset.i), 1); if (!ed.lines.length) ed.lines.push(mcBlank()); render(); const n = page.querySelector("#mcP-" + id + "-0"); if (n) n.focus(); });
  const mcAfter = async () => { S.dirty = true; try { await S.load(true); } catch (err) { /* lijst volgt later */ } await loadControle(); };
  K.on(page, "click", "[data-mc-create]", async (e, t) => {
    const id = t.dataset.mcCreate, ed = MC.edits[id], box = page.querySelector("#mcErr-" + id);
    box.innerHTML = "";
    const lines = ed.lines.filter(l => l.productId || String(l.qty).trim()).map(l => ({ productId: l.productId, qty: K.parseNum(l.qty), comment: l.comment }));
    const local = !ed.clientId ? "Kies eerst de klant." : !lines.length ? "Voeg minstens één artikel toe." : lines.some(l => !l.productId) ? "Kies voor elke regel een artikel." : lines.some(l => !(l.qty > 0)) ? "Vul voor elke regel een hoeveelheid in." : "";
    if (local) { box.innerHTML = K.c.error(local); return; }
    K.busy(t, true, "Aanmaken…");
    try {
      const d = await K.api("/api/mailcontrole", { json: { action: "create", id, clientId: ed.clientId, lines, dateLivraison: ed.day, notes: ed.notes } });
      delete MC.edits[id];
      K.toast("Bestelling " + d.ref + " aangemaakt", { action: "Openen", onAction: () => { location.href = "/team/bestelling?id=" + encodeURIComponent(d.id); } });
      await mcAfter();
    } catch (err) {
      // 409 : al behandeld of de bestelling bestond al (het bericht is dan afgesloten) → lijst opnieuw laden.
      if (err.status === 409) { K.toast(err.message); delete MC.edits[id]; await mcAfter(); return; }
      box.innerHTML = K.c.error(err.message); K.busy(t, false);
    }
  });
  K.on(page, "click", "[data-mc-read]", async (e, t) => {
    const id = t.dataset.mcRead, ed = MC.edits[id], box = page.querySelector("#mcErr-" + id);
    box.innerHTML = "";
    if (!ed.clientId) { box.innerHTML = K.c.error("Kies eerst de klant: het voorstel gebruikt zijn catalogus."); return; }
    K.busy(t, true, "Lezen…");
    try { await K.api("/api/mailcontrole", { json: { action: "analyse", id, clientId: ed.clientId } }); delete MC.edits[id]; K.toast("Opnieuw gelezen: controleer het voorstel"); await loadControle(); }
    catch (err) { box.innerHTML = K.c.error(err.message); K.busy(t, false); }
  });
  K.on(page, "click", "[data-mc-ignore]", async (e, t) => {
    const id = t.dataset.mcIgnore;
    const reden = await K.prompt({ title: "Bericht negeren?", text: "Er komt geen bestelling en de klant krijgt geen bericht. Waarom? (komt in het journaal)", placeholder: "bv. reclame, dubbel, al telefonisch ingevoerd", yes: "Negeren" });
    if (reden == null) return;
    if (reden.trim().length < 3) { K.toast("Geef een reden op (minstens 3 tekens).", { kind: "err" }); return; }
    try { await K.api("/api/mailcontrole", { json: { action: "ignore", id, reden: reden.trim() } }); delete MC.edits[id]; K.toast("Bericht genegeerd"); await loadControle(); }
    catch (err) { K.toast(err.message, { kind: "err" }); if (err.status === 409) await loadControle(); }
  });
  S.onMailIds = () => { if (view !== "controle") render(); };
  const selected = () => S.orders.filter(o => sel.has(o.id));
  function bulkBar() {
    if (!sel.size) return "";
    const list = selected(), unpaid = list.filter(o => o.statut === "Facturée" && o.paiement !== "Payé").length;
    return '<div class="bulk"><b>' + sel.size + '</b> geselecteerd<button type="button" class="btn btn-sm btn-light" data-bulk="picking">Verzamellijst</button><button type="button" class="btn btn-sm btn-glass" data-bulk="delivery">Leveringsbonnen</button>' + (unpaid ? '<button type="button" class="btn btn-sm btn-glass" data-bulk="paid">Markeer betaald (' + unpaid + ')</button>' : "") + '<button type="button" class="btn btn-sm btn-glass" data-bulk="csv">Exporteren (CSV)</button><button type="button" class="ibtn t-white" data-bulk="clear" aria-label="Selectie wissen">' + K.icon("x") + '</button></div>';
  }
  // G-03 / CLA-10 : chaque re-rendu garde le focus (filtre, case, tri, action) ; K.keep le retrouve par ses clés.
  function render() { return K.keep(page, draw); }
  function draw() {
    if (view === "controle") return drawControle();
    saveFilter();
    const list = filtered();
    page.innerHTML = header() + '<div class="content pt-4">' + (view === "bord" ? bord(list) : view === "kalender" ? kalender(list) : tabel(list)) + '</div>' + bulkBar();
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
  K.on(page, "click", "tr[data-open]", (e, t) => { if (e.target.closest("button,a")) return; location.href = "/team/bestelling?id=" + encodeURIComponent(t.dataset.open); });
  K.on(page, "click", "[data-bulk]", async (e, t) => {
    const list = selected();
    if (t.dataset.bulk === "clear") { sel.clear(); render(); return; }
    if (t.dataset.bulk === "picking") S.openPicking(list, list.length + " bestellingen");
    if (t.dataset.bulk === "delivery") S.openDocs(list, "delivery");
    if (t.dataset.bulk === "csv") S.csvDownload([["Referentie", "Levering", "Klant", "Status", "Betaling", "Totaal excl. btw", "Factuur", "Creditnota", "Artikelen"]].concat(list.map(o => [o.ref, o.day, o.client, K.status(o.statut), K.pay(o.paiement), K.num(o.total), o.factuurnummer || "", S.cns(o).map(cn => cn.nummer).join(", "), S.lineTxt(o)])), "famo-bestellingen-" + K.today() + ".csv");
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
  K.on(page, "click", "[data-sort]", (e, t) => { e.stopPropagation(); const k = t.dataset.sort; sort = sort.key !== k ? { key: k, dir: 1 } : sort.dir > 0 ? { key: k, dir: -1 } : { key: "", dir: 1 }; render(); const b = page.querySelector('[data-sort="' + k + '"]'); if (b) b.focus(); });
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
  window.addEventListener("hashchange", () => {
    const h = K.hashParams(); let again = false;
    if (h.path && h.path !== view) { view = h.path; if (view !== "controle") K.store.set("famoOrdersView", view); again = true; }
    if (h.params.status && h.params.status !== filter.status) { filter.status = h.params.status; again = true; } // lien d'un chiffre (INT-12)
    if (again) { render(); if (view === "controle") loadControle(); }
  });
  async function load(force, all) {
    try { await S.load(force, all); render(); }
    catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content pt-20">' + K.c.error(err.message, true) + '</div>'; K.on(page, "click", "[data-retry]", e => { e.preventDefault(); load(true); }); }
  }
  page.innerHTML = '<div class="page-h"><h1 class="h1">Bestellingen</h1></div><div class="content">' + K.c.skeleton(4) + '</div>';
  load(false, qs.get("all") === "1").then(() => { if (S.orders.length || S.loadedAt) S.autoRefresh(render); if (view === "controle") loadControle(); });
})();
