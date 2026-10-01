# Feature Specification: Session client par cookie HttpOnly

**Feature Branch**: `worktree-agent-a830d896f5c8da4f0`
**Created**: 2026-10-01
**Status**: Ready
**Input**: `IDEAS.md` B3, reste à faire : « cookie HttpOnly au lieu du jeton en `sessionStorage` ».
Aujourd'hui le jeton de session du client (`k.id.exp.fp.iat.gen.sig`) est gardé par le
navigateur (`sessionStorage`) et renvoyé dans le corps de chaque requête : un script injecté
(XSS) pourrait le lire et l'envoyer ailleurs. Le jeton doit vivre dans un cookie HttpOnly +
Secure + SameSite posé par le serveur à la connexion, à l'activation et au changement de mot
de passe, effacé à la déconnexion. Les API client lisent le cookie ; le jeton dans le corps reste
accepté pendant une période de transition (date de fin écrite et testée) pour ne pas déconnecter
les clients déjà connectés. Le navigateur ne garde que des données d'affichage non secrètes.
CSRF : garde Origin + JSON existante (`lib/guard.js`), à vérifier et tester. Le hors ligne et le
service worker continuent de fonctionner.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connexion : la session n'est plus lisible par une page (Priority: P1)

Le chef d'un restaurant se connecte avec son identifiant et son mot de passe. Il commande,
consulte ses factures, change ses favoris comme avant. Rien ne change pour lui. Mais le jeton
de session n'apparaît plus nulle part dans la page : ni dans le stockage de l'onglet, ni dans
une réponse du serveur. Un script malveillant injecté dans la page ne peut pas l'emporter.

