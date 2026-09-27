"use strict";
// Envoi de la sauvegarde nocturne (api/backup-cron.js) par l'API Resend, AVEC pièce
// jointe. lib/mail.js ne gère pas les pièces jointes et reste inchangé (4 s de délai,
// pensé pour les notifications) : ici un seul envoi, gros, qui peut prendre du temps.
//
// Limite Resend : 40 Mo par e-mail APRÈS encodage base64 -> au-delà de 30 Mo de fichier
// compressé, api/backup-cron.js n'envoie qu'un résumé et demande un téléchargement
// manuel (Beheer → Systeemstatus → Back-up maken).
// Ne jette jamais ; la clé n'apparaît jamais dans un log.
const API_URL = "https://api.resend.com/emails";
// BACKUP_MAX_BYTES : pour les tests (forcer le cas « trop gros ») ; 30 Mo sinon.
const MAX_ATTACHMENT = () => Number(process.env.BACKUP_MAX_BYTES) || 30 * 1024 * 1024;

async function send(msg) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) return { ok: false, skipped: "disabled" };
  const to = (Array.isArray(msg.to) ? msg.to : [msg.to]).map((x) => String(x || "").trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  if (!to.length) return { ok: false, skipped: "no-recipient" };
  const payload = {
    from: String(process.env.MAIL_FROM || "").trim() || "FAMO Seafood <onboarding@resend.dev>",
    to, subject: String(msg.subject || "FAMO back-up"), text: String(msg.text || ""), html: String(msg.html || "")
  };
  if (msg.attachment) payload.attachments = [{ filename: msg.attachment.filename, content: msg.attachment.content }];
  const headers = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
  // Même clé le même jour : un cron rejoué par Vercel n'envoie pas deux fois.
  if (msg.idempotencyKey) headers["Idempotency-Key"] = String(msg.idempotencyKey);
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(Number(process.env.BACKUP_MAIL_TIMEOUT_MS) || 60000) : undefined
    });
    const status = typeof r.status === "number" ? r.status : 200;
    let body = {};
    try { body = await r.json(); } catch (e) { body = {}; }
    if (status < 200 || status >= 300) return { ok: false, status, error: String((body && (body.message || body.name)) || "Resend " + status).slice(0, 200) };
    return { ok: true, id: (body && body.id) || "" };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
}

module.exports = { send, MAX_ATTACHMENT };
