require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Bijwerken : point d'entrée HTTP unique (garde A-10, session, verrou par commande, journal d'audit).
// Les actions vivent par domaine dans lib/commande/ (dette A6, specs/010-updateorder-numerotation) :
// corrigeren, creditnota, correctiemail, bijwerken (statut, lignes, paiement, départ, facture),
// avec lignes, stock et nummering. require statiques : Vercel (nft) n'embarque que ce qu'il voit.
const { at, REC, __auth, __journal, STATUSES, parseLines, formatLine } = require("../lib/commande/common");
const { applyCorrection } = require("../lib/commande/corrigeren");
const { makeCreditnota } = require("../lib/commande/creditnota");
const { sendCorrectieMail } = require("../lib/commande/correctiemail");
const { update } = require("../lib/commande/bijwerken");
function staffCodeReady(res){
  if (__auth.hasCode()) return true;
  res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt. Stel de omgevingsvariabele in op Vercel." });
  return false;
}

// Double tap sur la même instance : une seule requête à la fois par commande.
// État d'instance : il reste ici (un harnais qui recharge ce fichier simule une autre instance).
const inflight = new Set();

const handler = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST toegestaan" });
  if (!staffCodeReady(res)) return;
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    if (!body) body = {};
    const { id } = body;
    if (!(await __auth.staffSession(req))) return res.status(401).json({ error: "Ongeldige personeelscode" });
    if (!id || !REC.test(String(id))) return res.status(400).json({ error: "Bestelling-id ontbreekt of is ongeldig" });

    if (inflight.has(id)) return res.status(409).json({ error: "Deze bestelling wordt al bijgewerkt. Even geduld." });
    inflight.add(id);
    try { return await handle(req, res, body, id); } finally { inflight.delete(id); }
  } catch (e) {
    console.error("[updateorder]", e && e.message || e);
    res.status(500).json({ error: "Bijwerken mislukt. Probeer opnieuw." });
  }
};

// Aiguillage : chaque requête est traitée par exactement un module de lib/commande/.
async function handle(req, res, body, id){
  const cur = await at(`Commandes/${id}`);
  if (cur.error) return res.status(cur.error.type === "NOT_FOUND" || /not found/i.test(String(cur.error.message || "")) ? 404 : 500).json({ error: cur.error.message || "Bestelling onleesbaar" });
  const f = cur.fields || {};
  // Commande d'essai archivée (specs/021) : plus aucune écriture (stock, numéros, e-mails) tant qu'elle n'est pas remise.
  if (require("../lib/testorders").isTest(f)) return res.status(409).json({ error: require("../lib/testorders").REFUS });
  if (body.correction !== undefined) return applyCorrection(req, res, id, f, body, STATUSES);
  if (body.creditnota && typeof body.creditnota === "object") return makeCreditnota(req, res, id, f, body.creditnota);
  if (body.correctieMail === true) return sendCorrectieMail(req, res, id, f);
  return update(req, res, id, f, body);
}

// Journal d'audit (lib/journal.js, moteur SQL) : chaque action réussie sur une commande, qui,
// quand, et chaque champ avant → après (lignes, prix, statut, paiement, corrections…).
module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); } catch (e) { body = {}; }
  const id = REC.test(String(body.id || "")) ? String(body.id) : "";
  const before = id && __journal.store() ? await __journal.get("Commandes", id) : null;
  await handler(req, res);
  if (res.statusCode === 200) await require("../lib/revision").bump();
  if (!before || res.statusCode !== 200) return;
  const after = await __journal.get("Commandes", id);
  const actie = body.correction ? "Correctie: " + body.correction : body.creditnota ? "Creditnota" : body.correctieMail === true ? "Correctiemail" : body.paiement ? "Betaalstatus: " + body.paiement
    : body.statut ? "Status → " + body.statut : typeof body.lignes === "string" ? "Lijnen gewijzigd" : body.volgorde !== undefined ? "Volgorde levering" : body.leverslot !== undefined ? "Leverslot" : "Bestelling bijgewerkt";
  await __journal.log({ wie: __auth.actorOf(req), rol: __auth.roleOf(req), actie, object: "Commandes", record: id, referentie: (after || before)["Référence"] || "",
    wijzigingen: __journal.diff(before, after), reden: body.reden || (body.creditnota && body.creditnota.motif) || body.uitzonderingNota || "" });
};
module.exports.parseLines = parseLines;
module.exports.formatLine = formatLine;
