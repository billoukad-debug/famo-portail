"use strict";
// « Correctie mailen » (audit L-08) : ce qui a changé sur une commande depuis ce que le client a
// reçu par e-mail. Référence (« avant ») :
//   - le dernier e-mail de correction envoyé (champ « Correctiemail », JSON { le, lignes, cn, sleutel }) ;
//   - sinon les lignes commandées (« Lignes besteld » = ce que la confirmation de commande montrait) ;
//   - sinon (anciennes commandes) les lignes actuelles : aucune différence de lignes inventée.
// « Après » : lignes actuelles + notes de crédit émises depuis (lib/creditnota.js).
// La clé (sleutel) résume l'état envoyé : même état = même clé = pas de deuxième e-mail.
const crypto = require("crypto");
const CN = require("./creditnota");

const FIELD = "Correctiemail";
const LINES = "Lignes (produits / quantités)";
const norm = (s) => String(s || "").toLowerCase().trim();

function lastSent(fields) {
  const raw = (fields || {})[FIELD];
  if (!raw) return null;
  try { const p = typeof raw === "string" ? JSON.parse(raw) : raw; return p && typeof p === "object" && !Array.isArray(p) ? p : null; } catch (e) { return null; }
}

function baseline(fields) {
  const f = fields || {};
  const last = lastSent(f);
  if (last) return { lignes: String(last.lignes || ""), cn: Array.isArray(last.cn) ? last.cn.map(String) : [] };
  const besteld = f["Lignes besteld"];
  return { lignes: besteld ? String(besteld) : String(f[LINES] || ""), cn: [] };
}

// Lignes regroupées par article (nom normalisé) : quantités additionnées, premier prix.
function byName(txt) {
  const m = new Map();
  CN.parseLines(txt).forEach((l) => {
    const k = norm(l.nom);
    const cur = m.get(k);
    if (cur) cur.qty = Math.round((cur.qty + l.qty) * 1000) / 1000;
    else m.set(k, { name: l.nom, unit: l.unit, qty: l.qty, price: l.price });
  });
  return m;
}

/** [{ name, unit, voor:{qty,price}|null, na:{qty,price}|null }] : articles ajoutés, retirés ou modifiés. */
function diffLines(before, after) {
  const b = byName(before), a = byName(after), out = [];
  const same = (x, y) => Math.abs(x.qty - y.qty) < 1e-9 && (x.price == null ? null : Math.round(x.price * 100)) === (y.price == null ? null : Math.round(y.price * 100));
  a.forEach((n, k) => {
    const v = b.get(k);
    if (!v) out.push({ name: n.name, unit: n.unit, voor: null, na: { qty: n.qty, price: n.price } });
    else if (!same(v, n)) out.push({ name: n.name, unit: n.unit || v.unit, voor: { qty: v.qty, price: v.price }, na: { qty: n.qty, price: n.price } });
  });
  b.forEach((v, k) => { if (!a.has(k)) out.push({ name: v.name, unit: v.unit, voor: { qty: v.qty, price: v.price }, na: null }); });
  return out;
}

/** Ce qui a changé depuis le dernier e-mail au client. */
function changes(fields) {
  const f = fields || {};
  const base = baseline(f);
  const wijzigingen = diffLines(base.lignes, f[LINES]);
  const notes = CN.list(f);
  const nieuweCreditnotas = notes.filter((n) => !base.cn.includes(n.nummer));
  return { changed: wijzigingen.length > 0 || nieuweCreditnotas.length > 0, wijzigingen, nieuweCreditnotas, notes };
}

/** État envoyé au client (écrit dans « Correctiemail » au moment de l'envoi). */
function snapshot(fields, le) {
  const f = fields || {};
  const lignes = String(f[LINES] || "");
  const cn = CN.list(f).map((n) => n.nummer);
  const sleutel = crypto.createHash("sha256").update(lignes + "\n#" + cn.join(",")).digest("hex").slice(0, 16);
  return { le: String(le || ""), lignes, cn, sleutel };
}

module.exports = { FIELD, lastSent, baseline, diffLines, changes, snapshot };
