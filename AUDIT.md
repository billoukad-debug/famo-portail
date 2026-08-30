# FAMO — AUDIT TECHNIQUE ET FONCTIONNEL

Date de l'audit : 30 août 2026  
Dépôt audité : `https://github.com/billoukad-debug/famo-portail`  
Révision auditée : `ca642d5` (`main`, identique à `origin/main`)  
Production contrôlée : `https://famo-portail.vercel.app`  

## Statut et périmètre

Cet audit comporte :

- une lecture statique complète du dépôt (12 pages HTML, 13 fonctions API, scripts partagés, sécurité, données, responsive et tests) ;
- l'exécution de `node scripts/check.js`, incluant les tests métier simulés : tous passent ;
- une traversée de toutes les routes de production en desktop et mobile (390 × 844), sans débordement horizontal constaté sur les écrans d'authentification ;
- le contrôle en production des contrats API accessibles sans identifiants ;
- un test d'échec de connexion client et personnel, avec messages corrects et sans erreur console ;
- une comparaison du script d'authentification déployé avec le dépôt.

Limite importante : aucun identifiant CLIENT, PERSONNEL ou ADMIN de test n'a été fourni. Les parcours authentifiés et les actions qui écrivent dans Airtable (commande, préparation, livraison, stock, onboarding) n'ont donc pas été exécutés en production. Ils sont marqués `⏸` et non présentés comme validés. Une validation V1 complète exige trois comptes de test et des commandes/produits de test dédiés.

Au début de l'audit, le worktree contenait une modification locale non commitée de `staff-session.js`. Elle corrige le flash de connexion, mais n'est pas en production : le fichier servi en production est identique à `HEAD` (SHA-1 `2826844…`) et diffère du fichier local modifié (`c949121…`). Pendant l'audit, d'autres modifications applicatives sont apparues dans le worktree (`aan-de-slag.html`, `bestellingen.html`, `documenten.html`, `entrepot.html`, `index.html`, `invoer.html`, `leveringen.html`, `order.html`, `stock.html`). Elles ne proviennent pas de cet audit, ne sont pas déployées et ne sont pas incluses dans le verdict sur la révision `ca642d5`. L'audit n'a modifié aucun fichier applicatif.

## Verdict exécutif

La base fonctionnelle est cohérente et les garde-fous métier les plus critiques (prix recalculé au serveur, transitions de commande, séparation STAFF/ADMIN, cookie staff HttpOnly, contrôle des quantités et déduction unique du stock) sont couverts par des tests simulés. En revanche, la V1 ne doit pas être considérée prête pour une exploitation complète tant que les deux P0 ci-dessous ne sont pas traités : authentification client non conforme et politique stock contradictoire.

Décision recommandée pour la V1 :

1. remplacer l'authentification client par une session serveur et des mots de passe hachés ;
2. désactiver l'interface stock, la déduction automatique et tout bouton `skipStock` tant qu'un inventaire réel n'est pas certifié ;
3. conserver commandes, préparation et livraison, mais présenter les documents comme internes et désactiver facture/creditnota comme documents comptables officiels jusqu'au raccord Peppol/comptable ;
4. terminer une recette authentifiée avec trois comptes de test avant le go-live.

## Architecture et routes

| Couche | Contenu | Source de données |
|---|---|---|
| Portail client | `/` : login, catalogue, favoris, panier, confirmation, historique, aide | Airtable via `/api/catalogue`, `/api/order`, `/api/orders`, `/api/config?public=1` |
| Demande publique | `/aanvraag.html` | Écriture Airtable `Aanvragen` via `/api/signup` |
| Personnel | `/bestellingen.html`, `/entrepot.html`, `/leveringen.html`, `/order.html` | Cookie signé + Airtable via `/api/session`, `/api/allorders`, `/api/updateorder` |
| Admin | `/invoer.html`, `/stock.html`, `/documenten.html`, `/aan-de-slag.html` | Cookie admin + Airtable via `/api/staff`, `/api/stock`, `/api/config`, `/api/onboarding` |
| Compatibilité | `/overzicht.html` → `/bestellingen.html`; `/dagprep.html` → `/entrepot.html?view=dag` | Redirections validées en production |
| Fermé | `/api/cadrage` | Répond volontairement `410` |

