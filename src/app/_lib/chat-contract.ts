/**
 * Le contrat de `POST /api/chat` et de `POST /api/match` — tenu **une fois**,
 * des deux côtés (AD-16).
 *
 * La route le produit, le composant client le lit : un renommage d'un côté
 * doit casser l'autre à la compilation, pas en production. Aucun import ici,
 * pour que le module aille aussi bien dans un composant client que dans une
 * route — d'où `QUESTION_MAX_CHARS` et `AD_MAX_CHARS`, recopiés de la couche
 * `agent` et verrouillés par un test : le champ libre, la zone de l'annonce
 * et les routes refusent la même longueur que l'agent, sans l'importer.
 *
 * Deux transports, jamais deux pour la même chose : un refus **préalable** est
 * un JSON `{ok: false, reason}` avec son statut ; un flux ouvert est du
 * `text/event-stream`, trois événements nommés, chacun un JSON sur sa ligne
 * `data:`. Une erreur en cours de flux est un événement, pas un statut. Les
 * deux routes parlent le même flux et les mêmes refus : seul le corps diffère.
 */

/** Une question tient en mille caractères — la valeur de `agent/pricing.ts`. */
export const QUESTION_MAX_CHARS = 1000;

/** Une annonce tient en huit mille caractères — la valeur de `agent/pricing.ts`. */
export const AD_MAX_CHARS = 8000;

/** Ce que le navigateur envoie à `/api/chat`. */
export type ChatRequest = {
  readonly question: string;
  readonly lang: string;
};

/** Ce que le navigateur envoie à `/api/match`. */
export type MatchRequest = {
  readonly ad: string;
  readonly lang: string;
};

/**
 * Un champ texte sans ses blancs, entre 1 et `max` caractères, bien formé
 * (aucune paire de substitution coupée : l'API la refuserait après la
 * réservation), et une langue non vide ; sinon `null`.
 */
function parseTextRequest(payload: unknown, field: string, max: number): {text: string; lang: string} | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const {[field]: value, lang} = payload as Record<string, unknown>;
  if (typeof value !== 'string' || typeof lang !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > max || !text.isWellFormed()) return null;
  if (lang.trim() === '') return null;
  return {text, lang};
}

/**
 * L'annonce coupée à `AD_MAX_CHARS`, sans jamais couper une paire de
 * substitution : si la dernière unité gardée ouvre un caractère astral (un
 * emoji), elle part avec lui. Pour la zone du navigateur, où `maxLength`
 * borne la frappe mais pas toujours un collage.
 */
export function clampAd(value: string): string {
  if (value.length <= AD_MAX_CHARS) return value;
  const last = value.charCodeAt(AD_MAX_CHARS - 1);
  const highSurrogate = last >= 0xd800 && last <= 0xdbff;
  return value.slice(0, highSurrogate ? AD_MAX_CHARS - 1 : AD_MAX_CHARS);
}

/**
 * Le corps tel qu'il part : la question sans ses blancs, la langue telle que
 * la page l'a dite. `null` pour tout ce qui n'est pas ça — pas un objet, une
 * question absente, vide, blanche ou trop longue, une langue absente. La
 * route valide la langue contre le routage ; l'agent revalide tout.
 */
export function parseChatRequest(payload: unknown): ChatRequest | null {
  const parsed = parseTextRequest(payload, 'question', QUESTION_MAX_CHARS);
  return parsed === null ? null : {question: parsed.text, lang: parsed.lang};
}

/** Même règle pour une annonce : `ad` sans ses blancs, entre 1 et `AD_MAX_CHARS`. */
export function parseMatchRequest(payload: unknown): MatchRequest | null {
  const parsed = parseTextRequest(payload, 'ad', AD_MAX_CHARS);
  return parsed === null ? null : {ad: parsed.text, lang: parsed.lang};
}

/** Les raisons d'un refus, liste close (AD-16) — chacune a sa clé `errors.<reason>`. */
export const CHAT_REFUSAL_REASONS = [
  'invalid_input',
  'no_visitor',
  'rate_limited',
  'cap_reached',
  'model_unavailable'
] as const;
export type ChatRefusalReason = (typeof CHAT_REFUSAL_REASONS)[number];

