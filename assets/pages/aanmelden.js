(function () {
  // Rôle demandé par la page : <body data-login="admin|staff"> (pas de script inline : CSP).
  const cfg = window.__LOGIN || { want: document.body.dataset.login === "admin" ? "admin" : "staff" };
  const admin = cfg.want === "admin";
  const app = document.getElementById("app");
  const denied = new URLSearchParams(location.search).get("denied") === "1";
  app.innerHTML = '<div class="lg"><div class="lg-left"><a class="brand p-0 t-white" href="/"><span class="logo" aria-hidden="true"></span><span><b>FAMO Seafood</b><small>' + (admin ? "Beheer" : "Teamportaal") + '</small></span></a>' +
    '<div><h1>' + (admin ? "Klanten, producten, prijzen en instellingen." : "Klaarzetten, ronde rijden, ontvangst bevestigen.") + '</h1><p class="m-0 mt-14 fs-15">' + (admin ? "Enkel voor de zaakvoerder. Met de beheerderscode of uw persoonlijke PIN." : "Werkt op de tablet in het magazijn en op de telefoon in de wagen. Persoonlijke PIN of teamcode.") + '</p></div>' +
    '<div class="fs-12">FAMO Seafood · Antwerpen</div></div>' +
    '<div class="lg-right"><form class="lg-form" id="f" novalidate><a class="tlink fs-13" href="/">' + K.icon("back") + ' Kies een ander portaal</a>' +
    '<div><h2 class="h1 fs-24">' + (admin ? "Aanmelden als beheerder" : "Aanmelden als personeel") + '</h2><p class="sub">' + (admin ? "Voer de beheerderscode of uw PIN in" : "Voer de personeelscode of uw PIN in") + '</p></div>' +
    (denied ? K.c.warn("Deze pagina is enkel voor beheerders. Meld u aan met de beheerderscode.") : "") +
    K.c.field(admin ? "Beheerderscode of PIN" : "Personeelscode of PIN", K.c.input("code", { type: "password", cls: "code-input", attrs: ' autocomplete="current-password" inputmode="text" required' }), { id: "fCode", for: "code", hint: "Een persoonlijke PIN meldt u aan op naam; die naam staat dan in het logboek van correcties." }) +
    '<div id="err"></div><button type="submit" class="btn btn-p btn-tall" id="btn">Aanmelden</button>' +
    '<div class="quiet fs-125">' + (admin ? "Personeel? " : "Code of PIN kwijt? Vraag de beheerder. Na 5 foute pogingen wacht u 30 seconden. ") + (admin ? '<a href="/team/aanmelden">Naar het teamportaal</a>' : '<a href="/beheer/aanmelden">Beheerder? Naar beheer</a>') + '</div></form></div></div>';
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
      setTimeout(() => { location.href = ret || K.home(admin); }, d.name ? 600 : 0);
    } catch (err) { document.getElementById("err").innerHTML = K.c.error(err.message); K.busy(btn, false); }
  });
  K.staff.check().then(ok => { if (ok && (!admin || K.staff.isAdmin())) { const ret = K.takeReturn(null); location.replace(ret || K.home(admin)); } });
})();
