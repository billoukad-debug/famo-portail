# Inventaire des comptes

Modèle à tenir à jour par Famo Trading BV. **Aucun secret dans ce fichier** : ni mot de passe, ni code, ni clé, ni code de récupération 2FA. Les secrets vivent dans un gestionnaire de mots de passe de l'entreprise (à choisir), partagé entre au moins deux personnes.

État connu au 27/09/2026 : **tous les comptes sont au nom d'une seule personne**, sans second administrateur. C'est le risque principal (départ, maladie, perte du téléphone 2FA = portail impossible à dépanner). Procédure pour y remédier : `docs/TRANSFERT.md`.

## Comptes

| Service | Rôle pour le portail | Propriétaire (compte, e-mail de connexion) | 2ᵉ administrateur | 2FA activée ? (méthode, où sont les codes de secours) | Facturation (plan, carte au nom de) | Dernière vérification |
|---|---|---|---|---|---|---|
| **GitHub** (dépôt `famo-portail`) | code source, CI | compte personnel `billoukad-debug` (dépôt `billoukad-debug/famo-portail`, pas d'organisation) | _aucun_ | _à remplir_ | gratuit | _à remplir_ |
| **Vercel** (projet `famo-portail`) | hébergement, fonctions, variables d'environnement | _à remplir_ | _aucun_ | _à remplir_ | _à remplir_ (Pro requis, voir `docs/COUTS.md`) | _à remplir_ |
| **Neon** (projet Postgres) | base de données de production | _à remplir_ (via l'intégration Vercel ?) | _aucun_ | _à remplir_ | _à remplir_ | _à remplir_ |
| **Resend** | envoi des e-mails | _à remplir_ | _aucun_ | _à remplir_ | _à remplir_ (si plan gratuit : 100 e-mails/jour) | _à remplir_ |
| **one.com** | nom de domaine et DNS | _à remplir_ | _aucun_ | _à remplir_ | _à remplir_ (renouvellement annuel : date ?) | _à remplir_ |
| **Airtable** (base historique) | plus utilisée en production ; archive | _à remplir_ | _aucun_ | _à remplir_ | _à remplir_ | _à remplir_ |
| **Billtobox** | factures légales (comptable, Peppol) | _à remplir_ (comptable ?) | _à remplir_ | _à remplir_ | _à remplir_ | _à remplir_ |
| Messagerie de l'entreprise (boîte « Interne postbus », `E-mail` de Configuratie) | reçoit les commandes | _à remplir_ | _à remplir_ | _à remplir_ | _à remplir_ | _à remplir_ |

## Accès applicatifs (dans le portail)

| Accès | Où il est géré | Qui le connaît / l'utilise | Dernière rotation |
|---|---|---|---|
| Code beheerder (`ADMIN_CODE` ou code enregistré) | Vercel / Beheer → Toegang | _à remplir_ | _à remplir_ |
| Code personnel (`STAFF_CODE` ou code enregistré) | Vercel / Beheer → Toegang | _à remplir_ | _à remplir_ |
| PIN individuels | Beheer → Toegang → Medewerkers | une ligne par personne dans la table | — |
| `SESSION_SECRET`, `DATABASE_URL`, `RESEND_API_KEY` | Vercel → Environment Variables | _à remplir_ | _à remplir_ |

## Règles

- Chaque service a **au moins deux administrateurs** de l'entreprise, avec 2FA.
- Les comptes appartiennent à l'entreprise (adresse e-mail de l'entreprise, organisation / équipe), pas à une personne ni à un prestataire.
- Un prestataire reçoit un accès nominatif, retiré à la fin de sa mission (et les secrets qu'il a vus sont renouvelés : `docs/RUNBOOK.md` § 5).
- Relire ce tableau tous les 6 mois et à chaque départ.
