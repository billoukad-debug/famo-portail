---
last_mapped_commit: 87c2948d2b10ce5ae0c5e27550fcc1197acbf17e
last_mapped_at: 2026-10-02
---
# Codebase Concerns

**Analysis Date:** 2026-10-02

> Constats sur le code, la documentation et l'exploitation au commit `87c2948` (branche `claude/brave-lovelace-s4xk7h`, production = `333125a`).
> Les constats « données de production » viennent du brief du propriétaire (2026-10-02) et n'ont PAS été revérifiés en base (aucune lecture de la production dans cette mission).
> Aucun de ces constats n'a été corrigé : `.planning/` les trace, la correction passe par une spec (`specs/NNN-*`).

## Tech Debt

**Chemin de transition du jeton client dans le corps (spec 013) :**
- Issue : le jeton dans le corps reste accepté jusqu'au 31/10/2026 inclus, puis ignoré automatiquement ; le code de transition doit ensuite être retiré.
- Files : `lib/clientauth.js` (`BODY_TOKEN_UNTIL = 2026-11-01T00:00:00+01:00`, `bodyTokenAllowed`)
- Impact : code mort et surface d'attaque inutile après l'échéance.
- Fix approach : petite spec de retrait après le 01/11/2026 (tests `test/klantcookie.test.js` à adapter).

**Lignes appariées par nom pour les lots, la marge et la TVA d'une commande non facturée (reste de B4) :**
- Issue : `Lignes JSON` (spec 016) porte `productId`, mais lots, marge et taux de TVA d'une commande non facturée restent appariés par nom ; les commandes antérieures à la spec 016 n'ont que le texte (pas de rattrapage, décision).
- Files : `lib/margin.js`, `lib/trace.js`, `lib/commande/bijwerken.js`, `lib/lignesjson.js`, `IDEAS.md` B4, `specs/016-lignes-structurees/spec.md`
- Impact : un produit renommé dont l'ancien nom est repris peut fausser la marge ou le rattachement d'un lot ; creditnota avec retour sur une ancienne commande renommée ne remet pas le stock.
- Fix approach : étendre l'appariement par `productId` (prérequis utile à la traçabilité numérique par lot, phase 2).

**Duplications volontaires sans build (ADR 0001) :**
- Issue : `esc`, `eur`, `parseLines`, `rateLimited` réécrits à plusieurs endroits.
- Files : `api/order.js` (`rateLimited`), `assets/ui.js`, `lib/commande/common.js`, `lib/lines.js`
- Impact : divergence possible ; compensée par des tests de parité (`test/workflow/emails-documents.test.js` bloc M6, `facturation.test.js` AZ).
- Fix approach : garder les tests de parité ; toute nouvelle copie ajoute son test.

**Règles ESLint désactivées :**
- Issue : `no-useless-escape` (18 cas) et `no-regex-spaces` (2 cas) désactivées.
- Files : `eslint.config.js`
- Fix approach : corriger les cas puis activer (spec de dette, faible risque).

**Gros fichiers navigateur :**
- Issue : `assets/pages/beheer.js` (≈ 131 Ko), `assets/ui.js` (≈ 109 Ko), `assets/pages/klant.js` (≈ 83 Ko), `assets/pages/staff-common.js` (≈ 62 Ko), `lib/ordermail.js` (≈ 49 Ko).
- Impact : coût de lecture pour les agents, risque de régression ; pas de build pour découper en modules.
- Fix approach : découpages par domaine comme pour `lib/commande/` (spec 010) et `lib/beheer/` (spec 006), seulement si une phase y touche.

## Known Bugs

**Qualité des données catalogue en production (brief propriétaire) :**
- Symptoms : le champ `Kaliber` contient des poids (ex. « 0.800 ») au lieu d'un calibre ; 56 produits sur 69 sont en catégorie « Algemeen ».
- Files : données `Catalogue` (Neon) ; tri `K.kaliberKey` / `K.byNameKaliber` (`assets/ui.js`, spec 018) ; familles `K.families` et Rapportage par catégorie (`assets/rapport.js`, spec 022)
- Trigger : saisie initiale du catalogue
- Workaround : correction dans Beheer → Producten (phase 1). Le code n'est pas en cause.

**Doublon transitoire possible de référence CMD :**
- Symptoms : deux commandes créées au même instant peuvent partager une `CMD-AAAA-NNNN`.
- Files : `lib/ordernumber.js`, ADR 0004
- Trigger : concurrence (plusieurs canaux : portail, Invoeren, e-mail spec 020)
- Workaround : aucun automatique (FA/CN ont un compteur atomique, pas CMD). À surveiller quand la commande par e-mail sera active.

