# Runbook — incidents de production

Pour la personne de garde quand le portail ne marche plus. Production au 27/09/2026 : **Vercel** (site + fonctions `api/`), **Neon** (Postgres, `DB_BACKEND=postgres`), **Resend** (e-mails), domaine et DNS chez **one.com**. Airtable n'est plus utilisé en production.

Règle d'or : **d'abord rétablir le service (rollback), ensuite comprendre**. Ne jamais corriger directement en production sans trace (commit, note dans l'incident).

## 0. Qui appeler

À remplir par le client (Famo Trading BV). Ne rien inscrire ici de secret (ni mot de passe, ni code).

| Rôle | Nom | Téléphone | Joignable | Suppléant |
|---|---|---|---|---|
| Responsable FAMO (décide) | _à remplir_ | _à remplir_ | _à remplir_ | _à remplir_ |
| Technique (Vercel, Neon, GitHub) | _à remplir_ | _à remplir_ | _à remplir_ | _à remplir_ |
| Comptable (factures légales, Billtobox) | _à remplir_ | _à remplir_ | _à remplir_ | — |
| Domaine / DNS (one.com) | _à remplir_ | _à remplir_ | _à remplir_ | — |

Support des fournisseurs : Vercel (vercel.com/help), Neon (console → Support), Resend (resend.com/help), one.com (help.one.com). Les comptes et leurs propriétaires : `docs/COMPTES.md`.

**Risque connu** : au 27/09/2026, tous les comptes sont au nom d'une seule personne. Si elle est injoignable, personne ne peut faire un rollback. Voir `docs/TRANSFERT.md` (ajouter un deuxième administrateur partout).

## 1. Diagnostic en 5 minutes

1. Le site répond-il ? Ouvrir `https://<domaine>/` et `https://<projet>.vercel.app/` (le second contourne le DNS).
2. Vercel → projet → **Deployments** : le dernier déploiement de production est-il « Ready » ? Date du dernier déploiement = heure du début de l'incident ?
3. Vercel → projet → **Logs** (Runtime Logs) : filtrer sur 5xx ; chercher `DATABASE_NOT_CONFIGURED`, `[mail]`, `[updateorder]`, `Error`.
4. Beheer → **Systeemstatus** → Database : backend `postgres`, « bereikbaar ».
5. `GET /api/health` (sans connexion) : version déployée, backend, base joignable, e-mail configuré ou non, dernière sauvegarde. C'est la première vérification, à brancher sur une sonde externe.
6. Pages d'état des fournisseurs (Vercel, Neon, Resend : lien « Status » en pied de leur site) : panne générale en cours ?

## 2. Mauvais déploiement → rollback Vercel

Symptôme : tout allait bien, un déploiement vient de partir, et une page ou une action casse.

1. Vercel → projet → **Deployments**, ou tuile « Production Deployment » de la page du projet.
2. **Instant Rollback** (ou ⋮ à côté d'un déploiement de production précédent → *Instant Rollback*) → choisir le dernier déploiement sain → **Continue** → vérifier les domaines → **Confirm Rollback**. C'est immédiat.
   - Plan Pro : on peut revenir à n'importe quel déploiement déjà passé en production. Plan Hobby : seulement au précédent (et Hobby est interdit en usage commercial, voir `docs/COUTS.md`).
   - Alternative : ⋮ → **Promote** sur un déploiement précédent.
3. **Attention** : après un rollback, Vercel coupe l'attribution automatique du domaine de production ; les prochains push sur `main` **ne passent plus en ligne** tant qu'on n'a pas fait **Undo Rollback** (ou *Promote*) sur un déploiement corrigé.
4. Les variables d'environnement ne sont pas remises en arrière par un rollback : si l'incident vient d'une variable, la corriger puis **Redeploy**.
5. Le rollback ne touche **pas** la base : une migration de données déjà faite reste faite.
6. Ensuite : corriger sur une branche, CI verte (`node scripts/check.js`, ESLint, job Navigateur), fusionner, puis *Undo Rollback* / *Promote* du nouveau déploiement.

Source : https://vercel.com/docs/instant-rollback (consulté le 27/09/2026).

## 3. Panne ou erreur de données Neon

### 3.1 Neon injoignable (toutes les API en 500)
- Logs Vercel : erreurs de connexion vers `*.neon.tech`, ou `DATABASE_NOT_CONFIGURED` (variable `DATABASE_URL` absente ou invalide : la remettre, **Redeploy**).
- Neon console → projet → **Monitoring** / page d'état Neon. Le plan gratuit met le calcul en veille : premier appel plus lent, pas une panne.
- Quota du plan gratuit atteint (heures de calcul, 0,5 Go) : passer au plan Launch (`docs/COUTS.md`).
- Pas de repli possible sur Airtable : les commandes depuis la bascule ne sont que dans Neon. Pendant la panne, prendre les commandes par téléphone et les saisir ensuite dans **Invoeren**.

### 3.2 Données effacées ou abîmées (erreur humaine, bug)
Neon garde un **historique** qui permet de restaurer la base à un instant passé (« Instant restore », point-in-time) :

| Plan Neon | Fenêtre d'historique (défaut / max) |
|---|---|
| Free | 6 h / 6 h (limité à 1 Go) |
| Launch | 1 jour / 7 jours |
| Scale | 1 jour / 30 jours |

Source : https://neon.com/docs/postgres/backup-restore/history-window (consulté le 27/09/2026). **Agir vite** : sur le plan gratuit, au-delà de 6 h, l'état d'avant est perdu.

Procédure (console Neon) :
1. Noter l'heure du dernier état sain (journal `Correcties`, logs Vercel).
2. Idéalement, arrêter les écritures : prévenir l'équipe de ne plus rien saisir.
3. Neon console → projet → **Backup & Restore** (Instant restore) → branche racine de production → choisir l'horodatage → vérifier → **Restore**. Neon crée automatiquement une branche de sauvegarde de l'état actuel (`<branche>_old_<horodatage>`) : rien n'est perdu, on peut y récupérer les commandes saisies entre-temps.
4. Vérifier dans Beheer (Overzicht, Bestellingen) et Systeemstatus.
5. Resaisir via Invoeren les commandes légitimes arrivées après l'horodatage choisi (les lire dans la branche `_old_`).

Alternative sans toucher la production : créer une **branche** Neon à l'instant voulu, l'inspecter, puis ne copier que ce qui manque.

### 3.3 Restauration depuis un export (plan B)
Indépendant de l'historique Neon, utile au-delà de la fenêtre de restauration ou pour changer de fournisseur.

- **Export / restauration** : Beheer → Systeemstatus → Database → « Back-up maken » (export complet, `api/dbadmin` action `export`) et « Back-up terugzetten » (`restore`, base SQL seulement, protégé : saisir RESTORE, sauvegarde automatique avant). Sauvegarde nocturne par e-mail : `api/backup-cron` (exige `CRON_SECRET` + `RESEND_API_KEY` + destinataire).
- Procédure prévue, à préciser quand ces actions seront livrées :
  1. Exporter régulièrement (au moins chaque semaine et avant toute opération risquée) ; conserver le fichier hors de Vercel et de Neon (stockage de l'entreprise), chiffré s'il contient des données clients.
  2. Restaurer d'abord dans une **nouvelle branche** Neon ou une base vide, jamais directement sur la production.
  3. Vérifier (comptes par table, derniers numéros FA/CN/CMD), puis faire pointer `DATABASE_URL` vers la base restaurée et **Redeploy**.
- Test de restauration : au moins une fois par trimestre, sur une branche de test.

## 4. E-mails (Resend)

Symptôme : les clients ou la boîte interne ne reçoivent plus rien. Un échec d'e-mail **n'annule jamais** une commande.

1. Logs Vercel : lignes `[mail] …` (`domain not verified`, `quota`, `422`, `reseau`).
2. Resend → **Emails** : envois refusés ou en échec ; **Domains** : le domaine est-il toujours *Verified* ?
3. Quota : plan gratuit = 100 e-mails/jour, 3 000/mois ; ≈ 4 e-mails par commande → ≈ 25 commandes/jour. Au-delà : plan Pro.
4. DNS chez one.com (panneau one.com → DNS du domaine). Les enregistrements exacts sont affichés par Resend (Domains → le domaine) ; les recopier **tels quels** :
   - **DKIM** : TXT sur `resend._domainkey` ;
   - **SPF** : MX et TXT sur le sous-domaine d'envoi indiqué par Resend (en général `send`) ;
   - **DMARC** : TXT sur `_dmarc` (par exemple `v=DMARC1; p=none; rua=mailto:<boîte de l'entreprise>` au début, puis `quarantine` une fois les envois vérifiés).
   - Ne pas supprimer les enregistrements existants de one.com (MX de la messagerie de l'entreprise).
5. `MAIL_FROM` doit utiliser le domaine vérifié ; sans lui, Resend n'envoie qu'au propriétaire du compte.

## 5. Rotation des secrets

À faire : départ d'une personne, fuite supposée, et au moins une fois par an. Ne jamais coller un secret dans un ticket, un chat ou un commit.

| Secret | Où le changer | Effet |
|---|---|---|
| `ADMIN_CODE` / `STAFF_CODE` | Beheer → Toegang (code enregistré, haché) **ou** variable Vercel + Redeploy | Le nouveau code remplace l'ancien pour ce rôle. Les sessions ouvertes restent valables jusqu'à 8 h (voir `SESSION_SECRET`). |
| PIN personnel | Beheer → Toegang → Medewerkers (désactiver / changer) | Immédiat pour les nouvelles connexions. |
| Codes partagés (fin) | Beheer → Toegang → « Enkel persoonlijke pincodes » → Aanzetten | Teamcodes refusées, tout le monde déconnecté ; seuls les PIN ouvrent, `ADMIN_CODE` devient un accès de secours journalisé (§ 6). Refusé sans beheerder PIN active. |
| `SESSION_SECRET` | Vercel → Settings → Environment Variables → nouvelle valeur (`openssl rand -base64 48`) → Redeploy | **Déconnecte tout le monde** (personnel et clients) : à utiliser pour couper une session volée. |
| `DATABASE_URL` | Neon → Roles → réinitialiser le mot de passe du rôle → copier la nouvelle adresse dans Vercel → Redeploy | Si `SESSION_SECRET` est absente, déconnecte aussi tout le monde. |
| `RESEND_API_KEY` | Resend → API Keys → créer la nouvelle, la poser dans Vercel, Redeploy, **puis** révoquer l'ancienne | Pas d'interruption si l'ordre est respecté. |
| `AIRTABLE_TOKEN` | Airtable → Developer hub → révoquer (plus utilisé en production) | Si `SESSION_SECRET` est absente, déconnecte tout le monde. |
| `CRON_SECRET` | à remplir | Obligatoire pour la sauvegarde nocturne et les relances (sinon 500). |
| `RESEND_INBOUND_SECRET` | Resend → Webhooks → nouveau secret → Vercel → Redeploy | Bestellen per e-mail (§ 7) ; absent = toute mail refusée (500). |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → Vercel → Redeploy → révoquer l'ancienne | Lecture des mails (§ 7) ; absente = tout en Te controleren. |
| Clés des pushmeldingen (VAPID) | Par défaut créées dans Configuratie à la première activation ; pour en changer : `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` dans Vercel (prioritaires) → Redeploy | Chaque appareil rallume ses meldingen (Vandaag → Meldingen → Aanzetten) ; les anciens abonnements sont retirés sans envoi (§ 10). |
| Mot de passe d'un client | Beheer → Klanten → Nieuw wachtwoord / Toegang blokkeren | Invalide aussi ses jetons. |

Après une rotation : vérifier la connexion Beheer, une commande test, un e-mail test.

## 6. Autres situations

- **Un client ne peut plus se connecter** : Beheer → Klanten → fiche : archivé ? accès bloqué ? → Nieuw wachtwoord. Trop d'essais : attendre 30 s.
- **Un client connecté est renvoyé à « Sessie verlopen » à chaque clic** : sa session vit dans le cookie HttpOnly `famo_klant` (chemin `/api`, `specs/013-cookie-client-httponly`). Navigateur qui bloque les cookies du site → les autoriser pour le portail (cookie strictement nécessaire). Deux comptes clients dans deux onglets du même navigateur : le dernier connecté gagne, l'autre onglet revient à la connexion (voulu). Jusqu'au 31/10/2026 inclus, un ancien jeton gardé dans l'onglet est encore accepté une fois puis converti en cookie ; après cette date il est ignoré (une reconnexion).
- **Code Beheer perdu** : un autre beheerder (PIN) le change dans Toegang ; sinon vider `Beheerderscode hash` dans la table `Configuratie` (Neon, SQL : champ JSON de `famo_records` où `tbl = 'Configuratie'`) : le code de la variable `ADMIN_CODE` redevient valable.
- **« Enkel persoonlijke pincodes » active et plus aucun PIN beheerder utilisable** (PIN oublié, départ, verrou des PIN) — accès de secours (audit L-06, `specs/005-pin-personnels-seuls/plan.md`) :
  1. Sur `/beheer/aanmelden` (page Beheer, pas celle du personnel), taper la valeur de la variable Vercel `ADMIN_CODE`. Elle ouvre Beheer au nom « Noodtoegang », **seulement si aucun code beheerder n'est enregistré** (`Beheerderscode hash` vide) : un code enregistré remplace `ADMIN_CODE`, y compris pour le secours. `STAFF_CODE` et les codes enregistrés restent refusés.
  2. Chaque usage laisse une ligne d'erreur `"msg":"noodtoegang: ADMIN_CODE gebruikt…"` dans les logs Vercel (fonction `session`) et une ligne « noodtoegang » dans Beheer → Journaal. Une ligne qui n'est pas de vous = `ADMIN_CODE` a fuité : le changer (tableau ci-dessus) et prévenir le propriétaire.
  3. Dans Toegang → Medewerkers : créer ou réactiver un beheerder avec un PIN, puis se reconnecter avec ce PIN.
  4. Si un code beheerder est enregistré : vider `Beheerderscode hash` (voir ligne précédente) **ou** retirer `Enkel persoonlijke PIN` du JSON de `Configuratie` dans Neon ; les codes partagés refonctionnent alors (option inactive).
  - Verrou des PIN (20 échecs → 15 min) avec l'option active : il n'y a plus de teamcode de repli, le personnel attend 15 min (ou le beheerder utilise le secours). Risque accepté pour ne pas rouvrir une porte partagée.
- **Numéro FA/CN en double** : `ensureUnique` renumérote automatiquement ; si un doublon subsiste, corriger à la main et le noter dans `Correcties`. Les numéros du portail sont internes ; prévenir le comptable si un document a déjà été transmis.
- **Trou dans la série FA/CN** (« où est CN-2026-0003 ? ») — `specs/010-updateorder-numerotation/` :
  1. Ce qui ne crée **jamais** de trou : un refus de contrôle (statut, rôle, plafond, motif, réception non confirmée, régime TVA illisible, stock illisible), un rejeu (double clic, file hors ligne, même `sleutel`). Les contrôles passent avant la réservation du numéro ; un refus décidé après (deux appareils en même temps) rend le numéro au compteur s'il est encore le dernier.
  2. Sinon, le numéro est **expliqué** : Beheer → Journaal, chercher « Nummer vervallen » (ou le numéro) → « Nummer vervallen — Factuurnummer: FA-2026-0012 → niet gebruikt », la commande, qui, quand et la raison. Même trace dans les logs Vercel : `[updateorder] nummer vervallen FA-2026-0012 rec… <erreur>`.
  3. Raison « Opslaan van de bestelling mislukt… » (écriture en échec) : l'issue est incertaine. Vérifier que le numéro n'est sur **aucune** commande (Neon, SQL Editor : `SELECT id FROM famo_records WHERE tbl = 'Commandes' AND fields LIKE '%FA-2026-0012%'`). Absent : trou normal, documenté par la ligne du journal, rien à corriger (ne **jamais** réattribuer le numéro à la main). Présent : la ligne du journal est sans objet (l'écriture avait réussi), le noter dans `Correcties`.
  4. Raison « Creditnota geweigerd na de reservering… » : un autre appareil a pris le numéro suivant entre-temps ; trou normal, rien à corriger.
  5. Sur Airtable (plus en production), le numéro est « max + 1 » recalculé : un échec ne consomme rien et rien n'est journalisé. Risque résiduel connu : deux appareils qui confirment la **même** réception au même instant (deux instances) ; le dernier écrit gagne, l'autre FA n'est pas journalisé.
- **Stock faux** : Voorraad → corriger avec un motif (journalisé dans `Mouvements de stock`).
- **Lignes structurées (`Lignes JSON`, B4 — `specs/016-lignes-structurees/`) : note de migration et diagnostic**
  1. **Au déploiement, rien n'est réécrit.** Champ additif sur `Commandes`, sans migration Neon (le moteur stocke les champs en JSON). Il apparaît sur les commandes **créées** (portail client, invoer) ou dont les **lignes changent** (magasin, renommage d'un produit pour les commandes ouvertes) après le déploiement. Les commandes d'avant gardent le texte seul et l'appariement par nom : départ, retour, note de crédit, documents et « Opnieuw bestellen » se comportent exactement comme avant. Aucune facture n'est touchée.
  2. **Pas de script de rattrapage** (décision) : apparier les anciennes commandes par nom au moment du rattrapage attacherait un mauvais produit si un produit a déjà été renommé et son ancien nom repris. Ne pas en écrire un à la main sur Neon. Limite connue : une ancienne commande facturée dont le produit est renommé ensuite ne remet pas le stock en place lors d'une note de crédit avec retour (le produit n'est pas trouvé par son ancien nom, comme avant ; aucun mouvement « Retour client » écrit pour cette ligne) → corriger dans Voorraad avec un motif.
  3. **Rollback** (§ 2) : l'ancien code ignore `Lignes JSON` ; rien à nettoyer. Retour à Airtable (`DB_BACKEND=airtable`, plus utilisé) : créer d'abord le champ texte long `Lignes JSON` dans la table `Commandes`, sinon Airtable refuse les nouvelles commandes (champ inconnu). Après un retour à la nouvelle version, une ligne dont le `naam` n'a pas suivi un renommage fait pendant le rollback retombe simplement sur le nom (le texte fait foi).
  4. **« Catalogus onleesbaar: voorraad niet bijgewerkt »** au départ, au retour arrière ou sur une note de crédit avec retour : la commande a des références produit et le catalogue n'a pas pu être lu ; rien n'a bougé (ni stock ni numéro). Réessayer ; si ça persiste, voir § 3.1.
  5. Vérifier une commande (Neon, SQL Editor, lecture seule) : `SELECT fields::json->>'Lignes (produits / quantités)', fields::json->>'Lignes JSON' FROM famo_records WHERE tbl = 'Commandes' AND id = 'rec…'`. Le texte fait foi pour quantités et prix ; chaque entrée JSON porte `productId` (id `Catalogue`) et le `naam` de la ligne correspondante. **Ne jamais modifier à la main** le JSON d'une commande facturée.
- **Verpakking (`specs/023-verpakking/`) : conditionnement de vente**
  1. **Au déploiement, rien n'est réécrit.** Trois champs facultatifs au `Catalogue` (`Per verpakking`, `Verpakking`, `Enkel per verpakking`), deux clés facultatives (`per`, `verpakking`) dans les entrées de `Lignes JSON` des commandes créées ensuite. Prix et lignes restent **par unité** (« Eieren × 12 pièce [€1.00] ») : totaux, TVA, stock, numérotation et UBL calculés comme avant.
  2. **« … enkel per doos van 6 te bestellen (u vroeg 7 stuks). »** (400, portail client, Invoeren ou commande par e-mail) : voulu ; le client commande par conditionnement entier. Si Mohsen veut vendre à l'unité : Beheer → Producten → décocher « Enkel per verpakking ». Le magasin peut toujours corriger la quantité livrée (Artikelen valideren) et faire une note de crédit à l'unité.
  3. Changer le conditionnement d'un produit ne change pas les documents des commandes déjà passées (conditionnement figé dans `Lignes JSON`, comme le prix).
  4. **Rollback** (§ 2) : l'ancien code ignore ces champs ; une commande « 2 doos » reste « 12 stuks » partout. Retour à Airtable : créer d'abord les trois champs dans `Catalogue`.

## 7. Bestellen per e-mail (specs/020)

Les clients écrivent à `bestel@orders.famoseafood.be` ; Resend reçoit, appelle le portail, Claude lit, le
serveur décide. Sans les réglages ci-dessous, rien ne se passe (fail-closed) : aucun risque à déployer avant.

### 7.1 Mise en place (propriétaire, une fois)

Le domaine principal `famoseafood.be` garde **sa** messagerie (et son MX nul) : on n'ajoute un MX que sur le
**sous-domaine** `orders`. Ne jamais toucher aux MX du domaine principal.

1. **Resend → Domains → Add domain** : `orders.famoseafood.be`, région UE si proposée ; activer **Receiving**
   (réception). Resend affiche les enregistrements à créer, dont un **MX** pour `orders` (valeur et priorité
   exactes données par Resend, ne pas les recopier d'ici) et les TXT de vérification.
2. **one.com → DNS de famoseafood.be** : créer **exactement** les enregistrements affichés par Resend, avec
   l'hôte `orders` (ou `xxx.orders` selon Resend). Rien sur `@`. Attendre « Verified » dans Resend (quelques
   minutes à quelques heures).
3. **Resend → Webhooks → Add endpoint** : URL `https://www.famoseafood.be/api/inbound-mail`, événement
   **`email.received`** seulement. Copier le **Signing secret** (`whsec_…`).
4. **Vercel → Settings → Environment Variables** (Production) :
   - `RESEND_INBOUND_SECRET` = le signing secret (étape 3) ;
   - `RESEND_API_KEY` : déjà en place (envois) ; elle sert aussi à lire le contenu des mails reçus — la clé
     doit avoir l'accès complet (« Full access »), une clé « Sending access » ne lit pas les mails reçus ;
   - `ANTHROPIC_API_KEY` : console.anthropic.com → API Keys → Create Key (un workspace dédié « FAMO portail »
     permet de plafonner la dépense : Limits → spend limit) ;
   - facultatif : `INBOUND_AI_DAILY_MAX` (défaut 200 lectures/jour), `ANTHROPIC_FALLBACKS=0` (couper le
     repli de modèle), `ANTHROPIC_TIMEOUT_MS` (défaut 25 000).
5. **Redeploy** (Deployments → ⋮ → Redeploy) : les variables ne s'appliquent qu'aux nouveaux déploiements.
6. **Beheer → Bedrijfsgegevens → Bestellen per e-mail** : les trois clés « Ingesteld » ; vérifier l'adresse.
   L'interrupteur « automatisch aanmaken » reste **coupé** pour commencer.
7. Premier essai : depuis l'adresse e-mail d'une fiche client de test, écrire « 2 kg … pour <jour> ». Il doit
   apparaître dans **Bestellingen → Te controleren** (raison « automatisch aanmaken staat uit ») avec une
   proposition lisible. Vérifier aussi la ligne `Verificatie` (`spf=pass dkim=pass dmarc=pass`) : seul
   **`dmarc=pass`** (ou un DKIM aligné, si Resend en donne le domaine) permet l'automatisme ; si elle montre
   `dmarc=?`, Resend ne donne pas DMARC et rien ne sera jamais automatique (spec R1 : prévenir le développeur).
   Corps brut (spec R2) : dans Resend → Webhooks → l'endpoint → la tentative doit être **200** ; un **400**
   avec, dans les logs Vercel (`"fn":"inbound-mail"`), « ruwe body onbeschikbaar » signifie que Vercel ne
   rejoue plus le corps (prévenir le développeur) ; un 401 = secret. Puis allumer l'interrupteur.
8. Communiquer l'adresse aux clients : ils écrivent **depuis l'adresse de leur fiche** (Beheer → Klanten →
   e-mail, plusieurs adresses séparées par une virgule possibles) ; sinon leur mail attend le personnel.
9. `privacy.html` : ajouter Resend (réception) et Anthropic (lecture automatique) comme sous-traitants.

### 7.2 Incidents

- **Aucune mail n'arrive dans Te controleren** : Resend → Emails → Receiving (la mail est-elle reçue ?) ;
  Resend → Webhooks → l'endpoint → tentatives : `500` = `RESEND_INBOUND_SECRET` absent (logs Vercel
  `inbound-mail` « RESEND_INBOUND_SECRET ontbreekt ») ; `401` = mauvais secret (recopier, Redeploy) ou
  horloge ; `503` = contenu non lu chez Resend (Resend réessaie seul ; vérifier `RESEND_API_KEY` en accès
  complet). DNS : `dig MX orders.famoseafood.be`.
- **Une mail d'un client est « Genegeerd » « niet aan het bestel-adres gericht »** : elle était adressée à
  une autre adresse du sous-domaine ; vérifier l'adresse dans Beheer (Bestel-e-mailadres) et celle utilisée
  par le client.
- **Une carte montre « bestelling CMD-… werd al aangemaakt »** : la fonction s'est arrêtée après la création ;
  cliquer « Bestelling aanmaken » ferme le message sans seconde commande (409 « bestond al »).
- **Tout va dans Te controleren** : lire la raison sur la carte. « ANTHROPIC_API_KEY ontbreekt » (clé,
  Redeploy) ; « AI-sleutel geweigerd (401) » (clé révoquée) ; « daglimiet » (plafond quotidien atteint) ;
  « automatisch aanmaken staat uit » (Beheer) ; « niet geverifieerd » (domaine du client sans DMARC pass :
  normal, le personnel valide) ; « te veel berichten » (plus de 10 mails vérifiées en une heure) ; « mogelijk
  dubbele bestelling » (même commande déjà passée aujourd'hui).
- **Une mail « bloquée » en Verwerken** : après 3 min elle apparaît dans Te controleren (« verwerking
  onderbroken ») ; la traiter à la main. Logs Vercel : `"fn":"inbound-mail"` + l'id d'enregistrement.
- **Boucle avec un répondeur** : les répondeurs sont ignorés et un expéditeur est plafonné à 10 mails/heure
  (Genegeerd). Si besoin, couper l'endpoint dans Resend → Webhooks (Disable), rien d'autre n'est touché.
- **Coût AI inattendu** : console Anthropic → Usage ; champ `AI-gebruik` des messages ; baisser
  `INBOUND_AI_DAILY_MAX` ou retirer `ANTHROPIC_API_KEY` (tout passe alors par le personnel).
- **Rotation** : `RESEND_INBOUND_SECRET` → Resend → Webhooks → l'endpoint → nouveau secret (rotation, ou
  supprimer puis recréer l'endpoint), coller la nouvelle valeur dans Vercel, Redeploy ; entre les deux, les
  webhooks refusés (401) sont réessayés par Resend. Le portail accepte plusieurs signatures `v1` dans l'en-tête ; `ANTHROPIC_API_KEY` → nouvelle clé,
  Vercel, Redeploy, puis révoquer l'ancienne.
- **Données** : chaque message est supprimé après 90 jours par le cron quotidien (`/api/reminders-cron`,
  `inkomendeMailsVerwijderd` dans la réponse) ; l'export RGPD d'un client les contient ; l'anonymisation les
  supprime.
- **Test local** : `node scripts/dev.js` puis `node scripts/mail-inbound-test.js --help` (Resend et Claude
  simulés, jamais la production).

## 8. Testperiode afsluiten (fin des essais, `specs/021-testgegevens-opruimen/`)

Pour le propriétaire, **une fois**, quand l'usage réel commence. Tout se fait dans **Beheer → Systeemstatus → carte « Testperiode afsluiten »** ; personne n'écrit à la main dans Neon. Produits, prix, quantités en stock, clients, configuration et medewerkers ne sont jamais touchés.

1. **Prévenir l'équipe** : pendant ces 10 minutes, personne ne saisit de commande (sinon elle pourrait tomber dans la sélection).
2. **Back-up** : bouton « Back-up maken » (dans la carte, ou carte Database). Le fichier `.json.gz` se télécharge : le ranger hors du portail (stockage de l'entreprise). Il reste aussi dans la liste des back-ups.
3. **Voorbeeld** : « Aangemaakt vóór » = date et heure du début de l'usage réel (par défaut : maintenant). Si de vrais clients ont déjà commandé : après « Voorbeeld tonen », cocher ces clients sous « Echte klanten: hun bestellingen behouden » (toutes leurs commandes restent) ; pour une seule vraie commande d'un client de test, mettre sa référence dans « Behalve ». Cliquer « Voorbeeld tonen » : rien n'est écrit. Lire les comptes : commandes par statut, numéros FA / CN, leveringsbons, photos et signatures, mouvements de stock, commandes par client. « Buiten de selectie » = ce qui reste visible.
4. **Archiveren als test** : bouton « N bestellingen archiveren als test » puis confirmer. Le serveur refuse si la sélection a changé depuis l'aperçu (refaire l'aperçu). Réversible : « Terugzetten ».
5. **Vérifier** : Bestellingen, Magazijn, Leveringen, Documenten (personnel), Rapportage (Beheer) et le portail d'un client : plus aucun essai. Une fiche ouverte par un ancien lien refuse toute modification (« testbestelling »). En cas de doute : « Terugzetten », tout revient tel quel.
6. **Definitief verwijderen** : seulement les commandes archivées comme test. Le serveur exige une back-up de **moins de 30 minutes** (sinon refaire l'étape 2) et la saisie exacte de `VERWIJDER TESTS`. Supprimés : les commandes, leurs fichiers (signatures, photos) et leurs mouvements de stock. **Les quantités en stock ne bougent pas** (le stock a été recompté). Beheer → Journaal garde toutes les lignes d'audit d'avant et une ligne « Testperiode: definitief verwijderd » (comptes, plages de références et de numéros). Échec partiel : relancer ; ce qui est supprimé le reste, ce qui reste est retrouvé.
7. **Nummering herstarten** (facultatif) : **d'abord demander au comptable**. Seulement si **aucune** facture ou note de crédit d'essai n'a été envoyée à un client ni transmise au comptable (Billtobox, export UBL/CSV) : une facture émise ne s'efface pas, elle s'annule par une note de crédit (`docs/adr/0005-facturation-legale.md`, `specs/021-testgegevens-opruimen/plan.md` § légal). Le bouton n'est actif que pour les séries de l'année où plus aucun document numéroté n'existe (FA, CN ; CMD seulement si aucune vraie commande n'a déjà un numéro) ; back-up de moins de 30 min et saisie de `HERSTART NUMMERING` exigées. Le compteur repart : la prochaine facture est `FA-<année>-0001`. Journalisé « Testperiode: nummering herstart ». Si quelqu'un doute : ne pas herstarten, la série continue simplement (FA-…-0007) et c'est toujours correct.
8. **Première vraie commande** : la passer (ou attendre la première du jour), vérifier dans Bestellingen sa référence ; à la première livraison, vérifier le numéro FA attribué (`…-0001` si l'étape 7 a été faite).
9. Retour en arrière après l'étape 6 : seulement par la back-up (Systeemstatus → Database → « Terugzetten » sur la back-up, saisir RESTORE) — elle remplace **toute** la base, y compris ce qui a été saisi depuis ; à faire tout de suite ou pas du tout (§ 3.2 / 3.3).

## 9. « Vandaag » : l'écran du gérant (`specs/024-eenvoudig-beheer/`)

Pour qui : Mohsen (et tout appareil réglé en « Eenvoudig »). Rien ne change pour un appareil « Uitgebreid ».

1. **Activer sur un appareil** : ouvrir `/team/vandaag` (ou la bannière « Altijd op Vandaag openen? » → Ja), ou
   l'engrenage en haut → « Weergave » → Eenvoudig. L'appareil s'ouvre alors sur Vandaag (connexion et app installée).
2. **Installer sur l'iPhone** : Safari → `www.famoseafood.be/team/vandaag` → Partager → « Zet op beginscherm ».
3. **Une commande** = une carte, un gros bouton : Klaar → Onderweg → Geleverd → Betaald. Après chaque tap,
   « Ongedaan maken » pendant 6 s. Geleverd : réceptionnaire = nom du client ; pour un autre nom, une signature ou
   une photo : ⋯ → « Geleverd met naam of handtekening ».
4. **Refus du serveur** (stock insuffisant, lots obligatoires, commande changée ailleurs) : le message est sur la
   carte, la commande n'a pas bougé. « Lots verplicht » actif : le tap Klaar ouvre la saisie des lots.
5. **Revenir aux écrans complets** : menu « Alle schermen », ou engrenage → Weergave → Uitgebreid.

## 10. Pushmeldingen : une notification sur l'iPhone (`specs/025-pushmeldingen/`)

Une notification à chaque commande du portail client ou créée depuis un e-mail, et pour un e-mail mis en
« Te controleren » (au plus une par 10 minutes : une vague de spam ne fait pas sonner le téléphone à chaque fois).
Une commande saisie par le personnel (Invoeren, « + Bestelling ») n'en envoie pas. L'e-mail de nouvelle commande reste
le filet. Moteur SQL seulement (production : Postgres ; en local : `DB_BACKEND=sqlite node scripts/dev.js`).

1. **Activer sur l'iPhone** (iOS 16.4 ou plus) : FAMO sur l'écran d'accueil (Safari → Partager → « Zet op
   beginscherm ») et ouvert **depuis l'icône** (Apple n'envoie rien à un onglet Safari). Vandaag → **Meldingen** →
   **Aanzetten** → iOS demande l'autorisation → « Sta toe ». Puis **Test sturen** : « FAMO · Test » arrive en quelques
   secondes. Ordinateur (Chrome, Edge, Firefox, Safari) : même chemin, dans le navigateur.
2. **Rien n'arrive** :
   - Vandaag → Meldingen dit « uit » : rallumer (appareil retiré dans Beheer, nettoyé après un 404/410, ou clé changée).
   - « geweigerd » : iPhone → Instellingen → Meldingen → FAMO → Sta meldingen toe ; ordinateur : cadenas à gauche de
     l'adresse → Meldingen → Toestaan.
   - Beheer → Toegang → « Meldingen op toestellen » : colonne « Laatste fout » (service en panne, time-out) ; effacée
     au prochain envoi réussi. Mode Concentration / Niet storen de l'iPhone : notifications muettes.
   - Logs Vercel, `"fn":"push"` : « niet alle meldingen verstuurd » (nombre d'envois ratés, jamais le contenu).
3. **Retirer un appareil** (perdu, personne partie) : Beheer → Toegang → Meldingen op toestellen → Verwijderen.
   Sur l'appareil lui-même : Vandaag → Meldingen → Uitzetten.
4. **Changer les clés** (fuite supposée d'une sauvegarde : la clé privée en fait partie) : poser `VAPID_PUBLIC_KEY` /
   `VAPID_PRIVATE_KEY` dans Vercel (paire P-256 en base64url, générée dans un terminal local :
   `node -e "console.log(require('./lib/webpush').generateKeys())"`, jamais dans un chat) puis Redeploy. Chaque appareil
   rallume ensuite ses meldingen ; les anciens abonnements sont retirés sans envoi. Une seule des deux variables, ou
   une paire invalide : `/api/push` répond 503 (jamais d'autres clés en silence).
5. Une notification ne bloque jamais une commande : 4 s au plus par appareil, en parallèle de l'e-mail ; la commande
   est déjà enregistrée.
