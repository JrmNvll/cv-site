/**
 * La table de prix, **figée dans le code et datée** (AD-6, étape 3) — et les
 * bornes qui protègent l'argent : plafond mensuel, longueur d'une question,
 * longueur d'une réponse.
 *
 * Tout est en **micro-USD entiers** (convention « Identifiants & dates ») : un
 * coût ne se calcule pas en flottants, et la base ne stocke que des entiers.
 * Les prix par jeton dérivent des prix publics par million de jetons du modèle
 * imposé ; l'écriture de cache coûte 1,25 fois l'entrée, la lecture 0,1 fois.
 *
 * Changer un prix, un seuil ou le modèle est une décision à demander, jamais
 * un réglage local : la date ci-dessous dit de quand la table est.
 */

/** Le modèle imposé (AD-6, étape 4). Nulle part ailleurs. */
export const MODEL = 'claude-opus-5';

/** La date de la table de prix : ce qu'elle vaut, elle le vaut à ce jour. */
export const PRICING_DATE = '2026-09-16';

/** Prix publics, en USD par million de jetons. */
const USD_PER_MTOK = {input: 5, output: 25} as const;
const CACHE_WRITE_FACTOR = 1.25;
const CACHE_READ_FACTOR = 0.1;

/**
 * Prix par jeton, en micro-USD (1 USD = 1 000 000 micro-USD ; 1 MTok = 1 000 000
 * jetons — les deux facteurs s'annulent, le prix par jeton en micro-USD est le
 * prix par million en USD). La lecture de cache vaut un demi micro-USD : le
 * total est arrondi à l'entier une fois calculé, jamais jeton par jeton.
 */
export const MICRO_USD_PER_TOKEN = {
  input: USD_PER_MTOK.input,
  output: USD_PER_MTOK.output,
  cacheWrite: USD_PER_MTOK.input * CACHE_WRITE_FACTOR,
  cacheRead: USD_PER_MTOK.input * CACHE_READ_FACTOR
} as const;

/** Le plafond mensuel : 5,00 USD (AD-6, étape 2). */
export const MONTHLY_CAP_MICRO_USD = 5_000_000;

/** `max_tokens` de chaque appel (AD-6, étape 4) — la réflexion s'y compte. */
export const MAX_TOKENS = 1200;

/** Une question tient en mille caractères (AD-6, étape 4). */
export const MAX_QUESTION_CHARS = 1000;

/**
 * Une annonce tient en huit mille caractères (CAP-4, AD-17) : le texte d'une
 * offre d'emploi ordinaire, pas un cahier des charges. Elle est journalisée
 * entière et rejouée une seule fois ; au-delà, la réservation grimperait avec
 * elle pour rien.
 */
export const MAX_AD_CHARS = 8000;

/**
 * Un jeton pour deux caractères : mesuré sur le contenu réel le 2026-09-17 —
 * le noyau (YAML, identifiants, ponctuation) tokenise à ≈ 2,2 caractères par
 * jeton, loin des 3 à 4 d'une prose française. La réservation doit surestimer,
 * jamais l'inverse : c'est elle qui décide du refus au plafond.
 */
export const CHARS_PER_TOKEN = 2;

/**
 * Les quatre compteurs de `usage`, tels que l'API les rend — `null` ou absent
 * quand un compteur n'existe pas. Tout est optionnel : un flux coupé peut ne
 * porter qu'une partie des compteurs, et un coût doit pouvoir s'en déduire.
 */
export type Usage = {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
};

function count(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Le coût réel d'un appel, en micro-USD entiers, depuis ses compteurs. Robuste
 * à un `usage` incomplet, nul ou absent : un compteur qui manque vaut zéro,
 * jamais une exception — c'est appelé dans le chemin d'erreur de la passerelle.
 */
export function costMicroUsd(usage: Usage | null | undefined): number {
  if (usage == null) return 0;
  const total =
    count(usage.input_tokens) * MICRO_USD_PER_TOKEN.input +
    count(usage.output_tokens) * MICRO_USD_PER_TOKEN.output +
    count(usage.cache_creation_input_tokens) * MICRO_USD_PER_TOKEN.cacheWrite +
    count(usage.cache_read_input_tokens) * MICRO_USD_PER_TOKEN.cacheRead;
  return Math.round(total);
}

/**
 * Ce qu'un appel peut coûter au plus, réservé **avant** de l'engager (AD-6,
 * étape 2) : l'entrée estimée au prix de l'**écriture** du cache — le pire cas,
 * celui du premier appel, qui paie le noyau à 1,25 × — plus `MAX_TOKENS` de
 * sortie, comme si le modèle allait au bout. Le premier appel réel (0,128 USD
 * pour une réservation à 0,099) a montré que le prix plein ne suffisait pas.
 */
export function reservationMicroUsd(inputChars: number): number {
  const inputTokens = Math.ceil(Math.max(0, inputChars) / CHARS_PER_TOKEN);
  return Math.round(
    inputTokens * MICRO_USD_PER_TOKEN.cacheWrite + MAX_TOKENS * MICRO_USD_PER_TOKEN.output
  );
}
