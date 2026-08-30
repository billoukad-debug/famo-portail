const TOKEN = process.env.AIRTABLE_TOKEN;
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
    if (j.error) return res.status(500).json(j);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
