/* global module */
// « Nieuw » in Beheer : bij elke wijziging een korte uitleg voor Mohsen, in eenvoudige taal.
// Wat is er veranderd, en wat moet u (eventueel) doen. Nieuwste bovenaan.
// REGEL : elke nieuwe spec (specs/NNN-…) krijgt hier een notitie, anders faalt test/nieuws.test.js.
(function (root) {
  "use strict";
  var items = [
    {
      id: "meerdere-categorieen", datum: "2026-10-31", spec: "039",
      titel: "Een product in meerdere categorieën",
      wat: "Een product kan nu in meer dan één categorie staan, bijvoorbeeld tonijn bij Vis en ook bij Sushi. Open het product en tik bij „Ook tonen in” de andere categorieën aan. De eerste categorie blijft de hoofdcategorie: die bepaalt de volgorde en de rapporten.",
      doen: [
        { tekst: "Open een product en tik bij „Ook tonen in” de extra categorieën aan.", link: "#/producten", label: "Naar Producten" }
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
