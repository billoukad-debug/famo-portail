// Envoi d'e-mails transactionnels via l'API HTTP de Resend.
//
// Contrat de sécurité et de robustesse :
// - Sans RESEND_API_KEY, le module est INERTE : aucun appel réseau n'est émis.
//   La séquence d'appels d'une commande reste alors strictement identique à
//   celle d'avant l'ajout des e-mails.
// - send() ne jette JAMAIS. Un e-mail est une notification, pas une transaction :
//   il ne doit pas pouvoir transformer une commande déjà enregistrée en erreur.
// - La clé n'apparaît jamais dans un log.
//
// Pas de dépendance npm (le dépôt n'a ni package.json ni node_modules) :
// on parle directement à l'API REST avec fetch.
const API_URL = "https://api.resend.com/emails";
const KEY = String(process.env.RESEND_API_KEY || "").trim();
const FROM = String(process.env.MAIL_FROM || "").trim() || "Famo Trading <onboarding@resend.dev>";
const TIMEOUT_MS = Number(process.env.MAIL_TIMEOUT_MS) > 0 ? Number(process.env.MAIL_TIMEOUT_MS) : 4000;

/** Même règle que api/signup.js : validation volontairement permissive. */
function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

/** L'envoi est-il configuré ? Si non, rien ne part et rien n'est tenté. */
function enabled() {
  return !!KEY;
}

function recipients(to) {
  const list = Array.isArray(to) ? to : [to];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const value = String(raw || "").trim();
    const key = value.toLowerCase();
    if (isEmail(value) && !seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * Envoie un e-mail. Ne jette jamais.
 * @returns {Promise<{ok:boolean, id?:string, skipped?:string, status?:number, error?:string}>}
 */
async function send(message) {
  const msg = message || {};

  // Court-circuit AVANT tout fetch : c'est ce qui garantit l'inertie complète.
  if (!enabled()) return { ok: false, skipped: "disabled" };

  const to = recipients(msg.to);
  if (!to.length) return { ok: false, skipped: "no-recipient" };

  const subject = String(msg.subject || "").trim();
  if (!subject) return { ok: false, skipped: "no-subject" };

  const payload = {
    from: FROM,
    to,
    subject,
    html: String(msg.html || ""),
    text: String(msg.text || "")
  };
  // Attention : l'API Resend attend reply_to en snake_case. Un replyTo en
  // camelCase est ignoré silencieusement — on enverrait des e-mails auxquels
  // personne ne peut répondre.
  if (isEmail(msg.replyTo)) payload.reply_to = String(msg.replyTo).trim();

  const headers = {
    Authorization: "Bearer " + KEY,
    "Content-Type": "application/json"
  };
  if (msg.idempotencyKey) headers["Idempotency-Key"] = String(msg.idempotencyKey);

  try {
    const options = { method: "POST", headers, body: JSON.stringify(payload) };
    // AbortSignal.timeout est natif en Node 18+ : pas de setTimeout qui traîne.
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      options.signal = AbortSignal.timeout(TIMEOUT_MS);
    }
    const r = await fetch(API_URL, options);

    // Le harnais de test ne fournit qu'un .json() : toute lecture de r.ok ou
    // r.text() doit être défensive, sinon le comportement diffère entre CI et
    // production.
    const okStatus = typeof r.status === "number" ? r.status >= 200 && r.status < 300 : r.ok !== false;
    if (!okStatus) {
      let detail = "";
      try {
        detail = typeof r.text === "function" ? await r.text() : "";
      } catch (e) { /* corps illisible : on garde le statut */ }
      console.warn("[mail] echec " + (r.status || "?") + " — " + subject + " (" + to.length + " dest.) " + String(detail).slice(0, 200));
      return { ok: false, status: r.status || 0, error: String(detail).slice(0, 200) };
    }

    let body = {};
    try {
      body = typeof r.json === "function" ? await r.json() : {};
    } catch (e) { body = {}; }
    return { ok: true, id: (body && body.id) || "" };
  } catch (e) {
    // Jamais la clé, jamais le HTML : sujet et nombre de destinataires suffisent
    // à diagnostiquer depuis les logs Vercel.
    console.warn("[mail] erreur reseau — " + subject + " (" + to.length + " dest.) " + String(e && e.message || e).slice(0, 200));
    return { ok: false, error: String(e && e.message || e).slice(0, 200) };
  }
}

/** Envoie plusieurs messages en parallèle. Ne rejette jamais (send non plus). */
async function sendAll(messages) {
  return Promise.all((messages || []).map(m => send(m)));
}

module.exports = {
  send,
  sendAll,
  isEmail,
  enabled,
  from: () => FROM
};
