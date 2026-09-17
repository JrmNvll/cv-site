/**
 * AD-6 — la passerelle, SDK et journal simulés : la séquence réservation →
 * appel → finalisation prouvée par l'ordre des appels ; le refus au plafond et
 * la réservation en échec sans aucun appel ; le coût depuis un `usage` connu ;
 * l'erreur avant et pendant le flux ; le consommateur parti, la finalisation
 * faite quand même. Le bloc `<sources>` est filtré ici aussi — c'est la
 * passerelle qui tient le filtre.
 *
 * La connaissance est réelle, sur la fixture : `qa:lic-01` se cite,
 * `qa:inexistante` non.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AgentEvent} from '@/agent/events';
import {reservationMicroUsd} from '@/agent/pricing';

type Listener = (...args: unknown[]) => void;

const sdk = vi.hoisted(() => {
  class APIError extends Error {
    status: number | undefined;
    type: string | undefined;
    constructor(message: string, status?: number, type?: string) {
      super(message);
      this.name = 'APIError';
      this.status = status;
      this.type = type;
    }
  }
  class RateLimitError extends APIError {
    constructor() {
      super('rate limited', 429, 'rate_limit_error');
      this.name = 'RateLimitError';
    }
  }
  class APIUserAbortError extends APIError {}
  class APIConnectionError extends APIError {}
  class APIConnectionTimeoutError extends APIConnectionError {}
  class AuthenticationError extends APIError {}
  class InternalServerError extends APIError {}

  /** Un flux que le test pilote : deltas, compteurs, fin ou erreur — et l'abandon par le signal. */
  class FakeStream {
    readonly listeners: Record<string, Listener[]> = {};
    private text = '';
    private usage: Record<string, number> | null = null;
    private settle!: (message: unknown) => void;
    private reject!: (error: unknown) => void;
    private readonly final = new Promise<unknown>((resolve, reject) => {
      this.settle = resolve;
      this.reject = reject;
    });
    constructor(options: unknown) {
      const signal = (options as {signal?: AbortSignal} | undefined)?.signal;
      // Comme le SDK : un signal abandonné fait échouer `finalMessage()` par `APIUserAbortError`.
      signal?.addEventListener('abort', () => this.reject(new APIUserAbortError('aborted')));
    }
    on(event: string, listener: Listener): this {
      (this.listeners[event] ??= []).push(listener);
      return this;
    }
    finalMessage(): Promise<unknown> {
      return this.final;
    }
    /** Un `content_block_delta` de texte : le SDK émet `text` avec le delta et le cumul. */
    emitText(delta: string): void {
      this.text += delta;
      for (const listener of this.listeners.text ?? []) listener(delta, this.text);
    }
    /** Le `message_delta` de l'API, qui porte les compteurs définitifs. */
    emitUsage(usage: Record<string, number>): void {
      this.usage = usage;
      for (const listener of this.listeners.streamEvent ?? []) {
        listener({type: 'message_delta'}, {usage: {...usage}});
      }
    }
    finish(stopReason = 'end_turn'): void {
      this.settle({
        stop_reason: stopReason,
        content: [{type: 'text', text: this.text}],
        usage: this.usage ?? {input_tokens: 0, output_tokens: 0}
      });
    }
    fail(error: unknown): void {
      this.reject(error);
    }
  }

  const state = {
    constructed: [] as unknown[],
    calls: [] as {params: Record<string, unknown>; options: unknown; stream: FakeStream}[],
    stream: vi.fn()
  };

  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static APIUserAbortError = APIUserAbortError;
    static APIConnectionError = APIConnectionError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    static AuthenticationError = AuthenticationError;
    static InternalServerError = InternalServerError;
    messages = {
      stream: (params: Record<string, unknown>, options: unknown) => {
        const stream = new FakeStream(options);
        state.calls.push({params, options, stream});
        state.stream(params, options);
        return stream;
      }
    };
    constructor(options: unknown) {
      state.constructed.push(options);
    }
  }

  return {Anthropic, APIError, RateLimitError, APIUserAbortError, FakeStream, state};
});

