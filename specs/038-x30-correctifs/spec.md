# Feature Specification: correctifs x30 après le juge (connexion, session, Facturen, panier, fiche, compte)

**Créée** : 2026-10-25 · **Statut** : codée sur la branche `recette-x30` (PR brouillon #51), non déployée : attend la
validation du gérant (Mohsen) puis le « go » · **Source** : `juge-x30.md` du 25/10/2026 (moyenne 70/100, aucun écran à 85),
barème de `audit-design-x30.md` § 3.

## Pourquoi
Le juge indépendant a noté le cœur (Bestellen 83, Wijzigen 83, confirmation 80) mais tout ce qui l'entoure est resté
faible : connexion 62 (régression : formulaire à 2 656 px sur téléphone), panier 62, Facturen 54, compte 61. Cible : chaque
écran client ≥ 85 sur le même barème, **sans rien inventer** (pas de créneau, d'avis, de label, de photo, de facture légale).

## Session : ce qui change, ce qui ne change pas (sécurité)
- **La seule preuve de session reste le cookie `famo_klant`** (spec 013) : HttpOnly, Secure, SameSite=Strict, Path=/api,
  jeton signé HMAC de **12 h**, renouvelé à chaque ouverture du catalogue, jamais plus de **7 jours** après la connexion
  par mot de passe, révoqué par la déconnexion (génération) ou un changement de mot de passe (empreinte). Rien de cela ne
  change (`lib/clientauth.js` intouché).
- **Max-Age vérifié** : `setSessionCookie` pose `Max-Age = échéance du jeton − maintenant` (≤ 43 200 s). Le cookie est donc
  **persistant** : il survit à la fermeture de l'onglet et du navigateur, jusqu'à 12 h après la dernière ouverture du
  catalogue. Ce qui coupait la session à la fermeture de l'onglet, c'étaient les **données d'affichage** (`famoKlant` :
  nom d'utilisateur, id, nom et langue de la zone), rangées en `sessionStorage`.
- **Changement** : `K.klant` range ces données d'affichage en `localStorage` (repli `sessionStorage` si le stockage est
  bloqué, navigation privée). Elles ne contiennent ni jeton ni mot de passe (`K.klant.safe`), un ancien jeton de transition
  ne quitte jamais l'onglet, et elles sont **effacées à la déconnexion et à l'expiration** (`K.klant.clear` vide les deux
  stockages). Un onglet ouvert avant ce changement est repris sans nouvelle connexion.
- **Effet** : le chef qui ferme l'onglet et revient dans les 12 h arrive directement sur Bestellen (1 geste pour sa
  commande habituelle). Au-delà de 12 h sans ouvrir le portail, le serveur répond 401, l'écran efface les données
  d'affichage et renvoie sur `/?sessie=verlopen#aanmelden` : le formulaire est à l'écran, le remplissage automatique du
  navigateur fait le reste (3 gestes + 1).
- **Non fait, à décider par le gérant** : garder un client connecté d'un soir à l'autre demanderait d'allonger le jeton
  (par exemple 36 h glissantes, toujours sous le plafond de 7 jours). C'est un choix entre confort et sécurité (téléphone
  partagé en cuisine) ; il n'est pas pris ici.

## Exigences
- **FR-001 Connexion** : sans session, `/klant` renvoie sur `/#aanmelden` ; expiration → `/?sessie=verlopen#aanmelden` ;
  déconnexion → `/?uit=1#aanmelden`. Sur l'accueil, la section de connexion suit directement le héros (script et HTML
  statique) ; le défilement vise le formulaire. Sur téléphone, le comptoir passe à trois petites plaques par ligne (formes
  entières, centrées). Erreur 401 : un seul message. « Tonen » mesure 44 px.
- **FR-002 Facturen, mode boekhouder (ADR 0005)** : le document s'appelle « Overzicht · pro forma » (titre et numéro PF-
  identiques au document), jamais « Factuur » ; statut « Te betalen vóór 6/11 » (ambre) ou « Vervallen sinds … » (rouge)
  d'après l'échéance calculée par le serveur (`vervaldatum` : Facturée le + Betaaltermijn), « Geleverd · niet betaald »
  sans échéance. Le relevé « Openstaande facturen », le montant dû TVAC et le QR restent réservés au mode Portaal. Une
  seule action par ligne (le document). La pastille de l'onglet compte les mêmes livraisons non payées que l'écran montre.
