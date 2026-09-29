// Relances de paiement (audit H-01) : cron Vercel quotidien (vercel.json → crons), règles dans
// lib/reminders.js. Rien en mode Boekhouder ni tant que Beheer n'a pas coché « Automatische
// betalingsherinneringen ». Protégé par CRON_SECRET comme api/backup-cron.js (fail-closed).
const crypto = require("crypto");
require("../lib/datastore");
const reminders = require("../lib/reminders");
const ordermail = require("../lib/ordermail");
const log = require("../lib/log");

function authorized(req) {
  const secret = String(process.env.CRON_SECRET || "");
  const h = (req.headers || {}).authorization || (req.headers || {}).Authorization || "";
  const a = Buffer.from(String(h)), b = Buffer.from("Bearer " + secret);
  return secret.length >= 16 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  const L = log.from(req, "reminders-cron");
  if (!process.env.CRON_SECRET) { L.error("CRON_SECRET ontbreekt : geen herinneringen"); return res.status(500).json({ error: "CRON_SECRET ontbreekt" }); }
  if (!authorized(req)) return res.status(401).json({ error: "Niet toegestaan" });
  try {
    const out = await reminders.run({ portalUrl: ordermail.portalUrl(req) });
    L.info("herinneringen", { sent: out.sent || 0, failed: out.failed || 0, skipped: out.skipped || "" });
    return res.status(200).json(Object.assign({ ok: !out.failed }, out, { details: undefined }));
  } catch (e) {
    L.error("herinneringen mislukt", { err: e });
    return res.status(500).json({ error: "Herinneringen mislukt" });
  }
};
