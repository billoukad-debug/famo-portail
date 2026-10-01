/* FAMO v2 — gedeelde laag: API, sessie, helpers, componenten, navigatie.
   Eén plaats om het uiterlijk en het gedrag van de drie portalen te veranderen. */
(function (global) {
  "use strict";
  const K = {};

  /* ---------- basis ---------- */
  K.esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // G-19 : montants selon la langue du client — nl-BE « € 1.284,50 », fr-BE « 1 284,50 € » (K.lang est lu plus bas).
  K.eur = v => { const n = Number(v) || 0; return K.lang === "fr" ? n.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "\u00a0€" : "€\u00a0" + n.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  K.num = v => String(Number(v) || 0).replace(".", ",");
  // FOR-06 : « 1 404,48 », « 1.404,48 », « 1404.48 », « 12,5 », « € 12,50 » → nombre ; vide ou illisible → NaN.
  K.parseNum = v => {
    if (typeof v === "number") return v;
    let t = String(v == null ? "" : v).replace(/[\s\u00a0\u202f€]|eur/gi, "");
    if (!t) return NaN;
    const c = t.lastIndexOf(","), d = t.lastIndexOf(".");
    if (c >= 0 && d >= 0) t = c > d ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    else if (c >= 0) t = t.replace(/,(?=.*,)/g, "").replace(",", ".");
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
  };
  // Pour l'envoi au serveur : le nombre lu, ou le texte tel quel (le serveur refuse ce qui n'est pas un nombre).
  K.numIn = v => { const n = K.parseNum(v); return Number.isFinite(n) ? String(n) : String(v == null ? "" : v).trim(); };
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
    "Verse vis en zeevruchten, Antwerpen": "Poissons et fruits de mer, Anvers", "Meer links": "Autres liens",
    "Die dag is te vroeg: de eerste mogelijke leverdag is {d}.": "Ce jour est trop tôt : le premier jour de livraison possible est {d}.",
    "Bestel vóór {t} voor levering op {d}.": "Commandez avant {t} pour une livraison le {d}.",
    "Levering op {d}. Vóór {t} besteld = geleverd op de eerstvolgende leverdag.": "Livraison le {d}. Commandé avant {t} = livré au prochain jour de livraison.",
    "De btw wordt op de factuur toegevoegd. Levering gratis · bestel vóór {t} voor levering op {d}.": "La TVA est ajoutée sur la facture. Livraison gratuite · commandez avant {t} pour une livraison le {d}.", "Personeel": "Personnel", "Beheer": "Gestion",
    "Vóór {t} besteld,": "Commandé avant {t},", "morgen in uw keuken.": "demain dans votre cuisine.",             "Levering {d} in Antwerpen en omstreken. U ziet uw afgesproken prijzen, kiest zelf de leverdag en vindt uw leveringsbonnen en facturen terug.": "Livraison {d} à Anvers et environs. Vous voyez vos prix négociés, choisissez votre jour de livraison et retrouvez vos bons de livraison et factures.",
    "Tellers in het menu": "Pastilles du menu", "Nieuw": "Nouveau", "Uit": "Aucune", "nieuw sinds uw laatste bezoek": "nouveau depuis votre dernière visite",
    "Nieuw: verdwijnt zodra u de pagina opent. Alles: blijft zolang er iets te doen is. Uit: geen tellers.": "Nouveau : disparaît dès que vous ouvrez la page. Tout : reste tant qu'il y a quelque chose à faire. Aucune : pas de pastille.",
    "Vandaag": "Aujourd'hui", "Morgen": "Demain", "Gisteren": "Hier", "Algemeen": "Général", "Ontvangen": "Reçue", "Openstaand": "À payer",
    "Er ging iets mis.": "Une erreur s'est produite.", "Opnieuw proberen": "Réessayer", "Onbekende fout": "Erreur inconnue", "Bevestigen": "Confirmer", "Bezig…": "En cours…", "Wijzigingen niet bewaard": "Modifications non enregistrées", "U heeft iets gewijzigd in dit venster. Sluiten zonder te bewaren?": "Vous avez modifié quelque chose dans cette fenêtre. Fermer sans enregistrer ?", "Sluiten zonder bewaren": "Fermer sans enregistrer", "Verder bewerken": "Continuer", "Sneltoetsen": "Raccourcis clavier", "Zoeken": "Rechercher", "Sneltoetsen tonen": "Afficher les raccourcis", "Venster sluiten": "Fermer la fenêtre", "Bewaren vanuit een tekstvak": "Enregistrer depuis un champ texte", "Volgende / vorige knop": "Bouton suivant / précédent", "Zoekveld": "Champ de recherche", "Naar de inhoud": "Aller au contenu", "Annuleren": "Annuler",
    "Laden…": "Chargement…", "Openen": "Ouvrir", "Creditnota niet gevonden": "Note de crédit introuvable", "Minder": "Moins", "Meer": "Plus", "Aantal": "Quantité", "Wijzigen": "Modifier", "Wijzigen…": "Modification…", "Verplicht.": "Obligatoire.",
    // start
    "Toegang aanvragen": "Demander un accès",
            "Klantportaal": "Portail client", "Aanmelden met uw gebruikersnaam": "Connectez-vous avec votre identifiant", "U bent afgemeld.": "Vous êtes déconnecté.",
    "Gebruikersnaam": "Identifiant", "Wachtwoord": "Mot de passe", "Tonen": "Afficher", "Verbergen": "Masquer", "Aanmelden": "Se connecter", "Aanmelden…": "Connexion…",
    "Wachtwoord vergeten?": "Mot de passe oublié ?", "Nog geen klant? Toegang aanvragen": "Pas encore client ? Demander un accès", "Werkt u bij Famo?": "Vous travaillez chez Famo ?",
    "besteldeadline": "heure limite de commande", "ma–za": "lun–sam",     "Vul uw gebruikersnaam in.": "Indiquez votre identifiant.", "Vul uw wachtwoord in.": "Indiquez votre mot de passe.", "Gebruikersnaam of wachtwoord klopt niet.": "Identifiant ou mot de passe incorrect.",
    // catalogus
    "bestel vóór 22:00 voor morgen": "commandez avant 22 h pour demain", "Zoek een product…": "Rechercher un produit…", "Alles": "Tout", "Favoriet": "Favori", "Uit favorieten": "Retirer des favoris",
    "uw prijs": "votre prix", "artikel": "article", "artikelen": "articles", "excl. btw": "HTVA", "Bestellen": "Commander",
    "Niets gevonden voor": "Aucun résultat pour", "Nog geen favorieten": "Pas encore de favoris", "Probeer een ander woord of kies een categorie.": "Essayez un autre mot ou choisissez une catégorie.",
    "Tik op de ster bij een product om het hier te zien.": "Touchez l'étoile d'un produit pour le voir ici.", "Tik op de ster bij een product in de catalogus.": "Touchez l'étoile d'un produit dans le catalogue.",
    // winkelmand
    "Categorieën": "Catégories", "Product": "Produit", "Kaliber": "Calibre", "Eenheid": "Unité", "Prijs excl. btw": "Prix HTVA", "Categorie": "Catégorie", "Beschikbaar": "Disponible", "Bestellen per": "Commander par", "0,5 kg": "0,5 kg", "Opmerking bij dit artikel": "Remarque pour cet article", "bv. dikke moot…": "ex. tranche épaisse…", "Nog niets gekozen. Gebruik + bij een product.": "Rien choisi pour l’instant. Utilisez + sur un produit.", "{p} verwijderd": "{p} retiré", "Ongedaan maken": "Annuler", "Verwijderen": "Retirer",
    "Winkelmand": "Panier", "Leegmaken": "Vider", "Opmerking (bv. dikke moot)": "Remarque (ex. tranche épaisse)", "Leverdag": "Jour de livraison", "Andere dag": "Autre jour",
    "Geen levering op zondag. Vóór 22:00 besteld = morgen geleverd.": "Pas de livraison le dimanche. Commandé avant 22 h = livré demain.",
    "Leveradres": "Adresse de livraison", "Adres bij Famo bekend": "Adresse connue de Famo", "Ander adres? Zet het in de opmerking.": "Autre adresse ? Indiquez-la dans la remarque.",
    "Opmerking voor Famo": "Remarque pour Famo", "bv. graag achteraan bellen…": "ex. sonner à l’arrière…", "Totaal excl. btw": "Total HTVA",
   
    "Bestelling plaatsen": "Passer la commande", "Uw winkelmand is leeg": "Votre panier est vide", "Kies producten in de catalogus.": "Choisissez des produits dans le catalogue.", "Naar de catalogus": "Vers le catalogue",
    "Op zondag leveren we niet. Kies een andere dag.": "Nous ne livrons pas le dimanche. Choisissez un autre jour.",
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
    "Bestelling": "Commande", "annuleren?": "annuler ?", "Behouden": "Garder", "Annuleren…": "Annulation…", "geannuleerd": "annulée",
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
    "Wat bestelt u meestal?": "Que commandez-vous habituellement ?", "bv. garnalen 16/20, zalm, tonijn · ongeveer per week…": "ex. crevettes 16/20, saumon, thon · environ par semaine…",
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
    "Verzoek mislukt": "La demande a échoué", "Niets gewijzigd": "Rien n'a été modifié", "Opslaan mislukt": "Enregistrement impossible", "Opslaan mislukt. Probeer opnieuw.": "Enregistrement impossible. Réessayez.", "Algemene voorwaarden": "Conditions générales", "Onze algemene verkoopsvoorwaarden zijn nieuw of gewijzigd. Lees en aanvaard ze om te bestellen.": "Nos conditions générales de vente sont nouvelles ou ont changé. Lisez-les et acceptez-les pour commander.", "Voorwaarden lezen": "Lire les conditions", "Ik aanvaard": "J'accepte", "Later": "Plus tard", "Ik aanvaard de algemene verkoopsvoorwaarden": "J'accepte les conditions générales de vente", "lezen": "lire", "Aanvaard de algemene voorwaarden om verder te gaan.": "Acceptez les conditions générales pour continuer.", "Aanvaard eerst onze algemene voorwaarden.": "Acceptez d'abord nos conditions générales.", "De voorwaarden zijn intussen gewijzigd. Lees de nieuwe versie.": "Les conditions ont changé entre-temps. Lisez la nouvelle version.", "Voorwaarden": "Conditions", "Even geen verbinding met de server. Probeer over een minuut opnieuw.": "Pas de connexion au serveur pour le moment. Réessayez dans une minute.", "Annuleren mislukt. Probeer opnieuw of bel ons.": "Annulation impossible. Réessayez ou appelez-nous.", "Afmelden mislukt. Probeer opnieuw.": "Déconnexion impossible. Réessayez.", "Deze link is verlopen of al gebruikt. Vraag een nieuwe aan.": "Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.", "Wachtwoord opslaan mislukt. Probeer het later opnieuw.": "Enregistrement du mot de passe impossible. Réessayez plus tard.", "Als de gegevens kloppen, ontvangt u binnen enkele minuten een e-mail met een link om een nieuw wachtwoord te kiezen.": "Si les données sont correctes, vous recevrez dans quelques minutes un e-mail avec un lien pour choisir un nouveau mot de passe.", "Verzoek geweigerd: andere herkomst.": "Demande refusée : origine différente.", "Verzoek moet JSON zijn.": "La demande doit être au format JSON.", "Gebruik POST.": "Utilisez POST.", "Gebruik POST. Wachtwoorden horen niet in een URL.": "Utilisez POST. Un mot de passe ne doit pas figurer dans une URL.", "Nogmaals bestellen?": "Commander à nouveau ?", "Annuleren mislukt": "Annulation impossible", "Onbekende actie": "Action inconnue",
    "Vul uw gebruikersnaam en e-mailadres in.": "Indiquez votre identifiant et votre adresse e-mail.", "Te veel aanvragen. Probeer over een uur opnieuw of bel ons.": "Trop de demandes. Réessayez dans une heure ou appelez-nous.",
    "Wachtwoord vernieuwen mislukt. Bel ons.": "Le renouvellement du mot de passe a échoué. Appelez-nous.", "Documentmodule laden mislukt. Controleer de verbinding.": "Impossible de charger le module documents. Vérifiez la connexion.", "Taal van uw documenten": "Langue de vos documents", "Leveringsbonnen en facturen in deze taal.": "Bons de livraison et factures dans cette langue.", "Sessie verlopen. Meld u opnieuw aan.": "Session expirée. Reconnectez-vous.", "Voor vandaag kan niet meer besteld worden. Kies een latere leverdag.": "Il n'est plus possible de commander pour aujourd'hui. Choisissez un jour plus tard.", "Serverfout. Probeer opnieuw.": "Erreur du serveur. Réessayez.", "Opslaan of lezen mislukt. Probeer opnieuw.": "L'enregistrement ou la lecture a échoué. Réessayez.", "Catalogus laden mislukt. Probeer opnieuw.": "Le chargement du catalogue a échoué. Réessayez.", "Aanvraag opslaan mislukt. Bel ons.": "L'enregistrement de la demande a échoué. Appelez-nous.",
    "Aanvraag versturen mislukt. Probeer later opnieuw of bel ons.": "L'envoi de la demande a échoué. Réessayez plus tard ou appelez-nous.",
    "Als de gegevens kloppen, ontvangt u binnen enkele minuten een e-mail met een nieuw wachtwoord.": "Si les données sont correctes, vous recevrez dans quelques minutes un e-mail avec un nouveau mot de passe.",
    // leveringsregels (uit Configuratie) — {t} = deadline, {n} = dagen, {d} = dagenlijst, {m}/{r} = bedragen
   
   
    "Kies een leverdag binnen de komende {n} dagen": "Choisissez un jour de livraison dans les {n} prochains jours",
    "Minimumbestelling {m} excl. btw · nog {r} toe te voegen.": "Commande minimum {m} HTVA · encore {r} à ajouter.", "Minimumbestelling {m} excl. btw": "Commande minimum {m} HTVA",
    "zo": "dim", "ma": "lun", "di": "mar", "wo": "mer", "do": "jeu", "vr": "ven", "za": "sam",
    // beschikbaarheid
    "Nog {n}": "Encore {n}", "Uitverkocht": "Épuisé", "Slechts {n} beschikbaar.": "Seulement {n} disponible(s).",
    // bestelling detail
    "Details": "Détails", "details": "détails", "Artikelen": "Articles", "Verloop": "Suivi", "Klaar": "Préparée", "Geleverd": "Livrée", "Gefactureerd": "Facturée", "Geannuleerd": "Annulée", "Betaald": "Payée", "Reden": "Motif",
    "Factuurnummer": "Numéro de facture", "Gefactureerd op": "Facturée le", "Geleverd op": "Livrée le", "Ontvangen door": "Réceptionné par", "Betaald op": "Payée le", "Uitzondering levering": "Exception de livraison", "Verwacht leveruur": "Heure de livraison prévue", "tussen {van} en {tot}": "entre {van} et {tot}",
    "Creditnota": "Note de crédit", "Uw opmerking": "Votre remarque", "Besteld op": "Commandée le", "Gewenste leverdag": "Jour de livraison souhaité", "Sluiten": "Fermer",
    "Bestelling wijzigen?": "Modifier la commande ?", "Deze bestelling wordt geannuleerd en de artikelen komen in uw winkelmand. Plaats daarna een nieuwe bestelling.": "Cette commande sera annulée et ses articles remis dans votre panier. Passez ensuite une nouvelle commande.",
    "Bestelling geannuleerd · artikelen in de winkelmand": "Commande annulée · articles dans le panier", "Geannuleerd door klant": "Annulée par le client",
    // openstaande facturen
    "Toch opslaan": "Enregistrer quand même", "Privacy": "Confidentialité",
    "incl. btw": "TVAC", "Pro forma": "Pro forma", "Uw facturen en betaalgegevens ontvangt u van onze boekhouding (via Peppol).": "Vos factures et coordonnées de paiement vous sont envoyées par notre comptabilité (via Peppol).",
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
    "Liever bellen? Wij zetten meteen een nieuw wachtwoord klaar.": "Vous préférez appeler ? Nous préparons aussitôt un nouveau mot de passe.",
    // documentvoorbeeld (assets/docs/voorbeeld.js)
    "Documentvoorbeeld": "Aperçu du document", "Afdrukken": "Imprimer", "PDF downloaden": "Télécharger le PDF", "Document laden…": "Chargement du document…",
    "Geen documentinhoud beschikbaar.": "Aucun contenu de document disponible.", "Afdrukken mislukt: voorbeeld niet geladen.": "Impression impossible : aperçu non chargé.", "Afdrukken mislukt. Probeer opnieuw.": "Impression impossible. Réessayez.",
    "Download mislukt: voorbeeld niet geladen.": "Téléchargement impossible : aperçu non chargé.", "PDF genereren…": "Création du PDF…", "PDF gedownload:": "PDF téléchargé :", "PDF downloaden mislukt.": "Le téléchargement du PDF a échoué.",
    "PDF-bibliotheek niet beschikbaar.": "Module PDF indisponible.", "PDF-bibliotheek kon niet worden geladen.": "Le module PDF n'a pas pu être chargé.", "Geen geldige PDF gegenereerd (geen HTML-hernoemd bestand).": "Aucun PDF valide n'a été créé.",
    // pastilles (aria-label) : enkelvoud / meervoud
    "factuur te betalen": "facture à payer", "facturen te betalen": "factures à payer",
    "Opmerking bij": "Remarque pour", "Filter": "Filtre", "Bekijken": "Voir"
  };
  // Servermeldingen met een getal erin : één patroon per melding, vertaald bij het tonen.
  const FR_PAT = [[/^U plaatste vandaag al dezelfde bestelling \(([^)]*)\)\. Nogmaals bestellen\?$/, "Vous avez déjà passé cette même commande aujourd'hui ($1). Commander à nouveau ?"], [/^Na (\d{2}:\d{2}) kan niet meer voor morgen besteld worden\. Kies een latere leverdag\.$/, "Après $1, il n'est plus possible de commander pour demain. Choisissez un jour plus tard."], [/^Kies een leverdag binnen de komende (\d+) dagen$/, "Choisissez un jour de livraison dans les $1 prochains jours"], [/^Minimum bestelling: (€ [\d.,]+) excl\. btw \(nu (€ [\d.,]+)\)$/, "Commande minimum : $1 HTVA (actuellement $2)"]];
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
  // G-19 : un horodatage du serveur (« …T14:20:00Z ») s'affiche à l'heure d'Anvers, comme les lignes du journal
  // écrites par le serveur (Europe/Brussels) — pas à l'heure de l'appareil.
  const ZONED = /T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/i;
  const BXL = (() => { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); } catch (e) { return null; } })();
  const bxl = d => { const o = {}; BXL.formatToParts(d).forEach(x => { o[x.type] = x.value; }); return o; };
  K.isoDay = d => { const x = d instanceof Date ? d : K.parseDate(d); if (!x) return ""; if (BXL && typeof d === "string" && ZONED.test(d)) { const o = bxl(x); return o.year + "-" + o.month + "-" + o.day; } const m = String(x.getMonth() + 1).padStart(2, "0"), day = String(x.getDate()).padStart(2, "0"); return x.getFullYear() + "-" + m + "-" + day; };
  K.today = () => K.isoDay(new Date());
  // Fenêtre de commande (spec 002) : minutes avant l'heure limite et premier jour livrable.
  // Même règle que lib/levering.js : avant la limite = demain, après = après-demain ; puis le premier jour de livraison non fermé.
  const ORDER_DEF = { deadline: "22:00", leverdagen: ["ma", "di", "wo", "do", "vr", "za"], geslotenDagen: [] };
  K.orderWindow = (rules, now) => {
    const r = Object.assign({}, ORDER_DEF, rules || {}), n = now || new Date(), keys = ["zo", "ma", "di", "wo", "do", "vr", "za"];
    const [h, m] = String(r.deadline || "22:00").split(":").map(Number), cut = (h || 0) * 60 + (m || 0), cur = n.getHours() * 60 + n.getMinutes();
    const open = cur < cut, closed = r.geslotenDagen || [], lever = r.leverdagen || ORDER_DEF.leverdagen;
    let d = K.addDays(K.isoDay(n), open ? 1 : 2), i = 0;
    while (!(lever.includes(keys[K.parseDate(d).getDay()]) && !closed.includes(d)) && i++ < 400) d = K.addDays(d, 1);
    return { open, left: open ? cut - cur : 0, first: d, deadline: r.deadline };
  };
  K.addDays = (iso, n) => { const d = K.parseDate(iso) || new Date(); d.setDate(d.getDate() + n); return K.isoDay(d); };
  K.date = v => { const d = K.parseDate(v); if (!d) return "—"; return DAYS[d.getDay()] + " " + d.getDate() + "/" + String(d.getMonth() + 1).padStart(2, "0"); };
  K.dateLong = v => { const d = K.parseDate(v); if (!d) return "—"; return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); };
  K.time = v => { const d = K.parseDate(v); if (!d) return ""; if (BXL && typeof v === "string" && ZONED.test(v)) { const o = bxl(d); return o.hour + ":" + o.minute; } return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  K.relDay = iso => { if (!iso) return "—"; const t = K.today(); if (iso === t) return K.t("Vandaag"); if (iso === K.addDays(t, 1)) return K.t("Morgen"); if (iso === K.addDays(t, -1)) return K.t("Gisteren"); return K.date(iso); };
  K.initials = name => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";

  /* ---------- NL (interne waarden blijven Frans in Airtable) ---------- */
  K.NL = {
    status: { "Reçue": "Ontvangen", "Prête": "Klaar", "Sortie en livraison": "Onderweg", "Facturée": "Geleverd", "Annulée": "Geannuleerd" },
    pay: { "En attente": "Openstaand", "Payé": "Betaald" },
    unit: { "caisse": "kassa", "carton": "doos", "pièce": "stuk", "piece": "stuk", "kg": "kg" },
    move: { "Correction inventaire": "Voorraadcorrectie", "Entrée stock": "Voorraadontvangst", "Retour client": "Klantretour", "Sortie livraison": "Vertrek levering", "Annulation sortie": "Vertrek ongedaan" },
    // Catégories du catalogue Airtable (valeurs françaises historiques) ; repli : valeur brute.
    cat: { "poisson": "Vis", "poissons": "Vis", "coquillages": "Schelpdieren", "coquillage": "Schelpdieren", "crustacés": "Schaaldieren", "crustaces": "Schaaldieren", "crustacé": "Schaaldieren", "céphalopodes": "Inktvis", "fumé": "Gerookt", "surgelé": "Diepvries", "divers": "Algemeen", "général": "Algemeen", "": "Algemeen" }
  };
  // assets/docs/documents.js lit ce même dictionnaire (famoNL) : une seule source (ancien staff-i18n.js).
  global.FAMO_NL = K.NL;
  global.famoNL = {
    status: v => K.NL.status[v] || v,
    pay: v => K.NL.pay[v] || v,
    move: v => K.NL.move[v] || v,
    unit: v => K.NL.unit[String(v || "").toLowerCase()] || v,
    cat: v => K.NL.cat[String(v || "").trim().toLowerCase()] || String(v || "").trim() || "Algemeen",
    lines: t => String(t || "").replace(/\b(caisse|carton|pièce|piece)\b/gi, m => K.NL.unit[m.toLowerCase()] || m)
  };
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
  // Ordre du catalogue : Volgorde (Beheer, glisser-déposer) puis nom ; une catégorie se place
  // selon le plus petit Volgorde de ses produits, puis alphabétiquement.
  const VO = p => (p && p.volgorde != null && Number.isFinite(Number(p.volgorde)) ? Number(p.volgorde) : 1e9);
  K.byVolgorde = (a, b) => VO(a) - VO(b) || String(a.nom || "").localeCompare(String(b.nom || ""), "nl");
  K.catOrder = (products, keyOf) => { const m = new Map(); (products || []).forEach(p => { const k = keyOf(p); m.set(k, Math.min(m.has(k) ? m.get(k) : 1e9, VO(p))); }); return (a, b) => (m.has(a) ? m.get(a) : 1e9) - (m.has(b) ? m.get(b) : 1e9) || String(a).localeCompare(String(b), "nl"); };
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
  // Heure de livraison prévue (D4) : "HH:MM-HH:MM" (normalisé par le serveur, lib/levering.parseSlot) → { van, tot }.
  K.slot = v => { const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(String(v || "")); return m ? { van: m[1], tot: m[2] } : null; };
  // Tournée du chauffeur (A4, Leveringen) : ordre de la route, stop « afgehandeld », prochain stop à faire.
  K.ronde = {
    order: list => (list || []).slice().sort((a, b) => (a.volgorde == null ? Infinity : a.volgorde) - (b.volgorde == null ? Infinity : b.volgorde) || String(a.client || "").localeCompare(String(b.client || ""), "nl")),
    // Livré, en file hors ligne (queued), ou Afwezig / Geweigerd (rien livré, la commande reste onderweg).
    done: (o, queued) => !!(o && (o.statut === "Facturée" || queued || (o.statut === "Sortie en livraison" && (o.uitzondering === "Afwezig" || o.uitzondering === "Geweigerd")))),
    // Prochain stop non fait APRÈS cur (en bouclant), jamais cur lui-même ; sans cur : le premier à faire ; null : rien d'autre.
    next: (route, cur, isDone) => {
      const r = route || [], i = r.findIndex(o => o.id === cur);
      if (i < 0) { const f = r.find(o => !isDone(o)); return f ? f.id : null; }
      for (let k = 1; k < r.length; k++) { const o = r[(i + k) % r.length]; if (!isDone(o)) return o.id; }
      return null;
    }
  };
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
  };  // Hoog contrast (vroege dienst, fel licht in de koelcel, vermoeide ogen) : keuze per toestel. Zonder keuze volgt
  // het toestel de systeeminstelling « meer contrast ». Attribuut op <html> : ui.css herdefinieert enkel de tokens.
  K.contrast = () => {
    const m = K.store.get("famoContrast", "");
    if (m === "hoog" || m === "normaal") return m;
    try { return global.matchMedia && global.matchMedia("(prefers-contrast: more)").matches ? "hoog" : "normaal"; } catch (e) { return "normaal"; }
  };
  K.applyContrast = () => {
    const html = global.document && global.document.documentElement; if (!html || typeof html.removeAttribute !== "function") return;
    const hoog = K.contrast() === "hoog";
    if (hoog) html.setAttribute("data-contrast", "hoog"); else html.removeAttribute("data-contrast");
    (global.document.querySelectorAll ? Array.from(global.document.querySelectorAll("[data-contrasttoggle]")) : []).forEach(b => b.setAttribute("aria-pressed", String(hoog)));
  };
  K.applyContrast();


  // Voert fn uit voor elk item, hoogstens n tegelijk (bv. 3 facturen op betaald) ; geeft [{item, ok, error}] terug.
  K.pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0; const worker = async () => { while (i < items.length) { const k = i++; try { out[k] = { item: items[k], ok: true, value: await fn(items[k]) }; } catch (error) { out[k] = { item: items[k], ok: false, error }; } } }; await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker)); return out; };
  // Wacht tot er even niet getypt wordt (zoekvelden) : één render per pauze, niet per toets.
  K.debounce = (fn, ms) => { let t = 0; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms || 150); }; };

  /* ---------- documentmodule op aanvraag (leveringsbon, factuur, PDF) ---------- */
  // Enkel geladen bij het eerste document dat geopend wordt : scheelt ± 35 kB op elke pagina.
  // DOCS_VER wordt door scripts/assets-version.js bijgewerkt (cache-busting).
  K.DOCS_VER = "8e28e60aa8";
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
    docsLoading = ["/assets/vat.js", "/assets/docs/bedrijf.js", "/assets/docs/documents.js", "/assets/docs/voorbeeld.js"]
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
    catch (err) {
      if (retry && (err.network || err.status >= 500)) { await new Promise(res => setTimeout(res, 800)); return once(); }
      // Garde-fou serveur (prix à 0, ×2, ÷2…) : « toch opslaan ? » puis même requête avec confirmation.
      if (err.status === 409 && err.payload && err.payload.needConfirm && o.body && K.confirm) {
        if (!(await K.confirm({ title: K.t("Bevestigen"), text: K.errText(err.message), yes: K.t("Toch opslaan"), no: K.t("Annuleren") }))) throw err;
        const body = Object.assign(JSON.parse(o.body), { confirm: true, confirmPrice: true });
        o.body = JSON.stringify(body);
        return once();
      }
      throw err;
    }
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
    // Hors ligne (H-12) : une erreur RÉSEAU n'est pas une déconnexion. On garde le dernier rôle connu
    // (≤ 12 h, cet appareil) pour afficher la page et vider la file au retour du réseau ; le serveur
    // reste seul juge de chaque requête.
    async check() {
      try { const d = await K.api("/api/session"); K.staff.role = d.role || null; K.staff.name = K.staff.nameOf(d); K.store.set("famoStaffLast", { role: K.staff.role, name: K.staff.name, at: Date.now() }); return true; }
      catch (e) {
        const last = e.network ? K.store.get("famoStaffLast", null) : null;
        if (last && last.role && Date.now() - last.at < 12 * 3600e3) { K.staff.role = last.role; K.staff.name = last.name || ""; K.staff.offline = true; return true; }
        K.staff.role = null; K.staff.name = ""; if (!e.network) K.store.del("famoStaffLast"); return false;
      }
    },
    async logout() { try { await fetch("/api/session", { method: "DELETE", credentials: "include" }); } catch (e) { /* ignore */ } K.staff.role = null; K.staff.name = ""; K.store.del("famoStaffLast"); },
    isAdmin() { return K.staff.role === "admin"; }
  };
  K.RETURN = "famoReturnTo";
  K.saveReturn = () => K.session.set(K.RETURN, location.pathname + location.search + location.hash);
  K.takeReturn = fb => { const v = K.session.get(K.RETURN, null); K.session.del(K.RETURN); return v && v.startsWith("/") && !v.startsWith("//") ? v : (fb || null); };

  /* ---------- klant sessie : HttpOnly-cookie van de server (famo_klant, IDEAS B3) ---------- */
  // Het sessietoken zit in een cookie die JavaScript niet kan lezen. Dit tabblad bewaart enkel
  // weergavegegevens : gebruikersnaam + id, naam en taal van de zaak. Nooit een token of wachtwoord.
  K.klant = {
    KEY: "famoKlant",
    safe(v) { if (!v || !v.user) return null; const c = v.client || {}; return { user: String(v.user), client: { id: String(c.id || ""), nom: String(c.nom || ""), taal: c.taal === "FR" ? "FR" : "NL" } }; },
    get() { return K.session.get(K.klant.KEY, null); },
    set(v) { const s = K.klant.safe(v); if (s) K.session.set(K.klant.KEY, s); else K.klant.clear(); },
    clear() { K.session.del(K.klant.KEY); },
    // Elke klant-API krijgt de gebruikersnaam mee : de server controleert dat de cookie bij dezelfde login hoort.
    // Overgang (tot 31/10/2026) : een token van vóór de cookie gaat nog mee tot het eerste geslaagde verzoek
    // (de server zet dan de cookie) ; forgetToken() wist het daarna.
    creds() { const c = K.klant.get(); if (!c || !c.user) return null; return c.token ? { user: c.user, token: c.token } : { user: c.user }; },
    forgetToken() { const c = K.klant.get(); if (c && (c.token || c.pw)) K.klant.set(c); }
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
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>',
    contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/>',
    table: '<path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14"/>',
    board: '<path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z"/>',
    cal: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    group: '<path d="M4 6h16M4 12h10M4 18h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><path d="M6 14h12v7H6z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    map: '<path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    cart: '<path d="M3 4h2l2.4 11h11.2L21 7H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="18" cy="19.5" r="1.3"/>',
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
  c.field = (label, inputHtml, opts) => { const o = Object.assign({}, opts); if (!o.for) { const m = /<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/.exec(inputHtml || ""); if (m) o.for = m[1]; } return '<div class="field"' + (o.id ? ' id="' + o.id + '"' : "") + '><label' + (o.for ? ' for="' + o.for + '"' : "") + '>' + K.esc(label) + (o.req ? ' <span class="t-danger">*</span>' : "") + '</label>' + inputHtml + (o.hint ? '<span class="quiet fs-12">' + K.esc(o.hint) + '</span>' : "") + '<span class="err" data-err></span></div>'; };
  c.input = (id, opts) => { const o = opts || {}; return '<input class="input' + (o.cls ? " " + o.cls : "") + '" id="' + id + '" type="' + (o.type || "text") + '"' + (o.value != null ? ' value="' + K.esc(o.value) + '"' : "") + (o.placeholder ? ' placeholder="' + K.esc(o.placeholder) + '"' : "") + (o.attrs || "") + '>'; };
  c.empty = (title, text, action) => '<div class="state"><div class="ic">' + K.icon("orders") + '</div><b>' + K.esc(title) + '</b>' + (text ? '<p class="sub maxw-320 ws-normal">' + K.esc(text) + '</p>' : "") + (action || "") + '</div>';
  c.error = (text, retry) => '<div class="notice err" role="alert"><i>!</i><div><b>' + K.t("Er ging iets mis.") + '</b> ' + K.esc(text) + (retry ? ' <button type="button" class="linkbtn" data-retry>' + K.t("Opnieuw proberen") + '</button>' : "") + '</div></div>';
  c.warn = html => '<div class="notice warn"><i>!</i><div>' + html + '</div></div>';
  c.ok = html => '<div class="notice ok"><i>✓</i><div>' + html + '</div></div>';
  c.skeleton = n => '<div class="d-flex f-col gap-10">' + Array.from({ length: n || 3 }, () => '<div class="card card-b d-flex f-col gap-8"><div class="sk w-40p"></div><div class="sk w-70p"></div><div class="sk w-55p"></div></div>').join("") + '</div>';
  // INT-12 : un chiffre avec « href » est un lien vers sa source.
  c.kpi = (n, label, warn, href) => '<' + (href ? 'a href="' + K.esc(href) + '"' : "span") + ' class="kpi' + (warn ? " warn" : "") + (href ? " kpi-link" : "") + '"><b>' + K.esc(n) + '</b> ' + K.esc(label) + '</' + (href ? "a" : "span") + '>';
  c.avatar = name => '<span class="avatar">' + K.esc(K.initials(name)) + '</span>';
  // opts.big → 44px (personnel, gants) ; opts.label → nom accessible. aria-pressed suit K.setOn.
  c.check = (on, attrs, opts) => { const o = opts || {}; return '<button type="button" class="check' + (on ? " on" : "") + (o.big ? " big" : "") + '" ' + (attrs || "") + (o.label ? ' aria-label="' + K.esc(o.label) + '"' : "") + ' aria-pressed="' + (on ? "true" : "false") + '">' + K.icon("check") + '</button>'; };
  // Interrupteur visuel + état accessible en une fois (check, toggle, favoriet).
  K.setOn = (el, on) => { if (!el) return; el.classList.toggle("on", !!on); el.setAttribute("aria-pressed", on ? "true" : "false"); const line = el.closest(".line"); if (line) line.classList.toggle("ok", !!on); };
  // ACC-06 / G-06 : l'état « choisi » (classe .on) est toujours exposé, quel que soit le code qui la pose :
  // choix .opt, filtres .cats, langue → aria-pressed ; vues .views et onglets .tabs → aria-current="page".
  // Un groupe .opt / .cats devient role=group, nommé par le libellé de son champ (ou aria-label).
  let stateUid = 0, statePending = false;
  K.syncStates = root => {
    const r = root || document;
    if (!r.querySelectorAll) return;
    r.querySelectorAll(".opt, .cats, .lang").forEach(g => {
      if (!g.hasAttribute("role")) g.setAttribute("role", "group");
      if (g.hasAttribute("aria-label") || g.hasAttribute("aria-labelledby")) return;
      const f = g.closest(".field"), l = f && f.querySelector(":scope > label, :scope > .flabel");
      if (l) { if (!l.id) l.id = "kGrp" + (++stateUid); g.setAttribute("aria-labelledby", l.id); }
      else if (g.dataset.label) g.setAttribute("aria-label", g.dataset.label);
    });
    r.querySelectorAll(".opt > button, .cats > button, .lang > button, .kside > button").forEach(b => b.setAttribute("aria-pressed", b.classList.contains("on") ? "true" : "false"));
    r.querySelectorAll(".views > a, .views > button, .tabs > a").forEach(a => { if (a.classList.contains("on")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  };
  if (doc && doc.addEventListener && typeof global.MutationObserver === "function") {
    const start = () => new global.MutationObserver(() => { if (statePending) return; statePending = true; Promise.resolve().then(() => { statePending = false; K.syncStates(doc); }); })
      .observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    if (doc.body) start(); else doc.addEventListener("DOMContentLoaded", start);
  }
  // opts.name : nom du produit dans chaque libellé (« Meer: Zalmfilet ») — sinon dix « Meer » identiques (G-27).
  c.stepper = (id, value, opts) => { const o = opts || {}, n = o.name ? ": " + o.name : ""; return '<div class="stepper' + (Number(value) > 0 ? " on" : "") + '" data-stepper="' + id + '"><button type="button" data-dec aria-label="' + K.esc(K.t("Minder") + n) + '">−</button><input type="number" inputmode="decimal" min="0" step="' + (o.step || 1) + '" value="' + K.esc(value) + '" aria-label="' + K.esc(K.t("Aantal") + n) + '"><button type="button" data-inc aria-label="' + K.esc(K.t("Meer") + n) + '">+</button></div>'; };
  K.c = c;

  /* ---------- toast / dialoog / paneel ---------- */
  // Zone permanente (role=status) : un message inséré dans une zone déjà montée est lu par les lecteurs d'écran.
  function toasts() { let t = document.querySelector(".toasts"); if (!t) { t = document.createElement("div"); t.className = "toasts"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); } return t; }
  if (doc && typeof doc.createElement === "function" && doc.addEventListener) { if (doc.body) toasts(); else doc.addEventListener("DOMContentLoaded", toasts); }
  // Lien d'évitement : les pages routent sur le « # » ; on déplace donc le focus sans toucher à l'URL.
  if (doc && doc.addEventListener) doc.addEventListener("click", e => {
    const a = e.target && e.target.closest && e.target.closest("a.skip"); if (!a) return;
    e.preventDefault(); const t = doc.querySelector(a.getAttribute("href")); if (t) { t.focus(); if (t.scrollIntoView) t.scrollIntoView({ block: "start" }); }
  });
  // G-18 : une erreur reste affichée jusqu'à ce qu'on la ferme (×), annoncée tout de suite (role=alert) ; la même
  // erreur ne s'empile pas. Un message qui a le focus ou le pointeur ne disparaît pas sous la main (2.2.1).
  K.toast = (msg, opts) => {
    const o = opts || {}, err = o.kind === "err", box = toasts(), text = String(msg == null ? "" : msg);
    if (err) { K.$$(".toast.err", box).filter(x => x.dataset.msg === text).forEach(x => x.remove()); const old = K.$$(".toast.err", box); if (old.length >= 3) old[0].remove(); }
    const el = document.createElement("div"); el.className = "toast" + (o.kind ? " " + o.kind : ""); el.dataset.msg = text;
    if (err) el.setAttribute("role", "alert");
    el.innerHTML = '<span>' + K.esc(text) + '</span>' + (o.action ? '<button type="button" data-toast-act>' + K.esc(o.action) + '</button>' : "") + (err ? '<button type="button" class="toast-x" data-toast-x aria-label="' + K.esc(K.t("Sluiten")) + '">×</button>' : "");
    const remove = () => { if (!el.isConnected) return; const had = el.contains(document.activeElement); el.remove(); if (had) K.restoreFocus([], null); };
    if (o.action && o.onAction) el.querySelector("[data-toast-act]").onclick = () => { remove(); o.onAction(); };
    if (err) el.querySelector("[data-toast-x]").onclick = remove;
    box.appendChild(el);
    if (!err) { const later = () => { if (!el.isConnected) return; if (el.contains(document.activeElement) || el.matches(":hover")) { setTimeout(later, 2000); return; } remove(); }; setTimeout(later, o.ms || (o.action ? 6000 : 4500)); }
    return el;
  };
  // Dialogen en panelen (motif APG « dialog modal ») : Tab reste dedans, Échap ne ferme que le plus haut,
  // et le focus revient à l'élément qui l'a ouvert.
  const modals = [];
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  // Clés pour retrouver un élément après un re-rendu, de la plus précise à la plus large (CLA-10) :
  // id ; tous ses attributs data-* (data-act + data-id = même action sur la MÊME commande) ; puis le bouton
  // principal de la même commande (son action a changé : Klaarzetten → Vertrekt) ; un lien par son href ;
  // un bouton sans attribut propre (−/+ d'un stepper) par son hôte. Jamais « le premier data-act venu ».
  const DATA_SKIP = /^data-label$/;
  const q1 = (name, v) => "[" + name + '="' + CSS.escape(v) + '"]';
  const keysOf = el => {
    if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) return [];
    if (el.id) return ["#" + CSS.escape(el.id)];
    const data = Array.from(el.attributes || []).filter(a => a.name.indexOf("data-") === 0 && !DATA_SKIP.test(a.name));
    const own = data.map(a => a.value ? q1(a.name, a.value) : "[" + a.name + "]").join(""), tag = el.tagName.toLowerCase();
    const href = el.getAttribute("href"), c0 = Array.from(el.classList || []).find(c => !/^(on|open|ok|is-.*)$/.test(c)), cls = c0 ? "." + CSS.escape(c0) : "";
    if (data.some(a => a.value)) {
      const out = [tag + own], id = el.getAttribute("data-id");
      if (id && data.length > 1) out.push(".btn-p" + q1("data-id", id), q1("data-id", id));
      return out;
    }
    const host = el.parentElement && el.parentElement.closest("[data-stepper],[data-id],[data-i],[data-q],[data-oid]");
    const hk = host ? keysOf(host)[0] : null;
    if (hk) return [hk + " " + tag + own];
    if (href && href !== "#") return [tag + cls + q1("href", href)];
    return [];
  };
  const usable = x => x && !x.disabled && x.isConnected && (x.offsetParent !== null || (x.getClientRects && x.getClientRects().length > 0));
  const findKeys = keys => { for (const k of keys || []) { try { const t = Array.from(document.querySelectorAll(k)).find(usable); if (t) return t; } catch (e) { /* sélecteur invalide */ } } return null; };
  const lost = () => { const a = document.activeElement; return !a || a === document.body || !a.isConnected; };
  // G-03 : après un changement de vue, le focus va au titre (h1, tabindex=-1) : le lecteur d'écran annonce
  // la nouvelle page et Tab repart de là. Jamais pendant une saisie, jamais sous une fenêtre ouverte.
  // opts.scroll : ramener le titre à l'écran s'il est hors de la vue ou sous la barre du haut (changement d'onglet) ;
  // sinon aucun défilement (le portail client restaure lui-même la position de chaque vue).
  K.focusTitle = (root, sel, opts) => {
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return false;
    if (modals.length || document.querySelector(".famo-doc-preview:not(.hidden)")) return false;
    const scope = root || document.querySelector("main") || document;
    const h = Array.from(scope.querySelectorAll(sel || "h1")).find(usable);
    if (!h) return false;
    if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
    const r = h.getBoundingClientRect(), hidden = r.top < 64 || r.bottom > (global.innerHeight || 800);
    try { h.focus({ preventScroll: true }); } catch (e) { return false; }
    if (opts && opts.scroll && hidden && h.scrollIntoView) h.scrollIntoView({ block: "start" }); // tient compte de scroll-padding-top
    return document.activeElement === h;
  };
  // Focus perdu (élément redessiné) : on retrouve l'élément par ses clés, sinon le titre de la page.
  K.restoreFocus = (keys, root) => { if (!lost()) return; const t = findKeys(keys); if (t) { try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } if (lost()) K.focusTitle(root); };
  K.focusKeys = keysOf;
  // Redessine une zone sans perdre le focus : fn() peut être asynchrone.
  K.keep = (root, fn) => {
    const a = document.activeElement, inside = !!(a && a !== document.body && root && root.contains(a)), keys = inside ? keysOf(a) : null;
    const r = fn();
    if (inside) { const fix = () => K.restoreFocus(keys, root); if (r && typeof r.then === "function") r.then(fix, fix); else fix(); }
    return r;
  };
  // Le focus revient au déclencheur ; s'il a disparu (liste redessinée après l'enregistrement), à son remplaçant,
  // sinon (la ligne a quitté la liste) au titre de la page.
  function refocus(back, keys) {
    const tryIt = last => { if (!lost()) return; const t = back && back.isConnected && !back.disabled ? back : findKeys(keys); if (t && t.focus) { try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } if (last && lost()) K.focusTitle(); };
    if (back && back.isConnected && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    [60, 400, 1200].forEach((ms, i) => setTimeout(() => tryIt(i === 2), ms));
  }
  // Dernier élément focalisé (hors body) : un bouton désactivé pendant le chargement (K.busy) perd le focus,
  // la fenêtre qui s'ouvre ensuite doit quand même rendre le focus à ce bouton.
  let lastFocused = null;
  if (doc && doc.addEventListener) doc.addEventListener("focusin", e => { if (e.target && e.target !== doc.body && e.target.nodeType === 1) lastFocused = e.target; });
  function modal(el, onEsc) {
    const a = document.activeElement, back = a && a !== document.body ? a : lastFocused, backKey = keysOf(back), entry = { el };
    modals.push(entry);
    const key = e => {
      if (modals[modals.length - 1] !== entry) return;
      if (e.key === "Escape") { e.preventDefault(); onEsc(); return; }
      if (e.key !== "Tab") return;
      const f = Array.from(el.querySelectorAll(FOCUSABLE)).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], cur = document.activeElement, inside = el.contains(cur);
      if (e.shiftKey && (cur === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      const i = modals.indexOf(entry); if (i >= 0) modals.splice(i, 1);
      refocus(back, backKey);
    };
  }
  // Fenêtre modale « maison » (aperçu des documents…) : même piège Tab, même Échap que K.panel.
  // K.modal(el, onEsc) → fonction release() à appeler à la fermeture (rend le focus au déclencheur).
  K.modal = modal;
  K.isTopModal = el => !!modals.length && modals[modals.length - 1].el === el;
  // Clavier physique (souris/trackpad) : focus au premier champ ; tactile : pas de clavier qui surgit.
  const finePointer = () => !!(global.matchMedia && global.matchMedia("(pointer: fine)").matches);
  K.confirm = (opts) => new Promise(resolve => {
    const o = typeof opts === "string" ? { text: opts } : (opts || {});
    const d = document.createElement("div"); d.className = "dialog"; d.setAttribute("role", o.danger ? "alertdialog" : "dialog"); d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-labelledby", "kDialogTitle"); d.setAttribute("aria-describedby", "kDialogText");
    d.innerHTML = '<div class="box"><b class="fs-15" id="kDialogTitle">' + K.esc(o.title || K.t("Bevestigen")) + '</b><span class="muted" id="kDialogText">' + K.esc(o.text || "") + '</span>' + (o.html || "") + '<div class="d-flex gap-8 jc-end mt-4"><button type="button" class="btn btn-o btn-sm" data-no>' + K.esc(o.no || K.t("Annuleren")) + '</button><button type="button" class="btn btn-sm ' + (o.danger ? "btn-danger" : "btn-p") + '" data-yes>' + K.esc(o.yes || K.t("Bevestigen")) + '</button></div></div>';
    let release = null;
    const done = v => { d.remove(); if (release) release(); resolve(v); };
    d.querySelector("[data-no]").onclick = () => done(false); d.querySelector("[data-yes]").onclick = () => done(true); d.onclick = e => { if (e.target === d) done(false); };
    release = modal(d, () => done(false)); document.body.appendChild(d);
    // Action destructive : le focus va sur « Annuler », jamais sur le bouton qui détruit.
    d.querySelector(o.danger ? "[data-no]" : "[data-yes]").focus();
  });
  K.prompt = (opts) => new Promise(resolve => {
    const o = opts || {};
    const d = document.createElement("div"); d.className = "dialog"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.setAttribute("aria-labelledby", "kPromptTitle");
    d.innerHTML = '<div class="box"><b class="fs-15" id="kPromptTitle">' + K.esc(o.title || "") + '</b>' + (o.text ? '<span class="muted">' + K.esc(o.text) + '</span>' : "") + '<input class="input" id="kPrompt" aria-labelledby="kPromptTitle" value="' + K.esc(o.value || "") + '" placeholder="' + K.esc(o.placeholder || "") + '"><div class="d-flex gap-8 jc-end"><button type="button" class="btn btn-o btn-sm" data-no>' + K.t("Annuleren") + '</button><button type="button" class="btn btn-p btn-sm" data-yes>' + K.esc(o.yes || K.t("Bevestigen")) + '</button></div></div>';
    const inp = d.querySelector("#kPrompt");
    let release = null;
    const done = v => { d.remove(); if (release) release(); resolve(v); };
    d.querySelector("[data-no]").onclick = () => done(null); d.querySelector("[data-yes]").onclick = () => done(inp.value); inp.addEventListener("keydown", e => { if (e.key === "Enter") done(inp.value); });
    release = modal(d, () => done(null)); document.body.appendChild(d); inp.focus();
  });
  K.panel = (opts) => {
    const o = opts || {};
    const s = document.createElement("div"); s.className = "scrim"; s.setAttribute("role", "dialog"); s.setAttribute("aria-modal", "true");
    s.setAttribute("aria-labelledby", "kPanelTitle");
    s.innerHTML = '<div class="panel" tabindex="-1"' + (o.width ? ' style="width:min(' + o.width + ',100%)"' : "") + '><div class="panel-h"><div><h2 class="h2" id="kPanelTitle">' + K.esc(o.title || "") + '</h2>' + (o.sub ? '<p class="sub">' + K.esc(o.sub) + '</p>' : "") + '</div><button type="button" class="ibtn" data-close aria-label="' + K.t("Sluiten") + '">' + K.icon("x") + '</button></div><div class="panel-b">' + (o.body || "") + '</div>' + (o.footer ? '<div class="panel-f">' + o.footer + '</div>' : "") + '</div>';
    let release = null, open = true, dirty = false, asking = false;
    const close = () => { if (!open) return; open = false; dirtyPanels.delete(s); s.remove(); if (release) release(); document.body.style.overflow = ""; if (o.onClose) o.onClose(); };
    // Fermeture demandée par la personne (×, Échap, clic à côté, Annuleren) : si le formulaire a changé, on demande d'abord.
    const tryClose = async () => {
      if (!dirty || o.guard === false) return close();
      if (asking) return; asking = true;
      const ok = await K.confirm({ title: K.t("Wijzigingen niet bewaard"), text: K.t("U heeft iets gewijzigd in dit venster. Sluiten zonder te bewaren?"), yes: K.t("Sluiten zonder bewaren"), no: K.t("Verder bewerken"), danger: true });
      asking = false; if (ok) close();
    };
    const markDirty = e => { if (e.target && e.target.closest && e.target.closest(".panel-b") && !e.target.closest("[data-no-dirty]")) { dirty = true; dirtyPanels.add(s); } };
    s.addEventListener("input", markDirty); s.addEventListener("change", markDirty);
    s.addEventListener("click", e => { if (dirty && e.target.closest && e.target.closest("[data-cancel]")) { e.preventDefault(); e.stopImmediatePropagation(); tryClose(); } }, true);
    s.querySelector("[data-close]").onclick = tryClose; s.onclick = e => { if (e.target === s) tryClose(); };
    // FOR-02 / G-17 : Entrée dans un champ d'une ligne = le bouton principal du panneau (comme un formulaire).
    // Pas dans un champ multiligne, une liste, une quantité (−/+) ; un champ qui gère Entrée lui-même l'emporte.
    s.addEventListener("keydown", e => {
      if (e.key !== "Enter" || e.defaultPrevented || e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (!t || !t.matches || !t.matches(".panel-b input") || t.matches("[type=checkbox],[type=radio],[type=file],[type=button],[type=submit],[type=reset],[list],[data-no-submit]") || t.closest(".stepper")) return;
      const btn = s.querySelector(".panel-f .btn-p:not(:disabled), .panel-f .btn-danger:not(:disabled)");
      if (btn) { e.preventDefault(); btn.click(); }
    });
    // G-18 : un texte d'état dans le pied du panneau (« 2 van 3 gecontroleerd ») est une région live.
    K.$$(".panel-f > span, .panel-f > div:not(:has(button))", s).forEach(x => { if (!x.hasAttribute("role")) { x.setAttribute("role", "status"); x.setAttribute("aria-live", "polite"); } });
    release = modal(s, tryClose); document.body.style.overflow = "hidden"; document.body.appendChild(s);
    // G-04 : premier élément focalisable VISIBLE du panneau (un champ caché, ex. #vSearch, ne compte pas) ;
    // au tactile, le panneau lui-même (pas de clavier virtuel qui surgit).
    const first = finePointer() && Array.from(s.querySelectorAll(".panel-b " + FOCUSABLE.split(",").join(",.panel-b "))).find(usable);
    try { (first || s.querySelector(".panel")).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    return { el: s, close, tryClose, markClean: () => { dirty = false; dirtyPanels.delete(s); }, body: s.querySelector(".panel-b"), footer: s.querySelector(".panel-f") };
  };
  // Quitter la page avec un panneau modifié ouvert : le navigateur demande confirmation.
  const dirtyPanels = new Set();
  if (global.addEventListener) global.addEventListener("beforeunload", e => { if (dirtyPanels.size) { e.preventDefault(); e.returnValue = ""; } });
  if (doc && doc.addEventListener) doc.addEventListener("keydown", e => {
    // FOR-02 : ⌘/Ctrl+Entrée dans un champ multiligne = bouton principal de la zone.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target && e.target.tagName === "TEXTAREA") {
      const zone = e.target.closest(".scrim,form,.card,.mcard,.kc-side") || doc.body;
      const btn = zone.querySelector(".panel-f .btn-p:not(:disabled), button[type=submit]:not(:disabled), .btn-p:not(:disabled)");
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }
    // CLA-07 : « ? » ouvre la liste des raccourcis (jamais pendant la saisie).
    if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey && !modals.length) {
      const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      e.preventDefault(); K.shortcutsHelp();
    }
  });
  // Raccourcis : liste commune, complétée par les pages (K.shortcuts.push([touche, action])).
  K.shortcuts = [["/", "Zoeken"], ["?", "Sneltoetsen tonen"], ["Esc", "Venster sluiten"], ["⌘/Ctrl + Enter", "Bewaren vanuit een tekstvak"], ["Tab / Shift + Tab", "Volgende / vorige knop"]];
  K.shortcutsHelp = () => {
    const d = document.createElement("div"); d.className = "dialog"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-labelledby", "kKeysTitle");
    d.innerHTML = '<div class="box"><b class="fs-15" id="kKeysTitle">' + K.t("Sneltoetsen") + '</b><dl class="keys">' + K.shortcuts.map(([k, l]) => '<div><dt><kbd>' + K.esc(k) + '</kbd></dt><dd>' + K.esc(K.t(l)) + '</dd></div>').join("") + '</dl><div class="d-flex jc-end"><button type="button" class="btn btn-o btn-sm" data-no>' + K.t("Sluiten") + '</button></div></div>';
    let release = null; const done = () => { d.remove(); if (release) release(); };
    d.querySelector("[data-no]").onclick = done; d.onclick = e => { if (e.target === d) done(); };
    release = modal(d, done); document.body.appendChild(d); d.querySelector("[data-no]").focus();
  };
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
  // FOR-05 : message lié au champ (aria-describedby) ; après une série de setErr, le focus va à la première erreur.
  let errFocus = 0;
  K.setErr = (fieldId, msg) => {
    const f = document.getElementById(fieldId); if (!f) return;
    const e = f.querySelector("[data-err]"); if (e) { e.textContent = msg || ""; if (!e.id) e.id = fieldId + "-err"; }
    const i = f.querySelector(".input");
    if (i) { if (msg) { i.setAttribute("aria-invalid", "true"); if (e) i.setAttribute("aria-describedby", e.id); } else i.removeAttribute("aria-invalid"); }
    if (msg && !errFocus && typeof document.querySelector === "function") errFocus = setTimeout(() => {
      errFocus = 0;
      try { const a = document.activeElement; if (a && a.getAttribute && a.getAttribute("aria-invalid") === "true") return; const first = document.querySelector('[aria-invalid="true"]'); if (first && first.focus) first.focus(); } catch (err) { /* ignore */ }
    }, 0);
  };
  // Bouton en cours : désactivé, aria-busy, largeur gelée (pas de saut de mise en page), libellé « …ing… ».
  K.busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.label = btn.textContent; btn.style.minWidth = btn.offsetWidth ? btn.offsetWidth + "px" : ""; btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = label || K.t("Bezig…"); } else { btn.disabled = false; btn.removeAttribute("aria-busy"); btn.style.minWidth = ""; if (btn.dataset.label) btn.textContent = btn.dataset.label; } };
  K.hashParams = () => { const h = location.hash.replace(/^#\/?/, ""); const [path, q] = h.split("?"); const p = {}; new URLSearchParams(q || "").forEach((v, k) => { p[k] = v; }); return { path: path || "", params: p }; };
  K.go = (path, params) => { const q = params ? "?" + new URLSearchParams(params).toString() : ""; location.hash = "#/" + path + q; };

  /* ---------- personeel/beheer shell ---------- */
  // [clé de pastille, URL, libellé, icône] : la clé reste l'ancien nom de fichier (mémoire « vu » des pastilles inchangée).
  const NAV_DAILY = [["bestellingen.html", "/team/bestellingen", "Bestellingen", "orders"], ["entrepot.html", "/team/magazijn", "Magazijn", "box"], ["leveringen.html", "/team/leveringen", "Leveringen", "truck"]];
  // Invoeren en Voorraad staan open voor het personeel (bestelling ingeven aan de telefoon, voorraad
  // tellen) ; enkel verwijderen in Voorraad en Beheer blijven voor de beheerder (server : adminOk).
  // Pastilles de la navigation (« 3 » à côté de Bestellingen…) : { "bestellingen.html": 3, … }.
  // Les derniers chiffres restent en session : la page suivante les affiche avant d'avoir rechargé.
  // [enkelvoud, meervoud] : « 1 onbetaalde factuur », « 2 onbetaalde facturen ».
  const BADGE_TXT = { "bestellingen.html": ["nieuw te bevestigen"], "entrepot.html": ["klaar te zetten (vandaag en morgen)"], "leveringen.html": ["vandaag te leveren"], "documenten.html": ["onbetaalde factuur", "onbetaalde facturen"], "stock.html": ["onder de drempel"], "beheer.html": ["nieuwe aanvraag", "nieuwe aanvragen"], "aanvragen": ["nieuwe aanvraag", "nieuwe aanvragen"], "bestellingen": ["factuur te betalen", "facturen te betalen"] };
  K.plural = (n, one, many) => n + " " + (Number(n) === 1 ? one : (many || one));
  // Pastilles lues (spec 001) : chaque valeur est un nombre ou une liste d'identifiants.
  // Mode par appareil : « nieuw » (défaut) = pas encore vus ici ; « alles » = tout ce qui reste ; « uit » = rien.
  // Vu = la personne est sur la page de la pastille (lien actif), onglet visible.
  const BADGE_MODES = ["nieuw", "alles", "uit"];
  K.badgeMode = () => { const m = K.store.get("famoBadgeMode", "nieuw"); return BADGE_MODES.includes(m) ? m : "nieuw"; };
  // Fonction pure : { n affiché, seen mémoire à garder }.
  K.badgeView = (value, mode, seen, here) => {
    const m = BADGE_MODES.includes(mode) ? mode : "nieuw";
    if (Array.isArray(value)) {
      const ids = value.map(String);
      const old = new Set(seen && Array.isArray(seen.ids) ? seen.ids.map(String) : []);
      const next = { ids: here ? ids : ids.filter(id => old.has(id)) };
      return { n: m === "uit" ? 0 : m === "alles" ? ids.length : (here ? 0 : ids.filter(id => !old.has(id)).length), seen: next };
    }
    const n = Math.max(0, Number(value) || 0), prev = seen && typeof seen.n === "number" && Number.isFinite(seen.n) ? seen.n : 0;
    const base = here ? n : Math.min(prev, n);
    return { n: m === "uit" ? 0 : m === "alles" ? n : Math.max(0, n - base), seen: { n: base } };
  };
  K.setBadges = map => {
    const all = Object.assign(K.session.get("famoBadges", {}) || {}, map || {});
    if (map && Object.keys(map).length) K.session.set("famoBadges", all);
    const mode = K.badgeMode(), seenAll = K.store.get("famoBadgeSeen", {}) || {};
    const visible = !(typeof document !== "undefined" && document.visibilityState === "hidden");
    let changed = false;
    K.$$("[data-badge]").forEach(el => {
      const key = el.dataset.badge, a = el.closest && el.closest("a");
      const here = visible && !!a && (a.getAttribute("aria-current") === "page" || a.classList.contains("on"));
      const v = K.badgeView(all[key], mode, seenAll[key], here);
      if (all[key] != null && JSON.stringify(v.seen) !== JSON.stringify(seenAll[key])) { seenAll[key] = v.seen; changed = true; }
      const n = v.n, txt = BADGE_TXT[key] || [""];
      el.hidden = !n; el.textContent = n > 99 ? "99+" : String(n);
      el.setAttribute("aria-label", K.plural(n, K.t(txt[0]), K.t(txt[1] || txt[0])) + (mode === "nieuw" ? " · " + K.t("nieuw sinds uw laatste bezoek") : ""));
    });
    if (changed) K.store.set("famoBadgeSeen", seenAll);
  };
  // Keuze per toestel : drie knoppen (zelfde vorm als de taalkeuze), meteen toegepast.
  K.badgeSwitch = () => '<div class="lang" role="group" aria-label="' + K.t("Tellers in het menu") + '">' + [["nieuw", "Nieuw"], ["alles", "Alles"], ["uit", "Uit"]].map(([m, l]) => '<button type="button" data-badgemode="' + m + '" aria-pressed="' + (K.badgeMode() === m) + '"' + (K.badgeMode() === m ? ' class="on"' : "") + '>' + K.t(l) + '</button>').join("") + '</div>';
  K.badgeHelp = () => K.t("Nieuw: verdwijnt zodra u de pagina opent. Alles: blijft zolang er iets te doen is. Uit: geen tellers.");
  if (doc && typeof doc.addEventListener === "function") doc.addEventListener("click", e => {
    const b = e.target && e.target.closest && e.target.closest("[data-badgemode]"); if (!b) return;
    K.store.set("famoBadgeMode", b.dataset.badgemode);
    K.$$("[data-badgemode]").forEach(x => { const on = x.dataset.badgemode === b.dataset.badgemode; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
    K.setBadges({});
  });
  const NAV_ADMIN = [["invoer.html", "/team/invoeren", "Invoeren", "plus"], ["documenten.html", "/team/documenten", "Documenten", "doc"], ["beheer.html", "/beheer", "Beheer", "settings"]];
  const NAV_STAFF_MORE = [["invoer.html", "/team/invoeren", "Invoeren", "plus"], ["documenten.html", "/team/documenten", "Documenten", "doc"]];
  K.shell = function (opts) {
    const o = opts || {};
    K.lang = "nl"; // personeel en beheer werken altijd in het Nederlands, ook op een toestel dat het klantportaal in het Frans toont
    if (doc && doc.documentElement) doc.documentElement.lang = "nl";
    const here = (location.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/").toLowerCase(); // URL propre (/team/magazijn), avec ou sans .html
    const admin = K.staff.isAdmin();
    const portal = o.portal || (admin ? "beheer" : "personeel");
    document.body.classList.remove("portal-klant", "portal-personeel", "portal-beheer");
    document.body.classList.add("portal-" + portal);
    const link = ([key, href, label, icon]) => '<a class="nav' + (here === href ? " on" : "") + '" href="' + href + '"' + (here === href ? ' aria-current="page"' : "") + '>' + K.icon(icon) + '<span>' + label + '</span><b class="nbadge" data-badge="' + key + '" hidden></b></a>';
    const more = admin ? NAV_ADMIN : NAV_STAFF_MORE;
    // Sessie GET geeft de naam van de medewerker (persoonlijke PIN) : die staat bij de rol ; zonder naam blijft de rol alleen.
    const role = admin ? "Beheerder" : "Personeel", who = K.staff.name || role;
    const side = '<nav class="side" data-famo-nav aria-label="Hoofdnavigatie"><a class="brand" href="/team/bestellingen"><span class="logo" aria-hidden="true"></span><span><b>FAMO Seafood</b><small>' + (admin ? "Beheer" : "Teamportaal") + '</small></span></a>' +
      '<div class="navlbl">Dagelijks</div>' + NAV_DAILY.map(link).join("") +
      '<div class="navlbl">' + (admin ? "Beheer" : "Meer") + '</div>' + more.map(link).join("") +
      link(["stock.html", "/team/voorraad", "Voorraad", "stock"]) +
      '<div class="spacer"></div><a class="nav" href="/">' + K.icon("ext") + '<span>Klantportaal</span></a>' +
      '<div class="user">' + c.avatar(who) + '<div class="utxt fs-125 minw-0"><b class="ellipsis fw-500 d-block">' + K.esc(who) + '</b>' + (K.staff.name ? '<small class="quiet fs-11 d-block">' + role + '</small>' : "") + '<div><button type="button" class="linkbtn fs-11" data-logout>Uitloggen</button></div></div></div></nav>';
    // Uitloggen aussi dans la topbar (44px) : sur tablette et téléphone la sidebar cache le lien.
    // Systeemstatus (beheer.html#status) enkel voor de beheerder : het personeel mag die pagina niet openen.
    const top = '<div class="topbar"><label class="search">' + K.icon("search") + '<input id="globalSearch" aria-label="Zoeken" placeholder="' + K.esc(o.searchPlaceholder || "Zoek bestelling, klant of artikel…") + '" autocomplete="off"></label><span class="spacer"></span>' + (o.topRight || "") + '<button type="button" class="ibtn" data-contrasttoggle aria-pressed="' + (K.contrast() === "hoog") + '" title="Hoog contrast" aria-label="Hoog contrast">' + K.icon("contrast") + '</button><button type="button" class="ibtn" data-badgesettings title="Tellers in het menu" aria-label="Tellers in het menu">' + K.icon("bell") + '</button>' + (admin ? '<a class="ibtn" href="/beheer#status" title="Systeemstatus" aria-label="Systeemstatus">' + K.icon("help") + '</a>' : "") + '<span title="' + K.esc(who + (K.staff.name ? " · " + role : "")) + '">' + c.avatar(who) + '</span><button type="button" class="ibtn" data-logout title="Uitloggen" aria-label="Uitloggen">' + K.icon("logout") + '</button></div>';
    const app = document.getElementById("app");
    app.innerHTML = '<a class="skip" href="#page">Naar de inhoud</a><div class="shell">' + side + '<div class="main">' + top + '<main id="page" tabindex="-1"></main></div></div>';
    K.setBadges({}); // derniers compteurs connus (session) tout de suite, sans attendre les données
    app.querySelector("[data-contrasttoggle]").onclick = () => { K.store.set("famoContrast", K.contrast() === "hoog" ? "normaal" : "hoog"); K.applyContrast(); K.toast(K.contrast() === "hoog" ? "Hoog contrast aan" : "Hoog contrast uit"); };
    app.querySelector("[data-badgesettings]").onclick = () => K.panel({ title: "Tellers in het menu", sub: "Voor dit toestel", width: "420px", body: '<div class="badgeset"><p class="muted">' + K.badgeHelp() + '</p>' + K.badgeSwitch() + '</div>' });
    // G-20 : au téléphone la navigation défile à l'horizontale — un fondu montre qu'il reste des onglets,
    // et l'onglet de la page est ramené dans la vue.
    const sideEl = app.querySelector(".side");
    const edge = () => { const max = sideEl.scrollWidth - sideEl.clientWidth; sideEl.classList.toggle("more-r", max - sideEl.scrollLeft > 4); sideEl.classList.toggle("more-l", sideEl.scrollLeft > 4); };
    const onNav = sideEl.querySelector(".nav.on"); if (onNav && sideEl.scrollWidth > sideEl.clientWidth) sideEl.scrollLeft = Math.max(0, onNav.offsetLeft - (sideEl.clientWidth - onNav.offsetWidth) / 2);
    sideEl.addEventListener("scroll", edge, { passive: true }); if (global.addEventListener) global.addEventListener("resize", edge); edge();
    K.on(app, "click", "[data-logout]", async e => { e.preventDefault(); await K.staff.logout(); location.href = "/team/aanmelden"; });
    globalSearch(app);
    return document.getElementById("page");
  };

  // Zoekveld bovenaan (elke personeelspagina) : zoekt in alle bestellingen op referentie, klant,
  // artikel of factuurnummer ; ↑↓ kiezen, Enter opent, Esc sluit. « / » springt naar het veld.
  function globalSearch(app) {
    const input = app.querySelector("#globalSearch"); if (!input) return;
    const box = input.closest(".search"); box.style.position = "relative";
    const list = document.createElement("div"); list.className = "gs-list"; list.setAttribute("role", "listbox"); list.hidden = true; box.appendChild(list);
    input.setAttribute("role", "combobox"); input.setAttribute("aria-expanded", "false"); input.setAttribute("aria-autocomplete", "list");
    let hits = [], cur = 0;
    const source = () => (global.S && global.S.load ? global.S.load().then(S => S.orders) : K.api("/api/allorders").then(d => d.orders || []));
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); };
    const open = o => { location.href = "/team/bestelling?id=" + encodeURIComponent(o.id); };
    const paint = () => {
      list.innerHTML = hits.length ? hits.map((o, i) => '<a role="option" href="/team/bestelling?id=' + encodeURIComponent(o.id) + '" class="gs-item' + (i === cur ? " on" : "") + '"' + (i === cur ? ' aria-selected="true"' : "") + '><b>' + K.esc(o.client || "—") + '</b><span class="quiet mono">' + K.esc(o.ref || "") + (o.factuurnummer ? " · " + K.esc(o.factuurnummer) : "") + '</span><span class="quiet">' + K.esc(K.relDay(o.dateLiv || o.date || "")) + " · " + K.esc(K.status(o.statut)) + '</span></a>').join("") : '<div class="gs-empty quiet">Geen bestelling gevonden</div>';
      list.hidden = false; input.setAttribute("aria-expanded", "true");
    };
    const search = K.debounce(async () => {
      const q = input.value.trim().toLowerCase(); if (q.length < 2) { close(); return; }
      let orders = []; try { orders = await source(); } catch (e) { return; }
      if (input.value.trim().toLowerCase() !== q) return;
      const words = q.split(/\s+/);
      hits = orders.filter(o => { const hay = [o.ref, o.client, o.factuurnummer, o.lignes, o.notes].join(" ").toLowerCase(); return words.every(w => hay.includes(w)); })
        .sort((a, b) => String(b.dateLiv || b.date || "").localeCompare(String(a.dateLiv || a.date || ""))).slice(0, 8);
      cur = 0; paint();
    }, 150);
    input.addEventListener("input", search);
    input.addEventListener("focus", () => { if (input.value.trim().length >= 2) search(); });
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") { close(); input.blur(); return; }
      if (list.hidden || !hits.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); cur = (cur + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length; paint(); }
      else if (e.key === "Enter") { e.preventDefault(); open(hits[cur]); }
    });
    document.addEventListener("click", e => { if (!box.contains(e.target)) close(); });
    document.addEventListener("keydown", e => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault(); input.focus(); input.select();
    });
  }
  // Aanmeldpagina voor personeel/beheer op een pagina zelf (inline), met terugkeer.
  K.requireStaff = async function (opts) {
    const o = opts || {};
    const ok = await K.staff.check();
    if (!ok) { K.saveReturn(); location.replace(o.admin ? "/beheer/aanmelden" : "/team/aanmelden"); return false; }
    if (o.admin && !K.staff.isAdmin()) { K.saveReturn(); location.replace("/beheer/aanmelden?denied=1"); return false; }
    if (K.staff.offline) { K.toast("Geen netwerk · laatst geladen gegevens; bevestigingen gaan in de wachtrij", { kind: "err" }); global.addEventListener("online", () => { K.staff.offline = false; }, { once: true }); }
    document.addEventListener("famo:session-expired", () => { K.saveReturn(); K.toast("Sessie verlopen. Meld u opnieuw aan.", { kind: "err" }); setTimeout(() => location.replace(o.admin ? "/beheer/aanmelden" : "/team/aanmelden"), 1200); }, { once: true });
    return true;
  };
  K.klantTabs = active => {
    const tabs = [["catalogus", "Catalogus", "list"], ["bestellingen", "Bestellingen", "orders"], ["favorieten", "Favorieten", "star"], ["account", "Account", "user"]];
    return '<nav class="mtabs" aria-label="' + K.t("Hoofdnavigatie") + '">' + tabs.map(([k, l, i]) => '<a class="mtab' + (active === k ? " on" : "") + '" href="#/' + k + '"' + (active === k ? ' aria-current="page"' : "") + '>' + K.icon(i) + K.t(l) + (k === "bestellingen" ? '<b class="nbadge" data-badge="bestellingen" hidden></b>' : "") + '</a>').join("") + '</nav>';
  };
  global.K = K;
})(window);
