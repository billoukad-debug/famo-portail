# Feature Specification: x30 lot C « accueil public » (De avondtoonbank)

**Créée** : 2026-10-24 · **Statut** : codée sur la branche `x30-c-accueil` (partie de `recette-vagues-2-3-4`), non
déployée : attend la validation du gérant (Mohsen) puis le « go » · **Source** : `audit-design-x30.md` § 3.1, 3.2 et 3.7,
maquette `maquette-x30/accueil.html`, `plan-x30.md` lot X7, `annexe-audit-public-24-10.md` (SEO),
`recherche-info-poisson-24-10.md` (ce qu'on a le droit d'affirmer sur le poisson).

## Pourquoi
L'accueil public est noté 56/100 (audit x30) : aucun poisson, aucune preuve, un titre au zéro barré (« 22:ØØ »), la
moitié gauche vide sur ordinateur. Cible : ≥ 85/100 sur le même barème (clarté, vitesse, confiance, esthétique, mobile,
accessibilité), **sans rien inventer**.

## Principe : rien d'inventé
- Aucune donnée inventée : pas de clients, d'avis, de labels, de certifications, de chiffres, de prix.
- Aucun créneau horaire de livraison (« tussen 6 en 8 u ») tant qu'il n'existe pas dans la configuration (FR-002).
- Pas de « Rauw OK » présenté comme une garantie : la vriesbehandeling est une information **du lot ou du produit**,
  affichée seulement quand elle est remplie (spec 035).
- « Zo werkt het » ne décrit que ce qui marche aujourd'hui (pas de modification sans annulation, pas de commande
  habituelle, pas de photo de livraison : lots X1, X3, X9 non livrés).
- Aucune image copiée : les plaques d'espèces sont des aplats et des formes dessinés pour FAMO (SVG en ligne).

## Exigences
- **FR-001 En-tête** (timonerie bleu-noir) : marque, bascule NL/FR, bouton « Aanmelden » visible à toutes les largeurs ;
  il mène au formulaire de connexion de la page et y place le curseur.
- **FR-002 Bandeau vivant** sous l'en-tête, calculé dans le navigateur depuis la configuration publique
  (`/api/config?public=1` → `levering` : deadline, leverdagen, geslotenDagen) **à l'heure de Bruxelles**, quelle que soit
  l'horloge de l'appareil. Même règle que le serveur (`lib/levering.js`) : avant la deadline, premier jour livrable
  = demain ou le suivant ; après, à partir d'après-demain ; on saute les jours non livrés et fermés. La date limite pour
  ce jour est la veille, à la deadline. Textes :
  - date limite ce soir, moins de 6 h : « Vanavond nog 3 u 12 om te bestellen · geleverd za 25/10 » ;
  - date limite aujourd'hui, plus loin : « Bestel vandaag vóór 22:00 · geleverd … » ;
  - date limite un autre jour (après la deadline, samedi soir, jour fermé) : « Bestel vóór zo 25/10, 22:00 · geleverd ma 26/10 » ;
  - à 30 minutes ou moins : style d'alerte (ambre) ; mise à jour toutes les 20 s ; sans JavaScript, texte statique
    « Bestel vóór 22:00 · levering ma–za ».
  **Emplacement du créneau** : si la configuration publique contient un jour `levering.levervenster` au format
  normalisé `HH:MM-HH:MM` (celui de `lib/levering.parseSlot`), le bandeau ajoute « tussen 06:00 en 08:00 ». Ce champ
  **n'existe pas aujourd'hui** (aucune colonne Configuratie, absent de `publicRules`) : rien n'est affiché. L'ajouter
  demande une colonne « Levervenster » + `publicRules` (hors de ce lot, décision du gérant : plan x30, décision 5).
- **FR-003 Héros** en serif : « Vóór 22:00 besteld, *morgen in uw keuken.* » (heure lue dans la configuration), le
  texte de service existant (leverdagen, afgesproken prijzen, leverdag kiezen, bons et factures), deux actions
  « Aanmelden » et « Klant worden » (`/aanvraag`), deux faits issus de la configuration (deadline, leverdagen).