- **FR-003 Aperçu de document sur téléphone** : sous 600 px, une feuille de style propre à l'aperçu (`famo-narrow`) met
  le document en colonne (qui, quel document, chaque ligne avec quantité, prix, TVA et montant, récapitulatif TVA,
  totaux). Mêmes données que le PDF, aucun second calcul. L'impression (`@media print`) et le PDF (la feuille est exclue
  par `scopedCss`) restent l'A4. Le bouton « Annuleren » disparaît (la croix suffit).
- **FR-004 Panier mobile** : « Bestelling plaatsen · € … » dans une barre fixe au-dessus des onglets ; commentaire par
  ligne derrière « + opmerking » (ouvert d'office s'il existe) ; le sélecteur de date de l'appareil est replié sous
  « Andere dag… » et le jour choisi s'affiche comme un bouton au format belge (jj/mm) ; sous 430 px le stepper et le
  prix passent sous le nom. Le toast se pose au-dessus des onglets et des barres.
- **FR-005 Fiche produit sur téléphone** : la carte d'identité (visfiche, prix, stepper) d'abord, une petite galerie
  ensuite ; commentaire derrière « + opmerking ».
- **FR-006 Noms et quantités** : noms en casse normale partout à l'écran (Leveringen, détail, confirmation, vaste
  producten) via `FamoBestellen.naam`, qui détache aussi un poids collé (« 1KG » → « 1 kg ») ; les kilos s'écrivent
  « Saumon frais 4,5 kg ». Les données ne changent pas ; les documents A4 non plus.
- **FR-007 Leveringen et détail** : statut court en liste (« Aanpasbaar tot 22:00 »), sous le titre sur téléphone ; pas de
  « Opnieuw bestellen » sur une commande encore modifiable ; « Annuleren » passe dans le panneau Wijzigen (lien discret) ;
  sous chaque article la ligne d'origine de la visfiche du produit, et sur une commande livrée le renvoi au bon de
  livraison pour le lot.
- **FR-007b Wijzigen** : on ajoute un produit dans le panneau lui-même (recherche dans le catalogue actif, « + Toevoegen »,
  une étape) ; le serveur revérifie tout à l'enregistrement (`/api/klantorder` action `wijzig`, déjà capable d'ajouter).
  Sur une commande livrée, le détail affiche le lot par article quand l'équipe l'a saisi (données du bon, `/api/klantdoc`).
- **FR-008 Compte et contact** : carte « Een vraag? » en haut du compte et sur la confirmation (WhatsApp **seulement si un
  numéro est configuré** dans la configuration publique, téléphone, e-mail) ; réglage « Tellers in het menu » retiré ;
  « Uitloggen » sur toute la largeur ; « Favorieten » devient « Uw vaste producten » (même liste que Bestellen : produits
  habituels du serveur + étoiles), la commande type reste disponible.
- **FR-009 Demande d'accès** : même famille que l'accueil (en-tête timonerie, titre serif), trois raisons vraies
  (heure limite et jours lus dans la configuration, prix négociés, visfiche) et un contact direct.
- **FR-010 Catalogue** : « Vis 2 · + 2 bij uw vaste » quand des produits du groupe sont déjà dans « Uw vaste » ; après
  une commande, l'aide dit que le « + » passe par le panier.

## Hors champ (dit honnêtement)
- Connexion par e-mail : demande l'unicité des adresses entre Clients et Klantgebruikers et touche l'authentification ;
  à spécifier à part.
- Lien « Personeel » du pied de page public : gardé, exigé par les specs 032-033 (tests `vague1`, `vague2`).
- Zéro barré d'Atkinson Hyperlegible Next dans les chiffres : propriété de la police, non modifiable ici.
- Photos réelles des produits, n° FAVV (affiché dès qu'il est rempli dans Beheer), créneau de livraison : données à fournir.

## Tests
`test/x30-correctifs.test.js` ; `test/vague3.test.js` mis à jour (l'échéance s'affiche aussi en mode boekhouder, le
montant dû reste au mode Portaal) ; `test/x30-commande.test.js` (« 1KG » → « 1 kg »).
