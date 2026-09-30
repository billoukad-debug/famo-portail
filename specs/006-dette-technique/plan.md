# Implementation Plan: Dette technique (I-10, I-11)

## Summary
Découpage mécanique par script (extraction des blocs `if (action === …)`, imports calculés sur l'usage réel, contrôle « aucun code hors bloc ») ; un aiguillage `ACTIONS` → `run(ctx)`, chaque module finit par le même 400 « Onbekende actie » que l'original.

## Constitution Check
- I. Sans build : ✅ modules CommonJS, `require` statiques (Vercel nft).
- II. Le serveur décide : ✅ garde et session inchangées, en tête du seul point d'entrée.
- III. Tests : ✅ tests de structure (routage, taille, garde) et de parité ; toutes les portes existantes.
- IV / V : ✅ aucun changement visible ni de données.

## Complexity Tracking
Deux contrôles textuels de `workflow-check.js` (P7, AN10) lisent désormais le fichier où le code a été déplacé ; le harnais e-mail de `test/security.test.js` recharge aussi `lib/beheer/*`. Aucune assertion affaiblie.
