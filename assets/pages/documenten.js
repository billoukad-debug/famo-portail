(async function () {
  if (!(await K.requireStaff())) return;
  const page = K.shell({});
  const qs = new URLSearchParams(location.search);
  // Filters bewaard op dit toestel (famoDocsFilter) ; een link met ?klant/?van/?tot gaat voor.
  const DKEY = "famoDocsFilter", sv = K.store.get(DKEY, {}) || {};
  let type = K.hashParams().path || "alle", client = qs.get("klant") || sv.client || "", q = sv.q || "", van = qs.get("van") || sv.van || "", tot = qs.get("tot") || sv.tot || "";
  // CHI-09 : tri par colonne (clic sur l'en-tête : croissant → décroissant → ordre par défaut = date récente d'abord).
  let sort = sv.sort && sv.sort.key ? sv.sort : { key: "", dir: 1 };
  const SORTS = { number: d => String(d.number), client: d => String(d.o.client || "").toLowerCase(), ref: d => String(d.o.ref), date: d => String(d.date || ""), state: d => d.state, amount: d => Number(d.amount) || 0 };
  const bySort = (a, b) => { const f = SORTS[sort.key]; if (!f) return String(b.date).localeCompare(String(a.date)); const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; };
  const th = (key, text, cls) => '<th' + (cls ? ' class="' + cls + '"' : "") + ' aria-sort="' + (sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none") + '"><button type="button" class="th-sort" data-sort="' + key + '">' + text + (sort.key === key ? (sort.dir > 0 ? " ▲" : " ▼") : "") + '</button></th>';
  function docs() {
    const out = [];
    S.orders.forEach(o => {
      if (o.statut === "Sortie en livraison" || o.statut === "Facturée") out.push({ kind: "delivery", number: "LB-" + o.ref.replace(/^CMD-/, ""), o, date: o.livreeLe || o.day, state: o.statut === "Facturée" ? "Geleverd" : "Onderweg", amount: o.total });
      if (o.statut === "Facturée") out.push({ kind: "invoice", number: o.factuurnummer || "—", o, date: o.factureeLe || o.livreeLe || o.day, state: o.paiement === "Payé" ? "Betaald" : "Openstaand", amount: o.total });
      S.cns(o).forEach(cn => out.push({ kind: "credit", number: cn.nummer, cn: cn.nummer, o, date: cn.le || o.factureeLe || o.day, state: "Creditnota", amount: -cn.montant })); // C-08 : één rij per creditnota
    });
    return out.filter(d => (type === "alle" || (type === "facturen" && d.kind === "invoice") || (type === "bonnen" && d.kind === "delivery") || (type === "open" && d.kind === "invoice" && d.state === "Openstaand") || (type === "creditnotas" && d.kind === "credit"))
      && (!client || d.o.client === client) && (!van || K.isoDay(d.date) >= van) && (!tot || K.isoDay(d.date) <= tot)
      && (!q || (d.number + " " + d.o.ref + " " + d.o.client).toLowerCase().includes(q))).sort(bySort);
  }
  const label = k => k === "invoice" ? "Factuur" : k === "credit" ? "Creditnota" : "Leveringsbon";
  function render() { return K.keep(page, draw); }
  function draw() {
    K.store.set(DKEY, { client, q, van, tot, sort });
    const list = docs(); const c = S.counts(); const inv = list.filter(d => d.kind === "invoice");
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Documenten</h1><p class="sub">Facturen, creditnota\'s en leveringsbonnen</p></div><span class="spacer"></span>' + K.c.kpi(K.eur(c.unpaidSum), "openstaand") + K.c.kpi(c.unpaid, c.unpaid === 1 ? "onbetaalde factuur" : "onbetaalde facturen", c.unpaid > 0, "#/open") + '</div>' +
      '<nav class="views" aria-label="Soort document">' + [["alle", "Alle"], ["facturen", "Facturen"], ["bonnen", "Leveringsbonnen"], ["open", "Openstaand"], ["creditnotas", "Creditnota's"]].map(([k, l]) => '<a href="#/' + k + '"' + (type === k ? ' class="on"' : "") + '>' + l + '</a>').join("") + '</nav>' +
      '<div class="tools"><label class="search" style="max-width:280px">' + K.icon("search") + '<input id="q" aria-label="Zoeken" placeholder="Nummer, bestelling of klant…" value="' + K.esc(q) + '"></label><select class="input tool" id="fClient" aria-label="Klant" style="width:auto;padding:0 8px"><option value="">Alle klanten</option>' + Array.from(new Set(S.orders.map(o => o.client))).sort((a, b) => a.localeCompare(b, "nl")).map(x => '<option' + (x === client ? " selected" : "") + '>' + K.esc(x) + '</option>').join("") + '</select>' +
      '<label class="quiet" style="font-size:12px;display:inline-flex;align-items:center;gap:4px">van <input type="date" class="input tool" id="fVan" aria-label="Van" value="' + K.esc(van) + '" style="width:auto;padding:0 8px"></label><label class="quiet" style="font-size:12px;display:inline-flex;align-items:center;gap:4px">tot <input type="date" class="input tool" id="fTot" aria-label="Tot" value="' + K.esc(tot) + '" style="width:auto;padding:0 8px"></label>' + (van || tot ? '<button type="button" class="tool" id="clearDates">' + K.icon("x") + 'Periode wissen</button>' : "") +
      '<span class="spacer"></span><span class="muted">' + list.length + ' document' + (list.length === 1 ? "" : "en") + (S.window ? ' · laatste ' + S.window + ' dagen · <button type="button" class="linkbtn" id="loadAll">Alles laden</button>' : ' · volledige historiek') + '</span>' +
      (inv.length ? '<button type="button" class="tool" id="bulkInv" title="Alle facturen van deze selectie in één PDF">' + K.icon("print") + 'Alle facturen (' + inv.length + ')</button><button type="button" class="tool" id="csvInv">' + K.icon("doc") + 'Facturen CSV</button><button type="button" class="tool" id="csvBoek" title="Eén regel per factuur en per btw-tarief, creditnota\'s negatief: om in te lezen in Billtobox of het boekhoudpakket">' + K.icon("doc") + 'Boekhouding CSV</button><button type="button" class="tool" id="ublInv" title="Peppol BIS 3.0 (UBL) per factuur en per creditnota, voor Billtobox">' + K.icon("doc") + 'UBL (' + inv.length + ')</button>' : "") + '</div>' +
      '<div class="content"><div class="grp"><div class="tblwrap"><table class="tbl"><thead><tr>' + th("number", "Document") + th("client", "Klant") + th("ref", "Bestelling") + th("date", "Datum") + th("state", "Status") + th("amount", "Bedrag", "num") + '<th></th></tr></thead><tbody>' + (list.length ? list.map(d => '<tr><td><b>' + K.esc(d.number) + '</b><div class="quiet" style="font-size:11px">' + label(d.kind) + '</div></td><td>' + K.esc(d.o.client) + '</td><td class="mono">' + K.esc(d.o.ref) + '</td><td>' + K.esc(K.date(K.isoDay(d.date))) + '</td><td style="width:130px">' + (d.kind === "invoice" ? (d.state === "Betaald" ? '<span class="cell-st c-done" title="' + K.esc(S.payTxt(d.o)) + '">Betaald</span>' : '<span class="cell-st c-open">Openstaand</span>') : d.kind === "credit" ? '<span class="cell-st c-inv">Creditnota</span>' : (d.state === "Geleverd" ? '<span class="cell-st c-done">Geleverd</span>' : '<span class="cell-st c-road">Onderweg</span>')) + '</td><td class="num mono">' + K.eur(d.amount) + '</td><td class="actions"><span class="act-slots"><button type="button" class="btn btn-o btn-sm" data-act="' + d.kind + '" data-id="' + d.o.id + '"' + (d.cn ? ' data-cn="' + K.esc(d.cn) + '"' : "") + '>Openen / PDF</button>' + (d.kind === "invoice" ? (d.state !== "Betaald" ? '<button type="button" class="btn btn-p btn-sm" data-act="paid" data-id="' + d.o.id + '">Markeer als betaald</button>' : '<button type="button" class="btn btn-ghost btn-sm" data-act="paid" data-id="' + d.o.id + '">Terug op openstaand</button>') : "<span></span>") + '</span></td></tr>').join("") : '<tr><td colspan="7" class="wrap" style="height:auto">' + K.c.empty("Geen documenten", "Leveringsbonnen verschijnen bij vertrek, facturen bij levering, creditnota's na een correctie door de beheerder.") + '</td></tr>') + '</tbody></table></div></div>' +
      '<p class="quiet" style="font-size:12.5px">Bedragen in de lijst excl. btw. Zolang de boekhouder factureert (Beheer → Bedrijf → Facturatie), zijn de documenten van het portaal pro forma: bezorg de boekhouder de « Boekhouding CSV » of de UBL-bestanden (Billtobox).</p></div>';
    const qi = page.querySelector("#q"); qi.addEventListener("input", K.debounce(() => { q = qi.value.toLowerCase(); const pos = qi.selectionStart; render(); const n = page.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); }, 150));
    page.querySelector("#fClient").onchange = e => { client = e.target.value; render(); };
    page.querySelector("#fVan").onchange = e => { van = e.target.value; render(); };
    page.querySelector("#fTot").onchange = e => { tot = e.target.value; render(); };
    const cd = page.querySelector("#clearDates"); if (cd) cd.onclick = () => { van = ""; tot = ""; render(); };
    const la = page.querySelector("#loadAll"); if (la) la.onclick = async e => { e.preventDefault(); la.textContent = "Laden…"; try { await S.load(true, true); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } };
    const bi = page.querySelector("#bulkInv"); if (bi) bi.onclick = () => S.openDocs(inv.map(d => d.o), "invoice");
    // Boekhouding : maatstaf en btw per tarief, zelfde regel als de documenten (assets/vat.js, vastgezette tarieven).
    const cb = page.querySelector("#csvBoek"); if (cb) cb.onclick = () => {
      const rows = [["Type", "Nummer", "Datum", "Oorspronkelijke factuur", "Klantnummer", "Klant", "BTW-nummer klant", "Bestelling", "Btw-tarief", "Maatstaf", "Btw", "Totaal incl. btw", "Btw-regime"]];
      const push = (typ, nr, datum, orig, o, lignes, sign) => { const map = S.btwPerLine(o); const t = window.FamoVat.totals(K.parseLines(lignes).filter(l => l.price != null), n => window.FamoVat.rateFrom(map, n, S.rate("")), sign); t.groups.forEach(g => rows.push([typ, nr, K.isoDay(datum), orig, o.klant && o.klant.klantnr || "", o.client, o.klant && o.klant.btw || "", o.ref, K.num(g.rate), K.num(g.base), K.num(g.tva), K.num(window.FamoVat.r2(g.base + g.tva)), window.FamoVat.regime(o.btwRegime).short])); };
      inv.forEach(d => { const o = d.o; push("Factuur", o.factuurnummer, o.factureeLe || d.date, "", o, o.lignes, 1); S.cns(o).forEach(cn => push("Creditnota", cn.nummer, cn.le, o.factuurnummer, o, cn.lignes, -1)); });
      S.csvDownload(rows, "Famo-boekhouding-" + (van || "begin") + "-" + (tot || K.today()) + ".csv");
    };
    // UBL per factuur (server : /api/export, beheerder). Ontbreekt er iets (btw-nummer klant…), dan
    // staat dat in het overzicht in plaats van een bestand dat Billtobox zou weigeren.
    const ub = page.querySelector("#ublInv"); if (ub) ub.onclick = async () => {
      K.busy(ub, true, "UBL…"); const fouten = []; let ok = 0;
      // Per factuur het UBL-bestand, en daarna elke creditnota van die factuur (C-08).
      const jobs = inv.reduce((a, d) => a.concat([{ d, number: d.number, url: "", file: "Factuur-" + d.o.factuurnummer }], S.cns(d.o).map(cn => ({ d, number: cn.nummer, url: "&type=credit&cn=" + encodeURIComponent(cn.nummer), file: "Creditnota-" + cn.nummer }))), []);
      for (const job of jobs) {
        const d = job.d;
        try {
          const r = await fetch("/api/export?format=ubl&id=" + encodeURIComponent(d.o.id) + job.url, { credentials: "same-origin" });
          if (r.status === 422) { const j = await r.json(); fouten.push(job.number + " (" + d.o.client + "): " + (j.problems || []).join("; ")); continue; }
          if (!r.ok) { const j = await r.json().catch(() => ({})); fouten.push(job.number + ": " + (j.error || "fout " + r.status)); continue; }
          const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = String(job.file).replace(/[^\w.-]+/g, "-") + ".xml"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); ok++;
        } catch (err) { fouten.push(job.number + ": " + err.message); }
      }
      K.busy(ub, false);
      if (fouten.length) K.panel({ title: "UBL: " + ok + " klaar, " + fouten.length + " onvolledig", body: '<ul style="padding-left:18px;display:grid;gap:6px;font-size:13px">' + fouten.map(f => "<li>" + K.esc(f) + "</li>").join("") + "</ul>" });
      else K.toast(ok + " UBL-bestand" + (ok === 1 ? "" : "en") + " gedownload");
    };
    const ci = page.querySelector("#csvInv"); if (ci) ci.onclick = () => S.csvDownload([["Factuurnummer", "Datum", "Klant", "BTW-nummer klant", "Bestelling", "Totaal excl. btw", "Btw", "Totaal incl. btw", "Betaald", "Betaald op", "Betaalwijze", "Creditnota's", "Creditnota's bedrag excl. btw"]].concat(inv.map(d => { const o = d.o, t = S.totals(o); return [d.number, K.isoDay(d.date), o.client, o.klant && o.klant.btw || "", o.ref, K.num(t.excl), K.num(t.btw), K.num(t.incl), o.paiement === "Payé" ? "ja" : "nee", o.payeLe ? K.isoDay(o.payeLe) : "", o.modePaiement || "", S.cns(o).map(cn => cn.nummer).join(", "), S.cns(o).length ? K.num(S.cns(o).reduce((s, cn) => s + (Number(cn.montant) || 0), 0)) : ""]; })), "famo-facturen-" + (van || "") + (van || tot ? "_" : "") + (tot || "") + (van || tot ? "" : K.today()) + ".csv");
  }
  K.on(page, "click", "[data-sort]", (e, t) => { const k = t.dataset.sort; sort = sort.key !== k ? { key: k, dir: 1 } : sort.dir > 0 ? { key: k, dir: -1 } : { key: "", dir: 1 }; render(); const b = page.querySelector('[data-sort="' + k + '"]'); if (b) b.focus(); });
  S.bindActions(page, render);
  window.addEventListener("hashchange", () => { type = K.hashParams().path || "alle"; render(); });
  page.innerHTML = '<div class="page-h"><h1 class="h1">Documenten</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  try { await S.load(false, qs.get("all") === "1"); render(); } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message) + '</div>'; }
})();