## Security Considerations

**`.planning/config.json` serait déployé et servi publiquement si `.planning/` est commité :**
- Risk : `.vercelignore` exclut `*.md` mais pas `/.planning` ; tout fichier non `.md` de `.planning/` (`config.json`, futurs `.json`/`.tsv`) serait publié. Constitution : « Tout nouveau fichier non destiné au public est exclu dans `.vercelignore` ».
- Files : `.vercelignore`, `test/deploy.test.js`, `vercel.json` (`redirects` des chemins internes)
- Current mitigation : `.planning/` non commité (2026-10-02).
- Recommendations : AVANT le premier commit de `.planning/`, ajouter `/.planning` à `.vercelignore` (et `/.planning/:path*` aux redirections de `vercel.json`, avec un test dans `test/deploy.test.js`) — par une petite spec, hors de cette mission.

**`SESSION_SECRET` peut être absente :**
- Risk : sans elle, le secret HMAC dérive des codes et des identifiants de base ; changer l'un d'eux déconnecte tout le monde.
- Files : `lib/staffauth.js`, `README.md` § Variables
- Current mitigation : avertissement `[staffauth] SESSION_SECRET ontbreekt` dans les logs.
- Recommendations : vérifier dans Vercel qu'elle est posée en production (geste propriétaire, non vérifié ici).

**Anti-force brute et verrous en mémoire d'instance :**
- Risk : sur Vercel, plusieurs instances : les compteurs (`_rl`) et le verrou `inflight` ne sont pas globaux.
- Files : `api/order.js`, `api/catalogue.js`, `api/klantorder.js`, `api/signup.js`, `api/klantwachtwoord.js`, `api/session.js` (compteurs `Map` en mémoire), `api/updateorder.js` (`inflight`)
- Current mitigation : documenté comme frein, pas limite ; compteur atomique pour FA/CN ; concurrence optimiste (`version`) dans le moteur.
- Recommendations : compteur en base si l'abus devient réel.

**Commande par e-mail (spec 020) — sous-traitants non déclarés :**
- Risk : Resend (réception) et Anthropic (lecture) doivent figurer dans `privacy.html` avant l'activation (RUNBOOK § 7.1 étape 9).
- Files : `privacy.html`, `assets/pages/privacy.js`
- Recommendations : critère d'entrée de la phase 3.

**Comptes tous au nom d'une seule personne :**
- Risk : départ, maladie ou perte du téléphone 2FA = portail impossible à dépanner (rollback impossible).
- Files : `docs/COMPTES.md`, `docs/TRANSFERT.md`, `docs/RUNBOOK.md` § 0 (« Qui appeler » vide)
- Recommendations : transfert à Famo Trading BV + second administrateur (hors code, propriétaire).

## Performance Bottlenecks

**Chargement complet des commandes côté staff :**
- Problem : `api/allorders.js` et `S.load` chargent la liste des commandes ; le moteur évite déjà la sérialisation (E-01, `lib/datastore.js` `engineResponse`).
- Files : `api/allorders.js`, `assets/pages/staff-common.js`, `lib/at-engine.js` (table unique `famo_records` JSON, index sur `tbl`)
- Cause : filtrage JSON en SQL sur une table unique
- Improvement path : à mesurer quand l'historique réel grossit (`scripts/bench-engine.js`).

## Fragile Areas

**Numérotation FA/CN et trous de série :**
- Files : `lib/billing.js` (`reserve`/`release`), `lib/commande/nummering.js`, `docs/RUNBOOK.md` § 6
- Why fragile : obligation de séries continues (même internes) ; un numéro réservé puis non écrit est journalisé « Nummer vervallen ».
- Safe modification : contrôles avant réservation ; tests `test/nummering.test.js`, `test/workflow/facturation.test.js` (AX1, AQ5b).
- Test coverage : bonne.

**Remise à zéro de la numérotation (spec 021) :**
- Files : `lib/beheer/testperiode.js`
- Why fragile : légalement acceptable seulement si aucun document d'essai n'a été transmis (client, comptable, Billtobox, export UBL/CSV).
- Safe modification : décision du comptable d'abord (action en attente chez le propriétaire).

**Moteur Airtable → SQL :**
- Files : `lib/at-engine.js`, `lib/at-formula.js`, `lib/datastore.js`
- Why fragile : rejoue un protocole tiers (formules, pages, lots de 10, effacement des champs vides) ; un `DB_BACKEND` mal orthographié est lu comme `airtable`.
- Test coverage : `test/engine.test.js`, `test/datastore.test.js`, `test/engine-switch.test.js`.

## Scaling Limits

