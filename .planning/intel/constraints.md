# Constraints (synthèse d'ingestion, 2026-10-02)

Une entrée par SPEC (`specs/NNN-*/spec.md`, méthode spec-kit). Toutes au statut « Implemented » (sauf en-têtes périmés signalés en INFO) et livrées en production à la version 333125a, la 020 étant désactivée par défaut.
Ces contraintes décrivent l'existant validé : toute phase qui y touche respecte leur comportement et leurs tests.

## SPEC-001: Pastilles lues (compteurs du menu)
- source: specs/001-badges-lus/spec.md
- type: nfr
- content: les pastilles du menu disparaissent après lecture ; choix Nieuw / Alles / Uit par appareil (K.pref, localStorage).

## SPEC-002: Identité « Vismijn »
- source: specs/002-identite-vismijn/spec.md
- type: nfr
- content: une seule peau pour les trois portails (fond froid, couleur d'action Noordzee, barre équipe bleu-noir, Atkinson Hyperlegible Next, couleurs de statut identiques partout) ; référence DESIGN.md.

## SPEC-003: Régime TVA par client et contrôle VIES
- source: specs/003-regime-tva-vies/spec.md
- type: schema
- content: régime de TVA par client (dont 0 % intracommunautaire / export avec mention) ; numéro de TVA européen vérifié dans VIES (lib/vies.js), panne VIES = 503 claire, jamais bloquante pour l'enregistrement.

## SPEC-004: Plusieurs notes de crédit par facture et e-mail de correction
- source: specs/004-avoirs-multiples-mail-correction/spec.md
- type: api-contract
- content: plusieurs CN par commande facturée, lignes ⊆ livrées, montants aux prix figés ; e-mail de correction au client après correction ou CN.

## SPEC-005: PIN personnels seuls
- source: specs/005-pin-personnels-seuls/spec.md
- type: protocol
- content: option Configuratie « Enkel persoonlijke PIN » : codes partagés refusés (401), seuls les PIN ouvrent ; ADMIN_CODE = accès de secours journalisé « Noodtoegang » sur /beheer/aanmelden si aucun code beheerder enregistré.

## SPEC-006: Dette technique — Beheer découpé, lecture des lignes unique
- source: specs/006-dette-technique/spec.md
- type: nfr
- content: api/onboarding.js = point d'entrée ; actions dans lib/beheer/*.js (require statiques) ; parseLines unique.

## SPEC-007: Logo « F » sobre, accueil sans minuteur
- source: specs/007-logo-f-sans-minuteur/spec.md
- type: nfr
- content: F sobre comme marque, favicon, icône et en-tête de document ; pas de minuteur sur l'accueil.

## SPEC-008: Catalogue client sans la ligne deadline
- source: specs/008-catalogue-sans-ligne-deadline/spec.md
- type: nfr
- content: le catalogue client n'affiche plus la ligne « Vóór 22:00 besteld ».

## SPEC-009: Lot A — finitions
- source: specs/009-lot-a-finitions/spec.md
- type: nfr
- content: documentation exacte, panier juste, nettoyage, focus clavier (inventaire du 01/10/2026, A1/A2/A3/A8).

## SPEC-010: Bijwerken découpé, numérotation FA/CN sans trou inexpliqué
- source: specs/010-updateorder-numerotation/spec.md
- type: protocol
- content: api/updateorder.js aiguille vers lib/commande/* ; réservation de numéro après les contrôles ; numéro rendu si refus certain, sinon ligne « Nummer vervallen » (Journaal + logs) ; procédure RUNBOOK § 6.

## SPEC-011: Scénarios métier découpés par domaine
- source: specs/011-workflow-check-decoupe/spec.md
- type: nfr
- content: test/workflow/<domaine>.test.js, un processus par fichier, _helpers.js ; inventaire.test.js garde 36 blocs et ≥ 752 assertions.

## SPEC-012: Documents A4 et e-mails redessinés
- source: specs/012-documents-emails/spec.md
- type: nfr
- content: documents A4 (leveringsbon, factuur interne, creditnota) avec TVA par ligne, récapitulatif par taux, mentions de traçabilité ; gabarit e-mail unique lib/maillayout.js.

## SPEC-013: Session client par cookie HttpOnly
- source: specs/013-cookie-client-httponly/spec.md
- type: protocol
- content: cookie famo_klant HttpOnly Secure SameSite=Strict Path=/api ; aucune réponse ne contient le jeton ; transition jeton dans le corps jusqu'au 31/10/2026 inclus.

## SPEC-014: URL propres et arborescence par portail
- source: specs/014-url-arborescence/spec.md
- type: api-contract
- content: cleanUrls sans .html, team/ et beheer/, redirections permanentes des anciennes adresses (sources sans .html) ; e-mails gardent /team/bestelling?id=.

## SPEC-015: Leveringen « chauffeur d'abord » et créneau visible
- source: specs/015-chauffeur-creneau/spec.md
- type: schema
- content: mode chauffeur (un stop à la fois, ordre de tournée, preuve, file hors ligne) ; champ Leverslot HH:MM-HH:MM montré au client.

## SPEC-016: Lignes de commande structurées
- source: specs/016-lignes-structurees/spec.md
- type: schema
- content: Lignes JSON (productId, naam, qty, unit, prijs) écrit par le serveur à côté du texte ; stock, retours et recommande par id ; anciennes commandes par nom, pas de rattrapage ; hors périmètre : lots/traçabilité, marge, TVA d'une commande non facturée (restent par nom).

## SPEC-017: Derniers styles en ligne vers ui.css
- source: specs/017-styles-en-ligne/spec.md
- type: nfr
- content: styles en ligne migrés vers les utilitaires de ui.css ; check.js plafonne les styles en ligne statiques restants.

## SPEC-018: Photos produit et ordre par kaliber
- source: specs/018-fotos-kaliber/spec.md
- type: schema
- content: photos toujours visibles, jusqu'à 6 par produit (setFotos, K.thumb, galerie client) ; ordre des produits par kaliber (K.byNameKaliber, K.kaliberOrder).

## SPEC-019: Catalogus — weergave, tri, familles
- source: specs/019-catalogus-weergave/spec.md
- type: nfr
- content: vues Lijst / Tegels / Compact et Sorteren par appareil (K.pref), familles de noms (K.families), barre collante ; constat données réelles : 69 produits, catégories « Algemeen » 56, « VEGETARISCH » 5, « VIS » 6, « SURIMI » 2.

## SPEC-020: Bestellen per e-mail
- source: specs/020-bestellen-per-mail/spec.md
- type: protocol
- content: Resend Receiving sur le sous-domaine orders, webhook /api/inbound-mail signé Svix sur corps brut (RESEND_INBOUND_SECRET, fail-closed), idempotence par id Resend, Claude propose / le serveur décide (lib/bestelling.js), DMARC pass + interrupteur Beheer pour l'automatisme, sinon file « Te controleren » ; inconnus et répondeurs jamais servis ; WhatsApp plus tard ; activation : RUNBOOK § 7.

## SPEC-021: Testperiode afsluiten
- source: specs/021-testgegevens-opruimen/spec.md
- type: protocol
- content: Beheer → Systeemstatus : aperçu sans écriture, archivage réversible « test », suppression définitive après back-up < 30 min et saisie « VERWIJDER TESTS », redémarrage de numérotation seulement si aucun document numéroté ne reste (« HERSTART NUMMERING », avis du comptable) ; behoudKlanten pour garder les commandes des vrais clients ; clients de démo non touchés (suivi : les archiver depuis Klanten).

## SPEC-022: Rapportage
- source: specs/022-rapportage/spec.md
- type: api-contract
- content: page /beheer/rapportage (beheerder seul, NAV_ADMIN), GET /api/rapportage (401/403, commandes test exclues) + /api/marge ; module pur assets/rapport.js ; graphiques SVG sans librairie, filtres dans l'URL, tri, CSV, « Betaald » via updateorder.

## SPEC-023: Verpakking / verkoopeenheid
- source: specs/023-verpakking/spec.md
- type: schema
- content: Catalogue Per verpakking / Verpakking / Enkel per verpakking ; prix et lignes par unité ; conditionnement figé dans Lignes JSON (per, verpakking) ; une règle pour écran, documents, e-mails, UBL (note BT-127) et serveur (FamoVat.pak*) ; non-multiple d'un article « enkel » refusé.
