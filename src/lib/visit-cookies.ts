/**
 * Les noms des cookies de visite (AD-14), partagés par celui qui les pose
 * (`src/proxy.ts`) et celui qui les lit (`src/app/_lib/visit.ts`).
 *
 * Un module à part, dans le code partagé, parce que `proxy.ts` charge `@/env`
 * au chargement : l'importer depuis le layout ferait réclamer la configuration
 * au `next build`. Des constantes et une validation sans dépendance — rien
 * d'autre n'a à y vivre.
 */
export const VISITOR_COOKIE = 'cv_visitor';
export const SESSION_COOKIE = 'cv_session';

/**
 * L'étiquette d'un lien (story 12). Jérémie envoie l'adresse du site à une
 * personne nommée, avec `?l=<libellé>` au bout ; `proxy.ts` — le seul endroit
 * qui pose un cookie — la valide, la relaie par ce cookie court et redirige
 * vers l'adresse sans le paramètre, pour que le visiteur ne le voie jamais
 * dans sa barre d'adresse. À la requête suivante, `visit.ts` lit le cookie et
 * `touchSession()` pose l'étiquette **à la création** de la session.
 *
 * Le relais passe par un cookie et non par la chaîne de requête parce qu'une
 * redirection perd celle-ci, et que `proxy.ts` n'atteint pas la couche
 * `journal` : même raison que l'horodatage de session, qui voyage déjà ainsi.
 */
export const LABEL_COOKIE = 'cv_label';

/** Le nom du paramètre dans l'adresse envoyée : `https://…/fr?l=a7f3`. */
export const LABEL_PARAM = 'l';

/** Longueur maximale d'un libellé — assez pour être lisible, trop court pour servir de charge. */
export const LABEL_MAX = 32;

/**
 * Le jeu de caractères accepté. Un libellé vient de l'adresse, donc d'un
 * inconnu : il est borné et restreint **avant** d'entrer dans un cookie ou
 * dans la base, pas à l'affichage. Rien qui demande à être échappé dans une
 * valeur de cookie, dans une URL ou dans du HTML.
 */
export const LABEL_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${LABEL_MAX}}$`);

/**
 * Vrai si la valeur est un libellé acceptable. Toute autre valeur — absente,
 * vide, trop longue, hors du jeu — est **ignorée en silence** : ni cookie, ni
 * redirection, la page est servie normalement. Lu par `proxy.ts` sur le
 * paramètre, et par `visit.ts` sur le cookie : un cookie n'est pas plus digne
 * de confiance qu'une chaîne de requête.
 */
export function isVisitLabel(value: string | undefined | null): value is string {
  return typeof value === 'string' && LABEL_PATTERN.test(value);
}
