(async function () {
  if (!(await K.requireStaff())) return;
  const page = K.shell({});
  const P = K.hashParams(); const qs = new URLSearchParams(location.search);
  let view = qs.get("view") === "dag" ? "dag" : (P.path || K.store.get("famoMagView", "dag"));
  // Le jour choisi n'est retenu que pour la journée : réouvert demain, on repart sur « morgen ».
  const savedDay = K.store.get("famoMagDay", null);
  let day = qs.get("dag") || (savedDay && savedDay.on === K.today() ? savedDay.day : "") || K.addDays(K.today(), 1);
  const rememberDay = d => K.store.set("famoMagDay", { day: d, on: K.today() });
  const focusId = qs.get("id");
  function dayOrders() { return S.orders.filter(o => o.day === day && !K.isClosed(o)); }
  function header() {
    const list = dayOrders(); const prep = list.filter(o => o.statut === "Reçue").length;
    return '<div class="page-h"><div><h1 class="h1">Magazijn</h1><p class="sub">' + K.esc(K.dateLong(day)) + ' · ' + list.length + ' bestelling' + (list.length === 1 ? "" : "en") + ' · ' + prep + ' te bereiden</p></div><span class="spacer"></span>' +
      '<div class="opt" style="flex:0 0 auto"><button type="button" data-day="' + K.today() + '"' + (day === K.today() ? ' class="on"' : "") + '>Vandaag</button><button type="button" data-day="' + K.addDays(K.today(), 1) + '"' + (day === K.addDays(K.today(), 1) ? ' class="on"' : "") + '>Morgen</button><input type="date" class="input" id="pickDay" aria-label="Kies een dag" value="' + day + '" style="width:auto;min-height:44px"></div>' +
      '<button type="button" class="btn btn-o btn-sm" id="print">' + K.icon("print") + 'Verzamellijst</button></div>' +
      '<div class="views"><a href="#/dag"' + (view === "dag" ? ' class="on"' : "") + '>' + K.icon("table") + 'Dag</a><a href="#/bord"' + (view === "bord" ? ' class="on"' : "") + '>' + K.icon("board") + 'Bord</a></div>';
  }
  function verzamel(list) {
    const agg = new Map();
    list.forEach(o => K.parseLines(o.lignes).forEach(l => { const k = l.name.toLowerCase() + "|" + l.unit; const a = agg.get(k) || { name: l.name, unit: l.unit, qty: 0, n: 0 }; a.qty += l.qty; a.n++; agg.set(k, a); }));
    const rows = Array.from(agg.values()).sort((a, b) => a.name.localeCompare(b.name, "nl"));
    const done = K.store.get("famoPick:" + day, {});
    return '<div class="card"><div class="card-h"><div><h2 class="h2">Verzamellijst</h2><p class="sub">Per product, alle bestellingen van de dag samen</p></div><span class="quiet" style="font-size:12px" id="pickCount"></span></div>' + (rows.length ? rows.map(r => { const k = r.name.toLowerCase() + "|" + r.unit; return '<div class="line' + (done[k] ? " ok" : "") + '" style="grid-template-columns:44px minmax(0,1fr) auto">' + K.c.check(!!done[k], 'data-pick="' + K.esc(k) + '"', { big: true, label: "Verzameld: " + r.name }) + '<div><b>' + K.esc(r.name) + '</b><div class="quiet" style="font-size:12px">' + r.n + ' bestelling' + (r.n === 1 ? "" : "en") + '</div></div><b class="mono" style="font-size:16px;white-space:nowrap">' + K.esc(K.qty(r.qty) + " " + K.unit(r.unit)) + '</b></div>'; }).join("") : '<div class="empty" style="margin:12px">Geen artikelen voor deze dag.</div>') + '</div>';
  }
  function perOrder(list) {
    const sorted = list.slice().sort((a, b) => (a.statut === "Reçue" ? 0 : 1) - (b.statut === "Reçue" ? 0 : 1) || a.client.localeCompare(b.client, "nl"));
    return '<div class="card"><div class="card-h"><div><h2 class="h2">Bestellingen van de dag</h2><p class="sub">Valideer artikel per artikel, dan Klaarzetten</p></div>' + (list.some(o => o.statut === "Prête") ? '<button type="button" class="btn btn-o btn-sm" id="allDepart">Alles wat klaar is: vertrekt</button>' : "") + '</div>' + (S.config && !S.config.voorraadAfboeken ? '<div class="card-b quiet" style="font-size:12px;padding-top:6px;padding-bottom:6px;border-bottom:1px solid var(--line)">Voorraad wordt niet automatisch afgeboekt bij vertrek (instelling Beheer).</div>' : "") + (sorted.length ? sorted.map(o => '<div class="stop" id="o-' + o.id + '"' + (o.id === focusId ? ' style="background:var(--p-soft)"' : "") + '>' + K.c.avatar(o.client) + '<div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + K.esc(o.client) + '</b><span class="quiet mono" style="font-size:11px">' + K.esc(o.ref) + '</span>' + (o.notes ? '<span class="tag" title="' + K.esc(o.notes) + '">nota</span>' : "") + '</div><div class="quiet" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(S.lineTxt(o)) + '</div></div>' + K.stCell(o.statut) + '<div style="display:flex;gap:6px"><a class="btn btn-o btn-sm" href="/order.html?id=' + encodeURIComponent(o.id) + '">Open</a>' + S.correctBtn(o) + S.nextAction(o) + '</div></div>').join("") : '<div class="empty" style="margin:12px">Nog geen bestellingen voor ' + K.esc(K.relDay(day).toLowerCase()) + '. Klanten kunnen bestellen tot 22:00.</div>') + '</div>';
  }
  function bord() {
    const list = S.orders.filter(o => !K.isClosed(o));
    const cols = [["Reçue", "Ontvangen", "var(--st-new)"], ["Prête", "Klaar", "var(--st-ready)"], ["Sortie en livraison", "Onderweg", "var(--st-road)"]];
    return '<div class="board" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + cols.map(([st, label, color]) => { const rows = list.filter(o => o.statut === st).sort((a, b) => (a.day || "").localeCompare(b.day || "")); return '<div class="col"><div class="colh"><i style="background:' + color + '"></i>' + label + '<b>' + rows.length + '</b></div>' + (rows.length ? rows.map(o => S.orderCard(o).replace('</a>', '<div style="display:flex;gap:6px;margin-top:6px">' + S.nextAction(o) + '</div></a>')).join("") : '<div class="empty">Niets.</div>') + '</div>'; }).join("") + '</div>';
  }
  function render() {
    const list = dayOrders();
    page.innerHTML = header() + '<div class="content" style="padding-top:14px">' + (view === "bord" ? bord() : '<div id="two" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start">' + verzamel(list) + perOrder(list) + '</div>') + '</div>';
    if (window.innerWidth < 1000) { const t = page.querySelector("#two"); if (t) t.style.gridTemplateColumns = "1fr"; }
    K.$$("[data-day]", page).forEach(b => { b.onclick = () => { day = b.dataset.day; rememberDay(day); render(); }; });
    page.querySelector("#pickDay").onchange = e => { if (e.target.value) { day = e.target.value; rememberDay(day); render(); } };
    page.querySelector("#print").onclick = () => S.openPicking(list, K.dateLong(day));
    // Vertrek : de server beslist over de voorraad (Beheer → « Voorraad afboeken ») ; een 409 (al vertrokken, niet gevalideerd, voorraad te kort) komt per bestelling in een toast.
    const ad = page.querySelector("#allDepart"); if (ad) ad.onclick = async () => { const ready = list.filter(o => o.statut === "Prête"); if (!(await K.confirm({ title: ready.length + " bestellingen vertrekken?", text: "Ze gaan allemaal op Onderweg. Artikelen kunnen daarna niet meer gewijzigd worden." + (S.config && S.config.voorraadAfboeken ? " De voorraad wordt afgeboekt." : ""), yes: "Vertrekken" }))) return; let ok = 0; for (const o of ready) { try { await K.api("/api/updateorder", { json: { id: o.id, statut: "Sortie en livraison" } }); ok++; } catch (err) { K.toast(o.client + ": " + err.message, { kind: "err", ms: 8000 }); } } try { await S.load(true); } catch (err) { K.toast(err.message, { kind: "err" }); } render(); K.toast(ok + " van " + ready.length + " onderweg"); };
    const cnt = () => { const n = K.$$("[data-pick]", page).length, d = K.$$("[data-pick].on", page).length; const el = page.querySelector("#pickCount"); if (el) el.textContent = d + " van " + n + " verzameld"; }; cnt();
    K.on(page, "click", "[data-pick]", (e, t) => { const done = K.store.get("famoPick:" + day, {}); const k = t.dataset.pick; done[k] = !done[k]; K.store.set("famoPick:" + day, done); K.setOn(t, !!done[k]); cnt(); });
    const f = focusId && page.querySelector("#o-" + CSS.escape(focusId)); if (f) f.scrollIntoView({ block: "center" });
  }
  S.bindActions(page, render);
  window.addEventListener("hashchange", () => { const h = K.hashParams(); if (h.path && h.path !== view) { view = h.path; K.store.set("famoMagView", view); render(); } });
  page.innerHTML = '<div class="page-h"><h1 class="h1">Magazijn</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  async function first(force) {
    try { await S.load(force); render(); return true; }
    catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message, true) + '</div>'; return false; }
  }
  K.on(page, "click", "[data-retry]", async e => { e.preventDefault(); if (await first(true)) S.autoRefresh(render); });
  if (await first()) S.autoRefresh(render);
})();
