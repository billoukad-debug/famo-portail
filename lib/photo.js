"use strict";
// Photo d'un produit (champ pièce jointe « Foto ») : l'URL à afficher, ou "".
// Deux sources acceptées, rien d'autre (jamais de data: ni de lien arbitraire) :
//   - Airtable : lien https (vignette « large » si elle existe), qui expire après
//     quelques heures : relu à chaque ouverture, jamais stocké ;
//   - base Postgres/SQLite : /api/foto?id=att…, servi par le portail (api/foto.js).
const LOCAL = /^\/api\/foto\?id=att[A-Za-z0-9]{14}$/;

function photoUrl(attachments) {
  const image = (Array.isArray(attachments) ? attachments : [])
    .find((a) => a && /^image\//i.test(String(a.type || "")));
  if (!image) return "";
  const url = String((image.thumbnails && image.thumbnails.large && image.thumbnails.large.url) || image.url || "");
  return /^https:\/\//i.test(url) || LOCAL.test(url) ? url : "";
}

module.exports = { photoUrl, LOCAL };
