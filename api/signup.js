const TOKEN = process.env.AIRTABLE_TOKEN;
const __ordermail = require("../lib/ordermail");
// Anti-abus minimal (memoire d'instance, best-effort sur serverless).
const _rl = new Map();
function rateLimited(key, max, windowMs){
  const now = Date.now();
  const e = _rl.get(key) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++; _rl.set(key, e);
  return e.n > max;
}

const BASE = "appcdduLth9iGX8I0";

function clean(s, max){
  return String(s || "").trim().slice(0, max || 200);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const ip = String((req.headers["x-forwarded-for"] || "unknown")).split(",")[0].trim();
    if (rateLimited("signup:" + ip, 5, 3600000)) {
      return res.status(429).json({ error: "Te veel aanvragen vanaf dit toestel. Probeer later opnieuw of bel ons." });
    }

    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};

    const bedrijfsnaam = clean(body.bedrijfsnaam, 120);
    const contactpersoon = clean(body.contactpersoon, 120);
    const email = clean(body.email, 120);
    const telefoon = clean(body.telefoon, 40);
    const adres = clean(body.adres, 250);
    const notities = clean(body.notities, 500);

    if (!bedrijfsnaam || !contactpersoon || !email || !telefoon) {
      return res.status(400).json({ error: "Bedrijfsnaam, contactpersoon, e-mail en telefoon zijn verplicht" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ongeldig e-mailadres" });
    }

    const fields = {
      "Bedrijfsnaam": bedrijfsnaam,
      "Contactpersoon": contactpersoon,
      "Email": email,
      "Telefoon": telefoon,
      "Adres": adres,
      "Notities": notities,
      "Status": "Nieuw"
    };

    const r = await fetch(`https://api.airtable.com/v0/${BASE}/Aanvragen`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields }] })
    });
    const j = await r.json();
    if (j.error) return res.status(500).json({ error: "Aanvraag opslaan mislukt. Bel ons." });
    // L'équipe est prévenue par e-mail ; sans clé mail rien ne part, la demande est quand même enregistrée.
    let mail = null;
    if (__ordermail.enabled()) {
      mail = await (async () => {
        const cfg = await __ordermail.loadMailConfig(async p => (await fetch(`https://api.airtable.com/v0/${BASE}/${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json());
        return __ordermail.notifySignup({ aanvraag: { bedrijfsnaam, contact: contactpersoon, tel: telefoon, email, adresse: adres, notities }, opsEmail: cfg.opsEmail, company: cfg, portalUrl: __ordermail.portalUrl(req), at: Date.now() });
      })().catch(() => null);
    }
    res.status(200).json({ ok: true, mail: mail ? !!mail.ok : null });
  } catch (e) {
    console.error("[signup]", e && e.message || e);
    res.status(500).json({ error: "Aanvraag versturen mislukt. Probeer later opnieuw of bel ons." });
  }
};