**Why this priority**: c'est le constat B3 ; tant que le jeton est lisible par JavaScript, une
faille XSS donne une session de 12 h (jusqu'à 7 jours avec les renouvellements) utilisable
depuis n'importe où.

**Independent Test**: portail de dev, connexion `aloha` / `welkom123` : outils du navigateur →
stockage de session : seulement l'identifiant et le nom / la langue de la zaak ; cookies :
`famo_klant` marqué HttpOnly, Secure, SameSite=Strict, chemin `/api` ; le catalogue, la
commande, les documents et le compte fonctionnent.

**Acceptance Scenarios**:

1. **Given** un client avec un mot de passe valable, **When** il se connecte, **Then** le
   serveur pose un cookie de session HttpOnly, Secure, SameSite=Strict, limité aux API, qui
   expire avec le jeton ; la réponse ne contient pas le jeton.
2. **Given** un client connecté, **When** il ouvre le catalogue, ses commandes, un document,
   commande, annule, change ses favoris ou son profil, **Then** chaque appel est authentifié
   par le cookie seul, sans jeton ni mot de passe dans le corps.
3. **Given** un client connecté, **When** il rouvre le catalogue, **Then** le cookie est
   renouvelé (12 h), sans dépasser 7 jours après la connexion par mot de passe (règle
   existante).
4. **Given** le stockage de l'onglet, **Then** il ne contient que l'identifiant de connexion et
   le nom et la langue de la zaak (affichage), jamais un jeton ni un mot de passe.

---

### User Story 2 - Déconnexion et révocation (Priority: P1)

Le client clique sur « Uitloggen ». Sa session tombe sur tous ses appareils (règle existante)
et le cookie est effacé de cet appareil. Un mot de passe changé (lui-même, via le lien reçu ou
par Beheer) ferme aussi toutes ses sessions.

**Why this priority**: un cookie qui survit à la déconnexion sur une tablette partagée serait
pire que l'existant.

**Independent Test**: se connecter, se déconnecter : le cookie n'existe plus ; un cookie copié
avant la déconnexion est refusé (401) par toutes les API client.

**Acceptance Scenarios**:

1. **Given** un client connecté, **When** il se déconnecte, **Then** la génération de session
   du compte augmente (tous ses appareils tombent) et la réponse efface le cookie.
2. **Given** une déconnexion sans session valable (cookie absent ou déjà révoqué), **Then** la
   réponse reste neutre (succès) et efface quand même le cookie.
3. **Given** un cookie émis avant un changement de mot de passe ou une déconnexion ailleurs,
   **When** il est présenté, **Then** refus (401, « Sessie verlopen »).
4. **Given** un changement de mot de passe réussi (Account ou lien e-mail), **Then** le serveur
   pose un nouveau cookie (le client reste connecté) et l'ancien est refusé.

---

### User Story 3 - Transition sans déconnexion forcée (Priority: P1)

Le jour du déploiement, des clients ont un onglet ouvert avec l'ancien jeton dans le stockage.
Au rechargement, la nouvelle page envoie une dernière fois ce jeton dans le corps : le serveur
l'accepte, pose le cookie, et la page oublie le jeton. Le client ne remarque rien.

**Why this priority**: déconnecter tous les clients en pleine prise de commande du soir serait
un incident.

**Independent Test**: avec un jeton valable dans le corps et sans cookie, l'API répond 200 et
pose le cookie ; après la date de fin, le même appel est refusé alors que le cookie fonctionne.

**Acceptance Scenarios**:

1. **Given** la période de transition (jusqu'au **31/10/2026 inclus**, heure de Bruxelles),
   **When** une API client reçoit un jeton valable dans le corps sans cookie, **Then** elle
   l'accepte et pose le cookie.
2. **Given** la date de fin passée (à partir du 01/11/2026 00:00 à Bruxelles), **When** une API
   client reçoit un jeton dans le corps, **Then** il est ignoré : seul le cookie authentifie.
3. **Given** un cookie et un jeton de corps tous deux présents, **Then** le cookie prime ; le
   jeton de corps n'est essayé que si le cookie manque ou ne vaut plus rien.

---

### User Story 4 - Deux onglets, deux comptes (Priority: P2)

Un employé ouvre le portail avec le compte « Resto A » dans un onglet, puis se connecte avec
« Resto B » dans un autre. Le cookie étant partagé par le navigateur, le premier onglet ne
doit jamais commander au nom de B en affichant A.

**Why this priority**: risque de commande attribuée au mauvais client, rare mais grave.

**Independent Test**: cookie de B, requête qui annonce l'identifiant A → 401 ; l'onglet A
retourne à l'écran de connexion avec « Sessie verlopen ».

**Acceptance Scenarios**:

1. **Given** un cookie de session du compte B, **When** une requête annonce l'identifiant
   affiché A, **Then** refus (401) sans aucune lecture ni écriture au nom de B.

---

### User Story 5 - CSRF et hors ligne (Priority: P1)

Une page d'un autre site ne peut pas faire commander le client à son insu, même si son
navigateur envoie le cookie. Une perte de réseau ne déconnecte pas.

**Independent Test**: requête POST avec le cookie mais une origine étrangère → 403 ; corps
`text/plain` → 415 ; GET → 405. Réseau coupé : message « Geen verbinding », pas de retour à la
connexion.

**Acceptance Scenarios**:

1. **Given** un cookie valable, **When** une requête POST arrive d'une autre origine (ou
   d'origine `null`), **Then** 403 avant toute authentification, sur toutes les API client.
2. **Given** un cookie valable, **When** le corps n'est pas du JSON, **Then** 415.
3. **Given** le service worker, **Then** les appels `/api/*` ne passent jamais par son cache
   (inchangé) et le cookie est envoyé par le navigateur.
4. **Given** une erreur réseau, **Then** le client n'est pas déconnecté (seul un 401 l'est).

### Edge Cases

- Navigateur qui refuse les cookies : la connexion réussit mais l'appel suivant répond 401 →
  retour à l'écran de connexion avec « Sessie verlopen ». Accepté (cookie strictement
  nécessaire, mentionné dans la page Privacy).
