"use strict";
// Transactionele e-mails via Resend (REST). Zonder RESEND_API_KEY gebeurt er niets
// en wordt er niets geprobeerd. send() gooit nooit: een e-mail is een melding,
// geen transactie — een bestelling die al is opgeslagen mag nooit een fout worden.
const cfg = require("./config");
const dom = require("./domain");

const TIMEOUT_MS = 6000;

function esc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function enabled() { return cfg.mailEnabled(); }

function recipients(to) {
  const list = Array.isArray(to) ? to : [to];
  const seen = new Set(), out = [];
  for (const raw of list) {
    const v = String(raw || "").trim();
    if (dom.isEmail(v) && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  return out;
}

/** @returns {Promise<{ok:boolean,id?:string,skipped?:string,status?:number,error?:string}>} */
async function send(msg) {
  const m = msg || {};
  if (!enabled()) return { ok: false, skipped: "uitgeschakeld" };
  const to = recipients(m.to);
  if (!to.length) return { ok: false, skipped: "geen-ontvanger" };
  const subject = String(m.subject || "").trim();
  if (!subject) return { ok: false, skipped: "geen-onderwerp" };
  const payload = { from: cfg.mailFrom, to, subject, html: String(m.html || ""), text: String(m.text || "") };
  if (dom.isEmail(m.replyTo)) payload.reply_to = String(m.replyTo).trim();
  const headers = { Authorization: "Bearer " + cfg.resendKey, "Content-Type": "application/json" };
  if (m.idempotencyKey) headers["Idempotency-Key"] = String(m.idempotencyKey).slice(0, 256);
  try {
    const opts = { method: "POST", headers, body: JSON.stringify(payload) };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) opts.signal = AbortSignal.timeout(TIMEOUT_MS);
    const r = await fetch(cfg.resendApi + "/emails", opts);
    const text = await r.text();
    if (!r.ok) {
      console.warn("[mail] " + r.status + " — " + subject + " (" + to.length + " ontv.) " + text.slice(0, 200));
      return { ok: false, status: r.status, error: text.slice(0, 200) };
    }
    let body = {};
    try { body = JSON.parse(text); } catch (_) { body = {}; }
    return { ok: true, id: body.id || "" };
  } catch (e) {
    console.warn("[mail] netwerkfout — " + subject + " " + String(e && e.message || e).slice(0, 200));
    return { ok: false, error: String(e && e.message || e).slice(0, 200) };
  }
}

// ---- Opmaak (tabellen + inline CSS: werkt in Gmail, Outlook en Apple Mail) ------
const C = { navy: "#0E2A47", accent: "#F26A21", bg: "#F3F6F9", ink: "#14202E", muted: "#5B6B7C", line: "#D9E1EA", card: "#FFFFFF", ok: "#1B9C85" };
const FONT = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const P = `margin:0 0 12px 0;font-size:15px;line-height:1.55;color:${C.ink};${FONT}`;
const MUTED = `font-size:13px;line-height:1.5;color:${C.muted};${FONT}`;
const LABEL = `font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${C.muted};${FONT}`;

function shell({ title, preheader, companyName, body, footer }) {
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + "</title></head>" +
    `<body style="margin:0;padding:0;background:${C.bg};">` +
    (preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : "") +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.bg};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;">` +
    `<tr><td style="background:${C.navy};border-radius:14px 14px 0 0;padding:18px 24px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="width:34px;height:34px;background:${C.accent};border-radius:9px;text-align:center;vertical-align:middle;color:#fff;font-weight:800;font-size:17px;${FONT}">F</td>` +
    `<td style="padding-left:12px;color:#fff;font-weight:800;font-size:15px;letter-spacing:1.5px;${FONT}">${esc(String(companyName || "FAMO TRADING").toUpperCase())}</td>` +
    `</tr></table></td></tr>` +
    `<tr><td style="background:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 14px 14px;padding:8px 24px 20px 24px;">${body}</td></tr>` +
    `<tr><td style="padding:14px 8px 0 8px;${MUTED}text-align:center;">${footer || ""}</td></tr>` +
    "</table></td></tr></table></body></html>";
}
function heading(title, sub) {
  return `<h1 style="margin:16px 0 4px 0;font-size:22px;line-height:1.25;color:${C.ink};font-weight:800;${FONT}">${esc(title)}</h1>` +
    (sub ? `<p style="margin:0 0 14px 0;${MUTED}">${esc(sub)}</p>` : `<div style="height:10px"></div>`);
}
function facts(pairs) {
  const rows = pairs.filter((p) => p && p[1]).map((p) =>
    `<tr><td style="padding:5px 12px 5px 0;width:150px;vertical-align:top;${LABEL}">${esc(p[0])}</td>` +
    `<td style="padding:5px 0;vertical-align:top;font-size:14px;line-height:1.45;color:${C.ink};${FONT}">${esc(p[1]).replace(/\n/g, "<br>")}</td></tr>`).join("");
  return rows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:6px 0 10px 0;">${rows}</table>` : "";
}
function linesTable(lines, totals, opts = {}) {
  const th = `style="padding:8px 8px;background:${C.bg};border-bottom:1px solid ${C.line};font-size:11px;letter-spacing:.5px;text-transform:uppercase;font-weight:600;color:${C.muted};${FONT}"`;
  const td = `style="padding:9px 8px;border-bottom:1px solid ${C.line};font-size:14px;color:${C.ink};${FONT}"`;
  const tdn = `style="padding:9px 8px;border-bottom:1px solid ${C.line};font-size:14px;color:${C.ink};white-space:nowrap;text-align:right;${FONT}"`;
  const withPrices = !opts.hidePrices;
  const head = `<tr><th align="left" ${th}>Artikel</th><th align="right" ${th}>Aantal</th>${withPrices ? `<th align="right" ${th}>Prijs</th><th align="right" ${th}>Bedrag</th>` : ""}</tr>`;
  const body = lines.map((l) => `<tr><td ${td}>${esc(l.name)}${l.comment ? `<div style="${MUTED}font-size:12px;">${esc(l.comment)}</div>` : ""}</td>` +
    `<td ${tdn}>${esc(dom.fmtQty(l.qty))} ${esc(dom.unitPlural(l.unit, l.qty))}</td>` +
    (withPrices ? `<td ${tdn}>${Number.isFinite(l.priceCents) ? esc(dom.fmtEur(l.priceCents)) : "—"}</td><td ${tdn}>${Number.isFinite(l.priceCents) ? esc(dom.fmtEur(dom.lineTotalCents(l))) : "—"}</td>` : "") + "</tr>").join("");
  const foot = (totals || []).map((t) => `<tr><td colspan="${withPrices ? 3 : 1}" style="padding:${t.strong ? "10px" : "5px"} 8px 4px 8px;text-align:right;font-size:${t.strong ? "15px" : "13px"};font-weight:${t.strong ? "800" : "500"};color:${t.strong ? C.ink : C.muted};${t.strong ? "border-top:2px solid " + C.ink + ";" : ""}${FONT}">${esc(t.label)}</td>` +
    `<td style="padding:${t.strong ? "10px" : "5px"} 8px 4px 8px;text-align:right;white-space:nowrap;font-size:${t.strong ? "16px" : "13px"};font-weight:${t.strong ? "800" : "500"};color:${C.ink};${t.strong ? "border-top:2px solid " + C.ink + ";" : ""}${FONT}">${esc(dom.fmtEur(t.cents))}</td></tr>`).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 6px 0;">${head}${body}${foot}</table>`;
}
function note(label, text) {
  if (!text) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:10px 0;"><tr><td style="background:#FFF4EC;border:1px solid #F8D3BC;border-radius:10px;padding:10px 14px;font-size:14px;line-height:1.5;color:${C.ink};${FONT}"><b>${esc(label)}</b><br>${esc(text).replace(/\n/g, "<br>")}</td></tr></table>`;
}
function button(label, href, secondary) {
  if (!href) return "";
  const bg = secondary ? C.card : C.accent, color = secondary ? C.navy : "#fff", border = secondary ? `border:2px solid ${C.navy};` : "";
  return `<a href="${esc(href)}" style="display:inline-block;margin:6px 8px 6px 0;padding:13px 22px;background:${bg};color:${color};${border}text-decoration:none;border-radius:10px;font-size:15px;line-height:18px;font-weight:700;${FONT}">${esc(label)}</a>`;
}
function para(text) { return `<p style="${P}">${esc(text).replace(/\n/g, "<br>")}</p>`; }
function textLines(lines, withPrices) {
  return lines.map((l) => `- ${l.name} × ${dom.fmtQty(l.qty)} ${dom.unitPlural(l.unit, l.qty)}` +
    (withPrices && Number.isFinite(l.priceCents) ? `  ${dom.fmtEur(dom.lineTotalCents(l))}` : "") + (l.comment ? ` (${l.comment})` : "")).join("\n");
}
function contactFooter(company) {
  return [company.companyName, [company.street, company.city].filter(Boolean).join(", "), company.phone, company.email].filter(Boolean).map(esc).join(" · ");
}
function contactText(company) {
  return [company.companyName, [company.street, company.city].filter(Boolean).join(", "), company.phone, company.email].filter(Boolean).join("\n");
}

