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
// staff-i18n.js : ces fichiers sont des assets navigateur à la racine, hors du
// graphe require, donc pas fiablement inclus dans le bundle serverless Vercel.
// La dérive est rattrapée par les tests de parité (section M de workflow-check).
const mail = require("./mail");

// Table identique à staff-i18n.js — "caisse" s'affiche TOUJOURS "kassa".
const UNITS = { "caisse": "kassa", "carton": "doos", "pièce": "stuk", "piece": "stuk", "kg": "kg" };

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function eur(value) {
  return "€ " + Number(value || 0).toFixed(2).replace(".", ",");
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

// --- Briques HTML compatibles clients mail -----------------------------------
// Tables uniquement, tout le CSS en ligne : Gmail supprime <style> dans la vue
// repliée, et le moteur Word d'Outlook ignore flexbox.
const FONT = "font-family:Arial,Helvetica,sans-serif";
const MUTED = "color:#6b6b6b;font-size:13px;line-height:1.5;" + FONT;

function shell(title, inner) {
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>" + esc(title) + "</title></head>" +
    '<body style="margin:0;padding:0;background:#f4f4f4;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f4;">' +
    '<tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e5e5e5;border-radius:10px;">' +
    inner +
    "</table></td></tr></table></body></html>";
}

function headerRow(title, subtitle) {
  return '<tr><td style="padding:22px 24px 6px 24px;">' +
    '<div style="font-size:19px;font-weight:bold;color:#111111;' + FONT + '">' + esc(title) + "</div>" +
    (subtitle ? '<div style="margin-top:4px;' + MUTED + '">' + esc(subtitle) + "</div>" : "") +
    "</td></tr>";
}

function factsRow(pairs) {
  const rows = pairs.filter(p => p && p[1]).map(p =>
    '<tr><td style="padding:3px 0;width:150px;vertical-align:top;' + MUTED + '">' + esc(p[0]) + "</td>" +
    '<td style="padding:3px 0;vertical-align:top;font-size:13.5px;color:#111111;' + FONT + '">' + esc(p[1]) + "</td></tr>"
  ).join("");
  if (!rows) return "";
  return '<tr><td style="padding:10px 24px 4px 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + rows + "</table></td></tr>";
}

function linesRow(rows, total) {
  const head = '<tr>' +
    '<th align="left" style="padding:7px 8px;background:#f4f4f4;border-bottom:1px solid #e5e5e5;font-size:11px;text-transform:uppercase;color:#6b6b6b;' + FONT + '">Artikel</th>' +
    '<th align="right" style="padding:7px 8px;background:#f4f4f4;border-bottom:1px solid #e5e5e5;font-size:11px;text-transform:uppercase;color:#6b6b6b;' + FONT + '">Aantal</th>' +
    '<th align="right" style="padding:7px 8px;background:#f4f4f4;border-bottom:1px solid #e5e5e5;font-size:11px;text-transform:uppercase;color:#6b6b6b;' + FONT + '">Subtotaal</th></tr>';
  const body = rows.map(r => {
    const qty = Number(String(r.qty).replace(",", ".")) || 0;
    const sub = r.price == null ? null : r.price * qty;
    return "<tr>" +
      '<td style="padding:9px 8px;border-bottom:1px solid #f0f0f0;font-size:13.5px;color:#111111;' + FONT + '">' +
        esc(r.name) + (r.comment ? '<div style="' + MUTED + 'font-size:12px;">' + esc(r.comment) + "</div>" : "") + "</td>" +
      '<td align="right" style="padding:9px 8px;border-bottom:1px solid #f0f0f0;font-size:13.5px;color:#111111;white-space:nowrap;' + FONT + '">' +
        esc(r.qty) + " " + esc(nlUnit(r.unit)) + "</td>" +
      '<td align="right" style="padding:9px 8px;border-bottom:1px solid #f0f0f0;font-size:13.5px;color:#111111;white-space:nowrap;' + FONT + '">' +
        (sub == null ? "—" : esc(eur(sub))) + "</td></tr>";
  }).join("");
  const foot = '<tr><td colspan="2" align="right" style="padding:11px 8px;font-size:14px;font-weight:bold;color:#111111;' + FONT + '">Totaal</td>' +
    '<td align="right" style="padding:11px 8px;font-size:14px;font-weight:bold;color:#111111;white-space:nowrap;' + FONT + '">' + esc(eur(total)) + "</td></tr>";
  return '<tr><td style="padding:14px 24px 4px 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + head + body + foot + "</table></td></tr>";
}

function noteRow(label, value) {
  if (!value) return "";
  return '<tr><td style="padding:12px 24px 0 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fffdf6;border:1px solid #e6d4a8;border-radius:8px;">' +
    '<tr><td style="padding:11px 13px;font-size:13px;line-height:1.55;color:#7a5800;' + FONT + '">' +
    "<b>" + esc(label) + "</b><br>" + esc(value).replace(/\n/g, "<br>") + "</td></tr></table></td></tr>";
}

function buttonRow(label, href) {
  if (!href) return "";
  return '<tr><td style="padding:16px 24px 4px 24px;">' +
    '<a href="' + esc(href) + '" style="display:inline-block;padding:11px 18px;background:#111111;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13.5px;font-weight:bold;' + FONT + '">' +
    esc(label) + "</a></td></tr>";
}

function footerRow(text) {
  return '<tr><td style="padding:18px 24px 22px 24px;border-top:1px solid #f0f0f0;' + MUTED + '">' +
    esc(text).replace(/\n/g, "<br>") + "</td></tr>";
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
    footerRow("Automatisch bericht van het Famo-bestelportaal.")
  );
  const text = "Nieuwe bestelling " + ctx.ref + "\n" +
    "Klant: " + (klant.nom || "—") + (klant.tel ? " · " + klant.tel : "") + "\n" +
    (klant.adresse ? "Leveradres: " + klant.adresse + "\n" : "") +
    "Gewenste levering: " + dateNl(ctx.dateLivraison) + "\n" +
    "Bron: " + (ctx.bron || "Klantportaal") + "\n\n" +
    textLines(rows) + "\n\nTotaal: " + eur(ctx.total) + "\n" +
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
    '<tr><td style="padding:14px 24px 0 24px;' + MUTED + '">' +
      "Dit is een bevestiging van ontvangst, geen factuur. " +
      "Hebt u een aanpassing nodig? Antwoord gerust op dit bericht." +
    "</td></tr>" +
    footerRow(contact || "Famo Trading")
  );
  const text = "Bedankt voor uw bestelling.\n\n" +
    "Referentie: " + ctx.ref + "\n" +
    "Gewenste levering: " + dateNl(ctx.dateLivraison) + "\n\n" +
    textLines(rows) + "\n\nTotaal: " + eur(ctx.total) + "\n\n" +
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
      opsEmail: String(f["Bestellingen e-mail"] || "").trim()
    };
  } catch (e) {
    return { bedrijfsnaam: "", telefoon: "", email: "", opsEmail: "" };
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
  parseLines,
  nlLines,
  nlUnit,
  enabled: mail.enabled
};
