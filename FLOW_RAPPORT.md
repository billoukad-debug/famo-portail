# Mega rapport — flux quotidien FAMO (post-merge + correctifs)

**Date :** 2026-07-28  
**Branche :** `cursor/flow-logic-audit-4754`  
**Base :** `main` @ `d39563e` (PR #7 mergée)

---

## 1. Verdict

Le **moteur métier** (prix serveur, validation article, stock 1×, réception, facture) est solide.  
Le **parcours quotidien** était illisible : 3 endroits pour confirmer une livraison, 2 générateurs de facture, labels contradictoires (« Openstaand »), chips qui envoient au mauvais écran, IBAN vide = facture morte sans sortie claire.

**Ce lot rend le flux logique** : une action = un écran propriétaire + IBAN/BIC d’exemple temporaire pour débloquer les tests.

---

## 2. Flux cible (à coller sur le frigo)

```text
Téléphone / WhatsApp     →  Invoeren
Commande client          →  Bestellingen (file)
Matin                    →  Magazijn → Dag (picking)
Préparer / partir        →  Magazijn → Bord
Sur la route / réception →  Leveringen  ← SEUL endroit « bevestigen »
PDF LB / facture         →  Documenten
Inventaire               →  Voorraad (Meer)
Setup société            →  Aan de slag (footer)
```

### Règles d’or

| Action | Écran propriétaire | Les autres pages… |
|---|---|---|
| Créer commande manuelle | **Invoeren** | deep-link Magazijn après save |
| Valider lignes / départ | **Magazijn Bord** | order → Magazijn `?id=` |
| Confirmer réception + facturer | **Leveringen** | Magazijn/order → lien Leveringen |
| Imprimer LB / FA | **Documenten** | Magazijn/order → `?order=&type=` |
| IBAN / société | **Aan de slag** | banner + CTA « Vul IBAN in » |

---

## 3. Incohérences trouvées (audit)

### P0 — cassaient le quotidien

| ID | Problème | Impact |
|---|---|---|
| P0-1 | `order.html` « Vertrek » sans modal ni détail stock | Départ aveugle / erreur opaque |
| P0-2 | Confirmation livraison ×3 (Magazijn + Leveringen + order) | Qui facture ? Double-clic |
| P0-3 | Facture bloquée IBAN sans CTA recovery dans la liste | Cul-de-sac après livraison |
| P0-4 | Deux moteurs docs (Magazijn `doc()` vs Documenten) + message « via Airtable » | Confusion ops |

### P1 — friction

| ID | Problème |
|---|---|
| P1-1 | « Openstaand » = impayés (Bestellingen) **et** non-facturés (Magazijn) |
| P1-2 | Chip « Te bevestigen » → Bestellingen au lieu de Leveringen |
| P1-3 | Dag : après départ, commande disparaît sans lien Leveringen |
| P1-4 | Print Bord = toutes les commandes ≠ filtre Dag |
| P1-5 | Mobile Meer : summary caché → impossible de fermer |
| P1-6 | Invoeren succès sans lien Magazijn |
| P1-7 | README mentait encore sur `famo2026` |
| P1-8 | Facture Documenten affichait `En attente` en FR |

---

## 4. Correctifs livrés dans ce lot

### IBAN / BIC exemple (en attendant le vrai)
- `staff-company.js` : `BE68 5390 0754 7034` / `GKCCBEBB`
- Appliqué automatiquement si Configuratie vide (`documents.js`, Magazijn)
- Bannière jaune sur facture : **« Voorbeeld bankgegevens »**
- Préremplissage Aan de slag (tél/email/IBAN/BIC exemples)
- **À remplacer** par les vrais coords via Aan de slag avant facturation réelle

### Flux unifié
- Magazijn **Onderweg** → CTA **Open Leveringen** (plus de sheet in-place)
- Magazijn docs → deep-link **Documenten**
- Paiement « Markeer betaald » seulement une fois **Gefactureerd**
- Stats Magazijn : « Openstaand » → **Niet gefactureerd**
- Chip Bestellingen **Te bevestigen** → `/leveringen.html`
- Chip **Openstaand** renommé **Te betalen**
- `order.html` : départ avec **modal + erreurs stock** ; réception → Leveringen (secondaire : sheet)
- Dag : bandeau **onderweg → Leveringen**
- Print Bord aligné sur le **filtre jour**
- Invoeren : liens post-save Magazijn / order
- Documenten : CTA **Vul IBAN in** si bloqué
- Nav : Bestellingen · Magazijn · **Leveringen** · Invoeren
- Meer mobile : summary visible pour fermer
- README + VERCEL_CHECKLIST : fail-closed `STAFF_CODE`, plus de `famo2026`

---

## 5. Ce qui reste (volontairement hors lot)

1. Extraire `magazijn.js` du monolithe HTML (risque parenthèse)
2. Nettoyer CSS fantôme warehouse dans `staff.css`
3. Alléger davantage Bestellingen (chips **ou** summary, pas les deux)
4. Hash mots de passe clients / Peppol / Blob preuve photo
5. Purge données test Airtable + vraie commande Mohsen
6. Sauvegarder **vrais** IBAN/BIC (les exemples ne sont pas légaux pour encaisser)

---

## 6. Routine quotidienne Mohsen (après deploy)

1. Login avec **STAFF_CODE** Vercel (pas famo2026)
2. Si banner setup → Aan de slag → **Opslaan** (accepte exemples ou met le vrai IBAN)
3. Matin : **Magazijn → Dag** → print si besoin
4. **Bord** : valider → Klaar → Onderweg
5. **Leveringen** : confirmer réception (nom obligatoire)
6. **Documenten** : ouvrir facture (bannière jaune = encore exemple banque)
7. WhatsApp : **Invoeren** → « Open in Magazijn »

---

## 7. Definition of Done de ce lot

- [x] Une confirmation réception = Leveringen (owner)
- [x] Une génération docs = Documenten
- [x] IBAN/BIC exemple → facture testable
- [x] Labels « Te bevestigen / Te betalen / Niet gefactureerd » distincts
- [x] Départ order.html protégé (modal + stock)
- [x] Docs / check.js mis à jour
- [ ] Smoke manuel Preview/Prod après merge (humain)
- [ ] Vrais IBAN/BIC avant encaissement

---

**Bottom line :** avant = labyrinthe avec 3 portes pour la même action.  
Après = **4 destinations avec jobs clairs** + banque exemple pour que le flow tourne.  
Le reste « amateur » = **données test + pas encore de routine humaine**, pas un manque de code métier.
