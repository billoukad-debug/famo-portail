(async function () {
  if (!(await K.requireStaff({ admin: true }))) return;
  const page = K.shell({});
  const DAY_KEYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  // Leverregels : uit Configuratie (via /api/config, daarna /api/staff?client=). Zelfde controle als lib/levering.js
  // (checkDate) voor directe feedback ; de server blijft de scheidsrechter.
  let rules = { deadline: "22:00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [], minimum: 0, maxDagen: 60 };
  const dow = iso => { const d = K.parseDate(iso); return d ? d.getDay() : -1; };
  const checkDate = iso => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || "")) || !K.parseDate(iso) || K.isoDay(iso) !== iso) return "Ongeldige leverdag";
    const t = K.today(); if (iso < t) return "De leverdag ligt in het verleden";
    if (iso > K.addDays(t, rules.maxDagen)) return "Kies een leverdag binnen de komende " + rules.maxDagen + " dagen";
    const d = dow(iso); if (!rules.leverdagen.includes(DAY_KEYS[d])) return d === 0 ? "Op zondag leveren we niet" : "Op die dag leveren we niet";
    if (rules.geslotenDagen.includes(iso)) return "Op die dag zijn we gesloten";
    return "";
  };
  const pastDeadline = () => { const [h, m] = String(rules.deadline || "22:00").split(":").map(Number); const n = new Date(); return n.getHours() * 60 + n.getMinutes() >= h * 60 + m; };
  // Eerste dag die het klantportaal ook zou aanbieden : morgen (of overmorgen na de deadline), dan de eerste leverbare dag.
  const firstDay = () => { let d = K.addDays(K.today(), pastDeadline() ? 2 : 1); for (let i = 0; i < 14 && checkDate(d); i++) d = K.addDays(d, 1); return d; };
  // "ma–vr" of "ma, wo, vr" : opeenvolgende dagen worden samengetrokken.
  const daysText = () => { const idx = rules.leverdagen.map(k => DAY_KEYS.indexOf(k)).filter(i => i >= 0).map(i => i === 0 ? 7 : i).sort((a, b) => a - b); const out = []; let s = null, p = null; idx.forEach(i => { if (s === null) { s = p = i; return; } if (i === p + 1) { p = i; return; } out.push([s, p]); s = p = i; }); if (s !== null) out.push([s, p]); const nm = i => DAY_KEYS[i % 7]; return out.map(([a, b]) => a === b ? nm(a) : b === a + 1 ? nm(a) + ", " + nm(b) : nm(a) + "–" + nm(b)).join(", "); };
  const ruleHint = () => { const off = DAY_KEYS.filter(k => !rules.leverdagen.includes(k)); return "Levering " + daysText() + (off.length ? ", niet op " + off.join(", ") : "") + " · vóór " + rules.deadline + " besteld = morgen geleverd" + (rules.minimum > 0 ? " · minimum " + K.eur(rules.minimum) : "") + (rules.geslotenDagen.length ? " · gesloten: " + rules.geslotenDagen.filter(d => d >= K.today()).slice(0, 4).map(K.date).join(", ") : ""); };
  let clients = [], products = [], clientId = "", bron = "Telefoon", items = {}, note = "", day = "", q = "", dayErr = "";
  const byId = id => products.find(p => p.id === id);
  const total = () => Object.entries(items).reduce((s, [id, qv]) => { const p = byId(id); return s + (p ? p.prix * qv : 0); }, 0);
  const isKg = p => /kg/i.test(p.unite || "");
  function render() {
    const cl = clients.find(c => c.id === clientId);
    const list = products.filter(p => !q || (p.nom + " " + (p.kaliber || "") + " " + K.cat(p.cat)).toLowerCase().includes(q));
    if (!day) day = firstDay();
    dayErr = checkDate(day);
    const tooEarly = !dayErr && day === K.addDays(K.today(), 1) && pastDeadline();
    const underMin = rules.minimum > 0 && total() > 0 && total() < rules.minimum;
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Bestelling invoeren</h1><p class="sub">Voor een klant die belt, mailt of appt</p></div><span class="spacer"></span><div class="opt" style="flex:0 0 auto">' + ["Telefoon", "WhatsApp", "E-mail", "Toonbank"].map(b => '<button type="button" data-bron="' + b + '"' + (b === bron ? ' class="on"' : "") + '>' + b + '</button>').join("") + '</div></div>' +
      '<div class="content" style="padding-top:14px;display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start" id="two">' +
      '<div class="card"><div class="card-h" style="gap:10px"><select class="input" id="client" style="max-width:320px"><option value="">— Kies een klant —</option>' + clients.map(c => '<option value="' + c.id + '"' + (c.id === clientId ? " selected" : "") + '>' + K.esc(c.nom) + '</option>').join("") + '</select><label class="search">' + K.icon("search") + '<input id="q" placeholder="Zoek product…" value="' + K.esc(q) + '"' + (clientId ? "" : " disabled") + '></label></div>' +
      (clientId ? (list.length ? list.map(p => '<div class="line" style="grid-template-columns:minmax(0,1fr) auto auto"><div><b>' + K.esc(p.nom) + '</b>' + (p.kaliber ? ' <span class="tag">' + K.esc(p.kaliber) + '</span>' : "") + '<div class="quiet" style="font-size:12px">' + K.esc(K.unit(p.unite)) + " · " + K.esc(K.cat(p.cat)) + '</div></div><div class="pp"><b class="mono">' + K.eur(p.prix) + '</b>' + (p.prix < p.base ? '<s class="mono">' + K.eur(p.base) + '</s>' : "") + '</div>' + K.c.stepper(p.id, items[p.id] || 0, { step: isKg(p) ? 0.5 : 1 }) + '</div>').join("") : '<div class="empty" style="margin:12px">Geen product gevonden.</div>') : '<div class="state"><b>Kies eerst een klant</b><p class="sub">De prijzen in de lijst zijn de afgesproken prijzen van die klant.</p></div>') + '</div>' +
      '<div class="card"><div class="card-h"><h2 class="h2">Samenvatting</h2><span class="tag">' + K.esc(bron) + '</span></div><div class="card-b" style="display:flex;flex-direction:column;gap:12px">' +
      (cl ? '<div><b>' + K.esc(cl.nom) + '</b><div class="quiet" style="font-size:12px;white-space:pre-line">' + K.esc(cl.adresse || "") + '</div></div>' : '<span class="quiet">Geen klant gekozen.</span>') +
      K.c.field("Leverdatum", '<input type="date" class="input" id="day" value="' + K.esc(day) + '" min="' + K.today() + '" max="' + K.addDays(K.today(), rules.maxDagen) + '"' + (dayErr ? ' aria-invalid="true"' : "") + '>', { id: "fDay", hint: ruleHint() }) +
      (tooEarly ? K.c.warn("Na " + K.esc(rules.deadline) + ": een klant kan morgen niet meer kiezen. Als telefonische uitzondering kan het wel — check met het magazijn.") : "") +
      K.c.field("Opmerking voor magazijn / chauffeur", '<textarea class="input" id="note" rows="2" placeholder="bv. achteraan bellen">' + K.esc(note) + '</textarea>', {}) +
      '<div style="border-top:1px solid var(--line);padding-top:10px;display:flex;flex-direction:column;gap:6px;font-size:13px">' + Object.entries(items).filter(([id, qv]) => byId(id) && qv > 0).map(([id, qv]) => '<div style="display:flex;justify-content:space-between;gap:8px"><span>' + K.esc(K.qty(qv) + "× " + byId(id).nom) + '</span><span class="mono">' + K.eur(byId(id).prix * qv) + '</span></div>').join("") + '<div style="display:flex;justify-content:space-between;font-weight:600;font-size:15px;margin-top:4px"><span>Totaal excl. btw</span><span class="mono">' + K.eur(total()) + '</span></div></div>' +
      (underMin ? K.c.warn("<b>Onder het minimum</b> van " + K.eur(rules.minimum) + " excl. btw (klantportaal weigert dit). Als personeel kunt u toch plaatsen.") : "") + '<div id="err"></div></div>' +
      '<div class="panel-f"><button type="button" class="btn btn-o" id="reset">Wissen</button><button type="button" class="btn btn-p" id="place" style="flex:1"' + (clientId && total() > 0 && !dayErr ? "" : " disabled") + '>Bestelling plaatsen</button></div></div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    K.setErr("fDay", dayErr);
    page.querySelector("#client").onchange = async e => { clientId = e.target.value; items = {}; products = []; render(); if (clientId) { try { const d = await K.api("/api/staff?client=" + encodeURIComponent(clientId)); products = d.products || []; if (d.levering) rules = Object.assign(rules, d.levering); } catch (err) { K.toast(err.message, { kind: "err" }); } render(); } };
    const qi = page.querySelector("#q"); qi.addEventListener("input", () => { q = qi.value.toLowerCase(); const pos = qi.selectionStart; render(); const n = page.querySelector("#q"); n.focus(); n.setSelectionRange(pos, pos); });
    K.$$("[data-bron]", page).forEach(b => { b.onclick = () => { bron = b.dataset.bron; render(); }; });
    page.querySelector("#day").onchange = e => { day = e.target.value || firstDay(); render(); };
    page.querySelector("#note").addEventListener("input", e => { note = e.target.value; });
    page.querySelector("#reset").onclick = () => { items = {}; note = ""; day = ""; render(); };
    K.$$(".stepper", page).forEach(st => { const id = st.dataset.stepper, inp = st.querySelector("input"), p = byId(id); const step = isKg(p) ? 0.5 : 1; const set = v => { v = Math.max(0, isKg(p) ? Math.round(v * 1000) / 1000 : Math.round(v)); if (v > 0) items[id] = v; else delete items[id]; render(); }; st.querySelector("[data-dec]").onclick = () => set(Number(inp.value) - step); st.querySelector("[data-inc]").onclick = () => set(Number(inp.value) + step); inp.addEventListener("change", () => set(Number(String(inp.value).replace(",", ".")) || 0)); });
    page.querySelector("#place").onclick = async () => {
      const err = checkDate(day); if (err) { dayErr = err; render(); return; }
      const btn = page.querySelector("#place"); K.busy(btn, true, "Plaatsen…"); page.querySelector("#err").innerHTML = "";
      try {
        const d = await K.api("/api/staff", { json: { clientId, notes: note, dateLivraison: day, bron, items: Object.entries(items).filter(([id, qv]) => qv > 0).map(([id, qv]) => ({ productId: id, quantity: qv })) } });
        K.toast("Bestelling " + d.ref + " geplaatst"); location.href = "/order.html?id=" + encodeURIComponent(d.id);
      } catch (err) { page.querySelector("#err").innerHTML = K.c.error(err.message); if (/leverdag|zondag|die dag/i.test(err.message)) K.setErr("fDay", err.message); K.busy(btn, false); }
    };
  }
  page.innerHTML = '<div class="page-h"><h1 class="h1">Bestelling invoeren</h1></div><div class="content">' + K.c.skeleton(2) + '</div>';
  try {
    const [d, cfg] = await Promise.all([K.api("/api/staff"), K.api("/api/config").catch(() => null)]);
    clients = d.clients || []; if (cfg && cfg.config && cfg.config.levering) rules = Object.assign(rules, cfg.config.levering); render();
  } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message) + '</div>'; }
})();