- Nouvel onglet : il n'a pas les données d'affichage, il montre l'écran de connexion (comme
  aujourd'hui). Se reconnecter pose un nouveau cookie.
- Test sur une IP du réseau local en http (`FAMO_DEV_HTTP=1`, jamais sur Vercel) : l'attribut
  Secure est retiré, comme pour le cookie du personnel.
- Cookie falsifié, illisible ou d'un autre format (`r.` lien de mot de passe) : refusé sans
  lecture de la base.
- Base injoignable pendant la vérification du cookie : 503 « Even geen verbinding », pas de
  déconnexion (règle D-06 existante).
- Onglet resté ouvert avec l'ancien script pendant le déploiement : le cookie, posé à la
  connexion suivante, suffit ; sa déconnexion n'efface que l'affichage tant qu'il n'est pas
  rechargé (fenêtre de quelques heures au plus).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Le serveur pose le cookie de session client à la connexion par mot de passe, au
  choix du mot de passe par lien (activation / reset), au changement de mot de passe et à chaque
  renouvellement (ouverture du catalogue).
- **FR-002**: Cookie : HttpOnly, Secure (sauf test http local explicite), SameSite=Strict,
  chemin `/api`, durée égale à celle du jeton (≤ 12 h).
- **FR-003**: Aucune réponse ne contient plus le jeton de session client.
- **FR-004**: Toutes les API client (catalogue, commandes, commande, actions compte, documents,
  mot de passe) acceptent le cookie ; le jeton du corps n'est accepté que jusqu'au 31/10/2026
  inclus (Bruxelles), puis ignoré ; un jeton de corps accepté est converti en cookie.
- **FR-005**: La déconnexion révoque toutes les sessions du compte (génération +1) et efface le
  cookie, dans tous les cas.
- **FR-006**: Une requête qui annonce un identifiant différent de celui de la session du cookie
  est refusée (401).
- **FR-007**: Les règles existantes restent vraies : 12 h, 7 jours max, révocation par mot de
  passe et génération, verrou anti-force brute, 503 en cas de panne.
- **FR-008**: Toute requête POST client passe la garde d'origine et de JSON avant
  l'authentification.
- **FR-009**: Le navigateur ne garde que l'identifiant, le nom et la langue de la zaak ; un jeton
  ou mot de passe trouvé dans le stockage (ancienne version) est effacé après le premier appel
  réussi.
- **FR-010**: Textes visibles : NL/FR (`K.t`) ; la page Privacy mentionne le cookie de session
  client.

### Key Entities

- **Cookie de session client** `famo_klant` : contient le jeton signé existant (format inchangé).
- **Données d'affichage de l'onglet** : identifiant, nom et langue de la zaak.
- **Génération de session** du compte (Clients / Klantgebruikers « Sessiegeneratie ») : existante.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 jeton de session client lisible par JavaScript après connexion (réponses et
  stockage), vérifié par tests automatiques.
- **SC-002**: 100 % des API client authentifient par le cookie seul (tests).
- **SC-003**: 0 client déconnecté par le déploiement pendant la transition (test du chemin
  « jeton dans le corps »).
- **SC-004**: Après déconnexion ou changement de mot de passe, 100 % des cookies antérieurs
  refusés (tests).
- **SC-005**: Aucune régression : `check.js`, ESLint, audits navigateur (UX et clavier) verts.

## Assumptions

- La fin de transition au 31/10/2026 laisse 30 jours ; un jeton ne vit de toute façon jamais
  plus de 7 jours après la connexion, donc tout ancien jeton est mort bien avant.
- SameSite=Strict suffit : le cookie ne sert qu'aux appels `fetch` des pages du portail
  (même site) ; un lien e-mail ouvre une page, pas une API.
- Un seul compte client par navigateur à la fois (cookie partagé entre onglets) est acceptable.
