/**
 * Le contrat de `/api/questions/<id>` — tenu **une fois**, des deux côtés.
 *
 * La route le produit, le composant client le lit : un renommage d'un côté
 * doit casser l'autre à la compilation, pas en production. Aucun import ici,
 * pour que le module aille aussi bien dans un composant client que dans une
 * route.
 */

/** Une réponse servie : le corps de l'entrée, tel qu'écrit, en Markdown. */
export type HeroAnswer = {
  readonly id: string;
  /** La question du corpus, plus longue que le libellé de la puce. */
  readonly question: string;
  /** Le corps de l'entrée, en Markdown, tel qu'écrit. */
  readonly answer: string;
  /** La clé de citation : `qa:<id>`. */
  readonly sources: readonly string[];
  /**
   * L'identifiant de l'échange journalisé, `null` sans cookies. Le client
   * l'ignore aujourd'hui ; il servira à rattacher un avis ou un signalement
   * à l'échange (admin, story 8) sans deviner lequel.
   */
  readonly exchangeId: string | null;
};

/**
 * Les raisons d'un refus, liste close — le vocabulaire d'AD-16, que les
 * stories 6 et 7 réutiliseront :
 *  - `unknown` : l'identifiant n'est pas une des cinq questions (faute du
 *    client, stable) ;
 *  - `invalid_input` : la langue manque ou n'est pas servie ;
 *  - `content_unavailable` : l'entrée n'est pas ordinaire dans le corpus de
 *    cette langue (défaut du contenu, permanent jusqu'à correction).
 */
export type HeroRefusalReason = 'unknown' | 'invalid_input' | 'content_unavailable';

export type HeroRefusal = {readonly ok: false; readonly reason: HeroRefusalReason};

/** Ce que le panneau affiche d'une réponse. */
export type HeroAnswerView = {readonly question: string; readonly answer: string};

/**
 * Ce que la route a rendu, ou `null` si ce n'est pas une réponse : un corps
 * inattendu — ou vide — vaut un échec, pas un panneau vide.
 */
export function parseHeroAnswer(payload: unknown): HeroAnswerView | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const {question, answer} = payload as {question?: unknown; answer?: unknown};
  if (typeof question !== 'string' || typeof answer !== 'string') return null;
  if (question.trim() === '' || answer.trim() === '') return null;
  return {question, answer};
}

/** Le `reason` d'un refus, s'il en porte un de la liste close. */
export function parseRefusalReason(payload: unknown): HeroRefusalReason | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const {reason} = payload as {reason?: unknown};
  return reason === 'unknown' || reason === 'invalid_input' || reason === 'content_unavailable'
    ? reason
    : null;
}
