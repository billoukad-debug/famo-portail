# Feature Specification: Vague 1 « en règle et rassurant » (pied de page légal, Privacy, Colofon, santé)

**Créée** : 2026-10-24 · **Statut** : implémentée sur la branche `vague-1-en-regle`, non déployée (attend la
validation du gérant puis le « go » du prestataire) · **Source** : audit public du 24/10/2026
(`~/Documents/Plan Kameha/FAMO/annexe-audit-public-24-10.md`) et plan « famoseafood.be parfait », vague 1.

## Constats (CONFIRMÉ en production le 24/10/2026)
- Nom légal, forme et RPR vides dans Configuratie ; la page Privacy présentait « FAMO Seafood » comme responsable.
- Privacy muette sur Anthropic (lecture des commandes par e-mail, spec 020, tâche T016 restée ouverte), sur la
  réception par Resend, la boîte one.com, les transferts hors UE et la conservation de 90 jours des mails reçus.
- Aucun contact visible sur les pages publiques ; pas de mentions légales ; pas de lien Privacy au moment de la
  collecte (`/aanvraag`).
- `/api/health` publiait version, base, région et état des sauvegardes à n'importe qui.
- Deux gros boutons « Personeel » et « Beheer » sur l'accueil client.

## Exigences
- **FR-001** Pied de page public commun (`K.publicFooter`, `K.fillPublicFooter`, `K.loadPublicFooter` dans
  `assets/ui.js`) sur `/`, `/aanvraag`, `/wachtwoord`, `/privacy`, `/voorwaarden`, `/colofon` : handelsnaam, juridische
  naam + rechtsvorm, adresse, ondernemingsnummer, btw, RPR, FAVV, e-mail (mailto), téléphone (tel), bouton WhatsApp,
  liens Privacy, Voorwaarden, Colofon, Personeel. Un champ vide n'est pas affiché, jamais de valeur inventée.
- **FR-002** Deux champs optionnels dans Beheer → Bedrijf : `WhatsApp` (numéro ; vide = pas de bouton) et
  `FAVV-nummer`. Exposés par `/api/config?public=1` (`whatsapp`, `favv`), comme le téléphone et l'e-mail.
- **FR-003** Lien WhatsApp `https://wa.me/<chiffres>` : `+32 470…`, `0032 470…` et `0470…` donnent `32470…` ;
  moins de 9 ou plus de 15 chiffres : pas de bouton.
- **FR-004** Page `/colofon` (NL « Colofon », FR « Mentions légales ») : éditeur, contact, hébergement et services
  techniques, propriété intellectuelle, liens Privacy et Voorwaarden.
- **FR-005** Privacy NL/FR : commandes par e-mail (données, Anthropic, conservation 90 jours), Resend en réception,
  one.com boîte e-mail, section « transferts hors UE » (art. 44 RGPD), FAVV dans l'identité, date du 24/10/2026.
  **À relire par le conseiller juridique avant la mise en ligne.**
- **FR-006** `/aanvraag` : phrase de finalité + lien vers la Privacy au moment de la collecte.
- **FR-007** Accueil : les boutons « Personeel » et « Beheer » laissent la place au lien discret « Personeel » du
  pied de page (`/team/aanmelden` mène toujours à Beheer). La navigation équipe reste à deux clics.
- **FR-008** `/api/health` : sans session équipe, `{ ok, time, checks: { backup: { ok, ageHours } } }` seulement : ni
  version, ni base, ni région, ni temps de réponse. 200/503 et HEAD inchangés ; la sonde `watch.yml` lit toujours
  `"ok":true` et `checks.backup`. Avec une session équipe (Beheer → Systeemstatus), le détail complet.
- **FR-009** Note « Nieuw » pour le gérant.

## Hors périmètre (vagues suivantes)
CGV (texte du juriste, publié par le gérant), texte indexable dans le HTML et `robots.txt` (vague 2), SEC-01 (après
le 31/10/2026).

## Tests
`test/ops.test.js` D-03 (santé publique réduite, détail avec session) ; `test/vague1.test.js` (lien WhatsApp,
nom légal, pied de page rempli sans valeur inventée, champs WhatsApp/FAVV enregistrés et publics).
