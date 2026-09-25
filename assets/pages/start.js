(function () {
  const app = document.getElementById("app");
  const denied = new URLSearchParams(location.search).get("uit") === "1";
  app.innerHTML = '<div class="start">' +
    '<header class="start-hd"><a class="brand" href="/"><span class="logo" style="width:36px;height:36px">F</span><span><b style="font-size:16px">FAMO Seafood</b><small>Verse vis en zeevruchten · Antwerpen</small></span></a>' +
    '<nav class="mini"><a href="/aanvraag.html">Toegang aanvragen</a></nav></header>' +
    '<main class="start-body"><section class="hero"><h1>Verse vis bestellen,<br>zo simpel als een berichtje.</h1><p>Bestel vandaag vóór 22:00 en wij leveren morgen in Antwerpen en omstreken. U ziet uw afgesproken prijzen, kiest zelf de leverdag en vindt uw leveringsbonnen en facturen terug in het portaal.</p>' +
    '<div class="proof" id="proof"></div></section>' +
    '<form class="card login" id="loginForm" novalidate><div><h2 class="h1" style="font-size:22px">Klantportaal</h2><p class="sub">Aanmelden met uw gebruikersnaam</p></div>' +
    (denied ? K.c.ok("U bent afgemeld.") : "") +
    K.c.field("Gebruikersnaam", K.c.input("user", { attrs: ' autocomplete="username" autocapitalize="none" spellcheck="false" required' }), { id: "fUser", for: "user" }) +
    K.c.field("Wachtwoord", '<div style="position:relative">' + K.c.input("pw", { type: "password", attrs: ' autocomplete="current-password" required style="padding-right:76px"' }) + '<button type="button" class="btn btn-ghost btn-sm" id="togglePw" style="position:absolute;right:4px;top:2px;min-height:40px">Tonen</button></div>', { id: "fPw", for: "pw" }) +
    '<div id="loginErr"></div>' +
    '<button type="submit" class="btn btn-p" id="loginBtn" style="min-height:50px;font-size:15px">Aanmelden</button>' +
    '<div style="display:flex;justify-content:space-between;font-size:13px;flex-wrap:wrap;gap:8px"><a href="/wachtwoord.html">Wachtwoord vergeten?</a><a href="/aanvraag.html">Nog geen klant? Toegang aanvragen</a></div></form></main>' +
    '<footer class="start-ft"><span class="quiet" style="font-size:12px" id="foot">FAMO Seafood</span><div class="mini"><span>Werkt u bij Famo?</span><a href="/personeel.html"><i style="background:#1F7A55"></i>Personeel</a><a href="/beheer-login.html"><i style="background:#B7791F"></i>Beheer</a></div></footer></div>';

  K.api("/api/config?public=1").then(d => {
    const c = d.config || {};
    document.getElementById("foot").textContent = [c.bedrijfsnaam, c.adres, c.plaats, c.btw].filter(Boolean).join(" · ");
  }).catch(() => {});
  document.getElementById("proof").innerHTML = '<div><b>22:00</b>besteldeadline</div><div><b>ma–za</b>levering, niet op zondag</div><div><b>Gratis</b>levering</div>';

  document.getElementById("togglePw").onclick = () => { const p = document.getElementById("pw"); p.type = p.type === "password" ? "text" : "password"; document.getElementById("togglePw").textContent = p.type === "password" ? "Tonen" : "Verbergen"; };
  document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const user = document.getElementById("user").value.trim(), pw = document.getElementById("pw").value;
    K.setErr("fUser", user ? "" : "Vul uw gebruikersnaam in."); K.setErr("fPw", pw ? "" : "Vul uw wachtwoord in.");
    if (!user || !pw) return;
    const btn = document.getElementById("loginBtn"); K.busy(btn, true, "Aanmelden…");
    document.getElementById("loginErr").innerHTML = "";
    try {
      const d = await K.api("/api/catalogue", { json: { user, pw } });
      K.klant.set({ user, pw, client: d.client, company: d.company });
      K.session.set("famoKlantCatalogus", { at: Date.now(), products: d.products, client: d.client, company: d.company });
      location.href = "/klant.html#/catalogus";
    } catch (err) {
      document.getElementById("loginErr").innerHTML = K.c.error(err.status === 401 ? "Gebruikersnaam of wachtwoord klopt niet." : err.message);
      K.busy(btn, false);
    }
  });
  const saved = K.klant.get(); if (saved && saved.user) { location.replace("/klant.html#/catalogus"); }
})();
