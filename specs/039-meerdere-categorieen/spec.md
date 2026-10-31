# Feature Specification: un produit dans plusieurs catégories

**Demande (2026-10-31, Bilal pour Mohsen, urgent)** : quand Mohsen crée ou modifie un produit, il doit pouvoir
le mettre dans plusieurs catégories, pas une seule. Simple et logique, sans rien casser.

## Choix
- `Catégorie` reste **la catégorie principale** : volgorde du catalogue, « Sorteer op kaliber », rapportage,
  vitrine publique, facture et lecture des mails gardent une seule catégorie et ne changent pas.
- Nouveau champ `Extra categorieën` (texte, une catégorie par ligne, 10 au plus) : les catégories **en plus**.

## Exigences
- **FR-001** Beheer → Producten → product : champ « Ook tonen in (optioneel) » sous Categorie. Toutes les
  catégories connues en boutons à cocher (sauf la principale), plus « Andere categorie… » + Toevoegen (ou Entrée)
  pour en créer une. Changer la principale retire celle-ci des extras.
- **FR-002** `saveProduct` : `extraCats` (liste) écrit seulement s'il est envoyé (comme Kaliber) ; nettoyé,
  sans doublon (casse ignorée), sans la principale, 10 au plus ; autre chose qu'une liste → 400.
- **FR-003** Catalogue client : le produit apparaît dans chacune de ses catégories (bouton, compteur, filtre,
  recherche, fiche « Categorie: Vis, Sushi »). Sous « Alles », une seule fois (catégorie principale). Une
  catégorie qui n'existe qu'en extra vient après les autres (ordre alphabétique).
- **FR-004** Liste Beheer → Producten : le produit est aussi listé dans ses catégories en plus, avec
  « Hoofdcategorie: … » ; dans sa catégorie principale, « Ook in: … ». Volgorde et kaliber : inchangés.
- **FR-005** `renameCategory` renomme aussi la catégorie là où elle est en extra.
- **FR-006** Invoeren (personnel) : la recherche trouve aussi par catégorie en plus.
- **FR-007** Note « Nieuw » pour Mohsen.

## Tests
`test/meerdere-categorieen.test.js` : enregistrement et nettoyage, refus d'une valeur non-liste, absence = inchangé,
API client `cats`, API Beheer `extraCats`, renommage dans les extras, `K.catsOf`.
