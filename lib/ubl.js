"use strict";
// Facture et note de crédit UBL 2.1 au profil Peppol BIS Billing 3.0 (EN 16931), celles que le
// comptable importe dans Billtobox et envoie par Peppol. Aucune dépendance : XML écrit à la main,
// échappé, montants calculés par la règle unique assets/vat.js (ce que Peppol revérifie).
//
// Codes utilisés :
//   EndpointID / PartyLegalEntity : schéma 0208 = numéro d'entreprise belge (BCE, 10 chiffres).
//   TaxCategory : S (taux > 0), Z (0 %). Unités UN/ECE rec. 20/21 : KGM, H87 (pièce), XBX (caisse),
//   XCT (carton). PaymentMeans 30 = virement ; PaymentID = communication structurée (OGM).
const vat = require("../assets/vat.js");
const bill = require("./billing");

const CUSTOMIZATION = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
const PROFILE = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const UNIT = { kg: "KGM", "pièce": "H87", piece: "H87", stuk: "H87", caisse: "XBX", kassa: "XBX", carton: "XCT", doos: "XCT" };

const x = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const amt = (n) => vat.r2(n).toFixed(2);
const qtyTxt = (n) => String(Math.round(Number(n) * 1000) / 1000);
const digits = (s) => String(s || "").replace(/\D/g, "");
// Date civile à Bruxelles (une facture émise à 00:30 le 1er est datée du 1er, pas de la veille UTC).
const day = (iso) => { const d = iso ? new Date(iso) : new Date(); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(d); };
const plusDays = (ymd, n) => { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + Number(n || 0)); return d.toISOString().slice(0, 10); };

// « Jezusstraat 32\n2000 Antwerpen » → { street, zip, city } ; pays BE par défaut.
function address(text, zipCityOverride) {
  const lines = String(text || "").split(/\n|,/).map((l) => l.trim()).filter(Boolean);
  const zc = String(zipCityOverride || "").trim() || lines.find((l) => /^\d{4}\s+\S/.test(l)) || "";
  const m = zc.match(/^(\d{4})\s+(.+)$/);
  const street = lines.filter((l) => l !== zc)[0] || "";
  return { street, zip: m ? m[1] : "", city: m ? m[2] : zc, country: "BE" };
}

// Numéro d'entreprise belge depuis un n° TVA (BE0123456789) ; vide si non belge ou invalide.
function beCompanyNo(btw) {
  const s = String(btw || "").toUpperCase().replace(/\s|\./g, "");
  if (s && !/^(BE)?\d{9,10}$/.test(s)) return "";
  const d = digits(s).padStart(10, "0");
  return d.length === 10 && 97 - (Number(d.slice(0, 8)) % 97) === Number(d.slice(8)) ? d : "";
}

// Contrôles avant génération : ce que Peppol refuserait. Renvoie une liste de messages (vide = ok).
function problems(ctx) {
  const out = [];
  const s = ctx.seller, b = ctx.buyer;
  if (!s.naam) out.push("Juridische naam van het bedrijf ontbreekt (Beheer → Bedrijf)");
  if (!beCompanyNo(s.btw)) out.push("BTW-nummer van het bedrijf ontbreekt of is ongeldig");
  if (!s.adres.zip || !s.adres.city) out.push("Postcode en plaats van het bedrijf ontbreken");
  if (!b.naam) out.push("Klantnaam ontbreekt");
  if (!beCompanyNo(b.btw)) out.push("BTW-nummer van de klant ontbreekt of is geen geldig Belgisch nummer (Peppol-adres)");
  if (!b.adres.city) out.push("Adres van de klant (postcode en plaats) ontbreekt");
  if (!ctx.lines.length) out.push("Geen lijnen met prijs");
  if (!ctx.number) out.push("Factuurnummer ontbreekt");
  return out;
}

