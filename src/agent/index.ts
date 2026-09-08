/**
 * Couche `agent` — frontière.
 *
 * Responsabilité : `ask()` et `match()` — assemblage du contexte, passerelle
 * unique vers Anthropic, plafond de dépense, limitation de débit, contrôle des
 * citations (AD-3, AD-4, AD-6, AD-17).
 *
 * Dépendances autorisées : `knowledge`, `journal`, `content`, `src/lib/`, `src/env.ts`.
 * Interdites : `app` — et **toute lecture de HTTP** (`next/headers`, `next/server`,
 * en-têtes, cookies). Cette couche reçoit `{ lang, visitorId, sessionId, ip, input }`
 * en paramètres ; elle ne va jamais les chercher elle-même.
 *
 * Implémentée par les stories « agent » et « adéquation ». Vide à dessein ici.
 */
export {};
