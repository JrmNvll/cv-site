/**
 * `ask()` — le câblage de la couche `agent` : validation de l'entrée, limiteur
 * (tout ou rien), historique de la session par `journal`, contexte par
 * `knowledge`, puis la passerelle. La passerelle et le journal sont simulés ;
 * le limiteur et la connaissance sont réels (fixture).
 *
 * Ce que la passerelle fait ensuite — réservation, appel, finalisation — est
 * prouvé dans `gateway.test.ts` ; ici, on prouve qu'elle est atteinte avec ce
 * qu'il faut, et jamais quand un refus préalable s'impose.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LIMITS, resetLimiter} from '@/agent/limiter';
import {MAX_QUESTION_CHARS} from '@/agent/pricing';
import {MESSAGE_LABELS} from '@/agent/prompts';

const gateway = vi.hoisted(() => ({callModel: vi.fn()}));
const journal = vi.hoisted(() => ({recentExchanges: vi.fn()}));

vi.mock('@/agent/gateway', () => gateway);
vi.mock('@/journal', () => journal);

type Agent = typeof import('@/agent');
let agent: Agent;

const VISITOR_ID = '01K4EXAMPVISIT000000000000';
const SESSION_ID = '01K4EXAMPSESS0000000000000';
const EXCHANGE_ID = '01K4EXAMPXCHG0000000000000';
const NOW = new Date('2026-09-15T10:00:00.000Z');

const base = {
  lang: 'fr',
  visitorId: VISITOR_ID,
  sessionId: SESSION_ID,
  ip: '203.0.113.7',
  question: 'Pourquoi la personne fictive est-elle en recherche ?',
  now: NOW
};

/** Ce que la passerelle rend quand elle est atteinte : un flux vide suffit ici. */
function engaged() {
  return {ok: true as const, exchangeId: EXCHANGE_ID, events: (async function* () {})()};
}

beforeEach(async () => {
  vi.resetAllMocks();
  resetLimiter();
  vi.resetModules();
  agent = await import('@/agent');
  gateway.callModel.mockReturnValue(engaged());
  journal.recentExchanges.mockReturnValue([]);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetLimiter();
  vi.restoreAllMocks();
});

describe('entrée invalide : refus avant tout, rien lu, rien consommé', () => {
  const invalides: [string, Record<string, unknown>][] = [
    ['question vide', {question: ''}],
    ['question blanche', {question: '   \n\t '}],
    // Des caractères invisibles seuls — largeur nulle, antiliants, marque d'ordre
    // des octets — ne sont pas une question, et réserveraient un appel facturé.
    ['question faite de caractères invisibles', {question: '\u200b\u200c\u200d \u2060\ufeff\u200b'}],
    ['question trop longue', {question: 'x'.repeat(MAX_QUESTION_CHARS + 1)}],
    ['question qui nʼest pas une chaîne', {question: 42}],
    ['langue hors du routage', {lang: 'de'}]
  ];

  for (const [nom, patch] of invalides) {
    it(nom, async () => {
      // `question: 42` sort du type : c'est bien ce que le test veut prouver.
      const result = await agent.ask({...base, ...patch} as unknown as Parameters<Agent['ask']>[0]);
      expect(result).toEqual({ok: false, reason: 'invalid_input'});
      expect(gateway.callModel).not.toHaveBeenCalled();
      expect(journal.recentExchanges).not.toHaveBeenCalled();
    });
  }

  it('ne consomme aucune fenêtre du limiteur : dix refus, puis dix questions passent', async () => {
    for (let n = 0; n < LIMITS.visitor.max; n += 1) {
      expect(await agent.ask({...base, question: ''})).toEqual({ok: false, reason: 'invalid_input'});
    }
    for (let n = 0; n < LIMITS.visitor.max; n += 1) {
      expect((await agent.ask(base)).ok).toBe(true);
    }
    expect(gateway.callModel).toHaveBeenCalledTimes(LIMITS.visitor.max);
  });

  it('accepte une question de mille caractères exactement, et la passe sans ses blancs', async () => {
    const question = `  ${'q'.repeat(MAX_QUESTION_CHARS)}\n`;
    const result = await agent.ask({...base, question});
    expect(result.ok).toBe(true);
    expect(gateway.callModel).toHaveBeenCalledWith(
      expect.objectContaining({question: 'q'.repeat(MAX_QUESTION_CHARS)})
    );
  });

  it('retire les caractères invisibles dʼune vraie question avant de la passer', async () => {
    await agent.ask({...base, question: '\ufeffQuel\u200b parcours ?\u2060'});
    expect(gateway.callModel).toHaveBeenCalledWith(expect.objectContaining({question: 'Quel parcours ?'}));
  });
});

