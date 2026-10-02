# Tasks: Bestellen per e-mail

- [x] T001 Spec, plan (Constitution Check, sécurité/RGPD, coûts), tâches ; documentation Resend Receiving lue (webhook = métadonnées, contenu par `GET /emails/receiving/{id}`), aide Node de Vercel lue (corps rejoué)
- [x] T002 Tests d'abord : `test/bestellen-per-mail.test.js` — signature (valide, fausse, périmée, rotation, secret absent 500), flux brut, idempotence (séquentielle et simultanée), inconnu, DMARC/absence d'authentification, archivé, répondeurs et boucles, plafond 10/h, contrôles (confiance, inconnu, inactif, id inventé, quantité, décimale, unité, onduidelijk), erreurs AI (refusal, max_tokens, 429, 500, 529, délai, réseau, JSON), repli refusé, sans clé, dates (fermé, passé, premier jour livrable), interrupteur, minimum, voorwaarden, Resend illisible puis repris, file du personnel (liste, pastille, revérification, 409, ignorer, relire), Beheer, RGPD, conservation, cron
- [x] T003 `lib/bestelling.js` extrait de `api/order.js` et `api/staff.js` (messages historiques gardés)
- [x] T004 `lib/inbound/svix.js`, `lib/inbound/resend.js`, `lib/inbound/claude.js`, `lib/inbound/mailorder.js`
- [x] T005 `api/inbound-mail.js` (garde, secret, corps brut, signature), `api/mailcontrole.js` (staff)
- [x] T006 E-mails : `viaMail`, `buildMailReceivedMail` (NL/FR) dans `lib/ordermail.js`
- [x] T007 Beheer : `saveMailBestellingen`, `config.mailBestellingen`, carte « Bestellen per e-mail », journal
- [x] T008 RGPD : export, anonymisation (`lib/beheer/klanten.js`), conservation 90 jours (`api/reminders-cron.js`)
- [x] T009 Données : table dans `lib/at-engine.js`, `docs/SCHEMA.md`, `scripts/fake-airtable.js`, démo `scripts/seed.js`
- [x] T010 Personnel : onglet « Te controleren » + compteur (`bestellingen.js`), pastille (`staff-common.js`), icône `mail`, styles (bloc séparé en fin de `ui.css`)
- [x] T011 Dev : `scripts/fake-anthropic.js`, réception dans `scripts/fake-resend.js`, `scripts/dev.js` (clés de dev, `.dev-data/dev-ports.json`), `req.rawBody` dans `scripts/dev-server.js`, `scripts/mail-inbound-test.js`
- [x] T012 `docs/RUNBOOK.md` § 7 (mise en place one.com / Resend / Anthropic / Vercel, incidents), `docs/COUTS.md`, `vercel.json` (`maxDuration` 60 s), `AGENTS.md`
- [x] T013 Audits : écran Te controleren (+ e-mail dépliée) dans `ux-audit` ; captures 1280 / 390 relues
- [x] T014 Portes : assets-version, check.js, ESLint, contrast-check, ux-audit → kbd-audit (serveur neuf, port 4370)
- [ ] T015 (propriétaire) DNS one.com, Resend, clés Vercel, Redeploy, premier vrai message (R1, R2), puis interrupteur Beheer
- [ ] T016 (propriétaire) Mentionner Resend et Anthropic comme sous-traitants dans `privacy.html`
