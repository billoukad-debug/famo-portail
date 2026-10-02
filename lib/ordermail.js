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
// Langue (audit C-15) : tout e-mail destiné AU CLIENT part dans sa langue (Clients → « Taal » :
// FR → français, sinon néerlandais), sujet, corps, unités, dates et montants (fr-BE « 15,00 € »,
// nl-BE « € 15,00 »). La langue voyage dans ctx.klant.taal (clientFrom la remplit). Les e-mails
// internes (boîte « Bestellingen e-mail » : nouvelle commande, annulation, demande d'accès)
// restent en néerlandais.
//
// parseLines/eur/esc/nlUnit sont volontairement recopiés depuis assets/docs/documents.js et
// assets/ui.js (famoNL) : ces fichiers sont des assets navigateur à la racine, hors du
// graphe require, donc pas fiablement inclus dans le bundle serverless Vercel.
// La dérive est rattrapée par les tests de parité (bloc M, test/workflow/emails-documents.test.js).
const mail = require("./mail");
const layout = require("./maillayout");

// Table identique à famoNL (assets/ui.js) — "caisse" s'affiche TOUJOURS "kassa".
const UNITS = { "caisse": "kassa", "carton": "doos", "pièce": "stuk", "piece": "stuk", "kg": "kg" };
// Table identique à K.FR.unit (assets/ui.js) et aux documents FR (assets/docs/documents.js).
const UNITS_FR = { "caisse": "caisse", "carton": "carton", "pièce": "pièce", "piece": "pièce", "kg": "kg" };

const esc = layout.esc;

