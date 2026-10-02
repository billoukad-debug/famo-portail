# Feature Specification: Bestellen per e-mail (commande enregistrée seule)

**Created**: 2026-10-02 · **Status**: Implemented (local, non déployé) · **Branch**: `worktree-agent-a1751446fee4751db`
**Input**: demande du propriétaire : les clients peuvent commander **par e-mail** (WhatsApp plus tard, pas
maintenant) et la commande est enregistrée **toute seule**. Ce que le système ne peut pas lire avec
certitude va dans une file « Te controleren » que le personnel règle en un clic.

## User Scenarios

- **Client connu** — Il écrit à `bestel@orders.famoseafood.be` depuis l'adresse de sa fiche client (ou d'un
  utilisateur supplémentaire actif) : « Pour demain 3 kg de sole et 24 huîtres n°3 ». Quelques secondes
  plus tard il reçoit, dans sa langue (NL/FR), « Bevestiging van uw bestelling CMD-… » / « Confirmation de
  votre commande CMD-… » avec les lignes, ses prix et le jour de livraison, et une phrase « reçu par e-mail,
  une erreur ? répondez ». La commande est « Ontvangen » dans Bestellingen ; le magasin la prépare comme
  toute autre (Klaarzetten).
- **Client connu, message incertain** — Article ambigu (kaliber), quantité étrange, jour impossible, AI
  indisponible… : aucune commande n'est créée. Le client reçoit seulement « We ontvingen uw bericht, ons team
  bekijkt het » (aucune supposition sur le contenu) ; le personnel voit le message dans Te controleren.
- **Personnel (Bestellingen → Te controleren)** — Un onglet avec compteur (et la pastille « Bestellingen »
  du menu) liste chaque message : client reconnu (ou à choisir), adresse, heure, objet, raison (« «garnalen»
  onzeker (55 %) », « onbekende afzender »…), texte original replié, proposition en lignes modifiables
  (article limité au catalogue actif, quantité, unité affichée, remarque), jour de livraison, remarque.
  « Bestelling aanmaken » : le serveur revérifie tout et crée la commande (confirmation au client) ;
  « Opnieuw laten lezen » : nouvelle lecture pour le client choisi ; « Negeren » : avec une raison. Tout est
  journalisé.
- **Beheerder (Beheer → Bedrijfsgegevens → Bestellen per e-mail)** — Voit l'adresse à donner aux clients
  (modifiable), si `RESEND_INBOUND_SECRET`, `RESEND_API_KEY` et `ANTHROPIC_API_KEY` sont posées (oui/non,
  jamais la valeur) et l'interrupteur « Bestellingen per e-mail automatisch aanmaken » (coupé = tout passe par
  Te controleren).
- **Inconnu, spam, faux expéditeur, répondeur** — Jamais de commande, jamais de réponse (pas de
  « backscatter ») ; les répondeurs et boucles sont ignorés sans garder le texte.

## Requirements

- **FR-001** Réception : Resend Receiving sur un **sous-domaine** (`orders.famoseafood.be`, MX propres) ; le
  domaine principal garde ses MX. Resend appelle `POST /api/inbound-mail` (événement `email.received`).
