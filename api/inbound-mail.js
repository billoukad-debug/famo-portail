require("../lib/datastore"); // DB_BACKEND : Airtable (défaut) ou Postgres, voir lib/datastore.js
// Webhook Resend « email.received » : bestellen per e-mail (specs/020-bestellen-per-mail).
//
// Pas une page du portail : un serveur (Resend/Svix) appelle cette adresse, sans cookie ni Origin.
// La garde A-10 (lib/guard.js) reste en première ligne comme partout (un navigateur d'un autre site
// est refusé) ; la vraie authentification est la SIGNATURE Svix, vérifiée sur le corps BRUT :
//   - RESEND_INBOUND_SECRET absent ou illisible → 500 (fail-closed, rien n'est lu ni écrit) ;
//   - signature absente, fausse ou horodatage à plus de 5 minutes → 401 ;
//   - même message reçu deux fois → 200 sans seconde commande (lib/inbound/mailorder.js).
// Corps brut, dans cet ordre :
//  1. req.rawBody (serveur de dev, tests) ;
//  2. le flux de la requête s'il est encore lisible — sur Vercel l'aide Node (@vercel/node, addHelpers →
//     readBody → restoreBody) lit le corps puis le REJOUE par req.on("data"/"end") : on le relit ;
//  3. flux déjà consommé (fini, non rejoué) : req.body s'il est un Buffer ou un texte (octets d'origine) ;
//  4. sinon (seulement un objet JSON déjà analysé) : refus 400, fail-closed — une signature ne se
//     vérifie pas sur un JSON re-sérialisé. Ligne de log « ruwe body onbeschikbaar ».
// `config.api.bodyParser = false` n'existe pas pour les fonctions Node simples (Next.js seulement ;
// serverless-handler.mts ne lit aucun `config` du module) : pas d'export de ce genre ici.
const log = require("../lib/log");
const svix = require("../lib/inbound/svix");
const mailorder = require("../lib/inbound/mailorder");
const { Readable } = require("stream");
const http = require("http");

const MAX_BODY = 256 * 1024; // le webhook ne porte que des métadonnées (quelques ko)

// Flux natif terminé (personne ne le rejoue) : attendre « end » ne servirait à rien.
const consumed = (req) => req.readableEnded === true && (req.on === Readable.prototype.on || req.on === http.IncomingMessage.prototype.on);

function readStream(req, ms) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, done = false;
    const finish = (value, error) => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => finish(null), ms);
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) return finish(null, Object.assign(new Error("te groot"), { status: 413 }));
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on("end", () => finish(Buffer.concat(chunks)));
    req.on("error", (e) => finish(null, e));
  });
}

async function rawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === "string") return Buffer.from(req.rawBody, "utf8");
  if (typeof req.on === "function" && !consumed(req)) {
    const b = await readStream(req, 5000);
    if (b) return b;
  }
  const body = req.body; // accès après la lecture du flux (sur Vercel : analyse paresseuse)
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return null;
}

module.exports = async (req, res) => {
  if (require("../lib/guard").blocked(req, res)) return; // A-10 : Origin + JSON sur les requêtes qui modifient
  const L = log.from(req, "inbound-mail");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const secret = String(process.env.RESEND_INBOUND_SECRET || "").trim();
  if (!svix.secretKey(secret)) {
    L.error("RESEND_INBOUND_SECRET ontbreekt of is onleesbaar: inkomende mail geweigerd");
    return res.status(500).json({ error: "Inkomende mail niet geconfigureerd" });
  }
  let raw;
  try { raw = await rawBody(req); } catch (e) { return res.status(e && e.status === 413 ? 413 : 400).json({ error: "Ongeldig verzoek" }); }
  if (!raw) {
    L.error("ruwe body onbeschikbaar (corps brut) : handtekening niet controleerbaar, webhook geweigerd", { type: typeof req.body });
    return res.status(400).json({ error: "Ongeldig verzoek" });
  }
  if (raw.length > MAX_BODY) return res.status(413).json({ error: "Ongeldig verzoek" });
  const v = svix.verify(secret, req.headers, raw);
  if (!v.ok) { L.warn("handtekening geweigerd", { reason: v.reason }); return res.status(401).json({ error: "Ongeldige handtekening" }); }
  let payload;
  try { payload = JSON.parse(raw.toString("utf8")); } catch (e) { return res.status(400).json({ error: "Ongeldige JSON" }); }
  try {
    const out = await mailorder.handleWebhook(payload, { req, svixId: v.id });
    return res.status(out.status).json(out.body);
  } catch (e) {
    // Resend réessaie (5xx) ; l'enregistrement « Verwerken » déjà créé apparaît dans « Te controleren »
    // après 3 minutes : le message n'est jamais perdu.
    L.error("verwerking mislukt", { svixId: v.id, err: e });
    return res.status(500).json({ error: "Verwerking mislukt" });
  }
};