const journal = vi.hoisted(() => ({
  recordCapRefusal: vi.fn(),
  reserveExchange: vi.fn(),
  finalizeExchange: vi.fn()
}));

vi.mock('@anthropic-ai/sdk', () => ({default: sdk.Anthropic}));
vi.mock('@/journal', () => journal);

type Gateway = typeof import('@/agent/gateway');
type Context = typeof import('@/agent/context');
let gateway: Gateway;
let buildContext: Context['buildContext'];

const SESSION_ID = '01K4EXAMPSESS0000000000000';
const EXCHANGE_ID = '01K4EXAMPXCHG0000000000000';
const NOW = new Date('2026-09-15T10:00:00.000Z');

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const found: AgentEvent[] = [];
  for await (const event of events) found.push(event);
  return found;
}

/** Un appel engagé sur la fixture ; le flux simulé attend le pilotage du test. */
function engage(question = 'Pourquoi la personne fictive est-elle en recherche ?') {
  const context = buildContext({lang: 'fr', question, history: []});
  const result = gateway.callModel({lang: 'fr', sessionId: SESSION_ID, kind: 'chat', question, context, now: NOW});
  if (!result.ok) throw new Error(`refusé : ${result.reason}`);
  const call = sdk.state.calls.at(-1)!;
  return {result, context, stream: call.stream, params: call.params, options: call.options};
}

/** Une évaluation engagée sur la fixture, en `kind: 'match'`, dans la langue voulue. */
function engageMatch(lang: 'fr' | 'en' = 'fr', ad = 'Poste fictif : dix ans de parcours demandés.') {
  const context = buildContext({lang, question: ad, history: [], mode: 'match'});
  const result = gateway.callModel({lang, sessionId: SESSION_ID, kind: 'match', question: ad, context, now: NOW});
  if (!result.ok) throw new Error(`refusé : ${result.reason}`);
  const call = sdk.state.calls.at(-1)!;
  return {result, context, stream: call.stream, params: call.params};
}

