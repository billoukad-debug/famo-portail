const TOKEN = process.env.AIRTABLE_TOKEN;
const __auth = require("../lib/staffauth");
function staffCodeReady(res){
  if (__auth.hasCode()) return true;
  res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt. Stel de omgevingsvariabele in op Vercel." });
  return false;
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

// Fenêtre par défaut : tout ce qui est ouvert + 365 jours d'historique. Au-delà, le
// quota Airtable (plan gratuit) et le temps de chargement montent avec chaque commande.
// ?all=1 lève la limite (export comptable, recherche ancienne).
const WINDOW_DAYS = 365;
function windowFormula(days){
  return `OR(AND({Statut}!='Facturée',{Statut}!='Annulée'),IS_AFTER({Date},DATEADD(TODAY(),-${days},'days')))`;
}

module.exports = async (req, res) => {
  if (!staffCodeReady(res)) return;
  try {
    if (!__auth.staffOk(req)) return res.status(401).json({ error: "Ongeldige personeelscode" });
    const q = req.query || {};
    const [cl, cat] = await Promise.all([atAll("Clients"), atAll("Catalogue")]);
    const nameById = {}, infoById = {};
    (cl.records || []).forEach(r => {
      nameById[r.id] = r.fields["Nom"] || "";
      infoById[r.id] = {
        nom: r.fields["Nom"] || "",
        adresse: r.fields["Lieu de livraison"] || "",
        btw: r.fields["BTW-nummer"] || "",
        klantnr: r.fields["Klantnummer"] || "",
        // Téléphone et e-mail : le chauffeur appelle, le magasin prévient. Jamais le mot de passe.
        tel: r.fields["Téléphone"] || "",
        email: (r.fields["Email"] || "").trim(),
        gearchiveerd: !!r.fields["Gearchiveerd"]
      };
    });
    // Taux de TVA par produit (nom normalisé) pour les documents ; vide = taux de Configuratie.
    const btwPerProduct = {};
    (cat.records || []).forEach(r => { const t = Number(r.fields["BTW-tarief"]); if (Number.isFinite(t) && t > 0) btwPerProduct[String(r.fields["Produit"] || "").toLowerCase().trim()] = t; });

    const filter = String(q.all || "") === "1" ? "" : "&filterByFormula=" + encodeURIComponent(windowFormula(WINDOW_DAYS));
    const cmd = await atAll("Commandes?sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc" + filter);
    if (cmd.error) return res.status(500).json({ error: cmd.error.message || "Commandes onleesbaar" });
    const orders = (cmd.records || []).map(r => ({
      id: r.id,
      ref: r.fields["Référence"] || "",
      date: r.fields["Date"] || "",
      dateLiv: r.fields["Date livraison souhaitée"] || "",
      client: (r.fields["Client"] || []).map(id => nameById[id] || id).join(", "),
      clientId: (r.fields["Client"] || [])[0] || "",
      klant: infoById[(r.fields["Client"] || [])[0]] || null,
      lignes: r.fields["Lignes (produits / quantités)"] || "",
      total: r.fields["Total"] || 0,
      statut: r.fields["Statut"] || "Reçue",
      paiement: r.fields["Statut paiement"] || "En attente",
      payeLe: r.fields["Payé le"] || "",
      modePaiement: r.fields["Mode de paiement"] || "",
      notes: r.fields["Notes"] || "",
      factuurnummer: r.fields["Factuurnummer"] || "",
      stockAf: !!r.fields["Stock afgeboekt"],
      preparationValidee: !!r.fields["Préparation validée"],
      prepareeLe: r.fields["Préparée le"] || "",
      livreeLe: r.fields["Livrée le"] || "",
      livraisonConfirmee: !!r.fields["Livraison confirmée"],
      receptionnePar: r.fields["Réceptionné par"] || "",
      preuveLivraison: (r.fields["Preuve de livraison"] || []).map(file => ({ url: file.url || "", filename: file.filename || "" })),
      factureeLe: r.fields["Facturée le"] || "",
      annuleeLe: r.fields["Annulée le"] || "",
      motifAnnulation: r.fields["Motif annulation"] || "",
      correcties: r.fields["Correcties"] || "",
      uitzondering: r.fields["Uitzondering levering"] || "",
      uitzonderingNota: r.fields["Uitzondering nota"] || "",
      volgorde: Number.isFinite(Number(r.fields["Volgorde levering"])) && r.fields["Volgorde levering"] !== undefined ? Number(r.fields["Volgorde levering"]) : null,
      creditnota: r.fields["Creditnota nummer"] ? {
        nummer: r.fields["Creditnota nummer"], lignes: r.fields["Creditnota lignes"] || "", montant: Number(r.fields["Creditnota montant"] || 0),
        le: r.fields["Creditnota le"] || "", motif: r.fields["Creditnota motif"] || ""
      } : null
    }));
    res.status(200).json({ orders, btwPerProduct, window: String(q.all || "") === "1" ? 0 : WINDOW_DAYS });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
