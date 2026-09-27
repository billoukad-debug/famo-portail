# Décisions d'architecture (ADR)

Une décision par fichier : contexte, décision, conséquences. On n'efface pas une ADR dépassée : on en écrit une nouvelle qui la remplace et on change le statut de l'ancienne.

| N° | Décision | Statut |
|---|---|---|
| [0001](0001-sans-build-sans-dependances.md) | Pas de build, pas de dépendances npm | Acceptée |
| [0002](0002-airtable-puis-neon.md) | Airtable d'abord, puis bascule sur Neon via `lib/at-engine.js` | Acceptée (bascule faite) |
| [0003](0003-jeton-client-signe.md) | Jeton client signé dans l'onglet, cookie HttpOnly pour le personnel | Acceptée |
| [0004](0004-numerotation.md) | Numérotation CMD / FA / CN : max + 1 puis dédoublonnage | Acceptée, à revoir |
| [0005](0005-facturation-legale.md) | Facturation légale chez le comptable (Billtobox), le portail n'émet pas de facture | Acceptée (27/09/2026) |