/** Laisse la tâche détachée de la passerelle avancer jusqu'à sa finalisation. */
async function settled(): Promise<void> {
  for (let n = 0; n < 10; n += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  vi.resetAllMocks();
  sdk.state.calls.length = 0;
  sdk.state.constructed.length = 0;
  vi.resetModules();
  gateway = await import('@/agent/gateway');
  ({buildContext} = await import('@/agent/context'));
  journal.reserveExchange.mockReturnValue({id: EXCHANGE_ID});
  journal.recordCapRefusal.mockReturnValue({id: EXCHANGE_ID});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('une question couverte', () => {
  it('réserve, appelle, filtre le bloc <sources> fragmenté, finalise avec les compteurs et le coût réel', async () => {
    const {result, stream, context} = engage();
    const reservation = reservationMicroUsd(
      context.system[0].text.length + context.messages.reduce((n, m) => n + m.content.length, 0)
    );

    // Avant tout : la réservation, avec ce que la passerelle a estimé, et le plafond que le journal applique.
    expect(journal.reserveExchange).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      kind: 'chat',
      question: 'Pourquoi la personne fictive est-elle en recherche ?',
      reservationMicroUsd: reservation,
      capMicroUsd: 5_000_000,
      now: NOW
    });
    expect(result.exchangeId).toBe(EXCHANGE_ID);

    stream.emitText('Elle cherche ');
    stream.emitText('un poste **fictif**.\n\n<sour');
    stream.emitText('ces>qa:inexistante, qa:lic-01</sources>');
    stream.emitUsage({input_tokens: 3000, output_tokens: 40, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0});
    stream.finish();

    const events = await collect(result.events);
    expect(events).toEqual([
      {type: 'delta', text: 'Elle cherche '},
      {type: 'delta', text: 'un poste **fictif**.\n\n'},
      {type: 'done', sources: ['qa:lic-01'], exchangeId: EXCHANGE_ID}
    ]);
    // Rien du bloc n'est sorti.
    expect(JSON.stringify(events)).not.toContain('sources>');
    expect(JSON.stringify(events)).not.toContain('inexistante');

    expect(journal.finalizeExchange).toHaveBeenCalledTimes(1);
    expect(journal.finalizeExchange).toHaveBeenCalledWith({
      id: EXCHANGE_ID,
      status: 'done',
      answer: 'Elle cherche un poste **fictif**.',
      sources: ['qa:lic-01'],
      citationOk: false,
      usage: {inputTokens: 3000, outputTokens: 40, cacheReadTokens: 8000, cacheCreationTokens: 0},
      costMicroUsd: 3000 * 5 + 40 * 25 + 8000 * 0.5,
      latencyMs: expect.any(Number)
    });
    // L'ordre, prouvé : réservation → appel → finalisation.
    const order = (fn: {mock: {invocationCallOrder: number[]}}) => fn.mock.invocationCallOrder[0]!;
    expect(order(journal.reserveExchange)).toBeLessThan(order(sdk.state.stream));
    expect(order(sdk.state.stream)).toBeLessThan(order(journal.finalizeExchange));
  });

  it('envoie ce quʼAD-6 impose : claude-opus-5, max_tokens 1 200, effort bas, un bloc système en cache, la clé et lʼadresse explicites', () => {
    const {params, options, context} = engage();

    expect(params).toEqual({
      model: 'claude-opus-5',
      max_tokens: 1200,
      system: [{type: 'text', text: context.system[0].text, cache_control: {type: 'ephemeral'}}],
      messages: context.messages.map((message) => ({role: message.role, content: message.content})),
      output_config: {effort: 'low'}
    });
    // Ni réflexion désactivée, ni température : la réflexion adaptative est le défaut du modèle.
    expect(params).not.toHaveProperty('thinking');
    expect(params).not.toHaveProperty('temperature');
    expect(options).toEqual({signal: expect.any(AbortSignal)});
    expect(sdk.state.constructed).toEqual([
      {
        apiKey: 'cle-de-test-sans-valeur',
        baseURL: 'http://127.0.0.1:9',
        maxRetries: gateway.SDK_MAX_RETRIES,
        timeout: gateway.CONNECT_TIMEOUT_MS
      }
    ]);
    expect(gateway.SDK_MAX_RETRIES).toBe(1);
  });

  it('un refus hors périmètre, sans bloc : done sans source, citation en ordre', async () => {
    const {result, stream} = engage('Quelle est la capitale de la Lune ?');
    stream.emitText('Le dossier ne couvre pas ce point.');
    stream.emitUsage({input_tokens: 10, output_tokens: 8});
    stream.finish();

    expect(await collect(result.events)).toEqual([
      {type: 'delta', text: 'Le dossier ne couvre pas ce point.'},
      {type: 'done', sources: [], exchangeId: EXCHANGE_ID}
    ]);
    expect(journal.finalizeExchange).toHaveBeenCalledWith(
      expect.objectContaining({status: 'done', sources: [], citationOk: true, costMicroUsd: 250})
    );
  });

  it.each(['max_tokens', 'refusal'])('une fin de tour « %s » est une fin normale : done', async (stopReason) => {
    const {result, stream} = engage();
    stream.emitText('Début');
    stream.emitUsage({input_tokens: 1, output_tokens: 1});
    stream.finish(stopReason);

    expect((await collect(result.events)).at(-1)).toEqual({type: 'done', sources: [], exchangeId: EXCHANGE_ID});
    expect(journal.finalizeExchange).toHaveBeenCalledWith(expect.objectContaining({status: 'done', answer: 'Début'}));
  });

  it('relâche à la fin un « < » qui nʼétait pas le bloc', async () => {
    const {result, stream} = engage();
    stream.emitText('2 <');
    stream.emitUsage({input_tokens: 1, output_tokens: 1});
    stream.finish();

    expect(await collect(result.events)).toEqual([
      {type: 'delta', text: '2 '},
      {type: 'delta', text: '<'},
      {type: 'done', sources: [], exchangeId: EXCHANGE_ID}
    ]);
  });
});

