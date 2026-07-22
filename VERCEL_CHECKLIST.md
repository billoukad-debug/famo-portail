# Checklist Vercel — mise en service Mohsen

## Variables d'environnement
| Variable | Valeur | Note |
|---|---|---|
| `AIRTABLE_TOKEN` | (déjà en place) | garder secret |
| `STAFF_CODE` | optionnel pour l’instant | **fallback temporaire `famo2026`** si absent (demande produit). À renforcer plus tard. |

Auth staff = cookie de session HttpOnly (`/api/session`). Les pages n’utilisent plus `?code=`.

Après modification d’une variable : **Redeploy**.

## Onboarding Mohsen
1. Ouvrir `/aan-de-slag.html`
2. Code staff : `famo2026` (ou votre `STAFF_CODE` Vercel)
3. Remplir les 6 étapes **dans le portail** (plus besoin d’ouvrir Airtable pour le flux de base)
4. Noter / copier les credentials clients générés
5. Une commande test via `/` puis Magazijn

## Vérifications rapides
```bash
# login temporaire
curl -s -c /tmp/famo.ck -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/session" \
  -H "Content-Type: application/json" -d '{"code":"famo2026"}'   # attendu: 200

curl -s -b /tmp/famo.ck -o /dev/null -w "%{http_code}\n" "https://famo-portail.vercel.app/api/onboarding"  # attendu: 200
```