// ---- Berichten ---------------------------------------------------------------------
// ctx: { order, client, company, portalUrl, source, docLinks:{deliveryNote, invoice} }

function orderTeam(ctx) {
  const { order, client, company } = ctx;
  const subject = `Nieuwe bestelling ${order.ref} · ${client.name || "onbekende klant"} · ${dom.fmtEur(order.totalCents)}`;
  const html = shell({
    title: subject, preheader: `${client.name} bestelt voor ${dom.fmtDateNl(order.deliveryDate, { short: true })}`, companyName: company.companyName,
    body: heading("Nieuwe bestelling", `${order.ref} · via ${ctx.source || "klantportaal"}`) +
      facts([["Klant", client.name], ["Klantnummer", client.number], ["Leveradres", client.address], ["Telefoon", client.phone], ["E-mail", client.email],
        ["Levering", dom.fmtDateNl(order.deliveryDate)], ["Besteld op", dom.fmtDateTimeNl(order.createdTime || new Date().toISOString())]]) +
      linesTable(order.lines, [{ label: "Totaal excl. btw", cents: order.totalCents, strong: true }]) +
      note("Opmerking van de klant", order.notes) +
      button("Bestelling openen", ctx.portalUrl ? `${ctx.portalUrl}/team?bestelling=${encodeURIComponent(order.id)}` : ""),
    footer: `Automatisch bericht van het bestelportaal van ${esc(company.companyName)}.`
  });
  const text = `Nieuwe bestelling ${order.ref} (${ctx.source || "klantportaal"})\nKlant: ${client.name}${client.phone ? " · " + client.phone : ""}\n` +
    (client.address ? `Leveradres: ${client.address}\n` : "") + `Levering: ${dom.fmtDateNl(order.deliveryDate)}\n\n${textLines(order.lines, true)}\n\nTotaal excl. btw: ${dom.fmtEur(order.totalCents)}\n` +
    (order.notes ? `\nOpmerking: ${order.notes}\n` : "") + (ctx.portalUrl ? `\n${ctx.portalUrl}/team?bestelling=${order.id}\n` : "");
  return { to: company.opsEmail, subject, html, text, replyTo: client.email, idempotencyKey: `kade:${order.ref}:team` };
}

