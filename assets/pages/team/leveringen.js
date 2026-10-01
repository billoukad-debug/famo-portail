(async function () {
  if (!(await K.requireStaff())) return;
  const page = K.shell({});
  let day = new URLSearchParams(location.search).get("dag") || K.today();
  // Route van de dag : eerst volgens « Volgorde levering » (▲▼), zonder volgorde achteraan op klantnaam ; afgewerkte stops onderaan.
  const vo = o => o.volgorde == null ? Infinity : o.volgorde;
  function list() { return S.orders.filter(o => o.day === day && (o.statut === "Prête" || o.statut === "Sortie en livraison" || (o.statut === "Facturée" && o.livreeLe && K.isoDay(o.livreeLe) === day))).sort((a, b) => (a.statut === "Facturée" ? 1 : 0) - (b.statut === "Facturée" ? 1 : 0) || vo(a) - vo(b) || a.client.localeCompare(b.client, "nl")); }
  function render() { return K.keep(page, draw); }
  // Weergave per toestel (A4) : « Lijst » (alle stops, volgorde) of « Chauffeur » (één stop tegelijk).
  // K.store = localStorage in try/catch : leeg of geblokkeerd → Lijst.
  const MODE_KEY = "famoLevMode";
  let mode = K.store.get(MODE_KEY, "lijst") === "chauffeur" ? "chauffeur" : "lijst";
  let cur = null; // stop die de chauffeur nu ziet (id)
  const stCell = o => o.statut === "Facturée" ? '<span class="cell-st c-done">Geleverd</span>' : o.statut === "Sortie en livraison" ? '<span class="cell-st c-road">Onderweg</span>' : '<span class="cell-st c-ready">Klaar</span>';
  function draw() {
    const rows = list(); const route = rows.filter(o => o.statut !== "Facturée"), ready = rows.filter(o => o.statut === "Prête");
    const late = S.orders.filter(o => o.late && o.statut !== "Facturée");
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Leveringen</h1><p class="sub">' + K.esc(K.dateLong(day)) + ' · ' + rows.length + ' stop' + (rows.length === 1 ? "" : "s") + '</p></div><span class="spacer"></span><div class="opt no-shrink" role="group" aria-label="Dag"><button type="button" data-day="' + K.today() + '"' + (day === K.today() ? ' class="on"' : "") + '>Vandaag</button><button type="button" data-day="' + K.addDays(K.today(), 1) + '"' + (day === K.addDays(K.today(), 1) ? ' class="on"' : "") + '>Morgen</button><input type="date" class="input" id="pickDay" aria-label="Kies een dag" value="' + day + '" style="width:auto;min-height:44px"></div><div class="opt no-shrink" role="group" aria-label="Weergave">' + [["lijst", "Lijst"], ["chauffeur", "Chauffeur"]].map(([m, l]) => '<button type="button" data-mode="' + m + '"' + (mode === m ? ' class="on"' : "") + '>' + l + '</button>').join("") + '</div>' + (ready.length ? '<button type="button" class="btn btn-p btn-sm" id="departAll">Ronde vertrekt (' + ready.length + ')</button>' : "") + '</div>' +
      '<div class="content" style="padding-top:14px">' +
      (late.length ? K.c.warn("<b>" + late.length + " bestelling" + (late.length === 1 ? "" : "en") + " te laat</b> — " + late.map(o => '<a href="/team/bestelling?id=' + encodeURIComponent(o.id) + '">' + K.esc(o.client) + '</a>').join(", ")) : "") +
      (mode === "chauffeur" ? driverHtml(rows) : '<div class="card" data-route-list><div class="card-h"><div><h2 class="h2">Stops</h2><p class="sub">Sleep een stop of gebruik ▲▼ · afgewerkte stops onderaan</p></div><button type="button" class="btn btn-o btn-sm" id="bons">' + K.icon("print") + 'Alle leveringsbonnen</button></div>' +
      (rows.length ? rows.map((o, i) => { const adr = (o.klant && o.klant.adresse || "").replace(/\n/g, ", "), t = S.totals(o), ri = route.indexOf(o); return '<div class="stop"' + (ri >= 0 ? ' data-route="' + o.id + '"' : "") + '>' + (ri >= 0 ? '<span class="grip" aria-hidden="true" title="Sleep om de volgorde te wijzigen">' + K.icon("grip") + '</span>' : "") + '<span class="no">' + (i + 1) + '</span>' + (ri >= 0 ? '<div class="mv" style="display:flex;gap:2px;flex:none"><button type="button" class="ibtn" data-move="-1" data-id="' + o.id + '" aria-label="Eerder in de route"' + (ri === 0 ? " disabled" : "") + ' style="width:40px;height:44px">▲</button><button type="button" class="ibtn" data-move="1" data-id="' + o.id + '" aria-label="Later in de route"' + (ri === route.length - 1 ? " disabled" : "") + ' style="width:40px;height:44px">▼</button></div>' : "") + '<div class="grow"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + K.esc(o.client) + '</b>' + (o.paiement !== "Payé" && o.statut !== "Facturée" ? '<span class="tag">te innen ' + K.eur(t.incl) + ' incl. btw</span>' : "") + S.uitzTag(o) + S.slotTag(o) + '</div>' + S.noteLine(o) + '<div class="quiet" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(adr || "adres onbekend") + (o.klant && o.klant.tel ? ' · ' + K.esc(o.klant.tel) : "") + ' · ' + K.esc(S.lineTxt(o)) + '</div></div>' + stCell(o) + '<div class="stop-acts">' + (adr ? '<a class="btn btn-o btn-sm" target="_blank" rel="noopener" href="https://maps.google.com/?q=' + encodeURIComponent(adr) + '">' + K.icon("map") + 'Kaart</a>' : "") + S.telLink(o.klant && o.klant.tel) + '<button type="button" class="btn btn-o btn-sm" data-act="delivery" data-id="' + o.id + '">Bon</button>' + (o.statut === "Facturée" ? '<button type="button" class="btn btn-o btn-sm" data-act="invoice" data-id="' + o.id + '">Factuur</button>' : S.slotBtn(o) + S.correctBtn(o) + S.nextAction(o)) + '</div></div>'; }).join("") : '<div class="empty m-12">Geen leveringen voor ' + K.esc(K.relDay(day).toLowerCase()) + '. Zet bestellingen klaar in het Magazijn.</div>') +
      '<div class="card-b quiet" style="font-size:12.5px;border-top:1px solid var(--line)">Uitzondering onderweg (afwezig, geweigerd, gedeeltelijk, beschadigd)? Noteer het bij de ontvangstbevestiging. Per ongeluk op Vertrekt gedrukt? „Corrigeren” zet de stop terug op Klaar. De volgorde (▲▼) wordt bewaard bij de bestelling.</div></div>') + '</div>';
    K.$$("[data-day]", page).forEach(b => { b.onclick = () => { day = b.dataset.day; render(); }; });
    page.querySelector("#pickDay").onchange = e => { if (e.target.value) { day = e.target.value; render(); } };
    const bons = page.querySelector("#bons"); if (bons) bons.onclick = () => { const r = list().filter(o => o.statut !== "Facturée"); if (!r.length) { K.toast("Geen bonnen voor deze dag."); return; } S.openDocs(r, "delivery"); };
    const da = page.querySelector("#departAll"); if (da) da.onclick = async () => {
      if (!(await K.confirm({ title: ready.length + " bestellingen vertrekken?", text: "Alles wat klaar staat gaat op Onderweg." + (S.config && S.config.voorraadAfboeken ? " De voorraad wordt afgeboekt." : ""), yes: "Vertrekken" }))) return;
      let ok = 0; for (const o of ready) { try { await K.api("/api/updateorder", { json: { id: o.id, statut: "Sortie en livraison" } }); ok++; } catch (err) { K.toast(o.client + ": " + err.message, { kind: "err", ms: 8000 }); } }
      try { await S.load(true); } catch (err) { K.toast(err.message, { kind: "err" }); } render(); K.toast(ok + " van " + ready.length + " onderweg");
    };
  }
  // --- chauffeur ---
  // Eén stop tegelijk in de volgorde van de route (A4). De hoofdactie is die van de lijst (data-act :
  // Vertrekt, Ontvangst bevestigen met foto/handtekening, wachtrij zonder netwerk) : geen eigen serverlogica.
  const queued = o => !!(S.queue && S.queue.has(o.id));
  const isDone = o => K.ronde.done(o, queued(o));
  function driverHtml(rows) {
    const route = K.ronde.order(rows);
    if (!route.length) return '<div class="card">' + K.c.empty("Geen leveringen voor " + K.relDay(day).toLowerCase(), "Zet bestellingen klaar in het Magazijn.") + '</div>';
    if (!route.some(o => o.id === cur)) cur = K.ronde.next(route, null, isDone) || route[route.length - 1].id;
    const i = route.findIndex(o => o.id === cur), o = route[i], done = isDone(o), nDone = route.filter(isDone).length;
    const nextId = K.ronde.next(route, o.id, isDone), t = S.totals(o), kl = o.klant || {};
    const adr = String(kl.adresse || "").trim(), lines = K.parseLines(o.lignes);
    const state = o.statut === "Facturée" ? K.c.ok("<b>Geleverd</b>" + (o.receptionnePar ? " · ontvangen door " + K.esc(o.receptionnePar) : ""))
      : queued(o) ? K.c.warn("<b>In wachtrij</b> · wordt verstuurd zodra er netwerk is.")
      : done ? K.c.warn("<b>Niet geleverd: " + K.esc(o.uitzondering) + "</b>" + (o.uitzonderingNota ? " · " + K.esc(o.uitzonderingNota) : "") + " · gaat terug naar het magazijn.") : "";
    const main = done ? (nextId ? '<button type="button" class="btn btn-p btn-lg drv-main" id="drvNext" data-drv="next" data-id="' + o.id + '">Volgende stop</button>'
        : K.c.ok("<b>Ronde afgewerkt</b> · " + nDone + " van " + route.length + " stops afgehandeld.") + '<button type="button" class="btn btn-p btn-lg drv-main" data-mode="lijst" data-id="' + o.id + '">Naar de lijst</button>')
      : o.statut === "Prête" ? '<button type="button" class="btn btn-p btn-lg drv-main" data-act="depart" data-id="' + o.id + '">Vertrekt</button>'
      : '<button type="button" class="btn btn-p btn-lg drv-main" data-act="deliver" data-id="' + o.id + '">' + K.icon("camera") + 'Ontvangst bevestigen</button>';
    return '<section class="card drv" aria-labelledby="drvTitle">' +
      '<div class="drv-top"><span class="drv-count">Stop ' + (i + 1) + ' van ' + route.length + '</span><span class="quiet">' + nDone + ' afgehandeld</span><span class="spacer"></span>' + stCell(o) + '</div>' +
      '<progress class="drv-prog" max="' + route.length + '" value="' + nDone + '" aria-label="' + nDone + ' van ' + route.length + ' stops afgehandeld"></progress>' +
      '<div class="card-b drv-b">' +
        '<h2 class="drv-name" id="drvTitle" tabindex="-1">' + K.esc(o.client) + '</h2>' +
        '<div class="drv-tags">' + (o.statut !== "Facturée" && o.paiement !== "Payé" ? '<span class="tag">te innen ' + K.eur(t.incl) + ' incl. btw</span>' : "") + S.slotTag(o) + S.uitzTag(o) + '<span class="tag mono">' + K.esc(o.ref) + '</span></div>' +
        state +
        '<div class="drv-adr"><p class="ws-pre">' + K.esc(adr || "Adres onbekend") + '</p>' + (adr ? '<a class="btn btn-o" target="_blank" rel="noopener" href="https://maps.google.com/?q=' + encodeURIComponent(adr.replace(/\n/g, ", ")) + '">' + K.icon("map") + 'Kaart</a>' : "") + S.telLink(kl.tel, kl.tel) + '</div>' +
        (o.notes ? '<div class="drv-note"><b>Nota</b> ' + K.esc(o.notes) + '</div>' : "") +
        '<h3 class="sec">Af te geven</h3><ul class="drv-lines">' + lines.map(l => '<li><b class="mono">' + K.esc(K.qty(l.qty) + (l.unit ? " " + K.unit(l.unit) : "")) + '</b><span>' + K.esc(l.name) + (l.comment ? ' <span class="quiet">(' + K.esc(l.comment) + ')</span>' : "") + '</span></li>').join("") + '</ul>' +
      '</div>' +
      '<div class="drv-acts">' + main + (!done && nextId ? '<button type="button" class="btn btn-o" id="drvSkip" data-drv="next">Volgende stop</button>' : "") + '</div>' +
      '<div class="drv-nav">' + (i > 0 ? '<button type="button" class="btn btn-ghost" id="drvPrev" data-drv="prev">Vorige stop</button>' : "") + '<button type="button" class="btn btn-ghost" data-act="delivery" data-id="' + o.id + '">' + K.icon("print") + 'Leveringsbon</button>' + (o.statut !== "Facturée" ? S.slotBtn(o, "Leveruur") : "") + '<span class="spacer"></span><button type="button" class="btn btn-ghost" id="drvList" data-mode="lijst">Naar de lijst</button></div>' +
    '</section>';
  }
  // Volgende / vorige stop : de focus gaat naar de naam van de nieuwe stop (de schermlezer leest hem voor).
  K.on(page, "click", "[data-drv]", (e, t) => {
    const route = K.ronde.order(list()), i = route.findIndex(o => o.id === cur);
    const to = t.dataset.drv === "prev" ? (route[i - 1] || {}).id : K.ronde.next(route, cur, isDone);
    if (!to) return;
    cur = to; render();
    const sec = page.querySelector(".drv"), h = page.querySelector("#drvTitle");
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: "start" });
    if (h) { try { h.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
  });
  K.on(page, "click", "[data-mode]", (e, t) => {
    if (t.dataset.mode === mode) return;
    mode = t.dataset.mode === "chauffeur" ? "chauffeur" : "lijst"; K.store.set(MODE_KEY, mode); render();
  });
  // Nieuwe volgorde bewaren : hernummer 1..n en bewaar enkel wat veranderde (één PATCH per stop, 3 tegelijk).
  async function saveRoute(route) {
    K.$$("[data-move]", page).forEach(b => { b.disabled = true; });
    const changed = route.map((o, n) => ({ o, n: n + 1 })).filter(x => x.o.volgorde !== x.n);
    const res = await K.pool(changed, 3, x => K.api("/api/updateorder", { json: { id: x.o.id, volgorde: x.n } }).then(() => { x.o.volgorde = x.n; }));
    const bad = res.find(r => !r.ok); const fail = bad ? bad.item.o.client + ": " + bad.error.message : "";
    if (fail) K.toast(fail, { kind: "err" }); else if (changed.length) K.toast("Volgorde bewaard");
    try { await S.load(true); } catch (err) { K.toast(err.message, { kind: "err" }); }
    render();
  }
  // ▲▼ : één plaats op of neer (toetsenbord, schermlezer).
  K.on(page, "click", "[data-move]", async (e, t) => {
    const route = list().filter(o => o.statut !== "Facturée"), i = route.findIndex(o => o.id === t.dataset.id), j = i + Number(t.dataset.move);
    if (i < 0 || j < 0 || j >= route.length) return;
    [route[i], route[j]] = [route[j], route[i]];
    await saveRoute(route);
  });
  // Slepen : de volgorde van de stops in het scherm wordt de route.
  K.sortable(page, { items: ".stop[data-route]", zones: "[data-route-list]", onDrop: ({ to }) => {
    const ids = K.$$(".stop[data-route]", to).map(el => el.dataset.route);
    const route = ids.map(id => S.byId(id)).filter(Boolean);
    saveRoute(route);
    return true;
  } });
  S.bindActions(page, render);
  page.innerHTML = '<div class="page-h"><h1 class="h1">Leveringen</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  async function first(force) {
    try { await S.load(force); render(); return true; }
    catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content pt-20">' + K.c.error(err.message, true) + '</div>'; return false; }
  }
  K.on(page, "click", "[data-retry]", async e => { e.preventDefault(); if (await first(true)) S.autoRefresh(render); });
  if (await first()) S.autoRefresh(render);
})();