describe('le plafond (AD-6, étape 2)', () => {
  it('refuse sans appel quand le journal dit que cumul + réservation dépasse 5 USD, et journalise le refus', () => {
    // C'est le journal qui décide, dans sa transaction ; la passerelle lui
    // passe le plafond et journalise le refus qu'il rend.
    journal.reserveExchange.mockReturnValue({capReached: true, spentMicroUsd: 4_990_000});
    const context = buildContext({lang: 'fr', question: 'Q ?', history: []});

    const result = gateway.callModel({lang: 'fr', sessionId: SESSION_ID, kind: 'chat', question: 'Q ?', context, now: NOW});

    expect(result).toEqual({ok: false, reason: 'cap_reached'});
    expect(sdk.state.stream).not.toHaveBeenCalled();
    expect(journal.reserveExchange).toHaveBeenCalledWith(expect.objectContaining({capMicroUsd: 5_000_000}));
    expect(journal.recordCapRefusal).toHaveBeenCalledWith({sessionId: SESSION_ID, kind: 'chat', question: 'Q ?', now: NOW});
    const ligne = vi
      .mocked(console.warn)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.event === 'agent.cap_reached');
    expect(ligne).toMatchObject({spentMicroUsd: 4_990_000, capMicroUsd: 5_000_000});
    expect(journal.finalizeExchange).not.toHaveBeenCalled();
  });

  it('refuse quand même si le refus ne peut pas être journalisé, et le dit', () => {
    journal.reserveExchange.mockReturnValue({capReached: true, spentMicroUsd: 5_000_000});
    journal.recordCapRefusal.mockImplementation(() => {
      throw new Error('disque plein (simulé)');
    });
    const context = buildContext({lang: 'fr', question: 'Q ?', history: []});

    expect(gateway.callModel({lang: 'fr', sessionId: SESSION_ID, kind: 'chat', question: 'Q ?', context, now: NOW})).toEqual({
      ok: false,
      reason: 'cap_reached'
    });
    expect(sdk.state.stream).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.some((call) => String(call[0]).includes('journal.write_failed'))).toBe(true);
  });
});

describe('réservation impossible (AD-6, étape 3)', () => {
  it('ne fait aucun appel quand lʼinsertion pending échoue : model_unavailable, journal.write_failed', () => {
    journal.reserveExchange.mockImplementation(() => {
      throw new Error('base verrouillée (simulé)');
    });
    const context = buildContext({lang: 'fr', question: 'Q ?', history: []});

    const result = gateway.callModel({lang: 'fr', sessionId: SESSION_ID, kind: 'chat', question: 'Q ?', context, now: NOW});

    expect(result).toEqual({ok: false, reason: 'model_unavailable'});
    expect(sdk.state.stream).not.toHaveBeenCalled();
    const lignes = vi.mocked(console.error).mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(lignes).toEqual([expect.objectContaining({event: 'journal.write_failed', reason: expect.stringContaining('verrouillée')})]);
  });

});

describe('lʼéchéance du flux', () => {
  it(`abandonne lʼappel après STREAM_DEADLINE_MS : model_error à la réservation, error, ligne timedOut`, async () => {
    vi.useFakeTimers();
    const {result, stream, context} = engage();
    const reservation = reservationMicroUsd(
      context.system[0].text.length + context.messages.reduce((n, m) => n + m.content.length, 0)
    );
    stream.emitText('Un début');

    vi.advanceTimersByTime(gateway.STREAM_DEADLINE_MS);
    const events = await collect(result.events);

    expect(events).toEqual([{type: 'delta', text: 'Un début'}, {type: 'error', reason: 'model_unavailable'}]);
    expect(journal.finalizeExchange).toHaveBeenCalledWith(
      expect.objectContaining({status: 'model_error', answer: 'Un début', usage: null, costMicroUsd: reservation})
    );
    const ligne = vi
      .mocked(console.error)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.event === 'agent.model_error');
    expect(ligne).toMatchObject({exchangeId: EXCHANGE_ID, errorFamily: 'aborted', timedOut: true});
  });

  it('nʼabandonne pas un flux qui finit à temps', async () => {
    vi.useFakeTimers();
    const {result, stream} = engage();
    vi.advanceTimersByTime(gateway.STREAM_DEADLINE_MS - 1);
    stream.emitText('À temps');
    stream.emitUsage({input_tokens: 1, output_tokens: 1});
    stream.finish();

    expect((await collect(result.events)).at(-1)).toEqual({type: 'done', sources: [], exchangeId: EXCHANGE_ID});
    vi.advanceTimersByTime(10);
    expect(journal.finalizeExchange).toHaveBeenCalledTimes(1);
  });
});