Il n'existe pas de dashboard admin, ni de pages distinctes « clients », « produits », « personnel » ou « paramètres ». L'administration des clients, produits, tarifs, mots de passe et identité société est concentrée dans l'assistant `/aan-de-slag.html`. La gestion de comptes personnel/admin n'existe pas dans l'interface : deux secrets globaux d'environnement (`STAFF_CODE`, `ADMIN_CODE`) représentent les deux rôles.

## Authentification et permissions

| Capacité | CLIENT | PERSONNEL | ADMIN |
|---|---:|---:|---:|
| Catalogue et commandes propres | Oui | Non | Non |
| Liste globale des commandes | Non | Oui | Oui |
| Préparation et livraison | Non | Oui | Oui |
| Saisie manuelle de commande | Non | Refusée | Oui |
| Stock | Non | Refusé | Oui |
| Documents | Non | Refusés | Oui |
| Produits, clients, tarifs, mots de passe | Non | Refusés | Oui |

La séparation des API staff/admin est globalement correcte et fail-closed. Les contrôles production sans cookie répondent comme attendu : `/api/session` 401, `/api/allorders` 401, `/api/stock` 401, `/api/onboarding` 401, `/api/catalogue` en GET 405 et `/api/cadrage` 410.

## Données réelles, exemples et fonctions à désactiver en V1

Les tables `Clients`, `Catalogue`, `Prix négociés`, `Commandes`, `Stock`, `Mouvements de stock`, `Configuratie` et `Aanvragen` sont des données Airtable réelles. Il n'y a pas de jeu de données mocké dans le runtime principal.

Éléments qui ne sont pas pleinement réels ou finalisés :

- la photo locale de preuve de livraison est seulement prévisualisée ; seule une URL HTTPS est stockée ;
- la creditnota est explicitement un exemple et n'est pas comptabilisée dans Airtable ;
- l'IBAN/BIC de remplacement peut être un exemple si la configuration manque ;
- les factures sont des documents internes, sans émission Peppol ;
- `skipStock` permet un départ en livraison sans mouvement de stock ;
- `PURGE_GO_LIVE.md` indique que des quantités de stock fictives peuvent encore devoir être remplacées.

À désactiver pour la V1 tant que les prérequis ne sont pas validés :

- `/stock.html`, les actions manuelles de stock et la déduction automatique ;
- le bouton de départ utilisant `skipStock` dans `/order.html` ;
- « Facture » comme document légal et « Creditnota » comme document réel ;
- la sélection de fichier local de preuve tant qu'aucun stockage n'est raccordé (elle donne l'impression d'un upload alors qu'aucun fichier n'est conservé).

## P0 — BLOQUANT

### P0-01 — Mots de passe clients en clair et persistés dans le navigateur

- Rôle concerné : CLIENT, ADMIN.
- Page : `/`, `/aan-de-slag.html`.
- Action effectuée : revue du login, de la restauration de session et de la création/réinitialisation client.
- Résultat actuel : le mot de passe est comparé directement au champ Airtable `Wachtwoord`; le portail stocke `{user, pw}` en clair dans `sessionStorage` puis renvoie ces identifiants à chaque appel catalogue, commande et historique. L'admin peut générer/réinitialiser un mot de passe en clair.
- Résultat attendu : mot de passe haché avec un algorithme adapté (Argon2id/bcrypt/scrypt), session opaque côté serveur dans un cookie `HttpOnly`, rotation et révocation possibles, aucun mot de passe dans le stockage JavaScript.
- Cause probable : authentification client conçue comme un accès direct Airtable sans couche d'identité/session.
- Fichiers concernés : `index.html`, `api/catalogue.js`, `api/order.js`, `api/orders.js`, `api/onboarding.js`.
- Correction proposée : ajouter une vraie session client distincte, migrer les mots de passe existants vers des hashes, supprimer `USER/PW` et `famo_client_sess`, authentifier les API par cookie, invalider les anciens mots de passe et documenter la rotation.
- Test de validation : vérifier qu'aucun secret n'apparaît dans `sessionStorage`, que la base ne contient que des hashes, que les API refusent les identifiants dans le corps après migration, et qu'une session peut être révoquée.

