const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = "appcdduLth9iGX8I0";
const MAP = {
  q1: "Q1 - Coordonnées légales",
  q2: "Q2 - Taux TVA",
  q3: "Q3 - Numérotation factures",
  q4: "Q4 - Peppol et comptable",
  q5: "Q5 - Conditions de paiement",
  q6: "Q6 - Clients (nombre et types)",
  q7: "Q7 - Prix négociés",
  q8: "Q8 - Infos par client",
  q9: "Q9 - Utilisateurs côté client",
  q10: "Q10 - Commandes hors ligne",
  q11: "Q11 - Catalogue produits",
  q12: "Q12 - Poids variable",
  q13: "Q13 - Gestion de stock et traçabilité",
  q14: "Q14 - Ruptures et remplacements",
  q15: "Q15 - Mise à jour catalogue",
  q16: "Q16 - Journée type",
  q17: "Q17 - Préparation entrepôt",
  q18: "Q18 - Livraisons",
  q19: "Q19 - Litiges et retours",
  q20: "Q20 - Priorités et budget",
  bonus: "Bonus"
};
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};
    const fields = {
      "Répondant": body.repondant || "",
      "Entreprise": body.entreprise || "",
      "Date": new Date().toISOString().slice(0, 10)
    };
    if (body.email) fields["Email"] = body.email;
    Object.keys(MAP).forEach(k => { if (body[k]) fields[MAP[k]] = body[k]; });
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent("Cadrage projet")}`, {
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
