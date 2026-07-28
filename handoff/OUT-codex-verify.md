# OUT — Codex verify

> Vérification sceptique en lecture seule de `cursor/fix-coherence-phase1-a47d` à `eecc6c4` (la fiche initiale annonçait `cdc06ba`). Aucun code modifié, aucun commit créé. Contrôles exécutés : `node scripts/check.js` et `node scripts/workflow-check.js` — tous deux passent, avec réserves détaillées ci-dessous.

## Verdict

- Les livrables UX des phases 1 à 4 sont majoritairement présents dans le code et plusieurs parcours ont réellement été améliorés.
- Deux P0 rendent toutefois la promesse « cookie-only / secret non exposé » fausse : un code staff connu est actif par défaut et les API acceptent encore `code` en URL ou corps de requête.
- La facture est bloquée dans Magazijn si IBAN/BIC manque, mais reste prévisualisable/imprimable depuis Documents : la règle métier n'est pas unifiée.
- Les deux scripts de contrôle donnent donc un faux vert sur les garanties les plus sensibles.
- **Décision : NO-GO — ne pas merger la PR #7 telle quelle. Corriger les P0 puis relancer les contrôles.**

## Claims vérifiés

| Claim | Statut | Preuve | Sévérité |
|---|---|---|---|
| Documents mobile : cartes lisibles | DONE | `documenten.html` contient à `max-width:780px` `.d-table{display:none}` et `.d-list .d-doc{display:block}`. | P2 |
| Filtre « Open » = non facturée | DONE | `bestellingen.html`, `statusMatch(o, "open")` retourne `o.statut !== "Facturée"`; le chip ouvre `?status=open`. | P2 |
| Filtres Bestellingen synchronisés avec l'URL | DONE | `bestellingen.html` emploie `syncUrlFromFilters()` et `history.replaceState`. | P2 |
| « Toon alles » Attention requise | DONE | `renderAttention()` mène vers `bestellingen.html?attention=required`. | P2 |
| Seuil bas éditable sans être remis à 0 | DONE | `aan-de-slag.html` envoie `lowThreshold` saisi; `api/onboarding.js` ne le modifie que s'il est numérique. | P2 |
| Erreur Magazijn avec retry | DONE | `entrepot.html` possède `showBoardError()` et un nouveau chargement depuis les blocs `catch`. | P2 |
| Retour après connexion staff | DONE | `staff-session.js` conserve le retour attendu puis `bindLogin` reprend la navigation. | P2 |
| Preuve de livraison honnête | DONE | `staff-session.js` indique explicitement que la photo est seulement prévisualisée localement et n'est pas stockée. | P2 |
| Deep-link commande → Magazijn | DONE | `order.html` génère `entrepot.html?id=…`; `entrepot.html` cible, fait défiler et ouvre l'édition de préparation. | P2 |
| Livraison confirmée dans le flux | DONE | `entrepot.html` appelle `famoStaff.openDeliveryConfirm`; la modale est implémentée dans `staff-delivery.js`. | P2 |
| Facture seulement si numéro existant dans Magazijn | DONE | Le bouton facture de `entrepot.html` est conditionné par `o.factuurnummer`. | P2 |
| Couleur de statut réelle dans le détail | DONE | `order.html` applique une carte de couleurs au statut réel. | P3 |
| Historique / correction stock / seuil | DONE | `api/stock.js` expose `history=1`, filtre produit, journalise uniquement une quantité modifiée et traite une quantité absolue; `stock.html` les consomme. | P2 |
| Créditnote clairement non comptabilisée | DONE | `documents.js` affiche « CREDITNOTA (VOORBEELD) » et « Voorbeeld — niet geboekt ». | P2 |
| Session client, contacts config, date et panier | DONE | `index.html` restaure la session client, charge `/api/config?public=1`, interdit dimanche/date passée et propose « Wissen » dans le panier. | P2 |
| Clients, tarifs et produits administrables | DONE | `aan-de-slag.html` et `api/onboarding.js` portent modification client, suppression prix et désactivation produit. | P2 |
| Bannière de configuration et catégories NL | DONE | `staff-nav.js` contrôle catalogue/client; `aan-de-slag.html` contient les catégories néerlandaises. | P3 |
| Pas de `alert`, `confirm` ou `prompt` natif | DONE | Recherche statique hors dépendances : aucune invocation native dans les pages/API applicatives. | P2 |
| Pas de code staff conservé dans le navigateur | PARTIAL | Aucun `famoStaffCode` trouvé dans le stockage, mais les API continuent d'accepter un code passé par URL/corps : la confidentialité n'est pas garantie de bout en bout. | P0 |
| `allorders` cookie-only / suppression de l'ancien code | **REGRESSION** | `lib/staffauth.js:staffOk(req, legacyCode)` valide encore un code hérité. `api/allorders.js`, `api/stock.js`, `api/onboarding.js`, `api/staff.js`, `api/config.js` et `api/updateorder.js` lui transmettent encore `query.code` ou `body.code`. | **P0** |
| Staff correctement configuré sans secret | **REGRESSION** | `lib/staffauth.js` définit `const CODE = process.env.STAFF_CODE || "famo2026"`; une absence d'environnement active donc un secret public connu et `hasCode()` répond vrai. | **P0** |
| Bloc IBAN/BIC sur toute facture | PARTIAL | `entrepot.html` bloque bien l'impression. Mais `documenten.html` appelle directement `FamoDocuments.build(order,type)` et `documents.js` construit une facture avec « Bankgegevens nog niet ingevuld » au lieu de bloquer. | P1 |
| Données publiques sans IBAN/BIC | DONE | `api/config.js?public=1` ne renvoie pas les champs bancaires. | P2 |
| APIs mortes signalées | PARTIAL | `api/onboarding.js` contient encore `saveStock` et `previewCredentials`; aucune page applicative ne les appelle (seul le script de contrôle mentionne l'aperçu). | P3 |

## Top régressions / affirmations trompeuses

1. **Secret staff par défaut actif** — l'absence de `STAFF_CODE` ne ferme pas l'accès : elle active `famo2026` dans `lib/staffauth.js`.
2. **« Cookie-only » faux** — une requête avec `?code=…` ou un `body.code` reste autorisable dans les endpoints staff listés ci-dessus; le secret peut donc encore finir dans URL, logs ou historique.
3. **Contrôles faussement verts** — `workflow-check.js` célèbre explicitement « Fallback temporaire famo2026 (env absente) » alors que cela invalide la garde de configuration.
4. **Facture incohérente entre deux écrans** — Magazijn bloque sans IBAN/BIC; Documents permet encore aperçu et impression.
5. **Identité documentaire de secours inventée** — `documents.js` conserve des valeurs Famo/TVA/adresse statiques si la configuration n'est pas chargée, au lieu de signaler une configuration incomplète.
6. **Deux moteurs de document** — `entrepot.html` génère son document séparément de `documents.js`; les règles BL/facture peuvent diverger à nouveau.
7. **Protection anti-abus incomplète** — `/api/catalogue` et `/api/order` limitent certains flux, mais `api/orders.js` accepte les tentatives d'authentification client sans limite équivalente.
8. **API orpheline** — `saveStock` et `previewCredentials` restent dans `api/onboarding.js` sans chemin produit, ce qui augmente la surface à maintenir sans bénéfice visible.
9. **Libellé BL ambigu** — `documents.js` affiche « Besteld / geleverd » alors qu'une seule quantité est rendue dans cette ligne; cela n'exprime pas clairement commandé versus réellement préparé.

## Faux verts de `check.js` / `workflow-check.js`

- `scripts/check.js:63-76` autorise explicitement le fallback `famo2026` dans `lib/staffauth.js` et ne cherche le fallback que dans `api/`; il ne teste donc pas l'échec fermé en absence de variable d'environnement.
- `scripts/workflow-check.js` imprime même `✓ A. Fallback temporaire famo2026 (env absente)`. Ce n'est pas une validation de sécurité, c'est la confirmation de la régression P0.
- Le contrôle « allorders cookie-only » est structurel : il ne vérifie pas qu'une requête portant `?code=` reçoit bien `401`. Le comportement réel reste compatible avec le code hérité.
- Le contrôle Documents cherche `setCompany` et une chaîne liée à l'IBAN, mais n'exerce pas le cas négatif « config sans IBAN/BIC → aucun aperçu/impression de facture ».
- Les recherches HTML de code secret / dialogues natifs ne couvrent pas la propagation de `query.code` et `body.code` dans les handlers API.

## Go / No-go

**NO-GO pour merger la PR #7 telle quelle.** Les améliorations UI peuvent être conservées, mais les deux P0 d'authentification et le blocage de facture divergent selon la route. Une livraison peut donner l'impression que la configuration est correcte alors qu'elle fonctionne avec un secret connu ou imprime une facture incomplète.

## P0 à faire corriger par Cursor

- `lib/staffauth.js` — supprimer le fallback `"famo2026"`; sans `STAFF_CODE`, `hasCode()` doit être faux et toute authentification staff doit échouer fermée avec un message de configuration.
- `api/allorders.js`, `api/stock.js`, `api/onboarding.js`, `api/staff.js`, `api/config.js`, `api/updateorder.js` — retirer tout passage de `query.code` / `body.code` à `staffOk`; seules les sessions cookie doivent autoriser ces endpoints (le seul code acceptable est le POST de connexion de `/api/session`).
- `scripts/check.js` et `scripts/workflow-check.js` — remplacer l'exception/faux succès fallback par des tests négatifs : absence de `STAFF_CODE` fermée et appels protégés avec `?code=famo2026` refusés `401`.
- `documenten.html`, `documents.js` et `entrepot.html` — centraliser la règle de facture : sans IBAN **et** BIC configurés, aucun aperçu ni impression de facture, quel que soit l'écran; ne jamais injecter identité, TVA, adresse ou coordonnées bancaires de secours dans un document réel.
- `documents.js` / `entrepot.html` — utiliser un seul builder et un seul modèle de données documentaires afin que les règles BL (sans prix, commandé/réel) et facture ne divergent plus.
