"use strict";
// E-mails d'accès client SANS mot de passe en clair : un lien signé (lib/clientauth.js
// issueResetToken) mène à wachtwoord.html?t=…, où le client choisit lui-même son mot de
// passe. Un e-mail peut traîner des années dans une boîte ou être transféré : il ne doit
// jamais contenir de quoi se connecter tel quel.
//
// Même rendu sobre que lib/ordermail.js (tableaux, styles en ligne) — ses briques ne sont
// pas exportées, d'où cette version courte. NL par défaut, FR si le client est en FR.
// Ne jette jamais (comme lib/ordermail) : un e-mail raté ne fait pas échouer l'action.
const mail = require("./mail");

const FONT = "font-family:Arial,Helvetica,sans-serif";
const esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const T = {
  nl: {
    activationSubject: n => "Uw toegang tot het bestelportaal van " + n,
    activationTitle: "Welkom in het bestelportaal",
    activationText: n => "Uw toegang tot het bestelportaal van " + n + " is klaar. Kies via de knop hieronder zelf uw wachtwoord; daarna meldt u zich aan met uw gebruikersnaam.",
    resetSubject: () => "Kies een nieuw wachtwoord voor het bestelportaal",
    resetTitle: "Nieuw wachtwoord kiezen",
    resetText: n => "Er werd een nieuw wachtwoord aangevraagd voor uw toegang tot het bestelportaal van " + n + ". Kies het via de knop hieronder. Uw huidige wachtwoord blijft geldig tot u een nieuw kiest.",
    button: "Wachtwoord kiezen",
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
    user: "Identifiant",
    valid: h => "Ce lien est valable " + (h >= 48 ? Math.round(h / 24) + " jours" : h >= 1 ? h + " heures" : Math.round(h * 60) + " minutes") + " et ne fonctionne qu'une fois.",
    notYou: "Vous n'êtes pas à l'origine de cette demande ? Vous n'avez rien à faire ; n'hésitez pas à répondre à ce message.",
    forWho: n => "Pour " + n
  }
};

function render(title, subtitle, paragraphs, user, label, button, link, footer, brand) {
  const p = t => '<tr><td style="padding:12px 24px 0 24px;font-size:14px;line-height:1.55;color:#232323;' + FONT + '">' + esc(t) + "</td></tr>";
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + "</title></head>" +
    '<body style="margin:0;padding:0;background:#FAF9F5;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAF9F5;"><tr><td align="center" style="padding:28px 12px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #E3E0D6;border-radius:12px;">' +
    '<tr><td style="padding:20px 24px 0 24px;font-size:11.5px;font-weight:bold;letter-spacing:2px;color:#232323;' + FONT + '">' + esc(String(brand).toUpperCase()) + "</td></tr>" +
    '<tr><td style="padding:18px 24px 6px 24px;"><div style="font-family:Georgia,\'Times New Roman\',serif;font-size:23px;color:#232323;">' + esc(title) + "</div>" +
      (subtitle ? '<div style="margin-top:5px;color:#6A6A6A;font-size:13px;' + FONT + '">' + esc(subtitle) + "</div>" : "") + "</td></tr>" +
    p(paragraphs[0]) +
    (user ? '<tr><td style="padding:14px 24px 0 24px;font-size:13px;color:#6A6A6A;' + FONT + '">' + esc(label) + ' : <span style="font-family:Consolas,Menlo,monospace;font-size:14px;color:#232323;">' + esc(user) + "</span></td></tr>" : "") +
    (link ? '<tr><td style="padding:18px 24px 6px 24px;"><a href="' + esc(link) + '" style="display:inline-block;padding:13px 22px;background:#4876A2;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;line-height:18px;font-weight:bold;' + FONT + '">' + esc(button) + "</a></td></tr>" : "") +
    paragraphs.slice(1).map(p).join("") +
    '<tr><td style="padding:16px 24px 20px 24px;border-top:1px solid #E3E0D6;font-size:12px;line-height:1.6;color:#6A6A6A;' + FONT + '">' + esc(footer).replace(/\n/g, "<br>") + "</td></tr>" +
    "</table></td></tr></table></body></html>";
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
    html: render(title, klant.nom ? t.forWho(klant.nom) : "", [intro].concat(after), ctx.user, t.user, t.button, ctx.link, footer, naam),
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
