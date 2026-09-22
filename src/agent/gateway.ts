/**
 * La passerelle vers l'API du modèle — AD-6 : **le seul fichier qui importe le
 * SDK**, et la seule séquence qui appelle le modèle, sans exception :
 *
 *  1. le cumul du mois — somme de `exchange.cost_micro_usd`, réservations
 *     `pending` comprises, depuis le 1er du mois UTC ;
 *  2. le refus `cap_reached` si cumul + réservation > plafond, journalisé ;
 *  3. l'insertion `pending` avec la réservation — **avant** l'appel ; une
 *     réservation impossible (journal en échec) vaut aucun appel ;
 *  4. l'appel, en flux, deltas filtrés du bloc `<sources>` — et des marques
 *     `[qa:…]` / `[cv:…]` d'une évaluation (AD-17) ;
 *  5. la finalisation avec les quatre compteurs et le coût réel depuis la
 *     table de prix datée — ou, sur erreur, le texte partiel et la réservation.
 *
 * **L'abandon du client n'interrompt ni l'appel ni la finalisation.** L'appel
 * tourne dans une tâche détachée qui pousse ses événements dans une file ; la
 * route les consomme si elle est encore là, et l'échange est finalisé dans
 * tous les cas — un appel facturé est un appel compté.
 *
 * Fins de tour normales : `end_turn`, `max_tokens`, `refusal` — le texte est ce
 * qu'il est, l'échange est `done`. Seule une exception du SDK ou du réseau
 * donne `model_error`. Le délai est borné des deux côtés : connexion par le
 * SDK (une reprise au plus), flux entier par une échéance locale.
 *
 * Une question libre (`kind: 'chat'`) et une annonce à évaluer (`kind:
 * 'match'`) suivent la même séquence ; seul le contrôle final diffère — le
 * bloc pour l'une, la structure en quatre parties et les marques pour l'autre
 * — et une évaluation hors structure est servie quand même, dite par une
 * ligne `agent.match_structure` (les raisons, jamais le texte).
 *
 * Ce module ne lit ni HTTP ni cookies : langue, session, sorte, question et
 * contexte lui sont passés. Il ne journalise jamais un texte : identifiants,
 * compteurs, coûts, classes d'erreur.
 */
import Anthropic from '@anthropic-ai/sdk';
import {env} from '@/env';
import {
  finalizeExchange,
  recordCapRefusal,
  reserveExchange,
  type ExchangeUsage,
  type ModelExchangeKind
} from '@/journal';
import {isValidSource, type Lang} from '@/knowledge';
import {checkCitations, checkMatchCitations, createSourcesFilter, type SourcesFilter} from './citations';
import {contextChars, type ModelContext} from './context';
import {EventQueue, type AgentEvent} from './events';
import {
  costMicroUsd,
  MAX_TOKENS,
  MODEL,
  MONTHLY_CAP_MICRO_USD,
  reservationMicroUsd,
  type Usage
} from './pricing';
import {MATCH_TITLES} from './prompts';

/** L'effort de réflexion : bas — la réflexion adaptative reste active (défaut du modèle). */
export const EFFORT = 'low';
/** Le SDK attend la réponse (ses en-têtes) au plus tant, puis reprend une fois. */
export const CONNECT_TIMEOUT_MS = 30_000;
/**
 * Une reprise au plus, et son prix : si le délai de connexion tombe après que
 * l'API a reçu la requête, l'appel rejoué peut être facturé **deux fois** alors
 * que le journal n'en compte qu'un — celui dont les compteurs reviennent. Le
 * cumul peut donc sous-estimer la dépense réelle, d'au plus un appel par
 * reprise ; c'est dit dans le README, et c'est le prix d'une reprise qui
 * absorbe un incident réseau ordinaire.
 */
export const SDK_MAX_RETRIES = 1;
/** Le flux entier — connexion, deltas, fin — tient là-dedans, sinon il est abandonné. */
export const STREAM_DEADLINE_MS = 120_000;

export type CallModelInput = {
  readonly lang: Lang;
  readonly sessionId: string;
  /** `chat` pour une question libre, `match` pour une annonce : la sorte journalisée, et le contrôle final. */
  readonly kind: ModelExchangeKind;
  /** La question — ou l'annonce entière —, déjà validée par l'agent : journalisée telle quelle. */
  readonly question: string;
  readonly context: ModelContext;
  /** L'instant de l'appel ; par défaut, maintenant. Sert aux tests. */
  readonly now?: Date;
};

export type CallModelRefusal = {readonly ok: false; readonly reason: 'cap_reached' | 'model_unavailable'};
export type CallModelStream = {
  readonly ok: true;
  readonly exchangeId: string;
  readonly events: AsyncIterable<AgentEvent>;
};
export type CallModelResult = CallModelRefusal | CallModelStream;

