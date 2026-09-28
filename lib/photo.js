"use strict";
const { Buffer } = require("buffer");
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

// Type réel d'une image d'après ses octets magiques (base64) : "png", "jpeg", "webp",
// "gif" ou "" (inconnu). Seuls les premiers octets sont décodés. Le type annoncé par le
// navigateur ne prouve rien : un HTML/SVG servi ensuite sous image/png serait un piège.
function imageType(b64) {
  let b;
  try { b = Buffer.from(String(b64 || "").slice(0, 24), "base64"); } catch (e) { return ""; }
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString("latin1", 0, 6))) return "gif";
  return "";
}

// Taille décodée d'un base64 (sans le décoder).
function b64Size(b64) {
  const s = String(b64 || "");
  return Math.floor(s.length * 3 / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
}

module.exports = { photoUrl, LOCAL, imageType, b64Size };
