"use strict";
// Testgegevens voor de lokale nabootsing: dezelfde vorm als de echte base.
function isoDaysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }

function seed(db) {
  db.reset();
  const [cfg] = db.create("Configuratie", [{
    "Bedrijfsnaam": "Famo Trading BV", "Adres": "Jezusstraat 34", "Postcode en plaats": "2000 Antwerpen, België", "BTW-nummer": "BE 0788.705.713",
    "Telefoon": "03 000 00 00", "E-mail": "info@famotrading.be", "IBAN": "BE68539007547034", "BIC": "GKCCBEBB", "BTW-tarief": 6,
    "Betalingsvoorwaarden": "Betaalbaar binnen 14 dagen", "Leveringsvoorwaarden": "Controleer de goederen bij ontvangst. Klachten over verse producten melden wij graag dezelfde dag.",
    "Bestellingen e-mail": "bestellingen@famotrading.be", "Besteldeadline": "22:00", "Leverdagen": "ma,di,wo,do,vr,za"
  }]);
  const products = db.create("Catalogue", [
    { "Produit": "Saumon frais", "Prix de base": 18.5, "Unité": "kg", "Catégorie": "Poisson", "Actif": true },
    { "Produit": "Cabillaud", "Prix de base": 22, "Unité": "kg", "Catégorie": "Poisson", "Actif": true },
    { "Produit": "Zeebaars heel 400-600", "Prix de base": 14.9, "Unité": "kg", "Catégorie": "Poisson", "Actif": true },
    { "Produit": "Moules (caisse)", "Prix de base": 28, "Unité": "caisse", "Catégorie": "Coquillages", "Actif": true },
    { "Produit": "Crevettes grises", "Prix de base": 35, "Unité": "kg", "Catégorie": "Crustacés", "Actif": true },
    { "Produit": "VANNAMEI GARNALEN 26-30", "Prix de base": 12.9, "Unité": "pièce", "Catégorie": "Algemeen", "Actif": true },
    { "Produit": "VANNAMEI GARNALEN 16-20 EP", "Prix de base": 13.9, "Unité": "pièce", "Catégorie": "Algemeen", "Actif": true },
    { "Produit": "VANNAMEI GARNALEN GEPELD 16/20", "Prix de base": 12.9, "Unité": "pièce", "Catégorie": "Algemeen", "Actif": true },
    { "Produit": "VANNAMEI GARNALEN GEPELD 26/30", "Prix de base": 11, "Unité": "pièce", "Catégorie": "Algemeen", "Actif": true },
    { "Produit": "Scampi", "Prix de base": 15, "Unité": "caisse", "Catégorie": "Algemeen", "Actif": true },
    { "Produit": "Oesters Zeeuwse creuse nr. 3", "Prix de base": 0.85, "Unité": "pièce", "Catégorie": "Coquillages", "Actif": true },
    { "Produit": "Tonijn sashimi blok", "Prix de base": 29.9, "Unité": "kg", "Catégorie": "Poisson", "Actif": true },
    { "Produit": "Vis (oud artikel)", "Prix de base": 3, "Unité": "caisse", "Catégorie": "Algemeen", "Actif": false }
  ]);
  const P = (name) => products.find((p) => p.fields["Produit"] === name);
  const clients = db.create("Clients", [
    { "Nom": "Aloha Poke Bowls", "Email": "keuken@alohapoke.example", "Téléphone": "+32 489 33 99 96", "Lieu de livraison": "Jezusstraat 32\n2000 Antwerpen", "Gebruikersnaam": "aloha", "Wachtwoord": "welkom123", "BTW-nummer": "BE 0123.456.789", "Klantnummer": "K-001", "Infos générales": "Levering via de achterdeur, bellen bij aankomst.", "Articles habituels": "Zalm, vannamei 26-30, tonijn" },
    { "Nom": "Brasserie De Kaai", "Email": "chef@dekaai.example", "Téléphone": "+32 3 123 45 67", "Lieu de livraison": "Waalsekaai 10\n2000 Antwerpen", "Gebruikersnaam": "dekaai", "Wachtwoord": "kaai2026!", "BTW-nummer": "BE 0987.654.321", "Klantnummer": "K-002" },
    { "Nom": "Vishandel Nora", "Téléphone": "+32 3 765 43 21", "Lieu de livraison": "Turnhoutsebaan 200\n2140 Borgerhout", "Gebruikersnaam": "nora", "Wachtwoord": "nora-vis-1", "Klantnummer": "K-003" }
  ]);
  const C = (name) => clients.find((c) => c.fields["Nom"] === name);
  db.create("Prix négociés", [
    { "Client": [C("Aloha Poke Bowls").id], "Produit": [P("Saumon frais").id], "Prix négocié": 16 },
    { "Client": [C("Aloha Poke Bowls").id], "Produit": [P("VANNAMEI GARNALEN 26-30").id], "Prix négocié": 10 },
    { "Client": [C("Aloha Poke Bowls").id], "Produit": [P("Tonijn sashimi blok").id], "Prix négocié": 27.5 },
    { "Client": [C("Brasserie De Kaai").id], "Produit": [P("Moules (caisse)").id], "Prix négocié": 26 }
  ]);
  db.create("Commandes", [
    { "Référence": "B-260828-ZQ4R", "Date": isoDaysAgo(5), "Lignes (produits / quantités)": "Saumon frais × 3 kg [€16.00]\nVANNAMEI GARNALEN 26-30 × 4 pièce [€10.00] (gepeld graag)", "Statut": "Facturée", "Statut paiement": "Payé", "Total": 88, "Client": [C("Aloha Poke Bowls").id], "Date livraison souhaitée": isoDaysAgo(4), "Factuurnummer": "FA-2026-0001", "Préparation validée": true, "Préparée le": new Date(Date.now() - 4 * 86400000).toISOString(), "Livrée le": new Date(Date.now() - 4 * 86400000 + 3600000).toISOString(), "Facturée le": new Date(Date.now() - 4 * 86400000 + 3600000).toISOString(), "Réceptionné par": "Kenji", "Livraison confirmée": true },
    { "Référence": "B-260830-M7PX", "Date": isoDaysAgo(3), "Lignes (produits / quantités)": "Tonijn sashimi blok × 2 kg [€27.50]\nSaumon frais × 2 kg [€16.00]", "Statut": "Facturée", "Statut paiement": "En attente", "Total": 87, "Client": [C("Aloha Poke Bowls").id], "Date livraison souhaitée": isoDaysAgo(2), "Factuurnummer": "FA-2026-0002", "Préparation validée": true, "Préparée le": new Date(Date.now() - 2 * 86400000).toISOString(), "Livrée le": new Date(Date.now() - 2 * 86400000 + 3600000).toISOString(), "Facturée le": new Date(Date.now() - 2 * 86400000 + 3600000).toISOString(), "Réceptionné par": "Kenji", "Livraison confirmée": true },
    { "Référence": "CMD-1788122390015", "Date": isoDaysAgo(2), "Lignes (produits / quantités)": "Moules (caisse) × 3 caisse [€26.00]\nCrevettes grises × 1.5 kg [€35.00]", "Statut": "Prête", "Statut paiement": "En attente", "Total": 130.5, "Notes": "[Telefoon] Graag vóór 9u", "Client": [C("Brasserie De Kaai").id], "Date livraison souhaitée": isoDaysAgo(0), "Préparation validée": true, "Préparée le": new Date().toISOString() },
    { "Référence": "B-260901-K2WD", "Date": isoDaysAgo(1), "Lignes (produits / quantités)": "Saumon frais × 4 kg [€16.00]\nVANNAMEI GARNALEN 26-30 × 6 pièce [€10.00]\nOesters Zeeuwse creuse nr. 3 × 48 pièce [€0.85]", "Statut": "Reçue", "Statut paiement": "En attente", "Total": 164.8, "Notes": "Zalm graag in filets.", "Client": [C("Aloha Poke Bowls").id], "Date livraison souhaitée": isoDaysAgo(0) },
    { "Référence": "B-260901-H8TN", "Date": isoDaysAgo(1), "Lignes (produits / quantités)": "Cabillaud × 5 kg [€22.00]\nZeebaars heel 400-600 × 6 kg [€14.90]", "Statut": "Reçue", "Statut paiement": "En attente", "Total": 199.4, "Client": [C("Vishandel Nora").id], "Date livraison souhaitée": isoDaysAgo(-1) }
  ]);
  db.create("Aanvragen", [
    { "Bedrijfsnaam": "Sushi Sato", "Contactpersoon": "Yuki Sato", "Email": "yuki@sushisato.example", "Telefoon": "+32 470 11 22 33", "Adres": "Meir 12, 2000 Antwerpen", "Notities": "Wij zoeken een vaste leverancier voor sashimi-kwaliteit.", "Status": "Nieuw" },
    { "Bedrijfsnaam": "AYBI group", "Contactpersoon": "Bilal Kaddouri", "Email": "aybi@example.com", "Telefoon": "+32 489 33 99 96", "Adres": "Rue Constant Deraedt 10", "Status": "Verwerkt" }
  ]);
  db.save();
  return { configId: cfg.id, products, clients };
}

module.exports = { seed };
