"use strict";
// Testgegevens voor de lokale nabootsing: dezelfde vorm als de echte base.
const zlib = require("zlib");
function isoDaysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }

// ---- Photos de démo (spec 018) : PNG dessinés ici (zlib intégré), sans fichier ni dépendance ----
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// px(x, y) -> [r, g, b] ; renvoie le PNG en base64.
function png(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// Een « vis » (ellips + staart) op ijs ; view 0 = heel, 1 = close-up, 2 = drie stuks op een rij.
function demoFoto(body, view) {
  const S = 320, ice = [228, 235, 235], ice2 = [205, 218, 220], dark = mix(body, [14, 34, 41], 0.45);
  const fish = (x, y, cx, cy, s) => {
    const dx = (x - cx) / s, dy = (y - cy) / s;
    if (dx * dx / 1.0 + dy * dy / 0.16 <= 1) return (dx - 0.55) ** 2 + (dy + 0.08) ** 2 < 0.004 ? [14, 34, 41] : dy > 0.12 ? mix(body, [255, 255, 255], 0.35) : body;
    if (dx < -0.9 && dx > -1.45 && Math.abs(dy) < (-0.9 - dx) * 0.9) return dark;
    return null;
  };
  return png(S, S, (x, y) => {
    const bg = mix(ice, ice2, (x + y) / (2 * S)), shade = ((x * 7 + y * 13) % 29 === 0) ? mix(bg, [255, 255, 255], 0.5) : bg;
    if (view === 0) return fish(x, y, 190, 165, 110) || shade;
    if (view === 1) return fish(x, y, 120, 175, 260) || shade;
    return fish(x, y, 170, 80, 70) || fish(x, y, 170, 165, 70) || fish(x, y, 170, 250, 70) || shade;
  });
}
const DEMO_FOTOS = { "Saumon frais": [[240, 128, 96], 3], "Cabillaud": [[214, 206, 190], 2], "Zeebaars heel 400-600": [[150, 164, 170], 1], "VANNAMEI GARNALEN GEPELD 16/20": [[238, 150, 110], 3], "VANNAMEI GARNALEN GEPELD 26/30": [[236, 160, 120], 2], "Tonijn sashimi blok": [[176, 48, 56], 1] };
function addDemoFotos(db, products) {
  const patch = [];
  for (const p of products) {
    const d = DEMO_FOTOS[p.fields["Produit"]]; if (!d) continue;
    const slug = p.fields["Produit"].toLowerCase().replace(/[^a-z0-9]+/g, "-");
    patch.push({ id: p.id, fields: { "Foto": Array.from({ length: d[1] }, (_, v) => db.addFile(p.id, "image/png", slug + "-" + (v + 1) + ".png", demoFoto(d[0], v))) } });
  }
  db.update("Catalogue", patch, false);
}

// opts.fotos : photos de démo (scripts/dev.js). Les tests n'en ont pas : ils recopient data vers
// SQLite sans les fichiers.
function seed(db, opts) {
  db.reset();
  const [cfg] = db.create("Configuratie", [{
    "Bedrijfsnaam": "FAMO Seafood", "Adres": "Jezusstraat 34", "Postcode en plaats": "2000 Antwerpen, België", "BTW-nummer": "BE 0788.705.713",
    "Telefoon": "03 000 00 00", "E-mail": "info@famotrading.be", "IBAN": "BE68539007547034", "BIC": "GKCCBEBB", "BTW-tarief": 6,
    "Betalingsvoorwaarden": "Betaalbaar binnen 14 dagen", "Leveringsvoorwaarden": "Controleer de goederen bij ontvangst. Klachten over verse producten melden wij graag dezelfde dag.",
    "Bestellingen e-mail": "bestellingen@famotrading.be", "Besteldeadline": "22:00", "Leverdagen": "ma,di,wo,do,vr,za",
    // Bestellen per e-mail (specs/020) : demo met automatisch aanmaken aan (scripts/mail-inbound-test.js).
    "Bestel-e-mailadres": "bestel@orders.famoseafood.be", "Mailbestellingen automatisch": true
  }]);
  const products = db.create("Catalogue", [
    { "Produit": "Saumon frais", "Prix de base": 18.5, "Unité": "kg", "Catégorie": "Poisson", "Actif": true },
    { "Produit": "Cabillaud", "Prix de base": 22, "Unité": "kg", "Catégorie": "Poisson", "Actif": true },
    { "Produit": "Zeebaars heel 400-600", "Prix de base": 14.9, "Unité": "kg", "Catégorie": "Poisson", "Actif": true },
    { "Produit": "Moules (caisse)", "Prix de base": 28, "Unité": "caisse", "Catégorie": "Coquillages", "Actif": true },
    { "Produit": "Crevettes grises", "Prix de base": 35, "Unité": "kg", "Catégorie": "Crustacés", "Actif": true },
    { "Produit": "VANNAMEI GARNALEN 26-30", "Prix de base": 12.9, "Unité": "pièce", "Catégorie": "Algemeen", "Actif": true, "Kaliber": "26/30" },
    { "Produit": "VANNAMEI GARNALEN 16-20 EP", "Prix de base": 13.9, "Unité": "pièce", "Catégorie": "Algemeen", "Actif": true, "Kaliber": "16/20" },
    { "Produit": "VANNAMEI GARNALEN GEPELD 16/20", "Prix de base": 12.9, "Unité": "pièce", "Catégorie": "Algemeen", "Actif": true, "Kaliber": "16/20" },
    { "Produit": "VANNAMEI GARNALEN GEPELD 26/30", "Prix de base": 11, "Unité": "pièce", "Catégorie": "Algemeen", "Actif": true, "Kaliber": "26/30" },
    { "Produit": "Scampi", "Prix de base": 15, "Unité": "caisse", "Catégorie": "Algemeen", "Actif": true },
    { "Produit": "Oesters Zeeuwse creuse nr. 3", "Prix de base": 0.85, "Unité": "pièce", "Catégorie": "Coquillages", "Actif": true },
    { "Produit": "Tonijn sashimi blok", "Prix de base": 29.9, "Unité": "kg", "Catégorie": "Poisson", "Actif": true },
    { "Produit": "Vis (oud artikel)", "Prix de base": 3, "Unité": "caisse", "Catégorie": "Algemeen", "Actif": false }
  ]);
  if (opts && opts.fotos) addDemoFotos(db, products);
  const P = (name) => products.find((p) => p.fields["Produit"] === name);
  db.create("Stock", products.filter((p) => p.fields["Actif"]).map((p, i) => ({ "Produit": p.fields["Produit"], "Quantité disponible": [12, 8, 6, 3, 1, 20, 14, 9, 7, 5, 200, 4][i] || 5, "Seuil bas": 4 })));
  const clients = db.create("Clients", [
    { "Nom": "Aloha Poke Bowls", "Email": "keuken@alohapoke.example", "Téléphone": "+32 3 000 00 01", "Lieu de livraison": "Jezusstraat 32\n2000 Antwerpen", "Gebruikersnaam": "aloha", "Wachtwoord": "welkom123", "BTW-nummer": "BE 0123.456.789", "Klantnummer": "K-001", "Infos générales": "Levering via de achterdeur, bellen bij aankomst.", "Articles habituels": "Zalm, vannamei 26-30, tonijn" },
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
    { "Référence": "CMD-1788122390015", "Date": isoDaysAgo(2), "Lignes (produits / quantités)": "Moules (caisse) × 3 caisse [€26.00]\nCrevettes grises × 1.5 kg [€35.00]", "Statut": "Prête", "Statut paiement": "En attente", "Total": 130.5, "Notes": "[Telefoon] Graag vóór 9u", "Leverslot": "07:00-09:00", "Client": [C("Brasserie De Kaai").id], "Date livraison souhaitée": isoDaysAgo(0), "Préparation validée": true, "Préparée le": new Date().toISOString() },
    // Ronde van vandaag (Leveringen, mode Chauffeur, spec 015) : nog twee stops klaar.
    { "Référence": "B-260902-R4ND", "Date": isoDaysAgo(1), "Lignes (produits / quantités)": "Cabillaud × 2 kg [€22.00]\nMoules (caisse) × 1 caisse [€28.00]", "Statut": "Prête", "Statut paiement": "En attente", "Total": 72, "Client": [C("Vishandel Nora").id], "Date livraison souhaitée": isoDaysAgo(0), "Préparation validée": true, "Préparée le": new Date().toISOString() },
    { "Référence": "B-260902-T9NA", "Date": isoDaysAgo(1), "Lignes (produits / quantités)": "Tonijn sashimi blok × 1 kg [€27.50]", "Statut": "Prête", "Statut paiement": "En attente", "Total": 27.5, "Notes": "Achterdeur, bellen bij aankomst.", "Client": [C("Aloha Poke Bowls").id], "Date livraison souhaitée": isoDaysAgo(0), "Préparation validée": true, "Préparée le": new Date().toISOString() },
    { "Référence": "B-260901-K2WD", "Date": isoDaysAgo(1), "Lignes (produits / quantités)": "Saumon frais × 4 kg [€16.00]\nVANNAMEI GARNALEN 26-30 × 6 pièce [€10.00]\nOesters Zeeuwse creuse nr. 3 × 48 pièce [€0.85]", "Statut": "Reçue", "Statut paiement": "En attente", "Total": 164.8, "Notes": "Zalm graag in filets.", "Leverslot": "06:00-08:00", "Client": [C("Aloha Poke Bowls").id], "Date livraison souhaitée": isoDaysAgo(0) },
    { "Référence": "B-260901-H8TN", "Date": isoDaysAgo(1), "Lignes (produits / quantités)": "Cabillaud × 5 kg [€22.00]\nZeebaars heel 400-600 × 6 kg [€14.90]", "Statut": "Reçue", "Statut paiement": "En attente", "Total": 199.4, "Client": [C("Vishandel Nora").id], "Date livraison souhaitée": isoDaysAgo(-1) }
  ]);
  db.create("Aanvragen", [
    { "Bedrijfsnaam": "Sushi Sato", "Contactpersoon": "Yuki Sato", "Email": "yuki@sushisato.example", "Telefoon": "+32 470 11 22 33", "Adres": "Meir 12, 2000 Antwerpen", "Notities": "Wij zoeken een vaste leverancier voor sashimi-kwaliteit.", "Status": "Nieuw" },
    { "Bedrijfsnaam": "Voorbeeld BV", "Contactpersoon": "Jan Janssens", "Email": "info@voorbeeld.example", "Telefoon": "+32 3 000 00 00", "Adres": "Voorbeeldstraat 1", "Status": "Verwerkt" }
  ]);
  // Bestellen per e-mail (specs/020) : twee berichten in Bestellingen → Te controleren.
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const ahead = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  const voorstel = { lines: [
    { productId: P("Saumon frais").id, naam_in_mail: "zalm", qty: 4, unit: "kg", confidence: 0.93, opmerking: "", note: "" },
    { productId: P("VANNAMEI GARNALEN GEPELD 16/20").id, naam_in_mail: "garnalen 16/20 gepeld", qty: 2, unit: "carton", confidence: 0.55, opmerking: "gepeld", note: "eenheid nagaan: catalogus per stuk" },
    { productId: P("Oesters Zeeuwse creuse nr. 3").id, naam_in_mail: "oesters", qty: 48, unit: "pièce", confidence: 0.9, opmerking: "", note: "" }
  ], leverdag: ahead(3), opmerkingen: "Levering langs de achterdeur", onduidelijk: false, leverdagVoorstel: ahead(3) };
  db.create("Inkomende mails", [
    { "Bericht-id": "demo-inbound-1", "Ontvangen op": ago(2), "Van": "keuken@alohapoke.example", "Aan": "bestel@orders.famoseafood.be", "Onderwerp": "Bestelling vrijdag",
      "Tekst": "Hallo,\n\nVoor vrijdag graag:\n4 kg zalm\n2 dozen garnalen 16/20 gepeld\n48 oesters\n\nLevering langs de achterdeur.\n\nGroeten,\nKeuken Aloha",
      "Client": [C("Aloha Poke Bowls").id], "Status": "Te controleren", "Verificatie": "spf=pass dkim=pass dmarc=pass", "Voorstel": JSON.stringify(voorstel),
      "Reden": "«garnalen 16/20 gepeld» onzeker (55 %): eenheid nagaan: catalogus per stuk; «garnalen 16/20 gepeld»: eenheid in de mail (doos) verschilt van de catalogus (stuk)" },
    { "Bericht-id": "demo-inbound-2", "Ontvangen op": ago(5), "Van": "info@sushisato.example", "Aan": "bestel@orders.famoseafood.be", "Onderwerp": "Commande",
      "Tekst": "Bonjour,\n\nPour demain: 2 kg de thon sashimi et 1 caisse de moules.\n\nMerci,\nYuki", "Status": "Te controleren", "Verificatie": "spf=pass dkim=pass dmarc=pass", "Reden": "onbekende afzender" }
  ]);
  db.save();
  return { configId: cfg.id, products, clients };
}

module.exports = { seed };
