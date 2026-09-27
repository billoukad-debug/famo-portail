# ADR 0005 — Facturation légale chez le comptable ; le portail n'émet pas de facture

Statut : acceptée le 27/09/2026 (décision du client, Famo Trading BV, BCE 0788.705.713).

## Contexte
Le portail produit des documents « leveringsbon », « factuur » et « creditnota » (`documents.js`) numérotés `FA-` / `CN-`. Une facture légale belge B2B doit porter toutes les mentions obligatoires et, avec l'obligation de facturation électronique B2B, transiter par le réseau Peppol. Le comptable de l'entreprise émet déjà les factures via **Billtobox** (Peppol).

## Décision
- Les factures et notes de crédit **légales** sont émises par le comptable dans Billtobox.
- Les documents du portail deviennent explicitement des documents internes, marqués « pas une facture » (modification en cours par un autre développeur) ; leurs numéros FA/CN sont des références internes.
- Le portail fournira au comptable des **exports** (CSV, et UBL si le comptable le demande) des commandes livrées et des creditnota, plutôt que d'envoyer lui-même sur Peppol.

## Conséquences
- Pas de responsabilité légale de numérotation ni de conformité Peppol dans le portail ; `IDEAS.md` C1 et C3 sont requalifiés.
- Risque de confusion pour le client final tant que la mention « pas une facture » n'est pas en place, et de double numérotation (FA interne vs numéro du comptable) : l'export doit porter les deux références.
- Les e-mails « geleverd » ne doivent plus présenter le document du portail comme la facture.
