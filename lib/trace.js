"use strict";
// Traçabilité des produits de la pêche (audit C-13, specs/035).
//   Règl. (CE) 178/2002 art. 18 : un pas en amont (qui a fourni le lot) et un pas en aval (à qui
//   il a été livré), disponibles sur demande de l'AFSCA.
//   Règl. (UE) 1379/2013 art. 35 : dénomination commerciale et nom scientifique, méthode de
//   production, zone de capture (FAO) ou pays d'élevage, engin de pêche, mention « décongelé ».
//   Règl. (CE) 1224/2009 art. 58 §5 (version 2023/2842, depuis le 10/01/2026) : par lot, code FAO,
//   identifiant de sortie de pêche ou d'unité aquacole, date de capture, quantité en kg net.
// Le lot choisi à la préparation est copié (instantané) dans la commande, complété par la visfiche du
// produit (assets/visfiche.js) : corriger une fiche de lot ou de produit plus tard ne réécrit jamais un
// bon de livraison déjà remis (TRACE-02). Lot ↔ produit ↔ ligne : par identifiant produit (TRACE-04),
// par nom seulement pour les lots et commandes d'avant.

const VIS = require("../assets/visfiche.js");
const METHODS = VIS.METHODS;
const iso = (v) => { const s = String(v || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T12:00:00Z").getTime()) ? s : ""; };
const txt = (v, n) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim().slice(0, n || 120);
const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));

// Champs d'un lot depuis le corps d'une requête ; renvoie { fields } ou { error }.
// before : champs actuels du lot (modification) — une ancienne saisie libre de zone ou d'engin, gardée
// telle quelle, reste acceptée ; toute nouvelle valeur vient de la liste fermée.
function lotFields(b, before) {
  const prev = before || {};
  const f = {
    "Lotnummer": txt(b.lotnummer, 60), "Produit": txt(b.produit, 120), "Leverancier": txt(b.leverancier, 120),
    "Ontvangen op": iso(b.ontvangenOp) || null, "Wetenschappelijke naam": txt(b.wetenschappelijkeNaam, 120),
    "Vangstgebied": txt(b.vangstgebied, 120), "Vistuig": txt(b.vistuig, 120), "Productiemethode": txt(b.productiemethode, 40),
    "Ontdooid": b.ontdooid === true, "THT": iso(b.tht) || null, "Actief": b.actief !== false, "Nota": txt(b.nota, 200),
    // specs/035 (art. 58 §5) : date de capture ou de récolte, n° de sortie / jour de pêche ou d'unité aquacole.
    "Vangstdatum": iso(b.vangstdatum) || null, "Vangst-id": txt(b.vangstId, 80)
  };
  const q = num(b.hoeveelheid);
  if (q !== null && !(Number.isFinite(q) && q >= 0)) return { error: "Ongeldige hoeveelheid" };
  f["Hoeveelheid"] = q;
  const kg = num(b.nettoKg);
  if (kg !== null && !(Number.isFinite(kg) && kg >= 0 && kg <= 100000)) return { error: "Ongeldig netto gewicht (kg)" };
  f["Netto kg"] = kg === null ? null : Math.round(kg * 1000) / 1000;
  // Prix d'achat unitaire HTVA (H-05) : beheerder seul (api/lots.js), JAMAIS copié dans la
  // commande (snapshot) : le bon de livraison et le portail client ne doivent pas le voir.
  if (b.aankoopprijs !== undefined) {
    const pr = num(b.aankoopprijs);
    if (pr !== null && !(Number.isFinite(pr) && pr >= 0 && pr <= 5000)) return { error: "Ongeldige aankoopprijs (0 tot 5000 € per eenheid)" };
    f["Aankoopprijs"] = pr === null ? null : Math.round(pr * 100) / 100;
  }
  if (!f["Lotnummer"]) return { error: "Lotnummer is verplicht" };
  if (!f["Produit"]) return { error: "Product is verplicht" };
  if (f["Productiemethode"] && !METHODS.includes(f["Productiemethode"])) return { error: "Productiemethode: " + METHODS.join(", ") };
  if (f["Vangstgebied"] && !VIS.isZone(f["Vangstgebied"]) && f["Vangstgebied"] !== txt(prev["Vangstgebied"], 120)) return { error: "Vangstgebied: kies een zone uit de lijst (leeg = zoals bij het product)" };
  if (f["Vistuig"] && !VIS.isGear(f["Vistuig"]) && f["Vistuig"] !== txt(prev["Vistuig"], 120)) return { error: "Vistuig: kies een categorie uit de lijst (leeg = zoals bij het product)" };
  if (b.ontvangenOp && !f["Ontvangen op"]) return { error: "Ontvangstdatum: JJJJ-MM-DD" };
  if (b.tht && !f["THT"]) return { error: "THT: JJJJ-MM-DD" };
  if (b.vangstdatum && !f["Vangstdatum"]) return { error: "Vangstdatum: JJJJ-MM-DD" };
  return { fields: f };
}

