/* global module, self */
// Eenvoudig beheer « Vandaag » (specs/024-eenvoudig-beheer) : règles d'écran PURES, sans DOM. Chargé tel quel
// par la page (window.FamoVandaag, team/vandaag.html) et par les tests Node (require("../assets/vandaag.js")).
//
// Le navigateur ne décide de rien : chaque étape est l'appel /api/updateorder EXISTANT (le serveur vérifie
// l'ordre des étapes, la préparation, le stock, les lots, le numéro FA, les droits) ; ce module dit seulement
// quel bouton montrer, quel appel envoyer et comment revenir d'une étape (correction « terug » existante).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FamoVandaag = api;
})(typeof self !== "undefined" ? self : this, function () {
  const REDEN = "Ongedaan in Vandaag";
  // Groupe d'écran par statut (base en français, écran en néerlandais) ; null = pas à traiter aujourd'hui.
  function group(o) {
    if (!o) return null;
    if (o.statut === "Reçue") return "nieuw";
    if (o.statut === "Prête") return "klaar";
    if (o.statut === "Sortie en livraison") return "onderweg";
    if (o.statut === "Facturée" && o.paiement !== "Payé") return "geleverd";
    return null;
  }
  const GROUPS = ["nieuw", "klaar", "onderweg", "geleverd"];
  const recipientOf = (o) => String((o && o.client) || "").trim() || "Klant";

  // Étape suivante : { key, label, payload } (1 tap) ou { key, label, panel } (un choix d'abord).
  // opts.admin : beheerder (Betaald) ; opts.lotsVerplicht : Configuratie « Lots verplicht ».
  function next(o, opts) {
    const g = group(o), x = opts || {};
    if (g === "nieuw") return x.lotsVerplicht ? { key: "klaar", label: "Klaar", panel: "validate" } : { key: "klaar", label: "Klaar", payload: { statut: "Prête", preparationValidee: true } };
    if (g === "klaar") return { key: "onderweg", label: "Onderweg", payload: { statut: "Sortie en livraison" } };
    if (g === "onderweg") return { key: "geleverd", label: "Geleverd", payload: { statut: "Facturée", deliveryConfirmed: true, recipient: recipientOf(o) } };
    if (g === "geleverd" && x.admin) return { key: "betaald", label: "Betaald", panel: "mode" };
    return null;
  }
  const payPayload = (mode) => ({ paiement: "Payé", modePaiement: mode });
  // Retour arrière juste après un tap ; null = le serveur le refuserait (Geleverd : beheerder seul).
  function undo(key, opts) {
    const x = opts || {};
    if (key === "klaar" || key === "onderweg") return { correction: "terug", reden: REDEN };
    if (key === "geleverd") return x.admin ? { correction: "terug", reden: REDEN } : null;
    if (key === "betaald") return x.admin ? { paiement: "En attente", reden: REDEN } : null;
    return null;
  }
  // Aantallen wijzigen : avant le départ seulement ; sur Klaar la préparation reste validée (sinon le serveur
  // la remet à valider et « Onderweg » serait refusé).
  function editPayload(o, lignes) {
    const g = group(o);
    if (g === "nieuw") return { lignes };
    if (g === "klaar") return { lignes, preparationValidee: true };
    return null;
  }
  // Tri : le travail d'abord (Nieuw, Klaar, Onderweg), les livrées à encaisser ensuite ; puis leverdag (le plus
  // ancien d'abord : un retard remonte), heure de commande, référence.
  const key = (o) => [group(o) === "geleverd" ? "1" : "0", String(o.day || o.dateLiv || o.date || ""), String(o.date || ""), String(o.ref || "")];
  function cmp(a, b) { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) { if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; } return 0; }
  function list(orders, filter) {
    const f = GROUPS.includes(filter) ? filter : "alle";
    return (orders || []).filter((o) => { const g = group(o); return g && (f === "alle" || g === f); }).sort(cmp);
  }
  function counts(orders) {
    const out = { alle: 0, nieuw: 0, klaar: 0, onderweg: 0, geleverd: 0 };
    (orders || []).forEach((o) => { const g = group(o); if (g) { out[g]++; out.alle++; } });
    return out;
  }
  // En retard : leverdag passée et pas encore livrée.
  const late = (o, today) => { const g = group(o); return (g === "nieuw" || g === "klaar" || g === "onderweg") && !!o.day && o.day < today; };
  // Contact : numéro belge → wa.me (indicatif 32) ; lien tel: sans espaces.
  function waLink(tel) {
    let d = String(tel || "").replace(/[^\d+]/g, "");
    if (!d) return "";
    if (d.startsWith("+")) d = d.slice(1); else if (d.startsWith("00")) d = d.slice(2); else if (d.startsWith("0")) d = "32" + d.slice(1);
    return /^\d{8,15}$/.test(d) ? "https://wa.me/" + d : "";
  }
  const telHref = (tel) => { const d = String(tel || "").replace(/[^\d+]/g, ""); return d ? "tel:" + d : ""; };

  // ---- Meldingen (specs/025-pushmeldingen) : état de CET appareil, sans DOM ---------------------------------
  // env : { ios, standalone, sw, push, notification, permission, server } (server : le serveur confirme que cet
  // appareil est inscrit avec la clé actuelle). iPhone/iPad dans Safari sans app sur l'écran d'accueil : Apple
  // n'envoie rien à un onglet, il faut d'abord installer FAMO (même si le navigateur expose déjà PushManager).
  function pushState(env) {
    const e = env || {};
    if (e.ios && !e.standalone) return "installeren";
    if (!e.sw || !e.push || !e.notification) return "geen";
    if (e.permission === "denied") return "geweigerd";
    return e.permission === "granted" && e.server === true ? "aan" : "uit";
  }
  // iPadOS se présente comme un Mac : « MacIntel » avec écran tactile.
  const isIos = (ua, platform, touchPoints) => /iPhone|iPad|iPod/.test(String(ua || "")) || (platform === "MacIntel" && Number(touchPoints) > 1);
  // Clé publique VAPID (base64url) → octets pour pushManager.subscribe({ applicationServerKey }).
  function keyBytes(b64u) {
    const s = String(b64u || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // L'abonnement du navigateur (options.applicationServerKey) a-t-il été fait avec cette clé ? Inconnu → oui (le serveur tranche).
  function sameKey(buf, b64u) {
    if (!buf) return true;
    const a = new Uint8Array(buf), b = keyBytes(b64u);
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }

  return { group, GROUPS, next, payPayload, undo, editPayload, list, counts, late, recipientOf, waLink, telHref, REDEN, pushState, isIos, keyBytes, sameKey };
});
