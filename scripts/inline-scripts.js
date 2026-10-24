"use strict";
// Scripts écrits dans les pages (spec 033). La CSP de vercel.json (script-src 'self') bloque tout script exécutable
// inline, sans erreur visible en local : check.js les refuse. Seule exception, étroite : un bloc de données schema.org
// écrit exactement <script type="application/ld+json">…</script>. Le navigateur ne l'exécute jamais (la CSP ne s'y
// applique donc pas) ; il doit contenir du JSON valide.
const LD = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const withoutLd = (html, onLd) => String(html).replace(LD, (all, body) => { if (onLd) onLd(body); return ""; });

// Problèmes CSP d'une page : script inline exécutable, attribut on*=, JSON-LD illisible.
function inlineProblems(html) {
  const problems = [];
  const rest = withoutLd(html, (body) => { try { JSON.parse(body); } catch (e) { problems.push("JSON-LD illisible : " + e.message); } });
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(rest)) problems.push("script inline (bloqué par la CSP)");
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(rest)) problems.push("attribut on*= (bloqué par la CSP)");
  return problems;
}
// Corps des scripts inline à compiler (contrôle de syntaxe) : tout sauf les blocs JSON-LD.
function inlineScripts(html) {
  const out = [], re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  const rest = withoutLd(html); let m;
  while ((m = re.exec(rest))) out.push(m[1]);
  return out;
}
module.exports = { inlineProblems, inlineScripts };
