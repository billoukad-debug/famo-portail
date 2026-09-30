"use strict";
// Beheer · Prix négociés et périodes — actions de api/onboarding.js (audit I-10).
// Garde, session beheerder et journal d'audit restent dans api/onboarding.js (le seul point d'entrée HTTP).
const { at, atAll, __prices, __guard, REC, clean, statusPayload } = require("./common");

const ACTIONS = ["savePrice", "deletePrice", "saveClientPrices"];

async function run({ res, body, action }) {

  // ---- Prix négocié ----
  if (action === "savePrice") {
    const clientId = clean(body.clientId, 40);
    const productId = clean(body.productId, 40);
    // Champ laissé vide : enregistré vide (le client paie le prix de base), jamais 0.
    const prixVide = body.prix === null || body.prix === undefined || String(body.prix).trim() === "";
    const prix = __prices.negotiatedValue(body.prix);
    if (!clientId || !productId) return res.status(400).json({ error: "Klant en product zijn verplicht" });
    if (!prixVide && prix === null) return res.status(400).json({ error: "Ongeldige prijs" });
    // Période facultative (audit H-07) : prix d'action ou de la semaine, à côté du prix permanent.
    const van = body.van ? __prices.iso(body.van) : "", tot = body.tot ? __prices.iso(body.tot) : "";
    if ((body.van && !van) || (body.tot && !tot)) return res.status(400).json({ error: "Datum: JJJJ-MM-DD" });
    if (van && tot && tot < van) return res.status(400).json({ error: "„Geldig tot” ligt vóór „Geldig van”" });
    if ((van || tot) && prixVide) return res.status(400).json({ error: "Een tijdelijke prijs heeft een bedrag nodig" });
    // Prix négocié suspect (0, < ½ ou > 2 × le prix de base) : confirmation explicite (audit L-04).
    if (!prixVide && body.confirm !== true && REC.test(productId)) {
      const p = await at(`Catalogue/${productId}`);
      const why = __guard.suspiciousPrice(prix, p && p.fields && p.fields["Prix de base"]);
      if (why) return __guard.needConfirm(res, "Controleer deze prijs: " + why + ". Toch opslaan?");
    }

    const all = await atAll(encodeURIComponent("Prix négociés"));
    if (all.error) return res.status(500).json(all);
    const existing = (all.records || []).find(r => {
      const c = r.fields["Client"] || [];
      const p = r.fields["Produit"] || [];
      const per = __prices.periodOf(r.fields);
      return c.includes(clientId) && p.includes(productId) && per.van === van && per.tot === tot;
    });
    const fields = {
      "Client": [clientId],
      "Produit": [productId],
      "Prix négocié": prix === null ? null : Math.round(prix * 100) / 100
    };
    if (van || tot) { fields["Geldig van"] = van || null; fields["Geldig tot"] = tot || null; }
    let saved;
    if (existing) {
      saved = await at(`${encodeURIComponent("Prix négociés")}/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields })
      });
    } else {
      saved = await at(encodeURIComponent("Prix négociés"), {
        method: "POST",
        body: JSON.stringify({ records: [{ fields }] })
      });
    }
    if (saved.error) return res.status(500).json({ error: saved.error.message || "Prijs opslaan mislukt" });
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }

  if (action === "deletePrice") {
    const id = clean(body.id, 40);
    if (!id) return res.status(400).json({ error: "Prijs-id ontbreekt" });
    if (!REC.test(id)) return res.status(400).json({ error: "Ongeldig prijs-id" }); // « ../Clients/rec… » supprimait un client
    const del = await at(`${encodeURIComponent("Prix négociés")}/${id}`, { method: "DELETE" });
    if (del && del.error) return res.status(500).json({ error: del.error.message || "Prijs verwijderen mislukt" });
    return res.status(200).json({ ok: true, ...(await statusPayload()) });
  }

  // ---- Prix négociés d'un client, depuis sa fiche : plusieurs produits en un envoi ----
  // Même règle que savePrice (vide → enregistré vide, 0 → 0). Une seule lecture des
  // accords, puis une écriture par produit, avec un résultat par produit : un prix
  // refusé ou une écriture en échec n'empêche pas les autres d'être enregistrés.
  if (action === "saveClientPrices") {
    const clientId = clean(body.clientId, 40);
    const rows = Array.isArray(body.prices) ? body.prices.slice(0, 200) : [];
    if (!clientId) return res.status(400).json({ error: "Klant is verplicht" });
    if (!rows.length) return res.status(400).json({ error: "Geen prijzen om op te slaan" });
    // Prix suspects de la grille (0, < ½ ou > 2 × le prix de base) : liste à confirmer (audit L-04).
    if (body.confirm !== true && rows.some(r => r && r.prix !== null && r.prix !== undefined && String(r.prix).trim() !== "")) {
      const cat = await atAll("Catalogue");
      const base = new Map((cat.records || []).map(r => [r.id, r.fields["Prix de base"]]));
      const odd = rows.map(r => { const p = __prices.negotiatedValue(r && r.prix); const why = p === null ? "" : __guard.suspiciousPrice(p, base.get(clean(r.productId, 40))); const nm = ((cat.records || []).find(c => c.id === clean(r.productId, 40)) || { fields: {} }).fields["Produit"]; return why ? (nm || "product") + ": " + why : ""; }).filter(Boolean);
      if (odd.length) return __guard.needConfirm(res, "Controleer deze prijzen: " + odd.slice(0, 5).join(" · ") + (odd.length > 5 ? " …" : "") + ". Toch opslaan?");
    }

    const all = await atAll(encodeURIComponent("Prix négociés"));
    if (all.error) return res.status(500).json(all);
    const results = [];
    for (const row of rows) {
      const productId = clean(row && row.productId, 40);
      const raw = row ? row.prix : undefined;
      const prixVide = raw === null || raw === undefined || String(raw).trim() === "";
      const prix = __prices.negotiatedValue(raw);
      if (!productId) { results.push({ productId: "", ok: false, error: "Product ontbreekt" }); continue; }
      if (!prixVide && prix === null) { results.push({ productId, ok: false, error: "Ongeldige prijs" }); continue; }
      const existing = (all.records || []).find(r => {
        const c = r.fields["Client"] || [];
        const p = r.fields["Produit"] || [];
        return c.includes(clientId) && p.includes(productId) && !__prices.isPeriod(__prices.periodOf(r.fields)); // grille = prix permanents
      });
      const fields = {
        "Client": [clientId],
        "Produit": [productId],
        "Prix négocié": prix === null ? null : Math.round(prix * 100) / 100
      };
      try {
        const saved = existing
          ? await at(`${encodeURIComponent("Prix négociés")}/${existing.id}`, { method: "PATCH", body: JSON.stringify({ fields }) })
          : await at(encodeURIComponent("Prix négociés"), { method: "POST", body: JSON.stringify({ records: [{ fields }] }) });
        if (saved && saved.error) results.push({ productId, ok: false, error: saved.error.message || "Prijs opslaan mislukt" });
        else results.push({ productId, ok: true });
      } catch (e) {
        results.push({ productId, ok: false, error: "Prijs opslaan mislukt" });
      }
    }
    return res.status(200).json({ ok: results.every(r => r.ok), results, ...(await statusPayload()) });
  }
  return res.status(400).json({ error: "Onbekende actie" });
}

module.exports = { ACTIONS, run };
