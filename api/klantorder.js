// Le client annule lui-même une bestelling, tant qu'elle est encore « Reçue »
// (rien n'a été préparé). POST {user, pw, ref} -> {ok, statut}.
//
// Même modèle que klantdoc : le client vérifié par authClient ne peut toucher
// qu'à ses propres commandes (lien « Client » sur l'enregistrement). Dès que le
// magasin a validé la préparation (Prête) ou plus loin, l'annulation passe par
// Famo (téléphone) : le personnel la fait depuis la fiche, avec la raison.
const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = "appcdduLth9iGX8I0";
const { authClient } = require("./catalogue");

async function at(path, opts){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, Object.assign({
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
  }, opts || {}));
  return r.json();
}

function stamp(){
  return new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(",", "");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Gebruik POST." });
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    if (q.action !== "cancel") return res.status(400).json({ error: "Onbekende actie" });
    const client = await authClient(q.user, q.pw);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    const ref = String(q.ref || "").replace(/'/g, "").slice(0, 40);
    if (!ref) return res.status(400).json({ error: "Referentie ontbreekt" });
    const found = await at(`Commandes?filterByFormula=${encodeURIComponent(`{Référence}='${ref}'`)}&maxRecords=1`);
    const rec = ((found && found.records) || [])[0];
    if (!rec || !(rec.fields["Client"] || []).includes(client.id)) return res.status(404).json({ error: "Bestelling niet gevonden" });
    const f = rec.fields || {};
    const statut = f["Statut"] || "Reçue";
    if (statut === "Annulée") return res.status(409).json({ error: "Deze bestelling is al geannuleerd." });
    if (statut !== "Reçue") return res.status(409).json({ error: "Deze bestelling wordt al klaargezet. Bel Famo om ze te wijzigen of te annuleren." });
    const journal = `${stamp()} · Geannuleerd · klant`;
    const fields = {
      "Statut": "Annulée",
      "Annulée le": new Date().toISOString(),
      "Motif annulation": "Geannuleerd door klant",
      "Correcties": (f["Correcties"] ? f["Correcties"] + "\n" : "") + journal
    };
    // typecast : l'option « Annulée » est créée dans Airtable au premier usage.
    const saved = await at(`Commandes/${rec.id}`, { method: "PATCH", body: JSON.stringify({ typecast: true, fields }) });
    if (saved.error) return res.status(500).json({ error: saved.error.message || "Annuleren mislukt" });
    res.status(200).json({ ok: true, ref, statut: "Annulée" });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
