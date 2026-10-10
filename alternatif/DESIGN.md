# DESIGN, « Kaai bij nacht » v2 (proposition alternative)

**Lecture du brief (taste-skill 0.B)** : vitrine B2B premium d'un grossiste de la mer, pour des chefs de restaurant, ton calme de quai nocturne, système maison en CSS natif (aucun design system officiel ne s'applique).
**Réglages** : DESIGN_VARIANCE 7, MOTION_INTENSITY 5, VISUAL_DENSITY 4 (vitrine). Écrans de travail : hors périmètre taste (Operate, impeccable), densité 6, mouvement 2.

## Monde
Le quai d'Anvers avant l'aube : la nuit bleu-encre, la lampe de quai ambrée, la glace pilée. Une seule audace : la photo réelle plein cadre du hero.

## Règles verrouillées
- **Thème** : vitrine (index, aanbod) entièrement nuit ; écrans de travail (klant, vandaag) entièrement glace. Aucune section n'inverse le thème.
- **Un accent** : `--lamp #E9A23B` partout (boutons, prix, ligne du temps). Gris d'une seule famille, teintée bleu.
- **Rayons** : 10 px ce qu'on touche, 16 px ce qui contient, pilule pour les filtres.
- **Typo** : Cabinet Grotesk 800 (titres, sans-serif, Fontshare) + Satoshi 400/500/700 (texte). Pas de serif (taste 4.1). Emphase = couleur dans la même police.
- **Icônes** : Phosphor (regular), jamais dessinées à la main.
- **Images** : 5 photos générées (Canva) : hero quai, garnalen, vis, schelpdieren, levering.
- **Copie** : zéro tiret long, une étiquette par intention (« Klant worden » partout), sous-texte du hero ≤ 20 mots.

## Mouvement (emil-design-eng)
| Élément | Choix | Pourquoi |
|---|---|---|
| Entrée du hero | 700 ms, ease-out `cubic-bezier(.23,1,.32,1)`, décalage 60 ms | Vu une fois, raconte l'arrivée |
| Photos des familles | clip-path depuis le bas, une fois (IntersectionObserver) | Révélation, pas de scroll listener |
| Boutons | `:active scale(.97)`, 160 ms | Retour tactile |
| Survols | seulement `(hover:hover) and (pointer:fine)` | Pas de faux survol au toucher |
| Panier | translateY(100 %) → 0, 250 ms, transition interruptible | Entre et sort du même côté |
| Étape Vandaag | **aucune animation** | Action répétée des dizaines de fois par matin |
| Mouvement réduit | fondus gardés, déplacements retirés | Accessibilité |