// Instantané d'un lot tel qu'il sera imprimé sur le bon de livraison. product : enregistrement
// Catalogue du produit livré (facultatif) — sa visfiche complète ce que le lot ne précise pas.
// Seules les valeurs remplies comptent : un document n'imprime jamais une case vide.
function snapshot(rec, product) {
  const f = (rec && rec.fields) || {};
  const p = VIS.fromFields(product && product.fields);
  const lotZone = f["Vangstgebied"] || "", lotGear = f["Vistuig"] || "";
  const s = {
    id: rec.id, lotnummer: f["Lotnummer"] || "", leverancier: f["Leverancier"] || "", ontvangenOp: f["Ontvangen op"] || "",
    wetenschappelijkeNaam: f["Wetenschappelijke naam"] || p.wetenschappelijkeNaam || "",
    vangstgebied: lotZone || p.vangstgebied || "", vistuig: lotGear || (f["Productiemethode"] === "Gekweekt" ? "" : p.vistuig || ""),
    productiemethode: f["Productiemethode"] || p.productiemethode || "",
    ontdooid: !!f["Ontdooid"] || p.staat === "Ontdooid", tht: f["THT"] || ""
  };
  const extra = { productId: f["Product-id"] || (product && product.id) || "", faoCode: p.faoCode || "", landVanKweek: lotZone ? "" : p.landVanKweek || "", vangstdatum: f["Vangstdatum"] || "", vangstId: f["Vangst-id"] || "" };
  for (const [k, v] of Object.entries(extra)) if (v) s[k] = v;
  return s;
}

// Visfiche du produit figée sur la commande à la préparation (champ Commandes « Productfiche ») :
// { "nom de la ligne": { productId, …visfiche } }, seulement pour les produits qui en ont une.
// lines : lignes avec productId (lib/lignesjson.linked) ; catRecs : enregistrements Catalogue.
function fiches(lines, catRecs) {
  const byId = new Map((catRecs || []).map((r) => [r.id, r]));
  const out = {};
  for (const l of lines || []) {
    const p = productOf(l, byId, catRecs);
    if (!p) continue;
    const v = VIS.fromFields(p.fields);
    if (VIS.isEmpty(v)) continue;
    out[String(l.nom)] = Object.assign({ productId: p.id }, v);
  }
  return out;
}
const productOf = (line, byId, catRecs) => (line.productId && byId.get(String(line.productId))) || (catRecs || []).find((r) => norm(r.fields && r.fields["Produit"]) === norm(line.nom)) || null;

const norm = (s) => String(s || "").trim().toLowerCase();

// lots demandés { "produit": "recLot" | ["recLot", …] } → instantanés validés { produit: [ … ] }.
// lines : lignes de la commande (avec productId si connu) ; lotRecs : Lots ; catRecs : Catalogue
// (facultatif). Un lot rattaché à un produit (Product-id) n'est accepté que pour CE produit, même
// renommé ; un ancien lot sans Product-id reste apparié par nom. Renvoie { lots } ou { error }.
function resolve(requested, lines, lotRecs, catRecs) {
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) return { error: "Ongeldige loten" };
  const byId = new Map((lotRecs || []).map((r) => [r.id, r]));
  const prodById = new Map((catRecs || []).map((r) => [r.id, r]));
  const out = {};
  for (const [prod, ids] of Object.entries(requested)) {
    const line = (lines || []).find((l) => norm(l.nom || l.name) === norm(prod));
    if (!line) return { error: "Lot voor een artikel dat niet in de bestelling staat: " + prod };
    const product = productOf({ nom: line.nom || line.name, productId: line.productId }, prodById, catRecs);
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).slice(0, 5);
    for (const id of list) {
      const r = byId.get(String(id));
      if (!r) return { error: "Lot niet gevonden: " + id };
      const lotPid = r.fields["Product-id"], linePid = line.productId || (product && product.id);
      const ok = lotPid && linePid ? lotPid === linePid : norm(r.fields["Produit"]) === norm(prod);
      if (!ok) return { error: "Lot " + (r.fields["Lotnummer"] || id) + " hoort niet bij " + prod };
    }
    if (list.length) out[String(prod)] = list.map((id) => snapshot(byId.get(String(id)), product));
  }
  return { lots: out };
}

const parseLots = (raw) => { if (!raw) return null; try { const m = typeof raw === "string" ? JSON.parse(raw) : raw; return m && typeof m === "object" && !Array.isArray(m) ? m : null; } catch (e) { return null; } };

module.exports = { METHODS, lotFields, snapshot, fiches, resolve, parseLots, norm };