let sdk: Anthropic | null = null;

/**
 * Un client par processus. La clé et l'adresse viennent de `src/env.ts` et
 * de nulle part ailleurs : l'adresse n'existe qu'en test, pour parler à un
 * simulateur ; en production elle est absente et le SDK vise l'API réelle.
 */
function client(): Anthropic {
  return (sdk ??= new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL,
    maxRetries: SDK_MAX_RETRIES,
    timeout: CONNECT_TIMEOUT_MS
  }));
}

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({level, event, ...fields});
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Ce qu'une erreur dit d'elle-même — une famille, un statut, un type, jamais
 * son corps. La famille vient des classes typées du SDK, de la plus précise à
 * la plus large : un nom de classe serait minifié en production.
 */
function describeError(error: unknown): Record<string, unknown> {
  const family = (() => {
    if (error instanceof Anthropic.APIUserAbortError) return 'aborted';
    if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
    if (error instanceof Anthropic.APIConnectionError) return 'connection';
    if (error instanceof Anthropic.AuthenticationError) return 'authentication';
    if (error instanceof Anthropic.RateLimitError) return 'rate_limit';
    if (error instanceof Anthropic.InternalServerError) return 'server';
    if (error instanceof Anthropic.APIError) return 'api';
    return error instanceof Error ? error.name || 'error' : typeof error;
  })();
  if (error instanceof Anthropic.APIError) {
    return {errorFamily: family, status: error.status ?? null, errorType: error.type ?? null};
  }
  return {errorFamily: family};
}

function toExchangeUsage(usage: Usage | null | undefined): ExchangeUsage | null {
  if (usage == null) return null;
  const whole = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  return {
    inputTokens: whole(usage.input_tokens),
    outputTokens: whole(usage.output_tokens),
    cacheReadTokens: whole(usage.cache_read_input_tokens),
    cacheCreationTokens: whole(usage.cache_creation_input_tokens)
  };
}

/**
 * Le contrôle final selon la sorte : le bloc seul pour une question, la
 * structure et les marques pour une évaluation — dite si elle n'est pas en
 * ordre, servie dans tous les cas.
 */
function checkAnswer(input: CallModelInput, filter: SourcesFilter, exchangeId: string) {
  const isValid = (id: string) => isValidSource(input.lang, id);
  if (input.kind !== 'match') return checkCitations(filter, isValid);
  const check = checkMatchCitations(filter, isValid, MATCH_TITLES[input.lang]);
  if (!check.ok) {
    log('warn', 'agent.match_structure', {
      exchangeId,
      reasons: check.reasons,
      marks: filter.marks().length,
      declared: check.declared.length,
      valid: check.valid.length
    });
  }
  return check;
}

/**
 * Appelle le modèle pour une question ou une annonce, selon la séquence
 * d'AD-6. Rend un refus préalable, ou l'identifiant de l'échange réservé et
 * le flux d'événements.
 */
export function callModel(input: CallModelInput): CallModelResult {
  const now = input.now ?? new Date();
  const reservation = reservationMicroUsd(contextChars(input.context), input.kind);

  // 1 à 3. Cumul du mois, plafond, réservation — **une seule transaction du
  // journal** : la somme et l'insertion `pending` se font sous le même verrou,
  // deux requêtes ne peuvent pas passer toutes deux juste sous le plafond, et
  // aucun `await` glissé ici un jour ne pourra rouvrir la fenêtre. Une
  // réservation impossible (journal en échec) = aucun appel.
  let outcome: ReturnType<typeof reserveExchange>;
  try {
    outcome = reserveExchange({
      sessionId: input.sessionId,
      kind: input.kind,
      question: input.question,
      reservationMicroUsd: reservation,
      capMicroUsd: MONTHLY_CAP_MICRO_USD,
      now
    });
  } catch (error) {
    log('error', 'journal.write_failed', {
      reason: reason(error),
      text: 'La réservation a échoué : aucun appel au modèle.'
    });
    return {ok: false, reason: 'model_unavailable'};
  }

  // 2. Le plafond : cumul + réservation > 5 USD → refus, journalisé, sans appel.
  if (outcome.capReached) {
    log('warn', 'agent.cap_reached', {
      spentMicroUsd: outcome.spentMicroUsd,
      reservationMicroUsd: reservation,
      capMicroUsd: MONTHLY_CAP_MICRO_USD
    });
    try {
      recordCapRefusal({sessionId: input.sessionId, kind: input.kind, question: input.question, now});
    } catch (error) {
      log('error', 'journal.write_failed', {
        reason: reason(error),
        text: 'Le refus au plafond nʼa pas été journalisé.'
      });
    }
    return {ok: false, reason: 'cap_reached'};
  }
  const exchangeId = outcome.id;

  // 4 et 5, détachés : rien de ce qui suit ne dépend du consommateur. Le filet
  // du bout : si `run()` levait hors de son propre `catch`, le rejet serait
  // non géré — un arrêt du processus en production, un échange laissé
  // `pending`, ni `done` ni `error` émis. Ici, c'est dit et la file se ferme.
  const events = new EventQueue<AgentEvent>();
  void run(input, exchangeId, reservation, events).catch((error: unknown) => {
    log('error', 'agent.run_failed', {exchangeId, reason: reason(error)});
    events.push({type: 'error', reason: 'model_unavailable'});
    events.close();
  });
  return {ok: true, exchangeId, events};
}

