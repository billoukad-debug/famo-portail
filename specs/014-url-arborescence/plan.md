# Plan : URL propres et arborescence (spec 014)

## Approche
Script idempotent (déplacements `git mv`, réécriture des adresses dans le code, les tests et la doc, navigation,
redirections) appliqué une fois sur l'arbre final, après la fusion des specs 010–013 qui touchaient les mêmes
fichiers. Validé d'abord sur une copie jetable : check.js, ESLint, ux-audit, kbd-audit verts.

- `vercel.json` : `cleanUrls: true`, `trailingSlash: false`, redirections permanentes des anciennes adresses
  (`/x.html` et `/x`) ; destinations des redirections historiques mises à jour.
- Navigation (`K.shell`) : entrées `[clé de pastille, URL, libellé, icône]` ; page courante = chemin sans `.html`.
- `check.js` / `assets-version.js` : pages de `team/` et `beheer/` incluses ; contrôle des liens en URL propre.
- `dev-server.js` : redirections de `vercel.json` + cleanUrls + trailingSlash.

## Constitution Check
- I (sans build) : aucun outil ajouté ; les pages restent du HTML statique (racine + `team/` + `beheer/`,
  constitution 1.0.1 CORRECTIF de formulation).
- II (le serveur décide) : aucune règle métier touchée ; seules les URL des liens d'e-mail changent.
- III (tests d'abord, local) : garde-fou de liens dans check.js ; audits navigateur sur l'arbre déplacé ;
  vérification de la préversion en GET uniquement.
- IV (terrain) : adresses en néerlandais, comme l'interface ; pastilles conservées.
- V (données) : aucun champ ni table.

## Complexity Tracking
Aucun écart.
