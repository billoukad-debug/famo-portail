"use strict";
// Afdrukbare documenten: leveringsbon, factuur, picklijst. Zuivere HTML met
// print-CSS (A4) — afdrukken vanaf de tablet via de browser, geen bibliotheek.
const dom = require("./domain");

function esc(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const nl2br = (s) => esc(s).replace(/\n/g, "<br>");
const noteText = (s) => String(s || "").replace(/^\[[^\]]+\]\s*/, "");

const CSS = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font: 11pt/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #14202E; background: #E9EEF3; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.toolbar { position: sticky; top: 0; z-index: 5; background: #0E2A47; color: #fff; padding: 10px 16px; display: flex; gap: 12px; align-items: center; }
.toolbar .t { font-weight: 700; flex: 1; }
.toolbar button, .toolbar a { border: 0; border-radius: 10px; padding: 10px 16px; font: inherit; font-weight: 700; cursor: pointer; text-decoration: none; }
.toolbar .p { background: #F26A21; color: #fff; }
.toolbar .s { background: transparent; color: #fff; border: 2px solid rgba(255,255,255,.5); }
.sheet { background: #fff; width: 210mm; max-width: 100%; margin: 16px auto; padding: 14mm 14mm 12mm; box-shadow: 0 6px 24px rgba(14,42,71,.14); }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 3px solid #0E2A47; padding-bottom: 10px; }
.brand { font-weight: 800; font-size: 19pt; letter-spacing: .4px; color: #0E2A47; line-height: 1.1; }
.brand small { display: block; font-weight: 500; font-size: 9.5pt; letter-spacing: 0; color: #5B6B7C; margin-top: 4px; }
.doc { text-align: right; }
.doc h1 { margin: 0; font-size: 22pt; letter-spacing: .5px; color: #0E2A47; }
.doc .nr { font-size: 13pt; font-weight: 700; }
.doc .sub { color: #5B6B7C; font-size: 9.5pt; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 14px 0 6px; }
.box { border: 1px solid #D9E1EA; border-radius: 10px; padding: 10px 12px; min-height: 26mm; }
.label { font-size: 8pt; text-transform: uppercase; letter-spacing: .7px; color: #5B6B7C; margin-bottom: 4px; }
.box .name { font-weight: 800; font-size: 12pt; }
.meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 10px 0 4px; }
.meta .box { min-height: 0; padding: 8px 10px; }
.meta .v { font-weight: 700; }
table.lines { width: 100%; border-collapse: collapse; margin-top: 10px; }
.lines th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .5px; color: #5B6B7C; border-bottom: 2px solid #0E2A47; padding: 6px 6px; }
.lines td { padding: 7px 6px; border-bottom: 1px solid #D9E1EA; vertical-align: top; }
.lines tr { break-inside: avoid; }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.lines .c { color: #5B6B7C; font-size: 9.5pt; }
.totals { margin-left: auto; width: 76mm; margin-top: 8px; border-collapse: collapse; }
.totals td { padding: 4px 6px; }
.totals .grand td { font-weight: 800; font-size: 13pt; border-top: 2px solid #0E2A47; padding-top: 8px; }
.totals .m { color: #5B6B7C; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }
.sign .box { min-height: 30mm; }
.sign img { max-height: 22mm; max-width: 100%; display: block; }
.stamp { display: inline-block; border: 2.5px solid #1B9C85; color: #1B9C85; padding: 3px 10px; border-radius: 8px; font-weight: 800; letter-spacing: 1px; transform: rotate(-3deg); }
.stamp.open { border-color: #E0A100; color: #B07F00; }
.foot { margin-top: 20px; font-size: 8.5pt; color: #5B6B7C; border-top: 1px solid #D9E1EA; padding-top: 8px; line-height: 1.5; }
.chk { display: inline-block; width: 16px; height: 16px; border: 1.6px solid #14202E; border-radius: 4px; vertical-align: -3px; }
.pick { border: 1.5px solid #0E2A47; border-radius: 12px; padding: 10px 12px; margin-top: 12px; break-inside: avoid; }
.pick h2 { margin: 0 0 4px; font-size: 14pt; display: flex; justify-content: space-between; }
.pick .addr { color: #5B6B7C; font-size: 10pt; margin-bottom: 6px; }
.pick table { width: 100%; border-collapse: collapse; }
.pick td { padding: 7px 6px; border-bottom: 1px dashed #D9E1EA; font-size: 12.5pt; }
.pick td.q { font-weight: 800; white-space: nowrap; font-size: 14pt; }
.pick .note { background: #FFF4EC; border: 1px solid #F8D3BC; border-radius: 8px; padding: 6px 10px; margin-top: 6px; font-size: 10.5pt; }
.summary td { font-size: 11.5pt; }
h3.sec { margin: 14px 0 4px; font-size: 10pt; text-transform: uppercase; letter-spacing: .7px; color: #5B6B7C; }
@media print { body { background: #fff; } .toolbar { display: none; } .sheet { box-shadow: none; margin: 0; padding: 0; width: auto; } }
@media (max-width: 700px) { .sheet { padding: 14px; } .parties, .sign { grid-template-columns: 1fr; } .meta { grid-template-columns: 1fr 1fr; } }
`;

function page(title, inner, opts = {}) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body>` +
    `<div class="toolbar"><div class="t">${esc(title)}</div>${opts.backHref ? `<a class="s" href="${esc(opts.backHref)}">Terug</a>` : ""}<button class="p" onclick="window.print()">Afdrukken</button></div>` +
    `<div class="sheet">${inner}</div></body></html>`;
}

function companyBlock(c) {
  return `<div class="brand">${esc(c.companyName)}<small>${[c.street, c.city].filter(Boolean).map(esc).join(" · ")}${c.vat ? "<br>Btw " + esc(c.vat) : ""}${c.phone || c.email ? "<br>" + [c.phone, c.email].filter(Boolean).map(esc).join(" · ") : ""}</small></div>`;
}
function clientBlock(client, label) {
  return `<div class="box"><div class="label">${esc(label)}</div><div class="name">${esc(client.name)}</div>` +
    (client.address ? `<div>${nl2br(client.address)}</div>` : "") + (client.vat ? `<div class="c">Btw ${esc(client.vat)}</div>` : "") +
    (client.number ? `<div class="c" style="color:#5B6B7C">Klantnummer ${esc(client.number)}</div>` : "") + (client.phone ? `<div style="color:#5B6B7C">${esc(client.phone)}</div>` : "") + "</div>";
}
function metaBox(k, v) { return `<div class="box"><div class="label">${esc(k)}</div><div class="v">${esc(v || "—")}</div></div>`; }

function linesTable(lines, { prices = true, checkboxes = false } = {}) {
  const head = `<tr>${checkboxes ? "<th style=\"width:24px\"></th>" : ""}<th>Omschrijving</th><th class="num">Aantal</th>${prices ? '<th class="num">Eenheidsprijs</th><th class="num">Bedrag</th>' : ""}</tr>`;
  const rows = lines.map((l) => `<tr>${checkboxes ? '<td><span class="chk"></span></td>' : ""}<td>${esc(l.name)}${l.comment ? `<div class="c">${esc(l.comment)}</div>` : ""}</td>` +
    `<td class="num">${esc(dom.fmtQty(l.qty))} ${esc(dom.unitPlural(l.unit, l.qty))}</td>` +
    (prices ? `<td class="num">${Number.isFinite(l.priceCents) ? esc(dom.fmtEur(l.priceCents)) : "—"}</td><td class="num">${Number.isFinite(l.priceCents) ? esc(dom.fmtEur(dom.lineTotalCents(l))) : "—"}</td>` : "") + "</tr>").join("");
  return `<table class="lines">${head}${rows}</table>`;
}

/** Leveringsbon: zonder prijzen, met ontvangstvak. */
function renderDeliveryNote({ order, client, company, backHref }) {
  const inner =
    `<div class="head">${companyBlock(company)}<div class="doc"><h1>Leveringsbon</h1><div class="nr">${esc(order.ref)}</div><div class="sub">Leverdatum ${esc(dom.fmtDateShort(order.deliveryDate || order.date))}</div></div></div>` +
    `<div class="parties">${clientBlock(client, "Leveren aan")}<div class="box"><div class="label">Details</div>` +
    `<div>Besteld op <b>${esc(dom.fmtDateShort(order.date))}</b></div><div>Referentie <b>${esc(order.ref)}</b></div>${order.invoiceNumber ? `<div>Factuur <b>${esc(order.invoiceNumber)}</b></div>` : ""}` +
    (order.preparedAt ? `<div>Klaargezet op ${esc(dom.fmtDateTimeNl(order.preparedAt))}</div>` : "") + `</div></div>` +
    linesTable(order.lines, { prices: false, checkboxes: true }) +
    (noteText(order.notes) ? `<div class="pick"><div class="label">Opmerking</div>${nl2br(noteText(order.notes))}</div>` : "") +
    `<div class="sign"><div class="box"><div class="label">Ontvangen door (naam)</div>${order.receivedBy ? `<div class="name">${esc(order.receivedBy)}</div><div class="c" style="color:#5B6B7C">${esc(dom.fmtDateTimeNl(order.deliveredAt))}</div>` : ""}</div>` +
    `<div class="box"><div class="label">Handtekening</div>${order.proof && order.proof[0] && order.proof[0].url ? `<img src="${esc(order.proof[0].url)}" alt="Handtekening">` : ""}</div></div>` +
    `<div class="foot">${nl2br(company.deliveryTerms || "")}</div>`;
  return page(`Leveringsbon ${order.ref}`, inner, { backHref });
}

/** Factuur: wettelijke vermeldingen, btw-uitsplitsing, betaalgegevens. */
function renderInvoice({ order, client, company, backHref }) {
  const vat = dom.vatBreakdown(order.totalCents, company.vatRate);
  const invoiceDate = order.invoicedAt ? dom.todayISO(new Date(order.invoicedAt)) : (order.deliveryDate || order.date);
  const deliveredDate = order.deliveredAt ? dom.todayISO(new Date(order.deliveredAt)) : (order.deliveryDate || order.date);
  const inner =
    `<div class="head">${companyBlock(company)}<div class="doc"><h1>Factuur</h1><div class="nr">${esc(order.invoiceNumber || "ONTWERP")}</div><div class="sub">${order.paid ? '<span class="stamp">Betaald</span>' : '<span class="stamp open">Openstaand</span>'}</div></div></div>` +
    `<div class="parties">${clientBlock(client, "Gefactureerd aan")}<div class="box"><div class="label">Afzender</div><div class="name">${esc(company.companyName)}</div>` +
    `<div>${[company.street, company.city].filter(Boolean).map(esc).join("<br>")}</div>${company.vat ? `<div>Btw ${esc(company.vat)}</div>` : ""}${company.iban ? `<div>IBAN ${esc(company.iban)}${company.bic ? " · BIC " + esc(company.bic) : ""}</div>` : ""}</div></div>` +
    `<div class="meta">${metaBox("Factuurnummer", order.invoiceNumber || "—")}${metaBox("Factuurdatum", dom.fmtDateShort(invoiceDate))}${metaBox("Leverdatum", dom.fmtDateShort(deliveredDate))}${metaBox("Referentie", order.ref)}</div>` +
    linesTable(order.lines, { prices: true }) +
    `<table class="totals"><tr><td class="m">Subtotaal excl. btw</td><td class="num">${esc(dom.fmtEur(vat.exclCents))}</td></tr>` +
    `<tr><td class="m">Btw ${esc(dom.fmtNumber(vat.ratePct, 0))}%</td><td class="num">${esc(dom.fmtEur(vat.vatCents))}</td></tr>` +
    `<tr class="grand"><td>Totaal incl. btw</td><td class="num">${esc(dom.fmtEur(vat.inclCents))}</td></tr></table>` +
    `<div class="sign"><div class="box"><div class="label">Betaling</div><div><b>${esc(company.paymentTerms)}</b></div>` +
    (company.iban ? `<div>Over te schrijven op <b>${esc(company.iban)}</b>${company.bic ? " (BIC " + esc(company.bic) + ")" : ""}<br>Mededeling: <b>${esc(order.invoiceNumber || order.ref)}</b></div>` : `<div>Betaalgegevens ontvangt u van ons; neem gerust contact op.</div>`) + `</div>` +
    `<div class="box"><div class="label">Levering</div>${order.receivedBy ? `<div>Ontvangen door <b>${esc(order.receivedBy)}</b><br>${esc(dom.fmtDateTimeNl(order.deliveredAt))}</div>` : `<div>${esc(dom.fmtDateShort(order.deliveryDate || order.date))}</div>`}` +
    (order.proof && order.proof[0] && order.proof[0].url ? `<img src="${esc(order.proof[0].url)}" alt="Handtekening" style="max-height:18mm;margin-top:4px">` : "") + `</div></div>` +
    `<div class="foot">${esc(company.companyName)}${company.vat ? " · Btw " + esc(company.vat) : ""}${company.street ? " · " + esc(company.street) + ", " + esc(company.city) : ""}${company.email ? " · " + esc(company.email) : ""}${company.phone ? " · " + esc(company.phone) : ""}<br>${nl2br(company.deliveryTerms || "")}</div>`;
  return page(`Factuur ${order.invoiceNumber || order.ref}`, inner, { backHref });
}

/** Picklijst voor één dag: eerst de totalen per artikel, dan elke bestelling apart. */
function renderPicklist({ date, orders, clientsById, company, backHref }) {
  const totals = new Map();
  orders.forEach((o) => o.lines.forEach((l) => {
    const key = l.name.toLowerCase() + "|" + dom.unitLabel(l.unit);
    const t = totals.get(key) || { name: l.name, unit: l.unit, qty: 0, orders: 0 };
    t.qty = Math.round((t.qty + l.qty) * 1000) / 1000; t.orders++;
    totals.set(key, t);
  }));
  const summary = Array.from(totals.values()).sort((a, b) => a.name.localeCompare(b.name, "nl"));
  const inner =
    `<div class="head">${companyBlock(company)}<div class="doc"><h1>Picklijst</h1><div class="nr">${esc(dom.fmtDateNl(date))}</div><div class="sub">${orders.length} ${orders.length === 1 ? "bestelling" : "bestellingen"}</div></div></div>` +
    (summary.length ? `<h3 class="sec">Totaal te verzamelen</h3><table class="lines summary"><tr><th style="width:24px"></th><th>Artikel</th><th class="num">Totaal</th><th class="num">Bestellingen</th></tr>` +
      summary.map((t) => `<tr><td><span class="chk"></span></td><td>${esc(t.name)}</td><td class="num"><b>${esc(dom.fmtQty(t.qty))} ${esc(dom.unitPlural(t.unit, t.qty))}</b></td><td class="num">${t.orders}</td></tr>`).join("") + "</table>" : `<p>Geen bestellingen voor deze dag.</p>`) +
    orders.map((o) => {
      const c = clientsById[o.clientId] || { name: "Onbekende klant", address: "" };
      return `<div class="pick"><h2><span>${esc(c.name)}</span><span>${esc(o.ref)}</span></h2><div class="addr">${esc(c.address || "")}${c.phone ? " · " + esc(c.phone) : ""}</div>` +
        `<table>${o.lines.map((l) => `<tr><td style="width:24px"><span class="chk"></span></td><td class="q">${esc(dom.fmtQty(l.qty))} ${esc(dom.unitPlural(l.unit, l.qty))}</td><td>${esc(l.name)}${l.comment ? ` <span class="c">— ${esc(l.comment)}</span>` : ""}</td></tr>`).join("")}</table>` +
        (noteText(o.notes) ? `<div class="note"><b>Opmerking:</b> ${nl2br(noteText(o.notes))}</div>` : "") + "</div>";
    }).join("") +
    `<div class="foot">Afgedrukt ${esc(dom.fmtDateTimeNl(new Date().toISOString()))} · ${esc(company.companyName)}</div>`;
  return page(`Picklijst ${dom.fmtDateShort(date)}`, inner, { backHref });
}

module.exports = { renderDeliveryNote, renderInvoice, renderPicklist, esc };
