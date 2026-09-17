/**
 * Couche `agent` — frontière.
 *
 * Responsabilité : `ask()` (et `match()`, story 7) — assemblage du contexte,
 * passerelle unique vers l'API du modèle, plafond de dépense, limitation de
 * débit, contrôle des citations (AD-3, AD-4, AD-6, AD-17).
 *
 * Dépendances autorisées : `knowledge`, `journal`, `content`, `src/lib/`, `src/env.ts`.
 * Interdites : `app` — et **toute lecture de HTTP** (`next/headers`, `next/server`,
 * en-têtes, cookies). Cette couche reçoit `{ lang, visitorId, sessionId, ip, question }`
 * en paramètres ; elle ne va jamais les chercher elle-même.
 *
 * **Surface publique.** `ask()` et ses types ; rien du SDK ne sort d'ici —
 * `gateway.ts` est le seul fichier qui l'importe. `app` atteint ce module par
 * un import différé dans le gestionnaire de route : `gateway` charge `@/env`,
 * dont le parsage a lieu au chargement, et le build ne doit réclamer aucune
 * variable.
 *
 * L'ordre d'`ask()` : validation de l'entrée, limiteur (trois fenêtres, tout
 * ou rien), historique de la session par `journal`, récupération et noyau par
 * `knowledge`, puis la passerelle — cumul, plafond, réservation, appel,
 * finalisation. Un refus préalable rend `{ok: false, reason}` et n'écrit rien,
 * sauf `cap_reached`, journalisé (AD-16).
 */
import {LANGS, type Lang} from '@/content';
import {recentExchanges} from '@/journal';
import {buildContext, type HistoryTurn} from './context';
import type {AgentEvent} from './events';
import {callModel} from './gateway';
import {take} from './limiter';
import {MAX_QUESTION_CHARS} from './pricing';

export type {AgentEvent} from './events';
export {MAX_QUESTION_CHARS, MAX_TOKENS, MODEL, MONTHLY_CAP_MICRO_USD} from './pricing';
export {LIMITS} from './limiter';

/** Les six derniers échanges de la session précèdent la question (AD-3, c). */
export const HISTORY_TURNS = 6;

/** Ce que `app` a extrait de la requête — jamais la requête elle-même. */
export type AskInput = {
  /** La langue de l'URL, telle quelle : validée ici. */
  readonly lang: string;
  /** `cv_visitor`, un ULID validé par l'appelant. */
  readonly visitorId: string;
  /** `cv_session`, un ULID validé par l'appelant — la session existe déjà. */
  readonly sessionId: string;
  /** Ce que `clientIp(headers)` a rendu. */
  readonly ip: string;
  /** La question, telle que le visiteur l'a tapée : validée ici. */
  readonly question: string;
  /** L'instant de la question ; par défaut, maintenant. Sert aux tests. */
  readonly now?: Date;
};

/**
 * Les raisons d'un refus préalable — le vocabulaire d'AD-16, moins
 * `no_visitor`, qui appartient à `app` : sans cookies, l'agent n'est jamais
 * appelé.
 */
export type AskRefusalReason = 'invalid_input' | 'rate_limited' | 'cap_reached' | 'model_unavailable';

export type AskRefusal = {readonly ok: false; readonly reason: AskRefusalReason};

export type AskStream = {
  readonly ok: true;
  /** L'échange réservé, que `done` répète. */
  readonly exchangeId: string;
  /** `delta`… puis `done` ou `error` ; la file se ferme ensuite. */
  readonly events: AsyncIterable<AgentEvent>;
};

export type AskResult = AskRefusal | AskStream;

function isLang(value: string): value is Lang {
  return (LANGS as readonly string[]).includes(value);
}

/**
 * Les caractères invisibles qu'un `trim()` ne voit pas : espaces de largeur
 * nulle, antiliants, marque d'ordre des octets. Une question qui n'est faite
 * que de ça n'est pas une question — et elle réserverait un appel facturé.
 */
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;

/**
 * La question telle qu'elle part et telle qu'elle est journalisée : sans les
 * caractères invisibles ni les blancs des deux bouts, entre 1 et
 * `MAX_QUESTION_CHARS` caractères. `null` pour tout le reste — vide, blanche,
 * trop longue, pas une chaîne.
 */
export function normalizeQuestion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const question = value.replace(INVISIBLE, '').trim();
  if (question.length === 0 || question.length > MAX_QUESTION_CHARS) return null;
  return question;
}

function history(sessionId: string): readonly HistoryTurn[] {
  try {
    return recentExchanges(sessionId, HISTORY_TURNS).map((exchange) => ({
      kind: exchange.kind,
      question: exchange.question,
      answer: exchange.answer
    }));
  } catch (error) {
    // Un historique illisible n'empêche pas de répondre ; la réservation, elle,
    // échouera si le journal est vraiment hors service.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'agent.history_unavailable',
        reason: error instanceof Error ? error.message : String(error),
        text: "L'historique de la session est illisible : la question part sans lui."
      })
    );
    return [];
  }
}

/**
 * Pose une question libre au modèle, ancrée sur le dossier (CAP-3). Rend un
 * refus préalable — rien n'a été appelé — ou le flux d'événements d'un appel
 * engagé, que l'appelant consomme ou non.
 */
export async function ask(input: AskInput): Promise<AskResult> {
  const question = normalizeQuestion(input.question);
  if (question === null || !isLang(input.lang)) return {ok: false, reason: 'invalid_input'};
  const lang = input.lang;
  const now = input.now ?? new Date();

  // La place prise ici n'est pas rendue si la passerelle refuse ensuite :
  // c'est voulu. Au plafond, chaque question insère une ligne `cap_reached`
  // — le limiteur est la seule borne de ces insertions.
  if (!take({visitorId: input.visitorId, ip: input.ip, now})) {
    return {ok: false, reason: 'rate_limited'};
  }

  const context = buildContext({lang, question, history: history(input.sessionId)});
  return callModel({lang, sessionId: input.sessionId, question, context, now});
}
