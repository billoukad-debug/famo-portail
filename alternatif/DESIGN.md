# DESIGN — « Kaai bij nacht » (proposition alternative)

**Le monde** : le quai d'Anvers avant l'aube. La nuit bleu-encre, les lampes de quai couleur sodium, la glace pilée sous le poisson, les numéros peints au pochoir sur les caisses. FAMO travaille quand la ville dort : c'est l'histoire à raconter.

**Le geste fort** : la vitrine est nocturne (bleu-encre + lampe ambrée) ; les écrans de travail sont « glace » (clairs, très contrastés) et ne gardent de la nuit que la barre de marque.

## Couleurs
| Jeton | Valeur | Rôle |
|---|---|---|
| `--night` | `#0A1B26` | fond vitrine, barre de marque |
| `--night-2` | `#12293A` | surfaces sur la nuit |
| `--tide` | `#9FB8C6` | texte secondaire sur la nuit (AA sur `--night`) |
| `--lamp` | `#F0A73A` | la lampe : action principale, prix, accent unique |
| `--ice` | `#F3F6F5` | fond des écrans de travail |
| `--salt` | `#FFFFFF` | ce qui contient |
| `--ink` | `#0B1A22` | texte sur glace |
| `--ink-2` | `#4A5E68` | secondaire sur glace |
| `--rope` | `#D5DEE1` | filets, séparateurs |
| `--kelp` | `#1F7A5A` | succès / livré |
| `--rust` | `#B3401C` | erreur, retard |

## Typographie
- **Gloock** (voix : titres, noms de produits, prix vitrine) — serif maritime, chaleureux, un peu « registre de bord ».
- **Hanken Grotesk** 400/600 (travail : interface, formulaires, tableaux). Chiffres tabulaires pour prix et quantités.
- Échelle : 14 / 16 / 20 / 28 / 44 / 72 (vitrine).

## Formes et mouvement
- Rayons : 8 (ce qu'on touche), 14 (ce qui contient). Pas de cartes en grille identique : listes et rangées.
- Mouvement (skill `motion-kowalski`) : 180 ms ease-out `cubic-bezier(.23,1,.32,1)`, `:active` scale(.97), aucune animation sur les actions répétées de Vandaag, `prefers-reduced-motion` respecté.

## Logo
Mot « famo » en Gloock bas de casse ; le point du « a » remplacé par une lampe de quai (cercle ambré) au-dessus d'une ligne de flottaison. Variantes : sur nuit (texte sel) et sur glace (texte encre).
