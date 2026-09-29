# Transfert des comptes à l'entreprise

But : que le portail appartienne à **Famo Trading BV** et non à une personne, avec au moins deux administrateurs par service. Au 27/09/2026, tous les comptes sont au nom d'une seule personne (`docs/COMPTES.md`).

Ordre conseillé : de ce qui bloque le plus un dépannage (Vercel, Neon) à ce qui est le plus lent (domaine). Chaque étape se fait **sans interruption** du portail si l'ordre est respecté. Prévoir un créneau sans commandes pour les étapes 2 et 3 (redéploiement).

## Préalables

- Une adresse e-mail de l'entreprise pour les comptes (par exemple `it@<domaine>`), qui ne dépend pas d'une personne.
- Un gestionnaire de mots de passe de l'entreprise partagé par les deux administrateurs.
- La 2FA de chaque nouveau compte, avec les codes de secours rangés dans ce gestionnaire.
- Le plan payant nécessaire (Vercel Pro : `docs/COUTS.md`) avec un moyen de paiement de l'entreprise.

## 1. GitHub : organisation

1. Créer une organisation GitHub au nom de l'entreprise (plan gratuit suffisant), avec deux propriétaires (*Owners*).
2. Dans le dépôt actuel : **Settings → General → Danger Zone → Transfer ownership** → l'organisation. GitHub redirige l'ancienne adresse vers la nouvelle ; les issues, PR et l'historique suivent.
3. Vérifier que l'onglet **Actions** fonctionne dans l'organisation (CI `check.yml`).
4. Vercel : reconnecter le dépôt si l'intégration GitHub ne le voit plus (**Settings → Git**), puis faire un push de test.
5. Mettre à jour `git remote set-url origin …` sur chaque poste.

## 2. Vercel : équipe

1. Créer une **équipe** Vercel (*Team*) au nom de l'entreprise, plan **Pro** (usage commercial interdit sur Hobby), et y inviter le deuxième administrateur (rôle *Owner*).
2. Projet → **Settings → General → Transfer Project** → l'équipe. Les déploiements, domaines et variables d'environnement suivent le projet ; vérifier qu'aucune variable ne manque après le transfert (liste : `VERCEL_CHECKLIST.md`).
3. Vérifier l'intégration Neon (Storage) : si elle est liée au compte personnel, la réinstaller dans l'équipe et vérifier que `DATABASE_URL` pointe toujours vers la même base.
4. Déployer, vérifier Beheer → Systeemstatus (Database bereikbaar), une commande test.

## 3. Neon : projet

1. Créer une organisation Neon de l'entreprise (ou utiliser celle créée par l'intégration Vercel de l'équipe), deux administrateurs.
2. Transférer le projet vers cette organisation (Neon : **Project settings → Transfer project**, si disponible sur le plan ; sinon, restaurer un export dans un nouveau projet de l'organisation, voir `docs/RUNBOOK.md` § 3.3).
3. Si l'adresse de connexion change : nouvelle `DATABASE_URL` dans Vercel, **Redeploy**. Si `SESSION_SECRET` n'est pas posée, tout le monde sera déconnecté : la poser **avant** (`VERCEL_CHECKLIST.md`).
4. Vérifier la fenêtre de restauration du plan (`docs/COUTS.md`).

## 4. Domaine (one.com)

1. Soit ajouter l'entreprise comme titulaire / contact du domaine dans le compte one.com actuel, soit transférer le domaine vers un compte one.com de l'entreprise (demander le code de transfert / la procédure au support one.com ; pour un `.be`, le titulaire doit être l'entreprise).
2. **Avant** tout transfert, relever tous les enregistrements DNS existants (MX de la messagerie, enregistrements Vercel, DKIM/SPF/DMARC Resend) et les recréer à l'identique : un DNS oublié coupe le site ou les e-mails.
3. Vérifier la date de renouvellement et activer le renouvellement automatique sur une carte de l'entreprise.

## 5. Resend

1. Créer le compte Resend de l'entreprise (ou une équipe), deux membres.
2. Ajouter et vérifier le domaine dans ce compte (DNS chez one.com : DKIM, SPF, DMARC, `docs/RUNBOOK.md` § 4) ; retirer le domaine de l'ancien compte une fois le nouveau vérifié.
3. Nouvelle `RESEND_API_KEY` dans Vercel → Redeploy → commande test → révoquer l'ancienne clé.

## 6. Régénération des secrets

Une fois les comptes transférés, toute personne qui a vu un secret ne doit plus pouvoir s'en servir. Suivre `docs/RUNBOOK.md` § 5, dans cet ordre :

1. `SESSION_SECRET` (nouvelle valeur ; déconnecte tout le monde : prévenir l'équipe).
2. `ADMIN_CODE`, `STAFF_CODE` (ou codes enregistrés dans Beheer → Toegang), PIN des personnes parties.
3. Mot de passe du rôle Neon → nouvelle `DATABASE_URL`.
4. `RESEND_API_KEY`.
5. `AIRTABLE_TOKEN` : révoquer (plus utilisé en production).
6. `CRON_SECRET` : à venir.

Chaque changement de variable : **Redeploy**, puis vérification (connexion Beheer, commande test, e-mail test).

## 7. Clôture

- Mettre à jour `docs/COMPTES.md` (propriétaires, 2ᵉ administrateur, 2FA, facturation, date).
- Retirer l'ancien propriétaire des services s'il ne doit plus y avoir accès.
- Remplir `docs/RUNBOOK.md` § 0 (qui appeler).