async function run(
  input: CallModelInput,
  exchangeId: string,
  reservation: number,
  events: EventQueue<AgentEvent>
): Promise<void> {
  const started = performance.now();
  const filter = createSourcesFilter();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), STREAM_DEADLINE_MS);
  /** Les compteurs, connus dès que l'API a envoyé `message_delta` — avant, seule la réservation vaut. */
  let usage: Usage | null = null;

  const finalize = (fields: Parameters<typeof finalizeExchange>[0]): void => {
    try {
      finalizeExchange(fields);
    } catch (error) {
      log('error', 'journal.write_failed', {
        exchangeId,
        reason: reason(error),
        text: "L'échange n'a pas été finalisé ; la réservation reste comptée."
      });
    }
  };

  try {
    const stream = client().messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS[input.kind],
        // Un seul bloc système, règles puis noyau, marqué pour le cache ; les
        // types du contexte sont structurellement ceux du SDK.
        system: [...input.context.system],
        messages: input.context.messages.map((message) => ({...message})),
        output_config: {effort: EFFORT}
      },
      {signal: deadline.signal}
    );

    stream.on('text', (delta) => {
      const released = filter.push(delta);
      if (released !== '') events.push({type: 'delta', text: released});
    });
    stream.on('streamEvent', (event, snapshot) => {
      if (event.type === 'message_delta') usage = snapshot.usage;
    });

    const message = await stream.finalMessage();
    usage = message.usage;

    const released = filter.flush();
    if (released !== '') events.push({type: 'delta', text: released});
    // Une évaluation coupée par `max_tokens` n'a presque jamais ses quatre
    // parties : dite pour elle-même, avant le contrôle de structure qui suivra
    // — deux lignes, deux causes, et Jérémie saura laquelle regarder.
    if (input.kind === 'match' && message.stop_reason === 'max_tokens') {
      log('warn', 'agent.match_truncated', {exchangeId, kind: input.kind, maxTokens: MAX_TOKENS[input.kind]});
    }
    const citations = checkAnswer(input, filter, exchangeId);
    const cost = costMicroUsd(message.usage);
    const latencyMs = performance.now() - started;

    finalize({
      id: exchangeId,
      status: 'done',
      answer: citations.text,
      sources: citations.valid,
      citationOk: citations.ok,
      usage: toExchangeUsage(message.usage),
      costMicroUsd: cost,
      latencyMs
    });
    log('info', 'agent.exchange_done', {
      exchangeId,
      kind: input.kind,
      stopReason: message.stop_reason,
      latencyMs: Math.round(latencyMs),
      costMicroUsd: cost,
      reservationMicroUsd: reservation,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
      declared: citations.declared.length,
      valid: citations.valid.length,
      citationOk: citations.ok
    });
    events.push({type: 'done', sources: citations.valid, exchangeId});
    events.close();
  } catch (error) {
    // Avant tout texte ou en cours de flux : même chemin. Ce qui a été relâché
    // est parti au client, qui le garde ; le journal reçoit le texte partiel.
    filter.flush();
    const partial = filter.text().trimEnd();
    // `== null` : nul ou absent, les deux veulent dire « compteurs inconnus ».
    const known: Usage | null | undefined = usage;
    const cost = known == null ? reservation : costMicroUsd(known);
    const latencyMs = performance.now() - started;

    log('error', 'agent.model_error', {
      exchangeId,
      ...describeError(error),
      timedOut: deadline.signal.aborted,
      partialChars: partial.length,
      latencyMs: Math.round(latencyMs),
      costMicroUsd: cost
    });
    finalize({
      id: exchangeId,
      status: 'model_error',
      answer: partial,
      sources: [],
      citationOk: null,
      usage: toExchangeUsage(known),
      costMicroUsd: cost,
      latencyMs
    });
    events.push({type: 'error', reason: 'model_unavailable'});
    events.close();
  } finally {
    // La file se ferme sur chaque chemin qui aboutit ; si le chemin d'erreur
    // lève lui-même, c'est le filet de `callModel()` qui la ferme — après
    // avoir poussé `error`, ce qu'un `close()` ici rendrait impossible.
    clearTimeout(timer);
  }
}
