# FAMO Portail — Nouvelles idées (plan)

Plan produit pour la suite, après le redesign staff (4 destinations + Meer) et l’onboarding Mohsen.
Ce document ne reprend pas l’audit structurel déjà traité : shell unique, Bestellingen / Magazijn / Invoeren / Leveringen.

**Principe :** chaque idée doit servir le parcours réel  
`commande → préparation ligne → sortie stock → réception → facture`,  
sans transformer le portail en ERP générique.

---

## Où on en est

| Zone | État | Commentaire |
|---|---|---|
| Parcours ops staff | Solide | Règles métier côté serveur (prix, stock une fois, facture une fois) |
| UI staff | En cours (PRs) | Shell + nav 4+Meer ; documents PDF in-app |
| Go-live | Quasi prêt | Guide `/aan-de-slag.html` + purge manuelle Airtable |
| Facturation légale | Intentionnellement incomplète | Docs internes, pas Peppol |
| Auth | Acceptable pour démarrer | Code staff partagé + fallback temporaire ; mots de passe clients en clair |
| Portail client `/` | Fonctionnel, hors redesign | Historique + reorder ; pas de session cookie |

---

## Horizon A — Débloquer l’exploitation quotidienne

Idées à forte valeur dès que Mohsen tourne en réel, **sans** changer le modèle Airtable en profondeur.

### A1. Preuve de livraison réelle (upload)
**Problème :** le sélecteur photo ne fait qu’un aperçu local (`PROOF_UPLOAD_BLOCKED`) ; le livreur doit coller une URL HTTPS externe.  
**Idée :** dépôt direct (Vercel Blob en premier choix) depuis la feuille de confirmation Leveringen.  
**DoD :** photo/signature jointe → URL HTTPS stockée dans Airtable → visible sur la facture / fiche commande.  
**Effort :** moyen · **Risque :** faible · **Dépendance :** compte Blob / token

### A2. Configuratie → documents
**Problème :** IBAN / BIC / identité saisis à l’onboarding n’apparaissent pas sur LB / facture / creditnota (coordonnées encore en dur).  
**Idée :** `documents.js` (et preview Magazijn) lisent `/api/config` ; pied de page dynamique ; alerte si banque non confirmée.  
**DoD :** changer IBAN dans Aan de slag → prochain PDF à jour.  
**Effort :** faible · **Risque :** faible

### A3. Départ unifié (Magazijn = Order)
**Problème :** Magazijn a un modal de confirmation avant déduction stock ; `order.html` peut partir sans le même garde-fou UX.  
**Idée :** un seul flux `confirmAdvance` / sheet partagé pour « Sortie en livraison », avec retour clair des erreurs stock (`missing` / `insufficient`).  
**DoD :** impossible de déduire le stock sans la même confirmation, quel que soit l’écran.  
**Effort :** faible · **Risque :** faible (règle API déjà là)

### A4. Leveringen « chauffeur d’abord »
**Problème :** la file existe (Maps + réception) mais reste une liste plate.  
**Idée :** ordre de tournée simple (glisser ou numéro), CTA photo-first, adresse + client en grand, mode une commande à la fois.  
**DoD :** un livreur termine 5 stops sans ouvrir Magazijn ni Documenten.  
**Effort :** moyen · **Risque :** faible

### A5. Paiement un cran plus utile
**Problème :** toggle Payé / non, sans montant, moyen ni date.  
**Idée :** champs légers `mode` (cash / transfer / autre) + date de paiement ; chip Bestellingen enrichi. Pas de grand module compta.  
**DoD :** Mohsen voit en un coup d’œil les impayés du jour et marque un paiement avec contexte.  
**Effort :** faible–moyen · **Risque :** faible (champs Airtable)

---

## Horizon B — Fiabiliser avant multi-utilisateur

À faire **avant** plusieurs tablettes / livreurs en parallèle sur les mêmes commandes.

### B1. Numérotation facture atomique
**Problème :** `FA-{année}-{nnnn}` = max+1 (course possible). Documenté dans le README.  
**Idée :** compteur dédié Airtable (ou table Compteurs) avec mise à jour conditionnelle ; retry si conflit.  
**DoD :** deux réceptions simultanées → deux numéros distincts, jamais de doublon.  
**Effort :** moyen · **Risque :** moyen (migration données)

