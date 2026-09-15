(async function () {
  if (!(await K.requireStaff())) return;
  const page = K.shell({});
  let type = K.hashParams().path || "alle", client = new URLSearchParams(location.search).get("klant") || "", q = "";
  function docs() {
    const out = [];
    S.orders.forEach(o => {
      if (o.statut === "Sortie en livraison" || o.statut === "Facturée") out.push({ kind: "delivery", number: "LB-" + o.ref.replace(/^CMD-/, ""), o, date: o.livreeLe || o.day, state: o.statut === "Facturée" ? "Geleverd" : "Onderweg" });
      if (o.statut === "Facturée") out.push({ kind: "invoice", number: o.factuurnummer || "—", o, date: o.factureeLe || o.livreeLe || o.day, state: o.paiement === "Payé" ? "Betaald" : "Openstaand" });
    });
    return out.filter(d => (type === "alle" || (type === "facturen" && d.kind === "invoice") || (type === "bonnen" && d.kind === "delivery") || (type === "open" && d.kind === "invoice" && d.state === "Openstaand")) && (!client || d.o.client === client) && (!q || (d.number + " " + d.o.ref + " " + d.o.client).toLowerCase().includes(q))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  function render() {
    const list = docs(); const c = S.counts();
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Documenten</h1><p class="sub">Facturen en leveringsbonnen</p></div><span class="spacer"></span>' + K.c.kpi(K.eur(c.unpaidSum), "openstaand") + K.c.kpi(c.unpaid, "onbetaalde facturen", c.unpaid > 0) + '</div>' +
      '<div class="views">' + [["alle", "Alle"], ["facturen", "Facturen"], ["bonnen", "Leveringsbonnen"], ["open", "Openstaand"]].map(([k, l]) => '<a href="#/' + k + '"' + (type === k ? ' class="on"' : "") + '>' + l + '</a>').join("") + '</div>' +
      '<div class="tools"><label class="search" style="max-width:280px">' + K.icon("search") + '<input id="q" placeholder="Nummer, bestelling of klant…" value="' + K.esc(q) + '"></label><select class="input tool" id="fClient" style="width:auto;min-height:36px;padding:0 8px"><option value="">Alle klanten</option>' + Array.from(new Set(S.orders.map(o => o.client))).sort().map(x => '<option' + (x === client ? " selected" : "") + '>' + K.esc(x) + '</option>').join("") + '</select><span class="spacer"></span><span class="muted">' + list.length + ' document' + (list.length === 1 ? "" : "en") + '</span></div>' +
      '<div class="content"><div class="grp"><div class="tblwrap"><table class="tbl"><thead><tr><th>Document</th><th>Klant</th><th>Bestelling</th><th>Datum</th><th>Status</th><th class="num">Bedrag</th><th></th></tr></thead><tbody>' + (list.length ? list.map(d => '<tr><td><b>' + K.esc(d.number) + '</b><div class="quiet" style="font-size:11px">' + (d.kind === "invoice" ? "Factuur" : "Leveringsbon") + '</div></td><td>' + K.esc(d.o.client) + '</td><td class="mono">' + K.esc(d.o.ref) + '</td><td>' + K.esc(K.date(K.isoDay(d.date))) + '</td><td style="width:130px">' + (d.kind === "invoice" ? (d.state === "Betaald" ? '<span class="cell-st c-done">Betaald</span>' : '<span class="cell-st c-open">Openstaand</span>') : (d.state === "Geleverd" ? '<span class="cell-st c-done">Geleverd</span>' : '<span class="cell-st c-road">Onderweg</span>')) + '</td><td class="num mono">' + K.eur(d.o.total) + '</td><td style="text-align:right;white-space:nowrap"><button type="button" class="btn btn-o btn-sm" data-act="' + d.kind + '" data-id="' + d.o.id + '">Openen / PDF</button>' + (d.kind === "invoice" && d.state !== "Betaald" ? ' <button type="button" class="btn btn-o btn-sm" data-act="paid" data-id="' + d.o.id + '">Betaald</button>' : "") + '</td></tr>').join("") : '<tr><td colspan="7" class="wrap" style="height:auto">' + K.c.empty("Geen documenten", "Leveringsbonnen verschijnen bij vertrek, facturen bij levering.") + '</td></tr>') + '</tbody></table></div></div>' +
      '<p class="quiet" style="font-size:12.5px">Facturen zijn interne documenten (PDF of print). Automatische verzending naar de boekhouding komt later.</p></div>';
    const qi = page.querySelector("#q"); qi.addEventListener("input", () => { q = qi.value.toLowerCase(); const pos = qi.selectionStart; render(); const n = page.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); });
    page.querySelector("#fClient").onchange = e => { client = e.target.value; render(); };
  }
  S.bindActions(page, render);
  window.addEventListener("hashchange", () => { type = K.hashParams().path || "alle"; render(); });
  page.innerHTML = '<div class="page-h"><h1 class="h1">Documenten</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  try { await S.load(); render(); } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message) + '</div>'; }
})();
