// Mapping d'affichage NL centralise. Les valeurs internes Airtable restent inchangees.
// "caisse" se traduit par "kassa" dans cette application (decision produit) — jamais "doos".
window.FAMO_NL = {
  status: { "Reçue":"Ontvangen", "Prête":"Klaar", "Sortie en livraison":"Onderweg", "Facturée":"Gefactureerd" },
  pay:    { "En attente":"Openstaand", "Payé":"Betaald" },
  move:   { "Correction inventaire":"Voorraadcorrectie", "Entrée stock":"Voorraadontvangst", "Retour client":"Klantretour" },
  unit:   { "caisse":"kassa", "carton":"doos", "pièce":"stuk", "piece":"stuk", "kg":"kg" }
};
window.famoNL = {
  status: v => window.FAMO_NL.status[v] || v,
  pay:    v => window.FAMO_NL.pay[v]    || v,
  move:   v => window.FAMO_NL.move[v]   || v,
  unit:   v => window.FAMO_NL.unit[String(v||"").toLowerCase()] || v,
  lines:  t => String(t||"").replace(/\b(caisse|carton|pièce|piece)\b/gi, m => window.FAMO_NL.unit[m.toLowerCase()] || m)
};
