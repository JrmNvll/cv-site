/**
 * Doublure de `server-only` pour Vitest.
 *
 * Le vrai paquet lève une erreur dès qu'il est chargé hors d'un contexte
 * « React Server » : c'est justement ce qui protège `src/env.ts` d'un import
 * depuis un composant client. Les tests unitaires tournent en Node simple, où
 * cette garde n'a pas de sens — Next, lui, la résout tout seul selon le bundle.
 */
export {};
