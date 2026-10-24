# Feature Specification: Vague 2 « trouvable sur Google »

**Créée** : 2026-10-24 · **Statut** : implémentée sur la branche `vague-2-trouvable`, non déployée (attend la
validation du gérant puis le « go » du prestataire) · **Source** : audit public du 24/10/2026
(`~/Documents/Plan Kameha/FAMO/annexe-audit-public-24-10.md`, points S1, S4, S5, S6, S8, P1, P2, A3) et plan
« famoseafood.be parfait », vague 2 (lots 2.1 à 2.6).

## Constats (CONFIRMÉ en production le 24/10/2026)
- `robots.txt` interdisait `/assets/pages/` : Google ne pouvait pas exécuter les scripts qui écrivent le texte des pages.
- Les pages publiques étaient des coquilles vides (`<div id="app"></div>`) : rien à lire sans JavaScript.
- Pas d'Open Graph, pas de `canonical`, pas de données structurées ; titre sans mots-clés ; Privacy et Voorwaarden sans
  description.
- La langue n'était que dans le navigateur (`localStorage`) : la version FR n'avait pas d'adresse, pas de `hreflang`.
- Sitemap : 2 adresses (accueil, aanvraag), lu après tout le Catalogue même vitrine fermée.
- Police téléchargée deux fois (préchargement `…woff2?v=…`, feuille de style `…woff2` sans version).

## Exigences
- **FR-001** `robots.txt` : `Disallow: /assets/pages/` retiré. Restent fermés `/api/`, `/klant`, `/team/`, `/beheer`,
  `/wachtwoord`, `/offline`, `/aanbod`. Deux exceptions étroites sous `/api/`, en lecture seule et déjà publiques :
  `Allow: /api/config?public=1` et `Allow: /api/config?voorwaarden=1`, pour que Google voie le pied de page et les
  conditions comme un visiteur.
- **FR-002** Texte dans le HTML de `/`, `/aanvraag`, `/privacy`, `/voorwaarden`, `/colofon` (dans `#app`, remplacé par
  le script de la page au chargement) : titre, accroche « Vóór 22:00 besteld, morgen in uw keuken. », livraison
  ma–za à Anvers et environs, ce que FAMO vend, coordonnées. **Aucun texte inventé** : chaque phrase vient des scripts
  existants (`start.js`, `aanvraag.js`, `privacy.js`, `colofon.js`, `voorwaarden.js`, `ui.js`, `lib/vitrine.js`) ;
  les coordonnées sont celles de `/api/config?public=1` du 24/10/2026 (FAMO Seafood, Jezusstraat 34, 2000 Antwerpen,
  België, +32483585854, info@famoseafood.be, BE0788705713, 0788.705.713). Ni prix, ni promesse nouvelle, ni label.
  Le texte est visible sans JavaScript (remplace le `<noscript>` de P2 / A3).
- **FR-003** Métadonnées de chaque page : `<title>` avec « groothandel vis en zeevruchten Antwerpen » (accueil et
  aanvraag), `<meta name="description">`, `<link rel="canonical">`, `hreflang` nl / fr / x-default, Open Graph
  (`og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:locale`, `og:image` =
  `/assets/icons/famo-512.png`, image déjà dans le dépôt). Accueil : JSON-LD schema.org `LocalBusiness` (nom, url,
  logo, e-mail, téléphone, btw, adresse, zone desservie « Antwerpen en omstreken »), sans nom légal (vide dans
  Configuratie), sans horaires ni prix.
- **FR-004** CSP : un `<script type="application/ld+json">` est un bloc de données, jamais exécuté, donc hors de
  `script-src`. `scripts/check.js` l'accepte seulement sous cette forme exacte et avec un JSON valide
  (`scripts/inline-scripts.js`) ; tout autre script inline reste refusé.
