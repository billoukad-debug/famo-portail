# Tasks: Vague 2 « trouvable sur Google »

- [x] T001 Tests d'abord : `test/vague2.test.js` (11 tests, tous rouges avant le code)
- [x] T002 `robots.txt` : `/assets/pages/` ouvert, `/api/config?public=1` et `?voorwaarden=1` seuls permis sous `/api/`
- [x] T003 `scripts/inline-scripts.js` + `scripts/check.js` : bloc `application/ld+json` permis (JSON valide), le reste refusé
- [x] T004 `assets/ui.js` : `?taal=` dans `K.lang`, `K.setLang` change l'adresse sur une page publique, `K.langHref`,
      `K.applyLangMeta` (variantes `data-fr` du `<head>`), liens du pied de page dans la langue
- [x] T005 Pages `index.html`, `aanvraag.html`, `privacy.html`, `voorwaarden.html`, `colofon.html` : texte statique, titre,
      description, canonical, hreflang, Open Graph ; JSON-LD `LocalBusiness` sur l'accueil
- [x] T006 `lib/vitrine.js` + `api/vitrine.js` : sitemap NL / FR avec alternates, vitrine fermée sans lecture du Catalogue ;
      vitrine prête (x-default, `og:url`, `og:image` de repli)
- [x] T007 `scripts/assets-version.js` : adresse de la police versionnée dans `ui.css` (= préchargement)
- [x] T008 Note « Nieuw » (`assets/nieuws.js`)
- [ ] T009 Validation du gérant sur la version d'essai, puis « go » et fusion
- [ ] T010 Après mise en ligne : Search Console + Bing (compte du gérant), fiche Google Business, contrôle de l'aperçu
      WhatsApp et du rapport « Pages » (version FR indexée ?)
- [ ] T011 Ouverture de la vitrine sur décision du gérant (`VITRINE_OPEN=1`, robots, lien accueil : voir spec)
