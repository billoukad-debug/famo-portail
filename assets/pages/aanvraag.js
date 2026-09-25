(function () {
  const app = document.getElementById("app");
  app.innerHTML = '<div style="max-width:560px;margin:0 auto;padding:24px 16px 60px"><a class="brand" href="/"><span class="logo">F</span><span><b>FAMO Seafood</b><small>' + K.t("Verse vis en zeevruchten · Antwerpen") + '</small></span></a>' +
    '<div style="display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap"><h1 class="h1" style="flex:1">' + K.t("Toegang aanvragen") + '</h1>' + K.langSwitch() + '</div><p class="sub" style="white-space:normal">' + K.t("Voor horeca en handel. Wij bellen u binnen 1 werkdag met uw prijzen en uw toegang.") + '</p>' +
    '<form id="f" class="card card-b" style="margin-top:16px;display:flex;flex-direction:column;gap:12px" novalidate>' +
    K.c.field(K.t("Bedrijfsnaam"), K.c.input("bedrijfsnaam", { attrs: ' autocomplete="organization" required' }), { id: "fBedrijf", req: true }) +
    K.c.field(K.t("Contactpersoon"), K.c.input("contactpersoon", { attrs: ' autocomplete="name" required' }), { id: "fContact", req: true }) +
    '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">' + K.c.field(K.t("Telefoon"), K.c.input("telefoon", { type: "tel", attrs: ' autocomplete="tel" required' }), { id: "fTel", req: true }) + K.c.field(K.t("E-mail"), K.c.input("email", { type: "email", attrs: ' autocomplete="email" required' }), { id: "fMail", req: true }) + '</div>' +
    K.c.field(K.t("Leveradres"), '<textarea class="input" id="adres" rows="2" placeholder="' + K.t("Straat, nummer, gemeente") + '"></textarea>', { id: "fAdres" }) +
    K.c.field(K.t("Wat bestelt u meestal?"), '<textarea class="input" id="notities" rows="3" placeholder="' + K.t("bv. garnalen 16/20, zalm, tonijn · ongeveer per week") + '"></textarea>', { id: "fNot" }) +
    '<div id="msg"></div><button type="submit" class="btn btn-p" id="btn" style="min-height:50px;font-size:15px">' + K.t("Aanvraag versturen") + '</button>' +
    '<p class="quiet" style="font-size:12px;text-align:center;margin:0">' + K.t("Al klant?") + ' <a href="/">' + K.t("Aanmelden") + '</a></p></form></div>';
  document.getElementById("f").addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => document.getElementById(id).value.trim();
    const data = { bedrijfsnaam: v("bedrijfsnaam"), contactpersoon: v("contactpersoon"), telefoon: v("telefoon"), email: v("email"), adres: v("adres"), notities: v("notities") };
    let ok = true;
    K.setErr("fBedrijf", data.bedrijfsnaam ? "" : (ok = false, K.t("Verplicht."))); K.setErr("fContact", data.contactpersoon ? "" : (ok = false, K.t("Verplicht.")));
    K.setErr("fTel", data.telefoon ? "" : (ok = false, K.t("Verplicht."))); K.setErr("fMail", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? "" : (ok = false, K.t("Geef een geldig e-mailadres.")));
    if (!ok) return;
    const btn = document.getElementById("btn"); K.busy(btn, true, K.t("Versturen…"));
    try { await K.api("/api/signup", { json: data }); document.getElementById("f").innerHTML = K.c.ok("<b>" + K.t("Aanvraag ontvangen.") + "</b> " + K.t("Wij bellen u op") + " " + K.esc(data.telefoon) + " " + K.t("binnen 1 werkdag.")) + '<a class="btn btn-o" href="/" style="margin-top:12px">' + K.t("Terug naar de startpagina") + '</a>'; }
    catch (err) { document.getElementById("msg").innerHTML = K.c.error(err.message); K.busy(btn, false); }
  });
})();
