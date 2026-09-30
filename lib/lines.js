"use strict";
// Lignes d'une commande (« Tong × 1.5 kg [€18.49] (en filets) ») → objets. Une seule définition
// côté serveur (audit I-11) : api/updateorder, orders, klantdoc, export, lib/margin, creditnota,
// reminders. Même format que K.parseLines (assets/ui.js), test de parité dans test/lines.test.js.
// lib/ordermail.js garde sa propre lecture : pour l'affichage d'un e-mail, une ligne illisible
// reste visible telle quelle et la quantité reste le texte saisi.
function parseLines(txt) {
  return String(txt || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)\s*[×x]\s*([\d.,]+)\s*([^[(]*)(.*)$/);
    if (!m) return null;
    const tail = m[4] || "", price = tail.match(/\[€\s*([\d.,]+)\]/), comment = tail.match(/\((.*?)\)/);
    return { nom: m[1].trim(), qty: parseFloat(m[2].replace(",", ".")) || 0, unit: m[3].trim(), price: price ? Number(price[1].replace(",", ".")) : null, comment: comment ? comment[1] : "" };
  }).filter(Boolean);
}
module.exports = { parseLines };
