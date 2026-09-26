(async function () {
  if (!(await K.requireStaff({ admin: true }))) return;
  const page = K.shell({ portal: "beheer" });
  const TABS = [["overzicht", "Overzicht"], ["aanvragen", "Aanvragen"], ["klanten", "Klanten"], ["producten", "Producten"], ["prijzen", "Prijzen"], ["rapportage", "Rapportage"], ["bedrijf", "Bedrijfsgegevens"], ["toegang", "Toegang"], ["status", "Systeemstatus"]];
  const DAGEN = [["ma", "maandag"], ["di", "dinsdag"], ["wo", "woensdag"], ["do", "donderdag"], ["vr", "vrijdag"], ["za", "zaterdag"], ["zo", "zondag"]];
  // pendingCreds : net aangemaakt wachtwoord, één keer getoond bovenaan de klantfiche (overleeft de hash-herrender).
  let D = null, tab = K.hashParams().path || "overzicht", sel = K.hashParams().params.klant || "", pendingCreds = null;
  const post = async (json) => { const d = await K.api("/api/onboarding", { json }); D = d; return d; };
  const load = async () => { D = await K.api("/api/onboarding"); };
  const clientById = id => (D.clients || []).find(c => c.id === id);
  // Index client|product reconstruit seulement quand D.prices change (grille produits × klanten : O(1) par cellule).
  let priceIdx = null, priceSrc = null;
  const priceOf = (cid, pid) => { if (priceSrc !== D.prices) { priceSrc = D.prices; priceIdx = new Map((D.prices || []).map(p => [p.clientId + "|" + p.productId, p])); } return priceIdx.get(cid + "|" + pid); };
  const head = (sub, right) => '<div class="page-h"><div><h1 class="h1">' + K.esc((TABS.find(t => t[0] === tab) || ["", "Beheer"])[1]) + '</h1><p class="sub">' + K.esc(sub) + '</p></div><span class="spacer"></span>' + (right || "") + '</div><nav class="tabs">' + TABS.map(([k, l]) => '<a href="#/' + k + '"' + (tab === k ? ' class="on"' : "") + '>' + l + (k === "aanvragen" && D.status.aanvragen ? ' <span class="chip st-new" style="height:20px;padding:0 7px;margin-left:4px">' + D.status.aanvragen + '</span>' : "") + '</a>').join("") + '</nav>';
  const credsBox = c => K.c.ok('<b>Toegang voor ' + K.esc(c.nom) + '</b><div style="margin-top:6px;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px"><span class="quiet">Gebruikersnaam</span><b class="mono" style="user-select:all">' + K.esc(c.user) + '</b><span class="quiet">Wachtwoord</span><b class="mono" style="user-select:all">' + K.esc(c.password) + '</b></div><div class="quiet" style="font-size:12px;margin-top:6px">Wordt maar één keer getoond. Geef het door aan de klant (telefoon of WhatsApp), niet per onbeveiligde mail.</div>');
  // Ingeklapte groep (gearchiveerde klanten, verwerkte aanvragen) : zelfde kop als een .grp.
  const fold = (title, n, inner) => '<details class="grp" style="margin-top:14px"><summary class="grp-h" style="cursor:pointer;list-style:none;border-left-color:var(--line)">' + K.icon("chev") + K.esc(title) + ' <small>' + n + '</small></summary>' + inner + '</details>';
  const dateTime = v => v ? K.date(K.isoDay(v)) + " " + K.time(v) : "—";
  // CSV voor Excel (nl-BE) : puntkomma, ; cellen die met = + - @ beginnen krijgen een apostrof (formule-injectie).
  const csvCell = v => { let s = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const download = (name, rows) => { const blob = new Blob(["﻿" + rows.map(r => r.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  const csvNum = v => (Math.round(Number(v) * 100) / 100).toFixed(2).replace(".", ",");

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
      '<div class="kpis"><div class="kp"><small>Open bestellingen</small><b>' + orders.filter(o => !K.isClosed(o)).length + '</b><em>' + c.today + ' vandaag</em></div><div class="kp"><small>Openstaand te betalen</small><b class="mono">' + K.eur(c.unpaidSum) + '</b><em>' + c.unpaid + ' factu' + (c.unpaid === 1 ? "ur" : "ren") + '</em></div><div class="kp"><small>Klanten</small><b>' + st.clients + '</b><em>' + st.credentials + ' met toegang</em></div><div class="kp"><small>Producten actief</small><b>' + st.catalogue + '</b><em>' + st.prijzen + ' prijsafspraken</em></div></div>' +
      (issues.length ? '<div class="card"><div class="card-h"><h2 class="h2">Aandachtspunten</h2></div>' + issues.map(([t, h]) => '<div class="stop" style="min-height:48px"><span class="chip st-new"><i></i>!</span><span style="flex:1">' + t + '</span><a class="btn btn-o btn-sm" href="' + h + '">Bekijken</a></div>').join("") + '</div>' : K.c.ok("Alles is ingevuld. Geen aandachtspunten.")) +
      '<div class="card"><div class="card-h"><h2 class="h2">Laatste bestellingen</h2><a class="btn btn-o btn-sm" href="/bestellingen.html">Alle bestellingen</a></div>' + (orders.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Levering</th><th>Klant</th><th>Artikelen</th><th>Status</th><th class="num">Bedrag</th></tr></thead><tbody>' + orders.slice(0, 6).map(o => '<tr class="row" data-open="' + o.id + '"><td><b>' + K.esc(K.relDay(o.day)) + '</b></td><td>' + K.esc(o.client) + '</td><td class="muted">' + K.esc(S.lineTxt(o)) + '</td><td style="width:130px">' + K.stCell(o.statut) + '</td><td class="num mono">' + K.eur(o.total) + '</td></tr>').join("") + '</tbody></table></div>' : '<div class="empty" style="margin:12px">Nog geen bestellingen.</div>') + '</div></div>';
    K.on(page, "click", "tr[data-open]", (e, t) => { location.href = "/order.html?id=" + encodeURIComponent(t.dataset.open); });
  }

  /* ---------- aanvragen ---------- */
  function aanvragen() {
    const all = D.aanvragen || [], list = all.filter(a => a.status === "Nieuw"), done = all.filter(a => a.status !== "Nieuw");
    const contact = a => '<div class="muted" style="font-size:12.5px">' + K.esc(a.contactpersoon) + ' · ' + (a.telefoon ? '<a href="tel:' + K.esc(String(a.telefoon).replace(/\s+/g, "")) + '">' + K.esc(a.telefoon) + '</a>' : '<span class="quiet">geen telefoon</span>') + ' · <a href="mailto:' + K.esc(a.email) + '">' + K.esc(a.email) + '</a></div>';
    page.innerHTML = head("Aanvragen via de website") + '<div class="content" style="padding-top:16px"><div class="card"><div class="card-h"><h2 class="h2">Nieuw <small class="quiet" style="font-weight:400">' + list.length + '</small></h2></div>' + (list.length ? list.map(a => '<div class="stop" style="align-items:flex-start;padding:14px"><div style="flex:1;min-width:0"><b>' + K.esc(a.bedrijfsnaam) + '</b><span class="quiet" style="font-size:11.5px;margin-left:8px">ontvangen ' + K.esc(dateTime(a.ontvangen)) + '</span>' + contact(a) + (a.adres ? '<div class="quiet" style="font-size:12.5px">' + K.esc(a.adres) + '</div>' : "") + (a.notities ? '<div style="font-size:12.5px;margin-top:4px">„' + K.esc(a.notities) + '”</div>' : "") + '</div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="btn btn-p btn-sm" data-accept="' + a.id + '">Klant aanmaken</button><button type="button" class="btn btn-ghost btn-sm" data-close="' + a.id + '">Afsluiten</button></div></div>').join("") : '<div class="empty" style="margin:12px">Geen nieuwe aanvragen. Het formulier staat op <a href="/aanvraag.html">/aanvraag.html</a>.</div>') + '</div><p class="quiet" style="font-size:12.5px">„Klant aanmaken” vult de klantfiche vooraf in en maakt gebruikersnaam en wachtwoord aan; de aanvraag sluit automatisch.</p>' +
      (done.length ? fold("Verwerkt", done.length, '<div class="tblwrap"><table class="tbl"><thead><tr><th>Ontvangen</th><th>Bedrijf</th><th>Contact</th><th>Status</th></tr></thead><tbody>' + done.map(a => '<tr><td class="muted">' + K.esc(dateTime(a.ontvangen)) + '</td><td><b>' + K.esc(a.bedrijfsnaam) + '</b>' + (a.adres ? '<div class="quiet" style="font-size:11px">' + K.esc(a.adres) + '</div>' : "") + '</td><td class="wrap">' + contact(a) + '</td><td style="width:120px"><span class="cell-st c-done">' + K.esc(a.status) + '</span></td></tr>').join("") + '</tbody></table></div>') : "") + '</div>';
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
      (c ? K.c.field("Gebruikersnaam", K.c.input("cUser", { value: v.user }), { hint: "Wijzigen? De klant moet het nieuwe login kennen." }) + '<label style="display:flex;gap:10px;align-items:center;font-size:13px">' + K.c.check(false, 'id="cGen"') + 'Nieuw wachtwoord aanmaken en tonen</label>' : "") +
      K.c.field(c ? "Of zelf een nieuw wachtwoord kiezen (optioneel)" : "Eigen wachtwoord (optioneel)", K.c.input("cPw", { attrs: ' autocomplete="new-password"' }), { id: "fPw", hint: "Minstens 8 tekens. Leeg = automatisch aangemaakt." + (c ? " Leeg + vinkje uit = wachtwoord blijft." : "") }) +
      '<label style="display:flex;gap:10px;align-items:center;font-size:13px">' + K.c.check(true, 'id="cMailSend"') + '<span>Welkomstmail sturen<span class="quiet" style="font-size:12px;display:block">Met gebruikersnaam en wachtwoord, enkel als er een e-mailadres is en er een (nieuw) wachtwoord wordt aangemaakt.</span></span></label><div id="cErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="cOk">' + (c ? "Opslaan" : "Klant aanmaken") + '</button>' });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    let gen = false, sendMail = true; const g = p.el.querySelector("#cGen"); if (g) g.onclick = () => { gen = !gen; K.setOn(g, gen); };
    const ms = p.el.querySelector("#cMailSend"); ms.onclick = () => { sendMail = !sendMail; K.setOn(ms, sendMail); };
    p.el.querySelector("#cOk").onclick = async () => {
      const val = id => p.el.querySelector("#" + id).value.trim();
      const nom = val("cNom"), pw = p.el.querySelector("#cPw").value; K.setErr("fNom", nom ? "" : "Verplicht."); K.setErr("fPw", pw && pw.length < 8 ? "Minstens 8 tekens." : ""); if (!nom || (pw && pw.length < 8)) return;
      const btn = p.el.querySelector("#cOk"); K.busy(btn, true, "Opslaan…");
      try {
        const d = await post({ action: "saveClient", id: c ? c.id : undefined, nom, adresse: val("cAdr"), tel: val("cTel"), email: val("cMail"), btw: val("cBtw"), klantnr: val("cNr"), user: c ? val("cUser") : "", password: pw || undefined, generate: pw ? false : (c ? gen : true), sendMail });
        if (prefill && prefill.aanvraagId) { try { await post({ action: "closeAanvraag", id: prefill.aanvraagId }); } catch (e) { /* al gesloten */ } }
        p.close(); tab = "klanten"; sel = d.credentials.id; if (!c || gen || pw) pendingCreds = d.credentials;
        // Eén render : via hashchange als de hash verandert, anders rechtstreeks (anders wist de tweede render de codes).
        const target = "#/klanten?klant=" + encodeURIComponent(sel); if (location.hash === target) render(); else location.hash = target;
        K.toast((c ? "Klant opgeslagen" : "Klant aangemaakt") + (d.mail && d.mail.ok ? " · Welkomstmail verstuurd" : ""));
      } catch (err) { if (err.status === 409 && /gebruikersnaam/i.test(err.message) && c) K.setErr("fNom", ""); p.el.querySelector("#cErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  }
  function klanten() {
    const all = D.clients || [], list = all.filter(x => !x.gearchiveerd), arch = all.filter(x => x.gearchiveerd);
    if (!sel && list.length) sel = list[0].id; const c = clientById(sel);
    const prods = (D.products || []).filter(p => p.actif);
    const row = x => '<a href="#/klanten?klant=' + x.id + '" class="stop" data-c="' + x.id + '" style="min-height:48px;text-decoration:none;color:inherit' + (x.id === sel ? ";background:var(--p-soft)" : "") + '">' + K.c.avatar(x.nom) + '<div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(x.nom) + '</b><span class="quiet" style="font-size:11.5px">' + K.esc(x.klantnr || x.user || "") + (x.email ? "" : " · geen e-mail") + '</span></div></a>';
    page.innerHTML = head(list.length + " klanten · " + D.status.credentials + " met toegang" + (arch.length ? " · " + arch.length + " gearchiveerd" : ""), '<button type="button" class="btn btn-p btn-sm" data-new-client>' + K.icon("plus") + 'Nieuwe klant</button>') +
      '<div class="content" style="padding-top:16px;display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start" id="two">' +
      '<div><div class="card"><div class="card-h"><label class="search">' + K.icon("search") + '<input id="cq" placeholder="Zoeken…"></label></div><div id="clist">' + list.map(row).join("") + '</div></div>' + (arch.length ? fold("Gearchiveerd", arch.length, '<div id="alist">' + arch.map(row).join("") + '</div>') : "") + '</div>' +
      '<div id="detail" style="display:flex;flex-direction:column;gap:14px;min-width:0">' + (c && pendingCreds && pendingCreds.id === c.id ? credsBox(pendingCreds) : "") + (c ? '<div class="card card-b"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><h2 class="h2">' + K.esc(c.nom) + '</h2>' + (c.gearchiveerd ? '<span class="chip st-cancel"><i></i>Gearchiveerd</span>' : c.user && c.hasPassword ? '<span class="chip st-done"><i></i>Toegang actief</span>' : '<span class="chip st-new"><i></i>Geen toegang</span>') + '<span class="spacer"></span>' + (c.gearchiveerd ? '<button type="button" class="btn btn-p btn-sm" data-unarchive="' + c.id + '">Herstellen</button>' : '<button type="button" class="btn btn-o btn-sm" data-reset="' + c.id + '">Nieuw wachtwoord</button>' + (c.user && c.hasPassword ? '<button type="button" class="btn btn-ghost btn-sm" data-revoke="' + c.id + '" style="color:var(--danger)">Toegang blokkeren</button>' : "") + '<button type="button" class="btn btn-ghost btn-sm" data-archive="' + c.id + '">Archiveren</button>') + '<button type="button" class="btn btn-o btn-sm" data-edit="' + c.id + '">Bewerken</button><a class="btn btn-o btn-sm" href="/bestellingen.html?klant=' + encodeURIComponent(c.id) + '">Bestellingen</a></div>' +
        (c.gearchiveerd ? K.c.warn("<b>Gearchiveerd.</b> De klant kan niet aanmelden en staat niet in de lijsten. Fiche, prijzen en bestellingen blijven bewaard. „Herstellen” zet alles terug.") : "") +
        '<div class="kv" style="margin-top:12px"><div><small>Gebruikersnaam</small><span class="mono">' + K.esc(c.user || "—") + '</span></div><div><small>Klantnummer</small>' + K.esc(c.klantnr || "—") + '</div><div><small>Telefoon</small>' + (c.tel ? '<a href="tel:' + K.esc(c.tel.replace(/\s+/g, "")) + '">' + K.esc(c.tel) + '</a>' : "—") + '</div><div><small>E-mail</small>' + (c.email ? K.esc(c.email) : '<span style="color:var(--danger)">ontbreekt — geen bevestigingsmails</span>') + '</div><div style="grid-column:1/-1"><small>Leveradres</small><span style="white-space:pre-line">' + K.esc(c.adresse || "—") + '</span></div><div><small>BTW</small>' + K.esc(c.btw || "—") + '</div></div></div>' +
        '<div class="card"><div class="card-h"><div><h2 class="h2">Afgesproken prijzen</h2><p class="sub">Leeg = basisprijs · prijzen excl. btw</p></div><button type="button" class="btn btn-p btn-sm" id="savePrices" disabled>Prijzen opslaan</button></div><div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th class="num">Basisprijs</th><th class="num" style="width:150px">Prijs ' + K.esc(c.nom) + '</th></tr></thead><tbody>' + prods.map(p => { const pr = priceOf(c.id, p.id); return '<tr><td><b>' + K.esc(p.nom) + '</b><div class="quiet" style="font-size:11px">' + K.esc(K.unit(p.unite)) + (p.kaliber ? " · " + K.esc(p.kaliber) : "") + '</div></td><td class="num mono muted">' + K.eur(p.base) + '</td><td class="num"><input class="input mono" data-price="' + p.id + '" inputmode="decimal" style="min-height:40px;text-align:right;width:130px" value="' + (pr && pr.prix != null ? String(pr.prix).replace(".", ",") : "") + '" placeholder="' + K.eur(p.base).replace("€ ", "") + '"></td></tr>'; }).join("") + '</tbody></table></div></div>' : K.c.empty("Nog geen klanten", "Maak de eerste klant aan.")) + '</div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    if (c && pendingCreds && pendingCreds.id === c.id) pendingCreds = null;
    if (c && c.gearchiveerd) { const d = page.querySelector("details"); if (d) d.open = true; }
    const cq = page.querySelector("#cq"); if (cq) cq.addEventListener("input", () => { const s = cq.value.toLowerCase(); K.$$("[data-c]", page).forEach(a => { a.style.display = a.textContent.toLowerCase().includes(s) ? "" : "none"; }); });
    const changed = new Map();
    K.on(page, "input", "[data-price]", (e, t) => { changed.set(t.dataset.price, t.value); page.querySelector("#savePrices").disabled = !changed.size; page.querySelector("#savePrices").textContent = "Prijzen opslaan (" + changed.size + ")"; });
    const sp = page.querySelector("#savePrices"); if (sp) sp.onclick = async () => { K.busy(sp, true, "Opslaan…"); try { const d = await post({ action: "saveClientPrices", clientId: c.id, prices: Array.from(changed.entries()).map(([productId, prix]) => ({ productId, prix: String(prix).replace(",", ".") })) }); const bad = (d.results || []).filter(r => !r.ok); if (bad.length) K.toast(bad.length + " prijs(en) niet opgeslagen: " + bad[0].error, { kind: "err" }); else K.toast("Prijzen opgeslagen"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(sp, false); } };
    K.on(page, "click", "[data-edit]", (e, t) => clientPanel(clientById(t.dataset.edit)));
    K.on(page, "click", "[data-archive]", async (e, t) => {
      const cl = clientById(t.dataset.archive);
      if (!(await K.confirm({ title: cl.nom + " archiveren?", text: "De klant kan niet meer aanmelden en verdwijnt uit de lijsten (invoer, bestellingen). Fiche, prijzen en bestellingen blijven bewaard; herstellen kan altijd.", yes: "Archiveren", danger: true }))) return;
      try { await post({ action: "archiveClient", id: cl.id }); K.toast(cl.nom + " gearchiveerd"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); }
    });
    K.on(page, "click", "[data-unarchive]", async (e, t) => { const cl = clientById(t.dataset.unarchive); try { await post({ action: "unarchiveClient", id: cl.id }); K.toast(cl.nom + " hersteld"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } });
    K.on(page, "click", "[data-revoke]", async (e, t) => {
      const cl = clientById(t.dataset.revoke);
      if (!(await K.confirm({ title: "Toegang blokkeren voor " + cl.nom + "?", text: "De klant kan niet meer aanmelden. Fiche, prijzen en bestellingen blijven bewaard. „Nieuw wachtwoord” geeft de toegang terug.", yes: "Blokkeren", danger: true }))) return;
      try { await post({ action: "revokeAccess", id: cl.id }); K.toast("Toegang geblokkeerd voor " + cl.nom); render(); } catch (err) { K.toast(err.message, { kind: "err" }); }
    });
    K.on(page, "click", "[data-reset]", async (e, t) => {
      const cl = clientById(t.dataset.reset);
      // Leeg laten = Famo maakt er een aan; zelf typen = dat wachtwoord (minstens 8 tekens, zelfde regel als de server).
      const typed = await K.prompt({ title: "Nieuw wachtwoord voor " + cl.nom, text: "Laat leeg om automatisch een wachtwoord aan te maken, of typ zelf een wachtwoord (minstens 8 tekens). Het oude wachtwoord werkt daarna niet meer." + (cl.email ? " De klant krijgt het per mail." : ""), placeholder: "Leeg = automatisch", yes: "Wachtwoord instellen" });
      if (typed === null) return;
      const password = typed.trim();
      if (password && password.length < 8) { K.toast("Minstens 8 tekens.", { kind: "err" }); return; }
      try { const d = await post(password ? { action: "resetPassword", id: cl.id, password } : { action: "resetPassword", id: cl.id }); pendingCreds = d.credentials; render(); if (d.mail && d.mail.ok) K.toast("Wachtwoord gemaild naar " + cl.email); } catch (err) { K.toast(err.message, { kind: "err" }); }
    });
  }

  /* ---------- producten ---------- */
  function productPanel(p) {
    const v = Object.assign({ nom: "", cat: "", unite: "caisse", base: "", kaliber: "", btwTarief: null, foto: "", actif: true }, p || {});
    const stockRow = (D.stock || []).find(s => s.product.toLowerCase() === String(v.nom).toLowerCase());

  // Lit un fichier image et le renvoie en base64, réduit à 1600 px de côté max (JPEG 85 %)
  // s'il dépasse 600 kB ; sinon tel quel. Repli : fichier d'origine si le canvas échoue.
  function shrinkFoto(file) {
    const asIs = () => new Promise((ok, ko) => { const r = new FileReader(); r.onerror = () => ko(new Error("Foto kon niet gelezen worden.")); r.onload = () => ok({ type: file.type, name: file.name, base64: String(r.result).replace(/^data:[^;]+;base64,/, "") }); r.readAsDataURL(file); });
    if (file.size <= 600 * 1024) return asIs();
    return new Promise((ok) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); ok(asIs()); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          const data = c.toDataURL("image/jpeg", 0.85);
          if (!/^data:image\/jpeg;base64,/.test(data)) return ok(asIs());
          ok({ type: "image/jpeg", name: file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", base64: data.replace(/^data:[^;]+;base64,/, "") });
        } catch (e) { ok(asIs()); }
      };
      img.src = url;
    });
  }
    const fotoHtml = f => (f ? '<img src="' + K.esc(f) + '" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--line);flex:none">' : '<span class="avatar" style="width:56px;height:56px;border-radius:8px">' + K.icon("camera") + '</span>');
    const pn = K.panel({ title: p ? p.nom : "Nieuw product", sub: p ? "Product bewerken" : "Verschijnt in de klantcatalogus zodra actief", body:
      K.c.field("Naam (zoals de klant het ziet)", K.c.input("pNom", { value: v.nom }), { id: "fPNom", req: true, hint: p ? "Hernoemen? Voorraad en open bestellingen worden mee hernoemd; geleverde bestellingen houden de oude naam." : undefined }) +
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">' + K.c.field("Kaliber", K.c.input("pKal", { value: v.kaliber, placeholder: "bv. 16/20" }), {}) + K.c.field("Eenheid", '<select class="input" id="pUnit">' + [["caisse", "kassa"], ["pièce", "stuk"], ["kg", "kg"], ["carton", "doos"]].map(([val, l]) => '<option value="' + val + '"' + (v.unite === val ? " selected" : "") + '>' + l + '</option>').join("") + '</select>', {}) + K.c.field("Basisprijs excl. btw", K.c.input("pBase", { value: v.base === "" ? "" : String(v.base).replace(".", ","), attrs: ' inputmode="decimal"' }), { id: "fPBase", req: true }) + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + K.c.field("Categorie", K.c.input("pCat", { value: v.cat, placeholder: "bv. Vis, Schelpdieren, Schaaldieren", attrs: ' list="cats"' }) + '<datalist id="cats">' + Array.from(new Set((D.products || []).map(x => x.cat).filter(Boolean))).map(x => '<option value="' + K.esc(x) + '">').join("") + '</datalist>', {}) + K.c.field("BTW-tarief (%)", K.c.input("pBtw", { value: v.btwTarief == null ? "" : v.btwTarief, placeholder: "standaard " + D.config.btwTarief + " %", attrs: ' inputmode="decimal"' }), { id: "fPBtw", hint: "Leeg = standaardtarief uit Bedrijfsgegevens." }) + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + K.c.field("Voorraad (optioneel)", K.c.input("pStock", { value: stockRow ? stockRow.quantity : "", attrs: ' inputmode="decimal"' }), { hint: D.config.voorraadAfboeken ? "Wordt bij vertrek automatisch afgeboekt." : "Wordt niet automatisch afgetrokken (instelbaar in Bedrijfsgegevens)." }) + K.c.field("Drempel", K.c.input("pLow", { value: stockRow ? stockRow.lowThreshold : "", attrs: ' inputmode="decimal"' }), {}) + '</div>' +
      '<label style="display:flex;gap:10px;align-items:center;font-size:13px"><button type="button" class="toggle' + (v.actif ? " on" : "") + '" id="pActif" aria-pressed="' + (v.actif ? "true" : "false") + '"></button>Actief in de catalogus</label>' +
      '<div class="notice" style="font-size:12.5px;align-items:center" id="pFotoBox">' + fotoHtml(v.foto) + '<div style="flex:1;min-width:0"><b>Foto</b><div class="quiet" style="font-size:12px">' + (p ? "JPEG, PNG of WebP. Grote foto's worden automatisch verkleind. Verschijnt meteen in de catalogus." : "Sla het product eerst op, daarna kunt u een foto toevoegen.") + '</div>' + (p ? '<input type="file" id="pFoto" accept="image/jpeg,image/png,image/webp" style="font-size:12px;margin-top:6px;max-width:100%">' : "") + '</div></div><div id="pErr"></div>',
      footer: (p ? '<button type="button" class="btn btn-ghost" id="pDel" style="color:var(--danger);margin-right:auto">Verwijderen</button>' : "") + '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="pOk">Opslaan</button>' });
    let actif = !!v.actif; const tg = pn.el.querySelector("#pActif"); tg.onclick = () => { actif = !actif; K.setOn(tg, actif); };
    pn.el.querySelector("[data-cancel]").onclick = pn.close;
    const fi = pn.el.querySelector("#pFoto"); if (fi) fi.onchange = () => {
      const f = fi.files && fi.files[0]; if (!f) return; const err = pn.el.querySelector("#pErr"); err.innerHTML = "";
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { err.innerHTML = K.c.error("Enkel JPEG, PNG of WebP."); fi.value = ""; return; }
      if (f.size > 12 * 1024 * 1024) { err.innerHTML = K.c.error("Foto te groot (max 12 MB)."); fi.value = ""; return; }
      fi.disabled = true;
      // Verkleind in de browser (max 1600 px, JPEG 85 %) : een gsm-foto van 5 MB wordt ~300 kB,
      // zodat de catalogus snel laadt op 4G. Kleine bestanden blijven zoals ze zijn.
      shrinkFoto(f).then(async (s) => {
        if (s.base64.length > 4200000) throw new Error("Foto te groot, ook na verkleinen (max 3 MB).");
        const d = await post({ action: "uploadFoto", id: p.id, contentType: s.type, filename: s.name, base64: s.base64 });
        const np = (d.products || []).find(x => x.id === p.id); const img = pn.el.querySelector("#pFotoBox").firstElementChild; img.outerHTML = fotoHtml(np && np.foto ? np.foto : "data:" + s.type + ";base64," + s.base64); K.toast("Foto opgeslagen");
      }).catch(e => { err.innerHTML = K.c.error(e.message || "Foto kon niet gelezen worden."); }).then(() => { fi.disabled = false; fi.value = ""; });
    };
    const del = pn.el.querySelector("#pDel"); if (del) del.onclick = async () => {
      if (!(await K.confirm({ title: "„" + p.nom + "” verwijderen?", text: "Het product verdwijnt uit de catalogus, samen met zijn prijsafspraken en voorraadregel. Geleverde bestellingen blijven leesbaar. Enkel tijdelijk uit de catalogus? Zet het op inactief.", yes: "Verwijderen", danger: true }))) return;
      K.busy(del, true, "Verwijderen…");
      try { await post({ action: "deleteProduct", id: p.id }); pn.close(); K.toast("Product verwijderd"); render(); }
      catch (err) { pn.el.querySelector("#pErr").innerHTML = K.c.error(err.message); K.busy(del, false); }
    };
    pn.el.querySelector("#pOk").onclick = async () => {
      const val = id => pn.el.querySelector("#" + id).value.trim();
      const nom = val("pNom"), base = Number(val("pBase").replace(",", ".")), btw = val("pBtw").replace(",", "."), btwN = Number(btw);
      K.setErr("fPNom", nom ? "" : "Verplicht."); K.setErr("fPBase", Number.isFinite(base) && val("pBase") !== "" ? "" : "Geef een prijs."); K.setErr("fPBtw", btw === "" || (Number.isFinite(btwN) && btwN >= 0 && btwN <= 100) ? "" : "0 tot 100."); if (!nom || !Number.isFinite(base) || val("pBase") === "" || (btw !== "" && !(Number.isFinite(btwN) && btwN >= 0 && btwN <= 100))) return;
      const btn = pn.el.querySelector("#pOk"); K.busy(btn, true, "Opslaan…");
      try { await post({ action: "saveProduct", id: p ? p.id : undefined, nom, cat: val("pCat"), unite: val("pUnit"), base, kaliber: val("pKal"), btwTarief: btw === "" ? "" : btwN, actif, stock: val("pStock") === "" ? undefined : Number(val("pStock").replace(",", ".")), lowThreshold: val("pLow") === "" ? undefined : Number(val("pLow").replace(",", ".")) }); pn.close(); K.toast("Product opgeslagen"); render(); }
      catch (err) { if (err.status === 409) K.setErr("fPNom", "Die naam bestaat al."); pn.el.querySelector("#pErr").innerHTML = K.c.error(err.status === 409 ? "Er bestaat al een product met die naam. Kies een andere naam (of pas dat product aan)." : err.message); K.busy(btn, false); }
    };
  }
  let orderMode = false;
  // Poignées distinctes : .cgrip déplace une catégorie, .pgrip un produit (dans sa catégorie).
  K.sortable(page, { items: ".ccat", zones: "[data-cat-list]", handle: ".cgrip", onDrop: () => true });
  K.sortable(page, { items: ".prow", zones: "[data-plist]", handle: ".pgrip", onDrop: ({ from, to }) => {
    if (from === to) return true;
    K.toast("Een product verhuist binnen zijn categorie. Categorie wijzigen: open het product.", { kind: "err" }); return false;
  } });
  function productOrder() {
    const all = (D.products || []).slice().sort(K.byVolgorde); const groups = {}; all.forEach(p => { const g = K.cat(p.cat); (groups[g] = groups[g] || []).push(p); });
    const cats = Object.keys(groups).sort(K.catOrder(all, p => K.cat(p.cat)));
    page.innerHTML = head("Volgorde van de catalogus", '<button type="button" class="btn btn-ghost btn-sm" id="orderCancel">Annuleren</button><button type="button" class="btn btn-p btn-sm" id="orderSave">Volgorde bewaren</button>') +
      '<div class="content" style="padding-top:16px"><p class="sub" style="white-space:normal;margin:0 0 4px">Sleep aan <span style="display:inline-flex;vertical-align:middle">' + K.icon("grip") + '</span> om categorieën en producten te verplaatsen. Dit is ook de volgorde in de klantcatalogus en bij Invoeren.</p>' +
      '<div data-cat-list style="display:flex;flex-direction:column;gap:12px">' + cats.map(g => '<div class="grp ccat" data-cat="' + K.esc(g) + '"><div class="grp-h" style="gap:6px"><span class="grip cgrip" title="Categorie verslepen">' + K.icon("grip") + '</span>' + K.esc(g) + ' <small>' + groups[g].length + '</small></div><div data-plist>' +
        groups[g].map(p => '<div class="prow" data-pid="' + K.esc(p.id) + '"><span class="grip pgrip" title="Product verslepen">' + K.icon("grip") + '</span>' + (p.foto ? '<img src="' + K.esc(p.foto) + '" alt="" style="width:28px;height:28px;object-fit:cover;border-radius:6px;flex:none">' : "") + '<b style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + K.esc(p.nom) + '</b><span class="quiet" style="font-size:12.5px;white-space:nowrap">' + K.esc([p.kaliber, K.unit(p.unite)].filter(Boolean).join(" · ")) + '</span>' + (p.actif ? "" : '<span class="tag">inactief</span>') + '</div>').join("") + '</div></div>').join("") + '</div></div>';
    page.querySelector("#orderCancel").onclick = () => { orderMode = false; render(); };
    page.querySelector("#orderSave").onclick = async () => {
      const btn = page.querySelector("#orderSave"); K.busy(btn, true, "Bewaren…");
      const order = K.$$(".prow", page).map(el => el.dataset.pid);
      try { const d = await post({ action: "reorderProducts", order }); orderMode = false; render(); K.toast(d.changed ? "Volgorde bewaard (" + d.changed + " product" + (d.changed === 1 ? "" : "en") + ")" : "Volgorde ongewijzigd"); }
      catch (err) { K.toast(err.message, { kind: "err" }); K.busy(btn, false); }
    };
  }
  function producten() {
    if (orderMode) return productOrder();
    const all = (D.products || []).slice().sort(K.byVolgorde); const groups = {}; all.forEach(p => { const g = K.cat(p.cat); (groups[g] = groups[g] || []).push(p); });
    const nAfsp = pid => (D.prices || []).filter(x => x.productId === pid && x.prix != null).length;
    page.innerHTML = head(all.filter(p => p.actif).length + " actief · " + all.filter(p => !p.actif).length + " inactief", '<button type="button" class="btn btn-o btn-sm" id="orderMode">' + K.icon("grip") + 'Volgorde</button><button type="button" class="btn btn-p btn-sm" data-new-product>' + K.icon("plus") + 'Nieuw product</button>') +
      '<div class="content" style="padding-top:16px">' + Object.keys(groups).sort(K.catOrder(all, p => K.cat(p.cat))).map(g => '<div class="grp"><div class="grp-h" style="border-left-color:var(--p)">' + K.esc(g) + ' <small>' + groups[g].length + '</small></div><div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th>Kaliber</th><th>Eenheid</th><th class="num">Basisprijs</th><th class="num">Btw</th><th>Afspraken</th><th>Actief</th><th></th></tr></thead><tbody>' + groups[g].map(p => '<tr class="row" data-p="' + p.id + '"><td><div style="display:flex;align-items:center;gap:10px">' + (p.foto ? '<img src="' + K.esc(p.foto) + '" alt="" style="width:28px;height:28px;object-fit:cover;border-radius:6px;flex:none">' : "") + '<b>' + K.esc(p.nom) + '</b></div></td><td>' + K.esc(p.kaliber || "—") + '</td><td>' + K.esc(K.unit(p.unite)) + '</td><td class="num mono">' + K.eur(p.base) + '</td><td class="num mono' + (p.btwTarief == null ? " muted" : "") + '">' + K.num(p.btwTarief == null ? D.config.btwTarief : p.btwTarief) + ' %</td><td class="muted">' + (nAfsp(p.id) ? nAfsp(p.id) + " klant" + (nAfsp(p.id) === 1 ? "" : "en") : "—") + '</td><td style="width:110px">' + (p.actif ? '<span class="cell-st c-done">Actief</span>' : '<span class="cell-st c-inv">Inactief</span>') + '</td><td style="text-align:right"><button type="button" class="btn btn-o btn-sm" data-p-edit="' + p.id + '">Bewerken</button></td></tr>').join("") + '</tbody></table></div></div>').join("") + (all.length ? "" : K.c.empty("Nog geen producten", "Maak het eerste product aan.")) + '</div>';
    page.querySelector("#orderMode").onclick = () => { orderMode = true; render(); };
    K.on(page, "click", "[data-p-edit]", (e, t) => { e.stopPropagation(); productPanel(all.find(p => p.id === t.dataset.pEdit)); });
    K.on(page, "click", "tr[data-p]", (e, t) => { if (e.target.closest("button")) return; productPanel(all.find(p => p.id === t.dataset.p)); });
  }

  /* ---------- prijzen (matrix) ---------- */
  function prijzen() {
    const prods = (D.products || []).filter(p => p.actif), cls = (D.clients || []).filter(c => !c.gearchiveerd);
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

  /* ---------- rapportage ---------- */
  let rapCache = null, rapJaar = "";
  async function rapportage() {
    page.innerHTML = head("Omzet, klanten, producten en btw · op basis van geleverde (gefactureerde) bestellingen") + '<div class="content" style="padding-top:16px">' + K.c.skeleton(3) + '</div>';
    if (!rapCache) { try { rapCache = await K.api("/api/allorders?all=1"); } catch (err) { page.querySelector(".content").innerHTML = K.c.error(err.message, true); K.on(page, "click", "[data-retry]", e => { e.preventDefault(); rapCache = null; render(); }); return; } }
    const all = rapCache.orders || [], btwPer = rapCache.btwPerProduct || {}, std = Number(D.config.btwTarief) || 0;
    const dayOf = o => o.factureeLe ? K.isoDay(o.factureeLe) : (o.dateLiv || o.date || "");
    const done = all.filter(o => o.statut === "Facturée").map(o => Object.assign({}, o, { dag: dayOf(o) }));
    const years = Array.from(new Set(done.map(o => o.dag.slice(0, 4)).filter(Boolean))).sort().reverse();
    if (!rapJaar || !years.includes(rapJaar)) rapJaar = years[0] || String(new Date().getFullYear());
    const yr = done.filter(o => o.dag.startsWith(rapJaar));
    const sum = (arr, f) => arr.reduce((s, o) => s + (Number(f(o)) || 0), 0);
    const group = (arr, key, add) => { const m = new Map(); arr.forEach(o => { const k = key(o); if (!k) return; const g = m.get(k) || { key: k, n: 0, total: 0 }; g.n++; g.total += Number(o.total) || 0; if (add) add(g, o); m.set(k, g); }); return Array.from(m.values()); };
    const months = group(yr, o => o.dag.slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key));
    const clients = group(yr, o => o.client).sort((a, b) => b.total - a.total);
    const prodMap = new Map(); yr.forEach(o => K.parseLines(o.lignes).forEach(l => { const k = l.name.toLowerCase(); const g = prodMap.get(k) || { name: l.name, unit: l.unit, qty: 0, total: 0, noPrice: 0 }; g.qty += l.qty; if (l.price != null) g.total += l.qty * l.price; else g.noPrice++; prodMap.set(k, g); }));
    const prods = Array.from(prodMap.values()).sort((a, b) => b.total - a.total);
    const unpaid = all.filter(o => o.statut === "Facturée" && o.paiement !== "Payé"), unpaidSum = sum(unpaid, o => o.total);
    // Btw per tarief : per regel (product-tarief of standaard) ; regels zonder prijs vallen terug op het ordertotaal naar rato.
    const vat = new Map(); let vatLinesTotal = 0;
    yr.forEach(o => { const lines = K.parseLines(o.lignes); const priced = lines.filter(l => l.price != null); const lineSum = priced.reduce((s, l) => s + l.qty * l.price, 0); const scale = lineSum > 0 ? (Number(o.total) || 0) / lineSum : 0; (priced.length ? priced : []).forEach(l => { const rate = btwPer[l.name.toLowerCase().trim()] || std; const base = l.qty * l.price * (scale || 1); const g = vat.get(rate) || { rate, base: 0 }; g.base += base; vat.set(rate, g); vatLinesTotal += base; }); if (!priced.length) { const g = vat.get(std) || { rate: std, base: 0 }; g.base += Number(o.total) || 0; vat.set(std, g); vatLinesTotal += Number(o.total) || 0; } });
    const vatRows = Array.from(vat.values()).sort((a, b) => a.rate - b.rate);
    const mName = k => { const d = K.parseDate(k + "-01"); return d ? d.toLocaleDateString("nl-BE", { month: "long", year: "numeric" }) : k; };
    const card = (title, sub, id, table) => '<div class="card"><div class="card-h"><div><h2 class="h2">' + title + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : "") + '</div><button type="button" class="btn btn-o btn-sm" data-csv="' + id + '">CSV</button></div>' + table + '</div>';
    const tbl = (heads, rows, foot) => rows.length ? '<div class="tblwrap"><table class="tbl"><thead><tr>' + heads.map(h => '<th' + (h[1] ? ' class="num"' : "") + '>' + h[0] + '</th>').join("") + '</tr></thead><tbody>' + rows.join("") + (foot || "") + '</tbody></table></div>' : '<div class="empty" style="margin:12px">Niets in ' + K.esc(rapJaar) + '.</div>';
    page.querySelector(".content").innerHTML = '<div class="tools" style="padding:0 0 14px"><label for="rapJaar" style="font-size:13px">Jaar</label><select class="input tool" id="rapJaar" style="width:auto;padding:0 8px">' + (years.length ? years : [rapJaar]).map(y => '<option' + (y === rapJaar ? " selected" : "") + '>' + y + '</option>').join("") + '</select><span class="quiet" style="font-size:12.5px">Datum = factuurdatum („Facturée le”), anders leverdag. Bedragen excl. btw.</span></div>' +
      '<div class="kpis"><div class="kp"><small>Omzet ' + K.esc(rapJaar) + '</small><b class="mono">' + K.eur(sum(yr, o => o.total)) + '</b><em>' + yr.length + ' factu' + (yr.length === 1 ? "ur" : "ren") + '</em></div><div class="kp"><small>Openstaand (alle jaren)</small><b class="mono">' + K.eur(unpaidSum) + '</b><em>' + unpaid.length + ' onbetaald</em></div><div class="kp"><small>Btw te innen ' + K.esc(rapJaar) + '</small><b class="mono">' + K.eur(vatRows.reduce((s, r) => s + r.base * r.rate / 100, 0)) + '</b><em>op ' + K.eur(vatLinesTotal) + '</em></div><div class="kp"><small>Klanten met omzet</small><b>' + clients.length + '</b><em>' + prods.length + ' producten</em></div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;margin-top:16px" id="two">' +
      card("Per maand", "", "maand", tbl([["Maand"], ["Facturen", 1], ["Omzet", 1]], months.map(m => '<tr><td><b>' + K.esc(mName(m.key)) + '</b></td><td class="num">' + m.n + '</td><td class="num mono">' + K.eur(m.total) + '</td></tr>'))) +
      card("Btw-overzicht", "Per tarief · producttarief of standaard " + K.num(std) + " %", "btw", tbl([["Tarief"], ["Grondslag", 1], ["Btw", 1], ["Incl. btw", 1]], vatRows.map(r => '<tr><td><b>' + K.num(r.rate) + ' %</b></td><td class="num mono">' + K.eur(r.base) + '</td><td class="num mono">' + K.eur(r.base * r.rate / 100) + '</td><td class="num mono">' + K.eur(r.base * (1 + r.rate / 100)) + '</td></tr>'))) +
      card("Per klant", "Top 20 op omzet", "klant", tbl([["Klant"], ["Facturen", 1], ["Omzet", 1]], clients.slice(0, 20).map(c => '<tr><td><b>' + K.esc(c.key) + '</b></td><td class="num">' + c.n + '</td><td class="num mono">' + K.eur(c.total) + '</td></tr>'))) +
      card("Per product", "Hoeveelheid en omzet", "product", tbl([["Product"], ["Aantal", 1], ["Omzet", 1]], prods.slice(0, 40).map(p => '<tr><td><b>' + K.esc(p.name) + '</b></td><td class="num mono">' + K.esc(K.qty(p.qty) + " " + K.unit(p.unit)) + '</td><td class="num mono">' + K.eur(p.total) + (p.noPrice ? ' <span class="tag" title="regels zonder prijs">±</span>' : "") + '</td></tr>'))) +
      '</div>' + (unpaid.length ? '<div class="card" style="margin-top:16px"><div class="card-h"><div><h2 class="h2">Openstaande facturen</h2><p class="sub">Alle jaren · geleverd, nog niet betaald</p></div><button type="button" class="btn btn-o btn-sm" data-csv="open">CSV</button></div>' + tbl([["Factuur"], ["Klant"], ["Datum"], ["Bedrag", 1]], unpaid.sort((a, b) => dayOf(a).localeCompare(dayOf(b))).map(o => '<tr class="row" data-open="' + o.id + '"><td class="mono">' + K.esc(o.factuurnummer || o.ref) + '</td><td>' + K.esc(o.client) + '</td><td' + (K.addDays(dayOf(o), Number(D.config.betaaltermijnDagen) || 14) < K.today() ? ' style="color:var(--danger)"' : "") + '>' + K.esc(K.date(dayOf(o))) + '</td><td class="num mono">' + K.eur(o.total) + '</td></tr>')) + '</div>' : "") + '</div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    page.querySelector("#rapJaar").onchange = e => { rapJaar = e.target.value; render(); };
    K.on(page, "click", "tr[data-open]", (e, t) => { location.href = "/order.html?id=" + encodeURIComponent(t.dataset.open); });
    K.on(page, "click", "[data-csv]", (e, t) => {
      const w = t.dataset.csv, name = "famo-" + w + "-" + rapJaar + ".csv";
      if (w === "maand") download(name, [["Maand", "Facturen", "Omzet excl. btw"]].concat(months.map(m => [m.key, m.n, csvNum(m.total)])));
      if (w === "btw") download(name, [["Tarief %", "Grondslag", "Btw", "Incl. btw"]].concat(vatRows.map(r => [csvNum(r.rate), csvNum(r.base), csvNum(r.base * r.rate / 100), csvNum(r.base * (1 + r.rate / 100))])));
      if (w === "klant") download(name, [["Klant", "Facturen", "Omzet excl. btw"]].concat(clients.map(c => [c.key, c.n, csvNum(c.total)])));
      if (w === "product") download(name, [["Product", "Aantal", "Eenheid", "Omzet excl. btw"]].concat(prods.map(p => [p.name, K.qty(p.qty), K.unit(p.unit), csvNum(p.total)])));
      if (w === "open") download("famo-openstaand.csv", [["Factuur", "Referentie", "Klant", "Datum", "Bedrag excl. btw"]].concat(unpaid.map(o => [o.factuurnummer, o.ref, o.client, dayOf(o), csvNum(o.total)])));
    });
  }

  /* ---------- bedrijf ---------- */
  function bedrijf() {
    const c = D.config, lev = c.levering || {}, dagen = lev.leverdagen || ["ma", "di", "wo", "do", "vr", "za"];
    const f = (label, id, val, extra, opts) => K.c.field(label, K.c.input(id, Object.assign({ value: val == null ? "" : val }, extra || {})), Object.assign({ id: "f_" + id }, opts || {}));
    page.innerHTML = head("Verschijnt op facturen, leveringsbonnen en e-mails", '<button type="button" class="btn btn-o btn-sm" id="preview">Voorbeeldfactuur</button><button type="button" class="btn btn-p btn-sm" id="save">Opslaan</button>') +
      '<div class="content" style="padding-top:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start" id="two">' +
      '<div class="card card-b" style="display:flex;flex-direction:column;gap:12px"><h2 class="h2">Identiteit</h2>' + f("Bedrijfsnaam", "bedrijfsnaam", c.bedrijfsnaam) + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + f("Adres", "adres", c.adres) + f("Postcode en plaats", "plaats", c.plaats) + f("BTW-nummer", "btw", c.btw) + f("BTW-tarief (%)", "btwTarief", c.btwTarief, { attrs: ' inputmode="decimal"' }, { hint: "Standaard; per product instelbaar." }) + f("Telefoon", "telefoon", c.telefoon, { type: "tel" }) + f("E-mail (op documenten)", "email", c.email, { type: "email" }) + '</div></div>' +
      '<div class="card card-b" style="display:flex;flex-direction:column;gap:12px"><h2 class="h2">Bank &amp; voorwaarden</h2>' + (D.status.ibanOntbreekt ? K.c.warn("<b>IBAN ontbreekt.</b> Zolang dit leeg is, tonen facturen voorbeeldbankgegevens.") : "") + '<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">' + f("IBAN", "iban", c.iban, { placeholder: "BE00 0000 0000 0000" }) + f("BIC", "bic", c.bic) + '</div><div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">' + f("Betalingsvoorwaarden (onder de factuur)", "betalingsvoorwaarden", c.betalingsvoorwaarden, { placeholder: "bv. Betaalbaar binnen 14 dagen" }) + f("Betaaltermijn (dagen)", "betaaltermijnDagen", c.betaaltermijnDagen, { type: "number", attrs: ' min="0" max="120" inputmode="numeric"' }, { hint: "Vervaldatum op de factuur." }) + '</div>' + K.c.field("Leveringsvoorwaarden (onder de leveringsbon)", '<textarea class="input" id="leveringsvoorwaarden" rows="3">' + K.esc(c.leveringsvoorwaarden || "") + '</textarea>', {}) + '</div>' +
      '<div class="card card-b" style="display:flex;flex-direction:column;gap:12px"><h2 class="h2">Bestellen &amp; leveren</h2><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + f("Besteldeadline (UU:MM)", "besteldeadline", c.besteldeadline || lev.deadline || "22:00", { placeholder: "22:00", attrs: ' inputmode="numeric" maxlength="5"' }, { hint: "Vóór dit uur besteld = morgen geleverd." }) + f("Minimum bestelling (€ excl. btw)", "minimumBestelling", c.minimumBestelling ? String(c.minimumBestelling).replace(".", ",") : "", { placeholder: "0 = geen minimum", attrs: ' inputmode="decimal"' }) + '</div>' +
      K.c.field("Leverdagen", '<div class="opt" id="dagen" style="gap:6px">' + DAGEN.map(([k, l]) => '<button type="button" data-dag="' + k + '"' + (dagen.includes(k) ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ' title="' + l + '" style="flex:1;min-width:44px;padding:0 6px">' + k + '</button>').join("") + '</div>', { id: "f_leverdagen" }) +
      K.c.field("Gesloten dagen (één datum per regel, JJJJ-MM-DD)", '<textarea class="input" id="geslotenDagen" rows="3" placeholder="2026-12-25\n2027-01-01" style="font-family:inherit">' + K.esc(c.geslotenDagen || "") + '</textarea>', { id: "f_geslotenDagen", hint: "Feestdagen en verlof: op die dagen kan niemand een levering kiezen." }) +
      '<label style="display:flex;gap:10px;align-items:center;font-size:13px">' + K.c.check(!!c.voorraadAfboeken, 'id="afboeken"') + '<span>Voorraad automatisch afboeken bij vertrek<span class="quiet" style="font-size:12px;display:block">Enkel aanzetten als de telling in Voorraad klopt.</span></span></label></div>' +
      '<div class="card card-b" style="display:flex;flex-direction:column;gap:12px"><h2 class="h2">E-mail</h2>' + f("Interne postbus (melding bij elke bestelling)", "bestellingenEmail", c.bestellingenEmail, { type: "email" }) + '<div class="notice" style="font-size:12.5px"><div>' + (D.status.mailEnabled ? "E-mail is actief. " : "<b>E-mail is niet actief</b> (RESEND_API_KEY ontbreekt op Vercel). ") + (c.mailFromConfigured ? "Afzender (MAIL_FROM) is ingesteld op Vercel." : "<b>Afzender (MAIL_FROM) ontbreekt op Vercel</b>: mails vertrekken enkel naar de eigenaar van het Resend-account.") + '</div></div></div>' +
      '<div id="bErr" style="grid-column:1/-1"></div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    K.on(page, "click", "[data-dag]", (e, t) => { const on = !t.classList.contains("on"); t.classList.toggle("on", on); t.setAttribute("aria-pressed", on ? "true" : "false"); });
    const af = page.querySelector("#afboeken"); af.onclick = () => K.setOn(af, !af.classList.contains("on"));
    page.querySelector("#preview").onclick = async () => { try { await K.docs(); } catch (e) { K.toast(e.message, { kind: "err" }); return; } const cfg = collect(); FamoDocuments.setCompany(cfg); const sample = { ref: "CMD-2026-0001", client: "Voorbeeldklant", klant: { adresse: "Straat 1, 2000 Antwerpen", btw: "BE 0000.000.000", klantnr: "K-000" }, lignes: "Vannamei garnalen 16/20 × 2 caisse [€9.50]\nZalmfilet × 1 kg [€20.20]", total: 39.2, factuurnummer: "FA-2026-0000", paiement: "En attente", dateLiv: K.today() }; famoDocPreview.open({ html: FamoDocuments.build(sample, "invoice"), filename: "Famo-Voorbeeldfactuur.pdf", title: "Voorbeeldfactuur", meta: "met de gegevens zoals nu ingevuld" }); };
    function collect() { const v = id => page.querySelector("#" + id).value.trim(); return { bedrijfsnaam: v("bedrijfsnaam"), adres: v("adres"), plaats: v("plaats"), btw: v("btw"), btwTarief: Number(v("btwTarief").replace(",", ".")), telefoon: v("telefoon"), email: v("email"), iban: v("iban"), bic: v("bic"), betalingsvoorwaarden: v("betalingsvoorwaarden"), leveringsvoorwaarden: v("leveringsvoorwaarden"), bestellingenEmail: v("bestellingenEmail"), besteldeadline: v("besteldeadline"), leverdagen: K.$$("[data-dag].on", page).map(b => b.dataset.dag).join(","), geslotenDagen: v("geslotenDagen"), minimumBestelling: v("minimumBestelling").replace(",", "."), betaaltermijnDagen: v("betaaltermijnDagen") === "" ? "" : Number(v("betaaltermijnDagen")), voorraadAfboeken: af.classList.contains("on") }; }
    // Fout van de server bij het juiste veld tonen (IBAN, BIC, BTW-nummer, deadline, …) én bovenaan.
    const FIELD_ERR = [[/iban/i, "f_iban"], [/\bbic\b/i, "f_bic"], [/btw-nummer/i, "f_btw"], [/besteldeadline/i, "f_besteldeadline"], [/gesloten dagen/i, "f_geslotenDagen"], [/minimumbedrag/i, "f_minimumBestelling"], [/betaaltermijn/i, "f_betaaltermijnDagen"], [/bestelmeldingen/i, "f_bestellingenEmail"], [/bedrijfsnaam/i, "f_bedrijfsnaam"]];
    const clearErrs = () => FIELD_ERR.forEach(([, id]) => K.setErr(id, ""));
    page.querySelector("#save").onclick = async () => {
      const b = page.querySelector("#save"); clearErrs(); page.querySelector("#bErr").innerHTML = "";
      const cfg = collect(); const local = [];
      if (cfg.besteldeadline && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(cfg.besteldeadline)) local.push(["f_besteldeadline", "Uur als UU:MM, bv. 22:00."]);
      if (!cfg.leverdagen) local.push(["f_leverdagen", "Kies minstens één leverdag."]);
      if (cfg.geslotenDagen.split(/[\n,;\s]+/).filter(Boolean).some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d) || !K.parseDate(d))) local.push(["f_geslotenDagen", "Eén datum per regel, als JJJJ-MM-DD."]);
      if (cfg.minimumBestelling !== "" && !(Number(cfg.minimumBestelling) >= 0)) local.push(["f_minimumBestelling", "Ongeldig bedrag."]);
      if (cfg.betaaltermijnDagen !== "" && !(Number.isInteger(cfg.betaaltermijnDagen) && cfg.betaaltermijnDagen >= 0 && cfg.betaaltermijnDagen <= 120)) local.push(["f_betaaltermijnDagen", "0 tot 120 dagen."]);
      if (local.length) { local.forEach(([id, m]) => K.setErr(id, m)); page.querySelector("#bErr").innerHTML = K.c.error("Controleer de gemarkeerde velden."); return; }
      K.busy(b, true, "Opslaan…");
      try { await post(Object.assign({ action: "saveConfig" }, cfg)); S.config = null; K.toast("Bedrijfsgegevens opgeslagen"); render(); }
      catch (err) { const hit = FIELD_ERR.find(([re]) => re.test(err.message)); if (hit) K.setErr(hit[1], err.message); page.querySelector("#bErr").innerHTML = K.c.error(err.message); K.busy(b, false); }
    };
  }

  /* ---------- toegang ---------- */
  function medewerkerPanel(m) {
    const v = Object.assign({ naam: "", rol: "personeel", actief: true }, m || {});
    const p = K.panel({ title: m ? m.naam : "Nieuwe medewerker", sub: m ? "Medewerker bewerken" : "Persoonlijke PIN: aanmelden op naam", body:
      K.c.field("Naam", K.c.input("mNaam", { value: v.naam, placeholder: "Voornaam (zoals in het logboek)" }), { id: "fMNaam", req: true }) +
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + K.c.field("Rol", '<select class="input" id="mRol">' + [["personeel", "Personeel"], ["beheerder", "Beheerder"]].map(([k, l]) => '<option value="' + k + '"' + (v.rol === k ? " selected" : "") + '>' + l + '</option>').join("") + '</select>', { hint: "Beheerder: ook Beheer, Invoeren en Voorraad." }) + K.c.field(m ? "Nieuwe PIN (leeg = ongewijzigd)" : "PIN", K.c.input("mPin", { type: "password", attrs: ' inputmode="numeric" autocomplete="new-password"' }), { id: "fMPin", req: !m, hint: "Minstens 4 cijfers. Wordt versleuteld bewaard." }) + '</div>' +
      '<label style="display:flex;gap:10px;align-items:center;font-size:13px">' + K.c.check(!!v.actief, 'id="mActief"') + 'Actief (kan aanmelden)</label><div id="mErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="mOk">Opslaan</button>' });
    let actief = !!v.actief; const a = p.el.querySelector("#mActief"); a.onclick = () => { actief = !actief; K.setOn(a, actief); };
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#mOk").onclick = async () => {
      const naam = p.el.querySelector("#mNaam").value.trim(), pin = p.el.querySelector("#mPin").value, rol = p.el.querySelector("#mRol").value;
      K.setErr("fMNaam", naam ? "" : "Verplicht."); K.setErr("fMPin", (!m && !pin) || (pin && !/^\d{4,40}$/.test(pin)) ? "Minstens 4 cijfers." : ""); if (!naam || (!m && !pin) || (pin && !/^\d{4,40}$/.test(pin))) return;
      const b = p.el.querySelector("#mOk"); K.busy(b, true, "Opslaan…");
      try { await post({ action: "saveMedewerker", id: m ? m.id : undefined, naam, rol, pin: pin || undefined, actief }); p.close(); K.toast("Medewerker opgeslagen"); render(); }
      catch (err) { p.el.querySelector("#mErr").innerHTML = K.c.error(err.message); K.busy(b, false); }
    };
  }
  function toegang() {
    const c = D.config, mw = D.medewerkers || [];
    const codeCard = (which, title, sub, custom) => '<div class="card card-b" style="display:flex;flex-direction:column;gap:10px"><div style="display:flex;align-items:center;gap:10px">' + K.c.avatar(title) + '<div><h2 class="h2">' + title + '</h2><p class="sub" style="white-space:normal">' + sub + '</p></div></div><div>' + (custom ? '<span class="chip st-done"><i></i>Eigen code ingesteld</span>' : '<span class="chip st-new"><i></i>Code uit Vercel (' + (which === "admin" ? "ADMIN_CODE" : "STAFF_CODE") + ')</span>') + '</div>' + K.c.field("Nieuwe code (minstens 10 tekens)", K.c.input("code_" + which, { type: "password", attrs: ' autocomplete="new-password"' }), { id: "f_code_" + which }) + '<div style="display:flex;gap:8px"><button type="button" class="btn btn-p btn-sm" data-setcode="' + which + '">Code instellen</button>' + (custom ? '<button type="button" class="btn btn-ghost btn-sm" data-resetcode="' + which + '">Terug naar Vercel-code</button>' : "") + '</div></div>';
    page.innerHTML = head("Wie kan wat · codes, medewerkers en klantaccounts") + '<div class="content" style="padding-top:16px">' + (!c.adminCodeCustom && !c.staffCodeCustom ? K.c.warn("<b>Zolang beide codes uit Vercel komen en gelijk zijn, kan personeel in Beheer.</b> Stel hieronder minstens de personeelscode apart in.") : "") + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px" id="two">' + codeCard("admin", "Beheerder", "Alles: klanten, prijzen, documenten, instellingen.", c.adminCodeCustom) + codeCard("staff", "Personeel", "Bestellingen, Magazijn, Leveringen, Documenten.", c.staffCodeCustom) + '</div>' +
      '<div class="card" style="margin-top:16px"><div class="card-h"><div><h2 class="h2">Medewerkers <small class="quiet" style="font-weight:400">' + mw.filter(m => m.actief).length + ' actief</small></h2><p class="sub" style="white-space:normal">Persoonlijke PIN: aanmelden op naam, zichtbaar in het logboek van correcties. De teamcodes hierboven blijven werken.</p></div><button type="button" class="btn btn-p btn-sm" data-new-mw>' + K.icon("plus") + 'Medewerker</button></div>' +
      (mw.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Naam</th><th>Rol</th><th>Actief</th><th>Laatste aanmelding</th><th></th></tr></thead><tbody>' + mw.map(m => '<tr><td><div style="display:flex;align-items:center;gap:10px">' + K.c.avatar(m.naam) + '<b>' + K.esc(m.naam) + '</b></div></td><td>' + (m.rol === "beheerder" ? "Beheerder" : "Personeel") + '</td><td style="width:110px">' + (m.actief ? '<span class="cell-st c-done">Actief</span>' : '<span class="cell-st c-inv">Inactief</span>') + '</td><td class="muted">' + K.esc(dateTime(m.laatste)) + '</td><td class="actions"><button type="button" class="btn btn-ghost btn-sm" style="color:var(--danger)" data-mw-del="' + m.id + '">Verwijderen</button> <button type="button" class="btn btn-o btn-sm" data-mw-edit="' + m.id + '">Bewerken</button></td></tr>').join("") + '</tbody></table></div>' : '<div class="empty" style="margin:12px">Nog geen medewerkers. Zonder medewerkers meldt iedereen aan met de teamcode en staat „personeel” in het logboek.</div>') + '</div>' +
      '<div class="card card-b" style="margin-top:16px"><h2 class="h2">Klanten</h2><p class="sub" style="white-space:normal">' + D.status.credentials + ' van ' + D.status.clients + ' klanten hebben een gebruikersnaam en wachtwoord. Wachtwoorden beheert u per klant (Klanten → Nieuw wachtwoord). Na 5 foute pogingen wacht een account 30 seconden.</p><a class="btn btn-o btn-sm" href="#/klanten" style="margin-top:8px">Naar klanten</a></div><div id="tErr"></div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    K.on(page, "click", "[data-setcode]", async (e, t) => { const which = t.dataset.setcode, code = page.querySelector("#code_" + which).value; K.setErr("f_code_" + which, code.length >= 10 ? "" : "Minstens 10 tekens."); if (code.length < 10) return; if (!(await K.confirm({ title: "Code voor " + (which === "admin" ? "beheerder" : "personeel") + " wijzigen?", text: "De oude code werkt meteen niet meer. Geef de nieuwe door aan wie ze nodig heeft.", yes: "Wijzigen" }))) return; K.busy(t, true, "Opslaan…"); try { await post({ action: "saveCode", which, code }); K.toast("Code ingesteld"); render(); } catch (err) { page.querySelector("#tErr").innerHTML = K.c.error(err.message); K.busy(t, false); } });
    K.on(page, "click", "[data-resetcode]", async (e, t) => { const which = t.dataset.resetcode; if (!(await K.confirm({ title: "Terug naar de Vercel-code?", text: "De eigen code wordt gewist.", yes: "Wissen", danger: true }))) return; try { await post({ action: "saveCode", which, reset: true }); K.toast("Eigen code gewist"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } });
    K.on(page, "click", "[data-new-mw]", () => medewerkerPanel(null));
    K.on(page, "click", "[data-mw-edit]", (e, t) => medewerkerPanel(mw.find(m => m.id === t.dataset.mwEdit)));
    K.on(page, "click", "[data-mw-del]", async (e, t) => { const m = mw.find(x => x.id === t.dataset.mwDel); if (!(await K.confirm({ title: m.naam + " verwijderen?", text: "De PIN werkt meteen niet meer. Eerdere regels in het logboek blijven op naam staan. Tijdelijk? Zet de medewerker op inactief.", yes: "Verwijderen", danger: true }))) return; K.busy(t, true, "Verwijderen…"); try { await post({ action: "deleteMedewerker", id: m.id }); K.toast("Medewerker verwijderd"); render(); } catch (err) { page.querySelector("#tErr").innerHTML = K.c.error(err.message); K.busy(t, false); } });
  }

  /* ---------- status ---------- */
  async function status() {
    const st = D.status, c = D.config;
    page.innerHTML = head("Alles wat het portaal nodig heeft om te draaien", '<button type="button" class="btn btn-o btn-sm" id="recheck">' + K.icon("refresh") + 'Nu controleren</button>') + '<div class="content" style="padding-top:16px"><div class="kpis" id="cards">' + K.c.skeleton(1) + '</div><div id="health"></div><div id="dbcard"></div></div>';
    const t0 = Date.now(); let api = null, apiMs = 0; try { api = await K.api("/api/config?status=1"); apiMs = Date.now() - t0; } catch (e) { api = { error: e.message }; }
    const cards = [
      ["Gegevens", api && !api.error ? "ok" : "bad", api && !api.error ? "Antwoord " + apiMs + " ms · " + (api.status.orders || 0) + " bestellingen · " + (api.status.clients || 0) + " klanten" : "Geen verbinding: " + (api && api.error), "Let op: het gratis Airtable-plan heeft een maandelijkse API-limiet. Bij overschrijding weigert Airtable tot de volgende maand."],
      ["E-mail (Resend)", st.mailEnabled ? (st.mailReady ? "ok" : "warn") : "bad", st.mailEnabled ? (st.mailReady ? "Actief · interne postbus " + c.bestellingenEmail : (!c.mailFromConfigured ? "Sleutel aanwezig, maar MAIL_FROM (afzender) ontbreekt op Vercel" : "Sleutel aanwezig, maar geen interne postbus ingesteld")) : "RESEND_API_KEY ontbreekt op Vercel", "Klanten krijgen enkel mail als het afzenderdomein bij Resend geverifieerd is."],
      ["Hosting (Vercel)", "ok", "Deze pagina laadt, dus de hosting draait", "Versies en logboek: vercel.com → project famo-portail."],
      ["Toegang", c.adminCodeCustom && c.staffCodeCustom ? "ok" : "warn", (c.adminCodeCustom && c.staffCodeCustom ? "Aparte codes voor beheerder en personeel" : "Codes nog niet apart ingesteld") + " · " + (st.medewerkers || 0) + " medewerker" + (st.medewerkers === 1 ? "" : "s") + " met PIN", ""]
    ];
    page.querySelector("#cards").innerHTML = cards.map(([t, s, d, n]) => '<div class="kp"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:14px;margin:0">' + t + '</b><span class="cell-st c-' + (s === "ok" ? "done" : s === "warn" ? "new" : "late") + '" style="min-width:64px">' + (s === "ok" ? "OK" : s === "warn" ? "Let op" : "Fout") + '</span></div><div class="muted" style="font-size:12.5px;margin-top:6px">' + K.esc(d) + '</div>' + (n ? '<div class="quiet" style="font-size:11.5px;margin-top:6px">' + K.esc(n) + '</div>' : "") + '</div>').join("");
    const issues = [];
    if (st.ibanOntbreekt) issues.push(["IBAN of BIC ontbreekt", "#/bedrijf"]); if (st.klantenZonderEmail) issues.push([st.klantenZonderEmail + " klant(en) zonder e-mail", "#/klanten"]); if (!(c.adminCodeCustom && c.staffCodeCustom)) issues.push(["Codes personeel en beheerder niet apart", "#/toegang"]); if (!st.stock) issues.push(["Voorraadtabel leeg" + (c.voorraadAfboeken ? " — afboeken staat aan" : " — voorraad wordt niet afgetrokken"), "/stock.html"]); if (st.aanvragen) issues.push([st.aanvragen + " nieuwe aanvraag/aanvragen", "#/aanvragen"]);
    page.querySelector("#health").innerHTML = '<div class="card" style="margin-top:16px"><div class="card-h"><h2 class="h2">Gezondheid van de gegevens</h2></div>' + (issues.length ? issues.map(([t, h]) => '<div class="stop" style="min-height:48px"><span class="chip st-new"><i></i>!</span><span style="flex:1">' + K.esc(t) + '</span><a class="btn btn-o btn-sm" href="' + h + '">Bekijken</a></div>').join("") : '<div class="card-b">' + K.c.ok("Alles in orde.") + '</div>') + '</div><p class="quiet" style="font-size:12.5px;margin-top:12px">Wie te bellen: ontwikkelaar Ayoub · eigenaar Bilal.</p>';
    page.querySelector("#recheck").onclick = () => render(true);
    dbCard();
  }

  /* ---------- database (Airtable -> Postgres) : api/dbadmin.js ---------- */
  const DB_LABEL = { airtable: "Airtable", postgres: "Postgres (Neon)", sqlite: "SQLite (lokaal)" };
  function dbReport(rep) {
    return '<div class="tblwrap"><table class="tbl"><thead><tr><th>Tabel</th><th class="num">Airtable</th><th class="num">Nieuwe database</th><th>Resultaat</th></tr></thead><tbody>' + rep.map(r => '<tr><td>' + K.esc(r.table) + '</td><td class="num mono">' + r.airtable + '</td><td class="num mono">' + r.postgres + '</td><td>' + (r.ok ? '<span class="cell-st c-done">OK</span>' : '<span class="cell-st c-late">Verschil</span>') + (r.onlyAirtable || r.onlyPostgres ? ' <small class="quiet">' + (r.onlyAirtable || 0) + ' enkel Airtable · ' + (r.onlyPostgres || 0) + ' enkel nieuw</small>' : "") + (r.totalAirtable !== undefined ? ' <small class="quiet">totaal ' + K.eur(r.totalAirtable) + ' / ' + K.eur(r.totalPostgres) + '</small>' : "") + '</td></tr>').join("") + '</tbody></table></div>';
  }
  async function dbCard(withAirtable) {
    const box = page.querySelector("#dbcard"); if (!box) return;
    box.innerHTML = '<div class="card" style="margin-top:16px"><div class="card-h"><h2 class="h2">Database</h2></div><div class="card-b">' + K.c.skeleton(1) + '</div></div>';
    let d; try { d = await K.api("/api/dbadmin" + (withAirtable ? "?airtable=1" : "")); } catch (e) { box.querySelector(".card-b").innerHTML = K.c.error(e.message); return; }
    const onNew = d.backend !== "airtable";
    const counts = Object.entries(d.counts || {}).map(([t, n]) => K.esc(t) + " " + n).join(" · ") || "nog leeg";
    const at = d.airtable ? '<p class="sub">In Airtable: ' + Object.entries(d.airtable).map(([t, n]) => K.esc(t) + " " + n).join(" · ") + '</p>' : "";
    box.querySelector(".card-b").innerHTML =
      '<p style="margin:0 0 6px"><b>Actief:</b> ' + K.esc(DB_LABEL[d.backend] || d.backend) + (onNew ? "" : ' <small class="quiet">(de portaal leest en schrijft in Airtable)</small>') + '</p>' +
      (d.target ? '<p class="sub" style="margin:0 0 6px">Nieuwe database: ' + (d.reachable ? '<span class="cell-st c-done">bereikbaar</span>' : '<span class="cell-st c-late">niet bereikbaar</span>') + ' · ' + counts + '</p>' : "") +
      (d.targetError ? K.c.error(d.targetError) : "") + at +
      '<div id="dbout"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
        '<button type="button" class="btn btn-o btn-sm" id="dbCount">Tellen in Airtable</button>' +
        (d.target && d.reachable ? '<button type="button" class="btn btn-o btn-sm" id="dbVerify">Vergelijken</button>' : "") +
        (d.target && d.reachable && !onNew ? '<button type="button" class="btn btn-p btn-sm" id="dbCopy">Kopieer Airtable naar de nieuwe database</button>' : "") +
      '</div>' +
      '<p class="sub" style="margin-top:10px">' + (onNew ? "De portaal draait op de nieuwe database. Terug naar Airtable: zet DB_BACKEND op airtable in Vercel en redeploy." : "Kopiëren overschrijft de nieuwe database met de inhoud van Airtable; Airtable zelf blijft onaangeroerd. Omschakelen: DB_BACKEND=postgres in Vercel, dan redeploy.") + '</p>';
    const out = box.querySelector("#dbout");
    box.querySelector("#dbCount").onclick = () => dbCard(true);
    const v = box.querySelector("#dbVerify");
    if (v) v.onclick = async () => { K.busy(v, true, "Vergelijken…"); try { const r = await K.api("/api/dbadmin", { json: { action: "verify" } }); out.innerHTML = (r.ok ? K.c.ok("Airtable en de nieuwe database zijn gelijk.") : K.c.warn("Er zijn verschillen: zie de tabel.")) + dbReport(r.report); } catch (e) { out.innerHTML = K.c.error(e.message); } K.busy(v, false); };
    const cp = box.querySelector("#dbCopy");
    if (cp) cp.onclick = async () => {
      if (!(await K.confirm({ title: "Alles kopiëren naar de nieuwe database?", text: "De nieuwe database wordt volledig vervangen door de huidige inhoud van Airtable. Airtable zelf verandert niet. De portaal blijft op Airtable draaien tot je omschakelt.", yes: "Kopiëren" }))) return;
      K.busy(cp, true, "Kopiëren…");
      try { const r = await K.api("/api/dbadmin", { json: { action: "copy" } }); K.toast(r.ok ? "Kopie klaar" : "Kopie met verschillen"); await dbCard(); box.querySelector("#dbout").innerHTML = (r.ok ? K.c.ok("Kopie klaar: alle tabellen hebben evenveel regels.") : K.c.warn("Kopie klaar, maar met verschillen.")) + dbReport(r.report); }
      catch (e) { out.innerHTML = K.c.error(e.message); K.busy(cp, false); }
    };
  }

  async function render(force) {
    if (force || !D) { try { await load(); } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content" style="padding-top:20px">' + K.c.error(err.message, true) + '</div>'; K.on(page, "click", "[data-retry]", e => { e.preventDefault(); render(true); }); return; } }
    if (!D.config) D.config = {};
    const views = { overzicht, aanvragen, klanten, producten, prijzen, rapportage, bedrijf, toegang, status };
    if (force) rapCache = null;
    views[tab] ? await views[tab]() : overzicht();
  }
  K.on(page, "click", "[data-new-client]", () => clientPanel(null));
  K.on(page, "click", "[data-new-product]", () => productPanel(null));
  window.addEventListener("hashchange", () => { const h = K.hashParams(); tab = h.path || "overzicht"; if (h.params.klant) sel = h.params.klant; render(); });
  page.innerHTML = '<div class="page-h"><h1 class="h1">Beheer</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  render(true);
})();
