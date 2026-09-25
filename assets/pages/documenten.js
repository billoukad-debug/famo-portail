(async function () {
  if (!(await K.requireStaff())) return;
  const page = K.shell({});
  const qs = new URLSearchParams(location.search);
  let type = K.hashParams().path || "alle", client = qs.get("klant") || "", q = "", van = qs.get("van") || "", tot = qs.get("tot") || "";
  function docs() {
    const out = [];
    S.orders.forEach(o => {
      if (o.statut === "Sortie en livraison" || o.statut === "Facturée") out.push({ kind: "delivery", number: "LB-" + o.ref.replace(/^CMD-/, ""), o, date: o.livreeLe || o.day, state: o.statut === "Facturée" ? "Geleverd" : "Onderweg", amount: o.total });
      if (o.statut === "Facturée") out.push({ kind: "invoice", number: o.factuurnummer || "—", o, date: o.factureeLe || o.livreeLe || o.day, state: o.paiement === "Payé" ? "Betaald" : "Openstaand", amount: o.total });
      if (o.creditnota) out.push({ kind: "credit", number: o.creditnota.nummer, o, date: o.creditnota.le || o.factureeLe || o.day, state: "Creditnota", amount: -o.creditnota.montant });
    });
    return out.filter(d => (type === "alle" || (type === "facturen" && d.kind === "invoice") || (type === "bonnen" && d.kind === "delivery") || (type === "open" && d.kind === "invoice" && d.state === "Openstaand") || (type === "creditnotas" && d.kind === "credit"))
      && (!client || d.o.client === client) && (!van || K.isoDay(d.date) >= van) && (!tot || K.isoDay(d.date) <= tot)
      && (!q || (d.number + " " + d.o.ref + " " + d.o.client).toLowerCase().includes(q))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  const label = k => k === "invoice" ? "Factuur" : k === "credit" ? "Creditnota" : "Leveringsbon";
  function render() {
    const list = docs(); const c = S.counts(); const inv = list.filter(d => d.kind === "invoice");
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Documenten</h1><p class="sub">Facturen, creditnota\'s en leveringsbonnen</p></div><span class="spacer"></span>' + K.c.kpi(K.eur(c.unpaidSum), "openstaand") + K.c.kpi(c.unpaid, "onbetaalde facturen", c.unpaid > 0) + '</div>' +
      '<div class="views">' + [["alle", "Alle"], ["facturen", "Facturen"], ["bonnen", "Leveringsbonnen"], ["open", "Openstaand"], ["creditnotas", "Creditnota's"]].map(([k, l]) => '<a href="#/' + k + '"' + (type === k ? ' class="on"' : "") + '>' + l + '</a>').join("") + '</div>' +
      '<div class="tools"><label class="search" style="max-width:280px">' + K.icon("search") + '<input id="q" aria-label="Zoeken" placeholder="Nummer, bestelling of klant…" value="' + K.esc(q) + '"></label><select class="input tool" id="fClient" aria-label="Klant" style="width:auto;padding:0 8px"><option value="">Alle klanten</option>' + Array.from(new Set(S.orders.map(o => o.client))).sort((a, b) => a.localeCompare(b, "nl")).map(x => '<option' + (x === client ? " selected" : "") + '>' + K.esc(x) + '</option>').join("") + '</select>' +
      '<label class="quiet" style="font-size:12px;display:inline-flex;align-items:center;gap:4px">van <input type="date" class="input tool" id="fVan" aria-label="Van" value="' + K.esc(van) + '" style="width:auto;padding:0 8px"></label><label class="quiet" style="font-size:12px;display:inline-flex;align-items:center;gap:4px">tot <input type="date" class="input tool" id="fTot" aria-label="Tot" value="' + K.esc(tot) + '" style="width:auto;padding:0 8px"></label>' + (van || tot ? '<button type="button" class="tool" id="clearDates">' + K.icon("x") + 'Periode wissen</button>' : "") +
      '<span class="spacer"></span><span class="muted">' + list.length + ' document' + (list.length === 1 ? "" : "en") + (S.window ? ' · laatste ' + S.window + ' dagen · <a href="#" id="loadAll">Alles laden</a>' : ' · volledige historiek') + '</span>' +
      (inv.length ? '<button type="button" class="tool" id="bulkInv" title="Alle facturen van deze selectie in één PDF">' + K.icon("print") + 'Alle facturen (' + inv.length + ')</button><button type="button" class="tool" id="csvInv">' + K.icon("doc") + 'Facturen CSV</button>' : "") + '</div>' +
      '<div class="content"><div class="grp"><div class="tblwrap"><table class="tbl"><thead><tr><th>Document</th><th>Klant</th><th>Bestelling</th><th>Datum</th><th>Status</th><th class="num">Bedrag</th><th></th></tr></thead><tbody>' + (list.length ? list.map(d => '<tr><td><b>' + K.esc(d.number) + '</b><div class="quiet" style="font-size:11px">' + label(d.kind) + '</div></td><td>' + K.esc(d.o.client) + '</td><td class="mono">' + K.esc(d.o.ref) + '</td><td>' + K.esc(K.date(K.isoDay(d.date))) + '</td><td style="width:130px">' + (d.kind === "invoice" ? (d.state === "Betaald" ? '<span class="cell-st c-done" title="' + K.esc(S.payTxt(d.o)) + '">Betaald</span>' : '<span class="cell-st c-open">Openstaand</span>') : d.kind === "credit" ? '<span class="cell-st c-inv">Creditnota</span>' : (d.state === "Geleverd" ? '<span class="cell-st c-done">Geleverd</span>' : '<span class="cell-st c-road">Onderweg</span>')) + '</td><td class="num mono">' + K.eur(d.amount) + '</td><td class="actions"><button type="button" class="btn btn-o btn-sm" data-act="' + d.kind + '" data-id="' + d.o.id + '">Openen / PDF</button>' + (d.kind === "invoice" ? (d.state !== "Betaald" ? ' <button type="button" class="btn btn-p btn-sm" data-act="paid" data-id="' + d.o.id + '">Markeer als betaald</button>' : ' <button type="button" class="btn btn-ghost btn-sm" data-act="paid" data-id="' + d.o.id + '">Terug op openstaand</button>') : "") + '</td></tr>').join("") : '<tr><td colspan="7" class="wrap" style="height:auto">' + K.c.empty("Geen documenten", "Leveringsbonnen verschijnen bij vertrek, facturen bij levering, creditnota's na een correctie door de beheerder.") + '</td></tr>') + '</tbody></table></div></div>' +
      '<p class="quiet" style="font-size:12.5px">Facturen zijn interne documenten (PDF of print). Bedragen in de lijst excl. btw; de CSV bevat ook btw en totaal incl. btw. Automatische verzending naar de boekhouding komt later.</p></div>';
    const qi = page.querySelector("#q"); qi.addEventListener("input", () => { q = qi.value.toLowerCase(); const pos = qi.selectionStart; render(); const n = page.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); });
    page.querySelector("#fClient").onchange = e => { client = e.target.value; render(); };
    page.querySelector("#fVan").onchange = e => { van = e.target.value; render(); };
    page.querySelector("#fTot").onchange = e => { tot = e.target.value; render(); };
    const cd = page.querySelector("#clearDates"); if (cd) cd.onclick = () => { van = ""; tot = ""; render(); };
    const la = page.querySelector("#loadAll"); if (la) la.onclick = async e => { e.preventDefault(); la.textContent = "Laden…"; try { await S.load(true, true); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } };
    const bi = page.querySelector("#bulkInv"); if (bi) bi.onclick = () => S.openDocs(inv.map(d => d.o), "invoice");
    const ci = page.querySelector("#csvInv"); if (ci) ci.onclick = () => S.csvDownload([["Factuurnummer", "Datum", "Klant", "BTW-nummer klant", "Bestelling", "Totaal excl. btw", "Btw", "Totaal incl. btw", "Betaald", "Betaald op", "Betaalwijze", "Creditnota", "Creditnota bedrag"]].concat(inv.map(d => { const o = d.o, t = S.totals(o); return [d.number, K.isoDay(d.date), o.client, o.klant && o.klant.btw || "", o.ref, K.num(t.excl), K.num(t.btw), K.num(t.incl), o.paiement === "Payé" ? "ja" : "nee", o.payeLe ? K.isoDay(o.payeLe) : "", o.modePaiement || "", o.creditnota ? o.creditnota.nummer : "", o.creditnota ? K.num(o.creditnota.montant) : ""]; })), "famo-facturen-" + (van || "") + (van || tot ? "_" : "") + (tot || "") + (van || tot ? "" : K.today()) + ".csv");
  }
  S.bindActions(page, render);
  window.addEventListener("hashchange", () => { type = K.hashParams().path || "alle"; render(); });
  page.innerHTML = '<div class="page-h"><h1 class="h1">Documenten</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  try { await S.load(false, qs.get("all") === "1"); render(); } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message) + '</div>'; }
})();
