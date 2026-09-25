// Mapping d'affichage NL centralise. Les valeurs internes Airtable restent inchangees.
// "caisse" se traduit par "kassa" dans cette application (decision produit) — jamais "doos".
//
// Source unique : assets/ui.js (K.NL). Ce fichier n'existe que pour les modules qui
// tournent sans K (documents.js, e-mails cote serveur via lib/ordermail.js) ; quand
// ui.js est charge, il reprend K.NL tel quel, sinon le repli ci-dessous, identique.
window.FAMO_NL = (window.K && window.K.NL) ? window.K.NL : {
  status: { "Reçue":"Ontvangen", "Prête":"Klaar", "Sortie en livraison":"Onderweg", "Facturée":"Geleverd", "Annulée":"Geannuleerd" },
  pay:    { "En attente":"Openstaand", "Payé":"Betaald" },
  move:   { "Correction inventaire":"Voorraadcorrectie", "Entrée stock":"Voorraadontvangst", "Retour client":"Klantretour", "Sortie livraison":"Vertrek levering", "Annulation sortie":"Vertrek ongedaan" },
  unit:   { "caisse":"kassa", "carton":"doos", "pièce":"stuk", "piece":"stuk", "kg":"kg" },
  cat:    { "poisson":"Vis", "poissons":"Vis", "coquillages":"Schelpdieren", "coquillage":"Schelpdieren", "crustacés":"Schaaldieren", "crustaces":"Schaaldieren", "crustacé":"Schaaldieren", "céphalopodes":"Inktvis", "fumé":"Gerookt", "surgelé":"Diepvries", "divers":"Algemeen", "général":"Algemeen", "":"Algemeen" }
};
window.famoNL = {
  status: v => window.FAMO_NL.status[v] || v,
  pay:    v => window.FAMO_NL.pay[v]    || v,
  move:   v => window.FAMO_NL.move[v]   || v,
  unit:   v => window.FAMO_NL.unit[String(v||"").toLowerCase()] || v,
  cat:    v => window.FAMO_NL.cat[String(v||"").trim().toLowerCase()] || String(v||"").trim() || "Algemeen",
  lines:  t => String(t||"").replace(/\b(caisse|carton|pièce|piece)\b/gi, m => window.FAMO_NL.unit[m.toLowerCase()] || m)
};
