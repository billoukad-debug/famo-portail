# Avant de pousser du code

```bash
node scripts/assets-version.js   # met à jour les ?v= des scripts/feuilles (cache long) après une modif front
node scripts/check.js
npx -y eslint@9.39.5 .           # version figée, la même qu'en CI
```

Changement d'interface : passer aussi `docs/CHECKLIST-UX.md` et lancer `node scripts/ux-audit.js` (portail de dev lancé dans un autre terminal par `node scripts/dev.js`). Playwright n'est pas une dépendance du dépôt : `ux-audit.js` fait `require("playwright")` puis essaie `/opt/node22/lib/node_modules/playwright`. Sur un autre poste, l'installer hors du dépôt :

```bash
mkdir -p ~/pw && cd ~/pw && npm init -y >/dev/null && npm install playwright@1.56.1
npx -y playwright@1.56.1 install chromium        # ~150 Mo, une fois
NODE_PATH=~/pw/node_modules CHROMIUM= node /chemin/du/depot/scripts/ux-audit.js
```

`CHROMIUM` vide = le chromium installé par Playwright ; sinon, chemin d'un exécutable chromium.

Vert = conforme aux contrôles. Par défaut, Vercel déploie sans attendre la CI GitHub ; pour qu'un rouge bloque la mise en production, configurer des Deployment Checks dans Vercel (réglage non vérifié sur ce projet au 27/09/2026). `check.js` refuse une version de fichier périmée (sinon un navigateur garderait l'ancien script en cache).

La CI GitHub (`.github/workflows/check.yml`, onglet Actions) tourne à chaque push sur **toute branche** et sur chaque pull request :
- job « Tests et lint » : `node scripts/check.js` puis ESLint 9.39.5 ;
- job « Navigateur » : Playwright 1.56.1, `FAMO_RESEED=1 node scripts/dev.js`, `node scripts/ux-audit.js` et, s'il existe, `node scripts/kbd-audit.js`.

## Ce qui est vérifié (`scripts/check.js`)
- Syntaxe de tout le JavaScript et des scripts inline.
- `api/` : aucun secret, aucun code de secours ; `lib/staffauth.js` reste fail-closed (contrôle textuel).
- Les e-mails lient toujours `/order.html?id=` ; tout lien interne pointe vers une page existante.
- Interface : dialogues maison (`K.confirm`, `K.prompt`), jamais `alert()` ; aucun code personnel en storage ni en URL.
- Néerlandais : `caisse` n'est jamais affiché tel quel (→ `kassa` via `K.unit`). Contrôle étroit : seulement `>caisse<` et `"caisse" +`.
- Chaque page charge `assets/ui.css` + `assets/ui.js` et a un meta viewport.
- Versions `?v=` à jour ; contrastes AA des couleurs du thème (`scripts/contrast-check.js`, ACC-05).
- Tests unitaires `test/*.test.js` (`node --test`) : moteur SQL et bascule de base, reprise 429/5xx de `lib/airtable.js`, actions Beheer et correction de stock sur SQLite, documents, e-mails, `assets/ui.js`.
- **Scénarios métier** `test/workflow/*.test.js` (36 blocs, l'essentiel des contrôles) : prix recalculés par le serveur, stock déduit une seule fois, numéros FA/CN uniques, rôles et sessions (expiration comprise), corrections, e-mails, règles de livraison, portail client, documents FR/NL. Un fichier par domaine (commandes, préparation-livraison, facturation, corrections, sessions-roles, portail-client et portail-client-wachtwoord, emails-documents, beheer, interface), aides communes dans `test/workflow/_helpers.js`. `node scripts/workflow-check.js` les lance en parallèle, un processus par fichier (obligatoire : chaque fichier remplace `fetch` et modifie `process.env`) ; `node scripts/workflow-check.js facturation` n'en lance qu'un. Un ✔ par bloc, regroupés par domaine ; tous les domaines vont au bout, les échecs sont listés à la fin. Nouveau scénario : un `test()` dans le fichier du domaine, qui commence par ses propres réponses simulées ; `test/workflow/inventaire.test.js` refuse qu'un bloc ou une assertion disparaisse sans le dire (spec 011, audit F-10).

## Règles de la maison
- Une seule feuille de style (`assets/ui.css`) et un seul module partagé (`assets/ui.js`) : pas de fichier CSS ni de helpers par page. Il reste des styles en ligne dans le JS des pages (264 `style="` au 30/09/2026, dont 84 dans `beheer.js` ; 234 migrés vers les utilitaires I-12 de `ui.css`, rendu vérifié identique au pixel sur 55 écrans) : ne pas en ajouter ; utiliser une classe de `ui.css` (utilitaires `fs-*`, `mt-*`, `stack-*`, `row-10`, `grow`…) ou en créer une.
- Personnel et Beheer : tout texte visible en néerlandais. Portail client : NL et FR (`K.t()` + `K.FR`). Documents (leveringsbon, factuur, creditnota) : langue du client (NL/FR). E-mails : néerlandais. Les valeurs de la base restent en français (`Reçue`, `caisse`) et se traduisent à l'affichage (glossaire : `docs/SCHEMA.md`).
- Cibles tactiles ≥ 44 px. Le personnel travaille avec des gants sur une tablette.
- Une action principale par écran ; les détails à la demande (panneau latéral).
- Ne jamais modifier `api/` ou `lib/` pour un besoin d'affichage : le front s'adapte à l'API, pas l'inverse.
- Ne jamais commiter `.dev-data/` (données locales réécrites par le serveur de dev) ni un secret.
