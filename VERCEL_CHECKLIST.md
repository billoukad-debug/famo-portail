# Checklist Vercel — mise en service

## Variables d'environnement
| Variable | Valeur | Note |
|---|---|---|
| `AIRTABLE_TOKEN` | (secret) | obligatoire |
| `STAFF_CODE` | code staff fort | **obligatoire** — sans ça, login staff = 401/500. Plus de fallback `famo2026`. |

Auth staff = cookie de session HttpOnly (`/api/session`). Les pages n’utilisent plus `?code=`.

Après modification d’une variable : **Redeploy**.

## Onboarding Mohsen
1. Ouvrir `/aan-de-slag.html`
2. Code staff = valeur `STAFF_CODE` Vercel
3. Remplir les 6 étapes (IBAN/BIC réels dès que possible ; exemples temporaires OK pour tester le flux)
4. Noter / copier les credentials clients générés
5. Une commande test via `/` puis Magazijn → Leveringen

## Vérifications rapides
```bash
# login (remplacer STAFF_CODE)
curl -s -c /tmp/famo.ck -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/session" \
  -H "Content-Type: application/json" -d '{"code":"VOTRE_STAFF_CODE"}'   # attendu: 200

curl -s -b /tmp/famo.ck -o /dev/null -w "%{http_code}\n" "https://famo-portail.vercel.app/api/onboarding"  # attendu: 200

# famo2026 doit échouer
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/session" \
  -H "Content-Type: application/json" -d '{"code":"famo2026"}'   # attendu: 401
```
