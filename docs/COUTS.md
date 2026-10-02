# Coûts d'exploitation

Prix relevés sur les pages officielles le **27/09/2026**, hors TVA, en dollars US sauf mention. Les prix changent : revérifier les liens avant toute décision. Les volumes FAMO sont des estimations (données fictives jusqu'au 27/09/2026).

## Synthèse

| Service | Plan conseillé | Coût mensuel estimé | Pourquoi |
|---|---|---|---|
| Vercel | **Pro**, 1 siège | **20 $** (crédit d'usage de 20 $ inclus) | Le plan Hobby (gratuit) est réservé à l'usage personnel non commercial : un portail de vente B2B doit être sur Pro. |
| Neon | Free au départ, **Launch** recommandé en production | 0 $ (Free) ; Launch ≈ quelques $ selon l'activité | Free : restauration limitée à 6 h en arrière. Launch : jusqu'à 7 jours. |
| Resend | Free tant que < 25 commandes/jour ; sinon Pro | 0 $ ; Pro 20 $ | Free : 100 e-mails/jour, ≈ 4 e-mails par commande. |
| one.com | domaine (et DNS) | _à relever sur la facture one.com_ | Prix non publié de façon lisible pour `.be` (voir plus bas). |
| GitHub | Free (organisation gratuite) | 0 $ | CI : minutes gratuites des dépôts (vérifier si le dépôt devient privé dans une organisation). |
| Billtobox | chez le comptable | hors portail | Factures légales (Peppol). |

Ordre de grandeur : **≈ 20 à 50 $ par mois** (Vercel Pro + Neon Launch, Resend gratuit), plus le domaine.

## Vercel

- Hobby : 0 $/mois. Conditions : « Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan. » Est commercial tout déploiement utilisé pour un gain financier de quiconque participe au projet, y compris un salarié ou un consultant qui écrit le code.
- Pro : **20 $/mois par siège**, avec **20 $ de crédit** d'usage inclus ; au-delà, facturation à l'usage (par exemple 0,60 $ par million d'invocations de fonctions). Un seul siège suffit si une seule personne déploie ; chaque administrateur supplémentaire (`docs/TRANSFERT.md`) est un siège de plus.
- Rollback : sur Pro, retour possible à n'importe quel ancien déploiement de production ; sur Hobby, seulement au précédent.
- Sources : https://vercel.com/pricing ; https://vercel.com/docs/limits/fair-use-guidelines (section « Commercial usage ») ; https://vercel.com/docs/instant-rollback — consultés le 27/09/2026.

## Neon (Postgres)

| Plan | Prix | Calcul | Stockage | Historique (restauration à un instant passé) |
|---|---|---|---|---|
| Free | 0 $ | 100 CU-heures / projet / mois | 0,5 Go / projet | 6 h (limite 1 Go) |
| Launch | à l'usage, sans minimum | 0,106 $ / CU-heure | 0,35 $ / Go-mois | 1 jour par défaut, jusqu'à 7 jours (historique facturé 0,20 $ / Go-mois) |
| Scale | à l'usage, sans minimum | 0,222 $ / CU-heure | 0,35 $ / Go-mois | 1 jour par défaut, jusqu'à 30 jours |

Estimation FAMO sur Launch (hypothèse : base < 1 Go, calcul minimal 0,25 CU actif ≈ 4 h par jour, mis en veille le reste du temps) : ≈ 30 CU-heures × 0,106 $ + 1 Go × 0,35 $ ≈ **4 $ par mois**, plus l'historique. À confirmer après un mois réel (Neon → Billing).

Recommandation : passer sur **Launch** avant de stocker de vraies commandes, pour pouvoir revenir jusqu'à 7 jours en arrière (`docs/RUNBOOK.md` § 3.2).

Sources : https://neon.com/pricing ; https://neon.com/docs/postgres/backup-restore/history-window — consultés le 27/09/2026.

## Resend (e-mails)

| Plan | Prix | Volume |
|---|---|---|
| Free | 0 $ | 3 000 e-mails / mois, **100 par jour**, 3 domaines |
| Pro | 20 $ / mois | 50 000 e-mails / mois (35 $ pour 100 000), 10 domaines, 0,90 $ / 1 000 au-delà |
| Scale | à partir de 90 $ / mois | 100 000 e-mails / mois et plus |

Consommation du portail : une commande complète envoie 4 e-mails (nouvelle commande : équipe + client ; départ ; réception), plus les e-mails ponctuels (bienvenue, mot de passe, demande d'accès). Plan gratuit ≈ **25 commandes par jour** au maximum (100 / 4), ≈ 750 par mois. Au-delà, un jour chargé bloque les derniers e-mails de la journée (les commandes, elles, passent toujours).

Source : https://resend.com/pricing — consulté le 27/09/2026.

## Anthropic (bestellen per e-mail, specs/020)

Claude Opus 5.5 : 4 $ / M jetons d'entrée, 20 $ / M de sortie, lecture de cache 0,20 $ / M (prix du
02/10/2026, à revérifier sur https://www.anthropic.com/pricing). Estimation ≈ **0,02 à 0,04 $ par mail lue**
(détail : `specs/020-bestellen-per-mail/plan.md` § Coûts) ; 20 mails par jour ≈ 15–20 $ par mois. Plafond
technique : 200 lectures par jour (`INBOUND_AI_DAILY_MAX`). Mails d'inconnus, répondeurs et boucles ne sont
jamais lus par l'AI. Chaque message garde sa consommation (`AI-gebruik`). Conseil : plafond de dépense dans
la console Anthropic (workspace dédié).

## one.com (domaine)

Le domaine et ses DNS sont chez one.com. Le prix de renouvellement d'un `.be` n'a pas pu être relevé sur le site public le 27/09/2026 (page de prix sans tarif lisible) : **reprendre le montant de la dernière facture one.com** et noter ici la date d'échéance. Une messagerie ou un hébergement one.com éventuels sont facturés à part.

Source : https://www.one.com/en/domain/prices (consultée le 27/09/2026, sans tarif affiché).

## À suivre chaque mois

- Vercel → Usage (crédit consommé), Neon → Billing, Resend → Usage (pics journaliers proches de 100).
- Relire ce fichier quand un plan change.
