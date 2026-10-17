# Feature Specification: Nachtelijke back-up zonder foto's als ze te groot is

**Constat (2026-10-17)** : depuis le 10/10 la sonde `.github/workflows/watch.yml` est rouge (36/40) :
« Laatste back-up mislukt: te groot voor e-mail ». Avec les photos produits, la back-up gzip dépasse 30 Mo :
le mail part sans pièce jointe, donc plus aucune copie hors du portail.

## Exigences
- **FR-001** `api/backup-cron.js` : si la back-up complète dépasse `MAX_ATTACHMENT` et contient des photos, la
  pièce jointe est la back-up SANS photos (`files: []`, toutes les tables), si elle tient sous la limite.
- **FR-002** Le test de restauration de nuit porte sur la pièce jointe réellement envoyée.
- **FR-003** Mail : sujet « FAMO back-up (zonder foto's) », texte qui dit que les photos ne sont pas dedans et
  comment les sauver (Beheer → Systeemstatus → Database → Back-up maken).
- **FR-004** La trace (`recordRun`, `dbadmin.lastBackup`) porte `zonderFotos` ; `/api/health` OK (les données sont
  sauvegardées) → la sonde redevient verte.
- **FR-005** Encore trop gros sans photos : comportement d'avant (résumé, 502, alarme).
- **FR-006** Note « Nieuw » pour Mohsen.

## Tests
`test/ops.test.js` D-01 : limite entre « sans photos » et « avec » → 200, pièce jointe sans photos avec toutes les
commandes, santé OK, `zonderFotos` ; limite 100 octets → 502 comme avant.
