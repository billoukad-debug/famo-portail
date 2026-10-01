# Checklist Vercel — mise en service

Production au 27/09/2026 : Vercel + Neon (`DB_BACKEND=postgres`). Airtable n'est plus utilisé en production. Plan Vercel : **Pro** obligatoire (le plan Hobby interdit l'usage commercial, voir `docs/COUTS.md`). Incidents et retour arrière : `docs/RUNBOOK.md`. Comptes et propriétaires : `docs/COMPTES.md`.

## Variables d'environnement

Toutes les variables lues par `api/` et `lib/`. Après toute modification : **Redeploy** (Vercel n'applique pas une variable à un déploiement existant).

| Variable | Valeur | Note |
|---|---|---|
| `ADMIN_CODE` | code admin fort (≥ 10 caractères, ne commence pas par « famo ») | Beheer (config, IBAN, clients, prix, codes). Sans lui, Beheer est fermé, PIN beheerder compris. |
| `STAFF_CODE` | code personnel fort | Personnel : Bestellingen, Magazijn, Leveringen, Invoeren, Documenten, Voorraad (pas Beheer ni Systeemstatus). Facultatif si `ADMIN_CODE` existe (**au moins l'un des deux**, sinon toute connexion staff répond 500). Peut être remplacé par un code enregistré dans Beheer → Toegang (haché). Plus de fallback `famo2026`. |
| `SESSION_SECRET` | 32 octets aléatoires ou plus (`openssl rand -base64 48`) | **Recommandée, à poser avant tout changement d'une autre variable** : signe les cookies staff et les jetons clients. Sans elle, le secret dérive de `AIRTABLE_TOKEN`, `DATABASE_URL`, `STAFF_CODE`, `ADMIN_CODE` : changer l'une d'elles déconnecte tout le monde. |
| `DB_BACKEND` | `postgres` | Production. Toute autre valeur que `postgres` / `sqlite` est lue comme `airtable`. |
| `DATABASE_URL` | fournie par l'intégration Neon (Vercel → Storage) | Obligatoire avec `DB_BACKEND=postgres` ; sans elle : 500 `DATABASE_NOT_CONFIGURED`. `POSTGRES_URL` est lue en repli. |
| `NEON_HTTP_URL` | — | Facultatif : point d'entrée HTTP de Neon, déduit de l'adresse par défaut. |
| `AIRTABLE_TOKEN` | (secret) | Plus nécessaire au fonctionnement ; sert à la copie / comparaison depuis l'ancienne base (Systeemstatus). Voir `SESSION_SECRET` avant de la retirer. |
| `RESEND_API_KEY` | clé Resend | Facultatif — **sans elle, aucun e-mail n'est envoyé** et les commandes fonctionnent normalement. |
| `MAIL_FROM` | `FAMO Seafood <bestellingen@VOTRE-DOMAINE.be>` | Domaine **vérifié chez Resend** obligatoire. Sans elle : `onboarding@resend.dev`, qui ne délivre qu'au propriétaire du compte Resend. |
| `MAIL_TIMEOUT_MS` | `4000` (défaut) | Facultatif : délai max d'un envoi. |
| `PORTAL_URL` | `https://VOTRE-DOMAINE` (sans `/` final) | Liens des e-mails. Sans elle, l'adresse est déduite de la requête (peut donner l'adresse `*.vercel.app`). |
| `CRON_SECRET` | aléatoire (≥ 16 caractères) | **Obligatoire** : protège les deux tâches planifiées de `vercel.json` (`/api/backup-cron` 02:17 UTC, `/api/reminders-cron` 07:43 UTC). Sans elle, les deux répondent 500 et ne font rien. 16 caractères aléatoires minimum. La sauvegarde nocturne part **par e-mail** : il faut aussi `RESEND_API_KEY` et un destinataire (`BACKUP_EMAIL` ou Beheer → Bedrijfsgegevens → Bestellingen e-mail). |

Ne jamais donner aux déploiements Preview les secrets de production (`DATABASE_URL` de production surtout) : une preview écrirait dans la base réelle. Utiliser une branche Neon dédiée pour Preview.

Auth staff = cookie de session HttpOnly (`/api/session`). Les pages n'utilisent plus `?code=`.

## Première mise en route
1. Ouvrir `/beheer` et se connecter avec `ADMIN_CODE`
2. **Bedrijfsgegevens** : identité (Famo Trading BV / FAMO Seafood, BCE 0788.705.713), IBAN/BIC réels, taux de TVA, conditions
3. **Producten** : vérifier le catalogue et les prix
4. **Klanten** : créer le premier client (identifiants affichés une seule fois — les copier)
5. **Prijzen** : prix négociés si nécessaire
6. Commande test via `/` puis Magazijn → Leveringen → Documenten

## Vérifications rapides
```bash
# login (remplacer VOTRE_ADMIN_CODE ; ne pas laisser le code dans l'historique du shell)
curl -s -c /tmp/famo.ck -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/session" \
  -H "Content-Type: application/json" -d '{"code":"VOTRE_ADMIN_CODE"}'   # attendu: 200

curl -s -b /tmp/famo.ck -o /dev/null -w "%{http_code}\n" "https://famo-portail.vercel.app/api/onboarding"  # attendu: 200

# famo2026 doit échouer
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/session" \
  -H "Content-Type: application/json" -d '{"code":"famo2026"}'   # attendu: 401
```

Beheer → Systeemstatus → **Database** doit indiquer `postgres` et « bereikbaar ».

## Mise en service des e-mails

1. Créer un compte sur **resend.com**. Plan gratuit : 3 000 e-mails/mois et **100 par jour**. Une commande complète envoie **4 e-mails** (nouvelle commande : équipe + client ; « onderweg » ; « geleverd ») : le plan gratuit couvre donc **≈ 25 commandes par jour** (100 / 4), et ≈ 750 par mois. Au-delà : plan Pro (voir `docs/COUTS.md`).
2. Y ajouter **votre domaine** (géré chez one.com) et poser chez one.com les enregistrements DNS affichés par Resend : DKIM (TXT), SPF (MX + TXT sur le sous-domaine d'envoi), puis un DMARC (`_dmarc`, TXT). Détail : `docs/RUNBOOK.md`, « E-mails ».
3. Attendre que Resend affiche le domaine comme **verified**.
4. Poser `RESEND_API_KEY` et `MAIL_FROM` dans Vercel (Production ; Preview seulement avec une clé de test), puis **Redeploy**.
5. Beheer → Bedrijfsgegevens → carte **E-mail** → champ « **Interne postbus (melding bij elke bestelling)** » : la boîte interne qui reçoit les commandes.
6. Beheer → Klanten : renseigner l'adresse e-mail de chaque client (sans elle, il ne reçoit aucune confirmation — la liste signale « geen e-mail »).
7. Passer une commande test depuis le portail client et vérifier **les deux** boîtes.

### Vérification
- Journal Resend (onglet *Emails*) : deux envois à la commande, puis un au départ et un à la réception.
- Logs Vercel : une ligne `[mail] …` n'apparaît qu'en cas d'échec (domaine non vérifié, quota, adresse invalide).
- Un échec d'envoi n'annule jamais la commande : elle reste enregistrée dans la base (Neon en production).
