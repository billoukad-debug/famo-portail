require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
const { atAll, escapeFormula } = require("../lib/airtable");
const log = require("../lib/log");
// Bestellingen van de aangemelde klant. POST {user} + cookie famo_klant -> {orders}.
// Détail suffisant pour une fiche côté client (nota, factuur, betaling, annulation),
// jamais rien d'interne (Correcties, boîte ops, notes préfixées d'une source restent
// visibles telles quelles : ce sont les notes du client lui-même).
const { authRequest, authUnavailable } = require("./catalogue");
const __bill = require("../lib/billing");
const __cn = require("../lib/creditnota");
const __lj = require("../lib/lignesjson");
const { parseLines } = require("./updateorder");
const __test = require("../lib/testorders");
const __lev = require("../lib/levering");
const __rem = require("../lib/reminders");
const __gw = require("../lib/gewoonte"); // « Zoals elke maandag » (specs/036)
const __bestelling = require("../lib/bestelling");
const FB = require("../assets/bestellen.js"); // échéance et reste à payer, même règle que les relances (specs/034) // commandes d'essai archivées : invisibles pour le client (specs/021)

// Ouvert + 365 jours d'historique (voir api/allorders.js).
const WINDOW = `OR(AND({Statut}!='Facturée',{Statut}!='Annulée'),IS_AFTER({Date},DATEADD(TODAY(),-365,'days')))`;

