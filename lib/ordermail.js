// Contenu des e-mails de confirmation de commande.
//
// Deux messages DISTINCTS, envoyés séparément :
//   - equipe  : tout l'opérationnel (note interne, téléphone, source, lien staff)
//   - client  : confirmation propre, sans rien d'interne
// Un seul envoi à deux destinataires exposerait la boîte interne au client et
// l'adresse du client à l'équipe ; et Resend rejette toute la requête si un
// destinataire est malformé — une adresse client erronée ne doit jamais
// supprimer la copie de l'équipe, dont dépend le travail du matin.
//
// parseLines/eur/esc/nlUnit sont volontairement recopiés depuis documents.js et
// assets/ui.js (famoNL) : ces fichiers sont des assets navigateur à la racine, hors du
// graphe require, donc pas fiablement inclus dans le bundle serverless Vercel.
// La dérive est rattrapée par les tests de parité (section M de workflow-check).
const mail = require("./mail");

// Table identique à famoNL (assets/ui.js) — "caisse" s'affiche TOUJOURS "kassa".
const UNITS = { "caisse": "kassa", "carton": "doos", "pièce": "stuk", "piece": "stuk", "kg": "kg" };

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Même rendu que l'écran (K.eur) et les documents : € 1.234,50 · € -12,00.
function eur(value) {
  const n = Number(value || 0);
  const s = Math.abs(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "€ " + (n < 0 ? "-" : "") + s;
}

function nlUnit(value) {
  return UNITS[String(value || "").toLowerCase()] || value;
}

/** Traduit les unités dans un texte libre, comme famoNL.lines. */
function nlLines(text) {
  return String(text || "").replace(/\b(caisse|carton|pièce|piece)\b/gi, m => UNITS[m.toLowerCase()] || m);
}

/** "Zalm × 2 kg [€12.50] (zonder kop)" -> {name, qty, unit, price, comment} */
function parseLines(lines) {
  return String(lines || "").split("\n").filter(Boolean).map(raw => {
    const m = raw.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*([^\[\(]*)(.*)$/);
    if (!m) return { name: raw, qty: "", unit: "", price: null, comment: "" };
    const tail = m[4] || "";
    const price = tail.match(/\[€\s*([\d.,]+)\]/);
    const comment = tail.match(/\((.*?)\)/);
    return {
      name: m[1].trim(),
      qty: m[2],
      unit: m[3].trim(),
      price: price ? Number(price[1].replace(",", ".")) : null,
      comment: comment ? comment[1] : ""
    };
  });
}

function dateNl(value) {
  if (!value) return "—";
  const d = new Date(String(value).includes("T") ? value : value + "T00:00:00");
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("nl-BE");
}

/**
 * Date d'échéance : isoDate + days, renvoyée en "YYYY-MM-DD" (calcul en UTC,
 * donc insensible au fuseau du serveur). Sans date valide : "".
 */
function vervaldatum(isoDate, days) {
  const s = String(isoDate || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const n = Number(days);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (Number.isFinite(n) ? n : 30)));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// --- Briques HTML compatibles clients mail -----------------------------------
// Tables uniquement, tout le CSS en ligne : Gmail supprime <style> dans la vue
// repliée, et le moteur Word d'Outlook ignore flexbox.
const FONT = "font-family:Arial,Helvetica,sans-serif";
// Ratio calculé : #6A6A6A sur #fff (carte du mail) = 7,1:1 — l'e-mail garde
// l'hex opaque volontairement (rgba est mal géré par les clients mail).
const MUTED = "color:#6A6A6A;font-size:13px;line-height:1.5;" + FONT;
// Micro-libellés en capitales suivies (jetons : encre .62 ≈ #6A6A6A sur crème).
const LABEL = "font-size:11px;letter-spacing:0.5px;text-transform:uppercase;color:#6A6A6A;" + FONT;

/** Bandeau de marque : pastille accent + raison sociale en capitales suivies. */
function brandRow(name) {
  const brand = esc(String(name || "FAMO Seafood").toUpperCase());
  return '<tr><td style="padding:20px 24px 0 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td width="30" height="30" style="width:30px;height:30px;background:#4876A2;border-radius:8px;text-align:center;vertical-align:middle;">' +
      '<span style="font-family:Georgia,\'Times New Roman\',serif;font-size:17px;line-height:30px;color:#ffffff;">F</span></td>' +
    '<td style="padding-left:11px;font-size:11.5px;font-weight:bold;letter-spacing:2px;color:#232323;' + FONT + '">' + brand + "</td>" +
    "</tr></table></td></tr>";
}

function shell(title, inner, brandName) {
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>" + esc(title) + "</title></head>" +
    '<body style="margin:0;padding:0;background:#FAF9F5;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAF9F5;">' +
    '<tr><td align="center" style="padding:28px 12px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #E3E0D6;border-radius:12px;">' +
    brandRow(brandName) +
    inner +
    "</table></td></tr></table></body></html>";
}

function headerRow(title, subtitle) {
  return '<tr><td style="padding:18px 24px 6px 24px;">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:23px;font-weight:normal;letter-spacing:-0.2px;color:#232323;">' + esc(title) + "</div>" +
    (subtitle ? '<div style="margin-top:5px;' + MUTED + '">' + esc(subtitle) + "</div>" : "") +
    "</td></tr>";
}

function factsRow(pairs) {
  const rows = pairs.filter(p => p && p[1]).map(p =>
    '<tr><td style="padding:4px 0;width:150px;vertical-align:top;' + LABEL + '">' + esc(p[0]) + "</td>" +
    '<td style="padding:4px 0;vertical-align:top;font-size:13.5px;color:#232323;' + FONT + '">' + esc(p[1]) + "</td></tr>"
  ).join("");
  if (!rows) return "";
  return '<tr><td style="padding:12px 24px 4px 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + rows + "</table></td></tr>";
}

function linesRow(rows, total) {
  const TH = 'style="padding:8px 10px;background:#F1EFE8;border-bottom:1px solid #E3E0D6;font-size:10.5px;letter-spacing:0.5px;text-transform:uppercase;font-weight:normal;color:#6A6A6A;' + FONT + '"';
  const head = "<tr>" +
    '<th align="left" ' + TH + ">Artikel</th>" +
    '<th align="right" ' + TH + ">Aantal</th>" +
    '<th align="right" ' + TH + ">Subtotaal</th></tr>";
  const body = rows.map(r => {
    const qty = Number(String(r.qty).replace(",", ".")) || 0;
    const sub = r.price == null ? null : r.price * qty;
    return "<tr>" +
      '<td style="padding:10px;border-bottom:1px solid #E3E0D6;font-size:13.5px;color:#232323;' + FONT + '">' +
        esc(r.name) + (r.comment ? '<div style="margin-top:2px;' + MUTED + 'font-size:12px;">' + esc(r.comment) + "</div>" : "") + "</td>" +
      '<td align="right" style="padding:10px;border-bottom:1px solid #E3E0D6;font-size:13.5px;color:#232323;white-space:nowrap;' + FONT + '">' +
        esc(r.qty) + " " + esc(nlUnit(r.unit)) + "</td>" +
      '<td align="right" style="padding:10px;border-bottom:1px solid #E3E0D6;font-size:13.5px;color:#232323;white-space:nowrap;' + FONT + '">' +
        (sub == null ? "—" : esc(eur(sub))) + "</td></tr>";
  }).join("");
  const foot = '<tr><td colspan="2" align="right" style="padding:12px 10px 4px 10px;border-top:2px solid #232323;font-size:15px;font-weight:bold;color:#232323;' + FONT + '">Totaal excl. btw</td>' +
    '<td align="right" style="padding:12px 10px 4px 10px;border-top:2px solid #232323;font-size:16px;font-weight:bold;color:#232323;white-space:nowrap;' + FONT + '">' + esc(eur(total)) + "</td></tr>";
  return '<tr><td style="padding:16px 24px 4px 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + head + body + foot + "</table></td></tr>";
}

function noteRow(label, value) {
  if (!value) return "";
  return '<tr><td style="padding:14px 24px 0 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAF9F5;border:1px solid #E3E0D6;border-radius:12px;">' +
    '<tr><td style="padding:11px 14px;font-size:13px;line-height:1.55;color:#7A5410;' + FONT + '">' +
    "<b>" + esc(label) + "</b><br>" + esc(value).replace(/\n/g, "<br>") + "</td></tr></table></td></tr>";
}

function buttonRow(label, href) {
  if (!href) return "";
  // 44px de haut (18px de ligne + 2×13px) : cible tactile pleine, gants compris.
  return '<tr><td style="padding:18px 24px 20px 24px;">' +
    '<a href="' + esc(href) + '" style="display:inline-block;padding:13px 22px;background:#4876A2;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;line-height:18px;font-weight:bold;' + FONT + '">' +
    esc(label) + "</a></td></tr>";
}

function footerRow(text) {
  return '<tr><td style="padding:16px 24px 20px 24px;border-top:1px solid #E3E0D6;font-size:12px;line-height:1.6;color:#6A6A6A;' + FONT + '">' +
    esc(text).replace(/\n/g, "<br>") + "</td></tr>";
}

/** Paragraphe courant (même style que la note de bas de confirmation client). */
function paragraphRow(text) {
  if (!text) return "";
  return '<tr><td style="padding:14px 24px 4px 24px;font-size:14px;line-height:1.55;color:#232323;' + FONT + '">' +
    esc(text).replace(/\n/g, "<br>") + "</td></tr>";
}

/** Bloc identifiants / paiement : valeurs en monospace pour éviter les confusions l/1/O/0. */
function credentialsRow(pairs) {
  const rows = pairs.filter(p => p && p[1]).map(p =>
    '<tr><td style="padding:5px 0;width:190px;vertical-align:top;' + LABEL + '">' + esc(p[0]) + "</td>" +
    '<td style="padding:5px 0;vertical-align:top;font-family:Consolas,Menlo,monospace;font-size:14px;color:#232323;">' + esc(p[1]) + "</td></tr>"
  ).join("");
  if (!rows) return "";
  return '<tr><td style="padding:14px 24px 0 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAF9F5;border:1px solid #E3E0D6;border-radius:12px;">' +
    '<tr><td style="padding:11px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + rows +
    "</table></td></tr></table></td></tr>";
}

/** Coordonnées publiques de la société pour le pied des mails client. */
function contactBlock(company) {
  const c = company || {};
  return [c.bedrijfsnaam, c.telefoon, c.email].filter(Boolean).join("\n");
}

function textFacts(pairs) {
  return pairs.filter(p => p && p[1]).map(p => p[0] + ": " + p[1]).join("\n");
}

function textLines(rows) {
  return rows.map(r => {
    const qty = Number(String(r.qty).replace(",", ".")) || 0;
    const sub = r.price == null ? null : r.price * qty;
    return "- " + r.name + " × " + r.qty + " " + nlUnit(r.unit) +
      (sub == null ? "" : "  " + eur(sub)) + (r.comment ? " (" + r.comment + ")" : "");
  }).join("\n");
}

// --- Messages ----------------------------------------------------------------

function buildTeamMail(ctx) {
  const rows = parseLines(ctx.lignes);
  const klant = ctx.klant || {};
  const subject = "Nieuwe bestelling " + ctx.ref + " — " + (klant.nom || "onbekende klant") + " — " + eur(ctx.total);
  const html = shell(subject,
    headerRow("Nieuwe bestelling", ctx.ref + " · " + (ctx.bron || "Klantportaal")) +
    factsRow([
      ["Klant", klant.nom],
      ["Klantnummer", klant.klantnr],
      ["Leveradres", klant.adresse],
      ["Telefoon", klant.tel],
      ["E-mail", klant.email],
      ["Besteld op", dateNl(ctx.date)],
      ["Gewenste levering", dateNl(ctx.dateLivraison)]
    ]) +
    linesRow(rows, ctx.total) +
    noteRow("Opmerking van de klant", ctx.notes) +
    buttonRow("Bestelling openen", ctx.orderUrl) +
    footerRow("Automatisch bericht van het Famo-bestelportaal."),
    (ctx.company || {}).bedrijfsnaam
  );
  const text = "Nieuwe bestelling " + ctx.ref + "\n" +
    "Klant: " + (klant.nom || "—") + (klant.tel ? " · " + klant.tel : "") + "\n" +
    (klant.adresse ? "Leveradres: " + klant.adresse + "\n" : "") +
    "Gewenste levering: " + dateNl(ctx.dateLivraison) + "\n" +
    "Bron: " + (ctx.bron || "Klantportaal") + "\n\n" +
    textLines(rows) + "\n\nTotaal excl. btw: " + eur(ctx.total) + "\n" +
    (ctx.notes ? "\nOpmerking: " + ctx.notes + "\n" : "") +
    (ctx.orderUrl ? "\n" + ctx.orderUrl + "\n" : "");
  return {
    to: ctx.opsEmail,
    subject,
    html,
    text,
    // L'équipe répond depuis la boîte partagée et tombe directement sur le client.
    replyTo: klant.email,
    idempotencyKey: "order:" + ctx.ref + ":team"
  };
}

function buildCustomerMail(ctx) {
  const rows = parseLines(ctx.lignes);
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const subject = "Bevestiging van uw bestelling " + ctx.ref;
  const contact = [company.bedrijfsnaam, company.telefoon, company.email].filter(Boolean).join("\n");
  const html = shell(subject,
    headerRow("Bedankt voor uw bestelling", klant.nom ? "Voor " + klant.nom : "") +
    factsRow([
      ["Referentie", ctx.ref],
      ["Besteld op", dateNl(ctx.date)],
      ["Gewenste levering", dateNl(ctx.dateLivraison)]
    ]) +
    linesRow(rows, ctx.total) +
    '<tr><td style="padding:16px 24px 18px 24px;' + MUTED + '">' +
      "Dit is een bevestiging van ontvangst, geen factuur. " +
      "Hebt u een aanpassing nodig? Antwoord gerust op dit bericht." +
    "</td></tr>" +
    footerRow(contact || "FAMO Seafood"),
    company.bedrijfsnaam
  );
  const text = "Bedankt voor uw bestelling.\n\n" +
    "Referentie: " + ctx.ref + "\n" +
    "Gewenste levering: " + dateNl(ctx.dateLivraison) + "\n\n" +
    textLines(rows) + "\n\nTotaal excl. btw: " + eur(ctx.total) + "\n\n" +
    "Dit is een bevestiging van ontvangst, geen factuur.\n" +
    (contact ? "\n" + contact + "\n" : "");
  return {
    to: klant.email,
    subject,
    html,
    text,
    // Jamais la boîte ops : elle est privée et ne doit pas fuir vers le client.
    replyTo: company.email || ctx.opsEmail,
    idempotencyKey: "order:" + ctx.ref + ":client"
  };
}

// --- Annulation (équipe) -----------------------------------------------------

const DOOR = { klant: "de klant", personeel: "het personeel", beheerder: "de beheerder" };

function buildCancelTeamMail(ctx) {
  const rows = parseLines(ctx.lignes);
  const klant = ctx.klant || {};
  const reden = String(ctx.reden || ctx.motif || "").trim();
  const door = DOOR[String(ctx.door || "").toLowerCase()] || String(ctx.door || "") || "onbekend";
  const subject = "Bestelling " + ctx.ref + " geannuleerd — " + (klant.nom || "onbekende klant") + " — " + (reden || "geen reden opgegeven");
  const facts = [
    ["Klant", klant.nom],
    ["Klantnummer", klant.klantnr],
    ["Leveradres", klant.adresse],
    ["Telefoon", klant.tel],
    ["E-mail", klant.email],
    ["Gewenste levering", dateNl(ctx.dateLivraison)],
    ["Geannuleerd door", door],
    ["Reden", reden || "geen reden opgegeven"]
  ];
  const html = shell(subject,
    headerRow("Bestelling geannuleerd", ctx.ref + " · door " + door) +
    factsRow(facts) +
    (rows.length ? linesRow(rows, ctx.total) : "") +
    buttonRow("Bestelling openen", ctx.orderUrl) +
    footerRow("Automatisch bericht van het Famo-bestelportaal."),
    (ctx.company || {}).bedrijfsnaam
  );
  const text = "Bestelling " + ctx.ref + " geannuleerd\n" +
    textFacts(facts) + "\n" +
    (rows.length ? "\n" + textLines(rows) + "\n\nTotaal excl. btw: " + eur(ctx.total) + "\n" : "") +
    (ctx.orderUrl ? "\n" + ctx.orderUrl + "\n" : "");
  return {
    to: ctx.opsEmail,
    subject,
    html,
    text,
    replyTo: klant.email,
    idempotencyKey: "cancel:" + ctx.ref
  };
}

// --- Statut (client) ---------------------------------------------------------

function buildStatusMail(ctx) {
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const status = String(ctx.status || "").toLowerCase();
  const rows = parseLines(ctx.lignes);
  const contact = contactBlock(company);
  const portal = String(ctx.portalUrl || "").replace(/\/+$/, "");
  const ordersUrl = portal ? portal + "/klant.html#/bestellingen" : "";
  const closing = "Vragen? Antwoord gerust op dit bericht.";
  let subject, inner, text;

  if (status === "onderweg") {
    subject = "Uw bestelling " + ctx.ref + " is onderweg";
    const wanneer = ctx.dateLivraison ? "Verwachte levering: " + dateNl(ctx.dateLivraison) + "." : "De levering wordt vandaag verwacht.";
    const facts = [["Referentie", ctx.ref], ["Levering", dateNl(ctx.dateLivraison) !== "—" ? dateNl(ctx.dateLivraison) : "vandaag"], ["Leveradres", klant.adresse]];
    inner = headerRow("Uw bestelling is onderweg", klant.nom ? "Voor " + klant.nom : "") +
      paragraphRow("Uw bestelling " + ctx.ref + " is onderweg. " + wanneer) +
      factsRow(facts) +
      (rows.length ? linesRow(rows, ctx.total) : "") +
      paragraphRow(closing) +
      buttonRow("Mijn bestellingen", ordersUrl) +
      footerRow(contact || "FAMO Seafood");
    text = "Uw bestelling " + ctx.ref + " is onderweg. " + wanneer + "\n\n" +
      textFacts(facts) + "\n" +
      (rows.length ? "\n" + textLines(rows) + "\n" : "") +
      "\n" + closing + "\n" + (ordersUrl ? "\n" + ordersUrl + "\n" : "") + (contact ? "\n" + contact + "\n" : "");
  } else if (status === "geleverd") {
    const factuur = String(ctx.factuurnummer || "").trim();
    subject = "Uw bestelling " + ctx.ref + " is geleverd" + (factuur ? " — factuur " + factuur : "");
    const facts = [
      ["Referentie", ctx.ref],
      ["Factuurnummer", factuur],
      ["Geleverd op", dateNl(ctx.dateLivraison || ctx.date)],
      ["Ontvangen door", ctx.ontvangenDoor],
      ["Totaal excl. btw", eur(ctx.total)],
      ["Vervaldatum", dateNl(ctx.vervaldatum)]
    ];
    const betaling = [
      ["IBAN", company.iban],
      ["BIC", company.bic],
      ["Gestructureerde mededeling", ctx.mededeling],
      ["Bedrag", eur(ctx.total)]
    ];
    const betaalTekst = "Gelieve het bedrag te betalen tegen " + dateNl(ctx.vervaldatum) + " op onderstaande rekening" +
      (ctx.mededeling ? ", met vermelding van de gestructureerde mededeling." : ".");
    inner = headerRow("Uw bestelling is geleverd", klant.nom ? "Voor " + klant.nom : "") +
      paragraphRow("Uw bestelling " + ctx.ref + " werd geleverd." + (factuur ? " Uw factuur " + factuur + " staat klaar in het portaal." : "")) +
      factsRow(facts) +
      (rows.length ? linesRow(rows, ctx.total) : "") +
      paragraphRow(company.iban ? betaalTekst : "") +
      credentialsRow(betaling) +
      buttonRow("Factuur bekijken", ordersUrl) +
      paragraphRow(closing) +
      footerRow(contact || "FAMO Seafood");
    text = "Uw bestelling " + ctx.ref + " werd geleverd.\n\n" +
      textFacts(facts) + "\n" +
      (rows.length ? "\n" + textLines(rows) + "\n" : "") +
      (company.iban ? "\n" + betaalTekst + "\n" + textFacts(betaling) + "\n" : "") +
      (ordersUrl ? "\nFactuur bekijken: " + ordersUrl + "\n" : "") +
      "\n" + closing + "\n" + (contact ? "\n" + contact + "\n" : "");
  } else if (status === "geannuleerd") {
    subject = "Uw bestelling " + ctx.ref + " is geannuleerd";
    const reden = String(ctx.reden || ctx.motif || "").trim();
    const facts = [["Referentie", ctx.ref], ["Gewenste levering", dateNl(ctx.dateLivraison)], ["Reden", reden]];
    inner = headerRow("Uw bestelling is geannuleerd", klant.nom ? "Voor " + klant.nom : "") +
      paragraphRow("Uw bestelling " + ctx.ref + " werd geannuleerd door " + (company.bedrijfsnaam || "FAMO Seafood") + ".") +
      factsRow(facts) +
      (rows.length ? linesRow(rows, ctx.total) : "") +
      paragraphRow("Wilt u opnieuw bestellen of hebt u vragen? Antwoord gerust op dit bericht.") +
      buttonRow("Opnieuw bestellen", portal ? portal + "/klant.html" : "") +
      footerRow(contact || "FAMO Seafood");
    text = "Uw bestelling " + ctx.ref + " werd geannuleerd door " + (company.bedrijfsnaam || "FAMO Seafood") + ".\n\n" +
      textFacts(facts) + "\n" +
      (rows.length ? "\n" + textLines(rows) + "\n" : "") +
      "\nWilt u opnieuw bestellen of hebt u vragen? Antwoord gerust op dit bericht.\n" +
      (contact ? "\n" + contact + "\n" : "");
  } else {
    throw new Error("onbekende status: " + ctx.status);
  }

  return {
    to: klant.email,
    subject,
    html: shell(subject, inner, company.bedrijfsnaam),
    text,
    replyTo: company.email || ctx.opsEmail,
    idempotencyKey: "status:" + ctx.ref + ":" + status
  };
}

// --- Accès (client) ----------------------------------------------------------

const PASSWORD_ADVICE = "Wijzig uw wachtwoord bij de eerste aanmelding via Account. Deel deze gegevens met niemand.";

function buildWelcomeMail(ctx) {
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const cred = ctx.credentials || {};
  const naam = company.bedrijfsnaam || "FAMO Seafood";
  const contact = contactBlock(company);
  const portal = String(ctx.portalUrl || "").replace(/\/+$/, "");
  const loginUrl = portal ? portal + "/" : "";
  const subject = "Uw toegang tot het bestelportaal van " + naam;
  const pairs = [["Gebruikersnaam", cred.user], ["Wachtwoord", cred.password]];
  const html = shell(subject,
    headerRow("Welkom in het bestelportaal", klant.nom ? "Voor " + klant.nom : "") +
    paragraphRow("Uw toegang tot het bestelportaal van " + naam + " is klaar. Met onderstaande gegevens meldt u zich aan en bestelt u rechtstreeks online.") +
    credentialsRow(pairs) +
    paragraphRow(PASSWORD_ADVICE) +
    buttonRow("Aanmelden", loginUrl) +
    footerRow(contact || naam),
    company.bedrijfsnaam
  );
  const text = "Welkom in het bestelportaal van " + naam + ".\n\n" +
    textFacts(pairs) + "\n\n" +
    (loginUrl ? "Aanmelden: " + loginUrl + "\n\n" : "") +
    PASSWORD_ADVICE + "\n" + (contact ? "\n" + contact + "\n" : "");
  return {
    to: klant.email,
    subject,
    html,
    text,
    replyTo: company.email || ctx.opsEmail,
    idempotencyKey: "welcome:" + (cred.user || "") + ":" + (ctx.at || "")
  };
}

function buildResetMail(ctx) {
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const naam = company.bedrijfsnaam || "FAMO Seafood";
  const contact = contactBlock(company);
  const portal = String(ctx.portalUrl || "").replace(/\/+$/, "");
  const loginUrl = portal ? portal + "/" : "";
  const user = (ctx.credentials && ctx.credentials.user) || ctx.user || klant.user || "";
  const password = ctx.password || (ctx.credentials && ctx.credentials.password) || "";
  const subject = "Uw nieuw wachtwoord voor het bestelportaal";
  const pairs = [["Gebruikersnaam", user], ["Nieuw wachtwoord", password]];
  const html = shell(subject,
    headerRow("Nieuw wachtwoord", klant.nom ? "Voor " + klant.nom : "") +
    paragraphRow("Uw wachtwoord voor het bestelportaal van " + naam + " werd opnieuw ingesteld. Meld u aan met onderstaande gegevens.") +
    credentialsRow(pairs) +
    paragraphRow(PASSWORD_ADVICE + " Hebt u dit niet aangevraagd? Antwoord dan op dit bericht.") +
    buttonRow("Aanmelden", loginUrl) +
    footerRow(contact || naam),
    company.bedrijfsnaam
  );
  const text = "Uw wachtwoord voor het bestelportaal van " + naam + " werd opnieuw ingesteld.\n\n" +
    textFacts(pairs) + "\n\n" +
    (loginUrl ? "Aanmelden: " + loginUrl + "\n\n" : "") +
    PASSWORD_ADVICE + " Hebt u dit niet aangevraagd? Antwoord dan op dit bericht.\n" +
    (contact ? "\n" + contact + "\n" : "");
  return {
    to: klant.email,
    subject,
    html,
    text,
    replyTo: company.email || ctx.opsEmail,
    idempotencyKey: "reset:" + user + ":" + (ctx.at || "")
  };
}

// --- Demande d'accès (équipe) ------------------------------------------------

function buildSignupTeamMail(ctx) {
  const a = ctx.aanvraag || ctx.klant || {};
  const bedrijf = a.bedrijfsnaam || a.nom || "onbekend bedrijf";
  const portal = String(ctx.portalUrl || "").replace(/\/+$/, "");
  const url = portal ? portal + "/beheer.html#/aanvragen" : "";
  const subject = "Nieuwe aanvraag toegang — " + bedrijf;
  const facts = [
    ["Bedrijf", bedrijf],
    ["Contact", a.contact],
    ["Telefoon", a.tel],
    ["E-mail", a.email],
    ["Adres", a.adresse || a.adres],
    ["Ontvangen op", dateNl(ctx.at)]
  ];
  const html = shell(subject,
    headerRow("Nieuwe aanvraag toegang", bedrijf) +
    factsRow(facts) +
    noteRow("Notities", a.notities || a.notes) +
    buttonRow("Aanvraag behandelen", url) +
    footerRow("Automatisch bericht van het Famo-bestelportaal."),
    (ctx.company || {}).bedrijfsnaam
  );
  const text = "Nieuwe aanvraag toegang — " + bedrijf + "\n" +
    textFacts(facts) + "\n" +
    ((a.notities || a.notes) ? "\nNotities: " + (a.notities || a.notes) + "\n" : "") +
    (url ? "\n" + url + "\n" : "");
  return {
    to: ctx.opsEmail,
    subject,
    html,
    text,
    replyTo: a.email,
    idempotencyKey: "signup:" + (a.email || "") + ":" + (ctx.at || "")
  };
}

// --- Wrappers d'envoi : ne jettent JAMAIS ---------------------------------------

async function notifyOne(name, build, ctx) {
  try {
    if (!mail.enabled()) return { ok: false, skipped: "disabled" };
    return await mail.send(build(ctx || {}));
  } catch (e) {
    console.warn("[mail] " + name + " — " + String(e && e.message || e).slice(0, 200));
    return { ok: false, error: "build" };
  }
}

const notifyCancel = ctx => notifyOne("notifyCancel", buildCancelTeamMail, ctx);
const notifyStatus = ctx => notifyOne("notifyStatus", buildStatusMail, ctx);
const notifyWelcome = ctx => notifyOne("notifyWelcome", buildWelcomeMail, ctx);
const notifySignup = ctx => notifyOne("notifySignup", buildSignupTeamMail, ctx);
const notifyReset = ctx => notifyOne("notifyReset", buildResetMail, ctx);

/** Charge société + boîte ops via le helper at() de l'appelant (lib/ reste sans credentials). */
async function loadMailConfig(at) {
  try {
    const conf = await at(encodeURIComponent("Configuratie") + "?maxRecords=1");
    const c = ((conf && conf.records) || [])[0];
    const f = (c && c.fields) || {};
    return {
      bedrijfsnaam: f["Bedrijfsnaam"] || "",
      telefoon: f["Telefoon"] || "",
      email: String(f["E-mail"] || "").trim(),
      opsEmail: String(f["Bestellingen e-mail"] || "").trim(),
      // Pour le bloc paiement du mail "geleverd" (mêmes champs que api/config.js).
      iban: String(f["IBAN"] || "").trim(),
      bic: String(f["BIC"] || "").trim()
    };
  } catch (e) {
    return { bedrijfsnaam: "", telefoon: "", email: "", opsEmail: "", iban: "", bic: "" };
  }
}

/** Normalise un enregistrement Airtable Clients en bloc utilisable dans les mails. */
function clientFrom(record) {
  const f = (record && record.fields) || {};
  return {
    nom: f["Nom"] || "",
    adresse: f["Lieu de livraison"] || "",
    tel: f["Téléphone"] || "",
    klantnr: f["Klantnummer"] || "",
    email: String(f["Email"] || "").trim()
  };
}

/**
 * Envoie les deux confirmations. Ne rejette JAMAIS : une commande enregistrée
 * ne doit pas pouvoir devenir une erreur à cause d'un e-mail.
 */
async function notifyNewOrder(ctx) {
  try {
    if (!mail.enabled()) return { team: { ok: false, skipped: "disabled" }, customer: { ok: false, skipped: "disabled" } };
    const team = buildTeamMail(ctx);
    const customer = buildCustomerMail(ctx);
    const [teamRes, customerRes] = await mail.sendAll([team, customer]);
    return { team: teamRes, customer: customerRes };
  } catch (e) {
    console.warn("[mail] notifyNewOrder — " + String(e && e.message || e).slice(0, 200));
    return { team: { ok: false, error: "build" }, customer: { ok: false, error: "build" } };
  }
}

/** URL publique du portail, pour le lien staff dans le mail équipe. */
function portalUrl(req) {
  const fixed = String(process.env.PORTAL_URL || "").trim();
  if (fixed) return fixed.replace(/\/+$/, "");
  const h = (req && req.headers) || {};
  const host = h["x-forwarded-host"] || h.host;
  if (!host) return "";
  const proto = h["x-forwarded-proto"] || "https";
  return proto + "://" + host;
}

module.exports = {
  notifyNewOrder,
  loadMailConfig,
  clientFrom,
  portalUrl,
  buildTeamMail,
  buildCustomerMail,
  buildCancelTeamMail,
  buildStatusMail,
  buildWelcomeMail,
  buildSignupTeamMail,
  buildResetMail,
  notifyCancel,
  notifyStatus,
  notifyWelcome,
  notifySignup,
  notifyReset,
  dateNl,
  vervaldatum,
  parseLines,
  eur,
  nlLines,
  nlUnit,
  enabled: mail.enabled
};
