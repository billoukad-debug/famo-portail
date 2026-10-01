"use strict";
// Gabarit commun des e-mails (spec 012, audit A10) : lib/ordermail.js et lib/authmail.js.
//
// Contraintes des clients mail, d'où la forme :
//   - tableaux seulement, tout le CSS en ligne : Gmail supprime <style> dans la vue repliée,
//     le moteur Word d'Outlook ignore flexbox, max-width et le padding des liens ;
//   - aucune image (ni hébergée ni jointe) : la marque F est une cellule colorée avec un « F »
//     en texte ; aucun lien externe hors du portail ;
//   - mode sombre : on ne peut pas fournir de thème sombre sans <style> ; on déclare donc
//     « clair seulement » (Apple Mail, Outlook.com respectent) et chaque cellule porte un fond
//     (bgcolor + background-color) et une couleur de texte explicites : quand un client inverse
//     quand même (Gmail app, Outlook Windows), il inverse des couples connus, jamais du texte
//     blanc sur un fond transparent. Le blanc n'est écrit que sur une cellule Noordzee.
// Valeurs = jetons Vismijn (DESIGN.md) ; police Arial (les polices web y sont peu fiables).
// Casse normale partout : aucun libellé en capitales.

const C = {
  canvas: "#EFF3F3", card: "#FFFFFF", soft: "#EFF3F3", ink: "#0E2229", muted: "#475A61",
  line: "#D3DDDF", lineSoft: "#E3EAEB", lineStrong: "#AAB8BB", action: "#0B5A6C", onAction: "#FFFFFF"
};
const FONT = "font-family:Arial,Helvetica,sans-serif";
const PAD_X = 28;

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
const br = text => esc(text).replace(/\n/g, "<br>");

// Styles de cellule partagés (tableaux métier de lib/ordermail.js : lignes, correction).
const TH = 'style="padding:8px 10px;border-bottom:1px solid ' + C.lineStrong + ";background-color:" + C.card + ";font-size:12px;line-height:16px;font-weight:bold;color:" + C.muted + ";" + FONT + '"';
const TD = "padding:10px;border-bottom:1px solid " + C.lineSoft + ";background-color:" + C.card + ";font-size:14px;line-height:20px;color:" + C.ink + ";" + FONT;
const LABEL = "font-size:13px;line-height:19px;color:" + C.muted + ";" + FONT + ";";
const VALUE = "font-size:14px;line-height:20px;color:" + C.ink + ";" + FONT + ";";
const MONO = "font-family:Consolas,Menlo,'Courier New',monospace;font-size:15px;line-height:21px;color:" + C.ink;

/** Ligne de la carte : une cellule blanche explicite. */
function row(inner, padding) {
  return '<tr><td bgcolor="' + C.card + '" style="padding:' + (padding || "14px " + PAD_X + "px 0 " + PAD_X + "px") + ";background-color:" + C.card + ';">' + inner + "</td></tr>";
}
const table = (inner, attrs) => '<table role="presentation" cellpadding="0" cellspacing="0" border="0"' + (attrs || "") + ">" + inner + "</table>";

/** Marque : carré Noordzee avec un F blanc (texte), puis le nom en casse normale. */
function brandRow(name) {
  return row(table("<tr>" +
    '<td width="32" height="32" align="center" valign="middle" bgcolor="' + C.action + '" style="width:32px;height:32px;background-color:' + C.action + ";border-radius:7px;font-size:19px;line-height:32px;mso-line-height-rule:exactly;font-weight:bold;color:" + C.onAction + ";" + FONT + ';">F</td>' +
    '<td style="padding-left:12px;font-size:16px;line-height:20px;font-weight:bold;color:' + C.ink + ";" + FONT + ';">' + esc(name || "FAMO Seafood") + "</td>" +
    "</tr>"), "24px " + PAD_X + "px 0 " + PAD_X + "px");
}

function headerRow(title, subtitle) {
  return row('<div style="font-size:22px;line-height:28px;font-weight:bold;color:' + C.ink + ";" + FONT + ';">' + esc(title) + "</div>" +
    (subtitle ? '<div style="margin-top:4px;' + LABEL + 'font-size:14px;">' + esc(subtitle) + "</div>" : ""), "22px " + PAD_X + "px 4px " + PAD_X + "px");
}

/** Paragraphe courant ; `muted` pour une précision secondaire. */
function paragraphRow(text, muted) {
  if (!text) return "";
  return row('<div style="' + (muted ? LABEL + "font-size:14px;line-height:21px;" : "font-size:15px;line-height:23px;color:" + C.ink + ";" + FONT + ";") + '">' + br(text) + "</div>");
}

/** Faits « libellé : valeur » (référence, dates, totaux…). */
function factsRow(pairs) {
  const rows = pairs.filter(p => p && p[1]).map(p =>
    '<tr><td width="170" valign="top" style="width:170px;padding:5px 12px 5px 0;' + LABEL + '">' + esc(p[0]) + "</td>" +
    '<td valign="top" style="padding:5px 0;' + VALUE + '">' + esc(p[1]) + "</td></tr>").join("");
  if (!rows) return "";
  return row(table(rows, ' width="100%"'));
}