// Même rendu que l'écran (K.eur) et les documents : € 1.234,50 · € -12,00.
function eur(value) {
  const n = Number(value || 0);
  const s = Math.abs(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "€ " + (n < 0 ? "-" : "") + s;
}

// Usage fr-BE : 1 234,50 € · -12,00 €. Espaces insécables : le montant ne se coupe jamais
// en fin de ligne (le symbole seul sur la ligne suivante).
function eurFr(value) {
  const n = Number(value || 0);
  const s = Math.abs(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "-" : "") + s + " €";
}

function nlUnit(value) {
  return UNITS[String(value || "").toLowerCase()] || value;
}
function frUnit(value) {
  return UNITS_FR[String(value || "").toLowerCase()] || value;
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

function dateIn(locale, value) {
  if (!value) return "—";
  const d = new Date(String(value).includes("T") ? value : value + "T00:00:00");
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(locale);
}
function dateNl(value) { return dateIn("nl-BE", value); }
function dateFr(value) { return dateIn("fr-BE", value); }

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

// --- Textes par langue (e-mails client) -----------------------------------------
// NL : les textes historiques, inchangés mot pour mot (tests). FR : vocabulaire des documents
// (commande, livraison, facture, note de crédit, TVA, HTVA/TVAC).
const T = {
  nl: {
    lang: "nl", eur, date: dateNl, unit: nlUnit, colon: ": ",
    artikel: "Artikel", aantal: "Aantal", subtotaal: "Subtotaal",
    totaalExcl: "Totaal excl. btw", totaalIncl: "Totaal incl. btw",
    forWho: n => "Voor " + n,
    referentie: "Referentie", besteldOp: "Besteld op", gewensteLevering: "Gewenste levering",
    closing: "Vragen? Antwoord gerust op dit bericht.",
    mijnBestellingen: "Mijn bestellingen", factuurBekijken: "Factuur bekijken", opnieuwBestellen: "Opnieuw bestellen",
    // Confirmation
    confirmSubject: ref => "Bevestiging van uw bestelling " + ref,
    confirmTitle: "Bedankt voor uw bestelling",
    confirmThanks: "Bedankt voor uw bestelling.",
    notInvoice: "Dit is een bevestiging van ontvangst, geen factuur.",
    adjust: "Hebt u een aanpassing nodig? Antwoord gerust op dit bericht.",
    // Bestelling per e-mail (specs/020) : automatisch ingevoerd, of eerst door het team bekeken
    viaMail: "We ontvingen uw bestelling per e-mail en voerden ze in zoals hieronder. Klopt er iets niet? Antwoord gerust op dit bericht.",
    ontvangenSubject: () => "We ontvingen uw bericht",
    ontvangenTitle: "Bericht ontvangen",
    ontvangenBody: onderwerp => "We hebben uw bericht" + (onderwerp ? " „" + onderwerp + "”" : "") + " goed ontvangen. Ons team bekijkt het en bevestigt uw bestelling zo snel mogelijk met een aparte e-mail.",
    // En route
    onderwegSubject: ref => "Uw bestelling " + ref + " is onderweg",
    onderwegTitle: "Uw bestelling is onderweg",
    onderwegBody: (ref, wanneer) => "Uw bestelling " + ref + " is onderweg. " + wanneer,
    verwacht: d => "Verwachte levering: " + d + ".",
    vandaagVerwacht: "De levering wordt vandaag verwacht.",
    levering: "Levering", vandaag: "vandaag", leveradres: "Leveradres",
    // Livrée
    geleverdSubject: (ref, factuur) => "Uw bestelling " + ref + " is geleverd" + (factuur ? " — factuur " + factuur : ""),
    geleverdTitle: "Uw bestelling is geleverd",
    geleverdBody: ref => "Uw bestelling " + ref + " werd geleverd.",
    factuurKlaar: nr => " Uw factuur " + nr + " staat klaar in het portaal.",
    viaBoekhouding: " De factuur ontvangt u afzonderlijk van onze boekhouding (via Peppol).",
    factuurnummer: "Factuurnummer", geleverdOp: "Geleverd op", ontvangenDoor: "Ontvangen door", vervaldatum: "Vervaldatum",
    iban: "IBAN", bic: "BIC", mededeling: "Gestructureerde mededeling", bedrag: "Bedrag",
    betaalTekst: (d, ogm) => "Gelieve het bedrag te betalen tegen " + d + " op onderstaande rekening" + (ogm ? ", met vermelding van de gestructureerde mededeling." : "."),
    // Annulée
    geannuleerdSubject: ref => "Uw bestelling " + ref + " is geannuleerd",
    geannuleerdTitle: "Uw bestelling is geannuleerd",
    geannuleerdBody: (ref, naam) => "Uw bestelling " + ref + " werd geannuleerd door " + naam + ".",
    reden: "Reden",
    opnieuw: "Wilt u opnieuw bestellen of hebt u vragen? Antwoord gerust op dit bericht.",
    // Accès
    welcomeSubject: n => "Uw toegang tot het bestelportaal van " + n,
    welcomeTitle: "Welkom in het bestelportaal",
    welcomeBody: n => "Uw toegang tot het bestelportaal van " + n + " is klaar. Met onderstaande gegevens meldt u zich aan en bestelt u rechtstreeks online.",
    welcomeText: n => "Welkom in het bestelportaal van " + n + ".",
    gebruikersnaam: "Gebruikersnaam", wachtwoord: "Wachtwoord", nieuwWachtwoord: "Nieuw wachtwoord",
    passwordAdvice: "Wijzig uw wachtwoord bij de eerste aanmelding via Account. Deel deze gegevens met niemand.",
    resetSubject: () => "Uw nieuw wachtwoord voor het bestelportaal",
    resetTitle: "Nieuw wachtwoord",
    resetBody: n => "Uw wachtwoord voor het bestelportaal van " + n + " werd opnieuw ingesteld. Meld u aan met onderstaande gegevens.",
    resetText: n => "Uw wachtwoord voor het bestelportaal van " + n + " werd opnieuw ingesteld.",
    notYou: " Hebt u dit niet aangevraagd? Antwoord dan op dit bericht.",
    aanmelden: "Aanmelden",
    // Relances de paiement (H-01)
    reminderSubject: (level, nr) => (level >= 2 ? "Tweede herinnering: factuur " + nr + " staat nog open" : "Herinnering: factuur " + nr + " is vervallen"),
    reminderTitle: level => (level >= 2 ? "Tweede betalingsherinnering" : "Betalingsherinnering"),
    reminderBody: (nr, datum, bedrag, verval) => "Volgens onze gegevens is factuur " + nr + " van " + datum + " (" + bedrag + " incl. btw) nog niet betaald. De vervaldatum was " + verval + ".",
    reminderSecond: "Dit is onze tweede herinnering. Gelieve het openstaande bedrag zo snel mogelijk te betalen.",
    reminderPay: ogm => "Gelieve het bedrag over te schrijven op onderstaande rekening" + (ogm ? ", met vermelding van de gestructureerde mededeling." : "."),
    reminderPaid: "Hebt u intussen al betaald? Dan mag u dit bericht als onbestaande beschouwen. Vragen? Antwoord gerust op dit bericht.",
    factuurdatum: "Factuurdatum", bestelling: "Bestelling", creditnota: "Creditnota", openstaand: "Openstaand bedrag",
    // Correctie (L-08) : bestelling aangepast na de bevestiging, of creditnota
    correctieSubject: ref => "Correctie van uw bestelling " + ref,
    correctieTitle: "Uw bestelling werd aangepast",
    correctieBody: ref => "We hebben uw bestelling " + ref + " aangepast. Hieronder ziet u wat er veranderde.",
    was: "Was", nu: "Nu", geschrapt: "geschrapt", nieuw: "nieuw",
    nieuwTotaalExcl: "Nieuw totaal excl. btw", nieuwTotaalIncl: "Nieuw totaal incl. btw",
    creditnotaNr: nr => "Creditnota " + nr, retour: "Retour (creditnota)",
    naCreditnotas: "Totaal na creditnota's (incl. btw)",
    creditViaBoekhouding: "De creditnota ontvangt u afzonderlijk van onze boekhouding (via Peppol)."
  },
  fr: {
    lang: "fr", eur: eurFr, date: dateFr, unit: frUnit, colon: " : ",
    artikel: "Article", aantal: "Quantité", subtotaal: "Sous-total",
    totaalExcl: "Total HTVA", totaalIncl: "Total TVAC",
    forWho: n => "Pour " + n,
    referentie: "Référence", besteldOp: "Commandé le", gewensteLevering: "Livraison souhaitée",
    closing: "Des questions ? N'hésitez pas à répondre à ce message.",
    mijnBestellingen: "Mes commandes", factuurBekijken: "Voir la facture", opnieuwBestellen: "Commander à nouveau",
    confirmSubject: ref => "Confirmation de votre commande " + ref,
    confirmTitle: "Merci pour votre commande",
    confirmThanks: "Merci pour votre commande.",
    notInvoice: "Ceci est un accusé de réception, pas une facture.",
    adjust: "Une modification ? N'hésitez pas à répondre à ce message.",
    viaMail: "Nous avons reçu votre commande par e-mail et l'avons enregistrée comme ci-dessous. Une erreur ? N'hésitez pas à répondre à ce message.",
    ontvangenSubject: () => "Nous avons bien reçu votre message",
    ontvangenTitle: "Message reçu",
    ontvangenBody: onderwerp => "Nous avons bien reçu votre message" + (onderwerp ? " « " + onderwerp + " »" : "") + ". Notre équipe le traite et vous confirmera votre commande dès que possible par un e-mail séparé.",
    onderwegSubject: ref => "Votre commande " + ref + " est en route",
    onderwegTitle: "Votre commande est en route",
    onderwegBody: (ref, wanneer) => "Votre commande " + ref + " est en route. " + wanneer,
    verwacht: d => "Livraison prévue : " + d + ".",
    vandaagVerwacht: "La livraison est prévue aujourd'hui.",
    levering: "Livraison", vandaag: "aujourd'hui", leveradres: "Adresse de livraison",
    geleverdSubject: (ref, factuur) => "Votre commande " + ref + " a été livrée" + (factuur ? " — facture " + factuur : ""),
    geleverdTitle: "Votre commande a été livrée",
    geleverdBody: ref => "Votre commande " + ref + " a été livrée.",
    factuurKlaar: nr => " Votre facture " + nr + " est disponible sur le portail.",
    viaBoekhouding: " La facture vous est envoyée séparément par notre comptabilité (via Peppol).",
    factuurnummer: "N° de facture", geleverdOp: "Livrée le", ontvangenDoor: "Réceptionnée par", vervaldatum: "Échéance",
    iban: "IBAN", bic: "BIC", mededeling: "Communication structurée", bedrag: "Montant",
    betaalTekst: (d, ogm) => "Merci de régler le montant pour le " + d + " sur le compte ci-dessous" + (ogm ? ", en indiquant la communication structurée." : "."),
    geannuleerdSubject: ref => "Votre commande " + ref + " a été annulée",
    geannuleerdTitle: "Votre commande a été annulée",
    geannuleerdBody: (ref, naam) => "Votre commande " + ref + " a été annulée par " + naam + ".",
    reden: "Motif",
    opnieuw: "Vous souhaitez commander à nouveau ou vous avez une question ? N'hésitez pas à répondre à ce message.",
    welcomeSubject: n => "Votre accès au portail de commande de " + n,
    welcomeTitle: "Bienvenue sur le portail de commande",
    welcomeBody: n => "Votre accès au portail de commande de " + n + " est prêt. Connectez-vous avec les données ci-dessous et commandez directement en ligne.",
    welcomeText: n => "Bienvenue sur le portail de commande de " + n + ".",
    gebruikersnaam: "Identifiant", wachtwoord: "Mot de passe", nieuwWachtwoord: "Nouveau mot de passe",
    passwordAdvice: "Changez votre mot de passe lors de votre première connexion, via Compte. Ne communiquez ces données à personne.",
    resetSubject: () => "Votre nouveau mot de passe pour le portail de commande",
    resetTitle: "Nouveau mot de passe",
    resetBody: n => "Votre mot de passe pour le portail de commande de " + n + " a été réinitialisé. Connectez-vous avec les données ci-dessous.",
    resetText: n => "Votre mot de passe pour le portail de commande de " + n + " a été réinitialisé.",
    notYou: " Vous n'êtes pas à l'origine de cette demande ? Répondez à ce message.",
    aanmelden: "Se connecter",
    reminderSubject: (level, nr) => (level >= 2 ? "Second rappel : facture " + nr + " toujours impayée" : "Rappel : facture " + nr + " échue"),
    reminderTitle: level => (level >= 2 ? "Second rappel de paiement" : "Rappel de paiement"),
    reminderBody: (nr, datum, bedrag, verval) => "Sauf erreur de notre part, la facture " + nr + " du " + datum + " (" + bedrag + " TVAC) n'a pas encore été payée. L'échéance était le " + verval + ".",
    reminderSecond: "Ceci est notre second rappel. Merci de régler le montant dû dans les meilleurs délais.",
    reminderPay: ogm => "Merci de virer le montant sur le compte ci-dessous" + (ogm ? ", en indiquant la communication structurée." : "."),
    reminderPaid: "Si vous avez payé entre-temps, veuillez ne pas tenir compte de ce message. Des questions ? N'hésitez pas à répondre à ce message.",
    factuurdatum: "Date de facture", bestelling: "Commande", creditnota: "Note de crédit", openstaand: "Montant dû",
    correctieSubject: ref => "Correction de votre commande " + ref,
    correctieTitle: "Votre commande a été modifiée",
    correctieBody: ref => "Nous avons modifié votre commande " + ref + ". Voici ce qui a changé.",
    was: "Avant", nu: "Maintenant", geschrapt: "supprimé", nieuw: "nouveau",
    nieuwTotaalExcl: "Nouveau total HTVA", nieuwTotaalIncl: "Nouveau total TVAC",
    creditnotaNr: nr => "Note de crédit " + nr, retour: "Retour (note de crédit)",
    naCreditnotas: "Total après notes de crédit (TVAC)",
    creditViaBoekhouding: "La note de crédit vous est envoyée séparément par notre comptabilité (via Peppol)."
  }
};

/** Textes dans la langue du client (Clients → Taal) : FR → français, tout le reste → néerlandais. */
function langOf(klant) {
  return String((klant || {}).taal || "").trim().toUpperCase() === "FR" ? T.fr : T.nl;
}

// --- Briques HTML : gabarit commun (lib/maillayout.js, spec 012) ---------------
// Tableaux seulement, CSS en ligne, fonds et couleurs explicites (mode sombre) : voir maillayout.
const { headerRow, factsRow, noteRow, buttonRow, footerRow, paragraphRow, credentialsRow, tableRow, TH, TD } = layout;

/** Document complet : marque, lignes, texte d'aperçu (liste des messages) dans la langue du mail. */
function shell(title, inner, brandName, lang, preheader) {
  return layout.shell({ title, rows: inner, brand: brandName, lang, preheader });
}

const tdNum = extra => 'align="right" style="' + TD + ";white-space:nowrap;" + (extra || "") + '"';

function linesRow(rows, total, t) {
  t = t || T.nl;
  const head = "<tr>" +
    '<th align="left" ' + TH + ">" + esc(t.artikel) + "</th>" +
    '<th align="right" ' + TH + ">" + esc(t.aantal) + "</th>" +
    '<th align="right" ' + TH + ">" + esc(t.subtotaal) + "</th></tr>";
  const body = rows.map(r => {
    const qty = Number(String(r.qty).replace(",", ".")) || 0;
    const sub = r.price == null ? null : r.price * qty;
    return "<tr>" +
      '<td style="' + TD + '">' +
        esc(r.name) + (r.comment ? '<div style="margin-top:2px;font-size:13px;line-height:18px;color:' + layout.C.muted + ";" + layout.FONT + ';">' + esc(r.comment) + "</div>" : "") + "</td>" +
      "<td " + tdNum() + ">" + esc(r.qty) + " " + esc(t.unit(r.unit)) + "</td>" +
      "<td " + tdNum() + ">" + (sub == null ? "—" : esc(t.eur(sub))) + "</td></tr>";
  }).join("");
  const TOT = "padding:12px 10px 2px 10px;border-top:2px solid " + layout.C.ink + ";background-color:" + layout.C.card + ";font-weight:bold;color:" + layout.C.ink + ";" + layout.FONT;
  const foot = '<tr><td colspan="2" align="right" style="' + TOT + ';font-size:15px;line-height:20px;">' + esc(t.totaalExcl) + "</td>" +
    '<td align="right" style="' + TOT + ';font-size:16px;line-height:20px;white-space:nowrap;">' + esc(t.eur(total)) + "</td></tr>";
  return tableRow(head + body + foot);
}

/** Coordonnées publiques de la société pour le pied des mails client. */
function contactBlock(company) {
  const c = company || {};
  return [c.bedrijfsnaam, c.telefoon, c.email].filter(Boolean).join("\n");
}

function textFacts(pairs, t) {
  const colon = (t || T.nl).colon;
  return pairs.filter(p => p && p[1]).map(p => p[0] + colon + p[1]).join("\n");
}

function textLines(rows, t) {
  t = t || T.nl;
  return rows.map(r => {
    const qty = Number(String(r.qty).replace(",", ".")) || 0;
    const sub = r.price == null ? null : r.price * qty;
    return "- " + r.name + " × " + r.qty + " " + t.unit(r.unit) +
      (sub == null ? "" : "  " + t.eur(sub)) + (r.comment ? " (" + r.comment + ")" : "");
  }).join("\n");
}

// --- Messages ----------------------------------------------------------------

// Équipe : toujours en néerlandais (boîte interne).
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
    (ctx.company || {}).bedrijfsnaam, "nl",
    (klant.nom || "onbekende klant") + " · " + eur(ctx.total) + " excl. btw · Gewenste levering: " + dateNl(ctx.dateLivraison)
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
    idempotencyKey: "order:" + (ctx.recordId || ctx.ref) + ":team"
  };
}

