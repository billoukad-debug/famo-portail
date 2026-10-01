# ADR 0004 — Numérotation CMD / FA / CN

Statut : acceptée, à revoir si plusieurs appareils saisissent en même temps.

## Contexte
Il faut des numéros lisibles et séquentiels par année : commandes `CMD-AAAA-NNNN`, documents `FA-AAAA-NNNN` et creditnota `CN-AAAA-NNNN`. Airtable n'offrait ni transaction ni compteur atomique ; le moteur SQL actuel n'en expose pas non plus au code métier.

## Décision
- Numéro = plus grand numéro de l'année (heure de Bruxelles) + 1 (`lib/ordernumber.js`, `nextNumber` dans `api/updateorder.js`).
- FA et CN : `ensureUnique` relit juste **après** l'écriture ; en cas de doublon, l'enregistrement au plus petit identifiant garde le numéro, l'autre en prend un nouveau (5 essais). Testé : AX1 (FA) et AQ5b (CN).
- CMD : pas de dédoublonnage ; si la lecture échoue, repli sur l'ancien format horodaté (une commande n'est jamais perdue pour un numéro).
- Un numéro FA déjà attribué reste sur la commande si la réception est annulée et resservira à la prochaine confirmation.
- Depuis l'ADR 0005, FA et CN sont des **numéros internes** du portail ; la numérotation légale des factures est celle du comptable (Billtobox).

## Conséquences
- Simple et sans dépendance. Pas de trou garanti ni d'absence de doublon transitoire : un numéro peut être remplacé juste après son attribution.
- Deux commandes créées au même instant peuvent partager une référence CMD (non testé, `lib/ordernumber.js` le documente).
- Piste : compteur atomique dans Postgres (séquence ou ligne compteur avec mise à jour conditionnelle).

## Mise à jour 2026-10-01 (specs/010-updateorder-numerotation)
- Le compteur atomique existe (`lib/billing.js` `reserve`, table interne `Compteurs`, moteur SQL).
- FA/CN (`lib/commande/`) : tout contrôle qui peut refuser passe AVANT la réservation ; la note de crédit
  ne réserve qu'au moment d'écrire, sur l'état relu. Un numéro réservé puis non écrit est rendu au
  compteur si le refus est certain et qu'il est encore le dernier (`billing.release`), sinon journalisé
  « Nummer vervallen » (Journaal + logs). Une écriture en échec ne rend jamais le numéro (issue incertaine).
  Procédure : `docs/RUNBOOK.md` § 6.
