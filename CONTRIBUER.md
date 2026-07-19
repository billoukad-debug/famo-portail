# Avant de pousser du code

Deux bugs ont deja casse la production :
- une parenthese manquante dans `entrepot.html` (tout le JS du magazijn etait mort)
- une variable hors portee dans `api/order.js` (plus aucune commande client possible)

Les deux auraient ete attrapes en 10 secondes par la commande ci-dessous.

## La commande a lancer avant chaque push

```bash
node scripts/check.js && npx eslint api/
```

Si ca affiche « Tout est bon », tu peux pousser.

## Ce qui est verifie

| Controle | Attrape |
|---|---|
| `scripts/check.js` | Erreurs de syntaxe dans `api/*.js` et dans les `<script>` des pages HTML |
| `scripts/check.js` | Fonctions appelees dans un `onclick=` mais jamais definies |
| `eslint api/` | Variables non definies, code inatteignable, cles dupliquees |

Le meme controle tourne automatiquement sur GitHub a chaque push.
Si l'onglet **Actions** affiche une croix rouge, le code est casse : corrige avant de continuer.

## Ce qui n'est PAS verifie

Ces controles ne testent pas le comportement. Ils disent que le code s'execute,
pas qu'il fait la bonne chose. **Charge la page une fois dans le navigateur
avant de pousser** — c'est ce qui manquait les deux fois.

## Zones sensibles

- **Les prix ne viennent jamais du navigateur.** Le serveur les recalcule depuis
  Airtable a chaque commande. Ne jamais faire confiance a un total envoye par le client.
- **Le stock ne se deduit qu'une fois**, au passage en « Sortie en livraison »,
  protege par le champ `Stock afgeboekt`. Ne pas contourner ce verrou.
- **Le numero de facture est attribue une seule fois** et ne doit jamais etre reattribue.
