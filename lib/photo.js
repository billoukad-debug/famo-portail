"use strict";
const { Buffer } = require("buffer");
// Photo d'un produit (champ pièce jointe « Foto ») : l'URL à afficher, ou "".
// Deux sources acceptées, rien d'autre (jamais de data: ni de lien arbitraire) :
//   - Airtable : lien https (vignette « large » si elle existe), qui expire après
//     quelques heures : relu à chaque ouverture, jamais stocké ;
//   - base Postgres/SQLite : /api/foto?id=att…, servi par le portail (api/foto.js).
const LOCAL = /^\/api\/foto\?id=att[A-Za-z0-9]{14}$/;

// URL sûre d'une pièce jointe image, ou "".
function safeUrl(a) {
  if (!a || !/^image\//i.test(String(a.type || ""))) return "";
  const url = String((a.thumbnails && a.thumbnails.large && a.thumbnails.large.url) || a.url || "");
  return /^https:\/\//i.test(url) || LOCAL.test(url) ? url : "";
}

// Toutes les vues d'un produit (spec 018 : jusqu'à 6, la première = photo principale), dans l'ordre
// du champ ; une pièce jointe qui n'est pas une image ou dont l'URL n'est pas sûre est sautée.
function photoList(attachments) {
  return (Array.isArray(attachments) ? attachments : []).map((a) => ({ id: String((a && a.id) || ""), url: safeUrl(a) })).filter((f) => f.url);
}
function photoUrls(attachments) { return photoList(attachments).map((f) => f.url); }
// La photo principale (la première image sûre) : comportement d'avant.
function photoUrl(attachments) { return photoUrls(attachments)[0] || ""; }

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

module.exports = { photoUrl, photoUrls, photoList, LOCAL, imageType, b64Size };
