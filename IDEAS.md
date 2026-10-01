# FAMO Portail — Nouvelles idées (plan)

Plan produit pour la suite, après le redesign staff (4 destinations + Meer) et l’onboarding Mohsen.
Ce document ne reprend pas l’audit structurel déjà traité : shell unique, Bestellingen / Magazijn / Invoeren / Leveringen.

> **État au 27/09/2026** (vérifié dans le code) : chaque idée porte **[FAIT]**, **[PARTIEL]**, **[OBSOLÈTE]** ou **[À FAIRE]**. Le texte « Problème » d'origine est gardé pour l'historique quand l'idée est faite.

**Principe :** chaque idée doit servir le parcours réel  
`commande → préparation ligne → sortie stock → réception → facture`,  
sans transformer le portail en ERP générique.

---

## Où on en est

| Zone | État | Commentaire |
|---|---|---|
| Parcours ops staff | Solide | Règles métier côté serveur (prix, stock une fois, facture une fois) |
| UI staff | En cours (PRs) | Shell + nav 4+Meer ; documents PDF in-app |
| Go-live | En production | Vercel + Neon (`DB_BACKEND=postgres`) ; Airtable n'est plus utilisé. `/aan-de-slag.html` n'existe plus (redirigé vers `/beheer.html`, onglet Overzicht) |
| Facturation légale | Hors portail (décision du 27/09/2026) | Le comptable émet les factures légales via Billtobox (Peppol) ; les documents du portail sont internes (« pas une facture »), exports CSV/UBL à prévoir (`docs/adr/0005-facturation-legale.md`) |
| Auth | Acceptable pour démarrer | Codes partagés (modifiables et hachés depuis Beheer) + PIN personnels (`Medewerkers`) ; pas de fallback ; mots de passe clients hachés (scrypt) ; jeton client signé 12 h |
| Portail client `/` | Fonctionnel, NL/FR, version ordinateur | Détail commande, documents téléchargeables, relevé impayés, favoris synchronisés, mot de passe oublié par e-mail ; jeton signé (pas de cookie) |
| Livraison & paiement | Fait | Règles configurables (deadline, jours, fermetures, minimum), exceptions de livraison, ordre de tournée, mode/date de paiement, creditnota réelle (C2) |

---

## Horizon A — Débloquer l’exploitation quotidienne

Idées à forte valeur dès que Mohsen tourne en réel, **sans** changer le modèle Airtable en profondeur.

### A1. Preuve de livraison réelle (upload) — [FAIT]
**Fait (28/09/2026, audit H-09) :** signature à l'écran + photo facultative depuis la feuille de réception Leveringen (`api/bewijs.js`, `assets/proof.js`), stockées en base (`famo_files`), visibles sur la fiche commande et le bon ; rejouables hors ligne.
**Problème :** la réception accepte seulement un lien HTTPS externe (« Bewijs (optioneel) », champ `Preuve de livraison`) ; aucun envoi de photo depuis l'appareil.  
**Idée :** dépôt direct (Vercel Blob en premier choix) depuis la feuille de confirmation Leveringen.  
**DoD :** photo/signature jointe → URL HTTPS stockée dans Airtable → visible sur la facture / fiche commande.  
**Effort :** moyen · **Risque :** faible · **Dépendance :** compte Blob / token

