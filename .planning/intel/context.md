# Context (synthèse d'ingestion, 2026-10-02)

Notes par thème extraites des documents de type DOC du corpus ingéré, avec leur source.
Les cinq DOC exclus du corpus pour casser un cycle de renvois (AGENTS.md, docs/RUNBOOK.md, docs/SCHEMA.md, docs/TRANSFERT.md, IDEAS.md) restent des références de premier rang : leur contenu est repris par `.planning/codebase/` et cité dans `.planning/PROJECT.md`.

## Produit et utilisateurs
- source: README.md
- FAMO Seafood (nom commercial de Famo Trading BV, BCE 0788.705.713), grossiste en produits de la mer à Anvers. Le client commande en ligne, le personnel prépare et livre, le responsable administre.
- Trois portails, une identité : Klant (`/`, `/klant`, `/aanvraag`, `/wachtwoord` ; NL/FR), Personeel (`/team/*` ; NL ; code ou PIN, cookie 8 h), Beheer (`/beheer`, `/beheer/rapportage` ; beheerder).
- Parcours d'une commande : commande client (prix recalculés serveur) → validation article par article et Klaarzetten → Vertrekt (verrouillée) → Ontvangst bevestigen (réceptionnaire obligatoire, exception) → Facturée avec numéro interne FA → Betaald → Creditnota éventuelle.
- « Pas dans cette version » : optimisation de tournée, carte, suivi live client, import Excel, envoi Peppol depuis le portail.

## Utilisateurs et contextes d'usage
- source: DESIGN.md
- Client : chef ou gérant de restaurant, le soir, souvent au téléphone. Personnel : préparateur, livreur, 5 h du matin, froid, gants, téléphone bon marché. Administration : responsable, au bureau.
- Le mobile n'est pas secondaire. Reste à faire design : variante très contrastée pour Magazijn/Leveringen, PDF sans en-tête répété, design system claude.ai à resynchroniser.

## Contribution et portes de qualité
- source: CONTRIBUER.md
- Avant push : `node scripts/assets-version.js && node scripts/check.js && npx -y eslint@9.39.5 .` ; interface : `docs/CHECKLIST-UX.md` + `scripts/ux-audit.js` contre `scripts/dev.js`.
- CI GitHub sur toute branche et toute PR : « Tests et lint » + « Navigateur ». Vercel déploie sans attendre la CI (Deployment Checks non vérifiés au 27/09/2026).
- Règles de la maison : une feuille, un module partagé ; ne jamais modifier `api/`/`lib/` pour un besoin d'affichage ; ne jamais commiter `.dev-data/` ni un secret.

## Checklist UX
- source: docs/CHECKLIST-UX.md
- Familles INT, CLA, FOR, EDI, ETA, MEP, CHI, MOU, ACC, PER, TON ; à passer pour tout changement d'interface.

## Exploitation, comptes et coûts
- source: docs/COMPTES.md
- Tous les comptes (GitHub `billoukad-debug/famo-portail`, Vercel, Neon, Resend, one.com, Airtable) sont au nom d'une seule personne, sans second administrateur : risque principal.
- source: docs/COUTS.md
- ≈ 20 à 50 $/mois : Vercel Pro requis (usage commercial), Neon Launch recommandé (restauration 7 jours au lieu de 6 h), Resend gratuit jusqu'à ≈ 25 commandes/jour, Anthropic ≈ 0,02-0,04 $ par e-mail lu (spec 020).
- source: VERCEL_CHECKLIST.md
- Variables d'environnement de production et vérifications de mise en service (login, refus de l'ancien code `famo2026`, e-mails).

## ADR (index)
- source: docs/adr/README.md
- Cinq ADR (0001 à 0005), une décision par fichier ; une ADR dépassée n'est pas effacée, on en écrit une nouvelle qui la remplace.

## Faits du brief de mission (propriétaire, 2026-10-02 — hors corpus, relayés par vibeflow-head)
- source: brief de mission vibeflow-head → vf-dev-manager
- Production à la version 333125a : specs 001-023 livrées (020 désactivée par défaut) + correctif des favoris.
- Décision VERROUILLÉE 2026-10-02 : factures légales et Peppol par le comptable via Billtobox (ADR 0005) ; idée différée : Peppol direct seulement si FAMO quitte Billtobox.
- Données catalogue à corriger : `Kaliber` contient des poids (« 0.800 »), 56 produits sur 69 en « Algemeen ».
- Traçabilité numérique par lot : règlement (UE) 2023/2842, obligatoire depuis le 10/01/2026 ; le portail gère déjà les lots, il manque la transmission numérique au client ; trois questions ouvertes.
- Actions en attente chez le propriétaire : nettoyage des tests (spec 021), avis du comptable (exports déjà envoyés ? remise à zéro de la numérotation ? note de ligne UBL BT-127), réglages Resend inbound (RUNBOOK § 7).
