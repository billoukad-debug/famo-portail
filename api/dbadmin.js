// Beheer → Systeemstatus → Database. Enkel voor de beheerder.
//   GET                        -> welke database actief is, bereikbaarheid, aantallen per tabel,
//                                 recente back-ups (?airtable=1 telt ook in Airtable)
//   POST {action:"export"}     -> volledige back-up (alle tabellen + famo_files, lib/backup.js).
//                                 SQL : bewaard als back-up in de database, te downloaden per
//                                 deel ({action:"download"}). Airtable : enkel lezen, meteen
//                                 teruggegeven als hij klein genoeg is (anders : nachtelijke mail).
//   POST {action:"download", id, part}      -> deel <part> (base64 van gzip) van back-up <id>
//   POST {action:"upload", id?, part, parts, data} -> bestand om terug te zetten, per deel
//   POST {action:"restore", snapshot | backup, confirm} -> terugzetten (enkel SQL-database) :
//                                 lege database, of {confirm:"RESTORE"} ; eerst een automatische
//                                 back-up van de huidige inhoud (teruggegeven in `before`).
//   POST {action:"copy"}       -> kopieert ALLE tabellen van Airtable naar de SQL-database, foto's
//                                 inbegrepen (gedownload naar famo_files : Airtable-links verlopen).
//                                 Na de omschakeling enkel met {force:true, confirm:"OVERWRITE"},
//                                 na een automatische back-up, en geweigerd als de database
//                                 nieuwere bestellingen heeft dan Airtable.
//   POST {action:"verify"}     -> vergelijkt Airtable en de database : ids, som van de bestellingen
//                                 én een vingerafdruk van de velden per record. Niets geschreven.
//   POST {action:"fixPhotos"}  -> foto's die nog naar Airtable wijzen opnieuw ophalen (verse link
//                                 uit Airtable) en in famo_files bewaren.
// Airtable blijft altijd onaangeroerd : dit endpoint leest er alleen uit.
const ds = require("../lib/datastore");
const __auth = require("../lib/staffauth");
const { sqlStore, TABLES, newId } = require("../lib/at-engine");
const sqlLib = require("../lib/sql");
const backup = require("../lib/backup");
const log = require("../lib/log");

const INLINE_MAX = 3 * 1024 * 1024; // export Airtable renvoyé tel quel (base64 < 4,5 Mo)
const IMG = /^image\/(jpeg|png|webp)$/;
const LOCAL = /^\/api\/foto\?id=att[A-Za-z0-9]{14}$/;

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

const sumTotal = (recs) => Math.round((recs || []).reduce((s, r) => s + (Number((r.fields || {})["Total"]) || 0), 0) * 100) / 100;
const isEmptyDb = async (store) => !Object.values(await store.counts()).some((n) => n > 0) && !(await store.fileCount());
const snapshotOut = (m) => m && { id: m.id, createdTime: m.createdTime, kind: m.kind, size: m.size, parts: m.parts };

