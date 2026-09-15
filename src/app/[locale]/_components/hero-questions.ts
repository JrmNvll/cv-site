/**
 * Les six questions du premier écran — **la correspondance libellé → entrée**.
 *
 * `content-contract.md` la fixe et dit qu'elle « ne se devine pas » : les
 * libellés affichés sont plus courts que les questions du corpus, et rien dans
 * le texte ne permet de retrouver l'entrée qu'ils interrogent. Elle vit donc
 * ici, dans le code, pendant que les libellés vivent dans `messages/*.json`
 * (`assistant.questions.<id>`) — jamais dans le contenu.
 *
 * Module séparé du panneau exprès : il ne dépend de rien, donc un test peut le
 * lire sans monter le rendu, et la story 5 pourra s'y brancher pour restituer la
 * réponse écrite par Jérémie sans appeler le modèle.
 */

/** Les cinq questions adossées au corpus, dans l'ordre du contrat de contenu. */
export const HERO_QUESTIONS = ['lic-01', 'sit-02', 'ia-01', 'wd-02', 'site-02'] as const;

export type HeroQuestion = (typeof HERO_QUESTIONS)[number];

/**
 * La sixième n'interroge pas le corpus : elle ouvrira l'évaluation d'adéquation
 * à une annonce (`CAP-4`), qui appelle le modèle. D'où un identifiant à part,
 * et l'accent visuel qui la distingue des cinq autres.
 */
export const MATCH_QUESTION = 'annonce';

/**
 * Regroupement visuel de la maquette : deux questions courtes, une longue, deux
 * courtes. Les puces s'enroulent d'elles-mêmes sur écran étroit ; ces rangées
 * évitent seulement qu'une question longue entraîne une voisine avec elle.
 */
export const HERO_ROWS: readonly (readonly HeroQuestion[])[] = [
  ['lic-01', 'sit-02'],
  ['ia-01'],
  ['wd-02', 'site-02']
];
