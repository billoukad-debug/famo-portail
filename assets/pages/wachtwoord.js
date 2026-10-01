// Wachtwoord vergeten / nieuw wachtwoord kiezen (wachtwoord.html). Script extern : de CSP
// staat geen inline scripts toe (vercel.json, script-src 'self').
//  - zonder ?t= : gebruikersnaam + e-mail van de zaak → /api/klantorder action "reset". De
//    server antwoordt altijd neutraal (bestaat het account of niet) ; die tekst tonen we.
//  - met ?t=… (link uit de e-mail) : nieuw wachtwoord kiezen → /api/klantwachtwoord action
//    "setPassword". De link verdwijnt meteen uit de adresbalk (geschiedenis, schermdelen) en
//    wordt enkel in deze tab bewaard, zodat de taalwissel (herladen) hem niet verliest.
document.addEventListener("DOMContentLoaded", function () { // na de uitgestelde (defer) scripts
  Object.assign(K.FR, {
    "Als de gegevens kloppen, ontvangt u binnen enkele minuten een e-mail met een link om een nieuw wachtwoord te kiezen.": "Si les données sont correctes, vous recevrez dans quelques minutes un e-mail avec un lien pour choisir un nouveau mot de passe.",
    "Vul uw gebruikersnaam en het e-mailadres van uw zaak in. Als ze overeenkomen, sturen we een link naar dat adres om een nieuw wachtwoord te kiezen.": "Indiquez votre identifiant et l'adresse e-mail de votre établissement. S'ils correspondent, nous envoyons à cette adresse un lien pour choisir un nouveau mot de passe.",
    "Nieuw wachtwoord kiezen": "Choisir un nouveau mot de passe",
    "Kies uw wachtwoord. Daarna meldt u zich aan met uw gebruikersnaam en dit wachtwoord.": "Choisissez votre mot de passe. Vous vous connecterez ensuite avec votre identifiant et ce mot de passe.",
    "Wachtwoord opslaan": "Enregistrer le mot de passe", "Opslaan…": "Enregistrement…",
    "Wachtwoord opgeslagen.": "Mot de passe enregistré.", "Naar het bestelportaal": "Vers le portail de commande",
    "Deze link is verlopen of al gebruikt. Vraag een nieuwe aan.": "Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.",
    "Nieuwe link aanvragen": "Demander un nouveau lien",
    "Wachtwoord opslaan mislukt. Probeer het later opnieuw.": "L'enregistrement du mot de passe a échoué. Réessayez plus tard."
  });
  const app = document.getElementById("app");
  const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const KEY = "famoResetToken";
  let token = new URLSearchParams(location.search).get("t") || "";
  try {
    if (token) { sessionStorage.setItem(KEY, token); history.replaceState(null, "", location.pathname); }
    else token = sessionStorage.getItem(KEY) || "";
  } catch (e) { /* privévenster : de token blijft in het geheugen */ }
  const head = title => '<div class="d-flex ai-c jc-sb gap-10"><a class="tlink fs-13" href="/">' + K.t("← Aanmelden") + '</a>' + K.langSwitch() + '</div><h1 class="h1 mt-18">' + K.t(title) + '</h1>';

  if (token) {
    // ---- Nieuw wachtwoord kiezen via de link ----
    app.innerHTML = '<div class="wrap-480">' + head("Nieuw wachtwoord kiezen") + '<p class="sub ws-normal">' + K.t("Kies uw wachtwoord. Daarna meldt u zich aan met uw gebruikersnaam en dit wachtwoord.") + '</p>' +
      '<form id="f" class="card card-b mt-16 stack-12" novalidate>' +
      K.c.field(K.t("Nieuw wachtwoord"), K.c.input("pw1", { type: "password", attrs: ' autocomplete="new-password" minlength="8" maxlength="80" required' }), { id: "fPw1", for: "pw1", hint: K.t("Minstens 8 tekens.") }) +
      K.c.field(K.t("Herhaal nieuw wachtwoord"), K.c.input("pw2", { type: "password", attrs: ' autocomplete="new-password" maxlength="80" required' }), { id: "fPw2", for: "pw2" }) +
      '<div id="msg"></div><button type="submit" class="btn btn-p btn-tall" id="btn">' + K.t("Wachtwoord opslaan") + '</button></form></div>';
    document.getElementById("f").addEventListener("submit", async e => {
      e.preventDefault();
      const pw1 = document.getElementById("pw1").value, pw2 = document.getElementById("pw2").value;
      K.setErr("fPw1", pw1.length >= 8 ? "" : K.t("Het nieuwe wachtwoord moet minstens 8 tekens hebben."));
      K.setErr("fPw2", pw1 === pw2 ? "" : K.t("De twee nieuwe wachtwoorden zijn niet gelijk."));
      if (pw1.length < 8 || pw1 !== pw2) return;
      const btn = document.getElementById("btn"); K.busy(btn, true, K.t("Opslaan…")); document.getElementById("msg").innerHTML = "";
      try {
        const d = await K.api("/api/klantwachtwoord", { json: { action: "setPassword", token, nieuw: pw1 } });
        try { sessionStorage.removeItem(KEY); } catch (err) { /* niets */ }
        // Meteen aangemeld : de server zette de HttpOnly-sessiecookie ; hier enkel de gebruikersnaam (weergave).
        if (d.ok && d.user) K.klant.set({ user: d.user });
        document.getElementById("f").innerHTML = K.c.ok(K.t("Wachtwoord opgeslagen.")) + '<a class="btn btn-p mt-12" href="/klant#/catalogus">' + K.t("Naar het bestelportaal") + '</a>';
      } catch (err) {
        if (err.payload && err.payload.expired) {
          try { sessionStorage.removeItem(KEY); } catch (e2) { /* niets */ }
          document.getElementById("f").innerHTML = K.c.warn(err.message) + '<a class="btn btn-o mt-12" href="/wachtwoord">' + K.t("Nieuwe link aanvragen") + '</a>';
          return;
        }
        document.getElementById("msg").innerHTML = K.c.error(err.message); K.busy(btn, false);
      }
    });
    return;
  }

  // ---- Link aanvragen : gebruikersnaam + e-mail van de zaak ----
  app.innerHTML = '<div class="wrap-480">' + head("Wachtwoord vergeten") + '<p class="sub ws-normal">' + K.t("Vul uw gebruikersnaam en het e-mailadres van uw zaak in. Als ze overeenkomen, sturen we een link naar dat adres om een nieuw wachtwoord te kiezen.") + '</p>' +
    '<form id="f" class="card card-b mt-16 stack-12" novalidate>' + K.c.field(K.t("Gebruikersnaam"), K.c.input("user", { attrs: ' autocomplete="username" autocapitalize="none" spellcheck="false" required' }), { id: "fUser", for: "user" }) + K.c.field(K.t("E-mailadres van uw zaak"), K.c.input("email", { type: "email", attrs: ' autocomplete="email" inputmode="email" required' }), { id: "fMail", for: "email" }) + '<div id="msg"></div><button type="submit" class="btn btn-p btn-tall" id="btn">' + K.t("Nieuw wachtwoord aanvragen") + '</button></form>' +
    '<div class="card card-b mt-16 d-flex f-col gap-8" id="contact"><b>FAMO Seafood</b><span class="muted">' + K.t("Gegevens laden…") + '</span></div></div>';
  K.api("/api/config?public=1").then(d => { const c = d.config || {}; document.getElementById("contact").innerHTML = "<b>" + K.esc(c.bedrijfsnaam || "FAMO Seafood") + "</b><span class=\"muted\">" + K.t("Liever bellen? Wij zetten meteen een nieuw wachtwoord klaar.") + "</span>" + (c.telefoon ? "<a class=\"tlink\" href=\"tel:" + K.esc(String(c.telefoon).replace(/\s+/g, "")) + "\">" + K.esc(c.telefoon) + "</a>" : "") + (c.email ? "<a class=\"tlink\" href=\"mailto:" + K.esc(c.email) + "\">" + K.esc(c.email) + "</a>" : "") + "<span class=\"quiet fs-12\">" + K.esc([c.adres, c.plaats].filter(Boolean).join(", ")) + "</span>"; }).catch(() => {});
  document.getElementById("f").addEventListener("submit", async e => {
    e.preventDefault();
    const user = document.getElementById("user").value.trim(), email = document.getElementById("email").value.trim();
    K.setErr("fUser", user ? "" : K.t("Vul uw gebruikersnaam in.")); K.setErr("fMail", isEmail(email) ? "" : K.t("Geef een geldig e-mailadres."));
    if (!user || !isEmail(email)) return;
    const btn = document.getElementById("btn"); K.busy(btn, true, K.t("Versturen…")); document.getElementById("msg").innerHTML = "";
    try {
      const d = await K.api("/api/klantorder", { json: { action: "reset", user, email } });
      // mail:false = de server kan geen e-mail versturen (geen mailsleutel) : dan helpt enkel bellen.
      document.getElementById("f").innerHTML = (d.mail === false ? K.c.warn(K.t("E-mail versturen is momenteel niet mogelijk. Bel of mail ons voor een nieuw wachtwoord.")) : K.c.ok(K.errText(d.message || "Als de gegevens kloppen, ontvangt u binnen enkele minuten een e-mail met een link om een nieuw wachtwoord te kiezen."))) + '<a class="btn btn-o mt-12" href="/">' + K.t("← Aanmelden") + '</a>';
    } catch (err) { document.getElementById("msg").innerHTML = K.c.error(err.message); K.busy(btn, false); }
  });
});
