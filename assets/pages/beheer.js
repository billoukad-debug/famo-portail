(async function () {
  if (!(await K.requireStaff({ admin: true }))) return;
  const page = K.shell({ portal: "beheer" });
  const TABS = [["overzicht", "Overzicht"], ["aanvragen", "Aanvragen"], ["klanten", "Klanten"], ["producten", "Producten"], ["prijzen", "Prijzen"], ["bedrijf", "Bedrijfsgegevens"], ["toegang", "Toegang"], ["status", "Systeemstatus"]];
  let D = null, tab = K.hashParams().path || "overzicht", sel = K.hashParams().params.klant || "";
  const post = async (json) => { const d = await K.api("/api/onboarding", { json }); D = d; return d; };
  const load = async () => { D = await K.api("/api/onboarding"); };
  const clientById = id => (D.clients || []).find(c => c.id === id);
  const priceOf = (cid, pid) => (D.prices || []).find(p => p.clientId === cid && p.productId === pid);
  const head = (sub, right) => '<div class="page-h"><div><h1 class="h1">Beheer</h1><p class="sub">' + K.esc(sub) + '</p></div><span class="spacer"></span>' + (right || "") + '</div><nav class="tabs">' + TABS.map(([k, l]) => '<a href="#/' + k + '"' + (tab === k ? ' class="on"' : "") + '>' + l + (k === "aanvragen" && D.status.aanvragen ? ' <span class="chip st-new" style="height:20px;padding:0 7px;margin-left:4px">' + D.status.aanvragen + '</span>' : "") + '</a>').join("") + '</nav>';
  const credsBox = c => K.c.ok('<b>Toegang voor ' + K.esc(c.nom) + '</b><div style="margin-top:6px;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px"><span class="quiet">Gebruikersnaam</span><b class="mono" style="user-select:all">' + K.esc(c.user) + '</b><span class="quiet">Wachtwoord</span><b class="mono" style="user-select:all">' + K.esc(c.password) + '</b></div><div class="quiet" style="font-size:12px;margin-top:6px">Wordt maar één keer getoond. Geef het door aan de klant (telefoon of WhatsApp), niet per onbeveiligde mail.</div>');

  /* ---------- overzicht ---------- */
  async function overzicht() {
    let orders = []; try { await S.load(); orders = S.orders; } catch (e) { /* toon zonder */ }
    const c = S.counts(); const st = D.status;
    const issues = [];
    if (st.ibanOntbreekt) issues.push(['IBAN of BIC ontbreekt: facturen tonen voorbeeldbankgegevens.', '#/bedrijf']);
    if (!D.config.adminCodeCustom || !D.config.staffCodeCustom) issues.push(['Personeels- en beheerderscode zijn nog niet apart ingesteld.', '#/toegang']);
    if (st.klantenZonderEmail) issues.push([st.klantenZonderEmail + ' klant' + (st.klantenZonderEmail === 1 ? "" : "en") + ' zonder e-mail: geen bevestigingen.', '#/klanten']);
    if (!st.mailEnabled) issues.push(['E-mail is niet actief (RESEND_API_KEY ontbreekt op Vercel).', '#/status']);
    if (st.aanvragen) issues.push([st.aanvragen + ' nieuwe aanvraag' + (st.aanvragen === 1 ? "" : "en") + ' wachten.', '#/aanvragen']);
    page.innerHTML = head("Klanten, producten, prijzen en instellingen", '<a class="btn btn-o btn-sm" href="/invoer.html">' + K.icon("plus") + 'Bestelling invoeren</a><button type="button" class="btn btn-p btn-sm" data-new-client>Nieuwe klant</button>') +
      '<div class="content" style="padding-top:16px">' +
      '<div class="kpis"><div class="kp"><small>Open bestellingen</small><b>' + orders.filter(o => o.statut !== "Facturée").length + '</b><em>' + c.today + ' vandaag</em></div><div class="kp"><small>Openstaand te betalen</small><b class="mono">' + K.eur(c.unpaidSum) + '</b><em>' + c.unpaid + ' factu' + (c.unpaid === 1 ? "ur" : "ren") + '</em></div><div class="kp"><small>Klanten</small><b>' + st.clients + '</b><em>' + st.credentials + ' met toegang</em></div><div class="kp"><small>Producten actief</small><b>' + st.catalogue + '</b><em>' + st.prijzen + ' prijsafspraken</em></div></div>' +
      (issues.length ? '<div class="card"><div class="card-h"><h2 class="h2">Aandachtspunten</h2></div>' + issues.map(([t, h]) => '<div class="stop" style="min-height:48px"><span class="chip st-new"><i></i>!</span><span style="flex:1">' + t + '</span><a class="btn btn-o btn-sm" href="' + h + '">Bekijken</a></div>').join("") + '</div>' : K.c.ok("Alles is ingevuld. Geen aandachtspunten.")) +
      '<div class="card"><div class="card-h"><h2 class="h2">Laatste bestellingen</h2><a class="btn btn-o btn-sm" href="/bestellingen.html">Alle bestellingen</a></div>' + (orders.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Levering</th><th>Klant</th><th>Artikelen</th><th>Status</th><th class="num">Bedrag</th></tr></thead><tbody>' + orders.slice(0, 6).map(o => '<tr class="row" data-open="' + o.id + '"><td><b>' + K.esc(K.relDay(o.day)) + '</b></td><td>' + K.esc(o.client) + '</td><td class="muted">' + K.esc(S.lineTxt(o)) + '</td><td style="width:130px">' + K.stCell(o.statut) + '</td><td class="num mono">' + K.eur(o.total) + '</td></tr>').join("") + '</tbody></table></div>' : '<div class="empty" style="margin:12px">Nog geen bestellingen.</div>') + '</div></div>';
    K.on(page, "click", "tr[data-open]", (e, t) => { location.href = "/order.html?id=" + encodeURIComponent(t.dataset.open); });
  }

  /* ---------- aanvragen ---------- */
  function aanvragen() {
    const list = D.aanvragen || [];
    page.innerHTML = head("Aanvragen via de website") + '<div class="content" style="padding-top:16px"><div class="card"><div class="card-h"><h2 class="h2">Nieuw <small class="quiet" style="font-weight:400">' + list.length + '</small></h2></div>' + (list.length ? list.map(a => '<div class="stop" style="align-items:flex-start;padding:14px"><div style="flex:1;min-width:0"><b>' + K.esc(a.bedrijfsnaam) + '</b><div class="muted" style="font-size:12.5px">' + K.esc(a.contactpersoon) + ' · <a href="tel:' + K.esc(a.telefoon.replace(/\s+/g, "")) + '">' + K.esc(a.telefoon) + '</a> · <a href="mailto:' + K.esc(a.email) + '">' + K.esc(a.email) + '</a></div>' + (a.adres ? '<div class="quiet" style="font-size:12.5px">' + K.esc(a.adres) + '</div>' : "") + (a.notities ? '<div style="font-size:12.5px;margin-top:4px">„' + K.esc(a.notities) + '”</div>' : "") + '</div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="btn btn-p btn-sm" data-accept="' + a.id + '">Klant aanmaken</button><button type="button" class="btn btn-ghost btn-sm" data-close="' + a.id + '">Afsluiten</button></div></div>').join("") : '<div class="empty" style="margin:12px">Geen nieuwe aanvragen. Het formulaar staat op <a href="/aanvraag.html">/aanvraag.html</a>.</div>') + '</div><p class="quiet" style="font-size:12.5px">„Klant aanmaken” vult de klantfiche vooraf in en maakt gebruikersnaam en wachtwoord aan; de aanvraag sluit automatisch.</p></div>';
    K.on(page, "click", "[data-accept]", (e, t) => { const a = list.find(x => x.id === t.dataset.accept); clientPanel(null, { nom: a.bedrijfsnaam, email: a.email, tel: a.telefoon, adresse: a.adres, aanvraagId: a.id }); });
    K.on(page, "click", "[data-close]", async (e, t) => { if (!(await K.confirm({ title: "Aanvraag afsluiten?", text: "Zonder klant aan te maken.", yes: "Afsluiten" }))) return; try { await post({ action: "closeAanvraag", id: t.dataset.close }); K.toast("Aanvraag afgesloten"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } });
  }

  /* ---------- klanten ---------- */
  function clientPanel(c, prefill) {
    const v = Object.assign({ nom: "", adresse: "", tel: "", email: "", btw: "", klantnr: "", user: "" }, c || {}, prefill || {});
    const p = K.panel({ title: c ? c.nom : "Nieuwe klant", sub: c ? "Klantfiche bewerken" : "Gebruikersnaam en wachtwoord worden automatisch aangemaakt", body:
      K.c.field("Naam van de zaak", K.c.input("cNom", { value: v.nom }), { id: "fNom", req: true }) +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + K.c.field("Telefoon", K.c.input("cTel", { value: v.tel, type: "tel" }), {}) + K.c.field("E-mail (bevestigingen)", K.c.input("cMail", { value: v.email, type: "email" }), { id: "fMail" }) + '</div>' +
      K.c.field("Leveradres", '<textarea class="input" id="cAdr" rows="2">' + K.esc(v.adresse) + '</textarea>', {}) +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + K.c.field("BTW-nummer", K.c.input("cBtw", { value: v.btw, placeholder: "BE 0xxx.xxx.xxx" }), {}) + K.c.field("Klantnummer", K.c.input("cNr", { value: v.klantnr, placeholder: "bv. K-004" }), {}) + '</div>' +
      (c ? K.c.field("Gebruikersnaam", K.c.input("cUser", { value: v.user }), { hint: "Wijzigen? De klant moet het nieuwe login kennen." }) + '<label style="display:flex;gap:10px;align-items:center;font-size:13px">' + K.c.check(false, 'id="cGen"') + 'Nieuw wachtwoord aanmaken en tonen</label>' : "") + '<div id="cErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="cOk">' + (c ? "Opslaan" : "Klant aanmaken") + '</button>' });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    let gen = false; const g = p.el.querySelector("#cGen"); if (g) g.onclick = () => { gen = !gen; g.classList.toggle("on", gen); };
    p.el.querySelector("#cOk").onclick = async () => {
      const val = id => p.el.querySelector("#" + id).value.trim();
      const nom = val("cNom"); K.setErr("fNom", nom ? "" : "Verplicht."); if (!nom) return;
      const btn = p.el.querySelector("#cOk"); K.busy(btn, true, "Opslaan…");
      try {
        const d = await post({ action: "saveClient", id: c ? c.id : undefined, nom, adresse: val("cAdr"), tel: val("cTel"), email: val("cMail"), btw: val("cBtw"), klantnr: val("cNr"), user: c ? val("cUser") : "", generate: c ? gen : true });
        if (prefill && prefill.aanvraagId) { try { await post({ action: "closeAanvraag", id: prefill.aanvraagId }); } catch (e) { /* al gesloten */ } }
        p.close(); tab = "klanten"; sel = d.credentials.id; location.hash = "#/klanten?klant=" + encodeURIComponent(sel); render();
        if (!c || gen) { const box = document.createElement("div"); box.innerHTML = credsBox(d.credentials); const target = page.querySelector("#detail"); if (target) target.prepend(box.firstChild); }
        K.toast(c ? "Klant opgeslagen" : "Klant aangemaakt");
      } catch (err) { p.el.querySelector("#cErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  }
  function klanten() {
    const list = D.clients || []; if (!sel && list.length) sel = list[0].id; const c = clientById(sel);
    const prods = (D.products || []).filter(p => p.actif);
    page.innerHTML = head(list.length + " klanten · " + D.status.credentials + " met toegang", '<button type="button" class="btn btn-p btn-sm" data-new-client>' + K.icon("plus") + 'Nieuwe klant</button>') +
      '<div class="content" style="padding-top:16px;display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start" id="two">' +
      '<div class="card"><div class="card-h"><label class="search">' + K.icon("search") + '<input id="cq" placeholder="Zoeken…"></label></div><div id="clist">' + list.map(x => '<a href="#/klanten?klant=' + x.id + '" class="stop" data-c="' + x.id + '" style="min-height:48px;text-decoration:none;color:inherit' + (x.id === sel ? ";background:var(--p-soft)" : "") + '">' + K.c.avatar(x.nom) + '<div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(x.nom) + '</b><span class="quiet" style="font-size:11.5px">' + K.esc(x.klantnr || x.user || "") + (x.email ? "" : " · geen e-mail") + '</span></div></a>').join("") + '</div></div>' +
      '<div id="detail" style="display:flex;flex-direction:column;gap:14px;min-width:0">' + (c ? '<div class="card card-b"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><h2 class="h2">' + K.esc(c.nom) + '</h2>' + (c.user && c.hasPassword ? '<span class="chip st-done"><i></i>Toegang actief</span>' : '<span class="chip st-new"><i></i>Geen toegang</span>') + '<span class="spacer"></span><button type="button" class="btn btn-o btn-sm" data-reset="' + c.id + '">Nieuw wachtwoord</button><button type="button" class="btn btn-o btn-sm" data-edit="' + c.id + '">Bewerken</button><a class="btn btn-o btn-sm" href="/bestellingen.html?status=all">Bestellingen</a></div>' +
        '<div class="kv" style="margin-top:12px"><div><small>Gebruikersnaam</small><span class="mono">' + K.esc(c.user || "—") + '</span></div><div><small>Klantnummer</small>' + K.esc(c.klantnr || "—") + '</div><div><small>Telefoon</small>' + (c.tel ? '<a href="tel:' + K.esc(c.tel.replace(/\s+/g, "")) + '">' + K.esc(c.tel) + '</a>' : "—") + '</div><div><small>E-mail</small>' + (c.email ? K.esc(c.email) : '<span style="color:var(--danger)">ontbreekt — geen bevestigingsmails</span>') + '</div><div style="grid-column:1/-1"><small>Leveradres</small><span style="white-space:pre-line">' + K.esc(c.adresse || "—") + '</span></div><div><small>BTW</small>' + K.esc(c.btw || "—") + '</div></div></div>' +
        '<div class="card"><div class="card-h"><div><h2 class="h2">Afgesproken prijzen</h2><p class="sub">Leeg = basisprijs · prijzen excl. btw</p></div><button type="button" class="btn btn-p btn-sm" id="savePrices" disabled>Prijzen opslaan</button></div><div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th class="num">Basisprijs</th><th class="num" style="width:150px">Prijs ' + K.esc(c.nom) + '</th></tr></thead><tbody>' + prods.map(p => { const pr = priceOf(c.id, p.id); return '<tr><td><b>' + K.esc(p.nom) + '</b><div class="quiet" style="font-size:11px">' + K.esc(K.unit(p.unite)) + (p.kaliber ? " · " + K.esc(p.kaliber) : "") + '</div></td><td class="num mono muted">' + K.eur(p.base) + '</td><td class="num"><input class="input mono" data-price="' + p.id + '" inputmode="decimal" style="min-height:40px;text-align:right;width:130px" value="' + (pr && pr.prix != null ? String(pr.prix).replace(".", ",") : "") + '" placeholder="' + K.eur(p.base).replace("€ ", "") + '"></td></tr>'; }).join("") + '</tbody></table></div></div>' : K.c.empty("Nog geen klanten", "Maak de eerste klant aan.")) + '</div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    const cq = page.querySelector("#cq"); if (cq) cq.addEventListener("input", () => { const s = cq.value.toLowerCase(); K.$$("[data-c]", page).forEach(a => { a.style.display = a.textContent.toLowerCase().includes(s) ? "" : "none"; }); });
    const changed = new Map();
    K.on(page, "input", "[data-price]", (e, t) => { changed.set(t.dataset.price, t.value); page.querySelector("#savePrices").disabled = !changed.size; page.querySelector("#savePrices").textContent = "Prijzen opslaan (" + changed.size + ")"; });
    const sp = page.querySelector("#savePrices"); if (sp) sp.onclick = async () => { K.busy(sp, true, "Opslaan…"); try { const d = await post({ action: "saveClientPrices", clientId: c.id, prices: Array.from(changed.entries()).map(([productId, prix]) => ({ productId, prix: String(prix).replace(",", ".") })) }); const bad = (d.results || []).filter(r => !r.ok); if (bad.length) K.toast(bad.length + " prijs(en) niet opgeslagen: " + bad[0].error, { kind: "err" }); else K.toast("Prijzen opgeslagen"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(sp, false); } };
    K.on(page, "click", "[data-edit]", (e, t) => clientPanel(clientById(t.dataset.edit)));
    K.on(page, "click", "[data-reset]", async (e, t) => {
      const cl = clientById(t.dataset.reset);
      // Leeg laten = Famo maakt er een aan; zelf typen = dat wachtwoord (minstens 6 tekens).
      const typed = await K.prompt({ title: "Nieuw wachtwoord voor " + cl.nom, text: "Laat leeg om automatisch een wachtwoord aan te maken, of typ zelf een wachtwoord (minstens 6 tekens). Het oude wachtwoord werkt daarna niet meer.", placeholder: "Leeg = automatisch", yes: "Wachtwoord instellen" });
      if (typed === null) return;
      const password = typed.trim();
      if (password && password.length < 6) { K.toast("Minstens 6 tekens.", { kind: "err" }); return; }
      try { const d = await post(password ? { action: "resetPassword", id: cl.id, password } : { action: "resetPassword", id: cl.id }); render(); const box = document.createElement("div"); box.innerHTML = credsBox(d.credentials); page.querySelector("#detail").prepend(box.firstChild); } catch (err) { K.toast(err.message, { kind: "err" }); }
    });
  }

  /* ---------- producten ---------- */
  function productPanel(p) {
    const v = Object.assign({ nom: "", cat: "", unite: "caisse", base: "", kaliber: "", actif: true }, p || {});
    const stockRow = (D.stock || []).find(s => s.product.toLowerCase() === String(v.nom).toLowerCase());
    const pn = K.panel({ title: p ? p.nom : "Nieuw product", sub: p ? "Product bewerken" : "Verschijnt in de klantcatalogus zodra actief", body:
      K.c.field("Naam (zoals de klant het ziet)", K.c.input("pNom", { value: v.nom }), { id: "fPNom", req: true }) +
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' + K.c.field("Kaliber", K.c.input("pKal", { value: v.kaliber, placeholder: "bv. 16/20" }), {}) + K.c.field("Eenheid", '<select class="input" id="pUnit">' + [["caisse", "kassa"], ["pièce", "stuk"], ["kg", "kg"], ["carton", "doos"]].map(([val, l]) => '<option value="' + val + '"' + (v.unite === val ? " selected" : "") + '>' + l + '</option>').join("") + '</select>', {}) + K.c.field("Basisprijs excl. btw", K.c.input("pBase", { value: v.base === "" ? "" : String(v.base).replace(".", ","), attrs: ' inputmode="decimal"' }), { id: "fPBase", req: true }) + '</div>' +
      K.c.field("Categorie", K.c.input("pCat", { value: v.cat, placeholder: "bv. Garnalen, Vis, Schelpdieren", attrs: ' list="cats"' }) + '<datalist id="cats">' + Array.from(new Set((D.products || []).map(x => x.cat).filter(Boolean))).map(x => '<option value="' + K.esc(x) + '">').join("") + '</datalist>', {}) +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + K.c.field("Voorraad (optioneel)", K.c.input("pStock", { value: stockRow ? stockRow.quantity : "", attrs: ' inputmode="decimal"' }), { hint: "Wordt niet automatisch afgetrokken (bewust, tot de telling klopt)." }) + K.c.field("Drempel", K.c.input("pLow", { value: stockRow ? stockRow.lowThreshold : "", attrs: ' inputmode="decimal"' }), {}) + '</div>' +
      '<label style="display:flex;gap:10px;align-items:center;font-size:13px"><button type="button" class="toggle' + (v.actif ? " on" : "") + '" id="pActif" aria-pressed="' + (v.actif ? "true" : "false") + '"></button>Actief in de catalogus</label>' +
      '<div class="notice" style="font-size:12.5px"><div>Foto: upload ze rechtstreeks in Airtable (kolom Foto, tabel Catalogue). Ze verschijnt automatisch in de catalogus.</div></div><div id="pErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="pOk">Opslaan</button>' });
    let actif = !!v.actif; const tg = pn.el.querySelector("#pActif"); tg.onclick = () => { actif = !actif; tg.classList.toggle("on", actif); };
    pn.el.querySelector("[data-cancel]").onclick = pn.close;
    pn.el.querySelector("#pOk").onclick = async () => {
      const val = id => pn.el.querySelector("#" + id).value.trim();
      const nom = val("pNom"), base = Number(val("pBase").replace(",", "."));
      K.setErr("fPNom", nom ? "" : "Verplicht."); K.setErr("fPBase", Number.isFinite(base) && val("pBase") !== "" ? "" : "Geef een prijs."); if (!nom || !Number.isFinite(base) || val("pBase") === "") return;
      const btn = pn.el.querySelector("#pOk"); K.busy(btn, true, "Opslaan…");
      try { await post({ action: "saveProduct", id: p ? p.id : undefined, nom, cat: val("pCat"), unite: val("pUnit"), base, kaliber: val("pKal"), actif, stock: val("pStock") === "" ? undefined : Number(val("pStock").replace(",", ".")), lowThreshold: val("pLow") === "" ? undefined : Number(val("pLow").replace(",", ".")) }); pn.close(); K.toast("Product opgeslagen"); render(); }
      catch (err) { pn.el.querySelector("#pErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  }
  function producten() {
    const all = D.products || []; const groups = {}; all.forEach(p => { (groups[p.cat || "Algemeen"] = groups[p.cat || "Algemeen"] || []).push(p); });
    const nAfsp = pid => (D.prices || []).filter(x => x.productId === pid && x.prix != null).length;
    page.innerHTML = head(all.filter(p => p.actif).length + " actief · " + all.filter(p => !p.actif).length + " inactief", '<button type="button" class="btn btn-p btn-sm" data-new-product>' + K.icon("plus") + 'Nieuw product</button>') +
      '<div class="content" style="padding-top:16px">' + Object.keys(groups).sort((a, b) => a.localeCompare(b, "nl")).map(g => '<div class="grp"><div class="grp-h" style="border-left-color:var(--p)">' + K.esc(g) + ' <small>' + groups[g].length + '</small></div><div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th>Kaliber</th><th>Eenheid</th><th class="num">Basisprijs</th><th>Afspraken</th><th>Actief</th><th></th></tr></thead><tbody>' + groups[g].map(p => '<tr class="row" data-p="' + p.id + '"><td><b>' + K.esc(p.nom) + '</b></td><td>' + K.esc(p.kaliber || "—") + '</td><td>' + K.esc(K.unit(p.unite)) + '</td><td class="num mono">' + K.eur(p.base) + '</td><td class="muted">' + (nAfsp(p.id) ? nAfsp(p.id) + " klant" + (nAfsp(p.id) === 1 ? "" : "en") : "—") + '</td><td style="width:110px">' + (p.actif ? '<span class="cell-st c-done">Actief</span>' : '<span class="cell-st c-inv">Inactief</span>') + '</td><td style="text-align:right"><button type="button" class="btn btn-o btn-sm" data-p-edit="' + p.id + '">Bewerken</button></td></tr>').join("") + '</tbody></table></div></div>').join("") + (all.length ? "" : K.c.empty("Nog geen producten", "Maak het eerste product aan.")) + '</div>';
    K.on(page, "click", "[data-p-edit]", (e, t) => { e.stopPropagation(); productPanel(all.find(p => p.id === t.dataset.pEdit)); });
    K.on(page, "click", "tr[data-p]", (e, t) => { if (e.target.closest("button")) return; productPanel(all.find(p => p.id === t.dataset.p)); });
  }

  /* ---------- prijzen (matrix) ---------- */
  function prijzen() {
    const prods = (D.products || []).filter(p => p.actif), cls = D.clients || [];
    const changed = new Map();
    page.innerHTML = head("Afgesproken prijzen per klant en product · leeg = basisprijs", '<button type="button" class="btn btn-p btn-sm" id="saveAll" disabled>Wijzigingen opslaan</button>') +
      '<div class="content" style="padding-top:16px"><div class="grp"><div class="tblwrap"><table class="tbl"><thead><tr><th style="min-width:200px">Product</th><th class="num">Basis</th>' + cls.map(c => '<th class="num" style="min-width:120px">' + K.esc(c.nom) + '</th>').join("") + '</tr></thead><tbody>' + prods.map(p => '<tr><td><b>' + K.esc(p.nom) + '</b><div class="quiet" style="font-size:11px">' + K.esc(K.unit(p.unite)) + '</div></td><td class="num mono muted">' + K.eur(p.base) + '</td>' + cls.map(c => { const pr = priceOf(c.id, p.id); return '<td class="num"><input class="input mono" data-m="' + c.id + '|' + p.id + '" inputmode="decimal" style="min-height:38px;text-align:right;width:110px;padding:0 8px' + (pr && pr.prix != null && pr.prix < p.base ? ";color:var(--st-done-ink);font-weight:600" : "") + '" value="' + (pr && pr.prix != null ? String(pr.prix).replace(".", ",") : "") + '" placeholder="—"></td>'; }).join("") + '</tr>').join("") + '</tbody></table></div></div><p class="quiet" style="font-size:12.5px">Een leeg vak = de klant betaalt de basisprijs. 0 is een geldige prijs. Wijzigingen gelden vanaf de volgende bestelling.</p></div>';
    K.on(page, "input", "[data-m]", (e, t) => { changed.set(t.dataset.m, t.value); const b = page.querySelector("#saveAll"); b.disabled = false; b.textContent = "Wijzigingen opslaan (" + changed.size + ")"; });
    page.querySelector("#saveAll").onclick = async () => {
      const b = page.querySelector("#saveAll"); K.busy(b, true, "Opslaan…"); let fail = 0;
      const byClient = {}; changed.forEach((v, k) => { const [cid, pid] = k.split("|"); (byClient[cid] = byClient[cid] || []).push({ productId: pid, prix: String(v).replace(",", ".") }); });
      for (const cid of Object.keys(byClient)) { try { const d = await post({ action: "saveClientPrices", clientId: cid, prices: byClient[cid] }); fail += (d.results || []).filter(r => !r.ok).length; } catch (err) { fail++; } }
      K.toast(fail ? fail + " prijs(en) niet opgeslagen" : "Prijzen opgeslagen", { kind: fail ? "err" : "" }); render();
    };
  }

  /* ---------- bedrijf ---------- */
  function bedrijf() {
    const c = D.config;
    const f = (label, id, val, extra) => K.c.field(label, K.c.input(id, Object.assign({ value: val == null ? "" : val }, extra || {})), { id: "f_" + id });
    page.innerHTML = head("Verschijnt op facturen, leveringsbonnen en e-mails", '<button type="button" class="btn btn-o btn-sm" id="preview">Voorbeeldfactuur</button><button type="button" class="btn btn-p btn-sm" id="save">Opslaan</button>') +
      '<div class="content" style="padding-top:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start" id="two">' +
      '<div class="card card-b" style="display:flex;flex-direction:column;gap:12px"><h2 class="h2">Identiteit</h2>' + f("Bedrijfsnaam", "bedrijfsnaam", c.bedrijfsnaam) + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + f("Adres", "adres", c.adres) + f("Postcode en plaats", "plaats", c.plaats) + f("BTW-nummer", "btw", c.btw) + f("BTW-tarief (%)", "btwTarief", c.btwTarief, { attrs: ' inputmode="decimal"' }) + f("Telefoon", "telefoon", c.telefoon, { type: "tel" }) + f("E-mail (op documenten)", "email", c.email, { type: "email" }) + '</div></div>' +
      '<div class="card card-b" style="display:flex;flex-direction:column;gap:12px"><h2 class="h2">Bank &amp; voorwaarden</h2>' + (D.status.ibanOntbreekt ? K.c.warn("<b>IBAN ontbreekt.</b> Zolang dit leeg is, tonen facturen voorbeeldbankgegevens.") : "") + '<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">' + f("IBAN", "iban", c.iban, { placeholder: "BE00 0000 0000 0000" }) + f("BIC", "bic", c.bic) + '</div>' + f("Betalingsvoorwaarden (onder de factuur)", "betalingsvoorwaarden", c.betalingsvoorwaarden, { placeholder: "bv. Betaalbaar binnen 14 dagen" }) + K.c.field("Leveringsvoorwaarden (onder de leveringsbon)", '<textarea class="input" id="leveringsvoorwaarden" rows="3">' + K.esc(c.leveringsvoorwaarden || "") + '</textarea>', {}) + '</div>' +
      '<div class="card card-b" style="display:flex;flex-direction:column;gap:12px"><h2 class="h2">E-mail</h2>' + f("Interne postbus (melding bij elke bestelling)", "bestellingenEmail", c.bestellingenEmail, { type: "email" }) + '<div class="notice" style="font-size:12.5px"><div>' + (D.status.mailEnabled ? "E-mail is actief. " : "<b>E-mail is niet actief</b> (RESEND_API_KEY ontbreekt op Vercel). ") + 'Afzender en domein worden op Vercel ingesteld (MAIL_FROM).</div></div></div>' +
      '<div class="card card-b quiet" style="font-size:12.5px"><b style="color:var(--ink)">Bestellen &amp; leveren</b><br>Besteldeadline 22:00 en leverdagen ma–za zijn nu vaste teksten in het klantportaal. Instelbaar maken komt later.</div><div id="bErr" style="grid-column:1/-1"></div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    page.querySelector("#preview").onclick = () => { const cfg = collect(); FamoDocuments.setCompany(cfg); const sample = { ref: "CMD-2026-0001", client: "Voorbeeldklant", klant: { adresse: "Straat 1, 2000 Antwerpen", btw: "BE 0000.000.000", klantnr: "K-000" }, lignes: "Vannamei garnalen 16/20 × 2 caisse [€9.50]\nZalmfilet × 1 kg [€20.20]", total: 39.2, factuurnummer: "FA-2026-0000", paiement: "En attente", dateLiv: K.today() }; famoDocPreview.open({ html: FamoDocuments.build(sample, "invoice"), filename: "Famo-Voorbeeldfactuur.pdf", title: "Voorbeeldfactuur", meta: "met de gegevens zoals nu ingevuld" }); };
    function collect() { const v = id => page.querySelector("#" + id).value.trim(); return { bedrijfsnaam: v("bedrijfsnaam"), adres: v("adres"), plaats: v("plaats"), btw: v("btw"), btwTarief: Number(v("btwTarief").replace(",", ".")), telefoon: v("telefoon"), email: v("email"), iban: v("iban"), bic: v("bic"), betalingsvoorwaarden: v("betalingsvoorwaarden"), leveringsvoorwaarden: v("leveringsvoorwaarden"), bestellingenEmail: v("bestellingenEmail") }; }
    page.querySelector("#save").onclick = async () => { const b = page.querySelector("#save"); K.busy(b, true, "Opslaan…"); try { await post(Object.assign({ action: "saveConfig" }, collect())); S.config = null; K.toast("Bedrijfsgegevens opgeslagen"); render(); } catch (err) { page.querySelector("#bErr").innerHTML = K.c.error(err.message); K.busy(b, false); } };
  }

  /* ---------- toegang ---------- */
  function toegang() {
    const c = D.config;
    const codeCard = (which, title, sub, custom) => '<div class="card card-b" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:center;gap:10px">' + K.c.avatar(title) + '<div><h2 class="h2">' + title + '</h2><p class="sub" style="white-space:normal">' + sub + '</p></div></div><div>' + (custom ? '<span class="chip st-done"><i></i>Eigen code ingesteld</span>' : '<span class="chip st-new"><i></i>Code uit Vercel (' + (which === "admin" ? "ADMIN_CODE" : "STAFF_CODE") + ')</span>') + '</div>' + K.c.field("Nieuwe code (minstens 10 tekens)", K.c.input("code_" + which, { type: "password", attrs: ' autocomplete="new-password"' }), { id: "f_code_" + which }) + '<div style="display:flex;gap:8px"><button type="button" class="btn btn-p btn-sm" data-setcode="' + which + '">Code instellen</button>' + (custom ? '<button type="button" class="btn btn-ghost btn-sm" data-resetcode="' + which + '">Terug naar Vercel-code</button>' : "") + '</div></div>';
    page.innerHTML = head("Wie kan wat · codes en klantaccounts") + '<div class="content" style="padding-top:16px">' + (!c.adminCodeCustom && !c.staffCodeCustom ? K.c.warn("<b>Zolang beide codes uit Vercel komen en gelijk zijn, kan personeel in Beheer.</b> Stel hieronder minstens de personeelscode apart in.") : "") + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px" id="two">' + codeCard("admin", "Beheerder", "Alles: klanten, prijzen, documenten, instellingen.", c.adminCodeCustom) + codeCard("staff", "Personeel", "Bestellingen, Magazijn, Leveringen, Documenten.", c.staffCodeCustom) + '</div>' +
      '<div class="card card-b" style="margin-top:16px"><h2 class="h2">Klanten</h2><p class="sub" style="white-space:normal">' + D.status.credentials + ' van ' + D.status.clients + ' klanten hebben een gebruikersnaam en wachtwoord. Wachtwoorden beheert u per klant (Klanten → Nieuw wachtwoord). Na 5 foute pogingen wacht een account 30 seconden.</p><a class="btn btn-o btn-sm" href="#/klanten" style="margin-top:8px">Naar klanten</a></div><div id="tErr"></div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    K.on(page, "click", "[data-setcode]", async (e, t) => { const which = t.dataset.setcode, code = page.querySelector("#code_" + which).value; K.setErr("f_code_" + which, code.length >= 10 ? "" : "Minstens 10 tekens."); if (code.length < 10) return; if (!(await K.confirm({ title: "Code voor " + (which === "admin" ? "beheerder" : "personeel") + " wijzigen?", text: "De oude code werkt meteen niet meer. Geef de nieuwe door aan wie ze nodig heeft.", yes: "Wijzigen" }))) return; K.busy(t, true, "Opslaan…"); try { await post({ action: "saveCode", which, code }); K.toast("Code ingesteld"); render(); } catch (err) { page.querySelector("#tErr").innerHTML = K.c.error(err.message); K.busy(t, false); } });
    K.on(page, "click", "[data-resetcode]", async (e, t) => { const which = t.dataset.resetcode; if (!(await K.confirm({ title: "Terug naar de Vercel-code?", text: "De eigen code wordt gewist.", yes: "Wissen", danger: true }))) return; try { await post({ action: "saveCode", which, reset: true }); K.toast("Eigen code gewist"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } });
  }

  /* ---------- status ---------- */
  async function status() {
    const st = D.status, c = D.config;
    page.innerHTML = head("Alles wat het portaal nodig heeft om te draaien", '<button type="button" class="btn btn-o btn-sm" id="recheck">' + K.icon("refresh") + 'Nu controleren</button>') + '<div class="content" style="padding-top:16px"><div class="kpis" id="cards">' + K.c.skeleton(1) + '</div><div id="health"></div></div>';
    const t0 = Date.now(); let api = null, apiMs = 0; try { api = await K.api("/api/config?status=1"); apiMs = Date.now() - t0; } catch (e) { api = { error: e.message }; }
    const cards = [
      ["Gegevens (Airtable)", api && !api.error ? "ok" : "bad", api && !api.error ? "Antwoord " + apiMs + " ms · " + (api.status.orders || 0) + " bestellingen · " + (api.status.clients || 0) + " klanten" : "Geen verbinding: " + (api && api.error), "Let op: het gratis Airtable-plan heeft een maandelijkse API-limiet. Bij overschrijding weigert Airtable tot de volgende maand."],
      ["E-mail (Resend)", st.mailEnabled ? (st.mailReady ? "ok" : "warn") : "bad", st.mailEnabled ? (st.mailReady ? "Actief · interne postbus " + c.bestellingenEmail : "Sleutel aanwezig, maar geen interne postbus ingesteld") : "RESEND_API_KEY ontbreekt op Vercel", "Klanten krijgen enkel mail als het afzenderdomein bij Resend geverifieerd is."],
      ["Hosting (Vercel)", "ok", "Deze pagina laadt, dus de hosting draait", "Versies en logboek: vercel.com → project famo-portail."],
      ["Toegang", c.adminCodeCustom && c.staffCodeCustom ? "ok" : "warn", c.adminCodeCustom && c.staffCodeCustom ? "Aparte codes voor beheerder en personeel" : "Codes nog niet apart ingesteld", ""]
    ];
    page.querySelector("#cards").innerHTML = cards.map(([t, s, d, n]) => '<div class="kp"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:14px;margin:0">' + t + '</b><span class="cell-st c-' + (s === "ok" ? "done" : s === "warn" ? "new" : "late") + '" style="min-width:64px">' + (s === "ok" ? "OK" : s === "warn" ? "Let op" : "Fout") + '</span></div><div class="muted" style="font-size:12.5px;margin-top:6px">' + K.esc(d) + '</div>' + (n ? '<div class="quiet" style="font-size:11.5px;margin-top:6px">' + K.esc(n) + '</div>' : "") + '</div>').join("");
    const issues = [];
    if (st.ibanOntbreekt) issues.push(["IBAN of BIC ontbreekt", "#/bedrijf"]); if (st.klantenZonderEmail) issues.push([st.klantenZonderEmail + " klant(en) zonder e-mail", "#/klanten"]); if (!(c.adminCodeCustom && c.staffCodeCustom)) issues.push(["Codes personeel en beheerder niet apart", "#/toegang"]); if (!st.stockReady) issues.push(["Voorraadtabel leeg — voorraad wordt niet afgetrokken (bewust)", "/stock.html"]); if (st.aanvragen) issues.push([st.aanvragen + " nieuwe aanvraag/aanvragen", "#/aanvragen"]);
    page.querySelector("#health").innerHTML = '<div class="card" style="margin-top:16px"><div class="card-h"><h2 class="h2">Gezondheid van de gegevens</h2></div>' + (issues.length ? issues.map(([t, h]) => '<div class="stop" style="min-height:48px"><span class="chip st-new"><i></i>!</span><span style="flex:1">' + K.esc(t) + '</span><a class="btn btn-o btn-sm" href="' + h + '">Bekijken</a></div>').join("") : '<div class="card-b">' + K.c.ok("Alles in orde.") + '</div>') + '</div><p class="quiet" style="font-size:12.5px;margin-top:12px">Wie te bellen: ontwikkelaar Ayoub · eigenaar Bilal.</p>';
    page.querySelector("#recheck").onclick = () => render(true);
  }

  async function render(force) {
    if (force || !D) { try { await load(); } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message, true) + '</div>'; K.on(page, "click", "[data-retry]", e => { e.preventDefault(); render(true); }); return; } }
    if (!D.config) D.config = {};
    ({ overzicht, aanvragen, klanten, producten, prijzen, bedrijf, toegang, status })[tab] ? await ({ overzicht, aanvragen, klanten, producten, prijzen, bedrijf, toegang, status })[tab]() : overzicht();
  }
  K.on(page, "click", "[data-new-client]", () => clientPanel(null));
  K.on(page, "click", "[data-new-product]", () => productPanel(null));
  window.addEventListener("hashchange", () => { const h = K.hashParams(); tab = h.path || "overzicht"; if (h.params.klant) sel = h.params.klant; render(); });
  page.innerHTML = '<div class="page-h"><h1 class="h1">Beheer</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  render(true);
})();
