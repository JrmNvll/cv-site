/**
 * Couche `content` — frontière.
 *
 * Responsabilité : charger et valider le contenu privé depuis `CONTENT_DIR`
 * (`cv.yaml`, `qa.fr.md`, `qa.en.md`, `assets/`), puis produire les deux
 * projections par liste blanche, `display` et `agent` (AD-2, AD-8).
 *
 * Dépendances autorisées : `src/env.ts`, `src/lib/`, la bibliothèque standard.
 * Interdites : `agent`, `journal`, `app` — cette couche est la plus basse et ne
 * connaît rien de ce qui la consomme. Elle est aussi la seule à lire `CONTENT_DIR`.
 *
 * Implémentée par la story « contenu et projections ». Vide à dessein ici.
 */
export {};