function buildCustomerMail(ctx) {
  const rows = parseLines(ctx.lignes);
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const t = langOf(klant);
  const subject = t.confirmSubject(ctx.ref);
  const contact = [company.bedrijfsnaam, company.telefoon, company.email].filter(Boolean).join("\n");
  const html = shell(subject,
    headerRow(t.confirmTitle, klant.nom ? t.forWho(klant.nom) : "") +
    (ctx.viaMail ? paragraphRow(t.viaMail) : "") +
    factsRow([
      [t.referentie, ctx.ref],
      [t.besteldOp, t.date(ctx.date)],
      [t.gewensteLevering, t.date(ctx.dateLivraison)]
    ]) +
    linesRow(rows, ctx.total, t) +
    paragraphRow(t.notInvoice + " " + t.adjust, true) +
    footerRow(contact || "FAMO Seafood"),
    company.bedrijfsnaam, t.lang,
    t.referentie + t.colon + ctx.ref + " · " + t.gewensteLevering + t.colon + t.date(ctx.dateLivraison) + " · " + t.totaalExcl + t.colon + t.eur(ctx.total)
  );
  const text = t.confirmThanks + "\n\n" + (ctx.viaMail ? t.viaMail + "\n\n" : "") +
    t.referentie + t.colon + ctx.ref + "\n" +
    t.gewensteLevering + t.colon + t.date(ctx.dateLivraison) + "\n\n" +
    textLines(rows, t) + "\n\n" + t.totaalExcl + t.colon + t.eur(ctx.total) + "\n\n" +
    t.notInvoice + "\n" +
    (contact ? "\n" + contact + "\n" : "");
  return {
    to: klant.email,
    subject,
    html,
    text,
    // Jamais la boîte ops : elle est privée et ne doit pas fuir vers le client.
    replyTo: company.email || ctx.opsEmail,
    idempotencyKey: "order:" + (ctx.recordId || ctx.ref) + ":client"
  };
}

