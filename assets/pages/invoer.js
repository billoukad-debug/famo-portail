(async function () {
  if (!(await K.requireStaff({ admin: true }))) return;
  const page = K.shell({});
  let clients = [], products = [], clientId = "", bron = "Telefoon", items = {}, note = "", day = K.addDays(K.today(), 1), q = "";
  const byId = id => products.find(p => p.id === id);
  const total = () => Object.entries(items).reduce((s, [id, qv]) => { const p = byId(id); return s + (p ? p.prix * qv : 0); }, 0);
  const isKg = p => /kg/i.test(p.unite || "");
  function render() {
    const cl = clients.find(c => c.id === clientId);
    const list = products.filter(p => !q || (p.nom + " " + p.cat).toLowerCase().includes(q));
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Bestelling invoeren</h1><p class="sub">Voor een klant die belt, mailt of appt</p></div><span class="spacer"></span><div class="opt" style="flex:0 0 auto">' + ["Telefoon", "WhatsApp", "E-mail", "Toonbank"].map(b => '<button type="button" data-bron="' + b + '"' + (b === bron ? ' class="on"' : "") + '>' + b + '</button>').join("") + '</div></div>' +
      '<div class="content" style="padding-top:14px;display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start" id="two">' +
      '<div class="card"><div class="card-h" style="gap:10px"><select class="input" id="client" style="max-width:320px"><option value="">— Kies een klant —</option>' + clients.map(c => '<option value="' + c.id + '"' + (c.id === clientId ? " selected" : "") + '>' + K.esc(c.nom) + '</option>').join("") + '</select><label class="search">' + K.icon("search") + '<input id="q" placeholder="Zoek product…" value="' + K.esc(q) + '"' + (clientId ? "" : " disabled") + '></label></div>' +
      (clientId ? (list.length ? list.map(p => '<div class="line" style="grid-template-columns:minmax(0,1fr) auto auto"><div><b>' + K.esc(p.nom) + '</b><div class="quiet" style="font-size:12px">' + K.esc(K.unit(p.unite)) + (p.cat ? " · " + K.esc(p.cat) : "") + '</div></div><div class="pp"><b class="mono">' + K.eur(p.prix) + '</b>' + (p.prix < p.base ? '<s class="mono">' + K.eur(p.base) + '</s>' : "") + '</div>' + K.c.stepper(p.id, items[p.id] || 0, { step: isKg(p) ? 0.5 : 1 }) + '</div>').join("") : '<div class="empty" style="margin:12px">Geen product gevonden.</div>') : '<div class="state"><b>Kies eerst een klant</b><p class="sub">De prijzen in de lijst zijn de afgesproken prijzen van die klant.</p></div>') + '</div>' +
      '<div class="card"><div class="card-h"><h2 class="h2">Samenvatting</h2><span class="tag">' + K.esc(bron) + '</span></div><div class="card-b" style="display:flex;flex-direction:column;gap:12px">' +
      (cl ? '<div><b>' + K.esc(cl.nom) + '</b><div class="quiet" style="font-size:12px;white-space:pre-line">' + K.esc(cl.adresse || "") + '</div></div>' : '<span class="quiet">Geen klant gekozen.</span>') +
      K.c.field("Leverdatum", '<input type="date" class="input" id="day" value="' + day + '" min="' + K.today() + '">', {}) +
      K.c.field("Opmerking voor magazijn / chauffeur", '<textarea class="input" id="note" rows="2" placeholder="bv. achteraan bellen">' + K.esc(note) + '</textarea>', {}) +
      '<div style="border-top:1px solid var(--line);padding-top:10px;display:flex;flex-direction:column;gap:6px;font-size:13px">' + Object.entries(items).filter(([id, qv]) => byId(id) && qv > 0).map(([id, qv]) => '<div style="display:flex;justify-content:space-between;gap:8px"><span>' + K.esc(K.qty(qv) + "× " + byId(id).nom) + '</span><span class="mono">' + K.eur(byId(id).prix * qv) + '</span></div>').join("") + '<div style="display:flex;justify-content:space-between;font-weight:600;font-size:15px;margin-top:4px"><span>Totaal excl. btw</span><span class="mono">' + K.eur(total()) + '</span></div></div><div id="err"></div></div>' +
      '<div class="panel-f"><button type="button" class="btn btn-o" id="reset">Wissen</button><button type="button" class="btn btn-p" id="place" style="flex:1"' + (clientId && total() > 0 ? "" : " disabled") + '>Bestelling plaatsen</button></div></div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    page.querySelector("#client").onchange = async e => { clientId = e.target.value; items = {}; products = []; render(); if (clientId) { try { const d = await K.api("/api/staff?client=" + encodeURIComponent(clientId)); products = d.products || []; } catch (err) { K.toast(err.message, { kind: "err" }); } render(); } };
    const qi = page.querySelector("#q"); qi.addEventListener("input", () => { q = qi.value.toLowerCase(); const pos = qi.selectionStart; render(); const n = page.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); });
    K.$$("[data-bron]", page).forEach(b => { b.onclick = () => { bron = b.dataset.bron; render(); }; });
    page.querySelector("#day").onchange = e => { day = e.target.value; };
    page.querySelector("#note").addEventListener("input", e => { note = e.target.value; });
    page.querySelector("#reset").onclick = () => { items = {}; note = ""; render(); };
    K.$$(".stepper", page).forEach(st => { const id = st.dataset.stepper, inp = st.querySelector("input"), p = byId(id); const step = isKg(p) ? 0.5 : 1; const set = v => { v = Math.max(0, isKg(p) ? Math.round(v * 1000) / 1000 : Math.round(v)); if (v > 0) items[id] = v; else delete items[id]; render(); }; st.querySelector("[data-dec]").onclick = () => set(Number(inp.value) - step); st.querySelector("[data-inc]").onclick = () => set(Number(inp.value) + step); inp.addEventListener("change", () => set(Number(String(inp.value).replace(",", ".")) || 0)); });
    page.querySelector("#place").onclick = async () => {
      const btn = page.querySelector("#place"); K.busy(btn, true, "Plaatsen…"); page.querySelector("#err").innerHTML = "";
      try {
        const d = await K.api("/api/staff", { json: { clientId, notes: note, dateLivraison: day, bron, items: Object.entries(items).filter(([id, qv]) => qv > 0).map(([id, qv]) => ({ productId: id, quantity: qv })) } });
        K.toast("Bestelling " + d.ref + " geplaatst"); location.href = "/order.html?id=" + encodeURIComponent(d.id);
      } catch (err) { page.querySelector("#err").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  }
  page.innerHTML = '<div class="page-h"><h1 class="h1">Bestelling invoeren</h1></div><div class="content">' + K.c.skeleton(2) + '</div>';
  try { const d = await K.api("/api/staff"); clients = d.clients || []; render(); } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message) + '</div>'; }
})();
