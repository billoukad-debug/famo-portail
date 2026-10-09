// Sauvegarde nocturne (cron Vercel, vercel.json → crons) : export complet (lib/backup.js),
// compressé gzip, envoyé en pièce jointe à la boîte ops (BACKUP_EMAIL, sinon Configuratie
// → « Bestellingen e-mail »). Au-delà de 30 Mo compressés : résumé seul, téléchargement
// manuel depuis Beheer → Systeemstatus.
//
// Protégé par CRON_SECRET : Vercel envoie « Authorization: Bearer <CRON_SECRET> » à chaque
// déclenchement. Sans la variable, rien ne part (fail-closed, comme STAFF_CODE).
// Lecture seule sur les données ; en mode SQL, une trace de l'envoi (sans données) est
// gardée pour Systeemstatus et /api/health.
const crypto = require("crypto");
const ds = require("../lib/datastore");
const { at } = require("../lib/airtable");
const backup = require("../lib/backup");
const backupmail = require("../lib/backupmail");
const log = require("../lib/log");
const restoretest = require("../lib/restoretest"); // specs/026 : restauration prouvée chaque nuit
const alarm = require("../lib/alert");

function authorized(req) {
  const secret = String(process.env.CRON_SECRET || "");
  const h = (req.headers || {}).authorization || (req.headers || {}).Authorization || "";
  const a = Buffer.from(String(h)), b = Buffer.from("Bearer " + secret);
  return secret.length >= 16 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function recipient() {
  const env = String(process.env.BACKUP_EMAIL || "").trim();
  if (env) return env;
  const conf = await at(`${encodeURIComponent("Configuratie")}?maxRecords=1`);
  return String((((conf.records || [])[0] || {}).fields || {})["Bestellingen e-mail"] || "").trim();
}

module.exports = async (req, res) => {
  const L = log.from(req, "backup-cron");
  if (!process.env.CRON_SECRET) { L.error("CRON_SECRET ontbreekt : geen back-up"); return res.status(500).json({ error: "CRON_SECRET ontbreekt" }); }
  if (!authorized(req)) return res.status(401).json({ error: "Niet toegestaan" });
  const store = ds.backend() !== "airtable" ? ds.state.store : null;
  let size = 0, sha = "";
  try {
    const b = store ? await backup.fromStore(store, ds.backend()) : await backup.fromAirtable();
    const buf = backup.gzip(b), sum = backup.summary(b);
    size = buf.length; sha = backup.sha256(buf);
    // Restauration testée sur une base jetable en mémoire : la sauvegarde se remonte-t-elle à l'identique ?
    const rt = await restoretest.verify(buf);
    const to = await recipient();
    if (!to) throw new Error("Geen ontvanger : zet BACKUP_EMAIL of Beheer → Bedrijfsgegevens → Bestellingen e-mail");
    const day = new Date().toISOString().slice(0, 10);
    const big = buf.length > backupmail.MAX_ATTACHMENT();
    const lines = Object.entries(sum.tables).map(([t, n]) => "  " + t + " : " + n);
    const text = "FAMO Portail — back-up van " + day + " (" + sum.backend + ")\n\n" + lines.join("\n") + "\n  Foto's (famo_files) : " + sum.files + "\n\n" +
      (big ? "Het bestand is te groot voor e-mail (" + Math.round(buf.length / 1048576) + " MB gecomprimeerd). Download het handmatig : Beheer → Systeemstatus → Database → Back-up maken.\n"
        : "Bijlage : famo-backup-" + day + ".json.gz (" + Math.round(buf.length / 1024) + " kB, sha256 " + sha.slice(0, 16) + "…). Terugzetten : Beheer → Systeemstatus → Database → Back-up terugzetten.\n") +
      "\nTerugzet-test (lege testdatabase): " + (rt.ok ? "geslaagd, " + rt.records + " records in " + Math.round(rt.ms / 100) / 10 + " s" : "MISLUKT — " + rt.error) + "\n" +
      "\nBewaar deze e-mail buiten de mailbox van het portaal (bv. een map in de cloud).";
    const r = await backupmail.send({
      to, subject: (big ? "⚠ FAMO back-up te groot voor e-mail — " : "FAMO back-up ") + day, text,
      attachment: big ? null : { filename: "famo-backup-" + day + ".json.gz", content: buf.toString("base64") },
      idempotencyKey: "famo-backup-" + day
    });
    const ok = !!r.ok && !big && rt.ok;
    const fout = !rt.ok ? "terugzet-test: " + rt.error : r.ok ? (big ? "te groot voor e-mail" : "") : (r.error || r.skipped || "");
    if (store) await backup.recordRun(store, { ok, big, size, sha256: sha, error: fout });
    if (!ok) await alarm.alert("back-up", "De nachtelijke back-up is niet in orde: " + fout + ". Zie Beheer → Systeemstatus.");
    L[ok ? "info" : "error"]("nachtelijke back-up", { size, big, sent: !!r.ok, records: sum.records, files: sum.files, err: r.ok ? undefined : (r.error || r.skipped) });
    return res.status(ok ? 200 : 502).json({ ok, sent: !!r.ok, big, size, summary: sum, error: r.ok ? undefined : (r.error || r.skipped) });
  } catch (e) {
    L.error("nachtelijke back-up mislukt", { err: e });
    if (store) { try { await backup.recordRun(store, { ok: false, size, sha256: sha, error: e.message || String(e) }); } catch (e2) { /* trace impossible : le log suffit */ } }
    await alarm.alert("back-up", "De nachtelijke back-up is mislukt: " + String(e.message || e).slice(0, 200));
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};