function orderClient(ctx) {
  const { order, client, company } = ctx;
  const subject = `Bevestiging van uw bestelling ${order.ref}`;
  const html = shell({
    title: subject, preheader: `Wij leveren op ${dom.fmtDateNl(order.deliveryDate)}.`, companyName: company.companyName,
    body: heading("Bedankt voor uw bestelling", `Wij leveren op ${dom.fmtDateNl(order.deliveryDate)}.`) +
      facts([["Referentie", order.ref], ["Klant", client.name], ["Leveradres", client.address]]) +
      linesTable(order.lines, [{ label: "Totaal excl. btw", cents: order.totalCents, strong: true }]) +
      (order.notes ? note("Uw opmerking", order.notes) : "") +
      para("Dit is een ontvangstbevestiging, geen factuur. De factuur ontvangt u bij de levering.") +
      para(`Wilt u nog iets wijzigen? Antwoord op dit bericht${company.phone ? " of bel ons op " + company.phone : ""}.`) +
      button("Mijn bestellingen", ctx.portalUrl ? `${ctx.portalUrl}/?ga=bestellingen` : ""),
    footer: contactFooter(company)
  });
  const text = `Bedankt voor uw bestelling.\n\nReferentie: ${order.ref}\nLevering: ${dom.fmtDateNl(order.deliveryDate)}\n\n${textLines(order.lines, true)}\n\nTotaal excl. btw: ${dom.fmtEur(order.totalCents)}\n\n` +
    `Dit is een ontvangstbevestiging, geen factuur. De factuur ontvangt u bij de levering.\n\n${contactText(company)}\n`;
  return { to: client.email, subject, html, text, replyTo: company.email, idempotencyKey: `kade:${order.ref}:klant` };
}

