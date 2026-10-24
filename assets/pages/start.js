(function () {
  // Accueil public x30 « De avondtoonbank » (specs/037-x30-accueil). index.html porte la même page en néerlandais pour
  // Google et sans JavaScript ; ici elle est redessinée dans la langue choisie, avec le bandeau vivant et la connexion.
  // Rien d'inventé : heures et jours lus dans la configuration publique, aucun créneau tant qu'il n'y en a pas (FamoTij).
  const app = document.getElementById("app");
  const qs = new URLSearchParams(location.search), loggedOut = qs.get("uit") === "1", expired = qs.get("sessie") === "verlopen";
  const T = window.FamoTij;
  // Leveringsregels (deadline, leverdagen, gesloten dagen) komen uit de publieke configuratie ; tot die geladen is gelden de standaardregels.
  const DEF = { deadline: "22:00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [] };
  let lev = DEF, cfg = {};
  const e = K.esc;
  // Sjabloon met plaatshouders, de waarden vet : fill("Nog {n}", { n: "3 u" }) → "Nog <b>3 u</b>".
  const fill = (s, vars) => Object.entries(vars || {}).reduce((out, [k, v]) => out.split("{" + k + "}").join("<b>" + e(v) + "</b>"), e(K.t(s)));
  const svg = body => '<svg viewBox="0 0 200 120" aria-hidden="true" focusable="false">' + body + "</svg>";

  // Comptoir : aplats et formes dessinés pour FAMO (aucune photo), noms dans la langue de la page, nom latin en italique.
  // Ter illustratie : l'assortiment réel et les prix ne sont visibles qu'après connexion.
  const SHAPES = {
    zalm: '<path d="M8 70C40 30 120 18 192 40L184 96C120 112 50 108 8 70Z" fill="#E9836B"/><path d="M40 52c30 18 30 36 12 48M78 42c30 20 30 44 14 62M118 36c28 22 28 48 14 70M156 36c22 20 22 44 14 64" stroke="#F6C4B2" stroke-width="5" fill="none" stroke-linecap="round"/>',
    tonijn: '<rect x="18" y="26" width="168" height="82" rx="8" fill="#9E2B33"/><path d="M18 52H186M18 78H186" stroke="#B9474E" stroke-width="4"/><rect x="18" y="26" width="168" height="10" rx="5" fill="#7D1F27"/>',
    garnalen: '<path d="M30 92C20 40 80 10 140 26c36 10 50 40 36 66-12-22-36-34-64-30-28 4-50 22-54 44Z" fill="#E7957F"/><path d="M76 34l8 30M104 26l2 34M130 26l-6 34M152 36l-12 30" stroke="#F5C9BB" stroke-width="5" stroke-linecap="round"/><path d="M58 106l-18 10M58 106l8 12" stroke="#E7957F" stroke-width="6" stroke-linecap="round"/>',
    inktvis: '<g fill="none" stroke="#C4B193" stroke-width="12"><circle cx="58" cy="70" r="26"/><circle cx="120" cy="56" r="24"/><circle cx="160" cy="92" r="20"/></g>',
    octopus: '<ellipse cx="128" cy="40" rx="34" ry="28" fill="#9B5D74"/><g fill="none" stroke="#9B5D74" stroke-width="8" stroke-linecap="round"><path d="M102 58c-10 26-34 32-48 22"/><path d="M116 66c-4 28-20 40-36 38"/><path d="M140 66c4 28 20 40 36 38"/><path d="M156 56c12 22 30 26 38 14"/></g><g fill="#C99AAE"><circle cx="70" cy="84" r="3"/><circle cx="94" cy="100" r="3"/><circle cx="162" cy="100" r="3"/></g>',
    sintjakobs: '<path d="M100 112L40 52A70 70 0 0 1 160 52Z" fill="#E2B98A"/><path d="M100 108L58 44M100 108L78 28M100 108V22M100 108L122 28M100 108L142 44" stroke="#F3DCC0" stroke-width="4" stroke-linecap="round"/><path d="M82 104h36v12H82z" fill="#CF9A63"/>'
  };
  const PLATES = [["zalm", "Zalm", "Salmo salar"], ["tonijn", "Tonijn", "Thunnus"], ["garnalen", "Garnalen", "Penaeus"], ["inktvis", "Inktvis", "Loligo"], ["octopus", "Octopus", "Octopus vulgaris"], ["sintjakobs", "Sint-jakobsvrucht", "Pecten maximus"]];
  const ICON_WA = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19.1L4 20z"/><path d="M9 9.5c.5 2 2.5 4 4.5 4.5l1.2-1.2 2 .8v1.6c-4.4.6-8.8-3.8-8.2-8.2h1.6l.8 2z"/></svg>';

  const KEYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  function daysLabel() {
    const days = (lev.leverdagen || DEF.leverdagen).filter(k => KEYS.includes(k)).sort((a, b) => (KEYS.indexOf(a) || 7) - (KEYS.indexOf(b) || 7));
    const idx = days.map(k => KEYS.indexOf(k) || 7), contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
    return days.length > 1 && contiguous ? K.t(days[0]) + "–" + K.t(days[days.length - 1]) : days.map(K.t).join(", ");
  }
  const deadline = () => lev.deadline || DEF.deadline;

  app.innerHTML = '<div class="ac">' +
    '<a class="skip" href="#main">' + K.t("Naar de inhoud") + "</a>" +
    '<header class="ac-hd"><div class="ac-w ac-hd-in"><a class="brand ac-brand" href="' + K.langHref("/") + '"><span class="logo" aria-hidden="true"></span><span><b>FAMO Seafood</b><small>' + K.t("Verse vis en zeevruchten, Antwerpen") + "</small></span></a>" +
    '<nav class="ac-nav" aria-label="' + K.t("Taal en aanmelden") + '">' + K.langSwitch() + '<a class="btn ac-btn-light ac-hd-login" href="#aanmelden">' + K.t("Aanmelden") + "</a></nav></div></header>" +
    '<div class="ac-tide" id="tij"><div class="ac-w ac-tide-in"><span class="ac-dot" aria-hidden="true"></span><p id="tijT">' + e(K.tt("Bestel vóór {t} · levering {d}", { t: DEF.deadline, d: K.t("ma") + "–" + K.t("za") })) + '</p></div></div>' +
    '<main id="main" tabindex="-1">' +
    // Héros
    '<section class="ac-hero" aria-labelledby="heroT"><div class="ac-w ac-hero-in"><div class="ac-copy">' +
    '<p class="ac-eyebrow">' + K.t("Groothandel vis en zeevruchten · Antwerpen") + "</p>" +
    '<h1 class="ac-h1" id="heroT"></h1>' +
    '<p class="ac-lead"><span>' + K.t("Voor horeca, poke- en sushizaken.") + '</span> <span id="hero"></span></p>' +
    '<p class="ac-cta"><a class="btn ac-btn-light" href="#aanmelden">' + K.t("Aanmelden") + '</a><a class="btn ac-btn-ghost" href="/aanvraag">' + K.t("Klant worden") + "</a></p>" +
    '<dl class="ac-facts"><div><dt id="factT"></dt><dd>' + K.t("uiterste besteltijd, de avond vóór levering") + '</dd></div><div><dt id="factD"></dt><dd>' + K.t("levering in Antwerpen en omstreken") + "</dd></div></dl></div>" +
    '<figure class="ac-counter" aria-labelledby="counterCap"><ul class="ac-plates">' +
    PLATES.map(([k, nl, la]) => '<li class="ac-plate ac-c-' + k + '"><span class="ac-pn">' + K.t(nl) + '</span><i class="ac-la" lang="la">' + la + "</i>" + svg(SHAPES[k]) + "</li>").join("") +
    '</ul><figcaption id="counterCap">' + K.t("Ter illustratie. Het actuele aanbod en uw prijzen ziet u na het aanmelden.") + "</figcaption></figure></div></section>" +
    // Connexion + vraag : juste sous le héros (spec 038 : sur téléphone le formulaire était à 2 656 px, sous la vitrine).
    '<section class="ac-sec ac-meet" id="aanmelden" aria-label="' + K.t("Aanmelden") + '"><div class="ac-w ac-split">' +
    '<form class="ac-login" id="loginForm" novalidate><div><h2 class="ac-h3">' + K.t("Klantportaal") + '</h2><p class="sub">' + K.t("Aanmelden met uw gebruikersnaam") + "</p></div>" +
    (expired ? K.c.warn(K.t("Sessie verlopen, meld u opnieuw aan.")) : loggedOut ? K.c.ok(K.t("U bent afgemeld.")) : "") +
    K.c.field(K.t("Gebruikersnaam"), K.c.input("user", { attrs: ' autocomplete="username" autocapitalize="none" spellcheck="false" required' }), { id: "fUser", for: "user" }) +
    K.c.field(K.t("Wachtwoord"), '<div class="pwwrap">' + K.c.input("pw", { type: "password", attrs: ' autocomplete="current-password" required' }) + '<button type="button" class="btn btn-ghost" id="togglePw" aria-controls="pw">' + K.t("Tonen") + "</button></div>", { id: "fPw", for: "pw" }) +
    '<div id="loginErr"></div>' +
    '<button type="submit" class="btn btn-p btn-lg" id="loginBtn">' + K.t("Aanmelden") + "</button>" +
    '<div class="login-links"><a class="tlink" href="/wachtwoord">' + K.t("Wachtwoord vergeten?") + '</a><a class="tlink" href="/aanvraag">' + K.t("Nog geen klant? Toegang aanvragen") + "</a></div></form>" +
    '<div class="ac-help"><h2 class="ac-h3">' + K.t("Een vraag vanavond?") + "</h2><p>" + K.t("Bel of mail ons. Nog geen klant? Vraag toegang aan.") + "</p>" +
    '<div class="ac-contact" id="acContact"></div><a class="btn btn-o ac-join" href="/aanvraag">' + K.t("Klant worden") + "</a></div></div></section>" +
    // Identiteitskaart (voorbeeld)
    '<section class="ac-sec" aria-labelledby="idT"><div class="ac-w"><div class="ac-sec-hd"><h2 class="ac-h2" id="idT">' + K.t("Elk lot heeft een identiteitskaart") + "</h2>" +
    '<p class="ac-sub">' + K.t("Wetenschappelijke naam, herkomst, vistuig, staat en allergenen: per product in uw catalogus, per lot op uw leveringsbon. U ziet enkel wat echt ingevuld is.") + "</p></div>" +
    '<article class="ac-id" aria-labelledby="idName"><div class="ac-id-pl ac-c-tonijn"><span class="ac-ex">' + K.t("Voorbeeld") + "</span>" + svg(SHAPES.tonijn) + "</div>" +
    '<div class="ac-id-b"><h3 class="ac-id-n" id="idName">' + K.t("Tonijn, diepgevroren") + '</h3><p class="ac-id-la"><i lang="la">Thunnus albacares</i> · YFT</p>' +
    '<dl class="ac-spec"><div><dt>' + K.t("Herkomst") + "</dt><dd>" + K.t("Gevangen op zee, Westelijke Indische Oceaan (FAO 51)") + "</dd></div>" +
    "<div><dt>" + K.t("Vistuig") + "</dt><dd>" + K.t("Lijnen en haken") + "</dd></div>" +
    "<div><dt>" + K.t("Staat") + "</dt><dd>" + K.t("Diepgevroren") + "</dd></div>" +
    "<div><dt>" + K.t("Allergenen") + "</dt><dd>" + K.t("Vis") + "</dd></div>" +
    "<div><dt>" + K.t("Lot") + "</dt><dd>" + K.t("lotnummer, houdbaarheidsdatum en vangstdatum op de leveringsbon") + "</dd></div>" +
    '<div class="ac-spec-raw"><dt>' + K.t("Rauw te eten") + "</dt><dd>" + K.t("diepgevroren op −20 °C of kouder, minstens 24 uur in alle delen (behandeling tegen parasieten)") + "</dd></div></dl>" +
    '<p class="ac-note">' + K.t("Voorbeeld met fictieve waarden. De regel « Rauw te eten » verschijnt enkel als de vriesbehandeling voor dat product of lot geregistreerd is.") + "</p></div></article></div></section>" +
    // Zo werkt het (vandaag waar)
    '<section class="ac-sec" aria-labelledby="howT"><div class="ac-w"><div class="ac-sec-hd"><h2 class="ac-h2" id="howT">' + K.t("Zo werkt het") + "</h2></div>" +
    '<ol class="ac-steps"><li><span class="ac-n" aria-hidden="true">1</span><div><h3>' + K.t("Bestel in uw klantportaal") + "</h3><p>" + K.t("Uw afgesproken prijzen staan erbij. U kiest zelf de leverdag.") + "</p></div></li>" +
    '<li><span class="ac-n" aria-hidden="true">2</span><div><h3 id="step2T"></h3><p id="step2"></p></div></li>' +
    '<li><span class="ac-n" aria-hidden="true">3</span><div><h3>' + K.t("Bon en factuur in uw account") + "</h3><p>" + K.t("Leveringsbon en factuur vindt u terug bij uw bestellingen.") + "</p></div></li></ol></div></section>" +
    "</main>" + K.publicFooter() + "</div>";

  function contact() {
    const tel = cfg.telefoon || "", mail = cfg.email || "", wa = K.waLink(cfg.whatsapp);
    const item = (href, ico, big, small, ext) => '<a class="ac-cbtn" href="' + e(href) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + ico + "<span><b>" + e(big) + "</b><small>" + e(small) + "</small></span></a>";
    document.getElementById("acContact").innerHTML = [
      wa ? item(wa, ICON_WA, K.t("WhatsApp"), K.t("Stuur ons een bericht op WhatsApp"), true) : "",
      tel ? item("tel:" + K.telHref(tel), K.icon("phone"), tel, K.t("Bellen")) : "",
      mail ? item("mailto:" + mail, K.icon("mail"), mail, K.t("E-mail")) : ""
    ].join("");
  }
  function tide() {
    const p = T.plan(lev, new Date()), d = K.date(p.deliver), t = p.deadline;
    let html;
    if (p.mode === "countdown" && t >= "17:00") html = fill("Vanavond nog {n} om te bestellen · geleverd {d}", { n: T.duration(p.left, K.lang), d });
    else if (p.mode === "countdown") html = fill("Vandaag nog {n} om te bestellen · geleverd {d}", { n: T.duration(p.left, K.lang), d });
    else if (p.mode === "today") html = fill("Bestel vandaag vóór {t} · geleverd {d}", { t, d });
    else html = fill("Bestel vóór {o}, {t} · geleverd {d}", { o: K.date(p.orderBy), t, d });
    if (p.slot) html += " " + fill("tussen {van} en {tot}", p.slot);
    document.getElementById("tijT").innerHTML = html;
    document.getElementById("tij").classList.toggle("is-soon", p.soon);
  }
  function draw() {
    document.getElementById("heroT").innerHTML = e(K.tt("Vóór {t} besteld,", { t: deadline() })) + "<br><em>" + e(K.t("morgen in uw keuken.")) + "</em>";
    document.getElementById("hero").textContent = K.tt("Levering {d} in Antwerpen en omstreken. U ziet uw afgesproken prijzen, kiest zelf de leverdag en vindt uw leveringsbonnen en facturen terug.", { d: daysLabel() });
    document.getElementById("factT").textContent = deadline();
    document.getElementById("factD").textContent = daysLabel();
    document.getElementById("step2T").textContent = K.tt("Vóór {t} besteld", { t: deadline() });
    document.getElementById("step2").textContent = K.tt("Geleverd op de eerstvolgende leverdag: {d}, in Antwerpen en omstreken.", { d: daysLabel() });
    tide();
  }
  draw();
  setInterval(tide, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tide(); });
  K.api("/api/config?public=1").then(d => {
    cfg = (d && d.config) || {};
    K.fillPublicFooter(cfg);
    contact();
    if (cfg.levering) { lev = Object.assign({}, DEF, cfg.levering); draw(); }
  }).catch(() => {});

  // « Aanmelden » (en-tête, héros) : naar het formulier en de cursor in het veld Gebruikersnaam.
  const toLogin = smooth => {
    const sec = document.getElementById("loginForm"), user = document.getElementById("user");
    let calm = false; try { calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (err) { calm = false; }
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: smooth && !calm ? "smooth" : "auto", block: "start" });
    if (user && user.focus) user.focus({ preventScroll: true });
  };
  document.addEventListener("click", ev => { const a = ev.target && ev.target.closest && ev.target.closest('a[href="#aanmelden"]'); if (!a) return; ev.preventDefault(); toLogin(true); });
  if (expired || loggedOut || location.hash === "#aanmelden") setTimeout(() => toLogin(false), 0);

  document.getElementById("togglePw").onclick = () => { const p = document.getElementById("pw"); p.type = p.type === "password" ? "text" : "password"; document.getElementById("togglePw").textContent = p.type === "password" ? K.t("Tonen") : K.t("Verbergen"); };
  document.getElementById("loginForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const user = document.getElementById("user").value.trim(), pw = document.getElementById("pw").value;
    K.setErr("fUser", user ? "" : K.t("Vul uw gebruikersnaam in.")); K.setErr("fPw", pw ? "" : K.t("Vul uw wachtwoord in."));
    if (!user || !pw) return;
    const btn = document.getElementById("loginBtn"); K.busy(btn, true, K.t("Aanmelden…"));
    document.getElementById("loginErr").innerHTML = "";
    try {
      const d = await K.api("/api/catalogue", { json: { user, pw } });
      // De sessie zit in de HttpOnly-cookie die de server net zette ; hier enkel weergavegegevens.
      K.klant.set({ user, client: d.client });
      // Klant in het Frans (Clients.Taal) en nog geen taal gekozen op dit toestel : portaal meteen in het Frans.
      try { if (!localStorage.getItem("famoLang") && d.client && d.client.taal === "FR") localStorage.setItem("famoLang", "fr"); } catch (err) { /* privévenster */ }
      K.session.set("famoKlantCatalogus", { at: Date.now(), products: d.products, client: d.client, company: d.company });
      location.href = "/klant#/catalogus";
    } catch (err) {
      // 401 : un seul message, sans « Er ging iets mis. » devant (spec 038).
      document.getElementById("loginErr").innerHTML = err.status === 401 ? '<div class="notice err" role="alert"><i>!</i><div><b>' + K.t("Gebruikersnaam of wachtwoord klopt niet.") + "</b></div></div>" : K.c.error(err.message);
      K.busy(btn, false);
    }
  });
  const saved = K.klant.get(); if (saved && saved.user) { location.replace("/klant#/catalogus"); }
})();
