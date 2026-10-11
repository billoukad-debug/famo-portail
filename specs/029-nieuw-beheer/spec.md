# Spec 029 — « Nieuw » dans Beheer

**Demande du gérant (2026-10-10)** : à chaque modification, une notification pour Mohsen dans Beheer qui explique ce qui a changé et ce qu'il doit mettre à jour, dans le ton le plus simple possible.

- `assets/nieuws.js` : la liste des notes (NL simple) : titre, ce qui a changé, « Wat moet u doen? » avec liens directs.
- Beheer : onglet « Nieuw » (pastille = non lu) + bandeau en haut de l'Overzicht tant qu'il reste du non lu ; « Gezien » par note, « Alles gezien ». Lu = par appareil.
- **Règle** : toute nouvelle spec (≥ 027) doit avoir sa note, sinon `test/nieuws.test.js` échoue (CI rouge, pas de fusion). Pas de jargon technique, pas de tiret long.

## Validation par Mohsen avant publication (demande du gérant, 2026-10-10)
Règle dès maintenant : aucune fusion ni publication tant que Mohsen n'a pas validé la mise à jour.
À construire ensuite (spec 030) : dans Beheer, « Update klaar » montre les notes de la prochaine version ; Mohsen
clique « Goedkeuren » et c'est seulement alors que la version est fusionnée et publiée. Nécessite une clé GitHub
limitée à ce dépôt, ajoutée par le propriétaire dans Vercel (jamais affichée).
