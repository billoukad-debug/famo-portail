require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Bestellingen → « Te controleren » (specs/020-bestellen-per-mail) : e-mails que le serveur n'a pas
// transformés seul en commande. Personnel et beheerder (session staff).
//   GET  /api/mailcontrole          → { items, afgehandeld, products, clients }
//   GET  /api/mailcontrole?count=1  → { count, ids } (pastille de la navigation)
//   POST { action: "create", id, clientId, lines:[{productId, qty, comment}], dateLivraison, notes }
//   POST { action: "ignore", id, reden }
//   POST { action: "analyse", id, clientId }  (relire avec Claude pour le client choisi)
// Le serveur revérifie tout à la création (client, articles actifs, quantités, jour livrable, prix).
const __auth = require("../lib/staffauth");
const mailorder = require("../lib/inbound/mailorder");
const log = require("../lib/log");

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  if (!__auth.hasCode()) return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  const L = log.from(req, "mailcontrole");
  try {
    if (!(await __auth.staffSession(req))) return res.status(401).json({ error: "Ongeldige personeelscode" });
    if (req.method === "GET") {
      if (req.query && req.query.count) { const ids = await mailorder.openIds(); return res.status(200).json({ count: ids.length, ids }); }
      return res.status(200).json(await mailorder.listForStaff());
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Gebruik GET of POST." });
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
    body = body && typeof body === "object" ? body : {};
    const who = { wie: __auth.actorOf(req) || "personeel", rol: __auth.roleOf(req) || "", req };
    const run = { create: mailorder.createFromQueue, ignore: mailorder.ignoreFromQueue, analyse: mailorder.reanalyse }[String(body.action || "")];
    if (!run) return res.status(400).json({ error: "Onbekende actie" });
    const out = await run(body, who);
    if (out.status === 200) L.info("mailcontrole " + body.action, { recId: String(body.id || "").slice(0, 40), ref: out.body.ref });
    return res.status(out.status).json(out.body);
  } catch (e) {
    L.error("mailcontrole mislukt", { err: e });
    return res.status(500).json({ error: "Serverfout. Probeer opnieuw." });
  }
};
