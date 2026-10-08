/* « Vandaag » (specs/024-eenvoudig-beheer) : het scherm van de zaakvoerder. Bestellingen ontvangen en per stap
   één tik verder (Klaar → Onderweg → Geleverd → Betaald), zonder Magazijn of Leveringen. Elke stap is de
   bestaande /api/updateorder (de server beslist) ; de regels van het scherm staan in assets/vandaag.js. */
(async function () {
  K.session.set("famoVandaagStart", true); // Bestellingen niet meer hierheen sturen in dit tabblad
  if (!(await K.requireStaff())) return;
  const V = window.FamoVandaag;
  const page = K.shell({ searchPlaceholder: "Zoek bestelling of klant…" });
  const LABEL = { alle: "Alles", nieuw: "Nieuw", klaar: "Klaar", onderweg: "Onderweg", geleverd: "Geleverd" };
  const GO = { klaar: ["check", "Klaar"], onderweg: ["truck", "Onderweg"], geleverd: ["check", "Geleverd"], betaald: ["check", "Betaald"] };
  let filter = K.store.get("famoVdFilter", "alle"); if (!LABEL[filter]) filter = "alle";
  const errs = {}; // fout van de server per bestelling, op de kaart getoond tot de volgende geslaagde stap
  let seenNew = null; // ids « Nieuw » al gezien : een nieuwe = signaal
  const admin = () => K.staff.isAdmin();
  const opts = () => ({ admin: admin(), lotsVerplicht: !!(S.config && S.config.lotsVerplicht) });
  const sound = () => K.store.get("famoVdSound", true) !== false;
  let meldLocal = null, loaded = false; // meldLocal : ce navigateur a un abonnement push (null = pas encore regardé)

  // Kort signaal (Web Audio, geen bestand) ; stil als de browser het weigert.
  function ping() {
    if (!sound()) return;
    try { const A = window.AudioContext || window.webkitAudioContext; const a = new A(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.18); setTimeout(() => a.close(), 400); } catch (e) { /* geen geluid mogelijk */ }
  }
  const say = msg => { const el = page.querySelector("#vdLive"); if (el) el.textContent = msg; };

  function card(o) {
    const st = V.next(o, opts()), late = V.late(o, K.today()), tel = o.klant && o.klant.tel, wa = V.waLink(tel), g = V.group(o);
    const go = st ? '<button type="button" class="btn btn-p vd-go" data-go="' + K.esc(o.id) + '">' + K.icon(GO[st.key][0]) + '<span>' + K.esc(GO[st.key][1]) + '</span></button>'
      : '<span class="vd-done">' + K.esc(g === "geleverd" ? "Geleverd · te innen" : K.status(o.statut)) + '</span>';
    return '<article class="vd-card vd-' + g + '" id="o-' + K.esc(o.id) + '" aria-labelledby="h-' + K.esc(o.id) + '">' +
      '<div class="vd-top"><h2 class="vd-cl" id="h-' + K.esc(o.id) + '">' + K.esc(o.client) + '</h2><b class="mono vd-sum">' + K.eur(o.total) + '</b></div>' +
      '<div class="vd-meta">' + K.stChip(o.statut, LABEL[g]) + '<span class="tag">' + K.esc(K.relDay(o.day)) + '</span>' + (late ? '<span class="chip st-late"><i></i>Te laat</span>' : "") + (o.leverslot ? S.slotTag(o) : "") + '<span class="quiet mono fs-12">' + K.esc(o.ref) + '</span></div>' +
      '<p class="vd-lines">' + K.esc(S.lineTxt(o)) + '</p>' + (o.notes ? '<p class="vd-note"><b>Nota</b> ' + K.esc(o.notes) + '</p>' : "") +
      (errs[o.id] ? '<div class="notice err" role="alert"><i>!</i><div>' + K.esc(errs[o.id]) + '</div></div>' : "") +
      '<div class="vd-act">' + go +
      (tel ? '<a class="btn btn-o vd-ic" href="' + K.esc(V.telHref(tel)) + '" aria-label="' + K.esc("Bellen: " + o.client) + '">' + K.icon("phone") + '</a>' : "") +
      (wa ? '<a class="btn btn-o vd-ic vd-wa" href="' + K.esc(wa) + '" target="_blank" rel="noopener" aria-label="' + K.esc("WhatsApp: " + o.client) + '">WA</a>' : "") +
      '<button type="button" class="btn btn-o vd-ic" data-more="' + K.esc(o.id) + '" aria-label="' + K.esc("Meer acties: " + o.client) + '" aria-haspopup="dialog">⋯</button></div></article>';
  }

  function draw() {
    const c = V.counts(S.orders), list = V.list(S.orders, filter);
    const nieuw = V.list(S.orders, "nieuw").map(o => o.id);
    if (seenNew && nieuw.some(id => !seenNew.has(id))) ping();
    seenNew = new Set(nieuw);
    const invite = K.modus() !== "eenvoudig" && !K.store.get("famoVdInvite", false)
      ? '<div class="notice vd-invite"><div><b>Altijd op Vandaag openen op dit toestel?</b><div class="quiet fs-12">Kort menu, alles op één scherm. Terug te zetten via het tandwiel bovenaan.</div></div><div class="d-flex gap-8"><button type="button" class="btn btn-p btn-sm" data-invite="ja">Ja</button><button type="button" class="btn btn-o btn-sm" data-invite="nee">Nee</button></div></div>' : "";
    // Pushmeldingen (specs/025) : une seule invitation, sur un appareil qui n'est pas encore inscrit.
    const meldInvite = !invite && meldLocal === false && !K.store.get("famoVdMeldInvite", false)
      ? '<div class="notice vd-invite"><div><b>Een melding bij elke nieuwe bestelling?</b><div class="quiet fs-12">Op dit toestel, ook als FAMO gesloten is.</div></div><div class="d-flex gap-8"><button type="button" class="btn btn-p btn-sm" data-meld-open>Instellen</button><button type="button" class="btn btn-o btn-sm" data-meld-later>Later</button></div></div>' : "";
    page.innerHTML = '<div class="page-h"><div><h1 class="h1">Vandaag</h1><p class="sub">' + K.esc(K.dateLong(K.today())) + ' · ' + K.plural(c.alle, "bestelling", "bestellingen") + ' te doen</p></div><span class="spacer"></span>' +
      '<button type="button" class="btn btn-o" id="vdMeld" aria-haspopup="dialog">' + K.icon("bell") + 'Meldingen</button>' +
      '<button type="button" class="btn btn-p" id="vdNew">' + K.icon("plus") + 'Bestelling</button></div>' +
      '<div class="content pt-14 stack-12">' + invite + meldInvite +
      '<div class="opt vd-filter" role="group" aria-label="Toon">' + Object.keys(LABEL).map(k => '<button type="button" data-filter="' + k + '" aria-pressed="' + (k === filter) + '"' + (k === filter ? ' class="on"' : "") + '>' + LABEL[k] + ' <b>' + c[k] + '</b></button>').join("") + '</div>' +
      (list.length ? '<div class="vd-list">' + list.map(card).join("") + '</div>'
        : '<div class="state"><div class="ic">' + K.icon("check") + '</div><b>Alles is bijgewerkt</b><p class="muted">' + (filter === "alle" ? "Geen bestellingen te doen." : "Niets in „" + LABEL[filter] + "”.") + '</p><button type="button" class="btn btn-p mt-6" data-new>' + K.icon("plus") + 'Bestelling ingeven</button></div>') +
      '<p class="vd-live" id="vdLive" role="status" aria-live="polite"></p></div>';
  }
  const render = () => K.keep(page, draw);
  // Après une étape, le bouton désactivé pendant l'envoi a perdu le focus : on le rend à la même commande
  // (son étape suivante, sinon son menu ⋯, sinon le filtre) — clavier et lecteur d'écran restent sur place.
  const refocus = id => { const t = page.querySelector('[data-go="' + CSS.escape(id) + '"]') || page.querySelector('[data-more="' + CSS.escape(id) + '"]') || page.querySelector(".vd-filter .on"); if (t) try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ } };

  // Eén tik = één stap. Betaald : eerst de betaalwijze ; Lots verplicht : eerst het lotpaneel.
  async function go(o, btn) {
    const st = V.next(o, opts()); if (!st) return;
    if (st.panel === "validate") { S.validatePanel(o, render); return; }
    let payload = st.payload;
    if (st.panel === "mode") { const mode = await S.askMode("Betaald", o.client + " · " + (o.factuurnummer || o.ref) + " · " + K.eur(S.totals(o).incl) + " incl. btw"); if (!mode) return; payload = V.payPayload(mode); }
    K.busy(btn, true, st.label + "…");
    try {
      const d = await S.update(o.id, payload);
      delete errs[o.id];
      const msg = o.client + " · " + st.label + (st.key === "geleverd" && d && d.factuurnummer ? " · factuur " + d.factuurnummer : "") + S.mailTxt(d && d.mail);
      say(msg); render(); refocus(o.id);
      const u = V.undo(st.key, opts());
      K.toast(msg, u ? { action: "Ongedaan maken", ms: 6000, onAction: async () => {
        try { await S.update(o.id, u); say(o.client + " · terug"); K.toast(o.client + " · stap ongedaan gemaakt"); render(); refocus(o.id); } catch (err) { K.toast(err.message, { kind: "err" }); }
      } } : undefined);
    } catch (err) {
      // Geen netwerk bij Geleverd : de bestaande wachtrij (H-12), verstuurd zodra er netwerk is.
      if (err.network && st.key === "geleverd" && S.queue) { const q = S.queue.add({ orderId: o.id, ref: o.ref, body: Object.assign({ id: o.id }, payload), proofs: [] }); if (q.ok) { S.queueBadge(); K.toast("Geen netwerk · levering in wachtrij"); K.busy(btn, false); return; } }
      errs[o.id] = err.network ? "Geen verbinding. Probeer opnieuw." : err.message;
      try { await S.load(true); } catch (e2) { /* toon wat we hebben */ }
      render(); refocus(o.id);
    }
  }

  // Aantallen wijzigen (vóór vertrek) : de server herrekent prijzen en totaal.
  function editLines(o) {
    const lines = K.parseLines(o.lignes).map(l => Object.assign({}, l));
    const isKg = u => /kg/i.test(u || "");
    const p = K.panel({ title: "Aantallen wijzigen", sub: o.client + " · " + o.ref, body: '<div class="card">' + lines.map((l, i) => '<div class="line vd-pl"><div class="minw-0"><b>' + K.esc(l.name) + '</b><div class="quiet fs-12">' + K.esc(K.unit(l.unit)) + '</div></div>' + K.c.stepper("l" + i, l.qty, { step: isKg(l.unit) ? 0.5 : 1, name: l.name }) + '</div>').join("") + '</div><p class="quiet fs-125">0 = artikel schrappen. Prijs en totaal worden op de server herberekend.</p><div id="lErr"></div>',
      footer: '<button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="lOk">Opslaan</button>' });
    K.$$(".stepper", p.el).forEach(st => {
      const i = +st.dataset.stepper.slice(1), inp = st.querySelector("input"), step = isKg(lines[i].unit) ? 0.5 : 1;
      const set = v => { v = Math.max(0, isKg(lines[i].unit) ? Math.round(v * 1000) / 1000 : Math.round(v)); lines[i].qty = v; inp.value = K.num(v); st.classList.toggle("on", v > 0); };
      st.querySelector("[data-dec]").onclick = () => set((K.parseNum(inp.value) || 0) - step);
      st.querySelector("[data-inc]").onclick = () => set((K.parseNum(inp.value) || 0) + step);
      inp.addEventListener("change", () => set(K.parseNum(inp.value) || 0));
    });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    p.el.querySelector("#lOk").onclick = async () => {
      const kept = lines.filter(l => l.qty > 0);
      if (!kept.length) { p.el.querySelector("#lErr").innerHTML = K.c.error("Minstens één artikel. Of annuleer de bestelling via ⋯ → Corrigeren."); return; }
      const payload = V.editPayload(o, kept.map(K.formatLine).join("\n")); if (!payload) { p.close(); return; }
      const btn = p.el.querySelector("#lOk"); K.busy(btn, true, "Opslaan…");
      try { await S.update(o.id, payload); p.markClean && p.markClean(); p.close(); K.toast("Aantallen aangepast · " + o.client); render(); }
      catch (err) { p.el.querySelector("#lErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  }

  // ⋯ : alles wat geen dagelijkse stap is, in klare taal.
  function more(o) {
    const g = V.group(o), tel = o.klant && o.klant.tel, wa = V.waLink(tel);
    const item = (act, icon, label, hint) => '<button type="button" class="vd-mi" data-mi="' + act + '">' + K.icon(icon) + '<span><b>' + K.esc(label) + '</b>' + (hint ? '<small>' + K.esc(hint) + '</small>' : "") + '</span></button>';
    const p = K.panel({ title: o.client, sub: o.ref + " · " + K.status(o.statut) + " · " + K.eur(o.total), width: "460px", body: '<div class="vd-menu">' +
      (g === "onderweg" ? item("deliver", "check", "Geleverd met naam of handtekening", "Wie nam aan, handtekening, foto") : "") +
      (g === "nieuw" || g === "klaar" ? item("lines", "list", "Aantallen wijzigen", "Vóór vertrek") + item("edit", "cal", "Leverdag of nota wijzigen", "") : "") +
      item("bon", "doc", g === "geleverd" ? "Factuur / pro forma" : "Leveringsbon", "Bekijken, afdrukken of delen") +
      (tel ? '<a class="vd-mi" href="' + K.esc(V.telHref(tel)) + '">' + K.icon("phone") + '<span><b>Bellen</b><small>' + K.esc(tel) + '</small></span></a>' : "") +
      (wa ? '<a class="vd-mi" href="' + K.esc(wa) + '" target="_blank" rel="noopener">' + K.icon("mail") + '<span><b>WhatsApp</b><small>' + K.esc(tel) + '</small></span></a>' : "") +
      item("correct", "back", "Corrigeren of annuleren", "Stap terug, annuleren met reden") +
      '<a class="vd-mi" href="/team/bestelling?id=' + encodeURIComponent(o.id) + '">' + K.icon("ext") + '<span><b>Volledige fiche</b><small>Journaal, documenten, creditnota</small></span></a></div>' });
    K.on(p.el, "click", "[data-mi]", (e, t) => {
      const a = t.dataset.mi; p.close();
      if (a === "deliver") S.confirmDelivery(o, render);
      else if (a === "lines") editLines(o);
      else if (a === "edit") S.editPanel(o, render);
      else if (a === "bon") S.openDoc(o, g === "geleverd" ? "invoice" : "delivery");
      else if (a === "correct") S.correctPanel(o, render);
    });
  }

  // ---- Meldingen (specs/025-pushmeldingen) : een melding op DIT toestel bij elke nieuwe bestelling ----------
  // Toestand : V.pushState (assets/vandaag.js). Op de iPhone moet subscribe() rechtstreeks uit de tik komen :
  // sleutel en service worker worden vooraf geladen bij het openen van het venster, niets wacht ervoor.
  const M = { state: "", reg: null, key: "", sub: null, server: false, err: "" };
  const env = () => ({
    ios: V.isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    standalone: !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true),
    sw: "serviceWorker" in navigator, push: "PushManager" in window, notification: "Notification" in window,
    permission: "Notification" in window ? window.Notification.permission : "default", server: M.server
  });
  const b64u = buf => btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buf)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const usedKey = sub => (sub && sub.options && sub.options.applicationServerKey ? b64u(sub.options.applicationServerKey) : M.key);
  const swReady = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("De app is nog niet klaar. Herlaad de pagina en probeer opnieuw.")), 8000))]);
  async function prepare() {
    M.err = ""; M.state = V.pushState(env());
    if (M.state === "installeren" || M.state === "geen") return;
    try {
      if (!(await navigator.serviceWorker.getRegistration("/"))) await navigator.serviceWorker.register("/sw.js");
      const both = await Promise.all([swReady(), K.api("/api/push")]);
      M.reg = both[0]; M.key = both[1].publicKey;
      let sub = await M.reg.pushManager.getSubscription();
      // Abonnement gemaakt met een oude sleutel : ontvangt nooit meer iets, dus lokaal opruimen (opnieuw aanzetten volstaat).
      if (sub && !V.sameKey(sub.options && sub.options.applicationServerKey, M.key)) { try { await sub.unsubscribe(); } catch (e) { /* al weg */ } sub = null; }
      M.sub = sub;
      M.server = sub ? !!(await K.api("/api/push", { json: { action: "status", endpoint: sub.endpoint } })).aan : false;
    } catch (err) { M.err = err.message; }
    M.state = V.pushState(env()); meldLocal = M.state === "aan" ? true : meldLocal;
  }
  function meldBody() {
    const st = M.state, btn = (act, cls, label) => '<button type="button" class="btn ' + cls + '" data-meld="' + act + '">' + label + '</button>';
    let top;
    if (st === "aan") top = K.c.ok("<b>Meldingen staan aan op dit toestel.</b> Bij elke nieuwe bestelling (klantportaal of e-mail) verschijnt er een melding, ook als FAMO gesloten is.") +
      '<div class="d-flex gap-8 f-wrap">' + btn("test", "btn-p", K.icon("bell") + "Test sturen") + btn("uit", "btn-o", "Uitzetten") + '</div>';
    else if (st === "uit") top = '<p class="m-0">Meldingen staan uit op dit toestel. Zet ze aan om een nieuwe bestelling meteen te zien, ook \'s avonds.</p>' +
      '<div>' + btn("aan", "btn-p", K.icon("bell") + "Aanzetten") + '</div><p class="quiet fs-12 m-0">Het toestel vraagt eerst toestemming: kies „Sta toe”.</p>';
    else if (st === "installeren") top = '<p class="m-0"><b>Op de iPhone werken meldingen enkel vanuit de FAMO-app op het beginscherm.</b></p><ol class="vd-steps">' +
      '<li>Tik in Safari op <b>Deel</b> (het vierkantje met de pijl omhoog).</li><li>Kies <b>Zet op beginscherm</b> en tik op <b>Voeg toe</b>.</li>' +
      '<li>Open FAMO via het nieuwe icoon, ga naar Vandaag → Meldingen en tik op <b>Aanzetten</b>.</li></ol><p class="quiet fs-12 m-0">Vereist iOS 16.4 of nieuwer.</p>';
    else if (st === "geweigerd") top = K.c.warn("<b>Meldingen zijn geweigerd voor FAMO op dit toestel.</b> iPhone: Instellingen → Meldingen → FAMO → Sta meldingen toe. Computer: klik op het slotje links van het adres → Meldingen → Toestaan. Open daarna dit venster opnieuw.");
    else if (st === "geen") top = K.c.warn(env().ios ? "<b>Deze iPhone ondersteunt nog geen meldingen.</b> Werk bij naar iOS 16.4 of nieuwer (Instellingen → Algemeen → Software-update)." : "<b>Deze browser ondersteunt geen meldingen.</b> Vandaag toont nieuwe bestellingen wel zolang het open staat, met geluid.");
    else top = K.c.skeleton(1);
    return top + (M.err ? K.c.error(M.err) : "") +
      '<div class="vd-row"><div><b>Geluid in de app</b><div class="quiet fs-12">Kort signaal bij een nieuwe bestelling terwijl Vandaag open staat.</div></div>' + K.c.check(sound(), 'id="vdSnd"', { big: true, label: "Geluid in de app" }) + '</div>';
  }
  async function meldingen() {
    K.store.set("famoVdMeldInvite", true);
    const p = K.panel({ title: "Meldingen", sub: "Op dit toestel", width: "460px", body: '<div class="stack-12" id="vdMeldBox" aria-live="polite">' + meldBody() + '</div>', onClose: render });
    const box = p.el.querySelector("#vdMeldBox");
    const paint = focusAct => {
      box.innerHTML = meldBody();
      const t = focusAct && box.querySelector('[data-meld="' + focusAct + '"]'); if (t) try { t.focus(); } catch (e) { /* ignore */ }
    };
    box.addEventListener("click", async e => {
      const snd = e.target.closest("#vdSnd");
      if (snd) { K.store.set("famoVdSound", !sound()); K.setOn(snd, sound()); say(sound() ? "Geluid aan" : "Geluid uit"); return; }
      const b = e.target.closest("[data-meld]"); if (!b || b.disabled) return;
      const act = b.dataset.meld; M.err = "";
      if (act === "aan") {
        let sub;
        if (!M.reg || !M.key) { K.busy(b, true, "Laden…"); await prepare(); if (!M.err && M.state === "uit") M.err = "Nog niet klaar. Tik nogmaals op Aanzetten."; paint("aan"); return; }
        K.busy(b, true, "Aanzetten…");
        // Eerste stap = subscribe() : geen enkele await ervoor (iPhone).
        try { sub = await M.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: V.keyBytes(M.key) }); }
        catch (err) { M.state = V.pushState(env()); if (M.state !== "geweigerd") M.err = "Aanzetten lukte niet: " + (err.message || err); paint("aan"); return; }
        try {
          await K.api("/api/push", { json: { action: "subscribe", subscription: sub.toJSON(), sleutel: usedKey(sub) } });
          M.sub = sub; M.server = true; meldLocal = true; K.toast("Meldingen staan aan op dit toestel");
        } catch (err) { try { await sub.unsubscribe(); } catch (e2) { /* al weg */ } M.err = err.message; }
        M.state = V.pushState(env()); paint(M.state === "aan" ? "test" : "aan");
      } else if (act === "uit") {
        K.busy(b, true, "Uitzetten…");
        const sub = M.sub || (M.reg && await M.reg.pushManager.getSubscription());
        // Eerst de server (anders blijft hij versturen) ; mislukt dat, dan ruimt de meldingsdienst het op (404/410).
        if (sub) { try { await K.api("/api/push", { json: { action: "unsubscribe", endpoint: sub.endpoint } }); } catch (err) { /* zie hierboven */ } try { await sub.unsubscribe(); } catch (err) { /* al weg */ } }
        M.sub = null; M.server = false; meldLocal = false; M.state = V.pushState(env());
        K.toast("Meldingen uit op dit toestel"); paint("aan");
      } else if (act === "test") {
        K.busy(b, true, "Versturen…");
        try { await K.api("/api/push", { json: { action: "test", endpoint: M.sub.endpoint } }); K.toast("Test verstuurd. De melding komt binnen enkele seconden."); say("Test verstuurd"); }
        catch (err) { if (err.status === 404 || err.status === 410) { M.server = false; M.state = V.pushState(env()); } M.err = err.message; }
        paint(M.state === "aan" ? "test" : "aan");
      }
    });
    await prepare();
    if (document.body.contains(p.el)) paint();
  }

  // + Bestelling : klant → artikelen → plaatsen, zelfde weg als Invoeren (/api/staff, de server beslist).
  async function newOrder() {
    let clients = [], products = [], clientId = "", items = {}, q = "", bron = "Telefoon";
    const p = K.panel({ title: "Nieuwe bestelling", sub: "Voor een klant die belt of appt", width: "560px", body: '<div id="nb">' + K.c.skeleton(2) + '</div>',
      footer: '<span class="mono mr-auto fw-600" id="nbSum"></span><button type="button" class="btn btn-o" data-cancel>Annuleren</button><button type="button" class="btn btn-p" id="nbOk" disabled>Plaatsen</button>' });
    p.el.querySelector("[data-cancel]").onclick = p.close;
    const byId = id => products.find(x => x.id === id);
    const total = () => Object.entries(items).reduce((s, [id, v]) => s + (byId(id) ? byId(id).prix * v : 0), 0);
    // Vaak besteld door deze klant eerst (uit de geladen bestellingen), dan de catalogusvolgorde.
    const usual = () => { const n = {}; S.orders.filter(o => o.clientId === clientId).forEach(o => K.parseLines(o.lignes).forEach(l => { const k = l.name.toLowerCase(); n[k] = (n[k] || 0) + 1; })); return n; };
    const isKg = x => /kg/i.test(x.unite || "");
    function body() {
      const u = usual(), list = products.filter(x => !q || (x.nom + " " + (x.kaliber || "")).toLowerCase().includes(q)).sort((a, b) => (u[b.nom.toLowerCase()] || 0) - (u[a.nom.toLowerCase()] || 0) || K.byVolgorde(a, b));
      return K.c.field("Klant", '<select class="input" id="nbClient"><option value="">— Kies een klant —</option>' + clients.map(c => '<option value="' + K.esc(c.id) + '"' + (c.id === clientId ? " selected" : "") + '>' + K.esc(c.nom) + '</option>').join("") + '</select>', { id: "fNbClient" }) +
        K.c.field("Via", '<div class="opt" role="group" aria-label="Via">' + ["Telefoon", "WhatsApp", "E-mail", "Toonbank"].map(b => '<button type="button" data-bron="' + b + '" aria-pressed="' + (b === bron) + '"' + (b === bron ? ' class="on"' : "") + '>' + b + '</button>').join("") + '</div>', {}) +
        (clientId ? '<label class="search mt-6">' + K.icon("search") + '<input id="nbQ" placeholder="Zoek product…" value="' + K.esc(q) + '" aria-label="Zoek product" autocomplete="off"></label><div class="card mt-6">' +
          (list.length ? list.map(x => { const k = K.pakOf(x), n = K.pakStep(x), v = items[x.id] || 0; return '<div class="line vd-pl"><div class="minw-0"><b>' + K.esc(x.nom) + '</b>' + (u[x.nom.toLowerCase()] ? ' <span class="tag">vaak</span>' : "") + '<div class="quiet fs-12">' + K.esc(K.eur(x.prix) + " / " + K.unit(x.unite) + (k ? " · " + K.pakOne(k, x.unite, "nl") + (k.only ? ", enkel per " + k.label : "") : "")) + '</div></div>' + (n > 1 ? K.c.stepper(x.id, v / n, { step: 1, name: x.nom, suffix: k.label, label: "Aantal (" + K.pakOne(k, x.unite, "nl") + ")" }) : K.c.stepper(x.id, v, { step: isKg(x) ? 0.5 : 1, name: x.nom })) + '</div>'; }).join("") : '<div class="empty m-12">Geen product gevonden.</div>') + '</div>' : "") +
        '<p class="quiet fs-125">Leverdag: de eerstvolgende leverdag volgens de regels (aan te passen via ⋯ → Leverdag). Prijzen van de klant, op de server berekend.</p><div id="nbErr"></div>';
    }
    function draw() {
      const box = p.el.querySelector("#nb"); box.innerHTML = body();
      p.el.querySelector("#nbSum").textContent = total() > 0 ? K.eur(total()) + " excl. btw" : "";
      p.el.querySelector("#nbOk").disabled = !(clientId && total() > 0);
      box.querySelector("#nbClient").onchange = async e => {
        clientId = e.target.value; items = {}; products = []; draw();
        if (clientId) { try { const d = await K.api("/api/staff?client=" + encodeURIComponent(clientId)); products = (d.products || []).slice(); } catch (err) { box.querySelector("#nbErr").innerHTML = K.c.error(err.message); } draw(); }
      };
      K.$$("[data-bron]", box).forEach(b => { b.onclick = () => { bron = b.dataset.bron; draw(); }; });
      const qi = box.querySelector("#nbQ"); if (qi) qi.addEventListener("input", () => { q = qi.value.toLowerCase(); const pos = qi.selectionStart; draw(); const n2 = p.el.querySelector("#nbQ"); n2.focus(); n2.setSelectionRange(pos, pos); });
      K.$$(".stepper", box).forEach(st => {
        const id = st.dataset.stepper, inp = st.querySelector("input"), x = byId(id); if (!x) return;
        const n = K.pakStep(x), step = n > 1 ? 1 : isKg(x) ? 0.5 : 1;
        const set = sv => { const v = n > 1 ? Math.max(0, Math.round(sv)) * n : Math.max(0, isKg(x) ? Math.round(sv * 1000) / 1000 : Math.round(sv)); if (v > 0) items[id] = v; else delete items[id]; draw(); const again = p.el.querySelector('[data-stepper="' + CSS.escape(id) + '"] [data-inc]'); if (again) again.focus(); };
        st.querySelector("[data-dec]").onclick = () => set((K.parseNum(inp.value) || 0) - step);
        st.querySelector("[data-inc]").onclick = () => set((K.parseNum(inp.value) || 0) + step);
        inp.addEventListener("change", () => set(K.parseNum(inp.value) || 0));
      });
    }
    try { const d = await K.api("/api/staff"); clients = d.clients || []; draw(); }
    catch (err) { p.el.querySelector("#nb").innerHTML = K.c.error(err.message); }
    p.el.querySelector("#nbOk").onclick = async () => {
      const btn = p.el.querySelector("#nbOk"); K.busy(btn, true, "Plaatsen…");
      try {
        const d = await K.api("/api/staff", { json: { clientId, bron, notes: "", dateLivraison: "", items: Object.entries(items).filter(([, v]) => v > 0).map(([productId, quantity]) => ({ productId, quantity })) } });
        p.markClean && p.markClean(); p.close(); S.invalidate(); await S.load(true); filter = "alle"; render();
        K.toast("Bestelling " + d.ref + " geplaatst"); say("Bestelling " + d.ref + " geplaatst");
      } catch (err) { p.el.querySelector("#nbErr").innerHTML = K.c.error(err.message); K.busy(btn, false); }
    };
  }

  K.on(page, "click", "[data-go]", (e, t) => { const o = S.byId(t.dataset.go); if (o) go(o, t); });
  K.on(page, "click", "[data-more]", (e, t) => { const o = S.byId(t.dataset.more); if (o) more(o); });
  K.on(page, "click", "[data-filter]", (e, t) => { filter = t.dataset.filter; K.store.set("famoVdFilter", filter); render(); });
  K.on(page, "click", "#vdNew, [data-new]", () => newOrder());
  K.on(page, "click", "#vdMeld, [data-meld-open]", () => meldingen());
  K.on(page, "click", "[data-meld-later]", () => { K.store.set("famoVdMeldInvite", true); render(); });
  K.on(page, "click", "[data-invite]", (e, t) => { K.store.set("famoVdInvite", true); if (t.dataset.invite === "ja") { K.setModus("eenvoudig"); location.reload(); return; } render(); });

  page.innerHTML = '<div class="page-h"><h1 class="h1">Vandaag</h1></div><div class="content">' + K.c.skeleton(3) + '</div>';
  async function first(force) {
    try { await S.load(force); loaded = true; render(); return true; }
    catch (err) { if (err.status !== 401) page.innerHTML = '<div class="content pt-20">' + K.c.error(err.message, true) + '</div>'; return false; }
  }
  K.on(page, "click", "[data-retry]", async e => { e.preventDefault(); if (await first(true)) S.autoRefresh(render); });
  // Abonnement op dit toestel (lokaal, zonder server) : bepaalt enkel of de uitnodiging verschijnt.
  (async () => {
    try { const r = "serviceWorker" in navigator && "PushManager" in window ? await navigator.serviceWorker.getRegistration("/") : null; meldLocal = !!(r && (await r.pushManager.getSubscription())); }
    catch (e) { meldLocal = true; /* onbekend : geen uitnodiging */ }
    if (loaded) render();
  })();
  if (await first()) S.autoRefresh(render);
})();
