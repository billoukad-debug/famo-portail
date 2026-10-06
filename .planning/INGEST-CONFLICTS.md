## Conflict Detection Report

Opération : ingest (gsd-ingest-docs, mode new, corpus par manifeste de 37 documents, 2026-10-02).

### BLOCKERS (0)

### WARNINGS (0)

### INFO (9)

[INFO] Corpus réduit par manifeste (plafond de 50 documents)
  Note: 83 candidats détectés par `init onboard` ; manifeste limité aux spec.md des 23 specs (plan.md, tasks.md et checklists exclus : ils détaillent l'exécution, pas la décision), à la constitution, aux ADR et aux DOC racine. Source : .planning/intel/classifications/

[INFO] Cycle de renvois cassé en excluant cinq DOC de plus faible précédence
  Note: le graphe des renvois entre documents formait une composante cyclique de 17 nœuds (constitution, ADR 0002 et 0005, specs 005, 010, 013, 016, 023, AGENTS.md, CONTRIBUER.md, VERCEL_CHECKLIST.md, docs/COMPTES.md, docs/COUTS.md, docs/TRANSFERT.md, docs/RUNBOOK.md, docs/SCHEMA.md, IDEAS.md). Retrait glouton par précédence croissante : AGENTS.md, docs/RUNBOOK.md, docs/SCHEMA.md, docs/TRANSFERT.md, IDEAS.md exclus ; les 37 restants forment un graphe acyclique. Le contenu exclu est repris par .planning/codebase/ et cité dans PROJECT.md.

[INFO] Auto-resolved: constitution > SPEC sur la langue des e-mails client
  Note: .specify/memory/constitution.md § IV dit « E-mails : néerlandais » ; specs/020-bestellen-per-mail/spec.md (confirmation « dans sa langue (NL/FR) ») et le code (lib/ordermail.js, audit C-15 : tout e-mail destiné au client part dans sa langue) envoient les e-mails client en NL ou FR. La constitution verrouillée l'emporte dans l'intel ; l'écart code/constitution est porté en question ouverte (amender la constitution ou non).

[INFO] Auto-resolved: SPEC > DOC sur le nombre de photos par produit
  Note: README.md décrit « une photo (Foto, ≤ 3 Mo) » par produit ; specs/018-fotos-kaliber/spec.md et le code permettent jusqu'à 6 photos. La SPEC l'emporte ; README périmé sur ce point.

[INFO] Auto-resolved: code > DOC sur les relances de paiement
  Note: README.md range « rappels de paiement automatiques » dans « Pas dans cette version » ; le cron /api/reminders-cron et l'option Configuratie « Herinneringen aan » existent (vercel.json, lib/reminders.js). README périmé sur ce point.

[INFO] En-têtes de statut périmés dans des specs livrées
  Note: specs 001, 003, 005 et 013 portent « Status: Ready » ; specs/020-bestellen-per-mail/spec.md porte « Implemented (local, non déployé) » alors que le brief indique la spec livrée en production (version 333125a), désactivée par défaut. Les faits du brief l'emportent pour l'état de production.

[INFO] Nombre d'ADR
  Note: le brief de mission annonce 6 ADR ; docs/adr/ contient 5 ADR (0001 à 0005) et un index README.md.

[INFO] Rôle de Mohsen
  Note: specs/018-fotos-kaliber/spec.md le présente comme « personnel », specs/023-verpakking/spec.md comme « gérant de FAMO » ; le brief dit « gérant Mohsen ». Retenu : gérant (source la plus récente et brief).

[INFO] AGENTS.md « Done so far » omet la spec 021
  Note: specs/021-testgegevens-opruimen est implémentée (statut Implemented, RUNBOOK § 8) mais absente de la liste « Done so far » d'AGENTS.md (document exclu du corpus, constaté à la cartographie). Dérive documentaire tracée, non corrigée.
