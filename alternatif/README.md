# Proposition de design alternative, « Kaai bij nacht » v2

Maquettes statiques, **séparées du portail** : `/alternatif` est dans `.vercelignore`, rien n'est servi en ligne.

- `index.html` : accueil vitrine (photo du quai la nuit, ligne du temps d'une nuit, familles en bento, livraison)
- `aanbod.html` : l'offre par famille, filtres
- `klant.html` : commander (client, téléphone d'abord), recherche avec état vide, panier
- `vandaag.html` : écran du patron, un bouton par étape
- Ajouter `?demo=pire` à `klant.html` ou `vandaag.html` : données extrêmes (skill emil break-ui)

Skills appliqués : `impeccable`, `taste-skill` + `redesign-skill` (Leonxlnx/taste-skill, MIT), `emil-design-eng`, `emil-animate`,
`emil-break-ui`, `emil-review-animations`, `emil-find-animation-opportunities` (emilkowalski/skills), Playwright pour les captures.
Figma : non disponible (connecteur à autoriser par l'utilisateur dans claude.ai).
Polices : Cabinet Grotesk et Satoshi (Fontshare, licence gratuite ITF). Icônes : Phosphor (MIT). Photos : générées avec Canva.
Prix et clients : données d'exemple.
