/* Rapportage (specs/022-rapportage) — page à part dans la barre latérale, beheerder seul.
   Données : GET /api/rapportage (beheerder) et /api/marge ; calcul : assets/rapport.js (pur, testé en Node).
   Filtres dans l'URL (/beheer/rapportage?periode=…&klant=…) : lien partageable, « terug » du navigateur.
   Graphiques : SVG en ligne (role="img", titre, description), boutons HTML superposés pour le clavier et le
   tactile (≥ 44 px), info-bulle au survol et au focus, tableau équivalent sur la page. */
(async function () {
  if (!(await K.requireStaff({ admin: true }))) return;
  const page = K.shell({ portal: "beheer" });
  const R = window.FamoRapport, V = window.FamoVat;
  const KEYS = ["periode", "jaar", "kwartaal", "maand", "van", "tot", "vergelijk", "klant", "categorie", "familie", "product", "betaling", "regime", "q", "groep"];
  const FILTERS = ["klant", "categorie", "familie", "product", "betaling", "regime", "q"];
  const readState = () => { const p = new URLSearchParams(location.search), s = {}; KEYS.forEach(k => { const v = p.get(k); if (v) s[k] = v.slice(0, 120); }); return s; };
  const urlOf = s => { const p = new URLSearchParams(); KEYS.forEach(k => { if (s[k]) p.set(k, s[k]); }); const q = p.toString(); return location.pathname + (q ? "?" + q : ""); };
  let st = readState(), data = null, rep = null, marge = { key: "", cur: null, prev: null, err: "", busy: false };
  const sorts = {}, more = {};
  const deps = () => ({ parseLines: K.parseLines, isoDay: K.isoDay, vat: V, catLabel: K.cat, familyOf: K.familyKey, today: K.today() });
  const pct = v => (v == null || !Number.isFinite(v) ? "—" : K.num(Math.round(v * 10) / 10) + " %");
  const coarse = () => !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  /* ---------- état / URL ---------- */
  function go(patch, opts) {
    const next = Object.assign({}, st, patch);
    Object.keys(next).forEach(k => { if (next[k] == null || next[k] === "") delete next[k]; });
    // Une seule forme de période dans l'URL.
    const keep = { jaar: ["jaar"], kwartaal: ["kwartaal"], maand: ["maand"], vrij: ["van", "tot"] }[next.periode || "jaar"] || ["jaar"];
    ["jaar", "kwartaal", "maand", "van", "tot"].forEach(k => { if (!keep.includes(k)) delete next[k]; });
    if (next.periode === "jaar") delete next.periode;
    if (next.vergelijk === "vorige") delete next.vergelijk;
    if (next.groep === "categorie") delete next.groep;
    st = next;
    try { if (opts && opts.replace) history.replaceState(null, "", urlOf(st)); else history.pushState(null, "", urlOf(st)); } catch (e) { /* ignore */ }
    render(opts && opts.filters);
  }
  window.addEventListener("popstate", () => { st = readState(); render(true); });

  /* ---------- formats ---------- */
  const qtyTxt = (q, u) => K.qty(q) + (u ? " " + K.unit(u) : "");
  const short = v => { const a = Math.abs(v); return (v < 0 ? "−" : "") + "€ " + (a >= 1e6 ? K.num(Math.round(a / 1e5) / 10) + " mln" : a >= 1e4 ? K.num(Math.round(a / 100) / 10) + "k" : Math.round(a).toLocaleString("nl-BE")); };
  const regimeTxt = k => V.regime(k).short;
  const klantNaam = id => ((data && data.klanten) || []).find(k => k.id === id)?.nom || id;
  const prodNaam = key => ((rep && rep.opties.producten) || []).find(p => p.key === key)?.naam || key;
  const famNaam = key => ((rep && rep.opties.families) || []).find(p => p.key === key)?.naam || key;
  const rangeTxt = p => p ? R.fmt(p.van) + " – " + R.fmt(p.tot) : "";

  /* ---------- filtres ---------- */
  function yearsOf() {
    const ys = new Set([K.today().slice(0, 4)]);
    (data.orders || []).forEach(o => { const d = o.factureeLe ? K.isoDay(o.factureeLe) : (o.dateLiv || o.date || ""); if (d) ys.add(d.slice(0, 4)); });
    return Array.from(ys).sort().reverse();
  }
  const sel = (id, label, opts, value, extra) => '<div class="field rp-f' + (extra || "") + '"><label for="' + id + '">' + K.esc(label) + '</label><select class="input" id="' + id + '">' + opts.map(([v, l]) => '<option value="' + K.esc(v) + '"' + (String(v) === String(value || "") ? " selected" : "") + '>' + K.esc(l) + '</option>').join("") + '</select></div>';
  function filtersHtml() {
    const p = R.periode(st, K.today()), years = yearsOf(), today = K.today(), o = rep.opties;
    const kind = p.kind;
    let dep = "";
    if (kind === "jaar") dep = sel("rpJaar", "Jaar", years.map(y => [y, y]), p.key);
    if (kind === "kwartaal") dep = sel("rpKwartaal", "Kwartaal", years.flatMap(y => [4, 3, 2, 1].map(q => y + "-Q" + q)).filter(k => k.slice(0, 4) + "-" + String(Number(k.slice(6)) * 3 - 2).padStart(2, "0") <= today.slice(0, 7)).map(k => [k, "K" + k.slice(6) + " " + k.slice(0, 4)]), p.key);
    if (kind === "maand") dep = sel("rpMaand", "Maand", years.flatMap(y => [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(m => y + "-" + String(m).padStart(2, "0"))).filter(k => k <= today.slice(0, 7)).map(k => [k, R.maandNaam(k)]), p.key);
    if (kind === "vrij") dep = '<div class="field rp-f" id="fVan"><label for="rpVan">Van</label><input class="input" type="date" id="rpVan" value="' + K.esc(p.van) + '"></div><div class="field rp-f" id="fTot"><label for="rpTot">Tot en met</label><input class="input" type="date" id="rpTot" value="' + K.esc(p.tot) + '"><span class="err" data-err></span></div>';
    return '<section class="card rp-filters" aria-labelledby="rpFiltH"><h2 class="sr-only" id="rpFiltH">Periode en filters</h2>' +
      sel("rpPeriode", "Periode", [["jaar", "Jaar"], ["kwartaal", "Kwartaal"], ["maand", "Maand"], ["vrij", "Vrije periode"]], kind) + dep +
      sel("rpCmp", "Vergelijken met", [["vorige", "Vorige periode"], ["jaar", "Zelfde periode vorig jaar"], ["geen", "Niets"]], st.vergelijk || "vorige") +
      sel("rpKlant", "Klant", [["", "Alle klanten"]].concat(o.klanten.map(k => [k.id, k.naam])), st.klant) +
      sel("rpCat", "Categorie", [["", "Alle categorieën"]].concat(o.categorieen.map(c => [c, c])), st.categorie) +
      sel("rpProduct", "Product", [["", "Alle producten"]].concat(o.producten.map(x => [x.key, x.naam])), st.product) +
      sel("rpBetaling", "Betaling", [["", "Alle"], ["open", "Openstaand"], ["betaald", "Betaald"]], st.betaling) +
      (o.regimes.length > 1 || st.regime ? sel("rpRegime", "Btw-regime", [["", "Alle"]].concat(o.regimes.map(k => [k, regimeTxt(k)])), st.regime) : "") +
      '<div class="field rp-f rp-fq"><label for="rpQ">Zoeken</label><label class="search">' + K.icon("search") + '<input id="rpQ" type="search" placeholder="Factuur, klant of product…" value="' + K.esc(st.q || "") + '" autocomplete="off"></label></div>' +
      '</section>';
  }
  function chipsHtml() {
    const lbl = { klant: v => "Klant: " + klantNaam(v), categorie: v => "Categorie: " + v, familie: v => "Familie: " + famNaam(v), product: v => "Product: " + prodNaam(v), betaling: v => "Betaling: " + (v === "open" ? "openstaand" : "betaald"), regime: v => "Btw-regime: " + regimeTxt(v), q: v => "Zoekterm: „" + v + "”" };
    const on = FILTERS.filter(k => st[k]);
    if (!on.length) return "";
    return '<div class="rp-chips" role="group" aria-label="Actieve filters">' + on.map(k => '<button type="button" class="rp-chip" data-clear="' + k + '" aria-label="' + K.esc(lbl[k](st[k]) + " — filter wissen") + '"><span>' + K.esc(lbl[k](st[k])) + '</span>' + K.icon("x") + '</button>').join("") + (on.length > 1 ? '<button type="button" class="btn btn-ghost btn-sm" data-clear="alles">Alle filters wissen</button>' : "") + '</div>';
  }

  /* ---------- KPIs ---------- */
  function deltaHtml(d, fmt, goodUp) {
    if (!d) return "";
    const up = d.abs > 0, down = d.abs < 0, cls = up || down ? (up === (goodUp !== false) ? " rp-up" : " rp-down") : "";
    return '<em class="rp-delta' + cls + '"><span aria-hidden="true">' + (up ? "▲" : down ? "▼" : "=") + '</span> ' + (d.pct == null ? "" : (d.pct > 0 ? "+" : "") + K.num(d.pct) + " % · ") + (up ? "+ " : down ? "− " : "") + fmt(Math.abs(d.abs)) + '</em>';
  }
  function margeView() {
    const lineFilter = !!(st.categorie || st.familie || st.product);
    const rowsOf = m => (m && m.producten || []).filter(x => { const key = String(x.produit || "").trim().toLowerCase(), info = ((data.producten || []).find(p => p.nom.trim().toLowerCase() === key) || null); const cat = info ? K.cat(info.cat) : "Niet in catalogus"; return (!st.product || key === st.product) && (!st.categorie || cat === st.categorie) && (!st.familie || K.familyKey(x.produit) === st.familie); });
    const tot = m => { if (!m) return null; if (!lineFilter) return { marge: m.totaal.marge, pct: m.totaal.pct, basis: m.totaal.omzetMetKost }; const rows = rowsOf(m), mg = rows.reduce((s, x) => s + x.marge, 0), b = rows.reduce((s, x) => s + x.omzetMetKost, 0); return { marge: V.r2(mg), pct: b > 0 ? Math.round(mg / b * 1000) / 10 : null, basis: V.r2(b) }; };
    const cur = tot(marge.cur), prev = tot(marge.prev);
    return { lineFilter, rows: rowsOf(marge.cur), cur, prev, delta: cur && prev ? { abs: V.r2(cur.marge - prev.marge), pct: prev.marge ? Math.round((cur.marge - prev.marge) / Math.abs(prev.marge) * 1000) / 10 : null } : null };
  }
  function kpisHtml() {
    const k = rep.kpi, d = rep.delta, mv = margeView(), cmp = !!rep.vergelijking;
    const tile = (label, value, sub, delta) => '<div class="kp"><small>' + label + '</small><b>' + value + '</b>' + (delta || "") + (sub ? '<em>' + sub + '</em>' : "") + '</div>';
    const margeVal = marge.err ? "—" : !mv.cur ? "…" : K.eur(mv.cur.marge);
    return '<div class="kpis rp-kpis" id="rpKpis">' +
      tile("Omzet excl. btw", K.eur(k.omzet), k.creditnotas ? K.eur(k.credit) + " creditnota's afgetrokken" : "na creditnota's", cmp ? deltaHtml(d.omzet, K.eur) : "") +
      tile("Facturen", String(k.facturen), k.creditnotas ? K.plural(k.creditnotas, "creditnota", "creditnota's") : "geen creditnota's", cmp ? deltaHtml(d.facturen, v => String(v)) : "") +
      tile("Gemiddelde factuur", K.eur(k.gemiddeld), "excl. btw, vóór creditnota's", cmp ? deltaHtml(d.gemiddeld, K.eur) : "") +
      tile("Brutomarge (schatting)", margeVal, mv.cur ? pct(mv.cur.pct) + " op " + K.eur(mv.cur.basis) + (mv.lineFilter ? " · zonder creditnota's" : "") : (marge.err ? "niet beschikbaar" : "laden…"), cmp && mv.delta ? deltaHtml(mv.delta, K.eur) : "") +
      tile("Openstaand", K.eur(k.openstaand), K.plural(k.openN, "factuur", "facturen") + " · alle jaren" + (k.vervallenN ? " · " + k.vervallenN + " vervallen" : "")) +
      tile("Actieve klanten", String(k.klanten), "met een factuur in de periode", cmp ? deltaHtml(d.klanten, v => String(v)) : "") +
      '</div>';
  }

  /* ---------- tableaux triables ---------- */
  // cols : [{ k, label, num, html(row), sort (clé de tri, défaut k) }]
  function table(id, caption, cols, rows, def, opts) {
    const o = opts || {}, s = sorts[id] || def, sorted = R.sortRows(rows, (cols.find(c => c.k === s.k) || {}).sort || s.k, s.dir);
    const lim = more[id] || o.limit || 25, shown = sorted.slice(0, lim);
    const th = c => { const on = s.k === c.k; return '<th scope="col"' + (c.num ? ' class="num"' : "") + ' aria-sort="' + (on ? (s.dir === "asc" ? "ascending" : "descending") : "none") + '"><button type="button" class="th-sort" data-sort="' + id + ':' + c.k + '">' + K.esc(c.label) + '<span aria-hidden="true">' + (on ? (s.dir === "asc" ? " ▲" : " ▼") : "") + '</span></button></th>'; };
    if (!rows.length) return '<div class="empty m-12">' + K.esc(o.empty || "Niets in deze periode.") + '</div>';
    return '<div class="tblwrap"><table class="tbl rp-tbl"><caption class="sr-only">' + K.esc(caption) + '</caption><thead><tr>' + cols.map(th).join("") + (o.actions ? '<th scope="col"><span class="sr-only">Acties</span></th>' : "") + '</tr></thead><tbody>' +
      shown.map(r => '<tr>' + cols.map(c => '<td' + (c.num ? ' class="num mono"' : c.wrap ? ' class="wrap"' : "") + '>' + c.html(r) + '</td>').join("") + (o.actions ? '<td class="actions">' + o.actions(r) + '</td>' : "") + '</tr>').join("") + '</tbody></table></div>' +
      (sorted.length > lim ? '<div class="rp-more"><button type="button" class="btn btn-o btn-sm" data-more="' + id + '">Toon alle ' + sorted.length + '</button></div>' : "");
  }
  const sortedRows = (id, rows, def, cols) => { const s = sorts[id] || def; return R.sortRows(rows, ((cols || []).find(c => c.k === s.k) || {}).sort || s.k, s.dir); };
  const drill = (kind, v, label, extra) => '<button type="button" class="linkbtn rp-drill" data-drill="' + kind + '" data-v="' + K.esc(v) + '" aria-label="' + K.esc(label + " — " + (extra || "filter hierop")) + '">' + K.esc(label) + '</button>';
  const card = (id, title, sub, body, right) => '<section class="card rp-card" aria-labelledby="h-' + id + '"><div class="card-h"><div class="minw-0"><h2 class="h2" id="h-' + id + '">' + K.esc(title) + '</h2>' + (sub ? '<p class="sub ws-normal">' + sub + '</p>' : "") + '</div><div class="rp-acts">' + (right || "") + '<button type="button" class="btn btn-o btn-sm" data-csv="' + id + '" aria-label="' + K.esc(title) + ' exporteren als CSV">CSV</button></div></div>' + body + '</section>';

  /* ---------- colonnes définies une fois (tableau + CSV) ---------- */
  const COLS = {
    maanden: [{ k: "key", label: "Maand", html: r => drill("maand", r.key, r.label, "toon deze maand") }, { k: "n", label: "Facturen", num: true, html: r => String(r.n) }, { k: "omzet", label: "Omzet", num: true, html: r => K.eur(r.omzet) }, { k: "vorigJaar", label: "Vorig jaar", num: true, html: r => K.eur(r.vorigJaar) }, { k: "verschil", label: "Verschil", num: true, html: r => K.eur(r.verschil) }],
    klanten: [{ k: "naam", label: "Klant", html: r => r.id ? drill("klant", r.id, r.naam) : K.esc(r.naam) }, { k: "n", label: "Facturen", num: true, html: r => String(r.n) }, { k: "omzet", label: "Omzet", num: true, html: r => K.eur(r.omzet) }, { k: "aandeel", label: "Aandeel", num: true, html: r => pct(r.aandeel) }],
    producten: [{ k: "naam", label: "Product", html: r => drill("product", r.key, r.naam) + (r.noPrice ? ' <span class="tag" title="regels zonder prijs">' + r.noPrice + ' zonder prijs</span>' : "") }, { k: "cat", label: "Categorie", html: r => drill("categorie", r.cat, r.cat) }, { k: "qty", label: "Aantal", num: true, html: r => K.esc(qtyTxt(r.qty, r.unit)) }, { k: "omzet", label: "Omzet", num: true, html: r => K.eur(r.omzet) }, { k: "aandeel", label: "Aandeel", num: true, html: r => pct(r.aandeel) }],
    groepen: [{ k: "naam", label: "Groep", html: r => drill(st.groep === "familie" ? "familie" : "categorie", r.key, r.naam) }, { k: "omzet", label: "Omzet", num: true, html: r => K.eur(r.omzet) }, { k: "aandeel", label: "Aandeel", num: true, html: r => pct(r.aandeel) }],
    marge: [{ k: "produit", label: "Product", wrap: true, html: r => drill("product", String(r.produit).trim().toLowerCase(), r.produit) + '<div class="quiet fs-11">' + K.esc(qtyTxt(r.qty, r.unit)) + ' · aankoop ' + K.eur(r.kost) + (r.zonderKost > 0 ? ' · ' + K.eur(r.zonderKost) + ' zonder aankoopprijs' : "") + '</div>' }, { k: "omzet", label: "Omzet", num: true, html: r => K.eur(r.omzet) }, { k: "marge", label: "Marge", num: true, html: r => K.eur(r.marge) }, { k: "pct", label: "%", num: true, html: r => pct(r.pct) }],
    btw: [{ k: "rate", label: "Tarief", html: r => K.num(r.rate) + " %" }, { k: "base", label: "Grondslag", num: true, html: r => K.eur(r.base) }, { k: "tva", label: "Btw", num: true, html: r => K.eur(r.tva) }, { k: "incl", label: "Incl. btw", num: true, html: r => K.eur(r.incl) }],
    facturen: [{ k: "dag", label: "Datum", html: r => K.esc(R.fmt(r.dag)) }, { k: "nummer", label: "Nummer", html: r => '<a class="tlink mono" href="/team/bestelling?id=' + encodeURIComponent(r.id) + '" aria-label="' + K.esc((r.type === "creditnota" ? "Creditnota " : "Factuur ") + r.nummer + " openen") + '">' + K.esc(r.nummer) + '</a>' + (r.type === "creditnota" ? ' <span class="tag">creditnota</span>' : "") }, { k: "client", label: "Klant", html: r => r.clientId ? drill("klant", r.clientId, r.client) : K.esc(r.client) }, { k: "bedrag", label: "Excl. btw", num: true, html: r => K.eur(r.bedrag) }, { k: "incl", label: "Incl. btw", num: true, html: r => K.eur(r.incl) }, { k: "paiement", label: "Betaling", html: r => K.payCell(r.paiement) }],
    open: [{ k: "nummer", label: "Factuur", html: r => '<a class="tlink mono" href="/team/bestelling?id=' + encodeURIComponent(r.id) + '" aria-label="' + K.esc("Factuur " + r.nummer + " openen") + '">' + K.esc(r.nummer) + '</a>' }, { k: "client", label: "Klant", html: r => r.clientId ? drill("klant", r.clientId, r.client) : K.esc(r.client) }, { k: "dag", label: "Datum", html: r => K.esc(R.fmt(r.dag)) }, { k: "vervalt", label: "Vervalt", html: r => '<span' + (r.telaat ? ' class="t-danger fw-600"' : "") + '>' + K.esc(R.fmt(r.vervalt)) + (r.telaat ? " · vervallen" : "") + '</span>' }, { k: "bedrag", label: "Excl. btw", num: true, html: r => K.eur(r.bedrag) }, { k: "incl", label: "Incl. btw", num: true, html: r => K.eur(r.incl) }]
  };
  const DEF = { maanden: { k: "key", dir: "asc" }, klanten: { k: "omzet", dir: "desc" }, producten: { k: "omzet", dir: "desc" }, groepen: { k: "omzet", dir: "desc" }, marge: { k: "omzet", dir: "desc" }, btw: { k: "rate", dir: "asc" }, facturen: { k: "dag", dir: "desc" }, open: { k: "dag", dir: "asc" } };
  const rowsOf = id => {
    if (id === "maanden") return rep.maanden.map(m => Object.assign({}, m, { verschil: V.r2(m.omzet - m.vorigJaar) }));
    if (id === "groepen") return st.groep === "familie" ? rep.families : rep.categorieen;
    if (id === "marge") return margeView().rows;
    return rep[id] || [];
  };

  /* ---------- graphiques (SVG) ---------- */
  const nice = x => { if (!(x > 0)) return 1; const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
  const svgOpen = (id, w, h, title, desc) => '<svg class="rp-svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-labelledby="' + id + 't ' + id + 'd"><title id="' + id + 't">' + K.esc(title) + '</title><desc id="' + id + 'd">' + K.esc(desc) + '</desc>';
  // Barre : bout arrondi (4 px) du côté de la valeur, carré sur la ligne de base.
  function barV(x, w, y0, y1) { const h = Math.abs(y1 - y0); if (h < 0.5) return ""; const r = Math.min(4, w / 2, h); return y1 < y0 ? "M" + x + "," + y0 + "V" + (y1 + r) + "Q" + x + "," + y1 + " " + (x + r) + "," + y1 + "H" + (x + w - r) + "Q" + (x + w) + "," + y1 + " " + (x + w) + "," + (y1 + r) + "V" + y0 + "Z" : "M" + x + "," + y0 + "V" + (y1 - r) + "Q" + x + "," + y1 + " " + (x + r) + "," + y1 + "H" + (x + w - r) + "Q" + (x + w) + "," + y1 + " " + (x + w) + "," + (y1 - r) + "V" + y0 + "Z"; }
  function barH(x0, x1, y, h) { const w = Math.abs(x1 - x0); if (w < 0.5) return ""; const r = Math.min(4, h / 2, w); return x1 > x0 ? "M" + x0 + "," + y + "H" + (x1 - r) + "Q" + x1 + "," + y + " " + x1 + "," + (y + r) + "V" + (y + h - r) + "Q" + x1 + "," + (y + h) + " " + (x1 - r) + "," + (y + h) + "H" + x0 + "Z" : "M" + x0 + "," + y + "H" + (x1 + r) + "Q" + x1 + "," + y + " " + x1 + "," + (y + r) + "V" + (y + h - r) + "Q" + x1 + "," + (y + h) + " " + (x1 + r) + "," + (y + h) + "H" + x0 + "Z"; }
  const f1 = v => Math.round(v * 10) / 10;
  const innerW = box => { const cs = getComputedStyle(box); return Math.floor((box.clientWidth || 600) - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)); };
  // Omzet per maand : colonnes (période) + ligne avec points (même mois un an plus tôt).
  function monthChart(box) {
    const rows = rep.maanden, n = rows.length, W = Math.max(260, innerW(box)), cmpLbl = "Een jaar eerder";
    const padL = 58, padR = 10, padT = 14, plotH = 200, axisH = 34, H = padT + plotH + axisH;
    const slot = Math.max(coarse() ? 44 : 26, (W - padL - padR) / Math.max(1, n)), w = Math.round(padL + padR + slot * n);
    const vals = rows.flatMap(r => [r.omzet, r.vorigJaar]); let hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
    const step = nice((hi - lo) / 4 || 100); hi = Math.ceil(hi / step) * step || step; lo = Math.floor(lo / step) * step;
    const y = v => f1(padT + (hi - v) / (hi - lo) * plotH), x0 = i => padL + slot * i, cx = i => f1(x0(i) + slot / 2), bw = Math.min(24, Math.max(6, slot * 0.5));
    const top = rows.reduce((a, r) => (r.omzet > a.omzet ? r : a), rows[0] || { omzet: 0, label: "" });
    const desc = n + " maanden, " + rangeTxt(rep.periode) + ". Totaal " + K.eur(rep.kpi.omzet) + (top && top.omzet > 0 ? "; hoogste maand " + top.label + " met " + K.eur(top.omzet) : "") + ". Lijn: dezelfde maanden een jaar eerder, samen " + K.eur(rows.reduce((s, r) => s + r.vorigJaar, 0)) + ".";
    let s = svgOpen("rpMaand", w, H, "Omzet per maand (excl. btw), " + rep.periode.label, desc);
    for (let v = lo; v <= hi + step / 2; v += step) s += '<line class="rp-gl" x1="' + padL + '" x2="' + (w - padR) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="rp-tick" x="' + (padL - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + K.esc(short(v)) + '</text>';
    s += '<line class="rp-axis" x1="' + padL + '" x2="' + (w - padR) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
    rows.forEach((r, i) => { s += '<path class="rp-col" data-i="' + i + '" d="' + barV(f1(cx(i) - bw / 2), f1(bw), y(0), y(r.omzet)) + '"/>'; });
    const pts = rows.map((r, i) => cx(i) + "," + y(r.vorigJaar));
    if (rep.vorigJaar && n > 1) s += '<polyline class="rp-prev" points="' + pts.join(" ") + '"/>';
    if (rep.vorigJaar) rows.forEach((r, i) => { s += '<circle class="rp-dot" data-i="' + i + '" cx="' + cx(i) + '" cy="' + y(r.vorigJaar) + '" r="4"/>'; });
    const every = slot >= 34 ? 1 : slot >= 20 ? 2 : 3;
    rows.forEach((r, i) => { if (i % every) return; const yr = i === 0 || r.key.endsWith("-01"); s += '<text class="rp-tick" x="' + cx(i) + '" y="' + (padT + plotH + 16) + '" text-anchor="middle">' + K.esc(r.kort.split(" ")[0]) + '</text>' + (yr ? '<text class="rp-tick" x="' + cx(i) + '" y="' + (padT + plotH + 30) + '" text-anchor="middle">' + r.key.slice(0, 4) + '</text>' : ""); });
    s += '</svg>';
    const hits = rows.map((r, i) => '<button type="button" class="rp-hit" data-drill="maand" data-v="' + r.key + '" data-i="' + i + '" data-tip="' + K.esc(JSON.stringify([K.eur(r.omzet), r.label, K.plural(r.n, "factuur", "facturen"), cmpLbl ? cmpLbl + ": " + K.eur(r.vorigJaar) : ""])) + '" aria-label="' + K.esc(r.label + ": " + K.eur(r.omzet) + ", " + K.plural(r.n, "factuur", "facturen") + (cmpLbl ? "; " + cmpLbl + ": " + K.eur(r.vorigJaar) : "") + ". Toon deze maand.") + '" style="left:' + f1(x0(i)) + 'px;top:' + padT + 'px;width:' + f1(slot) + 'px;height:' + (plotH + axisH) + 'px"></button>').join("");
    return { html: '<div class="rp-plot" style="width:' + w + 'px;height:' + H + 'px">' + s + '<div class="rp-hits">' + hits + '</div><div class="rp-tip" aria-hidden="true" hidden></div></div>', scroll: w > W + 1 };
  }
  // Barres horizontales : nom sur sa ligne, barre en dessous, valeur au bout ; valeurs négatives à gauche de zéro.
  function hbarChart(box, id, title, rows, opts) {
    const o = opts || {}, W = Math.max(240, innerW(box)), rowH = 48, n = rows.length, H = n * rowH + 4;
    const lbl = rows.map(r => r.valueLabel), valW = Math.min(W * 0.46, Math.max(...lbl.map(t => t.length)) * 7.2 + 14);
    const vals = rows.map(r => r.value), hi = Math.max(0, ...vals), lo = Math.min(0, ...vals), span = (hi - lo) || 1;
    const area = W - valW - 2, x = v => f1(2 + (v - lo) / span * area), zero = x(0), maxChars = Math.max(8, Math.floor(W / 7.4));
    let s = svgOpen(id, W, H, title, o.desc || "");
    if (lo < 0) s += '<line class="rp-axis" x1="' + zero + '" x2="' + zero + '" y1="0" y2="' + H + '"/>';
    rows.forEach((r, i) => {
      const y0 = i * rowH, name = r.naam.length > maxChars ? r.naam.slice(0, maxChars - 1) + "…" : r.naam, end = x(r.value);
      s += '<text class="rp-name" x="2" y="' + (y0 + 16) + '">' + K.esc(name) + '</text>';
      s += '<path class="rp-bar" data-i="' + i + '" d="' + barH(zero, end, y0 + 24, 14) + '"/>';
      s += '<text class="rp-val" x="' + f1(Math.max(end, zero) + 6) + '" y="' + (y0 + 35) + '">' + K.esc(r.valueLabel) + '</text>';
    });
    s += '</svg>';
    const hits = rows.map((r, i) => '<button type="button" class="rp-hit" data-drill="' + r.drill + '" data-v="' + K.esc(r.v) + '" data-i="' + i + '" data-tip="' + K.esc(JSON.stringify([r.valueLabel, r.naam, r.sub || ""])) + '" aria-label="' + K.esc(r.naam + ": " + r.valueLabel + (r.sub ? ", " + r.sub : "") + ". Filter hierop.") + '" style="left:0;top:' + (i * rowH) + 'px;width:' + W + 'px;height:' + rowH + 'px"></button>').join("");
    return { html: '<div class="rp-plot" style="width:' + W + 'px;height:' + H + 'px">' + s + '<div class="rp-hits">' + hits + '</div><div class="rp-tip" aria-hidden="true" hidden></div></div>', scroll: false };
  }
  const topN = (rows, n) => rows.slice(0, n);
  function paintCharts() {
    page.querySelectorAll("[data-chart]").forEach(box => {
      const kind = box.dataset.chart; let out = null;
      if (kind === "maand") out = rep.kpi.facturen || rep.kpi.creditnotas || rep.maanden.some(m => m.vorigJaar) ? monthChart(box) : null;
      if (kind === "klanten") { const rows = topN(rep.klanten.filter(r => r.id), 10); out = rows.length ? hbarChart(box, "rpKlanten", "Top " + rows.length + " klanten op omzet, " + rep.periode.label, rows.map(r => ({ naam: r.naam, value: r.omzet, valueLabel: K.eur(r.omzet), sub: K.plural(r.n, "factuur", "facturen") + " · " + pct(r.aandeel), drill: "klant", v: r.id })), { desc: rows.map(r => r.naam + " " + K.eur(r.omzet)).join("; ") }) : null; }
      if (kind === "producten") { const rows = topN(rep.producten, 10); out = rows.length ? hbarChart(box, "rpProducten", "Top " + rows.length + " producten op omzet, " + rep.periode.label, rows.map(r => ({ naam: r.naam, value: r.omzet, valueLabel: K.eur(r.omzet) + " · " + qtyTxt(r.qty, r.unit), sub: r.cat + " · " + pct(r.aandeel), drill: "product", v: r.key })), { desc: rows.map(r => r.naam + " " + K.eur(r.omzet) + " (" + qtyTxt(r.qty, r.unit) + ")").join("; ") }) : null; }
      if (kind === "groepen") { const fam = st.groep === "familie", rows = topN(fam ? rep.families : rep.categorieen, 12); out = rows.length ? hbarChart(box, "rpGroepen", "Omzet per " + (fam ? "familie" : "categorie") + ", " + rep.periode.label, rows.map(r => ({ naam: r.naam, value: r.omzet, valueLabel: K.eur(r.omzet) + " · " + pct(r.aandeel), drill: fam ? "familie" : "categorie", v: r.key })), { desc: rows.map(r => r.naam + " " + pct(r.aandeel)).join("; ") }) : null; }
      if (kind === "marge") { const rows = topN(R.sortRows(margeView().rows.filter(r => r.omzetMetKost > 0), "marge", "desc"), 10); out = rows.length ? hbarChart(box, "rpMarge", "Brutomarge per product (schatting), " + rep.periode.label, rows.map(r => ({ naam: r.produit, value: r.marge, valueLabel: K.eur(r.marge) + " · " + pct(r.pct), sub: "omzet " + K.eur(r.omzet) + " · aankoop " + K.eur(r.kost), drill: "product", v: String(r.produit).trim().toLowerCase() })), { desc: rows.map(r => r.produit + " " + K.eur(r.marge)).join("; ") }) : null; }
      box.classList.toggle("rp-scroll", !!(out && out.scroll));
      const hint = page.querySelector('[data-hint="' + kind + '"]'); if (hint) hint.hidden = !(out && out.scroll);
      box.innerHTML = out ? out.html : '<div class="empty m-12">Geen gegevens om te tonen.</div>';
    });
  }
  // Info-bulle : au survol et au focus d'un bouton de graphique (texte via textContent, jamais innerHTML).
  function tip(btn, show) {
    const plot = btn.closest(".rp-plot"); if (!plot) return; const t = plot.querySelector(".rp-tip"), i = btn.dataset.i;
    plot.querySelectorAll("[data-i].hot").forEach(x => x.classList.remove("hot"));
    if (!show) { t.hidden = true; return; }
    plot.querySelectorAll('svg [data-i="' + i + '"]').forEach(x => x.classList.add("hot"));
    let lines = []; try { lines = JSON.parse(btn.dataset.tip || "[]").filter(Boolean); } catch (e) { lines = []; }
    t.textContent = ""; lines.forEach((l, j) => { const d = document.createElement(j ? "span" : "b"); d.textContent = l; t.appendChild(d); });
    t.hidden = false;
    const pw = plot.offsetWidth, tw = t.offsetWidth, cx = btn.offsetLeft + btn.offsetWidth / 2;
    t.style.left = Math.max(0, Math.min(pw - tw, cx - tw / 2)) + "px";
    const above = btn.offsetTop - t.offsetHeight - 6;
    t.style.top = (above >= 0 ? above : btn.offsetTop + Math.min(btn.offsetHeight, 48) + 4) + "px";
  }

  /* ---------- rendu ---------- */
  function outHtml() {
    const p = rep.periode, k = rep.kpi, mv = margeView(), fam = st.groep === "familie";
    const cmpTxt = rep.vergelijking ? "Vergeleken met " + rangeTxt(rep.vergelijking) + (rep.vergelijking.kind === "jaar" ? " (zelfde periode vorig jaar)" : " (vorige periode)") + "." : "Zonder vergelijking.";
    const notes = [];
    if (mv.lineFilter) notes.push("Met een filter op product, categorie of familie tellen enkel die regels; creditnota's zitten niet in de marge per product.");
    if (st.betaling || st.regime || st.q) notes.push("De marge houdt geen rekening met " + [st.betaling && "betaling", st.regime && "btw-regime", st.q && "de zoekterm"].filter(Boolean).join(", ") + ".");
    const legend = '<div class="rp-legend" aria-hidden="true"><span><i class="rp-key-col"></i>' + K.esc(p.label) + '</span><span><i class="rp-key-line"></i>Een jaar eerder (' + K.esc(rangeTxt(rep.vorigJaar)) + ')</span></div>';
    const opt = (v, l) => '<button type="button" data-groep="' + v + '" class="' + ((fam ? "familie" : "categorie") === v ? "on" : "") + '" aria-pressed="' + ((fam ? "familie" : "categorie") === v) + '">' + l + '</button>';
    return '<p class="quiet fs-125 rp-cmp">' + K.esc(cmpTxt) + ' Datum = factuurdatum, anders leverdag. Bedragen excl. btw.</p>' + kpisHtml() +
      card("maanden", "Omzet per maand", "Kolom: " + K.esc(p.label) + " · lijn met punten: dezelfde maand een jaar eerder · klik op een maand om ze te bekijken", legend + '<div class="rp-chart" data-chart="maand"></div><p class="quiet fs-12 rp-hint" data-hint="maand" hidden>Schuif de grafiek opzij voor alle maanden.</p><details class="rp-details"><summary>Tabel per maand</summary>' + table("maanden", "Omzet per maand", COLS.maanden, rowsOf("maanden"), DEF.maanden, { limit: 400 }) + '</details>') +
      '<div class="rp-grid"><div class="rp-colm">' +
      card("klanten", "Klanten", "Top 10 op omzet · klik om op een klant te filteren", '<div class="rp-chart" data-chart="klanten"></div>' + table("klanten", "Omzet per klant", COLS.klanten, rowsOf("klanten"), DEF.klanten, { actions: r => r.id ? '<a class="btn btn-ghost btn-sm" href="/beheer#/klanten?klant=' + encodeURIComponent(r.id) + '" aria-label="Klantfiche ' + K.esc(r.naam) + '">Fiche</a><a class="btn btn-ghost btn-sm" href="/team/bestellingen?klant=' + encodeURIComponent(r.id) + '" aria-label="Bestellingen van ' + K.esc(r.naam) + '">Bestellingen</a>' : "", limit: 10 })) +
      card("groepen", fam ? "Per familie" : "Per categorie", "Aandeel in de omzet", '<div class="rp-opt-wrap"><div class="opt rp-opt" role="group" aria-label="Groeperen per">' + opt("categorie", "Categorie") + opt("familie", "Familie") + '</div></div><div class="rp-chart" data-chart="groepen"></div><details class="rp-details"><summary>Tabel</summary>' + table("groepen", "Omzet per groep", COLS.groepen, rowsOf("groepen"), DEF.groepen, { limit: 100 }) + '</details>') +
      '</div><div class="rp-colm">' +
      card("producten", "Producten", "Top 10 op omzet, met hoeveelheid · creditnota's in mindering", '<div class="rp-chart" data-chart="producten"></div>' + table("producten", "Omzet en hoeveelheid per product", COLS.producten, rowsOf("producten"), DEF.producten, { limit: 10 })) +
      card("marge", "Marge per product (schatting)", "Omzet min aankoopprijs (geleverd lot, anders laatste prijs). Schatting: gewichtsverschil en verlies tellen niet." + (notes.length ? " " + K.esc(notes.join(" ")) : ""), marge.err ? K.c.error("Marge: " + marge.err) : !marge.cur ? '<div class="card-b">' + K.c.skeleton(1) + '</div>' : '<div class="rp-chart" data-chart="marge"></div>' + table("marge", "Marge per product", COLS.marge, rowsOf("marge"), DEF.marge, { limit: 10, empty: "Geen gefactureerde regels met aankoopprijs in deze periode." }) + (marge.cur.voorraadWaarde != null ? '<p class="quiet fs-125 rp-foot">Voorraadwaarde nu: <b>' + K.eur(marge.cur.voorraadWaarde) + '</b>' + (marge.cur.voorraadZonderPrijs ? " · " + K.plural(marge.cur.voorraadZonderPrijs, "product", "producten") + " zonder aankoopprijs" : "") + '.</p>' : "")) +
      '</div></div>' +
      card("btw", "Btw-overzicht", "Per tarief · zelfde berekening als de facturen · creditnota's in mindering · totaal " + K.eur(k.btw), table("btw", "Btw per tarief", COLS.btw, rowsOf("btw"), DEF.btw)) +
      card("facturen", "Facturen en creditnota's", K.plural(rep.facturen.length, "document", "documenten") + " in " + K.esc(p.label) + " · open een factuur om ze te corrigeren of te crediteren", table("facturen", "Facturen en creditnota's van de periode", COLS.facturen, rowsOf("facturen"), DEF.facturen, { limit: 25 })) +
      card("open", "Openstaande facturen", "Alle jaren · geleverd, nog niet betaald · " + K.eur(k.openstaand) + " excl. btw", table("open", "Openstaande facturen", COLS.open, rowsOf("open"), DEF.open, { limit: 25, empty: "Geen openstaande facturen.", actions: r => '<button type="button" class="btn btn-o btn-sm" data-paid="' + K.esc(r.id) + '" aria-label="' + K.esc("Factuur " + r.nummer + " van " + r.client + " markeren als betaald") + '">Betaald</button>' }));
  }
  function render(filters) {
    return K.keep(page, () => {
      rep = window.FamoRapport.rapport(data, st, deps());
      const fbox = page.querySelector("#rpFilters");
      if (filters || !fbox || !fbox.firstChild) page.querySelector("#rpFilters").innerHTML = filtersHtml();
      page.querySelector("#rpChips").innerHTML = chipsHtml();
      page.querySelector("#rpSub").textContent = "Omzet, klanten en producten · " + rep.periode.label + " · excl. btw";
      page.querySelector("#rpOut").innerHTML = outHtml();
      paintCharts();
      loadMarge();
    });
  }
  // Marge : /api/marge pour la période et la comparaison (et le client choisi), rechargée seulement si elles changent.
  function loadMarge() {
    const p = rep.periode, c = rep.vergelijking, key = [p.van, p.tot, c ? c.van + "_" + c.tot : "", st.klant || ""].join("|");
    if (marge.key === key) return;
    marge = { key, cur: null, prev: null, err: "", busy: true };
    const q = (van, tot) => "/api/marge?van=" + van + "&tot=" + tot + (st.klant ? "&klant=" + encodeURIComponent(st.klant) : "");
    Promise.all([K.api(q(p.van, p.tot)), c ? K.api(q(c.van, c.tot)) : Promise.resolve(null)]).then(([a, b]) => {
      if (marge.key !== key) return; marge.cur = a; marge.prev = b; marge.busy = false; refreshMarge();
    }).catch(err => { if (marge.key !== key) return; marge.err = err.message; marge.busy = false; refreshMarge(); });
  }
  function refreshMarge() { K.keep(page, () => { const out = page.querySelector("#rpOut"); if (!out) return; out.innerHTML = outHtml(); paintCharts(); }); }

  /* ---------- événements ---------- */
  K.on(page, "change", "#rpPeriode", (e, t) => {
    const p = R.periode(st, K.today()), at = p.tot < K.today() ? p.tot : K.today(), v = t.value;
    const patch = { periode: v };
    if (v === "jaar") patch.jaar = at.slice(0, 4);
    if (v === "kwartaal") patch.kwartaal = at.slice(0, 4) + "-Q" + Math.ceil(Number(at.slice(5, 7)) / 3);
    if (v === "maand") patch.maand = at.slice(0, 7);
    if (v === "vrij") { patch.van = p.van; patch.tot = p.tot; }
    go(patch, { filters: true });
  });
  K.on(page, "change", "#rpJaar", (e, t) => go({ jaar: t.value }));
  K.on(page, "change", "#rpKwartaal", (e, t) => go({ kwartaal: t.value }));
  K.on(page, "change", "#rpMaand", (e, t) => go({ maand: t.value }));
  K.on(page, "change", "#rpVan, #rpTot", () => {
    const van = page.querySelector("#rpVan").value, tot = page.querySelector("#rpTot").value, bad = van && tot && tot < van;
    K.setErr("fTot", bad ? "„Tot en met” ligt vóór „van”." : "");
    if (van && tot && !bad) go({ periode: "vrij", van, tot });
  });
  K.on(page, "change", "#rpCmp", (e, t) => go({ vergelijk: t.value }));
  K.on(page, "change", "#rpKlant", (e, t) => go({ klant: t.value }));
  K.on(page, "change", "#rpCat", (e, t) => go({ categorie: t.value }));
  K.on(page, "change", "#rpProduct", (e, t) => go({ product: t.value }));
  K.on(page, "change", "#rpBetaling", (e, t) => go({ betaling: t.value }));
  K.on(page, "change", "#rpRegime", (e, t) => go({ regime: t.value }));
  const typed = K.debounce(v => { if ((st.q || "") !== v) go({ q: v }, { replace: true }); }, 300);
  K.on(page, "input", "#rpQ", (e, t) => typed(t.value.trim()));
  K.on(page, "click", "[data-clear]", (e, t) => { const k = t.dataset.clear, patch = {}; (k === "alles" ? FILTERS : [k]).forEach(x => { patch[x] = ""; }); go(patch, { filters: true }); });
  K.on(page, "click", "[data-drill]", (e, t) => {
    const k = t.dataset.drill, v = t.dataset.v;
    if (k === "maand") go({ periode: "maand", maand: v }, { filters: true });
    else go({ [k]: v }, { filters: true });
  });
  K.on(page, "click", "[data-groep]", (e, t) => go({ groep: t.dataset.groep }));
  K.on(page, "click", "[data-sort]", (e, t) => {
    const [id, k] = t.dataset.sort.split(":"), cur = sorts[id] || DEF[id], col = (COLS[id] || []).find(c => c.k === k);
    sorts[id] = cur.k === k ? { k, dir: cur.dir === "asc" ? "desc" : "asc" } : { k, dir: col && col.num ? "desc" : "asc" };
    render();
  });
  K.on(page, "click", "[data-more]", (e, t) => { more[t.dataset.more] = 100000; render(); });
  K.on(page, "pointerover", ".rp-hit", (e, t) => tip(t, true));
  K.on(page, "pointerout", ".rp-hit", (e, t) => tip(t, false));
  K.on(page, "focusin", ".rp-hit", (e, t) => tip(t, true));
  K.on(page, "focusout", ".rp-hit", (e, t) => tip(t, false));
  K.on(page, "keydown", ".rp-hit", (e, t) => { if (e.key === "Escape") tip(t, false); });
  K.on(page, "click", "[data-csv]", (e, t) => exportCsv(t.dataset.csv));
  K.on(page, "click", "[data-paid]", (e, t) => { const row = rep.open.find(r => r.id === t.dataset.paid); if (row) betaald(row, t); });
  let rz = 0; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (rep) K.keep(page, paintCharts); }, 150); });

  /* ---------- Betaald : action serveur existante (api/updateorder, beheerder, journal) ---------- */
  async function betaald(row, btn) {
    const mode = await S.askMode("Markeren als betaald", row.client + " · " + row.nummer + " · " + K.eur(row.incl) + " incl. btw"); if (!mode) return;
    K.busy(btn, true, "Opslaan…");
    try {
      await K.api("/api/updateorder", { json: { id: row.id, paiement: "Payé", modePaiement: mode } });
      S.invalidate(); await reload();
      K.toast("Gemarkeerd als betaald (" + mode + ")", { action: "Ongedaan maken", ms: 9000, onAction: async () => {
        try { await K.api("/api/updateorder", { json: { id: row.id, paiement: "En attente", reden: "Betaling meteen ongedaan gemaakt" } }); S.invalidate(); await reload(); K.toast("Terug op openstaand"); } catch (err) { K.toast(err.message, { kind: "err" }); }
      } });
    } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(btn, false); }
  }

  /* ---------- CSV (filtres appliqués, ordre du tableau) ---------- */
  function exportCsv(id) {
    const p = rep.periode, n = R.csvNum, fam = st.groep === "familie";
    const rows = sortedRows(id, rowsOf(id), DEF[id], COLS[id]);
    const T = {
      maanden: [["Maand", "Facturen", "Omzet excl. btw", "Vorig jaar", "Verschil"]].concat(rows.map(r => [r.key, r.n, n(r.omzet), n(r.vorigJaar), n(r.verschil)])),
      klanten: [["Klant", "Facturen", "Omzet excl. btw", "Aandeel %"]].concat(rows.map(r => [r.naam, r.n, n(r.omzet), n(r.aandeel)])),
      producten: [["Product", "Categorie", "Aantal", "Eenheid", "Omzet excl. btw", "Aandeel %", "Regels zonder prijs"]].concat(rows.map(r => [r.naam, r.cat, R.csvQty(r.qty), K.unit(r.unit), n(r.omzet), n(r.aandeel), r.noPrice])),
      groepen: [[fam ? "Familie" : "Categorie", "Omzet excl. btw", "Aandeel %"]].concat(rows.map(r => [r.naam, n(r.omzet), n(r.aandeel)])),
      marge: [["Product", "Aantal", "Eenheid", "Omzet excl. btw", "Aankoop", "Marge", "Marge %", "Omzet zonder aankoopprijs"]].concat(rows.map(r => [r.produit, R.csvQty(r.qty), K.unit(r.unit), n(r.omzet), n(r.kost), n(r.marge), n(r.pct), n(r.zonderKost)])),
      btw: [["Tarief %", "Grondslag", "Btw", "Incl. btw"]].concat(rows.map(r => [n(r.rate), n(r.base), n(r.tva), n(r.incl)])),
      facturen: [["Datum", "Type", "Nummer", "Referentie", "Klant", "Excl. btw", "Incl. btw", "Betaling"]].concat(rows.map(r => [r.dag, r.type === "creditnota" ? "Creditnota" : "Factuur", r.nummer, r.ref, r.client, n(r.bedrag), n(r.incl), K.pay(r.paiement)])),
      open: [["Factuur", "Referentie", "Klant", "Datum", "Vervalt", "Excl. btw", "Incl. btw"]].concat(rows.map(r => [r.nummer, r.ref, r.client, r.dag, r.vervalt, n(r.bedrag), n(r.incl)]))
    }[id];
    if (!T) return;
    const filtered = FILTERS.some(k => st[k]), name = "famo-" + id + (id === "open" ? "" : "-" + p.van + "_" + p.tot) + (filtered ? "-gefilterd" : "") + ".csv";
    const blob = new Blob([R.csv(T)], { type: "text/csv;charset=utf-8" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    K.toast("CSV gedownload: " + name);
  }

  /* ---------- chargement ---------- */
  async function reload() { data = await K.api("/api/rapportage"); render(); }
  page.innerHTML = '<div class="page-h"><div><h1 class="h1">Rapportage</h1><p class="sub" id="rpSub">Omzet, klanten en producten · excl. btw</p></div></div><div class="content pt-16"><div id="rpFilters"></div><div id="rpChips"></div><div id="rpOut" class="rp-out">' + K.c.skeleton(3) + '</div></div>';
  try { data = await K.api("/api/rapportage"); }
  catch (err) {
    if (err.status !== 401) page.querySelector("#rpOut").innerHTML = K.c.error(err.message, true);
    K.on(page, "click", "[data-retry]", e => { e.preventDefault(); location.reload(); });
    return;
  }
  render(true);
  if (window.S && S.load) S.load().catch(() => {}); // pastilles de la navigation
})();
