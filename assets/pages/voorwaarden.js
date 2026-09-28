// Algemene voorwaarden / Conditions générales (audit C-12). Texte et version publiés dans
// Beheer → Bedrijf (Configuratie), servis par /api/config?voorwaarden=1. Le texte est affiché
// tel quel (échappé, retours à la ligne conservés) ; un titre « # … » devient un intertitre.
document.addEventListener("DOMContentLoaded", function () {
  const app = document.getElementById("app");
  const T = K.lang === "fr" ? { title: "Conditions générales de vente", version: "Version", none: "Les conditions générales ne sont pas encore publiées. Contactez-nous pour les recevoir.", back: "← Portail", other: "Nederlandse versie" } : { title: "Algemene verkoopsvoorwaarden", version: "Versie", none: "De algemene voorwaarden zijn nog niet gepubliceerd. Neem contact met ons op om ze te ontvangen.", back: "← Portaal", other: "Version française" };
  const body = txt => txt.split(/\n{2,}/).map(par => /^#\s+/.test(par) ? '<h2 class="h2" style="margin-top:18px">' + K.esc(par.replace(/^#\s+/, "")) + "</h2>" : '<p style="white-space:pre-line;line-height:1.55">' + K.esc(par) + "</p>").join("");
  app.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><a class="tlink" href="/" id="back" style="font-size:13px;display:inline-block;min-height:44px;line-height:44px">' + K.esc(T.back) + '</a>' + K.langSwitch() + '</div><h1 class="h1" style="margin-top:12px">' + K.esc(T.title) + '</h1><div id="terms" class="card card-b" style="margin-top:14px"><div class="sk" style="width:60%"></div></div>';
  K.api("/api/config?voorwaarden=1").then(d => {
    const v = d.voorwaarden || {}, fr = K.lang === "fr";
    const txt = (fr ? v.fr || v.nl : v.nl || v.fr) || "";
    const shownOther = fr ? !v.fr && !!v.nl : !v.nl && !!v.fr;
    document.getElementById("terms").innerHTML = v.versie && txt
      ? '<p class="quiet" style="font-size:12.5px;margin:0 0 8px">' + K.esc(T.version + " " + v.versie) + (shownOther ? " · " + K.esc(T.other) : "") + "</p>" + body(txt)
      : K.c.warn(K.esc(T.none));
  }).catch(err => { document.getElementById("terms").innerHTML = K.c.error(err.message); });
});
