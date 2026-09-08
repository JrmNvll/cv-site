/**
 * Couche `journal` — frontière.
 *
 * Responsabilité : seul propriétaire de `usage.db` (`node:sqlite`, fichier dans
 * `DATA_DIR`) — visiteurs, sessions, échanges, cumul de dépense. Écritures en
 * insertion ; aucune suppression, aucune purge, aucune table d'agrégat (AD-7).
 *
 * Dépendances autorisées : `src/env.ts`, `src/lib/`, `node:sqlite`, ses propres types.
 * Interdites : `content`, `knowledge`, `agent`, `app`.
 *
 * Implémentée par la story « journal des visites ». Vide à dessein ici.
 */
export {};