describe('le filet du bout', () => {
  it('si le chemin dʼerreur lève lui-même, la file se ferme sur error et agent.run_failed est dit', async () => {
    // Le journal applicatif lève au premier appel — c'est le `catch` de `run()`
    // qui écrit `agent.model_error` : il lève donc hors de son propre `catch`.
    let calls = 0;
    vi.mocked(console.error).mockImplementation(() => {
      calls += 1;
      if (calls === 1) throw new Error('stdout fermé (simulé)');
    });
    const {result, stream} = engage();
    stream.fail(new Error('coupure'));

    expect(await collect(result.events)).toEqual([{type: 'error', reason: 'model_unavailable'}]);
    const lignes = vi
      .mocked(console.error)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(lignes.find((entry) => entry.event === 'agent.run_failed')).toMatchObject({
      exchangeId: EXCHANGE_ID,
      reason: expect.stringContaining('stdout fermé')
    });
  });
});

describe('lʼAPI en erreur', () => {
  it('avant tout texte : error seul, model_error sans réponse, coût = réservation', async () => {
    const {result, stream, context} = engage();
    const reservation = reservationMicroUsd(
      context.system[0].text.length + context.messages.reduce((n, m) => n + m.content.length, 0)
    );
    stream.fail(new sdk.RateLimitError());

    expect(await collect(result.events)).toEqual([{type: 'error', reason: 'model_unavailable'}]);
    expect(journal.finalizeExchange).toHaveBeenCalledWith({
      id: EXCHANGE_ID,
      status: 'model_error',
      answer: '',
      sources: [],
      citationOk: null,
      usage: null,
      costMicroUsd: reservation,
      latencyMs: expect.any(Number)
    });
    // Le journal applicatif dit la classe et le statut, jamais un texte.
    const ligne = vi
      .mocked(console.error)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.event === 'agent.model_error');
    expect(ligne).toMatchObject({exchangeId: EXCHANGE_ID, errorFamily: 'rate_limit', status: 429, errorType: 'rate_limit_error'});
  });

  it('en cours de flux, compteurs inconnus : les deltas puis error ; le texte partiel journalisé, coût = réservation', async () => {
    const {result, stream, context} = engage();
    const reservation = reservationMicroUsd(
      context.system[0].text.length + context.messages.reduce((n, m) => n + m.content.length, 0)
    );
    stream.emitText('Début de ');
    stream.emitText('réponse <sour');
    stream.fail(new sdk.APIError('overloaded', 529, 'overloaded_error'));

    expect(await collect(result.events)).toEqual([
      {type: 'delta', text: 'Début de '},
      {type: 'delta', text: 'réponse '},
      {type: 'error', reason: 'model_unavailable'}
    ]);
    expect(journal.finalizeExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'model_error',
        // Le « <sour » retenu est relâché dans le texte journalisé : ce n'était pas un bloc.
        answer: 'Début de réponse <sour',
        sources: [],
        citationOk: null,
        usage: null,
        costMicroUsd: reservation
      })
    );
  });

  it('en cours de flux, compteurs connus : le coût réel plutôt que la réservation', async () => {
    const {result, stream} = engage();
    stream.emitText('Début');
    stream.emitUsage({input_tokens: 2000, output_tokens: 5, cache_read_input_tokens: 4000});
    stream.fail(new Error('socket hang up'));

    expect((await collect(result.events)).at(-1)).toEqual({type: 'error', reason: 'model_unavailable'});
    expect(journal.finalizeExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'model_error',
        answer: 'Début',
        usage: {inputTokens: 2000, outputTokens: 5, cacheReadTokens: 4000, cacheCreationTokens: 0},
        costMicroUsd: 2000 * 5 + 5 * 25 + 4000 * 0.5
      })
    );
  });

  it('un bloc ouvert et jamais refermé au moment de lʼerreur ne sort pas', async () => {
    const {result, stream} = engage();
    stream.emitText('Réponse.\n<sources>qa:lic-01');
    stream.fail(new Error('coupure'));

    expect(await collect(result.events)).toEqual([
      {type: 'delta', text: 'Réponse.\n'},
      {type: 'error', reason: 'model_unavailable'}
    ]);
  });
});