### A2. Configuratie → documents — [FAIT]
**Fait :** les documents lisent l'identité, l'IBAN/BIC et les conditions de Configuratie (`/api/config`, `staff-common.js`, `klant.js`) ; bannière si l'IBAN manque.
**Problème (d'origine) :** IBAN / BIC / identité saisis à l’onboarding n’apparaissaient pas sur LB / facture / creditnota.  
**Idée :** `documents.js` (et preview Magazijn) lisent `/api/config` ; pied de page dynamique ; alerte si banque non confirmée.  
**DoD :** changer IBAN dans Aan de slag → prochain PDF à jour.  
**Effort :** faible · **Risque :** faible

### A3. Départ unifié (Magazijn = Order) — [FAIT]
**Fait :** Magazijn, Bestellingen et la fiche commande passent par la même action partagée (`S.depart`, `assets/pages/staff-common.js`).
**Problème :** Magazijn a un modal de confirmation avant déduction stock ; `order.html` peut partir sans le même garde-fou UX.  
**Idée :** un seul flux `confirmAdvance` / sheet partagé pour « Sortie en livraison », avec retour clair des erreurs stock (`missing` / `insufficient`).  
**DoD :** impossible de déduire le stock sans la même confirmation, quel que soit l’écran.  
**Effort :** faible · **Risque :** faible (règle API déjà là)

### A4. Leveringen « chauffeur d’abord » — [PARTIEL]
**Fait :** ordre de tournée (`Volgorde levering`, glisser ou ▲▼), notes visibles. **Reste :** mode « une commande à la fois » (la preuve photo A1 est faite).
**Problème :** la file existe (Maps + réception) mais reste une liste plate.  
**Idée :** ordre de tournée simple (glisser ou numéro), CTA photo-first, adresse + client en grand, mode une commande à la fois.  
**DoD :** un livreur termine 5 stops sans ouvrir Magazijn ni Documenten.  
**Effort :** moyen · **Risque :** faible

### A5. Paiement un cran plus utile — [FAIT]
**Fait :** `Mode de paiement` (Contant / Overschrijving / Bancontact / Andere) et `Payé le`, journalisés dans `Correcties`, paiement en lot.
**Problème (d'origine) :** toggle Payé / non, sans montant, moyen ni date.  
**Idée :** champs légers `mode` (cash / transfer / autre) + date de paiement ; chip Bestellingen enrichi. Pas de grand module compta.  
**DoD :** Mohsen voit en un coup d’œil les impayés du jour et marque un paiement avec contexte.  
**Effort :** faible–moyen · **Risque :** faible (champs Airtable)

---

## Horizon B — Fiabiliser avant multi-utilisateur

À faire **avant** plusieurs tablettes / livreurs en parallèle sur les mêmes commandes.

### B1. Numérotation facture atomique — [FAIT]
**Fait (28/09/2026, audit B-01) :** compteur par série dans la table `Compteurs`, écriture conditionnelle (CAS) sur le moteur SQL (`lib/billing.js`). Reste connu : un numéro réservé puis abandonné (échec après réservation) laisse un trou dans la série — voir `docs/RUNBOOK.md`.
**Fait :** `ensureUnique` (api/updateorder.js) détecte un doublon FA ou CN juste après l'écriture et renumérote la commande au plus grand identifiant (tests AX1 et AQ5b). **Reste :** pas de compteur atomique, et rien de tel pour les références `CMD-` (`lib/ordernumber.js`).
**Problème (d'origine) :** `FA-{année}-{nnnn}` = max+1 (course possible).  
**Idée :** compteur dédié Airtable (ou table Compteurs) avec mise à jour conditionnelle ; retry si conflit.  
**DoD :** deux réceptions simultanées → deux numéros distincts, jamais de doublon.  
**Effort :** moyen · **Risque :** moyen (migration données)

### B2. Identités staff (au-delà d’un code) — [FAIT]
**Fait :** plus aucun fallback `famo2026` (contrôlé par `scripts/check.js`) ; PIN personnels (table `Medewerkers`), prénom dans le cookie et dans le journal.
**Problème (d'origine) :** un seul `STAFF_CODE` (+ fallback `famo2026`) ; pas de « qui a préparé / qui a réceptionné » côté auth.  
**Idée :** table légère `Staff` (code ou PIN perso, prénom, rôle: magasin / livreur / admin) ; cookie session porte l’identité ; journaliser l’acteur sur les actions clés.  
**DoD :** plus de fallback partagé en prod ; chaque action sensible a un nom.  
**Effort :** moyen–élevé · **Risque :** moyen  
**Note :** `famo2026` retiré.

### B3. Session client + hygiène mots de passe — [FAIT, sauf cookie]
**Fait :** mots de passe hachés (scrypt, migration douce du clair à la connexion) ; après la connexion, jeton signé 12 h au lieu du mot de passe (`lib/clientauth.js`). **Reste (optionnel) :** cookie HttpOnly au lieu du jeton en `sessionStorage`.
**Problème (d'origine) :** mot de passe client en clair ; renvoyé à chaque appel catalogue / commande.  
**Idée :** hash (argon2/bcrypt) + cookie de session client (miroir du modèle staff) ; reset toujours via staff/onboarding.  
**DoD :** plus de `pw` dans le body des requêtes après login ; Airtable ne stocke plus le clair.  
**Effort :** élevé · **Risque :** moyen (migration clients existants)

### B4. Lignes de commande structurées — [FAIT, commandes nouvelles ou modifiées]
**Fait (specs/016-lignes-structurees) :** champ `Lignes JSON` (productId, naam, qty, unit, prijs) écrit par le serveur à côté du texte ; stock (départ, retour, note de crédit), lignes du magasin et « Opnieuw bestellen » rattachés par id ; anciennes commandes par nom (pas de rattrapage). Restent appariés par nom : lots, marge, taux TVA d'une commande non facturée.
**Problème :** lignes = texte avec `[€prix]` ; stock joint par **nom** normalisé → renommer un produit casse la déduction.  
**Idée :** stocker productId + qty + prix serveur (JSON ou table Lignes) ; affichage texte dérivé pour l’humain.  
**DoD :** renommer un produit catalogue → stock et reorder restent corrects.  
**Effort :** élevé · **Risque :** élevé (cœur métier) — à découper après B1

---

## Horizon C — Boucle comptable & retours

Quand les docs internes ne suffisent plus.

### C1. Handoff Peppol / Billtobox — [DÉCIDÉ : export, pas d'envoi]
**Décision (27/09/2026) :** le comptable émet les factures légales via Billtobox ; le portail marque ses documents « pas une facture » et fournira des exports (CSV/UBL) au comptable. Voir `docs/adr/0005-facturation-legale.md`.
**Problème (d'origine) :** facture portail = document interne ; envoi légal B2B à raccorder.  
**Idée :** après `Facturée`, bouton « Envoyer au comptable » (export structuré ou API prestataire) ; statut Peppol séparé du statut ops.  
**DoD :** une facture réelle part sans ressaisie manuelle dans l’outil comptable.  
**Effort :** élevé · **Risque :** dépend du prestataire

### C2. Annulation / creditnota métier — [FAIT]
**Fait :** creditnota numérotée `CN-AAAA-NNNN` (beheerder), lignes ⊆ lignes facturées, prix figés, retour en stock optionnel (mouvement `Retour client`), journal.
**Problème (d'origine) :** creditnota = impression cosmétique ; retours stock manuels. (Fait depuis : marche arrière de statut, annulation avec raison et journal, restauration du stock au retour arrière.)  
**Idée :** flux « retour partiel / total » après facture : creditnota numérotée + mouvement `Retour client` auto + lien vers commande d’origine.  
**DoD :** retour 2 kg sur une commande facturée → stock + document + trace sans correction manuelle opaque.  
**Effort :** élevé · **Risque :** moyen (nécessite B4 de préférence)

### C3. TVA & mentions légales — [PARTIEL / OBSOLÈTE]
**Fait :** taux par produit (`BTW-tarief`) ou taux de Configuratie, une ligne par taux. Les mentions légales relèvent désormais de la facture du comptable (C1).
**Problème (d'origine) :** TVA figée à 6 % dans les docs.  
**Idée :** taux par produit (ou défaut entreprise) + mentions configurables ; validation avant première facture légale.  
**Effort :** moyen · **Risque :** faible–moyen

---

## Horizon D — Portail client (2ᵉ vague)

Le client `/` a été volontairement laissé hors redesign staff. Idées ciblées, pas un refonte totale.

| Idée | Pourquoi |
|---|---|
| ~~**D1. Modifier / annuler avant préparation**~~ | Fait : le client annule tant que statut = Reçue, puis recommande |
| ~~**D2. Télécharger LB / facture**~~ | Fait : `/api/klantdoc` (le client n'ouvre que ses propres documents) |
| ~~**D3. Favoris synchronisés**~~ | Fait : champ `Favorieten` (JSON) de `Clients`, synchronisé entre appareils |
| **D4. Créneau / note de livraison visible** — [À FAIRE] | Transparence sans tracking GPS |

---

## Ce qu’on ne fera pas (pour l’instant)

- Refaire l’IA staff (4 + Meer) — déjà planifié / en PR  
- ~~Remplacer Airtable « parce que »~~ — [OBSOLÈTE] la production est passée sur Neon (`docs/adr/0002-airtable-puis-neon.md`)  
- CRM, catalogues multi-entrepôts, app native, offline complet  
- Dashboard analytics générique — les chips Bestellingen suffisent au quotidien  

---

## Proposition d’ordre d’exécution

> Historique (ordre proposé avant la mise en service). Au 27/09/2026 : 1 (A2), 2 (A3), 6 (B2), 7 (A5) et C2 sont faits ; 5 (B1), 4 (A4) et 8 (B3) partiellement ; C1 est remplacé par l'export vers le comptable.

```text
1. A2 Config → docs          (rapide, crédibilise les PDF)
2. A3 Départ unifié          (évite erreur ops)
3. A1 Upload preuve          (débloque la réception terrain)
4. A4 Leveringen chauffeur   (quotidien livreur)
5. B1 Compteur facture       (avant parallèle)
6. B2 Identités staff        (retire famo2026)
7. A5 Paiement léger         (si besoin terrain)
8. B3 Session client         (sécurité)
9. B4 Lignes structurées     (fondation retours)
10. C2 Retours / creditnota  puis C1 Peppol
11. D1–D4 Portail client     en parallèle si bande passante
```

### Critères pour dire « oui » à une idée
1. Un acteur concret (Mohsen, livreur, client resto) gagne du temps **cette semaine**  
2. Ça renforce une règle déjà vraie (prix serveur, stock une fois, facture une fois)  
3. Ça n’ajoute pas une 5ᵉ destination dans la nav quotidienne  

---

## Prochaines conversations utiles (prompts prêts)

> Historique : les prompts 1 (A2 + A3) et 3 (B2) sont réalisés ; 4 (B1) partiellement (`ensureUnique`).

1. **« Implémente A2 + A3 »** — Configuratie dans les docs + départ unifié  
2. **« Upload preuve Vercel Blob (A1) »** — remplacer `PROOF_UPLOAD_BLOCKED`  
3. **« Staff PIN + retrait famo2026 (B2) »** — après go-live stable  
4. **« Compteur facture atomique (B1) »** — avant 2ᵉ appareil en parallèle  

---

*Document de planification, mis à jour le 27/09/2026 : A2, A3, A5, B2, C2, D1, D2, D3 sont faits ; A4, B1, B3, C3 partiellement ; B4, D4 restent à faire ; A1 et B1 faits le 28/09/2026 ; C1 est tranché (facturation légale chez le comptable). À trancher avec Bilou / Mohsen.*
