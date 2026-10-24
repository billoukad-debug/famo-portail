require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { at, atAll, REC } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __trace = require("../lib/trace");
const __journal = require("../lib/journal");
const { parseLines } = require("../lib/lines");

// Lots et rappel (audit C-13, specs/035) — personnel et beheerder.
//   GET  /api/lots                → lots actifs (préparation, Voorraad) ; ?all=1 : aussi inactifs ;
//        + producten [{id, nom}] du catalogue (rattachement par identifiant, TRACE-04)
//   GET  /api/lots?trace=<n° de lot ou recId> → le lot et CHAQUE livraison qui l'a contenu
//        (client, date, quantité, statut) : réponse à « qui a reçu le lot X » en cas de rappel AFSCA.
//   GET  /api/lots?geleverd=1&klant=<recId>&van=JJJJ-MM-DD&tot=JJJJ-MM-DD → BEHEERDER seul (TRACE-03) :
//        les lots livrés (partis ou livrés) à un client (ou à tous) sur la période, avec l'instantané transmis.
//   POST /api/lots { id?, lotnummer, produit, productId?, leverancier, ontvangenOp, wetenschappelijkeNaam,
//        vangstgebied, vistuig, productiemethode, ontdooid, tht, vangstdatum, vangstId, nettoKg, hoeveelheid, actief, nota }
const out = (r, admin, naamVan) => Object.assign({ id: r.id }, __trace.snapshot(r), {
  produit: (r.fields["Product-id"] && naamVan && naamVan.get(r.fields["Product-id"])) || r.fields["Produit"] || "", productId: r.fields["Product-id"] || "",
  hoeveelheid: r.fields["Hoeveelheid"] == null ? null : r.fields["Hoeveelheid"], nettoKg: r.fields["Netto kg"] == null ? null : r.fields["Netto kg"],
  vangstdatum: r.fields["Vangstdatum"] || "", vangstId: r.fields["Vangst-id"] || "", actief: !!r.fields["Actief"], nota: r.fields["Nota"] || "" },
  // Prix d'achat (H-05) : beheerder seul.
  admin ? { aankoopprijs: r.fields["Aankoopprijs"] == null ? null : r.fields["Aankoopprijs"] } : {});
const day = (v) => String(v || "").slice(0, 10);
const isoOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

