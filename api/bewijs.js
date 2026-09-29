require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Preuve de livraison prise sur place (audit H-09) : signature du réceptionnaire (PNG)
// et photo facultative (JPEG), ajoutées au champ « Preuve de livraison » de la commande.
//
//   POST /api/bewijs  { id, soort: "handtekening" | "foto", contentType, base64 }
//
// Toujours APRÈS la confirmation de réception (api/updateorder) : une preuve qui échoue ne
// fait jamais perdre la livraison. Rejouable (file hors ligne) : une deuxième signature ou
// photo pour la même commande répond 200 { al: true } sans rien ajouter.
// Les fichiers sont servis par /api/foto au personnel seulement (voir api/foto.js).
const { at, REC } = require("../lib/airtable");
const __auth = require("../lib/staffauth");
const __journal = require("../lib/journal");
const { imageType, b64Size } = require("../lib/photo");

const BASE = "appcdduLth9iGX8I0";
const FIELD = "Preuve de livraison";
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 6;
const SOORTEN = { handtekening: ["image/png"], foto: ["image/jpeg", "image/png", "image/webp"] };
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
  return body && typeof body === "object" ? body : {};
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST toegestaan" });
  if (!__auth.hasCode()) return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  if (!(await __auth.staffSession(req))) return res.status(401).json({ error: "Ongeldige personeelscode" });
  const body = parseBody(req);
  const id = String(body.id || "");
  if (!REC.test(id)) return res.status(400).json({ error: "Bestelling-id ontbreekt of is ongeldig" });
  const soort = String(body.soort || "");
  if (!SOORTEN[soort]) return res.status(400).json({ error: "Onbekend soort bewijs" });
  const type = String(body.contentType || "");
  if (!SOORTEN[soort].includes(type)) return res.status(400).json({ error: soort === "handtekening" ? "Een handtekening moet een PNG zijn" : "Enkel JPEG, PNG of WebP" });
  const data = String(body.base64 || "").replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) return res.status(400).json({ error: "Ongeldig bestand" });
  if (b64Size(data) > MAX_BYTES) return res.status(413).json({ error: "Bestand te groot (max 5 MB)" });
  // Le type annoncé ne prouve rien : les premiers octets doivent être ceux d'une vraie image du même type.
  if (imageType(data) !== type.slice(6)) return res.status(400).json({ error: "Dit bestand is geen geldige afbeelding van het opgegeven type" });

  const cur = await at(`Commandes/${id}`);
  if (cur.error) {
    const nf = cur.error.type === "NOT_FOUND" || /not found/i.test(String(cur.error.message || ""));
    return res.status(nf ? 404 : 500).json({ error: nf ? "Bestelling niet gevonden" : "Bestelling onleesbaar" });
  }
  const f = cur.fields || {};
  const uitz = String(f["Uitzondering levering"] || "");
  // Livrée (confirmée) ou non livrée avec une exception à la porte (absent, refusé) : la preuve documente les deux.
  if (!f["Livraison confirmée"] && uitz !== "Geweigerd" && uitz !== "Afwezig") {
    return res.status(409).json({ error: "Bevestig eerst de ontvangst van de levering" });
  }
  const files = Array.isArray(f[FIELD]) ? f[FIELD] : [];
  if (files.some(a => a && String(a.filename || "").startsWith(soort + "-"))) return res.status(200).json({ ok: true, al: true, soort });
  if (files.length >= MAX_FILES) return res.status(409).json({ error: "Er zijn al genoeg bewijsstukken bij deze bestelling" });

  const ref = String(f["Référence"] || id).replace(/[^\w.-]+/g, "-").slice(0, 40);
  const filename = soort + "-" + ref + "." + EXT[type];
  // Même chemin que les photos produit (api/onboarding) : content-API d'Airtable, servie par
  // lib/at-engine.js sur Postgres/SQLite (le fichier s'ajoute au champ).
  const r = await fetch(`https://content.airtable.com/v0/${BASE}/${id}/${encodeURIComponent(FIELD)}/uploadAttachment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN || ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: type, filename, file: data })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    console.error("[bewijs]", id, r.status, j.error && (j.error.type || j.error));
    return res.status(500).json({ error: "Bewijs bewaren mislukt" });
  }
  await __journal.log({ wie: __auth.actorOf(req), rol: __auth.roleOf(req), actie: soort === "handtekening" ? "Leveringsbewijs: handtekening" : "Leveringsbewijs: foto",
    object: "Commandes", record: id, referentie: f["Référence"] || "", wijzigingen: [{ veld: FIELD, voor: String(files.length), na: String(files.length + 1) }], reden: "" });
  await require("../lib/revision").bump();
  return res.status(200).json({ ok: true, soort, filename });
}

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  try { return await handler(req, res); }
  catch (e) {
    console.error("[bewijs]", e && e.message || e);
    return res.status(500).json({ error: "Bewijs bewaren mislukt. Probeer opnieuw." });
  }
};
