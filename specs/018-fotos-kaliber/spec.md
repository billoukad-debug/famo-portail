# Feature Specification: Foto's altijd zichtbaar, meerdere zichten per product, volgorde per kaliber

**Created**: 2026-10-02 · **Status**: Implemented
**Input**: le portail est utilisé en production. Mohsen (personnel) vient d'encoder le stock et demande :
« Foto's zichtbaar maken », « Beweging van foto's », « Volgorde per kaliber ». Précision du propriétaire :
les photos produit sont **toujours** visibles (catalogue client, Voorraad, Invoeren) ; clients et personnel
voient **plusieurs vues** d'un produit (plusieurs photos) ; pas d'animation au survol. Plus l'ordre par kaliber.

## User Scenarios

- **Client (catalogue)** — Chaque ligne produit montre d'emblée une petite vignette carrée (une icône neutre
  sans photo). Toucher la vignette (ou le nom) ouvre le détail : grande photo et, s'il y en a plusieurs, les
  autres vues en petites vignettes à toucher ; au téléphone on glisse d'une vue à l'autre ; au clavier ← →
  changent de vue. NL et FR.
- **Personnel (Voorraad, Invoeren)** — La vignette du produit précède son nom ; Voorraad a une colonne Kaliber
  et la liste est triée par nom puis par kaliber (8/12, 13/15, 16/20, 21/25…).
- **Beheerder (Beheer → Producten)** — Dans la fiche produit : jusqu'à 6 photos (« 3 van 6 »). « Foto
  toevoegen » accepte plusieurs fichiers d'un coup ; chaque photo peut devenir « Hoofdfoto », être déplacée
  à gauche / à droite ou supprimée (confirmation). « Sorteer op kaliber » range, dans chaque catégorie, les
  produits de même nom l'un à côté de l'autre par kaliber croissant, après confirmation ; le catalogue
  client et Invoeren suivent cet ordre.

## Requirements

- **FR-001** Champ existant `Catalogue.Foto` (pièces jointes) : jusqu'à **6** images, la première = photo
  principale. Aucun nouveau champ ni table.
- **FR-002** `uploadFoto` avec `add: true` ajoute une photo sans toucher aux autres ; refus 400
  « Maximaal 6 foto's » s'il y en a déjà 6. Sans `add` : comportement actuel (remplace tout), compatible.
  Mêmes contrôles qu'avant (JPEG/PNG/WebP, octets magiques, 3 Mo).
- **FR-003** Nouvelle action `setFotos {id, order: [ids de pièces jointes]}` (beheerder seul, garde A-10
  d'abord, journal d'audit) : le serveur relit la fiche et ne garde **que** les pièces jointes existantes,
  dans l'ordre donné ; les ids inconnus sont ignorés, aucune URL venant du navigateur n'est crue. Liste vide
  = toutes les photos supprimées. Les fichiers retirés sont effacés de `famo_files` (moteur SQL).
- **FR-004** Le moteur SQL (`lib/at-engine.js`) se comporte comme Airtable : `uploadAttachment` **ajoute**
  au champ (l'API vide d'abord le champ quand elle veut remplacer) ; un PATCH `[{id}]` désigne une pièce
  jointe existante du même champ et la conserve telle quelle ; un id inconnu est refusé (422). Le faux
  Airtable (`scripts/fake-airtable.js`) fait de même et sert ses fichiers en `/api/foto?id=att…`.
- **FR-005** Réponses : Beheer `fotos: [{id, url}]` (+ `foto` = la première) ; catalogue client
  `fotos: [url…]` (+ `foto` inchangé) ; `/api/stock` : `foto` et `kaliber` du produit apparié ;
  `/api/staff?client=` (Invoeren) : `foto`. URL sûres seulement (`lib/photo.js` : https Airtable ou
  `/api/foto?id=att…`, jamais `data:`).
- **FR-006** Catalogue client : vignette ≈ 44 px en tête de chaque ligne (`loading="lazy"`,
  `decoding="async"`, largeur et hauteur posées) ; détail = galerie (grande image, vignettes-boutons 44 px
  « Foto 2 van 3 » / « Photo 2 sur 3 », `aria-current` sur la vue montrée, défilement à aimantation au
  téléphone, ← → au clavier). Image cassée : masquée.
- **FR-007** `K.kaliberKey` / `K.byNameKaliber` (`assets/ui.js`) : noms comparés sans casse avec tri
  numérique (`Intl.Collator("nl", {numeric:true, sensitivity:"base"})`) ; kaliber numérique :
  « U10 » / « U/10 » (moins de 10) d'abord, puis par premier nombre (8/12 < 13/15 < 16/20 < 21/25,
  « 1-2 kg » par son premier nombre), sans nombre : après les nombres, par texte.
- **FR-008** « Sorteer op kaliber » (Beheer) : fonction pure `K.kaliberOrder(products)` — catégories dans
  leur ordre actuel ; dans chaque catégorie, les noms (normalisés : minuscules, espaces) gardent l'ordre de
  leur première apparition et les produits de même nom se suivent par kaliber ; à égalité, le nom en tri
  numérique (« Scampi 16/20 » avant « Scampi 21/25 » même si le kaliber est dans le nom). Enregistré par
  l'action existante `reorderProducts`.

## Edge Cases

- 6 photos et deux ajouts simultanés : le contrôle se fait avant l'envoi ; une course peut en laisser 7
  (rare, un seul beheerder) — la suivante est refusée, une suppression ramène à 6.
- Photo Airtable expirée (lien https temporaire) : masquée à l'écran (`data-fallback`), relue au chargement.
- Produit sans kaliber : après ceux qui en ont, dans l'ordre des noms.
- Listes de centaines de produits : vignettes en `loading="lazy"` ; la galerie complète n'est dessinée
  qu'à l'ouverture du détail.

## Success Criteria

- **SC-001** Un client voit la photo de chaque produit sans ouvrir la ligne et parcourt 3 vues au doigt
  ou au clavier.
- **SC-002** Un beheerder ajoute 3 photos en une fois, choisit la principale et en supprime une sans
  quitter la fiche.
- **SC-003** check.js, ESLint, contrast-check, ux-audit puis kbd-audit : 0 écart.