// TRACE-03 : ce qui a été transmis, tel que figé dans la commande (jamais relu dans la fiche du lot).
async function geleverd(q, res) {
  const today = new Date().toISOString().slice(0, 10);
  const tot = isoOk(q.tot) ? q.tot : today;
  const van = isoOk(q.van) ? q.van : new Date(Date.parse(tot + "T12:00:00Z") - 30 * 864e5).toISOString().slice(0, 10);
  if (van > tot) return res.status(400).json({ error: "Periode: « van » ligt na « tot »" });
  const klant = String(q.klant || "").trim();
  if (klant && !REC.test(klant)) return res.status(400).json({ error: "Ongeldige klant" });
  const [cmd, cl] = await Promise.all([atAll("Commandes"), atAll("Clients")]);
  if (cmd.error || cl.error) return res.status(500).json({ error: "Bestellingen onleesbaar" });
  const naam = new Map((cl.records || []).map((r) => [r.id, r.fields["Nom"] || ""]));
  const rows = [], klanten = new Map();
  let zonderLot = 0;
  require("../lib/testorders").real(cmd.records).forEach((r) => { // essais archivés exclus (specs/021)
    const f = r.fields;
    if (!["Sortie en livraison", "Facturée"].includes(f["Statut"])) return; // seulement ce qui est parti
    const d = day(f["Livrée le"] || f["Date livraison souhaitée"]);
    if (!d || d < van || d > tot) return;
    const cid = (f["Client"] || [])[0] || "";
    klanten.set(cid, naam.get(cid) || "");
    if (klant && cid !== klant) return;
    const m = __trace.parseLots(f["Lots"]) || {};
    for (const l of parseLines(f["Lignes (produits / quantités)"])) {
      const k = Object.keys(m).find((x) => __trace.norm(x) === __trace.norm(l.nom));
      const list = (k && m[k]) || [];
      if (!list.length) { zonderLot++; continue; }
      for (const s of list) rows.push(Object.assign({ leverdatum: d, ref: f["Référence"] || "", bestelling: r.id, klant: naam.get(cid) || "", klantId: cid, artikel: l.nom, hoeveelheid: l.qty, eenheid: l.unit }, s));
    }
  });
  rows.sort((a, b) => b.leverdatum.localeCompare(a.leverdatum) || a.ref.localeCompare(b.ref));
  return res.status(200).json({ van, tot, klant, rows, zonderLot, klanten: Array.from(klanten, ([id, nom]) => ({ id, nom })).filter((x) => x.id).sort((a, b) => a.nom.localeCompare(b.nom, "nl")) });
}

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  if (!(await __auth.staffSession(req))) return res.status(401).json({ error: "Ongeldige personeelscode" });
  const admin = __auth.adminOk(req);
  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (String(q.geleverd || "") === "1") {
        // Liste par client et période (demande d'un client ou de l'AFSCA) : beheerder seul.
        if (!admin) return res.status(403).json({ error: "Enkel een beheerder" });
        return await geleverd(q, res);
      }
      const [lots, cat] = await Promise.all([atAll("Lots"), atAll("Catalogue")]);
      if (lots.error) return res.status(500).json({ error: "Loten onleesbaar" });
      const recs = lots.records || [];
      const naamVan = new Map(((cat && cat.records) || []).map((r) => [r.id, r.fields["Produit"] || ""]));
      if (q.trace) {
        const key = String(q.trace).trim();
        const lot = recs.find((r) => r.id === key) || recs.find((r) => __trace.norm(r.fields["Lotnummer"]) === __trace.norm(key));
        if (!lot) return res.status(404).json({ error: "Lot niet gevonden" });
        const [cmd, cl] = await Promise.all([atAll("Commandes"), atAll("Clients")]);
        const naam = new Map(((cl && cl.records) || []).map((r) => [r.id, r.fields]));
        const leveringen = [];
        require("../lib/testorders").real(cmd && cmd.records).forEach((r) => { // essais archivés exclus (specs/021)
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
        return res.status(200).json({ lot: out(lot, admin, naamVan), leveringen });
      }
      const all = String(q.all || "") === "1";
      const producten = ((cat && cat.records) || []).map((r) => ({ id: r.id, nom: r.fields["Produit"] || "" })).filter((p) => p.nom).sort((a, b) => a.nom.localeCompare(b.nom, "nl"));
      return res.status(200).json({ lots: recs.filter((r) => all || !!r.fields["Actief"]).map(r => out(r, admin, naamVan)).sort((a, b) => String(b.ontvangenOp).localeCompare(String(a.ontvangenOp))), methodes: __trace.METHODS, producten });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Gebruik GET of POST." });
    let b = req.body;
    if (typeof b === "string") b = JSON.parse(b || "{}");
    b = b || {};
    // Le personnel ne fixe pas le prix d'achat : champ ignoré (l'existant est gardé).
    if (!admin) delete b.aankoopprijs;
    if (b.id && !REC.test(String(b.id))) return res.status(400).json({ error: "Ongeldig lot-id" });
    let before = b.id ? await __journal.get("Lots", String(b.id)) : null;
    if (b.id && !before) { const cur = await at(`Lots/${b.id}`); before = cur && !cur.error ? cur.fields || null : null; }
    const v = __trace.lotFields(b, before);
    if (v.error) return res.status(400).json({ error: v.error });
    // TRACE-04 : le lot est rattaché au produit du catalogue par son identifiant (le serveur le cherche ;
    // le nom suit celui du catalogue). Produit hors catalogue : gardé par nom, comme avant.
    const cat = await atAll("Catalogue");
    if (cat.error) return res.status(500).json({ error: "Catalogus onleesbaar" });
    const pid = String(b.productId || "").trim();
    if (pid && !REC.test(pid)) return res.status(400).json({ error: "Ongeldig product-id" });
    const prod = pid ? (cat.records || []).find((r) => r.id === pid) : (cat.records || []).find((r) => __trace.norm(r.fields["Produit"]) === __trace.norm(v.fields["Produit"]));
    if (pid && !prod) return res.status(400).json({ error: "Product niet gevonden in de catalogus" });
    if (prod) { v.fields["Produit"] = String(prod.fields["Produit"] || v.fields["Produit"]); v.fields["Product-id"] = prod.id; }
    else if (before && before["Product-id"]) v.fields["Product-id"] = ""; // lot déplacé vers un produit hors catalogue
    const saved = b.id
      ? await at(`Lots/${b.id}`, { method: "PATCH", body: JSON.stringify({ fields: v.fields }) })
      : await at("Lots", { method: "POST", body: JSON.stringify({ records: [{ fields: v.fields }] }) });
    if (saved.error) return res.status(500).json({ error: "Lot opslaan mislukt" });
    const rec = saved.records ? saved.records[0] : saved;
    await __journal.log({ wie: __auth.actorOf(req), rol: __auth.roleOf(req), actie: b.id ? "Lot gewijzigd" : "Lot aangemaakt", object: "Lots", record: rec.id, referentie: v.fields["Lotnummer"] + " · " + v.fields["Produit"], wijzigingen: __journal.diff(before, v.fields) });
    return res.status(200).json({ ok: true, lot: out(rec, admin) });
  } catch (e) {
    console.error("[lots]", e && e.message || e);
    return res.status(500).json({ error: "Serverfout. Probeer opnieuw." });
  }
};
