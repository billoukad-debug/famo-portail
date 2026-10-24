(function () {
  const app = document.getElementById("app");
  // Spec 038 : zelfde familie als de startpagina (kopbalk « timonerie », titel in serif), drie redenen die vandaag waar zijn
  // (uur en leverdagen uit de publieke configuratie, afgesproken prijzen, visfiche) en een rechtstreeks nummer.
  const DEF = { deadline: "22:00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"] };
  const KEYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
  const daysTxt = lev => { const d = (lev.leverdagen || DEF.leverdagen).filter(k => KEYS.includes(k)).sort((a, b) => (KEYS.indexOf(a) || 7) - (KEYS.indexOf(b) || 7)), i = d.map(k => KEYS.indexOf(k) || 7); return d.length > 1 && i.every((v, n) => n === 0 || v === i[n - 1] + 1) ? K.t(d[0]) + "–" + K.t(d[d.length - 1]) : d.map(K.t).join(", "); };
  const why = lev => [
    [K.tt("Vóór {t} besteld", { t: lev.deadline || DEF.deadline }), K.tt("Geleverd op de eerstvolgende leverdag: {d}, in Antwerpen en omstreken.", { d: daysTxt(lev) })],
    [K.t("Uw afgesproken prijzen"), K.t("Uw afgesproken prijzen staan erbij. U kiest zelf de leverdag.")],
    [K.t("Elk lot heeft een identiteitskaart"), K.t("Herkomst, staat en allergenen per product; lotnummer op de leveringsbon.")]
  ].map(([h, t], n) => '<li><span class="ac-n" aria-hidden="true">' + (n + 1) + '</span><div><h2 class="av-wh">' + K.esc(h) + '</h2><p>' + K.esc(t) + '</p></div></li>').join("");
  app.innerHTML = '<div class="ac av">' +
    '<header class="ac-hd"><div class="ac-w ac-hd-in"><a class="brand ac-brand" href="' + K.langHref("/") + '"><span class="logo" aria-hidden="true"></span><span><b>FAMO Seafood</b><small>' + K.t("Verse vis en zeevruchten, Antwerpen") + '</small></span></a>' +
    '<nav class="ac-nav" aria-label="' + K.t("Taal en aanmelden") + '">' + K.langSwitch() + '<a class="btn ac-btn-light ac-hd-login" href="/#aanmelden">' + K.t("Aanmelden") + '</a></nav></div></header>' +
    '<section class="ac-hero av-hero" aria-labelledby="avT"><div class="ac-w"><p class="ac-eyebrow">' + K.t("Klant worden") + '</p><h1 class="ac-h1 av-h1" id="avT">' + K.t("Toegang aanvragen") + '</h1>' +
    '<p class="ac-lead">' + K.t("Voor horeca en handel. Wij bellen u binnen 1 werkdag met uw prijzen en uw toegang.") + '</p><ol class="av-why" id="avWhy">' + why(DEF) + '</ol></div></section>' +
    '<section class="ac-sec ac-meet" aria-label="' + K.t("Toegang aanvragen") + '"><div class="ac-w ac-split">' +
    '<form id="f" class="ac-login av-form stack-12" novalidate><h2 class="ac-h3">' + K.t("Uw gegevens") + '</h2>' +
    K.c.field(K.t("Bedrijfsnaam"), K.c.input("bedrijfsnaam", { attrs: ' autocomplete="organization" required' }), { id: "fBedrijf", req: true }) +
    K.c.field(K.t("Contactpersoon"), K.c.input("contactpersoon", { attrs: ' autocomplete="name" required' }), { id: "fContact", req: true }) +
    '<div class="grid-2">' + K.c.field(K.t("Telefoon"), K.c.input("telefoon", { type: "tel", attrs: ' autocomplete="tel" required' }), { id: "fTel", req: true }) + K.c.field(K.t("E-mail"), K.c.input("email", { type: "email", attrs: ' autocomplete="email" required' }), { id: "fMail", req: true }) + '</div>' +
    K.c.field(K.t("Leveradres"), '<textarea class="input" id="adres" rows="2" placeholder="' + K.t("Straat, nummer, gemeente") + '"></textarea>', { id: "fAdres" }) +
    K.c.field(K.t("Taal van uw documenten"), '<div class="opt" role="group" aria-label="' + K.t("Taal van uw documenten") + '">' + [["NL", "Nederlands"], ["FR", "Français"]].map(([k, l]) => '<button type="button" data-taal="' + k + '"' + ((K.lang === "fr" ? "FR" : "NL") === k ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + l + '</button>').join("") + '</div>', { hint: K.t("Leveringsbonnen en facturen in deze taal.") }) +
    K.c.field(K.t("Wat bestelt u meestal?"), '<textarea class="input" id="notities" rows="3" placeholder="' + K.t("bv. garnalen 16/20, zalm, tonijn · ongeveer per week…") + '"></textarea>', { id: "fNot" }) +
    // Pot de miel (api/signup.js) : invisible et hors tabulation pour un humain, rempli par les robots.
    '<div aria-hidden="true" class="offscreen"><label for="bijkomend">Laat dit veld leeg</label><input id="bijkomend" name="bijkomend" type="text" tabindex="-1" autocomplete="off"></div>' +
    '<div id="terms"></div><div id="msg"></div><button type="submit" class="btn btn-p btn-tall" id="btn">' + K.t("Aanvraag versturen") + '</button>' +
    '<p class="quiet fs-12 m-0">' + K.t("Wij gebruiken deze gegevens enkel om uw aanvraag te behandelen en u te contacteren.") + ' <a class="tlink" href="/privacy">' + K.t("Privacyverklaring") + '</a></p>' +
    '<p class="quiet fs-12 ta-c m-0">' + K.t("Al klant?") + ' <a href="/#aanmelden">' + K.t("Aanmelden") + '</a></p></form>' +
    '<aside class="ac-help" aria-labelledby="avQ"><h2 class="ac-h3" id="avQ">' + K.t("Liever even bellen?") + '</h2><p>' + K.t("Bel of mail Famo.") + '</p><div class="ac-contact" id="avContact"></div></aside></div></section></div>';
  let taal = K.lang === "fr" ? "FR" : "NL";
  // Conditions générales (C-12) : case obligatoire dès qu'une version est publiée.
  let versie = "";
  K.mountPublicFooter();
  K.api("/api/config?public=1").then(d => {
    const cfg = d.config || {};
    K.fillPublicFooter(cfg);
    if (cfg.levering) document.getElementById("avWhy").innerHTML = why(Object.assign({}, DEF, cfg.levering));
    // Rechtstreeks contact : WhatsApp enkel als er een nummer ingesteld is.
    const wa = K.waLink(cfg.whatsapp), item = (href, ico, big, small, ext) => '<a class="ac-cbtn" href="' + K.esc(href) + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + ico + "<span><b>" + K.esc(big) + "</b><small>" + K.esc(small) + "</small></span></a>";
    document.getElementById("avContact").innerHTML = [wa ? item(wa, K.icon("wa"), K.t("WhatsApp"), K.t("Stuur ons een bericht op WhatsApp"), true) : "", cfg.telefoon ? item("tel:" + K.telHref(cfg.telefoon), K.icon("phone"), cfg.telefoon, K.t("Bellen")) : "", cfg.email ? item("mailto:" + cfg.email, K.icon("mail"), cfg.email, K.t("E-mail")) : ""].join("");
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