### P0-02 — Deux vérités incompatibles pour le stock

- Rôle concerné : PERSONNEL, ADMIN.
- Pages : `/order.html`, `/entrepot.html`, `/stock.html`, `/aan-de-slag.html`.
- Action effectuée : traçage du départ en livraison, de la déduction et de la documentation de go-live.
- Résultat actuel : certaines transitions déduisent et journalisent le stock, mais `/order.html` envoie explicitement `skipStock:true`; le backend précise que le stock Airtable « n'est pas encore fiable »; le document de purge parle encore de quantités fictives.
- Résultat attendu : une seule politique opérationnelle explicite. Soit le stock est certifié et chaque départ le déduit atomiquement, soit toute fonctionnalité stock est désactivée en V1.
- Cause probable : migration progressive entre gestion manuelle et stock intégré.
- Fichiers concernés : `order.html`, `entrepot.html`, `api/updateorder.js`, `api/stock.js`, `stock.html`, `PURGE_GO_LIVE.md`.
- Correction proposée : pour la V1, masquer `/stock.html`, retirer la navigation et supprimer/neutraliser `skipStock`; ne réactiver qu'après inventaire réel, procédure de reprise et recette de concurrence. Si le stock doit rester manuel, ne jamais afficher un stock calculé comme fiable.
- Test de validation : une commande préparée puis expédiée produit exactement un mouvement par ligne, aucune route ne peut expédier sans politique explicite, et deux expéditions concurrentes ne rendent jamais le stock négatif.

## P1 — IMPORTANT

### P1-01 — Parcours authentifiés non recettables sans comptes de test

- Rôles concernés : CLIENT, PERSONNEL, ADMIN.
- Pages : toutes les pages authentifiées.
- Action effectuée : parcours production jusqu'aux formulaires de connexion; essais d'identifiants volontairement invalides.
- Résultat actuel : les erreurs d'authentification sont correctes, mais aucune action métier réelle ne peut être certifiée sans identifiants et données de test.
- Résultat attendu : trois comptes dédiés, un catalogue et au moins deux commandes de test réinitialisables.
- Cause probable : absence de stratégie de recette/staging documentée.
- Fichiers concernés : configuration Vercel/Airtable, documentation projet.
- Correction proposée : créer un environnement Preview relié à une base Airtable de test et fournir un jeu de fixtures non personnelles.
- Test de validation : exécuter la matrice complète ci-dessous avec captures des requêtes/réponses et état Airtable avant/après.

### P1-02 — Le correctif anti-flash n'est pas déployé

- Rôles concernés : PERSONNEL, ADMIN.
- Pages : navigation entre toutes les pages staff/admin.
- Action effectuée : comparaison SHA du `staff-session.js` local, de `HEAD` et de la production.
- Résultat actuel : la production sert le fichier de `HEAD`; le correctif qui masque immédiatement le login existe uniquement comme modification locale non commitée.
- Résultat attendu : aucun formulaire de login visible pendant la vérification asynchrone de session.
- Cause probable : correctif local non commit/push/deploy.
- Fichiers concernés : `staff-session.js` et pages qui utilisent `bindLogin`.
- Correction proposée : revoir puis intégrer la modification locale, ajouter un état de chargement neutre dans le HTML/CSS afin d'éviter aussi le flash avant téléchargement du JavaScript.
- Test de validation : navigation répétée, connexion simulée lente (throttling), vidéo ou test visuel confirmant zéro frame de login.

### P1-03 — Secrets globaux partagés pour PERSONNEL et ADMIN

