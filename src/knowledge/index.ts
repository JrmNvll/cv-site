/**
 * Couche `knowledge` — frontière.
 *
 * Responsabilité : index de récupération lexicale (BM25+) par langue, noyau
 * toujours injecté et index des titres (AD-3).
 *
 * Dépendances autorisées : `content`, `src/lib/`, `src/env.ts`.
 * Interdites : `agent`, `journal`, `app`. `app` n'importe jamais cette couche :
 * seul `agent` assemble un contexte.
 *
 * Implémentée par la story « ancrage ». Vide à dessein ici.
 */
export {};