// D-08 : pièces jointes image hébergées par Airtable (liens signés qui expirent) ->
// téléchargées et rangées dans famo_files, servies ensuite par /api/foto. Nom, type et
// taille conservés (la vérification compare ces trois-là). Autres fichiers (PDF…) : lien
// Airtable laissé tel quel, compté dans `kept`.
async function localize(fields, recordId, files, stats) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (!Array.isArray(v) || !v.length || !v.every((a) => a && typeof a === "object" && typeof a.url === "string")) { out[k] = v; continue; }
    out[k] = [];
    for (const a of v) {
      if (LOCAL.test(a.url)) { out[k].push(a); continue; }
      const type = String(a.type || "").toLowerCase();
      if (!/^https:\/\//.test(a.url) || !IMG.test(type)) { stats.kept++; out[k].push(a); continue; }
      try {
        const r = await ds.realFetch(a.url);
        if (!r || !r.ok) throw new Error("HTTP " + (r && r.status));
        const buf = Buffer.from(await r.arrayBuffer());
        if (!buf.length || buf.length > 5 * 1024 * 1024) throw new Error("grootte " + buf.length);
        const id = newId("att"), url = "/api/foto?id=" + id;
        files.push({ id, recordId, contentType: type, filename: String(a.filename || "foto").slice(0, 120), size: buf.length, data: buf.toString("base64") });
        out[k].push({ id, url, filename: a.filename || "foto", size: buf.length, type, thumbnails: { large: { url }, small: { url } } });
        stats.downloaded++;
      } catch (e) {
        stats.failed++;
        stats.errors.push(recordId + " : " + (e.message || e));
        out[k].push(a);
      }
    }
  }
  return out;
}
const hasRemoteImage = (fields) => Object.values(fields || {}).some((v) => Array.isArray(v) && v.some((a) => a && typeof a === "object" && typeof a.url === "string" && /^https:\/\//.test(a.url) && IMG.test(String(a.type || "").toLowerCase())));

async function airtableRecord(table, id) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) throw new Error("AIRTABLE_TOKEN ontbreekt : kan Airtable niet lezen");
  const r = await ds.realFetch(`https://api.airtable.com/v0/${ds.BASE}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  return j && !j.error ? j : null;
}

module.exports = async (req, res) => {
  const L = log.from(req, "dbadmin");
  if (!__auth.hasCode()) return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  if (!__auth.adminOk(req)) return res.status(403).json({ error: "Enkel de beheerder kan de database beheren" });
  const t = targetStore();
  try {
    if (req.method === "GET") {
      const out = { backend: ds.backend(), target: t.kind, targetError: t.error, reachable: false, counts: {}, airtable: null, snapshots: [], lastBackup: null };
      if (t.store) {
        try { out.reachable = await t.store.ping(); out.counts = await t.store.counts(); }
        catch (e) { out.targetError = e.message || String(e); }
        if (out.reachable) {
          try {
            const snaps = await t.store.snapshots();
            out.snapshots = snaps.filter((s) => s.parts > 0).map(snapshotOut);
            const run = snaps.find((s) => s.kind === "nachtelijk");
            if (run) { let n = {}; try { n = JSON.parse(run.note || "{}"); } catch (e) { n = {}; } out.lastBackup = { at: run.createdTime, size: run.size, ok: !!n.ok, big: !!n.big, error: n.error || "" }; }
          } catch (e) { L.warn("back-ups onleesbaar", { err: e }); }
        }
      }
      if (String((req.query || {}).airtable || "") === "1") {
        out.airtable = {};
        for (const tbl of TABLES) { const recs = await backup.readAirtable(tbl); if (recs) out.airtable[tbl] = recs.length; }
      }
      return res.status(200).json(out);
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Methode niet toegestaan" });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
    body = body || {};
    const live = ds.backend() !== "airtable";

    // ---- Export : lecture seule, possible sur tous les moteurs ----
    if (body.action === "export") {
      if (live && t.store) {
        const b = await backup.fromStore(t.store, ds.backend());
        const meta = await backup.saveSnapshot(t.store, "export", backup.gzip(b), "Beheer");
        L.info("back-up gemaakt", { snapshot: meta.id, size: meta.size, records: backup.summary(b).records });
        return res.status(200).json({ ok: true, snapshot: snapshotOut(meta), summary: backup.summary(b) });
      }
      const b = await backup.fromAirtable();
      const buf = backup.gzip(b);
      if (buf.length > INLINE_MAX) return res.status(413).json({ error: "Back-up te groot om rechtstreeks te downloaden (" + Math.round(buf.length / 1048576) + " MB). De nachtelijke back-up per e-mail bevat alles.", size: buf.length });
      return res.status(200).json({ ok: true, inline: buf.toString("base64"), size: buf.length, summary: backup.summary(b) });
    }

    if (!t.store) return res.status(503).json({ error: "Geen database bereikbaar: " + t.error });

    if (body.action === "download") {
      const id = String(body.id || ""), part = Number(body.part) || 0;
      const meta = /^snp[A-Za-z0-9]{14}$/.test(id) ? await t.store.snapshot(id) : null;
      if (!meta || !meta.parts || part < 0 || part >= meta.parts) return res.status(404).json({ error: "Back-up niet gevonden" });
      return res.status(200).json({ id, part, parts: meta.parts, size: meta.size, sha256: meta.sha256, data: await t.store.snapshotPart(id, part), filename: "famo-backup-" + meta.createdTime.slice(0, 19).replace(/[:T]/g, "-") + ".json.gz" });
    }

    // Envoi d'un fichier à restaurer, par morceaux (limite de 4,5 Mo par requête).
    if (body.action === "upload") {
      const parts = Number(body.parts) || 0, part = Number(body.part);
      const data = String(body.data || "");
      if (!(parts >= 1 && parts <= 200) || !(part >= 0 && part < parts) || !/^[A-Za-z0-9+/]*=*$/.test(data) || data.length > backup.PART_CHARS + 16) return res.status(400).json({ error: "Ongeldig deel" });
      const id = part === 0 && !body.id ? newId("snp") : String(body.id || "");
      if (!/^snp[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ error: "Ongeldig id" });
      await t.store.putSnapshotPart(id, part, data);
      if (part < parts - 1) return res.status(200).json({ ok: true, id, part });
      let b64 = "";
      for (let n = 0; n < parts; n++) { const p = await t.store.snapshotPart(id, n); if (p == null) return res.status(400).json({ error: "Deel " + (n + 1) + " ontbreekt" }); b64 += p; }
      const buf = Buffer.from(b64, "base64");
      let b;
      try { b = backup.parse(buf); } catch (e) { return res.status(400).json({ error: e.message }); }
      const meta = { id, createdTime: new Date().toISOString(), kind: "upload", size: buf.length, parts, sha256: backup.sha256(buf), note: "" };
      await t.store.putSnapshot(meta, []); // morceaux déjà en place : seule la fiche manque
      return res.status(200).json({ ok: true, snapshot: snapshotOut(meta), summary: backup.summary(b) });
    }

    if (body.action === "restore") {
      if (!live) return res.status(400).json({ error: "Terugzetten kan enkel op de SQL-database (DB_BACKEND=postgres). Airtable wordt nooit overschreven." });
      let b;
      try {
        if (body.backup && typeof body.backup === "object") { backup.validate(body.backup); b = body.backup; }
        else b = backup.parse((await backup.loadSnapshot(t.store, String(body.snapshot || ""))).buf);
      } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
      const empty = await isEmptyDb(t.store);
      if (!empty && body.confirm !== "RESTORE") {
        return res.status(409).json({ error: "De database is niet leeg. Typ RESTORE om de volledige inhoud te vervangen (er wordt eerst automatisch een back-up gemaakt).", needConfirm: "RESTORE", current: await t.store.counts(), incoming: backup.summary(b) });
      }
      const before = empty ? null : await backup.saveSnapshot(t.store, "voor-herstel", backup.gzip(await backup.fromStore(t.store, ds.backend())), "automatisch vóór terugzetten");
      await backup.restore(t.store, b);
      const cmp = backup.compare(b, await backup.fromStore(t.store, ds.backend()));
      L[cmp.ok ? "info" : "error"]("back-up teruggezet", { before: before && before.id, records: backup.summary(b).records, ok: cmp.ok });
      return res.status(200).json({ ok: cmp.ok, before: snapshotOut(before), summary: backup.summary(b), report: cmp });
    }

    if (body.action === "copy") {
      if (live && body.force !== true) {
        return res.status(409).json({ error: "De portaal draait al op de nieuwe database. Kopiëren vanuit Airtable zou recente bestellingen overschrijven." });
      }
      if (live && body.confirm !== "OVERWRITE") {
        return res.status(409).json({ error: "Bevestig met OVERWRITE : de volledige database wordt vervangen door Airtable.", needConfirm: "OVERWRITE" });
      }
      // Tout lire d'abord : si Airtable échoue à mi-chemin, rien n'a été écrit.
      const src = {};
      for (const tbl of TABLES) src[tbl] = await backup.readAirtable(tbl);
      if (live) {
        // L-03 : jamais écraser des commandes passées après la bascule.
        const srcOrders = src.Commandes || [], srcIds = new Set(srcOrders.map((r) => r.id));
        const srcMax = srcOrders.reduce((m, r) => (String(r.createdTime || "") > m ? String(r.createdTime) : m), "");
        const newer = (await t.store.list("Commandes")).filter((r) => !srcIds.has(r.id) && String(r.createdTime || "") > srcMax);
        if (newer.length) {
          L.warn("kopie geweigerd : nieuwere bestellingen", { newer: newer.length });
          return res.status(409).json({ error: "Geweigerd : de database bevat " + newer.length + " bestelling(en) die nieuwer zijn dan alles in Airtable (bv. " + (newer[newer.length - 1].fields["Référence"] || newer[newer.length - 1].id) + "). Die zouden verloren gaan.", newer: newer.length });
        }
      }
      const before = (await isEmptyDb(t.store)) ? null : await backup.saveSnapshot(t.store, "voor-kopie", backup.gzip(await backup.fromStore(t.store, ds.backend())), "automatisch vóór kopie uit Airtable");
      const photos = { downloaded: 0, failed: 0, kept: 0, errors: [] }, files = [], prepared = {};
      for (const tbl of TABLES) {
        if (!src[tbl]) continue;
        prepared[tbl] = [];
        for (const r of src[tbl]) prepared[tbl].push({ id: r.id, createdTime: r.createdTime, fields: body.photos === false ? (r.fields || {}) : await localize(r.fields || {}, r.id, files, photos) });
      }
      // Remplacement complet : fichiers puis tables (une transaction par table).
      await t.store.clearFiles();
      for (const f of files) await t.store.putFile(f);
      const report = [];
      for (const tbl of TABLES) {
        if (!prepared[tbl]) { report.push({ table: tbl, airtable: 0, postgres: 0, ok: true, missing: true }); continue; }
        await t.store.replaceAll(tbl, prepared[tbl]);
        const n = await t.store.count(tbl);
        report.push({ table: tbl, airtable: prepared[tbl].length, postgres: n, ok: n === prepared[tbl].length });
      }
      photos.errors = photos.errors.slice(0, 10);
      L.info("kopie Airtable → database", { before: before && before.id, photos: photos.downloaded, photosFailed: photos.failed });
      return res.status(200).json({ ok: report.every((r) => r.ok) && !photos.failed, report, photos, before: snapshotOut(before), at: new Date().toISOString() });
    }

    if (body.action === "verify") {
      const report = [];
      for (const tbl of TABLES) {
        const a = (await backup.readAirtable(tbl)) || [];
        const p = await t.store.list(tbl);
        // D-07 : vingerafdruk per record (velden, sleutels gesorteerd ; bijlagen op naam, type, grootte).
        const c = backup.compareRecords(a, p, true);
        const row = { table: tbl, airtable: c.a, postgres: c.b, onlyAirtable: c.onlyA, onlyPostgres: c.onlyB, changed: c.changed, changedIds: c.changedIds, ok: c.ok };
        if (tbl === "Commandes") { row.totalAirtable = sumTotal(a); row.totalPostgres = sumTotal(p); row.ok = row.ok && row.totalAirtable === row.totalPostgres; }
        report.push(row);
      }
      return res.status(200).json({ ok: report.every((r) => r.ok), report });
    }

    if (body.action === "fixPhotos") {
      const photos = { downloaded: 0, failed: 0, kept: 0, missing: 0, records: 0, errors: [] };
      for (const tbl of TABLES) {
        for (const cur of await t.store.list(tbl)) {
          if (!hasRemoteImage(cur.fields)) continue;
          photos.records++;
          const fresh = await airtableRecord(tbl, cur.id); // lien signé frais
          if (!fresh) { photos.missing++; continue; }
          const files = [];
          const merged = Object.assign({}, cur.fields);
          for (const [k, v] of Object.entries(fresh.fields || {})) if (hasRemoteImage({ [k]: v }) && hasRemoteImage({ [k]: cur.fields[k] })) merged[k] = v;
          const next = await localize(merged, cur.id, files, photos);
          for (const f of files) await t.store.putFile(f);
          if (files.length && !(await t.store.update(tbl, cur.id, next, cur.version))) { photos.failed += files.length; await t.store.removeFiles(files.map((f) => f.id)); }
        }
      }
      photos.errors = photos.errors.slice(0, 10);
      L.info("foto's opgehaald", { downloaded: photos.downloaded, failed: photos.failed, missing: photos.missing });
      return res.status(200).json({ ok: !photos.failed && !photos.missing, photos });
    }
    return res.status(400).json({ error: "Onbekende actie" });
  } catch (e) {
    L.error("dbadmin mislukt", { err: e });
    return res.status(500).json({ error: e.message || String(e) });
  }
};
