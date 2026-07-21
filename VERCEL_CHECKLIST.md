# Checklist Vercel — avant mise en production

## Variables d'environnement (Settings → Environment Variables)
| Variable | Valeur | Note |
|---|---|---|
| `AIRTABLE_TOKEN` | (déjà en place) | régénérer si transmis hors coffre |
| `STAFF_CODE` | **à créer / à faire tourner immédiatement** | jamais `famo2026` (compromis). Sans variable, les API staff répondent 500. |

**Urgent :** faire tourner `STAFF_CODE` dès maintenant si l’ancien code public `famo2026` a jamais été utilisé. Auth staff = cookie de session HttpOnly (`/api/session`) ; les pages ne mettent plus le code dans `?code=`.

Après création/modification : **Redeploy** (une variable ne s'applique qu'au déploiement suivant).

## Vérifications après déploiement
```bash
# ancien code compromis refusé
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/session" \
  -H "Content-Type: application/json" -d '{"code":"famo2026"}'   # attendu: 401

# login session (cookie HttpOnly) puis accès sans ?code=
curl -s -c /tmp/famo.ck -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/session" \
  -H "Content-Type: application/json" -d '{"code":"<STAFF_CODE>"}'   # attendu: 200
curl -s -b /tmp/famo.ck -o /dev/null -w "%{http_code}\n" "https://famo-portail.vercel.app/api/allorders"  # attendu: 200 (cookie seul)

# mot de passe en GET refusé
curl -s -o /dev/null -w "%{http_code}\n" "https://famo-portail.vercel.app/api/catalogue?user=x&pw=y"      # attendu: 405
# cadrage fermé
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/cadrage"            # attendu: 410
```
