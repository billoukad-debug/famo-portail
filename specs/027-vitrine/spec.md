# Spec 027 — Vitrine publique « Ons aanbod »

**Statut** : implémenté · **Date** : 2026-10-09 · **Demandeur** : gérant (« on a besoin d'une exposition et vitrine pour gagner des clients »)

## Contexte
Le portail était entièrement fermé (`robots.txt` : `Disallow: /`, page d'accueil `noindex`) : un restaurant qui cherche
« grossiste scampi Antwerpen » ne trouvait rien. Comparaison faite avec ogbaygroup.be (vitrine publique, catalogue indexé).

## Décisions du gérant (2026-10-09)
- Prix : **« vanaf »** = le `Prix de base` du catalogue, HTVA, par unité. Jamais un prix négocié, jamais le stock.
- Produits : **tout le catalogue actif** (`Actif` coché), mis à jour automatiquement.
- Google : **indexé** (vitrine, accueil, aanvraag). Portail client, personnel et Beheer restent fermés.

## User stories
- **US1** Un prospect ouvre `/aanbod` et voit toutes les familles de produits, photo, calibre, « vanaf € X / kg excl. btw », et un bouton « Klant worden ».
- **US2** Un prospect ouvre `/aanbod/<produit>` : photos, description, calibre, conditionnement, prix « vanaf », bouton « Klant worden ».
- **US3** Google trouve les pages : HTML rendu par le serveur (pas de JavaScript nécessaire), `sitemap.xml`, `robots.txt`, titres et descriptions, données structurées `Product`, NL et FR (`?taal=fr`, `hreflang`).
- **US4** La page d'accueil mène à l'aanbod et à « Klant worden » ; la connexion client reste identique.

## Exigences
- FR-001 Aucune donnée privée : pas de prix négocié, pas de stock, pas de client, pas d'IBAN ; seuls les champs Catalogue publics et les coordonnées publiques (`contactOnly`).
- FR-002 Produit inactif ou inconnu → 404 HTML propre (`noindex`).
- FR-003 Tout texte venant de la base est échappé (HTML et JSON-LD).
- FR-004 `Prix de base` vide ou 0 → « Prijs op aanvraag ».
- FR-005 Adresses stables : slug du nom + calibre ; collision → suffixe `-2`, `-3` dans l'ordre des id.
- FR-006 Cache CDN 10 min (`s-maxage=600, stale-while-revalidate=3600`) ; aucune écriture.
- FR-007 CSP inchangée (aucun script, aucun style inline) ; WCAG 2.2 AA, cibles 44 px, NL/FR.
- FR-008 `robots.txt` : autorise `/`, `/aanbod`, `/aanvraag` ; interdit `/api/`, `/klant`, `/team/`, `/beheer`, `/wachtwoord` ; pointe le sitemap.

## Hors périmètre
Panier public, fidélité, avis clients, blog, newsletter (pas adaptés à 30–60 restaurants à prix négociés).
