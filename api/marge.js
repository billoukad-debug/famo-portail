require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Marge brute par produit et valeur du stock (audit H-05, H-06, H-11) — beheerder seul.
//   GET /api/marge?van=JJJJ-MM-DD&tot=JJJJ-MM-DD   (défaut : année en cours)
const { atAll } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const margin = require("../lib/margin");
const iso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gebruik GET." });
  if (!(await __auth.adminSession(req))) return res.status(401).json({ error: "Enkel voor de beheerder" });
  try {
    const q = req.query || {}, year = new Date().getFullYear();
    const van = iso(q.van) || year + "-01-01", tot = iso(q.tot) || year + "-12-31";
    if (tot < van) return res.status(400).json({ error: "„Tot” ligt vóór „van”" });
    const [orders, lots, cat, stock] = await Promise.all([atAll("Commandes"), atAll("Lots"), atAll("Catalogue"), atAll("Stock")]);
    if (orders.error || lots.error) return res.status(500).json({ error: "Gegevens onleesbaar. Probeer opnieuw." });
    return res.status(200).json(margin.compute({ van, tot, orders: require("../lib/testorders").real(orders.records), lots: lots.records, catalogue: (cat && cat.records) || [], stock: (stock && stock.records) || [] }));
  } catch (e) {
    console.error("[marge]", e && e.message || e);
    return res.status(500).json({ error: "Serverfout. Probeer opnieuw." });
  }
};
