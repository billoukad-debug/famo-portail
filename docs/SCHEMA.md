# Schéma des données — FAMO Portail

État au 27/09/2026, établi depuis le code (`grep` des noms de champs dans `api/`, `lib/`, `assets/`) et depuis `scripts/fake-airtable.js` (copie du schéma de l'ancienne base Airtable, utilisée par le banc local et les tests). **Le code fait foi** : un champ ajouté dans le code doit l'être aussi dans `scripts/fake-airtable.js` et ici.

## Où vivent les données

| Environnement | Stockage | Comment |
|---|---|---|
| Production | **Postgres (Neon)**, `DB_BACKEND=postgres` | Deux tables SQL (ci-dessous) ; chaque « table » métier est une valeur de la colonne `tbl`. |
| Local / tests | SQLite intégré à Node (`DB_BACKEND=sqlite`) ou faux Airtable (`node scripts/dev.js`) | Même schéma logique. |
| Historique | Airtable (base `appcdduLth9iGX8I0`) | Plus utilisé en production ; lu seulement par la copie/comparaison de Systeemstatus (`api/dbadmin.js`). |

Le code métier parle toujours le protocole REST d'Airtable (`lib/airtable.js`) ; `lib/datastore.js` envoie ces requêtes à `lib/at-engine.js`, qui les rejoue sur SQL (voir `docs/adr/0002-airtable-puis-neon.md`).

### Tables SQL (`lib/at-engine.js`, `SCHEMA_SQL`)

| Table | Colonnes | Rôle |
|---|---|---|
| `famo_records` | `id` TEXT PK (`rec…`), `tbl` TEXT (nom de la table métier), `created_time` TEXT ISO, `fields` TEXT (JSON des champs), `version` INTEGER | Tous les enregistrements. `version` sert à la concurrence optimiste : deux PATCH simultanés ne s'écrasent pas (relecture + nouvel essai). Index sur `tbl`. |
| `famo_files` | `id` TEXT PK (`att…`), `record_id`, `content_type`, `filename`, `size`, `data` (base64), `created_time` | Photos produit envoyées depuis Beheer, servies par `/api/foto?id=att…` (cache 1 an). |

Règles du moteur (comme Airtable) : une valeur vide (`""`, `null`, `false`, `[]`) **efface** le champ ; 10 enregistrements au plus par écriture groupée ; `filterByFormula`, `sort`, `fields[]`, `maxRecords`, `offset` pris en charge (`lib/at-formula.js`).

## Tables métier

Types : texte, nombre, case (booléen), date (`AAAA-MM-JJ`), date-heure (ISO UTC), liste (valeurs fixes), lien (liste d'ids `rec…`), pièces jointes (`[{url, filename}]`).
« Écrit par » / « Lu par » : fichiers `api/*.js` et `lib/*.js` (sans extension). Les pages du navigateur ne lisent jamais la base directement : elles passent par ces API.

### `Clients` — comptes clients (restaurants)

| Champ | Type | Écrit par | Lu par | Remarque |
|---|---|---|---|---|
| `Nom` | texte | onboarding (saveClient) | allorders, catalogue, klantdoc, staff, ordermail | Champ principal. |
| `Email` | texte | onboarding, klantorder (profil) | allorders, catalogue, staff, ordermail | Sans e-mail : aucun envoi au client. |
| `Téléphone` | texte | onboarding, klantorder (profil) | allorders, catalogue, staff | |
| `Lieu de livraison` | texte multiligne | onboarding | allorders, catalogue, klantdoc, staff | Adresse de livraison. |
| `Gebruikersnaam` | texte | onboarding | catalogue (connexion), klantorder, ordermail | Identifiant de connexion, unique (comparé en minuscules). |
| `Wachtwoord` | texte | onboarding (création, resetPassword, revokeAccess = vide), klantwachtwoord, klantorder (mot de passe oublié), catalogue (migration clair → empreinte) | clientauth | **Empreinte scrypt** `scrypt$<sel>$<empreinte>` ; un ancien texte clair est migré à la connexion. Vide = accès bloqué. |
| `BTW-nummer` | texte | onboarding | allorders, catalogue, klantdoc | N° TVA du client. |
| `Klantnummer` | texte | onboarding | allorders, catalogue, klantdoc | |
| `Gearchiveerd` | case | onboarding | allorders, catalogue, klantorder, staff | Vrai = plus de connexion ni de présence dans les listes. |
| `Favorieten` | texte (JSON) | klantorder | catalogue | `{favorieten:[ids produit], standaard:{id: qté}}`. |
| `Taal` | liste `NL` / `FR` | onboarding, (via aanvraag) | allorders, catalogue, klantdoc | Langue du portail et des documents ; NL par défaut. |
| `Voorwaarden versie`, `Voorwaarden aanvaard op` | texte, date-heure | klantorder (acceptTerms) | order, catalogue, onboarding (compteur Beheer) | Version des conditions générales acceptée et quand ; aussi dans le Journaal (« Voorwaarden aanvaard »). |
| `Facturatieadres` | texte multiligne | onboarding (saveClient) | onboarding, export UBL | Siège (facture, UBL) si différent du lieu de livraison ; vide = lieu de livraison. |
| `Régime TVA` | liste `Normal` / `Intracommunautaire` / `Export` / `Cocontractant` | onboarding (saveClient) | updateorder (facturation), allorders, klantdoc, orders, export UBL, onboarding | C-10. **Absent = `Normal`** (taux par produit). Les trois autres : 0 % sur toute la facture + mention légale (`assets/vat.js`) ; catégorie UBL K / G / AE. Intracommunautaire exige un n° TVA d'un autre État membre, Cocontractant un n° belge valide (400 sinon). Pas une donnée personnelle. |
| `VIES gecontroleerd op`, `VIES resultaat` | date-heure, texte (JSON `{valid, name, address, vatNumber}`) | onboarding (checkVies) | onboarding (fiche Beheer) | C-16 : dernier contrôle VIES du n° TVA **enregistré** (lib/vies.js). Effacés par saveClient si le n° change. Peut contenir le nom d'une entreprise individuelle : inclus dans l'export RGPD, conservé à l'anonymisation (justificatif de l'exonération, comme nom, n° TVA et adresses). |
| `Articles habituels`, `Infos générales` | texte | — | — | Hérités d'Airtable, non utilisés par le code (données de démo seulement). |
| `Commandes`, `Prix négociés` | lien inverse | Airtable | — | Liens inverses Airtable, non utilisés par le code. |

### `Catalogue` — produits

| Champ | Type | Écrit par | Lu par | Remarque |
|---|---|---|---|---|
| `Produit` | texte | onboarding (saveProduct, renommage) | allorders, catalogue, order, staff, prices, stock | Nom ; **clé de jointure** avec `Stock.Produit` et les lignes de commande (par nom normalisé). |
| `Prix de base` | nombre (€ HTVA) | onboarding | catalogue, staff, prices | |
| `Unité` | liste `kg` / `pièce` / `caisse` / `carton` | onboarding | catalogue, order, staff, updateorder | Valeur FR stockée, affichée en NL (`kg`, `stuk`, `kassa`, `doos`). |
| `Catégorie` | texte | onboarding | catalogue, staff | |
| `Actif` | case | onboarding | catalogue, config, order, staff, stock | Inactif = absent du catalogue client. |
| `Kaliber` | texte | onboarding | catalogue, staff | |
| `Omschrijving` | texte | onboarding | catalogue | |
| `Foto` | pièces jointes | onboarding (upload) | catalogue, foto | En production : fichier dans `famo_files`. |
| `BTW-tarief` | nombre (%) | onboarding | allorders, config, klantdoc | Vide = taux de Configuratie. |
| `Volgorde` | nombre | onboarding (reorderProducts) | catalogue, staff | Ordre d'affichage. |
| `Stock`, `Prix négociés` | lien inverse | Airtable | — | Non utilisés. |

### `Commandes` — commandes

| Champ | Type | Écrit par | Lu par | Remarque |
|---|---|---|---|---|
| `Référence` | texte | order, staff | allorders, klantdoc, klantorder, orders, updateorder, ordernumber | `CMD-AAAA-NNNN` (max + 1, non atomique : voir `lib/ordernumber.js`). |
| `Date` | date | order, staff | allorders, klantdoc, orders | Date de la commande. |
| `Lignes (produits / quantités)` | texte multiligne | order, staff, updateorder, onboarding (renommage produit) | allorders, klantdoc, klantorder, orders | Une ligne : `Nom × qté unité [€prix]` ; prix figé par le serveur. |
| `Statut` | liste `Reçue` / `Prête` / `Sortie en livraison` / `Facturée` / `Annulée` | order, staff, updateorder, klantorder | allorders, klantdoc, onboarding, orders | Affiché : Ontvangen / Klaar / Onderweg / Geleverd / Geannuleerd. |
| `Statut paiement` | liste `En attente` / `Payé` | order, staff, updateorder | allorders, klantdoc, orders | Openstaand / Betaald. |
| `Total` | nombre (€ HTVA) | order, staff, updateorder | allorders, dbadmin, klantdoc, klantorder, orders | Recalculé par le serveur. |
| `Notes` | texte | order, staff, updateorder | allorders, klantdoc, orders | |
| `Client` | lien → Clients | order, staff | allorders, klantdoc, klantorder, orders, updateorder | |
| `Date livraison souhaitée` | date | order, staff, updateorder | allorders, klantdoc, klantorder, orders | Contrôlée par `lib/levering.js`. |
| `Préparation validée`, `Préparée le` | case, date-heure | updateorder | allorders | Validation article par article. |
| `Stock afgeboekt` | case | updateorder | allorders | Stock déduit au départ (une seule fois). |
| `Livrée le`, `Livraison confirmée`, `Réceptionné par` | date-heure, case, texte | updateorder | allorders, klantdoc, orders | Réception. |
| `Preuve de livraison` | pièces jointes | updateorder (lien https), bewijs (signature PNG `handtekening-…`, photo JPEG `foto-…`, H-09) | allorders, klantdoc (`getekend`), order.html | Ajoutées après la confirmation, jamais remplacées ; servies par /api/foto au personnel seulement (privé, sans cache). |
| `Factuurnummer`, `Facturée le` | texte, date-heure | updateorder | allorders, klantdoc, orders, ordermail | `FA-AAAA-NNNN`, **numéro interne du portail** (pas la facture légale : `docs/adr/0005-facturation-legale.md`). Dédoublonné par `ensureUnique`. |
| `Payé le`, `Mode de paiement` | date-heure, liste `Contant` / `Overschrijving` / `Bancontact` / `Andere` | updateorder | allorders, orders | |
| `Uitzondering levering`, `Uitzondering nota` | liste `Afwezig` / `Geweigerd` / `Gedeeltelijk` / `Beschadigd`, texte | updateorder | allorders, orders | Exception à la réception. |
| `Volgorde levering` | nombre 1..999 | updateorder | allorders | Ordre de tournée. |
| `Leverslot` | texte `HH:MM-HH:MM` | updateorder (personnel, avant livraison) | allorders, orders | Heure de livraison prévue (D4), normalisée par `lib/levering.parseSlot` ; montrée au client (« tussen … en … » / « entre … et … ») jusqu'à la livraison. Pas une donnée personnelle ; dans l'export RGPD avec la commande. |
| `Annulée le`, `Motif annulation` | date-heure, texte | updateorder, klantorder | allorders, orders | |
| `Correcties` | texte multiligne | updateorder, klantorder | allorders | Journal : `date · action · acteur — raison` (Beheer → Journaal). |
| `Creditnota nummer`, `Creditnota lignes`, `Creditnota montant`, `Creditnota le`, `Creditnota motif` | texte, texte, nombre, date-heure, texte | updateorder | allorders, orders, klantdoc, export, margin, reminders (via `lib/creditnota.js`) | `CN-AAAA-NNNN` interne : la **première** note de crédit de la commande, écrite une fois et jamais réécrite (sauf renumérotation d'un doublon sur Airtable). Les commandes d'avant C-08 n'ont que ces champs. |
| `Creditnotas` | texte (JSON) | updateorder (makeCreditnota) | via `lib/creditnota.js` : allorders, orders, klantdoc, export, margin, reminders, correctie | Plusieurs notes de crédit par facture (C-08) : liste **complète** `[{nummer, lignes, montant, le, motif, retour, sleutel?}]` dans l'ordre d'émission (la première = champs `Creditnota …`). Absente = seule la note historique (ou aucune). Plafond : toutes notes ensemble ≤ facturé, par article et par taux de TVA. `sleutel` = clé d'idempotence du navigateur (double clic sans deuxième note ni deuxième retour en stock). |
| `Correctiemail` | texte (JSON) | updateorder (correctieMail) | allorders, lib/correctie.js | Dernier e-mail de correction envoyé au client (L-08) : `{le, lignes, cn:[numéros], sleutel}` = état envoyé. Réservé avant l'envoi, libéré si l'envoi échoue ; même état = pas de deuxième e-mail. Sans données personnelles (l'adresse n'y est pas). |
| `BTW per lijn` | texte (JSON) | updateorder (passage en Facturée) | allorders, klantdoc, export UBL | Taux de TVA figés par ligne : un changement de catalogue ne réécrit pas une facture émise. À 0 pour un régime autre que Normal. |
| `Régime TVA` | liste (comme `Clients.Régime TVA`) | updateorder (passage en Facturée) | allorders, klantdoc, orders, export UBL (`lib/billing.regimeOf`) | C-10 : régime du client **figé** sur la facture (absent = Normal, y compris les factures d'avant) ; un changement du client ne touche ni la facture ni sa note de crédit. |
| `Idempotentie` | texte | order | order | Clé envoyée par le panier : un renvoi réseau ne crée pas de doublon. |
| `Lots` | texte (JSON) | updateorder (Klaarzetten) | allorders, klantdoc, lots?trace | Instantané du/des lot(s) livrés par article (traçabilité 178/2002 art. 18). |
| `Lignes besteld` | texte | order, staff (création) | allorders, klantdoc | Lignes commandées ; les documents montrent « besteld X » si le poids livré diffère. |
| `Besteld door` | texte | order (utilisateur supplémentaire) | allorders, order.html | Nom de la personne qui a passé la commande (H-08) ; vide = identifiant principal du client. Anonymisé avec le client. |
| `Herinnering 1 op`, `Herinnering 2 op` | date-heure | reminders-cron (lib/reminders.js) | allorders, order.html | Relances de paiement envoyées (mode Portaal) : échéance + 3 j et + 17 j ; réservé avant l'envoi, libéré si l'envoi échoue. |
| `Photo préparation` | pièces jointes | — | — | Hérité, non utilisé. |

### `Stock` — stock par produit

| Champ | Type | Écrit par | Lu par | Remarque |
|---|---|---|---|---|
| `Produit` | texte | onboarding (saveStock, renommage), stock, updateorder | allorders, catalogue, stock, updateorder | Même nom que `Catalogue.Produit` (sinon ligne « niet in catalogus »). |
| `Quantité disponible` | nombre (3 décimales) | onboarding (saveStock), stock (correction), updateorder (départ, retour) | catalogue, stock, updateorder | |
| `Seuil bas` | nombre | onboarding, stock | stock, onboarding | Pastille Voorraad. |
| `Produit lié` | lien | — | — | Hérité, non utilisé. |

### `Mouvements de stock` — journal du stock (écrit, jamais modifié)

| Champ | Type | Écrit par | Lu par |
|---|---|---|---|
| `Mouvement` | texte (libellé) | stock, updateorder, onboarding | — |
| `Date et heure` | date-heure | stock, updateorder, onboarding | stock (historique) |
| `Type` | liste `Sortie livraison` / `Correction inventaire` / `Entrée stock` / `Retour client` / `Annulation sortie` | stock, updateorder, onboarding | stock |
| `Produit`, `Quantité` (signée), `Stock avant`, `Stock après` | texte, nombres | stock, updateorder, onboarding | stock |
| `Référence commande` | texte | updateorder | — |
| `Note` | texte | stock, onboarding | stock |

### `Prix négociés` — prix par client et produit

| Champ | Type | Écrit par | Lu par | Remarque |
|---|---|---|---|---|
| `Client` | lien → Clients | onboarding (savePrice, saveClientPrices) | prices, catalogue, order, staff | |
| `Produit` | lien → Catalogue | onboarding | prices, catalogue, order, staff | Un seul accord permanent par couple client/produit ; plus les prix de période éventuels. |
| `Prix négocié` | nombre (€ HTVA) | onboarding | prices | Vide = prix de base ; 0 = gratuit (0 est une vraie valeur). |
| `Geldig van`, `Geldig tot` | date (inclus) | onboarding (savePrice) | prices | Vides = prix permanent. Remplis = prix de période (action, prix de la semaine), prioritaire sur le permanent pendant la période ; chevauchement → « van » le plus récent. |
| `Libellé` | texte | — | — | Champ principal hérité, non utilisé. |

### `Configuratie` — une seule ligne : identité et règles

| Champ | Type | Écrit par | Lu par | Remarque |
|---|---|---|---|---|
| `Bedrijfsnaam`, `Adres`, `Postcode en plaats`, `BTW-nummer`, `Telefoon`, `E-mail` | texte | onboarding (saveConfig) | config, catalogue, klantdoc, ordermail | Bloc public (`/api/config?public=1`). |
| `IBAN`, `BIC` | texte | onboarding | config (personnel et beheerder), catalogue (relevé client), klantdoc, ordermail | **Jamais** dans la réponse publique. |
| `BTW-tarief` | nombre (%) | onboarding | allorders, config, klantdoc | Taux par défaut (6 si vide). |
| `Betalingsvoorwaarden`, `Leveringsvoorwaarden` | texte | onboarding | config, klantdoc | |
| `Bestellingen e-mail` | texte | onboarding | config (beheerder seul), ordermail | Boîte interne « Interne postbus ». |
| `Beheerderscode hash`, `Personeelscode hash` | texte | onboarding (saveCode) | session | Empreinte scrypt ; remplace `ADMIN_CODE` / `STAFF_CODE` ; vide = code de l'environnement. Jamais renvoyée. |
| `Enkel persoonlijke PIN` | case | onboarding (saveEnkelPin, Beheer → Toegang) | session, onboarding (garde « dernière beheerder ») | Audit L-06. Cochée : codes partagés (`STAFF_CODE`, codes enregistrés) refusés à la connexion, seuls les PIN `Medewerkers` ouvrent ; `ADMIN_CODE` reste un accès de secours (page Beheer, rôle beheerder, nom « Noodtoegang », journalisé) tant qu'aucun `Beheerderscode hash` ne le remplace. Activation refusée (409) sans `Medewerkers` beheerder active avec PIN ; l'activation augmente `Sessiegeneratie`. Absente = décochée. |
| `Besteldeadline` (HH:MM), `Leverdagen` (`ma,di,…`), `Gesloten dagen` (dates ISO, une par ligne), `Minimum bestelling` (€), `Betaaltermijn dagen`, `Voorraad afboeken` (case) | texte / nombre / case | onboarding | levering | Règles de commande, de livraison et de stock. |
| `Voorwaarden NL`, `Voorwaarden FR`, `Voorwaarden versie` | texte, texte, texte (`AAAA-MM-JJ HH:MM:SS`) | onboarding (saveVoorwaarden ; « Publiceren » change la version) | config (?voorwaarden=1 public, version dans le bloc contact), catalogue, order, signup, klantorder, documents | Conditions générales (C-12, lib/terms.js). Version vide = rien à accepter ; version publiée = chaque client l'accepte avant sa commande suivante (order : 409 `needTerms`). |
| `Herinneringen aan`, `Lots verplicht` | case, case | onboarding (saveConfig, Beheer → Bedrijf) | reminders-cron ; updateorder | Relances de paiement automatiques (Portaal seulement) ; lot obligatoire avant « Klaar ». |

### `Lots` — lots reçus (traçabilité, marge)

| Champ | Type | Écrit par | Lu par | Remarque |
|---|---|---|---|---|
| `Lotnummer`, `Produit`, `Leverancier`, `Ontvangen op` | texte, texte, texte, date | lots (POST) | lots, updateorder (Klaarzetten), margin | Un pas en amont (règl. 178/2002 art. 18). `Produit` = nom du catalogue. |
| `Wetenschappelijke naam`, `Vangstgebied`, `Vistuig`, `Productiemethode`, `Ontdooid`, `THT` | texte, texte, texte, liste, case, date | lots | bon de livraison (instantané) | Mentions du règl. 1379/2013 art. 35. |
| `Hoeveelheid`, `Actief`, `Nota` | nombre, case, texte | lots | lots | Inactif = plus proposé à la préparation. |
| `Aankoopprijs` | nombre (€ HTVA par unité) | lots (beheerder seul) | marge (beheerder seul) | Jamais dans l'instantané copié dans la commande : ni le personnel ni le client ne le voient (H-05). |

### `Klantgebruikers` — utilisateurs supplémentaires d'un client (H-08)

| Champ | Type | Écrit par | Lu par | Remarque |
|---|---|---|---|---|
| `Client` | lien → Clients | onboarding (saveKlantgebruiker) | lib/klantlogin.js | Commandes, prix, favoris et documents sont ceux de ce client. |
| `Naam`, `Email` | texte | onboarding | order (« Besteld door »), mots de passe oubliés | L'e-mail reçoit le lien d'activation / de réinitialisation. |
| `Gebruikersnaam` | texte | onboarding | catalogue (connexion) | Unique sur Clients ET Klantgebruikers. |
| `Wachtwoord` | texte (scrypt) | onboarding (création, reset), klantwachtwoord | catalogue | Jamais en clair ; montré une seule fois dans Beheer à la création. |
| `Actief` | case | onboarding | lib/klantlogin.js | Décochée = champ absent = pas de connexion ; désactiver déconnecte partout. |
| `Sessiegeneratie`, `Echecs`, `Geblokkeerd tot` | nombre, nombre, date-heure | klantwachtwoord (logout), catalogue (verrou) | catalogue | Comme sur Clients, mais propres à cet utilisateur. |

### `Aanvragen` — demandes d'accès publiques

| Champ | Type | Écrit par | Lu par |
|---|---|---|---|
| `Bedrijfsnaam`, `Contactpersoon`, `Email`, `Telefoon`, `Adres`, `Notities` | texte | signup | onboarding, ordermail |
| `Status` | liste `Nieuw` / `Verwerkt` | signup (`Nieuw`), onboarding (closeAanvraag) | onboarding |
| `Taal` | liste `NL` / `FR` | signup | onboarding |
| `Voorwaarden versie` | texte | signup | onboarding | Version des conditions générales cochée sur le formulaire (preuve). |

### `Medewerkers` — comptes individuels du personnel

| Champ | Type | Écrit par | Lu par | Remarque |
|---|---|---|---|---|
| `Naam` | texte | onboarding | session | Prénom affiché et journalisé. |
| `Rol` | liste `personeel` / `beheerder` | onboarding | session | |
| `PIN hash` | texte | onboarding | session | Empreinte scrypt du PIN (≥ 4 chiffres). |
| `Actief` | case | onboarding | session | |
| `Laatste aanmelding` | date-heure | session | onboarding | |

### `Cadrage projet`

Table historique d'un questionnaire fermé (`/api/cadrage` répond 410). Aucune lecture ni écriture.

## Glossaire FR / NL / écran

Les noms de champs et les valeurs stockées mêlent le français (base d'origine) et le néerlandais (ajouts ultérieurs). **Ne jamais renommer un champ** sans migrer les données et le code : le nom exact est la clé.

| Stocké (base) | Langue | À l'écran (NL) | Sens |
|---|---|---|---|
| `Actif` (Catalogue) | FR | Actief | Produit visible au catalogue. **Ne pas confondre** avec `Actief` (Medewerkers, NL) : même sens, deux orthographes, deux tables. |
| `Actief` (Medewerkers) | NL | Actief | Compte du personnel utilisable. |
| `Gearchiveerd` (Clients) | NL | Gearchiveerd | Client archivé (plus de connexion). |
| `Reçue` / `Prête` / `Sortie en livraison` / `Facturée` / `Annulée` | FR | Ontvangen / Klaar / Onderweg / Geleverd / Geannuleerd (`famoNL.status`) | Statut de commande. `Facturée` s'affiche « Geleverd » (livrée et document émis). |
| `En attente` / `Payé` | FR | Openstaand / Betaald | Statut de paiement. |
| `caisse` / `carton` / `pièce` / `kg` | FR | kassa / doos / stuk / kg | Unité (`K.unit`, `famoNL.unit`). |
| `Factuurnummer` | NL | Factuur | Numéro interne `FA-…` du document du portail. |
| `Creditnota nummer` / `montant` / `motif` / `lignes` / `le` | NL + FR | Creditnota : nummer / bedrag / reden / lijnen / datum | Série hybride : préfixe NL, suffixe FR. `montant` = bedrag (€ HTVA), `motif` = reden, `lignes` = lijnen, `le` = datum. Première note seulement. |
| `Creditnotas` | NL | Creditnota's | Toutes les notes de crédit de la commande (JSON), clés `nummer` / `lignes` / `montant` / `le` / `motif` / `retour` (retour en stock). |
| `Correctiemail` | NL | Correctie mailen | Dernier e-mail de correction envoyé au client. |
| `Correcties` | NL | Journaal | Journal des corrections d'une commande. |
| `Uitzondering levering` / `nota` | NL | Uitzondering | Exception à la réception. |
| `Volgorde` (Catalogue) / `Volgorde levering` (Commandes) | NL | Volgorde | Ordre d'affichage / ordre de tournée. |
| `Leverslot` (Commandes) | NL | Leveruur · client : Verwacht leveruur / Heure de livraison prévue | Créneau `HH:MM-HH:MM` posé par le personnel. |
| `Voorraad afboeken` (Configuratie) | NL | Voorraad automatisch afboeken | Déduire le stock au départ. |
| `Stock afgeboekt` (Commandes) | NL | — | Stock déjà déduit pour cette commande. |
| `Prix négocié` | FR | Uw prijs / Prijs | Prix propre au client. |
| `Lieu de livraison` | FR | Leveradres | Adresse de livraison. |
| `Mouvements de stock` : `Sortie livraison` / `Annulation sortie` / `Retour client` / `Correction inventaire` / `Entrée stock` | FR | Vertrek levering / Vertrek ongedaan / Klantretour / Voorraadcorrectie / Voorraadontvangst (`famoNL.move`) | Type de mouvement. |
| `Leverdagen` : `ma,di,wo,do,vr,za,zo` | NL | ma … zo | Jours livrés. |
| `Taal` : `NL` / `FR` | — | NL / FR | Langue du client. |
| `Régime TVA` : `Normal` / `Intracommunautaire` / `Export` / `Cocontractant` | FR | Normaal / Intracommunautair / Uitvoer / Medecontractant (`FamoVat.regime(v).short`) | Régime de TVA du client, figé sur la facture. |

Identifiants du code (JSON des API) : mélange FR/NL/EN (`dateLivraison`, `voorraadAfboeken`, `movementType`) ; suivre le nom déjà utilisé par l'endpoint plutôt que d'en inventer un.
