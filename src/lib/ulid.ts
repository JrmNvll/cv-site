/**
 * Génération d'identifiants ULID — convention « Identifiants & dates » du squelette.
 *
 * 26 caractères en base 32 de Crockford : 10 pour l'horodatage (48 bits, en
 * millisecondes) puis 16 d'aléa (80 bits). Triable lexicographiquement par
 * ordre de création. Aucune dépendance externe : l'algorithme tient en
 * quelques lignes et `crypto.getRandomValues` est disponible aussi bien dans
 * Node que dans le contexte d'exécution de `proxy.ts`.
 */

/** Alphabet de Crockford : ni I, ni L, ni O, ni U. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LENGTH = 32;
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

/** Longueur totale d'un ULID. */
export const ULID_LENGTH = TIME_LENGTH + RANDOM_LENGTH;

/**
 * Reconnaît un ULID bien formé — sert à rejeter une valeur de cookie forgée.
 *
 * Le premier caractère est borné à `[0-7]` : au-delà, l'horodatage dépasserait
 * les 48 bits et `encodeTime` refuserait de produire une telle valeur. La
 * longueur est dérivée des constantes, jamais figée en dur.
 */
export const ULID_PATTERN = new RegExp(
  `^[0-7][0-9A-HJKMNP-TV-Z]{${ULID_LENGTH - 1}}$`
);

/** Vrai si la valeur est un ULID syntaxiquement valide. */
export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}

function encodeTime(time: number): string {
  if (!Number.isFinite(time) || time < 0 || time > 0xffffffffffff) {
    throw new RangeError(`Horodatage hors des bornes ULID : ${time}`);
  }
  let remaining = Math.floor(time);
  let encoded = '';
  for (let index = 0; index < TIME_LENGTH; index++) {
    const digit = remaining % ENCODING_LENGTH;
    encoded = ENCODING[digit] + encoded;
    remaining = (remaining - digit) / ENCODING_LENGTH;
  }
  return encoded;
}

function encodeRandom(): string {
  // 256 est un multiple de 32 : le modulo ne biaise pas la distribution.
  const bytes = new Uint8Array(RANDOM_LENGTH);
  crypto.getRandomValues(bytes);
  let encoded = '';
  for (let index = 0; index < RANDOM_LENGTH; index++) {
    encoded += ENCODING[bytes[index]! % ENCODING_LENGTH];
  }
  return encoded;
}

/** Produit un ULID. `time` sert aux tests ; par défaut, l'instant courant. */
export function ulid(time: number = Date.now()): string {
  return encodeTime(time) + encodeRandom();
}

/** Relit l'horodatage encodé dans un ULID, en millisecondes. */
export function ulidTime(value: string): number {
  if (!isUlid(value)) {
    throw new TypeError(`ULID invalide : ${value}`);
  }
  let time = 0;
  for (let index = 0; index < TIME_LENGTH; index++) {
    time = time * ENCODING_LENGTH + ENCODING.indexOf(value[index]!);
  }
  return time;
}
