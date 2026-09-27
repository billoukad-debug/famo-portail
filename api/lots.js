require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, REC } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __trace = require("../lib/trace");
const __journal = require("../lib/journal");

// Lots et rappel (audit C-13) — personnel et beheerder.
//   GET  /api/lots                → lots actifs (préparation, Voorraad) ; ?all=1 : aussi inactifs
//   GET  /api/lots?trace=<n° de lot ou recId> → le lot et CHAQUE livraison qui l'a contenu
//        (client, date, quantité, statut) : réponse à « qui a reçu le lot X » en cas de rappel AFSCA.
//   POST /api/lots { id?, lotnummer, produit, leverancier, ontvangenOp, wetenschappelijkeNaam,
//        vangstgebied, vistuig, productiemethode, ontdooid, tht, hoeveelheid, actief, nota }
const out = (r) => Object.assign({ id: r.id }, __trace.snapshot(r), { produit: r.fields["Produit"] || "", hoeveelheid: r.fields["Hoeveelheid"] == null ? null : r.fields["Hoeveelheid"], actief: r.fields["Actief"] !== false, nota: r.fields["Nota"] || "" });

module.exports = async (req, res) => {
  if (!__auth.staffOk(req)) return res.status(401).json({ error: "Ongeldige personeelscode" });
  try {
    if (req.method === "GET") {
      const q = req.query || {};
      const lots = await atAll("Lots");
      if (lots.error) return res.status(500).json({ error: "Loten onleesbaar" });
      const recs = lots.records || [];
      if (q.trace) {
        const key = String(q.trace).trim();
        const lot = recs.find((r) => r.id === key) || recs.find((r) => __trace.norm(r.fields["Lotnummer"]) === __trace.norm(key));
        if (!lot) return res.status(404).json({ error: "Lot niet gevonden" });
        const [cmd, cl] = await Promise.all([atAll("Commandes"), atAll("Clients")]);
        const naam = new Map(((cl && cl.records) || []).map((r) => [r.id, r.fields]));
        const leveringen = [];
        ((cmd && cmd.records) || []).forEach((r) => {
          const m = __trace.parseLots(r.fields["Lots"]);
          if (!m) return;
          for (const [prod, list] of Object.entries(m)) {
            if (!(list || []).some((s) => s.id === lot.id)) continue;
            const line = String(r.fields["Lignes (produits / quantités)"] || "").split("\n").find((l) => __trace.norm(l.split(/\s*[×x]\s*/)[0]) === __trace.norm(prod)) || "";
            const c = naam.get((r.fields["Client"] || [])[0]) || {};
            leveringen.push({ ref: r.fields["Référence"] || "", id: r.id, klant: c["Nom"] || "", telefoon: c["Téléphone"] || "", email: c["Email"] || "", leverdatum: r.fields["Livrée le"] || r.fields["Date livraison souhaitée"] || "", statut: r.fields["Statut"] || "", artikel: prod, lijn: line });
          }
        });
        leveringen.sort((a, b) => String(b.leverdatum).localeCompare(String(a.leverdatum)));
        return res.status(200).json({ lot: out(lot), leveringen });
      }
      const all = String(q.all || "") === "1";
      return res.status(200).json({ lots: recs.filter((r) => all || r.fields["Actief"] !== false).map(out).sort((a, b) => String(b.ontvangenOp).localeCompare(String(a.ontvangenOp))), methodes: __trace.METHODS });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Gebruik GET of POST." });
    let b = req.body;
    if (typeof b === "string") b = JSON.parse(b || "{}");
    b = b || {};
    const v = __trace.lotFields(b);
    if (v.error) return res.status(400).json({ error: v.error });
    if (b.id && !REC.test(String(b.id))) return res.status(400).json({ error: "Ongeldig lot-id" });
    const before = b.id ? await __journal.get("Lots", String(b.id)) : null;
    const saved = b.id
      ? await at(`Lots/${b.id}`, { method: "PATCH", body: JSON.stringify({ fields: v.fields }) })
      : await at("Lots", { method: "POST", body: JSON.stringify({ records: [{ fields: v.fields }] }) });
    if (saved.error) return res.status(500).json({ error: "Lot opslaan mislukt" });
    const rec = saved.records ? saved.records[0] : saved;
    await __journal.log({ wie: __auth.actorOf(req), rol: __auth.roleOf(req), actie: b.id ? "Lot gewijzigd" : "Lot aangemaakt", object: "Lots", record: rec.id, referentie: v.fields["Lotnummer"] + " · " + v.fields["Produit"], wijzigingen: __journal.diff(before, v.fields) });
    return res.status(200).json({ ok: true, lot: out(rec) });
  } catch (e) {
    console.error("[lots]", e && e.message || e);
    return res.status(500).json({ error: "Serverfout. Probeer opnieuw." });
  }
};