describe('le consommateur parti', () => {
  it('nʼinterrompt ni lʼappel ni la finalisation : le journal est complet', async () => {
    const {result, stream} = engage();
    const iterator = result.events[Symbol.asyncIterator]();
    stream.emitText('Premier ');
    expect(await iterator.next()).toEqual({done: false, value: {type: 'delta', text: 'Premier '}});
    // L'onglet se ferme : la route lâche l'itérateur.
    await iterator.return?.();

    stream.emitText('second.\n<sources>qa:lic-01</sources>');
    stream.emitUsage({input_tokens: 100, output_tokens: 10});
    stream.finish();
    await settled();

    expect(journal.finalizeExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'done',
        answer: 'Premier second.',
        sources: ['qa:lic-01'],
        citationOk: true,
        costMicroUsd: 100 * 5 + 10 * 25
      })
    );
  });

  it('émet quand même done quand la finalisation échoue, et le dit : la réservation reste comptée', async () => {
    journal.finalizeExchange.mockImplementation(() => {
      throw new Error('disque plein (simulé)');
    });
    const {result, stream} = engage();
    stream.emitText('R.');
    stream.emitUsage({input_tokens: 1, output_tokens: 1});
    stream.finish();

    expect((await collect(result.events)).at(-1)).toEqual({type: 'done', sources: [], exchangeId: EXCHANGE_ID});
    const lignes = vi.mocked(console.error).mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    expect(lignes).toEqual([expect.objectContaining({event: 'journal.write_failed', exchangeId: EXCHANGE_ID})]);
  });
});

describe('ce que la passerelle ne journalise jamais', () => {
  it('aucun texte de question ni de réponse dans les lignes applicatives', async () => {
    const {result, stream} = engage('Question-Sentinelle-Journal ?');
    stream.emitText('Réponse-Sentinelle-Journal.');
    stream.emitUsage({input_tokens: 1, output_tokens: 1});
    stream.finish();
    await collect(result.events);

    const tout = [console.info, console.warn, console.error]
      .flatMap((fn) => vi.mocked(fn).mock.calls)
      .map((call) => String(call[0]))
      .join('\n');
    expect(tout).toContain('agent.exchange_done');
    expect(tout).not.toContain('Sentinelle-Journal');
  });
});

