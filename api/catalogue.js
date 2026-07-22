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

async function at(path){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.json();
}

async function atAll(path){
  let offset = "", records = [];
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await at(path + (offset ? sep + "offset=" + encodeURIComponent(offset) : ""));
    if (page.error) return page;
    records = records.concat(page.records || []);
    offset = page.offset || "";
  } while (offset);
  return { records };
}

// Authentifie par gebruikersnaam + wachtwoord. Renvoie l'enregistrement client ou null.
async function authClient(user, pw){
  if (!user || !pw) return null;
  const f = encodeURIComponent(`LOWER({Gebruikersnaam})='${String(user).toLowerCase().replace(/'/g, "")}'`);
  const cl = await at(`Clients?filterByFormula=${f}`);
  if (!cl.records || !cl.records.length) return null;
  const rec = cl.records[0];
  const stored = rec.fields["Wachtwoord"];
  if (!stored || String(stored) !== String(pw)) return null;
  return rec;
}
module.exports.authClient = authClient;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Gebruik POST. Wachtwoorden horen niet in een URL." });
  }
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    const rlKey = "login:" + String(q.user || "").toLowerCase();
    if (rateLimited(rlKey, 5, 30000)) {
      return res.status(429).json({ error: "Te veel mislukte pogingen. Wacht 30 seconden en probeer opnieuw." });
    }
    const client = await authClient(q.user, q.pw);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    _rl.delete(rlKey);
    const clientId = client.id;

    const cat = await atAll(`Catalogue?filterByFormula=${encodeURIComponent("{Actif}=1")}`);
    const neg = await atAll(`${encodeURIComponent("Prix négociés")}`);
    const negMap = {};
    (neg.records || []).forEach(r => {
      const cli = r.fields["Client"] || [];
      const prod = r.fields["Produit"] || [];
      if (cli.includes(clientId) && prod.length) negMap[prod[0]] = r.fields["Prix négocié"];
    });
    const products = (cat.records || []).map(r => ({
      id: r.id,
      nom: r.fields["Produit"],
      cat: r.fields["Catégorie"] || "",
      unite: r.fields["Unité"] || "",
      base: r.fields["Prix de base"] || 0,
      prix: (negMap[r.id] != null ? negMap[r.id] : (r.fields["Prix de base"] || 0))
    }));

    res.status(200).json({
      client: { id: clientId, nom: client.fields["Nom"], adresse: client.fields["Lieu de livraison"] || "" },
      products
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
module.exports.authClient = authClient;