- **FR-004 Comptoir d'espèces** : six plaques typographiques (aplat couleur, forme simple, nom dans la langue de la page,
  nom latin en italique), sans prix ni photo, avec la légende « Ter illustratie. Het actuele aanbod en uw prijzen ziet u
  na het aanmelden. » (l'assortiment réel n'est pas public : vitrine fermée, spec 027).
- **FR-005 « Elk lot heeft een identiteitskaart »** : une fiche **marquée « Voorbeeld »**, valeurs fictives, seulement
  des mentions que la recherche juridique marque CONFIRMÉ et que le portail sait déjà montrer (spec 035) : nom
  scientifique + code FAO, méthode de production, zone de capture, catégorie d'engin, état, allergènes, lot et THT sur
  la leveringsbon, et la ligne « Rauw te eten » avec la phrase exacte du portail, précédée d'une note disant qu'elle
  n'apparaît que si la vriesbehandeling est enregistrée pour ce produit ou ce lot.
- **FR-006 « Zo werkt het »** : 3 étapes vraies aujourd'hui (bestellen met uw prijzen en leverdag ; vóór deadline =
  eerstvolgende leverdag, leverdagen ; leveringsbon en factuur in uw account).
- **FR-007 Connexion + « Een vraag vanavond? »** : le formulaire existant (mêmes identifiants, mêmes messages, même
  appel `/api/catalogue`, mêmes champs `#user`, `#pw`, `#loginBtn`) à côté d'un bloc contact : téléphone et e-mail de la
  configuration publique, bouton WhatsApp **seulement si** `K.waLink(config.whatsapp)` donne un lien, « Klant worden ».
- **FR-008 À garder** : lien d'évitement, pied de page légal commun (`K.publicFooter`, dont « Personeel »), texte
  statique indexable (spec 033, `test/vague2.test.js`), JSON-LD `LocalBusiness` (mis à jour, toujours vrai),
  canonical / hreflang / `?taal=`, NL/FR par `K.t` + `K.FR`, redirection d'un client déjà connecté.
- **FR-009 Police** : Instrument Serif (OFL 1.1, paquet npm officiel `@fontsource/instrument-serif` 5.3.0), hébergée dans
  `assets/fonts/` (CSP `font-src 'self' data:` : Google Fonts bloqué), latin 400 droit et italique, préchargée. Atkinson
  Hyperlegible Next reste pour tout le reste (données, formulaires, équipe). Amendement de `DESIGN.md` (deux voix).
- **FR-010** Note « Nieuw » pour le gérant (`assets/nieuws.js`).

## Hors périmètre (documenté)
- Commande habituelle, modification sans annulation, suivi en fil, photo de livraison (lots A et D du plan x30).
- Connexion par e-mail (la maquette dit « E-mail of gebruikersnaam » : le serveur n'accepte que le nom d'utilisateur).
- Numéro FAVV : affiché par le pied de page commun dès qu'il est rempli dans Beheer (spec 032) ; rien n'est écrit en dur.
- Section « Wat we leveren » de la maquette (familles et descriptions) : l'assortiment réel n'est pas vérifiable ici.
- Photos des produits (séance photo, décision 4 du plan).

## Questions pour le gérant
1. Les six espèces du comptoir (zalm, tonijn, garnalen, inktvis, octopus, sint-jakobsvrucht) correspondent-elles à ce
   que FAMO vend ? Sinon, changer la liste (une ligne dans `assets/pages/start.js` et `index.html`).
2. La police serif des titres (décision de marque, plan x30 décision 1).
3. Le créneau de livraison (« tussen 6 en 8 u ») : seulement quand il est vrai et saisi (FR-002).

## Tests
`test/x30-accueil.test.js` : calcul du bandeau (heure de Bruxelles, après la deadline, samedi soir, jour fermé, autre
deadline et autres jours, changement d'heure), aucun créneau sans configuration, rendu de la page NL/FR dans un faux
navigateur (WhatsApp seulement si configuré, connexion inchangée), textes vrais (rien d'inventé, « Voorbeeld »,
pas de « Rauw OK », pas de créneau), liens et SEO préservés, police auto-hébergée.