describe('une évaluation dʼannonce (kind match, AD-17)', () => {
  const EVALUATION_FR =
    '**Points forts**\n- Dix ans de parcours fictif [cv:profil] [qa:lic-01]\n\n' +
    '**Compétences transférables**\n- Un outil voisin [voir CV] [qa:sit-02]\n\n' +
    '**Écarts**\n- Une certification : non documenté dans le dossier\n\n' +
    '**Conclusion**\nUn échange direct dira le reste.\n\n<sources>qa:lic-01, cv:profil</sources>';

  it('réserve et journalise en kind match, retient les marques fragmentées et le bloc, finalise avec lʼunion des sources', async () => {
    const {result, stream} = engageMatch();

    expect(journal.reserveExchange).toHaveBeenCalledWith(
      expect.objectContaining({kind: 'match', question: 'Poste fictif : dix ans de parcours demandés.'})
    );

    stream.emitText('**Points forts**\n- Dix ans de parcours fictif [cv:pro');
    stream.emitText('fil] [qa:l');
    stream.emitText('ic-01]\n\n**Compétences transférables**\n- Un outil voisin [voir CV] [qa:sit-02]\n\n');
    stream.emitText('**Écarts**\n- Une certification : non documenté dans le dossier\n\n');
    stream.emitText('**Conclusion**\nUn échange direct dira le reste.\n\n<sour');
    stream.emitText('ces>qa:lic-01, cv:profil</sources>');
    stream.emitUsage({input_tokens: 3000, output_tokens: 200, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0});
    stream.finish();

    const events = await collect(result.events);
    const deltas = events.filter((event) => event.type === 'delta').map((event) => (event as {text: string}).text);
    // Rien d'une marque ni du bloc ne sort ; le « [voir CV] » sort, lui.
    const sorti = deltas.join('');
    expect(sorti).not.toMatch(/\[(qa|cv):/);
    expect(sorti).not.toContain('sources>');
    expect(sorti).not.toContain('lic-01');
    expect(sorti).toContain('[voir CV]');
    expect(sorti.replace(/[ \t]+$/gm, '').trimEnd()).toBe(
      EVALUATION_FR.replace(/ \[(qa|cv):[^\]]+\]/g, '').replace(/\n\n<sources>.*$/, '')
    );
    expect(events.at(-1)).toEqual({type: 'done', sources: ['cv:profil', 'qa:lic-01', 'qa:sit-02'], exchangeId: EXCHANGE_ID});

    expect(journal.finalizeExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'done',
        answer:
          '**Points forts**\n- Dix ans de parcours fictif\n\n' +
          '**Compétences transférables**\n- Un outil voisin [voir CV]\n\n' +
          '**Écarts**\n- Une certification : non documenté dans le dossier\n\n' +
          '**Conclusion**\nUn échange direct dira le reste.',
        sources: ['cv:profil', 'qa:lic-01', 'qa:sit-02'],
        citationOk: true
      })
    );
    const lignes = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(lignes.some((ligne) => ligne.includes('agent.match_structure'))).toBe(false);
    const done = vi
      .mocked(console.info)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.event === 'agent.exchange_done');
    expect(done).toMatchObject({kind: 'match', citationOk: true, valid: 3});
  });

  it('une marque invalide : retirée du flux et des sources, citation_ok = 0, agent.match_structure avec la raison', async () => {
    const {result, stream} = engageMatch();
    stream.emitText(EVALUATION_FR.replace('[qa:sit-02]', '[qa:inexistante]'));
    stream.emitUsage({input_tokens: 1, output_tokens: 1});
    stream.finish();

    const events = await collect(result.events);
    expect(JSON.stringify(events)).not.toContain('inexistante');
    expect(events.at(-1)).toEqual({type: 'done', sources: ['cv:profil', 'qa:lic-01'], exchangeId: EXCHANGE_ID});
    expect(journal.finalizeExchange).toHaveBeenCalledWith(
      expect.objectContaining({status: 'done', sources: ['cv:profil', 'qa:lic-01'], citationOk: false})
    );
    const ligne = vi
      .mocked(console.warn)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.event === 'agent.match_structure');
    // Trois marques, un bloc de deux : l'union en déclare trois, dont une invalide.
    expect(ligne).toMatchObject({exchangeId: EXCHANGE_ID, reasons: ['invalid_mark'], marks: 3, declared: 3, valid: 2});
    // Jamais le texte.
    expect(JSON.stringify(ligne)).not.toContain('Points forts');
  });

  it('une structure absente ou désordonnée : servie telle quelle, citation_ok = 0, la raison dite', async () => {
    const {result, stream} = engageMatch();
    stream.emitText('Le dossier ne couvre pas cette annonce. [qa:lic-01]');
    stream.emitUsage({input_tokens: 1, output_tokens: 1});
    stream.finish();

    expect(await collect(result.events)).toEqual([
      {type: 'delta', text: 'Le dossier ne couvre pas cette annonce. '},
      {type: 'done', sources: ['qa:lic-01'], exchangeId: EXCHANGE_ID}
    ]);
    expect(journal.finalizeExchange).toHaveBeenCalledWith(
      expect.objectContaining({status: 'done', answer: 'Le dossier ne couvre pas cette annonce.', citationOk: false})
    );
    const ligne = vi
      .mocked(console.warn)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
      .find((entry) => entry.event === 'agent.match_structure');
    expect(ligne).toMatchObject({reasons: ['missing_title']});
  });

  it('en anglais, cherche les titres anglais', async () => {
    const {result, stream} = engageMatch('en', 'Fictional position: ten years of career required.');
    stream.emitText(
      '**Strengths**\n- Ten years [cv:profil]\n\n**Transferable skills**\n- A tool [qa:lic-01]\n\n' +
        '**Gaps**\n- A certification: not documented in the dossier\n\n**Conclusion**\nAsk directly.\n\n<sources>cv:profil</sources>'
    );
    stream.emitUsage({input_tokens: 1, output_tokens: 1});
    stream.finish();

    expect((await collect(result.events)).at(-1)).toEqual({type: 'done', sources: ['cv:profil', 'qa:lic-01'], exchangeId: EXCHANGE_ID});
    expect(journal.finalizeExchange).toHaveBeenCalledWith(expect.objectContaining({citationOk: true}));
  });

  it('refusée au plafond : journalisée en kind match', () => {
    journal.reserveExchange.mockReturnValue({capReached: true, spentMicroUsd: 4_990_000});
    const context = buildContext({lang: 'fr', question: 'Annonce', history: [], mode: 'match'});

    const result = gateway.callModel({lang: 'fr', sessionId: SESSION_ID, kind: 'match', question: 'Annonce', context, now: NOW});

    expect(result).toEqual({ok: false, reason: 'cap_reached'});
    expect(sdk.state.stream).not.toHaveBeenCalled();
    expect(journal.recordCapRefusal).toHaveBeenCalledWith({sessionId: SESSION_ID, kind: 'match', question: 'Annonce', now: NOW});
  });

  it('une marque ouverte au moment dʼune erreur ne sort pas, et le texte partiel journalisé ne la porte pas non plus', async () => {
    const {result, stream} = engageMatch();
    stream.emitText('**Points forts**\n- Dix ans [cv:pro');
    stream.fail(new Error('coupure'));

    expect(await collect(result.events)).toEqual([
      {type: 'delta', text: '**Points forts**\n- Dix ans '},
      {type: 'error', reason: 'model_unavailable'}
    ]);
    expect(journal.finalizeExchange).toHaveBeenCalledWith(
      expect.objectContaining({status: 'model_error', answer: '**Points forts**\n- Dix ans', citationOk: null})
    );
  });

  it('une question libre nʼest pas contrôlée comme une évaluation : pas de agent.match_structure', async () => {
    const {result, stream} = engage();
    stream.emitText('Réponse libre sans titres.\n<sources>qa:lic-01</sources>');
    stream.emitUsage({input_tokens: 1, output_tokens: 1});
    stream.finish();
    await collect(result.events);

    expect(journal.finalizeExchange).toHaveBeenCalledWith(expect.objectContaining({citationOk: true}));
    const lignes = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(lignes.some((ligne) => ligne.includes('agent.match_structure'))).toBe(false);
  });

  it('coupée par max_tokens : une ligne agent.match_truncated dédiée, puis agent.match_structure — done quand même', async () => {
    const {result, stream} = engageMatch();
    stream.emitText('**Points forts**\n- Dix ans [cv:profil]\n\n**Compétences transférables**\n- Un outil');
    stream.emitUsage({input_tokens: 10, output_tokens: 1200});
    stream.finish('max_tokens');

    expect((await collect(result.events)).at(-1)).toMatchObject({type: 'done', sources: ['cv:profil']});
    expect(journal.finalizeExchange).toHaveBeenCalledWith(expect.objectContaining({status: 'done', citationOk: false}));
    const lignes = vi
      .mocked(console.warn)
      .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
    const tronquee = lignes.findIndex((entry) => entry.event === 'agent.match_truncated');
    const structure = lignes.findIndex((entry) => entry.event === 'agent.match_structure');
    expect(lignes[tronquee]).toMatchObject({exchangeId: EXCHANGE_ID, kind: 'match', maxTokens: 1200});
    expect(lignes[structure]).toMatchObject({reasons: ['missing_title']});
    expect(tronquee).toBeLessThan(structure);
    // Une question libre coupée par max_tokens ne dit rien de tel.
    vi.mocked(console.warn).mockClear();
    const libre = engage();
    libre.stream.emitText('Réponse coupée');
    libre.stream.emitUsage({input_tokens: 1, output_tokens: 1200});
    libre.stream.finish('max_tokens');
    await collect(libre.result.events);
    expect(vi.mocked(console.warn).mock.calls.some((call) => String(call[0]).includes('agent.match_truncated'))).toBe(false);
  });
});
