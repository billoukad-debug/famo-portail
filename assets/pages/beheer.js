(async function () {
  if (!(await K.requireStaff({ admin: true }))) return;
  // Ancien lien (#/rapportage) : la Rapportage est une page à part depuis la spec 022.
  if (K.hashParams().path === "rapportage") { location.replace("/beheer/rapportage"); return; }
  const page = K.shell({ portal: "beheer" });
  const TABS = [["overzicht", "Overzicht"], ["aanvragen", "Aanvragen"], ["klanten", "Klanten"], ["producten", "Producten"], ["prijzen", "Prijzen"], ["rapportage", "Rapportage"], ["journaal", "Journaal"], ["bedrijf", "Bedrijfsgegevens"], ["toegang", "Toegang"], ["status", "Systeemstatus"]];
  const DAGEN = [["ma", "maandag"], ["di", "dinsdag"], ["wo", "woensdag"], ["do", "donderdag"], ["vr", "vrijdag"], ["za", "zaterdag"], ["zo", "zondag"]];
  // pendingCreds : net aangemaakt wachtwoord, één keer getoond bovenaan de klantfiche (overleeft de hash-herrender).
  let D = null, tab = K.hashParams().path || "overzicht", sel = K.hashParams().params.klant || "", pendingCreds = null;
  const post = async (json) => { const d = await K.api("/api/onboarding", { json }); D = d; return d; };
  const load = async () => { D = await K.api("/api/onboarding"); };
  const clientById = id => (D.clients || []).find(c => c.id === id);
  // Index client|product reconstruit seulement quand D.prices change (grille produits × klanten : O(1) par cellule).
  let priceIdx = null, priceSrc = null;
  const priceOf = (cid, pid) => { if (priceSrc !== D.prices) { priceSrc = D.prices; priceIdx = new Map((D.prices || []).filter(p => !p.van && !p.tot).map(p => [p.clientId + "|" + p.productId, p])); } return priceIdx.get(cid + "|" + pid); };
  const head = (sub, right) => '<div class="page-h"><div><h1 class="h1">' + K.esc((TABS.find(t => t[0] === tab) || ["", "Beheer"])[1]) + '</h1><p class="sub">' + K.esc(sub) + '</p></div><span class="spacer"></span>' + (right || "") + '</div><nav class="tabs" aria-label="Beheer">' + TABS.map(([k, l]) => '<a href="' + (k === "rapportage" ? "/beheer/rapportage" : "#/" + k) + '"' + (tab === k ? ' class="on"' : "") + '>' + l + (k === "aanvragen" ? '<b class="nbadge" data-badge="aanvragen"' + (D.status.aanvragen ? "" : " hidden") + ' aria-label="' + K.plural(D.status.aanvragen, "nieuwe aanvraag", "nieuwe aanvragen") + '">' + D.status.aanvragen + '</b>' : "") + '</a>').join("") + '</nav>';
  const credsBox = c => K.c.ok('<b>Toegang voor ' + K.esc(c.nom) + '</b><div class="mt-6 d-grid gc-a-1 gap-4-12 fs-13"><span class="quiet">Gebruikersnaam</span><b class="mono us-all">' + K.esc(c.user) + '</b><span class="quiet">Wachtwoord</span><b class="mono us-all">' + K.esc(c.password) + '</b></div><div class="quiet fs-12 mt-6">Wordt maar één keer getoond. Geef het door aan de klant (telefoon of WhatsApp), niet per onbeveiligde mail.</div>');
  // Ingeklapte groep (gearchiveerde klanten, verwerkte aanvragen) : zelfde kop als een .grp.
  const fold = (title, n, inner) => '<details class="grp mt-14"><summary class="grp-h c-pointer ls-none blc-line">' + K.icon("chev") + K.esc(title) + ' <small>' + n + '</small></summary>' + inner + '</details>';
  const dateTime = v => v ? K.date(K.isoDay(v)) + " " + K.time(v) : "—";

  /* ---------- overzicht ---------- */
  async function overzicht() {
    let orders = []; try { await S.load(); orders = S.orders; } catch (e) { /* toon zonder */ }
    const c = S.counts(); const st = D.status;
    const issues = [];
    if (st.ibanOntbreekt) issues.push(['IBAN of BIC ontbreekt: facturen tonen voorbeeldbankgegevens.', '#/bedrijf']);
    if (!D.config.adminCodeCustom || !D.config.staffCodeCustom) issues.push(['Personeels- en beheerderscode zijn nog niet apart ingesteld.', '#/toegang']);
    if (st.klantenZonderEmail) issues.push([st.klantenZonderEmail + ' klant' + (st.klantenZonderEmail === 1 ? "" : "en") + ' zonder e-mail: geen bevestigingen.', '#/klanten']);
    if (!st.mailEnabled) issues.push(['E-mail is niet actief (RESEND_API_KEY ontbreekt op Vercel).', '#/status']);
    if (st.aanvragen) issues.push([st.aanvragen === 1 ? "1 nieuwe aanvraag wacht." : st.aanvragen + " nieuwe aanvragen wachten.", '#/aanvragen']);
    page.innerHTML = head("Klanten, producten, prijzen en instellingen", '<a class="btn btn-o btn-sm" href="/team/invoeren">' + K.icon("plus") + 'Bestelling invoeren</a><button type="button" class="btn btn-p btn-sm" data-new-client>Nieuwe klant</button>') +
      '<div class="content pt-16">' +
      '<div class="kpis"><a class="kp kp-link" href="/team/bestellingen"><small>Open bestellingen</small><b>' + orders.filter(o => !K.isClosed(o)).length + '</b><em>' + c.today + ' vandaag</em></a><a class="kp kp-link" href="/team/documenten#/open"><small>Openstaand te betalen</small><b class="mono">' + K.eur(c.unpaidSum) + '</b><em>' + c.unpaid + ' factu' + (c.unpaid === 1 ? "ur" : "ren") + '</em></a><a class="kp kp-link" href="#/klanten"><small>Klanten</small><b>' + st.clients + '</b><em>' + st.credentials + ' met toegang</em></a><a class="kp kp-link" href="#/producten"><small>Producten actief</small><b>' + st.catalogue + '</b><em>' + st.prijzen + ' prijsafspraken</em></a></div>' +
      (issues.length ? '<div class="card"><div class="card-h"><h2 class="h2">Aandachtspunten</h2></div>' + issues.map(([t, h]) => '<div class="stop attn-row"><span class="attn" aria-hidden="true"></span><span class="grow">' + t + '</span><a class="btn btn-o btn-sm" href="' + h + '">Bekijken</a></div>').join("") + '</div>' : K.c.ok("Alles is ingevuld. Geen aandachtspunten.")) +
      '<div class="card"><div class="card-h"><h2 class="h2">Laatste bestellingen</h2><a class="btn btn-o btn-sm" href="/team/bestellingen">Alle bestellingen</a></div>' + (orders.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Levering</th><th>Klant</th><th>Artikelen</th><th>Status</th><th class="num">Bedrag</th></tr></thead><tbody>' + orders.slice(0, 6).map(o => '<tr class="row" data-open="' + o.id + '"><td><b>' + K.esc(K.relDay(o.day)) + '</b></td><td>' + K.esc(o.client) + '</td><td class="muted">' + K.esc(S.lineTxt(o)) + '</td><td class="w-130">' + K.stCell(o.statut) + '</td><td class="num mono">' + K.eur(o.total) + '</td></tr>').join("") + '</tbody></table></div>' : '<div class="empty m-12">Nog geen bestellingen.</div>') + '</div></div>';
    K.on(page, "click", "tr[data-open]", (e, t) => { location.href = "/team/bestelling?id=" + encodeURIComponent(t.dataset.open); });
  }

  /* ---------- aanvragen ---------- */
  function aanvragen() {
    const all = D.aanvragen || [], list = all.filter(a => a.status === "Nieuw"), done = all.filter(a => a.status !== "Nieuw");
    const contact = a => '<div class="muted fs-125">' + K.esc(a.contactpersoon) + ' · <span class="tag">' + (a.taal === "FR" ? "Français" : "Nederlands") + '</span> · ' + (a.telefoon ? '<a href="tel:' + K.esc(String(a.telefoon).replace(/\s+/g, "")) + '">' + K.esc(a.telefoon) + '</a>' : '<span class="quiet">geen telefoon</span>') + ' · <a href="mailto:' + K.esc(a.email) + '">' + K.esc(a.email) + '</a></div>';
    page.innerHTML = head("Aanvragen via de website") + '<div class="content pt-16"><div class="card"><div class="card-h"><h2 class="h2">Nieuw <small class="quiet fw-400">' + list.length + '</small></h2></div>' + (list.length ? list.map(a => '<div class="stop ai-fs p-14"><div class="grow"><b>' + K.esc(a.bedrijfsnaam) + '</b><span class="quiet fs-115 ml-8">ontvangen ' + K.esc(dateTime(a.ontvangen)) + '</span>' + contact(a) + (a.adres ? '<div class="quiet fs-125">' + K.esc(a.adres) + '</div>' : "") + (a.notities ? '<div class="fs-125 mt-4">„' + K.esc(a.notities) + '”</div>' : "") + '</div><div class="d-flex gap-6 f-wrap jc-end"><button type="button" class="btn btn-p btn-sm" data-accept="' + a.id + '">Klant aanmaken</button><button type="button" class="btn btn-ghost btn-sm" data-close="' + a.id + '">Afsluiten</button></div></div>').join("") : '<div class="empty m-12">Geen nieuwe aanvragen. Het formulier staat op <a href="/aanvraag">/aanvraag</a>.</div>') + '</div><p class="quiet fs-125">„Klant aanmaken” vult de klantfiche vooraf in en maakt gebruikersnaam en wachtwoord aan; de aanvraag sluit automatisch.</p>' +
      (done.length ? fold("Verwerkt", done.length, '<div class="tblwrap"><table class="tbl"><thead><tr><th>Ontvangen</th><th>Bedrijf</th><th>Contact</th><th>Status</th></tr></thead><tbody>' + done.map(a => '<tr><td class="muted">' + K.esc(dateTime(a.ontvangen)) + '</td><td><b>' + K.esc(a.bedrijfsnaam) + '</b>' + (a.adres ? '<div class="quiet fs-11">' + K.esc(a.adres) + '</div>' : "") + '</td><td class="wrap">' + contact(a) + '</td><td class="w-120"><span class="cell-st c-done">' + K.esc(a.status) + '</span></td></tr>').join("") + '</tbody></table></div>') : "") + '</div>';
    K.on(page, "click", "[data-accept]", (e, t) => { const a = list.find(x => x.id === t.dataset.accept); clientPanel(null, { nom: a.bedrijfsnaam, email: a.email, tel: a.telefoon, adresse: a.adres, taal: a.taal, aanvraagId: a.id }); });
    K.on(page, "click", "[data-close]", async (e, t) => { if (!(await K.confirm({ title: "Aanvraag afsluiten?", text: "Zonder klant aan te maken.", yes: "Afsluiten" }))) return; try { await post({ action: "closeAanvraag", id: t.dataset.close }); K.toast("Aanvraag afgesloten"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } });
  }

  /* ---------- klanten ---------- */
  // EDI-02 : un panneau d'édition ouvert est dans l'URL (#/klanten?edit=klant:rec…) ; ce lien le rouvre directement.
  function setEdit(v) {
    const h = K.hashParams(), params = Object.assign({}, h.params); if (v) params.edit = v; else delete params.edit;
    const qs = new URLSearchParams(params).toString();
    try { history.replaceState(null, "", location.pathname + location.search + "#/" + (h.path || tab) + (qs ? "?" + qs : "")); } catch (e) { /* ignore */ }
  }
  function editPanel(key, opts) {
    if (key) setEdit(key);
    const prev = opts.onClose; opts.onClose = () => { if (key) setEdit(null); if (prev) prev(); };
    return K.panel(opts);
  }
  function openFromUrl() {
    const e = K.hashParams().params.edit || ""; if (!e || document.querySelector(".scrim")) return;
    const [kind, id] = e.split(":");
    if (kind === "product") { const pr = (D.products || []).find(x => x.id === id); if (pr) productPanel(pr); else setEdit(null); }
    if (kind === "klant") { const cl = clientById(id); if (cl) clientPanel(cl); else setEdit(null); }
  }
  // Régime de TVA (C-10) et contrôle VIES (C-16) : libellés de assets/vat.js, résultat lisible.
  const regimeLabel = k => window.FamoVat.regime(k).short;
  const viesHtml = r => !r ? '<span class="quiet">Nog niet gecontroleerd in VIES.</span>' : (r.valid ? K.c.ok : K.c.warn)('<b>' + (r.valid ? "Geldig in VIES" : "Niet geldig in VIES") + '</b> · <span class="mono">' + K.esc(r.vatNumber) + '</span>' + (r.name ? " · " + K.esc(r.name) : "") + (r.address ? '<br><span class="quiet">' + K.esc(r.address).replace(/\n/g, ", ") + '</span>' : "") + '<br><span class="quiet">Gecontroleerd op ' + K.esc(K.dateLong(r.checkedAt) + " " + K.time(r.checkedAt)) + '</span>');
  function clientPanel(c, prefill) {
    const v = Object.assign({ nom: "", adresse: "", facturatieadres: "", tel: "", email: "", btw: "", klantnr: "", user: "", taal: "NL", regime: "Normal" }, c || {}, prefill || {});
    let taal = v.taal === "FR" ? "FR" : "NL";
    const p = editPanel(c ? "klant:" + c.id : "", { title: c ? c.nom : "Nieuwe klant", sub: c ? "Klantfiche bewerken" : "Gebruikersnaam en wachtwoord worden automatisch aangemaakt", body:
      K.c.field("Naam van de zaak", K.c.input("cNom", { value: v.nom }), { id: "fNom", req: true }) +
      '<div class="grid-2">' + K.c.field("Telefoon", K.c.input("cTel", { value: v.tel, type: "tel" }), {}) + K.c.field("E-mail (bevestigingen)", K.c.input("cMail", { value: v.email, type: "email" }), { id: "fMail" }) + '</div>' +
      K.c.field("Leveradres", '<textarea class="input" id="cAdr" rows="2">' + K.esc(v.adresse) + '</textarea>', {}) +
      K.c.field("Facturatieadres (maatschappelijke zetel)", '<textarea class="input" id="cFact" rows="2" placeholder="Leeg = leveradres">' + K.esc(v.facturatieadres) + '</textarea>', { hint: "Straat en nummer, dan postcode en plaats op een nieuwe regel." }) +
      '<div class="grid-2">' + K.c.field("BTW-nummer", K.c.input("cBtw", { value: v.btw, placeholder: "BE 0xxx.xxx.xxx" }), {}) + K.c.field("Klantnummer", K.c.input("cNr", { value: v.klantnr, placeholder: "bv. K-004…" }), {}) + '</div>' +
      K.c.field("Btw-regime", '<select class="input" id="cRegime">' + window.FamoVat.REGIME_KEYS.map(k => '<option value="' + k + '"' + (v.regime === k ? " selected" : "") + '>' + K.esc(window.FamoVat.regime(k).label) + '</option>').join("") + '</select>', { id: "fRegime", hint: "Bepaalt de btw op factuur en creditnota. Bij 0 % komt de wettelijke vermelding op het document, in de taal van de klant. Intracommunautair: btw-nummer van een ander EU-land. Medecontractant: geldig Belgisch btw-nummer. Een uitgereikte factuur behoudt haar regime." }) +
      (c ? K.c.field("Controle in VIES", '<button type="button" class="btn btn-o" id="cVies">Controleren via VIES</button><div id="cViesOut" aria-live="polite">' + viesHtml(c.vies) + '</div>', { hint: "Controleert het btw-nummer hierboven bij de Europese Commissie (EU-nummers met landcode). Het resultaat van het opgeslagen nummer blijft bij de klant als bewijs." }) : "") +
      K.c.field("Taal van de documenten", '<div class="opt" role="group" aria-label="Taal van de documenten">' + [["NL", "Nederlands"], ["FR", "Français"]].map(([k, l]) => '<button type="button" data-taal="' + k + '"' + (taal === k ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + l + '</button>').join("") + '</div>', { hint: "Leveringsbon, factuur en creditnota worden in deze taal opgemaakt." }) +
      (c ? K.c.field("Gebruikersnaam", K.c.input("cUser", { value: v.user }), { hint: "Wijzigen? De klant moet het nieuwe login kennen." }) + '<label class="row-10 fs-13">' + K.c.check(false, 'id="cGen"') + 'Nieuw wachtwoord aanmaken en tonen</label>' : "") +
      K.c.field(c ? "Of zelf een nieuw wachtwoord kiezen (optioneel)" : "Eigen wachtwoord (optioneel)", K.c.input("cPw", { attrs: ' autocomplete="new-password"' }), { id: "fPw", hint: "Minstens 8 tekens. Leeg = automatisch aangemaakt." + (c ? " Leeg + vinkje uit = wachtwoord blijft." : "") }) +
      '<label class="row-10 fs-13">' + K.c.check(true, 'id="cMailSend"') + '<span>Welkomstmail sturen<span class="quiet fs-12 d-block">Met de gebruikersnaam en een link (72 uur geldig) om zelf een wachtwoord te kiezen; nooit het wachtwoord zelf. Enkel als er een e-mailadres is.</span></span></label><div id="cErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="cOk">' + (c ? "Opslaan" : "Klant aanmaken") + '</button>' });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    const vb = p.el.querySelector("#cVies");
    if (vb) vb.onclick = async () => {
      const out = p.el.querySelector("#cViesOut"); K.busy(vb, true, "Controleren…");
      try { const d = await post({ action: "checkVies", id: c.id, btw: p.el.querySelector("#cBtw").value.trim() }); out.innerHTML = viesHtml(d.vies) + (d.stored ? "" : '<span class="quiet">Niet bewaard: sla eerst het nieuwe btw-nummer op en controleer dan opnieuw.</span>'); }
      catch (err) { out.innerHTML = K.c.error(err.message); }
      K.busy(vb, false);
    };
    K.on(p.el, "click", "[data-taal]", (e, t) => { taal = t.dataset.taal; K.$$("[data-taal]", p.el).forEach(b => { const on = b === t; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); }); });
    let gen = false, sendMail = true; const g = p.el.querySelector("#cGen"); if (g) g.onclick = () => { gen = !gen; K.setOn(g, gen); };
    const ms = p.el.querySelector("#cMailSend"); ms.onclick = () => { sendMail = !sendMail; K.setOn(ms, sendMail); };
    p.el.querySelector("#cOk").onclick = async () => {
      const val = id => p.el.querySelector("#" + id).value.trim();
      const nom = val("cNom"), pw = p.el.querySelector("#cPw").value; K.setErr("fNom", nom ? "" : "Verplicht."); K.setErr("fPw", pw && pw.length < 8 ? "Minstens 8 tekens." : ""); if (!nom || (pw && pw.length < 8)) return;
      const btn = p.el.querySelector("#cOk"); K.busy(btn, true, "Opslaan…");
      try {
        const d = await post({ action: "saveClient", id: c ? c.id : undefined, nom, adresse: val("cAdr"), facturatieadres: val("cFact"), tel: val("cTel"), email: val("cMail"), btw: val("cBtw"), klantnr: val("cNr"), taal, regime: p.el.querySelector("#cRegime").value, user: c ? val("cUser") : "", password: pw || undefined, generate: pw ? false : (c ? gen : true), sendMail });
        if (prefill && prefill.aanvraagId) { try { await post({ action: "closeAanvraag", id: prefill.aanvraagId }); } catch (e) { /* al gesloten */ } }
        p.close(); tab = "klanten"; sel = d.credentials.id; if (!c || gen || pw) pendingCreds = d.credentials;
        // Eén render : via hashchange als de hash verandert, anders rechtstreeks (anders wist de tweede render de codes).
        const target = "#/klanten?klant=" + encodeURIComponent(sel); if (location.hash === target) render(); else location.hash = target;
        K.toast((c ? "Klant opgeslagen" : "Klant aangemaakt") + (d.mail && d.mail.ok ? " · Welkomstmail verstuurd" : ""));
      } catch (err) { if (err.status === 409 && /gebruikersnaam/i.test(err.message) && c) K.setErr("fNom", ""); p.el.querySelector("#cErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  }
  // Prix à période (audit H-07) : action ou prix de la semaine, prioritaire sur le prix permanent
  // pendant sa période (lib/prices.js). La grille au-dessus reste celle des prix permanents.
  function tempPrices(c, prods) {
    const today = K.today(), nm = pid => (prods.find(p => p.id === pid) || (D.products || []).find(p => p.id === pid) || { nom: "?" }).nom;
    const rows = (D.prices || []).filter(p => p.clientId === c.id && (p.van || p.tot)).sort((a, b) => String(b.van).localeCompare(String(a.van)));
    const state = p => p.tot && p.tot < today ? '<span class="chip st-cancel"><i></i>Verlopen</span>' : p.van && p.van > today ? '<span class="chip st-new"><i></i>Gepland</span>' : '<span class="chip st-done"><i></i>Actief</span>';
    return '<div class="card"><div class="card-h"><div><h2 class="h2">Tijdelijke prijzen</h2><p class="sub">Actie of weekprijs · geldt van–tot (inbegrepen) en gaat vóór de afgesproken prijs</p></div></div>' +
      (rows.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th class="num">Prijs</th><th>Van</th><th>Tot</th><th></th><th></th></tr></thead><tbody>' + rows.map(p => '<tr><td><b>' + K.esc(nm(p.productId)) + '</b></td><td class="num mono">' + K.eur(p.prix) + '</td><td>' + K.esc(p.van ? K.date(p.van) : "—") + '</td><td>' + K.esc(p.tot ? K.date(p.tot) : "—") + '</td><td>' + state(p) + '</td><td class="num"><button type="button" class="btn btn-ghost btn-sm" data-del-temp="' + K.esc(p.id) + '" aria-label="Tijdelijke prijs verwijderen">' + K.icon("trash") + '</button></td></tr>').join("") + '</tbody></table></div>' : '<div class="card-b quiet">Geen tijdelijke prijzen.</div>') +
      '<form class="card-b d-flex gap-8 f-wrap ai-end bt-line" id="tempForm">' +
      '<label class="fx2-180"><small>Product</small><select class="input" name="productId" required>' + prods.map(p => '<option value="' + K.esc(p.id) + '">' + K.esc(p.nom) + '</option>').join("") + '</select></label>' +
      '<label class="fx-90"><small>Prijs excl. btw</small><input class="input mono" name="prix" inputmode="decimal" required></label>' +
      '<label class="fx-130"><small>Van</small><input class="input" type="date" name="van" value="' + today + '" required></label>' +
      '<label class="fx-130"><small>Tot</small><input class="input" type="date" name="tot" required></label>' +
      '<button class="btn btn-p btn-sm" type="submit">Toevoegen</button></form></div>';
  }
  // Plusieurs utilisateurs par client (H-08) : chacun son identifiant ; commandes et prix du client.
  async function usersCard(c) {
    const box = page.querySelector("#kgBox"); if (!box) return;
    let users = [];
    try { users = (await K.api("/api/onboarding", { json: { action: "listKlantgebruikers", clientId: c.id } })).users || []; } catch (err) { box.innerHTML = '<div class="card card-b">' + K.c.error(err.message) + '</div>'; return; }
    const showCreds = cr => cr ? K.c.warn("<b>Gegevens voor " + K.esc(cr.nom || cr.user) + "</b> · gebruikersnaam <span class=\"mono\">" + K.esc(cr.user) + "</span> · wachtwoord <span class=\"mono\">" + K.esc(cr.password) + "</span> — nu doorgeven, dit wordt niet meer getoond.") : "";
    const draw = creds => {
      box.innerHTML = '<div class="card"><div class="card-h"><div><h2 class="h2">Extra gebruikers</h2><p class="sub ws-normal">Bv. chef en zaakvoerder: elk een eigen login, dezelfde prijzen en bestellingen van ' + K.esc(c.nom) + '. Bij elke bestelling staat wie ze plaatste.</p></div></div>' +
        (creds ? '<div class="card-b">' + showCreds(creds) + '</div>' : "") +
        (users.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Naam</th><th>Gebruikersnaam</th><th>E-mail</th><th>Status</th><th></th></tr></thead><tbody>' + users.map(u => '<tr><td><b>' + K.esc(u.naam) + '</b></td><td class="mono">' + K.esc(u.user) + '</td><td>' + K.esc(u.email || "—") + '</td><td>' + (u.actief ? '<span class="chip st-done"><i></i>Actief</span>' : '<span class="chip st-cancel"><i></i>Inactief</span>') + '</td><td class="num nowrap"><button type="button" class="btn btn-ghost btn-sm" data-kg-reset="' + K.esc(u.id) + '">Nieuw wachtwoord</button><button type="button" class="btn btn-ghost btn-sm" data-kg-toggle="' + K.esc(u.id) + '">' + (u.actief ? "Deactiveren" : "Activeren") + '</button><button type="button" class="btn btn-ghost btn-sm" data-kg-del="' + K.esc(u.id) + '" aria-label="Gebruiker ' + K.esc(u.naam) + ' verwijderen">' + K.icon("trash") + '</button></td></tr>').join("") + '</tbody></table></div>' : '<div class="card-b quiet">Enkel de hoofdlogin (' + K.esc(c.user || "—") + ').</div>') +
        '<form class="card-b d-flex gap-8 f-wrap ai-end bt-line" id="kgForm">' +
        '<label class="fx2-160"><small>Naam</small><input class="input" name="naam" required maxlength="80"></label>' +
        '<label class="fx2-180"><small>E-mail (voor de activatielink)</small><input class="input" name="email" type="email" maxlength="120"></label>' +
        '<label class="fx-140"><small>Gebruikersnaam (leeg = automatisch)</small><input class="input mono" name="user" maxlength="40" autocapitalize="none" spellcheck="false"></label>' +
        '<button class="btn btn-p btn-sm" type="submit">Gebruiker toevoegen</button></form></div>';
    };
    const reload = async creds => { try { users = (await K.api("/api/onboarding", { json: { action: "listKlantgebruikers", clientId: c.id } })).users || []; } catch (e) { /* lijst van vóór */ } draw(creds); wire(); };
    const wire = () => {
      const f = box.querySelector("#kgForm");
      f.onsubmit = async e => { e.preventDefault(); const b = f.querySelector("button"), v = n => f.elements[n].value.trim(); if (!v("naam")) { K.toast("Naam is verplicht", { kind: "err" }); return; } K.busy(b, true, "Opslaan…"); try { const d = await K.api("/api/onboarding", { json: { action: "saveKlantgebruiker", clientId: c.id, naam: v("naam"), email: v("email"), user: v("user") } }); K.toast(d.mail && d.mail.ok ? "Gebruiker toegevoegd · activatielink gemaild" : "Gebruiker toegevoegd"); await reload(d.credentials); } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(b, false); } };
      K.$$("[data-kg-reset]", box).forEach(b => { b.onclick = async () => { if (!(await K.confirm({ title: "Nieuw wachtwoord?", text: "Het oude werkt meteen niet meer; de gebruiker wordt overal afgemeld.", yes: "Nieuw wachtwoord" }))) return; try { const d = await K.api("/api/onboarding", { json: { action: "resetKlantgebruiker", id: b.dataset.kgReset } }); await reload(d.credentials); } catch (err) { K.toast(err.message, { kind: "err" }); } }; });
      K.$$("[data-kg-toggle]", box).forEach(b => { b.onclick = async () => { const u = users.find(x => x.id === b.dataset.kgToggle); try { await K.api("/api/onboarding", { json: { action: "saveKlantgebruiker", id: u.id, naam: u.naam, email: u.email, user: u.user, actief: !u.actief } }); await reload(null); } catch (err) { K.toast(err.message, { kind: "err" }); } }; });
      K.$$("[data-kg-del]", box).forEach(b => { b.onclick = async () => { const u = users.find(x => x.id === b.dataset.kgDel); if (!(await K.confirm({ title: u.naam + " verwijderen?", text: "Deze login werkt meteen niet meer. Bestellingen blijven bewaard.", yes: "Verwijderen", danger: true }))) return; try { await K.api("/api/onboarding", { json: { action: "deleteKlantgebruiker", id: u.id } }); await reload(null); } catch (err) { K.toast(err.message, { kind: "err" }); } }; });
    };
    draw(null); wire();
  }
  function klanten() {
    // CHI-09 : liste triable (nom, numéro client, sans e-mail d'abord), choix gardé sur l'appareil.
    const ksort = K.store.get("famoKlantenSort", "naam");
    const KS = { naam: (a, b) => String(a.nom || "").localeCompare(String(b.nom || ""), "nl"), nr: (a, b) => String(a.klantnr || "~").localeCompare(String(b.klantnr || "~"), "nl", { numeric: true }), mail: (a, b) => (a.email ? 1 : 0) - (b.email ? 1 : 0) || String(a.nom || "").localeCompare(String(b.nom || ""), "nl") };
    const all = (D.clients || []).slice().sort(KS[ksort] || KS.naam), list = all.filter(x => !x.gearchiveerd), arch = all.filter(x => x.gearchiveerd);
    if (!sel && list.length) sel = list[0].id; const c = clientById(sel);
    const prods = (D.products || []).filter(p => p.actif);
    const row = x => '<a href="#/klanten?klant=' + x.id + '" class="stop mh-48 td-none t-inherit' + (x.id === sel ? " bg-p-soft" : "") + '" data-c="' + x.id + '">' + K.c.avatar(x.nom) + '<div class="grow"><b class="ellipsis d-block">' + K.esc(x.nom) + '</b><span class="quiet fs-115">' + K.esc(x.klantnr || x.user || "") + (x.email ? "" : " · geen e-mail") + '</span></div></a>';
    page.innerHTML = head(list.length + " klanten · " + D.status.credentials + " met toegang" + (arch.length ? " · " + arch.length + " gearchiveerd" : ""), '<button type="button" class="btn btn-p btn-sm" data-new-client>' + K.icon("plus") + 'Nieuwe klant</button>') +
      '<div class="content pt-16 d-grid duo-l300 gap-16 ai-start" id="two">' +
      '<div class="sticky-list"><div class="card"><div class="card-h gap-8 f-wrap"><label class="search fx-150">' + K.icon("search") + '<input id="cq" aria-label="Klant zoeken" placeholder="Naam of klantnummer…"></label><select class="input tool w-auto px-8" id="ksort" aria-label="Sorteren">' + [["naam", "Naam A–Z"], ["nr", "Klantnummer"], ["mail", "Zonder e-mail eerst"]].map(([k, l]) => '<option value="' + k + '"' + (ksort === k ? " selected" : "") + '>' + l + '</option>').join("") + '</select></div><div id="clist">' + list.map(row).join("") + '</div></div>' + (arch.length ? fold("Gearchiveerd", arch.length, '<div id="alist">' + arch.map(row).join("") + '</div>') : "") + '</div>' +
      '<div id="detail" class="d-flex f-col gap-14 minw-0">' + (c && pendingCreds && pendingCreds.id === c.id ? credsBox(pendingCreds) : "") + (c ? '<div class="card card-b"><div class="d-flex ai-c gap-12 f-wrap"><h2 class="h2">' + K.esc(c.nom) + '</h2>' + (c.gearchiveerd ? '<span class="chip st-cancel"><i></i>Gearchiveerd</span>' : c.user && c.hasPassword ? '<span class="chip st-done"><i></i>Toegang actief</span>' : '<span class="chip st-new"><i></i>Geen toegang</span>') + '</div><div class="acts">' + '<button type="button" class="btn btn-o btn-sm" data-edit="' + c.id + '">Bewerken</button><a class="btn btn-o btn-sm" href="/team/bestellingen?klant=' + encodeURIComponent(c.id) + '">Bestellingen</a>' + '<button type="button" class="btn btn-o btn-sm" data-export="' + c.id + '" title="Recht op inzage (AVG): alle gegevens van deze klant als JSON">Gegevens exporteren</button>' + (c.gearchiveerd ? '<button type="button" class="btn btn-p btn-sm" data-unarchive="' + c.id + '">Herstellen</button><button type="button" class="btn btn-o btn-sm" data-anon="' + c.id + '" title="Recht op wissing (AVG): contactgegevens en login wissen, facturen blijven">Anonimiseren</button>' : '<button type="button" class="btn btn-o btn-sm" data-reset="' + c.id + '">Nieuw wachtwoord</button><span class="spacer"></span>' + (c.user && c.hasPassword ? '<button type="button" class="btn btn-ghost btn-sm t-danger" data-revoke="' + c.id + '">Toegang blokkeren</button>' : "") + '<button type="button" class="btn btn-ghost btn-sm" data-archive="' + c.id + '">Archiveren</button>') + '</div>' +
        (c.gearchiveerd ? K.c.warn("<b>Gearchiveerd.</b> De klant kan niet aanmelden en staat niet in de lijsten. Fiche, prijzen en bestellingen blijven bewaard. „Herstellen” zet alles terug.") : "") +
        '<div class="kv mt-12"><div><small>Gebruikersnaam</small><span class="mono">' + K.esc(c.user || "—") + '</span></div><div><small>Klantnummer</small>' + K.esc(c.klantnr || "—") + '</div><div><small>Telefoon</small>' + (c.tel ? '<a href="tel:' + K.esc(c.tel.replace(/\s+/g, "")) + '">' + K.esc(c.tel) + '</a>' : "—") + '</div><div><small>E-mail</small>' + (c.email ? K.esc(c.email) : '<span class="t-danger">ontbreekt — geen bevestigingsmails</span>') + '</div><div class="span-all"><small>Leveradres</small><span class="ws-pre">' + K.esc(c.adresse || "—") + '</span></div><div><small>BTW</small>' + K.esc(c.btw || "—") + '</div><div><small>Btw-regime</small>' + K.esc(regimeLabel(c.regime)) + (c.vies ? ' · <span class="quiet">VIES ' + (c.vies.valid ? "geldig" : "niet geldig") + " (" + K.esc(K.dateLong(c.vies.checkedAt)) + ")</span>" : "") + '</div></div></div>' +
        '<div class="card"><div class="card-h"><div><h2 class="h2">Afgesproken prijzen</h2><p class="sub">Leeg = basisprijs · prijzen excl. btw · Enter in een prijs = opslaan</p></div><button type="button" class="btn btn-p btn-sm" id="savePrices" data-save-prices disabled>Prijzen opslaan</button></div><div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th class="num">Basisprijs</th><th class="num w-150">Prijs ' + K.esc(c.nom) + '</th></tr></thead><tbody>' + prods.map(p => { const pr = priceOf(c.id, p.id); return '<tr><td><b>' + K.esc(p.nom) + '</b><div class="quiet fs-11">' + K.esc(K.unit(p.unite)) + (p.kaliber ? " · " + K.esc(p.kaliber) : "") + '</div></td><td class="num mono muted">' + K.eur(p.base) + '</td><td class="num"><input class="input mono mh-40 ta-r w-130" data-price="' + p.id + '" inputmode="decimal" value="' + (pr && pr.prix != null ? String(pr.prix).replace(".", ",") : "") + '" placeholder="' + K.eur(p.base).replace(/^€\s/, "") + '" aria-label="Afgesproken prijs ' + K.esc(p.nom) + '"></td></tr>'; }).join("") + '</tbody></table></div><div class="card-b d-flex jc-end bt-soft"><button type="button" class="btn btn-p btn-sm" data-save-prices disabled>Prijzen opslaan</button></div></div>' + tempPrices(c, prods) + '<div id="kgBox"></div>' : K.c.empty("Nog geen klanten", "Maak de eerste klant aan.")) + '</div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    if (c && pendingCreds && pendingCreds.id === c.id) pendingCreds = null;
    if (c && c.gearchiveerd) { const d = page.querySelector("details"); if (d) d.open = true; }
    const ks = page.querySelector("#ksort"); if (ks) ks.onchange = () => { K.store.set("famoKlantenSort", ks.value); render(); const n = page.querySelector("#ksort"); if (n) n.focus(); };
    const cq = page.querySelector("#cq"); if (cq) cq.addEventListener("input", () => { const s = cq.value.toLowerCase(); K.$$("[data-c]", page).forEach(a => { a.style.display = a.textContent.toLowerCase().includes(s) ? "" : "none"; }); });
    const changed = new Map();
    // G-17 : deux boutons « Prijzen opslaan » (au-dessus et sous le tableau) ; Entrée dans un prix enregistre.
    const saveBtns = () => K.$$("[data-save-prices]", page);
    K.on(page, "input", "[data-price]", (e, t) => { changed.set(t.dataset.price, t.value); saveBtns().forEach(b => { b.disabled = !changed.size; b.textContent = "Prijzen opslaan (" + changed.size + ")"; }); });
    const savePrices = async sp => { if (!changed.size || !c) return; K.busy(sp, true, "Opslaan…"); try { const d = await post({ action: "saveClientPrices", clientId: c.id, prices: Array.from(changed.entries()).map(([productId, prix]) => ({ productId, prix: K.numIn(prix) })) }); const bad = (d.results || []).filter(r => !r.ok); if (bad.length) K.toast(K.plural(bad.length, "prijs", "prijzen") + " niet opgeslagen: " + bad[0].error, { kind: "err" }); else K.toast("Prijzen opgeslagen"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(sp, false); } };
    saveBtns().forEach(b => { b.onclick = () => savePrices(b); });
    K.on(page, "keydown", "[data-price]", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); const b = saveBtns()[0]; if (b && !b.disabled) savePrices(b); } });
    if (c) usersCard(c);
    const tf = page.querySelector("#tempForm"); if (tf) tf.onsubmit = async (e) => { e.preventDefault(); const b = tf.querySelector("button"); const f = { get: n => tf.elements[n].value }; K.busy(b, true, "Opslaan…"); try { await post({ action: "savePrice", clientId: c.id, productId: f.get("productId"), prix: K.numIn(f.get("prix")), van: f.get("van"), tot: f.get("tot") }); K.toast("Tijdelijke prijs opgeslagen"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(b, false); } };
    K.on(page, "click", "[data-del-temp]", async (e, t) => { if (!(await K.confirm({ title: "Tijdelijke prijs verwijderen?", text: "De afgesproken prijs geldt dan opnieuw.", yes: "Verwijderen", no: "Annuleren", danger: true }))) return; try { await post({ action: "deletePrice", id: t.dataset.delTemp }); K.toast("Verwijderd"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } });
    K.on(page, "click", "[data-edit]", (e, t) => clientPanel(clientById(t.dataset.edit)));
    K.on(page, "click", "[data-archive]", async (e, t) => {
      const cl = clientById(t.dataset.archive);
      if (!(await K.confirm({ title: cl.nom + " archiveren?", text: "De klant kan niet meer aanmelden en verdwijnt uit de lijsten (invoer, bestellingen). Fiche, prijzen en bestellingen blijven bewaard; herstellen kan altijd.", yes: "Archiveren", danger: true }))) return;
      try { await post({ action: "archiveClient", id: cl.id }); K.toast(cl.nom + " gearchiveerd"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); }
    });
    // AVG : inzage (export JSON) en wissing (anonimiseren van een gearchiveerde klant).
    K.on(page, "click", "[data-export]", async (e, t) => { const cl = clientById(t.dataset.export); try { const d = await K.api("/api/onboarding", { json: { action: "exportClient", id: cl.id } }); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(d.export, null, 2)], { type: "application/json" })); a.download = "klant-" + String(cl.nom || cl.id).replace(/[^\w.-]+/g, "-") + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); K.toast("Gegevens van " + cl.nom + " gedownload"); } catch (err) { K.toast(err.message, { kind: "err" }); } });
    K.on(page, "click", "[data-anon]", async (e, t) => { const cl = clientById(t.dataset.anon); const v = await K.prompt({ title: "Klant anonimiseren?", text: "E-mail, telefoon, login, favorieten en namen van ontvangers bij " + cl.nom + " worden gewist. Naam van de zaak, btw-nummer en adressen blijven (facturen: 10 jaar bewaren). Dit kan niet ongedaan gemaakt worden. Typ ANONIEM om te bevestigen.", yes: "Anonimiseren" }); if (String(v || "").trim() !== "ANONIEM") return; try { const d = await post({ action: "anonymizeClient", id: cl.id, confirm: "ANONIEM" }); K.toast(cl.nom + " geanonimiseerd (" + d.geanonimiseerd.bestellingen + " bestellingen)"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } });
    K.on(page, "click", "[data-unarchive]", async (e, t) => { const cl = clientById(t.dataset.unarchive); try { await post({ action: "unarchiveClient", id: cl.id }); K.toast(cl.nom + " hersteld"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } });
    K.on(page, "click", "[data-revoke]", async (e, t) => {
      const cl = clientById(t.dataset.revoke);
      if (!(await K.confirm({ title: "Toegang blokkeren voor " + cl.nom + "?", text: "De klant kan niet meer aanmelden. Fiche, prijzen en bestellingen blijven bewaard. „Nieuw wachtwoord” geeft de toegang terug.", yes: "Blokkeren", danger: true }))) return;
      try { await post({ action: "revokeAccess", id: cl.id }); K.toast("Toegang geblokkeerd voor " + cl.nom); render(); } catch (err) { K.toast(err.message, { kind: "err" }); }
    });
    K.on(page, "click", "[data-reset]", async (e, t) => {
      const cl = clientById(t.dataset.reset);
      // Leeg laten = Famo maakt er een aan; zelf typen = dat wachtwoord (minstens 8 tekens, zelfde regel als de server).
      const typed = await K.prompt({ title: "Nieuw wachtwoord voor " + cl.nom, text: "Laat leeg om automatisch een wachtwoord aan te maken, of typ zelf een wachtwoord (minstens 8 tekens). Het oude wachtwoord werkt daarna niet meer." + (cl.email ? " De klant krijgt per mail een link om zelf een wachtwoord te kiezen (72 uur geldig)." : ""), placeholder: "Leeg = automatisch", yes: "Wachtwoord instellen" });
      if (typed === null) return;
      const password = typed.trim();
      if (password && password.length < 8) { K.toast("Minstens 8 tekens.", { kind: "err" }); return; }
      try { const d = await post(password ? { action: "resetPassword", id: cl.id, password } : { action: "resetPassword", id: cl.id }); pendingCreds = d.credentials; render(); if (d.mail && d.mail.ok) K.toast("Link gemaild naar " + cl.email); } catch (err) { K.toast(err.message, { kind: "err" }); }
    });
  }

  /* ---------- producten ---------- */
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
  // Foto's van een product (spec 018) : tot 6, de eerste = hoofdfoto (vignet in alle lijsten). De server
  // beslist : uploadFoto {add:true} weigert een 7e, setFotos houdt enkel bestaande foto's in de gekozen volgorde.
  const MAX_FOTOS = 6;
  function fotoManager(pn, p) {
    const box = pn.el.querySelector("#pFotoBox"), err = () => pn.el.querySelector("#pErr");
    let fotos = (p.fotos || []).slice(), busy = false;
    const draw = (focusSel) => {
      const n = fotos.length, lbl = i => "Foto " + (i + 1) + " van " + n;
      box.innerHTML = '<div class="d-flex jc-sb ai-c gap-8"><b>Foto\'s</b><span class="quiet fs-12" id="pFotoN" aria-live="polite">' + n + " van " + MAX_FOTOS + '</span></div>' +
        '<p class="quiet fs-12 m-0">De eerste foto is de hoofdfoto: die staat in de catalogus, bij Invoeren en in Voorraad. De klant ziet alle foto\'s in de details. JPEG, PNG of WebP; grote foto\'s worden automatisch verkleind.</p>' +
        (n ? '<ul class="fgrid" aria-label="Foto\'s van ' + K.esc(p.nom) + '">' + fotos.map((f, i) => '<li class="fcell" data-fid="' + K.esc(f.id) + '"><div class="fcell-img"><img src="' + K.esc(f.url) + '" alt="' + K.esc(lbl(i)) + '" loading="lazy" decoding="async">' + (i ? "" : '<span class="tag fcell-main">Hoofdfoto</span>') + '</div>' +
          '<div class="fcell-a"><button type="button" class="ibtn" data-fmv="-1" aria-label="' + K.esc(lbl(i)) + ' naar links"' + (i ? "" : " disabled") + '>◀</button><button type="button" class="ibtn" data-fmv="1" aria-label="' + K.esc(lbl(i)) + ' naar rechts"' + (i < n - 1 ? "" : " disabled") + '>▶</button></div>' +
          (i ? '<button type="button" class="btn btn-o btn-sm" data-fmain aria-label="' + K.esc(lbl(i)) + ' als hoofdfoto">Hoofdfoto</button>' : "") +
          '<button type="button" class="btn btn-ghost btn-sm t-danger" data-fdel aria-label="' + K.esc(lbl(i)) + ' verwijderen">Verwijderen</button></li>').join("") + '</ul>' : '<p class="m-0 fs-13">Nog geen foto. De catalogus toont dan een neutraal icoon.</p>') +
        '<div class="d-flex ai-c gap-10 f-wrap"><button type="button" class="btn btn-o btn-sm" id="pFotoAdd"' + (n >= MAX_FOTOS || busy ? " disabled" : "") + '>' + K.icon("camera") + 'Foto toevoegen</button><input type="file" id="pFoto" accept="image/jpeg,image/png,image/webp" multiple hidden><span class="quiet fs-12" id="pFotoSt" role="status">' + (n >= MAX_FOTOS ? "Maximum bereikt: verwijder eerst een foto." : "U kunt meerdere foto's tegelijk kiezen.") + '</span></div>';
      const f = focusSel && box.querySelector(focusSel); if (f && !f.disabled) f.focus(); else if (focusSel) { const a = box.querySelector("#pFotoAdd"); if (a) a.focus(); }
    };
    const fromServer = d => { const np = (d.products || []).find(x => x.id === p.id); fotos = np ? (np.fotos || []).slice() : fotos; p.fotos = fotos; p.foto = fotos[0] ? fotos[0].url : ""; };
    const save = async (order, focusSel, msg) => {
      if (busy) return; busy = true; err().innerHTML = "";
      try { fromServer(await post({ action: "setFotos", id: p.id, order })); busy = false; draw(focusSel); if (msg) K.toast(msg); }
      catch (e) { busy = false; err().innerHTML = K.c.error(e.message); draw(); }
    };
    box.addEventListener("click", async (e) => {
      const t = e.target.closest("button"); if (!t || t.disabled || busy) return;
      if (t.id === "pFotoAdd") { box.querySelector("#pFoto").click(); return; }
      const cell = t.closest(".fcell"); if (!cell) return;
      const id = cell.dataset.fid, i = fotos.findIndex(f => f.id === id), ids = fotos.map(f => f.id);
      if (t.hasAttribute("data-fmv")) { const j = i + Number(t.dataset.fmv); if (j < 0 || j >= ids.length) return; ids.splice(j, 0, ids.splice(i, 1)[0]); await save(ids, '[data-fid="' + CSS.escape(id) + '"] [data-fmv="' + t.dataset.fmv + '"]'); }
      else if (t.hasAttribute("data-fmain")) { ids.splice(0, 0, ids.splice(i, 1)[0]); await save(ids, '[data-fid="' + CSS.escape(id) + '"] [data-fmv="1"]', "Hoofdfoto gewijzigd"); }
      else if (t.hasAttribute("data-fdel")) {
        if (!(await K.confirm({ title: "Foto " + (i + 1) + " verwijderen?", text: (i === 0 && ids.length > 1 ? "Dit is de hoofdfoto: de volgende foto wordt de hoofdfoto. " : "") + "De foto verdwijnt meteen uit de catalogus. Dit kan niet ongedaan gemaakt worden.", yes: "Verwijderen", danger: true }))) return;
        ids.splice(i, 1); await save(ids, '.fcell:nth-child(' + Math.min(i + 1, ids.length) + ') [data-fdel]', "Foto verwijderd");
      }
    });
    box.addEventListener("change", async (e) => {
      const fi = e.target; if (fi.id !== "pFoto") return;
      const room = MAX_FOTOS - fotos.length, picked = Array.from(fi.files || []); fi.value = "";
      if (!picked.length) return; err().innerHTML = "";
      const bad = picked.filter(f => !/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 12 * 1024 * 1024);
      const files = picked.filter(f => !bad.includes(f)).slice(0, Math.max(0, room));
      const notes = [];
      if (bad.length) notes.push(bad.length + " bestand" + (bad.length === 1 ? "" : "en") + " overgeslagen (enkel JPEG, PNG of WebP tot 12 MB)");
      if (picked.length - bad.length > files.length) notes.push("maximaal " + MAX_FOTOS + " foto's: " + (picked.length - bad.length - files.length) + " niet toegevoegd");
      busy = true; draw(); let ok = 0;
      for (let k = 0; k < files.length; k++) {
        const st = box.querySelector("#pFotoSt"); if (st) st.textContent = "Foto " + (k + 1) + " van " + files.length + " uploaden…";
        try {
          // Verkleind in de browser (max 1600 px, JPEG 85 %) : een gsm-foto van 5 MB wordt ~300 kB.
          const s = await shrinkFoto(files[k]);
          if (s.base64.length > 4200000) throw new Error(files[k].name + ": te groot, ook na verkleinen (max 3 MB).");
          fromServer(await post({ action: "uploadFoto", id: p.id, add: true, contentType: s.type, filename: s.name, base64: s.base64 })); ok++;
        } catch (x) { notes.push(x.message || "Foto kon niet gelezen worden."); if (x.status === 400 && /Maximaal/.test(x.message || "")) break; }
      }
      busy = false; draw("#pFotoAdd");
      if (ok) K.toast(ok === 1 ? "Foto toegevoegd" : ok + " foto's toegevoegd");
      if (notes.length) err().innerHTML = K.c.warn(K.esc(notes.join(" · ")));
    });
    draw();
  }
  function productPanel(p) {
    const v = Object.assign({ nom: "", cat: "", unite: "caisse", base: "", kaliber: "", btwTarief: null, foto: "", actif: true }, p || {});
    const stockRow = (D.stock || []).find(s => s.product.toLowerCase() === String(v.nom).toLowerCase());

    const pn = editPanel(p ? "product:" + p.id : "", { title: p ? p.nom : "Nieuw product", sub: p ? "Product bewerken" : "Verschijnt in de klantcatalogus zodra actief", body:
      K.c.field("Naam (zoals de klant het ziet)", K.c.input("pNom", { value: v.nom }), { id: "fPNom", req: true, hint: p ? "Hernoemen? Voorraad en open bestellingen worden mee hernoemd; geleverde bestellingen houden de oude naam." : undefined }) +
      '<div class="d-grid gc-3 gap-10">' + K.c.field("Kaliber", K.c.input("pKal", { value: v.kaliber, placeholder: "bv. 16/20…" }), {}) + K.c.field("Eenheid", '<select class="input" id="pUnit">' + [["caisse", "kassa"], ["pièce", "stuk"], ["kg", "kg"], ["carton", "doos"]].map(([val, l]) => '<option value="' + val + '"' + (v.unite === val ? " selected" : "") + '>' + l + '</option>').join("") + '</select>', {}) + K.c.field("Basisprijs excl. btw", K.c.input("pBase", { value: v.base === "" ? "" : String(v.base).replace(".", ","), attrs: ' inputmode="decimal"' }), { id: "fPBase", req: true }) + '</div>' +
      // Verpakking (spec 023) : de prijs blijft per stuk ; enkel per verpakking = de klant bestelt per doos.
      '<div class="d-grid gc-3 gap-10 ai-start">' + K.c.field("Per verpakking", K.c.input("pPer", { value: v.per ? String(v.per).replace(".", ",") : "", placeholder: "bv. 6", attrs: ' inputmode="decimal" autocomplete="off"' }), { id: "fPPer" }) +
      K.c.field("Verpakking", K.c.input("pPak", { value: v.verpakking || "", placeholder: "doos", attrs: ' list="paks" maxlength="30" autocomplete="off"' }) + '<datalist id="paks">' + ["doos", "kist", "tray", "zak", "bak", "schaal"].map(x => '<option value="' + x + '">').join("") + '</datalist>', { id: "fPPak" }) +
      K.c.field("Bestellen", '<label class="row-10 fs-13 mh-44"><button type="button" class="toggle' + (v.enkel ? " on" : "") + '" id="pEnkel" aria-pressed="' + (v.enkel ? "true" : "false") + '"></button>Enkel per verpakking</label>', {}) + '</div>' +
      '<p class="quiet fs-12 m-0" id="pPakHint" aria-live="polite"></p>' +
      '<div class="grid-2">' + K.c.field("Categorie", K.c.input("pCat", { value: v.cat, placeholder: "bv. Vis, Schelpdieren, Schaaldieren…", attrs: ' list="cats"' }) + '<datalist id="cats">' + Array.from(new Set((D.products || []).map(x => x.cat).filter(Boolean))).map(x => '<option value="' + K.esc(x) + '">').join("") + '</datalist>', {}) + K.c.field("BTW-tarief (%)", K.c.input("pBtw", { value: v.btwTarief == null ? "" : v.btwTarief, placeholder: "standaard " + D.config.btwTarief + " %", attrs: ' inputmode="decimal"' }), { id: "fPBtw", hint: "Leeg = standaardtarief uit Bedrijfsgegevens." }) + '</div>' +
      '<div class="grid-2">' + K.c.field("Voorraad (optioneel)", K.c.input("pStock", { value: stockRow ? stockRow.quantity : "", attrs: ' inputmode="decimal"' }), { hint: D.config.voorraadAfboeken ? "Wordt bij vertrek automatisch afgeboekt." : "Wordt niet automatisch afgetrokken (instelbaar in Bedrijfsgegevens)." }) + K.c.field("Drempel", K.c.input("pLow", { value: stockRow ? stockRow.lowThreshold : "", attrs: ' inputmode="decimal"' }), {}) + '</div>' +
      K.c.field("Omschrijving voor de klant (optioneel)", '<textarea class="input" id="pDesc" rows="2" maxlength="400" placeholder="bv. Wilde zeebaars uit de Noordzee, gevangen met de lijn…">' + K.esc(v.omschrijving || "") + '</textarea>', { for: "pDesc", hint: "Verschijnt wanneer de klant het product openklapt." }) +
      '<label class="row-10 fs-13"><button type="button" class="toggle' + (v.actif ? " on" : "") + '" id="pActif" aria-pressed="' + (v.actif ? "true" : "false") + '"></button>Actief in de catalogus</label>' +
      '<div class="fbox" id="pFotoBox">' + (p ? "" : '<b>Foto\'s</b><p class="quiet fs-12 m-0">Sla het product eerst op, daarna kunt u tot ' + MAX_FOTOS + ' foto\'s toevoegen.</p>') + '</div>' + '<div id="pErr"></div>',
      footer: (p ? '<button type="button" class="btn btn-ghost t-danger mr-auto" id="pDel">Verwijderen</button>' : "") + '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="pOk">Opslaan</button>' });
    let actif = !!v.actif; const tg = pn.el.querySelector("#pActif"); tg.onclick = () => { actif = !actif; K.setOn(tg, actif); };
    // Verpakking : voorbeeld van wat de klant ziet (« doos van 6 = € 6,00 », prijs per stuk blijft).
    let enkel = !!v.enkel; const te = pn.el.querySelector("#pEnkel");
    const pakHint = () => { const g = id => pn.el.querySelector("#" + id).value.trim(), per = K.parseNum(g("pPer")), base = K.parseNum(g("pBase")), unit = g("pUnit"); const k = K.pakOf({ per, verpakking: g("pPak"), enkel }); pn.el.querySelector("#pPakHint").textContent = k ? "De klant ziet: " + K.eur(Number.isFinite(base) ? base : 0) + " / " + K.unit(unit) + " · " + K.pakOne(k, unit, "nl") + " = " + K.eur(window.FamoVat.r2((Number.isFinite(base) ? base : 0) * k.per)) + (enkel ? " · bestellen enkel per " + k.label : " · ook per stuk te bestellen") : (enkel ? "Vul eerst het aantal per verpakking in." : "Per verpakking leeg = per stuk verkocht. Bv. 6 en doos: de klant ziet de prijs per stuk en per doos."); };
    te.onclick = () => { enkel = !enkel; K.setOn(te, enkel); pakHint(); };
    ["pPer", "pPak", "pBase", "pUnit"].forEach(id => pn.el.querySelector("#" + id).addEventListener("input", pakHint)); pn.el.querySelector("#pUnit").addEventListener("change", pakHint); pakHint();
    pn.el.querySelector("[data-cancel]").onclick = pn.close;
    if (p) fotoManager(pn, p);
    const del = pn.el.querySelector("#pDel"); if (del) del.onclick = async () => {
      if (!(await K.confirm({ title: "„" + p.nom + "” verwijderen?", text: "Het product verdwijnt uit de catalogus, samen met zijn prijsafspraken en voorraadregel. Geleverde bestellingen blijven leesbaar. Enkel tijdelijk uit de catalogus? Zet het op inactief.", yes: "Verwijderen", danger: true }))) return;
      K.busy(del, true, "Verwijderen…");
      try { await post({ action: "deleteProduct", id: p.id }); pn.close(); K.toast("Product verwijderd"); render(); }
      catch (err) { pn.el.querySelector("#pErr").innerHTML = K.c.error(err.message); K.busy(del, false); }
    };
    pn.el.querySelector("#pOk").onclick = async () => {
      const val = id => pn.el.querySelector("#" + id).value.trim();
      const nom = val("pNom"), base = K.parseNum(val("pBase")), btw = K.numIn(val("pBtw")), btwN = Number(btw);
      K.setErr("fPNom", nom ? "" : "Verplicht."); K.setErr("fPBase", Number.isFinite(base) && val("pBase") !== "" ? "" : "Geef een prijs."); K.setErr("fPBtw", btw === "" || (Number.isFinite(btwN) && btwN >= 0 && btwN <= 100) ? "" : "0 tot 100."); if (!nom || !Number.isFinite(base) || val("pBase") === "" || (btw !== "" && !(Number.isFinite(btwN) && btwN >= 0 && btwN <= 100))) return;
      const btn = pn.el.querySelector("#pOk"); K.busy(btn, true, "Opslaan…");
      try { await post({ action: "saveProduct", id: p ? p.id : undefined, nom, cat: val("pCat"), unite: val("pUnit"), base, kaliber: val("pKal"), omschrijving: val("pDesc"), btwTarief: btw === "" ? "" : btwN, actif, perVerpakking: val("pPer"), verpakking: val("pPak"), enkelPerVerpakking: enkel, stock: val("pStock") === "" ? undefined : K.parseNum(val("pStock")), lowThreshold: val("pLow") === "" ? undefined : K.parseNum(val("pLow")) }); pn.close(); K.toast("Product opgeslagen"); render(); }
      catch (err) { if (err.status === 409) K.setErr("fPNom", "Die naam bestaat al."); if (/verpakking/i.test(err.message)) K.setErr("fPPer", err.message); pn.el.querySelector("#pErr").innerHTML = K.c.error(err.status === 409 ? "Er bestaat al een product met die naam. Kies een andere naam (of pas dat product aan)." : err.message); K.busy(btn, false); }
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
      '<div class="content pt-16"><p class="sub ws-normal m-0 mb-4">Sleep aan <span class="d-iflex va-m">' + K.icon("grip") + '</span> of gebruik ▲▼ om categorieën en producten te verplaatsen. Dit is ook de volgorde in de klantcatalogus en bij Invoeren.</p>' +
      '<div data-cat-list class="stack-12">' + cats.map(g => '<div class="grp ccat" data-cat="' + K.esc(g) + '"><div class="grp-h gap-6"><span class="grip cgrip" title="Categorie verslepen">' + K.icon("grip") + '</span>' + K.esc(g) + ' <small>' + groups[g].length + '</small>' + '<span class="mvbtns"><button type="button" class="ibtn" data-mvc="-1" aria-label="' + K.esc("Categorie " + g) + ' omhoog">▲</button><button type="button" class="ibtn" data-mvc="1" aria-label="' + K.esc("Categorie " + g) + ' omlaag">▼</button></span>' + '</div><div data-plist>' +
        groups[g].map(p => '<div class="prow" data-pid="' + K.esc(p.id) + '"><span class="grip pgrip" title="Product verslepen">' + K.icon("grip") + '</span>' + K.thumb(p.foto, "", "pthumb-28") + '<b class="ellipsis minw-0">' + K.esc(p.nom) + '</b><span class="quiet fs-125 nowrap">' + K.esc([p.kaliber, K.unit(p.unite)].filter(Boolean).join(" · ")) + '</span>' + (p.actif ? "" : '<span class="tag">inactief</span>') + '<span class="mvbtns"><button type="button" class="ibtn" data-mvp="-1" aria-label="' + K.esc(p.nom) + ' omhoog">▲</button><button type="button" class="ibtn" data-mvp="1" aria-label="' + K.esc(p.nom) + ' omlaag">▼</button></span>' + '</div>').join("") + '</div></div>').join("") + '</div></div>';
    // ▲▼ : même résultat que le glisser, au clic ou au clavier (WCAG 2.5.7) ; le focus reste sur le bouton.
    const shift = (el, dir, sel) => { const sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling; if (!sib || !sib.matches(sel)) return; el.parentNode.insertBefore(dir < 0 ? el : sib, dir < 0 ? sib : el); };
    K.on(page, "click", "[data-mvc]", (e, t) => { shift(t.closest(".ccat"), Number(t.dataset.mvc), ".ccat"); t.focus(); });
    K.on(page, "click", "[data-mvp]", (e, t) => { shift(t.closest(".prow"), Number(t.dataset.mvp), ".prow"); t.focus(); });
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
    page.innerHTML = head(all.filter(p => p.actif).length + " actief · " + all.filter(p => !p.actif).length + " inactief", '<button type="button" class="btn btn-o btn-sm" id="kalSort">Sorteer op kaliber</button><button type="button" class="btn btn-o btn-sm" id="orderMode">' + K.icon("grip") + 'Volgorde</button><button type="button" class="btn btn-p btn-sm" data-new-product>' + K.icon("plus") + 'Nieuw product</button>') +
      '<div class="content pt-16">' + Object.keys(groups).sort(K.catOrder(all, p => K.cat(p.cat))).map(g => '<div class="grp"><div class="grp-h blc-p">' + K.esc(g) + ' <small>' + groups[g].length + '</small></div><div class="tblwrap"><table class="tbl"><thead><tr><th>Product</th><th>Kaliber</th><th>Eenheid</th><th class="num">Basisprijs</th><th class="num">Btw</th><th>Afspraken</th><th>Actief</th><th></th></tr></thead><tbody>' + groups[g].map(p => '<tr class="row" data-p="' + p.id + '"><td class="wrap minw-200"><div class="row-10">' + K.thumb(p.foto, "", "pthumb-40") + '<div class="minw-0"><b>' + K.esc(p.nom) + '</b>' + ((p.fotos || []).length > 1 ? '<div class="quiet fs-12">' + p.fotos.length + ' foto\'s</div>' : "") + '</div></div></td><td>' + K.esc(p.kaliber || "—") + '</td><td>' + K.esc(K.unit(p.unite)) + (K.pakOf(p) ? '<div class="quiet fs-12 nowrap">' + K.esc(K.pakOne(K.pakOf(p), p.unite, "nl") + (K.pakOf(p).only ? " · enkel" : "")) + '</div>' : "") + '</td><td class="num mono">' + K.eur(p.base) + '</td><td class="num mono' + (p.btwTarief == null ? " muted" : "") + '">' + K.num(p.btwTarief == null ? D.config.btwTarief : p.btwTarief) + ' %</td><td class="muted">' + (nAfsp(p.id) ? nAfsp(p.id) + " klant" + (nAfsp(p.id) === 1 ? "" : "en") : "—") + '</td><td class="w-110">' + (p.actif ? '<span class="cell-st c-done">Actief</span>' : '<span class="cell-st c-inv">Inactief</span>') + '</td><td class="ta-r"><button type="button" class="btn btn-o btn-sm" data-p-edit="' + p.id + '">Bewerken</button></td></tr>').join("") + '</tbody></table></div></div>').join("") + (all.length ? "" : K.c.empty("Nog geen producten", "Maak het eerste product aan.")) + '</div>';
    page.querySelector("#orderMode").onclick = () => { orderMode = true; render(); };
    // Spec 018 : per categorie dezelfde namen naast elkaar, kaliber oplopend (K.kaliberOrder) ; bewaard via reorderProducts.
    page.querySelector("#kalSort").onclick = async (e) => {
      const btn = e.currentTarget, cur = Object.keys(groups).sort(K.catOrder(all, p => K.cat(p.cat))).flatMap(g => groups[g].map(p => p.id)), order = K.kaliberOrder(all);
      const moved = order.filter((id, i) => cur[i] !== id).length;
      if (!moved) { K.toast("De producten staan al op kaliber."); return; }
      if (!(await K.confirm({ title: "Sorteren op kaliber?", text: "Binnen elke categorie komen producten met dezelfde naam naast elkaar, van klein naar groot kaliber (U10, 8/12, 13/15, 16/20, 21/25…). Een kaliber in de naam telt ook (\u201eScampi 16/20\u201d). De volgorde van de categorie\u00ebn en van de verschillende namen blijft. Dit wordt ook de volgorde in de klantcatalogus en bij Invoeren. " + moved + " product" + (moved === 1 ? " verschuift" : "en verschuiven") + ".", yes: "Sorteren" }))) return;
      K.busy(btn, true, "Sorteren…");
      try { const d = await post({ action: "reorderProducts", order }); render(); K.toast("Gesorteerd op kaliber (" + d.changed + " product" + (d.changed === 1 ? "" : "en") + " bewaard)"); }
      catch (err) { K.toast(err.message, { kind: "err" }); K.busy(btn, false); }
    };
    K.on(page, "click", "[data-p-edit]", (e, t) => { e.stopPropagation(); productPanel(all.find(p => p.id === t.dataset.pEdit)); });
    K.on(page, "click", "tr[data-p]", (e, t) => { if (e.target.closest("button")) return; productPanel(all.find(p => p.id === t.dataset.p)); });
  }

  /* ---------- prijzen (matrix) ---------- */
  function prijzen() {
    const prods = (D.products || []).filter(p => p.actif), cls = (D.clients || []).filter(c => !c.gearchiveerd);
    const changed = new Map();
    page.innerHTML = head("Afgesproken prijzen per klant en product · leeg = basisprijs · Enter = opslaan", '<button type="button" class="btn btn-p btn-sm" id="saveAll" data-save-prices disabled>Wijzigingen opslaan</button>') +
      '<div class="content pt-16"><div class="grp"><div class="tblwrap"><table class="tbl"><thead><tr><th class="minw-200">Product</th><th class="num">Basis</th>' + cls.map(c => '<th class="num minw-120">' + K.esc(c.nom) + '</th>').join("") + '</tr></thead><tbody>' + prods.map(p => '<tr><td><b>' + K.esc(p.nom) + '</b><div class="quiet fs-11">' + K.esc(K.unit(p.unite)) + '</div></td><td class="num mono muted">' + K.eur(p.base) + '</td>' + cls.map(c => { const pr = priceOf(c.id, p.id); return '<td class="num"><input class="input mono mh-38 ta-r w-110 px-8' + (pr && pr.prix != null && pr.prix < p.base ? " t-done-ink fw-600" : "") + '" data-m="' + c.id + '|' + p.id + '" inputmode="decimal" value="' + (pr && pr.prix != null ? String(pr.prix).replace(".", ",") : "") + '" placeholder="—" aria-label="' + K.esc(p.nom) + ' · ' + K.esc(c.nom) + '"></td>'; }).join("") + '</tr>').join("") + '</tbody></table></div></div><div class="d-flex jc-sb ai-c gap-12 f-wrap"><p class="quiet fs-125 m-0">Een leeg vak = de klant betaalt de basisprijs. 0 is een geldige prijs. Wijzigingen gelden vanaf de volgende bestelling.</p><button type="button" class="btn btn-p btn-sm" data-save-prices disabled>Wijzigingen opslaan</button></div></div>';
    // G-17 : le bouton existe aussi sous la grille ; Entrée dans une case enregistre.
    const saveBtns = () => K.$$("[data-save-prices]", page);
    const saveAll = async b => {
      if (!changed.size) return; K.busy(b, true, "Opslaan…"); let fail = 0;
      const byClient = {}; changed.forEach((v, k) => { const [cid, pid] = k.split("|"); (byClient[cid] = byClient[cid] || []).push({ productId: pid, prix: K.numIn(v) }); });
      for (const cid of Object.keys(byClient)) { try { const d = await post({ action: "saveClientPrices", clientId: cid, prices: byClient[cid] }); fail += (d.results || []).filter(r => !r.ok).length; } catch (err) { fail++; } }
      K.toast(fail ? K.plural(fail, "prijs", "prijzen") + " niet opgeslagen" : "Prijzen opgeslagen", { kind: fail ? "err" : "" }); render();
    };
    K.on(page, "input", "[data-m]", (e, t) => { changed.set(t.dataset.m, t.value); saveBtns().forEach(b => { b.disabled = false; b.textContent = "Wijzigingen opslaan (" + changed.size + ")"; }); });
    K.on(page, "keydown", "[data-m]", e => { if (e.key === "Enter" && !e.isComposing && changed.size) { e.preventDefault(); saveAll(saveBtns()[0]); } });
    saveBtns().forEach(b => { b.onclick = () => saveAll(b); });
  }

  /* ---------- journaal ---------- */
  // Rapportage (spec 022) : page à part, /beheer/rapportage (barre latérale) ; l'ancien lien #/rapportage y mène.
  let rapCache = null;
  // EDI-06 : journal global — toutes les corrections, paiements, creditnota's et exceptions (champ Correcties),
  // du plus récent au plus ancien, avec lien vers la commande. Format d'une ligne : « jj/mm/aaaa hh:mm · action · qui — raison ».
  let jq = "";
  async function journaal() {
    page.innerHTML = head("Wie wijzigde wat, en wanneer · correcties, betalingen, creditnota's en uitzonderingen") + '<div class="content pt-16">' + K.c.skeleton(3) + '</div>';
    if (!rapCache) { try { rapCache = await K.api("/api/allorders?all=1"); } catch (err) { page.querySelector(".content").innerHTML = K.c.error(err.message, true); K.on(page, "click", "[data-retry]", e => { e.preventDefault(); rapCache = null; render(); }); return; } }
    const rows = [];
    (rapCache.orders || []).forEach(o => String(o.correcties || "").split("\n").map(x => x.trim()).filter(Boolean).forEach(line => {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s*·\s*(.*?)\s*·\s*(.*?)(?:\s+—\s+(.*))?$/.exec(line);
      rows.push(m ? { at: m[3] + "-" + m[2] + "-" + m[1] + "T" + m[4] + ":" + m[5], when: m[1] + "/" + m[2] + "/" + m[3] + " " + m[4] + ":" + m[5], wat: m[6], wie: m[7], reden: m[8] || "", o } : { at: "", when: "", wat: line, wie: "", reden: "", o });
    }));
    // Journal d'audit (api/journaal, ajout seul) : prix, configuratie, klanten, codes, bestellingen — voor → na.
    try {
      const j = await K.api("/api/journaal?limit=1000");
      (j.rows || []).forEach(e => {
        const d = new Date(e.Tijdstip), p = n => String(n).padStart(2, "0");
        const when = Number.isNaN(d.getTime()) ? "" : p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
        const wijz = (e.Wijzigingen || []).slice(0, 6).map(w => w.veld + ": " + (w.voor || "—") + " → " + (w.na || "—")).join(" · ");
        rows.push({ at: String(e.Tijdstip || "").slice(0, 16), when, wat: e.Actie + (wijz ? " — " + wijz : ""), wie: e.Wie, reden: e.Reden || "", o: e.Object === "Commandes" ? { id: e.Record, ref: e.Referentie, client: "" } : { id: "", ref: e.Referentie || e.Object, client: e.Object } });
      });
    } catch (err) { /* journal indisponible (Airtable) : les correcties des bestellingen restent affichées */ }
    rows.sort((a, b) => b.at.localeCompare(a.at));
    const show = () => {
      const t = jq.toLowerCase(), list = rows.filter(r => !t || (r.wat + " " + r.wie + " " + r.reden + " " + r.o.ref + " " + r.o.client).toLowerCase().includes(t));
      page.querySelector("#jlist").innerHTML = list.length ? '<div class="tblwrap"><table class="tbl"><caption class="sr-only">Journaal</caption><thead><tr><th scope="col">Wanneer</th><th scope="col">Bestelling</th><th scope="col">Klant</th><th scope="col">Actie</th><th scope="col">Door</th><th scope="col">Reden</th></tr></thead><tbody>' +
        list.slice(0, 500).map(r => '<tr><td class="mono nowrap">' + K.esc(r.when || "—") + '</td><td class="mono">' + (r.o.id ? '<a class="tlink" href="/team/bestelling?id=' + encodeURIComponent(r.o.id) + '">' + K.esc(r.o.ref) + '</a>' : K.esc(r.o.ref || "—")) + '</td><td>' + K.esc(r.o.client || "") + '</td><td class="wrap">' + K.esc(r.wat) + '</td><td>' + K.esc(r.wie || "—") + '</td><td class="wrap muted">' + K.esc(r.reden || "") + '</td></tr>').join("") + '</tbody></table></div>' + (list.length > 500 ? '<p class="quiet fs-12">De 500 recentste van ' + list.length + ' regels. Verfijn met het zoekveld.</p>' : "")
        : K.c.empty(rows.length ? "Niets gevonden" : "Nog geen wijzigingen", rows.length ? "Probeer een ander woord." : "Correcties, betalingen en creditnota's verschijnen hier.");
    };
    page.querySelector(".content").innerHTML = '<div class="card"><div class="card-h gap-10 f-wrap"><label class="search fx-240 maxw-420">' + K.icon("search") + '<input id="jq" aria-label="Journaal doorzoeken" placeholder="Bestelling, klant, actie of medewerker…" value="' + K.esc(jq) + '"></label><span class="quiet fs-125">' + rows.length + ' regel' + (rows.length === 1 ? "" : "s") + '</span></div><div id="jlist"></div></div>';
    show();
    const qi = page.querySelector("#jq"); qi.addEventListener("input", K.debounce(() => { jq = qi.value.trim(); show(); }, 150));
  }
  /* ---------- bedrijf ---------- */
  function bedrijf() {
    const c = D.config, lev = c.levering || {}, dagen = lev.leverdagen || ["ma", "di", "wo", "do", "vr", "za"], lg = c.legal || {};
    const f = (label, id, val, extra, opts) => K.c.field(label, K.c.input(id, Object.assign({ value: val == null ? "" : val }, extra || {})), Object.assign({ id: "f_" + id }, opts || {}));
    page.innerHTML = head("Verschijnt op facturen, leveringsbonnen en e-mails", '<button type="button" class="btn btn-o btn-sm" id="preview">Voorbeeldfactuur</button><button type="button" class="btn btn-p btn-sm" id="save">Opslaan</button>') +
      '<div class="content masonry pt-16" id="two">' +
      '<div class="card card-b stack-12"><h2 class="h2">Identiteit</h2>' + f("Handelsnaam (op documenten)", "bedrijfsnaam", c.bedrijfsnaam) + '<div class="grid-2">' + f("Juridische naam", "juridischeNaam", lg.naam, { placeholder: "Famo Trading" }, { hint: "Zoals in de KBO." }) + f("Rechtsvorm", "rechtsvorm", lg.rechtsvorm, { placeholder: "BV" }) + '</div>' + f("RPR (rechtbank en afdeling)", "rpr", lg.rpr, { placeholder: "RPR Antwerpen, afdeling Antwerpen" }, { hint: "Verplichte vermelding (WVV art. 2:20) op documenten en website." }) + '<div class="grid-2">' + f("Adres", "adres", c.adres) + f("Postcode en plaats", "plaats", c.plaats) + f("BTW-nummer", "btw", c.btw) + f("BTW-tarief (%)", "btwTarief", c.btwTarief, { attrs: ' inputmode="decimal"' }, { hint: "Standaard; per product instelbaar." }) + f("Telefoon", "telefoon", c.telefoon, { type: "tel" }) + f("E-mail (op documenten)", "email", c.email, { type: "email" }) + '</div></div>' +
      '<div class="card card-b stack-12"><h2 class="h2">Facturatie</h2>' + K.c.field("Wie maakt de factuur?", '<select class="input" id="facturatie"><option value="Boekhouder"' + (c.facturatie !== "portaal" ? " selected" : "") + '>De boekhouder (Billtobox / Peppol) — portaal maakt pro forma</option><option value="Portaal"' + (c.facturatie === "portaal" ? " selected" : "") + '>Het portaal (factuur FA-… en UBL voor Peppol)</option></select>', { id: "f_facturatie", hint: "Nooit twee facturen voor dezelfde levering: kies Portaal enkel als de boekhouder de UBL van het portaal verstuurt." }) +
      '<label class="row-10 fs-13">' + K.c.check(!!c.herinneringen, 'id="herinneringen" aria-label="Automatische betalingsherinneringen"') + '<span>Automatische betalingsherinneringen<span class="quiet fs-12 d-block">Enkel met Portaal. E-mail aan de klant 3 en 17 dagen na de vervaldatum, in zijn taal. Met Boekhouder volgt de boekhouder de betalingen op.</span></span></label>' + ((c.legalMissing || []).length ? K.c.warn("<b>Wettelijke vermeldingen ontbreken:</b> " + K.esc(c.legalMissing.join(", ")) + ".") : "") + '</div>' +
      '<div class="card card-b stack-12"><h2 class="h2">Bank &amp; voorwaarden</h2>' + (D.status.ibanOntbreekt ? K.c.warn("<b>IBAN ontbreekt.</b> Zolang dit leeg is, tonen facturen voorbeeldbankgegevens.") : "") + '<div class="d-grid gc-2-1 gap-10">' + f("IBAN", "iban", c.iban, { placeholder: "BE00 0000 0000 0000" }) + f("BIC", "bic", c.bic) + '</div><div class="d-grid gc-2-1 gap-10">' + f("Betalingsvoorwaarden (onder de factuur)", "betalingsvoorwaarden", c.betalingsvoorwaarden, { placeholder: "bv. Betaalbaar binnen 14 dagen…" }) + f("Betaaltermijn (dagen)", "betaaltermijnDagen", c.betaaltermijnDagen, { type: "number", attrs: ' min="0" max="120" inputmode="numeric"' }, { hint: "Vervaldatum op de factuur." }) + '</div>' + K.c.field("Leveringsvoorwaarden (onder de leveringsbon)", '<textarea class="input" id="leveringsvoorwaarden" rows="3">' + K.esc(c.leveringsvoorwaarden || "") + '</textarea>', {}) + '</div>' +
      '<div class="card card-b stack-12"><h2 class="h2">Bestellen &amp; leveren</h2><div class="grid-2">' + f("Besteldeadline (UU:MM)", "besteldeadline", c.besteldeadline || lev.deadline || "22:00", { placeholder: "22:00", attrs: ' inputmode="numeric" maxlength="5"' }, { hint: "Vóór dit uur besteld = morgen geleverd." }) + f("Minimum bestelling (€ excl. btw)", "minimumBestelling", c.minimumBestelling ? String(c.minimumBestelling).replace(".", ",") : "", { placeholder: "0 = geen minimum", attrs: ' inputmode="decimal"' }) + '</div>' +
      K.c.field("Leverdagen", '<div class="opt gap-6" id="dagen">' + DAGEN.map(([k, l]) => '<button type="button" data-dag="' + k + '"' + (dagen.includes(k) ? ' class="on flex-1 minw-44 px-6" aria-pressed="true"' : ' class="flex-1 minw-44 px-6" aria-pressed="false"') + ' title="' + l + '">' + k + '</button>').join("") + '</div>', { id: "f_leverdagen" }) +
      K.c.field("Gesloten dagen (één datum per regel, JJJJ-MM-DD)", '<textarea class="input ff-inherit" id="geslotenDagen" rows="3" placeholder="2026-12-25\n2027-01-01">' + K.esc(c.geslotenDagen || "") + '</textarea>', { id: "f_geslotenDagen", hint: "Feestdagen en verlof: op die dagen kan niemand een levering kiezen." }) +
      '<label class="row-10 fs-13">' + K.c.check(!!c.voorraadAfboeken, 'id="afboeken" aria-label="Voorraad automatisch afboeken bij vertrek"') + '<span>Voorraad automatisch afboeken bij vertrek<span class="quiet fs-12 d-block">Enkel aanzetten als de telling in Voorraad klopt.</span></span></label>' +
      '<label class="row-10 fs-13">' + K.c.check(!!c.lotsVerplicht, 'id="lotsVerplicht" aria-label="Lot verplicht bij klaarzetten"') + '<span>Lot verplicht bij klaarzetten<span class="quiet fs-12 d-block">Elk artikel krijgt een lot (traceerbaarheid) vóór „Klaar”. Loten beheert u in Voorraad → Loten.</span></span></label></div>' +
      '<div class="card card-b stack-12"><h2 class="h2">E-mail</h2>' + f("Interne postbus (melding bij elke bestelling)", "bestellingenEmail", c.bestellingenEmail, { type: "email" }) + '<div class="notice fs-125"><div>' + (D.status.mailEnabled ? "E-mail is actief. " : "<b>E-mail is niet actief</b> (RESEND_API_KEY ontbreekt op Vercel). ") + (c.mailFromConfigured ? "Afzender (MAIL_FROM) is ingesteld op Vercel." : "<b>Afzender (MAIL_FROM) ontbreekt op Vercel</b>: mails vertrekken enkel naar de eigenaar van het Resend-account.") + '</div></div></div>' +
      mailCard(c, f) +
      termsCard(c) +
      '<div id="bErr" class="span-all"></div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    termsWire();
    mailWire();
    K.on(page, "click", "[data-dag]", (e, t) => { const on = !t.classList.contains("on"); t.classList.toggle("on", on); t.setAttribute("aria-pressed", on ? "true" : "false"); });
    const af = page.querySelector("#afboeken"); af.onclick = () => K.setOn(af, !af.classList.contains("on"));
    ["lotsVerplicht", "herinneringen"].forEach(id => { const el = page.querySelector("#" + id); el.onclick = () => K.setOn(el, !el.classList.contains("on")); });
    page.querySelector("#preview").onclick = async () => { try { await K.docs(); } catch (e) { K.toast(e.message, { kind: "err" }); return; } const cfg = collect(); FamoDocuments.setCompany(cfg); const sample = { ref: "CMD-2026-0001", client: "Voorbeeldklant", klant: { adresse: "Straat 1, 2000 Antwerpen", btw: "BE 0000.000.000", klantnr: "K-000" }, lignes: "Vannamei garnalen 16/20 × 2 caisse [€9.50]\nZalmfilet × 1 kg [€20.20]", total: 39.2, factuurnummer: "FA-2026-0000", paiement: "En attente", dateLiv: K.today() }; famoDocPreview.open({ html: FamoDocuments.build(sample, "invoice"), filename: "Famo-Voorbeeldfactuur.pdf", title: "Voorbeeldfactuur", meta: "met de gegevens zoals nu ingevuld" }); };
    function collect() { const v = id => page.querySelector("#" + id).value.trim(); const d = v("btw").replace(/\D/g, ""); return { facturatie: v("facturatie"), juridischeNaam: v("juridischeNaam"), rechtsvorm: v("rechtsvorm"), rpr: v("rpr"), legal: { naam: v("juridischeNaam"), rechtsvorm: v("rechtsvorm"), rpr: v("rpr"), handelsnaam: v("bedrijfsnaam"), ondernemingsnummer: d.length === 10 ? d.slice(0, 4) + "." + d.slice(4, 7) + "." + d.slice(7) : "" }, bedrijfsnaam: v("bedrijfsnaam"), adres: v("adres"), plaats: v("plaats"), btw: v("btw"), btwTarief: K.parseNum(v("btwTarief")), telefoon: v("telefoon"), email: v("email"), iban: v("iban"), bic: v("bic"), betalingsvoorwaarden: v("betalingsvoorwaarden"), leveringsvoorwaarden: v("leveringsvoorwaarden"), bestellingenEmail: v("bestellingenEmail"), besteldeadline: v("besteldeadline"), leverdagen: K.$$("[data-dag].on", page).map(b => b.dataset.dag).join(","), geslotenDagen: v("geslotenDagen"), minimumBestelling: K.numIn(v("minimumBestelling")), betaaltermijnDagen: v("betaaltermijnDagen") === "" ? "" : Number(v("betaaltermijnDagen")), voorraadAfboeken: af.classList.contains("on"), lotsVerplicht: page.querySelector("#lotsVerplicht").classList.contains("on"), herinneringen: page.querySelector("#herinneringen").classList.contains("on") }; }
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

  // Bestellen per e-mail (specs/020) : adres voor de klanten, sleutels aanwezig (ja/nee, nooit de waarde),
  // schakelaar « automatisch aanmaken » (uit = alles naar Bestellingen → Te controleren). Eigen knop.
  function mailCard(c, f) {
    const m = c.mailBestellingen || {};
    const keys = [[m.webhookGeheim, "Webhook-geheim (RESEND_INBOUND_SECRET)"], [m.resendSleutel, "Resend-sleutel (RESEND_API_KEY)"], [m.aiSleutel, "AI-sleutel (ANTHROPIC_API_KEY)"]];
    return '<div class="card card-b stack-12"><h2 class="h2">Bestellen per e-mail</h2><p class="sub ws-normal">Klanten mailen hun bestelling naar dit adres. Het portaal leest de mail en maakt de bestelling aan als alles zeker is; anders komt ze in Bestellingen → Te controleren.</p>' +
      f("Adres voor bestellingen", "mbAdres", m.adres, { type: "email", attrs: ' autocomplete="off"' }, { hint: "Geef dit adres aan uw klanten. Enkel mails van e-mailadressen uit de klantfiches worden verwerkt." }) +
      '<ul class="mb-keys">' + keys.map(([ok, l]) => '<li>' + (ok ? '<span class="chip st-done"><i></i>Ingesteld</span>' : '<span class="chip st-late"><i></i>Ontbreekt</span>') + '<span>' + K.esc(l) + '</span></li>').join("") + '</ul>' +
      (!m.webhookGeheim ? K.c.warn("<b>Zonder RESEND_INBOUND_SECRET weigert het portaal elke inkomende mail.</b> Instellen: zie de handleiding (RUNBOOK, bestellen per e-mail).") : !m.aiSleutel ? K.c.warn("Zonder ANTHROPIC_API_KEY komt elke mail in Te controleren (niets gaat verloren).") : "") +
      '<label class="row-10 fs-13">' + K.c.check(!!m.automatisch, 'id="mbAuto" aria-label="Bestellingen per e-mail automatisch aanmaken"') + '<span>Bestellingen per e-mail automatisch aanmaken<span class="quiet fs-12 d-block">Uit: elke mail komt eerst in Te controleren. Aan: enkel zekere bestellingen van gekende klanten worden meteen aangemaakt (Ontvangen) en de klant krijgt een bevestiging; u zet ze klaar zoals altijd.</span></span></label>' +
      '<div><button type="button" class="btn btn-o btn-sm" id="mbSave">E-mailbestellingen bewaren</button></div></div>';
  }
  function mailWire() {
    const auto = page.querySelector("#mbAuto"), save = page.querySelector("#mbSave");
    if (!auto || !save) return;
    auto.onclick = () => K.setOn(auto, !auto.classList.contains("on"));
    save.onclick = async () => {
      K.setErr("f_mbAdres", ""); K.busy(save, true, "Bewaren…");
      try { await post({ action: "saveMailBestellingen", adres: page.querySelector("#mbAdres").value.trim(), automatisch: auto.classList.contains("on") }); K.toast("E-mailbestellingen bewaard"); render(); }
      catch (err) { K.setErr("f_mbAdres", err.message); K.busy(save, false); }
    };
  }

  // Conditions générales (C-12) : texte NL/FR ; « Publiceren » crée une version que chaque client
  // accepte avant sa commande suivante (api/order.js refuse sinon).
  function termsCard(c) {
    const v = c.voorwaarden || { versie: "", nl: "", fr: "" }, act = (D.clients || []).filter(x => !x.gearchiveerd), ok = v.versie ? act.filter(x => x.voorwaardenVersie === v.versie).length : 0;
    const ta = (id, label, val) => K.c.field(label, '<textarea class="input ff-inherit" id="' + id + '" rows="8" maxlength="20000">' + K.esc(val || "") + '</textarea>', { id: "f_" + id });
    return '<div class="card card-b stack-12"><h2 class="h2">Algemene voorwaarden</h2>' +
      (v.versie ? '<p class="sub ws-normal m-0">Versie <b>' + K.esc(v.versie) + '</b> · ' + ok + ' van ' + act.length + ' klanten aanvaard · <a class="tlink" href="/voorwaarden" target="_blank" rel="noopener">bekijken</a></p>' : K.c.warn("Nog geen voorwaarden gepubliceerd: klanten moeten niets aanvaarden. Laat de tekst nakijken door uw juridisch adviseur.")) +
      ta("vwNl", "Tekst (Nederlands)", v.nl) + ta("vwFr", "Texte (français)", v.fr) +
      '<p class="quiet fs-12 m-0">Lege regel = nieuwe alinea · een regel die met „# ” begint = tussentitel. Publiceren = nieuwe versie: elke klant aanvaardt ze vóór zijn volgende bestelling.</p>' +
      '<div class="d-flex gap-8 f-wrap"><button type="button" class="btn btn-o btn-sm" id="vwSave">Tekst opslaan</button><button type="button" class="btn btn-p btn-sm" id="vwPub">Publiceren als nieuwe versie</button></div></div>';
  }
  function termsWire() {
    const send = async (publish, b) => {
      const nl = page.querySelector("#vwNl").value, fr = page.querySelector("#vwFr").value;
      if (publish && !(await K.confirm({ title: "Nieuwe versie publiceren?", text: "Elke klant moet deze voorwaarden aanvaarden vóór zijn volgende bestelling.", yes: "Publiceren" }))) return;
      K.busy(b, true, "Opslaan…");
      try { await post({ action: "saveVoorwaarden", nl, fr, publish }); K.toast(publish ? "Nieuwe versie gepubliceerd" : "Tekst opgeslagen"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(b, false); }
    };
    const s = page.querySelector("#vwSave"), p = page.querySelector("#vwPub");
    if (s) s.onclick = () => send(false, s);
    if (p) p.onclick = () => send(true, p);
  }

  /* ---------- toegang ---------- */
  function medewerkerPanel(m) {
    const v = Object.assign({ naam: "", rol: "personeel", actief: true }, m || {});
    const p = K.panel({ title: m ? m.naam : "Nieuwe medewerker", sub: m ? "Medewerker bewerken" : "Persoonlijke PIN: aanmelden op naam", body:
      K.c.field("Naam", K.c.input("mNaam", { value: v.naam, placeholder: "bv. Karim…" }), { id: "fMNaam", req: true }) +
      '<div class="grid-2">' + K.c.field("Rol", '<select class="input" id="mRol">' + [["personeel", "Personeel"], ["beheerder", "Beheerder"]].map(([k, l]) => '<option value="' + k + '"' + (v.rol === k ? " selected" : "") + '>' + l + '</option>').join("") + '</select>', { hint: "Beheerder: ook Beheer, Invoeren en Voorraad." }) + K.c.field(m ? "Nieuwe PIN (leeg = ongewijzigd)" : "PIN", K.c.input("mPin", { type: "password", attrs: ' inputmode="numeric" autocomplete="new-password"' }), { id: "fMPin", req: !m, hint: "6 tot 12 cijfers, uniek per medewerker. Wordt versleuteld bewaard." }) + '</div>' +
      '<label class="row-10 fs-13">' + K.c.check(!!v.actief, 'id="mActief"') + 'Actief (kan aanmelden)</label><div id="mErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="mOk">Opslaan</button>' });
    let actief = !!v.actief; const a = p.el.querySelector("#mActief"); a.onclick = () => { actief = !actief; K.setOn(a, actief); };
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#mOk").onclick = async () => {
      const naam = p.el.querySelector("#mNaam").value.trim(), pin = p.el.querySelector("#mPin").value, rol = p.el.querySelector("#mRol").value;
      K.setErr("fMNaam", naam ? "" : "Verplicht."); K.setErr("fMPin", (!m && !pin) || (pin && !/^\d{6,12}$/.test(pin)) ? "PIN: 6 tot 12 cijfers." : ""); if (!naam || (!m && !pin) || (pin && !/^\d{6,12}$/.test(pin))) return;
      const b = p.el.querySelector("#mOk"); K.busy(b, true, "Opslaan…");
      try { await post({ action: "saveMedewerker", id: m ? m.id : undefined, naam, rol, pin: pin || undefined, actief }); p.close(); K.toast("Medewerker opgeslagen"); render(); }
      catch (err) { p.el.querySelector("#mErr").innerHTML = K.c.error(err.message); K.busy(b, false); }
    };
  }
  function toegang() {
    const c = D.config, mw = D.medewerkers || [];
    const codeCard = (which, title, sub, custom) => '<div class="card card-b stack-10"><div class="row-10">' + K.c.avatar(title) + '<div><h2 class="h2">' + title + '</h2><p class="sub ws-normal">' + sub + '</p></div></div><div>' + (custom ? '<span class="chip st-done"><i></i>Eigen code ingesteld</span>' : '<span class="chip st-new"><i></i>Code uit Vercel (' + (which === "admin" ? "ADMIN_CODE" : "STAFF_CODE") + ')</span>') + (c.enkelPin ? ' ' + (which === "admin" && !custom ? '<span class="chip st-late" title="ADMIN_CODE opent Beheer enkel nog als noodtoegang, via de aanmelding van Beheer. Elk gebruik wordt gelogd."><i></i>Enkel noodtoegang</span>' : '<span class="chip st-inv"><i></i>Uitgeschakeld</span>') : "") + '</div>' + K.c.field("Nieuwe code (minstens 10 tekens)", K.c.input("code_" + which, { type: "password", attrs: ' autocomplete="new-password"' }), { id: "f_code_" + which }) + '<div class="d-flex gap-8"><button type="button" class="btn btn-p btn-sm" data-setcode="' + which + '">Code instellen</button>' + (custom ? '<button type="button" class="btn btn-ghost btn-sm" data-resetcode="' + which + '">Terug naar Vercel-code</button>' : "") + '</div></div>';
    // Audit L-06 : enkel persoonlijke PIN's (codes partagés refusés par api/session.js). Le serveur
    // refuse l'activation sans beheerder PIN active (409) ; ici on prévient seulement.
    const bhPin = mw.filter(m => m.actief && m.rol === "beheerder").length;
    const enkelCard = '<div class="card card-b col mt-16"><h2 class="h2">Enkel persoonlijke pincodes</h2>' +
      '<div>' + (c.enkelPin ? '<span class="chip st-done"><i></i>Aan</span>' : '<span class="chip st-new"><i></i>Uit</span>') + '</div>' +
      '<p class="sub">' + (c.enkelPin ? "De teamcodes werken niet meer: iedereen meldt aan met een eigen PIN, dus elke actie staat op naam in het logboek. Noodtoegang: de ADMIN_CODE uit Vercel via de aanmelding van Beheer, als er geen eigen beheerderscode is ingesteld (elk gebruik wordt gelogd)." : "Teamcodes en persoonlijke PIN's werken nu allebei. Zet dit aan zodra iedereen een eigen PIN heeft: de teamcodes werken dan niet meer en elke actie staat op naam in het logboek.") + '</p>' +
      (!c.enkelPin && !bhPin ? K.c.warn("<b>Eerst nodig:</b> een actieve medewerker met rol Beheerder. Anders kan niemand Beheer nog openen.") : "") +
      '<div class="acts"><button type="button" class="btn ' + (c.enkelPin ? "btn-o" : "btn-p") + ' btn-sm" id="enkelPin">' + (c.enkelPin ? "Uitzetten" : "Aanzetten") + '</button></div></div>';
    page.innerHTML = head("Wie kan wat · codes, medewerkers en klantaccounts") + '<div class="content pt-16">' + (!c.enkelPin && !c.adminCodeCustom && !c.staffCodeCustom ? K.c.warn("<b>Zolang beide codes uit Vercel komen en gelijk zijn, kan personeel in Beheer.</b> Stel hieronder minstens de personeelscode apart in.") : "") + '<div class="d-grid duo-2 gap-16" id="two">' + codeCard("admin", "Beheerder", "Alles: klanten, prijzen, documenten, instellingen.", c.adminCodeCustom) + codeCard("staff", "Personeel", "Bestellingen, Magazijn, Leveringen, Documenten.", c.staffCodeCustom) + '</div>' +
      '<div class="card mt-16"><div class="card-h"><div><h2 class="h2">Medewerkers <small class="quiet fw-400">' + mw.filter(m => m.actief).length + ' actief</small></h2><p class="sub ws-normal">Persoonlijke PIN: aanmelden op naam, zichtbaar in het logboek van correcties. ' + (c.enkelPin ? "De teamcodes hierboven zijn uitgeschakeld." : "De teamcodes hierboven blijven werken.") + '</p></div><button type="button" class="btn btn-p btn-sm" data-new-mw>' + K.icon("plus") + 'Medewerker</button></div>' +
      (mw.length ? '<div class="tblwrap"><table class="tbl"><thead><tr><th>Naam</th><th>Rol</th><th>Actief</th><th>Laatste aanmelding</th><th></th></tr></thead><tbody>' + mw.map(m => '<tr><td><div class="row-10">' + K.c.avatar(m.naam) + '<b>' + K.esc(m.naam) + '</b></div></td><td>' + (m.rol === "beheerder" ? "Beheerder" : "Personeel") + '</td><td class="w-110">' + (m.actief ? '<span class="cell-st c-done">Actief</span>' : '<span class="cell-st c-inv">Inactief</span>') + '</td><td class="muted">' + K.esc(dateTime(m.laatste)) + '</td><td class="actions"><button type="button" class="btn btn-ghost btn-sm t-danger" data-mw-del="' + m.id + '">Verwijderen</button> <button type="button" class="btn btn-o btn-sm" data-mw-edit="' + m.id + '">Bewerken</button></td></tr>').join("") + '</tbody></table></div>' : '<div class="empty m-12">Nog geen medewerkers. Zonder medewerkers meldt iedereen aan met de teamcode en staat „personeel” in het logboek.</div>') + '</div>' +
      enkelCard +
      '<div class="card card-b mt-16"><h2 class="h2">Klanten</h2><p class="sub ws-normal">' + D.status.credentials + ' van ' + D.status.clients + ' klanten hebben een gebruikersnaam en wachtwoord. Wachtwoorden beheert u per klant (Klanten → Nieuw wachtwoord). Na 10 foute pogingen op rij wordt een klantaccount 15 minuten geblokkeerd.</p><a class="btn btn-o btn-sm mt-8" href="#/klanten">Naar klanten</a></div>' +
      '<div class="card card-b mt-16"><h2 class="h2">Iedereen afmelden</h2><p class="sub ws-normal">Toestel kwijt of code uitgelekt? Alle personeels- en beheersessies worden meteen ongeldig (binnen 1 minuut op elke server), ook de uwe. Klanten blijven aangemeld.</p><button type="button" class="btn btn-o btn-sm mt-8" id="logoutAll">Iedereen afmelden</button></div><div id="tErr"></div></div>';
    if (window.innerWidth < 900) page.querySelector("#two").style.gridTemplateColumns = "1fr";
    K.on(page, "click", "[data-setcode]", async (e, t) => { const which = t.dataset.setcode, code = page.querySelector("#code_" + which).value; K.setErr("f_code_" + which, code.length >= 10 ? "" : "Minstens 10 tekens."); if (code.length < 10) return; if (!(await K.confirm({ title: "Code voor " + (which === "admin" ? "beheerder" : "personeel") + " wijzigen?", text: "De oude code werkt meteen niet meer. Geef de nieuwe door aan wie ze nodig heeft.", yes: "Wijzigen" }))) return; K.busy(t, true, "Opslaan…"); try { await post({ action: "saveCode", which, code }); K.toast("Code ingesteld"); render(); } catch (err) { page.querySelector("#tErr").innerHTML = K.c.error(err.message); K.busy(t, false); } });
    K.on(page, "click", "[data-resetcode]", async (e, t) => { const which = t.dataset.resetcode; if (!(await K.confirm({ title: "Terug naar de Vercel-code?", text: "De eigen code wordt gewist.", yes: "Wissen", danger: true }))) return; try { await post({ action: "saveCode", which, reset: true }); K.toast("Eigen code gewist"); render(); } catch (err) { K.toast(err.message, { kind: "err" }); } });
    const la = page.querySelector("#logoutAll"); if (la) la.onclick = async () => { if (!(await K.confirm({ title: "Iedereen afmelden?", text: "Alle medewerkers en beheerders moeten opnieuw aanmelden, u ook.", yes: "Iedereen afmelden", danger: true }))) return; K.busy(la, true, "Afmelden…"); try { await K.api("/api/session?all=1", { method: "DELETE" }); location.replace("/beheer/aanmelden"); } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(la, false); } };
    const ep = page.querySelector("#enkelPin"); if (ep) ep.onclick = async () => {
      const aan = !c.enkelPin;
      if (!(await K.confirm(aan
        ? { title: "Enkel persoonlijke pincodes aanzetten?", text: "De teamcodes werken meteen niet meer en iedereen wordt afgemeld (binnen 1 minuut op elke server). Daarna meldt iedereen aan met een eigen PIN. Bent u met een teamcode aangemeld, dan meldt u daarna aan met uw eigen PIN.", yes: "Aanzetten", danger: true }
        : { title: "Enkel persoonlijke pincodes uitzetten?", text: "De teamcodes werken dan weer naast de persoonlijke PIN's. Wie met een teamcode aanmeldt, staat als „personeel” of „beheerder” in het logboek.", yes: "Uitzetten" }))) return;
      K.busy(ep, true, "Opslaan…");
      try { const d = await post({ action: "saveEnkelPin", aan }); if (d.afgemeld) { location.replace("/beheer/aanmelden"); return; } K.toast(aan ? "Enkel persoonlijke pincodes staat aan" : "Teamcodes werken weer"); render(); }
      catch (err) { page.querySelector("#tErr").innerHTML = K.c.error(err.message); K.busy(ep, false); }
    };
    K.on(page, "click", "[data-new-mw]", () => medewerkerPanel(null));
    K.on(page, "click", "[data-mw-edit]", (e, t) => medewerkerPanel(mw.find(m => m.id === t.dataset.mwEdit)));
    K.on(page, "click", "[data-mw-del]", async (e, t) => { const m = mw.find(x => x.id === t.dataset.mwDel); if (!(await K.confirm({ title: m.naam + " verwijderen?", text: "De PIN werkt meteen niet meer. Eerdere regels in het logboek blijven op naam staan. Tijdelijk? Zet de medewerker op inactief.", yes: "Verwijderen", danger: true }))) return; K.busy(t, true, "Verwijderen…"); try { await post({ action: "deleteMedewerker", id: m.id }); K.toast("Medewerker verwijderd"); render(); } catch (err) { page.querySelector("#tErr").innerHTML = K.c.error(err.message); K.busy(t, false); } });
  }

  /* ---------- status ---------- */
  async function status() {
    const st = D.status, c = D.config;
    page.innerHTML = head("Alles wat het portaal nodig heeft om te draaien", '<button type="button" class="btn btn-o btn-sm" id="recheck">' + K.icon("refresh") + 'Nu controleren</button>') + '<div class="content pt-16"><div class="kpis" id="cards">' + K.c.skeleton(1) + '</div><div id="health"></div><div id="dbcard"></div><div id="testcard"></div></div>';
    const t0 = Date.now(); let api = null, apiMs = 0; try { api = await K.api("/api/config?status=1"); apiMs = Date.now() - t0; } catch (e) { api = { error: e.message }; }
    // Echte toestand (D-03) : /api/health, dezelfde controle als de externe sonde. 503 = niet gezond, maar het antwoord blijft leesbaar.
    let hl = null; try { const r = await fetch("/api/health", { cache: "no-store" }); hl = await r.json().catch(() => null); } catch (e) { hl = null; }
    const hc = (hl && hl.checks) || {}, bk = hc.backup;
    const cards = [
      ["Gegevens", api && !api.error ? "ok" : "bad", api && !api.error ? "Antwoord " + apiMs + " ms · " + (api.status.orders || 0) + " bestellingen · " + (api.status.clients || 0) + " klanten" : "Geen verbinding: " + (api && api.error), hl && hl.backend !== "airtable" ? "" : "Let op: het gratis Airtable-plan heeft een maandelijkse API-limiet. Bij overschrijding weigert Airtable tot de volgende maand."],
      ["E-mail (Resend)", st.mailEnabled ? (st.mailReady ? "ok" : "warn") : "bad", st.mailEnabled ? (st.mailReady ? "Actief · interne postbus " + c.bestellingenEmail : (!c.mailFromConfigured ? "Sleutel aanwezig, maar MAIL_FROM (afzender) ontbreekt op Vercel" : "Sleutel aanwezig, maar geen interne postbus ingesteld")) : "RESEND_API_KEY ontbreekt op Vercel", "Klanten krijgen enkel mail als het afzenderdomein bij Resend geverifieerd is."],
      ["Gezondheid (/api/health)", !hl ? "bad" : !hl.ok ? "bad" : bk && (!bk.ok || bk.ageHours > 36) ? "warn" : "ok", !hl ? "Geen antwoord van /api/health" : "Versie " + hl.version + " · database " + (hc.database && hc.database.ok ? "OK (" + hc.database.ms + " ms)" : "FOUT" + (hc.database && hc.database.error ? " — " + hc.database.error : "")) + " · configuratie " + (hc.config && hc.config.ok ? "OK" : "FOUT") + (bk ? " · back-up " + (bk.ok ? "verstuurd" : "MISLUKT") + " " + dateTime(bk.at) : ""), "Externe sonde (elke 5 min) op /api/health: zie RUNBOOK.md. Logboek: vercel.com → project famo-portail."],
      ["Toegang", c.adminCodeCustom && c.staffCodeCustom ? "ok" : "warn", (c.adminCodeCustom && c.staffCodeCustom ? "Aparte codes voor beheerder en personeel" : "Codes nog niet apart ingesteld") + " · " + (st.medewerkers || 0) + " medewerker" + (st.medewerkers === 1 ? "" : "s") + " met PIN", ""]
    ];
    page.querySelector("#cards").innerHTML = cards.map(([t, s, d, n]) => '<div class="kp"><div class="d-flex jc-sb ai-c gap-8"><b class="fs-14 m-0">' + t + '</b><span class="minw-64 cell-st c-' + (s === "ok" ? "done" : s === "warn" ? "new" : "late") + '">' + (s === "ok" ? "OK" : s === "warn" ? "Let op" : "Fout") + '</span></div><div class="muted fs-125 mt-6">' + K.esc(d) + '</div>' + (n ? '<div class="quiet fs-115 mt-6">' + K.esc(n) + '</div>' : "") + '</div>').join("");
    const issues = [];
    if (st.ibanOntbreekt) issues.push(["IBAN of BIC ontbreekt", "#/bedrijf"]); if (st.klantenZonderEmail) issues.push([st.klantenZonderEmail + " klant(en) zonder e-mail", "#/klanten"]); if (!(c.adminCodeCustom && c.staffCodeCustom)) issues.push(["Codes personeel en beheerder niet apart", "#/toegang"]); if (!st.stock) issues.push(["Voorraadtabel leeg" + (c.voorraadAfboeken ? " — afboeken staat aan" : " — voorraad wordt niet afgetrokken"), "/team/voorraad"]); if (st.aanvragen) issues.push([st.aanvragen + " nieuwe aanvraag/aanvragen", "#/aanvragen"]);
    page.querySelector("#health").innerHTML = '<div class="card mt-16"><div class="card-h"><h2 class="h2">Gezondheid van de gegevens</h2></div>' + (issues.length ? issues.map(([t, h]) => '<div class="stop mh-48"><span class="chip st-new"><i></i>!</span><span class="flex-1">' + K.esc(t) + '</span><a class="btn btn-o btn-sm" href="' + h + '">Bekijken</a></div>').join("") : '<div class="card-b">' + K.c.ok("Alles in orde.") + '</div>') + '</div><p class="quiet fs-125 mt-12">Wie te bellen: ontwikkelaar Ayoub · eigenaar Bilal.</p>';
    page.querySelector("#recheck").onclick = () => render(true);
    secCard();
    dbCard();
    testCard();
  }

  // Beveiliging (A-04, A-14) : wachtwoorden nog in klare tekst en SESSION_SECRET op Vercel.
  async function secCard() {
    const box = document.createElement("div"); page.querySelector("#health").after(box);
    let s; try { s = await K.api("/api/onboarding", { json: { action: "securityStatus" } }); } catch (e) { box.innerHTML = '<div class="card card-b mt-16">' + K.c.error("Beveiliging: " + e.message) + '</div>'; return; }
    box.innerHTML = '<div class="card mt-16"><div class="card-h"><h2 class="h2">Beveiliging</h2></div><div class="card-b stack-10">' +
      (s.hasSessionSecret ? K.c.ok("SESSION_SECRET is ingesteld op Vercel.") : K.c.warn("<b>SESSION_SECRET ontbreekt op Vercel.</b> Voeg 32+ willekeurige tekens toe en redeploy. Iedereen meldt daarna één keer opnieuw aan.")) +
      (s.klareWachtwoorden ? K.c.warn("<b>" + s.klareWachtwoorden + " klantwachtwoord(en) nog leesbaar opgeslagen.</b> Ze worden bij de volgende aanmelding versleuteld, of nu meteen:") + '<div><button type="button" class="btn btn-p btn-sm" id="hashAll">Nu versleutelen</button></div>' : K.c.ok("Alle klantwachtwoorden zijn versleuteld opgeslagen.")) + '</div></div>';
    const hb = box.querySelector("#hashAll"); if (hb) hb.onclick = async () => { K.busy(hb, true, "Versleutelen…"); try { let r; do { r = await K.api("/api/onboarding", { json: { action: "hashAllPasswords" } }); } while (r.klareWachtwoorden > 0 && r.hashed > 0); K.toast(r.klareWachtwoorden ? r.klareWachtwoorden + " nog niet gelukt" : "Alle wachtwoorden versleuteld", { kind: r.klareWachtwoorden ? "err" : undefined }); box.remove(); secCard(); } catch (err) { K.toast(err.message, { kind: "err" }); K.busy(hb, false); } };
  }

  /* ---------- database (Airtable -> Postgres) : api/dbadmin.js ---------- */
  const DB_LABEL = { airtable: "Airtable", postgres: "Postgres (Neon)", sqlite: "SQLite (lokaal)" };
  const SNAP_LABEL = { export: "Handmatig", "voor-herstel": "Automatisch (vóór terugzetten)", "voor-kopie": "Automatisch (vóór kopie)", upload: "Geüpload bestand" };
  const sizeTxt = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " kB";
  function dbReport(rep) {
    return '<div class="tblwrap"><table class="tbl"><thead><tr><th>Tabel</th><th class="num">Airtable</th><th class="num">Nieuwe database</th><th>Resultaat</th></tr></thead><tbody>' + rep.map(r => '<tr><td>' + K.esc(r.table) + '</td><td class="num mono">' + r.airtable + '</td><td class="num mono">' + r.postgres + '</td><td>' + (r.ok ? '<span class="cell-st c-done">OK</span>' : '<span class="cell-st c-late">Verschil</span>') + (r.onlyAirtable || r.onlyPostgres ? ' <small class="quiet">' + (r.onlyAirtable || 0) + ' enkel Airtable · ' + (r.onlyPostgres || 0) + ' enkel nieuw</small>' : "") + (r.changed ? ' <small class="quiet">' + r.changed + ' gewijzigd (bv. ' + K.esc((r.changedIds || [])[0] || "") + ')</small>' : "") + (r.totalAirtable !== undefined ? ' <small class="quiet">totaal ' + K.eur(r.totalAirtable) + ' / ' + K.eur(r.totalPostgres) + '</small>' : "") + '</td></tr>').join("") + '</tbody></table></div>';
  }
  // Back-up : de server bewaart het gzip-bestand in delen (max. 4,5 MB per antwoord) ; hier worden ze aan elkaar gezet.
  // Gedeeld door de kaart Database en « Testperiode afsluiten » (specs/021).
  const saveBlob = (bytes, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: "application/gzip" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); };
  const b64bytes = b64 => { const bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const bytesB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
  const downloadSnap = async (id) => { const chunks = []; let parts = 1, name = "famo-backup.json.gz"; for (let n = 0; n < parts; n++) { const r = await K.api("/api/dbadmin", { json: { action: "download", id, part: n } }); parts = r.parts; name = r.filename || name; chunks.push(b64bytes(r.data)); } saveBlob(new Blob(chunks), name); };
  // Volledige back-up maken en meteen downloaden (SQL : ook bewaard in de database ; Airtable : rechtstreeks).
  const backupNow = async () => { const r = await K.api("/api/dbadmin", { json: { action: "export" } }); if (r.inline) saveBlob(b64bytes(r.inline), "famo-backup-airtable-" + new Date().toISOString().slice(0, 10) + ".json.gz"); else await downloadSnap(r.snapshot.id); return r; };
  async function dbCard(withAirtable) {
    const box = page.querySelector("#dbcard"); if (!box) return;
    box.innerHTML = '<div class="card mt-16"><div class="card-h"><h2 class="h2">Database</h2></div><div class="card-b">' + K.c.skeleton(1) + '</div></div>';
    let d; try { d = await K.api("/api/dbadmin" + (withAirtable ? "?airtable=1" : "")); } catch (e) { box.querySelector(".card-b").innerHTML = K.c.error(e.message); return; }
    const onNew = d.backend !== "airtable";
    const counts = Object.entries(d.counts || {}).map(([t, n]) => K.esc(t) + " " + n).join(" · ") || "nog leeg";
    const at = d.airtable ? '<p class="sub">In Airtable: ' + Object.entries(d.airtable).map(([t, n]) => K.esc(t) + " " + n).join(" · ") + '</p>' : "";
    box.querySelector(".card-b").innerHTML =
      '<p class="m-0 mb-6"><b>Actief:</b> ' + K.esc(DB_LABEL[d.backend] || d.backend) + (onNew ? "" : ' <small class="quiet">(de portaal leest en schrijft in Airtable)</small>') + '</p>' +
      (d.target ? '<p class="sub m-0 mb-6">Nieuwe database: ' + (d.reachable ? '<span class="cell-st c-done">bereikbaar</span>' : '<span class="cell-st c-late">niet bereikbaar</span>') + ' · ' + counts + '</p>' : "") +
      (d.targetError ? K.c.error(d.targetError) : "") + at +
      (d.lastBackup ? '<p class="sub m-0 mb-6">Nachtelijke back-up: ' + (d.lastBackup.ok ? '<span class="cell-st c-done">verstuurd</span>' : '<span class="cell-st c-late">' + (d.lastBackup.big ? "te groot voor e-mail" : "mislukt") + '</span>') + ' · ' + K.esc(dateTime(d.lastBackup.at)) + (d.lastBackup.error ? ' · ' + K.esc(d.lastBackup.error) : "") + '</p>' : (d.target && onNew ? '<p class="sub m-0 mb-6">Nog geen nachtelijke back-up verstuurd (CRON_SECRET en e-mail nodig).</p>' : "")) +
      '<div id="dbout"></div>' +
      '<div class="d-flex gap-8 f-wrap mt-12">' +
        '<button type="button" class="btn btn-o btn-sm" id="dbCount">Tellen in Airtable</button>' +
        (d.target && d.reachable ? '<button type="button" class="btn btn-o btn-sm" id="dbVerify">Vergelijken</button>' : "") +
        (d.target && d.reachable && !onNew ? '<button type="button" class="btn btn-p btn-sm" id="dbCopy">Kopieer Airtable naar de nieuwe database</button>' : "") +
        '<button type="button" class="btn btn-o btn-sm" id="dbExport">Back-up maken</button>' +
        (onNew && d.reachable ? '<label class="btn btn-o btn-sm c-pointer">Back-up terugzetten…<input type="file" id="dbRestore" accept=".gz,.json,application/gzip,application/json" hidden></label><button type="button" class="btn btn-ghost btn-sm" id="dbFix">Foto\'s uit Airtable ophalen</button>' : "") +
      '</div>' +
      ((d.snapshots || []).length ? '<div class="tblwrap mt-12"><table class="tbl"><thead><tr><th>Back-up</th><th>Soort</th><th class="num">Grootte</th><th></th></tr></thead><tbody>' + d.snapshots.map(sn => '<tr><td>' + K.esc(dateTime(sn.createdTime)) + '</td><td>' + K.esc(SNAP_LABEL[sn.kind] || sn.kind) + '</td><td class="num mono">' + K.esc(sizeTxt(sn.size)) + '</td><td class="actions"><button type="button" class="btn btn-o btn-sm" data-snap-dl="' + K.esc(sn.id) + '">Downloaden</button>' + (onNew ? ' <button type="button" class="btn btn-ghost btn-sm" data-snap-restore="' + K.esc(sn.id) + '">Terugzetten</button>' : "") + '</td></tr>').join("") + '</tbody></table></div>' : "") +
      '<p class="sub mt-10">' + (onNew ? "De portaal draait op de nieuwe database. Terug naar Airtable: zet DB_BACKEND op airtable in Vercel en redeploy." : "Kopiëren overschrijft de nieuwe database met de inhoud van Airtable; Airtable zelf blijft onaangeroerd. Omschakelen: DB_BACKEND=postgres in Vercel, dan redeploy.") + '</p>';
    const out = box.querySelector("#dbout");
    box.querySelector("#dbCount").onclick = () => dbCard(true);
    const v = box.querySelector("#dbVerify");
    if (v) v.onclick = async () => { K.busy(v, true, "Vergelijken…"); try { const r = await K.api("/api/dbadmin", { json: { action: "verify" } }); out.innerHTML = (r.ok ? K.c.ok("Airtable en de nieuwe database zijn gelijk.") : K.c.warn("Er zijn verschillen: zie de tabel.")) + dbReport(r.report); } catch (e) { out.innerHTML = K.c.error(e.message); } K.busy(v, false); };
    const restoreSnap = async (id, summary) => {
      const what = summary ? Object.entries(summary.tables || {}).map(([t, n]) => t + " " + n).join(" · ") + " · foto's " + (summary.files || 0) : "deze back-up";
      const typed = await K.prompt({ title: "Database vervangen door de back-up?", text: "ALLES in de database wordt vervangen door: " + what + ". Eerst wordt automatisch een back-up van de huidige inhoud gemaakt. Typ RESTORE om te bevestigen.", placeholder: "RESTORE", yes: "Terugzetten" });
      if (typed === null) return;
      try { const r = await K.api("/api/dbadmin", { json: { action: "restore", snapshot: id, confirm: typed.trim() } }); K.toast(r.ok ? "Back-up teruggezet" : "Teruggezet, maar met verschillen"); await dbCard(); box.querySelector("#dbout").innerHTML = r.ok ? K.c.ok("Teruggezet: alle records en foto's zijn identiek aan de back-up." + (r.before ? " De vorige inhoud staat als back-up in de lijst." : "")) : K.c.warn("Teruggezet met verschillen."); }
      catch (e) { out.innerHTML = K.c.error(e.message); }
    };
    const ex = box.querySelector("#dbExport");
    ex.onclick = async () => { K.busy(ex, true, "Back-up maken…"); try { const r = await backupNow(); if (!r.inline) await dbCard(); K.toast("Back-up gedownload (" + r.summary.records + " records, " + r.summary.files + " foto's)"); } catch (e) { out.innerHTML = K.c.error(e.message); } K.busy(ex, false); };
    // onclick per knop (niet K.on op #dbcard) : dbCard hertekent de kaart, een gedelegeerde listener zou zich opstapelen.
    box.querySelectorAll("[data-snap-dl]").forEach(t => { t.onclick = async () => { K.busy(t, true, "Downloaden…"); try { await downloadSnap(t.dataset.snapDl); } catch (err) { out.innerHTML = K.c.error(err.message); } K.busy(t, false); }; });
    box.querySelectorAll("[data-snap-restore]").forEach(t => { t.onclick = () => restoreSnap(t.dataset.snapRestore, null); });
    const rf = box.querySelector("#dbRestore");
    if (rf) rf.onchange = async () => {
      const f = rf.files && rf.files[0]; if (!f) return;
      out.innerHTML = K.c.skeleton(1);
      try {
        const u8 = new Uint8Array(await f.arrayBuffer()), step = 1572864, parts = Math.max(1, Math.ceil(u8.length / step));
        let id = "", r = null;
        for (let n = 0; n < parts; n++) { r = await K.api("/api/dbadmin", { json: { action: "upload", id: id || undefined, part: n, parts, data: bytesB64(u8.subarray(n * step, (n + 1) * step)) } }); id = r.id || id; }
        out.innerHTML = K.c.ok("Bestand ontvangen en gecontroleerd: " + r.summary.records + " records, " + r.summary.files + " foto's (gemaakt " + K.esc(dateTime(r.summary.exportedAt)) + ").");
        await restoreSnap(r.snapshot.id, r.summary);
      } catch (e) { out.innerHTML = K.c.error(e.message); }
      rf.value = "";
    };
    const fx = box.querySelector("#dbFix");
    if (fx) fx.onclick = async () => { K.busy(fx, true, "Ophalen…"); try { const r = await K.api("/api/dbadmin", { json: { action: "fixPhotos" } }); out.innerHTML = (r.ok ? K.c.ok : K.c.warn)(r.photos.downloaded + " foto('s) opgehaald · " + r.photos.failed + " mislukt · " + r.photos.missing + " niet meer in Airtable."); } catch (e) { out.innerHTML = K.c.error(e.message); } K.busy(fx, false); };
    const cp = box.querySelector("#dbCopy");
    if (cp) cp.onclick = async () => {
      if (!(await K.confirm({ title: "Alles kopiëren naar de nieuwe database?", text: "De nieuwe database wordt volledig vervangen door de huidige inhoud van Airtable. Airtable zelf verandert niet. De portaal blijft op Airtable draaien tot je omschakelt.", yes: "Kopiëren" }))) return;
      K.busy(cp, true, "Kopiëren…");
      try { const r = await K.api("/api/dbadmin", { json: { action: "copy" } }); K.toast(r.ok ? "Kopie klaar" : "Kopie met verschillen"); await dbCard(); box.querySelector("#dbout").innerHTML = (r.ok ? K.c.ok("Kopie klaar: alle tabellen hebben evenveel regels.") : K.c.warn("Kopie klaar, maar met verschillen.")) + dbReport(r.report); }
      catch (e) { out.innerHTML = K.c.error(e.message); K.busy(cp, false); }
    };
  }

  /* ---------- Testperiode afsluiten (specs/021) : lib/beheer/testperiode.js ---------- */
  // Volgorde : selectie + voorbeeld (niets geschreven) → archiveren als test (omkeerbaar) → back-up → definitief
  // verwijderen → nummering herstarten. De server rekent de selectie zelf na en controleert back-up en bevestiging.
  const ST_NL = { "Reçue": "Ontvangen", "Prête": "Klaar", "Sortie en livraison": "Onderweg", "Facturée": "Geleverd", "Annulée": "Geannuleerd" };
  let tp = { voor: null, behalve: "", behoud: [], data: null, backupAt: 0 };
  const two = n => String(n).padStart(2, "0");
  const nrList = l => !l.length ? "geen" : l.length <= 6 ? l.join(", ") : l[0] + " … " + l[l.length - 1] + " (" + l.length + ")";
  async function testCard() {
    const box = page.querySelector("#testcard"); if (!box) return;
    // Standaard « nu », afgerond naar de volgende minuut (het veld kent geen seconden) : ook wat net gemaakt is, telt mee.
    const d0 = tp.voor ? new Date(tp.voor) : new Date(Math.ceil(Date.now() / 60000) * 60000);
    const day = d0.getFullYear() + "-" + two(d0.getMonth() + 1) + "-" + two(d0.getDate()), hm = two(d0.getHours()) + ":" + two(d0.getMinutes());
    box.innerHTML = '<div class="card mt-16"><div class="card-h"><div><h2 class="h2" id="tpTitle">Testperiode afsluiten</h2><p class="sub ws-normal">Bestellingen en documenten uit de testperiode opruimen, zodat het personeel, de klanten en de boekhouding enkel nog echte gegevens zien. Producten, prijzen, voorraadaantallen, klanten, instellingen en medewerkers blijven onaangeroerd.</p></div></div><div class="card-b stack-10">' +
      '<h3 class="fs-14 m-0">1. Welke bestellingen waren een test?</h3>' +
      '<div class="d-flex gap-8 f-wrap ai-end">' + K.c.field("Aangemaakt vóór (datum)", K.c.input("tpDag", { type: "date", value: day }), { id: "f_tpDag" }).replace('class="field"', 'class="field fx-150"') +
      K.c.field("Uur", K.c.input("tpUur", { type: "time", value: hm }), { id: "f_tpUur" }).replace('class="field"', 'class="field fx-130"') +
      K.c.field("Behalve (referenties, gescheiden door een komma)", K.c.input("tpBehalve", { value: tp.behalve, placeholder: "bv. CMD-2026-0031" }), { id: "f_tpBehalve" }).replace('class="field"', 'class="field fx2-180"') + '</div>' +
      '<div class="d-flex gap-8 f-wrap"><button type="button" class="btn btn-p btn-sm" id="tpVoorbeeld">Voorbeeld tonen</button></div>' +
      '<p class="quiet fs-12 m-0">Het voorbeeld verandert niets. Elke stap daarna vraagt nog een bevestiging.</p>' +
      '<div id="tpOut" aria-live="polite"></div></div></div>';
    const out = box.querySelector("#tpOut");
    const voorIso = () => { const dv = box.querySelector("#tpDag").value, tv = box.querySelector("#tpUur").value || "00:00"; const t = new Date(dv + "T" + tv); return dv && !isNaN(t) ? t.toISOString() : ""; };
    const run = async () => {
      const iso = voorIso(); K.setErr("f_tpDag", iso ? "" : "Kies een datum."); if (!iso) return;
      tp.voor = iso; tp.behalve = box.querySelector("#tpBehalve").value;
      const b = box.querySelector("#tpVoorbeeld"); K.busy(b, true, "Tellen…");
      try { tp.data = await K.api("/api/onboarding", { json: { action: "testVoorbeeld", voor: iso, behalve: tp.behalve, behoudKlanten: tp.behoud } }); drawTp(out); }
      catch (e) { out.innerHTML = K.c.error(e.message); }
      K.busy(b, false);
    };
    box.querySelector("#tpVoorbeeld").onclick = run;
    if (tp.data) await run();
  }
  function drawTp(out) {
    const d = tp.data, s = d.scope, g = d.gearchiveerd, bk = d.backup;
    const fresh = bk.serverCheck ? bk.vers : Date.now() - tp.backupAt < 30 * 60000;
    const rows = c => [
      ["Bestellingen", c.bestellingen ? c.bestellingen + " · " + Object.entries(c.perStatus).map(([k, n]) => (ST_NL[k] || k) + " " + n).join(" · ") + (c.referenties ? " · " + c.referenties.eerste + " … " + c.referenties.laatste : "") : "geen"],
      ["Facturen (FA)", nrList(c.facturen)], ["Creditnota's (CN)", nrList(c.creditnotas)], ["Leveringsbonnen", String(c.leveringsbonnen)],
      ["Foto's en handtekeningen", String(c.bestanden)], ["Voorraadbewegingen van deze bestellingen", String(c.voorraadbewegingen)],
      ["Per klant", c.klanten.length ? c.klanten.map(k => k.naam + " " + k.bestellingen).join(" · ") : "—"],
      ["Regels in het auditlogboek", c.journaal == null ? "—" : c.journaal + " (blijven bewaard)"]];
    // Label boven waarde (.kv : twee kolommen, één kolom op de telefoon) : lange nummerlijsten lopen niet buiten beeld.
    const table = (c, cap) => '<div class="kv" role="group" aria-label="' + K.esc(cap) + '">' + rows(c).map(([k, v]) => '<div><small>' + K.esc(k) + '</small>' + K.esc(v) + '</div>').join("") + '</div>';
    const nodig = d.nummering.filter(n => n.nodig), blocked = d.nummering.filter(n => !n.magHerstarten);
    const why = (id, txt) => txt ? '<p class="quiet fs-12 m-0" id="' + id + '">' + K.esc(txt) + '</p>' : "";
    const purgeWhy = !g.bestellingen ? "Eerst archiveren als test (stap 2)." : !fresh ? "Eerst een back-up maken (stap 3)." : "";
    const numWhy = !nodig.length ? (blocked.length ? blocked.map(n => n.reden).join(" ") : "Niets te herstarten.") : !fresh ? "Eerst een back-up maken (stap 3)." : "";
    out.innerHTML =
      // Echte klanten : aangevinkt = al hun bestellingen blijven buiten de selectie (server rekent na).
      (d.kandidaten.length ? '<div class="stack-6 mt-10" role="group" aria-labelledby="tpKeepH"><h3 class="fs-14 m-0" id="tpKeepH">Echte klanten: hun bestellingen behouden</h3><p class="quiet fs-12 m-0">Vink de klanten aan wiens bestellingen echt zijn. Die bestellingen worden niet gearchiveerd.</p>' +
        d.kandidaten.map(k => '<label class="row-10 fs-13">' + K.c.check(k.behouden, 'data-behoud="' + K.esc(k.id) + '"', { big: true, label: "Bestellingen van " + k.naam + " behouden" }) + '<span><b>' + K.esc(k.naam) + '</b> <span class="quiet">· ' + K.plural(k.bestellingen, "bestelling", "bestellingen") + (k.behouden ? " · behouden" : "") + '</span></span></label>').join("") + '</div>' : "") +
      '<h3 class="fs-14 mt-10 mb-6">Voorbeeld: ' + K.plural(s.bestellingen, "bestelling", "bestellingen") + ' in de selectie</h3>' + table(s, "Wat gearchiveerd zou worden") +
      '<p class="sub m-0 mt-6">Buiten de selectie (blijft zichtbaar): ' + K.plural(d.buiten.bestellingen, "bestelling", "bestellingen") + '.</p>' +
      '<h3 class="fs-14 mt-14 mb-6">2. Archiveren als test</h3><p class="sub m-0 mb-6">Omkeerbaar. Gearchiveerde bestellingen verdwijnen uit alle lijsten, rapporten, documenten, de klantenportal, herinneringen en exports. Hun nummers blijven bezet tot ze definitief verwijderd zijn.</p>' +
      '<div class="d-flex gap-8 f-wrap"><button type="button" class="btn btn-p btn-sm" id="tpArch"' + (s.bestellingen ? "" : " disabled aria-describedby=\"tpArchWhy\"") + '>' + (s.bestellingen ? K.plural(s.bestellingen, "bestelling", "bestellingen") + " archiveren als test" : "Archiveren als test") + '</button>' +
      (g.bestellingen ? '<button type="button" class="btn btn-o btn-sm" id="tpBack">' + K.plural(g.bestellingen, "testbestelling", "testbestellingen") + ' terugzetten</button>' : "") + '</div>' + why("tpArchWhy", s.bestellingen ? "" : "Geen bestellingen in deze selectie.") +
      (g.bestellingen ? '<p class="sub m-0 mt-6"><b>Nu gearchiveerd als test:</b></p>' + table(g, "Gearchiveerde testbestellingen") : "") +
      '<h3 class="fs-14 mt-14 mb-6">3. Back-up</h3>' +
      (fresh ? K.c.ok("Back-up gemaakt" + (bk.laatste ? " om " + K.esc(K.time(bk.laatste)) : "") + ". Bewaar het bestand buiten het portaal.") : K.c.warn("<b>Verplicht vóór verwijderen of nummering herstarten:</b> een back-up van minder dan 30 minuten oud" + (bk.laatste ? " (laatste: " + K.esc(dateTime(bk.laatste)) + ")" : "") + ".")) +
      '<div class="d-flex gap-8 f-wrap mt-6"><button type="button" class="btn btn-o btn-sm" id="tpBackup">Back-up maken</button></div>' +
      '<h3 class="fs-14 mt-14 mb-6">4. Definitief verwijderen</h3><p class="sub m-0 mb-6">Onomkeerbaar. Enkel de bestellingen die als test gearchiveerd zijn, met hun foto\'s, handtekeningen en voorraadbewegingen. <b>De voorraadaantallen veranderen niet</b>: de voorraad is opnieuw geteld. Het auditlogboek blijft bewaard en krijgt één samenvattende regel.</p>' +
      '<div class="d-flex gap-8 f-wrap"><button type="button" class="btn btn-danger btn-sm" id="tpPurge"' + (purgeWhy ? ' disabled aria-describedby="tpPurgeWhy"' : "") + '>' + (g.bestellingen ? K.plural(g.bestellingen, "testbestelling", "testbestellingen") + " definitief verwijderen" : "Definitief verwijderen") + '</button></div>' + why("tpPurgeWhy", purgeWhy) +
      '<h3 class="fs-14 mt-14 mb-6">5. Nummering herstarten</h3>' +
      K.c.warn("<b>Alleen als geen enkele van deze testfacturen of creditnota's ooit naar een klant of naar de boekhouder is gegaan.</b> Facturen moeten doorlopend genummerd zijn; een verstuurde factuur annuleer je met een creditnota, je wist ze niet. Vraag het na bij je boekhouder." + (d.facturatie === "portaal" ? " <b>Let op:</b> het portaal maakt hier zelf de facturen (modus Portaal)." : "")) +
      '<div class="tblwrap mt-6"><table class="tbl"><thead><tr><th scope="col">Reeks</th><th scope="col" class="num">Als test</th><th scope="col" class="num">Andere</th><th scope="col">Volgende</th></tr></thead><tbody>' + d.nummering.map(n => '<tr><td class="mono">' + K.esc(n.serie) + '</td><td class="num mono">' + n.test + '</td><td class="num mono">' + n.echt + '</td><td>' + (n.magHerstarten ? (n.nodig ? '<span class="cell-st c-new">kan terug naar 0001</span>' : '<span class="cell-st c-done">0001</span>') : '<span class="cell-st c-late">loopt door</span>') + '</td></tr>').join("") + '</tbody></table></div>' +
      '<div class="d-flex gap-8 f-wrap mt-6"><button type="button" class="btn btn-o btn-sm" id="tpNum"' + (numWhy ? ' disabled aria-describedby="tpNumWhy"' : "") + '>Nummering herstarten' + (nodig.length ? " (" + nodig.map(n => n.serie).join(", ") + ")" : "") + '</button></div>' + why("tpNumWhy", numWhy) + '<div id="tpRes" class="mt-6"></div>';
    const res = out.querySelector("#tpRes");
    out.querySelectorAll("[data-behoud]").forEach(b => b.onclick = async () => {
      const id = b.dataset.behoud, on = !b.classList.contains("on");
      tp.behoud = on ? tp.behoud.concat(id) : tp.behoud.filter(x => x !== id);
      K.setOn(b, on); b.disabled = true;
      await testCard();
      const again2 = page.querySelector('[data-behoud="' + id + '"]'); if (again2) again2.focus();
    });
    const again = async (msg) => { await testCard(); const r = page.querySelector("#tpRes"); if (r && msg) { r.innerHTML = msg; } const h = page.querySelector("#tpOut h3"); if (h) { h.tabIndex = -1; h.focus(); } };
    const fail = (b, e) => { res.innerHTML = K.c.error(e.message); K.busy(b, false); };
    const ar = out.querySelector("#tpArch");
    if (ar && s.bestellingen) ar.onclick = async () => {
      if (!(await K.confirm({ title: K.plural(s.bestellingen, "bestelling", "bestellingen") + " archiveren als test?", text: "Ze verdwijnen overal uit beeld (personeel, klanten, documenten, rapporten). Met « Terugzetten » komen ze ongewijzigd terug.", yes: "Archiveren" }))) return;
      K.busy(ar, true, "Archiveren…");
      try { const r = await K.api("/api/onboarding", { json: { action: "testArchiveren", voor: d.voor, behalve: d.behalve, behoudKlanten: d.behoudKlanten, verwacht: s.bestellingen } }); K.toast(r.gearchiveerd + " gearchiveerd als test"); await again(K.c.ok(K.plural(r.gearchiveerd, "bestelling", "bestellingen") + " gearchiveerd als test. Controleer Bestellingen en Documenten; daarna kan u ze definitief verwijderen.")); }
      catch (e) { fail(ar, e); }
    };
    const bb = out.querySelector("#tpBack");
    if (bb) bb.onclick = async () => {
      if (!(await K.confirm({ title: K.plural(g.bestellingen, "testbestelling", "testbestellingen") + " terugzetten?", text: "Ze worden weer overal zichtbaar, precies zoals voor het archiveren.", yes: "Terugzetten" }))) return;
      K.busy(bb, true, "Terugzetten…");
      try { const r = await K.api("/api/onboarding", { json: { action: "testTerugzetten" } }); K.toast(r.teruggezet + " teruggezet"); await again(K.c.ok(K.plural(r.teruggezet, "bestelling", "bestellingen") + " weer zichtbaar.")); }
      catch (e) { fail(bb, e); }
    };
    const bk2 = out.querySelector("#tpBackup");
    bk2.onclick = async () => { K.busy(bk2, true, "Back-up maken…"); try { const r = await backupNow(); tp.backupAt = Date.now(); K.toast("Back-up gedownload (" + r.summary.records + " records, " + r.summary.files + " foto's)"); await again(K.c.ok("Back-up gemaakt en gedownload. Bewaar het bestand buiten het portaal.")); } catch (e) { fail(bk2, e); } };
    const pg = out.querySelector("#tpPurge");
    if (pg && !purgeWhy) pg.onclick = async () => {
      const typed = await K.prompt({ title: K.plural(g.bestellingen, "testbestelling", "testbestellingen") + " definitief verwijderen?", text: "Dit kan niet ongedaan gemaakt worden (enkel met de back-up). Facturen " + nrList(g.facturen) + ", creditnota's " + nrList(g.creditnotas) + ", " + g.bestanden + " bestand(en) en " + g.voorraadbewegingen + " voorraadbeweging(en) verdwijnen; de voorraadaantallen blijven. Typ " + d.bevestig.verwijderen + " om te bevestigen.", placeholder: d.bevestig.verwijderen, yes: "Definitief verwijderen" });
      if (typed === null) return;
      K.busy(pg, true, "Verwijderen…");
      try { const r = await K.api("/api/onboarding", { json: { action: "testVerwijderen", confirm: typed.trim(), verwacht: g.bestellingen } }); K.toast(r.verwijderd.bestellingen + " testbestellingen verwijderd"); await again(K.c.ok(K.plural(r.verwijderd.bestellingen, "testbestelling", "testbestellingen") + " en " + K.plural(r.verwijderd.voorraadbewegingen, "voorraadbeweging", "voorraadbewegingen") + " verwijderd. De voorraadaantallen zijn niet veranderd.")); }
      catch (e) { fail(pg, e); }
    };
    const nm = out.querySelector("#tpNum");
    if (nm && !numWhy) nm.onclick = async () => {
      const list = nodig.map(n => n.serie).join(", ");
      const typed = await K.prompt({ title: "Nummering herstarten (" + list + ")?", text: "De volgende factuur, creditnota of bestelling van deze reeks krijgt opnieuw nummer 0001. Alleen als geen enkel testdocument ooit naar een klant of de boekhouder is gegaan — vraag het na bij je boekhouder. Typ " + d.bevestig.nummering + " om te bevestigen.", placeholder: d.bevestig.nummering, yes: "Herstarten" });
      if (typed === null) return;
      K.busy(nm, true, "Herstarten…");
      try { const r = await K.api("/api/onboarding", { json: { action: "testNummering", series: nodig.map(n => n.serie), confirm: typed.trim() } }); K.toast("Nummering herstart"); await again(K.c.ok("Herstart: " + r.herstart.map(h => K.esc(h.serie) + " → volgende " + K.esc(h.serie) + "-0001").join(" · ") + ".")); }
      catch (e) { fail(nm, e); }
    };
  }

  // G-03 : un re-rendu garde le focus (K.keep) ; un changement d'onglet le met sur le titre, un autre client sur sa fiche.
  function render(force) { return K.keep(page, () => draw(force)); }
  async function draw(force) {
    if (force || !D) { try { await load(); } catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content pt-20">' + K.c.error(err.message, true) + '</div>'; K.on(page, "click", "[data-retry]", e => { e.preventDefault(); render(true); }); return; } }
    if (!D.config) D.config = {};
    const views = { overzicht, aanvragen, klanten, producten, prijzen, journaal, bedrijf, toegang, status };
    if (force) rapCache = null;
    views[tab] ? await views[tab]() : overzicht();
    K.setBadges({ "beheer.html": D.status.aanvragen || 0, "aanvragen": D.status.aanvragen || 0 });
    S.load().catch(() => {}); // pastilles des commandes (cache 60 s partagé : pas d'appel en plus si déjà chargé)
    openFromUrl();
  }
  K.on(page, "click", "[data-new-client]", () => clientPanel(null));
  K.on(page, "click", "[data-new-product]", () => productPanel(null));
  window.addEventListener("hashchange", () => {
    if (K.hashParams().path === "rapportage") { location.replace("/beheer/rapportage"); return; }
    const h = K.hashParams(), prevTab = tab, prevSel = sel; tab = h.path || "overzicht"; if (h.params.klant) sel = h.params.klant;
    render().then(() => { if (tab !== prevTab) K.focusTitle(page, null, { scroll: true }); else if (sel !== prevSel) K.focusTitle(page, "#detail h2", { scroll: true }); });
  });
  page.innerHTML = '<div class="page-h"><h1 class="h1">Beheer</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  render(true);
})();
