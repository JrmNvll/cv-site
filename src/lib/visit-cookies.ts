/**
 * Les noms des deux cookies de visite (AD-14), partagés par celui qui les pose
 * (`src/proxy.ts`) et celui qui les lit (`src/app/_lib/visit.ts`).
 *
 * Un module à part, dans le code partagé, parce que `proxy.ts` charge `@/env`
 * au chargement : l'importer depuis le layout ferait réclamer la configuration
 * au `next build`. Deux constantes, aucun import — rien d'autre n'a à y vivre.
 */
export const VISITOR_COOKIE = 'cv_visitor';
export const SESSION_COOKIE = 'cv_session';
