# Brief pour la session design — FAMO Seafood, v3

À lire en entier avant de dessiner ou de coder. Il remplace `DESIGN.md` (brief v1 « Notion × Revolut », périmé depuis la v2).

Rédigé le 25 septembre 2026 sur `main` @ `5dca0ac` (PR #13 mergé). Ton design system (« FAMO Portail Design System ») et ton canevas (« schermen v2 ») ont été extraits de `main` @ `673f68d`, **avant** ce PR : il leur manque une vingtaine d'écrans et de composants, listés en section 3.

---

## 1. Ce qui est tranché — ne pas rediscuter

| Sujet | Décision |
|---|---|
| Nom | **FAMO Seafood**, partout : titres, logo, documents, e-mails, textes. Jamais « Famo Trading » (ton README et `tokens.json` le disent encore : à corriger). |
| Coordonnées d'exemple | Jezusstraat 34, 2000 Antwerpen · +32 483 58 58 54 · BTW BE0788705713 · IBAN BE… · BIC **KREDBEBB** |
| Langues | Portail client : NL par défaut, bouton NL ⇄ FR. Personnel et Beheer : NL uniquement. Documents et e-mails : NL. |
| Portails | Trois portails, **une seule peau**. La densité change selon le portail, pas le style. |
| Documents | **Plus aucune ligne « Handtekening klant »** ni mention « Intern document — Peppol » : retirées dans le code, ne pas les redessiner. Le bon de livraison garde la phrase de conditions (« Goederen ontvangen in goede staat… », texte venant de Beheer). |
| Données | Pas de produits, clients ou chiffres inventés. Le catalogue réel est petit (4 produits actifs, des crevettes Vannamei). Le produit peut maintenant avoir une **photo** : dessine les deux cas, avec et sans photo (initiale). |

## 2. La direction visuelle — la seule décision qui te revient

Ton canevas propose trois directions : **Crème** (page d'ouverture), **Kade**, **Noordzee** (marquée « verworpen »). Il faut en garder **une**.

**Recommandation : Crème**, avec une variante à fort contraste pour Magazijn et Leveringen.

- Crème est la plus sobre et la plus proche d'un produit B2B sérieux. Le client est un restaurateur qui commande le soir sur son téléphone : il veut lire un prix et appuyer sur un bouton, pas une ambiance.
- Le personnel travaille à 5 h du matin, dans le froid, avec des gants, sur un téléphone bon marché parfois mouillé. Pour Magazijn et Leveringen, reprends l'idée « nacht » de Kade : fond sombre, texte très contrasté, cibles énormes. C'est la seule partie de Kade à garder.
- Noordzee est abandonnée. Ne pas la faire revenir par morceaux.

Si tu pars sur une autre direction, écris pourquoi en trois lignes dans le README du design system.

## 3. Ce qui manque dans ton canevas

Tout ceci existe dans le code et en production depuis le PR #13. Chaque écran doit avoir son artboard, avec des données réalistes.

### Portail client (téléphone 390 **et** ordinateur 1280)
1. **Choix de la date de livraison** selon les règles de Beheer : heure limite, jours de livraison, jours fermés, 60 jours maximum. Message d'aide sous le champ (« Bestel vóór 22:00 voor levering morgen ») et message d'erreur par cas.
2. **Minimum de commande** dans le panier : avertissement et bouton désactivé tant que le minimum n'est pas atteint.
3. **Disponibilité** sur la carte produit : étiquette « Nog 12 » ou « Uitverkocht », stepper plafonné.
4. **Détail d'une commande** (panneau) : lignes, **tijdlijn** Ontvangen → Klaar → Onderweg → Geleverd, ou Geannuleerd avec date et motif. Blocs facture (numéro, date), livraison (date, réceptionnaire), paiement (payé le), exception de livraison, creditnota. Boutons : documents, Annuleren, **Wijzigen**, Opnieuw bestellen.
5. **Openstaande facturen** (onglet « Te betalen ») : liste des factures ouvertes, total, IBAN et BIC, communication structurée, boutons « Kopiëren ». Montants **hors TVA**, et c'est écrit.
6. **Favoris et standaardbestelling**, synchronisés entre appareils.
7. **Account** : e-mail et téléphone modifiables, numéro client et TVA en lecture seule, changement de mot de passe.
8. **Mot de passe oublié** (`wachtwoord.html`) : nom d'utilisateur + e-mail, puis un message neutre.
9. **Session expirée** : retour à l'accueil avec un bandeau.
10. **Sélecteur NL | FR** : chaque texte doit tenir dans les deux langues. Le français est en moyenne 20 % plus long.

### Personnel (téléphone, tablette 820, desktop 1280)
11. **Leveringen** : l'ordre de tournée se règle avec ▲▼, bouton **Bellen**, adresse et lien carte, montant **à encaisser TVA comprise**, badge d'exception sur les livraisons faites.
12. **Réception confirmée** (panneau) : nom du réceptionnaire, lien de preuve facultatif, **exception** (Afwezig, Geweigerd, Gedeeltelijk, Beschadigd) avec note, paiement comptant.
13. **Betaalwijze** (panneau) : Contant, Overschrijving, Bancontact, Andere.
14. **Validation au Magazijn** avec « **Product toevoegen** » (recherche dans le catalogue du client).
15. **Creditnota** (panneau, beheerder) : choix des lignes et quantités, motif, case « Retour in voorraad ».
16. **Corrigeren** (panneau) : revenir en arrière, annuler, restaurer, changer la date. Chaque action demande une raison. Le **journal** apparaît dans la fiche commande.
17. **Barre d'actions groupées** dans Bestellingen : « Markeer betaald (n) », « Leveringsbonnen », « CSV ». Puce de filtre client avec croix. Mention « 365 dagen · Alles laden ».
18. **Documenten** : filtres de dates, vue « Creditnota's », « Alle facturen (n) », export CSV.
19. **Invoeren** (saisie d'une commande pour un client au téléphone) et **Voorraad** (stock, historique filtrable) : désormais dans le menu du personnel.
20. **Fiche commande** (`order.html`) : toutes les informations ci-dessus sur une page.

### Beheer (desktop 1280)
21. Onglet **Bedrijfsgegevens** : nouvelle carte « Bestellen & leveren » avec l'heure limite, les jours de livraison (7 boutons bascule lu à di), les jours fermés, le minimum, le délai de paiement, et l'interrupteur « Voorraad automatisch afboeken ». Erreurs affichées sous chaque champ.
22. **Producten** : TVA par produit, **téléversement de photo** avec vignette, erreur de nom en double.
23. **Klanten** : Archiveren / Herstellen, groupe repliable « Gearchiveerd (n) », lien « Bestellingen », case « Welkomstmail sturen ».
24. **Toegang → Medewerkers** : liste nom, rôle, actif, dernière connexion, et panneau d'ajout avec PIN personnel.
25. **Rapportage** (nouvel onglet) : choix de l'année, KPI, tableaux par mois, par client, par produit, TVA par taux, impayés en retard en rouge. Chaque tableau a un bouton CSV. Pas de graphique obligatoire. Si tu en ajoutes un, un seul par tableau, simple.
26. **Aanvragen** : groupe « Verwerkt (n) » avec dates.
27. **Systeemstatus** : visible par le beheerder seulement.

### Documents A4 (`documents.js`) — la vitrine
28. **Leveringsbon**, **Factuur**, **Creditnota** (montants négatifs), et les **lots** : plusieurs documents, un par page, dans un seul PDF.
29. Facture : factuurdatum, vervaldatum, leverdatum, **une ligne de TVA par taux** (6 % et 21 % peuvent coexister), « Betaald op … » si payée, bloc bancaire avec communication.
30. Aucune zone de signature.

### E-mails (`lib/ordermail.js`)
31. Sept modèles : confirmation de commande, annulation (vers l'équipe), « onderweg », « geleverd » avec facture, bienvenue avec identifiants, nouvelle demande d'accès (vers l'équipe), nouveau mot de passe. Un seul gabarit commun (en-tête, corps, pied), 600 px, en tableaux, styles en ligne, lisible en mode sombre de Gmail et d'Outlook.

## 4. Contraintes techniques — ce qui casse si tu les ignores

1. **HTML, CSS et JavaScript pur.** Pas de framework, pas de build, pas de `package.json`. Le design se livre en CSS dans **`assets/ui.css`**, la seule feuille de style.
2. **Le balisage est produit en JavaScript** (`assets/ui.js` : `K.c.*`, `K.panel`, `K.shell`, `K.stChip`… et `assets/pages/*.js`). Restyle les classes existantes **sur place** plutôt que de les renommer : `btn btn-p btn-o btn-ghost btn-sm`, `card card-h card-b`, `chip st-*`, `cell-st c-*`, `tbl grp`, `notice`, `tag`, `field input`, `panel scrim`, `toast`, `side topbar mtabs cartbar`, `ocard`, `kpis kp`, `stepper`, `tl`, `state sk`. Si un renommage est indispensable, fournis la table ancien → nouveau.
3. **Trois portails par classe sur `<body>`** : `portal-klant`, `portal-personeel`, `portal-beheer`, qui ne changent que `--p`, `--p-soft` et `--p-deep`. Les **six couleurs de statut** sont les mêmes partout.
4. **Les `<style>` en ligne** de `index.html` et `klant.html` doivent rejoindre `ui.css`. C'est le seul changement de HTML attendu.
5. **Content-Security-Policy** (`vercel.json`) : polices uniquement Google Fonts ou système, images `https:`, `data:` ou `blob:`, **aucun script externe**, aucun CDN. Une police Google Fonts est acceptée. Un fichier de police auto-hébergé l'est aussi.
6. **Tests qui figent le balisage** (`node scripts/check.js`) : structure du menu (`NAV_DAILY`, `NAV_ADMIN`, `NAV_STAFF_MORE`, lien Voorraad), `K.langSwitch`, `famoCard.html`, `famoDocActions`, la mention « excl. btw » côté client. Surtout : **tout texte visible côté client passe par `K.t()` et a sa traduction dans `K.FR`**, sinon le test échoue.
7. **Cibles tactiles ≥ 44 px** partout où le personnel appuie. Les onglets mobiles font 64 px.
8. **Contrastes calculés, pas estimés** : 4,5:1 pour le texte, 3:1 au-dessus de 24 px et pour les bordures de contrôles. `ink-3` (2,9:1) ne porte jamais une information seule. La couleur du portail Beheer (3,4:1 sur blanc) ne sert que pour les grands aplats ou un texte blanc de 14 px en graisse 500. Deux couleurs à distinguer doivent différer en luminosité, pas seulement en teinte.
9. **Documents** : HTML A4 généré dans `documents.js`, avec CSS en ligne, imprimé et converti en PDF (html2pdf). Corps ≥ 9 pt, pas de grands aplats de couleur (encre et PDF), sauts de page propres dans les lots.
10. **Jamais `alert()`, `confirm()` ou `prompt()` natifs** : on utilise les toasts, les dialogues et les panneaux maison.

## 5. Ce que tu dois livrer, dans cet ordre

1. **Design system resynchronisé** sur `main` @ `5dca0ac` : nom FAMO Seafood, tokens au format liste, README réécrit, composants manquants (tijdlijn, puce de filtre, barre d'actions groupées, bascules de jours, téléversement de photo, relevé bancaire, badge d'exception, stepper plafonné).
2. **Les artboards de la section 3**, dans la direction retenue, avec des données réelles.
3. **Un logo.** Il n'existe pas. Aujourd'hui on a un « F » dans un carré (favicon, interface) et un monogramme « F-houle » vert `#0C6157` sur les documents. Propose **une** marque et décline-la en favicon, tuile d'interface, en-tête de document et en-tête d'e-mail.
4. **L'implémentation**, dans une PR séparée, qui ne touche que la présentation :
   - `assets/ui.css` ; le balisage minimal dans `assets/ui.js` et `assets/pages/*.js`, seulement s'il est impossible de faire autrement ;
   - le bloc CSS de `documents.js` ;
   - le gabarit HTML de `lib/ordermail.js` ;
   - **aucune logique modifiée** ;
   - `node scripts/check.js && npx eslint@9 api/` au vert ;
   - des captures avant/après prises sur le banc local (voir section 7).
5. **`DESIGN.md` réécrit** pour décrire le système livré, et ce brief supprimé.

## 6. Priorités, par impact réel

1. **Catalogue et panier client, sur téléphone.** C'est là que la commande se fait ou se perd. Le prix négocié doit être l'élément le plus visible de l'écran.
2. **Magazijn et Leveringen.** Une seule action évidente à la fois, lisible à un mètre, utilisable avec des gants.
3. **Documents A4.** C'est le seul objet qui sort de l'écran et arrive physiquement chez le client.
4. **E-mails.**
5. **Beheer.** Utilisé au bureau par une seule personne. La densité y est acceptable.

## 7. Vérifier sur le banc local

```bash
FAMO_RESEED=1 node scripts/dev.js          # http://localhost:4200, faux Airtable
# personnel : team-dev-code · beheerder : beheer-dev-code · PIN « Ilse » : 1234
# client : aloha / welkom123
# Playwright : executablePath /opt/pw-browsers/chromium-1194/chrome-linux/chrome
git checkout -- .dev-data                   # après chaque session : le banc modifie les données de démo
```

Passe **chaque** page en NL et en FR côté client, à 390 et à 1280 de large. Vérifie la console : zéro erreur JavaScript.

## 8. À ne pas faire

- Des dégradés, des cartes avec une bordure gauche colorée, des emojis, des icônes décoratives sans fonction.
- Des pilules de 44 px comme boutons : avec des gants, on rate les coins.
- Des ombres sur le contenu. L'ombre sert uniquement à l'élévation réelle : dialogue, panneau, toast, barre panier.
- Des écrans pour des fonctions qui n'existent pas côté serveur.
- Du français visible chez le personnel ou dans Beheer.
- Des chiffres ou des produits de démonstration inventés.
- Dire « vérifié visuellement » sans capture d'écran jointe.

## 9. Critères d'acceptation

- [ ] Une seule direction, écrite et justifiée.
- [ ] Les 31 éléments de la section 3 dessinés.
- [ ] Nom FAMO Seafood partout ; aucune signature sur les documents.
- [ ] Contrastes notés pour chaque paire texte/fond, dans chaque portail.
- [ ] PR d'implémentation au vert, sans changement de logique, avec captures NL et FR, téléphone et desktop.
- [ ] Documents imprimés en PDF, lot de trois factures compris, sans coupure de ligne entre deux pages.
- [ ] E-mail « geleverd » testé en clair et en sombre.
- [ ] `DESIGN.md` à jour.