describe('débit dépassé : refus sans appel, rien lu', () => {
  it('laisse passer dix questions du même visiteur en quinze minutes et refuse la onzième', async () => {
    for (let n = 0; n < LIMITS.visitor.max; n += 1) {
      expect((await agent.ask(base)).ok).toBe(true);
    }
    journal.recentExchanges.mockClear();
    gateway.callModel.mockClear();

    const result = await agent.ask(base);
    expect(result).toEqual({ok: false, reason: 'rate_limited'});
    expect(gateway.callModel).not.toHaveBeenCalled();
    expect(journal.recentExchanges).not.toHaveBeenCalled();
  });

  it('bloque aussi par adresse : un autre visiteur derrière la même adresse est refusé', async () => {
    for (let n = 0; n < LIMITS.ip.max; n += 1) {
      expect((await agent.ask({...base, visitorId: `01K4EXAMPVISIT0000000000${String(n).padStart(2, '0')}`})).ok).toBe(true);
    }
    const result = await agent.ask({...base, visitorId: VISITOR_ID});
    expect(result).toEqual({ok: false, reason: 'rate_limited'});
    expect(gateway.callModel).toHaveBeenCalledTimes(LIMITS.ip.max);
  });

  it('rouvre quand la première question sort de la fenêtre', async () => {
    for (let n = 0; n < LIMITS.visitor.max; n += 1) {
      expect((await agent.ask(base)).ok).toBe(true);
    }
    expect(await agent.ask(base)).toEqual({ok: false, reason: 'rate_limited'});
    const plusTard = new Date(NOW.getTime() + LIMITS.visitor.windowMs + 1);
    expect((await agent.ask({...base, now: plusTard})).ok).toBe(true);
  });
});

describe('question recevable : la passerelle reçoit ce quʼelle attend', () => {
  it('langue, session, question normalisée, instant, et un contexte sur le dossier', async () => {
    const result = await agent.ask({...base, question: `  ${base.question}  `});
    expect(result).toEqual(expect.objectContaining({ok: true, exchangeId: EXCHANGE_ID}));

    expect(gateway.callModel).toHaveBeenCalledTimes(1);
    const input = gateway.callModel.mock.calls[0]![0];
    expect(input).toEqual(
      expect.objectContaining({lang: 'fr', sessionId: SESSION_ID, question: base.question, now: NOW})
    );
    // Le contexte vient de `knowledge` : un bloc système en cache, la question en dernier.
    expect(input.context.system).toHaveLength(1);
    expect(input.context.system[0].cache_control).toEqual({type: 'ephemeral'});
    expect(input.context.messages.at(-1)).toEqual(
      expect.objectContaining({role: 'user', content: expect.stringContaining(base.question)})
    );
    expect(input.context.retrieved).toContain('qa:lic-01');
    // Il ne reçoit jamais le visiteur ni lʼadresse : ils ne servent quʼau limiteur.
    expect(input).not.toHaveProperty('visitorId');
    expect(input).not.toHaveProperty('ip');
  });

  it('demande les six derniers échanges de la session et les place avant la question, du plus ancien au plus récent', async () => {
    journal.recentExchanges.mockReturnValue([
      {id: '01K4EXAMPXCHG0000000000001', kind: 'hero', question: 'Première ?', answer: 'Première réponse.', at: '2026-09-15T09:00:00.000Z'},
      {id: '01K4EXAMPXCHG0000000000002', kind: 'chat', question: 'Deuxième ?', answer: 'Deuxième réponse.', at: '2026-09-15T09:30:00.000Z'}
    ]);

    await agent.ask(base);

    expect(journal.recentExchanges).toHaveBeenCalledWith(SESSION_ID, agent.HISTORY_TURNS);
    expect(agent.HISTORY_TURNS).toBe(6);
    const messages = gateway.callModel.mock.calls[0]![0].context.messages;
    expect(messages.slice(0, 4)).toEqual([
      {role: 'user', content: 'Première ?'},
      // Un tour `hero` est marqué comme lu dans le dossier : la sorte de l'échange est passée au contexte.
      {role: 'assistant', content: `${MESSAGE_LABELS.fr.hero}\nPremière réponse.`},
      {role: 'user', content: 'Deuxième ?'},
      {role: 'assistant', content: 'Deuxième réponse.'}
    ]);
    expect(messages).toHaveLength(5);
  });

  it('part sans historique si le journal ne peut pas le lire, et le dit', async () => {
    journal.recentExchanges.mockImplementation(() => {
      throw new Error('base verrouillée');
    });

    const result = await agent.ask(base);
    expect(result.ok).toBe(true);
    const messages = gateway.callModel.mock.calls[0]![0].context.messages;
    expect(messages).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('agent.history_unavailable'));
  });

  it('transmet tel quel un refus de la passerelle', async () => {
    gateway.callModel.mockReturnValue({ok: false, reason: 'cap_reached'});
    expect(await agent.ask(base)).toEqual({ok: false, reason: 'cap_reached'});
  });
});