- **FR-002** Authentification du webhook : signature Svix vérifiée sur le **corps brut** avec
  `RESEND_INBOUND_SECRET` (`whsec_…`) ; secret absent ou illisible → 500 (rien n'est lu) ; signature absente,
  fausse ou horodatage à plus de 5 min → 401. La garde A-10 reste en première ligne (navigateur étranger 403).
- **FR-003** Idempotence : un message (id Resend) = un enregistrement `Inkomende mails` créé avant tout
  traitement ; un second webhook du même message répond 200 sans seconde commande, y compris deux livraisons
  simultanées (clé primaire SQL). Exception : un message dont le contenu n'a pas pu être lu chez Resend est
  repris au nouvel essai de Resend (503 la première fois).
- **FR-004** Contenu : lu par `GET https://api.resend.com/emails/receiving/{id}` (le webhook ne porte que des
  métadonnées) ; texte ≤ 20 000 caractères gardé (au-delà : Te controleren « te lang ») ; texte brut ou, à
  défaut, HTML converti ; pièces jointes ignorées (« enkel een bijlage »).
- **FR-005** Expéditeur : adresse From exacte (minuscules) = `Clients.Email` (une ou plusieurs adresses
  séparées) ou `Klantgebruikers.Email` d'un utilisateur **actif**. Inconnu → Te controleren « onbekende
  afzender », sans réponse ni appel AI ; plusieurs clients → Te controleren ; client archivé → Te controleren
  sans réponse. SPF/DKIM/DMARC : DMARC « pass » exigé quand il est donné, sinon SPF ou DKIM « pass » ; sinon
  Te controleren « mogelijk vervalst », sans réponse.
- **FR-006** Boucles : `Auto-Submitted` ≠ no, `Precedence: bulk/auto_reply/junk/list`, `X-Autoreply`,
  `X-Autorespond`, expéditeurs `noreply`/`mailer-daemon`, expéditeur sur notre domaine (adresse de réception ou
  `MAIL_FROM`) → Genegeerd, texte non gardé. Plus de 10 messages par heure du même expéditeur → Genegeerd.
- **FR-007** Lecture : Claude (`claude-opus-5-5`, effort low, sortie JSON imposée par schéma) propose
  `lines[{productId|null, naam_in_mail, qty, unit, confidence, opmerking, note}]`, `leverdag`, `opmerkingen`,
  `onduidelijk`. Le catalogue (actifs, sans prix) est dans le système (mis en cache), le message dans le tour
  utilisateur, marqué comme donnée. Refus, réponse tronquée, 429/5xx, réseau, délai 25 s, JSON illisible,
  clé absente, plafond quotidien (200 lectures) → Te controleren avec la raison ; rien n'est perdu.
- **FR-008** Le serveur décide : la commande n'est créée que si **toutes** les lignes ont un article actif du
  catalogue, une confiance ≥ 0,8, une quantité > 0 et sous un plafond par unité (kg 200, stuk 1000, kassa 50,
  doos 50), entière hors kg, la même unité que le catalogue (si la mail en donne une) ; si le jour demandé
  passe `lib/levering` (passé, fermé, non livré, > 60 jours, heure limite de la veille) — sans jour : premier
  jour livrable ; si le client a accepté les conditions générales publiées ; si le minimum est atteint ; et si
  l'interrupteur Beheer est allumé. Sinon Te controleren avec toutes les raisons et la proposition.
- **FR-009** Commande créée exactement comme une commande du portail : `lib/bestelling.js` (prix négociés,
  texte + `Lignes JSON`), numéro `CMD-…`, statut `Reçue`, `Bron` = « E-mail », `Inkomende mail` = id de
  l'enregistrement, `Besteld door` pour un utilisateur supplémentaire, journal « Mailbestelling aangemaakt ».
- **FR-010** E-mails : commande créée → mails habituels (équipe + client dans sa langue, Reply-To = e-mail de
  l'entreprise) avec la phrase « reçu par e-mail » ; Te controleren d'un client connu et vérifié → accusé
  « We ontvingen uw bericht » (NL/FR). Jamais rien à un inconnu, un faux expéditeur, un client archivé.
- **FR-011** Personnel : `GET /api/mailcontrole` (session staff), `?count=1` pour la pastille ;
  `POST create` (le serveur revérifie client actif, articles actifs, quantités ≤ 1000, jour livrable sans
  l'heure limite comme Invoeren, prix du serveur ; 409 si déjà traité), `ignore` (raison ≥ 3 caractères),
  `analyse` (nouvelle lecture). Journalisés.
- **FR-012** Beheer : `saveMailBestellingen {adres, automatisch}` (beheerder), état exposé en booléens.
- **FR-013** RGPD : export client = messages liés au client ou venant de ses adresses (texte compris) ;
  anonymisation = suppression de ces messages ; conservation : suppression après **90 jours** (cron quotidien
  existant `api/reminders-cron.js`).
- **FR-014** Journaux techniques : ids, statut, raison, statut HTTP et id de requête Anthropic ; jamais le
  texte, l'objet ni une clé.

## Success Criteria

- **SC-001** Tests `test/bestellen-per-mail.test.js` (SQLite en mémoire, réseau simulé) verts : signature,
  idempotence, inconnus, DMARC, répondeurs, plafond, contrôles, erreurs AI, dates, file du personnel, Beheer,
  RGPD, conservation.
- **SC-002** Démonstration locale complète sans clé (`node scripts/dev.js` + `node scripts/mail-inbound-test.js`).
- **SC-003** `ux-audit` (dont « Te controleren ») et `kbd-audit` sans écart.

## Risques et hypothèses à vérifier

- **R1 — format Resend** : vérifié dans la documentation Resend le 02/10/2026 (webhook `email.received` =
  métadonnées seulement ; contenu, en-têtes et `authentication {spf,dkim,dmarc}` via `GET
  /emails/receiving/{id}`). **Non vérifié sur un vrai message** : forme exacte de `headers` (objet supposé,
  liste acceptée), présence de `authentication` (absente → Te controleren « niet geverifieerd », donc aucun
  automatisme : sûr, mais à vérifier au premier message), `html_format` (« data_uri » géré). Tout est isolé
  dans `lib/inbound/resend.js`.
- **R2 — corps brut sur Vercel** : l'aide Node de Vercel lit le corps puis le rejoue (`restoreBody` de
  `@vercel/node`, lu le 02/10/2026) ; le handler relit le flux. Si un jour le flux n'est plus rejoué, la
  signature échoue (401, fail-closed) : à surveiller au premier message (Resend → Webhooks → tentatives).
- **R3 — délai** : Svix attend une réponse en quelques secondes ; une lecture AI lente peut provoquer un
  nouvel essai → idempotence (FR-003) ; l'enregistrement « Verwerken » de plus de 3 minutes apparaît dans
  Te controleren (« verwerking onderbroken »).
- **R4 — usurpation** : un client dont le domaine n'a ni DKIM ni DMARC passe par Te controleren à chaque
  fois (choix de sécurité).
- **R5 — repli AI** : `fallbacks:"default"` (beta `server-side-fallback-2026-07-01`) ; si l'API le refuse
  (400), un seul nouvel essai sans lui. `ANTHROPIC_FALLBACKS=0` le coupe.
- **R6 — interrupteur** : absent = coupé (constitution V) ; à allumer dans Beheer après les premiers essais.
