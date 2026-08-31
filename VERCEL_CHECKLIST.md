# Checklist Vercel — mise en service

## Variables d'environnement
| Variable | Valeur | Note |
|---|---|---|
| `AIRTABLE_TOKEN` | (secret) | obligatoire |
| `ADMIN_CODE` | code admin fort | **obligatoire** — accès complet (config, IBAN, clients, prix, Invoeren, Voorraad, Documenten). |
| `STAFF_CODE` | code personnel fort | optionnel — accès limité à Bestellingen/Magazijn/Leveringen. Peut être identique à `ADMIN_CODE` au démarrage. Plus de fallback `famo2026`. |
| `RESEND_API_KEY` | clé Resend | optionnel — **sans elle, aucun e-mail n'est envoyé** et les commandes fonctionnent normalement. |
| `MAIL_FROM` | `Famo Trading <bestellingen@famotrading.be>` | domaine **vérifié chez Resend** obligatoire. `onboarding@resend.dev` ne délivre qu'au propriétaire du compte Resend. |

Auth staff = cookie de session HttpOnly (`/api/session`). Les pages n’utilisent plus `?code=`.

Après modification d’une variable : **Redeploy**.

## Première mise en route
1. Ouvrir `/beheer.html` et se connecter avec `ADMIN_CODE`
2. **Bedrijfsgegevens** : identité, IBAN/BIC réels, taux de TVA, conditions
3. **Producten** : vérifier le catalogue et les prix
4. **Klanten** : créer le premier client (identifiants affichés une seule fois — les copier)
5. **Prijzen** : prix négociés si nécessaire
6. Commande test via `/` puis Magazijn → Leveringen → Documenten

## Vérifications rapides
```bash
# login (remplacer STAFF_CODE)
curl -s -c /tmp/famo.ck -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/session" \
  -H "Content-Type: application/json" -d '{"code":"VOTRE_ADMIN_CODE"}'   # attendu: 200

curl -s -b /tmp/famo.ck -o /dev/null -w "%{http_code}\n" "https://famo-portail.vercel.app/api/onboarding"  # attendu: 200

# famo2026 doit échouer
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/session" \
  -H "Content-Type: application/json" -d '{"code":"famo2026"}'   # attendu: 401
```

## Mise en service des e-mails

1. Créer un compte sur **resend.com** (gratuit : 100 e-mails/jour, 3 000/mois — soit ~50 commandes/jour à 2 e-mails chacune).
2. Y ajouter le domaine `famotrading.be` et poser les enregistrements DNS (SPF + DKIM) chez le registrar.
3. Attendre que Resend affiche le domaine comme **verified**.
4. Poser `RESEND_API_KEY` et `MAIL_FROM` dans Vercel (Production + Preview), puis **Redeploy**.
5. Beheer → Bedrijfsgegevens → **Bestelmeldingen** : renseigner la boîte interne qui reçoit les commandes.
6. Beheer → Klanten : renseigner l'adresse e-mail de chaque client (sans elle, il ne reçoit aucune confirmation — la liste signale « geen e-mail »).
7. Passer une commande test depuis le portail client et vérifier **les deux** boîtes.

### Vérification
- Journal Resend (onglet *Emails*) : deux envois par commande.
- Logs Vercel : une ligne `[mail] …` n'apparaît qu'en cas d'échec (domaine non vérifié, quota, adresse invalide).
- Un échec d'envoi n'annule jamais la commande : elle reste enregistrée dans Airtable.
