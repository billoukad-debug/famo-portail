# Feature Specification: Leveringen « chauffeur d'abord » (A4) et créneau visible par le client (D4)

**Created**: 2026-10-01 · **Status**: Implemented
**Input**: IDEAS.md § A4 (reste : mode « une commande à la fois ») et Horizon D, D4 (créneau / note de livraison visible).

## User Scenarios

- **Chauffeur (A4)** — Sur la page Leveringen, le livreur choisit « Chauffeur » (mémorisé sur l'appareil). Il voit
  un seul stop à la fois, dans l'ordre de la tournée (`Volgorde levering`) : nom du client en grand, adresse
  (lien Kaart), téléphone (lien Bellen), nota, leveruur prévu, articles à remettre, montant à encaisser.
  L'action principale est celle de la liste (Vertrekt, puis « Ontvangst bevestigen » avec preuve photo /
  handtekening, hors ligne compris). Ensuite « Volgende stop » mène au prochain stop non confirmé et le focus
  va sur le titre du nouveau stop. « Stop 2 van 5 » et une barre de progression disent où il en est ;
  « Lijst » ramène à la liste. Fin de tournée : « Ronde afgewerkt ».
- **Créneau (D4)** — Le personnel indique sur la fiche commande (et depuis Leveringen) l'heure de
  livraison prévue : « tussen 06:00 en 08:00 ». Le client la voit dans sa liste et sa fiche de commande
  (NL « tussen 06:00 en 08:00 », FR « entre 06:00 et 08:00 ») tant que la commande n'est pas livrée.

## Requirements

- **FR-001** Mode Lijst / Chauffeur sur Leveringen, mémorisé par appareil (`localStorage` via `K.store`,
  `try/catch` ; « Lijst » si le stockage est vide ou bloqué).
- **FR-002** Ordre des stops du chauffeur = ordre de tournée (volgorde, puis nom du client), stops livrés
  compris (ils gardent leur rang) ; « Stop k van n ».
- **FR-003** Un stop est « afgehandeld » s'il est livré (Geleverd), en file hors ligne (`FamoQueue`), ou
  marqué Afwezig / Geweigerd ; « Volgende stop » va au prochain stop non afgehandeld (en bouclant).
- **FR-004** L'action principale réutilise `S.depart` / `S.confirmDelivery` (`data-act`) : aucune logique
  serveur ni de preuve dupliquée ; la file hors ligne fonctionne comme dans la liste.
- **FR-005** Après « Volgende stop », le focus va au titre (h2, `tabindex=-1`) du nouveau stop ; après une
  confirmation, à « Volgende stop ». Cibles ≥ 44 px (52 px pour l'action principale), textes en néerlandais.
- **FR-006** Champ `Leverslot` (Commandes) : `HH:MM-HH:MM`, début < fin, ≤ 40 caractères, normalisé et
  validé par le serveur ; vide = effacé. Écrit seulement par le personnel (`/api/updateorder`, session staff),
  refusé (409) une fois la commande livrée ou annulée.
- **FR-007** `/api/allorders` (personnel) et `/api/orders` (client, ses commandes seulement) renvoient
  `leverslot`. Le client ne peut pas l'écrire (`api/order.js` construit ses champs un par un).
- **FR-008** Le client voit le créneau dans la liste et la fiche (NL/FR via `K.t()`), ni après la livraison ni
  sur une commande annulée. Export RGPD : inclus (toutes les colonnes de la commande).

## Edge Cases

- Afwezig / Geweigerd : la commande reste Onderweg (pas de facture) ; le chauffeur passe au suivant, le
  magasin la reprend (Corrigeren → Terug).
- Leverdag modifiée après coup : le créneau reste ; le personnel l'adapte.
- Créneau en texte libre (« na de middag ») : refusé ; deux heures demandées (affichage NL/FR exact).
  « 6u-8u » et « 6:00 – 8:00 » sont acceptés et normalisés.

## Success Criteria

- **SC-001** Un livreur termine 5 stops sans ouvrir Magazijn ni Documenten (mode Chauffeur seul).
- **SC-002** check.js, ESLint, ux-audit puis kbd-audit (avec un scénario « Volgende stop ») : 0 écart.
