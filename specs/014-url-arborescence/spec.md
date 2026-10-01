# Feature Specification: URL propres et arborescence par portail

**Created**: 2026-10-01 · **Status**: Implemented
**Input**: « ameliore aussi les noms des liens et larboresence etc » (01/10/2026).

## Problème
Les adresses mêlaient français et néerlandais (`entrepot.html`, `stock.html`, `order.html`, `invoer.html`,
`personeel.html`), portaient l'extension `.html`, et les 19 pages vivaient toutes à la racine : rien ne disait
quelle page appartient au personnel, à Beheer ou au client.

## Requirements
- **R1 — Adresses néerlandaises, sans extension** : personnel sous `/team/` (`aanmelden`, `bestellingen`,
  `bestelling?id=…`, `magazijn`, `leveringen`, `invoeren`, `documenten`, `voorraad`, `lots`) ; Beheer `/beheer`
  et `/beheer/aanmelden` ; client `/`, `/klant`, `/aanvraag`, `/wachtwoord`, `/privacy`, `/voorwaarden` ; `/offline`.
- **R2 — Arborescence = adresses** : `team/*.html`, `beheer/aanmelden.html` ; `beheer.html` et les pages client
  restent à la racine. Une adresse se lit comme le chemin du fichier.
- **R3 — Rien ne casse** : toute ancienne adresse (`/order.html?id=…` des e-mails déjà envoyés, favoris,
  raccourcis PWA, `/bestellingen`) redirige en permanent (308) vers la nouvelle, requête et ancre conservées ;
  `x.html` → `x` pour toutes les pages (cleanUrls).
- **R4 — Pastilles inchangées** : la mémoire « vu » des pastilles (clés `bestellingen.html`…) reste valable.
- **R5 — Garde-fou** : `check.js` refuse tout lien interne en `.html` et tout lien vers une page absente ;
  les e-mails lient `/team/bestelling?id=`.
- **R6 — Local = production** : `scripts/dev-server.js` applique les redirections de `vercel.json`, cleanUrls
  et trailingSlash comme Vercel.

## Success Criteria
- check.js, ESLint, ux-audit puis kbd-audit (données neuves) : 0 écart.
- Préversion Vercel (GET seulement) : nouvelles adresses 200, anciennes 308 vers la nouvelle avec la requête.
