// Santé du portail pour une sonde externe (UptimeRobot, Better Stack…) et Systeemstatus.
// GET ou HEAD, sans authentification, sans aucune donnée personnelle ni secret :
//   200 { ok: true, … }  base joignable ET configuration lisible
//   503 { ok: false, … } sinon (la sonde alerte)
// Contrôles légers : SELECT 1 (SQL) et lecture d'un seul enregistrement Configuratie, un seul
// champ. E-mail : seulement « configuré ou non » (aucun envoi). version = commit déployé.
const ds = require("../lib/datastore");
const { at } = require("../lib/airtable");
const mail = require("../lib/mail");
const log = require("../lib/log");

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout " + ms + " ms")), ms))]);

module.exports = async (req, res) => {
  const L = log.from(req, "health");
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "GET of HEAD" });
  const out = {
    ok: false,
    version: String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "lokaal",
    backend: ds.backend(),
    region: String(process.env.VERCEL_REGION || ""),
    checks: { database: { ok: false, ms: 0 }, config: { ok: false, ms: 0 }, mail: { configured: mail.enabled() && !!String(process.env.MAIL_FROM || "").trim() } },
    time: new Date().toISOString()
  };
  try {
    let t0 = Date.now();
    if (ds.state.store) out.checks.database.ok = await withTimeout(ds.state.store.ping(), 5000);
    else if (ds.backend() !== "airtable") out.checks.database.error = "database niet geconfigureerd";
    out.checks.database.ms = Date.now() - t0;
    t0 = Date.now();
    const conf = await withTimeout(at(`${encodeURIComponent("Configuratie")}?maxRecords=1&fields%5B%5D=${encodeURIComponent("Bedrijfsnaam")}`), 5000);
    out.checks.config.ok = !conf.error && Array.isArray(conf.records);
    if (conf.error) out.checks.config.error = String(conf.error.type || "leesfout");
    out.checks.config.ms = Date.now() - t0;
    // Airtable : la lecture de Configuratie EST le test de la base.
    if (ds.backend() === "airtable") { out.checks.database.ok = out.checks.config.ok; out.checks.database.ms = out.checks.config.ms; }
    if (ds.state.store && ds.state.store.lastSnapshot) {
      const run = await withTimeout(ds.state.store.lastSnapshot("nachtelijk"), 3000).catch(() => null);
      if (run) { let n = {}; try { n = JSON.parse(run.note || "{}"); } catch (e) { n = {}; } out.checks.backup = { at: run.createdTime, ok: !!n.ok, ageHours: Math.round((Date.now() - Date.parse(run.createdTime)) / 3600000) }; }
    }
  } catch (e) {
    if (!out.checks.database.ok) out.checks.database.error = String(e.message || e).slice(0, 120);
    else out.checks.config.error = String(e.message || e).slice(0, 120);
  }
  out.ok = out.checks.database.ok && out.checks.config.ok;
  if (!out.ok) L.error("health : niet gezond", { database: out.checks.database, config: out.checks.config });
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "HEAD") { res.statusCode = out.ok ? 200 : 503; return res.end(); }
  return res.status(out.ok ? 200 : 503).json(out);
};