- **FR-005** Langue dans l'adresse : `?taal=fr` (comme la vitrine, spec 027) ou `?taal=nl` prime sur le choix
  enregistré et l'enregistre. Le bouton NL / FR d'une page publique (celle qui a des `hreflang`) change l'adresse
  (`?taal=fr`, ou sans paramètre pour le néerlandais). En français, `K.applyLangMeta` applique les variantes `data-fr`
  des balises du `<head>` (titre, description, canonical, `og:*`). Les liens du pied de page gardent la langue
  (`K.langHref`).
- **FR-006** Sitemap : `/`, `/aanvraag`, `/privacy`, `/voorwaarden`, `/colofon` en NL et en FR (`?taal=fr`), chacun avec
  ses alternates `xhtml:link` nl / fr / x-default ; vitrine fermée : aucune lecture du Catalogue, cache 1 h.
- **FR-007** Police : `scripts/assets-version.js` versionne aussi l'adresse de la police dans `assets/ui.css` ; le
  préchargement des pages et la feuille de style demandent la même adresse (un seul téléchargement).
- **FR-008** Vitrine « Ons aanbod » prête à l'ouverture : titre, description, canonical, hreflang nl / fr / x-default,
  `og:url`. Elle reste fermée.
- **FR-009** Note « Nieuw » pour le gérant.

## Gestes hors code (pas faits ici)
- **Ouvrir la vitrine** : quand le gérant le décide, `VITRINE_OPEN=1` dans Vercel (Production), puis remplacer
  `Disallow: /aanbod` par `Allow: /aanbod` dans `robots.txt` et remettre le lien « Ons aanbod » sur l'accueil
  (`start.js`), dans une petite PR (le dernier test de `test/vitrine.test.js` est à adapter dans la même PR).
- **Google Search Console** (compte Google du gérant) : propriété de domaine `famoseafood.be` (enregistrement TXT chez
  one.com), soumettre `https://www.famoseafood.be/sitemap.xml`, demander l'indexation de `/` et `/aanvraag`.
  Idem Bing Webmaster Tools (peut importer depuis Search Console).
- **Fiche Google Business Profile** : « FAMO Seafood », catégorie groothandel in vis en zeevruchten, téléphone, site,
  zone desservie ; adresse de l'entrepôt si elle diffère du siège (sinon zone de service sans adresse affichée).
- **DMARC** (lot 2.7, DNS one.com, sur « go ») : `v=DMARC1; p=none; rua=mailto:…; fo=1`, lire les rapports 2 à 4
  semaines, puis `quarantine`, puis `reject`.
- **Coordonnées en dur** : elles sont maintenant aussi dans le HTML et le JSON-LD. Si le téléphone, l'e-mail ou
  l'adresse changent dans Beheer → Bedrijf, mettre à jour `index.html`, `aanvraag.html`, `privacy.html`,
  `voorwaarden.html`, `colofon.html` et la liste `PUBLIC` de `test/vague2.test.js`.

## INCERTAIN
- La version FR repose sur le rendu JavaScript : le HTML reçu porte le `canonical` NL, remplacé par l'adresse FR après
  exécution. Google rend le JavaScript et lit les `hreflang` et le sitemap, mais peut choisir l'adresse NL comme
  canonique de la page FR. À vérifier dans Search Console (rapport « Pages ») ; sinon, servir des fichiers FR statiques.
- L'aperçu WhatsApp d'un lien `?taal=fr` reste en néerlandais (le robot de WhatsApp n'exécute pas de JavaScript).
- `og:image` est le logo carré 512 px : WhatsApp l'affiche en vignette, pas en grande image 1200×630 (aucune photo
  libre de droits dans le dépôt servi ; `alternatif/` n'est pas déployé).

## Tests
`test/vague2.test.js` : robots, métadonnées et JSON-LD de chaque page, texte statique tiré des sources, règle
`ld+json` de `check.js`, langue depuis l'adresse, `K.applyLangMeta`, `K.setLang`, sitemap NL / FR, police alignée,
vitrine prête.
