require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Rapportage (specs/022-rapportage) : données de direction (chiffre d'affaires, clients, produits) — beheerder seul.
//   GET /api/rapportage → { orders, producten, klanten, btwPerProduct, config }
// orders = factures (Facturée) et commandes qui portent une creditnota, SANS les commandes test (lib/testorders.js),
// réduites aux champs du calcul (mêmes valeurs qu'api/allorders.js). Le navigateur agrège (assets/rapport.js, même
// règle de TVA que les documents : assets/vat.js). Lecture seule : rien n'est écrit.
// Le personnel garde api/allorders (?all=1 compris) pour son travail ; les agrégats ne sont servis qu'ici et par
// api/marge.js, au beheerder.
const { at, atAll } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __bill = require("../lib/billing");
const __cn = require("../lib/creditnota");
const __lev = require("../lib/levering");
const __test = require("../lib/testorders");

const json = (raw) => { try { const v = raw ? JSON.parse(raw) : null; return v && typeof v === "object" ? v : null; } catch (e) { return null; } };

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gebruik GET." });
  if (!__auth.hasCode()) return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  try {
    if (!(await __auth.staffSession(req))) return res.status(401).json({ error: "Niet aangemeld" });
    if (!(await __auth.adminSession(req))) return res.status(403).json({ error: "Enkel voor de beheerder" });
    if (res.setHeader) res.setHeader("Cache-Control", "private, no-store");
    const [cmd, cl, cat, conf] = await Promise.all([atAll("Commandes"), atAll("Clients"), atAll("Catalogue"), at(encodeURIComponent("Configuratie") + "?maxRecords=1")]);
    if (cmd.error || cl.error || cat.error) return res.status(500).json({ error: "Gegevens onleesbaar. Probeer opnieuw." });
    const clients = new Map((cl.records || []).map((r) => [r.id, r.fields || {}]));
    const btwPerProduct = {};
    (cat.records || []).forEach((r) => { const t = Number(r.fields["BTW-tarief"]); if (Number.isFinite(t) && t > 0) btwPerProduct[String(r.fields["Produit"] || "").toLowerCase().trim()] = t; });
    const orders = __test.real(cmd.records).map((r) => ({ r, f: r.fields || {}, cns: __cn.list(r.fields || {}) }))
      .filter((x) => x.f["Statut"] === "Facturée" || x.cns.length)
      .map(({ r, f, cns }) => {
        const cid = (f["Client"] || [])[0] || "";
        return {
          id: r.id, ref: f["Référence"] || "", factuurnummer: f["Factuurnummer"] || "", statut: f["Statut"] || "",
          date: f["Date"] || "", dateLiv: f["Date livraison souhaitée"] || "", factureeLe: f["Facturée le"] || "",
          clientId: cid, client: (f["Client"] || []).map((id) => (clients.get(id) || {})["Nom"] || id).join(", "),
          lignes: f["Lignes (produits / quantités)"] || "", total: f["Total"] || 0,
          paiement: f["Statut paiement"] || "En attente", payeLe: f["Payé le"] || "",
          btwRegime: __bill.regimeOf(f, clients.get(cid)), btwFrozen: json(f["BTW per lijn"]),
          creditnotas: cns.map((n) => ({ nummer: n.nummer, lignes: n.lignes, montant: n.montant, le: n.le }))
        };
      });
    const c = ((conf && conf.records || [])[0] || {}).fields || {};
    return res.status(200).json({
      orders,
      producten: (cat.records || []).map((r) => ({ nom: r.fields["Produit"] || "", cat: r.fields["Catégorie"] || "", unit: r.fields["Unité"] || "" })).filter((p) => p.nom),
      klanten: (cl.records || []).map((r) => ({ id: r.id, nom: r.fields["Nom"] || "", regime: __bill.vat.regime(r.fields["Régime TVA"]).key, gearchiveerd: !!r.fields["Gearchiveerd"] })),
      btwPerProduct,
      config: { btwTarief: Number(c["BTW-tarief"]) > 0 ? Number(c["BTW-tarief"]) : 6, betaaltermijnDagen: __lev.rulesFrom(c).betaaltermijn }
    });
  } catch (e) {
    console.error("[rapportage]", e && e.message || e);
    return res.status(500).json({ error: "Serverfout. Probeer opnieuw." });
  }
};