function party(p, role) {
  const nr = beCompanyNo(p.btw);
  return `<cac:${role}><cac:Party>` +
    `<cbc:EndpointID schemeID="0208">${x(nr)}</cbc:EndpointID>` +
    (p.handelsnaam && p.handelsnaam !== p.naam ? `<cac:PartyName><cbc:Name>${x(p.handelsnaam)}</cbc:Name></cac:PartyName>` : "") +
    `<cac:PostalAddress>${p.adres.street ? `<cbc:StreetName>${x(p.adres.street)}</cbc:StreetName>` : ""}<cbc:CityName>${x(p.adres.city)}</cbc:CityName>${p.adres.zip ? `<cbc:PostalZone>${x(p.adres.zip)}</cbc:PostalZone>` : ""}<cac:Country><cbc:IdentificationCode>${x(p.adres.country)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>` +
    `<cac:PartyTaxScheme><cbc:CompanyID>BE${x(nr)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` +
    `<cac:PartyLegalEntity><cbc:RegistrationName>${x(p.naam)}</cbc:RegistrationName><cbc:CompanyID schemeID="0208">${x(nr)}</cbc:CompanyID>${p.legalForm ? `<cbc:CompanyLegalForm>${x(p.legalForm)}</cbc:CompanyLegalForm>` : ""}</cac:PartyLegalEntity>` +
    (p.email ? `<cac:Contact><cbc:ElectronicMail>${x(p.email)}</cbc:ElectronicMail></cac:Contact>` : "") +
    `</cac:Party></cac:${role}>`;
}
const cat = (rate) => (Number(rate) > 0 ? "S" : "Z");

