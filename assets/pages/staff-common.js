/* Gedeeld door de personeels- en beheerpagina's: bestellingen laden, fiche, levering bevestigen, documenten. */
(function (global) {
  const S = { orders: [], config: null, loadedAt: 0 };
  S.load = async function (force) {
    if (!force && S.orders.length && Date.now() - S.loadedAt < 60 * 1000) return S;
    const [o, c] = await Promise.all([K.api("/api/allorders"), S.config ? Promise.resolve({ config: S.config }) : K.api("/api/config").catch(() => ({ config: null }))]);
    S.orders = (o.orders || []).map(x => Object.assign(x, { late: K.isLate(x), day: x.dateLiv || x.date || "" }));
    S.config = c.config || S.config; S.loadedAt = Date.now();
    if (global.FamoDocuments && S.config) FamoDocuments.setCompany(S.config);
    return S;
  };
  S.byId = id => S.orders.find(o => o.id === id);
  S.counts = () => { const t = K.today(); return { today: S.orders.filter(o => o.day === t && o.statut !== "Facturée").length, prep: S.orders.filter(o => o.statut === "Reçue").length, ready: S.orders.filter(o => o.statut === "Prête").length, road: S.orders.filter(o => o.statut === "Sortie en livraison").length, late: S.orders.filter(o => o.late).length, unpaid: S.orders.filter(o => o.statut === "Facturée" && o.paiement !== "Payé").length, unpaidSum: S.orders.filter(o => o.statut === "Facturée" && o.paiement !== "Payé").reduce((s, o) => s + Number(o.total || 0), 0) }; };
  S.update = async function (id, payload) { const d = await K.api("/api/updateorder", { json: Object.assign({ id }, payload) }); await S.load(true); return d; };
  S.lineTxt = o => K.linesSummary(o.lignes);

  /* ---------- documenten ---------- */
  S.openDoc = function (o, type) {
    if (!global.FamoDocuments || !global.famoDocPreview) { K.toast("Documentmodule niet geladen.", { kind: "err" }); return; }
    if (S.config) FamoDocuments.setCompany(S.config);
    try {
      const html = FamoDocuments.build(o, type);
      famoDocPreview.open({ html, filename: FamoDocuments.filename(o, type), title: type === "invoice" ? "Factuur " + (o.factuurnummer || "") : type === "credit" ? "Creditnota (voorbeeld)" : "Leveringsbon " + o.ref, meta: o.client + " · " + K.eur(o.total) + " excl. btw" });
    } catch (e) { K.toast(e.message || "Document kon niet worden gemaakt.", { kind: "err" }); }
  };
  S.pickingHtml = function (orders, dayLabel) {
    const agg = new Map();
    orders.forEach(o => K.parseLines(o.lignes).forEach(l => { const k = l.name.toLowerCase() + "|" + l.unit; const a = agg.get(k) || { name: l.name, unit: l.unit, qty: 0, orders: new Set() }; a.qty += l.qty; a.orders.add(o.client); agg.set(k, a); }));
    const rows = Array.from(agg.values()).sort((a, b) => a.name.localeCompare(b.name, "nl"));
    return '<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Verzamellijst</title><style>body{font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111;padding:32px}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#666}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;border-bottom:1px solid #ccc;padding:6px 4px}td{padding:9px 4px;border-bottom:1px solid #eee;vertical-align:top}.n{text-align:right;font-weight:600;font-size:15px;white-space:nowrap}.box{width:16px;height:16px;border:2px solid #333;display:inline-block;border-radius:3px}</style></head><body><h1>Verzamellijst · ' + K.esc(dayLabel) + '</h1><p>' + orders.length + ' bestelling' + (orders.length === 1 ? "" : "en") + ' · ' + rows.length + ' product' + (rows.length === 1 ? "" : "en") + ' · afgedrukt ' + K.esc(K.dateLong(K.today())) + '</p><table><thead><tr><th></th><th>Product</th><th>Voor</th><th style="text-align:right">Nodig</th></tr></thead><tbody>' + rows.map(r => '<tr><td><span class="box"></span></td><td>' + K.esc(r.name) + '</td><td>' + K.esc(Array.from(r.orders).join(", ")) + '</td><td class="n">' + K.esc(K.qty(r.qty) + " " + K.unit(r.unit)) + '</td></tr>').join("") + '</tbody></table><h1 style="margin-top:28px;font-size:16px">Per bestelling</h1><table><thead><tr><th>Klant</th><th>Artikelen</th><th>Ref.</th></tr></thead><tbody>' + orders.map(o => '<tr><td><b>' + K.esc(o.client) + '</b><br><span style="color:#666">' + K.esc((o.klant && o.klant.adresse || "").replace(/\n/g, ", ")) + '</span></td><td>' + K.parseLines(o.lignes).map(l => K.esc(K.qty(l.qty) + " " + K.unit(l.unit) + " " + l.name + (l.comment ? " — " + l.comment : ""))).join("<br>") + (o.notes ? '<br><i style="color:#8A5A00">' + K.esc(o.notes) + '</i>' : "") + '</td><td>' + K.esc(o.ref) + '</td></tr>').join("") + '</tbody></table></body></html>';
  };
  S.openPicking = function (orders, dayLabel) { if (!global.famoDocPreview) return; famoDocPreview.open({ html: S.pickingHtml(orders, dayLabel), filename: famoDocPreview.filenameFor("picking", { date: dayLabel }), title: "Verzamellijst", meta: dayLabel }); };

  /* ---------- levering bevestigen (sheet) ---------- */
  S.confirmDelivery = function (o, onDone) {
    const p = K.panel({ title: "Ontvangst bevestigen", sub: o.client + " · " + o.ref, body:
      '<div class="notice" style="background:var(--canvas)"><div><b>' + K.esc(S.lineTxt(o)) + '</b><div class="quiet" style="font-size:12px;margin-top:2px">' + K.esc((o.klant && o.klant.adresse || "").replace(/\n/g, ", ")) + (o.notes ? ' · „' + K.esc(o.notes) + '”' : "") + '</div></div></div>' +
      K.c.field("Ontvangen door", K.c.input("recipient", { placeholder: "Naam van wie de levering aanneemt", attrs: ' autocomplete="off"' }), { id: "fRec", req: true }) +
      K.c.field("Betaling", '<div class="opt"><button type="button" data-pay="En attente" class="on">Later / overschrijving</button><button type="button" data-pay="Payé">Contant betaald · ' + K.eur(o.total) + ' excl. btw</button></div>', { id: "fPay" }) +
      K.c.field("Bewijs (optioneel)", K.c.input("proof", { type: "url", placeholder: "https://… link naar foto of handtekening" }), { id: "fProof", hint: "Enkel een https-link wordt bewaard. Foto's uploaden komt in een volgende versie." }) +
      '<div class="notice" style="font-size:12.5px"><div><b>Wat gebeurt er:</b> status → Geleverd, het factuurnummer wordt toegekend, de factuur is meteen beschikbaar.</div></div><div id="dErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="dOk">Bevestigen</button>' });
    let pay = "En attente";
    K.on(p.el, "click", "[data-pay]", (e, t) => { pay = t.dataset.pay; K.$$("[data-pay]", p.el).forEach(b => b.classList.toggle("on", b === t)); });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#dOk").onclick = async () => {
      const rec = p.el.querySelector("#recipient").value.trim(), proof = p.el.querySelector("#proof").value.trim();
      K.setErr("fRec", rec ? "" : "Verplicht: naam van wie de levering aanneemt."); if (!rec) return;
      if (proof && !/^https:\/\//i.test(proof)) { K.setErr("fProof", "De link moet met https:// beginnen."); return; }
      const btn = p.el.querySelector("#dOk"); K.busy(btn, true, "Bevestigen…");
      try {
        const d = await S.update(o.id, { statut: "Facturée", deliveryConfirmed: true, recipient: rec, proofUrl: proof || undefined, paiement: pay === "Payé" ? "Payé" : undefined });
        p.close(); K.toast("Geleverd · factuur " + (d.factuurnummer || "") + " aangemaakt"); if (onDone) onDone(d);
      } catch (err) { p.el.querySelector("#dErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  };

  /* ---------- artikelen valideren + klaarzetten (paneel) ---------- */
  S.validatePanel = function (o, onDone) {
    const lines = K.parseLines(o.lignes);
    const state = lines.map(() => false);
    const p = K.panel({ title: "Artikelen valideren", sub: o.client + " · " + o.ref + " · levering " + K.relDay(o.day), body:
      '<div class="card" id="vl">' + lines.map((l, i) => '<div class="line" data-i="' + i + '">' + K.c.check(false, 'data-v="' + i + '"') + '<div><b>' + K.esc(l.name) + '</b>' + (l.comment ? '<div class="quiet" style="font-size:12px">„' + K.esc(l.comment) + '”</div>' : "") + '</div><div class="stepper" data-q="' + i + '"><button type="button" data-dec aria-label="Minder">−</button><input type="number" inputmode="decimal" min="0" step="' + (/kg/i.test(l.unit) ? 0.5 : 1) + '" value="' + l.qty + '"><button type="button" data-inc aria-label="Meer">+</button></div><span class="tag">' + K.esc(K.unit(l.unit)) + '</span></div>').join("") + '</div>' +
      (o.notes ? K.c.warn("<b>Nota klant:</b> " + K.esc(o.notes)) : "") + '<div class="quiet" style="font-size:12.5px">Pas een aantal aan als u minder kunt leveren; het totaal wordt op de server herberekend.</div><div id="vErr"></div>',
      footer: '<span class="muted" id="vCount" style="margin-right:auto;font-size:12.5px">0 van ' + lines.length + ' gecontroleerd</span><button type="button" class="btn btn-o" data-cancel>Later</button><button type="button" class="btn btn-p" id="vOk" disabled>Klaarzetten</button>' });
    const refresh = () => { const n = state.filter(Boolean).length; p.el.querySelector("#vCount").textContent = n + " van " + lines.length + " gecontroleerd"; p.el.querySelector("#vOk").disabled = n !== lines.length; };
    K.on(p.el, "click", "[data-v]", (e, t) => { const i = +t.dataset.v; state[i] = !state[i]; t.classList.toggle("on", state[i]); t.closest(".line").classList.toggle("ok", state[i]); refresh(); });
    K.$$("[data-q]", p.el).forEach(st => { const i = +st.dataset.q, inp = st.querySelector("input"), step = /kg/i.test(lines[i].unit) ? 0.5 : 1; const set = v => { v = Math.max(0, /kg/i.test(lines[i].unit) ? Math.round(v * 1000) / 1000 : Math.round(v)); lines[i].qty = v; inp.value = v; }; st.querySelector("[data-dec]").onclick = () => set(Number(inp.value) - step); st.querySelector("[data-inc]").onclick = () => set(Number(inp.value) + step); inp.addEventListener("change", () => set(Number(String(inp.value).replace(",", ".")) || 0)); });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#vOk").onclick = async () => {
      const kept = lines.filter(l => l.qty > 0); if (!kept.length) { p.el.querySelector("#vErr").innerHTML = K.c.error("Minstens één artikel met een aantal groter dan 0."); return; }
      const btn = p.el.querySelector("#vOk"); K.busy(btn, true, "Klaarzetten…");
      const changed = kept.length !== lines.length || kept.some(l => l.qty !== K.parseLines(o.lignes).find(x => x.name === l.name).qty);
      try {
        await S.update(o.id, Object.assign({ statut: "Prête", preparationValidee: true }, changed ? { lignes: kept.map(K.formatLine).join("\n") } : {}));
        p.close(); K.toast(o.client + " staat klaar"); if (onDone) onDone();
      } catch (err) { p.el.querySelector("#vErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  };
  S.depart = async function (o, onDone) {
    if (!(await K.confirm({ title: "Ronde vertrekt?", text: o.client + " · " + o.ref + " gaat op Onderweg. Daarna kunnen de artikelen niet meer gewijzigd worden.", yes: "Vertrekken" }))) return;
    try { await S.update(o.id, { statut: "Sortie en livraison", skipStock: true }); K.toast(o.client + " is onderweg"); if (onDone) onDone(); } catch (err) { K.toast(err.message, { kind: "err" }); }
  };
  S.togglePaid = async function (o, onDone) {
    const paid = o.paiement === "Payé";
    try { await S.update(o.id, { paiement: paid ? "En attente" : "Payé" }); K.toast(paid ? "Terug op openstaand" : "Gemarkeerd als betaald"); if (onDone) onDone(); } catch (err) { K.toast(err.message, { kind: "err" }); }
  };
  // Snelle actieknop volgens status.
  S.nextAction = function (o) {
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
      else if (act === "paid") S.togglePaid(o, refresh);
      else if (act === "picking") S.openPicking([o], o.client);
      else if (act === "open") location.href = "/order.html?id=" + encodeURIComponent(o.id);
    });
  };
  S.orderCard = o => '<a class="ocard" href="/order.html?id=' + encodeURIComponent(o.id) + '" style="border-top-color:var(--st-' + K.stKey(o.statut) + ')"><div><div class="date">' + K.esc(K.relDay(o.day)) + '</div><div class="ref mono">' + K.esc(o.ref) + '</div></div><div class="cl">' + K.esc(o.client) + '</div><div class="ln">' + K.esc(S.lineTxt(o)) + '</div><div class="foot">' + (o.late ? '<span class="chip st-late"><i></i>Te laat</span>' : (o.statut === "Facturée" ? (o.paiement === "Payé" ? '<span class="chip st-done"><i></i>Betaald</span>' : '<span class="chip st-inv"><i></i>Open</span>') : K.stChip(o.statut))) + '<b class="mono">' + K.eur(o.total) + '</b></div></a>';
  global.S = S;
})(window);
