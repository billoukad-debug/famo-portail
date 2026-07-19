const TOKEN = process.env.AIRTABLE_TOKEN;
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

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const client = await authClient(q.user, q.pw);
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    const clientId = client.id;

    const cmd = await atAll(`Commandes?sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc`);
    const orders = (cmd.records || [])
      .filter(r => (r.fields["Client"] || []).includes(clientId))
      .map(r => ({
        ref: r.fields["Référence"] || "",
        date: r.fields["Date"] || "",
        lignes: r.fields["Lignes (produits / quantités)"] || "",
        total: r.fields["Total"] || 0,
        statut: r.fields["Statut"] || "",
        paiement: r.fields["Statut paiement"] || ""
      }));
    res.status(200).json({ orders });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
