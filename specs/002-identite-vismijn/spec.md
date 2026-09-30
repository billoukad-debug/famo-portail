# Feature Specification: Identité « Vismijn » — enlever l'effet « généré »

**Feature Branch**: `claude/brave-lovelace-s4xk7h`
**Created**: 2026-09-30
**Status**: Implemented
**Input**: « Le problème c'est qu'on a encore cet aperçu vibe-codé. Étudie comment les gens enlèvent cet effet. » — carte verte sur l'UI, « la crème de la crème ».

## Constat (sources)

- Skill `frontend-design` d'Anthropic (github.com/anthropics/skills) : fond crème chaud, « SaaS card kit » (cartes identiques, même rayon, même ombre), libellés en capitales, métadonnées « A · B · C », trio « gros chiffre + petit libellé » = défauts des interfaces générées.
- Détecteur Impeccable (github.com/pbakaus/impeccable, 61 règles) sur le dépôt : 2 × bande colorée sur le côté (`.ev`, `.prod.on`), 3 × police surutilisée (Plus Jakarta Sans).
- Relevé visuel (27 captures, bureau + téléphone) : lettre « F » dans un carré bleu comme logo, quatre cartes KPI identiques, accueil au format modèle, pastilles rouges pour de simples compteurs, zéro identité liée au poisson.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Un portail qui a l'air fait pour FAMO (Priority: P1)

Un chef qui ouvre le portail le soir reconnaît un fournisseur de poisson, pas un modèle SaaS ;
le premier écran lui dit combien de temps il lui reste pour commander et pour quel jour.

**Independent Test**: ouvrir `/` avant et après 22:00 (portail de dev) : le bandeau affiche « Nog x u y min … levering op <jour> » puis « Volgende levering <jour> ».

**Acceptance Scenarios**:
1. **Given** 20:30 un mercredi, **Then** le bandeau dit « Nog 1 u 30 min om te bestellen voor levering op donderdag … ».
2. **Given** 22:05, **Then** « Volgende levering vrijdag … » et « De bestellingen voor morgen zijn dicht sinds 22:00 ».
3. **Given** la langue FR, **Then** tout le bandeau est en français.

### User Story 2 - Une équipe qui lit tout du premier coup (Priority: P1)

Le préparateur à 5 h, avec des gants, distingue la zone de travail de la navigation et lit sans hésiter références et quantités.

**Acceptance Scenarios**:
1. La navigation de l'équipe est un bloc sombre distinct ; l'onglet actif et les compteurs restent lisibles (AA).
2. Police conçue pour la lisibilité (1/l/I, 0/O distincts).
3. Aucune régression d'accessibilité : ux-audit et kbd-audit sans écart, contrastes AA.

### Edge Cases

- Configuration publique indisponible : bandeau calculé avec les règles par défaut (22:00, lun–sam).
- Jour de livraison fermé (congé) : sauté.
- Page restée ouverte : le bandeau se recalcule toutes les 30 s.
- Impression : la timonerie n'est pas imprimée (règle `@media print` existante).

## Requirements *(mandatory)*

- **FR-001**: Jetons « Vismijn » (fond froid, encre Diepzee, action Noordzee, accent Boei limité à la marque), AA partout.
- **FR-002**: Police Atkinson Hyperlegible Next hébergée sur le site (RGPD), une seule famille.
- **FR-003**: Marque SVG (poisson) partout où il y avait « F » : navigation, accueil, connexions, documents, favicon, icônes PWA.
- **FR-004**: Barre latérale de l'équipe sombre, compteurs neutres ; rouge réservé à l'erreur/retard.
- **FR-005**: Supprimer les défauts relevés : bandes latérales, capitales, cartes KPI identiques, icône dans un carré coloré, ombre au survol des cartes, trio de chiffres de l'accueil, métadonnées « A · B » des en-têtes client.
- **FR-006**: Rayons hiérarchisés (6/10/14), ombres réservées à ce qui flotte.
- **FR-007**: Accueil : bandeau « marée » vivant (`K.orderWindow`, même règle que `lib/levering.js`), testé.
- **FR-008**: Style de l'accueil déplacé dans `assets/ui.css` (une seule feuille).

## Success Criteria *(mandatory)*

- **SC-001**: Impeccable (fichiers) : 0 bande latérale, 0 police surutilisée dans `assets/ui.css`.
- **SC-002**: `contrast-check`, `check.js`, ESLint, ux-audit, kbd-audit : 0 écart.
- **SC-003**: Les 27 captures de référence ne montrent plus aucun des défauts listés au constat.

## Assumptions

- Le zéro barré de la police est accepté (lisibilité) ; réversible en une ligne (`--sans`).
- Les noms de produits en MAJUSCULES viennent des données (Beheer → Producten), pas du design.