function orderShipped(ctx) {
  const { order, client, company, docLinks } = ctx;
  const subject = `Uw bestelling ${order.ref} is onderweg`;
  const html = shell({
    title: subject, preheader: "Onze chauffeur is vertrokken met uw bestelling.", companyName: company.companyName,
    body: heading("Onderweg naar u", "Onze chauffeur is vertrokken met uw bestelling.") +
      facts([["Referentie", order.ref], ["Leveradres", client.address], ["Leverdatum", dom.fmtDateNl(order.deliveryDate)]]) +
      linesTable(order.lines, [], { hidePrices: true }) +
      para("Controleer de goederen bij ontvangst. Is er iets niet in orde? Meld het ons dezelfde dag, dan lossen wij het meteen op.") +
      button("Leveringsbon bekijken", docLinks && docLinks.deliveryNote),
    footer: contactFooter(company)
  });
  const text = `Uw bestelling ${order.ref} is onderweg.\n\nLeveradres: ${client.address}\n\n${textLines(order.lines, false)}\n\n` +
    (docLinks && docLinks.deliveryNote ? `Leveringsbon: ${docLinks.deliveryNote}\n\n` : "") + contactText(company) + "\n";
  return { to: client.email, subject, html, text, replyTo: company.email, idempotencyKey: `kade:${order.ref}:onderweg` };
}

function orderDelivered(ctx) {
  const { order, client, company, docLinks, vat } = ctx;
  const subject = `Factuur ${order.invoiceNumber} · levering ${order.ref}`;
  const pay = company.iban ? `Gelieve ${dom.fmtEur(vat.inclCents)} over te schrijven op ${company.iban}${company.bic ? " (BIC " + company.bic + ")" : ""} met vermelding van ${order.invoiceNumber}.` : "";
  const html = shell({
    title: subject, preheader: `Uw levering is afgerond. Factuur ${order.invoiceNumber}.`, companyName: company.companyName,
    body: heading("Uw levering is afgerond", order.receivedBy ? `In ontvangst genomen door ${order.receivedBy} op ${dom.fmtDateTimeNl(order.deliveredAt)}.` : `Geleverd op ${dom.fmtDateTimeNl(order.deliveredAt)}.`) +
      facts([["Factuurnummer", order.invoiceNumber], ["Factuurdatum", dom.fmtDateShort(dom.todayISO(new Date(order.invoicedAt || Date.now())))], ["Referentie", order.ref], ["Betaling", company.paymentTerms]]) +
      linesTable(order.lines, [
        { label: "Subtotaal excl. btw", cents: vat.exclCents },
        { label: `Btw ${dom.fmtNumber(vat.ratePct, 0)}%`, cents: vat.vatCents },
        { label: "Totaal incl. btw", cents: vat.inclCents, strong: true }
      ]) +
      (pay ? para(pay) : "") +
      button("Factuur openen", docLinks && docLinks.invoice) + button("Leveringsbon", docLinks && docLinks.deliveryNote, true),
    footer: contactFooter(company)
  });
  const text = `Uw levering ${order.ref} is afgerond.\n\nFactuur ${order.invoiceNumber}\n${textLines(order.lines, true)}\n\nSubtotaal excl. btw: ${dom.fmtEur(vat.exclCents)}\nBtw ${vat.ratePct}%: ${dom.fmtEur(vat.vatCents)}\nTotaal incl. btw: ${dom.fmtEur(vat.inclCents)}\n\n${company.paymentTerms}\n${pay}\n\n` +
    (docLinks && docLinks.invoice ? `Factuur: ${docLinks.invoice}\n` : "") + (docLinks && docLinks.deliveryNote ? `Leveringsbon: ${docLinks.deliveryNote}\n` : "") + "\n" + contactText(company) + "\n";
  return { to: client.email, subject, html, text, replyTo: company.email, idempotencyKey: `kade:${order.ref}:factuur` };
}

function invoiceTeamCopy(ctx) {
  const { order, client, company, docLinks, vat } = ctx;
  const subject = `Factuur ${order.invoiceNumber} · ${client.name} · ${dom.fmtEur(vat.inclCents)}`;
  const html = shell({
    title: subject, preheader: `Levering ${order.ref} afgerond en gefactureerd.`, companyName: company.companyName,
    body: heading("Levering afgerond en gefactureerd", `${order.ref} · ${client.name}`) +
      facts([["Factuurnummer", order.invoiceNumber], ["Klant", client.name], ["Ontvangen door", order.receivedBy], ["Geleverd op", dom.fmtDateTimeNl(order.deliveredAt)], ["Totaal incl. btw", dom.fmtEur(vat.inclCents)]]) +
      button("Factuur openen", docLinks && docLinks.invoice) + button("Leveringsbon", docLinks && docLinks.deliveryNote, true),
    footer: `Kopie voor de boekhouding · ${esc(company.companyName)}`
  });
  const text = `Factuur ${order.invoiceNumber} · ${client.name}\nGeleverd op ${dom.fmtDateTimeNl(order.deliveredAt)}${order.receivedBy ? ", ontvangen door " + order.receivedBy : ""}\nTotaal incl. btw: ${dom.fmtEur(vat.inclCents)}\n` +
    (docLinks && docLinks.invoice ? `Factuur: ${docLinks.invoice}\n` : "");
  return { to: company.opsEmail, subject, html, text, idempotencyKey: `kade:${order.ref}:factuur-team` };
}

