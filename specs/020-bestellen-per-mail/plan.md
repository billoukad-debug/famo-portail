# Implementation Plan: Bestellen per e-mail

**Branch**: `worktree-agent-a1751446fee4751db` (sur `main` e3eedb7) | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

## Summary

```
client ──mail──▶ Resend (orders.famoseafood.be, MX) ──webhook signé──▶ POST /api/inbound-mail
   │                                                                    │ garde A-10 · signature Svix (corps brut) · 500/401 fail-closed
   │                                                                    ▼
   │                                         lib/inbound/mailorder.js handleWebhook
   │     ┌─ « Inkomende mails » créé d'abord (id dérivé de l'id Resend : idempotence)
   │     ├─ GET /emails/receiving/{id} (lib/inbound/resend.js : seul module qui connaît Resend)
   │     ├─ répondeur / boucle / > 10 par heure → Genegeerd (pas de texte, pas de réponse)
   │     ├─ expéditeur (Clients.Email, Klantgebruikers actifs) + SPF/DKIM/DMARC
   │     ├─ Claude propose (lib/inbound/claude.js, HTTP brut, JSON imposé)
   │     ├─ le serveur vérifie (check) : articles, confiance, quantités, unité, leverdag, voorwaarden, minimum, interrupteur
   │     └─ lib/bestelling.js + numéro + Commandes (Reçue, Bron E-mail) + journal + mails  ─┐
   │                       sinon : Te controleren (+ accusé de réception au client connu)   │
   ◀──────────── confirmation (NL/FR, Reply-To entreprise) ───────────────────────────────┘
personnel : /team/bestellingen#/controle ⇄ /api/mailcontrole (create · ignore · analyse) → même création
```

| Partie | Où | Quoi |
|---|---|---|
| Lignes partagées | `lib/bestelling.js` (nouveau) | `buildOrderLines` extrait de `api/order.js` et `api/staff.js` (même logique, messages historiques gardés par appelant), `catalogueFor` |
| Webhook | `api/inbound-mail.js` (nouveau) | garde, secret, corps brut (`req.rawBody` en dev, flux relu sur Vercel), signature, 256 ko max |
| Signature | `lib/inbound/svix.js` | `verify` (v1, plusieurs signatures, ±5 min, `timingSafeEqual`), `sign` (tests, script de démo) |
| Resend | `lib/inbound/resend.js` | `eventInfo`, `fetchEmail`, `normalise` (défensif), `htmlToText`, `autoReplyReason` |
| Claude | `lib/inbound/claude.js` | requête, schéma JSON, `sanitize`, erreurs → raison NL ; clé lue à l'appel |
| Logique | `lib/inbound/mailorder.js` | `handleWebhook`, `check`, `firstDeliverable`, création, file du personnel, RGPD, `purge` |
| Personnel | `api/mailcontrole.js` (nouveau), `assets/pages/team/bestellingen.js`, `assets/pages/staff-common.js`, `assets/ui.js` (icône `mail`) | onglet « Te controleren » + compteur, pastille du menu (toutes les 60 s au plus) |
| Beheer | `lib/beheer/config.js` (`saveMailBestellingen`), `lib/beheer/common.js` (`config.mailBestellingen`), `api/onboarding.js` (journal), `assets/pages/beheer.js` | carte « Bestellen per e-mail » |
| E-mails | `lib/ordermail.js` | `viaMail` (phrase NL/FR dans la confirmation), `buildMailReceivedMail` / `notifyMailReceived` |
| RGPD | `lib/beheer/klanten.js`, `api/reminders-cron.js` | export, anonymisation, conservation 90 jours |
| Données | `lib/at-engine.js` (table), `docs/SCHEMA.md`, `scripts/fake-airtable.js`, `scripts/seed.js` | table `Inkomende mails`, champs `Commandes.Bron`, `Commandes.Inkomende mail`, `Configuratie.Bestel-e-mailadres`, `Configuratie.Mailbestellingen automatisch` |
| Dev | `scripts/dev.js`, `scripts/dev-server.js`, `scripts/fake-resend.js`, `scripts/fake-anthropic.js` (nouveau), `scripts/mail-inbound-test.js` (nouveau) | démo complète sans clé |
| Audits | `scripts/ux-audit.js`, `scripts/check.js` | écran Te controleren (et e-mail dépliée) ; `lib/inbound` dans la syntaxe et les liens |
| Ops | `docs/RUNBOOK.md` § 7, `docs/COUTS.md`, `vercel.json` | mise en place, incidents, coûts, `maxDuration` 60 s |

## Constitution Check

- **I. Sans build, sans dépendance** : ✅ aucun SDK (Anthropic ni Resend ni Svix) : `fetch` global et `crypto`
  intégré ; `require` statiques (Vercel nft) ; une feuille `ui.css` (bloc séparé en fin de fichier), aucun
  style en ligne ajouté ; `assets-version.js` relancé.
