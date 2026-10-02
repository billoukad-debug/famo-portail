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
// Spec 019 : en production les photos sont des emballages (sac ou boîte avec étiquette), en paysage ou en portrait.
// view pair = paysage 320×240, impair = portrait 240×320 : les tuiles (4:3, contain) doivent montrer tout l'emballage.
function demoPak(color, view) {
  const portrait = view % 2 === 1, W = portrait ? 240 : 320, H = portrait ? 320 : 240;
  const bg = [244, 246, 246], edge = mix(color, [14, 34, 41], 0.35), ink = [14, 34, 41];
  const x0 = W * 0.14, x1 = W * 0.86, y0 = H * 0.1, y1 = H * 0.9, ly0 = y0 + (y1 - y0) * 0.36, ly1 = y0 + (y1 - y0) * 0.64, tx = x0 + (x1 - x0) * 0.12;
  return png(W, H, (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return x > x0 + 6 && x < x1 + 6 && y > y1 && y < y1 + 5 ? [222, 228, 228] : bg;
    if (x < x0 + 3 || x > x1 - 3 || y < y0 + 3 || y > y1 - 3) return edge;
    if (y > ly0 && y < ly1) {
      if (y > ly0 + 9 && y < ly0 + 17 && x > tx && x < x1 - (x1 - x0) * 0.28) return ink;
      if (y > ly0 + 25 && y < ly0 + 31 && x > tx && x < x1 - (x1 - x0) * 0.46) return [135, 146, 150];
      return [255, 255, 255];
    }
    return mix(color, [255, 255, 255], ((y - y0) / (y1 - y0)) * 0.18);
  });
}
const DEMO_FOTOS = { "Saumon frais": [[240, 128, 96], 3], "Cabillaud": [[214, 206, 190], 2], "Zeebaars heel 400-600": [[150, 164, 170], 1], "VANNAMEI GARNALEN GEPELD 16/20": [[238, 150, 110], 3], "VANNAMEI GARNALEN GEPELD 26/30": [[236, 160, 120], 2], "Tonijn sashimi blok": [[176, 48, 56], 1] };
const DEMO_PAK = { "BLACK TIGER GARNALEN 8-12": [[34, 46, 58], 2], "BLACK TIGER GARNALEN 13-15": [[34, 46, 58], 1], "BLACK TIGER GARNALEN BLOK 13-15": [[52, 70, 92], 2], "VANNAMEI GARNALEN 31-40": [[196, 82, 54], 1], "INKTVIS RINGEN 1KG": [[70, 110, 150], 2], "SURIMI STICKS 1KG": [[214, 70, 70], 1], "EDAMAME 1KG": [[92, 140, 70], 1], "KREEFTENSTAARTEN 150-200": [[160, 40, 36], 2] };
function addDemoFotos(db, products) {
  const patch = [];
  for (const p of products) {
    const name = p.fields["Produit"], d = DEMO_FOTOS[name], k = DEMO_PAK[name]; if (!d && !k) continue;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    patch.push({ id: p.id, fields: { "Foto": Array.from({ length: (d || k)[1] }, (_, v) => db.addFile(p.id, "image/png", slug + "-" + (v + 1) + ".png", d ? demoFoto(d[0], v) : demoPak(k[0], v))) } });
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
    "Bestellingen e-mail": "bestellingen@famotrading.be", "Besteldeadline": "22:00", "Leverdagen": "ma,di,wo,do,vr,za"
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
    { "Produit": "Vis (oud artikel)", "Prix de base": 3, "Unité": "caisse", "Catégorie": "Algemeen", "Actif": false },
    // Spec 019 : comme en production — une grande catégorie « Algemeen », le kaliber dans le nom (familles,
    // affichage dense) ; « Vegetarisch » et « Surimi ». Ajoutés après les 13 produits historiques (tests).
    ...[
      ["BLACK TIGER GARNALEN 8-12", 24.9, "caisse", "8/12"], ["BLACK TIGER GARNALEN 13-15", 21.5, "caisse", "13/15"], ["BLACK TIGER GARNALEN 16-20", 18.9, "caisse", "16/20"], ["BLACK TIGER GARNALEN 21-25", 16.5, "caisse", "21/25"],
      ["BLACK TIGER GARNALEN BLOK 8-12", 22, "caisse", "8/12"], ["BLACK TIGER GARNALEN BLOK 13-15", 19.5, "caisse", "13/15"], ["BLACK TIGER GARNALEN BLOK 16-20", 17.5, "caisse", "16/20"],
      ["VANNAMEI GARNALEN 31-40", 9.9, "caisse", "31/40"], ["VANNAMEI GARNALEN GEPELD 41/50", 8.5, "caisse", "41/50"],
      ["SCAMPI GEPELD 16-20", 16.9, "kg", "16/20"], ["SCAMPI GEPELD 21-25", 14.9, "kg", "21/25"],
      ["INKTVIS RINGEN 1KG", 7.9, "caisse", ""], ["INKTVIS TUBES U5", 11.5, "kg", "U5"], ["INKTVIS TUBES U10", 10.5, "kg", "U10"],
      ["MOSSELVLEES 1KG", 9.5, "caisse", ""], ["KREEFTENSTAARTEN 150-200", 39, "kg", "150/200"], ["KREEFTENSTAARTEN 200-250", 44, "kg", "200/250"]
    ].map(([n, prix, u, k]) => ({ "Produit": n, "Prix de base": prix, "Unité": u, "Catégorie": "Algemeen", "Actif": true, ...(k ? { "Kaliber": k } : {}) })),
    ...[["VEGGIE GARNALEN 1KG", 12.5], ["ZEEWIERSALADE 1KG", 9.9], ["WAKAME 500G", 6.5], ["EDAMAME 1KG", 5.9], ["VEGAN TONIJN 500G", 8.9]].map(([n, prix]) => ({ "Produit": n, "Prix de base": prix, "Unité": "pièce", "Catégorie": "Vegetarisch", "Actif": true })),
    ...[["SURIMI STICKS 1KG", 6.9], ["SURIMI SNOW CRAB 500G", 5.5]].map(([n, prix]) => ({ "Produit": n, "Prix de base": prix, "Unité": "pièce", "Catégorie": "Surimi", "Actif": true }))
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
    { "Client": [C("Brasserie De Kaai").id], "Produit": [P("Moules (caisse)").id], "Prix négocié": 26 },
    { "Client": [C("Aloha Poke Bowls").id], "Produit": [P("BLACK TIGER GARNALEN 13-15").id], "Prix négocié": 19.9 }
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
  db.save();
  return { configId: cfg.id, products, clients };
}

module.exports = { seed };
