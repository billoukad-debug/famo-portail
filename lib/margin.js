"use strict";
// Marge brute et valeur du stock (audit H-05, H-06, H-11) — beheerder seul (api/marge.js).
//  - Chiffre d'affaires HTVA : lignes des commandes facturées (« Facturée le » dans la période),
//    au prix figé de la ligne ; notes de crédit de la période déduites (date de la note).
//  - Coût : quantité × prix d'achat du lot livré (commande « Lots », H-02) ; à défaut, dernier
//    prix d'achat connu du produit (lot le plus récent avec un prix). Sans prix : ligne comptée
//    dans « zonder kostprijs » et exclue du pourcentage (jamais une marge de 100 % inventée).
//  - Valeur du stock : quantité en stock × dernier prix d'achat connu du produit.
// Estimation de gestion, pas une comptabilité analytique : les écarts de poids, pertes et
// retours au stock ne sont pas valorisés.
const __cn = require("./creditnota");
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const norm = (s) => String(s || "").trim().toLowerCase();

const { parseLines } = require("./lines"); // une seule définition (I-11)
const dayOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Brussels" }).format(d); };
const parseLots = (raw) => { try { const m = typeof raw === "string" ? JSON.parse(raw) : raw; return m && typeof m === "object" && !Array.isArray(m) ? m : null; } catch (e) { return null; } };

// Dernier prix d'achat connu par produit : lot le plus récent (Ontvangen op) avec un prix.
function lastPrices(lots) {
  const best = new Map();
  (lots || []).forEach((r) => {
    const f = r.fields || {}, p = f["Aankoopprijs"];
    if (p === null || p === undefined || p === "" || !Number.isFinite(Number(p))) return;
    const k = norm(f["Produit"]), d = String(f["Ontvangen op"] || "");
    const cur = best.get(k);
    if (!cur || d > cur.d) best.set(k, { d, p: Number(p) });
  });
  return new Map(Array.from(best, ([k, v]) => [k, v.p]));
}

function compute(input) {
  const o = input || {}, van = o.van || "0000-00-00", tot = o.tot || "9999-12-31";
  const byId = new Map((o.lots || []).map((r) => [r.id, r.fields || {}]));
  const last = lastPrices(o.lots);
  const units = new Map((o.catalogue || []).map((r) => [norm((r.fields || {})["Produit"]), (r.fields || {})["Unité"] || ""]));
  const rows = new Map();
  const row = (nom) => { const k = norm(nom); if (!rows.has(k)) rows.set(k, { produit: nom, unit: units.get(k) || "", qty: 0, omzet: 0, kost: 0, omzetMetKost: 0, zonderKost: 0, uitLot: 0 }); return rows.get(k); };
  let credit = 0, orders = 0;
  (o.orders || []).forEach((r) => {
    const f = r.fields || {};
    if (f["Statut"] === "Facturée") {
      const d = dayOf(f["Facturée le"]);
      if (d && d >= van && d <= tot) {
        orders++;
        const lotMap = parseLots(f["Lots"]) || {};
        const lotOf = (nom) => { const k = Object.keys(lotMap).find((x) => norm(x) === norm(nom)); const l = k && lotMap[k] && lotMap[k][0]; const lf = l && byId.get(l.id); return lf && lf["Aankoopprijs"] != null && Number.isFinite(Number(lf["Aankoopprijs"])) ? Number(lf["Aankoopprijs"]) : null; };
        parseLines(f["Lignes (produits / quantités)"]).forEach((l) => {
          if (l.price == null) return;
          const x = row(l.nom), omzet = r2(l.qty * l.price);
          x.qty = Math.round((x.qty + l.qty) * 1000) / 1000; x.omzet = r2(x.omzet + omzet);
          const fromLot = lotOf(l.nom), unit = fromLot != null ? fromLot : (last.has(norm(l.nom)) ? last.get(norm(l.nom)) : null);
          if (unit == null) { x.zonderKost = r2(x.zonderKost + omzet); return; }
          if (fromLot != null) x.uitLot++;
          x.kost = r2(x.kost + l.qty * unit); x.omzetMetKost = r2(x.omzetMetKost + omzet);
        });
      }
    }
    // Toutes les notes de crédit de la commande (C-08), chacune à sa date.
    __cn.list(f).forEach((n) => {
      const d = dayOf(n.le || f["Facturée le"]);
      if (d && d >= van && d <= tot) credit = r2(credit + Number(n.montant || 0));
    });
  });
  const producten = Array.from(rows.values()).map((x) => Object.assign(x, { marge: r2(x.omzetMetKost - x.kost), pct: x.omzetMetKost > 0 ? Math.round((x.omzetMetKost - x.kost) / x.omzetMetKost * 1000) / 10 : null })).sort((a, b) => b.omzet - a.omzet);
  const t = producten.reduce((s, x) => ({ omzet: r2(s.omzet + x.omzet), kost: r2(s.kost + x.kost), omzetMetKost: r2(s.omzetMetKost + x.omzetMetKost), zonderKost: r2(s.zonderKost + x.zonderKost) }), { omzet: 0, kost: 0, omzetMetKost: 0, zonderKost: 0 });
  const marge = r2(t.omzetMetKost - t.kost - credit);
  const voorraad = (o.stock || []).map((r) => {
    const f = r.fields || {}, k = norm(f["Produit"]), q = Number(f["Quantité disponible"] || 0), p = last.has(k) ? last.get(k) : null;
    return { produit: f["Produit"] || "", qty: q, unit: units.get(k) || "", prijs: p, waarde: p == null ? null : r2(Math.max(0, q) * p) };
  }).filter((x) => x.produit).sort((a, b) => (b.waarde || 0) - (a.waarde || 0));
  return {
    van, tot, orders, producten,
    totaal: Object.assign(t, { credit, marge, pct: t.omzetMetKost > 0 ? Math.round(marge / t.omzetMetKost * 1000) / 10 : null }),
    voorraad, voorraadWaarde: r2(voorraad.reduce((s, x) => s + (x.waarde || 0), 0)), voorraadZonderPrijs: voorraad.filter((x) => x.prijs == null && x.qty > 0).length
  };
}

module.exports = { compute, lastPrices, parseLines };
