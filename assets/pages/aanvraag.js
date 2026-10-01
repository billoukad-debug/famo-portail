(function () {
  const app = document.getElementById("app");
  app.innerHTML = '<div class="wrap-560"><a class="brand" href="/"><span class="logo" aria-hidden="true"></span><span><b>FAMO Seafood</b><small>' + K.t("Verse vis en zeevruchten, Antwerpen") + '</small></span></a>' +
    '<div class="d-flex ai-c gap-10 mt-14 f-wrap"><h1 class="h1 flex-1">' + K.t("Toegang aanvragen") + '</h1>' + K.langSwitch() + '</div><p class="sub ws-normal">' + K.t("Voor horeca en handel. Wij bellen u binnen 1 werkdag met uw prijzen en uw toegang.") + '</p>' +
    '<form id="f" class="card card-b mt-16 stack-12" novalidate>' +
    K.c.field(K.t("Bedrijfsnaam"), K.c.input("bedrijfsnaam", { attrs: ' autocomplete="organization" required' }), { id: "fBedrijf", req: true }) +
    K.c.field(K.t("Contactpersoon"), K.c.input("contactpersoon", { attrs: ' autocomplete="name" required' }), { id: "fContact", req: true }) +
    '<div class="grid-2">' + K.c.field(K.t("Telefoon"), K.c.input("telefoon", { type: "tel", attrs: ' autocomplete="tel" required' }), { id: "fTel", req: true }) + K.c.field(K.t("E-mail"), K.c.input("email", { type: "email", attrs: ' autocomplete="email" required' }), { id: "fMail", req: true }) + '</div>' +
    K.c.field(K.t("Leveradres"), '<textarea class="input" id="adres" rows="2" placeholder="' + K.t("Straat, nummer, gemeente") + '"></textarea>', { id: "fAdres" }) +
    K.c.field(K.t("Taal van uw documenten"), '<div class="opt" role="group" aria-label="' + K.t("Taal van uw documenten") + '">' + [["NL", "Nederlands"], ["FR", "Français"]].map(([k, l]) => '<button type="button" data-taal="' + k + '"' + ((K.lang === "fr" ? "FR" : "NL") === k ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + l + '</button>').join("") + '</div>', { hint: K.t("Leveringsbonnen en facturen in deze taal.") }) +
    K.c.field(K.t("Wat bestelt u meestal?"), '<textarea class="input" id="notities" rows="3" placeholder="' + K.t("bv. garnalen 16/20, zalm, tonijn · ongeveer per week…") + '"></textarea>', { id: "fNot" }) +
    // Pot de miel (api/signup.js) : invisible et hors tabulation pour un humain, rempli par les robots.
    '<div aria-hidden="true" class="offscreen"><label for="bijkomend">Laat dit veld leeg</label><input id="bijkomend" name="bijkomend" type="text" tabindex="-1" autocomplete="off"></div>' +
    '<div id="terms"></div><div id="msg"></div><button type="submit" class="btn btn-p btn-tall" id="btn">' + K.t("Aanvraag versturen") + '</button>' +
    '<p class="quiet fs-12 ta-c m-0">' + K.t("Al klant?") + ' <a href="/">' + K.t("Aanmelden") + '</a></p></form></div>';
  let taal = K.lang === "fr" ? "FR" : "NL";
  // Conditions générales (C-12) : case obligatoire dès qu'une version est publiée.
  let versie = "";
  K.api("/api/config?public=1").then(d => {
    versie = (d.config && d.config.voorwaardenVersie) || "";
    if (!versie) return;
    document.getElementById("terms").innerHTML = '<div class="field" id="fTerms"><label class="d-flex gap-10 ai-fs fs-135 mh-44"><input type="checkbox" id="akkoord" class="chk-22"><span>' + K.esc(K.t("Ik aanvaard de algemene verkoopsvoorwaarden")) + ' · <a class="tlink" href="/voorwaarden" target="_blank" rel="noopener">' + K.esc(K.t("lezen")) + '</a></span></label><span class="err" data-err role="alert"></span></div>';
  }).catch(() => {});
  K.on(app, "click", "[data-taal]", (e, t) => { taal = t.dataset.taal; K.$$("[data-taal]", app).forEach(b => { const on = b === t; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); }); });
  document.getElementById("f").addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => document.getElementById(id).value.trim();
    const data = { bedrijfsnaam: v("bedrijfsnaam"), contactpersoon: v("contactpersoon"), telefoon: v("telefoon"), email: v("email"), adres: v("adres"), notities: v("notities"), taal, bijkomend: v("bijkomend") };
    let ok = true;
    K.setErr("fBedrijf", data.bedrijfsnaam ? "" : (ok = false, K.t("Verplicht."))); K.setErr("fContact", data.contactpersoon ? "" : (ok = false, K.t("Verplicht.")));
    K.setErr("fTel", data.telefoon ? "" : (ok = false, K.t("Verplicht."))); K.setErr("fMail", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? "" : (ok = false, K.t("Geef een geldig e-mailadres.")));
    if (versie) { const on = document.getElementById("akkoord").checked; K.setErr("fTerms", on ? "" : K.t("Aanvaard de algemene voorwaarden om verder te gaan.")); if (!on) ok = false; else data.voorwaarden = versie; }
    if (!ok) return;
    const btn = document.getElementById("btn"); K.busy(btn, true, K.t("Versturen…"));
    try { await K.api("/api/signup", { json: data }); document.getElementById("f").innerHTML = K.c.ok("<b>" + K.t("Aanvraag ontvangen.") + "</b> " + K.t("Wij bellen u op") + " " + K.esc(data.telefoon) + " " + K.t("binnen 1 werkdag.")) + '<a class="btn btn-o mt-12" href="/">' + K.t("Terug naar de startpagina") + '</a>'; }
    catch (err) { document.getElementById("msg").innerHTML = K.c.error(err.message); K.busy(btn, false); }
  });
})();
