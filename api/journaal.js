require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const __auth = require("../lib/staffauth");
const __journal = require("../lib/journal");

// Journal d'audit (lecture seule, beheerder) : GET /api/journaal?limit=500[&object=Catalogue][&record=rec…]
// Aucune route ne modifie ni n'efface le journal (lib/journal.js : ajout seul).
module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gebruik GET." });
  if (!(await __auth.adminSession(req))) return res.status(401).json({ error: "Enkel voor de beheerder" });
  try {
    const q = req.query || {};
    const rows = await __journal.list({ limit: q.limit, object: q.object ? String(q.object) : "", record: q.record ? String(q.record) : "" });
    return res.status(200).json({ enabled: !!__journal.store(), rows });
  } catch (e) {
    console.error("[journaal]", e && e.message || e);
    return res.status(500).json({ error: "Serverfout. Probeer opnieuw." });
  }
};
