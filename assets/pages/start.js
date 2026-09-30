(function () {
  const app = document.getElementById("app");
  const qs = new URLSearchParams(location.search), loggedOut = qs.get("uit") === "1", expired = qs.get("sessie") === "verlopen";
  // Leveringsregels (deadline, leverdagen) komen uit de publieke configuratie ; tot die geladen is gelden de standaardregels.
  const DEF = { deadline: "22:00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [] };
  let lev = DEF;
  app.innerHTML = '<div class="start">' +
    '<a class="skip" href="#main">' + K.t("Naar de inhoud") + '</a><header class="start-hd"><a class="brand" href="/"><span class="logo logo-lg" aria-hidden="true"></span><span><b>FAMO Seafood</b><small>' + K.t("Verse vis en zeevruchten, Antwerpen") + '</small></span></a>' +
    '<nav class="mini">' + K.langSwitch() + '<a class="tlink" href="/aanvraag.html">' + K.t("Toegang aanvragen") + '</a></nav></header>' +
    '<main class="start-body" id="main" tabindex="-1"><section class="hero"><h1 id="heroT"></h1>' +
    '<p id="hero"></p></section>' +
    '<form class="card login" id="loginForm" novalidate><div><h2 class="h2 login-t">' + K.t("Klantportaal") + '</h2><p class="sub">' + K.t("Aanmelden met uw gebruikersnaam") + '</p></div>' +
    (expired ? K.c.warn(K.t("Sessie verlopen, meld u opnieuw aan.")) : loggedOut ? K.c.ok(K.t("U bent afgemeld.")) : "") +
    K.c.field(K.t("Gebruikersnaam"), K.c.input("user", { attrs: ' autocomplete="username" autocapitalize="none" spellcheck="false" required' }), { id: "fUser", for: "user" }) +
    K.c.field(K.t("Wachtwoord"), '<div class="pwwrap">' + K.c.input("pw", { type: "password", attrs: ' autocomplete="current-password" required' }) + '<button type="button" class="btn btn-ghost btn-sm" id="togglePw" data-ux-exempt>' + K.t("Tonen") + '</button></div>', { id: "fPw", for: "pw" }) +
    '<div id="loginErr"></div>' +
    '<button type="submit" class="btn btn-p btn-lg" id="loginBtn">' + K.t("Aanmelden") + '</button>' +
    '<div class="login-links"><a class="tlink" href="/wachtwoord.html">' + K.t("Wachtwoord vergeten?") + '</a><a class="tlink" href="/aanvraag.html">' + K.t("Nog geen klant? Toegang aanvragen") + '</a></div></form></main>' +
    '<footer class="start-ft"><span class="quiet" id="foot">FAMO Seafood</span><nav class="mini" aria-label="' + K.t("Meer links") + '"><a class="tlink" href="/privacy.html">' + K.t("Privacy") + '</a><a class="tlink" href="/voorwaarden.html">' + K.t("Voorwaarden") + '</a><span class="ft-sep"></span><span>' + K.t("Werkt u bij Famo?") + '</span><a class="btn btn-o btn-sm" href="/personeel.html">' + K.t("Personeel") + '</a><a class="btn btn-o btn-sm" href="/beheer-login.html">' + K.t("Beheer") + '</a></nav></footer></div>';

  const KEYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  function daysLabel() {
    const days = (lev.leverdagen || DEF.leverdagen).filter(k => KEYS.includes(k)).sort((a, b) => (KEYS.indexOf(a) || 7) - (KEYS.indexOf(b) || 7));
    const idx = days.map(k => KEYS.indexOf(k) || 7), contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
    return days.length > 1 && contiguous ? K.t(days[0]) + "–" + K.t(days[days.length - 1]) : days.map(K.t).join(", ");
  }
  function draw() {
    document.getElementById("heroT").innerHTML = K.esc(K.tt("Vóór {t} besteld,", { t: lev.deadline || DEF.deadline })) + '<br>' + K.esc(K.t("morgen in uw keuken."));
    document.getElementById("hero").textContent = K.tt("Levering {d} in Antwerpen en omstreken. U ziet uw afgesproken prijzen, kiest zelf de leverdag en vindt uw leveringsbonnen en facturen terug.", { d: daysLabel() });
  }
  draw();
  K.api("/api/config?public=1").then(d => {
    const c = d.config || {};
    document.getElementById("foot").textContent = [c.bedrijfsnaam, c.adres, c.plaats, c.btw].filter(Boolean).join(", ");
    if (c.levering) { lev = Object.assign({}, DEF, c.levering); draw(); }
  }).catch(() => {});

  document.getElementById("togglePw").onclick = () => { const p = document.getElementById("pw"); p.type = p.type === "password" ? "text" : "password"; document.getElementById("togglePw").textContent = p.type === "password" ? K.t("Tonen") : K.t("Verbergen"); };
  document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const user = document.getElementById("user").value.trim(), pw = document.getElementById("pw").value;
    K.setErr("fUser", user ? "" : K.t("Vul uw gebruikersnaam in.")); K.setErr("fPw", pw ? "" : K.t("Vul uw wachtwoord in."));
    if (!user || !pw) return;
    const btn = document.getElementById("loginBtn"); K.busy(btn, true, K.t("Aanmelden…"));
    document.getElementById("loginErr").innerHTML = "";
    try {
      const d = await K.api("/api/catalogue", { json: { user, pw } });
      K.klant.set({ user, token: d.token, client: d.client, company: d.company });
      // Klant in het Frans (Clients.Taal) en nog geen taal gekozen op dit toestel : portaal meteen in het Frans.
      try { if (!localStorage.getItem("famoLang") && d.client && d.client.taal === "FR") localStorage.setItem("famoLang", "fr"); } catch (e) { /* privévenster */ }
      K.session.set("famoKlantCatalogus", { at: Date.now(), products: d.products, client: d.client, company: d.company });
      location.href = "/klant.html#/catalogus";
    } catch (err) {
      document.getElementById("loginErr").innerHTML = K.c.error(err.status === 401 ? K.t("Gebruikersnaam of wachtwoord klopt niet.") : err.message);
      K.busy(btn, false);
    }
  });
  const saved = K.klant.get(); if (saved && saved.user) { location.replace("/klant.html#/catalogus"); }
})();