// --- Bestelling per e-mail : ontvangstbevestiging (specs/020) -------------------
// Enkel aan een gekende klant, wanneer het team de mail eerst bekijkt (« Te controleren ») : geen
// gissing over de inhoud, enkel « ontvangen ». Antwoorden gaan naar het adres van het bedrijf.
function buildMailReceivedMail(ctx) {
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const t = langOf(klant);
  const subject = t.ontvangenSubject();
  const onderwerp = String(ctx.onderwerp || "").slice(0, 120);
  const contact = [company.bedrijfsnaam, company.telefoon, company.email].filter(Boolean).join("\n");
  const html = shell(subject,
    headerRow(t.ontvangenTitle, klant.nom ? t.forWho(klant.nom) : "") +
    paragraphRow(t.ontvangenBody(onderwerp)) +
    footerRow(contact || "FAMO Seafood"),
    company.bedrijfsnaam, t.lang, t.ontvangenBody(onderwerp)
  );
  const text = t.ontvangenBody(onderwerp) + "\n" + (contact ? "\n" + contact + "\n" : "");
  return {
    to: ctx.to || klant.email,
    subject,
    html,
    text,
    replyTo: company.email || "",
    tag: "mailin",
    idempotencyKey: "mailin:" + (ctx.emailId || "") + ":ack"
  };
}
const notifyMailReceived = ctx => notifyOne("notifyMailReceived", buildMailReceivedMail, ctx);

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
    (ctx.company || {}).bedrijfsnaam, "nl",
    (klant.nom || "onbekende klant") + " · door " + door + " · Reden: " + (reden || "geen reden opgegeven")
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
  const t = langOf(klant);
  const status = String(ctx.status || "").toLowerCase();
  const rows = parseLines(ctx.lignes);
  const contact = contactBlock(company);
  const portal = String(ctx.portalUrl || "").replace(/\/+$/, "");
  const ordersUrl = portal ? portal + "/klant#/bestellingen" : "";
  const closing = t.closing;
  const forWho = klant.nom ? t.forWho(klant.nom) : "";
  let subject, inner, text, preheader;

  if (status === "onderweg") {
    subject = t.onderwegSubject(ctx.ref);
    const wanneer = ctx.dateLivraison ? t.verwacht(t.date(ctx.dateLivraison)) : t.vandaagVerwacht;
    const facts = [[t.referentie, ctx.ref], [t.levering, t.date(ctx.dateLivraison) !== "—" ? t.date(ctx.dateLivraison) : t.vandaag], [t.leveradres, klant.adresse]];
    inner = headerRow(t.onderwegTitle, forWho) +
      paragraphRow(t.onderwegBody(ctx.ref, wanneer)) +
      factsRow(facts) +
      (rows.length ? linesRow(rows, ctx.total, t) : "") +
      buttonRow(t.mijnBestellingen, ordersUrl) +
      paragraphRow(closing, true) +
      footerRow(contact || "FAMO Seafood");
    preheader = t.onderwegBody(ctx.ref, wanneer);
    text = t.onderwegBody(ctx.ref, wanneer) + "\n\n" +
      textFacts(facts, t) + "\n" +
      (rows.length ? "\n" + textLines(rows, t) + "\n" : "") +
      "\n" + closing + "\n" + (ordersUrl ? "\n" + ordersUrl + "\n" : "") + (contact ? "\n" + contact + "\n" : "");
  } else if (status === "geleverd") {
    // Mode « boekhouder » (défaut, lib/billing.js) : la facture et les coordonnées de paiement viennent
    // du comptable (Peppol) : cet e-mail ne cite ni numéro de facture ni montant « à payer ».
    // Mode « portaal » : le montant à payer est le total TVA COMPRISE (avant : le hors TVA, audit B-04).
    const portaal = ctx.facturatie === "portaal";
    const factuur = portaal ? String(ctx.factuurnummer || "").trim() : "";
    const incl = ctx.totalIncl != null ? Number(ctx.totalIncl) : null;
    subject = t.geleverdSubject(ctx.ref, factuur);
    const facts = [
      [t.referentie, ctx.ref],
      [t.factuurnummer, factuur],
      [t.geleverdOp, t.date(ctx.dateLivraison || ctx.date)],
      [t.ontvangenDoor, ctx.ontvangenDoor],
      [t.totaalExcl, t.eur(ctx.totalExcl != null ? ctx.totalExcl : ctx.total)],
      [t.totaalIncl, incl != null ? t.eur(incl) : ""],
      [t.vervaldatum, portaal ? t.date(ctx.vervaldatum) : ""]
    ];
    const betaling = portaal && incl != null ? [
      [t.iban, company.iban],
      [t.bic, company.bic],
      [t.mededeling, ctx.mededeling],
      [t.bedrag, t.eur(incl)]
    ] : [];
    const betaalTekst = t.betaalTekst(t.date(ctx.vervaldatum), !!ctx.mededeling);
    const betaalt = portaal && company.iban && betaling.length;
    const factuurTekst = portaal ? (factuur ? t.factuurKlaar(factuur) : "") : t.viaBoekhouding;
    const knop = portaal ? t.factuurBekijken : t.mijnBestellingen;
    inner = headerRow(t.geleverdTitle, forWho) +
      paragraphRow(t.geleverdBody(ctx.ref) + factuurTekst) +
      factsRow(facts) +
      (rows.length ? linesRow(rows, ctx.totalExcl != null ? ctx.totalExcl : ctx.total, t) : "") +
      paragraphRow(betaalt ? betaalTekst : "") +
      (betaalt ? credentialsRow(betaling) : "") +
      buttonRow(knop, ordersUrl) +
      paragraphRow(closing, true) +
      footerRow(contact || "FAMO Seafood");
    preheader = t.geleverdBody(ctx.ref) + factuurTekst;
    text = t.geleverdBody(ctx.ref) + factuurTekst + "\n\n" +
      textFacts(facts, t) + "\n" +
      (rows.length ? "\n" + textLines(rows, t) + "\n" : "") +
      (betaalt ? "\n" + betaalTekst + "\n" + textFacts(betaling, t) + "\n" : "") +
      (ordersUrl ? "\n" + knop + t.colon + ordersUrl + "\n" : "") +
      "\n" + closing + "\n" + (contact ? "\n" + contact + "\n" : "");
  } else if (status === "geannuleerd") {
    subject = t.geannuleerdSubject(ctx.ref);
    const reden = String(ctx.reden || ctx.motif || "").trim();
    const naam = company.bedrijfsnaam || "FAMO Seafood";
    const facts = [[t.referentie, ctx.ref], [t.gewensteLevering, t.date(ctx.dateLivraison)], [t.reden, reden]];
    inner = headerRow(t.geannuleerdTitle, forWho) +
      paragraphRow(t.geannuleerdBody(ctx.ref, naam)) +
      factsRow(facts) +
      (rows.length ? linesRow(rows, ctx.total, t) : "") +
      paragraphRow(t.opnieuw) +
      buttonRow(t.opnieuwBestellen, portal ? portal + "/klant" : "") +
      footerRow(contact || "FAMO Seafood");
    preheader = t.geannuleerdBody(ctx.ref, naam) + (reden ? " " + t.reden + t.colon + reden : "");
    text = t.geannuleerdBody(ctx.ref, naam) + "\n\n" +
      textFacts(facts, t) + "\n" +
      (rows.length ? "\n" + textLines(rows, t) + "\n" : "") +
      "\n" + t.opnieuw + "\n" +
      (contact ? "\n" + contact + "\n" : "");
  } else {
    throw new Error("onbekende status: " + ctx.status);
  }

  return {
    to: klant.email,
    subject,
    html: shell(subject, inner, company.bedrijfsnaam, t.lang, preheader),
    text,
    replyTo: company.email || ctx.opsEmail,
    idempotencyKey: "status:" + ctx.ref + ":" + status
  };
}

