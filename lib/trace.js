"use strict";
// Traçabilité des produits de la pêche (audit C-13).
//   Règl. (CE) 178/2002 art. 18 : un pas en amont (qui a fourni le lot) et un pas en aval (à qui
//   il a été livré), disponibles sur demande de l'AFSCA.
//   Règl. (UE) 1379/2013 art. 35 : dénomination commerciale et nom scientifique, méthode de
//   production, zone de capture (FAO) ou pays d'élevage, engin de pêche, mention « décongelé »,
//   date de durabilité.
// Le lot choisi à la préparation est copié (instantané) dans la commande : corriger une fiche de
// lot plus tard ne réécrit jamais un bon de livraison déjà remis.

const METHODS = ["Gevangen op zee", "Gevangen in zoet water", "Gekweekt"];
const iso = (v) => { const s = String(v || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T12:00:00Z").getTime()) ? s : ""; };
const txt = (v, n) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim().slice(0, n || 120);

// Champs d'un lot depuis le corps d'une requête ; renvoie { fields } ou { error }.
function lotFields(b) {
  const f = {
    "Lotnummer": txt(b.lotnummer, 60), "Produit": txt(b.produit, 120), "Leverancier": txt(b.leverancier, 120),
    "Ontvangen op": iso(b.ontvangenOp) || null, "Wetenschappelijke naam": txt(b.wetenschappelijkeNaam, 120),
    "Vangstgebied": txt(b.vangstgebied, 120), "Vistuig": txt(b.vistuig, 120), "Productiemethode": txt(b.productiemethode, 40),
    "Ontdooid": b.ontdooid === true, "THT": iso(b.tht) || null, "Actief": b.actief !== false, "Nota": txt(b.nota, 200)
  };
  const q = b.hoeveelheid === "" || b.hoeveelheid == null ? null : Number(String(b.hoeveelheid).replace(",", "."));
  if (q !== null && !(Number.isFinite(q) && q >= 0)) return { error: "Ongeldige hoeveelheid" };
  f["Hoeveelheid"] = q;
  // Prix d'achat unitaire HTVA (H-05) : beheerder seul (api/lots.js), JAMAIS copié dans la
  // commande (snapshot) : le bon de livraison et le portail client ne doivent pas le voir.
  if (b.aankoopprijs !== undefined) {
    const pr = b.aankoopprijs === "" || b.aankoopprijs == null ? null : Number(String(b.aankoopprijs).replace(",", "."));
    if (pr !== null && !(Number.isFinite(pr) && pr >= 0 && pr <= 5000)) return { error: "Ongeldige aankoopprijs (0 tot 5000 € per eenheid)" };
    f["Aankoopprijs"] = pr === null ? null : Math.round(pr * 100) / 100;
  }
  if (!f["Lotnummer"]) return { error: "Lotnummer is verplicht" };
  if (!f["Produit"]) return { error: "Product is verplicht" };
  if (f["Productiemethode"] && !METHODS.includes(f["Productiemethode"])) return { error: "Productiemethode: " + METHODS.join(", ") };
  if (b.ontvangenOp && !f["Ontvangen op"]) return { error: "Ontvangstdatum: JJJJ-MM-DD" };
  if (b.tht && !f["THT"]) return { error: "THT: JJJJ-MM-DD" };
  return { fields: f };
}

// Instantané d'un lot tel qu'il sera imprimé sur le bon de livraison.
function snapshot(rec) {
  const f = (rec && rec.fields) || {};
  return {
    id: rec.id, lotnummer: f["Lotnummer"] || "", leverancier: f["Leverancier"] || "", ontvangenOp: f["Ontvangen op"] || "",
    wetenschappelijkeNaam: f["Wetenschappelijke naam"] || "", vangstgebied: f["Vangstgebied"] || "", vistuig: f["Vistuig"] || "",
    productiemethode: f["Productiemethode"] || "", ontdooid: !!f["Ontdooid"], tht: f["THT"] || ""
  };
}

const norm = (s) => String(s || "").trim().toLowerCase();

// lots demandés { "produit": "recLot" | ["recLot", …] } → instantanés validés { produit: [ … ] }.
// lines : lignes de la commande ; lotRecs : enregistrements Lots. Renvoie { lots } ou { error }.
function resolve(requested, lines, lotRecs) {
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) return { error: "Ongeldige loten" };
  const byId = new Map((lotRecs || []).map((r) => [r.id, r]));
  const names = new Set((lines || []).map((l) => norm(l.nom || l.name)));
  const out = {};
  for (const [prod, ids] of Object.entries(requested)) {
    if (!names.has(norm(prod))) return { error: "Lot voor een artikel dat niet in de bestelling staat: " + prod };
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).slice(0, 5);
    for (const id of list) {
      const r = byId.get(String(id));
      if (!r) return { error: "Lot niet gevonden: " + id };
      if (norm(r.fields["Produit"]) !== norm(prod)) return { error: "Lot " + (r.fields["Lotnummer"] || id) + " hoort niet bij " + prod };
    }
    if (list.length) out[String(prod)] = list.map((id) => snapshot(byId.get(String(id))));
  }
  return { lots: out };
}

const parseLots = (raw) => { if (!raw) return null; try { const m = typeof raw === "string" ? JSON.parse(raw) : raw; return m && typeof m === "object" && !Array.isArray(m) ? m : null; } catch (e) { return null; } };

module.exports = { METHODS, lotFields, snapshot, resolve, parseLots, norm };
