/* global module */
// « Nieuw » in Beheer : bij elke wijziging een korte uitleg voor Mohsen, in eenvoudige taal.
// Wat is er veranderd, en wat moet u (eventueel) doen. Nieuwste bovenaan.
// REGEL : elke nieuwe spec (specs/NNN-…) krijgt hier een notitie, anders faalt test/nieuws.test.js.
(function (root) {
  "use strict";
  var items = [
    {
      id: "nieuwe-startpagina", datum: "2026-10-24", spec: "037",
      titel: "Nieuwe startpagina van famoseafood.be",
      wat: "De startpagina is vernieuwd: een balk die toont hoe lang klanten nog kunnen bestellen en wanneer er geleverd wordt, zes soorten vis als illustratie, een voorbeeld van de visfiche en uw contactgegevens. Aanmelden en Klant worden blijven zoals ze waren.",
      doen: [
        { tekst: "Kijk of de zes soorten (zalm, tonijn, garnalen, inktvis, octopus, sint-jakobsvrucht) passen bij wat u verkoopt. Zo niet, zeg welke het moeten zijn." },
        { tekst: "Vul uw WhatsApp-nummer in bij Bedrijfsgegevens: dan verschijnt de knop WhatsApp op de startpagina.", link: "#/bedrijf", label: "Naar Bedrijfsgegevens" },
        { tekst: "Een vast leveruur (bijvoorbeeld tussen 6 en 8 uur) tonen we pas als u het zeker kunt beloven. Laat het ons weten." }
      ]
    },
    {
      id: "bestellen-x30", datum: "2026-10-24", spec: "036",
      titel: "Uw klanten bestellen hun gewone bestelling met één tik",
      wat: "Bovenaan Bestellen ziet de klant „Zoals elke maandag”: zijn gewone bestelling, met de prijzen van vandaag. Eén tik en ze staat erin. Hij ziet ook hoeveel tijd er nog is. Hij past zijn bestelling zelf aan tot de deadline. Een tweede bestelling voor dezelfde dag komt bij de eerste.",
      doen: [
        { tekst: "Kijk op de proefversie hoe het scherm Bestellen eruitziet, op uw telefoon en op de computer. Is de nieuwe letter voor de titels goed voor u? Zeg het aan Bilal." },
        { tekst: "Het groene „Rauw OK” staat alleen bij een product als u in de visfiche „Bestemd om rauw te eten” aanzet én kiest hoe de vis diepgevroren werd. Controleer dat voor uw sushi- en pokevis.", link: "#/producten", label: "Naar Producten" },
        { tekst: "Er wordt nog geen leveruur getoond (bijvoorbeeld tussen 6 en 8 uur). Wilt u dat? Zeg aan Bilal welk uur altijd klopt." },
        { tekst: "Kijk bij een bestelling naar Correcties: daar ziet u wat de klant zelf veranderde of toevoegde." }
      ]
    },
    {
      id: "visfiche-en-loten", datum: "2026-10-24", spec: "035",
      titel: "Visfiche per product en meer gegevens per lot",
      wat: "Bij elk product kunt u nu de Latijnse naam, de herkomst, de staat (vers, diepgevroren of ontdooid) en de allergenen invullen. Uw klanten zien dat in hun catalogus en op de leveringsbon. Bij elk lot vult u ook de vangstdatum en het nummer van de vangstreis in.",
      doen: [
        { tekst: "Open elk product, klik op „Visfiche” en neem over wat op het etiket of het document van de leverancier staat. Niet zeker? Laat het leeg.", link: "#/producten", label: "Naar Producten" },
        { tekst: "Vink bij elk product de allergenen aan: vis, schaaldieren of weekdieren, en wat er nog in zit (bijvoorbeeld in een saus)." },
        { tekst: "Verkoopt u vis om rauw te eten (sushi, poke)? Zet „Bestemd om rauw te eten” aan en kies hoe de leverancier de vis diepvroor." },
        { tekst: "Bij elk nieuw lot: vul de vangstdatum, het nummer van de vangstreis of het kweekbedrijf en het netto gewicht in.", link: "/team/lots", label: "Naar Loten" },
        { tekst: "Kies bij het klaarzetten altijd het lot. Vraagt een klant of het FAVV iets? Klik bij Loten op „Geleverde loten per klant”." }
      ]
    },
    {
      id: "boekhouder-en-qr", datum: "2026-10-24", spec: "034",
      titel: "Facturen voor de boekhouder, per maand",
      wat: "Bij Beheer staat nu Boekhouder: kies een maand en u ziet alle facturen en creditnota's, met een bestand om aan uw boekhouder te geven. U noteert zelf wanneer u ze gestuurd hebt. Het portaal stuurt niets. Maakt het portaal ooit zelf de facturen, dan krijgt elke factuur een QR-code om te betalen.",
      doen: [
        { tekst: "Vraag aan uw boekhouder: kan Billtobox de facturen van het portaal inlezen, of wil hij ze anders ontvangen?" },
        { tekst: "Open Boekhouder, kies vorige maand en geef de lijst aan uw boekhouder. Klik daarna op Gestuurd vandaag.", link: "/beheer/boekhouder", label: "Naar Boekhouder" },
        { tekst: "Staat er Onvolledig bij een factuur? Vul dan bij de klant het btw-nummer en het adres in.", link: "#/klanten", label: "Naar Klanten" }
      ]
    },
    {
      id: "vindbaar-op-google", datum: "2026-10-24", spec: "033",
      titel: "Beter te vinden op Google",
      wat: "Google kan nu de tekst van uw website lezen: wie u bent, wat u verkoopt, waar u levert en hoe klanten u bereiken. Stuurt u een link naar uw website op WhatsApp, dan ziet men uw naam, een korte tekst en uw logo. De website heeft ook een eigen link in het Frans.",
      doen: [
        { tekst: "Maak met uw eigen Google-account een Search Console aan voor famoseafood.be. Bilal helpt u, het duurt een kwartier." },
        { tekst: "Maak een gratis Google Bedrijfsprofiel voor FAMO Seafood, met uw telefoon, uw website en de gemeenten waar u levert." },
        { tekst: "Wilt u dat iedereen uw producten ziet op de pagina Ons aanbod? Zeg het aan Bilal: hij zet ze dan aan." },
        { tekst: "Verandert uw telefoon, e-mail of adres? Pas het aan bij Bedrijf en zeg het ook aan Bilal: het staat nu ook vast op de website.", link: "#/bedrijf", label: "Naar Bedrijf" }
      ]
    },
    {
      id: "contact-en-colofon", datum: "2026-10-24", spec: "032",
      titel: "Uw gegevens en contact onderaan elke pagina",
      wat: "Onderaan de website staan nu uw bedrijfsgegevens, uw e-mail, uw telefoon en een knop WhatsApp. Er is ook een nieuwe pagina Colofon. De privacytekst is aangevuld.",
      doen: [
        { tekst: "Vul bij Bedrijf uw juridische naam (Famo Trading), rechtsvorm (BV) en RPR in.", link: "#/bedrijf", label: "Naar Bedrijf" },
        { tekst: "Vul uw WhatsApp-nummer en uw FAVV-nummer in. Leeg laten mag: dan verschijnt er niets." },
        { tekst: "Lees de pagina Colofon en de privacytekst na.", link: "/colofon", label: "Naar Colofon" }
      ]
    },
    {
      id: "backup-zonder-fotos", datum: "2026-10-17", spec: "031",
      titel: "De nachtelijke back-up werkt weer",
      wat: "Sinds 10 oktober kwam de back-up niet meer per e-mail: het bestand was te groot door de foto's. Nu krijgt u elke nacht weer een e-mail met al uw gegevens (bestellingen, klanten, facturen, producten). De foto's zitten er niet meer in.",
      doen: [
        { tekst: "Bewaar de e-mail „FAMO back-up” van elke nacht in een map buiten uw mailbox." },
        { tekst: "Eén keer per maand: maak zelf een volledige back-up met foto's (knop „Back-up maken”).", link: "#/status", label: "Naar Systeemstatus" }
      ]
    },
    {
      id: "volgend-factuurnummer", datum: "2026-10-16", spec: "030",
      titel: "Zelf het volgende factuurnummer kiezen",
      wat: "U kiest met welk nummer de volgende factuur begint, bijvoorbeeld 25. Daarna gaan de nummers vanzelf in volgorde verder: 25, 26, 27. Bestaan er al hogere nummers die nooit verstuurd zijn, dan worden die gewist.",
      doen: [
        { tekst: "Ga naar Beheer, Systeemstatus, kaart „Testperiode afsluiten”. Klik op „Voorbeeld tonen” en maak een back-up.", link: "#/status", label: "Naar Systeemstatus" },
        { tekst: "Vul 25 in bij „Volgend factuurnummer instellen” en klik op „Instellen”. Lees de waarschuwing en typ wat er gevraagd wordt." },
        { tekst: "Vraag aan uw boekhouder of dat nummer klopt." }
      ]
    },
    {
      id: "nieuw-lijst", datum: "2026-10-10", spec: "029",
      titel: "Nieuw: deze lijst",
      wat: "Bij elke verandering in het portaal ziet u hier wat er nieuw is en wat u moet doen. Klik op „Gezien” als u het gelezen hebt.",
      doen: []
    },
    {
      id: "gewicht", datum: "2026-10-10", spec: "028",
      titel: "Kaliber heet nu Gewicht",
      wat: "Bij elk product staat nu „Gewicht” in plaats van „Kaliber”. Uw klanten zien dat gewicht in hun catalogus.",
      doen: [
        { tekst: "Open elk product en vul het gewicht in, bijvoorbeeld „500 g” of „1 kg”.", link: "#/producten", label: "Naar Producten" },
        { tekst: "Staat er nog een oud kaliber (zoals 16/20)? Vervang het door het gewicht." }
      ]
    },
    {
      id: "categorie", datum: "2026-10-10", spec: "028",
      titel: "Een categorie in één keer hernoemen",
      wat: "Bij Producten staat naast elke categorie een knop „Hernoemen”. Alle producten van die categorie krijgen meteen de nieuwe naam.",
      doen: [
        { tekst: "Geef elke groep een duidelijke naam, bijvoorbeeld Garnalen, Vis, Schelpdieren.", link: "#/producten", label: "Naar Producten" }
      ]
    },
    {
      id: "annuleren", datum: "2026-10-10", spec: "028",
      titel: "Wie mag een bestelling annuleren?",
      wat: "Alleen u (Beheer) kunt nog een bestelling annuleren. Uw personeel niet meer. De klant kan zelf annuleren zolang de bestelwagen niet vertrokken is.",
      doen: []
    },
    {
      id: "website", datum: "2026-10-17", spec: "027",
      titel: "Uw aanbod op internet: nog verborgen",
      wat: "De pagina met uw producten en prijzen is klaar, maar staat nog uit. Niemand kan ze zien. Nieuwe klanten zien enkel de startpagina en de knop „Klant worden”.",
      doen: [
        { tekst: "Zet nu al een mooie foto en de juiste basisprijs bij elk product. Zo is alles klaar als we de pagina later openzetten.", link: "#/producten", label: "Naar Producten" },
        { tekst: "Wilt u de pagina openzetten? Vraag het aan wie uw portaal bouwt." }
      ]
    }
  ];
  items.sort(function (a, b) { return a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0; });
  function ongelezen(gezien) {
    var g = {}; (gezien || []).forEach(function (id) { g[id] = 1; });
    return items.filter(function (n) { return !g[n.id]; });
  }
  var api = { items: items, ongelezen: ongelezen };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FamoNieuws = api;
})(typeof window !== "undefined" ? window : this);