// Filtre client DANS la formule (E-04 : avant, toutes les commandes de la fenêtre étaient
// lues pour n'en garder qu'une poignée). Un champ lien ne se lit pas pareil partout :
//   - Airtable : ARRAYJOIN({Client}) donne le champ primaire des clients liés (« Nom »),
//     jamais leur id -> on cherche le nom ;
//   - moteur SQL (lib/at-engine.js) : il donne les ids (recXXX) -> on cherche l'id,
//     traduit en SQL (strpos/instr sur le JSON du champ).
// Chaque moteur ignore la moitié qui ne le concerne pas. Un nom est un sur-ensemble
// (« Aloha » trouve aussi « Aloha Poke ») : le filtre exact par id reste en JS ci-dessous.
// Client sans nom : pas de filtre de formule (un FIND vide retiendrait tout de toute façon).
function clientFormula(client) {
  const nom = String((client.fields || {})["Nom"] || "").trim();
  if (!nom) return WINDOW;
  return `AND(${WINDOW},OR(FIND('${escapeFormula(client.id)}',ARRAYJOIN({Client})),FIND('${escapeFormula(nom)}',ARRAYJOIN({Client}))))`;
}

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  const L = log.from(req, "orders");
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Gebruik POST. Wachtwoorden horen niet in een URL." });
  }
  try {
    let q = req.body;
    if (typeof q === "string") q = JSON.parse(q || "{}");
    if (!q) q = {};
    const client = await authRequest(req, q, res); // cookie famo_klant (B3), jeton du corps en transition
    if (!client) return res.status(401).json({ error: "Ongeldige gebruikersnaam of wachtwoord" });
    const clientId = client.id;

    const cmd = await atAll(`Commandes?sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc&filterByFormula=${encodeURIComponent(clientFormula(client))}`);
    if (cmd.error) { L.error("commandes illisibles", { recId: clientId, err: cmd.error }); return res.status(500).json({ error: cmd.error.message || "Bestellingen onleesbaar" }); }
    // Montant TVAC par commande (même règle que les documents) : le client ne voit jamais un HT « à payer ».
    const [conf, catl] = await Promise.all([atAll(encodeURIComponent("Configuratie") + "?maxRecords=1"), atAll("Catalogue")]);
    const cf = ((conf.records || [])[0] || {}).fields || {};
    const fallback = __bill.defaultRate(cf), rates = __bill.ratesFromCatalogue(catl.records || []);
    // Échéance et reste à payer (specs/034) : mêmes règles que les relances (lib/reminders.js) — échéance =
    // « Facturée le » (Bruxelles) + Betaaltermijn dagen ; reste = facture TVAC moins les notes de crédit TVAC.
    const rules = __lev.rulesFrom(cf), termijn = rules.betaaltermijn;
    // X3 (specs/036) : une commande « Reçue » se modifie jusqu'à l'heure limite de la veille de sa livraison —
    // la même règle que la commande elle-même (lib/levering.js checkCutoff, tolérance de 15 minutes comprise).
    const aanpasbaar = f => f["Statut"] === "Reçue" && !!f["Date livraison souhaitée"] && !__lev.checkCutoff(f["Date livraison souhaitée"], rules);
    const verval = f => (f["Statut"] === "Facturée" && f["Factuurnummer"] && f["Facturée le"] ? __rem.levelFor(Object.assign({}, f, { "Statut paiement": "" }), termijn, "").verval || "" : "");
    const tvac = f => { const l = parseLines(f["Lignes (produits / quantités)"]); return l.some(x => x.price != null) ? __bill.orderTotals(l, __bill.linesRates(l, f, rates, fallback, __bill.regimeOf(f, client.fields)), fallback).total : __bill.vat.r2((Number(f["Total"]) || 0) * (1 + fallback / 100)); };
    const orders = __test.real(cmd.records)
      .filter(r => (r.fields["Client"] || []).includes(clientId))
      .map(r => ({
        ref: r.fields["Référence"] || "",
        date: r.fields["Date"] || "",
        dateLiv: r.fields["Date livraison souhaitée"] || "",
        lignes: r.fields["Lignes (produits / quantités)"] || "",
        // Lignes rattachées au catalogue par référence (B4, specs/016) pour « Opnieuw bestellen » :
        // productId null = ancienne commande, le portail apparie alors par nom (comme avant).
        items: __lj.linked(r.fields["Lignes (produits / quantités)"], r.fields[__lj.FIELD]).map(l => ({ productId: l.productId, naam: l.nom, qty: l.qty, comment: l.comment || "" })),
        // Conditionnement figé par ligne (specs/023) : « 2 doos · 12 stuks » dans le détail de la commande.
        verpakking: __lj.pakMap(r.fields[__lj.FIELD]),
        total: r.fields["Total"] || 0,
        totalIncl: tvac(r.fields),
        vervaldatum: verval(r.fields),
        openstaand: r.fields["Statut"] === "Facturée" ? __rem.amounts(r.fields, rates, fallback).open : null,
        statut: r.fields["Statut"] || "",
        aanpasbaar: aanpasbaar(r.fields),
        paiement: r.fields["Statut paiement"] || "",
        payeLe: r.fields["Payé le"] || "",
        notes: r.fields["Notes"] || "",
        factuurnummer: r.fields["Factuurnummer"] || "",
        factureeLe: r.fields["Facturée le"] || "",
        livreeLe: r.fields["Livrée le"] || "",
        receptionnePar: r.fields["Réceptionné par"] || "",
        annuleeLe: r.fields["Annulée le"] || "",
        motifAnnulation: r.fields["Motif annulation"] || "",
        uitzondering: r.fields["Uitzondering levering"] || "",
        // Heure de livraison prévue posée par le personnel (D4) : "HH:MM-HH:MM" ou "".
        leverslot: r.fields["Leverslot"] || "",
        creditnota: r.fields["Creditnota nummer"] ? { nummer: r.fields["Creditnota nummer"], montant: Number(r.fields["Creditnota montant"] || 0), le: r.fields["Creditnota le"] || "" } : null,
        // Toutes les notes de crédit (C-08) ; le détail (lignes, motif) vient de /api/klantdoc.
        creditnotas: __cn.list(r.fields).map(n => ({ nummer: n.nummer, montant: n.montant, le: n.le }))
      }));
    const mine = __test.real(cmd.records).filter(r => (r.fields["Client"] || []).includes(clientId));
    const extra = await gewoonteVoor(clientId, mine, rules).catch(e => { L.error("gewoonte", { err: e }); return { gewoonte: null, vaste: [] }; });
    res.status(200).json(Object.assign({ orders, deadline: rules.deadline }, extra));
  } catch (e) {
    if (authUnavailable(res, e)) return;
    // 503 : base injoignable (authClient lève DB_UNAVAILABLE, D-06) — jamais un mauvais mot de passe.
    if (e && e.status === 503) { L.error("database onbereikbaar", { err: e }); return res.status(503).json({ error: "Database tijdelijk onbereikbaar. Probeer opnieuw." }); }
    { L.error("serverfout", { err: e }); res.status(500).json({ error: "Serverfout. Probeer opnieuw." }); }
  }
};
module.exports.clientFormula = clientFormula;

// Commande probable pour le prochain jour de livraison (lib/gewoonte.js) au prix d'AUJOURD'HUI : catalogue actif et
// prix négociés relus, lignes reconstruites par lib/bestelling.js comme une vraie commande (rien du navigateur).
// Une règle qui refuse (conditionnement, produit devenu inactif entre-temps) : pas de carte plutôt qu'une carte fausse.
async function gewoonteVoor(clientId, records, rules) {
  const catalogue = await __bestelling.catalogueFor(clientId);
  const k = FB.klok(rules);
  const vaste = __gw.vaste(records, catalogue.products);
  const p = __gw.probable(records, catalogue.products, k.levering);
  if (!p) return { gewoonte: null, vaste };
  let built;
  try { built = await __bestelling.buildOrderLines(clientId, p.items, __bestelling.MSG_KLANT, { catalogue }); } catch (e) { return { gewoonte: null, vaste }; }
  const items = __lj.parse(built.json).map(e => ({ productId: e.productId, naam: e.naam, qty: e.qty, unit: e.unit, prijs: e.prijs }));
  return { vaste, gewoonte: { levering: k.levering, deadlineDag: k.deadlineDag, deadline: k.deadline, basis: p.basis, n: p.n, weekdag: p.weekdag, items, total: built.total } };
}
module.exports.gewoonteVoor = gewoonteVoor;
