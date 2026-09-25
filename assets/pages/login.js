(function () {
  const cfg = window.__LOGIN || { want: "staff" };
  const admin = cfg.want === "admin";
  const app = document.getElementById("app");
  const denied = new URLSearchParams(location.search).get("denied") === "1";
  app.innerHTML = '<div class="lg"><div class="lg-left"><a class="brand" href="/" style="padding:0;color:#fff"><span class="logo" style="background:#fff;color:var(--p)">F</span><span><b>FAMO Seafood</b><small style="color:rgba(255,255,255,.75)">' + (admin ? "Beheer" : "Teamportaal") + '</small></span></a>' +
    '<div><h1>' + (admin ? "Klanten, producten, prijzen en instellingen." : "Klaarzetten, ronde rijden, ontvangst bevestigen.") + '</h1><p style="opacity:.85;margin:14px 0 0;font-size:15px">' + (admin ? "Enkel voor de zaakvoerder. Met de beheerderscode of uw persoonlijke PIN." : "Werkt op de tablet in het magazijn en op de telefoon in de wagen. Persoonlijke PIN of teamcode.") + '</p></div>' +
    '<div style="font-size:12px;opacity:.7">FAMO Seafood · Antwerpen</div></div>' +
    '<div class="lg-right"><form class="lg-form" id="f" novalidate><a href="/" style="font-size:13px">' + K.icon("back") + ' Kies een ander portaal</a>' +
    '<div><h2 class="h1" style="font-size:24px">' + (admin ? "Aanmelden als beheerder" : "Aanmelden als personeel") + '</h2><p class="sub">' + (admin ? "Voer de beheerderscode of uw PIN in" : "Voer de personeelscode of uw PIN in") + '</p></div>' +
    (denied ? K.c.warn("Deze pagina is enkel voor beheerders. Meld u aan met de beheerderscode.") : "") +
    K.c.field(admin ? "Beheerderscode of PIN" : "Personeelscode of PIN", K.c.input("code", { type: "password", attrs: ' autocomplete="current-password" inputmode="text" required style="font-size:20px;letter-spacing:.2em"' }), { id: "fCode", for: "code", hint: "Een persoonlijke PIN meldt u aan op naam; die naam staat dan in het logboek van correcties." }) +
    '<div id="err"></div><button type="submit" class="btn btn-p" id="btn" style="min-height:50px;font-size:15px">Aanmelden</button>' +
    '<div class="quiet" style="font-size:12.5px">' + (admin ? "Personeel? " : "Code of PIN kwijt? Vraag de beheerder. Na 5 foute pogingen wacht u 30 seconden. ") + (admin ? '<a href="/personeel.html">Naar het teamportaal</a>' : '<a href="/beheer-login.html">Beheerder? Naar beheer</a>') + '</div></form></div></div>';
  document.getElementById("f").addEventListener("submit", async e => {
    e.preventDefault();
    const code = document.getElementById("code").value.trim();
    K.setErr("fCode", code ? "" : "Vul de code in."); if (!code) return;
    const btn = document.getElementById("btn"); K.busy(btn, true, "Controleren…"); document.getElementById("err").innerHTML = "";
    try {
      const d = await K.staff.login(code, cfg.want);
      if (admin && d.role !== "admin") { document.getElementById("err").innerHTML = K.c.error("Deze code geeft geen toegang tot Beheer."); K.busy(btn, false); return; }
      // Op naam aangemeld (persoonlijke PIN) : even begroeten, dan door.
      if (d.name) { K.toast("Welkom, " + d.name); K.busy(btn, true, "Welkom, " + d.name + "…"); }
      const ret = K.takeReturn(null);
      setTimeout(() => { location.href = ret || (admin ? "/beheer.html" : "/bestellingen.html"); }, d.name ? 600 : 0);
    } catch (err) { document.getElementById("err").innerHTML = K.c.error(err.message); K.busy(btn, false); }
  });
  K.staff.check().then(ok => { if (ok && (!admin || K.staff.isAdmin())) { const ret = K.takeReturn(null); location.replace(ret || (admin ? "/beheer.html" : "/bestellingen.html")); } });
})();
