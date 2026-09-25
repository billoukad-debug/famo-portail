// Beheer → Systeemstatus → Database. Enkel voor de beheerder.
//   GET                      -> welke database actief is, bereikbaarheid, aantallen per tabel
//                               (?airtable=1 telt ook in Airtable : kost een paar API-oproepen)
//   POST {action:"copy"}     -> kopieert ALLE tabellen van Airtable naar Postgres (volledige
//                               vervanging per tabel, in één transactie per tabel).
//                               Geweigerd zodra DB_BACKEND=postgres, tenzij {force:true} :
//                               anders zou een oude Airtable de nieuwe gegevens overschrijven.
//   POST {action:"verify"}   -> vergelijkt Airtable en Postgres : aantallen, ids, som van de
//                               bestellingen. Niets wordt geschreven.
// Airtable blijft altijd onaangeroerd : dit endpoint leest er alleen uit.
const ds = require("../lib/datastore");
const __auth = require("../lib/staffauth");
const { sqlStore, TABLES } = require("../lib/at-engine");
const sqlLib = require("../lib/sql");

const TOKEN = process.env.AIRTABLE_TOKEN;

// Doelopslag : die van het interrupteur als het al op postgres/sqlite staat, anders een
// verbinding met DATABASE_URL (vóór de omschakeling, om de kopie voor te bereiden).
function targetStore() {
  if (ds.state.store) return { store: ds.state.store, kind: ds.state.sql && ds.state.sql.kind, error: "" };
  if (ds.state.error) return { store: null, kind: null, error: ds.state.error };
  const url = ds.databaseUrl();
  if (!url) return { store: null, kind: null, error: "DATABASE_URL ontbreekt in Vercel (Storage → Neon koppelen aan het project)" };
  try { const sql = sqlLib.neon(url, ds.realFetch); return { store: sqlStore(sql), kind: sql.kind, error: "" }; }
  catch (e) { return { store: null, kind: null, error: e.message || String(e) }; }
}

async function airtableAll(table) {
  if (!TOKEN) throw new Error("AIRTABLE_TOKEN ontbreekt : kan Airtable niet lezen");
  let offset = "", records = [];
  do {
    const url = `https://api.airtable.com/v0/${ds.BASE}/${encodeURIComponent(table)}?pageSize=100` + (offset ? "&offset=" + encodeURIComponent(offset) : "");
    const r = await ds.realFetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const page = await r.json();
    // Une table absente de la base (ex. supprimée à la main) n'est pas une erreur de copie.
    if (page.error && (page.error.type === "TABLE_NOT_FOUND" || r.status === 404)) return null;
    if (page.error) throw new Error(table + " : " + (page.error.message || page.error.type || "leesfout"));
    records = records.concat(page.records || []);
    offset = page.offset || "";
  } while (offset);
  return records;
}

const sumTotal = (recs) => Math.round((recs || []).reduce((s, r) => s + (Number((r.fields || {})["Total"]) || 0), 0) * 100) / 100;

module.exports = async (req, res) => {
  if (!__auth.hasCode()) return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  if (!__auth.adminOk(req)) return res.status(403).json({ error: "Enkel de beheerder kan de database beheren" });
  const t = targetStore();
  try {
    if (req.method === "GET") {
      const out = { backend: ds.backend(), target: t.kind, targetError: t.error, reachable: false, counts: {}, airtable: null };
      if (t.store) {
        try { out.reachable = await t.store.ping(); out.counts = await t.store.counts(); }
        catch (e) { out.targetError = e.message || String(e); }
      }
      if (String((req.query || {}).airtable || "") === "1") {
        out.airtable = {};
        for (const tbl of TABLES) { const recs = await airtableAll(tbl); if (recs) out.airtable[tbl] = recs.length; }
      }
      return res.status(200).json(out);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Methode niet toegestaan" });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
    body = body || {};
    if (!t.store) return res.status(503).json({ error: "Geen database bereikbaar: " + t.error });

    if (body.action === "copy") {
      if (ds.backend() !== "airtable" && body.force !== true) {
        return res.status(409).json({ error: "De portaal draait al op de nieuwe database. Kopiëren vanuit Airtable zou recente bestellingen overschrijven." });
      }
      const report = [];
      for (const tbl of TABLES) {
        const recs = await airtableAll(tbl);
        if (!recs) { report.push({ table: tbl, airtable: 0, postgres: 0, ok: true, missing: true }); continue; }
        await t.store.replaceAll(tbl, recs.map((r) => ({ id: r.id, createdTime: r.createdTime, fields: r.fields || {} })));
        const n = (await t.store.list(tbl)).length;
        report.push({ table: tbl, airtable: recs.length, postgres: n, ok: n === recs.length });
      }
      return res.status(200).json({ ok: report.every((r) => r.ok), report, at: new Date().toISOString() });
    }

    if (body.action === "verify") {
      const report = [];
      for (const tbl of TABLES) {
        const a = await airtableAll(tbl);
        const p = await t.store.list(tbl);
        const aIds = new Set((a || []).map((r) => r.id)), pIds = new Set(p.map((r) => r.id));
        const onlyAirtable = [...aIds].filter((id) => !pIds.has(id)).length;
        const onlyPostgres = [...pIds].filter((id) => !aIds.has(id)).length;
        const row = { table: tbl, airtable: (a || []).length, postgres: p.length, onlyAirtable, onlyPostgres, ok: !onlyAirtable && !onlyPostgres };
        if (tbl === "Commandes") { row.totalAirtable = sumTotal(a); row.totalPostgres = sumTotal(p); row.ok = row.ok && row.totalAirtable === row.totalPostgres; }
        report.push(row);
      }
      return res.status(200).json({ ok: report.every((r) => r.ok), report });
    }
    return res.status(400).json({ error: "Onbekende actie" });
  } catch (e) {
    console.error("[dbadmin]", e);
    return res.status(500).json({ error: e.message || String(e) });
  }
};
