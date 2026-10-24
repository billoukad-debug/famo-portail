/* global module, self, require */
// QR de virement européen (EPC069-12 « SEPA QR », version 002) : specs/034-vague-3-facturation.
// Chargé tel quel par le navigateur (window.FamoEpc, après /vendor/qrcode-generator.js) et par Node
// (require("../assets/epc.js")) : la même règle pour la facture du portail, le relevé client et les tests.
//
// Contenu (une donnée par ligne, séparateur LF, rien après la dernière donnée remplie) :
//   1 BCD · 2 002 · 3 1 (UTF-8) · 4 SCT · 5 BIC (facultatif en version 002) · 6 bénéficiaire (≤ 70)
//   7 IBAN · 8 EUR + montant (0.01 à 999999999.99, point décimal) · 9 code « purpose » (vide)
//   10 référence structurée (≤ 35) · 11 communication libre (≤ 140, seulement sans référence) · 12 info (vide)
// Belgique (Febelfin, guide « QR-code on invoice », 01/02/2026) : la référence structurée porte la
// communication structurée belge +++123/4567/89012+++ (OGM) ; QR d'au moins 2 × 2 cm, sur la facture.
// Niveau de correction d'erreur M (exigé par l'EPC), au plus 331 octets.
//
// Jamais de QR (allowed / forInvoice renvoient faux / null) :
//   - en mode « Boekhouder » (pro forma : la facture et le paiement viennent du comptable) ;
//   - sans IBAN valide (modulo 97), ou avec un IBAN d'exemple (assets/docs/bedrijf.js, données de démo) ;
//   - sans montant positif (facture déjà réglée par une note de crédit, montant nul).
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FamoEpc = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";
  // IBAN de démonstration connus : celui de assets/docs/bedrijf.js (EXAMPLE, aussi dans scripts/seed.js) et
  // l'exemple belge des registres bancaires. Un portail configuré avec l'un d'eux n'a pas de vrai compte.
  const EXAMPLE_IBANS = ["BE68539007547034", "BE71096123456769"];
  const MAX_BYTES = 331;

  const clean = (s) => String(s == null ? "" : s).toUpperCase().replace(/[\s.-]+/g, "");
  function ibanValid(iban) {
    const s = clean(iban);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    if (s.slice(0, 2) === "BE" && s.length !== 16) return false;
    const r = s.slice(4) + s.slice(0, 4);
    let mod = 0;
    for (const ch of r) { const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55); for (const d of v) mod = (mod * 10 + Number(d)) % 97; }
    return mod === 1;
  }
  const isExample = (iban) => EXAMPLE_IBANS.includes(clean(iban));
  const bicValid = (bic) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(clean(bic));
  // Communication structurée belge : 10 chiffres + contrôle modulo 97 (0 → 97).
  function ogmValid(ref) {
    const m = /^\+\+\+(\d{3})\/(\d{4})\/(\d{5})\+\+\+$/.exec(String(ref || "").trim());
    if (!m) return false;
    const d = m[1] + m[2] + m[3];
    return (Number(d.slice(0, 10)) % 97 || 97) === Number(d.slice(10));
  }
  const oneLine = (s, max) => Array.from(String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim()).slice(0, max).join("");
  function amountTxt(n) {
    const v = Math.round(Number(n) * 100) / 100;
    if (!Number.isFinite(v) || v < 0.01 || v > 999999999.99) return "";
    return "EUR" + v.toFixed(2);
  }
  const utf8Len = (s) => { let n = 0; for (const ch of s) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };

  // { naam, iban, bic?, bedrag, mededeling? (OGM), tekst? (libre, si pas d'OGM) } → { ok, text } | { ok:false, reden }
  function payload(o) {
    const p = o || {};
    const iban = clean(p.iban), bic = clean(p.bic), naam = oneLine(p.naam, 70), bedrag = amountTxt(p.bedrag);
    if (!ibanValid(iban)) return { ok: false, reden: "iban" };
    if (isExample(iban)) return { ok: false, reden: "voorbeeld-iban" };
    if (!naam) return { ok: false, reden: "naam" };
    if (!bedrag) return { ok: false, reden: "bedrag" };
    const ogm = ogmValid(p.mededeling) ? String(p.mededeling).trim() : "";
    const lines = ["BCD", "002", "1", "SCT", bic && bicValid(bic) ? bic : "", naam, iban, bedrag, "", ogm, ogm ? "" : oneLine(p.tekst, 140), ""];
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    const text = lines.join("\n");
    if (utf8Len(text) > MAX_BYTES) return { ok: false, reden: "te-lang" };
    return { ok: true, text };
  }

  // Le portail peut-il montrer un QR ? company : { facturatie, iban, exampleBank? }.
  function allowed(company) {
    const c = company || {};
    return String(c.facturatie || "").toLowerCase() === "portaal" && !c.exampleBank && ibanValid(c.iban) && !isExample(c.iban);
  }
  // Bénéficiaire = titulaire du compte : nom juridique + forme (vérification du nom par la banque), sinon nom commercial.
  function begunstigde(company) {
    const c = company || {}, lg = c.legal || {};
    const naam = String(lg.naam || "").trim(), vorm = String(lg.rechtsvorm || "").trim();
    if (naam) return naam + (vorm && !naam.toLowerCase().split(/[^a-z0-9.]+/).includes(vorm.toLowerCase()) ? " " + vorm : "");
    return String(c.nom || c.bedrijfsnaam || "").trim();
  }
  // QR d'une facture du portail : null si interdit (voir en tête) ; sinon { text, svg }.
  // f : { company, bedrag (TVAC), mededeling (OGM), factuurnummer, label? }
  function forInvoice(f) {
    const o = f || {}, c = o.company || {};
    if (!allowed(c)) return null;
    const p = payload({ naam: begunstigde(c), iban: c.iban, bic: c.bic, bedrag: o.bedrag, mededeling: o.mededeling, tekst: o.factuurnummer ? "Factuur " + o.factuurnummer : "" });
    if (!p.ok) return null;
    return { text: p.text, svg: svg(p.text, { label: o.label }) };
  }

  // Bibliothèque QR (vendor/qrcode-generator.js, MIT, version figée) : globale dans le navigateur, require dans Node.
  function lib() {
    if (root && typeof root.qrcode === "function") return root.qrcode;
    if (typeof require === "function") return require("../vendor/qrcode-generator.js");
    throw new Error("QR-module niet geladen");
  }
  // Matrice des modules (true = foncé) : version minimale, correction M, octets UTF-8.
  function matrix(text) {
    const q = lib();
    q.stringToBytes = q.stringToBytesFuncs["UTF-8"];
    const code = q(0, "M");
    code.addData(String(text), "Byte");
    code.make();
    const n = code.getModuleCount(), rows = [];
    for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(code.isDark(r, c)); rows.push(row); }
    return rows;
  }
  // SVG net (un seul tracé, zone calme de 4 modules), sans style externe : écran, impression et PDF.
  function svg(text, opts) {
    const m = matrix(text), n = m.length, q = 4, size = n + 2 * q;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += "M" + (c + q) + " " + (r + q) + "h1v1h-1z";
    const label = String((opts && opts.label) || "QR-code voor overschrijving").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    return '<svg xmlns="http://www.w3.org/2000/svg" class="epc-qr" viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="' + label + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#FFFFFF"/><path d="' + d + '" fill="#000000"/></svg>';
  }

  return { payload, allowed, forInvoice, begunstigde, matrix, svg, ibanValid, isExample, bicValid, ogmValid, amountTxt, EXAMPLE_IBANS, MAX_BYTES };
});
