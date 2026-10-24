// Colofon / Mentions légales (spec 032) : qui édite le site, comment nous joindre, qui l'héberge.
// Les données de la société viennent de Beheer → Bedrijf (Configuratie), servies par /api/config?public=1 ;
// un champ vide n'est pas affiché (jamais de valeur inventée). À relire par le conseiller juridique.
document.addEventListener("DOMContentLoaded", function () {
  const fr = K.lang === "fr";
  const T = fr ? {
    title: "Mentions légales", editor: "Éditeur du site", contact: "Contact", host: "Hébergement et services techniques",
    hostList: ["Vercel Inc., San Francisco (États-Unis) : hébergement du site ; fonctions exécutées à Francfort (UE).", "Neon : base de données, Francfort (UE).", "one.com : nom de domaine et boîte e-mail.", "Resend : envoi et réception des e-mails du portail."],
    ip: "Propriété intellectuelle", ipTxt: "Les textes, photos et le logo de ce site appartiennent à l'éditeur. Toute reproduction demande son accord écrit.",
    more: "Voir aussi", form: "Dénomination", seat: "Siège", ent: "N° d'entreprise", vat: "TVA", rpr: "RPR", favv: "N° AFSCA", trade: "Nom commercial",
    mail: "E-mail", tel: "Téléphone", wa: "WhatsApp", back: "← Retour", none: "Données en cours de publication."
  } : {
    title: "Colofon", editor: "Uitgever van de website", contact: "Contact", host: "Hosting en technische diensten",
    hostList: ["Vercel Inc., San Francisco (Verenigde Staten): hosting van de website; functies draaien in Frankfurt (EU).", "Neon: database, Frankfurt (EU).", "one.com: domeinnaam en mailbox.", "Resend: versturen en ontvangen van de e-mails van het portaal."],
    ip: "Intellectuele eigendom", ipTxt: "De teksten, foto's en het logo van deze website behoren toe aan de uitgever. Overnemen kan enkel met zijn schriftelijke toestemming.",
    more: "Zie ook", form: "Juridische naam", seat: "Zetel", ent: "Ondernemingsnummer", vat: "Btw", rpr: "RPR", favv: "FAVV-nummer", trade: "Handelsnaam",
    mail: "E-mail", tel: "Telefoon", wa: "WhatsApp", back: "← Terug", none: "Gegevens worden aangevuld."
  };
  document.documentElement.lang = fr ? "fr" : "nl";
  document.title = "FAMO Seafood · " + T.title;
  const sec = (h, body) => '<section class="card card-b mt-14"><h2 class="h2">' + K.esc(h) + "</h2>" + body + "</section>";
  const app = document.getElementById("app");
  app.innerHTML = '<div class="spread-c"><a class="tlink" href="/">' + K.esc(T.back) + "</a>" + K.langSwitch() + "</div>" +
    '<h1 class="h1 mt-18">' + K.esc(T.title) + "</h1>" +
    sec(T.editor, '<div class="kv" id="editor"><div class="sk w-60p"></div></div>') +
    sec(T.contact, '<div class="kv" id="contactKv"><div class="sk w-60p"></div></div>') +
    sec(T.host, "<ul>" + T.hostList.map(x => "<li>" + K.esc(x) + "</li>").join("") + "</ul>") +
    sec(T.ip, "<p>" + K.esc(T.ipTxt) + "</p>") +
    sec(T.more, '<p class="mini"><a class="tlink" href="/privacy">' + K.t("Privacyverklaring") + '</a><a class="tlink" href="/voorwaarden">' + K.t("Algemene voorwaarden") + "</a></p>");
  document.body.insertAdjacentHTML("beforeend", K.publicFooter());
  const kv = rows => rows.filter(r => r[1]).map(r => "<div><small>" + K.esc(r[0]) + "</small>" + r[1] + "</div>").join("") || '<p class="muted">' + K.esc(T.none) + "</p>";
  K.api("/api/config?public=1").then(d => {
    const c = d.config || {}, l = c.legal || {};
    K.fillPublicFooter(c);
    const wa = K.waLink(c.whatsapp);
    document.getElementById("editor").innerHTML = kv([
      [T.trade, K.esc(c.bedrijfsnaam || l.handelsnaam || "")], [T.form, K.esc(K.legalNameOf(c))], [T.seat, K.esc([c.adres, c.plaats].filter(Boolean).join(", "))],
      [T.ent, K.esc(l.ondernemingsnummer || "")], [T.vat, K.esc(c.btw || "")], [T.rpr, K.esc(l.rpr || "")], [T.favv, K.esc(c.favv || "")]
    ]);
    document.getElementById("contactKv").innerHTML = kv([
      [T.mail, c.email ? '<a class="tlink" href="mailto:' + K.esc(c.email) + '">' + K.esc(c.email) + "</a>" : ""],
      [T.tel, c.telefoon ? '<a class="tlink" href="tel:' + K.esc(K.telHref(c.telefoon)) + '">' + K.esc(c.telefoon) + "</a>" : ""],
      [T.wa, wa ? '<a class="tlink" href="' + K.esc(wa) + '" target="_blank" rel="noopener">' + K.esc(c.whatsapp) + "</a>" : ""]
    ]);
  }).catch(err => { document.getElementById("editor").innerHTML = K.c.error(err.message); document.getElementById("contactKv").innerHTML = ""; });
});
