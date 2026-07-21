# Purge de mise en service — À NE PAS EXÉCUTER SANS DÉCISION EXPLICITE

Objectif : passer des données de test aux données réelles. La première vraie facture doit être FA-2026-0001.

## Avant toute purge
1. Export CSV de sauvegarde de chaque table (Commandes, Mouvements de stock, Stock, Clients, Catalogue, Prix négociés) → archiver dans le dossier FAMO.
2. Vérifier que les 6 étapes de /aan-de-slag.html sont vertes (données réelles saisies).

## Purge (manuelle, dans Airtable)
1. Table **Commandes** : supprimer toutes les lignes de test (références CMD-…). Le compteur de facture se recalcule sur l'existant : table vide ⇒ prochain numéro FA-2026-0001.
2. Table **Mouvements de stock** : supprimer les lignes de test.
3. Table **Stock** : remplacer les quantités fictives par le comptage réel (ou remettre à zéro puis saisir via /stock.html pour journaliser).
4. Table **Clients** : supprimer « Restaurant Le Ponton (TEST) » et ses prix négociés liés.
5. Contrôle final : une commande réelle de bout en bout (cf. étape 6 du guide).

## Jamais
- Ne jamais purger sans les exports CSV.
- Ne jamais mélanger test et réel après la purge.
