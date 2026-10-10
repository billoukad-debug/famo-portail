# Tâches — 027 Vitrine

- [x] T001 Tests d'abord : `test/vitrine.test.js` (pas de fuite de prix négocié / stock, inactif → 404, échappement, slugs, sitemap, FR, prix sur demande)
- [x] T002 `lib/vitrine.js` (rendu pur) + `api/vitrine.js` (lecture Catalogue + Configuratie, cache)
- [x] T003 `vercel.json` rewrites `/aanbod`, `/aanbod/:slug`, `/sitemap.xml` ; `scripts/dev-server.js` les applique aussi
- [x] T004 Accueil : liens « Ons aanbod » / « Klant worden », plus de `noindex`, description ; `robots.txt`
- [x] T005 Styles `.vt-*` dans `assets/ui.css` ; ux-audit inclut `/aanbod`
- [x] T006 Portes (assets-version, check, eslint, contraste, audits navigateur), docs (AGENTS.md, SCHEMA si besoin)