// ctx : { kind: "invoice"|"credit", number, issueDate, dueDate, orderRef, billingRef (facture d'origine
//   pour une note de crédit), note, seller:{naam, handelsnaam, legalForm, btw, adres, iban, bic, email},
//   buyer:{naam, btw, adres, email}, lines:[{name, qty, unit, price}], rates:{produit: taux}, fallback, paymentId }
function build(ctx) {
  const credit = ctx.kind === "credit";
  const t = vat.totals(ctx.lines, (n) => vat.rateFrom(ctx.rates, n, ctx.fallback));
  const root = credit ? "CreditNote" : "Invoice";
  const ns = credit ? "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" : "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
  const lineTag = credit ? "CreditNoteLine" : "InvoiceLine";
  const qtyTag = credit ? "CreditedQuantity" : "InvoicedQuantity";
  const lines = t.lines.filter((l) => l.amount != null).map((l, i) =>
    `<cac:${lineTag}><cbc:ID>${i + 1}</cbc:ID><cbc:${qtyTag} unitCode="${UNIT[String(l.unit || "").toLowerCase()] || "H87"}">${qtyTxt(l.qty)}</cbc:${qtyTag}>` +
    `<cbc:LineExtensionAmount currencyID="EUR">${amt(l.amount)}</cbc:LineExtensionAmount>` +
    `<cac:Item><cbc:Name>${x(l.name)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${cat(l.rate)}</cbc:ID><cbc:Percent>${l.rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>` +
    `<cac:Price><cbc:PriceAmount currencyID="EUR">${amt(l.price)}</cbc:PriceAmount></cac:Price></cac:${lineTag}>`).join("");
  const subtotals = t.groups.map((g) =>
    `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">${amt(g.base)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">${amt(g.tva)}</cbc:TaxAmount>` +
    `<cac:TaxCategory><cbc:ID>${cat(g.rate)}</cbc:ID><cbc:Percent>${g.rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join("");
  const iban = String(ctx.seller.iban || "").replace(/\s+/g, "");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<${root} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">` +
    `<cbc:CustomizationID>${CUSTOMIZATION}</cbc:CustomizationID><cbc:ProfileID>${PROFILE}</cbc:ProfileID>` +
    `<cbc:ID>${x(ctx.number)}</cbc:ID><cbc:IssueDate>${x(ctx.issueDate)}</cbc:IssueDate>` +
    (!credit && ctx.dueDate ? `<cbc:DueDate>${x(ctx.dueDate)}</cbc:DueDate>` : "") +
    `<cbc:${credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>${credit ? "381" : "380"}</cbc:${credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>` +
    (ctx.note ? `<cbc:Note>${x(ctx.note)}</cbc:Note>` : "") +
    `<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode><cbc:BuyerReference>${x(ctx.orderRef || ctx.number)}</cbc:BuyerReference>` +
    (ctx.orderRef ? `<cac:OrderReference><cbc:ID>${x(ctx.orderRef)}</cbc:ID></cac:OrderReference>` : "") +
    (credit && ctx.billingRef ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${x(ctx.billingRef)}</cbc:ID>${ctx.billingRefDate ? `<cbc:IssueDate>${x(ctx.billingRefDate)}</cbc:IssueDate>` : ""}</cac:InvoiceDocumentReference></cac:BillingReference>` : "") +
    party(ctx.seller, "AccountingSupplierParty") + party(ctx.buyer, "AccountingCustomerParty") +
    (ctx.deliveryDate ? `<cac:Delivery><cbc:ActualDeliveryDate>${x(ctx.deliveryDate)}</cbc:ActualDeliveryDate></cac:Delivery>` : "") +
    (iban ? `<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>${ctx.paymentId ? `<cbc:PaymentID>${x(ctx.paymentId)}</cbc:PaymentID>` : ""}<cac:PayeeFinancialAccount><cbc:ID>${x(iban)}</cbc:ID>${ctx.seller.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${x(ctx.seller.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ""}</cac:PayeeFinancialAccount></cac:PaymentMeans>` : "") +
    (!credit && ctx.paymentTerms ? `<cac:PaymentTerms><cbc:Note>${x(ctx.paymentTerms)}</cbc:Note></cac:PaymentTerms>` : "") +
    `<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${amt(t.tva)}</cbc:TaxAmount>${subtotals}</cac:TaxTotal>` +
    `<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">${amt(t.htva)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">${amt(t.htva)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">${amt(t.total)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">${amt(t.total)}</cbc:PayableAmount></cac:LegalMonetaryTotal>` +
    lines + `</${root}>\n`;
  return { xml, totals: t };
}

// Contexte UBL depuis les enregistrements Commandes / Clients / Configuratie (+ taux du catalogue).
function contextFrom({ order, client, config, catalogueRates, parseLines, kind }) {
  const f = order.fields || {}, c = config || {}, cl = (client && client.fields) || {};
  const credit = kind === "credit";
  const legal = bill.legalOf(c), fallback = bill.defaultRate(c);
  const src = parseLines(credit ? f["Creditnota lignes"] : f["Lignes (produits / quantités)"]);
  const rates = bill.linesRates(parseLines(f["Lignes (produits / quantités)"]), f, catalogueRates, fallback);
  const issue = day(credit ? f["Creditnota le"] : f["Facturée le"]);
  const termijn = Number(c["Betaaltermijn dagen"]) > 0 ? Number(c["Betaaltermijn dagen"]) : 14;
  const number = credit ? f["Creditnota nummer"] : f["Factuurnummer"];
  return {
    kind: credit ? "credit" : "invoice", number, issueDate: issue, dueDate: credit ? "" : plusDays(issue, termijn),
    orderRef: f["Référence"] || "", billingRef: credit ? f["Factuurnummer"] : "", billingRefDate: credit ? day(f["Facturée le"]) : "",
    deliveryDate: f["Livrée le"] ? day(f["Livrée le"]) : "",
    note: credit ? String(f["Creditnota motif"] || "").slice(0, 300) : "",
    paymentId: credit ? "" : bill.structuredRef(number), paymentTerms: String(c["Betalingsvoorwaarden"] || "").trim() || ("Betaalbaar binnen " + termijn + " dagen"),
    seller: { naam: legal.naam ? legal.naam + (legal.rechtsvorm && !legal.naam.toLowerCase().split(/[^a-z0-9.]+/).includes(legal.rechtsvorm.toLowerCase()) ? " " + legal.rechtsvorm : "") : "", handelsnaam: legal.handelsnaam, legalForm: legal.rpr, btw: legal.btw, adres: address(c["Adres"], c["Postcode en plaats"]), iban: c["IBAN"] || "", bic: c["BIC"] || "", email: c["E-mail"] || "" },
    buyer: { naam: cl["Nom"] || "", btw: cl["BTW-nummer"] || "", adres: address(cl["Facturatieadres"] || cl["Lieu de livraison"]), email: cl["Email"] || "" },
    lines: src.filter((l) => l.price != null).map((l) => ({ name: l.nom, qty: l.qty, unit: l.unit, price: l.price })),
    rates, fallback
  };
}

module.exports = { build, contextFrom, problems, address, beCompanyNo, UNIT, CUSTOMIZATION, PROFILE };