// --- Relance de paiement (client, mode Portaal : lib/reminders.js) ------------
// ctx : { klant, company:{bedrijfsnaam,telefoon,email,iban,bic}, opsEmail, portalUrl, level (1|2),
//         ref, factuurnummer, factuurdatum, vervaldatum (YYYY-MM-DD), totalIncl (facture TVAC),
//         creditnota?:{nummer, montantIncl}, openstaand (montant dû TVAC), mededeling }
function buildReminderMail(ctx) {
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const t = langOf(klant);
  const level = Number(ctx.level) >= 2 ? 2 : 1;
  const nr = String(ctx.factuurnummer || "").trim();
  if (!nr) throw new Error("herinnering zonder factuurnummer");
  const incl = Number(ctx.totalIncl) || 0;
  const due = ctx.openstaand != null ? Number(ctx.openstaand) : incl;
  const cn = ctx.creditnota && ctx.creditnota.nummer ? ctx.creditnota : null;
  const contact = contactBlock(company);
  const portal = String(ctx.portalUrl || "").replace(/\/+$/, "");
  const ordersUrl = portal ? portal + "/klant#/bestellingen" : "";
  const subject = t.reminderSubject(level, nr);
  const intro = t.reminderBody(nr, t.date(ctx.factuurdatum), t.eur(incl), t.date(ctx.vervaldatum)) + (level >= 2 ? " " + t.reminderSecond : "");
  const facts = [
    [t.factuurnummer, nr],
    [t.factuurdatum, t.date(ctx.factuurdatum)],
    [t.vervaldatum, t.date(ctx.vervaldatum)],
    [t.bestelling, ctx.ref],
    [t.totaalIncl, t.eur(incl)],
    [t.creditnota, cn ? cn.nummer + " (" + t.eur(-Math.abs(Number(cn.montantIncl) || 0)) + ")" : ""],
    [t.openstaand, cn ? t.eur(due) : ""]
  ];
  const betaling = [
    [t.iban, company.iban],
    [t.bic, company.bic],
    [t.mededeling, ctx.mededeling],
    [t.bedrag, t.eur(due)]
  ];
  const pay = t.reminderPay(!!ctx.mededeling);
  const inner = headerRow(t.reminderTitle(level), klant.nom ? t.forWho(klant.nom) : "") +
    paragraphRow(intro) +
    factsRow(facts) +
    paragraphRow(pay) +
    credentialsRow(betaling) +
    buttonRow(t.factuurBekijken, ordersUrl) +
    paragraphRow(t.reminderPaid, true) +
    footerRow(contact || "FAMO Seafood");
  const text = t.reminderTitle(level) + "\n\n" + intro + "\n\n" +
    textFacts(facts, t) + "\n\n" +
    pay + "\n" + textFacts(betaling, t) + "\n" +
    (ordersUrl ? "\n" + t.factuurBekijken + t.colon + ordersUrl + "\n" : "") +
    "\n" + t.reminderPaid + "\n" + (contact ? "\n" + contact + "\n" : "");
  return {
    to: klant.email,
    subject,
    tag: "herinnering",
    html: shell(subject, inner, company.bedrijfsnaam, t.lang, intro),
    text,
    replyTo: company.email || ctx.opsEmail,
    // Un niveau par facture : un deuxième passage du cron ne renvoie rien (Resend dédoublonne 24 h ;
    // au-delà, c'est le champ « Herinnering N op » qui fait foi).
    idempotencyKey: "reminder:" + nr + ":" + level
  };
}

