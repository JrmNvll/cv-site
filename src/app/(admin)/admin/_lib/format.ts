/**
 * Mise en forme pour l'admin — et rien d'autre. Ces fonctions ne connaissent
 * ni la base ni la requête : elles reçoivent des valeurs du journal et
 * décident comment les écrire. Isolées, elles se testent sans rendu.
 *
 * Tout est en français de Suisse, à l'heure de Zurich : le journal stocke
 * des instants ISO 8601 UTC, Jérémie lit une heure locale.
 */
import type {ExchangeKind, ExchangeStatus} from '@/journal';

const LOCALE = 'fr-CH';
const TIME_ZONE = 'Europe/Zurich';

const DATE_TIME = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  // `h23`, pas `hour12: false` : selon ICU, ce dernier peut rendre « 24:30 ».
  hourCycle: 'h23'
});

const DATE_TIME_SECONDS = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

const USD = new Intl.NumberFormat(LOCALE, {minimumFractionDigits: 3, maximumFractionDigits: 3});
const INTEGER = new Intl.NumberFormat(LOCALE, {maximumFractionDigits: 0});

/**
 * Un instant ISO 8601 UTC, à l'heure de Zurich : « 17.09.2026 11:40 » — avec
 * les secondes sur demande, pour l'ordre des échanges d'une session. Une
 * valeur illisible est rendue telle quelle : mieux vaut voir ce que la base
 * dit que le déformer.
 */
export function formatInstant(iso: string, options: {readonly seconds?: boolean} = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return (options.seconds ? DATE_TIME_SECONDS : DATE_TIME).format(date);
}

/** Des micro-USD entiers, en USD à trois décimales : « 0,128 USD ». `null` vaut « — ». */
export function formatMicroUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${USD.format(value / 1_000_000)} USD`;
}

/** Un entier, groupé à la suisse : « 1’234 ». `null` vaut « — ». */
export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return INTEGER.format(value);
}

/** Des millisecondes, en secondes à une décimale : « 1,2 s ». `null` vaut « — ». */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return `${new Intl.NumberFormat(LOCALE, {minimumFractionDigits: 1, maximumFractionDigits: 1}).format(ms / 1000)} s`;
}

/**
 * Un ULID abrégé, reconnaissable d'un coup d'œil : les quatre premiers
 * caractères (l'époque) et les quatre derniers (l'aléa) — « 01K5…X7QZ ».
 */
export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

/** Un texte posé par l'admin, ou rien : `null` et la chaîne vide (« retiré ») valent absent. */
export function labelOrNull(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  return text === '' ? null : text;
}

/** Ce qui désigne un visiteur dans une liste : son nom s'il en a un, sinon son identifiant abrégé. */
export function visitorLabel(name: string | null | undefined, id: string): string {
  return labelOrNull(name) ?? shortId(id);
}

/** Ce qui désigne une adresse : son étiquette si elle en a une, sinon l'adresse. */
export function addressLabel(label: string | null | undefined, ip: string): string {
  return labelOrNull(label) ?? ip;
}

/**
 * Le numéro de page d'une chaîne de requête : des chiffres seulement, un
 * entier à partir de 1, sinon la première page — `Number()` accepterait
 * `0x10`, `1e3` ou ` 2 `, pas ceci. `?page=999` est laissé passer : la liste
 * sera vide, et le dira.
 */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || !/^\d{1,7}$/.test(raw)) return 1;
  const page = Number(raw);
  return page >= 1 ? page : 1;
}

/** Les sortes d'échange, en français. */
export const KIND_LABELS: Record<ExchangeKind, string> = {
  hero: 'puce',
  chat: 'question',
  match: 'annonce'
};

/** Les statuts d'un échange, en français. */
export const STATUS_LABELS: Record<ExchangeStatus, string> = {
  pending: 'en cours',
  done: 'répondu',
  model_error: 'erreur du modèle',
  cap_reached: 'plafond atteint'
};

/** Les langues du site, en français. */
export function langLabel(lang: string): string {
  return lang === 'fr' ? 'français' : lang === 'en' ? 'anglais' : lang;
}
