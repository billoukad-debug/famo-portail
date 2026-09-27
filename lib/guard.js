"use strict";
// Garde des requêtes qui modifient (POST, PUT, PATCH, DELETE), en tête de chaque handler :
//   if (require("../lib/guard").blocked(req, res)) return;
//
// Pourquoi : la session staff est un cookie (SameSite=Lax). Lax bloque déjà l'envoi du
// cookie sur un POST venu d'un autre site, mais pas d'un sous-domaine « même site », ni
// d'un navigateur ancien. Deux contrôles indépendants, sans dépendance :
//  - sameOrigin : Origin (ou, à défaut, Referer) doit désigner l'hôte de la requête ou
//    PORTAL_URL. Origin « null » (iframe sandbox, Referrer-Policy no-referrer) = refus.
//    Ni Origin ni Referer : ce n'est pas un navigateur (ils envoient Origin sur tout POST,
//    même sur un fetch no-cors) — outils, tests, serveur à serveur, sans cookie de victime.
//    Accepté seulement en JSON ou sans corps typé.
//  - requireJson : un formulaire HTML ou un fetch « simple » (sans pré-vérification CORS)
//    ne peut envoyer que x-www-form-urlencoded, multipart/form-data ou text/plain. Exiger
//    application/json force la pré-vérification CORS, que ce serveur ne valide jamais.
//    Content-Type absent (outils, tests) : accepté, voir ci-dessus.
// Le serveur de dev (scripts/dev-server.js) transmet Host et Origin tels quels : même règle.

function hostOf(url) {
  try { return new URL(String(url)).host.toLowerCase(); } catch (e) { return ""; }
}

function allowedHosts(req) {
  const h = (req && req.headers) || {};
  const out = new Set();
  for (const v of [h["x-forwarded-host"], h.host]) {
    String(v || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean).forEach(x => out.add(x));
  }
  const portal = hostOf(String(process.env.PORTAL_URL || "").trim());
  if (portal) out.add(portal);
  return out;
}

function contentType(req) {
  return String(((req && req.headers) || {})["content-type"] || "").split(";")[0].trim().toLowerCase();
}
const isJsonType = ct => ct === "application/json" || /^application\/[a-z0-9.+-]*\+json$/.test(ct);

/** La requête vient-elle d'une page du portail (ou d'un client non navigateur en JSON) ? */
function sameOrigin(req) {
  const h = (req && req.headers) || {};
  const origin = h.origin;
  if (origin !== undefined && origin !== "") {
    if (String(origin).trim() === "null") return false;
    const host = hostOf(origin);
    return !!host && allowedHosts(req).has(host);
  }
  const ref = h.referer || h.referrer;
  if (ref) {
    const host = hostOf(ref);
    return !!host && allowedHosts(req).has(host);
  }
  const ct = contentType(req);
  return !ct || isJsonType(ct);
}

/** Corps en JSON (ou sans Content-Type : pas un navigateur, voir plus haut). */
function requireJson(req) {
  const ct = contentType(req);
  return !ct || isJsonType(ct);
}

/** true = réponse déjà envoyée (403 origine étrangère, 415 pas du JSON). */
function blocked(req, res) {
  const m = String((req && req.method) || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  if (!sameOrigin(req)) {
    console.warn("[guard] herkomst geweigerd", m, String((req.headers || {}).origin || (req.headers || {}).referer || "").slice(0, 120));
    res.status(403).json({ error: "Verzoek geweigerd: andere herkomst." });
    return true;
  }
  if (m !== "DELETE" && !requireJson(req)) {
    res.status(415).json({ error: "Verzoek moet JSON zijn." });
    return true;
  }
  return false;
}

module.exports = { sameOrigin, requireJson, blocked };