// --- Correctie (client + copie interne, L-08) ----------------------------------
// ctx : { ref, recordId, klant, company, opsEmail, portalUrl, orderUrl (fiche du personnel,
//         copie interne seulement), facturatie ("portaal"|"boekhouder"),
//         wijzigingen: [{ name, unit, voor:{qty,price}|null, na:{qty,price}|null }] (lib/correctie.js),
//         totalExcl, totalIncl (nouveaux totaux de la commande),
//         creditnotas: [{ nummer, montantIncl, motif }] (émises depuis le dernier e-mail),
//         netIncl (total TVAC après TOUTES les notes, si notes), sleutel (état envoyé) }
function qtyTxt(n) { return String(Math.round((Number(n) || 0) * 1000) / 1000).replace(".", ","); }
function sideTxt(side, other, t) {
  if (!side) return "";
  const priceChanged = side.price != null && (!other || other.price == null || Math.round(side.price * 100) !== Math.round(other.price * 100));
  return qtyTxt(side.qty) + (side.unit ? " " + t.unit(side.unit) : "") + (priceChanged ? " · " + t.eur(side.price) : "");
}
function correctieRows(ctx, t) {
  return (ctx.wijzigingen || []).map(w => {
    const v = w.voor ? Object.assign({ unit: w.unit }, w.voor) : null, n = w.na ? Object.assign({ unit: w.unit }, w.na) : null;
    return { name: w.name, voor: v ? sideTxt(v, n, t) : t.nieuw, na: n ? sideTxt(n, v, t) : t.geschrapt };
  });
}
function correctieTable(rows, t) {
  if (!rows.length) return "";
  const td = 'style="' + TD + '"', tdR = 'align="right" style="' + TD + ';white-space:nowrap;"';
  return tableRow(
    '<tr><th align="left" ' + TH + ">" + esc(t.artikel) + '</th><th align="right" ' + TH + ">" + esc(t.was) + '</th><th align="right" ' + TH + ">" + esc(t.nu) + "</th></tr>" +
    rows.map(r => "<tr><td " + td + ">" + esc(r.name) + "</td><td " + tdR + ">" + esc(r.voor) + "</td><td " + tdR + "><b>" + esc(r.na) + "</b></td></tr>").join(""));
}
function correctieFacts(ctx, t, withNumbers) {
  const cns = ctx.creditnotas || [];
  return [
    [t.referentie, ctx.ref],
    [t.nieuwTotaalExcl, ctx.totalExcl != null ? t.eur(ctx.totalExcl) : ""],
    [t.nieuwTotaalIncl, ctx.totalIncl != null ? t.eur(ctx.totalIncl) : ""]
  ].concat(cns.map(n => [withNumbers ? t.creditnotaNr(n.nummer) : t.retour, t.eur(-Math.abs(Number(n.montantIncl) || 0)) + (n.motif ? " — " + n.motif : "")]))
    .concat(cns.length && ctx.netIncl != null ? [[t.naCreditnotas, t.eur(ctx.netIncl)]] : []);
}