**Resend (plan gratuit) :**
- Current capacity : 100 e-mails/jour, ≈ 4 par commande → ≈ 25 commandes/jour (`docs/COUTS.md`)
- Limit : au-delà, les derniers e-mails du jour ne partent pas (les commandes passent)
- Scaling path : plan Pro ; la commande par e-mail ajoute des confirmations.

**Neon (plan gratuit) :**
- Current capacity : restauration point-in-time limitée à 6 h
- Scaling path : plan Launch (7 jours) recommandé avant de stocker de vraies commandes (`docs/COUTS.md`, RUNBOOK § 3.2).

**Anthropic (spec 020) :**
- Current capacity : plafond `INBOUND_AI_DAILY_MAX` = 200 lectures/jour ; ≈ 0,02–0,04 $ par mail.

## Dependencies at Risk

**Vercel « raw body » pour la signature Svix (spec 020) :**
- Risk : si Vercel ne rejoue plus le corps brut, toutes les mails sont refusées (400 « ruwe body onbeschikbaar »).
- Impact : canal e-mail coupé (fail-closed, pas de fausse commande).
- Migration plan : vérifié au premier essai (RUNBOOK § 7.1 étape 7, spec R2).

**Playwright hors dépôt :**
- Risk : version figée 1.56.1 installée à la main ; audits navigateur indisponibles sans elle.

## Missing Critical Features

**Transmission numérique de l'information de traçabilité par lot au client :**
- Problem : règlement (UE) 2023/2842 (contrôle des pêches), obligatoire depuis le 10/01/2026 selon le brief. Le portail gère les lots (`Lots`, instantané à la préparation, mentions art. 35 du règl. 1379/2013 sur le bon de livraison, rappel « lot → clients ») mais ne TRANSMET pas l'information au client sous forme numérique.
- Files : `lib/trace.js`, `api/lots.js`, `team/lots.html`, `assets/pages/team/lots.js`, `assets/docs/documents.js`, `lib/commande/bijwerken.js`, `test/trace.test.js`
- Blocks : conformité réglementaire de la chaîne aval. Trois questions ouvertes (qui demande l'info, forme fournie par les fournisseurs, saisie du lot à chaque préparation) — voir `.planning/ROADMAP.md` phase 2.

**Canal WhatsApp :**
- Problem : demandé par le propriétaire, explicitement « plus tard » (spec 020).

**Exports comptables complets :**
- Problem : UBL par document existe (`api/export.js`, `lib/ubl.js`), CSV construit dans le navigateur ; l'avis du comptable sur leur usage (exports déjà envoyés ? note de ligne UBL BT-127 pour le conditionnement) est en attente.

## Test Coverage Gaps

**Audits navigateur non relancés dans cette mission :**
- What's not tested : `scripts/ux-audit.js`, `scripts/kbd-audit.js`, `scripts/parcours-check.js` (Playwright absent du poste)
- Risk : faible (aucun code modifié) ; ils tournent en CI (job « Navigateur »).
- Priority : Low

**Concurrence réelle multi-instances :**
- What's not tested : deux instances Vercel qui confirment la même réception au même instant ; deux CMD simultanées.
- Files : `lib/ordernumber.js`, `api/updateorder.js`
- Risk : doublon CMD, FA non journalisé (RUNBOOK § 6 « risque résiduel »).
- Priority : Medium (monte avec la commande par e-mail).

## Documentation Drift (constaté, non corrigé)

- `AGENTS.md` « Done so far » saute la spec **021** (testgegevens opruimen, implémentée et documentée dans RUNBOOK § 8 et `docs/SCHEMA.md`).
- En-têtes `**Status**: Ready` sur des specs livrées en production : 001, 003, 005, 013 ; `specs/020-bestellen-per-mail/spec.md` dit « Implemented (local, non déployé) » alors que le code est en production (version 333125a), désactivé par défaut. Les 18 autres specs disent « Implemented ».
- `docs/adr/` contient **5** ADR (0001–0005) + un index `README.md` ; le brief de mission en annonçait 6.
- `IDEAS.md` est daté du 27/09/2026 (B4 et D4 marqués « à faire » dans son pied alors que faits).
- `docs/RUNBOOK.md` § 0 (« Qui appeler ») et § 5 ligne `CRON_SECRET` « à remplir ».
- `DESIGN.md` § Reste à faire : design system claude.ai désynchronisé, variante très contrastée « 5 h du matin » non faite.
- 5 worktrees d'agents ouverts sous `.claude/worktrees/` (budget VibeFlow : 3) — antérieurs à cette mission, non rangés par elle.

---

*Concerns audit: 2026-10-02*