function requestProspect(ctx) {
  const { request, company } = ctx;
  const subject = "Wij hebben uw aanvraag ontvangen";
  const html = shell({
    title: subject, preheader: "Wij nemen binnen één werkdag contact met u op.", companyName: company.companyName,
    body: heading("Bedankt voor uw aanvraag", `Beste ${request.contact || request.company},`) +
      para("Wij bekijken uw aanvraag en nemen binnen één werkdag contact met u op. Zodra uw account klaar is, ontvangt u uw inloggegevens per e-mail.") +
      facts([["Bedrijf", request.company], ["Contactpersoon", request.contact], ["Telefoon", request.phone], ["Leveradres", request.address]]) +
      para(`Vragen? ${company.phone ? "Bel ons op " + company.phone + " of a" : "A"}ntwoord op dit bericht.`),
    footer: contactFooter(company)
  });
  const text = `Beste ${request.contact || request.company},\n\nWij hebben uw aanvraag voor een klantaccount ontvangen en nemen binnen één werkdag contact met u op.\n\n${contactText(company)}\n`;
  return { to: request.email, subject, html, text, replyTo: company.email, idempotencyKey: `kade:aanvraag:${request.id}:klant` };
}

function requestTeam(ctx) {
  const { request, company } = ctx;
  const subject = `Nieuwe klantaanvraag · ${request.company}`;
  const html = shell({
    title: subject, preheader: `${request.contact} vraagt toegang aan voor ${request.company}.`, companyName: company.companyName,
    body: heading("Nieuwe klantaanvraag", "Via de publieke website.") +
      facts([["Bedrijf", request.company], ["Contactpersoon", request.contact], ["E-mail", request.email], ["Telefoon", request.phone], ["Leveradres", request.address]]) +
      note("Bericht", request.notes) +
      button("Aanvraag behandelen", ctx.portalUrl ? `${ctx.portalUrl}/beheer?aanvraag=${encodeURIComponent(request.id)}` : ""),
    footer: `Automatisch bericht van het bestelportaal van ${esc(company.companyName)}.`
  });
  const text = `Nieuwe klantaanvraag\n\nBedrijf: ${request.company}\nContact: ${request.contact}\nE-mail: ${request.email}\nTelefoon: ${request.phone}\nAdres: ${request.address}\n${request.notes ? "\n" + request.notes + "\n" : ""}` +
    (ctx.portalUrl ? `\n${ctx.portalUrl}/beheer?aanvraag=${request.id}\n` : "");
  return { to: company.opsEmail, subject, html, text, replyTo: request.email, idempotencyKey: `kade:aanvraag:${request.id}:team` };
}

function credentials(ctx) {
  const { client, company, username, password, cutoff } = ctx;
  const subject = `Uw toegang tot het bestelportaal van ${company.companyName}`;
  const url = ctx.portalUrl || "";
  const html = shell({
    title: subject, preheader: "Uw inloggegevens voor het bestelportaal.", companyName: company.companyName,
    body: heading("Welkom bij het bestelportaal", `Beste ${client.name},`) +
      para("Vanaf nu kunt u uw bestellingen online plaatsen, met uw eigen prijzen, op elk moment van de dag.") +
      facts([["Gebruikersnaam", username], ["Wachtwoord", password], ["Bestelportaal", url]]) +
      para(`Bestel vóór ${cutoff || "22:00"} voor levering op de volgende leverdag. U ontvangt telkens een bevestiging per e-mail.`) +
      button("Naar het bestelportaal", url) +
      para("Bewaar deze gegevens goed. Wilt u uw wachtwoord wijzigen? Dat kan onder ‘Mijn account’ in het portaal."),
    footer: contactFooter(company)
  });
  const text = `Beste ${client.name},\n\nUw toegang tot het bestelportaal van ${company.companyName}:\n\nGebruikersnaam: ${username}\nWachtwoord: ${password}\n${url ? "Portaal: " + url + "\n" : ""}\nBestel vóór ${cutoff || "22:00"} voor levering op de volgende leverdag.\n\n${contactText(company)}\n`;
  return { to: client.email, subject, html, text, replyTo: company.email, idempotencyKey: `kade:toegang:${client.id}:${Date.now()}` };
}