/** Encadré sur fond IJs : note du client, remarques. */
function boxRow(inner) {
  return row(table('<tr><td bgcolor="' + C.soft + '" style="padding:12px 16px;background-color:' + C.soft + ";border:1px solid " + C.line + ';border-radius:6px;">' + inner + "</td></tr>", ' width="100%"'));
}
function noteRow(label, value) {
  if (!value) return "";
  return boxRow('<div style="font-size:13px;line-height:19px;font-weight:bold;color:' + C.ink + ";" + FONT + ';">' + esc(label) + "</div>" +
    '<div style="margin-top:2px;font-size:14px;line-height:21px;color:' + C.ink + ";" + FONT + ';">' + br(value) + "</div>");
}

/** Identifiants / paiement : valeurs à chasse fixe (l/1, O/0 jamais confondus en recopiant un IBAN). */
function credentialsRow(pairs) {
  const rows = pairs.filter(p => p && p[1]).map(p =>
    '<tr><td width="180" valign="top" style="width:180px;padding:5px 12px 5px 0;' + LABEL + '">' + esc(p[0]) + "</td>" +
    '<td valign="top" style="padding:5px 0;' + MONO + ';">' + esc(p[1]) + "</td></tr>").join("");
  if (!rows) return "";
  return boxRow(table(rows, ' width="100%"'));
}

/** Tableau métier (déjà construit avec TH / TD) posé dans la carte. */
function tableRow(inner) {
  return row(table(inner, ' width="100%"'), "18px " + PAD_X + "px 0 " + PAD_X + "px");
}

/**
 * Bouton principal plein : cellule Noordzee + lien. Ailleurs, le padding est sur le lien (toute la
 * surface est cliquable) ; Outlook (Word) l'ignore et lit mso-padding-alt de la cellule.
 * 44 px de haut (18 + 2 × 13). `fallback` : phrase + lien en clair sous le bouton.
 */
function buttonRow(label, href, fallback) {
  if (!href) return "";
  return row(table('<tr><td align="center" bgcolor="' + C.action + '" style="background-color:' + C.action + ';border-radius:6px;mso-padding-alt:13px 24px;">' +
    '<a href="' + esc(href) + '" style="color:' + C.onAction + ";display:inline-block;padding:13px 24px;font-size:15px;line-height:18px;font-weight:bold;text-decoration:none;border-radius:6px;" + FONT + ';">' + esc(label) + "</a></td></tr>") +
    (fallback ? '<div style="margin-top:12px;' + LABEL + '">' + esc(fallback) + '<br><a href="' + esc(href) + '" style="color:' + C.action + ';text-decoration:underline;word-break:break-all;">' + esc(href) + "</a></div>" : ""),
  "22px " + PAD_X + "px 4px " + PAD_X + "px");
}

function footerRow(text) {
  return '<tr><td bgcolor="' + C.card + '" height="26" style="height:26px;line-height:26px;font-size:0;background-color:' + C.card + ';">&nbsp;</td></tr>' +
    '<tr><td bgcolor="' + C.card + '" style="padding:18px ' + PAD_X + "px 22px " + PAD_X + "px;background-color:" + C.card + ";border-top:1px solid " + C.line + ";" + LABEL + '">' + br(text) + "</td></tr>";
}

/**
 * Document complet. `preheader` : la phrase affichée dans la liste des messages (cachée dans le
 * corps), suivie d'espaceurs pour que le client n'y ajoute pas le début du corps.
 */
function shell(opts) {
  const o = opts || {};
  const pre = String(o.preheader || "").replace(/\s+/g, " ").trim();
  return '<!doctype html><html lang="' + (o.lang === "fr" ? "fr" : "nl") + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="x-apple-disable-message-reformatting">' +
    '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">' +
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">' +
    "<title>" + esc(o.title) + "</title></head>" +
    '<body bgcolor="' + C.canvas + '" style="margin:0;padding:0;background-color:' + C.canvas + ";color:" + C.ink + ';-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">' +
    (pre ? '<div class="preheader" style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:' + C.canvas + ';">' + esc(pre) + "&zwnj;&nbsp;".repeat(60) + "</div>" : "") +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="' + C.canvas + '" style="background-color:' + C.canvas + ';">' +
    '<tr><td align="center" style="padding:24px 12px;">' +
    '<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="' + C.card + '" style="width:100%;max-width:600px;background-color:' + C.card + ";border:1px solid " + C.line + ';border-radius:10px;border-collapse:separate;overflow:hidden;">' +
    brandRow(o.brand) + (o.rows || "") +
    "</table>" +
    "<!--[if mso]></td></tr></table><![endif]-->" +
    "</td></tr></table></body></html>";
}

module.exports = { C, FONT, TH, TD, esc, shell, brandRow, headerRow, paragraphRow, factsRow, noteRow, credentialsRow, tableRow, buttonRow, footerRow };