- **II. Le serveur décide** : ✅ Claude ne fait que proposer des ids et des quantités ; prix négociés, TVA (au
  passage en Facturée comme toujours), règles de livraison, numéro, statut, journal = chemin commun du serveur.
  Le personnel n'envoie que ids et quantités ; tout est revérifié. Garde A-10 en première ligne des deux
  nouveaux handlers ; `/api/mailcontrole` exige `staffSession`, Beheer `adminSession`. **Webhook** : la session
  est remplacée par la signature Svix (un serveur n'a pas de cookie) ; fail-closed (500 sans secret, 401 sinon).
  Sans `ANTHROPIC_API_KEY` : tout va dans Te controleren (pas de repli silencieux). Aucun secret dans le code,
  les logs, l'URL ni l'écran (Beheer : booléens).
- **III. Tests d'abord** : ✅ `test/bestellen-per-mail.test.js` (15 tests, SQLite en mémoire, `fetch` simulé,
  réseau réel refusé) ; aucun appel réel à Anthropic ni à Resend ; aucune écriture en production. Pas de bloc
  `test/workflow` ajouté : le scénario complet tient sur le moteur SQL, plus fidèle à la production que le faux
  Airtable des scénarios (inventaire F-10 inchangé).
- **IV. Terrain** : ✅ écran en néerlandais ; e-mails au client dans sa langue (règle C-15 déjà en place pour
  tous les e-mails client) ; cibles ≥ 44 px ; chaque champ a un libellé ; `K.prompt` pour la raison ;
  ux-audit et kbd-audit sans écart ; l'édition d'une carte survit au rafraîchissement automatique (état en
  mémoire, `K.keep`).
- **V. Données et conformité** : ✅ schéma + faux Airtable dans le même commit ; case absente = faux
  (interrupteur coupé par défaut) ; nouvelles données personnelles (adresse, texte libre) couvertes par
  l'export, l'anonymisation et une conservation de 90 jours.

## Sécurité et RGPD

| Menace | Mesure |
|---|---|
| Faux webhook, rejeu | HMAC Svix sur le corps brut, `timingSafeEqual`, ±5 min ; secret absent → 500 |
| Faux expéditeur (From usurpé) | adresse exacte d'une fiche + SPF/DKIM/DMARC ; échec → Te controleren, aucune réponse |
| Backscatter / spam | jamais de réponse à un inconnu ; pas d'appel AI pour un inconnu |
| Boucle de répondeurs | en-têtes RFC 3834 / Precedence / X-Autoreply, `noreply@`, nos domaines ; 10/h par expéditeur |
| Injection de consignes dans la mail | balise `<email>` = donnée ; le modèle n'a ni prix ni outil ; le serveur recalcule tout ; une ligne douteuse va au personnel |
| Coût incontrôlé | 200 lectures AI par jour au plus (`INBOUND_AI_DAILY_MAX`), effort low, catalogue en cache |
| Double commande | id d'enregistrement dérivé de l'id Resend (clé primaire), `atomic.claim` côté personnel |
| Fuite par les logs | ni texte, ni objet, ni clé : ids, statuts, raisons |
| Données personnelles | texte gardé 90 jours (cron quotidien), inclus dans l'export RGPD, supprimé à l'anonymisation ; les répondeurs/boucles ne gardent pas le texte. Sous-traitants : Resend (réception) et Anthropic (lecture) — à mentionner dans la politique de confidentialité (`privacy.html`, non modifiée ici : **à faire par le propriétaire**) |

## Coûts (prix relevés le 02/10/2026 ; à revérifier)

Claude Opus 5.5 : 4 $/M jetons d'entrée, 20 $/M de sortie, lecture de cache 0,20 $/M, écriture de cache
≈ 5 $/M (×1,25). Par mail (hypothèse : 100 produits ≈ 3 400 jetons de consignes + catalogue, mail ≈ 300 jetons,
sortie ≈ 300 jetons de JSON + ≈ 500 de réflexion à effort low) :

| Cas | Entrée | Sortie | Total |
|---|---|---|---|
| Cache froid (mails espacées de plus de 5 min : cas courant) | 3 400 × 5 $/M + 300 × 4 $/M ≈ 0,018 $ | 800 × 20 $/M = 0,016 $ | **≈ 0,035 $** |
| Cache chaud (rafale du soir) | 3 400 × 0,20 $/M + 300 × 4 $/M ≈ 0,002 $ | 0,016 $ | **≈ 0,018 $** |

Soit ≈ 1 $ pour 30 mails ; 20 mails par jour ≈ 15–20 $ par mois. Plafond : 200 lectures/jour ≈ 7 $/jour au
pire. Avec des mails espacées, le cache coûte ≈ 25 % de plus sur l'entrée qu'aucun cache (écriture ×1,25) ;
gain dès que deux mails arrivent à moins de 5 min. Mesure réelle : champ `AI-gebruik` de chaque message.
Resend : 2 e-mails envoyés par commande automatique (équipe + client), 1 par message à contrôler ;
réception : vérifier si elle compte dans le quota du plan (non précisé dans la documentation lue).
Vercel : une invocation de plus par mail (≤ 25 s), négligeable.

## Complexity Tracking

- **Webhook sans session** (principe II) : justifié, un serveur tiers n'a pas de cookie ; la signature Svix
  remplit le rôle de la session, fail-closed. La garde A-10 reste (inoffensive pour un serveur sans Origin).
- **Refactorisation de `api/order.js` / `api/staff.js`** : les deux `buildOrderLines` identiques passent dans
  `lib/bestelling.js` pour qu'une commande par e-mail ne puisse pas diverger ; messages d'erreur gardés mot
  pour mot ; tous les tests existants inchangés et verts.
- **Corps brut** : `scripts/dev-server.js` garde `req.rawBody` ; sur Vercel le flux rejoué est relu (R2).
