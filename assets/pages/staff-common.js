/* Gedeeld door de personeels- en beheerpagina's: bestellingen laden, fiche, levering bevestigen, documenten. */
(function (global) {
  const S = { orders: [], config: null, loadedAt: 0, btw: {}, window: 0, all: false };
  // all = true → ?all=1 : volledige historiek (export, oude zoekopdracht) ; anders het venster van de server (window dagen).
  S.load = async function (force, all) {
    if (all && !S.all) { S.all = true; force = true; }
    if (!force && S.orders.length && Date.now() - S.loadedAt < 60 * 1000) return S;
    const [o, c] = await Promise.all([K.api("/api/allorders" + (S.all ? "?all=1" : "")), S.config ? Promise.resolve({ config: S.config }) : K.api("/api/config").catch(() => ({ config: null }))]);
    S.orders = (o.orders || []).map(x => Object.assign(x, { late: K.isLate(x), day: x.dateLiv || x.date || "" }));
    S.btw = o.btwPerProduct && typeof o.btwPerProduct === "object" ? o.btwPerProduct : {};
    S.window = Number(o.window) || 0;
    S.config = c.config || S.config; S.loadedAt = Date.now();
    if (global.FamoDocuments && S.config) FamoDocuments.setCompany(S.config);
    return S;
  };
  S.byId = id => S.orders.find(o => o.id === id);
  S.counts = () => { const t = K.today(); return { today: S.orders.filter(o => o.day === t && !K.isClosed(o)).length, prep: S.orders.filter(o => o.statut === "Reçue").length, ready: S.orders.filter(o => o.statut === "Prête").length, road: S.orders.filter(o => o.statut === "Sortie en livraison").length, late: S.orders.filter(o => o.late).length, unpaid: S.orders.filter(o => o.statut === "Facturée" && o.paiement !== "Payé").length, unpaidSum: S.orders.filter(o => o.statut === "Facturée" && o.paiement !== "Payé").reduce((s, o) => s + Number(o.total || 0), 0) }; };
  S.update = async function (id, payload) { const d = await K.api("/api/updateorder", { json: Object.assign({ id }, payload) }); await S.load(true); return d; };
  S.lineTxt = o => K.linesSummary(o.lignes);
  // Mailresultaat van de server (nooit blokkerend) in één woord voor de toast.
  S.mailTxt = m => m && m.ok ? " · klant gemaild" : (m && m.skipped === "no-recipient" ? " · geen e-mailadres bij klant" : "");

  /* ---------- btw : tarief per product (Catalogus) of standaardtarief (Configuratie) ---------- */
  S.rate = name => { const k = String(name || "").trim().toLowerCase(); const r = Number(S.btw[k]); if (Number.isFinite(r) && r > 0) return r; const d = Number(S.config && S.config.btwTarief); return Number.isFinite(d) && d > 0 ? d : 6; };
  // { "productnaam": tarief } voor de lijnen van deze bestelling (wat documents.js leest als order.btwPerLine).
  S.btwPerLine = o => { const m = {}; K.parseLines(o.lignes).forEach(l => { m[l.name.trim().toLowerCase()] = S.rate(l.name); }); return m; };
  // Bedragen excl. / btw / incl., per tarief afgerond op de cent (zelfde regel als de factuur).
  S.totals = o => {
    const lines = K.parseLines(o.lignes).filter(l => l.price != null), acc = new Map();
    if (lines.length) lines.forEach(l => { const r = S.rate(l.name); acc.set(r, (acc.get(r) || 0) + l.price * l.qty); }); else acc.set(S.rate(""), Number(o.total) || 0);
    let excl = 0, btw = 0; acc.forEach((base, r) => { base = Math.round(base * 100) / 100; excl += base; btw += Math.round(base * r) / 100; });
    excl = Math.round(excl * 100) / 100; btw = Math.round(btw * 100) / 100;
    return { excl, btw, incl: Math.round((excl + btw) * 100) / 100 };
  };
  S.docOrder = o => Object.assign({}, o, { btwPerLine: S.btwPerLine(o) });

  /* ---------- documenten ---------- */
  S.openDoc = function (o, type) {
    if (!global.FamoDocuments || !global.famoDocPreview) { K.toast("Documentmodule niet geladen.", { kind: "err" }); return; }
    if (S.config) FamoDocuments.setCompany(S.config);
    try {
      const html = FamoDocuments.build(S.docOrder(o), type);
      famoDocPreview.open({ html, filename: FamoDocuments.filename(o, type), title: type === "invoice" ? "Factuur " + (o.factuurnummer || "") : type === "credit" ? "Creditnota " + (o.creditnota && o.creditnota.nummer || "") : "Leveringsbon " + o.ref, meta: o.client + " · " + K.eur(type === "credit" && o.creditnota ? o.creditnota.montant : o.total) + " excl. btw" });
    } catch (e) { K.toast(e.message || "Document kon niet worden gemaakt.", { kind: "err" }); }
  };
  // Bundel : alle leveringsbonnen / facturen van een selectie in één document (één PDF).
  S.openDocs = function (orders, type) {
    if (!global.FamoDocuments || !global.famoDocPreview) { K.toast("Documentmodule niet geladen.", { kind: "err" }); return; }
    if (S.config) FamoDocuments.setCompany(S.config);
    const list = (orders || []).filter(o => o.statut !== K.CANCELLED && (type !== "invoice" || o.factuurnummer) && (type !== "credit" || o.creditnota));
    if (!list.length) { K.toast("Geen documenten in deze selectie."); return; }
    if (list.length === 1) { S.openDoc(list[0], type); return; }
    try {
      const html = FamoDocuments.buildMany(list.map(S.docOrder), type);
      famoDocPreview.open({ html, filename: FamoDocuments.filenameMany(type), title: (type === "invoice" ? "Facturen" : type === "credit" ? "Creditnota's" : "Leveringsbonnen") + " (" + list.length + ")", meta: list.length + " documenten · " + K.eur(list.reduce((s, o) => s + Number(type === "credit" ? (o.creditnota && o.creditnota.montant) || 0 : o.total || 0), 0)) + " excl. btw" });
    } catch (e) { K.toast(e.message || "Documenten konden niet worden gebundeld.", { kind: "err" }); }
  };
  S.pickingHtml = function (orders, dayLabel) {
    const agg = new Map();
    orders.forEach(o => K.parseLines(o.lignes).forEach(l => { const k = l.name.toLowerCase() + "|" + l.unit; const a = agg.get(k) || { name: l.name, unit: l.unit, qty: 0, orders: new Set() }; a.qty += l.qty; a.orders.add(o.client); agg.set(k, a); }));
    const rows = Array.from(agg.values()).sort((a, b) => a.name.localeCompare(b.name, "nl"));
    return '<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Verzamellijst</title><style>body{font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111;padding:32px}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#666}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;border-bottom:1px solid #ccc;padding:6px 4px}td{padding:9px 4px;border-bottom:1px solid #eee;vertical-align:top}.n{text-align:right;font-weight:600;font-size:15px;white-space:nowrap}.box{width:16px;height:16px;border:2px solid #333;display:inline-block;border-radius:3px}</style></head><body><h1>Verzamellijst · ' + K.esc(dayLabel) + '</h1><p>' + orders.length + ' bestelling' + (orders.length === 1 ? "" : "en") + ' · ' + rows.length + ' product' + (rows.length === 1 ? "" : "en") + ' · afgedrukt ' + K.esc(K.dateLong(K.today())) + '</p><table><thead><tr><th></th><th>Product</th><th>Voor</th><th style="text-align:right">Nodig</th></tr></thead><tbody>' + rows.map(r => '<tr><td><span class="box"></span></td><td>' + K.esc(r.name) + '</td><td>' + K.esc(Array.from(r.orders).join(", ")) + '</td><td class="n">' + K.esc(K.qty(r.qty) + " " + K.unit(r.unit)) + '</td></tr>').join("") + '</tbody></table><h1 style="margin-top:28px;font-size:16px">Per bestelling</h1><table><thead><tr><th>Klant</th><th>Artikelen</th><th>Ref.</th></tr></thead><tbody>' + orders.map(o => '<tr><td><b>' + K.esc(o.client) + '</b><br><span style="color:#666">' + K.esc((o.klant && o.klant.adresse || "").replace(/\n/g, ", ")) + '</span></td><td>' + K.parseLines(o.lignes).map(l => K.esc(K.qty(l.qty) + " " + K.unit(l.unit) + " " + l.name + (l.comment ? " — " + l.comment : ""))).join("<br>") + (o.notes ? '<br><i style="color:#7A5410">' + K.esc(o.notes) + '</i>' : "") + '</td><td>' + K.esc(o.ref) + '</td></tr>').join("") + '</tbody></table></body></html>';
  };
  S.openPicking = function (orders, dayLabel) { if (!global.famoDocPreview) return; famoDocPreview.open({ html: S.pickingHtml(orders, dayLabel), filename: famoDocPreview.filenameFor("picking", { date: dayLabel }), title: "Verzamellijst", meta: dayLabel }); };
  // CSV : puntkomma, BOM voor Excel, cellen tussen aanhalingstekens. Een cel die met = + - @ tab of CR
  // begint krijgt een apostrof vooraan : anders voert een rekenblad ze als formule uit.
  S.csvCell = v => { let s = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  S.csvDownload = function (rows, name) { const csv = rows.map(r => r.map(S.csvCell).join(";")).join("\r\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); };

  /* ---------- fiche : blokken die order.html en de panelen delen ---------- */
  S.UITZ = ["Afwezig", "Geweigerd", "Gedeeltelijk", "Beschadigd"];
  S.MODES = ["Contant", "Overschrijving", "Bancontact", "Andere"];
  S.telLink = (tel, label) => tel ? '<a class="btn btn-o btn-sm" href="tel:' + K.esc(String(tel).replace(/[^+\d]/g, "")) + '">' + K.icon("phone") + K.esc(label || "Bellen") + '</a>' : "";
  S.when = v => v ? K.date(K.isoDay(v)) + " " + K.time(v) : "";
  S.uitzTag = o => o.uitzondering ? '<span class="tag" style="color:var(--danger);border-color:var(--danger-line)" title="' + K.esc(o.uitzonderingNota || "") + '">' + K.esc(o.uitzondering) + '</span>' : "";
  S.payTxt = o => o.paiement === "Payé" ? "Betaald" + (o.payeLe ? " op " + S.when(o.payeLe) : "") + (o.modePaiement ? " · " + o.modePaiement : "") : "Openstaand";
  // Journaal (Correcties + uitzondering + creditnota) als tijdlijn-items (.tl).
  S.journalHtml = o => String(o.correcties || "").split("\n").map(s => s.trim()).filter(Boolean).map(c => '<div><i style="background:var(--st-new)"></i><div>' + (/^.*?·\s*(Creditnota|Betaald|Terug op openstaand|Uitzondering)/.test(c) ? "Journaal" : "Correctie") + '<small>' + K.esc(c) + '</small></div></div>').join("");
  S.creditnotaHtml = o => { const cn = o.creditnota; if (!cn) return ""; return '<div class="notice" style="background:var(--canvas)"><div><b>Creditnota ' + K.esc(cn.nummer) + '</b> · ' + K.esc(K.eur(cn.montant)) + ' excl. btw' + (cn.le ? ' · ' + K.esc(S.when(cn.le)) : "") + (cn.motif ? '<div class="quiet" style="font-size:12px">„' + K.esc(cn.motif) + '”</div>' : "") + '<div class="quiet" style="font-size:12px">' + K.esc(K.linesSummary(cn.lignes)) + '</div><div style="margin-top:6px"><button type="button" class="btn btn-o btn-sm" data-act="credit" data-id="' + o.id + '">' + K.icon("print") + 'Creditnota</button></div></div></div>'; };
  S.creditnotaBtn = o => K.staff.isAdmin() && o.statut === "Facturée" && !o.creditnota ? '<button type="button" class="btn btn-o btn-sm" data-act="creditnota" data-id="' + o.id + '">Creditnota maken</button>' : "";

  /* ---------- levering bevestigen (sheet) ---------- */
  S.confirmDelivery = function (o, onDone) {
    const t = S.totals(o);
    const p = K.panel({ title: "Ontvangst bevestigen", sub: o.client + " · " + o.ref, body:
      '<div class="notice" style="background:var(--canvas)"><div><b>' + K.esc(S.lineTxt(o)) + '</b><div class="quiet" style="font-size:12px;margin-top:2px">' + K.esc((o.klant && o.klant.adresse || "").replace(/\n/g, ", ")) + (o.notes ? ' · „' + K.esc(o.notes) + '”' : "") + '</div><div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b class="mono">Te innen (incl. btw): ' + K.esc(K.eur(t.incl)) + '</b><span class="quiet" style="font-size:12px">' + K.esc(K.eur(t.excl)) + ' excl. + ' + K.esc(K.eur(t.btw)) + ' btw</span>' + S.telLink(o.klant && o.klant.tel) + '</div></div></div>' +
      K.c.field("Ontvangen door", K.c.input("recipient", { placeholder: "Naam van wie de levering aanneemt", attrs: ' autocomplete="off"' }), { id: "fRec", req: true }) +
      K.c.field("Betaling", '<div class="opt"><button type="button" data-pay="En attente" class="on">Later / overschrijving</button><button type="button" data-pay="Payé">Contant betaald · ' + K.eur(t.incl) + '</button></div>', { id: "fPay" }) +
      K.c.field("Uitzondering (optioneel)", '<select class="input" id="uitz"><option value="">Geen · levering in orde</option>' + S.UITZ.map(u => '<option>' + u + '</option>').join("") + '</select>', { id: "fUitz", hint: "Afwezig, geweigerd, gedeeltelijk of beschadigd: wordt bij de bestelling bewaard en in het journaal genoteerd." }) +
      '<div id="fUitzNota" style="display:none">' + K.c.field("Nota bij de uitzondering", K.c.input("uitzNota", { placeholder: "bv. 2 kg zalm geweigerd, doos beschadigd", attrs: ' maxlength="200" autocomplete="off"' }), {}) + '</div>' +
      K.c.field("Bewijs (optioneel)", K.c.input("proof", { type: "url", placeholder: "https://… link naar foto of handtekening" }), { id: "fProof", hint: "Enkel een https-link wordt bewaard. Foto's uploaden komt in een volgende versie." }) +
      '<div class="notice" style="font-size:12.5px"><div><b>Wat gebeurt er:</b> status → Geleverd, het factuurnummer wordt toegekend, de factuur is meteen beschikbaar en de klant krijgt ze per e-mail.</div></div><div id="dErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="dOk">Bevestigen</button>' });
    let pay = "En attente";
    K.on(p.el, "click", "[data-pay]", (e, t2) => { pay = t2.dataset.pay; K.$$("[data-pay]", p.el).forEach(b => b.classList.toggle("on", b === t2)); });
    p.el.querySelector("#uitz").onchange = e => { p.el.querySelector("#fUitzNota").style.display = e.target.value ? "" : "none"; };
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#dOk").onclick = async () => {
      const rec = p.el.querySelector("#recipient").value.trim(), proof = p.el.querySelector("#proof").value.trim(), uitz = p.el.querySelector("#uitz").value, nota = p.el.querySelector("#uitzNota").value.trim();
      K.setErr("fRec", rec ? "" : "Verplicht: naam van wie de levering aanneemt."); if (!rec) return;
      if (proof && !/^https:\/\//i.test(proof)) { K.setErr("fProof", "De link moet met https:// beginnen."); return; }
      const btn = p.el.querySelector("#dOk"); K.busy(btn, true, "Bevestigen…");
      try {
        const d = await S.update(o.id, Object.assign({ statut: "Facturée", deliveryConfirmed: true, recipient: rec, proofUrl: proof || undefined, paiement: pay === "Payé" ? "Payé" : undefined, modePaiement: pay === "Payé" ? "Contant" : undefined }, uitz ? { uitzondering: uitz, uitzonderingNota: nota } : {}));
        p.close(); K.toast("Geleverd · factuur " + (d.factuurnummer || "") + " aangemaakt" + S.mailTxt(d.mail)); if (onDone) onDone(d);
      } catch (err) {
        // Al bevestigd (dubbele tik, tweede toestel) : niets te herstellen, gewoon verversen.
        if (err.status === 409 && /al bevestigd/i.test(err.message)) { p.close(); K.toast(err.message); try { await S.load(true); } catch (e2) { /* toast volstaat */ } if (onDone) onDone(); return; }
        p.el.querySelector("#dErr").innerHTML = K.c.error(err.message); K.busy(btn, false);
      }
    };
  };

  /* ---------- artikelen valideren + klaarzetten (paneel) ---------- */
  S.validatePanel = function (o, onDone) {
    const orig = K.parseLines(o.lignes);
    const lines = orig.map(l => Object.assign({}, l));
    const state = lines.map(() => false);
    let catalogue = null;
    const isKg = u => /kg/i.test(u);
    const lineHtml = (l, i) => '<div class="line" data-i="' + i + '">' + K.c.check(state[i], 'data-v="' + i + '"', { label: "Gecontroleerd: " + l.name }) + '<div><b>' + K.esc(l.name) + '</b>' + (l.comment ? '<div class="quiet" style="font-size:12px">„' + K.esc(l.comment) + '”</div>' : "") + (l.added ? '<div class="quiet" style="font-size:12px">toegevoegd · prijs volgens afspraak klant</div>' : "") + '</div><div class="stepper" data-q="' + i + '"><button type="button" data-dec aria-label="Minder">−</button><input type="number" inputmode="decimal" min="0" step="' + (isKg(l.unit) ? 0.5 : 1) + '" value="' + l.qty + '"><button type="button" data-inc aria-label="Meer">+</button></div><span class="tag">' + K.esc(K.unit(l.unit)) + '</span></div>';
    const p = K.panel({ title: "Artikelen valideren", sub: o.client + " · " + o.ref + " · levering " + K.relDay(o.day), body:
      '<div class="card" id="vl"></div>' +
      '<div id="vAdd" style="display:none">' + K.c.field("Product toevoegen", '<div style="display:flex;gap:6px"><input class="input" id="vSearch" list="vList" placeholder="Zoek in de catalogus…" autocomplete="off" style="flex:1"><datalist id="vList"></datalist><button type="button" class="btn btn-o" id="vAddOk">Toevoegen</button></div>', { id: "fVAdd", hint: "De prijs wordt op de server bepaald (afgesproken prijs van de klant, anders basisprijs)." }) + '</div>' +
      '<button type="button" class="addrow" id="vAddBtn" style="width:100%">' + K.icon("plus") + 'Product toevoegen</button>' +
      (o.notes ? K.c.warn("<b>Nota klant:</b> " + K.esc(o.notes)) : "") + '<div class="quiet" style="font-size:12.5px">Pas een aantal aan als u minder kunt leveren; het totaal wordt op de server herberekend.</div><div id="vErr"></div>',
      footer: '<span class="muted" id="vCount" style="margin-right:auto;font-size:12.5px">0 van ' + lines.length + ' gecontroleerd</span><button type="button" class="btn btn-o" data-cancel>Later</button><button type="button" class="btn btn-p" id="vOk" disabled>Klaarzetten</button>' });
    const refresh = () => { const n = state.filter(Boolean).length; p.el.querySelector("#vCount").textContent = n + " van " + lines.length + " gecontroleerd"; p.el.querySelector("#vOk").disabled = n !== lines.length; };
    const draw = () => {
      p.el.querySelector("#vl").innerHTML = lines.map(lineHtml).join("");
      K.$$("[data-q]", p.el).forEach(st => { const i = +st.dataset.q, inp = st.querySelector("input"), step = isKg(lines[i].unit) ? 0.5 : 1; const set = v => { v = Math.max(0, isKg(lines[i].unit) ? Math.round(v * 1000) / 1000 : Math.round(v)); lines[i].qty = v; inp.value = v; }; st.querySelector("[data-dec]").onclick = () => set(Number(inp.value) - step); st.querySelector("[data-inc]").onclick = () => set(Number(inp.value) + step); inp.addEventListener("change", () => set(Number(String(inp.value).replace(",", ".")) || 0)); });
      refresh();
    };
    draw();
    K.on(p.el, "click", "[data-v]", (e, t) => { const i = +t.dataset.v; state[i] = !state[i]; K.setOn(t, state[i]); refresh(); });
    p.el.querySelector("#vAddBtn").onclick = async () => {
      const box = p.el.querySelector("#vAdd"); box.style.display = ""; p.el.querySelector("#vAddBtn").style.display = "none";
      if (!catalogue) {
        try { const d = await K.api("/api/staff?client=" + encodeURIComponent(o.clientId || "")); catalogue = d.products || []; }
        catch (err) { p.el.querySelector("#vErr").innerHTML = K.c.error(err.message); catalogue = []; }
        p.el.querySelector("#vList").innerHTML = catalogue.map(pr => '<option value="' + K.esc(pr.nom) + '">' + K.esc(K.eur(pr.prix) + " / " + K.unit(pr.unite) + (pr.kaliber ? " · " + pr.kaliber : "")) + '</option>').join("");
      }
      p.el.querySelector("#vSearch").focus();
    };
    const addProduct = () => {
      const q = p.el.querySelector("#vSearch").value.trim().toLowerCase(); if (!q) return;
      const pr = (catalogue || []).find(x => String(x.nom).toLowerCase() === q) || (catalogue || []).find(x => String(x.nom).toLowerCase().includes(q));
      if (!pr) { K.setErr("fVAdd", "Niet gevonden in de catalogus."); return; }
      K.setErr("fVAdd", "");
      const i = lines.findIndex(l => l.name.toLowerCase() === String(pr.nom).toLowerCase());
      if (i >= 0) { lines[i].qty += 1; } else { lines.push({ name: pr.nom, qty: 1, unit: pr.unite || "", price: null, comment: "", added: true }); state.push(false); }
      p.el.querySelector("#vSearch").value = ""; draw();
    };
    p.el.querySelector("#vAddOk").onclick = addProduct;
    p.el.querySelector("#vSearch").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addProduct(); } });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#vOk").onclick = async () => {
      const kept = lines.filter(l => l.qty > 0); if (!kept.length) { p.el.querySelector("#vErr").innerHTML = K.c.error("Minstens één artikel met een aantal groter dan 0."); return; }
      const btn = p.el.querySelector("#vOk"); K.busy(btn, true, "Klaarzetten…");
      const changed = kept.length !== orig.length || kept.some(l => { const x = orig.find(y => y.name === l.name); return !x || x.qty !== l.qty; });
      try {
        await S.update(o.id, Object.assign({ statut: "Prête", preparationValidee: true }, changed ? { lignes: kept.map(K.formatLine).join("\n") } : {}));
        p.close(); K.toast(o.client + " staat klaar"); if (onDone) onDone();
      } catch (err) { p.el.querySelector("#vErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  };
  // Vertrek : de server beslist over de voorraad (Beheer → « Voorraad afboeken ») en mailt de klant.
  S.depart = async function (o, onDone) {
    if (!(await K.confirm({ title: "Ronde vertrekt?", text: o.client + " · " + o.ref + " gaat op Onderweg. Daarna kunnen de artikelen niet meer gewijzigd worden.", yes: "Vertrekken" }))) return;
    try { const d = await S.update(o.id, { statut: "Sortie en livraison" }); K.toast(o.client + " is onderweg" + (d.stock && d.stock.done && d.stock.done.length ? " · voorraad afgeboekt" : "") + S.mailTxt(d.mail)); if (onDone) onDone(d); } catch (err) { K.toast(err.message, { kind: "err" }); }
  };
  // Betaalwijze kiezen (één keer, ook voor een groepsactie). null = geannuleerd.
  S.askMode = (title, text) => new Promise(resolve => {
    let mode = S.MODES[0], result = null;
    const p = K.panel({ title: title || "Markeren als betaald", sub: text || "", body: K.c.field("Betaalwijze", '<div class="opt">' + S.MODES.map((m, i) => '<button type="button" data-mode="' + m + '"' + (i === 0 ? ' class="on"' : "") + '>' + m + '</button>').join("") + '</div>', { id: "fMode" }) + '<div class="quiet" style="font-size:12.5px">Enkel een gefactureerde bestelling kan op betaald gezet worden. Datum en wijze komen op de factuur en in het journaal.</div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="mOk">Betaald</button>', onClose: () => resolve(result) });
    K.on(p.el, "click", "[data-mode]", (e, t) => { mode = t.dataset.mode; K.$$("[data-mode]", p.el).forEach(b => b.classList.toggle("on", b === t)); });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#mOk").onclick = () => { result = mode; p.close(); };
  });
  S.togglePaid = async function (o, onDone) {
    const paid = o.paiement === "Payé", t = S.totals(o);
    if (paid) {
      if (!(await K.confirm({ title: "Terug op openstaand?", text: o.client + " · " + (o.factuurnummer || o.ref) + " · " + K.eur(t.incl) + " incl. btw", yes: "Terug op openstaand" }))) return;
      try { await S.update(o.id, { paiement: "En attente" }); K.toast("Terug op openstaand"); if (onDone) onDone(); } catch (err) { K.toast(err.message, { kind: "err" }); }
      return;
    }
    const mode = await S.askMode("Markeren als betaald", o.client + " · " + (o.factuurnummer || o.ref) + " · " + K.eur(t.incl) + " incl. btw"); if (!mode) return;
    try { await S.update(o.id, { paiement: "Payé", modePaiement: mode }); K.toast("Gemarkeerd als betaald (" + mode + ")"); if (onDone) onDone(); } catch (err) { K.toast(err.message, { kind: "err" }); }
  };
  /* ---------- creditnota (paneel, enkel beheerder, enkel op een gefactureerde bestelling) ---------- */
  S.creditnotaPanel = function (o, onDone) {
    if (o.creditnota) { K.toast("Er bestaat al een creditnota (" + o.creditnota.nummer + ") op deze factuur."); return; }
    const lines = K.parseLines(o.lignes), pick = lines.map(l => ({ on: false, qty: l.qty }));
    const isKg = u => /kg/i.test(u);
    const p = K.panel({ title: "Creditnota maken", sub: o.client + " · factuur " + (o.factuurnummer || o.ref), body:
      '<div class="field"><label>Te crediteren artikelen</label><div class="card" id="cnL">' + lines.map((l, i) => '<div class="line" data-i="' + i + '">' + K.c.check(false, 'data-cn="' + i + '"', { label: "Crediteren: " + l.name }) + '<div><b>' + K.esc(l.name) + '</b><div class="quiet" style="font-size:12px">geleverd ' + K.esc(K.qty(l.qty) + " " + K.unit(l.unit)) + (l.price != null ? " · " + K.esc(K.eur(l.price)) : "") + '</div></div><div class="stepper" data-q="' + i + '"><button type="button" data-dec aria-label="Minder">−</button><input type="number" inputmode="decimal" min="0" max="' + l.qty + '" step="' + (isKg(l.unit) ? 0.5 : 1) + '" value="' + l.qty + '"><button type="button" data-inc aria-label="Meer">+</button></div><span class="tag">' + K.esc(K.unit(l.unit)) + '</span></div>').join("") + '</div></div>' +
      K.c.field("Reden", K.c.input("cnMotif", { placeholder: "bv. 2 kg zalm geweigerd bij levering", attrs: ' maxlength="200" autocomplete="off"' }), { id: "fCnMotif", req: true, hint: "Komt op de creditnota en in het journaal." }) +
      '<label class="line" style="grid-template-columns:44px minmax(0,1fr);cursor:pointer;border:1px solid var(--line);border-radius:8px">' + K.c.check(false, 'id="cnRetour"', { label: "Retour in voorraad" }) + '<div><b>Retour in voorraad</b><div class="quiet" style="font-size:12px">De gecrediteerde aantallen gaan terug in de voorraad (beweging „Klantretour”).</div></div></label>' +
      '<div class="notice" style="font-size:12.5px;margin-top:10px"><div><b>Bedrag:</b> <span id="cnSum" class="mono">' + K.esc(K.eur(0)) + '</span> excl. btw · nummer CN-… wordt op de server toegekend. Eén creditnota per factuur.</div></div><div id="cnErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="cnOk" disabled>Creditnota maken</button>' });
    let retour = false;
    const sum = () => { const s = pick.reduce((a, x, i) => a + (x.on && lines[i].price != null ? lines[i].price * x.qty : 0), 0); p.el.querySelector("#cnSum").textContent = K.eur(s); p.el.querySelector("#cnOk").disabled = !pick.some(x => x.on && x.qty > 0); };
    K.on(p.el, "click", "[data-cn]", (e, t) => { const i = +t.dataset.cn; pick[i].on = !pick[i].on; K.setOn(t, pick[i].on); sum(); });
    K.$$("[data-q]", p.el).forEach(st => { const i = +st.dataset.q, inp = st.querySelector("input"), step = isKg(lines[i].unit) ? 0.5 : 1; const set = v => { v = Math.min(lines[i].qty, Math.max(0, isKg(lines[i].unit) ? Math.round(v * 1000) / 1000 : Math.round(v))); pick[i].qty = v; inp.value = v; sum(); }; st.querySelector("[data-dec]").onclick = () => set(Number(inp.value) - step); st.querySelector("[data-inc]").onclick = () => set(Number(inp.value) + step); inp.addEventListener("change", () => set(Number(String(inp.value).replace(",", ".")) || 0)); });
    p.el.querySelector("#cnRetour").onclick = e => { retour = !retour; K.setOn(e.currentTarget, retour); };
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#cnOk").onclick = async () => {
      const motif = p.el.querySelector("#cnMotif").value.trim();
      K.setErr("fCnMotif", motif.length >= 3 ? "" : "Verplicht: geef een reden (minstens 3 tekens)."); if (motif.length < 3) return;
      const chosen = lines.map((l, i) => ({ name: l.name, qty: pick[i].qty, unit: l.unit, price: null, comment: "" })).filter((l, i) => pick[i].on && l.qty > 0);
      if (!(await K.confirm({ title: "Creditnota maken?", text: o.client + " · " + chosen.map(l => K.qty(l.qty) + "× " + l.name).join(", ") + (retour ? " · terug in voorraad" : ""), yes: "Creditnota maken" }))) return;
      const btn = p.el.querySelector("#cnOk"); K.busy(btn, true, "Bezig…");
      try {
        const d = await S.update(o.id, { creditnota: { lignes: chosen.map(K.formatLine).join("\n"), motif, retourStock: retour } });
        p.close(); K.toast("Creditnota " + (d.creditnota && d.creditnota.nummer || "") + " · " + K.eur(d.creditnota && d.creditnota.montant || 0) + (d.stock && d.stock.done && d.stock.done.length ? " · voorraad teruggezet" : "")); if (onDone) onDone(d);
      } catch (err) { p.el.querySelector("#cnErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  };
  /* ---------- corrigeren (paneel) : één marche arrière, annuleren, herstellen ---------- */
  // Welke correcties er mogelijk zijn hangt af van status en rol. De server beslist
  // opnieuw ; hier tonen we enkel wat zinvol is, met de gevolgen in klare taal.
  S.corrections = function (o) {
    const admin = K.staff.isAdmin(), st = o.statut, out = [];
    if (st === "Prête") out.push({ correction: "terug", title: "Terug naar te bereiden", text: "De validatie van de artikelen wordt gewist. Het magazijn valideert opnieuw." });
    if (st === "Sortie en livraison") out.push({ correction: "terug", title: "Terug naar klaar (vertrek ongedaan)", text: "De bestelling is toch niet vertrokken. Afgeboekte voorraad wordt teruggezet." });
    if (st === "Facturée") out.push({ correction: "terug", title: "Ontvangst ongedaan maken", text: "Terug op Onderweg. Het factuurnummer blijft voorbehouden voor deze bestelling. Enkel beheerder, niet als de factuur op betaald staat of er al een creditnota is.", admin: true, danger: true });
    if (st === "Reçue" || st === "Prête") out.push({ correction: "annuleren", title: "Bestelling annuleren", text: "De bestelling verdwijnt uit Magazijn en Leveringen. Ze blijft zichtbaar onder „Geannuleerd” en kan hersteld worden.", danger: true });
    if (st === "Sortie en livraison") out.push({ correction: "annuleren", title: "Bestelling annuleren (al onderweg)", text: "Enkel beheerder. Afgeboekte voorraad wordt teruggezet.", admin: true, danger: true });
    if (st === "Annulée") out.push({ correction: "herstellen", title: "Herstellen", text: "Terug naar „Ontvangen”. Het magazijn valideert opnieuw." });
    return out.filter(c => !c.admin || admin);
  };
  S.correctPanel = function (o, onDone) {
    const opts = S.corrections(o);
    const p = K.panel({ title: "Corrigeren", sub: o.client + " · " + o.ref + " · nu: " + K.status(o.statut), body:
      (opts.length ? '<div class="field"><label>Wat wilt u doen?</label><div class="card" id="cOpts">' + opts.map((c, i) => '<label class="line" style="grid-template-columns:44px minmax(0,1fr);cursor:pointer" data-copt="' + i + '">' + K.c.check(false, 'data-cchk="' + i + '"', { label: c.title }) + '<div><b' + (c.danger ? ' style="color:var(--danger)"' : "") + '>' + K.esc(c.title) + '</b><div class="quiet" style="font-size:12px">' + K.esc(c.text) + '</div></div></label>').join("") + '</div></div>' : K.c.warn(o.statut === "Facturée" ? "Geleverd en gefactureerd. Terugdraaien kan enkel een beheerder; een fout in de aantallen wordt met een creditnota rechtgezet." : "Geen correctie mogelijk in deze stap.")) +
      (o.statut === "Facturée" && o.paiement === "Payé" ? K.c.warn("Deze factuur staat op <b>betaald</b>. Zet ze eerst terug op openstaand (fiche → „Terug op openstaand”).") : "") +
      (o.statut === "Facturée" && o.creditnota ? K.c.warn("Er bestaat al een creditnota (<b>" + K.esc(o.creditnota.nummer) + "</b>) op deze factuur: de ontvangst kan niet meer ongedaan gemaakt worden.") : "") +
      K.c.field("Reden", K.c.input("cReden", { placeholder: "bv. klant belde af, verkeerde dag, per ongeluk vertrokken", attrs: ' maxlength="200" autocomplete="off"' }), { id: "fReden", req: true, hint: "Wordt bij de bestelling bewaard (Correcties)." }) +
      '<div id="cErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="cOk" disabled>Bevestigen</button>' });
    let chosen = -1;
    K.on(p.el, "click", "[data-copt]", (e, t) => { e.preventDefault(); chosen = +t.dataset.copt; K.$$("[data-cchk]", p.el).forEach(c => c.classList.toggle("on", +c.dataset.cchk === chosen)); K.$$("[data-copt]", p.el).forEach(l => l.classList.toggle("ok", +l.dataset.copt === chosen)); const b = p.el.querySelector("#cOk"); b.disabled = false; b.textContent = opts[chosen].title; b.className = "btn " + (opts[chosen].danger ? "btn-danger" : "btn-p"); });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#cOk").onclick = async () => {
      const reden = p.el.querySelector("#cReden").value.trim();
      K.setErr("fReden", reden.length >= 3 ? "" : "Verplicht: geef een reden (minstens 3 tekens)."); if (reden.length < 3 || chosen < 0) return;
      const c = opts[chosen];
      if (c.danger && !(await K.confirm({ title: c.title + "?", text: o.client + " · " + o.ref + ". " + c.text, yes: c.title, danger: true }))) return;
      const btn = p.el.querySelector("#cOk"); K.busy(btn, true, "Bezig…");
      try {
        const d = await S.update(o.id, { correction: c.correction, reden });
        p.close(); K.toast(c.title + " · " + o.client + (d.stock && d.stock.done && d.stock.done.length ? " · voorraad teruggezet" : "") + S.mailTxt(d.mail)); if (onDone) onDone(d);
      } catch (err) { p.el.querySelector("#cErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  };
  /* ---------- leverdag / nota aanpassen (paneel), enkel vóór vertrek ---------- */
  S.editPanel = function (o, onDone) {
    const p = K.panel({ title: "Leverdag en nota aanpassen", sub: o.client + " · " + o.ref, body:
      K.c.field("Leverdag", '<input type="date" class="input" id="eDay" value="' + K.esc(o.dateLiv || "") + '" min="' + K.today() + '">', { id: "fDay", hint: "Geen levering op zondag." }) +
      K.c.field("Nota (voor magazijn en chauffeur)", '<textarea class="input" id="eNote" rows="3" maxlength="500">' + K.esc(o.notes || "") + '</textarea>', {}) +
      K.c.field("Reden van de wijziging", K.c.input("eReden", { placeholder: "bv. klant belde: liever donderdag", attrs: ' maxlength="200" autocomplete="off"' }), { id: "fEReden", req: true }) + '<div id="eErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="eOk">Opslaan</button>' });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#eOk").onclick = async () => {
      const day = p.el.querySelector("#eDay").value, note = p.el.querySelector("#eNote").value, reden = p.el.querySelector("#eReden").value.trim();
      K.setErr("fEReden", reden.length >= 3 ? "" : "Verplicht: geef een reden."); if (reden.length < 3) return;
      const payload = { correction: "bewerken", reden }; if (day && day !== (o.dateLiv || "")) payload.dateLivraison = day; if (note !== (o.notes || "")) payload.notes = note;
      if (!payload.dateLivraison && payload.notes === undefined) { p.el.querySelector("#eErr").innerHTML = K.c.error("Niets gewijzigd."); return; }
      const btn = p.el.querySelector("#eOk"); K.busy(btn, true, "Opslaan…");
      try { await S.update(o.id, payload); p.close(); K.toast("Bestelling aangepast"); if (onDone) onDone(); }
      catch (err) { p.el.querySelector("#eErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  };
  // Zelfde knop overal (fiche, tabel, magazijn, leveringen) : ghost, nooit de hoofdactie.
  S.correctBtn = (o, label) => '<button type="button" class="btn btn-ghost btn-sm" data-act="correct" data-id="' + o.id + '" title="Corrigeren">' + K.esc(label || "Corrigeren") + '</button>';

  // Snelle actieknop volgens status.
  S.nextAction = function (o) {
    if (o.statut === "Annulée") return '<button type="button" class="btn btn-o btn-sm" data-act="correct" data-id="' + o.id + '">Herstellen</button>';
    if (o.statut === "Reçue") return '<button type="button" class="btn btn-p btn-sm" data-act="validate" data-id="' + o.id + '">Klaarzetten</button>';
    if (o.statut === "Prête") return '<button type="button" class="btn btn-p btn-sm" data-act="depart" data-id="' + o.id + '">Vertrekt</button>';
    if (o.statut === "Sortie en livraison") return '<button type="button" class="btn btn-p btn-sm" data-act="deliver" data-id="' + o.id + '">Ontvangst bevestigen</button>';
    return '<button type="button" class="btn btn-o btn-sm" data-act="invoice" data-id="' + o.id + '">Factuur</button>';
  };
  S.bindActions = function (root, refresh) {
    K.on(root, "click", "[data-act]", (e, t) => {
      e.preventDefault(); e.stopPropagation();
      const o = S.byId(t.dataset.id); if (!o) return;
      const act = t.dataset.act;
      if (act === "validate") S.validatePanel(o, refresh);
      else if (act === "depart") S.depart(o, refresh);
      else if (act === "deliver") S.confirmDelivery(o, refresh);
      else if (act === "invoice") S.openDoc(o, "invoice");
      else if (act === "delivery") S.openDoc(o, "delivery");
      else if (act === "credit") S.openDoc(o, "credit");
      else if (act === "creditnota") S.creditnotaPanel(o, refresh);
      else if (act === "paid") S.togglePaid(o, refresh);
      else if (act === "picking") S.openPicking([o], o.client);
      else if (act === "correct") S.correctPanel(o, refresh);
      else if (act === "edit") S.editPanel(o, refresh);
      else if (act === "open") location.href = "/order.html?id=" + encodeURIComponent(o.id);
    });
  };
  S.orderCard = o => '<a class="ocard" href="/order.html?id=' + encodeURIComponent(o.id) + '" style="border-top-color:var(--st-' + (o.statut === "Annulée" ? "inv" : K.stKey(o.statut)) + ')"><div><div class="date">' + K.esc(K.relDay(o.day)) + '</div><div class="ref mono">' + K.esc(o.ref) + '</div></div><div class="cl">' + K.esc(o.client) + '</div><div class="ln">' + K.esc(S.lineTxt(o)) + '</div><div class="foot">' + (o.late ? '<span class="chip st-late"><i></i>Te laat</span>' : (o.statut === "Facturée" ? (o.paiement === "Payé" ? '<span class="chip st-done"><i></i>Betaald</span>' : '<span class="chip st-inv"><i></i>Openstaand</span>') : K.stChip(o.statut))) + '<b class="mono">' + K.eur(o.total) + '</b></div></a>';
  global.S = S;
})(window);
