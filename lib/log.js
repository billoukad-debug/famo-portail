"use strict";
// Journal structuré : une ligne JSON par événement, lisible et filtrable dans les logs
// Vercel (recherche « "ref":"CMD-2026-0042" » ou « "reqId":"fra1::abcd-…" »).
//
// Pourquoi : des console.error("[x]", e) épars ne permettent pas de relier l'erreur
// d'une commande à la requête qui l'a causée. Chaque ligne porte donc :
//   niveau  info | warn | error
//   msg     phrase courte, stable (on la cherche telle quelle)
//   fn      fonction serverless (orders, dbadmin…)
//   reqId   en-tête x-vercel-id (identique à celui du journal des requêtes Vercel)
//   ref, recId, … : tout contexte passé en second argument
//   err     { message, type, status } d'une erreur, jamais son contenu de requête
//
// Utilisation (à adopter dans chaque api/*.js) :
//   const log = require("../lib/log");
//   const L = log.from(req, "updateorder");          // en tête du handler
//   L.info("statut modifié", { ref, recId: id, statut });
//   L.warn("retour de stock non enregistré", { ref, err: e });
//   L.error("écriture refusée", { recId: id, err: r.error });
//   log.error("at-engine", "requête SQL en échec", { err: e });   // hors requête
//
// Les clés qui ressemblent à un secret (mot de passe, code, jeton, clé) sont masquées :
// un log ne doit jamais devenir une fuite.
const SECRET_KEY = /^(code|pw|pin)$|pass|wachtwoord|token|secret|api.?key|authorization|cookie/i;

function errInfo(e) {
  if (!e) return undefined;
  if (typeof e !== "object") return { message: String(e).slice(0, 500) };
  const out = { message: String(e.message || e.type || "fout").slice(0, 500) };
  if (e.type) out.type = String(e.type);
  if (e.status) out.status = e.status;
  if (e.stack && process.env.FAMO_LOG_STACK === "1") out.stack = String(e.stack).split("\n").slice(0, 6).join(" | ");
  return out;
}

function clean(ctx) {
  const out = {};
  for (const [k, v] of Object.entries(ctx || {})) {
    if (v === undefined) continue;
    if (k === "err") { out.err = errInfo(v); continue; }
    out[k] = SECRET_KEY.test(k) ? "***" : (typeof v === "string" ? v.slice(0, 500) : v);
  }
  return out;
}

// Pour les tests : remplacer la sortie (tableau de lignes) sans toucher à console.
let sink = null;
function emit(niveau, fn, msg, ctx, reqId) {
  const line = Object.assign({ niveau, msg: String(msg || ""), fn: fn || "" }, reqId ? { reqId } : {}, clean(ctx), { t: new Date().toISOString() });
  let s;
  try { s = JSON.stringify(line); } catch (e) { s = JSON.stringify({ niveau, msg: String(msg || ""), fn, reqId, t: line.t, note: "contexte non sérialisable" }); }
  if (sink) return sink.push(line);
  if (niveau === "error") console.error(s); else if (niveau === "warn") console.warn(s); else console.log(s);
}

function reqIdOf(req) {
  const h = (req && req.headers) || {};
  return String(h["x-vercel-id"] || h["X-Vercel-Id"] || h["x-request-id"] || "").slice(0, 120);
}

function from(req, fn) {
  const reqId = reqIdOf(req);
  return {
    reqId,
    info: (msg, ctx) => emit("info", fn, msg, ctx, reqId),
    warn: (msg, ctx) => emit("warn", fn, msg, ctx, reqId),
    error: (msg, ctx) => emit("error", fn, msg, ctx, reqId)
  };
}

module.exports = {
  from,
  info: (fn, msg, ctx) => emit("info", fn, msg, ctx, ""),
  warn: (fn, msg, ctx) => emit("warn", fn, msg, ctx, ""),
  error: (fn, msg, ctx) => emit("error", fn, msg, ctx, ""),
  errInfo,
  _setSink(s) { const prev = sink; sink = s; return prev; }
};