function passwordReset(ctx) {
  const { client, company, url } = ctx;
  const subject = "Nieuw wachtwoord instellen — " + company.companyName;
  const html = shell({
    title: subject, preheader: "Kies binnen 30 minuten een nieuw wachtwoord.", companyName: company.companyName,
    body: heading("Nieuw wachtwoord instellen", "Beste " + (client.name || "klant") + ",") +
      para("U vroeg een nieuw wachtwoord aan voor het bestelportaal. Klik op de knop en kies een nieuw wachtwoord. De link werkt 30 minuten.") +
      button("Nieuw wachtwoord kiezen", url) +
      para("Vroeg u dit niet aan? Dan hoeft u niets te doen: uw huidige wachtwoord blijft geldig."),
    footer: contactFooter(company)
  });
  const text = "Beste " + (client.name || "klant") + ",\n\nKies een nieuw wachtwoord via deze link (30 minuten geldig):\n" + url + "\n\nVroeg u dit niet aan? Dan hoeft u niets te doen.\n\n" + contactText(company) + "\n";
  return { to: client.email, subject, html, text, replyTo: company.email, idempotencyKey: "kade:reset:" + client.id + ":" + Date.now() };
}

function requestDeclined(ctx) {
  const { request, company, message } = ctx;
  const subject = "Uw aanvraag bij " + company.companyName;
  const html = shell({
    title: subject, preheader: "Antwoord op uw aanvraag voor een klantaccount.", companyName: company.companyName,
    body: heading("Uw aanvraag", "Beste " + (request.contact || request.company) + ",") +
      para(message || "Bedankt voor uw interesse. Op dit moment kunnen wij geen account voor u openen.") +
      para("Hebt u vragen? Antwoord gerust op dit bericht" + (company.phone ? " of bel ons op " + company.phone : "") + "."),
    footer: contactFooter(company)
  });
  const text = "Beste " + (request.contact || request.company) + ",\n\n" + (message || "Bedankt voor uw interesse. Op dit moment kunnen wij geen account voor u openen.") + "\n\n" + contactText(company) + "\n";
  return { to: request.email, subject, html, text, replyTo: company.email, idempotencyKey: "kade:aanvraag:" + request.id + ":afgewezen" };
}

function orderCancelled(ctx) {
  const { order, client, company } = ctx;
  const subject = "Geannuleerd door klant: bestelling " + order.ref + " · " + (client.name || "");
  const html = shell({
    title: subject, preheader: client.name + " annuleerde bestelling " + order.ref + ".", companyName: company.companyName,
    body: heading("Bestelling geannuleerd", order.ref + " · " + (client.name || "")) +
      facts([["Klant", client.name], ["Telefoon", client.phone], ["Levering was gepland op", dom.fmtDateNl(order.deliveryDate)], ["Reden", ctx.reason]]) +
      linesTable(order.lines, [{ label: "Totaal excl. btw", cents: order.totalCents, strong: true }]),
    footer: "Automatisch bericht van het bestelportaal van " + esc(company.companyName) + "."
  });
  const text = "Bestelling " + order.ref + " van " + client.name + " is door de klant geannuleerd.\nGeplande levering: " + dom.fmtDateNl(order.deliveryDate) + "\n" + (ctx.reason ? "Reden: " + ctx.reason + "\n" : "") + "\n" + textLines(order.lines, true) + "\n";
  return { to: company.opsEmail, subject, html, text, replyTo: client.email, idempotencyKey: "kade:" + order.ref + ":geannuleerd" };
}

// ---- Verzendhulpjes (gooien nooit) --------------------------------------------------
async function sendAll(messages) {
  const out = {};
  await Promise.all(Object.entries(messages).map(async ([k, m]) => { out[k] = await send(m); }));
  return out;
}
const templates = { orderTeam, orderClient, orderShipped, orderDelivered, invoiceTeamCopy, requestProspect, requestTeam, credentials, passwordReset, requestDeclined, orderCancelled };

module.exports = { enabled, send, sendAll, templates, esc, recipients };