- Rôles concernés : PERSONNEL, ADMIN.
- Page : tous les écrans staff.
- Action effectuée : revue de `lib/staffauth.js` et `/api/session`.
- Résultat actuel : un code global représente tout le personnel et un autre tous les admins; aucune identité individuelle, révocation ciblée, piste d'audit utilisateur ou MFA.
- Résultat attendu : comptes nominatifs, rôles explicites, révocation individuelle et journal d'auteur pour les changements sensibles.
- Cause probable : modèle d'accès minimal à deux variables d'environnement.
- Fichiers concernés : `lib/staffauth.js`, `api/session.js`, toutes les mutations Airtable.
- Correction proposée : authentification nominative (fournisseur d'identité ou table utilisateurs sécurisée), identifiant utilisateur dans chaque mouvement/transition.
- Test de validation : révoquer un utilisateur sans interrompre les autres et retrouver l'auteur de chaque préparation, livraison et correction de stock.

### P1-04 — Opérations stock et numérotation non atomiques

- Rôle concerné : ADMIN.
- Pages : stock, livraison, documents.
- Action effectuée : revue des séquences lecture → calcul → PATCH/POST.
- Résultat actuel : plusieurs appels Airtable indépendants effectuent contrôle, mouvement, déduction et mise à jour de commande. Une panne ou concurrence peut produire un état partiel. Le README reconnaît que la numérotation n'est pas garantie atomique.
- Résultat attendu : transaction/idempotency key ou délégation au système comptable/stock de référence.
- Cause probable : limites transactionnelles d'Airtable et orchestration directement dans une fonction serverless.
- Fichiers concernés : `api/updateorder.js`, `api/stock.js`.
- Correction proposée : verrou/idempotency key par commande, statut de workflow, reprise compensatoire; déléguer les numéros légaux au système comptable.
- Test de validation : doubles clics, retry réseau et deux requêtes concurrentes donnent un seul mouvement, un seul numéro et un état final cohérent.

### P1-05 — Protection anti-abus non distribuée

- Rôles concernés : CLIENT, PERSONNEL, public.
- Pages/API : login client, login staff, demande d'accès, création de commande.
- Action effectuée : revue des maps mémoire `_rl`.
- Résultat actuel : les limites vivent seulement dans la mémoire d'une instance serverless et peuvent être contournées entre instances ou après redémarrage.
- Résultat attendu : limitation partagée par IP/compte, temporisation progressive, observabilité et alertes.
- Cause probable : rate limiter best-effort local.
- Fichiers concernés : `api/catalogue.js`, `api/order.js`, `api/signup.js`, `api/session.js`.
- Correction proposée : utiliser un store distribué ou le WAF/rate limiting de la plateforme et ne pas distinguer excessivement les erreurs.
- Test de validation : tentatives réparties sur plusieurs instances restent bloquées selon la politique définie.

### P1-06 — Documents non prêts pour un usage comptable légal

- Rôle concerné : ADMIN, CLIENT destinataire.
- Page : `/documenten.html`.
- Action effectuée : revue génération facture, creditnota, identité bancaire et README.
- Résultat actuel : facture interne, creditnota d'exemple, IBAN/BIC potentiellement d'exemple et aucun Peppol.
- Résultat attendu : documents légaux émis et numérotés par le système comptable, sans données bancaires fictives.
- Cause probable : module de prévisualisation livré avant raccord comptable.
- Fichiers concernés : `documenten.html`, `documents.js`, `staff-doc-preview.js`, `api/updateorder.js`.
- Correction proposée : renommer clairement « document interne » et désactiver l'émission officielle en V1; connecter ensuite Peppol/comptabilité.
- Test de validation : contrôle comptable, numérotation atomique, émission/réception Peppol et aucune valeur d'exemple dans un PDF final.

### P1-07 — Absence d'en-têtes de sécurité et de politique CSP dans le dépôt

- Rôles concernés : tous.
- Pages : toutes.
- Action effectuée : inspection du dépôt et de la structure HTML riche en scripts inline/handlers inline.
- Résultat actuel : aucun `vercel.json` ni configuration visible pour CSP, HSTS, `frame-ancestors`, `nosniff` ou politique de permissions. Les nombreux scripts et `onclick` inline rendent une CSP stricte difficile.
- Résultat attendu : en-têtes de sécurité vérifiés en production, CSP sans `unsafe-inline` à terme.
- Cause probable : application statique historique sans pipeline de headers.
- Fichiers concernés : toutes les pages HTML, configuration Vercel à créer.
- Correction proposée : externaliser les scripts/handlers, définir CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` et protection contre l'encadrement.
- Test de validation : scan des headers et exécution fonctionnelle sous CSP en mode report-only puis enforced.

## P2 — UX / FLUIDITÉ

### P2-01 — Ajout au panier implicite et peu découvrable

- Rôle concerné : CLIENT.
- Page : catalogue `/`.
- Action effectuée : revue de l'interaction produit/quantité.
- Résultat actuel : augmenter ou saisir une quantité ajoute implicitement au panier; aucun bouton « Toevoegen aan bestelling / Ajouter au panier » ne confirme l'action.
- Résultat attendu : action explicite ou, au minimum, retour visuel/annonce accessible immédiat après changement de quantité.
- Cause probable : modèle de panier synchronisé directement sur le champ quantité.
- Fichiers concernés : `index.html` (`renderCatalogue`, `setQ`).
- Correction proposée : ajouter un bouton explicite par produit, conserver `+/-` comme raccourci et annoncer l'ajout via `aria-live`.
- Test de validation : souris, tactile et clavier permettent tous d'ajouter un article sans ambiguïté; l'état du panier est annoncé.

### P2-02 — Le portail admin n'a pas la structure annoncée

- Rôle concerné : ADMIN.
- Pages : `/aan-de-slag.html`, `/invoer.html`, `/stock.html`, `/documenten.html`.
- Action effectuée : inventaire des routes.
- Résultat actuel : pas de dashboard admin ni de pages dédiées clients/produits/personnel/paramètres; l'onboarding sert de back-office permanent et s'adresse personnellement à « Mohsen ».
- Résultat attendu : navigation admin stable, neutre et adaptée à l'exploitation après onboarding.
- Cause probable : assistant de mise en service réutilisé comme administration.
- Fichiers concernés : `aan-de-slag.html`, `staff-nav.js`.
- Correction proposée : séparer « Configuration initiale » d'un back-office admin; remplacer le prénom en dur par un libellé neutre ou le profil connecté.
- Test de validation : chaque capacité admin est trouvable en deux actions maximum et aucun texte personnalisé en dur n'apparaît pour un autre admin.

### P2-03 — Preuve de livraison locale trompeuse

- Rôle concerné : PERSONNEL.
- Pages : livraison et confirmation.
- Action effectuée : revue du champ fichier et de son traitement.
- Résultat actuel : le fichier peut être choisi et prévisualisé, mais n'est jamais envoyé ni sauvegardé; seule une URL HTTPS est persistée.
- Résultat attendu : soit un véritable upload, soit aucun champ fichier.
- Cause probable : stockage externe non choisi.
- Fichiers concernés : `staff-session.js`, `staff-delivery.js`.
- Correction proposée : retirer le fichier en V1 et demander uniquement une URL, ou raccorder Blob/Drive avec contrôle de type, taille, accès et rétention.
- Test de validation : après rechargement et sur un autre appareil, la preuve attendue reste accessible selon la politique autorisée.

### P2-04 — Responsive validé seulement avant authentification

- Rôles concernés : tous.
- Pages : toutes.
- Action effectuée : traversée à 390 × 844; aucun débordement horizontal sur les écrans accessibles.
- Résultat actuel : les logins et la demande publique sont adaptés au mobile; les tables/cartes authentifiées n'ont pas pu être éprouvées avec données réelles.
- Résultat attendu : recette mobile des listes longues, modales, clavier virtuel, panier, kanban, documents et stock.
- Cause probable : absence de fixtures/comptes de recette.
- Fichiers concernés : pages HTML et `staff.css`.
- Correction proposée : tests visuels à 390, 768, 1280 et 1440 px avec jeux de données courts et longs.
- Test de validation : aucun contrôle masqué, aucun scroll horizontal involontaire, zones tactiles ≥ 44 px et modales utilisables avec clavier ouvert.

## P3 — AMÉLIORATION

### P3-01 — Code monolithique et duplication

- Résultat actuel : pages HTML avec CSS et JavaScript inline, nombreux handlers `onclick`, duplication de clients Airtable, auth client et logique commande entre API.
- Risque : corrections divergentes, tests unitaires difficiles, CSP difficile.
- Fichiers concernés : principalement `index.html`, `entrepot.html`, `aan-de-slag.html`, `api/catalogue.js`, `api/order.js`, `api/orders.js`, `api/staff.js`.
- Correction proposée : extraire services Airtable/auth/validation, modules UI et schémas de données partagés; ajouter formatage/lint automatisé.
- Test de validation : couverture unitaire des modules extraits et absence de duplication des fonctions d'authentification/calcul.

### P3-02 — Comptages de statut limités à 100 enregistrements

- Résultat actuel : `api/config.js` utilise `pageSize=100` sans pagination pour compter les tables.
- Risque : dashboard/onboarding indique des volumes faux au-delà de 100.
- Fichier concerné : `api/config.js`.
- Correction proposée : paginer ou utiliser une source de métrique dédiée.
- Test de validation : table de 101+ enregistrements retourne le total exact.

### P3-03 — Observabilité minimale

- Résultat actuel : erreurs renvoyées au client via `String(e)`, pas de corrélation, métriques, traces ou journal applicatif structuré visibles dans le dépôt.
- Risque : diagnostic difficile des échecs Airtable partiels et des doubles actions.
- Correction proposée : identifiant de requête, logs structurés sans secrets, événements métier et alertes sur 5xx/409/stock.
- Test de validation : une commande de test est traçable de l'UI à Airtable sans exposer mot de passe, token ou données inutiles.

## Matrice fonctionnelle — source de vérité

Légende : `✅` validé en production sans écriture; `🧪` couvert seulement par test simulé/revue; `⚠️` anomalie connue; `⏸` non testé faute de compte/données de test; `🚫` à désactiver en V1.

### CLIENT

| Parcours | Statut | Preuve / remarque |
|---|---:|---|
| Page login desktop/mobile | ✅ | Production, sans erreur console, 390 px sans débordement |
| Mauvais identifiants | ✅ | Message « Ongeldige gebruikersnaam of wachtwoord » |
| Session persistante | ⚠️ | Fonctionne par mot de passe en clair dans `sessionStorage` |
| Catalogue réel + prix négociés | ⏸ | API/code revus; compte requis |
| Recherche/favoris | ⏸ | Code présent; compte requis |
| Sélection produit | ⚠️ | Quantité = ajout implicite, pas de bouton explicite |
| Quantités kg/entières | 🧪 | Contrôles serveur testés |
| Panier desktop/mobile | ⏸ | Compte requis |
| Date de livraison | 🧪 | Validation UI présente; pas de soumission réelle |
| Création commande | 🧪 | Prix/total serveur testés; aucune écriture production |
| Confirmation | ⏸ | Dépend d'une commande réelle |
| Historique | ⏸ | Compte requis |
| Recommander | ⏸ | Parsing fragile par nom; compte requis |
| Demande d'accès | ✅/⏸ | Formulaire responsive; soumission non exécutée pour éviter une écriture réelle |

### PERSONNEL

| Parcours | Statut | Preuve / remarque |
|---|---:|---|
| Page login desktop/mobile | ✅ | Production, message d'erreur correct |
| Session cookie | 🧪 | HttpOnly/Secure/SameSite et expiration testés localement |
| Bestellingen | ⏸ | Compte requis |
| Filtres/recherche | ⏸ | Compte requis |
| Order deep-link | ⏸ | Route accessible; données requises |
| Magazijn board/jour | ⏸ | Compte et commandes requis |
| Modifier lignes préparées | 🧪 | Gardes métier simulées |
| Valider préparation | 🧪 | Double validation et transition couvertes |
| Leveringen | ⏸ | Compte et commande prête requis |
| Confirmer réception | 🧪 | Réceptionnaire obligatoire couvert |
| Preuve de livraison | ⚠️ | URL stockée; fichier local non sauvegardé |
| Accès admin interdit | 🧪 | API et garde UI revues; test réel avec compte requis |
| Flash login entre pages | ⚠️ | Correctif local non déployé |

### ADMIN

| Parcours | Statut | Preuve / remarque |
|---|---:|---|
| Login admin | ⏸ | Page contrôlée; vrai code requis |
| Dashboard admin | ⚠️ | N'existe pas |
| Clients | ⏸ | Dans onboarding, compte requis |
| Produits | ⏸ | Dans onboarding, compte requis |
| Prix négociés | ⏸ | Dans onboarding, compte requis |
| Mots de passe clients | ⚠️ | Gestion en clair, P0-01 |
| Personnel/comptes | ⚠️ | Aucun compte nominatif, seulement deux codes globaux |
| Saisie manuelle | ⏸ | Compte et données requis |
| Commandes | ⏸ | Compte requis |
| Stock | 🚫 | Politique contradictoire, P0-02 |
| Documents internes | ⏸ | Compte et commandes requis |
| Facture légale | 🚫 | Pas Peppol, numérotation non atomique |
| Creditnota réelle | 🚫 | Exemple uniquement |
| Paramètres société | ⏸ | Dans onboarding, compte requis |
| Demandes d'accès | ⏸ | Dans onboarding, compte requis |

## Tests existants et manquants

Tests existants :

- syntaxe des fonctions API et scripts inline ;
- présence des pages, liens et navigation staff ;
- interdiction de secrets staff dans URL/storage ;
- échappement XSS attendu sur les pages ;
- session staff, rôles, expiration et logout ;
- règles de préparation/livraison ;
- recalcul serveur des prix/totaux ;
- quantités décimales réservées au kg ;
- déduction unique/verrou stock et scénario `skipStock` ;
- numéro de facture non réalloué ;
- contrôles onboarding et documents.

Tests manquants :

- aucun framework E2E navigateur (Playwright/Cypress) ;
- aucun test contre une base Airtable de staging ;
- aucune recette authentifiée automatisée par rôle ;
- aucun test visuel/régression responsive ;
- aucun test d'accessibilité automatisé et manuel complet ;
- aucun test de concurrence/idempotence réel ;
- aucun test de panne partielle Airtable ;
- aucun scan de dépendances/headers/CSP/secrets ;
- aucune couverture chiffrée ;
- aucune vérification Peppol/comptable.

## Plan de recette authentifiée restant

Préconditions : base Airtable de test ou enregistrements clairement préfixés `AUDIT-`, comptes CLIENT/PERSONNEL/ADMIN dédiés, autorisation explicite d'écriture et procédure de nettoyage.

1. CLIENT : login → catalogue → produit → bouton/quantité → panier → date → commande → confirmation → historique → recommander → logout/refresh.
2. PERSONNEL : login → liste → détail → modification quantités → validation préparation → file livraison → confirmation réception → preuve → retour liste → accès admin refusé.
3. ADMIN : login → clients → produits → prix → commande manuelle → stock (si réactivé) → documents → paramètres → demandes d'accès → logout.
4. Rejouer chaque parcours à 390, 768, 1280 et 1440 px avec console, requêtes réseau et état Airtable avant/après.
5. Tester doubles clics, rafraîchissement pendant mutation, perte réseau, session expirée, données longues, catalogue vide et volumes > 100.

## Recommandation `AGENTS.md`

Créer un `AGENTS.md` séparé après validation métier, contenant au minimum : rôles et pages autorisées, vocabulaire néerlandais (`caisse` → `kassa`), règles kg/quantités entières, transitions de statut, politique stock V1, recalcul serveur obligatoire, interdiction des secrets en URL/storage, nature interne des documents et commande de test obligatoire avant déploiement. Ne pas y inscrire de codes, tokens, identifiants clients ou données personnelles.
