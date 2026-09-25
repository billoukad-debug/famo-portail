(async function () {
  if (!(await K.requireStaff())) return;
  const page = K.shell({});
  let day = new URLSearchParams(location.search).get("dag") || K.today();
  // Route van de dag : eerst volgens « Volgorde levering » (▲▼), zonder volgorde achteraan op klantnaam ; afgewerkte stops onderaan.
  const vo = o => o.volgorde == null ? Infinity : o.volgorde;
  function list() { return S.orders.filter(o => o.day === day && (o.statut === "Prête" || o.statut === "Sortie en livraison" || (o.statut === "Facturée" && o.livreeLe && K.isoDay(o.livreeLe) === day))).sort((a, b) => (a.statut === "Facturée" ? 1 : 0) - (b.statut === "Facturée" ? 1 : 0) || vo(a) - vo(b) || a.client.localeCompare(b.client, "nl")); }
  function render() {
    const rows = list(); const route = rows.filter(o => o.statut !== "Facturée"), ready = rows.filter(o => o.statut === "Prête");
    const late = S.orders.filter(o => o.late && o.statut !== "Facturée");
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Leveringen</h1><p class="sub">' + K.esc(K.dateLong(day)) + ' · ' + rows.length + ' stop' + (rows.length === 1 ? "" : "s") + '</p></div><span class="spacer"></span><div class="opt" style="flex:0 0 auto"><button type="button" data-day="' + K.today() + '"' + (day === K.today() ? ' class="on"' : "") + '>Vandaag</button><button type="button" data-day="' + K.addDays(K.today(), 1) + '"' + (day === K.addDays(K.today(), 1) ? ' class="on"' : "") + '>Morgen</button><input type="date" class="input" id="pickDay" aria-label="Kies een dag" value="' + day + '" style="width:auto;min-height:44px"></div>' + (ready.length ? '<button type="button" class="btn btn-p btn-sm" id="departAll">Ronde vertrekt (' + ready.length + ')</button>' : "") + '</div>' +
      '<div class="content" style="padding-top:14px">' +
      (late.length ? K.c.warn("<b>" + late.length + " bestelling" + (late.length === 1 ? "" : "en") + " te laat</b> — " + late.map(o => '<a href="/order.html?id=' + encodeURIComponent(o.id) + '">' + K.esc(o.client) + '</a>').join(", ")) : "") +
      '<div class="card"><div class="card-h"><div><h2 class="h2">Stops</h2><p class="sub">Route met ▲▼ · afgewerkte stops onderaan</p></div><button type="button" class="btn btn-o btn-sm" id="bons">' + K.icon("print") + 'Alle leveringsbonnen</button></div>' +
      (rows.length ? rows.map((o, i) => { const adr = (o.klant && o.klant.adresse || "").replace(/\n/g, ", "), t = S.totals(o), ri = route.indexOf(o); return '<div class="stop"><span class="no">' + (i + 1) + '</span>' + (ri >= 0 ? '<div style="display:flex;gap:2px;flex:none"><button type="button" class="ibtn" data-move="-1" data-id="' + o.id + '" aria-label="Eerder in de route"' + (ri === 0 ? " disabled" : "") + ' style="width:40px;height:44px">▲</button><button type="button" class="ibtn" data-move="1" data-id="' + o.id + '" aria-label="Later in de route"' + (ri === route.length - 1 ? " disabled" : "") + ' style="width:40px;height:44px">▼</button></div>' : "") + '<div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + K.esc(o.client) + '</b>' + (o.paiement !== "Payé" && o.statut !== "Facturée" ? '<span class="tag">te innen ' + K.eur(t.incl) + ' incl. btw</span>' : "") + (o.notes ? '<span class="tag" title="' + K.esc(o.notes) + '">nota</span>' : "") + S.uitzTag(o) + '</div><div class="quiet" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(adr || "adres onbekend") + (o.klant && o.klant.tel ? ' · ' + K.esc(o.klant.tel) : "") + ' · ' + K.esc(S.lineTxt(o)) + '</div></div>' + (o.statut === "Facturée" ? '<span class="cell-st c-done">Geleverd</span>' : o.statut === "Sortie en livraison" ? '<span class="cell-st c-road">Onderweg</span>' : '<span class="cell-st c-ready">Klaar</span>') + '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' + (adr ? '<a class="btn btn-o btn-sm" target="_blank" rel="noopener" href="https://maps.google.com/?q=' + encodeURIComponent(adr) + '">' + K.icon("map") + 'Kaart</a>' : "") + S.telLink(o.klant && o.klant.tel) + '<button type="button" class="btn btn-o btn-sm" data-act="delivery" data-id="' + o.id + '">Bon</button>' + (o.statut === "Facturée" ? '<button type="button" class="btn btn-o btn-sm" data-act="invoice" data-id="' + o.id + '">Factuur</button>' : S.correctBtn(o) + S.nextAction(o)) + '</div></div>'; }).join("") : '<div class="empty" style="margin:12px">Geen leveringen voor ' + K.esc(K.relDay(day).toLowerCase()) + '. Zet bestellingen klaar in het Magazijn.</div>') +
      '<div class="card-b quiet" style="font-size:12.5px;border-top:1px solid var(--line)">Uitzondering onderweg (afwezig, geweigerd, gedeeltelijk, beschadigd)? Noteer het bij de ontvangstbevestiging. Per ongeluk op Vertrekt gedrukt? „Corrigeren” zet de stop terug op Klaar. De volgorde (▲▼) wordt bewaard bij de bestelling.</div></div></div>';
    K.$$("[data-day]", page).forEach(b => { b.onclick = () => { day = b.dataset.day; render(); }; });
    page.querySelector("#pickDay").onchange = e => { if (e.target.value) { day = e.target.value; render(); } };
    page.querySelector("#bons").onclick = () => { const r = list().filter(o => o.statut !== "Facturée"); if (!r.length) { K.toast("Geen bonnen voor deze dag."); return; } S.openDocs(r, "delivery"); };
    const da = page.querySelector("#departAll"); if (da) da.onclick = async () => {
      if (!(await K.confirm({ title: ready.length + " bestellingen vertrekken?", text: "Alles wat klaar staat gaat op Onderweg." + (S.config && S.config.voorraadAfboeken ? " De voorraad wordt afgeboekt." : ""), yes: "Vertrekken" }))) return;
      let ok = 0; for (const o of ready) { try { await K.api("/api/updateorder", { json: { id: o.id, statut: "Sortie en livraison" } }); ok++; } catch (err) { K.toast(o.client + ": " + err.message, { kind: "err", ms: 8000 }); } }
      try { await S.load(true); } catch (err) { K.toast(err.message, { kind: "err" }); } render(); K.toast(ok + " van " + ready.length + " onderweg");
    };
  }
  // ▲▼ : verplaats in de route, hernummer 1..n en bewaar enkel wat veranderde (één PATCH per stop).
  K.on(page, "click", "[data-move]", async (e, t) => {
    const route = list().filter(o => o.statut !== "Facturée"), i = route.findIndex(o => o.id === t.dataset.id), j = i + Number(t.dataset.move);
    if (i < 0 || j < 0 || j >= route.length) return;
    [route[i], route[j]] = [route[j], route[i]];
    K.$$("[data-move]", page).forEach(b => { b.disabled = true; });
    const changed = route.map((o, n) => ({ o, n: n + 1 })).filter(x => x.o.volgorde !== x.n);
    let fail = "";
    for (const x of changed) { try { await K.api("/api/updateorder", { json: { id: x.o.id, volgorde: x.n } }); x.o.volgorde = x.n; } catch (err) { fail = x.o.client + ": " + err.message; break; } }
    if (fail) K.toast(fail, { kind: "err" });
    try { await S.load(true); } catch (err) { K.toast(err.message, { kind: "err" }); }
    render();
  });
  S.bindActions(page, render);
  page.innerHTML = '<div class="page-h"><h1 class="h1">Leveringen</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  try { await S.load(); render(); } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message) + '</div>'; }
})();
