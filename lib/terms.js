"use strict";
// Conditions générales de vente (audit C-12).
//   Configuratie : « Voorwaarden NL », « Voorwaarden FR » (texte), « Voorwaarden versie ».
//   Clients : « Voorwaarden versie » (version acceptée) et « Voorwaarden aanvaard op ».
//   Aanvragen : « Voorwaarden versie » (version cochée à la demande d'accès).
// Tant qu'aucune version n'est publiée (Beheer → Bedrijf), rien n'est exigé. Une nouvelle
// version publiée doit être acceptée par chaque client avant sa commande suivante (api/order.js).

const MAX = 20000;
const clean = (v) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, MAX);

function current(cfg) {
  const f = cfg || {};
  return { versie: String(f["Voorwaarden versie"] || "").trim(), nl: clean(f["Voorwaarden NL"]), fr: clean(f["Voorwaarden FR"]) };
}

// Le client doit-il (encore) accepter ? false si aucune version publiée.
function needs(clientFields, cfg) {
  const v = current(cfg).versie;
  return !!v && String((clientFields || {})["Voorwaarden versie"] || "") !== v;
}

// Numéro de version : date et heure de Bruxelles à la seconde (lisible, croissant ; deux
// publications dans la même minute donnent bien deux versions à accepter).
function newVersion(now) {
  const d = now ? new Date(now) : new Date();
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d);
  return p;
}

module.exports = { current, needs, newVersion, clean, MAX };
