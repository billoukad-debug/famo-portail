require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Pushmeldingen (specs/025-pushmeldingen) : une notification sur l'appareil à chaque nouvelle commande.
//
//   GET                                            -> { publicKey } (clé VAPID publique, pour s'inscrire)
//   GET  ?lijst=1                                  -> { toestellen } (beheerder : Beheer → Toegang)
//   POST { action:"subscribe", subscription, sleutel? } -> cet appareil reçoit les notifications
//   POST { action:"unsubscribe", endpoint }        -> plus rien sur cet appareil
//   POST { action:"status", endpoint }             -> { aan } : inscrit, avec la clé actuelle ?
//   POST { action:"test", endpoint }               -> « FAMO · Test » vers CET appareil seulement
//   POST { action:"remove", id }                   -> beheerder : retirer un appareil
//
// Session du personnel obligatoire (cookie), garde Origin + JSON sur chaque POST. La règle (clés, liste blanche,
// envoi) est dans lib/push.js ; le chiffrement et la signature dans lib/webpush.js.
const __auth = require("../lib/staffauth");
const __journal = require("../lib/journal");
const __push = require("../lib/push");

function parseBody(req) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; } }
  return body && typeof body === "object" ? body : {};
}
const isAdmin = async (req) => __auth.adminOk(req) && !!(await __auth.adminSession(req));
const header = (req, k) => String(((req && req.headers) || {})[k] || "");

async function handler(req, res) {
  if (!__auth.hasCode()) return res.status(500).json({ error: "Server niet geconfigureerd: STAFF_CODE ontbreekt." });
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Alleen GET of POST toegestaan" });
  if (!(await __auth.staffSession(req))) return res.status(401).json({ error: "Meld u opnieuw aan." });
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    if (req.query && req.query.lijst) {
      if (!(await isAdmin(req))) return res.status(403).json({ error: "Enkel voor beheerders" });
      return res.status(200).json({ toestellen: await __push.list() });
    }
    const k = await __push.keys();
    if (k.error) return res.status(503).json({ error: k.error });
    return res.status(200).json({ publicKey: k.publicKey });
  }

  const body = parseBody(req);
  const action = String(body.action || "");
  const who = { wie: __auth.actorOf(req), rol: __auth.roleOf(req) || "" };
  const done = (r) => res.status(r.status).json(r.body);
  if (action === "subscribe") {
    const r = await __push.subscribe(body, Object.assign({ ua: header(req, "user-agent") }, who));
    if (r.status === 200 && r.body.nieuw) await __journal.log({ wie: who.wie, rol: who.rol, actie: "Meldingen aangezet", object: __push.TABLE, record: r.body.id, referentie: r.body.toestel, reden: "" });
    return done(r);
  }
  if (action === "unsubscribe") {
    const r = await __push.unsubscribe(body.endpoint);
    if (r.status === 200 && r.body.removed) await __journal.log({ wie: who.wie, rol: who.rol, actie: "Meldingen uitgezet", object: __push.TABLE, record: "", referentie: r.body.toestel, reden: "" });
    return done(r);
  }
  if (action === "status") return res.status(200).json({ ok: true, aan: await __push.isSubscribed(body.endpoint) });
  if (action === "test") return done(await __push.test(body.endpoint));
  if (action === "remove") {
    if (!(await isAdmin(req))) return res.status(403).json({ error: "Enkel voor beheerders" });
    const r = await __push.remove(body.id);
    if (r.status === 200) await __journal.log({ wie: who.wie, rol: who.rol, actie: "Meldingstoestel verwijderd", object: __push.TABLE, record: String(body.id), referentie: r.body.toestel, reden: "" });
    return done(r);
  }
  return res.status(400).json({ error: "Onbekende actie" });
}

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  try { return await handler(req, res); }
  catch (e) {
    console.error("[push]", e && e.message || e);
    return res.status(500).json({ error: "Meldingen: serverfout. Probeer opnieuw." });
  }
};