function buildCorrectionMail(ctx) {
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const t = langOf(klant);
  const portaal = ctx.facturatie === "portaal";
  const contact = contactBlock(company);
  const portal = String(ctx.portalUrl || "").replace(/\/+$/, "");
  const ordersUrl = portal ? portal + "/klant#/bestellingen" : "";
  const subject = t.correctieSubject(ctx.ref);
  const rows = correctieRows(ctx, t);
  const facts = correctieFacts(ctx, t, portaal);
  const viaBoekhouding = !portaal && (ctx.creditnotas || []).length ? t.creditViaBoekhouding : "";
  const inner = headerRow(t.correctieTitle, klant.nom ? t.forWho(klant.nom) : "") +
    paragraphRow(t.correctieBody(ctx.ref)) +
    correctieTable(rows, t) +
    factsRow(facts) +
    paragraphRow(viaBoekhouding) +
    buttonRow(t.mijnBestellingen, ordersUrl) +
    paragraphRow(t.closing, true) +
    footerRow(contact || "FAMO Seafood");
  const preheader = t.correctieBody(ctx.ref) + (ctx.totalIncl != null ? " " + t.nieuwTotaalIncl + t.colon + t.eur(ctx.totalIncl) : "");
  const text = t.correctieBody(ctx.ref) + "\n\n" +
    (rows.length ? rows.map(r => r.name + t.colon + r.voor + " → " + r.na).join("\n") + "\n\n" : "") +
    textFacts(facts, t) + "\n" +
    (viaBoekhouding ? "\n" + viaBoekhouding + "\n" : "") +
    (ordersUrl ? "\n" + t.mijnBestellingen + t.colon + ordersUrl + "\n" : "") +
    "\n" + t.closing + "\n" + (contact ? "\n" + contact + "\n" : "");
  return {
    to: klant.email,
    subject,
    tag: "correctie",
    html: shell(subject, inner, company.bedrijfsnaam, t.lang, preheader),
    text,
    replyTo: company.email || ctx.opsEmail,
    // Même état envoyé = même clé : Resend ne renvoie pas un double clic (24 h), « Correctiemail » au-delà.
    idempotencyKey: "correctie:" + (ctx.recordId || ctx.ref) + ":" + (ctx.sleutel || "")
  };
}

// Copie interne (boîte « Bestellingen e-mail ») : toujours en néerlandais, lien vers la fiche.
function buildCorrectionTeamMail(ctx) {
  const klant = ctx.klant || {};
  const t = T.nl;
  const subject = "Correctiemail verstuurd — " + ctx.ref + " — " + (klant.nom || "onbekende klant");
  const rows = correctieRows(ctx, t);
  const facts = [["Klant", klant.nom], ["E-mail", klant.email], ["Taal", klant.taal]].concat(correctieFacts(ctx, t, true));
  const html = shell(subject,
    headerRow("Correctiemail verstuurd", ctx.ref) +
    correctieTable(rows, t) +
    factsRow(facts) +
    buttonRow("Bestelling openen", ctx.orderUrl) +
    footerRow("Automatisch bericht van het Famo-bestelportaal."),
    (ctx.company || {}).bedrijfsnaam, "nl",
    (klant.nom || "onbekende klant") + " · " + (rows.length ? rows.map(r => r.name).join(", ") : (ctx.creditnotas || []).map(n => n.nummer).join(", "))
  );
  const text = subject + "\n\n" +
    (rows.length ? rows.map(r => r.name + ": " + r.voor + " → " + r.na).join("\n") + "\n\n" : "") +
    textFacts(facts) + "\n" + (ctx.orderUrl ? "\n" + ctx.orderUrl + "\n" : "");
  return {
    to: ctx.opsEmail,
    subject,
    tag: "correctie",
    html,
    text,
    replyTo: klant.email,
    idempotencyKey: "correctie:" + (ctx.recordId || ctx.ref) + ":" + (ctx.sleutel || "") + ":team"
  };
}

