# Spec 028 — Retours de Mohsen (2026-10-09)

**Statut** : implémenté (points 1, 4, 5, 6) · photos, logo et visuels de vitrine en cours.

| # | Message (NL) | Décision | Fait |
|---|---|---|---|
| 1 | Caliber verandere door gramage | Le libellé « Kaliber » devient « Gewicht » (FR « Grammage ») partout : fiche produit, catalogue client, voorraad, vitrine. Même champ en base (`Kaliber`), saisie « 500 g », « 1 kg ». | ✅ |
| 2 | Paar foto's | Visuels de présentation pour la vitrine (mer, bateaux) + photos produits | ⏳ |
| 3 | Logo | Créer un vrai logo FAMO puis l'intégrer | ⏳ propositions |
| 4 | Alleen beheer bestellingen volledig annuleren | Côté personnel, seul le beheerder annule (`lib/commande/corrigeren.js`, 403 sinon ; bouton caché au personnel) | ✅ |
| 5 | Klant alleen voor levering annuleren | Le client annule jusqu'au départ en livraison : Ontvangen **et** Klaar (`api/klantorder.js`), plus après | ✅ |
| 6 | Bestaande categorie aanpassen | Beheer → Producten : « Hernoemen » par catégorie, renomme tous ses produits (`renameCategory`) | ✅ |

Tests : `test/retours-mohsen.test.js`, `test/workflow/corrections.test.js` (AN5, AN8), `test/lignes-structurees.test.js`.
