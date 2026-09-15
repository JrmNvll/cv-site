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
 * lire sans monter le rendu, et la route `/api/questions/<id>` s'y branche pour
 * restituer la réponse écrite par Jérémie sans appeler le modèle — elle ne sert
 * que ces cinq identifiants, et rien d'autre du corpus.
 */

/** Les cinq questions adossées au corpus, dans l'ordre du contrat de contenu. */
export const HERO_QUESTIONS = ['lic-01', 'sit-02', 'ia-01', 'wd-02', 'site-02'] as const;

export type HeroQuestion = (typeof HERO_QUESTIONS)[number];

/** Vrai si la valeur est l'un des cinq identifiants — la liste est close. */
export function isHeroQuestion(value: unknown): value is HeroQuestion {
  return typeof value === 'string' && (HERO_QUESTIONS as readonly string[]).includes(value);
}

/**
 * La sixième n'interroge pas le corpus : elle ouvrira l'évaluation d'adéquation
 * à une annonce (`CAP-4`), qui appelle le modèle. D'où un identifiant à part,
 * et l'accent visuel qui la distingue des cinq autres.
 */
export const MATCH_QUESTION = 'annonce';

/**
 * La question dont le libellé porte un nombre d'années — calculé depuis les
 * expériences (`careerYears`), jamais écrit : « 20 ans » aurait dérivé d'un an
 * chaque année. Sans années calculables, le libellé `assistant.yearsUnknown`
 * prend sa place.
 */
export const YEARS_QUESTION: HeroQuestion = 'wd-02';

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
