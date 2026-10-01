"use strict";
// E-mails d'accès client SANS mot de passe en clair : un lien signé (lib/clientauth.js
// issueResetToken) mène à wachtwoord.html?t=…, où le client choisit lui-même son mot de
// passe. Un e-mail peut traîner des années dans une boîte ou être transféré : il ne doit
// jamais contenir de quoi se connecter tel quel.
//
// Même gabarit que lib/ordermail.js (lib/maillayout.js, spec 012). NL par défaut, FR si le
// client est en FR. Ne jette jamais (comme lib/ordermail) : un e-mail raté ne fait pas échouer l'action.
const mail = require("./mail");
const layout = require("./maillayout");

const T = {
  nl: {
    activationSubject: n => "Uw toegang tot het bestelportaal van " + n,
    activationTitle: "Welkom in het bestelportaal",
    activationText: n => "Uw toegang tot het bestelportaal van " + n + " is klaar. Kies via de knop hieronder zelf uw wachtwoord; daarna meldt u zich aan met uw gebruikersnaam.",
    resetSubject: () => "Kies een nieuw wachtwoord voor het bestelportaal",
    resetTitle: "Nieuw wachtwoord kiezen",
    resetText: n => "Er werd een nieuw wachtwoord aangevraagd voor uw toegang tot het bestelportaal van " + n + ". Kies het via de knop hieronder. Uw huidige wachtwoord blijft geldig tot u een nieuw kiest.",
    button: "Wachtwoord kiezen",
    fallback: "Werkt de knop niet? Open deze link:",
    user: "Gebruikersnaam",
    valid: h => "Deze link is " + (h >= 48 ? Math.round(h / 24) + " dagen" : h >= 1 ? h + " uur" : Math.round(h * 60) + " minuten") + " geldig en werkt één keer.",
    notYou: "Hebt u dit niet aangevraagd? Dan hoeft u niets te doen; antwoord gerust op dit bericht.",
    forWho: n => "Voor " + n
  },
  fr: {
    activationSubject: n => "Votre accès au portail de commande de " + n,
    activationTitle: "Bienvenue sur le portail de commande",
    activationText: n => "Votre accès au portail de commande de " + n + " est prêt. Choisissez vous-même votre mot de passe avec le bouton ci-dessous ; vous vous connecterez ensuite avec votre identifiant.",
    resetSubject: () => "Choisissez un nouveau mot de passe pour le portail de commande",
    resetTitle: "Choisir un nouveau mot de passe",
    resetText: n => "Un nouveau mot de passe a été demandé pour votre accès au portail de commande de " + n + ". Choisissez-le avec le bouton ci-dessous. Votre mot de passe actuel reste valable jusque-là.",
    button: "Choisir mon mot de passe",
    fallback: "Le bouton ne fonctionne pas ? Ouvrez ce lien :",
    user: "Identifiant",
    valid: h => "Ce lien est valable " + (h >= 48 ? Math.round(h / 24) + " jours" : h >= 1 ? h + (h >= 2 ? " heures" : " heure") : Math.round(h * 60) + " minutes") + " et ne fonctionne qu'une fois.",
    notYou: "Vous n'êtes pas à l'origine de cette demande ? Vous n'avez rien à faire ; n'hésitez pas à répondre à ce message.",
    forWho: n => "Pour " + n
  }
};

function render(o) {
  return layout.shell({
    title: o.subject, lang: o.lang, brand: o.brand, preheader: o.intro,
    rows: layout.headerRow(o.title, o.subtitle) +
      layout.paragraphRow(o.intro) +
      (o.user ? layout.credentialsRow([[o.label, o.user]]) : "") +
      layout.buttonRow(o.button, o.link, o.fallback) +
      o.after.map(p => layout.paragraphRow(p, true)).join("") +
      layout.footerRow(o.footer)
  });
}

// ctx : { klant:{nom,email,taal}, user, link, hours, company:{bedrijfsnaam,telefoon,email}, opsEmail, at }
function build(kind, ctx) {
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const naam = company.bedrijfsnaam || "FAMO Seafood";
  const t = String(klant.taal || "").toUpperCase() === "FR" ? T.fr : T.nl;
  const activation = kind === "activation";
  const subject = activation ? t.activationSubject(naam) : t.resetSubject(naam);
  const title = activation ? t.activationTitle : t.resetTitle;
  const intro = activation ? t.activationText(naam) : t.resetText(naam);
  const after = [t.valid(Number(ctx.hours) || 0.5), t.notYou];
  const footer = [company.bedrijfsnaam, company.telefoon, company.email].filter(Boolean).join("\n") || naam;
  return {
    to: klant.email,
    subject,
    tag: activation ? "activatie" : "wachtwoord-link",
    html: render({ subject, title, subtitle: klant.nom ? t.forWho(klant.nom) : "", intro, after, user: ctx.user, label: t.user, button: t.button, fallback: t.fallback, link: ctx.link, footer, brand: naam, lang: t === T.fr ? "fr" : "nl" }),
    text: title + "\n\n" + intro + "\n\n" + (ctx.user ? t.user + ": " + ctx.user + "\n" : "") + (ctx.link ? t.button + ": " + ctx.link + "\n" : "") + "\n" + after.join("\n") + "\n\n" + footer + "\n",
    replyTo: company.email || ctx.opsEmail,
    idempotencyKey: kind + ":" + (ctx.user || "") + ":" + (ctx.at || "")
  };
}

async function notify(kind, ctx) {
  try {
    if (!mail.enabled()) return { ok: false, skipped: "disabled" };
    return await mail.send(build(kind, ctx || {}));
  } catch (e) {
    console.warn("[mail] " + kind + " — " + String(e && e.message || e).slice(0, 200));
    return { ok: false, error: "build" };
  }
}

/** Lien absolu vers la page « choisir un mot de passe ». */
function passwordLink(portalUrl, token) {
  return String(portalUrl || "").replace(/\/+$/, "") + "/wachtwoord.html?t=" + encodeURIComponent(token);
}

module.exports = {
  buildActivationMail: ctx => build("activation", ctx || {}),
  buildResetLinkMail: ctx => build("reset", ctx || {}),
  notifyActivation: ctx => notify("activation", ctx),
  notifyResetLink: ctx => notify("reset", ctx),
  passwordLink
};
