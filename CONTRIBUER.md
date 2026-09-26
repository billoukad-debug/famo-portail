# Avant de pousser du code

```bash
node scripts/assets-version.js   # met à jour les ?v= des scripts/feuilles (cache long) après une modif front
node scripts/check.js
npx --yes eslint@9 .
```

Vert = déployable. `check.js` refuse une version de fichier périmée (sinon un navigateur garderait l'ancien script en cache). Le même contrôle tourne sur GitHub à chaque push (onglet Actions).

## Ce qui est vérifié
- Syntaxe de tout le JavaScript et des scripts inline.
- `api/` : aucun secret, aucun code de secours ; `lib/staffauth.js` reste fail-closed.
- Les e-mails lient toujours `/order.html?id=` ; tout lien interne pointe vers une page existante.
- Interface : dialogues maison (`K.confirm`, `K.prompt`), jamais `alert()` ; aucun code personnel en storage ni en URL.
- Néerlandais : `caisse` n'est jamais affiché tel quel (→ `kassa` via `K.unit`).
- Chaque page charge `assets/ui.css` + `assets/ui.js` et a un meta viewport.
- Tests unitaires `test/*.test.js`.

## Règles de la maison
- Une seule feuille de style, un seul module partagé : pas de CSS ni de helpers par page.
- Tout texte visible en néerlandais ; les valeurs Airtable restent en français (`Reçue`, `caisse`) et se traduisent à l'affichage.
- Cibles tactiles ≥ 44 px. Le personnel travaille avec des gants sur une tablette.
- Une action principale par écran ; les détails à la demande (panneau latéral).
- Ne jamais modifier `api/` ou `lib/` pour un besoin d'affichage : le front s'adapte à l'API, pas l'inverse.
