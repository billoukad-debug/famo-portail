"use strict";
// Alertes d'exploitation (specs/026, US1) : e-mail à la boîte ops (BACKUP_EMAIL, sinon Configuratie →
// « Bestellingen e-mail ») + pushmelding (spec 025) aux appareils inscrits. Une par type et par heure
// (clé d'idempotence Resend). Jamais de données client dans le texte. Ne jette jamais.
const { at } = require("./airtable");
const backupmail = require("./backupmail");
const mail = require("./mail");
const log = require("./log");

function message(type, text, now) {
  const d = (now || new Date()).toISOString();
  return { subject: "⚠ FAMO alarm — " + type + " (" + d.slice(0, 16).replace("T", " ") + " UTC)", text: "FAMO Portail — alarm « " + type + " »\n\n" + text + "\n\nWat te doen: docs/RUNBOOK.md § 11.", idempotencyKey: "famo-alarm-" + type + "-" + d.slice(0, 13) };
}
async function recipient() {
  const env = String(process.env.BACKUP_EMAIL || "").trim();
  if (env) return env;
  const conf = await at(`${encodeURIComponent("Configuratie")}?maxRecords=1`).catch(() => ({}));
  return String((((conf && conf.records) || [])[0] || {}).fields && conf.records[0].fields["Bestellingen e-mail"] || "").trim();
}
async function alert(type, text) {
  const m = message(type, text);
  const out = { mail: null, push: null };
  log.error("alarm", "alarm: " + type, { type });
  try {
    if (mail.enabled()) { const to = await recipient(); if (to) out.mail = await backupmail.send({ to, subject: m.subject, text: m.text, idempotencyKey: m.idempotencyKey }); }
  } catch (e) { out.mail = { ok: false, error: String(e.message || e) }; }
  try { out.push = await require("./push").sendAll({ title: "FAMO · Alarm", body: type + ": " + String(text).slice(0, 120), url: "/beheer#/status", tag: "alarm-" + type }); }
  catch (e) { out.push = null; }
  return out;
}
module.exports = { message, alert };
