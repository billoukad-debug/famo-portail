# Checklist Vercel — avant mise en production

## Variables d'environnement (Settings → Environment Variables)
| Variable | Valeur | Note |
|---|---|---|
| `AIRTABLE_TOKEN` | (déjà en place) | régénérer si transmis hors coffre |
| `STAFF_CODE` | **à créer** — code fort, jamais `famo2026` | sans elle, les écrans staff renvoient 500 avec message explicite |

Après création/modification : **Redeploy** (une variable ne s'applique qu'au déploiement suivant).

## Vérifications après déploiement
```bash
# ancien code refusé
curl -s -o /dev/null -w "%{http_code}\n" "https://famo-portail.vercel.app/api/allorders?code=famo2026"   # attendu: 401
# nouveau code accepté
curl -s -o /dev/null -w "%{http_code}\n" "https://famo-portail.vercel.app/api/allorders?code=<STAFF_CODE>" # attendu: 200
# mot de passe en GET refusé
curl -s -o /dev/null -w "%{http_code}\n" "https://famo-portail.vercel.app/api/catalogue?user=x&pw=y"      # attendu: 405
# cadrage fermé
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://famo-portail.vercel.app/api/cadrage"            # attendu: 410
```
