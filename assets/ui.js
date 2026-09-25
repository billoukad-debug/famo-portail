/* FAMO v2 — gedeelde laag: API, sessie, helpers, componenten, navigatie.
   Eén plaats om het uiterlijk en het gedrag van de drie portalen te veranderen. */
(function (global) {
  "use strict";
  const K = {};

  /* ---------- basis ---------- */
  K.esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  K.eur = v => "€ " + (Number(v) || 0).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  K.num = v => String(Number(v) || 0).replace(".", ",");
  K.qty = v => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toLocaleString("nl-BE", { maximumFractionDigits: 3 }); };
  /* ---------- taal / langue (klantportaal : NL of FR ; personeel en beheer : altijd NL) ----------
     Eén schakelaar (K.langSwitch), één woordenboek (K.FR, sleutel = de Nederlandse tekst), één
     functie (K.t). Een ontbrekende vertaling valt terug op het Nederlands, nooit op een lege string. */
  K.lang = (() => { try { return localStorage.getItem("famoLang") === "fr" ? "fr" : "nl"; } catch (e) { return "nl"; } })();
  K.setLang = l => { try { localStorage.setItem("famoLang", l === "fr" ? "fr" : "nl"); } catch (e) { /* privé venster */ } location.reload(); };
  K.t = s => (K.lang === "fr" && K.FR[s]) ? K.FR[s] : s;
  // Woordenboek klantportaal. Ook de foutmeldingen van de server (in het Nederlands) staan
  // erin : de API blijft eentalig, de vertaling gebeurt bij het tonen (K.errText).
  K.FR = {
    "Catalogus": "Catalogue", "Bestellingen": "Commandes", "Favorieten": "Favoris", "Account": "Compte", "Hoofdnavigatie": "Navigation principale",
    "Vandaag": "Aujourd'hui", "Morgen": "Demain", "Gisteren": "Hier", "Algemeen": "Général", "Ontvangen": "Reçue", "Openstaand": "À payer",
    "Er ging iets mis.": "Une erreur s'est produite.", "Opnieuw proberen": "Réessayer", "Onbekende fout": "Erreur inconnue", "Bevestigen": "Confirmer", "Annuleren": "Annuler",
    "Laden…": "Chargement…", "Openen": "Ouvrir", "Minder": "Moins", "Meer": "Plus", "Aantal": "Quantité", "Wijzigen": "Modifier", "Wijzigen…": "Modification…", "Verplicht.": "Obligatoire.",
    // start
    "Verse vis en zeevruchten · Antwerpen": "Poissons et fruits de mer frais · Anvers", "Toegang aanvragen": "Demander un accès",
    "Verse vis bestellen,<br>zo simpel als een berichtje.": "Commander du poisson frais,<br>aussi simple qu'un message.",
    "Bestel vandaag vóór {t} en wij leveren morgen in Antwerpen en omstreken. U ziet uw afgesproken prijzen, kiest zelf de leverdag en vindt uw leveringsbonnen en facturen terug in het portaal.": "Commandez aujourd'hui avant {t}, nous livrons demain à Anvers et dans les environs. Vous voyez vos prix convenus, choisissez votre jour de livraison et retrouvez vos bons de livraison et factures dans le portail.",
    "Klantportaal": "Portail client", "Aanmelden met uw gebruikersnaam": "Connectez-vous avec votre identifiant", "U bent afgemeld.": "Vous êtes déconnecté.",
    "Gebruikersnaam": "Identifiant", "Wachtwoord": "Mot de passe", "Tonen": "Afficher", "Verbergen": "Masquer", "Aanmelden": "Se connecter", "Aanmelden…": "Connexion…",
    "Wachtwoord vergeten?": "Mot de passe oublié ?", "Nog geen klant? Toegang aanvragen": "Pas encore client ? Demander un accès", "Werkt u bij Famo?": "Vous travaillez chez Famo ?",
    "besteldeadline": "heure limite de commande", "ma–za": "lun–sam", "levering, niet op zondag": "livraison, pas le dimanche", "Gratis": "Gratuite", "levering": "livraison",
    "Vul uw gebruikersnaam in.": "Indiquez votre identifiant.", "Vul uw wachtwoord in.": "Indiquez votre mot de passe.", "Gebruikersnaam of wachtwoord klopt niet.": "Identifiant ou mot de passe incorrect.",
    // catalogus
    "bestel vóór 22:00 voor morgen": "commandez avant 22 h pour demain", "Zoek een product…": "Rechercher un produit…", "Alles": "Tout", "Favoriet": "Favori", "Uit favorieten": "Retirer des favoris",
    "uw prijs": "votre prix", "artikel": "article", "artikelen": "articles", "excl. btw": "HTVA", "Bestellen": "Commander",
    "Niets gevonden voor": "Aucun résultat pour", "Nog geen favorieten": "Pas encore de favoris", "Probeer een ander woord of kies een categorie.": "Essayez un autre mot ou choisissez une catégorie.",
    "Tik op de ster bij een product om het hier te zien.": "Touchez l'étoile d'un produit pour le voir ici.", "Tik op de ster bij een product in de catalogus.": "Touchez l'étoile d'un produit dans le catalogue.",
    // winkelmand
    "Winkelmand": "Panier", "Leegmaken": "Vider", "Opmerking (bv. dikke moot)": "Remarque (ex. tranche épaisse)", "Leverdag": "Jour de livraison", "Andere dag": "Autre jour",
    "Geen levering op zondag. Vóór 22:00 besteld = morgen geleverd.": "Pas de livraison le dimanche. Commandé avant 22 h = livré demain.",
    "Leveradres": "Adresse de livraison", "Adres bij Famo bekend": "Adresse connue de Famo", "Ander adres? Zet het in de opmerking.": "Autre adresse ? Indiquez-la dans la remarque.",
    "Opmerking voor Famo": "Remarque pour Famo", "bv. graag achteraan bellen": "ex. sonner à l'arrière", "Totaal excl. btw": "Total HTVA",
    "De btw wordt op de factuur toegevoegd. Levering gratis · bestel vóór 22:00 voor levering morgen.": "La TVA est ajoutée sur la facture. Livraison gratuite · commandez avant 22 h pour une livraison demain.",
    "Bestelling plaatsen": "Passer la commande", "Uw winkelmand is leeg": "Votre panier est vide", "Kies producten in de catalogus.": "Choisissez des produits dans le catalogue.", "Naar de catalogus": "Vers le catalogue",
    "Op zondag leveren we niet. Kies een andere dag.": "Nous ne livrons pas le dimanche. Choisissez un autre jour.", "Die dag is te vroeg: bestel vóór 22:00 voor levering morgen.": "Ce jour est trop tôt : commandez avant 22 h pour une livraison demain.",
    "Kies een dag binnen de komende 60 dagen.": "Choisissez un jour dans les 60 prochains jours.", "Winkelmand leegmaken?": "Vider le panier ?", "Alle artikelen worden verwijderd.": "Tous les articles seront retirés.",
    "Bestelling versturen…": "Envoi de la commande…", "Uw sessie is verlopen. Meld u opnieuw aan.": "Votre session a expiré. Reconnectez-vous.",
    // bevestigd
    "Bestelling ontvangen": "Commande reçue", "Dank u wel. We zetten alles klaar voor": "Merci. Nous préparons tout pour le", "Wordt klaargezet": "En préparation", "de dag vóór levering": "la veille de la livraison",
    "Onderweg": "En livraison", "ochtend": "matin", "Geleverd → leveringsbon en factuur bij uw bestellingen": "Livrée → bon de livraison et facture dans vos commandes",
    "Geen bevestigingsmail: er is geen e-mailadres bij uw account. Vraag Famo om het toe te voegen.": "Pas d'e-mail de confirmation : aucune adresse e-mail n'est liée à votre compte. Demandez à Famo de l'ajouter.",
    "Een bevestiging is gemaild als uw e-mailadres bij Famo bekend is.": "Une confirmation a été envoyée par e-mail si Famo connaît votre adresse.", "Naar mijn bestellingen": "Vers mes commandes", "Verder bestellen": "Continuer à commander",
    // bestellingen
    "Mijn bestellingen": "Mes commandes", "Lopend": "En cours", "Geleverd · documenten": "Livrées · documents", "Te betalen": "À payer", "Levering": "Livraison",
    "Geleverd · betaald": "Livrée · payée", "Geleverd · openstaand": "Livrée · à payer", "Te laat": "En retard", "Factuur": "Facture", "Leveringsbon": "Bon de livraison", "Opnieuw bestellen": "Commander à nouveau",
    "Wordt klaargezet · wijzigen of annuleren: bel Famo.": "En préparation · pour modifier ou annuler : appelez Famo.", "Geen lopende bestellingen": "Aucune commande en cours", "Niets in deze lijst": "Rien dans cette liste",
    "Bestel vóór 22:00 voor levering morgen.": "Commandez avant 22 h pour une livraison demain.", "Bestelling": "Commande", "annuleren?": "annuler ?", "Behouden": "Garder", "Annuleren…": "Annulation…", "geannuleerd": "annulée",
    "Ze wordt niet klaargezet en niet geleverd. U kunt ze daarna opnieuw bestellen.": "Elle ne sera ni préparée ni livrée. Vous pourrez la commander à nouveau ensuite.",
    "in de winkelmand gezet": "ajouté(s) au panier", "Deze artikelen staan niet meer in de catalogus": "Ces articles ne sont plus au catalogue",
    // favorieten
    "Mijn standaardbestelling": "Ma commande type", "Nog niet ingesteld": "Pas encore définie", "In winkelmand zetten": "Mettre dans le panier", "Vervang door winkelmand": "Remplacer par le panier",
    "Huidige winkelmand opslaan als standaard": "Enregistrer le panier actuel comme commande type", "Snel opnieuw bestellen": "Recommander rapidement",
    "Zet eerst artikelen in de winkelmand.": "Mettez d'abord des articles dans le panier.", "Standaardbestelling opgeslagen": "Commande type enregistrée",
    // account
    "Zaak": "Établissement", "Taal": "Langue", "Nederlands of Frans, voor dit toestel": "Néerlandais ou français, sur cet appareil", "Documenten": "Documents", "Leveringsbonnen en facturen per bestelling": "Bons de livraison et factures par commande",
    "Gegevens wijzigen": "Modifier vos données", "Adres, contact, e-mail: bel of mail Famo": "Adresse, contact, e-mail : appelez ou écrivez à Famo", "Wijzig uw wachtwoord zelf, met uw huidige wachtwoord": "Changez votre mot de passe vous-même, avec le mot de passe actuel",
    "Uitloggen": "Se déconnecter", "Uitloggen?": "Se déconnecter ?", "Uw winkelmand blijft bewaard op dit toestel.": "Votre panier reste enregistré sur cet appareil.",
    "Wachtwoord wijzigen": "Changer le mot de passe", "Ter bevestiging vragen we uw huidige wachtwoord.": "Par sécurité, nous demandons votre mot de passe actuel.", "Huidig wachtwoord": "Mot de passe actuel", "Nieuw wachtwoord": "Nouveau mot de passe",
    "Minstens 8 tekens.": "Au moins 8 caractères.", "Herhaal nieuw wachtwoord": "Répétez le nouveau mot de passe", "Vul uw huidige wachtwoord in.": "Indiquez votre mot de passe actuel.", "Kies een nieuw wachtwoord.": "Choisissez un nouveau mot de passe.",
    "Het nieuwe wachtwoord moet minstens 8 tekens hebben.": "Le nouveau mot de passe doit contenir au moins 8 caractères.", "Het nieuwe wachtwoord mag hoogstens 80 tekens hebben.": "Le nouveau mot de passe ne peut dépasser 80 caractères.",
    "Kies een nieuw wachtwoord dat verschilt van het huidige.": "Choisissez un mot de passe différent de l'actuel.", "De twee nieuwe wachtwoorden zijn niet gelijk.": "Les deux nouveaux mots de passe ne correspondent pas.",
    "Wachtwoord gewijzigd. Gebruik voortaan uw nieuwe wachtwoord.": "Mot de passe modifié. Utilisez désormais le nouveau.", "Uw huidige wachtwoord klopt niet.": "Votre mot de passe actuel est incorrect.",
    // aanvraag
    "Voor horeca en handel. Wij bellen u binnen 1 werkdag met uw prijzen en uw toegang.": "Pour l'horeca et le commerce. Nous vous appelons sous 1 jour ouvrable avec vos prix et votre accès.",
    "Bedrijfsnaam": "Nom de l'entreprise", "Contactpersoon": "Personne de contact", "Telefoon": "Téléphone", "E-mail": "E-mail", "Straat, nummer, gemeente": "Rue, numéro, commune",
    "Wat bestelt u meestal?": "Que commandez-vous habituellement ?", "bv. garnalen 16/20, zalm, tonijn · ongeveer per week": "ex. crevettes 16/20, saumon, thon · environ par semaine",
    "Aanvraag versturen": "Envoyer la demande", "Al klant?": "Déjà client ?", "Geef een geldig e-mailadres.": "Indiquez une adresse e-mail valide.", "Versturen…": "Envoi…",
    "Aanvraag ontvangen.": "Demande reçue.", "Wij bellen u op": "Nous vous appelons au", "binnen 1 werkdag.": "sous 1 jour ouvrable.", "Terug naar de startpagina": "Retour à l'accueil",
    // wachtwoord vergeten
    "← Aanmelden": "← Connexion", "Wachtwoord vergeten": "Mot de passe oublié",
    "Uw wachtwoord wordt door FAMO Seafood beheerd. Bel of mail ons: wij zetten meteen een nieuw wachtwoord klaar en sturen het naar het e-mailadres van uw zaak.": "Votre mot de passe est géré par FAMO Seafood. Appelez-nous ou écrivez-nous : nous préparons aussitôt un nouveau mot de passe et l'envoyons à l'adresse e-mail de votre établissement.",
    "Gegevens laden…": "Chargement…",
    // serveur (NL → FR)
    "Ongeldige gebruikersnaam of wachtwoord": "Identifiant ou mot de passe incorrect", "Bestelling niet gevonden": "Commande introuvable", "Referentie ontbreekt": "Référence manquante",
    "Deze bestelling is al geannuleerd.": "Cette commande est déjà annulée.", "Deze bestelling wordt al klaargezet. Bel Famo om ze te wijzigen of te annuleren.": "Cette commande est déjà en préparation. Appelez Famo pour la modifier ou l'annuler.",
    "Deze bestelling is geannuleerd: er zijn geen documenten.": "Cette commande est annulée : il n'y a pas de documents.",
    "Te veel bestellingen in korte tijd. Wacht even en probeer opnieuw, of bel ons.": "Trop de commandes en peu de temps. Patientez un instant et réessayez, ou appelez-nous.",
    "Te veel mislukte pogingen. Wacht 30 seconden en probeer opnieuw.": "Trop de tentatives échouées. Attendez 30 secondes et réessayez.", "Te veel aanvragen vanaf dit toestel. Probeer later opnieuw of bel ons.": "Trop de demandes depuis cet appareil. Réessayez plus tard ou appelez-nous.",
    "Wachtwoord wijzigen mislukt. Probeer het later opnieuw.": "La modification du mot de passe a échoué. Réessayez plus tard.", "Bedrijfsnaam, contactpersoon, e-mail en telefoon zijn verplicht": "Nom de l'entreprise, personne de contact, e-mail et téléphone sont obligatoires",
    "Ongeldig e-mailadres": "Adresse e-mail invalide", "Ongeldige leverdag": "Jour de livraison invalide", "De leverdag ligt in het verleden": "Le jour de livraison est passé", "Kies een leverdag binnen de komende 60 dagen": "Choisissez un jour de livraison dans les 60 prochains jours",
    "Op zondag leveren we niet": "Nous ne livrons pas le dimanche", "Geen artikelen": "Aucun article", "Klant en artikelen vereist": "Client et articles requis", "Ongeldig artikel of aantal": "Article ou quantité invalide",
    "Alleen producten per kg mogen een decimale hoeveelheid hebben": "Seuls les produits au kg acceptent une quantité décimale", "Geen verbinding. Controleer het netwerk en probeer opnieuw.": "Pas de connexion. Vérifiez le réseau et réessayez.",
    "Op die dag leveren we niet": "Nous ne livrons pas ce jour-là", "Op die dag zijn we gesloten": "Nous sommes fermés ce jour-là", "Ongeldige hoeveelheid": "Quantité invalide", "Artikel is niet beschikbaar": "Article indisponible",
    "Verzoek mislukt": "La demande a échoué", "Niets gewijzigd": "Rien n'a été modifié", "Opslaan mislukt": "Enregistrement impossible", "Annuleren mislukt": "Annulation impossible", "Onbekende actie": "Action inconnue",
    "Vul uw gebruikersnaam en e-mailadres in.": "Indiquez votre identifiant et votre adresse e-mail.", "Te veel aanvragen. Probeer over een uur opnieuw of bel ons.": "Trop de demandes. Réessayez dans une heure ou appelez-nous.",
    "Wachtwoord vernieuwen mislukt. Bel ons.": "Le renouvellement du mot de passe a échoué. Appelez-nous.", "Documentmodule laden mislukt. Controleer de verbinding.": "Impossible de charger le module documents. Vérifiez la connexion.", "Sessie verlopen. Meld u opnieuw aan.": "Session expirée. Reconnectez-vous.", "Voor vandaag kan niet meer besteld worden. Kies een latere leverdag.": "Il n'est plus possible de commander pour aujourd'hui. Choisissez un jour plus tard.", "Serverfout. Probeer opnieuw.": "Erreur du serveur. Réessayez.", "Opslaan of lezen mislukt. Probeer opnieuw.": "L'enregistrement ou la lecture a échoué. Réessayez.", "Catalogus laden mislukt. Probeer opnieuw.": "Le chargement du catalogue a échoué. Réessayez.", "Aanvraag opslaan mislukt. Bel ons.": "L'enregistrement de la demande a échoué. Appelez-nous.",
    "Aanvraag versturen mislukt. Probeer later opnieuw of bel ons.": "L'envoi de la demande a échoué. Réessayez plus tard ou appelez-nous.",
    "Als de gegevens kloppen, ontvangt u binnen enkele minuten een e-mail met een nieuw wachtwoord.": "Si les données sont correctes, vous recevrez dans quelques minutes un e-mail avec un nouveau mot de passe.",
    // leveringsregels (uit Configuratie) — {t} = deadline, {n} = dagen, {d} = dagenlijst, {m}/{r} = bedragen
    "Bestel vóór {t} voor levering morgen": "Commandez avant {t} pour une livraison demain", "bestel vóór {t} voor morgen": "commandez avant {t} pour demain", "Bestel vóór {t} voor levering morgen.": "Commandez avant {t} pour une livraison demain.",
    "Levering op {d}. Vóór {t} besteld = morgen geleverd.": "Livraison le {d}. Commandé avant {t} = livré demain.", "Die dag is te vroeg: bestel vóór {t} voor levering morgen.": "Ce jour est trop tôt : commandez avant {t} pour une livraison demain.",
    "Kies een leverdag binnen de komende {n} dagen": "Choisissez un jour de livraison dans les {n} prochains jours", "De btw wordt op de factuur toegevoegd. Levering gratis · bestel vóór {t} voor levering morgen.": "La TVA est ajoutée sur la facture. Livraison gratuite · commandez avant {t} pour une livraison demain.",
    "Minimumbestelling {m} excl. btw · nog {r} toe te voegen.": "Commande minimum {m} HTVA · encore {r} à ajouter.", "Minimumbestelling {m} excl. btw": "Commande minimum {m} HTVA",
    "zo": "dim", "ma": "lun", "di": "mar", "wo": "mer", "do": "jeu", "vr": "ven", "za": "sam",
    // beschikbaarheid
    "Nog {n}": "Encore {n}", "Uitverkocht": "Épuisé", "Slechts {n} beschikbaar.": "Seulement {n} disponible(s).",
    // bestelling detail
    "Details": "Détails", "Artikelen": "Articles", "Verloop": "Suivi", "Klaar": "Préparée", "Geleverd": "Livrée", "Gefactureerd": "Facturée", "Geannuleerd": "Annulée", "Betaald": "Payée", "Reden": "Motif",
    "Factuurnummer": "Numéro de facture", "Gefactureerd op": "Facturée le", "Geleverd op": "Livrée le", "Ontvangen door": "Réceptionné par", "Betaald op": "Payée le", "Uitzondering levering": "Exception de livraison",
    "Creditnota": "Note de crédit", "Uw opmerking": "Votre remarque", "Besteld op": "Commandée le", "Gewenste leverdag": "Jour de livraison souhaité", "Sluiten": "Fermer",
    "Bestelling wijzigen?": "Modifier la commande ?", "Deze bestelling wordt geannuleerd en de artikelen komen in uw winkelmand. Plaats daarna een nieuwe bestelling.": "Cette commande sera annulée et ses articles remis dans votre panier. Passez ensuite une nouvelle commande.",
    "Bestelling geannuleerd · artikelen in de winkelmand": "Commande annulée · articles dans le panier", "Geannuleerd door klant": "Annulée par le client",
    // openstaande facturen
    "Openstaande facturen": "Factures ouvertes", "Totaal openstaand": "Total à payer", "Mededeling": "Communication", "Kopiëren": "Copier", "Gekopieerd": "Copié", "Betaalgegevens": "Coordonnées de paiement",
    "Kopiëren lukt niet op dit toestel.": "La copie n'est pas possible sur cet appareil.", "Geen openstaande facturen": "Aucune facture ouverte", "Alles is betaald. Dank u wel.": "Tout est payé. Merci.",
    // favorieten synchronisatie
    "Favorieten bewaren mislukt. Ze blijven op dit toestel.": "Enregistrement des favoris impossible. Ils restent sur cet appareil.",
    // account
    "Klantnummer": "Numéro de client", "Btw-nummer": "Numéro de TVA", "Contactgegevens": "Coordonnées", "E-mail voor bevestigingen en facturen": "E-mail pour les confirmations et factures", "Leveradres wijzigen: bel of mail Famo": "Changer l'adresse de livraison : appelez ou écrivez à Famo",
    "Gegevens opgeslagen": "Données enregistrées", "Opslaan": "Enregistrer", "Opslaan…": "Enregistrement…", "Bevestigingen en facturen gaan naar dit adres.": "Les confirmations et factures sont envoyées à cette adresse.",
    // sessie / mail
    "Sessie verlopen, meld u opnieuw aan.": "Session expirée, reconnectez-vous.", "Geen bevestigingsmail: er is geen e-mailadres bij uw account. Voeg het toe via Account.": "Pas d'e-mail de confirmation : aucune adresse e-mail n'est liée à votre compte. Ajoutez-la via Compte.",
    "Geen bevestigingsmail ontvangen? De bestelling is wel goed geregistreerd. Bel Famo bij twijfel.": "Pas d'e-mail de confirmation ? La commande est bien enregistrée. Appelez Famo en cas de doute.", "Een bevestiging is gemaild naar": "Une confirmation a été envoyée à",
    // wachtwoord vergeten
    "Vul uw gebruikersnaam en het e-mailadres van uw zaak in. Als ze overeenkomen, sturen we een nieuw wachtwoord naar dat adres.": "Indiquez votre identifiant et l'adresse e-mail de votre établissement. S'ils correspondent, nous envoyons un nouveau mot de passe à cette adresse.",
    "Nieuw wachtwoord aanvragen": "Demander un nouveau mot de passe", "E-mailadres van uw zaak": "Adresse e-mail de votre établissement", "E-mail versturen is momenteel niet mogelijk. Bel of mail ons voor een nieuw wachtwoord.": "L'envoi d'e-mail n'est pas possible pour le moment. Appelez-nous ou écrivez-nous pour un nouveau mot de passe.",
    "Liever bellen? Wij zetten meteen een nieuw wachtwoord klaar.": "Vous préférez appeler ? Nous préparons aussitôt un nouveau mot de passe."
  };
  // Servermeldingen met een getal erin : één patroon per melding, vertaald bij het tonen.
  const FR_PAT = [[/^Na (\d{2}:\d{2}) kan niet meer voor morgen besteld worden\. Kies een latere leverdag\.$/, "Après $1, il n'est plus possible de commander pour demain. Choisissez un jour plus tard."], [/^Kies een leverdag binnen de komende (\d+) dagen$/, "Choisissez un jour de livraison dans les $1 prochains jours"], [/^Minimum bestelling: (€ [\d.,]+) excl\. btw \(nu (€ [\d.,]+)\)$/, "Commande minimum : $1 HTVA (actuellement $2)"]];
  // K.t met plaatshouders : K.tt("Nog {n}", {n: 3}).
  K.tt = (s, vars) => Object.entries(vars || {}).reduce((out, [k, v]) => out.split("{" + k + "}").join(String(v)), K.t(s));
  K.langSwitch = () => '<div class="lang" role="group" aria-label="Taal / Langue">' + ["nl", "fr"].map(l => '<button type="button" data-lang="' + l + '"' + (K.lang === l ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + l.toUpperCase() + '</button>').join("") + '</div>';
  const doc = global.document;
  if (doc && doc.documentElement) doc.documentElement.lang = K.lang;
  if (doc && typeof doc.addEventListener === "function") doc.addEventListener("click", e => { const b = e.target && e.target.closest && e.target.closest("[data-lang]"); if (b && b.dataset.lang !== K.lang) K.setLang(b.dataset.lang); });
  const DAYS_BY = { nl: ["zo", "ma", "di", "wo", "do", "vr", "za"], fr: ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"] };
  const MONTHS_BY = { nl: ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"], fr: ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"] };
  const DAYS = new Proxy([], { get: (_, i) => DAYS_BY[K.lang][i] }), MONTHS = new Proxy([], { get: (_, i) => MONTHS_BY[K.lang][i] });
  K.parseDate = v => { if (!v) return null; const d = new Date(String(v).includes("T") ? v : v + "T00:00:00"); return Number.isNaN(d.getTime()) ? null : d; };
  K.isoDay = d => { const x = d instanceof Date ? d : K.parseDate(d); if (!x) return ""; const m = String(x.getMonth() + 1).padStart(2, "0"), day = String(x.getDate()).padStart(2, "0"); return x.getFullYear() + "-" + m + "-" + day; };
  K.today = () => K.isoDay(new Date());
  K.addDays = (iso, n) => { const d = K.parseDate(iso) || new Date(); d.setDate(d.getDate() + n); return K.isoDay(d); };
  K.date = v => { const d = K.parseDate(v); if (!d) return "—"; return DAYS[d.getDay()] + " " + d.getDate() + "/" + String(d.getMonth() + 1).padStart(2, "0"); };
  K.dateLong = v => { const d = K.parseDate(v); if (!d) return "—"; return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); };
  K.time = v => { const d = K.parseDate(v); return d ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : ""; };
  K.relDay = iso => { if (!iso) return "—"; const t = K.today(); if (iso === t) return K.t("Vandaag"); if (iso === K.addDays(t, 1)) return K.t("Morgen"); if (iso === K.addDays(t, -1)) return K.t("Gisteren"); return K.date(iso); };
  K.initials = name => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
  K.uid = () => Math.random().toString(36).slice(2, 9);

  /* ---------- NL (interne waarden blijven Frans in Airtable) ---------- */
  K.NL = {
    status: { "Reçue": "Ontvangen", "Prête": "Klaar", "Sortie en livraison": "Onderweg", "Facturée": "Geleverd", "Annulée": "Geannuleerd" },
    pay: { "En attente": "Openstaand", "Payé": "Betaald" },
    unit: { "caisse": "kassa", "carton": "doos", "pièce": "stuk", "piece": "stuk", "kg": "kg" },
    move: { "Correction inventaire": "Voorraadcorrectie", "Entrée stock": "Voorraadontvangst", "Retour client": "Klantretour", "Sortie livraison": "Vertrek levering", "Annulation sortie": "Vertrek ongedaan" },
    // Catégories du catalogue Airtable (valeurs françaises historiques) ; repli : valeur brute.
    cat: { "poisson": "Vis", "poissons": "Vis", "coquillages": "Schelpdieren", "coquillage": "Schelpdieren", "crustacés": "Schaaldieren", "crustaces": "Schaaldieren", "crustacé": "Schaaldieren", "céphalopodes": "Inktvis", "fumé": "Gerookt", "surgelé": "Diepvries", "divers": "Algemeen", "général": "Algemeen", "": "Algemeen" }
  };
  // staff-i18n.js (documents, e-mails) lit ce même dictionnaire : une seule source.
  if (global.FAMO_NL) Object.assign(global.FAMO_NL, K.NL);
  // Zelfde interne waarden, Franse labels voor het klantportaal.
  K.FRV = {
    status: { "Reçue": "Reçue", "Prête": "Préparée", "Sortie en livraison": "En livraison", "Facturée": "Livrée", "Annulée": "Annulée" },
    pay: { "En attente": "À payer", "Payé": "Payée" },
    unit: { "caisse": "caisse", "carton": "carton", "pièce": "pièce", "piece": "pièce", "kg": "kg" },
    cat: { "poisson": "Poissons", "poissons": "Poissons", "coquillages": "Coquillages", "coquillage": "Coquillages", "crustacés": "Crustacés", "crustaces": "Crustacés", "crustacé": "Crustacés", "céphalopodes": "Céphalopodes", "fumé": "Fumé", "surgelé": "Surgelé", "divers": "Général", "général": "Général", "": "Général" }
  };
  const dict = () => (K.lang === "fr" ? K.FRV : K.NL);
  K.status = v => dict().status[v] || v || K.t("Ontvangen");
  K.pay = v => dict().pay[v] || v || K.t("Openstaand");
  K.unit = v => dict().unit[String(v || "").toLowerCase()] || v || "";
  K.move = v => K.NL.move[v] || v;
  K.cat = v => { const k = String(v || "").trim().toLowerCase(); return dict().cat[k] || String(v || "").trim() || K.t("Algemeen"); };
  K.STATUSES = ["Reçue", "Prête", "Sortie en livraison", "Facturée"];
  K.CANCELLED = "Annulée";
  // Une bestelling « afgesloten » n'est plus à préparer ni à livrer : gefactureerd of geannuleerd.
  K.isClosed = o => o.statut === "Facturée" || o.statut === K.CANCELLED;
  K.stKey = st => ({ "Reçue": "new", "Prête": "ready", "Sortie en livraison": "road", "Facturée": "done", "Annulée": "cancel" })[st] || "new";
  K.stChip = (st, extra) => '<span class="chip st-' + K.stKey(st) + '"><i></i>' + K.esc(extra || K.status(st)) + '</span>';
  K.stCell = (st, label) => '<span class="cell-st c-' + K.stKey(st) + '">' + K.esc(label || K.status(st)) + '</span>';
  K.payCell = p => p === "Payé" ? '<span class="cell-st c-done">Betaald</span>' : '<span class="cell-st c-open">Openstaand</span>';
  // "Zalm × 2 kg [€16.00] (opm)" -> {name, qty, unit, price, comment}
  K.parseLines = txt => String(txt || "").split("\n").map(l => l.trim()).filter(Boolean).map(raw => {
    const m = raw.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*([^\[\(]*)(.*)$/);
    if (!m) return { name: raw, qty: 0, unit: "", price: null, comment: "" };
    const tail = m[4] || "", price = tail.match(/\[€\s*([\d.,]+)\]/), comment = tail.match(/\((.*?)\)/);
    return { name: m[1].trim(), qty: parseFloat(String(m[2]).replace(",", ".")) || 0, unit: m[3].trim(), price: price ? Number(price[1].replace(",", ".")) : null, comment: comment ? comment[1] : "" };
  });
  K.formatLine = l => `${l.name} × ${K.qty(l.qty).replace(",", ".")}${l.unit ? " " + l.unit : ""}${l.price != null ? " [€" + Number(l.price).toFixed(2) + "]" : ""}${l.comment ? " (" + l.comment + ")" : ""}`;
  K.linesSummary = txt => K.parseLines(txt).map(l => K.qty(l.qty) + "× " + l.name).join(" · ");
  K.dayOrder = o => o.dateLiv || o.date || "";
  K.isLate = o => o.statut !== "Facturée" && o.statut !== "Annulée" && o.dateLiv && o.dateLiv < K.today();

  /* ---------- opslag ---------- */
  K.store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privé venster */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  K.session = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  // Voert fn uit voor elk item, hoogstens n tegelijk (bv. 3 facturen op betaald) ; geeft [{item, ok, error}] terug.
  K.pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; const worker = async () => { while (i < items.length) { const k = i++; try { out[k] = { item: items[k], ok: true, value: await fn(items[k]) }; } catch (error) { out[k] = { item: items[k], ok: false, error }; } } }; await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker)); return out; };
  // Wacht tot er even niet getypt wordt (zoekvelden) : één render per pauze, niet per toets.
  K.debounce = (fn, ms) => { let t = 0; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms || 150); }; };

  /* ---------- documentmodule op aanvraag (leveringsbon, factuur, PDF) ---------- */
  // Enkel geladen bij het eerste document dat geopend wordt : scheelt ± 35 kB op elke pagina.
  // DOCS_VER wordt door scripts/assets-version.js bijgewerkt (cache-busting).
  K.DOCS_VER = "aa7fc5aaf2";
  let docsLoading = null;
  K.docs = function () {
    if (global.FamoDocuments && global.famoDocPreview) return Promise.resolve();
    if (docsLoading) return docsLoading;
    const one = src => new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src + "?v=" + K.DOCS_VER; el.async = false;
      el.onload = resolve; el.onerror = () => reject(new Error(K.t("Documentmodule laden mislukt. Controleer de verbinding.")));
      document.head.appendChild(el);
    });
    docsLoading = ["/staff-i18n.js", "/staff-company.js", "/documents.js", "/staff-doc-preview.js"]
      .reduce((p, src) => p.then(() => one(src)), Promise.resolve())
      .catch(e => { docsLoading = null; throw e; });
    return docsLoading;
  };

  /* ---------- API ---------- */
  const ERR = { "Code invalide": "Ongeldige personeelscode", "POST only": "Alleen POST toegestaan" };
  K.errText = m => { if (m && typeof m === "object") m = m.message || m.error || JSON.stringify(m); const raw = String(m || "").trim(); if (!raw) return K.t("Onbekende fout"); if (ERR[raw]) return K.t(ERR[raw]); const nl = raw.replace(/\bcaisse\b/gi, "kassa").replace(/\bpièce\b/gi, "stuk"); if (K.lang !== "fr") return nl; const pat = FR_PAT.find(([re]) => re.test(nl)); return K.FR[raw] || K.FR[nl] || (pat ? nl.replace(pat[0], pat[1]) : nl); };
  // opts.retry : bij netwerkfout of 5xx één keer opnieuw proberen (na 800 ms) vóór de fout doorgaat.
  K.api = async function (url, opts) {
    const o = Object.assign({ credentials: "include" }, opts || {});
    const retry = !!o.retry; delete o.retry;
    if (o.json !== undefined) { o.method = o.method || "POST"; o.headers = Object.assign({ "Content-Type": "application/json" }, o.headers || {}); o.body = JSON.stringify(o.json); delete o.json; }
    // Elke wijziging aan bestellingen maakt de gedeelde lijst-cache (staff-common) ongeldig.
    if (o.method && o.method !== "GET" && /^\/api\/(updateorder|staff|onboarding)\b/.test(url)) K.session.del("famoOrdersCache");
    const once = async () => {
      let r;
      try { r = await fetch(url, o); } catch (e) { const err = new Error(K.t("Geen verbinding. Controleer het netwerk en probeer opnieuw.")); err.network = true; throw err; }
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && !/\/api\/(catalogue|orders|order|klantorder|klantdoc|klantwachtwoord)$/.test(url)) {
        document.dispatchEvent(new CustomEvent("famo:session-expired", { detail: { url } }));
      }
      if (!r.ok) { const err = new Error(K.errText(d.error || "Verzoek mislukt")); err.status = r.status; err.payload = d; throw err; }
      return d;
    };
    try { return await once(); }
    catch (err) { if (retry && (err.network || err.status >= 500)) { await new Promise(res => setTimeout(res, 800)); return once(); } throw err; }
  };
  // Laadblok met « Opnieuw proberen » : voert fn uit ; bij een fout toont de container de melding
  // en een link die fn opnieuw start. Retourneert wat fn retourneert (undefined bij een fout).
  K.retryBox = async function (container, fn) {
    try { return await fn(); }
    catch (err) {
      const el = typeof container === "string" ? document.getElementById(container) : container;
      if (!el) throw err;
      el.innerHTML = K.c.error(err.message || String(err), true);
      const a = el.querySelector("[data-retry]"); if (a) a.onclick = e => { e.preventDefault(); K.retryBox(el, fn); };
      return undefined;
    }
  };

  /* ---------- personeel / beheer sessie (cookie) ---------- */
  K.staff = {
    role: null, name: "",
    // « name » = voornaam van een persoonlijke PIN (Medewerkers) ; bij een gedeelde code geeft de server de rol terug (personeel/beheerder) : dan geen naam.
    nameOf(d) { const n = String((d && d.name) || "").trim(); return /^(personeel|beheerder)$/i.test(n) ? "" : n; },
    async login(code, want) { const d = await K.api("/api/session", { json: { code: String(code || ""), want: want === "admin" ? "admin" : "staff" } }); K.staff.role = d.role || null; K.staff.name = K.staff.nameOf(d); return d; },
    async check() { try { const d = await K.api("/api/session"); K.staff.role = d.role || null; K.staff.name = K.staff.nameOf(d); return true; } catch (e) { K.staff.role = null; K.staff.name = ""; return false; } },
    async logout() { try { await fetch("/api/session", { method: "DELETE", credentials: "include" }); } catch (e) { /* ignore */ } K.staff.role = null; K.staff.name = ""; },
    isAdmin() { return K.staff.role === "admin"; }
  };
  K.RETURN = "famoReturnTo";
  K.saveReturn = () => K.session.set(K.RETURN, location.pathname + location.search + location.hash);
  K.takeReturn = fb => { const v = K.session.get(K.RETURN, null); K.session.del(K.RETURN); return v && v.startsWith("/") && !v.startsWith("//") ? v : (fb || null); };

  /* ---------- klant sessie (ondertekend token, enkel in dit tabblad ; nooit het wachtwoord) ---------- */
  K.klant = {
    KEY: "famoKlant",
    get() { return K.session.get(K.klant.KEY, null); },
    set(v) { K.session.set(K.klant.KEY, v); },
    clear() { K.session.del(K.klant.KEY); },
    // Oude sessie (van vóór het token) : wachtwoord nog één keer meesturen, daarna vervangt het token het.
    creds() { const c = K.klant.get(); return c ? (c.token ? { token: c.token } : { user: c.user, pw: c.pw }) : null; },
    setToken(token) { const c = K.klant.get(); if (!c || !token) return; const n = Object.assign({}, c, { token }); delete n.pw; K.klant.set(n); }
  };

  /* ---------- iconen (één stijl, 24-grid, stroke) ---------- */
  const I = {
    orders: '<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6"/>',
    box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    stock: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/>',
    table: '<path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14"/>',
    board: '<path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z"/>',
    cal: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    group: '<path d="M4 6h16M4 12h10M4 18h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><path d="M6 14h12v7H6z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    map: '<path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    fish: '<path d="M3 12c3-4 7-6 11-6 3 0 5 2 7 6-2 4-4 6-7 6-4 0-8-2-11-6z"/><path d="M3 12l-1-4M3 12l-1 4"/><circle cx="15" cy="11" r="1"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M13 3h6v18h-6"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 9v5M12 17h.01"/>',
    refresh: '<path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10a8 8 0 00-14-4M4 14a8 8 0 0014 4"/>'
  };
  K.icon = (name, cls) => '<svg class="ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (I[name] || I.doc) + '</svg>';

  /* ---------- componenten ---------- */
  const c = {};
  c.btn = (label, opts) => { const o = opts || {}; return '<button type="button" class="btn ' + (o.kind ? "btn-" + o.kind : "btn-o") + (o.sm ? " btn-sm" : "") + (o.block ? " btn-block" : "") + (o.cls ? " " + o.cls : "") + '"' + (o.id ? ' id="' + o.id + '"' : "") + (o.attrs || "") + (o.disabled ? " disabled" : "") + '>' + (o.icon ? K.icon(o.icon) : "") + K.esc(label) + '</button>'; };
  c.field = (label, inputHtml, opts) => { const o = opts || {}; return '<div class="field"' + (o.id ? ' id="' + o.id + '"' : "") + '><label' + (o.for ? ' for="' + o.for + '"' : "") + '>' + K.esc(label) + (o.req ? ' <span style="color:var(--danger)">*</span>' : "") + '</label>' + inputHtml + (o.hint ? '<span class="quiet" style="font-size:12px">' + K.esc(o.hint) + '</span>' : "") + '<span class="err" data-err></span></div>'; };
  c.input = (id, opts) => { const o = opts || {}; return '<input class="input" id="' + id + '" type="' + (o.type || "text") + '"' + (o.value != null ? ' value="' + K.esc(o.value) + '"' : "") + (o.placeholder ? ' placeholder="' + K.esc(o.placeholder) + '"' : "") + (o.attrs || "") + '>'; };
  c.empty = (title, text, action) => '<div class="state"><div class="ic">' + K.icon("orders") + '</div><b>' + K.esc(title) + '</b>' + (text ? '<p class="sub" style="max-width:320px;white-space:normal">' + K.esc(text) + '</p>' : "") + (action || "") + '</div>';
  c.error = (text, retry) => '<div class="notice err" role="alert"><i>!</i><div><b>' + K.t("Er ging iets mis.") + '</b> ' + K.esc(text) + (retry ? ' <a href="#" data-retry>' + K.t("Opnieuw proberen") + '</a>' : "") + '</div></div>';
  c.warn = html => '<div class="notice warn"><i>!</i><div>' + html + '</div></div>';
  c.ok = html => '<div class="notice ok"><i>✓</i><div>' + html + '</div></div>';
  c.skeleton = n => '<div style="display:flex;flex-direction:column;gap:10px">' + Array.from({ length: n || 3 }, () => '<div class="card card-b" style="display:flex;flex-direction:column;gap:8px"><div class="sk" style="width:40%"></div><div class="sk" style="width:70%"></div><div class="sk" style="width:55%"></div></div>').join("") + '</div>';
  c.kpi = (n, label, warn) => '<span class="kpi' + (warn ? " warn" : "") + '"><b>' + K.esc(n) + '</b> ' + K.esc(label) + '</span>';
  c.avatar = name => '<span class="avatar">' + K.esc(K.initials(name)) + '</span>';
  // opts.big → 44px (personnel, gants) ; opts.label → nom accessible. aria-pressed suit K.setOn.
  c.check = (on, attrs, opts) => { const o = opts || {}; return '<button type="button" class="check' + (on ? " on" : "") + (o.big ? " big" : "") + '" ' + (attrs || "") + (o.label ? ' aria-label="' + K.esc(o.label) + '"' : "") + ' aria-pressed="' + (on ? "true" : "false") + '">' + K.icon("check") + '</button>'; };
  // Interrupteur visuel + état accessible en une fois (check, toggle, favoriet).
  K.setOn = (el, on) => { if (!el) return; el.classList.toggle("on", !!on); el.setAttribute("aria-pressed", on ? "true" : "false"); const line = el.closest(".line"); if (line) line.classList.toggle("ok", !!on); };
  c.stepper = (id, value, opts) => { const o = opts || {}; return '<div class="stepper' + (Number(value) > 0 ? " on" : "") + '" data-stepper="' + id + '"><button type="button" data-dec aria-label="' + K.t("Minder") + '">−</button><input type="number" inputmode="decimal" min="0" step="' + (o.step || 1) + '" value="' + K.esc(value) + '" aria-label="' + K.t("Aantal") + '"><button type="button" data-inc aria-label="' + K.t("Meer") + '">+</button></div>'; };
  K.c = c;

  /* ---------- toast / dialoog / paneel ---------- */
  function toasts() { let t = document.querySelector(".toasts"); if (!t) { t = document.createElement("div"); t.className = "toasts"; t.setAttribute("aria-live", "polite"); document.body.appendChild(t); } return t; }
  K.toast = (msg, opts) => { const o = opts || {}; const el = document.createElement("div"); el.className = "toast" + (o.kind ? " " + o.kind : ""); el.innerHTML = K.esc(msg) + (o.action ? '<button type="button">' + K.esc(o.action) + '</button>' : ""); if (o.action && o.onAction) el.querySelector("button").onclick = () => { o.onAction(); el.remove(); }; toasts().appendChild(el); setTimeout(() => el.remove(), o.ms || 4500); return el; };
  K.confirm = (opts) => new Promise(resolve => {
    const o = typeof opts === "string" ? { text: opts } : (opts || {});
    const d = document.createElement("div"); d.className = "dialog"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-labelledby", "kDialogTitle");
    d.innerHTML = '<div class="box"><b style="font-size:15px" id="kDialogTitle">' + K.esc(o.title || K.t("Bevestigen")) + '</b><span class="muted">' + K.esc(o.text || "") + '</span><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px"><button type="button" class="btn btn-o btn-sm" data-no>' + K.esc(o.no || K.t("Annuleren")) + '</button><button type="button" class="btn btn-sm ' + (o.danger ? "btn-danger" : "btn-p") + '" data-yes>' + K.esc(o.yes || "OK") + '</button></div></div>';
    const done = v => { d.remove(); document.removeEventListener("keydown", key); resolve(v); };
    const key = e => { if (e.key === "Escape") done(false); };
    d.querySelector("[data-no]").onclick = () => done(false); d.querySelector("[data-yes]").onclick = () => done(true); d.onclick = e => { if (e.target === d) done(false); };
    document.addEventListener("keydown", key); document.body.appendChild(d); d.querySelector("[data-yes]").focus();
  });
  K.prompt = (opts) => new Promise(resolve => {
    const o = opts || {};
    const d = document.createElement("div"); d.className = "dialog"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-labelledby", "kPromptTitle");
    d.innerHTML = '<div class="box"><b style="font-size:15px" id="kPromptTitle">' + K.esc(o.title || "") + '</b>' + (o.text ? '<span class="muted">' + K.esc(o.text) + '</span>' : "") + '<input class="input" id="kPrompt" aria-labelledby="kPromptTitle" value="' + K.esc(o.value || "") + '" placeholder="' + K.esc(o.placeholder || "") + '"><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-o btn-sm" data-no>' + K.t("Annuleren") + '</button><button type="button" class="btn btn-p btn-sm" data-yes>' + K.esc(o.yes || "OK") + '</button></div></div>';
    const inp = d.querySelector("#kPrompt");
    const done = v => { d.remove(); resolve(v); };
    d.querySelector("[data-no]").onclick = () => done(null); d.querySelector("[data-yes]").onclick = () => done(inp.value); inp.addEventListener("keydown", e => { if (e.key === "Enter") done(inp.value); if (e.key === "Escape") done(null); });
    document.body.appendChild(d); inp.focus();
  });
  K.panel = (opts) => {
    const o = opts || {};
    const s = document.createElement("div"); s.className = "scrim"; s.setAttribute("role", "dialog"); s.setAttribute("aria-modal", "true");
    s.setAttribute("aria-labelledby", "kPanelTitle");
    s.innerHTML = '<div class="panel"' + (o.width ? ' style="width:min(' + o.width + ',100%)"' : "") + '><div class="panel-h"><div><h2 class="h2" id="kPanelTitle">' + K.esc(o.title || "") + '</h2>' + (o.sub ? '<p class="sub">' + K.esc(o.sub) + '</p>' : "") + '</div><button type="button" class="ibtn" data-close aria-label="' + K.t("Sluiten") + '">' + K.icon("x") + '</button></div><div class="panel-b">' + (o.body || "") + '</div>' + (o.footer ? '<div class="panel-f">' + o.footer + '</div>' : "") + '</div>';
    const close = () => { s.remove(); document.removeEventListener("keydown", key); document.body.style.overflow = ""; if (o.onClose) o.onClose(); };
    const key = e => { if (e.key === "Escape") close(); };
    s.querySelector("[data-close]").onclick = close; s.onclick = e => { if (e.target === s) close(); };
    document.addEventListener("keydown", key); document.body.style.overflow = "hidden"; document.body.appendChild(s);
    const first = s.querySelector("input,select,textarea,button:not([data-close])"); if (first) try { first.focus(); } catch (e) { /* ignore */ }
    return { el: s, close, body: s.querySelector(".panel-b"), footer: s.querySelector(".panel-f") };
  };
  K.bind = (root, sel, ev, fn) => (root || document).querySelectorAll(sel).forEach(el => el.addEventListener(ev, fn));
  const delegated = new WeakMap();
  K.on = (root, ev, sel, fn) => {
    const host = root || document, key = ev + ":" + sel;
    let handlers = delegated.get(host); if (!handlers) { handlers = new Map(); delegated.set(host, handlers); }
    const previous = handlers.get(key); if (previous) host.removeEventListener(ev, previous);
    const handler = e => { const t = e.target.closest(sel); if (t && host.contains(t)) fn(e, t); };
    handlers.set(key, handler); host.addEventListener(ev, handler);
  };
  K.$ = (sel, root) => (root || document).querySelector(sel);
  K.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  K.setErr = (fieldId, msg) => { const f = document.getElementById(fieldId); if (!f) return; const e = f.querySelector("[data-err]"); if (e) e.textContent = msg || ""; const i = f.querySelector(".input"); if (i) { if (msg) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid"); } };
  K.busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || "Bezig…"; } else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; } };
  K.hashParams = () => { const h = location.hash.replace(/^#\/?/, ""); const [path, q] = h.split("?"); const p = {}; new URLSearchParams(q || "").forEach((v, k) => { p[k] = v; }); return { path: path || "", params: p }; };
  K.go = (path, params) => { const q = params ? "?" + new URLSearchParams(params).toString() : ""; location.hash = "#/" + path + q; };

  /* ---------- personeel/beheer shell ---------- */
  const NAV_DAILY = [["bestellingen.html", "Bestellingen", "orders"], ["entrepot.html", "Magazijn", "box"], ["leveringen.html", "Leveringen", "truck"]];
  // Invoeren en Voorraad staan open voor het personeel (bestelling ingeven aan de telefoon, voorraad
  // tellen) ; enkel verwijderen in Voorraad en Beheer blijven voor de beheerder (server : adminOk).
  const NAV_ADMIN = [["invoer.html", "Invoeren", "plus"], ["documenten.html", "Documenten", "doc"], ["beheer.html", "Beheer", "settings"]];
  const NAV_STAFF_MORE = [["invoer.html", "Invoeren", "plus"], ["documenten.html", "Documenten", "doc"]];
  K.shell = function (opts) {
    const o = opts || {};
    K.lang = "nl"; // personeel en beheer werken altijd in het Nederlands, ook op een toestel dat het klantportaal in het Frans toont
    if (doc && doc.documentElement) doc.documentElement.lang = "nl";
    const here = (location.pathname.split("/").pop() || "").toLowerCase();
    const admin = K.staff.isAdmin();
    const portal = o.portal || (admin ? "beheer" : "personeel");
    document.body.classList.remove("portal-klant", "portal-personeel", "portal-beheer");
    document.body.classList.add("portal-" + portal);
    const link = ([href, label, icon]) => '<a class="nav' + (here === href ? " on" : "") + '" href="/' + href + '"' + (here === href ? ' aria-current="page"' : "") + '>' + K.icon(icon) + '<span>' + label + '</span></a>';
    const more = admin ? NAV_ADMIN : NAV_STAFF_MORE;
    // Sessie GET geeft de naam van de medewerker (persoonlijke PIN) : die staat bij de rol ; zonder naam blijft de rol alleen.
    const role = admin ? "Beheerder" : "Personeel", who = K.staff.name || role;
    const side = '<aside class="side" data-famo-nav><a class="brand" href="/bestellingen.html"><span class="logo">F</span><span><b>FAMO Seafood</b><small>' + (admin ? "Beheer" : "Teamportaal") + '</small></span></a>' +
      '<div class="navlbl">Dagelijks</div>' + NAV_DAILY.map(link).join("") +
      '<div class="navlbl">' + (admin ? "Beheer" : "Meer") + '</div>' + more.map(link).join("") +
      link(["stock.html", "Voorraad", "stock"]) +
      '<div class="spacer"></div><a class="nav" href="/">' + K.icon("ext") + '<span>Klantportaal</span></a>' +
      '<div class="user">' + c.avatar(who) + '<div class="utxt" style="font-size:12.5px;min-width:0"><b style="font-weight:500;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + K.esc(who) + '</b>' + (K.staff.name ? '<small class="quiet" style="font-size:11px;display:block">' + role + '</small>' : "") + '<div><a href="#" data-logout class="quiet" style="font-size:11px">Uitloggen</a></div></div></div></aside>';
    // Uitloggen aussi dans la topbar (44px) : sur tablette et téléphone la sidebar cache le lien.
    // Systeemstatus (beheer.html#status) enkel voor de beheerder : het personeel mag die pagina niet openen.
    const top = '<div class="topbar"><label class="search">' + K.icon("search") + '<input id="globalSearch" aria-label="Zoeken" placeholder="' + K.esc(o.searchPlaceholder || "Zoek bestelling, klant of artikel…") + '" autocomplete="off"></label><span class="spacer"></span>' + (o.topRight || "") + (admin ? '<a class="ibtn" href="/beheer.html#status" title="Systeemstatus" aria-label="Systeemstatus">' + K.icon("help") + '</a>' : "") + '<span title="' + K.esc(who + (K.staff.name ? " · " + role : "")) + '">' + c.avatar(who) + '</span><button type="button" class="ibtn" data-logout title="Uitloggen" aria-label="Uitloggen">' + K.icon("logout") + '</button></div>';
    const app = document.getElementById("app");
    app.innerHTML = '<div class="shell">' + side + '<div class="main">' + top + '<div id="page"></div></div></div>';
    K.on(app, "click", "[data-logout]", async e => { e.preventDefault(); await K.staff.logout(); location.href = "/personeel.html"; });
    return document.getElementById("page");
  };
  // Aanmeldpagina voor personeel/beheer op een pagina zelf (inline), met terugkeer.
  K.requireStaff = async function (opts) {
    const o = opts || {};
    const ok = await K.staff.check();
    if (!ok) { K.saveReturn(); location.replace(o.admin ? "/beheer-login.html" : "/personeel.html"); return false; }
    if (o.admin && !K.staff.isAdmin()) { K.saveReturn(); location.replace("/beheer-login.html?denied=1"); return false; }
    document.addEventListener("famo:session-expired", () => { K.saveReturn(); K.toast("Sessie verlopen. Meld u opnieuw aan.", { kind: "err" }); setTimeout(() => location.replace(o.admin ? "/beheer-login.html" : "/personeel.html"), 1200); }, { once: true });
    return true;
  };
  K.klantTabs = active => {
    const tabs = [["catalogus", "Catalogus", "list"], ["bestellingen", "Bestellingen", "orders"], ["favorieten", "Favorieten", "star"], ["account", "Account", "user"]];
    return '<nav class="mtabs" aria-label="' + K.t("Hoofdnavigatie") + '">' + tabs.map(([k, l, i]) => '<a class="mtab' + (active === k ? " on" : "") + '" href="#/' + k + '"' + (active === k ? ' aria-current="page"' : "") + '>' + K.icon(i) + K.t(l) + '</a>').join("") + '</nav>';
  };
  global.K = K;
})(window);