### B2. Identités staff (au-delà d’un code)
**Problème :** un seul `STAFF_CODE` (+ fallback `famo2026`) ; pas de « qui a préparé / qui a réceptionné » côté auth.  
**Idée :** table légère `Staff` (code ou PIN perso, prénom, rôle: magasin / livreur / admin) ; cookie session porte l’identité ; journaliser l’acteur sur les actions clés.  
**DoD :** plus de fallback partagé en prod ; chaque action sensible a un nom.  
**Effort :** moyen–élevé · **Risque :** moyen  
**Note :** retirer `famo2026` une fois les PIN déployés.

### B3. Session client + hygiène mots de passe
**Problème :** mot de passe client en clair dans Airtable ; renvoyé à chaque appel catalogue / commande.  
**Idée :** hash (argon2/bcrypt) + cookie de session client (miroir du modèle staff) ; reset toujours via staff/onboarding.  
**DoD :** plus de `pw` dans le body des requêtes après login ; Airtable ne stocke plus le clair.  
**Effort :** élevé · **Risque :** moyen (migration clients existants)

### B4. Lignes de commande structurées
**Problème :** lignes = texte avec `[€prix]` ; stock joint par **nom** normalisé → renommer un produit casse la déduction.  
**Idée :** stocker productId + qty + prix serveur (JSON ou table Lignes) ; affichage texte dérivé pour l’humain.  
**DoD :** renommer un produit catalogue → stock et reorder restent corrects.  
**Effort :** élevé · **Risque :** élevé (cœur métier) — à découper après B1

---

## Horizon C — Boucle comptable & retours

Quand les docs internes ne suffisent plus.

### C1. Handoff Peppol / Billtobox
**Problème :** facture portail = document interne ; envoi légal B2B à raccorder.  
**Idée :** après `Facturée`, bouton « Envoyer au comptable » (export structuré ou API prestataire) ; statut Peppol séparé du statut ops.  
**DoD :** une facture réelle part sans ressaisie manuelle dans l’outil comptable.  
**Effort :** élevé · **Risque :** dépend du prestataire

### C2. Annulation / creditnota métier
**Problème :** statut strictement croissant ; creditnota = impression cosmétique ; retours stock manuels.  
**Idée :** flux « retour partiel / total » après facture : creditnota numérotée + mouvement `Retour client` auto + lien vers commande d’origine.  
**DoD :** retour 2 kg sur une commande facturée → stock + document + trace sans correction manuelle opaque.  
**Effort :** élevé · **Risque :** moyen (nécessite B4 de préférence)

### C3. TVA & mentions légales
**Problème :** TVA figée à 6 % dans les docs.  
**Idée :** taux par produit (ou défaut entreprise) + mentions configurables ; validation avant première facture légale.  
**Effort :** moyen · **Risque :** faible–moyen

---

## Horizon D — Portail client (2ᵉ vague)

Le client `/` a été volontairement laissé hors redesign staff. Idées ciblées, pas un refonte totale.

| Idée | Pourquoi |
|---|---|
| **D1. Modifier / annuler avant préparation** | Évite les appels téléphone tant que statut = Reçue |
| **D2. Télécharger LB / facture** | Même composant PDF staff, côté client authentifié |
| **D3. Favoris synchronisés** | Aujourd’hui `localStorage` ; perdu entre appareils |
| **D4. Créneau / note de livraison visible** | Transparence sans tracking GPS |

---

## Ce qu’on ne fera pas (pour l’instant)

- Refaire l’IA staff (4 + Meer) — déjà planifié / en PR  
- Remplacer Airtable « parce que » — plafond à traiter seulement si concurrence réelle  
- CRM, catalogues multi-entrepôts, app native, offline complet  
- Dashboard analytics générique — les chips Bestellingen suffisent au quotidien  

---

## Proposition d’ordre d’exécution

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

1. **« Implémente A2 + A3 »** — Configuratie dans les docs + départ unifié  
2. **« Upload preuve Vercel Blob (A1) »** — remplacer `PROOF_UPLOAD_BLOCKED`  
3. **« Staff PIN + retrait famo2026 (B2) »** — après go-live stable  
4. **« Compteur facture atomique (B1) »** — avant 2ᵉ appareil en parallèle  

---

*Document de planification — aucune de ces idées n’est implémentée ici. À trancher avec Bilou / Mohsen selon la date de mise en service réelle.*
