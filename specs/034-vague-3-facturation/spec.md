# Feature Specification: Vague 3 « facturation et paiement » (export boekhouder, statut d'envoi, QR de virement)

**Créée** : 2026-10-24 · **Statut** : implémentée sur la branche `vague-3-facturation`, non déployée (attend la
validation du gérant puis le « go » du prestataire) · **Source** : plan « famoseafood.be parfait », vague 3 (lots 3.1 à 3.4).

## Ce qui ne dépend PAS de la réponse du comptable (fait ici)
L'envoi Peppol réel dépend d'une réponse du comptable de Famo : Billtobox importe-t-il l'UBL du portail, ou faut-il
un point d'accès Peppol direct ? **Aucun envoi n'est branché** : ni Peppol, ni e-mail au comptable. Le portail prépare,
le beheerder bezorgt et note.

## Exigences
- **FR-001 Export boekhouder par période** — page `/beheer/boekhouder` (onglet « Boekhouder » de Beheer, lien depuis
  Documenten et retour vers Beheer / Documenten), beheerder seul. Période (van / tot, raccourcis vorige maand, deze maand,
  vorig kwartaal, dit jaar ; dans l'URL ; 400 jours au plus). Liste des factures et notes de crédit de la période :
  numéro, type, klant (+ btw), date, bedrag incl. btw, betaald / openstaand, statut d'envoi, bouton UBL. Totaux.
  Documents dont l'UBL est incomplet signalés en clair (liste des manques, `ubl.problems`) et sans bouton UBL.
  « CSV downloaden » et « Alle UBL ». Données : `GET /api/export?format=lijst|csv&van=&tot=` (`lib/boekhouder.js`) ;
  UBL : route existante `/api/export?format=ubl`.
  - Date : facture = « Facturée le » (jour de Bruxelles, sinon « Livrée le ») ; note de crédit = sa propre date.
  - Montants = ceux de l'UBL (`lib/ubl.js`, règle `assets/vat.js`, taux figés), note de crédit en négatif.
  - Exclus : commandes test (`lib/testorders.js`), commandes non facturées ou sans numéro FA.
  - CSV : UTF-8 + BOM, `;`, décimale `,`, une ligne par document puis une ligne « Totaal » ; colonnes
    `Type;Nummer;Datum;Oorspronkelijke factuur;Klant;BTW-nummer klant;Bestelling;Totaal excl. btw;Btw;Totaal incl. btw;Betaald;Betaald op;Naar boekhouder op;Peppol;Peppol op;UBL volledig` ;
    une cellule commençant par `=`, `+`, `-`, `@` (hors nombre) est neutralisée (même règle que la Rapportage).
  - Accès : 401 sans session, 403 pour le personnel. **Changement** : la route UBL existante répondait 401 au personnel,
    elle répond désormais 403 (même garde pour toute la route ; `test/ubl.test.js` adapté).
- **FR-002 Statut d'envoi au comptable / Peppol** — par document (facture ET chaque note de crédit), champ
  `Commandes.Verzending` (JSON `{ "FA-…": { boekhouder: {op, door, bron}, peppol: {status, op, reden, bron, id, door} } }`,
  `lib/verzending.js`). Rempli à la main par le beheerder : `POST /api/updateorder { id, verzending: { nummer,
  boekhouder: "JJJJ-MM-DD" | null, peppol: { status: Verstuurd | Aanvaard | Geweigerd, op, reden } | null, reden? } }`.
  - Refus : personnel 403 ; commande non facturée 409 ; numéro qui n'est pas un document de la commande 400 ; date
    invalide, future ou antérieure au document 400 ; « Geweigerd » sans raison 400 ; rien de changé 400.
  - Journal : une ligne `Correcties` par changement (« Naar boekhouder: FA-… op 21/09/2026 », « Peppol FA-…: geweigerd
    op … (raison) », « … gewist ») + le journal d'audit (« Verzending boekhouder/Peppol », avant → après).
  - Visible : fiche commande (carte « Boekhouder en Peppol », bouton « Aanpassen » pour le beheerder), Bestellingen
    (tag « Bij boekhouder », « Peppol verstuurd », « Peppol geweigerd » en rouge), page Export boekhouder (bouton
    « Gestuurd vandaag » pour noter en une fois les documents de la période pas encore notés).
  - **Envoi automatique futur** : `apply()` accepte `bron: "automatisch"` et l'identifiant du message (`id`) ; depuis
    le navigateur, `bron` est toujours « hand » et `id` ignoré. Le champ et le journal servent tels quels.
  - Garde ajoutée : une facture notée « naar boekhouder » ou Peppol ne peut plus être « ontvangst ongedaan maken »
    (409 : note de crédit), comme une facture payée ou créditée.
- **FR-003 QR de virement européen (EPC069-12, « SEPA QR »)** — `assets/epc.js` (navigateur et Node), bibliothèque QR
  `vendor/qrcode-generator.js` (voir « Bibliothèque »). Contenu version 002 : `BCD`, `002`, `1` (UTF-8), `SCT`, BIC,
  bénéficiaire (nom juridique + forme, sinon nom commercial, ≤ 70), IBAN, `EUR` + montant (point, 2 décimales),
  purpose vide, référence structurée = OGM `+++123/4567/89012+++` (guide Febelfin) ; sans OGM valide : communication
  libre ; rien après la dernière donnée ; ≤ 331 octets ; correction M ; zone calme 4 modules ; ≥ 2 × 2 cm (30 mm).
  - **Uniquement** facture du portail (mode « Portaal »), IBAN valide (modulo 97) et **jamais l'IBAN d'exemple**
    (`BE68 5390 0754 7034` de `assets/docs/bedrijf.js` / `scripts/seed.js`, et l'exemple de registre `BE71 0961 2345 6769`).
    Jamais sur un pro forma (mode Boekhouder), une facture payée, une facture avec note de crédit (le reste à payer
    diffère du montant de la facture), une note de crédit ou un bon de livraison.
  - Document factuur NL/FR : QR à droite du bloc « Bankgegevens », légende « Scan met uw bank-app om te betalen » /
    « Scannez avec votre app bancaire pour payer ».
  - Relevé « Openstaande facturen » du portail client : par facture, « Betalen met QR-code » (replié), montant = reste à
    payer calculé par le serveur.
- **FR-004 Portail client** — `/api/orders` donne `vervaldatum` (Facturée le à Bruxelles + Betaaltermijn dagen, règle
  de `lib/reminders.js`) et `openstaand` (facture TVAC − notes de crédit TVAC) ; jamais le statut d'envoi (interne).
  Mode **Portaal** : échéance (« vervalt op … » / « Vervallen … » en rouge) sur la ligne de commande et dans le relevé,
  « Vervaldatum » et « Nog te betalen » dans le détail, total du relevé = reste à payer, QR. Statut payé / openstaand :
  déjà visible (pastille « Geleverd · betaald / openstaand », filtre « Te betalen »), inchangé.
  Mode **Boekhouder** (actuel) : **inchangé**. Le relevé reste caché et aucune échéance n'est affichée : à la demande
  du gérant (08/10/2026, ADR 0005 « Évolution »), le portail ne montre pas de « montant à payer » pour un pro forma ;
  la facture légale, son échéance et ses coordonnées de paiement viennent du comptable (Billtobox). Montrer une
  échéance calculée par le portail pourrait contredire celle du comptable.
- **FR-005** Note « Nieuw » pour le gérant (`assets/nieuws.js`) : ce qui change et la question à poser au comptable.

## Bibliothèque QR
`vendor/qrcode-generator.js` = `dist/qrcode.js` du paquet npm officiel **qrcode-generator 2.0.4** (Kazuhiko Arase,
licence MIT), inchangé. Origine : `https://registry.npmjs.org/qrcode-generator/-/qrcode-generator-2.0.4.tgz`,
intégrité npm vérifiée `sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==`
(publié le 07/08/2025). Licence et origine : `vendor/qrcode-generator.LICENSE`. Chargé à la demande avec le module
documents (`K.docs`, version `K.DOCS_VER`), aucune dépendance npm ajoutée (constitution I, comme `vendor/html2pdf`).

## Vérification
- `test/vague3.test.js` (15 blocs) : EPC ligne par ligne, refus (IBAN invalide, d'exemple, nom, montant), mode
  Portaal seulement, matrice et SVG, document NL/FR (QR exact ; aucun en pro forma, payé, crédité, note de crédit,
  bon, IBAN d'exemple, module absent), export 401/403/400, liste et CSV exacts, statut d'envoi (refus, journal, effacer,
  allorders), garde « ontvangst ongedaan maken », envoi automatique futur, portail client (échéance, reste à payer).
- Décodage réel : le QR produit (« Famo Trading BV », UTF-8 compris) relu par OpenCV 5 `QRCodeDetector` = texte EPC
  identique (hors CI, 24/10/2026), et vérifié à l'écran sur le portail local.

## INCERTAIN
- Format exact attendu par les banques belges pour l'OGM dans la ligne 10 : le guide Febelfin (version 1.0, en vigueur
  le 01/02/2026) écrit « +++/123/1234/12345+++ » (barre après « +++ » probablement coquille) ; le portail met la forme
  usuelle `+++123/4567/89012+++`. À confirmer par un scan réel avec 2 ou 3 apps bancaires (KBC, BNP, Belfius, ING).
- Nom du bénéficiaire : nom juridique « Famo Trading BV » (vérification du nom du bénéficiaire par la banque). À
  confirmer : nom exact du titulaire du compte de Famo.
- Billtobox / point d'accès Peppol : la réponse du comptable décide la suite (lot 3.2).

## Hors périmètre
Envoi Peppol réel ou e-mail au comptable (lot 3.2, attend la réponse du comptable), statut Peppol visible par le
client, passage en mode « Portaal » (décision du gérant et du comptable).