/** Le statut HTTP d'un refus préalable, par raison (AD-16). */
export const CHAT_REFUSAL_STATUS: Readonly<Record<ChatRefusalReason, 400 | 401 | 429 | 503>> = {
  invalid_input: 400,
  no_visitor: 401,
  rate_limited: 429,
  cap_reached: 503,
  model_unavailable: 503
};

export type ChatRefusal = {readonly ok: false; readonly reason: ChatRefusalReason};

/** Le `reason` d'un refus, s'il en porte un de la liste close. */
export function parseChatRefusal(payload: unknown): ChatRefusalReason | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const {reason} = payload as {reason?: unknown};
  return typeof reason === 'string' && (CHAT_REFUSAL_REASONS as readonly string[]).includes(reason)
    ? (reason as ChatRefusalReason)
    : null;
}

/** Les trois événements du flux (AD-16). */
export const CHAT_EVENTS = ['delta', 'done', 'error'] as const;
export type ChatEventName = (typeof CHAT_EVENTS)[number];

export type ChatEvent =
  | {readonly type: 'delta'; readonly text: string}
  | {readonly type: 'done'; readonly sources: readonly string[]; readonly exchangeId: string | null}
  | {readonly type: 'error'; readonly reason: 'model_unavailable'};

/** Un événement SSE : `event: <nom>\ndata: <json>\n\n` — le JSON encode les retours à la ligne du texte. */
export function formatSseEvent(name: ChatEventName, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Un événement reçu, ou `null` si ce n'est pas un des trois avec la forme
 * attendue : un nom inconnu ou un `data` mal formé vaut rien — pas une
 * réponse tronquée à l'écran.
 */
export function parseChatEvent(name: string, data: string): ChatEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (name === 'delta') {
    return typeof record.text === 'string' ? {type: 'delta', text: record.text} : null;
  }
  if (name === 'done') {
    const {sources, exchangeId} = record;
    if (!Array.isArray(sources) || !sources.every((item) => typeof item === 'string')) return null;
    if (exchangeId !== null && typeof exchangeId !== 'string') return null;
    return {type: 'done', sources: sources as string[], exchangeId: exchangeId ?? null};
  }
  if (name === 'error') {
    return record.reason === 'model_unavailable' ? {type: 'error', reason: 'model_unavailable'} : null;
  }
  return null;
}

export type SseDecoder = {
  /** Reçoit un morceau du flux ; rend les événements complets qu'il termine. */
  push(chunk: string): ChatEvent[];
  /** Le flux est fini : rend ce qu'un dernier bloc sans ligne vide finale portait. */
  end(): ChatEvent[];
};

/**
 * Le décodeur du navigateur : `fetch` ne sait pas envoyer un `POST` en
 * `EventSource`, donc le corps se lit en morceaux, et un événement peut être
 * coupé n'importe où. Les blocs sont séparés par une ligne vide ; dans un
 * bloc, `event:` nomme, `data:` porte — sur plusieurs lignes, jointes par un
 * retour à la ligne, comme le format le veut. Un bloc sans nom ou sans donnée
 * ne rend rien.
 */
export function createSseDecoder(): SseDecoder {
  let buffer = '';

  const parseBlock = (block: string): ChatEvent | null => {
    let name = '';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      // Un commentaire (`:`) ou un champ inconnu (`id:`, `retry:`) est ignoré.
    }
    return name === '' || data.length === 0 ? null : parseChatEvent(name, data.join('\n'));
  };

  const drain = (final: boolean): ChatEvent[] => {
    // Un `\r` en toute fin de morceau peut être la moitié d'un CRLF dont le
    // `\n` arrive au morceau suivant : le normaliser maintenant ferait un
    // faux séparateur (`\n` + `\n`) et perdrait un événement. Il attend.
    let carried = '';
    if (!final && buffer.endsWith('\r')) {
      carried = '\r';
      buffer = buffer.slice(0, -1);
    }
    buffer = buffer.replace(/\r\n|\r/g, '\n');
    const events: ChatEvent[] = [];
    let separator = buffer.indexOf('\n\n');
    while (separator !== -1) {
      const event = parseBlock(buffer.slice(0, separator));
      if (event !== null) events.push(event);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf('\n\n');
    }
    if (final && buffer.trim() !== '') {
      const event = parseBlock(buffer);
      if (event !== null) events.push(event);
      buffer = '';
    }
    buffer += carried;
    return events;
  };

  return {
    push(chunk) {
      buffer += chunk;
      return drain(false);
    },
    end() {
      return drain(true);
    }
  };
}