// Client d'abord ; la copie interne seulement si le client l'a reçu. Ne jette jamais.
async function notifyCorrection(ctx) {
  try {
    if (!mail.enabled()) return { ok: false, skipped: "disabled" };
    const customer = await mail.send(buildCorrectionMail(ctx || {}));
    const team = customer.ok && ctx.opsEmail ? await mail.send(buildCorrectionTeamMail(ctx)) : null;
    return Object.assign({}, customer, { team });
  } catch (e) {
    console.warn("[mail] notifyCorrection — " + String(e && e.message || e).slice(0, 200));
    return { ok: false, error: "build" };
  }
}

// --- Accès (client) ----------------------------------------------------------

function buildWelcomeMail(ctx) {
  const klant = ctx.klant || {};
  const company = ctx.company || {};
  const t = langOf(klant);
  const cred = ctx.credentials || {};
  const naam = company.bedrijfsnaam || "FAMO Seafood";
  const contact = contactBlock(company);
  const portal = String(ctx.portalUrl || "").replace(/\/+$/, "");
  const loginUrl = portal ? portal + "/" : "";
  const subject = t.welcomeSubject(naam);
  const pairs = [[t.gebruikersnaam, cred.user], [t.wachtwoord, cred.password]];
  const html = shell(subject,
    headerRow(t.welcomeTitle, klant.nom ? t.forWho(klant.nom) : "") +
    paragraphRow(t.welcomeBody(naam)) +
    credentialsRow(pairs) +
    buttonRow(t.aanmelden, loginUrl) +
    paragraphRow(t.passwordAdvice, true) +
    footerRow(contact || naam),
    company.bedrijfsnaam, t.lang, t.welcomeBody(naam)
  );
  const text = t.welcomeText(naam) + "\n\n" +
    textFacts(pairs, t) + "\n\n" +
    (loginUrl ? t.aanmelden + t.colon + loginUrl + "\n\n" : "") +
    t.passwordAdvice + "\n" + (contact ? "\n" + contact + "\n" : "");
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
  const t = langOf(klant);
  const naam = company.bedrijfsnaam || "FAMO Seafood";
  const contact = contactBlock(company);
  const portal = String(ctx.portalUrl || "").replace(/\/+$/, "");
  const loginUrl = portal ? portal + "/" : "";
  const user = (ctx.credentials && ctx.credentials.user) || ctx.user || klant.user || "";
  const password = ctx.password || (ctx.credentials && ctx.credentials.password) || "";
  const subject = t.resetSubject();
  const pairs = [[t.gebruikersnaam, user], [t.nieuwWachtwoord, password]];
  const html = shell(subject,
    headerRow(t.resetTitle, klant.nom ? t.forWho(klant.nom) : "") +
    paragraphRow(t.resetBody(naam)) +
    credentialsRow(pairs) +
    buttonRow(t.aanmelden, loginUrl) +
    paragraphRow(t.passwordAdvice + t.notYou, true) +
    footerRow(contact || naam),
    company.bedrijfsnaam, t.lang, t.resetBody(naam)
  );
  const text = t.resetText(naam) + "\n\n" +
    textFacts(pairs, t) + "\n\n" +
    (loginUrl ? t.aanmelden + t.colon + loginUrl + "\n\n" : "") +
    t.passwordAdvice + t.notYou + "\n" +
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
  const url = portal ? portal + "/beheer#/aanvragen" : "";
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
    (ctx.company || {}).bedrijfsnaam, "nl",
    ["Nieuwe aanvraag van " + bedrijf, a.contact, a.adresse || a.adres].filter(Boolean).join(" · ")
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
const notifyReminder = ctx => notifyOne("notifyReminder", buildReminderMail, ctx);

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
    email: String(f["Email"] || "").trim(),
    // Langue des e-mails client (C-15) : FR ou NL (défaut), comme les documents.
    taal: String(f["Taal"] || "").trim().toUpperCase() === "FR" ? "FR" : "NL"
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
// En production (Vercel), JAMAIS l'en-tête Host : il vient du client, et un lien de mot de
// passe envoyé par e-mail pointerait alors vers le domaine de l'attaquant. PORTAL_URL, ou
// le domaine officiel par défaut. Host ne sert qu'en local (serveur de dev, tests).
const DEFAULT_PORTAL_URL = "https://www.famoseafood.be";
function portalUrl(req) {
  const fixed = String(process.env.PORTAL_URL || "").trim();
  if (fixed) return fixed.replace(/\/+$/, "");
  if (process.env.VERCEL) return DEFAULT_PORTAL_URL;
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
  buildMailReceivedMail,
  notifyMailReceived,
  buildCancelTeamMail,
  buildStatusMail,
  buildReminderMail,
  buildWelcomeMail,
  buildSignupTeamMail,
  buildResetMail,
  buildCorrectionMail,
  buildCorrectionTeamMail,
  notifyCorrection,
  notifyCancel,
  notifyStatus,
  notifyReminder,
  notifyWelcome,
  notifySignup,
  notifyReset,
  langOf,
  dateNl,
  dateFr,
  vervaldatum,
  parseLines,
  eur,
  eurFr,
  nlLines,
  nlUnit,
  enabled: mail.enabled
};
