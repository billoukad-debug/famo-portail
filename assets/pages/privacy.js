// Privacyverklaring / Déclaration de confidentialité (RGPD, audit C-11).
// Le texte décrit ce que le portail fait réellement (code de ce dépôt) ; les coordonnées de la
// société viennent de Configuratie (/api/config?public=1). À relire par le conseiller juridique.
document.addEventListener("DOMContentLoaded", function () {
  const fr = K.lang === "fr";
  const T = fr ? {
    title: "Déclaration de confidentialité", upd: "Dernière mise à jour : 27/09/2026",
    who: "Responsable du traitement", whoTxt: "Les données du portail de commande sont traitées par",
    what: "Quelles données ?", whatList: ["Identité et coordonnées de votre établissement : nom, adresse de livraison et de facturation, numéro de TVA, téléphone, e-mail.", "Votre compte : nom d'utilisateur et mot de passe (stocké uniquement sous forme d'empreinte scrypt, jamais lisible).", "Vos commandes : articles, quantités, prix, dates de livraison, nom de la personne qui réceptionne, remarques.", "Demande d'ouverture de compte : établissement, personne de contact, e-mail, téléphone, adresse."],
    why: "Pourquoi et sur quelle base ?", whyList: ["Traiter et livrer vos commandes, vous envoyer confirmations et bons de livraison : exécution du contrat (RGPD art. 6.1.b).", "Facturation et comptabilité, conservation des pièces : obligation légale (RGPD art. 6.1.c).", "Sécurité du portail (limitation des tentatives de connexion, journal des modifications) : intérêt légitime (RGPD art. 6.1.f)."],
    rec: "Qui reçoit vos données ?", recList: ["Notre comptable, pour la facturation légale (Billtobox / Peppol).", "Nos sous-traitants techniques, liés par un contrat de traitement : Vercel (hébergement ; fonctions à Francfort, UE), Neon (base de données ; Francfort, UE), Resend (envoi des e-mails), one.com (nom de domaine)."],
    keep: "Combien de temps ?", keepList: ["Factures et pièces justificatives : 10 ans (Code TVA, art. 60) ; livres comptables : 7 ans (Code de droit économique, art. III.86).", "Compte client : tant que la relation commerciale dure ; ensuite archivé, puis anonymisé sur demande, en gardant ce que la loi impose de conserver."],
    rights: "Vos droits", rightsTxt: "Vous pouvez demander l'accès à vos données, leur rectification, leur effacement (dans les limites des obligations légales de conservation), la limitation du traitement, leur portabilité, ou vous y opposer. Écrivez-nous à l'adresse ci-dessous. Vous pouvez aussi introduire une plainte auprès de l'Autorité de protection des données (www.autoriteprotectiondonnees.be).",
    cookies: "Cookies", cookiesTxt: "Le portail n'utilise aucun cookie publicitaire ni de mesure d'audience. Il utilise uniquement ce qui est strictement nécessaire : un cookie de session pour le personnel et un pour les clients (illisible par les scripts de la page, effacé à la déconnexion), et, dans votre navigateur, votre identifiant, le nom de votre établissement et votre panier (sessionStorage / localStorage). La police de caractères est hébergée sur notre propre serveur : aucune donnée n'est envoyée à Google.",
    contact: "Contact", back: "← Retour"
  } : {
    title: "Privacyverklaring", upd: "Laatst bijgewerkt: 27/09/2026",
    who: "Verwerkingsverantwoordelijke", whoTxt: "De gegevens van het bestelportaal worden verwerkt door",
    what: "Welke gegevens?", whatList: ["Identiteit en contactgegevens van uw zaak: naam, lever- en facturatieadres, btw-nummer, telefoon, e-mail.", "Uw account: gebruikersnaam en wachtwoord (enkel als scrypt-vingerafdruk bewaard, nooit leesbaar).", "Uw bestellingen: artikelen, hoeveelheden, prijzen, leverdata, naam van wie de levering ontvangt, opmerkingen.", "Aanvraag voor een account: zaak, contactpersoon, e-mail, telefoon, adres."],
    why: "Waarom en op welke grond?", whyList: ["Uw bestellingen verwerken en leveren, bevestigingen en leveringsbonnen sturen: uitvoering van de overeenkomst (AVG art. 6.1.b).", "Facturatie en boekhouding, bewaring van stukken: wettelijke verplichting (AVG art. 6.1.c).", "Beveiliging van het portaal (beperking van aanmeldpogingen, logboek van wijzigingen): gerechtvaardigd belang (AVG art. 6.1.f)."],
    rec: "Wie ontvangt uw gegevens?", recList: ["Onze boekhouder, voor de wettelijke facturatie (Billtobox / Peppol).", "Onze technische verwerkers, gebonden door een verwerkersovereenkomst: Vercel (hosting; functies in Frankfurt, EU), Neon (database; Frankfurt, EU), Resend (versturen van e-mails), one.com (domeinnaam)."],
    keep: "Hoe lang?", keepList: ["Facturen en bewijsstukken: 10 jaar (Btw-wetboek, art. 60); boekhouding: 7 jaar (Wetboek van economisch recht, art. III.86).", "Klantaccount: zolang de handelsrelatie loopt; daarna gearchiveerd en op verzoek geanonimiseerd, met behoud van wat de wet laat bewaren."],
    rights: "Uw rechten", rightsTxt: "U kunt inzage, verbetering, wissing (binnen de wettelijke bewaarplichten), beperking van de verwerking, overdraagbaarheid of bezwaar vragen. Schrijf ons op het adres hieronder. U kunt ook klacht indienen bij de Gegevensbeschermingsautoriteit (www.gegevensbeschermingsautoriteit.be).",
    cookies: "Cookies", cookiesTxt: "Het portaal gebruikt geen reclame- of meetcookies. Enkel wat strikt nodig is: een sessiecookie voor het personeel en een voor klanten (onleesbaar voor scripts op de pagina, gewist bij het afmelden) en, in uw browser, uw gebruikersnaam, de naam van uw zaak en uw winkelmand (sessionStorage / localStorage). Het lettertype staat op onze eigen server: er gaan geen gegevens naar Google.",
    contact: "Contact", back: "← Terug"
  };
  document.documentElement.lang = fr ? "fr" : "nl";
  document.title = "FAMO Seafood · " + T.title;
  const list = a => "<ul>" + a.map(x => "<li>" + K.esc(x) + "</li>").join("") + "</ul>";
  const sec = (h, body) => '<section class="card card-b mt-14"><h2 class="h2">' + K.esc(h) + "</h2>" + body + "</section>";
  const app = document.getElementById("app");
  app.innerHTML = '<div class="spread-c"><a class="tlink" href="/">' + K.esc(T.back) + "</a>" + K.langSwitch() + "</div>" +
    '<h1 class="h1 mt-18">' + K.esc(T.title) + '</h1><p class="sub">' + K.esc(T.upd) + "</p>" +
    sec(T.who, '<p>' + K.esc(T.whoTxt) + ' <b id="legalName">Famo Trading BV</b>.</p><p class="muted" id="legalMeta"></p>') +
    sec(T.what, list(T.whatList)) + sec(T.why, list(T.whyList)) + sec(T.rec, list(T.recList)) + sec(T.keep, list(T.keepList)) +
    sec(T.rights, "<p>" + K.esc(T.rightsTxt) + "</p>") + sec(T.cookies, "<p>" + K.esc(T.cookiesTxt) + "</p>") +
    sec(T.contact, '<p id="contact" class="muted">…</p>');
  K.api("/api/config?public=1").then(d => {
    const c = d.config || {}, l = c.legal || {};
    const naam = l.naam ? l.naam + (l.rechtsvorm && !l.naam.toLowerCase().split(/\s+/).includes(l.rechtsvorm.toLowerCase()) ? " " + l.rechtsvorm : "") : (c.bedrijfsnaam || "Famo Trading BV");
    document.getElementById("legalName").textContent = naam;
    document.getElementById("legalMeta").textContent = [c.adres, c.plaats, l.ondernemingsnummer ? (fr ? "N° d'entreprise " : "Ondernemingsnummer ") + l.ondernemingsnummer : (c.btw ? "BTW " + c.btw : ""), l.rpr, l.handelsnaam && l.handelsnaam !== l.naam ? (fr ? "nom commercial " : "handelsnaam ") + l.handelsnaam : ""].filter(Boolean).join(" · ");
    document.getElementById("contact").innerHTML = [c.email ? '<a class="tlink" href="mailto:' + K.esc(c.email) + '">' + K.esc(c.email) + "</a>" : "", c.telefoon ? K.esc(c.telefoon) : ""].filter(Boolean).join(" · ") || "—";
  }).catch(() => {});
});
