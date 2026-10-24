# Feature Specification: Vague 4 « fiche poisson et traçabilité par lot »

**Créée** : 2026-10-24 · **Statut** : implémentée sur la branche `vague-4-fiche-poisson`, non déployée (attend la
validation du gérant puis le « go » du prestataire) · **Source** : plan « famoseafood.be parfait », vague 4 (lots 4.1 à
4.4) ; exigences TRACE-01 à TRACE-04 (`.planning/REQUIREMENTS.md`) ; recherche juridique du 24/10/2026
(`~/Documents/Plan Kameha/FAMO/recherche-info-poisson-24-10.md`, ci-après « la recherche »).

## Principe
Rien n'est présenté comme une obligation au-delà de ce que la recherche marque CONFIRMÉ. Tous les champs sont
**facultatifs** : le portail ne bloque aucune commande faute d'information. Ce qui est vide n'est **jamais** affiché ni
imprimé (pas de « — » qui ferait croire à une mention obligatoire manquante). Les listes fermées sont contrôlées par le
serveur (constitution II) et définies une seule fois dans `assets/visfiche.js` (serveur et navigateur).

## Exigences
- **FR-001 Visfiche produit** (Beheer → Producten, volet « Visfiche », néerlandais) : wetenschappelijke naam, FAO-code
  (3 lettres, ASFIS), productiemethode (Gevangen op zee / Gevangen in zoet water / Gekweekt, art. 35 §1 b), vangstgebied
  (liste fermée de 32 zones FAO courantes : sous-zones 27 et 37, grandes zones ailleurs, art. 38) + land van kweek
  (texte libre ; aussi cours d'eau / lac + pays en eau douce), vistuig (7 catégories de l'annexe III col. 1 du R1379,
  refusé pour l'élevage), staat (Vers / Diepgevroren / Ontdooid), allergenen (les 14 de l'annexe II du R1169, cases),
  bewaren (texte court), « bestemd om rauw te eten » + vriesbehandeling (−20 °C 24 h / −35 °C 15 h / niet van
  toepassing, R853 annexe III sect. VIII ch. III partie D). Sans « rauw », le traitement n'est pas gardé. Une valeur hors
  liste est refusée (400), rien n'est écrit. Écrite seulement si envoyée (comme `Kaliber`).
- **FR-002 Champs lot** (Loten) : vangstdatum (capture ou récolte), nummer vangstreis of kweekbedrijf (texte ≤ 80),
  netto kg ontvangen ; vangstgebied et vistuig dans les mêmes listes fermées, **vides = repris du produit** (volet
  « Anders dan bij het product? »). Une ancienne saisie libre (avant cette spec) reste acceptée tant qu'elle n'est pas
  modifiée. Le serveur rattache le lot au produit du catalogue par identifiant (`Product-id`, TRACE-04) ; le nom du lot
  suit celui du catalogue (renommage).
