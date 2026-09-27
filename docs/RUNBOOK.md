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
5. `api/health` : **à venir** (un endpoint de santé est en cours d'ajout par un autre développeur ; quand il existera, `GET /api/health` sera la première vérification).
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

- **À venir** : des actions `export` et `restore` sont en cours d'ajout à `api/dbadmin` (Beheer → Systeemstatus) par un autre développeur. Tant qu'elles n'existent pas, il n'y a **pas** d'export applicatif : seul l'historique Neon protège les données.
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
| `SESSION_SECRET` | Vercel → Settings → Environment Variables → nouvelle valeur (`openssl rand -base64 48`) → Redeploy | **Déconnecte tout le monde** (personnel et clients) : à utiliser pour couper une session volée. |
| `DATABASE_URL` | Neon → Roles → réinitialiser le mot de passe du rôle → copier la nouvelle adresse dans Vercel → Redeploy | Si `SESSION_SECRET` est absente, déconnecte aussi tout le monde. |
| `RESEND_API_KEY` | Resend → API Keys → créer la nouvelle, la poser dans Vercel, Redeploy, **puis** révoquer l'ancienne | Pas d'interruption si l'ordre est respecté. |
| `AIRTABLE_TOKEN` | Airtable → Developer hub → révoquer (plus utilisé en production) | Si `SESSION_SECRET` est absente, déconnecte tout le monde. |
| `CRON_SECRET` | à venir | — |
| Mot de passe d'un client | Beheer → Klanten → Nieuw wachtwoord / Toegang blokkeren | Invalide aussi ses jetons. |

Après une rotation : vérifier la connexion Beheer, une commande test, un e-mail test.

## 6. Autres situations

- **Un client ne peut plus se connecter** : Beheer → Klanten → fiche : archivé ? accès bloqué ? → Nieuw wachtwoord. Trop d'essais : attendre 30 s.
- **Code Beheer perdu** : un autre beheerder (PIN) le change dans Toegang ; sinon vider `Beheerderscode hash` dans la table `Configuratie` (Neon, SQL : champ JSON de `famo_records` où `tbl = 'Configuratie'`) : le code de la variable `ADMIN_CODE` redevient valable.
- **Numéro FA/CN en double** : `ensureUnique` renumérote automatiquement ; si un doublon subsiste, corriger à la main et le noter dans `Correcties`. Les numéros du portail sont internes ; prévenir le comptable si un document a déjà été transmis.
- **Stock faux** : Voorraad → corriger avec un motif (journalisé dans `Mouvements de stock`).
