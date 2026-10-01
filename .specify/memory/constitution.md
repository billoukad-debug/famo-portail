# FAMO Portail Constitution

Règles non négociables du portail B2B de FAMO Seafood (commandes, entrepôt, livraisons,
documents, facturation). Elles s'appliquent à chaque spec (`specs/NNN-*/`), à chaque plan et à
chaque pull request. Détails opérationnels : `AGENTS.md`, `CONTRIBUER.md`, `docs/SCHEMA.md`,
`docs/RUNBOOK.md`, `docs/adr/`.

## Core Principles

### I. Sans build, sans dépendance

- Pages HTML statiques (racine : client et Beheer ; `team/` : personnel ; `beheer/` : connexion Beheer),
  servies en URL propres sans `.html` (`vercel.json` `cleanUrls`), + JavaScript vanilla ; fonctions Vercel `api/*.js` en Node
  CommonJS ; code partagé serveur dans `lib/`, navigateur dans `assets/`.
- Aucun `package.json`, aucun bundler, aucune dépendance npm : Node intégré + `fetch` global.
- Une seule feuille de style (`assets/ui.css`) et un seul module partagé (`assets/ui.js`, objet
  `K`) ; le JS de page vit dans `assets/pages/` (même arborescence que les pages). Aucun style en ligne ajouté ; ceux qu'on touche
  migrent vers `ui.css`.
- Après toute modification front : `node scripts/assets-version.js` (versions `?v=`).

Raison : un seul développeur à la fois, zéro chaîne d'outils à maintenir, reprise facile
(`docs/TRANSFERT.md`).

### II. Le serveur décide (NON NÉGOCIABLE)

- Prix, TVA, stock, numéros de facture, droits et états sont calculés et vérifiés côté serveur ;
  le navigateur n'est jamais cru.
- Chaque handler POST/PATCH/DELETE commence par
  `if (require("../lib/guard").blocked(req, res)) return;` puis contrôle la session
  (`staffSession` / `adminSession` / jeton client signé).
- Fail-closed : sans secret configuré, on refuse (500/503), jamais de code de secours ni de
  retour silencieux à un autre backend.
- Aucun secret dans le code, les logs, l'URL, le storage du navigateur ou un message affiché.

### III. Les tests d'abord, en local

- Toute règle métier a un test (`test/*.test.js` sur SQLite en mémoire, ou un bloc de
  `test/workflow/`) écrit avant ou avec le code, et qui échoue sans le code.
- Portes obligatoires avant push, codes de sortie vérifiés un par un :
  `node scripts/check.js` et `npx -y eslint@9.39.5 .` ; pour toute modification d'interface,
  `node scripts/ux-audit.js` et `node scripts/kbd-audit.js` contre `node scripts/dev.js`.
- Aucune écriture (POST, PATCH, DELETE) vers la production, aucun vrai identifiant, aucune
  soumission de `/aanvraag` en production : tous les tests d'écriture se font en local.
- On ne désactive, ne saute ni ne met en quarantaine un test pour obtenir du vert.

### IV. Terrain d'abord : langue, accessibilité, gants

- Personnel et Beheer : textes visibles en néerlandais. Portail client : NL et FR (`K.t()`).
  Documents : langue du client. E-mails : néerlandais. Les valeurs de la base restent en
  français et se traduisent à l'affichage (glossaire `docs/SCHEMA.md`).
- WCAG 2.2 AA : contraste AA, navigation clavier complète, focus visible, libellés ARIA.
- Cibles tactiles ≥ 44 px ; une action principale par écran ; détails à la demande.
- Dialogues maison (`K.confirm`, `K.prompt`), jamais `alert()`.
- Hors ligne : une perte de réseau ne déconnecte pas et ne perd pas une saisie.

### V. Données et conformité

- Le schéma (`docs/SCHEMA.md`) est à jour dans le même commit que tout champ ou table ajouté,
  y compris le faux Airtable (`scripts/fake-airtable.js`).
- Une case décochée n'est pas stockée par le moteur : absent = faux (`!!fields[...]`).
- Factures conformes (numérotation continue, mentions légales, TVA par ligne, EN 16931) ;
  une facture émise n'est jamais modifiée, on corrige par note de crédit.
- RGPD : export et anonymisation couvrent toute nouvelle donnée personnelle.

## Contraintes techniques

- Production : Vercel (région fra1) + Postgres Neon (`DB_BACKEND=postgres`). Local et tests :
  SQLite (`node:sqlite`) ou faux Airtable (`node scripts/dev.js`). Code métier indépendant du
  backend via `lib/datastore.js`.
- CI : Node 22 ; Vercel : version du projet (24.x). `node:sqlite` réservé aux tests et au local.
- Tout nouveau fichier non destiné au public est exclu dans `.vercelignore`
  (dont `.specify/`, `specs/`, `scripts/`, `test/`, `docs/`).
- Préférences d'interface propres à un appareil (affichage, filtres) : `localStorage`, toujours
  dans un `try/catch`, avec un comportement correct si le storage est vide ou bloqué.

## Flux de travail

1. `/speckit-specify` → `specs/NNN-nom/spec.md` (quoi et pourquoi, sans technique).
2. `/speckit-plan` → `plan.md` avec le contrôle de conformité à cette constitution.
3. `/speckit-tasks` → `tasks.md` ; `/speckit-implement` exécute et coche les tâches.
4. Branche de travail, commits en français, pull request en brouillon ; la CI GitHub
   (« Tests et lint » + « Navigateur ») doit être verte avant fusion. Pousser sur `main` déploie
   en production.
5. Chaque état est dit honnêtement : rédigé, envoyé, confirmé ou en attente — jamais « fait »
   par déduction.

## Governance

Cette constitution prime sur les habitudes et les suggestions d'outils. Un plan qui s'en écarte
le justifie dans sa section « Complexity Tracking ». Amendement : pull request qui modifie ce
fichier, version incrémentée (MAJEUR : principe retiré ou redéfini ; MINEUR : principe ou section
ajouté ; CORRECTIF : formulation), `AGENTS.md` / `CONTRIBUER.md` alignés dans le même commit.
Chaque revue vérifie la conformité aux principes II et III en premier.

**Version**: 1.0.1 | **Ratified**: 2026-09-30 | **Last Amended**: 2026-10-01