- **FR-003 Instantané figé** (TRACE-02) : à « Klaar » (et si lots ou lignes changent tant que la commande est Klaar),
  le lot choisi est copié dans `Commandes.Lots` complété par la visfiche du produit (le lot l'emporte) et la visfiche
  des produits est copiée dans `Commandes.Productfiche`. Après le départ, plus rien ne change ; une fiche de lot ou de
  produit corrigée ensuite ne réécrit jamais un document. Lot ↔ ligne par `productId` de `Lignes JSON` (spec 016)
  quand les deux le connaissent, sinon par nom (anciennes commandes, anciens lots). Jamais le prix d'achat.
- **FR-004 Catalogue client et vitrine** (NL/FR, `K.t` + `K.FR`) : « ontdooid / décongelé » sur la ligne du produit
  (mention CONFIRMÉE) ; le reste dans le détail dépliable (nom scientifique + code FAO, herkomst en clair, staat,
  allergènes, conservation, traitement pour le cru). Vitrine : les mêmes lignes sauf le traitement pour le cru.
- **FR-005 Bon de livraison / documents** (langue du client) : par ligne, n° de lot, nom scientifique (code FAO), zone
  en clair ou pays d'élevage, méthode, catégorie d'engin, « ontdooid », THT, date de capture, n° de sortie de pêche ou
  d'unité aquacole ; puis état, allergènes, conservation ; pour le poisson à manger cru avec un barème, la mention
  « Bestemd om rauw te eten: diepgevroren op −20 °C … (behandeling tegen parasieten) » / « Destiné à être consommé
  cru : congelé à −20 °C … (traitement contre les parasites) ». Ligne sans lot mais avec visfiche : l'origine du
  produit. Seulement ce qui est rempli.
- **FR-006 Lots transmis** (TRACE-03) : Loten → « Geleverde loten per klant » (beheerder seul, 403 pour le
  personnel) : pour un client (ou tous) et une période (défaut 30 jours), les lignes parties ou livrées avec leur lot,
  tel que figé dans la commande, et le nombre de lignes livrées sans lot ; CSV. `GET /api/lots?geleverd=1`.
- **FR-007** Note « Nieuw » pour le gérant (`assets/nieuws.js`).

## Questions juridiques ouvertes (reprises de la recherche, § d — à faire valider)
1. Forme numérique de l'art. 58 §6 en Belgique : un bon de livraison consultable sur le portail ou un PDF par e-mail
   suffit-il ? Quelle autorité contrôle l'art. 58 à Anvers ? (INCERTAIN)
2. Statut sanitaire de FAMO (agrément, autorisation, enregistrement) et numéro ; marque d'identification. (MANQUANT)
3. Préemballé ou non (caisse sous glace, sous vide, barquette) : art. 8 §6 ou art. 8 §7 + art. 9 du R1169.
4. Poisson vendu frais à des clients sushi / poke : qui doit garantir la congélation, FAMO ou le restaurant ? Faut-il
   une mention « non traité, à congeler avant consommation crue » ? (aujourd'hui : rien n'est imprimé sans barème)
5. Scission de lots (art. 56 bis §5) : nouveaux numéros ou numéro du fournisseur ?
6. Classement NC des articles (wakame, surimi, tobiko / masago, crevettes cuites décortiquées) : art. 35 et date
   2026 ou 2029 de l'art. 58.
7. Liste belge des dénominations commerciales en vigueur (art. 37). (INCERTAIN)
8. Langue des mentions à Anvers (néerlandais seul ou NL + FR) ; le portail imprime dans la langue du client. (INCERTAIN)
9. Normes communes de commercialisation : espèces concernées et catégories à transmettre.
10. AR du 17/07/2014 (allergènes du non-préemballé) non relu.
11. Libellés néerlandais des catégories d'engin et des zones : traductions maison, texte NL officiel du R1379 non relu
    (INCERTAIN) ; la valeur stockée de l'engin est le libellé français CONFIRMÉ.

## Ce qui n'est PAS fait (documenté)
- **Rappel par lot aux clients** (plan, lot 4.5) : « Wie kreeg dit lot? » donne déjà la liste des clients, contacts et
  CSV ; aucun message n'est envoyé par le portail (envoi = geste humain, règle « go »).
- Mentions du préemballé (art. 9 R1169 : ingrédients, quantité nette, type de date DLC/DDM, date de congélation).
- Code NC, identifiants d'import séparés (n° OMI du navire, n° de certificat de capture) : aujourd'hui seulement le
  champ libre « nummer vangstreis of kweekbedrijf ».
- Exploitant qui a congelé et document du fournisseur joint (PDF) ; mention d'exemption « élevage / zone sans parasites ».
- Sous-lots FAMO reliés au lot du fournisseur ; contrôle « lot obligatoire complet » à la préparation (Q-TRACE-3,
  l'option `Lots verplicht` existante est inchangée).
- Quantité livrée en kg net pour un article vendu à la pièce ou au colis (le bon imprime la quantité de la ligne).
- Normes de commercialisation (catégories de fraîcheur et de calibre).
- Numéro d'agrément sur le portail ou le bon (statut MANQUANT).
- Envoi du bon par e-mail : inchangé (le client le voit dans son portail, comme avant).

## Tests
`test/vague4.test.js` : visfiche enregistrée et refusée hors liste (zones, engins, méthode, état, allergène, code FAO,
barème, engin + élevage), écrite seulement si envoyée, Beheer seul ; champs de lot, rattachement par identifiant,
ancienne saisie libre gardée ; instantané figé qui ne bouge plus après correction du lot et du produit, départ
verrouillé ; lot suivant son produit renommé ; bon NL/FR qui n'imprime que ce qui est rempli, mention pour le cru et
rien pour « niet van toepassing » ; lots livrés par client et période réservés au beheerder ; catalogue client et
vitrine. `test/trace.test.js` adapté : zone et engin en liste fermée.
