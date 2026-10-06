# Decisions (synthèse d'ingestion, 2026-10-02)

Décisions verrouillées extraites des documents de type ADR (constitution + ADR 0001 à 0005).
Ordre de précédence : constitution (0) > ADR (1) > SPEC (2) > DOC (4-5). Aucune contradiction entre décisions verrouillées.

## CONST: Constitution FAMO Portail v1.0.1
- source: .specify/memory/constitution.md
- status: locked (Ratified 2026-09-30, amended 2026-10-01)
- decision: I. Sans build, sans dépendance (HTML statique + JS vanilla, fonctions Vercel CommonJS, aucun package.json, une seule feuille ui.css et un seul module ui.js, aucun style en ligne ajouté, assets-version après toute modification front). II. Le serveur décide (prix, TVA, stock, numéros, droits, états ; chaque POST/PATCH/DELETE commence par lib/guard puis contrôle de session ; fail-closed ; aucun secret dans le code, les logs, l'URL, le storage ou un message). III. Tests d'abord, en local (toute règle métier a un test qui échoue sans le code ; portes check.js + ESLint 9.39.5, audits ux/kbd pour toute interface ; aucune écriture vers la production ; aucun test désactivé pour obtenir du vert). IV. Terrain d'abord (personnel et Beheer en NL, client NL/FR, documents dans la langue du client, e-mails en néerlandais, valeurs de base en français ; WCAG 2.2 AA ; cibles ≥ 44 px ; dialogues maison ; hors ligne sans perte de saisie). V. Données et conformité (SCHEMA.md et faux Airtable à jour dans le même commit ; case décochée = absent ; factures conformes et jamais modifiées, correction par note de crédit ; RGPD export et anonymisation).
- scope: architecture, sécurité, tests, accessibilité, langue, schéma, RGPD, flux spec-kit (specify → plan avec Constitution Check → tasks → implement ; commits en français ; PR brouillon ; CI verte ; push main = production)

## ADR-0001: Pas de build, pas de dépendances npm
- source: docs/adr/0001-sans-build-sans-dependances.md
- status: locked (Accepted, formalisée 2026-09-27)
- decision: front HTML + CSS + JS sans framework ni bundler, cache par ?v= ; serveur CommonJS sur modules intégrés de Node et fetch ; pas de package.json ; outils à version figée par npx (ESLint 9.39.5, Playwright 1.56.1 hors dépôt) ; seule exception vendorisée vendor/html2pdf.bundle.min.js.
- scope: build, dépendances, front, fonctions Vercel

## ADR-0002: Airtable d'abord, puis Neon via lib/at-engine.js
- source: docs/adr/0002-airtable-puis-neon.md
- status: locked (Accepted ; bascule faite, production sur Neon au 2026-09-27)
- decision: le code métier continue à parler REST Airtable ; lib/datastore.js intercepte fetch et confie les requêtes à lib/at-engine.js sur une table SQL unique famo_records (JSON + version) ; Neon joint en HTTPS par fetch natif ; sans DATABASE_URL valable en mode postgres → 500 DATABASE_NOT_CONFIGURED, jamais de repli silencieux ; retour à Airtable n'est plus une option d'exploitation.
- scope: base de données, Neon, Airtable, moteur SQL

## ADR-0003: Jeton client signé ; cookie HttpOnly pour le personnel
- source: docs/adr/0003-jeton-client-signe.md
- status: locked (Accepted ; mise à jour 2026-10-01 par specs/013)
- decision: personnel = cookie famo_sess HttpOnly Secure SameSite=Lax 8 h signé HMAC ; client = jeton signé dans le cookie famo_klant HttpOnly Secure SameSite=Strict Path=/api (plus dans JavaScript) ; mots de passe, codes et PIN en scrypt ; même secret SESSION_SECRET ; jeton dans le corps accepté jusqu'au 31/10/2026 inclus puis ignoré et code à retirer.
- scope: authentification, session client, session personnel, CSRF

## ADR-0004: Numérotation CMD / FA / CN
- source: docs/adr/0004-numerotation.md
- status: locked (Accepted, « à revoir si plusieurs appareils saisissent en même temps » ; mise à jour 2026-10-01 par specs/010)
- decision: numéros séquentiels par année (heure de Bruxelles) ; FA/CN par compteur atomique (lib/billing.js reserve, table Compteurs), contrôles avant réservation, numéro rendu si refus certain sinon journalisé « Nummer vervallen » ; CMD en max+1 sans dédoublonnage ; FA et CN sont des numéros internes depuis l'ADR 0005.
- scope: numérotation, factures internes, notes de crédit, commandes

## ADR-0005: Facturation légale chez le comptable ; le portail n'émet pas de facture
- source: docs/adr/0005-facturation-legale.md
- status: locked (Accepted 2026-09-27, décision du client Famo Trading BV ; re-confirmée VERROUILLÉE par le propriétaire le 2026-10-02 dans le brief de mission)
- decision: les factures et notes de crédit légales sont émises par le comptable dans Billtobox (Peppol) ; les documents du portail sont internes, marqués « pas une facture », numéros FA/CN internes ; le portail fournit des exports CSV (et UBL si le comptable le demande) ; le portail n'envoie pas de Peppol. Idée différée (brief) : envoi Peppol direct seulement si FAMO quitte Billtobox.
- scope: facturation légale, Peppol, Billtobox, exports comptables
