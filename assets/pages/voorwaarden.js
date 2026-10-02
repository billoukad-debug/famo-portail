// Algemene voorwaarden / Conditions générales (audit C-12). Texte et version publiés dans
// Beheer → Bedrijf (Configuratie), servis par /api/config?voorwaarden=1. Le texte est affiché
// tel quel (échappé, retours à la ligne conservés) ; un titre « # … » devient un intertitre.
document.addEventListener("DOMContentLoaded", function () {
  const app = document.getElementById("app");
  const T = K.lang === "fr" ? { title: "Conditions générales de vente", version: "Version", none: "Les conditions générales ne sont pas encore publiées. Contactez-nous pour les recevoir.", back: "← Portail", other: "Nederlandse versie" } : { title: "Algemene verkoopsvoorwaarden", version: "Versie", none: "De algemene voorwaarden zijn nog niet gepubliceerd. Neem contact met ons op om ze te ontvangen.", back: "← Portaal", other: "Version française" };
  const body = txt => txt.split(/\n{2,}/).map(par => /^#\s+/.test(par) ? '<h2 class="h2 mt-18">' + K.esc(par.replace(/^#\s+/, "")) + "</h2>" : '<p class="ws-pre lh-155">' + K.esc(par) + "</p>").join("");
  app.innerHTML = '<div class="d-flex ai-c jc-sb gap-10 f-wrap"><a class="tlink tap-44 fs-13" href="/" id="back">' + K.esc(T.back) + '</a>' + K.langSwitch() + '</div><h1 class="h1 mt-12">' + K.esc(T.title) + '</h1><div id="terms" class="card card-b mt-14"><div class="sk w-60p"></div></div>';
  K.api("/api/config?voorwaarden=1").then(d => {
    const v = d.voorwaarden || {}, fr = K.lang === "fr";
    const txt = (fr ? v.fr || v.nl : v.nl || v.fr) || "";
    const shownOther = fr ? !v.fr && !!v.nl : !v.nl && !!v.fr;
    document.getElementById("terms").innerHTML = v.versie && txt
      ? '<p class="quiet fs-125 m-0 mb-8">' + K.esc(T.version + " " + v.versie) + (shownOther ? " · " + K.esc(T.other) : "") + "</p>" + body(txt)
      : K.c.warn(K.esc(T.none));
  }).catch(err => { document.getElementById("terms").innerHTML = K.c.error(err.message); });
});
